"""기상청(KMA) API허브 비동기 클라이언트.

출처는 **기상청 API허브**(`apihub.kma.go.kr/api/typ02/openApi/...`)다 — R13에서
공공데이터포털(`apis.data.go.kr/1360000/...`)에서 옮겼다. 응답 봉투(resultCode·
items)와 요청 인자는 그대로라 파싱 계층은 재사용하고, 실제로 갈린 것은 두 가지다:
**인증 파라미터 이름**(`serviceKey` → `authKey`)과 **ASOS 일자료의 출처**
(`AsosDalyInfoService` → typ01 `kma_sfcdd.php` — openApi 일자료는 월보라 당월을
주지 않는다. 아래 ASOS 어댑터의 ⚠️ 참조).

docs/specs/06_kma_api_parsing_spec.md 파싱 규칙 준수:
- response.header.resultCode == "00" 성공, "03"(NODATA)은 캐시 fallback, 그 외 KMAApiError
- authKey는 이미 인코딩된 키일 수 있으므로 재인코딩 금지 (URL 문자열에 직접 부착)
- PCP/PTY 값이 "강수없음" 등 문자열로 올 수 있음 → 숫자 변환 전 체크
- 응답 item이 flat하게 섞여 있음 → (fcstDate, fcstTime) 기준 grouping 후 category별 재구성
- 타임아웃 10초, 실패 시 1회 재시도 후 캐시 fallback
- 캐시 우선: Redis weather:{date}:{region} (TTL 1시간) 먼저 확인, miss일 때만 API 호출
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger(__name__)

# ── 인증키(authKey/serviceKey) 로그 유출 차단 (CO-Q-3 / CO-N-3d) ────────────
# 발급키는 URL 쿼리에 붙는다(재인코딩 금지 계약). 그래서 **URL이 찍히는 모든 자리가
# 곧 키 유출 지점**이다. 실측된 두 경로를 여기서 함께 막는다:
#   ① httpx 자체 로거가 성공·실패 무관하게 `HTTP Request: GET <전체 URL>`을 INFO로
#      남긴다 — "실패 시 공유 금지" 운영 수칙으로는 절대 못 막는 상시 유출이다.
#   ② httpx 예외의 str()에 `for url '...'`가 들어가 우리 warning 라인에 실린다.
# ①은 로거 레벨 상향(요청 라인은 우리 관측 자산이 아니다 — 실패는 ②가 남긴다),
# ②는 mask_service_key로 마스킹한다. 대회 규정상 **키 노출 = 실격**이다.
logging.getLogger("httpx").setLevel(logging.WARNING)

_SERVICE_KEY_RE = re.compile(r"((?:serviceKey|authKey)=)[^&\s'\"]+", re.IGNORECASE)
SERVICE_KEY_MASK = "***"


def mask_service_key(text: object) -> str:
    """문자열에서 `serviceKey=...` / `authKey=...` 값을 마스킹한다 (순수 함수).

    **두 이름을 모두 잡는다.** R13에서 데이터 출처를 공공데이터포털(`serviceKey`)에서
    기상청 API허브(`authKey`)로 옮겼는데, 정규식이 `serviceKey`만 알고 있으면 전환
    당일부터 키가 로그로 그대로 샌다 — 규정상 **키 노출 = 실격**이다. 구 이름을
    지우지 않는 이유는 되돌림·혼용 배포에서도 방어가 유지돼야 하기 때문이다.

    celery/app/kma_client.py에 같은 함수가 있다 — 교차 빌드 컨텍스트라 import로
    묶을 수 없어 값을 양쪽에 둔다(CLAUDE.md "단일 소유자 + 계약 테스트" 관례).
    드리프트는 tests/test_kma_key_masking.py가 양방향으로 감시한다.
    """
    return _SERVICE_KEY_RE.sub(rf"\1{SERVICE_KEY_MASK}", str(text))


KST = timezone(timedelta(hours=9))

# ── Redis 키/TTL (01번 스펙 Redis 키 네이밍 규칙) ──
WEATHER_CACHE_TTL_SEC = 60 * 60  # weather:{date}:{region} — 1시간

# ── 주요 지역 격자 좌표 (단기예보 nx, ny) ──
KMA_GRID = {
    "서울": (60, 127), "부산": (98, 76), "대구": (89, 90),
    "인천": (55, 124), "광주": (58, 74), "대전": (67, 100),
    "울산": (102, 84), "강릉": (92, 131), "제주": (52, 38),
    "수원": (60, 121), "청주": (69, 106), "전주": (63, 89),
}

# ── 중기예보(getMidLandFcst) 지역코드 ──
KMA_MID_REGION = {
    "서울": "11B00000",
    "부산": "11H20000",
}

# ── 과거관측(ASOS) 지점번호 ──
KMA_STATION = {"서울": "108", "부산": "159", "강릉": "105"}

# ── 단기예보 카테고리 코드 매핑 ──
KMA_CATEGORY = {
    "TMP": "기온",        # ℃
    "TMN": "최저기온",     # ℃ (일 1회)
    "TMX": "최고기온",     # ℃ (일 1회)
    "REH": "습도",        # %
    "WSD": "풍속",        # m/s
    "POP": "강수확률",     # %
    "PTY": "강수형태",     # 0없음/1비/2비눈/3눈/4소나기
    "SKY": "하늘상태",     # 1맑음/3구름많음/4흐림
    "PCP": "강수량",       # mm ("강수없음" 문자열 주의)
}

# 문자열로 오는 무강수 표기들 (PCP/PTY/sumRn 공통)
NO_RAIN_STRINGS = {"강수없음", "적설없음", "없음", "", None}

# SKY 코드 → 한국어 표현 (KMA 카테고리 의미의 단일 소유자 — session_service가 import).
SKY_TEXT = {1: "맑음", 3: "구름많음", 4: "흐림"}

# 퀴즈/리그 기준 지역 (MVP 기본값 — celery/app/config.py DEFAULT_REGION과 일치)
DEFAULT_REGION = "서울"


def user_region(user) -> str:
    """유저 기준 지역 — users.region NULL이면 서울 (R11-01 §8.2 하위 호환 계약).

    NULL=서울 폴백의 **단일 소유자**다: 기존 유저·게스트(region 미설정)가 무변경으로
    동작하는 근거. 화이트리스트 밖 저장값(과거 데이터·수동 조작)도 서울로 방어한다 —
    get_short_forecast가 unknown region에 ValueError를 내 날씨가 통째로 {}가 되는
    것을 막는다. 화이트리스트 강제 자체는 쓰기 시점(PUT /progress/region 422) 담당.
    """
    region = getattr(user, "region", None)
    return region if region in KMA_GRID else DEFAULT_REGION

# 단기예보 발표시각 (하루 8회)
KMA_BASE_TIMES = ("0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300")


class KMAApiError(Exception):
    """resultCode != '00' (NODATA 제외) 또는 응답 구조 이상."""


def weather_cache_key(date_str: str, region: str) -> str:
    return f"weather:{date_str}:{region}"


# KMA 호출 실패 마커 — 이 TTL 동안은 재호출 없이 즉시 폴백 경로를 탄다.
# 키 미발급·KMA 장애 시 답안 제출마다 타임아웃·재시도 대기를 지불하는 것을 방지
# (채점 지연의 주범). 성공 캐시(weather:*)와 별도 키라 회복도 TTL 내 자동.
WEATHER_FAIL_TTL_SEC = 60 * 5


def weather_fail_key(date_str: str, region: str) -> str:
    return f"weather:fail:{date_str}:{region}"


def parse_kma_value(raw):
    """KMA 값 파싱: '강수없음' 등 문자열이면 0.0, 숫자면 float 변환."""
    if raw in NO_RAIN_STRINGS:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return raw  # 숫자가 아닌 유의미한 문자열은 원본 유지


def group_forecast_items(items: list[dict]) -> list[dict]:
    """flat item 리스트를 (fcstDate, fcstTime) 기준으로 grouping해
    시간대별 dict 리스트로 재구성한다 (06번 스펙 파싱 규칙)."""
    grouped: dict[tuple, dict] = {}
    for item in items:
        key = (item.get("fcstDate"), item.get("fcstTime"))
        slot = grouped.setdefault(key, {})
        category = item.get("category")
        if category in KMA_CATEGORY:
            slot[category] = parse_kma_value(item.get("fcstValue"))
    return [
        {"datetime": f"{d}{t}", **values}
        for (d, t), values in sorted(grouped.items())
    ]


def forecast_numbers(forecasts: list[dict], category: str) -> list[float]:
    """예보 항목 리스트에서 category 숫자값만 추출 (문자·결측 무시) —
    세션 슬롯 주입(session_service)과 대결 정산(duel_service)이 공유."""
    return [
        float(f[category])
        for f in forecasts
        if isinstance(f.get(category), (int, float))
    ]


def forecast_temp_max(forecasts: list[dict]) -> float | None:
    """일 최고기온 — TMX(일 1회) 우선, 없으면 TMP 최대 (06번 파싱 규칙)."""
    tmx = forecast_numbers(forecasts, "TMX")
    if tmx:
        return tmx[0]
    tmp = forecast_numbers(forecasts, "TMP")
    return max(tmp) if tmp else None


def latest_base_datetime(now: datetime | None = None) -> tuple[str, str]:
    """현재(KST) 기준 가장 최근에 발표된 단기예보 base_date/base_time.

    발표 후 데이터 반영 지연을 고려해 발표시각+40분 이전이면 이전 발표시각 사용.
    """
    now = now or datetime.now(KST)
    for days_back in (0, 1):
        day = now - timedelta(days=days_back)
        candidates = KMA_BASE_TIMES if days_back else [
            t for t in KMA_BASE_TIMES
            if day.replace(hour=int(t[:2]), minute=int(t[2:]), second=0, microsecond=0)
            + timedelta(minutes=40) <= now
        ]
        if candidates:
            return day.strftime("%Y%m%d"), candidates[-1]
    return (now - timedelta(days=1)).strftime("%Y%m%d"), "2300"


def auth_keys() -> list[str]:
    """사용할 인증키를 우선순위대로 — 주키(대회 계정) → 스페어(개인 계정).

    스페어를 두는 이유는 **주키가 죽는 날짜가 이미 정해져 있기 때문**이다:
    대회 제공 계정 키는 8/22 만료인데 규정상 서비스 URL은 9월 셋째 주까지 살아
    있어야 한다. 그날 사람이 개입하지 않으면 날씨가 통째로 degraded로 떨어진다.
    한도(계정당 20,000콜/일) 소진도 같은 자리에서 흡수된다.

    ⚠️ 스페어 계정에도 **같은 3종 활용신청**(getVilageFcst·getMidLandFcst·
    getDailyWthrData)이 승인돼 있어야 한다 — 키만 넣으면 조용히 같이 실패한다.
    """
    return [k for k in (settings.KMA_API_KEY, settings.KMA_API_KEY_SPARE) if k.strip()]


# ── 키 게이트 (R13) ──────────────────────────────────────────────────────────
# 이 서비스의 실제 사고 형태는 "키가 틀렸다"가 아니라 **"틀린 걸 아무도 모른다"**였다:
# 잘못된 키·미승인 API·만료 어느 쪽이든 KMAApiError로 떨어지고 상위가 degraded 200
# 으로 흡수해 화면에 아무 티가 안 났다. `KMA_API_KEY`는 기동 거부 대상도 아니다
# (무키 기동은 스모크의 전제라 그대로 둔다). 그래서 **거부하는 대신 관측 가능하게**
# 만든다: 실트래픽 결과를 여기 기록하고 `/health`의 `kma` 필드가 읽는다.
# 기동 시 `probe_key()`가 1콜로 시드하므로 트래픽 전에도 상태를 알 수 있다.
#
# `active_key == "spare"`가 이 게이트의 핵심 출력이다 — **주키가 죽었다는 뜻**이고,
# 그 사실이 8/22(대회 계정 만료) 전후로 조용히 지나가면 안 된다.

_KEY_PROBE_TIMEOUT_SEC = 12.0  # 최악 2키 × 2시도 × 10초를 상한한다(기동 지연 방지)

_key_status: dict = {"state": "unknown", "active_key": None, "detail": None}


def _key_label(key: str) -> str:
    """어느 키가 응답을 냈나 — 인덱스가 아니라 **값**으로 판정한다.

    스페어만 설정된 환경에서는 `auth_keys()[0]`이 스페어라, 인덱스로 라벨하면
    "주키 정상"이라고 거짓 보고한다.
    """
    return "primary" if key and key == settings.KMA_API_KEY.strip() else "spare"


def _record_key_result(state: str, active_key: str | None, detail: object = None) -> None:
    """인증 상태 기록.

    ⚠️ `detail`은 **반드시 마스킹**한다. 예외 문자열에는 요청 URL(=authKey)이 실리는데
    이 값은 이제 `/health` 응답으로 **외부에 나간다** — 로그 유출보다 나쁘다.
    """
    _key_status.update({
        "state": state,
        "active_key": active_key,
        "detail": mask_service_key(detail) if detail is not None else None,
    })


def key_status() -> dict:
    """현재 KMA 인증 상태 스냅샷 (`/health`가 읽는 읽기 전용 사본)."""
    return {
        **_key_status,
        "keys_configured": len(auth_keys()),
        "spare_configured": bool(settings.KMA_API_KEY_SPARE.strip()),
    }


async def probe_key() -> dict:
    """기동 시 1콜로 인증 상태를 확정한다 — 실패해도 예외를 올리지 않는다.

    캐시·실패 마커를 쓰지 않는다: 부팅 시점엔 Redis가 아직 없을 수 있고, 프로브
    실패가 실트래픽을 5분간(WEATHER_FAIL_TTL_SEC) 막아서도 안 된다.
    """
    if not auth_keys():
        _record_key_result("unconfigured", None)
        return key_status()

    base_date, base_time = latest_base_datetime()
    nx, ny = KMA_GRID[DEFAULT_REGION]
    try:
        await asyncio.wait_for(
            _request_items(settings.KMA_VILAGE_FCST_URL, {
                "pageNo": 1,
                "numOfRows": 1,
                "dataType": "JSON",
                "base_date": base_date,
                "base_time": base_time,
                "nx": nx,
                "ny": ny,
            }),
            _KEY_PROBE_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        # 취소된 요청은 _request_items가 결과를 못 남긴다 — 여기서 직접 기록한다.
        _record_key_result("degraded", None, f"프로브 타임아웃({_KEY_PROBE_TIMEOUT_SEC}s)")
    except Exception as exc:  # KMAApiError 포함 — 기동을 막지 않는다
        _record_key_result("degraded", None, exc)
    return key_status()


async def _request_items(base_url: str, params: dict) -> list[dict]:
    """공통 요청 헬퍼 — 키를 순서대로 시도한다(주키 실패 시 스페어).

    **어떤 실패든 다음 키로 넘어간다.** API허브가 인증 실패·한도 초과를 어떤
    resultCode로 주는지 실측하지 못했으므로, 코드를 좁게 특정하면 정작 만료 당일에
    안 넘어갈 위험이 있다. 넓게 잡는 대신 호출 낭비는 상위의 실패 마커
    (WEATHER_FAIL_TTL_SEC 5분)가 막는다 — 실패해도 5분에 한 번뿐이다.

    성공·실패는 키 게이트에 기록된다(위 `_record_key_result`). NODATA(03)는 빈
    리스트로 정상 반환되므로 **ok로 기록된다** — 인증 자체는 통과한 것이 맞다.
    """
    return await _try_keys(lambda k: _request_items_with_key(base_url, params, k))


async def _try_keys(fetch):
    """키를 순서대로 시도하고 결과를 **키 게이트에 기록**한다.

    `fetch(auth_key)`는 실패 시 KMAApiError를 올린다. JSON(`_request_items`)과
    텍스트(`_request_text`) 두 경로가 이 한 곳을 공유한다 — 폴백 순서와 상태 기록이
    경로마다 갈리면 한쪽만 만료를 넘기고 다른 쪽은 조용히 죽는다.
    """
    configured = auth_keys()
    keys = configured or [""]  # 미설정이면 종전과 같이 빈 키로 1회 시도한다
    last_exc: KMAApiError | None = None
    for idx, key in enumerate(keys):
        try:
            out = await fetch(key)
        except KMAApiError as exc:
            last_exc = exc
            if idx + 1 < len(keys):
                logger.warning(
                    "KMA %d번 키 실패 — 다음 키로 재시도: %s", idx + 1, mask_service_key(exc)
                )
            continue
        _record_key_result("ok", _key_label(key) if configured else None)
        return out
    _record_key_result("degraded" if configured else "unconfigured", None, last_exc)
    raise last_exc


async def _request_text(base_url: str, params: dict) -> str:
    """typ01 텍스트 응답 요청 — JSON 봉투가 없는 경로(일자료 kma_sfcdd.php)."""
    return await _try_keys(lambda k: _request_text_with_key(base_url, params, k))


async def _request_text_with_key(base_url: str, params: dict, auth_key: str) -> str:
    """단일 키로 typ01 1회 요청. 타임아웃 10초, 실패 시 1회 재시도.

    권한 없는 API는 **HTTP 403**으로 온다(2026-08-10 실측: 미승인 kma_sfcdd3.php).
    raise_for_status가 잡아 KMAApiError로 바뀌므로 스페어 키 폴백이 인증 실패에서도
    동작한다.
    """
    query = urlencode(params)
    url = f"{base_url}?authKey={auth_key}&{query}"

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(2):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.text
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning(
                    "KMA(typ01) 요청 실패 (attempt %d): %s",
                    attempt + 1,
                    mask_service_key(f"{type(exc).__name__}: {exc}"),
                )
    raise KMAApiError(
        f"KMA typ01 request failed after retry: {mask_service_key(last_exc)}"
    )


async def _request_items_with_key(base_url: str, params: dict, auth_key: str) -> list[dict]:
    """단일 키로 1회 요청. resultCode 체크 포함. NODATA(03)는 빈 리스트.

    타임아웃 10초, 실패 시 1회 재시도.
    """
    # authKey 재인코딩 금지 — 발급키를 URL에 직접 부착하고
    # 나머지 파라미터만 urlencode 한다.
    query = urlencode(params)
    url = f"{base_url}?authKey={auth_key}&{query}"

    data = None
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(2):  # 최초 1회 + 재시도 1회
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                break
            except (httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                # httpx 예외 문자열에 요청 URL(=serviceKey 포함)이 들어간다 — 마스킹
                logger.warning(
                    "KMA 요청 실패 (attempt %d): %s",
                    attempt + 1,
                    mask_service_key(f"{type(exc).__name__}: {exc}"),
                )
    if data is None:
        # 예외 메시지도 상위에서 로깅·응답에 실릴 수 있으므로 같은 마스킹을 건다
        raise KMAApiError(
            f"KMA request failed after retry: {mask_service_key(last_exc)}"
        )

    header = data.get("response", {}).get("header", {})
    result_code = header.get("resultCode")
    if result_code != "00":
        if result_code == "03":  # NODATA — 호출측에서 캐시 fallback
            logger.info("KMA NODATA(03): %s", header.get("resultMsg"))
            return []
        raise KMAApiError(f"resultCode={result_code} msg={header.get('resultMsg')}")

    items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
    return items if isinstance(items, list) else [items]


async def _cached_fallback(region: str) -> dict | None:
    """Redis에서 오늘 → 어제 순으로 이전 캐시를 찾는다 (06번 에러 처리 정책)."""
    redis = get_redis()
    now = datetime.now(KST)
    for days_back in (0, 1):
        date_str = (now - timedelta(days=days_back)).strftime("%Y%m%d")
        raw = await redis.get(weather_cache_key(date_str, region))
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                continue
    return None


async def get_short_forecast(
    region: str, base_date: str | None = None, base_time: str | None = None
) -> dict:
    """단기예보(getVilageFcst).

    반환: {'region': str, 'forecasts': [{'datetime': 'YYYYMMDDHHMM', 'TMP': 28.0, ...}]}

    순서: Redis 캐시 확인 → API 호출 → 파싱((fcstDate,fcstTime) grouping) → 캐시 저장.
    NODATA/요청 실패 시 이전 캐시 fallback.
    """
    if region not in KMA_GRID:
        raise ValueError(f"unknown region: {region}")

    today = datetime.now(KST).strftime("%Y%m%d")
    redis = get_redis()

    # 1) 캐시 우선
    cached = await redis.get(weather_cache_key(today, region))
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            logger.warning("weather 캐시 JSON 파싱 실패 — API 재호출 (%s)", region)

    # 1.5) 최근 실패 마커 — 재호출 대기 없이 실패 시와 동일한 폴백 경로
    if await redis.get(weather_fail_key(today, region)):
        fallback = await _cached_fallback(region)
        if fallback is not None:
            return fallback
        raise KMAApiError("KMA 최근 실패 마커 활성 — 재호출 대기 중")

    if base_date is None or base_time is None:
        base_date, base_time = latest_base_datetime()

    # 2) API 호출
    nx, ny = KMA_GRID[region]
    try:
        items = await _request_items(settings.KMA_VILAGE_FCST_URL, {
            "pageNo": 1,
            "numOfRows": 1000,
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": nx,
            "ny": ny,
        })
    except KMAApiError:
        await redis.setex(weather_fail_key(today, region), WEATHER_FAIL_TTL_SEC, "1")
        fallback = await _cached_fallback(region)
        if fallback is not None:
            return fallback
        raise

    if not items:  # NODATA(03)
        fallback = await _cached_fallback(region)
        if fallback is not None:
            return fallback
        return {"region": region, "forecasts": []}

    # 3) 파싱 + 4) 캐시 저장 (weather:{date}:{region}, TTL 1h)
    result = {"region": region, "forecasts": group_forecast_items(items)}
    await redis.setex(
        weather_cache_key(today, region),
        WEATHER_CACHE_TTL_SEC,
        json.dumps(result, ensure_ascii=False),
    )
    return result


async def get_today_weather(region: str = DEFAULT_REGION) -> dict:
    """오늘의 날씨 (RAG 피드백·퀴즈 생성 입력용). 실패 시 빈 dict."""
    try:
        return await get_short_forecast(region)
    except (KMAApiError, ValueError) as exc:
        logger.error("오늘 날씨 조회 실패 (%s): %s", region, exc)
        return {}


async def get_mid_forecast(region: str = DEFAULT_REGION, tm_fc: str | None = None) -> dict:
    """중기예보(getMidLandFcst). 3~10일 후 오전/오후 날씨 + 강수확률.

    반환 예: {"wf3Am": "구름많음", "wf3Pm": "맑음", "rnSt3Am": 30, ...}
    """
    reg_id = KMA_MID_REGION.get(region, KMA_MID_REGION[DEFAULT_REGION])

    if tm_fc is None:
        # 발표시각: 매일 06시 / 18시. 현재 시각 기준 가장 최근 발표분 사용.
        now = datetime.now(KST)
        if now.hour >= 18:
            tm_fc = now.strftime("%Y%m%d") + "1800"
        elif now.hour >= 6:
            tm_fc = now.strftime("%Y%m%d") + "0600"
        else:
            tm_fc = (now - timedelta(days=1)).strftime("%Y%m%d") + "1800"

    try:
        items = await _request_items(settings.KMA_MID_LAND_FCST_URL, {
            "pageNo": 1,
            "numOfRows": 10,
            "dataType": "JSON",
            "regId": reg_id,
            "tmFc": tm_fc,
        })
    except KMAApiError as exc:
        logger.error("중기예보 조회 실패 (%s): %s", region, exc)
        return {}
    return items[0] if items else {}


# ── ASOS 일자료 어댑터 (API허브 typ01 kma_sfcdd.php) ─────────────────────────
# 공공데이터포털 `AsosDalyInfoService`는 **기간**(startDt~endDt) 조회에 필드가
# avgTa/maxTa/minTa/sumRn였다. API허브에는 그 서비스가 없다. 여기서 그 차이를
# 흡수해 **공개 시그니처와 반환 형태를 종전 그대로 유지**한다 — duel_service·
# league.py는 무변경이다.
#
# ⚠️ **왜 openApi가 아니라 typ01인가** (2026-08-10 실측으로 확정):
# API허브의 openApi 일자료 `SfcMtlyInfoService/getDailyWthrData`는 이름 그대로
# **월보(月報)**라 당월을 주지 않는다 — 어제 날짜로 부르면
# `resultCode=99 "발간되지 않은 기간입니다"`로 거절한다. 그런데 우리가 필요한 건
# 전부 당월이다(대결 정산=어제, 리그 정산=지난주, 브리핑=최근 며칠). 그래서 월보를
# 1차로 두는 폴백 사슬은 **매 호출 실패를 먼저 지불하는** 구조가 된다. 폴백이 아니라
# **교체**인 이유다. typ01 `kma_sfcdd.php`는 같은 날짜로 어제 행을 정상 반환한다.
#
# typ01은 JSON이 아니라 **`#` 주석 + 콤마 구분 텍스트**이고 결측을 `-9`로 준다.
# 그래서 `_request_items`(JSON 봉투)가 아니라 `_request_text`를 쓴다.

# typ01 kma_sfcdd.php 컬럼 인덱스 (0-based).
# 응답 헤더의 1-based 문서 번호 1·11·12·14·39에서 유도했고 2026-08-10 서울(108)
# 실측으로 확인했다: `20260809,108,…,27.6,31.6,1354,24.5,…` → 평균27.6 최고31.6 최저24.5.
ASOS_COL = {"tm": 0, "avgTa": 10, "maxTa": 11, "minTa": 13, "sumRn": 38}
ASOS_MIN_COLS = 57  # 실측 컬럼 수. 미달 행은 버린다 — 어긋난 인덱스가 결측보다 나쁘다.

# typ01 결측 표기. **문자열로 판정한다** — float 변환 후 비교는 표기 변형에 취약하다.
# 실측: 무강수일의 `RN_DAY=-9.0`. 이걸 놓치면 강수 -9mm·기온 -9℃가 정산에 들어간다.
ASOS_MISSING_RE = re.compile(r"^-9(\.0+)?$")


def asos_days(start_dt: str, end_dt: str) -> list[str]:
    """'YYYYMMDD' 기간을 날짜 목록으로 편다 — typ01은 하루 단위 조회(`tm`)다.

    주간 리그 정산이 7콜이 되지만 계정 한도가 20,000콜/일이라 무시할 수 있다.
    """
    start = datetime.strptime(start_dt, "%Y%m%d").date()
    end = datetime.strptime(end_dt, "%Y%m%d").date()
    if end < start:
        return []
    return [
        (start + timedelta(days=i)).strftime("%Y%m%d")
        for i in range((end - start).days + 1)
    ]


def normalize_asos_tm(raw: object) -> str | None:
    """관측일자를 'YYYY-MM-DD'로 통일. 'YYYYMMDD'·'YYYY-MM-DD' 둘 다 받는다.

    종전 출력이 'YYYY-MM-DD'였고 duel_service가 그 형태로 오늘/과거를 가른다 —
    표기가 무엇이든 이 자리에서 흡수해야 정산이 조용히 어긋나지 않는다.
    """
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) < 8:
        return None
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"


def asos_value(raw: object) -> float:
    """typ01 관측값 1개 → 숫자. `-9` 계열 결측은 기존 결측 표현(0.0)으로 흡수한다.

    None을 새로 도입하지 않는 이유: duel_service가 이 값들로 산술을 한다. 종전에도
    결측은 0.0이었으므로(parse_kma_value(None)) 동작을 바꾸지 않는 쪽을 고른다.
    """
    text = str(raw or "").strip()
    if ASOS_MISSING_RE.match(text):
        return 0.0
    return parse_kma_value(text)


def parse_asos_text(text: str) -> list[dict]:
    """typ01 응답 텍스트 → 행 목록(tm·avgTa·maxTa·minTa·sumRn).

    `#`로 시작하는 주석·헤더 줄은 버리고, 컬럼 수가 모자란 행도 버린다 —
    조용히 어긋난 인덱스로 엉뚱한 값을 정산에 넣는 것이 최악이다.
    """
    rows: list[dict] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = [f.strip() for f in line.split(",")]
        if len(fields) < ASOS_MIN_COLS:
            logger.warning(
                "ASOS 행 컬럼 부족 — 버림 (%d < %d)", len(fields), ASOS_MIN_COLS
            )
            continue
        tm = normalize_asos_tm(fields[ASOS_COL["tm"]])
        if not tm:
            continue
        rows.append({
            "tm": tm,
            "avgTa": asos_value(fields[ASOS_COL["avgTa"]]),
            "maxTa": asos_value(fields[ASOS_COL["maxTa"]]),
            "minTa": asos_value(fields[ASOS_COL["minTa"]]),
            "sumRn": asos_value(fields[ASOS_COL["sumRn"]]),
        })
    return rows


def asos_in_range(rows: list[dict], start_dt: str, end_dt: str) -> list[dict]:
    """[start_dt, end_dt]만 남기고 날짜순 정렬 (중복 날짜는 첫 행 유지)."""
    lo, hi = re.sub(r"\D", "", start_dt), re.sub(r"\D", "", end_dt)
    seen: set[str] = set()
    kept = []
    for r in rows:
        tm = r.get("tm")
        if not tm or not (lo <= re.sub(r"\D", "", tm) <= hi) or tm in seen:
            continue
        seen.add(tm)
        kept.append(r)
    return sorted(kept, key=lambda r: r["tm"])


def asos_cache_key(start_dt: str, end_dt: str, region: str) -> str:
    return f"asos:{start_dt}:{end_dt}:{region}"


def asos_fail_key(start_dt: str, end_dt: str, region: str) -> str:
    return f"asos:fail:{start_dt}:{end_dt}:{region}"


async def _fetch_daily_obs(start_dt: str, end_dt: str, stn_id: str) -> list[dict]:
    """일자료 행을 긁어온다 — typ01 `kma_sfcdd.php`, **하루 1콜**.

    한 날짜라도 실패하면 전체가 KMAApiError로 올라간다(부분 결과로 정산하면 승패가
    조용히 틀린다). 주간 정산이 7콜이 되지만 계정 한도 20,000콜/일 대비 무시 가능하다.
    """
    rows: list[dict] = []
    for day in asos_days(start_dt, end_dt):
        text = await _request_text(settings.KMA_ASOS_DALY_URL, {
            "tm": day,
            "stn": stn_id,
            "help": 0,  # 주석 블록 축소 — 파서는 '#' 줄을 어차피 버린다
        })
        rows += parse_asos_text(text)
    return rows


async def get_past_observation(start_dt: str, end_dt: str, region: str = DEFAULT_REGION) -> list[dict]:
    """과거관측 일자료(API허브 typ01 kma_sfcdd.php). 일별 관측값 리스트.

    각 항목: {'tm': 'YYYY-MM-DD', 'avgTa': float, 'maxTa': float, 'minTa': float, 'sumRn': float}

    단기예보와 동일한 Redis 캐시(1h)+실패 마커(5분) 패턴 (R9-01 §3.1 ② — 브리핑
    GET이 요청마다 이 함수를 타므로, 키 미발급·KMA 장애 시 매 요청 타임아웃·재시도
    대기를 지불하지 않도록 한다). 실패는 KMAApiError로 전파(호출측이 폴백 판단).
    """
    stn_id = KMA_STATION.get(region, KMA_STATION[DEFAULT_REGION])
    redis = get_redis()

    cached = await redis.get(asos_cache_key(start_dt, end_dt, region))
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            logger.warning("asos 캐시 JSON 파싱 실패 — API 재호출 (%s)", region)

    if await redis.get(asos_fail_key(start_dt, end_dt, region)):
        raise KMAApiError("ASOS 최근 실패 마커 활성 — 재호출 대기 중")

    try:
        rows = await _fetch_daily_obs(start_dt, end_dt, stn_id)
    except KMAApiError:
        await redis.setex(asos_fail_key(start_dt, end_dt, region), WEATHER_FAIL_TTL_SEC, "1")
        raise

    result = asos_in_range(rows, start_dt, end_dt)
    await redis.setex(
        asos_cache_key(start_dt, end_dt, region),
        WEATHER_CACHE_TTL_SEC,
        json.dumps(result, ensure_ascii=False),
    )
    return result

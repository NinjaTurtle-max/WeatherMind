"""기상청(KMA) 공공데이터 API 비동기 클라이언트.

docs/specs/06_kma_api_parsing_spec.md 파싱 규칙 준수:
- response.header.resultCode == "00" 성공, "03"(NODATA)은 캐시 fallback, 그 외 KMAApiError
- serviceKey는 이미 인코딩된 키일 수 있으므로 재인코딩 금지 (URL 문자열에 직접 부착)
- PCP/PTY 값이 "강수없음" 등 문자열로 올 수 있음 → 숫자 변환 전 체크
- 응답 item이 flat하게 섞여 있음 → (fcstDate, fcstTime) 기준 grouping 후 category별 재구성
- 타임아웃 10초, 실패 시 1회 재시도 후 캐시 fallback
- 캐시 우선: Redis weather:{date}:{region} (TTL 1시간) 먼저 확인, miss일 때만 API 호출
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger(__name__)

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

# 단기예보 발표시각 (하루 8회)
KMA_BASE_TIMES = ("0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300")


class KMAApiError(Exception):
    """resultCode != '00' (NODATA 제외) 또는 응답 구조 이상."""


def weather_cache_key(date_str: str, region: str) -> str:
    return f"weather:{date_str}:{region}"


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


async def _request_items(base_url: str, params: dict) -> list[dict]:
    """공통 요청 헬퍼. resultCode 체크 포함. NODATA(03)는 빈 리스트.

    타임아웃 10초, 실패 시 1회 재시도.
    """
    # serviceKey 재인코딩 금지 — 발급키를 URL에 직접 부착하고
    # 나머지 파라미터만 urlencode 한다.
    query = urlencode(params)
    url = f"{base_url}?serviceKey={settings.KMA_API_KEY}&{query}"

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
                logger.warning("KMA 요청 실패 (attempt %d): %s", attempt + 1, exc)
    if data is None:
        raise KMAApiError(f"KMA request failed after retry: {last_exc}")

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


async def get_past_observation(start_dt: str, end_dt: str, region: str = DEFAULT_REGION) -> list[dict]:
    """과거관측(getAsosDalyInfoList). 일별 관측값 리스트.

    각 항목: {'tm': 'YYYY-MM-DD', 'avgTa': float, 'maxTa': float, 'minTa': float, 'sumRn': float}
    """
    stn_id = KMA_STATION.get(region, KMA_STATION[DEFAULT_REGION])
    items = await _request_items(settings.KMA_ASOS_DALY_URL, {
        "pageNo": 1,
        "numOfRows": 31,
        "dataType": "JSON",
        "dataCd": "ASOS",
        "dateCd": "DAY",
        "startDt": start_dt,
        "endDt": end_dt,
        "stnIds": stn_id,
    })
    return [
        {
            "tm": item.get("tm"),
            "avgTa": parse_kma_value(item.get("avgTa")),
            "maxTa": parse_kma_value(item.get("maxTa")),
            "minTa": parse_kma_value(item.get("minTa")),
            "sumRn": parse_kma_value(item.get("sumRn")),
        }
        for item in items
    ]

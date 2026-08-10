"""기상청(KMA) API허브 동기 클라이언트.

출처는 **기상청 API허브**(`apihub.kma.go.kr/api/typ02/openApi/...`)다 — R13에서
공공데이터포털에서 옮겼다. 갈린 것은 인증 파라미터 이름(`serviceKey`→`authKey`)과
ASOS 일자료 서비스·필드명뿐이고, 응답 봉투와 파싱 규칙은 그대로다.

docs/specs/06_kma_api_parsing_spec.md 파싱 규칙 준수:
- response.header.resultCode == "00" 성공, "03"(NODATA)은 빈 결과 처리, 그 외 KMAApiError
- authKey는 이미 인코딩된 키일 수 있으므로 재인코딩 금지 (URL 문자열에 직접 부착)
- PCP/PTY 값이 "강수없음" 등 문자열로 올 수 있음 → 숫자 변환 전 체크
- 응답 item이 flat하게 섞여 있음 → (fcstDate, fcstTime) 기준 grouping 후 category별 재구성
- 타임아웃 10초, 실패 시 1회 재시도
"""
import logging
import re
from datetime import datetime
from urllib.parse import urlencode

import httpx

from app import config

logger = logging.getLogger(__name__)

# ── 인증키(authKey/serviceKey) 로그 유출 차단 (CO-Q-3 / CO-N-3d) ────────────
# backend/app/services/weather_api.py와 **같은 규칙**이다(교차 빌드 컨텍스트라
# import로 묶을 수 없어 값을 양쪽에 둔다 — 드리프트는 backend
# tests/test_kma_key_masking.py가 두 파일을 함께 읽어 감시한다).
# ① httpx 자체 로거가 모든 요청의 전체 URL을 INFO로 남긴다 → 레벨 상향
# ② httpx 예외 문자열에 요청 URL이 들어간다 → mask_service_key
logging.getLogger("httpx").setLevel(logging.WARNING)

_SERVICE_KEY_RE = re.compile(r"((?:serviceKey|authKey)=)[^&\s'\"]+", re.IGNORECASE)
SERVICE_KEY_MASK = "***"


def mask_service_key(text: object) -> str:
    """문자열에서 `serviceKey=...` / `authKey=...` 값을 마스킹한다 (순수 함수).

    두 이름을 모두 잡는다 — R13 API허브 전환(`serviceKey`→`authKey`) 후에도 방어가
    유지돼야 한다. backend weather_api.py와 바이트 동일(계약 테스트가 대조).
    """
    return _SERVICE_KEY_RE.sub(rf"\1{SERVICE_KEY_MASK}", str(text))

# ── 주요 지역 격자 좌표 (단기예보 nx, ny) ──
KMA_GRID = {
    "서울": (60, 127), "부산": (98, 76), "대구": (89, 90),
    "인천": (55, 124), "광주": (58, 74), "대전": (67, 100),
    "울산": (102, 84), "강릉": (92, 131), "제주": (52, 38),
    "수원": (60, 121), "청주": (69, 106), "전주": (63, 89),
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


class KMAApiError(Exception):
    """resultCode != '00' (NODATA 제외) 또는 응답 구조 이상."""


def parse_kma_value(raw):
    """KMA 값 파싱: '강수없음' 등 문자열이면 0.0, 숫자면 float 변환."""
    if raw in NO_RAIN_STRINGS:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return raw  # 숫자가 아닌 유의미한 문자열은 원본 유지


def _request_items(base_url: str, params: dict) -> list[dict]:
    """공통 요청 헬퍼. resultCode 체크 포함. NODATA(03)는 빈 리스트."""
    # authKey 재인코딩 금지 — 발급키를 URL에 직접 부착하고
    # 나머지 파라미터만 urlencode 한다.
    query = urlencode(params)
    url = f"{base_url}?authKey={config.KMA_API_KEY}&{query}"

    data = None
    last_exc = None
    for attempt in range(2):  # 최초 1회 + 재시도 1회
        try:
            resp = httpx.get(url, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            logger.warning(
                "KMA 요청 실패 (attempt %d): %s", attempt + 1, mask_service_key(exc)
            )
    if data is None:
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


def get_short_forecast(region: str, base_date: str, base_time: str) -> dict:
    """단기예보(getVilageFcst).

    반환: {'region': str, 'forecasts': [{'datetime': 'YYYYMMDDHHMM', 'TMP': 28.0, ...}]}
    """
    if region not in KMA_GRID:
        raise ValueError(f"unknown region: {region}")
    nx, ny = KMA_GRID[region]
    items = _request_items(config.KMA_VILAGE_FCST_URL, {
        "pageNo": 1,
        "numOfRows": 1000,
        "dataType": "JSON",
        "base_date": base_date,
        "base_time": base_time,
        "nx": nx,
        "ny": ny,
    })

    # (fcstDate, fcstTime) 기준으로 grouping 후 category별 재구성
    grouped: dict[tuple, dict] = {}
    for item in items:
        key = (item.get("fcstDate"), item.get("fcstTime"))
        slot = grouped.setdefault(key, {})
        category = item.get("category")
        if category in KMA_CATEGORY:
            slot[category] = parse_kma_value(item.get("fcstValue"))

    forecasts = [
        {"datetime": f"{d}{t}", **values}
        for (d, t), values in sorted(grouped.items())
    ]
    return {"region": region, "forecasts": forecasts}


# ── ASOS 일자료 어댑터 (API허브 SfcMtlyInfoService/getDailyWthrData) ─────────
# backend/app/services/weather_api.py의 같은 이름 함수들과 **동작이 같아야 한다**
# (교차 빌드 컨텍스트 — import로 묶을 수 없다). 드리프트는 backend
# tests/test_kma_asos_adapter.py가 두 구현을 함께 실행해 감시한다.
# 배경·폴백 경로(typ01 kma_sfcdd3.php)는 backend 쪽 주석이 소유한다.

# 우리 출력 필드 → API허브 응답 필드 (키 순서 = 종전 출력 순서)
ASOS_FIELD_MAP = {"avgTa": "ta", "maxTa": "ta_max", "minTa": "ta_min", "sumRn": "rn_day"}


def asos_months(start_dt: str, end_dt: str) -> list[tuple[str, str]]:
    """'YYYYMMDD' 기간을 (year, month) 목록으로 편다 — 월 경계를 걸치면 2개 이상."""
    start = datetime.strptime(start_dt, "%Y%m%d").date()
    end = datetime.strptime(end_dt, "%Y%m%d").date()
    if end < start:
        return []
    out: list[tuple[str, str]] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        out.append((f"{year:04d}", f"{month:02d}"))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def normalize_asos_tm(raw: object) -> str | None:
    """관측일자를 'YYYY-MM-DD'로 통일. 'YYYYMMDD'·'YYYY-MM-DD' 둘 다 받는다."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) < 8:
        return None
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"


def asos_row(item: dict) -> dict:
    """API허브 일자료 1행 → 종전 출력 형태(tm·avgTa·maxTa·minTa·sumRn)."""
    row = {"tm": normalize_asos_tm(item.get("tm"))}
    for ours, theirs in ASOS_FIELD_MAP.items():
        row[ours] = parse_kma_value(item.get(theirs))
    return row


def asos_in_range(rows: list[dict], start_dt: str, end_dt: str) -> list[dict]:
    """월 단위로 받아온 행에서 [start_dt, end_dt]만 남기고 날짜순 정렬."""
    lo, hi = re.sub(r"\D", "", start_dt), re.sub(r"\D", "", end_dt)
    kept = [
        r for r in rows
        if r.get("tm") and lo <= re.sub(r"\D", "", r["tm"]) <= hi
    ]
    return sorted(kept, key=lambda r: r["tm"])


def _fetch_daily_obs(start_dt: str, end_dt: str, stn_id: str) -> list[dict]:
    """일자료 원본 행을 긁어온다 — **출처 교체 지점**(backend 주석 참조)."""
    items: list[dict] = []
    for year, month in asos_months(start_dt, end_dt):
        items += _request_items(config.KMA_ASOS_DALY_URL, {
            "pageNo": 1,
            "numOfRows": 31,
            "dataType": "JSON",
            "year": year,
            "month": month,
            "station": stn_id,
        })
    return items


def get_past_observation(start_dt: str, end_dt: str, stn_id: str) -> list[dict]:
    """과거관측 일자료(API허브 getDailyWthrData). 일별 관측값 리스트.

    각 항목: {'tm': 'YYYY-MM-DD', 'avgTa': float, 'maxTa': float, 'sumRn': float, ...}
    월 단위 API를 기간 조회처럼 보이게 감싼다 — 리그 정산(league.py)은 무변경.
    """
    items = _fetch_daily_obs(start_dt, end_dt, stn_id)
    return asos_in_range([asos_row(item) for item in items], start_dt, end_dt)

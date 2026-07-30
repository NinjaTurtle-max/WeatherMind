"""예보 대결 — AI 캐스터 예측(결정적) + 정산 판정 — 스프린트 R4-01 §3.4 (R4-S4).

AI 캐스터 예측은 LLM 없이 결정적으로 생성한다: user_id+date 해시를 시드로 한
난수로 KMA 내일 예보(TMX·POP)에 온도 ±2.0·강수 ±15 범위의 노이즈를 더한다.
같은 입력(유저·날짜·기준 예보)은 항상 같은 예측을 낸다(재현 가능 — 테스트로 고정).

정산(§3.4): 다음날 실측으로 user/ai 예측의 accuracy_score(league_service 재사용)를
비교해 승패를 가르고, 승리 시 +15 XP. 정산은 celery 일일 태스크가 수행하며 이
모듈의 순수 함수(ai_caster_prediction·duel_result)를 celery도 동일하게 쓴다.

구조적 결정: 예측 생성·승패 판정·내일 예보 추출은 DB 의존이 없는 순수 함수로
분리해 pytest가 DB 없이 결정성/판정을 검증한다 (TEAM_PROCESS §1.2).
"""
import hashlib
import random
from datetime import date

from app.services.league_service import accuracy_score

# 승리 보상 (§3.4) — **단일 소유자**(R8-01 §3.6). celery/app/tasks/league.py의
# 복제본은 교차 빌드 컨텍스트라 import 불가 — 값 변경은 여기서 하고, 드리프트는
# tests/test_xp_contract.py 계약 테스트가 CI 실패로 잡는다.
DUEL_WIN_XP = 15

# AI 캐스터 노이즈 범위 (§3.4)
TEMP_NOISE = 2.0     # 온도 ±2.0℃
RAIN_NOISE = 15      # 강수확률 ±15%p

# 브리핑 시간별 시계열에 담는 KMA 카테고리 (R9-01 §3.1 ② — 응답 키는 소문자)
BRIEFING_HOURLY_CATEGORIES = ("TMP", "POP", "PCP", "REH", "WSD", "SKY", "PTY")
# 브리핑 최근 실측 추이 최대 일수 (R9-01 §3.1 ② — recent_days ≤ 7)
BRIEFING_RECENT_DAYS_MAX = 7


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def _seed(user_id: str, duel_date: date) -> int:
    """user_id + duel_date로부터 결정적 정수 시드 (해시 — 파이썬 실행 간 안정)."""
    digest = hashlib.sha256(f"{user_id}:{duel_date.isoformat()}".encode()).hexdigest()
    return int(digest, 16)


def ai_caster_prediction(
    base_temp_max: float, base_rain_prob: float, user_id: str, duel_date: date
) -> dict:
    """KMA 기준 예보에 결정적 노이즈를 더한 AI 캐스터 예측 (§3.4, 순수·재현 가능).

    - 온도: base_temp_max ± TEMP_NOISE (소수 1자리)
    - 강수: base_rain_prob ± RAIN_NOISE, 0~100 클램프(정수)
    같은 (base·user_id·duel_date)는 항상 같은 결과를 낸다. random.Random(seed)의
    Mersenne Twister는 시드 고정 시 파이썬 버전 간 재현 가능하다.
    """
    rng = random.Random(_seed(user_id, duel_date))
    temp = round(base_temp_max + rng.uniform(-TEMP_NOISE, TEMP_NOISE), 1)
    rain = round(base_rain_prob + rng.uniform(-RAIN_NOISE, RAIN_NOISE))
    rain = max(0, min(100, rain))
    return {"temp_max": temp, "rain_prob": rain}


def duel_result(user_score: float, ai_score: float) -> str:
    """정확도 점수 비교로 승패 판정 (§3.4). 높은 쪽 승, 같으면 draw."""
    if user_score > ai_score:
        return "win"
    if user_score < ai_score:
        return "lose"
    return "draw"


def settle_scores(user_pred: dict, ai_pred: dict, actual: dict) -> tuple[float, float, str]:
    """실측으로 user/ai 점수·승패를 산정한다 (§3.4 — accuracy_score 재사용)."""
    user_score = accuracy_score(user_pred, actual)
    ai_score = accuracy_score(ai_pred, actual)
    return user_score, ai_score, duel_result(user_score, ai_score)


def briefing_hourly(weather: dict, dates: tuple[date, ...]) -> list[dict]:
    """단기예보(get_short_forecast 형식)에서 브리핑 대상 날짜들의 시간별 시계열 추출.

    R9-01 §3.1 ② — 키는 KMA 카테고리 소문자(tmp·pop·pcp·reh·wsd·sky·pty),
    숫자가 아닌 값(결측·비숫자 문자열)은 None. 제출일+대상일을 함께 담아
    pop_trend(추세)·temp_drop(전일 대비) 판단 재료가 되도록 한다.
    빈/실패 날씨({})는 빈 리스트 — 순수 함수(FakeDB·네트워크 불필요).
    """
    allowed = {d.strftime("%Y%m%d") for d in dates}
    hours = []
    for f in weather.get("forecasts") or []:
        dt = str(f.get("datetime", ""))
        if dt[:8] not in allowed:
            continue
        row: dict = {"datetime": dt}
        for cat in BRIEFING_HOURLY_CATEGORIES:
            value = f.get(cat)
            row[cat.lower()] = float(value) if isinstance(value, (int, float)) else None
        hours.append(row)
    return hours


def split_daily_observations(rows: list[dict], today: date) -> tuple[dict | None, list[dict]]:
    """ASOS 일자료(get_past_observation 형식)를 (today_observed, recent_days)로 분리.

    R9-01 §3.1 ② — today_observed는 오늘(tm==today) 행의 {max_ta, min_ta, sum_rn}
    (ASOS 일자료는 보통 D+1 공표라 대개 None), recent_days는 오늘 이전 행들을
    날짜 오름차순으로 최대 BRIEFING_RECENT_DAYS_MAX(=7)건. 숫자가 아닌 값은 None.
    """

    def _num(value):
        return float(value) if isinstance(value, (int, float)) else None

    today_iso = today.isoformat()
    today_observed = None
    recent: list[dict] = []
    for row in rows or []:
        tm = str(row.get("tm") or "")
        if tm == today_iso:
            today_observed = {
                "max_ta": _num(row.get("maxTa")),
                "min_ta": _num(row.get("minTa")),
                "sum_rn": _num(row.get("sumRn")),
            }
        elif tm and tm < today_iso:
            recent.append(
                {"date": tm, "max_ta": _num(row.get("maxTa")), "sum_rn": _num(row.get("sumRn"))}
            )
    recent.sort(key=lambda r: r["date"])
    return today_observed, recent[-BRIEFING_RECENT_DAYS_MAX:]


def extract_forecast_for_date(weather: dict, target: date) -> dict | None:
    """단기예보(get_short_forecast 형식)에서 특정 날짜의 최고기온·강수확률을 뽑는다.

    - temp_max: 해당 날짜 TMX(일 1회) 우선, 없으면 TMP 최대
    - rain_prob: 해당 날짜 POP 최대
    해당 날짜 데이터가 없으면 None(호출측이 대체 판단).
    """
    target_str = target.strftime("%Y%m%d")
    forecasts = [
        f
        for f in (weather.get("forecasts") or [])
        if str(f.get("datetime", "")).startswith(target_str)
    ]
    if not forecasts:
        return None

    def _nums(category: str) -> list[float]:
        return [
            float(f[category])
            for f in forecasts
            if isinstance(f.get(category), (int, float))
        ]

    tmx, tmp = _nums("TMX"), _nums("TMP")
    if tmx:
        temp_max = tmx[0]
    elif tmp:
        temp_max = max(tmp)
    else:
        return None

    pop = _nums("POP")
    rain_prob = max(pop) if pop else 0.0
    return {"temp_max": round(temp_max, 1), "rain_prob": round(rain_prob)}

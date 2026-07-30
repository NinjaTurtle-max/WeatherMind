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

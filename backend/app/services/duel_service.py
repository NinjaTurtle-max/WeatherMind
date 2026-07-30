"""예보 대결 — AI 캐스터 예측(결정적) + 정산 판정 — 스프린트 R4-01 §3.4 (R4-S4).

AI 캐스터 예측은 LLM 없이 결정적으로 생성한다: user_id+date 해시를 시드로 한
난수로 KMA 내일 예보(TMX·POP)에 온도 ±2.0·강수 ±15 범위의 노이즈를 더한다.
같은 입력(유저·날짜·기준 예보)은 항상 같은 예측을 낸다(재현 가능 — 테스트로 고정).

적응형 캐스터(R9-01 §3.2): 유저 리그 티어가 높을수록 노이즈 배율(noise_scale)이
줄어 캐스터가 정확해진다(5계단, CASTER_NOISE_SCALES). 배율은 진폭에만 곱하고
시드는 불변 — 결정성·재현성은 그대로다.

정산(§3.4): 다음날 실측으로 user/ai 예측의 accuracy_score(league_service 재사용)를
비교해 승패를 가르고, 승리 시 +15 XP. 정산은 celery 일일 태스크가 수행하며 이
모듈의 순수 함수(ai_caster_prediction·duel_result)를 celery도 동일하게 쓴다.

구조적 결정: 예측 생성·승패 판정·내일 예보 추출은 DB 의존이 없는 순수 함수로
분리해 pytest가 DB 없이 결정성/판정을 검증한다 (TEAM_PROCESS §1.2).
"""
import hashlib
import random
from datetime import date

from app.services.league_service import DEFAULT_TIER, accuracy_score, tier_from_elo

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

# 근거 선택 화이트리스트 (R9-01 §3.1 ③ — 계약 코드 5종, 미지 코드는 라우터가 422)
EVIDENCE_CODES = (
    "pop_trend",      # 강수확률 추세
    "humidity_high",  # 높은 습도
    "temp_drop",      # 전일 대비 기온 하강
    "sky_overcast",   # 흐린 하늘
    "recent_rain",    # 최근 강수 이력
)

# 강수 신호 근거의 결과 해설 (미적중, 적중) — review_evidence가 인덱싱
_RAIN_SIGNAL_NOTES = {
    "pop_trend": (
        "강수확률 추세와 달리 실제로는 비가 오지 않았어요.",
        "강수확률 추세대로 실제 비가 왔어요.",
    ),
    "humidity_high": (
        "습도가 높았지만 실제 비로 이어지지는 않았어요.",
        "높은 습도 신호가 실제 강수로 이어졌어요.",
    ),
    "sky_overcast": (
        "하늘이 흐렸어도 실제 비는 오지 않았어요.",
        "흐린 하늘 신호가 실제 강수로 이어졌어요.",
    ),
    "recent_rain": (
        "최근 강수 흐름이 이번에는 이어지지 않았어요.",
        "최근 강수 이력대로 실제 비가 왔어요.",
    ),
}

# ── 적응형 캐스터 (R9-01 §3.2) — 티어별 노이즈 배율 (계약 수치) ──
# 유저 티어가 높을수록 캐스터 노이즈 진폭이 줄어 더 정확해진다(5계단).
# 티어 경계(ELO 임계)는 league_service.TIER_THRESHOLDS가 단일 소유 —
# 여기서는 tier_from_elo 재사용으로 경계를 중복 정의하지 않는다.
CASTER_NOISE_SCALES: dict[str, float] = {
    "stratus": 1.00,
    "cumulus": 0.85,
    "nimbostratus": 0.70,
    "cumulonimbus": 0.55,
    "typhoon_eye": 0.40,
}


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def _seed(user_id: str, duel_date: date) -> int:
    """user_id + duel_date로부터 결정적 정수 시드 (해시 — 파이썬 실행 간 안정)."""
    digest = hashlib.sha256(f"{user_id}:{duel_date.isoformat()}".encode()).hexdigest()
    return int(digest, 16)


def caster_grade(elo: int | None) -> str:
    """유저 ELO → 캐스터 등급(티어명) (R9-01 §3.2, 순수 함수).

    None(리그 정산 이력 없는 첫 참가)은 기본 티어(stratus). 경계 판정은
    league_service.tier_from_elo 재사용 — TIER_THRESHOLDS 중복 정의 금지.
    """
    return DEFAULT_TIER if elo is None else tier_from_elo(elo)


def caster_noise_scale(elo: int | None) -> float:
    """유저 ELO → 캐스터 노이즈 배율 (R9-01 §3.2, 순수 함수).

    티어 5계단 매핑(계약 수치): stratus 1.00 / cumulus 0.85 / nimbostratus 0.70 /
    cumulonimbus 0.55 / typhoon_eye 0.40. elo None(첫 참가)=1.00.
    """
    return CASTER_NOISE_SCALES[caster_grade(elo)]


def ai_caster_prediction(
    base_temp_max: float,
    base_rain_prob: float,
    user_id: str,
    duel_date: date,
    *,
    noise_scale: float = 1.0,
) -> dict:
    """KMA 기준 예보에 결정적 노이즈를 더한 AI 캐스터 예측 (§3.4, 순수·재현 가능).

    - 온도: base_temp_max ± TEMP_NOISE×noise_scale (소수 1자리)
    - 강수: base_rain_prob ± RAIN_NOISE×noise_scale, 0~100 클램프(정수)
    같은 (base·user_id·duel_date)는 항상 같은 결과를 낸다. random.Random(seed)의
    Mersenne Twister는 시드 고정 시 파이썬 버전 간 재현 가능하다.

    noise_scale(R9-01 §3.2 적응형 캐스터): **시드는 (user,date) 불변** — 배율은
    난수 추출 후 진폭에만 곱한다(결정성 보존). 기본값 1.0은 기존 동작과
    비트 단위 동일(하위 호환 — 기존 결정성 테스트가 그대로 고정).
    """
    rng = random.Random(_seed(user_id, duel_date))
    temp = round(base_temp_max + rng.uniform(-TEMP_NOISE, TEMP_NOISE) * noise_scale, 1)
    rain = round(base_rain_prob + rng.uniform(-RAIN_NOISE, RAIN_NOISE) * noise_scale)
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


def review_evidence(user_pred: dict | None, actual: dict | None) -> list[dict] | None:
    """근거 적중 판정 (R9-01 §3.1 ④) — 정산 후 조회 시 계산하는 결정적 순수 함수.

    실측 대조 규칙 — actual은 celery 일일 정산이 기록한
    ``{"temp_max": 실측 최고기온(℃), "rain_prob": 100.0(강수)|0.0(무강수 이진화)}``:

    - **강수 신호 4종**(pop_trend·humidity_high·sky_overcast·recent_rain)은 모두
      "비가 올 것"이라는 신호를 근거로 삼은 것 — **실측 강수 발생(rain_prob > 0)이면
      hit=True**. 예: recent_rain 선택 & 실측 강수>0 → 적중 (§3.1 예시 그대로).
    - **temp_drop**(전일 대비 하강)은 제출 시점에 저장한 기준 기온
      ``user_pred["evidence_ctx"]["today_temp_max"]``(제출일 KMA 예보 최고기온)
      대비 **실측 최고기온이 엄격히 낮으면 hit=True**. 기준 기온이 없으면
      (제출 시 KMA 실패) hit=False + note에 사유를 남긴다.
    - 화이트리스트 밖 코드가 저장돼 있으면(방어) hit=False + 일반 note.

    반환: 선택 순서 그대로 ``[{code, hit, note}]``.
    evidence 미선택 또는 미정산(actual 없음)이면 None.
    같은 입력은 항상 같은 출력(외부 상태·난수·시계 미사용).
    """
    evidence = (user_pred or {}).get("evidence")
    if not evidence or not isinstance(actual, dict):
        return None

    rain_prob = actual.get("rain_prob")
    rained = isinstance(rain_prob, (int, float)) and rain_prob > 0
    actual_temp = actual.get("temp_max")
    ctx = (user_pred or {}).get("evidence_ctx") or {}
    ref_temp = ctx.get("today_temp_max")

    reviews = []
    for code in evidence:
        if code in _RAIN_SIGNAL_NOTES:
            hit = rained
            note = _RAIN_SIGNAL_NOTES[code][int(hit)]
        elif code == "temp_drop":
            if isinstance(ref_temp, (int, float)) and isinstance(actual_temp, (int, float)):
                hit = actual_temp < ref_temp
                direction = "실제로 내려갔어요." if hit else "내려가지 않았어요."
                note = f"제출일 예보 최고기온 {ref_temp}℃ 대비 실측 {actual_temp}℃ — {direction}"
            else:
                hit = False
                note = "제출 시점의 기준 기온 자료가 없어 미적중으로 처리했어요."
        else:  # 화이트리스트 밖(저장 경로가 막지만 방어적으로 처리)
            hit = False
            note = "알 수 없는 근거 코드예요."
        reviews.append({"code": code, "hit": hit, "note": note})
    return reviews


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

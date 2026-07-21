"""(c) 매주 월요일 — 지난주 리그 정산 + (e) 매일 — 예보 대결 정산.

주간 리그 정산(settle_weekly_league): 지난주 league_results 미정산 행에 대해
1. KMA 과거관측으로 지난주 실측값 산출 2. accuracy_score 계산 3. ELO 갱신 →
elo_rating_after 기록 4. **티어 산정·기록(R4-01 §3.2)** + 직전 대비 상승 시
tier_promoted 배지(§3.3).

일일 예보 대결 정산(settle_daily_duel, R4-01 §3.4): 어제가 대상일이던 duels를
KMA 실측으로 채점(accuracy_score 재사용)해 승패·승리 XP를 확정한다. 소유권 규칙상
이번 스프린트에서 celery는 이 파일만 백엔드가 수정하므로 대결 정산도 여기 둔다
(celery_app.py beat_schedule 등록은 celery 소유자의 후속 1줄 추가 — 완료 보고에 명시).
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import text

from app import config
from app.db import get_engine
from app.kma_client import KMA_STATION, get_past_observation

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
ELO_INITIAL = 1200
ELO_K = 32

# ── 리그 티어 (R4-01 §3.2) — backend league_service.TIER_THRESHOLDS와 동일 정의 ──
# celery는 backend를 임포트하지 않으므로(별 서비스) 공식 계열의 기존 이원화 관례를 따라
# 여기 복제한다. 값이 바뀌면 양측을 함께 고쳐야 한다(계약 §3.2 고정).
TIER_THRESHOLDS = (
    ("stratus", 0),
    ("cumulus", 1100),
    ("nimbostratus", 1250),
    ("cumulonimbus", 1400),
    ("typhoon_eye", 1550),
)
TIER_ORDER = tuple(code for code, _ in TIER_THRESHOLDS)
DEFAULT_TIER = TIER_ORDER[0]


# ── 07번 문서 공식 (원문 그대로) ──────────────────────────────

def accuracy_score(predicted: dict, actual: dict) -> float:
    """각 항목 오차를 0~100 점수로 환산 후 평균."""
    temp_max_err = abs(predicted["temp_max"] - actual["temp_max"])
    temp_score = max(0, 100 - temp_max_err * 10)      # 1도당 -10점
    rain_err = abs(predicted["rain_prob"] - actual["rain_prob"])
    rain_score = max(0, 100 - rain_err)                # 1%당 -1점
    return round((temp_score + rain_score) / 2, 2)


def update_elo(rating: int, score: float, expected: float, k: int = ELO_K) -> int:
    """score: 이번 주 정확도(0~1 정규화), expected: 리그 평균 대비 기대값."""
    return round(rating + k * (score - expected))


def tier_from_elo(elo: int) -> str:
    """정산 ELO → 구름 티어 코드 (§3.2 — 하한 포함 ≥)."""
    tier = DEFAULT_TIER
    for code, floor in TIER_THRESHOLDS:
        if elo >= floor:
            tier = code
    return tier


def is_tier_promoted(previous_tier, new_tier: str) -> bool:
    """직전 대비 티어 상승 여부 (§3.2 tier_promoted 조건)."""
    prev = previous_tier if previous_tier in TIER_ORDER else DEFAULT_TIER
    return TIER_ORDER.index(new_tier) > TIER_ORDER.index(prev)

# ─────────────────────────────────────────────────────────────


def _last_week_start(today: date) -> date:
    """지난주 월요일 (태스크는 월요일에 실행되지만 임의 실행에도 안전하게)."""
    this_monday = today - timedelta(days=today.weekday())
    return this_monday - timedelta(days=7)


def _actual_value_for_week(week_start: date) -> dict | None:
    """지난주(월~일) KMA 과거관측으로 실측값 산출.

    temp_max: 주간 최고기온(maxTa 최대값)
    rain_prob: 강수일 비율(%) — sumRn > 0 인 날 / 관측일
    """
    week_end = week_start + timedelta(days=6)
    obs = get_past_observation(
        week_start.strftime("%Y%m%d"),
        week_end.strftime("%Y%m%d"),
        KMA_STATION[config.DEFAULT_REGION],
    )
    if not obs:
        return None
    max_temps = [o["maxTa"] for o in obs if isinstance(o["maxTa"], (int, float))]
    if not max_temps:
        return None
    rain_days = sum(
        1 for o in obs if isinstance(o["sumRn"], (int, float)) and o["sumRn"] > 0
    )
    return {
        "temp_max": max(max_temps),
        "rain_prob": round(100.0 * rain_days / len(obs), 1),
    }


def _current_rating(conn, user_id, week_start: date) -> int:
    """직전 주까지의 마지막 elo_rating_after. 없으면 초기 1200."""
    row = conn.execute(
        text("""
            SELECT elo_rating_after FROM league_results
            WHERE user_id = :uid AND week_start < :ws AND elo_rating_after IS NOT NULL
            ORDER BY week_start DESC LIMIT 1
        """),
        {"uid": user_id, "ws": week_start},
    ).fetchone()
    return row[0] if row else ELO_INITIAL


def _previous_tier(conn, user_id, week_start: date):
    """직전 주까지의 마지막 tier. 없으면 None(첫 정산)."""
    row = conn.execute(
        text("""
            SELECT tier FROM league_results
            WHERE user_id = :uid AND week_start < :ws AND tier IS NOT NULL
            ORDER BY week_start DESC LIMIT 1
        """),
        {"uid": user_id, "ws": week_start},
    ).fetchone()
    return row[0] if row else None


def _award_tier_promoted(conn, user_id) -> None:
    """tier_promoted 배지 지급 (§3.3 중복 방지 — ON CONFLICT DO NOTHING).

    badges 시드가 없으면(로더 미실행) SELECT가 비어 no-op이다.
    """
    conn.execute(
        text("""
            INSERT INTO user_badges (user_id, badge_id)
            SELECT :uid, id FROM badges WHERE code = 'tier_promoted'
            ON CONFLICT ON CONSTRAINT uq_user_badges_user_badge DO NOTHING
        """),
        {"uid": user_id},
    )


@shared_task(name="app.tasks.league.settle_weekly_league", bind=True, max_retries=2)
def settle_weekly_league(self):
    today = datetime.now(KST).date()
    week_start = _last_week_start(today)

    actual = _actual_value_for_week(week_start)
    if actual is None:
        logger.error("[league] %s 주간 실측값 조회 실패 — 1시간 후 재시도", week_start)
        raise self.retry(countdown=3600)

    engine = get_engine()
    with engine.begin() as conn:
        rows = conn.execute(
            text("""
                SELECT id, user_id, predicted_value FROM league_results
                WHERE week_start = :ws AND actual_value IS NULL
            """),
            {"ws": week_start},
        ).fetchall()

        if not rows:
            logger.info("[league] %s 정산 대상 없음", week_start)
            return {"week_start": str(week_start), "settled": 0}

        # 1) 참가자별 accuracy_score 계산
        scored = []
        for row_id, user_id, predicted in rows:
            if isinstance(predicted, str):
                predicted = json.loads(predicted)
            try:
                score = accuracy_score(predicted, actual)
            except (KeyError, TypeError) as exc:
                logger.warning("[league] row %s predicted_value 형식 오류: %s", row_id, exc)
                score = 0.0
            scored.append((row_id, user_id, score))

        # 2) 리그 평균(0~1 정규화)을 기대값으로 ELO 갱신 + 티어 산정·승급 배지
        expected = sum(s for _, _, s in scored) / len(scored) / 100.0
        promoted = 0
        for row_id, user_id, score in scored:
            rating = _current_rating(conn, user_id, week_start)
            new_rating = update_elo(rating, score / 100.0, expected)
            new_tier = tier_from_elo(new_rating)
            prev_tier = _previous_tier(conn, user_id, week_start)
            conn.execute(
                text("""
                    UPDATE league_results
                    SET actual_value = CAST(:actual AS jsonb),
                        accuracy_score = :score,
                        elo_rating_after = :elo,
                        tier = :tier
                    WHERE id = :id
                """),
                {
                    "actual": json.dumps(actual, ensure_ascii=False),
                    "score": score,
                    "elo": new_rating,
                    "tier": new_tier,
                    "id": row_id,
                },
            )
            # 직전 대비 티어 상승 시 tier_promoted 배지 (§3.3)
            if is_tier_promoted(prev_tier, new_tier):
                _award_tier_promoted(conn, user_id)
                promoted += 1

    logger.info(
        "[league] %s 정산 완료: %d명 (승급 %d, actual=%s)",
        week_start, len(scored), promoted, actual,
    )
    return {
        "week_start": str(week_start),
        "settled": len(scored),
        "promoted": promoted,
        "actual_value": actual,
    }


# ═══════════════════════════════════════════════════════════════
# (e) 예보 대결 일일 정산 (R4-01 §3.4)
# ═══════════════════════════════════════════════════════════════

DUEL_WIN_XP = 15


def duel_result(user_score: float, ai_score: float) -> str:
    """정확도 비교 승패 (§3.4). 높은 쪽 승, 같으면 draw."""
    if user_score > ai_score:
        return "win"
    if user_score < ai_score:
        return "lose"
    return "draw"


def _duel_actual_for_day(target: date) -> dict | None:
    """대상일(어제) KMA 과거관측으로 실측값 산출. 관측 없으면 None.

    temp_max: 어제 최고기온(maxTa), rain_prob: 강수 이진화(sumRn>0 → 100, 아니면 0)
    — 단일 일자이므로 강수 '확률'을 관측 강수 유무로 환산한다.
    """
    day_str = target.strftime("%Y%m%d")
    obs = get_past_observation(day_str, day_str, KMA_STATION[config.DEFAULT_REGION])
    if not obs:
        return None
    row = obs[0]
    max_ta = row.get("maxTa")
    if not isinstance(max_ta, (int, float)):
        return None
    sum_rn = row.get("sumRn")
    rained = isinstance(sum_rn, (int, float)) and sum_rn > 0
    return {"temp_max": max_ta, "rain_prob": 100.0 if rained else 0.0}


@shared_task(name="app.tasks.league.settle_daily_duel", bind=True, max_retries=2)
def settle_daily_duel(self):
    today = datetime.now(KST).date()
    target = today - timedelta(days=1)  # 어제가 대상일이던 대결

    actual = _duel_actual_for_day(target)
    if actual is None:
        logger.error("[duel] %s 실측값 조회 실패 — 1시간 후 재시도", target)
        raise self.retry(countdown=3600)

    engine = get_engine()
    settled = wins = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text("""
                SELECT id, user_id, user_pred, ai_pred FROM duels
                WHERE duel_date = :d AND actual IS NULL
            """),
            {"d": target},
        ).fetchall()

        if not rows:
            logger.info("[duel] %s 정산 대상 없음", target)
            return {"duel_date": str(target), "settled": 0}

        for row_id, user_id, user_pred, ai_pred in rows:
            if isinstance(user_pred, str):
                user_pred = json.loads(user_pred)
            if isinstance(ai_pred, str):
                ai_pred = json.loads(ai_pred)
            try:
                user_score = accuracy_score(user_pred, actual)
                ai_score = accuracy_score(ai_pred, actual)
            except (KeyError, TypeError) as exc:
                logger.warning("[duel] row %s pred 형식 오류: %s", row_id, exc)
                continue
            result = duel_result(user_score, ai_score)
            conn.execute(
                text("""
                    UPDATE duels
                    SET actual = CAST(:actual AS jsonb),
                        user_score = :us, ai_score = :ais, result = :res
                    WHERE id = :id
                """),
                {
                    "actual": json.dumps(actual, ensure_ascii=False),
                    "us": user_score,
                    "ais": ai_score,
                    "res": result,
                    "id": row_id,
                },
            )
            if result == "win":
                conn.execute(
                    text("UPDATE users SET xp = xp + :bonus WHERE id = :uid"),
                    {"bonus": DUEL_WIN_XP, "uid": user_id},
                )
                wins += 1
            settled += 1

    logger.info("[duel] %s 정산 완료: %d건 (승리 %d, actual=%s)", target, settled, wins, actual)
    return {"duel_date": str(target), "settled": settled, "wins": wins, "actual_value": actual}

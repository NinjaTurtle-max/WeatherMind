"""(c) 매주 월요일 — 지난주 리그 정산.

지난주(week_start = 지난 월요일) league_results 중 미정산 행에 대해:
1. KMA 과거관측(getAsosDalyInfoList)으로 지난주 실측값(actual_value) 산출
2. docs/specs/07_gamification_spec.md 공식으로 accuracy_score 계산
3. 리그 평균 대비 ELO(K=32, 초기 1200) 갱신 → elo_rating_after 기록
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

        # 2) 리그 평균(0~1 정규화)을 기대값으로 ELO 갱신
        expected = sum(s for _, _, s in scored) / len(scored) / 100.0
        for row_id, user_id, score in scored:
            rating = _current_rating(conn, user_id, week_start)
            new_rating = update_elo(rating, score / 100.0, expected)
            conn.execute(
                text("""
                    UPDATE league_results
                    SET actual_value = CAST(:actual AS jsonb),
                        accuracy_score = :score,
                        elo_rating_after = :elo
                    WHERE id = :id
                """),
                {
                    "actual": json.dumps(actual, ensure_ascii=False),
                    "score": score,
                    "elo": new_rating,
                    "id": row_id,
                },
            )

    logger.info("[league] %s 정산 완료: %d명 (actual=%s)", week_start, len(scored), actual)
    return {"week_start": str(week_start), "settled": len(scored), "actual_value": actual}

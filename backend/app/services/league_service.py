"""기상 리그 — 정확도 점수 · ELO 레이팅 (docs/specs/07_gamification_spec.md 공식 그대로).

주간 정산(actual_value·accuracy_score·elo_rating_after 기록)은 Celery
(celery/app/tasks/league.py)가 수행하고, backend는 제출·조회와 공식만 소유한다.
"""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.league_result import LeagueResult

ELO_INITIAL = 1200
ELO_K = 32


def accuracy_score(predicted: dict, actual: dict) -> float:
    """각 항목 오차를 0~100 점수로 환산 후 평균 (07번 원문 그대로)."""
    temp_max_err = abs(predicted["temp_max"] - actual["temp_max"])
    temp_score = max(0, 100 - temp_max_err * 10)      # 1도당 -10점
    rain_err = abs(predicted["rain_prob"] - actual["rain_prob"])
    rain_score = max(0, 100 - rain_err)                # 1%당 -1점
    return round((temp_score + rain_score) / 2, 2)


def update_elo(rating: int, score: float, expected: float, k: int = ELO_K) -> int:
    """score: 이번 주 정확도(0~1 정규화), expected: 리그 평균 대비 기대값.

    초기 레이팅 1200. 리그 미참여 주는 변동 없음.
    """
    return round(rating + k * (score - expected))


def week_start_of(day: date) -> date:
    """해당 날짜가 속한 주의 월요일."""
    return day - timedelta(days=day.weekday())


async def get_current_rating(session: AsyncSession, user_id: uuid.UUID) -> int:
    """마지막으로 정산된 elo_rating_after. 없으면 초기 1200."""
    result = await session.execute(
        select(LeagueResult.elo_rating_after)
        .where(
            LeagueResult.user_id == user_id,
            LeagueResult.elo_rating_after.is_not(None),
        )
        .order_by(LeagueResult.week_start.desc())
        .limit(1)
    )
    rating = result.scalar_one_or_none()
    return rating if rating is not None else ELO_INITIAL

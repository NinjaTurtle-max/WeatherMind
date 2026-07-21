"""League API (/api/v1/league) — 02번 스펙.

| GET  | /current     | 이번 주 예측 대상 기간·지역 → {week_start, region, mid_forecast} |
| POST | /predict     | {temp_max, temp_min, rain_prob} → {"submitted": true} (주 1회) |
| GET  | /leaderboard | ?week=YYYY-MM-DD → LeagueRank[] |
| GET  | /me/results  | 내 리그 이력 → LeagueResult[] |

정산(actual_value·accuracy_score·ELO)은 Celery 주간 태스크가 수행한다.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, get_db_with_rls
from app.models.league_result import LeagueResult
from app.models.user import User
from app.schemas.league import (
    LeagueCurrent,
    LeagueRank,
    LeagueResultOut,
    PredictRequest,
    PredictResponse,
)
from app.services.league_service import week_start_of
from app.services.weather_api import DEFAULT_REGION, KST, get_mid_forecast

router = APIRouter(prefix="/api/v1/league", tags=["league"])


def _current_week_start() -> date:
    return week_start_of(datetime.now(KST).date())


@router.get("/current", response_model=LeagueCurrent)
async def get_current(user: User = Depends(get_current_user)) -> LeagueCurrent:
    mid_forecast = await get_mid_forecast(DEFAULT_REGION)
    return LeagueCurrent(
        week_start=_current_week_start(),
        region=DEFAULT_REGION,
        mid_forecast=mid_forecast,
    )


@router.post("/predict", response_model=PredictResponse)
async def submit_prediction(
    body: PredictRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> PredictResponse:
    week_start = _current_week_start()

    exists = (
        await db.execute(
            select(LeagueResult.id).where(
                LeagueResult.user_id == user.id,
                LeagueResult.week_start == week_start,
            )
        )
    ).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이번 주 예측을 이미 제출했습니다.", "code": "ALREADY_SUBMITTED"},
        )

    db.add(
        LeagueResult(
            user_id=user.id,
            week_start=week_start,
            predicted_value={
                "temp_max": body.temp_max,
                "temp_min": body.temp_min,
                "rain_prob": body.rain_prob,
            },
        )
    )
    await db.flush()
    return PredictResponse(submitted=True)


@router.get("/leaderboard", response_model=list[LeagueRank])
async def get_leaderboard(
    week: date | None = Query(default=None, description="주 시작일(월요일), 기본: 이번 주"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # 전체 유저 집계 — RLS 미적용 세션
) -> list[LeagueRank]:
    week_start = week or _current_week_start()

    rows = (
        await db.execute(
            select(
                User.nickname,
                LeagueResult.accuracy_score,
                LeagueResult.elo_rating_after,
                LeagueResult.tier,
            )
            .join(User, User.id == LeagueResult.user_id)
            .where(LeagueResult.week_start == week_start)
            .order_by(
                LeagueResult.accuracy_score.desc().nulls_last(),
                LeagueResult.elo_rating_after.desc().nulls_last(),
            )
        )
    ).all()

    return [
        LeagueRank(
            rank=i,
            nickname=nickname,
            accuracy_score=accuracy_score,
            elo_rating=elo_rating_after,
            tier=tier,
        )
        for i, (nickname, accuracy_score, elo_rating_after, tier) in enumerate(
            rows, start=1
        )
    ]


@router.get("/me/results", response_model=list[LeagueResultOut])
async def get_my_results(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[LeagueResultOut]:
    results = (
        (
            await db.execute(
                select(LeagueResult)
                .where(LeagueResult.user_id == user.id)
                .order_by(LeagueResult.week_start.desc())
            )
        )
        .scalars()
        .all()
    )
    return [LeagueResultOut.model_validate(r) for r in results]

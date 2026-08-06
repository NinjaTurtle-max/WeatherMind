"""League API (/api/v1/league) — 02번 스펙.

| GET  | /current     | 이번 주 예측 대상 기간·지역 → {week_start, region, mid_forecast} |
| POST | /predict     | {temp_max, temp_min, rain_prob} → {"submitted": true} (주 1회) |
| GET  | /leaderboard | ?week=YYYY-MM-DD → LeagueRank[] |
| GET  | /division    | ?week=&neighbors= → LeagueDivision (분반 + 이웃 격차) |
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
    LeagueDivision,
    LeagueRank,
    LeagueResultOut,
    PredictRequest,
    PredictResponse,
)
from app.services import league_service
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


async def _ranked_leaderboard(db: AsyncSession, week_start: date) -> list[dict]:
    """주간 전역 순위(1등이 index 0) — /leaderboard와 /division의 단일 정렬 공급원.

    정렬: 정확도 desc → ELO desc → user_id asc. 마지막 키는 동점자 순서를 고정해
    분반 소속이 요청마다 흔들리지 않게 하는 결정성 장치다(§2.8).
    """
    rows = (
        await db.execute(
            select(
                LeagueResult.user_id,
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
                LeagueResult.user_id.asc(),
            )
        )
    ).all()
    return [
        {
            "user_id": user_id,
            "nickname": nickname,
            "accuracy_score": accuracy_score,
            "elo_rating": elo_rating_after,
            "tier": tier,
        }
        for user_id, nickname, accuracy_score, elo_rating_after, tier in rows
    ]


@router.get("/leaderboard", response_model=list[LeagueRank])
async def get_leaderboard(
    week: date | None = Query(default=None, description="주 시작일(월요일), 기본: 이번 주"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # 전체 유저 집계 — RLS 미적용 세션
) -> list[LeagueRank]:
    ranked = await _ranked_leaderboard(db, week or _current_week_start())
    return [
        LeagueRank(rank=i, **{k: v for k, v in row.items() if k != "user_id"})
        for i, row in enumerate(ranked, start=1)
    ]


@router.get("/division", response_model=LeagueDivision)
async def get_division(
    week: date | None = Query(default=None, description="주 시작일(월요일), 기본: 이번 주"),
    neighbors: int = Query(
        default=league_service.NEIGHBOR_SPAN,
        ge=0,
        le=league_service.DIVISION_SIZE,
        description="내 위·아래로 보여줄 이웃 수(분반 경계에서 잘림)",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # 전체 유저 집계 — RLS 미적용 세션
) -> LeagueDivision:
    """분반 리더보드 (R13-01 §2.8) — 전역 순위를 30인 블록으로 잘라 내 블록만."""
    week_start = week or _current_week_start()
    ranked = await _ranked_leaderboard(db, week_start)
    view = league_service.build_division_view(ranked, user.id, span=neighbors)
    return LeagueDivision(
        week_start=week_start,
        **{**view, "entries": [
            {k: v for k, v in entry.items() if k != "user_id"}
            for entry in view["entries"]
        ]},
    )


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

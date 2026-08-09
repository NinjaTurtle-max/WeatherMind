"""League API (/api/v1/league) — 02번 스펙.

| GET  | /current     | 이번 주 예측 대상 기간·지역 → {week_start, region, mid_forecast} |
| POST | /predict     | {temp_max, temp_min, rain_prob} → {"submitted": true} (주 1회) |
| GET  | /leaderboard | ?week=YYYY-MM-DD → LeagueRank[] (기본: 정산된 최근 주) |
| GET  | /division    | ?week=&neighbors= → LeagueDivision (분반 + 이웃 격차) |
| GET  | /me/results  | 내 리그 이력 → LeagueResult[] |

정산(actual_value·accuracy_score·ELO)은 Celery 주간 태스크가 수행한다.

⚠️ **제출 주 ≠ 조회 주**(R13 CO-R-1). 제출은 항상 **이번 주**(`_current_week_start`)에
쌓이고 정산은 월요일에 **지난주**를 채운다 — 두 주가 겹치는 시점이 없다. 그래서
순위 조회의 기본값은 이번 주가 아니라 **정산이 실제로 존재하는 가장 최근 주**다
(`_default_ranked_week`). 이번 주를 기본으로 두면 전 행이 accuracy·elo·tier 전부
NULL이라 정렬이 최종 타이브레이크(user_id)만 남아 **순위가 UUID 사전순**이 된다.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, LIMIT_TODAY, limiter, user_or_ip_key
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
from app.services.weather_api import DEFAULT_REGION, KST

router = APIRouter(prefix="/api/v1/league", tags=["league"])


def _current_week_start() -> date:
    return week_start_of(datetime.now(KST).date())


async def _latest_settled_week(db: AsyncSession) -> date | None:
    """정산이 실제로 끝난 가장 최근 주(월요일). 정산 이력이 전혀 없으면 None.

    `accuracy_score IS NOT NULL`이 정산 완료의 표식이다 — celery
    settle_weekly_league가 actual_value·accuracy_score·elo·tier를 한 UPDATE로
    함께 채우므로 넷 중 어느 것으로 걸러도 같은 행 집합이다.
    """
    return (
        await db.execute(
            select(func.max(LeagueResult.week_start)).where(
                LeagueResult.accuracy_score.is_not(None)
            )
        )
    ).scalar_one_or_none()


async def _default_ranked_week(db: AsyncSession, week: date | None) -> date:
    """순위 조회의 대상 주 — 명시 ?week= > 정산된 최근 주 > 이번 주 (CO-R-1).

    "지난주 고정"(`이번 주 - 7일`)이 아니라 **조회**로 정하는 이유: 정산은
    KMA 실측에 의존하고 재시도 경로가 사실상 없어(CO-R-5) 한 주를 통째로
    놓칠 수 있다. 고정 오프셋이면 그 주 내내 리더보드가 다시 전건 NULL로
    돌아가고, 배포 첫 주(지난주 데이터 자체가 없음)와 심사 데모(마지막 정산이
    2~3주 전일 수 있음)도 같은 구멍에 빠진다. `MAX(week_start)` 한 번은
    week_start 인덱스를 타는 값싼 집계이고, 그 대가로 **"화면에 뜬 순위는
    반드시 정산된 순위"**가 구조적으로 보장된다.

    아무 주도 정산된 적이 없으면 이번 주로 떨어진다 — 빈 DB·첫 주에
    "참가자 목록"이라도 보여 주던 종전 동작을 유지한다.
    """
    if week is not None:
        return week
    return await _latest_settled_week(db) or _current_week_start()


@router.get("/current", response_model=LeagueCurrent)
async def get_current(user: User = Depends(get_current_user)) -> LeagueCurrent:
    """이번 주 예측 대상 기간·지역.

    ⚠️ `mid_forecast`는 **빈 dict 고정**이다(R13 CO-Q-6). 예전엔 여기서
    `get_mid_forecast`(KMA 중기육상예보)를 불렀는데 **리그 진입마다 KMA 2콜**을
    쓰면서 화면 산출물이 0이었다 — 프론트는 R9-01 §3.1에서 이 raw JSON을
    버리고 `/duel/briefing`을 재사용하도록 바뀌었고(`LeaguePage.jsx:31` 주석이
    그 교체를 기록한다) 서버 호출만 남아 쿼터를 태웠다. 세 KMA 경로 중 유일하게
    캐시·실패마커도 없어 KMA 장애가 리그 화면 전체를 막았다.
    필드는 **응답 계약 유지를 위해 남긴다**(제거하면 구 클라이언트가 깨진다).
    """
    return LeagueCurrent(
        week_start=_current_week_start(),
        region=DEFAULT_REGION,
        mid_forecast={},
    )


@router.post("/predict", response_model=PredictResponse)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def submit_prediction(
    request: Request,
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
    # 위 SELECT는 **경합을 막지 못한다** — 같은 유저의 두 요청이 겹치면 둘 다
    # "없음"을 보고 둘 다 INSERT한다. 그래서 DB에 UNIQUE(user_id, week_start)를
    # 걸었고(0013), 여기서는 그 제약이 말하는 것을 **SELECT와 같은 답**으로 옮긴다.
    # 경합에서 진 쪽이 500을 받으면 사용자는 "제출됐는지 아닌지"를 알 수 없다 —
    # 이미 자기 예측이 들어가 있는데도 그렇다.
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이번 주 예측을 이미 제출했습니다.", "code": "ALREADY_SUBMITTED"},
        )
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
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def get_leaderboard(
    request: Request,
    week: date | None = Query(
        default=None, description="주 시작일(월요일), 기본: 정산된 가장 최근 주"
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # 전체 유저 집계 — RLS 미적용 세션
) -> list[LeagueRank]:
    ranked = await _ranked_leaderboard(db, await _default_ranked_week(db, week))
    return [
        LeagueRank(rank=i, **{k: v for k, v in row.items() if k != "user_id"})
        for i, row in enumerate(ranked, start=1)
    ]


@router.get("/division", response_model=LeagueDivision)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def get_division(
    request: Request,
    week: date | None = Query(
        default=None, description="주 시작일(월요일), 기본: 정산된 가장 최근 주"
    ),
    neighbors: int = Query(
        default=league_service.NEIGHBOR_SPAN,
        ge=0,
        le=league_service.DIVISION_SIZE,
        description="내 위·아래로 보여줄 이웃 수(분반 경계에서 잘림)",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # 전체 유저 집계 — RLS 미적용 세션
) -> LeagueDivision:
    """분반 리더보드 (R13-01 §2.8) — 전역 순위를 30인 블록으로 잘라 내 블록만.

    기본 주는 /leaderboard와 **같은 규칙**(정산된 최근 주)이다 — 두 화면이 다른
    주를 보면 "내 분반 3위"와 리더보드가 어긋난다.
    """
    week_start = await _default_ranked_week(db, week)
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
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def get_my_results(
    request: Request,
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

"""온보딩 API (/api/v1/onboarding) — 스프린트 R7-01 §3.1 · R7-02 §3.1.

| POST | /placement/start      | 배치고사 세션 발급(mode='placement', 6문항) |
| POST | /placement/submit-all | 미채점 로그 일괄 채점(기채점은 멱등 스킵)  |

이미 완료(users.placement_completed_at NOT NULL)면 409 PLACEMENT_ALREADY_DONE.
당일 미완료 배치 세션 재호출은 멱등 재조회 — sessions의 daily 부분 유니크 인덱스
((user_id, session_date, mode) WHERE unit_id IS NULL)가 mode='placement'에도
그대로 적용되므로 get_today_session의 선조회→발급→IntegrityError 재조회 패턴을
답습한다. 답안 제출은 submit-all(일괄, RAG 없는 순수 채점 — R7-02) 또는 기존
/session/{id}/answer(문항별 — 불변, daily와 공유)로, 완료는 /session/{id}/complete로
(placement는 구름 미소모·XP/퀘스트 스킵 — routers/session.py 분기).
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_SUBMIT_ALL, LIMIT_TODAY, limiter, user_or_ip_key
from app.models.session import Session
from app.models.user import User
from app.routers.session import (
    _progress_of,
    _session_logs,
    session_today_response,
)
from app.schemas.onboarding import (
    PlacementAnswerOutcome,
    PlacementSubmitAllRequest,
    PlacementSubmitAllResult,
)
from app.schemas.session import SessionToday
from app.services import answer_service, placement_service
from app.services.answer_service import QuizNotInSessionError
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


async def _get_placement_session(
    db: AsyncSession, user: User, today
) -> Session | None:
    return (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.session_date == today,
                Session.mode == placement_service.MODE_PLACEMENT,
            )
        )
    ).scalar_one_or_none()


@router.post("/placement/start", response_model=SessionToday)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def start_placement(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionToday:
    """배치고사 세션 발급 (§3.1) — 완료자 409, 당일 미완료 세션은 멱등 재조회."""
    if user.placement_completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "이미 배치고사를 완료했습니다.",
                "code": "PLACEMENT_ALREADY_DONE",
            },
        )

    today = datetime.now(KST).date()

    # 1) 당일 미완료 배치 세션이 있으면 그대로 반환 (멱등 — daily 패턴)
    session = await _get_placement_session(db, user, today)

    # 2) 없으면 발급 — 동시 요청이 부분 유니크 인덱스에 걸리면 재조회
    if session is None:
        try:
            async with db.begin_nested():
                session, _ = await placement_service.create_placement_session(
                    db, user, today
                )
        except IntegrityError:
            logger.info(
                "배치 세션 동시 발급 감지 — 기존 세션 재조회 (user=%s)", user.id
            )
            session = await _get_placement_session(db, user, today)
            if session is None:
                raise

    return await session_today_response(db, session, user)


@router.post("/placement/submit-all", response_model=PlacementSubmitAllResult)
@limiter.limit(LIMIT_SUBMIT_ALL, key_func=user_or_ip_key)
async def submit_placement_answers(
    request: Request,
    body: PlacementSubmitAllRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> PlacementSubmitAllResult:
    """배치고사 답안 일괄 채점 (R7-02 §3.1).

    당일 placement 세션의 미채점 로그만 GRADERS로 일괄 채점한다 — 문항별
    answer 경로의 지연 원인(문항마다 RAG 동기 대기)이 없는 순수 루프
    (answer_service.submit_answers_bulk). placement 계약 그대로 XP·스트릭·
    퀘스트·에너지 없음, weak_tags·뱅크 통계는 기존 answer 경로와 동일 갱신.
    기채점 로그는 멱등 스킵(재진입 시 전체 409로 죽이지 않음 — 기존 결과 반환).
    채점 결과 필드 주입은 스키마(extra='forbid')가 422로 거부한다.

    세션 조회가 mode='placement'로 한정되므로 daily·unit 세션은 이 경로로
    채점될 수 없다(404). 완료 확정(θ 배정)은 기존 /session/{id}/complete 몫.
    """
    today = datetime.now(KST).date()
    session = await _get_placement_session(db, user, today)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "진행 중인 배치고사 세션이 없습니다.",
                "code": "PLACEMENT_SESSION_NOT_FOUND",
            },
        )

    logs = await _session_logs(db, session)
    try:
        outcomes = await answer_service.submit_answers_bulk(
            db,
            user,
            logs,
            [(a.quiz_id, a.answer, a.elapsed_sec) for a in body.answers],
        )
    except QuizNotInSessionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "세션에 해당 퀴즈가 없습니다.", "code": "QUIZ_NOT_FOUND"},
        )

    # logs는 방금 채점된 ORM 객체 그대로 — 재조회 없이 진행도 계산
    return PlacementSubmitAllResult(
        results=[
            PlacementAnswerOutcome(quiz_id=quiz_id, is_correct=is_correct)
            for quiz_id, is_correct in outcomes
        ],
        progress=_progress_of(logs),
    )

"""Session API (/api/v1/session) — 스프린트 R2-01 §3.1 (S1).

| GET  | /today                  | 오늘의 세션(5문항) — 당일 재호출 시 동일 세션 (멱등) |
| POST | /{session_id}/answer    | {quiz_id, answer, elapsed_sec?} → AnswerResult + session_progress |
| POST | /{session_id}/complete  | 전 문항 응답 시 {xp_total, correct_count, total, streak_count}, 미완료 409 |

멱등성: sessions UNIQUE(user_id, session_date, mode) 제약을 활용한다 —
선조회 후 없으면 발급하되, 동시 요청이 제약에 걸리면 SAVEPOINT 롤백 후 재조회.
채점·XP·weak_tags는 services/answer_service.py 공통 파이프라인을 사용해
기존 /quiz/{id}/answer와 동일하게 동작한다 (하위 호환).
에러 포맷·인증은 02번 스펙 공통 규칙과 동일.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, LIMIT_TODAY, limiter, user_or_ip_key
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.schemas.session import (
    SessionAnswerRequest,
    SessionAnswerResult,
    SessionCompleteResult,
    SessionItem,
    SessionProgress,
    SessionToday,
)
from app.services import answer_service, session_service
from app.services.ai_client import AIWorkerError
from app.services.answer_service import AlreadyAnsweredError, BoardStateRequiredError
from app.services.board_engine import BoardRulesError, BoardValidationError
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/session", tags=["session"])


# board 플레이에 필요한 template 필드 화이트리스트 (§3.3) — correct_answer는
# 이 목록에 없으므로 구조적으로 노출되지 않는다(방어적 비밀 정답 제외).
BOARD_TEMPLATE_FIELDS = (
    "question_text",
    "mode",
    "guide_steps",
    "initial_state",
    "palette",
    "goal_conditions",
    "hints",
)


def _board_template_json(question: dict) -> dict | None:
    """board 유형이면 render된 question_json에서 board 플레이 필드만 추린다.

    create_daily_session이 슬롯 치환을 발급 시점에 마친 question_json을 넘기므로
    여기서 화이트리스트로 뽑기만 하면 슬롯 치환이 반영된 값이 노출된다.
    화이트리스트에 없는 correct_answer는 제외된다. board 외 유형은 None.
    """
    if question.get("question_type") != "board":
        return None
    return {key: question[key] for key in BOARD_TEMPLATE_FIELDS if key in question}


def _to_session_item(
    quiz_id: str,
    question: dict,
    level_group: str,
    source: str,
    slot_filled: bool,
) -> SessionItem:
    """question_json → SessionItem (correct_answer 미노출 — 기존 /quiz 관례).

    board 유형은 프론트가 보드를 그리도록 template_json(board 플레이 필드)을 함께
    노출한다(§3.3). 그 외 유형은 template_json=None.
    """
    return SessionItem(
        quiz_id=quiz_id,
        concept_tag=question.get("concept_tag", "pressure_front"),
        question_type=question.get("question_type", "multiple_choice"),
        question_text=question.get("question_text", ""),
        options=question.get("options"),
        level_group=level_group,
        source=source,
        slot_filled=slot_filled,
        template_json=_board_template_json(question),
    )


async def _session_logs(db: AsyncSession, session: Session) -> list[QuizLog]:
    """세션 소속 quiz_logs를 발급 순서(quiz_id 오름차순)로 조회."""
    return list(
        (
            await db.execute(
                select(QuizLog)
                .where(QuizLog.session_id == session.id)
                .order_by(QuizLog.quiz_id.asc())
            )
        )
        .scalars()
        .all()
    )


def _progress_of(logs: list[QuizLog]) -> SessionProgress:
    answered = sum(1 for log in logs if log.is_correct is not None)
    return SessionProgress(answered=answered, total=len(logs))


async def _get_today_session(
    db: AsyncSession, user: User, today
) -> Session | None:
    return (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.session_date == today,
                Session.mode == session_service.MODE_DAILY,
            )
        )
    ).scalar_one_or_none()


@router.get("/today", response_model=SessionToday)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def get_today_session(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionToday:
    today = datetime.now(KST).date()

    # 1) 오늘 세션이 이미 있으면 그대로 반환 (멱등)
    session = await _get_today_session(db, user, today)

    # 2) 없으면 발급 — 동시 요청이 UNIQUE 제약에 걸리면 재조회
    if session is None:
        try:
            async with db.begin_nested():
                session, _ = await session_service.create_daily_session(
                    db, user, today
                )
        except IntegrityError:
            logger.info("세션 동시 발급 감지 — 기존 세션 재조회 (user=%s)", user.id)
            session = await _get_today_session(db, user, today)
            if session is None:
                raise
        except AIWorkerError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "detail": "퀴즈 생성 서비스가 일시적으로 응답하지 않습니다.",
                    "code": "AI_WORKER_UNAVAILABLE",
                },
            )

    logs = await _session_logs(db, session)
    meta = {
        m.get("quiz_id"): m
        for m in (session.recipe_json or {}).get("items", [])
    }
    items = [
        _to_session_item(
            log.quiz_id,
            log.question_json or {},
            user.level_group,
            source=meta.get(log.quiz_id, {}).get("source", "bank"),
            slot_filled=meta.get(log.quiz_id, {}).get("slot_filled", False),
        )
        for log in logs
    ]
    return SessionToday(
        session_id=session.id,
        session_date=session.session_date,
        mode=session.mode,
        items=items,
        progress=_progress_of(logs),
    )


def _resolve_board_answer(
    log: QuizLog, answer: str, board_state: dict | None
) -> str:
    """§3.4 board 제출을 answer 문자열로 정규화 — 누락 422 / 형식 위반 422."""
    try:
        return answer_service.resolve_answer(log, answer, board_state)
    except BoardStateRequiredError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "보드 유형 문항은 board_state가 필요합니다.",
                "code": "BOARD_STATE_REQUIRED",
            },
        )
    except BoardValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"detail": f"보드 상태가 올바르지 않습니다: {exc}", "code": "BOARD_STATE_INVALID"},
        )


async def _load_session_or_404(
    db: AsyncSession, user: User, session_id: uuid.UUID
) -> Session:
    session = (
        await db.execute(
            select(Session).where(Session.id == session_id, Session.user_id == user.id)
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 세션을 찾을 수 없습니다.", "code": "SESSION_NOT_FOUND"},
        )
    return session


@router.post("/{session_id}/answer", response_model=SessionAnswerResult)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def submit_session_answer(
    request: Request,
    session_id: uuid.UUID,
    body: SessionAnswerRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionAnswerResult:
    session = await _load_session_or_404(db, user, session_id)

    log = (
        await db.execute(
            select(QuizLog).where(
                QuizLog.session_id == session.id,
                QuizLog.user_id == user.id,
                QuizLog.quiz_id == body.quiz_id,
            )
        )
    ).scalar_one_or_none()
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "세션에 해당 퀴즈가 없습니다.", "code": "QUIZ_NOT_FOUND"},
        )

    # board 유형(§3.4): board_state 필수·검증, answer 문자열로 정규화
    answer = _resolve_board_answer(log, body.answer, body.board_state)

    # 멱등 가드·세션 XP 누적은 서비스 층 (R2-01 웨이브 1 리뷰 1번 —
    # /quiz 경로로 세션 문항을 제출해도 session.xp_total이 정확)
    try:
        result = await answer_service.submit_answer_for_log(
            db, user, log, answer, body.elapsed_sec
        )
    except AlreadyAnsweredError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 답안을 제출한 퀴즈입니다.", "code": "ALREADY_ANSWERED"},
        )
    except BoardRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"detail": str(exc), "code": "BOARD_RULES_UNAVAILABLE"},
        )

    logs = await _session_logs(db, session)
    return SessionAnswerResult(
        **result.model_dump(), session_progress=_progress_of(logs)
    )


@router.post("/{session_id}/complete", response_model=SessionCompleteResult)
async def complete_session(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionCompleteResult:
    session = await _load_session_or_404(db, user, session_id)

    logs = await _session_logs(db, session)
    progress = _progress_of(logs)
    if progress.answered < progress.total or progress.total == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": f"아직 풀지 않은 문항이 있습니다 ({progress.answered}/{progress.total}).",
                "code": "SESSION_NOT_COMPLETED",
            },
        )

    if session.completed_at is None:
        session.completed_at = datetime.now(timezone.utc)
        await db.flush()

    correct_count = sum(1 for log in logs if log.is_correct)
    db_user = await db.get(User, user.id)
    streak_count = db_user.streak_count if db_user is not None else user.streak_count
    return SessionCompleteResult(
        xp_total=session.xp_total,
        correct_count=correct_count,
        total=progress.total,
        streak_count=streak_count,
    )

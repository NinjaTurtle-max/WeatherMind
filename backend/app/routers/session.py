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
from app.schemas.curriculum import CrownAward
from app.schemas.session import (
    SessionAnswerRequest,
    SessionAnswerResult,
    SessionCompleteResult,
    SessionItem,
    SessionProgress,
    SessionToday,
    UnitResult,
)
from app.services import (
    answer_service,
    badge_service,
    curriculum_service,
    energy_service,
    placement_service,
    quest_service,
    session_service,
    weatherbrain_service,
)
from app.services.ai_client import AIWorkerError
from app.services.answer_service import AlreadyAnsweredError, BoardStateRequiredError
from app.services.board_engine import BoardRulesError, BoardValidationError
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/session", tags=["session"])


def _out_of_clouds(exc: energy_service.OutOfCloudsError) -> HTTPException:
    """구름 소진 → 429 OUT_OF_CLOUDS (다음 회복 ETA 포함, §3.3·§3.5)."""
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "detail": "구름이 부족합니다. 시간이 지나면 회복됩니다.",
            "code": "OUT_OF_CLOUDS",
            "next_regen_sec": exc.next_regen_sec,
        },
    )


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

    # 1) 오늘 세션이 이미 있으면 그대로 반환 (멱등) — 단, 발급 후 쌓인 응답이
    #    θ에 반영되도록 재조회 경로에서도 refresh_abilities를 호출한다
    #    (R7-01 §3.4-7 "answer×3 → 재발급 → num_responses>0 전이" 실왕복 계약.
    #    발급 경로는 create_daily_session→decide_route가 이미 호출하므로 제외).
    #    ai-worker 실패 시 저장된 θ 폴백이라 세션 반환은 항상 진행된다.
    session = await _get_today_session(db, user, today)
    if session is not None:
        await weatherbrain_service.refresh_abilities(db, user)

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

    # 구름 에너지(§3.3): 최초(비멱등) 제출에만 1 소모 — 0이면 제출 전 429.
    # 재제출(멱등 가드 히트)은 미소모하도록 이미 응답된 로그면 소모를 건너뛴다
    # (submit_answer_for_log이 AlreadyAnsweredError로 409 처리).
    # 배치고사(mode='placement')는 온보딩 진단이므로 구름을 소모하지 않고
    # XP도 부여하지 않는다 (R7-01 §3.3 — 에너지 면제와 동일한 mode 분기.
    # 신규 유저가 에너지 걱정 없이 6문항을 끝내야 초기 θ가 선다).
    is_placement = session.mode == placement_service.MODE_PLACEMENT
    already_answered = log.user_answer is not None or log.is_correct is not None
    if not already_answered and not is_placement:
        # 소모는 요청 트랜잭션(get_db_with_rls) 안에서 일어나므로, 이후 422/503/409로
        # 예외가 나면 롤백되어 구름이 새지 않는다 — "제출 성공 시에만 소모"가 성립한다.
        # (이 속성은 소모가 요청 트랜잭션을 공유할 때만 유효: 별도 커밋/예외 삼킴 금지.)
        try:
            await energy_service.consume(db, user)
        except energy_service.OutOfCloudsError as exc:
            raise _out_of_clouds(exc)

    # board 유형(§3.4): board_state 필수·검증, answer 문자열로 정규화
    answer = _resolve_board_answer(log, body.answer, body.board_state)

    # 멱등 가드·세션 XP 누적은 서비스 층 (R2-01 웨이브 1 리뷰 1번 —
    # /quiz 경로로 세션 문항을 제출해도 session.xp_total이 정확)
    try:
        result = await answer_service.submit_answer_for_log(
            db, user, log, answer, body.elapsed_sec, grant_xp=not is_placement
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

    correct_count = sum(1 for log in logs if log.is_correct)

    # 배치고사(§3.3) — 진단 전용 완료 경로: XP·스트릭·퀘스트·배지·왕관 부여를
    # 모두 스킵하고, 응답을 IRT 형식으로 조립해 개인화된 초기 θ를 배정한다.
    if session.mode == placement_service.MODE_PLACEMENT:
        if session.completed_at is None:
            session.completed_at = datetime.now(timezone.utc)
            # ai-worker 장애 시 사전 θ 유지 + 완료는 기록(재시도 강요 금지 — §3.3)
            abilities = await placement_service.finalize_placement(db, user, logs)
            db_user = await db.get(User, user.id)
            if db_user is not None and db_user.placement_completed_at is None:
                db_user.placement_completed_at = datetime.now(timezone.utc)
            await db.flush()
        else:
            # 재완료(멱등) — 저장된 θ 재조회 (재추정·재기록 없음)
            abilities = await weatherbrain_service.load_abilities(db, user)
        return SessionCompleteResult(
            xp_total=session.xp_total,
            correct_count=correct_count,
            total=progress.total,
            streak_count=user.streak_count,
            # /progress/abilities와 동일 형식(§3.1 보강 — 프론트 렌더러 공유)
            abilities=placement_service.to_progress_abilities(abilities),
            placement_done=True,
        )

    all_correct = progress.total > 0 and correct_count == progress.total
    is_first_complete = session.completed_at is None
    crown_award: CrownAward | None = None

    if is_first_complete:
        session.completed_at = datetime.now(timezone.utc)
        await db.flush()
        # 무오답 세션 배지(perfect_session) — 5/5 정답, 중복은 UNIQUE로 방어 (R4-01 §3.3)
        if badge_service.is_perfect_session(correct_count, progress.total):
            await badge_service.award_badge(db, user.id, badge_service.BADGE_PERFECT_SESSION)
        # 데일리 만점 → 왕관 유입 (R8-01 §3.4): 세션 문항 최다 개념(동률: route
        # target 우선→사전순)의 "열린 첫 미클리어 quiz 유닛"에 왕관 +1. daily는
        # 하루 1세션(멱등 인덱스) + 최초 완료에만 부여라 파밍 상한이 선다.
        # placement는 위에서 조기 반환, 유닛 세션은 mode 분기로 제외된다.
        if session.mode == session_service.MODE_DAILY and all_correct:
            concept = curriculum_service.majority_concept(
                (log.concept_tag for log in logs),
                (session.route_decision or {}).get("target_concept_tag"),
            )
            if concept is not None:
                award = await curriculum_service.award_crown_for_activity(
                    db, user, concept_tag=concept, kind="quiz"
                )
                if award is not None:
                    crown_award = CrownAward(**award)

    # 유닛 세션 unit_result (R8-01 §3.1 계약 복구) — grant_unit_crown 반환을
    # 버리지 않고 노출한다(프론트 UnitSummary가 읽는 필드). 왕관 가산(§3.2)은
    # 기존과 동일하게 "세션 최초 완료 + 전 문항 정답"일 때만(멱등) — 그 외
    # (오답 있음·재완료)엔 저장된 진도 스냅샷을 unit_xp=0으로 돌려준다.
    unit_result: UnitResult | None = None
    if session.unit_id is not None:
        payload = await curriculum_service.unit_result_for_session(
            db,
            user,
            session.unit_id,
            all_correct=all_correct,
            grant_crown=is_first_complete and all_correct,
        )
        if payload is not None:
            unit_result = UnitResult(**payload)

    # 일일 퀘스트 재계산 — 세션 complete 트리거(당일 집계 멱등 재계산) (R4-01 §3.1)
    await quest_service.recalculate_quests(db, user, session.session_date)

    db_user = await db.get(User, user.id)
    streak_count = db_user.streak_count if db_user is not None else user.streak_count
    return SessionCompleteResult(
        xp_total=session.xp_total,
        correct_count=correct_count,
        total=progress.total,
        streak_count=streak_count,
        unit_result=unit_result,
        crown_award=crown_award,
    )

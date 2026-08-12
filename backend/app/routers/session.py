"""Session API (/api/v1/session) — 스프린트 R2-01 §3.1 (S1).

| GET  | /today                  | 오늘의 세션(15문항 — R13-01 §2.10: 신규5·복습4·실황1·진도5) — 당일 재호출 시 동일 세션 (멱등) |
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
from app.schemas.reward import BadgeAward, QuestReward
from app.schemas.session import (
    ForecastClosingStep,
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
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/session", tags=["session"])


# board 플레이에 필요한 template 필드 화이트리스트 (§3.3·§3.5) — correct_answer는
# 이 목록에 없으므로 구조적으로 노출되지 않는다(방어적 비밀 정답 제외).
# 프론트 AtmosphereBoard.jsx가 소비하는 표시용 필드 집합과 1:1 —
# 드리프트는 tests/test_session_board_item.py 계약 테스트가 감시한다.
BOARD_TEMPLATE_FIELDS = (
    "question_text",
    "mode",
    "guide_steps",
    "initial_state",
    "palette",
    "goal_conditions",
    "hints",
    "time_limit_sec",  # §3.5 미니 미션 타이머 (표시·카운트다운 전용, 정답 정보 없음)
    "based_on",  # §3.5 재현 퍼즐 "실화" 배지 (event_name·event_date·region, 표시 전용)
)


# 유형별 플레이 페이로드 화이트리스트 (R10-07 §2.1) — board 전용이던 것을 전 유형으로
# 일반화한다. 프론트 QuestionCard.jsx가 유형별로 소비하는 필드와 1:1이며
# (match→pairs, ordering→items·shuffled, slider→min·max·step·unit), 어떤 유형에서도
# correct_answer·explanation_hint는 목록에 없어 구조적으로 노출되지 않는다.
# 목록에 없는 유형(multiple_choice·short_answer·cloze)은 추가 페이로드가 필요 없어
# None이다 — 객관식 보기는 SessionItem.options 전용 컬럼으로 나간다.
# 드리프트는 tests/test_r10_question_payload_contract.py(시드 전건·7유형 전수)와
# tests/test_session_board_item.py(board 양방향)가 감시한다.
QUESTION_PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "board": BOARD_TEMPLATE_FIELDS,
    "match": ("pairs",),
    "ordering": ("items", "shuffled"),
    "slider": ("min", "max", "step", "unit"),
}


def _question_payload(question: dict) -> dict | None:
    """render된 question_json에서 해당 유형의 플레이 필드만 추린다 (§2.1).

    create_daily_session이 슬롯 치환을 발급 시점에 마친 question_json을 넘기므로
    여기서 화이트리스트로 뽑기만 하면 슬롯 치환이 반영된 값이 노출된다.
    화이트리스트에 없는 correct_answer·explanation_hint는 제외된다.
    페이로드가 필요 없는 유형이거나 저작된 키가 하나도 없으면 None —
    **없는 키에 빈 값·기본값을 주입하지 않는다**(데이터 부재를 가리면 저작 누락을
    영원히 못 찾는다. slider의 min·max·step·unit이 지금 그 상태다 — R10-07 S4).
    """
    fields = QUESTION_PAYLOAD_FIELDS.get(question.get("question_type"))
    if not fields:
        return None
    return {key: question[key] for key in fields if key in question} or None


def _to_session_item(
    quiz_id: str,
    question: dict,
    level_group: str,
    source: str,
    slot_filled: bool,
    kind: str = "new",
    is_correct: bool | None = None,
    retry_correct: bool | None = None,
) -> SessionItem:
    """question_json → SessionItem (correct_answer 미노출 — 기존 /quiz 관례).

    유형별 플레이 페이로드(board의 팔레트·초기배치, match의 pairs, ordering의
    items·shuffled, slider의 min·max·step·unit)는 template_json으로 함께 노출한다
    (R3-01 §3.3 → R10-07 §2.1로 전 유형 확장). 페이로드가 없는 유형은 None.

    is_correct·retry_correct는 재진입 복원용 채점 결과다 (CO-A5) — 기본 None이라
    미응답 문항과 개정 전 호출부는 동작이 같다.
    """
    return SessionItem(
        quiz_id=quiz_id,
        concept_tag=question.get("concept_tag", "pressure_front"),
        question_type=question.get("question_type", "multiple_choice"),
        question_text=question.get("question_text", ""),
        options=question.get("options"),
        level_group=level_group,
        # 문항의 **지식 단계**(난이도 축) — `level_group`(표현 톤·학령)과 다른 축이다.
        # 데이터에는 1,000건 전건 채워져 있는데 이 한 줄이 없어서 화면까지 오는
        # 통로가 끊겨 있었다(2026-08-12 클라이언트 지적 「학습 수준 태깅이 안 보인다」).
        # 없으면 None이고 프론트는 배지를 그리지 않는다(구 세션·구 데이터 하위 호환).
        knowledge_level=question.get("knowledge_level"),
        source=source,
        slot_filled=slot_filled,
        kind=kind,
        template_json=_question_payload(question),
        is_correct=is_correct,
        retry_correct=retry_correct,
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


def _is_resolved(log: QuizLog) -> bool:
    """왕관 판정 단위 (R13-01 §2.1) — 최초 정답이거나 만회 정답이면 해결."""
    return bool(log.is_correct) or bool(log.retry_correct)


def _unit_block_meta(session: Session) -> dict:
    """세션 행에 기록된 진도 블록 메타 (R13-01 §2.10) — 없으면 빈 dict."""
    return (getattr(session, "recipe_json", None) or {}).get("unit_block") or {}


def _crown_scope_logs(session: Session, logs: list[QuizLog]) -> list[QuizLog]:
    """왕관 판정 대상 문항 (R13-01 §2.10) — 진도 블록(kind='unit') 5문항.

    §2.1의 all_resolved를 **세션 전체가 아니라 진도 블록에** 적용한다: "오늘의
    발견·복습·실황"은 다양성 블록이라 유닛 진도의 근거가 아니고, 15문항 전건
    해결을 요구하면 왕관이 사실상 닫힌다(§2.10 "왕관 소유권 이전").

    kind 메타가 **아예 없는** 세션(개정 전 발급분)만 세션 전체로 폴백한다.

    **진도 블록 0인 세션은 폴백하지 않고 빈 목록을 돌려준다** (CO-M7). 예전에는
    `... or logs`로 함께 폴백했는데, 그러면 왕관 기준이 조용히 **5문항에서 15문항으로
    올라간다** — §2.10이 없애려던 바로 그 조건으로 되돌아가는 것이다. 독스트링은
    "줄 유닛이 없어 무동작"이라 적었지만 블록 0은 "열린 유닛 없음"만이 아니라
    **"열린 첫 유닛들의 풀이 전부 빔"**에서도 나므로(대장 L-F2) 전제가 틀렸고,
    거기에 `kind` 기본값 'quiz'가 겹쳐 **board 유닛은 이 경로로 영원히 왕관을 못
    받았다**. 진도가 없으면 진도 왕관도 없다 — 그것이 §2.10의 뜻이다.
    """
    meta = (getattr(session, "recipe_json", None) or {}).get("items", [])
    if not meta:
        return logs
    kinds = {m.get("quiz_id"): m.get("kind") for m in meta}
    return [log for log in logs if kinds.get(log.quiz_id) == "unit"]


def _crown_target(
    session: Session, crown_logs: list[QuizLog]
) -> tuple[str | None, str]:
    """왕관 대상 (concept_tag, kind) — **한 유닛에서 나온 쌍** (CO-M6 / 대장 L3).

    `curriculum_service.pick_crown_unit`은 concept_tag **AND** kind가 모두 일치하는
    유닛을 찾는다. 예전에는 그 두 값을 서로 다른 출처에서 뽑았다 —
    kind는 `recipe_json.unit_block`(블록 **첫 문항**의 유닛), concept은
    `majority_concept`(블록 **최다** 개념). 블록이 두 유닛에 걸치면 둘이 다른 유닛을
    가리켜 매칭이 실패하고, **전건 정답(만회 포함)에도 왕관이 0**이 됐다.
    재현 경로: 초등이 하늘읽기3(board·crown 2)에 도달 → elementary `pressure_front`
    board 시드가 1건뿐 → 블록 = board 1 + 공기의힘1 quiz 4 →
    `pick_crown_unit(air_mass, board)` = 선행 잠금 → None. 약한 형태로는 왕관이
    현재 유닛을 건너뛰고 뒤 유닛에 붙는 **진도 역전**이었다.

    수리는 발급 시점에 기록해 둔 **블록 유닛 자신의 쌍**을 쓰는 것이다. 두 값이 같은
    유닛에서 나오므로 AND 요구가 구조적으로 만족되고, `pick_crown_unit`의 엄격함은
    그대로 둘 수 있다(느슨하게 풀면 "엉뚱한 유닛에 왕관"이라는 새 결함이 생긴다).

    쌍이 없는 세션(concept_tag를 안 적던 개정 전 발급분)만 종전 방식으로 폴백한다.
    """
    block = _unit_block_meta(session)
    concept, kind = block.get("concept_tag"), block.get("kind")
    if concept and kind:
        return concept, kind
    return (
        curriculum_service.majority_concept(
            (log.concept_tag for log in crown_logs),
            (session.route_decision or {}).get("target_concept_tag"),
        ),
        kind or "quiz",
    )


async def _closing_step(
    db: AsyncSession, session: Session, user: User
) -> ForecastClosingStep | None:
    """예보 마감 단계 (R13 A-1) — daily 세션에서만, 필요할 때만 non-null.

    유닛·배치 세션은 마감 단계가 없다(진도 연습·진단이라 하루 1회 예보와 무관).
    판정 전체는 session_service.forecast_closing_step이 소유한다 — 여기서는
    mode 게이트와 스키마 변환만 한다.
    """
    if session.mode != session_service.MODE_DAILY:
        return None
    step = await session_service.forecast_closing_step(db, user)
    return ForecastClosingStep(**step) if step is not None else None


async def session_today_response(
    db: AsyncSession, session: Session, user: User
) -> SessionToday:
    """세션 → SessionToday 응답 조립 — daily·unit(curriculum)·placement(onboarding) 공용.

    recipe_json items 메타에 level_group이 있으면(배치고사) 그 값을, 없으면
    user.level_group을 쓴다 — daily·unit는 메타에 키가 없어 동작 동일.
    kind(R13-01 §2.10)도 같은 메타에서 읽는다. 메타에 없으면(개정 전 발급 세션·
    유닛/배치 세션) 유닛 세션은 전 문항이 진도이므로 'unit', 나머지는 'new'다.
    """
    logs = await _session_logs(db, session)
    meta = {
        m.get("quiz_id"): m
        for m in (session.recipe_json or {}).get("items", [])
    }
    default_kind = "unit" if session.mode == curriculum_service.MODE_UNIT else "new"
    items = [
        _to_session_item(
            log.quiz_id,
            log.question_json or {},
            meta.get(log.quiz_id, {}).get("level_group", user.level_group),
            source=meta.get(log.quiz_id, {}).get("source", "bank"),
            slot_filled=meta.get(log.quiz_id, {}).get("slot_filled", False),
            kind=meta.get(log.quiz_id, {}).get("kind", default_kind),
            # 재진입 복원 (CO-A5) — 중간 이탈 후 다시 들어와도 만회 큐를 세울 수 있다
            is_correct=log.is_correct,
            retry_correct=log.retry_correct,
        )
        for log in logs
    ]
    return SessionToday(
        session_id=session.id,
        session_date=session.session_date,
        mode=session.mode,
        items=items,
        progress=_progress_of(logs),
        closing_step=await _closing_step(db, session, user),
    )


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
        # 진입 게이트(R10-01 §3.1·D6): 잔량 부족이면 **문항을 만들기 전에** 429
        # OUT_OF_CLOUDS(전역 핸들러 변환). 이 분기 안에서만 검사하는 것이 계약이다 —
        # 위의 기존 세션 재조회는 무차단이어야 "풀던 것을 뺏기지 않는다"가 성립한다.
        # 무소모 검사이므로 발급 실패(503 등)로 구름이 새지 않는다.
        await energy_service.require_entry(db, user)
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

    return await session_today_response(db, session, user)



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

    # 배치고사(mode='placement')는 온보딩 진단이므로 구름을 소모하지 않고
    # XP도 부여하지 않는다 (R7-01 §3.3 — 에너지 면제와 동일한 mode 분기.
    # 신규 유저가 에너지 걱정 없이 6문항을 끝내야 초기 θ가 선다).
    # 재제출(멱등 가드 히트)도 새 시도가 아니므로 소모 대상이 아니다
    # (submit_answer_for_log이 AlreadyAnsweredError로 409 처리).
    is_placement = session.mode == placement_service.MODE_PLACEMENT
    already_answered = log.user_answer is not None or log.is_correct is not None

    # board 유형(§3.4): board_state 필수·검증, answer 문자열로 정규화 —
    # BoardStateRequired/BoardValidation → 422는 main.py 전역 핸들러가 변환.
    answer = answer_service.resolve_answer(log, body.answer, body.board_state)

    # 만회 라운드(R13-01 §2.1) — 멱등 의미론의 **유일한 예외**. 최초 오답이고 아직
    # 만회로 해결되지 않은 문항만(is_retry_eligible) 다시 채점해 retry_correct에
    # 기록한다. 같은 세션 조건은 위 로그 조회가 session_id로 걸러 구조적으로 성립.
    # 배치고사는 진단이므로 제외 — 만회는 학습 루프의 장치다.
    # 여기서 조기 반환하므로 구름 소모(should_consume)·XP·weak_tags·뱅크 통계
    # 어디에도 닿지 않는다: 만회는 벌도 파밍도 아니다.
    if not is_placement and answer_service.is_retry_eligible(log):
        retry = await answer_service.submit_retry_for_log(db, user, log, answer)
        state = await energy_service.get_state(db, user)
        logs = await _session_logs(db, session)
        return SessionAnswerResult(
            **retry.model_dump(),
            session_progress=_progress_of(logs),
            clouds_spent=0,
            clouds=state["clouds"],
            is_retry=True,
            retry_correct=retry.is_correct,
        )

    # 멱등 가드·세션 XP 누적은 서비스 층 (R2-01 웨이브 1 리뷰 1번).
    # AlreadyAnswered → 409, BoardRules → 503도 전역 핸들러 담당.
    result = await answer_service.submit_answer_for_log(
        db, user, log, answer, body.elapsed_sec, grant_xp=not is_placement
    )

    # 구름 에너지(R10-01 §3.1): 소모는 **채점 이후 · 오답에만** 1 (should_consume).
    # 진행 중 세션은 잔량 0이어도 끊지 않는다 — consume_if_available이 가드 UPDATE
    # 0행이면 소모를 생략하고 실측 잔량을 돌려준다(429 없음, §3.1 각주 7).
    # 소모는 요청 트랜잭션(get_db_with_rls)을 공유하므로 이후 예외 시 롤백되어 구름이
    # 새지 않는다 — 별도 커밋/예외 삼킴을 넣으면 이 보장이 깨진다.
    now = datetime.now(timezone.utc)
    state = await energy_service.get_state(db, user, now)
    clouds_spent, clouds_remaining = 0, state["clouds"]
    if energy_service.should_consume(
        is_correct=bool(result.is_correct),
        already_answered=already_answered,
        is_placement=is_placement,
    ):
        clouds_remaining = await energy_service.consume_if_available(db, user, now)
        # 실측 차이로 산출 — 잔량 0(소모 생략)·무제한 모드에서 0이 된다.
        clouds_spent = max(
            0, min(energy_service.CLOUD_COST, state["clouds"] - clouds_remaining)
        )

    logs = await _session_logs(db, session)
    return SessionAnswerResult(
        **result.model_dump(),
        session_progress=_progress_of(logs),
        clouds_spent=clouds_spent,
        clouds=clouds_remaining,
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

    # 왕관 판정 (R13-01 §2.1 개정): all_correct(최초 만점) → all_resolved
    # (전 문항이 최초 정답 **또는** 만회 정답). "틀린 걸 고쳐서 끝내면 인정한다"가
    # 개정 취지라, 만회 없는 세션에서는 all_resolved == all_correct로 기존 동작과
    # 완전히 같다. correct_count·all_correct(unit_result 필드)는 **최초 시도**
    # 의미를 그대로 유지한다 — 통계·표기의 근거가 흔들리면 안 되기 때문.
    all_correct = progress.total > 0 and correct_count == progress.total
    all_resolved = progress.total > 0 and all(_is_resolved(log) for log in logs)
    retry_resolved_count = sum(
        1 for log in logs if not log.is_correct and log.retry_correct
    )
    is_first_complete = session.completed_at is None
    crown_award: CrownAward | None = None
    # 이번 완료로 **새로** 획득한 배지 (CO-T-4). 재-complete는 is_first_complete가
    # False라 지급 자체가 안 돌고, 이미 보유 중이면 award_badge가 False다 —
    # 두 경우 모두 빈 리스트로 나가야 화면이 "방금 받았다"를 두 번 말하지 않는다.
    badges_earned: list[BadgeAward] = []

    if is_first_complete:
        session.completed_at = datetime.now(timezone.utc)
        await db.flush()
        # 무오답 세션 배지(perfect_session) — 전 문항 정답(total/total), 중복은 UNIQUE로 방어 (R4-01 §3.3)
        if badge_service.is_perfect_session(correct_count, progress.total):
            granted = await badge_service.award_badge(
                db, user.id, badge_service.BADGE_PERFECT_SESSION
            )
            if granted:
                detail = await badge_service.badge_detail(
                    db, badge_service.BADGE_PERFECT_SESSION
                )
                if detail is not None:
                    badges_earned.append(BadgeAward(**detail))
        # 데일리 → 왕관 유입 (R8-01 §3.4 → R13-01 §2.10 소유권 이전): 판정 대상은
        # **진도 블록 5문항**(_crown_scope_logs)이고, 그 블록이 전건 해결(만회 포함,
        # §2.1)이면 블록 최다 개념(동률: route target 우선→사전순)의 "열린 첫
        # 미클리어 유닛"에 왕관 +1. daily는 하루 1세션(멱등 인덱스) + 최초 완료에만
        # 부여라 **하루 1왕관 상한**이 그대로 선다.
        # kind는 진도 블록 유닛의 kind(quiz|board) — 메타가 없으면 기존값 'quiz'.
        # placement는 위에서 조기 반환, 유닛 세션은 mode 분기로 제외된다.
        crown_logs = _crown_scope_logs(session, logs)
        crown_resolved = bool(crown_logs) and all(
            _is_resolved(log) for log in crown_logs
        )
        if session.mode == session_service.MODE_DAILY and crown_resolved:
            concept, kind = _crown_target(session, crown_logs)
            if concept is not None:
                award = await curriculum_service.award_crown_for_activity(
                    db, user, concept_tag=concept, kind=kind
                )
                if award is not None:
                    crown_award = CrownAward(**award)

    # 유닛 세션 unit_result (R8-01 §3.1 계약 복구) — grant_unit_crown 반환을
    # 버리지 않고 노출한다(프론트 UnitSummary가 읽는 필드).
    #
    # ══ 왕관은 **하루 첫 유닛 세션**에만 (2026-08-13 클라이언트 확정) ═══════════
    # 경위를 남긴다. R13-01 §2.10이 왕관을 일일 세션의 **진도 블록**으로 옮기면서
    # 유닛 직접 진입을 «연습 전용»로 고정했는데, 그 뒤 배합이
    # `{live:2, new:4, review:3, board:1}`이 되며 `unit` kind 자체가 사라져
    # 유입로가 죽었다. 그래서 2026-08-12에 **유닛 세션 완료**로 되돌렸다
    # (`grant_crown=all_correct`). 그런데 그러면 **하루에 유닛을 여러 개 열수록
    # 왕관이 무제한으로 나온다** — daily가 갖고 있던 「하루 1세션 = 하루 1왕관」
    # 상한이 유닛에는 없기 때문이다(`uq_sessions_daily`가 `unit_id IS NULL`에만
    # 걸린다). 확정 사양이 그 구멍을 닫는다: **하루의 첫 유닛 세션이 곧 데일리
    # 세션**이고, 왕관은 그 세션에만 붙는다.
    #
    # ⚠️ **여기서 「첫 세션인가」를 재계산하지 않는다.** 판정은 발급 시점에 끝났고
    # 이 코드는 `recipe_json`의 도장을 **읽기만** 한다. 완료 시점에 다시 세면 두
    # 유닛을 열어 역순으로 완료할 때 둘 다 첫 세션이 되거나 둘 다 아니게 된다
    # (`curriculum_service.is_first_unit_session_today` 독스트링).
    # 도장이 없는 세션(개정 이전 발급분)은 `.get`이 None → False라 왕관이 나가지
    # 않는다 — 모르는 세션은 안 주는 쪽으로 닫는다.
    #
    # ⚠️ 왕관 유입로는 **3개**다 (CO-L5 정정): ⑴ **하루 첫 유닛 세션 완료**(여기) ·
    # ⑵ 보드 퍼즐 최초 클리어(routers/board.py) · ⑶ /dev 개발 경로
    # (UserUnitProgress 직접 upsert — grant_unit_crown 미경유). 목록의 단일
    # 소유자는 curriculum_service 모듈 독스트링이다.
    # 진도 스냅샷(crowns·cleared)과 all_correct·all_resolved 표기는 그대로 나간다.
    unit_result: UnitResult | None = None
    if session.unit_id is not None:
        daily_first = bool(
            (getattr(session, "recipe_json", None) or {}).get("daily_first")
        )
        payload = await curriculum_service.unit_result_for_session(
            db,
            user,
            session.unit_id,
            all_correct=all_correct,
            # 하루 첫 유닛 세션 ∧ 전 문항 정답일 때만 — `grant_unit_crown`이 멱등
            # 판정(이미 준 왕관은 다시 안 준다)을 갖고 있어 상한은 그쪽이 지킨다.
            grant_crown=all_correct and daily_first,
        )
        if payload is not None:
            unit_result = UnitResult(**payload, all_resolved=all_resolved)

    # 일일 퀘스트 재계산 — 세션 complete 트리거(당일 집계 멱등 재계산) (R4-01 §3.1)
    # 반환(무엇이 완료됐고 몇 XP인지)을 **버리지 않는다** (CO-T-4): 버렸을 때
    # 최대 +25 XP가 지급만 되고 화면 어디에도 안 떴고, 요약의 "+N XP"는 문항 XP만이라
    # 표기가 실지급보다 그만큼 적었다.
    transitions = await quest_service.recalculate_quests(
        db, user, session.session_date
    )
    quest_rewards = [
        QuestReward(**event) for event in quest_service.reward_events(transitions)
    ]
    bonus_xp = sum(reward.reward_xp for reward in quest_rewards)

    db_user = await db.get(User, user.id)
    streak_count = db_user.streak_count if db_user is not None else user.streak_count
    return SessionCompleteResult(
        xp_total=session.xp_total,
        quest_rewards=quest_rewards,
        badges_earned=badges_earned,
        bonus_xp=bonus_xp,
        # 화면 표기용 총합은 서버가 더한다 — 프론트에 덧셈을 맡기면 더하는 화면마다
        # 빠뜨릴 수 있고, 그게 정확히 이 결함이 났던 방식이다.
        xp_awarded=session.xp_total + bonus_xp,
        correct_count=correct_count,
        total=progress.total,
        streak_count=streak_count,
        unit_result=unit_result,
        crown_award=crown_award,
        all_resolved=all_resolved,
        retry_resolved_count=retry_resolved_count,
        # 15문항 결산 뒤에 붙는 마감 단계 (R13 A-1) — 없으면 null이고 세션은 여기서
        # 끝난다. XP·스트릭·구름은 위에서 이미 확정됐고 이 값이 바꾸지 않는다.
        closing_step=await _closing_step(db, session, user),
    )

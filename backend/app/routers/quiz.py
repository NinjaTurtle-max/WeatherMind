"""Quiz API (/api/v1/quiz) — 02번 스펙.

| GET  | /today            | 오늘의 퀴즈 조회 (Redis 캐시 우선) → QuizQuestion[] |
| POST | /{quiz_id}/answer | {answer} → AnswerResult (RAG Chain 피드백 포함) |
| GET  | /history          | ?limit=20 → QuizLog[] |

/today 흐름:
1. 오늘 이미 발급된 문제가 있으면 그대로 반환 (일일 퀴즈는 멱등)
2. Router Chain(/internal/router-decide)으로 개인화 분기 (weak_tags + 최근 정오답)
3. general → Redis quiz:{date}:{level_group}(24h) 캐시 우선, miss 시 생성 후 캐시
   focused/advanced → 개인화 문제 즉시 생성 (공용 캐시 미사용)
4. quiz_logs에 발급 기록(미응답 상태) 저장 → /answer가 이 행으로 채점

R2-01 변경: 채점·XP·weak_tags 파이프라인은 services/answer_service.py로,
Router Chain 분기(decide_route)·quiz_id 채번(allocate_quiz_ids)은
services/session_service로 추출해 /session/* 경로와 공유한다
(응답 스키마·동작은 기존 그대로 — 하위 호환).
레이트리밋: GET /today 10회/분/유저, POST answer 30회/분/유저 (§3.6).
"""
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, LIMIT_TODAY, limiter, user_or_ip_key
from app.core.redis import get_redis
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.schemas.quiz import AnswerRequest, AnswerResult, QuizLogOut, QuizQuestion
from app.services import ai_client, answer_service, session_service
from app.services.ai_client import AIWorkerError
from app.services.answer_service import AlreadyAnsweredError, BoardStateRequiredError
from app.services.board_engine import BoardRulesError, BoardValidationError
from app.services.weather_api import KST, get_today_weather

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/quiz", tags=["quiz"])

QUIZ_CACHE_TTL_SEC = 24 * 60 * 60  # quiz:{date}:{level_group} — 24시간


def quiz_cache_key(date_str: str, level_group: str) -> str:
    return f"quiz:{date_str}:{level_group}"


def _to_question_schema(quiz_id: str, question: dict, level_group: str) -> QuizQuestion:
    """Quiz Gen Chain 출력(JSON)을 02번 QuizQuestion 응답으로 변환 (correct_answer 미노출)."""
    return QuizQuestion(
        quiz_id=quiz_id,
        concept_tag=question.get("concept_tag", "pressure_front"),
        question_type=question.get("question_type", "multiple_choice"),
        question_text=question.get("question_text", ""),
        options=question.get("options"),
        level_group=level_group,
    )


@router.get("/today", response_model=list[QuizQuestion])
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def get_today_quiz(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[QuizQuestion]:
    today = datetime.now(KST).strftime("%Y%m%d")

    # 1) 오늘 이미 발급된 문제가 있으면 그대로 반환 (멱등)
    existing = (
        (
            await db.execute(
                select(QuizLog)
                .where(QuizLog.user_id == user.id, QuizLog.quiz_id.like(f"{today}-%"))
                .order_by(QuizLog.answered_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return [
            _to_question_schema(existing.quiz_id, existing.question_json, user.level_group)
        ]

    # 2) Router Chain 분기 (session_service와 공유)
    decision = await session_service.decide_route(db, user)
    route = decision.get("route", "general")
    target_concept_tag = decision.get("target_concept_tag")

    # 3) 문제 확보 — general은 일일 공용 캐시 우선(Celery가 새벽에 미리 생성)
    redis = get_redis()
    question: dict | None = None
    if route == "general":
        cached = await redis.get(quiz_cache_key(today, user.level_group))
        if cached:
            try:
                question = json.loads(cached)
            except json.JSONDecodeError:
                logger.warning("quiz 캐시 JSON 파싱 실패 — 재생성")

    if question is None:
        weather_data = await get_today_weather()
        try:
            question = await ai_client.quiz_generate(
                weather_data=weather_data,
                level_group=user.level_group,
                route=route,
                target_concept_tag=target_concept_tag,
            )
        except AIWorkerError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "detail": "퀴즈 생성 서비스가 일시적으로 응답하지 않습니다.",
                    "code": "AI_WORKER_UNAVAILABLE",
                },
            )
        if route == "general":
            await redis.setex(
                quiz_cache_key(today, user.level_group),
                QUIZ_CACHE_TTL_SEC,
                json.dumps(question, ensure_ascii=False),
            )

    # 4) 발급 기록 저장 (미응답 상태) — quiz_id 채번은 세션 발급과 공용 헬퍼
    quiz_id = (await session_service.allocate_quiz_ids(db, user.id, today, 1))[0]

    db.add(
        QuizLog(
            user_id=user.id,
            quiz_id=quiz_id,
            concept_tag=question.get("concept_tag", "pressure_front"),
            question_type=question.get("question_type"),
            question_json=question,
        )
    )
    await db.flush()

    return [_to_question_schema(quiz_id, question, user.level_group)]


@router.post("/{quiz_id}/answer", response_model=AnswerResult)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def submit_answer(
    request: Request,
    quiz_id: str,
    body: AnswerRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> AnswerResult:
    log = (
        await db.execute(
            select(QuizLog).where(
                QuizLog.user_id == user.id, QuizLog.quiz_id == quiz_id
            )
        )
    ).scalar_one_or_none()
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 퀴즈를 찾을 수 없습니다.", "code": "QUIZ_NOT_FOUND"},
        )
    # board 유형(§3.4): board_state 필수·검증, answer 문자열로 정규화
    try:
        answer = answer_service.resolve_answer(log, body.answer, body.board_state)
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

    # 채점·XP·weak_tags·세션 XP 누적·RAG 피드백 — 세션 경로와 공통 파이프라인
    # (멱등 가드는 서비스 층 — R2-01 웨이브 1 리뷰 1번)
    try:
        return await answer_service.submit_answer_for_log(
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


@router.get("/history", response_model=list[QuizLogOut])
async def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[QuizLogOut]:
    logs = (
        (
            await db.execute(
                select(QuizLog)
                .where(QuizLog.user_id == user.id)
                .order_by(QuizLog.answered_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [QuizLogOut.model_validate(log) for log in logs]

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
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.redis import get_redis
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.models.weak_tag import WeakTag
from app.schemas.quiz import AnswerRequest, AnswerResult, QuizLogOut, QuizQuestion
from app.services import ai_client, xp_service
from app.services.ai_client import AIWorkerError
from app.services.weather_api import KST, get_today_weather

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/quiz", tags=["quiz"])

QUIZ_CACHE_TTL_SEC = 24 * 60 * 60  # quiz:{date}:{level_group} — 24시간

# 슬라이더 채점 허용 오차 (0~100 스케일)
SLIDER_TOLERANCE = 10.0


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


def _grade(question: dict, answer: str) -> bool:
    """채점: slider는 ±10 오차 허용, 그 외 공백/대소문자 무시 비교."""
    correct = str(question.get("correct_answer", "")).strip()
    submitted = answer.strip()
    if question.get("question_type") == "slider":
        try:
            return abs(float(submitted) - float(correct)) <= SLIDER_TOLERANCE
        except ValueError:
            return False
    return submitted.casefold() == correct.casefold()


async def _decide_route(db: AsyncSession, user: User) -> dict:
    """weak_tags + 최근 정오답으로 Router Chain 분기 (실패 시 general)."""
    tags = (
        (await db.execute(select(WeakTag).where(WeakTag.user_id == user.id)))
        .scalars()
        .all()
    )
    weak_tags = [
        {"concept_tag": t.concept_tag, "accuracy_rate": float(t.accuracy_rate or 0)}
        for t in tags
        if t.total_count
    ]
    recent = (
        (
            await db.execute(
                select(QuizLog.is_correct)
                .where(QuizLog.user_id == user.id, QuizLog.is_correct.is_not(None))
                .order_by(QuizLog.answered_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    recent_results = [bool(v) for v in reversed(recent)]  # 시간순(과거 → 최근)
    return await ai_client.router_decide(str(user.id), weak_tags, recent_results)


@router.get("/today", response_model=list[QuizQuestion])
async def get_today_quiz(
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

    # 2) Router Chain 분기
    decision = await _decide_route(db, user)
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

    # 4) 발급 기록 저장 (미응답 상태) — quiz_id = 날짜 + 시퀀스
    count = (
        await db.execute(
            select(func.count())
            .select_from(QuizLog)
            .where(QuizLog.user_id == user.id, QuizLog.quiz_id.like(f"{today}-%"))
        )
    ).scalar_one()
    quiz_id = f"{today}-{count + 1:03d}"

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
async def submit_answer(
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
    if log.user_answer is not None or log.is_correct is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 답안을 제출한 퀴즈입니다.", "code": "ALREADY_ANSWERED"},
        )

    question = log.question_json or {}
    is_correct = _grade(question, body.answer)
    concept_tag = log.concept_tag

    # 약점 여부는 이번 답안 반영 "이전" 기준으로 판단 (07번 약점 극복 보너스)
    weak_tag = await xp_service.get_weak_tag(db, user.id, concept_tag)
    is_weak = xp_service.is_weak_concept(weak_tag)

    # XP 계산 (문항당 1회 제출 → 정답이면 곧 첫 시도 정답 보너스 대상)
    xp_earned = xp_service.quiz_xp(is_correct, is_first_try=True, is_weak=is_weak)

    # weak_tags 갱신 + 유저 XP 가산 + 로그 확정
    await xp_service.update_weak_tag(db, user.id, concept_tag, is_correct)
    db_user = await db.get(User, user.id)
    if db_user is not None:
        await xp_service.add_xp(db, db_user, xp_earned)

    log.user_answer = body.answer
    log.is_correct = is_correct
    log.elapsed_sec = body.elapsed_sec
    log.answered_at = datetime.now(timezone.utc)
    await db.flush()

    # RAG Chain 피드백 (실패 시 ai_client 내부 정적 문구 fallback)
    today_weather = await get_today_weather()
    feedback = await ai_client.rag_feedback(
        question_text=question.get("question_text", ""),
        user_answer=body.answer,
        is_correct=is_correct,
        concept_tag=concept_tag,
        today_weather=today_weather,
    )

    return AnswerResult(
        is_correct=is_correct,
        correct_answer=str(question.get("correct_answer", "")),
        feedback=feedback,
        xp_earned=xp_earned,
        concept_tag=concept_tag,
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

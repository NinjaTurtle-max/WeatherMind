"""답안 채점 공통 파이프라인 — 채점 + XP + weak_tags + RAG 피드백.

구조적 결정 (스프린트 R2-01 S1): 기존 routers/quiz.py의 _grade·XP 가산·
weak_tags 갱신·RAG 피드백 흐름을 /quiz/{id}/answer와 /session/{id}/answer
두 경로가 공유하도록 서비스 계층으로 추출했다. /quiz/*의 채점 규칙
(슬라이더 ±10 오차 허용, 공백·대소문자 무시)과 응답 스키마(AnswerResult)는
그대로 유지된다 (§1 하위 호환).

웨이브 1 리뷰 반영:
- 멱등 가드(중복 제출)와 세션 XP 누적을 서비스 층으로 내렸다 — 어느 라우터
  경로로 제출해도(세션 문항을 /quiz로 제출하는 경우 포함) session.xp_total이
  정확하다. 중복 제출은 AlreadyAnsweredError로 알리고 라우터가 409로 변환한다.
- 뱅크 통계·세션 XP는 read-modify-write 대신 원자 UPDATE로 가산한다
  (동시 요청 lost update 방지).
"""
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.schemas.quiz import AnswerResult
from app.services import ai_client, xp_service
from app.services.weather_api import get_today_weather

# 슬라이더 채점 허용 오차 (0~100 스케일)
SLIDER_TOLERANCE = 10.0


class AlreadyAnsweredError(Exception):
    """이미 답안이 제출된 quiz_log에 대한 재제출 (라우터에서 409 ALREADY_ANSWERED 변환)."""


def grade(question: dict, answer: str) -> bool:
    """채점: slider는 ±10 오차 허용, 그 외 공백/대소문자 무시 비교."""
    correct = str(question.get("correct_answer", "")).strip()
    submitted = answer.strip()
    if question.get("question_type") == "slider":
        try:
            return abs(float(submitted) - float(correct)) <= SLIDER_TOLERANCE
        except ValueError:
            return False
    return submitted.casefold() == correct.casefold()


async def submit_answer_for_log(
    db: AsyncSession,
    user: User,
    log: QuizLog,
    answer: str,
    elapsed_sec: int | None,
) -> AnswerResult:
    """미응답 quiz_log 1건에 대한 답안 처리 전체 흐름.

    멱등 가드 → 채점 → 약점 판정(반영 이전 기준, 07번 약점 극복 보너스) →
    XP 가산 → weak_tags 갱신 → 로그 확정 → 뱅크 통계·세션 XP 원자 가산 →
    RAG 피드백. 404 검증은 호출한 라우터가 담당한다 (HTTP 관심사 분리).

    Raises:
        AlreadyAnsweredError: 이미 답안이 제출된 로그.
    """
    if log.user_answer is not None or log.is_correct is not None:
        raise AlreadyAnsweredError(f"quiz_id={log.quiz_id}")

    question = log.question_json or {}
    is_correct = grade(question, answer)
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

    log.user_answer = answer
    log.is_correct = is_correct
    log.elapsed_sec = elapsed_sec
    log.answered_at = datetime.now(timezone.utc)

    # 뱅크 문항 노출·정답 통계 — 원자 UPDATE (전역 콘텐츠, 동시 제출 경합)
    if log.content_item_id is not None:
        await db.execute(
            update(ContentItem)
            .where(ContentItem.id == log.content_item_id)
            .values(
                stat_total=ContentItem.stat_total + 1,
                stat_correct=ContentItem.stat_correct + (1 if is_correct else 0),
            )
        )

    # 세션 문항이면 세션 XP 누적 — 제출 경로(/quiz·/session)와 무관하게 정확
    if log.session_id is not None:
        await db.execute(
            update(Session)
            .where(Session.id == log.session_id)
            .values(xp_total=Session.xp_total + xp_earned)
        )

    await db.flush()

    # RAG Chain 피드백 (실패 시 ai_client 내부 정적 문구 fallback)
    today_weather = await get_today_weather()
    feedback = await ai_client.rag_feedback(
        question_text=question.get("question_text", ""),
        user_answer=answer,
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

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

스프린트 R3-01 §3.6 — 채점기 레지스트리:
- 유형별 채점을 dict[question_type, grader]로 분리했다(GRADERS). 기존 3유형
  (multiple_choice·short_answer·slider)의 채점 규칙·동작은 불변이며, 신규 4유형
  (match·ordering·cloze·board)을 같은 레지스트리에 등록한다.
- board 유형(§3.4)은 board_state를 board_engine으로 재판정(권위 채점)하고,
  피드백은 RAG 호출 없이 성립/미성립 규칙의 explain/hints로 구성한다. answer
  인자에는 board_state가 JSON 직렬화되어 전달된다(QuizLog.user_answer는 Text —
  스키마 변경 없이 구조적 제출을 수용).
"""
import json
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.schemas.quiz import AnswerResult
from app.services import ai_client, board_engine, xp_service
from app.services.weather_api import get_today_weather

# 슬라이더 채점 허용 오차 (0~100 스케일)
SLIDER_TOLERANCE = 10.0

Grader = Callable[[dict[str, Any], str], bool]


class AlreadyAnsweredError(Exception):
    """이미 답안이 제출된 quiz_log에 대한 재제출 (라우터에서 409 ALREADY_ANSWERED 변환)."""


class BoardStateRequiredError(Exception):
    """board 유형인데 board_state 누락 (라우터에서 422 BOARD_STATE_REQUIRED 변환)."""


def resolve_answer(
    log: QuizLog, answer: str, board_state: dict[str, Any] | None
) -> str:
    """제출 body를 submit_answer_for_log가 받는 answer 문자열로 정규화한다 (§3.4).

    board 유형이면 board_state(§3.1)를 검증 후 JSON 직렬화해 answer로 쓴다
    (QuizLog.user_answer가 Text이므로 구조적 제출을 문자열로 저장 — 스키마 불변).
    그 외 유형은 answer를 그대로 반환한다.

    Raises:
        BoardStateRequiredError: board 유형인데 board_state 누락.
        board_engine.BoardValidationError: board_state가 §3.1 위반.
    """
    question = log.question_json or {}
    if question.get("question_type") == "board":
        if board_state is None:
            raise BoardStateRequiredError(f"quiz_id={log.quiz_id}")
        board_engine.validate_board(board_state)
        return json.dumps(board_state, ensure_ascii=False)
    return answer


# ═══════════════════════════════════════════════════════════════
# 채점기 레지스트리 (§3.6) — 유형별 순수 함수 dict
# ═══════════════════════════════════════════════════════════════


def _grade_text(question: dict[str, Any], answer: str) -> bool:
    """공백·대소문자 무시 문자열 일치 (multiple_choice·short_answer·cloze)."""
    correct = str(question.get("correct_answer", "")).strip()
    return answer.strip().casefold() == correct.casefold()


def _grade_slider(question: dict[str, Any], answer: str) -> bool:
    """±10 오차 허용 (0~100 스케일). 숫자 파싱 실패 시 오답."""
    correct = str(question.get("correct_answer", "")).strip()
    try:
        return abs(float(answer.strip()) - float(correct)) <= SLIDER_TOLERANCE
    except ValueError:
        return False


def _grade_match(question: dict[str, Any], answer: str) -> bool:
    """§3.6 match: "left1:right1|left2:right2|..." 전 쌍 일치 (순서 무관).

    pairs는 template_json에 저작된 정답 쌍. 제출/정답을 (left, right) 집합으로
    비교한다(매칭은 본질적으로 순서 무관). 형식 위반·부분 일치는 오답.
    """
    pairs = question.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        return False
    try:
        expected = {(str(p["left"]).strip(), str(p["right"]).strip()) for p in pairs}
    except (KeyError, TypeError):
        return False
    submitted: set[tuple[str, str]] = set()
    for token in answer.split("|"):
        if ":" not in token:
            return False
        left, right = token.split(":", 1)
        submitted.add((left.strip(), right.strip()))
    return submitted == expected


def _grade_ordering(question: dict[str, Any], answer: str) -> bool:
    """§3.6 ordering: "0,2,1,3" 원본 인덱스 순열 완전 일치.

    items는 정답 순서로 저작(shuffled:true는 표시용). 정답 배열은 원본 인덱스를
    올바른 순서로 놓은 것 = 항등 순열 [0,1,...,n-1]. 제출이 이와 완전 일치해야 정답.
    """
    items = question.get("items")
    if not isinstance(items, list) or not items:
        return False
    try:
        submitted = [int(token) for token in answer.split(",")]
    except ValueError:
        return False
    return submitted == list(range(len(items)))


def evaluate_board_answer(
    question: dict[str, Any], board_state: dict[str, Any]
) -> tuple[list[dict[str, Any]], bool, list[dict[str, Any]]]:
    """board_state를 규칙 엔진으로 재판정한다 (§3.4 권위 채점).

    반환: (phenomena 존별 판정, goal_conditions AND 충족 여부, 로드된 규칙).
    규칙은 board_engine이 프로세스 캐시로 관리한다. board_state는 사전에
    board_engine.validate_board로 검증된 것을 전제(라우터가 422 처리).
    """
    rules = board_engine.load_rules()
    phenomena = board_engine.evaluate(board_state, rules)
    passed = board_engine.check_goals(phenomena, question.get("goal_conditions") or [])
    return phenomena, passed, rules


def _grade_board(question: dict[str, Any], answer: str) -> bool:
    """§3.6 board: answer는 board_state의 JSON 직렬화. 엔진 재판정 결과 반환."""
    _, passed, _ = evaluate_board_answer(question, json.loads(answer))
    return passed


# 유형 → 채점기. 미등록 유형은 기본(문자열 일치)으로 폴백 (기존 동작 보존).
GRADERS: dict[str, Grader] = {
    "multiple_choice": _grade_text,
    "short_answer": _grade_text,
    "slider": _grade_slider,
    "cloze": _grade_text,        # §3.6 cloze = short_answer 규칙 재사용
    "match": _grade_match,
    "ordering": _grade_ordering,
    "board": _grade_board,
}


def grade(question: dict[str, Any], answer: str) -> bool:
    """유형별 채점기로 위임 (§3.6 레지스트리). 미등록 유형은 문자열 일치 폴백."""
    grader = GRADERS.get(question.get("question_type"), _grade_text)
    return grader(question, answer)


# ═══════════════════════════════════════════════════════════════
# 제출 파이프라인
# ═══════════════════════════════════════════════════════════════


async def submit_answer_for_log(
    db: AsyncSession,
    user: User,
    log: QuizLog,
    answer: str,
    elapsed_sec: int | None,
    grant_xp: bool = True,
) -> AnswerResult:
    """미응답 quiz_log 1건에 대한 답안 처리 전체 흐름.

    멱등 가드 → 채점 → 약점 판정(반영 이전 기준, 07번 약점 극복 보너스) →
    XP 가산 → weak_tags 갱신 → 로그 확정 → 뱅크 통계·세션 XP 원자 가산 →
    피드백(board는 규칙 explain/hints, 그 외 RAG). 404 검증은 라우터가 담당한다.

    board 유형(§3.4): answer에 board_state JSON을 담아 전달한다. 엔진으로
    phenomena를 산출해 결과에 싣고, 피드백은 RAG 없이 규칙에서 구성한다.

    grant_xp=False(R7-01 §3.3 배치고사): XP를 계산·가산하지 않는다(xp_earned=0,
    유저 XP·세션 xp_total 불변). 채점·weak_tags·뱅크 통계·피드백은 그대로 —
    진단 응답도 실제 학습 데이터이므로 XP 보상만 뗀다. 기본값 True는 기존
    경로(daily·unit·/quiz) 동작 불변(additive).

    Raises:
        AlreadyAnsweredError: 이미 답안이 제출된 로그.
    """
    if log.user_answer is not None or log.is_correct is not None:
        raise AlreadyAnsweredError(f"quiz_id={log.quiz_id}")

    question = log.question_json or {}
    concept_tag = log.concept_tag
    is_board = question.get("question_type") == "board"

    # 채점 — board는 phenomena·규칙을 함께 확보(피드백 재사용, 재계산 방지)
    phenomena: list[dict[str, Any]] | None = None
    board_rules: list[dict[str, Any]] | None = None
    if is_board:
        phenomena, is_correct, board_rules = evaluate_board_answer(
            question, json.loads(answer)
        )
    else:
        is_correct = grade(question, answer)

    # 약점 여부는 이번 답안 반영 "이전" 기준으로 판단 (07번 약점 극복 보너스)
    xp_earned = 0
    if grant_xp:
        weak_tag = await xp_service.get_weak_tag(db, user.id, concept_tag)
        is_weak = xp_service.is_weak_concept(weak_tag)
        # XP 계산 (문항당 1회 제출 → 정답이면 곧 첫 시도 정답 보너스 대상)
        xp_earned = xp_service.quiz_xp(is_correct, is_first_try=True, is_weak=is_weak)

    # weak_tags 갱신 + 유저 XP 가산 + 로그 확정
    await xp_service.update_weak_tag(db, user.id, concept_tag, is_correct)
    if grant_xp:
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
    # (grant_xp=False인 배치고사는 미갱신 — xp_total 0 유지)
    if log.session_id is not None and grant_xp:
        await db.execute(
            update(Session)
            .where(Session.id == log.session_id)
            .values(xp_total=Session.xp_total + xp_earned)
        )

    await db.flush()

    # 피드백: board는 규칙 explain/hints로 구성(RAG 미호출 — §3.4),
    # 그 외 유형은 RAG Chain (실패 시 ai_client 내부 정적 문구 fallback)
    if is_board:
        feedback = board_engine.select_feedback(
            question, phenomena or [], is_correct, board_rules or []
        )
    else:
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
        phenomena=phenomena,
    )

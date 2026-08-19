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
from typing import Any, Callable, Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.schemas.quiz import AnswerResult
from app.services import (
    ai_client,
    board_engine,
    tone_text,
    weatherbrain_service,
    xp_service,
)
from app.services.weather_api import get_today_weather, user_region

# 슬라이더 채점 허용 오차 (0~100 스케일)
SLIDER_TOLERANCE = 10.0

Grader = Callable[[dict[str, Any], str], bool]


class AlreadyAnsweredError(Exception):
    """이미 답안이 제출된 quiz_log에 대한 재제출 (라우터에서 409 ALREADY_ANSWERED 변환)."""


class BoardStateRequiredError(Exception):
    """board 유형인데 board_state 누락 (라우터에서 422 BOARD_STATE_REQUIRED 변환)."""


class QuizNotInSessionError(Exception):
    """세션 로그에 없는 quiz_id 제출 (라우터에서 404 QUIZ_NOT_FOUND 변환)."""


def is_retry_eligible(log: QuizLog) -> bool:
    """만회 라운드(R13-01 §2.1) 재제출 대상인가 — 순수 판정.

    **최초 채점이 오답이고 아직 만회로 해결되지 않은** 문항만 다시 풀 수 있다.
    미응답(is_correct=None)·최초 정답·이미 만회 성공(retry_correct=True)은 전부
    False라서 기존 경로를 그대로 탄다 — 만회는 멱등 의미론의 **예외 1개**이지
    재제출 전면 허용이 아니다. "같은 세션" 조건은 호출측(세션 라우터가
    session_id로 로그를 조회)이 구조적으로 보장한다.
    """
    return log.is_correct is False and log.retry_correct is not True


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


async def build_feedback(
    db: AsyncSession,
    user: User,
    question: dict[str, Any],
    answer: str,
    is_correct: bool,
    concept_tag: str,
    phenomena: list[dict[str, Any]] | None,
    board_rules: list[dict[str, Any]] | None,
) -> str:
    """채점 결과 → 피드백 문자열 — 최초 제출·만회 재제출 공용 (R13-01 §2.1).

    우선순위 3단 (CO-I-1에서 ②가 신설됐다):
      ① board  → 규칙 explain/hints (RAG 미호출 — §3.4). board 판정 여부는
         phenomena 유무가 아니라 question_type으로 본다(판정이 비어도 board다).
      ② **사람이 저작한 해설**(`template_json.explanation_hint`) → 반환.
         ⚠️ **초등(`effective_tone(user) == "child"`)에서만** 문말이 부드러운
         설명체로 바뀐다(MT-11 — `tone_text.soften_for_tone`). 그 외 톤은 원문
         바이트 그대로이고, 변환 불가 문장이 하나라도 있으면 초등도 원문이다.
      ③ 그 외 → RAG Chain(실패 시 ai_client 내부 정적 문구 fallback).

    ②를 넣은 이유(CO-I-1 — 대장 I절 "최대 건"):
    본시드 272건 중 **193건에 해설이 저작돼 있는데 소비자가 개발용 목 하나뿐**이었다
    (2026-08-09 실측. 배선 당시 표기는 237중 158이었고 그 뒤 저작 배치로 자랐다).
    답안마다 ③이 무조건 나가서, 이미 저작된 해설이 있는 문항에도 **매 답안 유료 1콜**을
    지불했다(CLAUDE.md가 "상시 과금 지점"으로 지목한 바로 그 자리).

    왜 ②가 ③보다 **앞**인가 — 셋 다 근거가 같은 방향을 가리킨다:
    - **비용**: 비board 238건 중 193건(81%)에서 상시 과금 지점이 사라진다. 남는 호출은
      해설이 없는 45건과 생성 문항뿐이다. (건수의 소유자는 시드다 —
      `test_seed_contract.py::test_시드_증보_누적`이 총량을 고정한다.)
    - **무키 실운영(8/11~18)**: ③은 키가 없으면 문항과 무관한 정적 일반 문구
      ("아쉽지만 괜찮아요…")로 떨어진다. 문항별 해설은 그보다 **엄격히 낫다**.
    - **정확성**: 2단 LLM 게이트는 "이 진술이 참인가"를 묻지 않는다(대장 O-10).
      사람이 저작한 해설은 그 검증을 이미 통과한 텍스트다.
    맞바꾼 것은 오답 피드백의 개인화(유저 답안·오늘 날씨 인용)다. 되돌리려면 이
    분기에 `if not is_correct` 한 줄을 더하면 정답에만 해설이 나간다.

    정답 공개 시점 계약은 바뀌지 않는다: 해설은 **채점 이후 피드백에만** 실린다.
    문항 발급 페이로드(`routers/session.QUESTION_PAYLOAD_FIELDS`)에서 여전히 제외되며
    (풀기 전에 보이면 정답 유도다), 그 미노출은
    tests/test_r10_question_payload_contract.py가 계속 강제한다.
    """
    if question.get("question_type") == "board":
        return board_engine.select_feedback(
            question, phenomena or [], is_correct, board_rules or []
        )
    hint = str(question.get("explanation_hint") or "").strip()
    if hint:
        # MT-11 — `effective_tone`의 **첫 소비처**. 그 전까지 톤은 파생·노출만 되고
        # 아무도 읽지 않았다(조사 §1.4). child가 아니면 tone_text가 입력을 그대로
        # 돌려주므로 다른 학령의 문구는 한 글자도 안 바뀐다.
        return tone_text.soften_for_tone(
            hint, weatherbrain_service.effective_tone(user)
        )
    # RAG 피드백의 오늘 날씨도 유저 지역 기준 (R11-01 §8.2 — NULL=서울)
    today_weather = await get_today_weather(user_region(user))
    return await ai_client.rag_feedback(
        question_text=question.get("question_text", ""),
        user_answer=answer,
        is_correct=is_correct,
        concept_tag=concept_tag,
        today_weather=today_weather,
    )


def feedback_source(question: dict) -> str:
    """`build_feedback`이 어느 갈래를 탈지 **미리** 말한다 (순수 함수).

    같은 우선순위를 두 번 적으면 갈라진다 — 그래서 분기 조건만 여기 모으고
    `build_feedback`은 텍스트를, 이 함수는 라벨을 낸다. 둘이 어긋나면
    `tests/test_feedback_source.py`가 잡는다.
    """
    if question.get("question_type") == "board":
        return "board"
    if str(question.get("explanation_hint") or "").strip():
        return "authored"
    return "ai"


async def submit_retry_for_log(
    db: AsyncSession, user: User, log: QuizLog, answer: str
) -> AnswerResult:
    """만회 라운드 재제출 (R13-01 §2.1) — 채점해 `retry_correct`에만 기록한다.

    최초 제출(submit_answer_for_log)과 **의도적으로 다른** 점:
    - `is_correct`·`user_answer`·`elapsed_sec`·`answered_at`을 덮지 않는다 —
      최초 정오 기록은 θ·통계의 근거다(§2.1 "불변 보존").
    - XP 0 (유저 XP·세션 xp_total 무가산) — 만회로 XP를 벌면 오답 후 재도전이
      최적 전략이 되어 파밍이 된다.
    - weak_tags·ContentItem 노출/정답 통계를 갱신하지 않는다 — 같은 문항의
      두 번째 풀이는 새 표본이 아니라 같은 표본의 재시도다.
    - 구름을 소모하지 않는다 — 소모 판정은 라우터의 `should_consume`이 하며
      만회는 `already_answered=True`라 구조적으로 0이다(만회는 벌이 아니다).

    채점 규칙·피드백 생성은 최초 제출과 완전히 동일한 GRADERS·build_feedback을
    쓴다 — 채점 권위는 서버 소유이고 만회라고 관대해지지 않는다.

    Raises:
        AlreadyAnsweredError: 만회 대상이 아닌 재제출(미응답·최초 정답·만회 완료).
    """
    if not is_retry_eligible(log):
        raise AlreadyAnsweredError(f"quiz_id={log.quiz_id}")

    question = log.question_json or {}
    phenomena: list[dict[str, Any]] | None = None
    board_rules: list[dict[str, Any]] | None = None
    if question.get("question_type") == "board":
        phenomena, is_correct, board_rules = evaluate_board_answer(
            question, json.loads(answer)
        )
    else:
        is_correct = grade(question, answer)

    log.retry_correct = is_correct
    await db.flush()

    feedback = await build_feedback(
        db, user, question, answer, is_correct, log.concept_tag,
        phenomena, board_rules,
    )
    return AnswerResult(
        is_correct=is_correct,
        correct_answer=str(question.get("correct_answer", "")),
        feedback=feedback,
        feedback_source=feedback_source(question),
        xp_earned=0,
        xp_base=0,
        xp_weak_bonus=0,
        concept_tag=log.concept_tag,
        phenomena=phenomena,
    )


async def submit_answer_for_log(
    db: AsyncSession,
    user: User,
    log: QuizLog,
    answer: str,
    elapsed_sec: int | None,
    grant_xp: bool = True,
) -> AnswerResult:
    """미응답 quiz_log 1건에 대한 답안 처리 전체 흐름.

    멱등 가드 → 채점 → 약점 판정(θ 파생, R8-01 §3.5 — 07번 약점 극복 보너스) →
    XP 가산 → weak_tags 갱신 → 로그 확정 → 뱅크 통계·세션 XP 원자 가산 →
    피드백(board는 규칙 explain/hints, 그 외 RAG). 404 검증은 라우터가 담당한다.

    board 유형(§3.4): answer에 board_state JSON을 담아 전달한다. 엔진으로
    phenomena를 산출해 결과에 싣고, 피드백은 RAG 없이 규칙에서 구성한다.

    grant_xp=False(R7-01 §3.3 배치고사): XP를 계산·가산하지 않는다(xp_earned=0
    이며 분해값 xp_base·xp_weak_bonus도 0 — 합 계약 유지,
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

    # 약점 여부는 θ 파생 단일 공급원 (R8-01 §3.5). refresh_abilities 호출 금지 —
    # 저장된 θ를 read-only(load_abilities)로만 읽는다. θ는 세션 발급 시점의
    # refresh_abilities가 영속화한 스냅샷이라 세션 안에서 변하지 않으므로,
    # 문항별로 약점 판정이 뒤집히던 구 weak_tags(매 답안 갱신) 동작이 사라진다
    # — 계약이 수용한 행동 변화.
    xp_earned = 0
    xp_base, xp_weak_bonus = 0, 0
    if grant_xp:
        abilities = await weatherbrain_service.load_abilities(db, user)
        is_weak = concept_tag in weatherbrain_service.weak_concepts(
            abilities, user.level_group
        )
        # XP 계산 (문항당 1회 제출 → 정답이면 곧 첫 시도 정답 보너스 대상).
        # 분해값을 함께 실어 보낸다 (R10-01 §3.5 마감 3) — 프론트가 "약점 극복
        # +N"을 상수 사본으로 역산하지 않게. 합이 xp_earned와 같은 것이 계약이라
        # 가산·세션 누적은 분해 이전과 동일한 단일 금액을 쓴다.
        xp_base, xp_weak_bonus = xp_service.quiz_xp_breakdown(
            is_correct, is_first_try=True, is_weak=is_weak
        )
        xp_earned = xp_base + xp_weak_bonus

    # weak_tags 갱신 + 유저 XP 가산 + 로그 확정
    await xp_service.update_weak_tag(db, user.id, concept_tag, is_correct)
    if grant_xp:
        await xp_service.add_xp(db, user.id, xp_earned)

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

    # 피드백: board는 규칙 explain/hints, 그 외는 RAG — 만회 경로와 공용
    # (build_feedback, R13-01 §2.1). 두 경로가 같은 문구 규칙을 쓰는 것이 계약이다.
    feedback = await build_feedback(
        db, user, question, answer, is_correct, concept_tag, phenomena, board_rules
    )

    return AnswerResult(
        is_correct=is_correct,
        correct_answer=str(question.get("correct_answer", "")),
        feedback=feedback,
        feedback_source=feedback_source(question),
        xp_earned=xp_earned,
        xp_base=xp_base,
        xp_weak_bonus=xp_weak_bonus,
        concept_tag=concept_tag,
        phenomena=phenomena,
    )


async def submit_answers_bulk(
    db: AsyncSession,
    user: User,
    logs: Sequence[QuizLog],
    answers: Sequence[tuple[str, str, int | None]],
) -> list[tuple[str, bool]]:
    """미채점 로그 일괄 채점 — 배치고사 submit-all (R7-02 §3.1).

    submit_answer_for_log에서 채점 코어만 남긴 순수 루프: GRADERS 채점 →
    weak_tags 갱신 → 로그 확정 → 뱅크 통계 원자 UPDATE(기존 answer 경로와
    동일 패턴). 채점 지연의 원인이던 문항별 RAG 피드백(외부 동기 대기)과
    XP·세션 xp_total 가산은 수행하지 않는다 — placement는 원래 grant_xp=False
    계약(§3.3)이고 진단 UX에 문항별 해설이 필요 없다. 에너지·스트릭·퀘스트도
    없음(placement 계약 유지). 채점은 서버가 GRADERS로 재계산 — 클라이언트가
    결과를 주입할 통로 없음(채점 권위 서버 소유).

    answers: (quiz_id, answer, elapsed_sec) 시퀀스. 이미 채점된 로그는 멱등
    스킵하고 기존 is_correct를 결과에 싣는다(재진입 시 전체 409로 죽이지 않음 —
    같은 요청 안의 중복 quiz_id도 두 번째부터 같은 가드에 걸린다).

    board 유형은 다루지 않는다 — placement 풀이 구조적으로 제외한다
    (placement_service._placement_pool). 반환: [(quiz_id, is_correct)] 제출 순.

    Raises:
        QuizNotInSessionError: logs에 없는 quiz_id 제출.
    """
    by_quiz_id = {log.quiz_id: log for log in logs}
    now = datetime.now(timezone.utc)

    results: list[tuple[str, bool]] = []
    for quiz_id, answer, elapsed_sec in answers:
        log = by_quiz_id.get(quiz_id)
        if log is None:
            raise QuizNotInSessionError(f"quiz_id={quiz_id}")

        # 멱등 스킵 — 이미 채점된 로그는 부수효과 없이 기존 결과만 보고
        if log.user_answer is not None or log.is_correct is not None:
            results.append((quiz_id, bool(log.is_correct)))
            continue

        question = log.question_json or {}
        is_correct = grade(question, answer)

        # weak_tags 갱신 + 로그 확정 — 진단 응답도 실제 학습 데이터 (§3.3)
        await xp_service.update_weak_tag(db, user.id, log.concept_tag, is_correct)
        log.user_answer = answer
        log.is_correct = is_correct
        log.elapsed_sec = elapsed_sec
        log.answered_at = now

        # 뱅크 문항 노출·정답 통계 — 원자 UPDATE (submit_answer_for_log 동일)
        if log.content_item_id is not None:
            await db.execute(
                update(ContentItem)
                .where(ContentItem.id == log.content_item_id)
                .values(
                    stat_total=ContentItem.stat_total + 1,
                    stat_correct=ContentItem.stat_correct + (1 if is_correct else 0),
                )
            )

        results.append((quiz_id, is_correct))

    await db.flush()
    return results

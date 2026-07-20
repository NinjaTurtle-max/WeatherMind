"""Validate Chain — 스프린트 R2-01 §3.4 품질 게이트 (스토리 S4).

생성/저작 문항이 문항 뱅크(content_items)에 들어가기 전에 통과해야 하는
2단 검증 체인. 요청/응답 계약은 SPRINT_R2_01.md §3.4에 고정되어 있다.

검증 항목 표:

| 단계 | name                  | 대상 question_type | 기준                                              |
|------|-----------------------|--------------------|---------------------------------------------------|
| 1단  | required_fields       | 전체               | question_text·question_type·correct_answer 존재, 허용 type, 객관식은 options 존재 |
| 1단  | options_count         | multiple_choice    | options가 정확히 4개                              |
| 1단  | options_unique        | multiple_choice    | 보기 간 중복 없음                                 |
| 1단  | answer_in_options     | multiple_choice    | correct_answer가 options에 포함                   |
| 1단  | slider_range          | slider             | 정답이 0~100 범위의 숫자(숫자 문자열 허용)        |
| 1단  | question_length       | 전체               | question_text 10~300자                            |
| 2단  | llm_answer_uniqueness | 전체               | 정답이 유일하게 옳은가 (Gemini 판정)              |
| 2단  | llm_option_clarity    | 전체               | 보기가 모호하지 않은가 (비객관식은 통과)          |
| 2단  | llm_concept_match     | 전체               | 문항이 concept_tag 개념에 부합하는가              |
| 2단  | llm_skipped           | -                  | 2단 미실행 시 대체 표기 (항상 passed=true)        |

2단 구조를 택한 이유 (TEAM_PROCESS.md §1.4 적용):
- 1단 휴리스틱은 LLM·외부 의존성 없이 결정적으로 동작한다. GEMINI_API_KEY가
  없는 개발/CI 환경에서도 품질 게이트와 골든셋 회귀 테스트가 항상 실행 가능하다.
- 2단 LLM(Gemini)은 휴리스틱으로 잡을 수 없는 의미 수준 결함(정답 유일성,
  보기 모호성, concept_tag 부합)을 판정한다. 키 부재·호출 실패 시 예외를 내지
  않고 1단 결과만으로 응답하며, checks에 "llm_skipped"를 남겨 관측 가능하게 한다.
- 1단 실패 문항은 2단을 호출하지 않는다(비용·지연 예산 절감 — 어차피 반려됨).
- passed = 모든 1단 체크 통과 AND (2단 실행 시 2단도 전부 통과).

해당 없는 체크(예: 주관식의 options_count)는 passed=true + "해당 없음" 사유로
항상 checks에 포함시켜, 응답 배열 구성이 결정적이도록 유지한다(가드레일·회귀 용이).

주의: LLM 관련 임포트(langchain*)는 run_llm_checks 내부에서 지연 임포트한다.
LLM 의존성이 설치되지 않은 환경에서도 1단 휴리스틱·골든셋 테스트가
모듈 임포트 실패 없이 동작해야 하기 때문이다.
"""

from __future__ import annotations

import json
import logging
import re

from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

# ── 휴리스틱 기준값 (§3.4 고정 계약) ──────────────────────────────────────
ALLOWED_QUESTION_TYPES = ("multiple_choice", "short_answer", "slider")
OPTION_COUNT = 4
SLIDER_MIN, SLIDER_MAX = 0, 100
QUESTION_TEXT_MIN, QUESTION_TEXT_MAX = 10, 300

# ── 2단 LLM System Prompt ─────────────────────────────────────────────────
# v1 (2026-07-19): 최초 작성 — 정답 유일성·보기 모호성·concept_tag 부합
#   3항목을 JSON으로 판정. 출력 스키마 강제 문구는 quiz_gen_chain 관례를 따름.
VALIDATE_SYSTEM_PROMPT = """당신은 대한민국 초·중·고등학생과 일반 성인을 위한 기상·기후 교육 퀴즈의 품질 검수 AI입니다.
아래 퀴즈 1문항을 검토해 세 가지 항목을 각각 판정하세요.

판정 항목:
1. answer_uniqueness: correct_answer가 유일하게 옳은 답인가
   (다른 보기나 다른 해석도 정답이 될 수 있으면 false)
2. option_clarity: 보기(options)가 서로 명확히 구분되고 모호하지 않은가
   (객관식이 아니면 true)
3. concept_match: 문항 내용이 주어진 concept_tag 개념에 부합하는가

규칙:
1. level_group 눈높이(elementary=초등, middle_high=중고등, adult=성인)를 감안해 판정할 것
2. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.

출력 스키마:
{
  "answer_uniqueness": {"passed": true|false, "reason": "<한 문장 근거>"},
  "option_clarity": {"passed": true|false, "reason": "<한 문장 근거>"},
  "concept_match": {"passed": true|false, "reason": "<한 문장 근거>"}
}"""

# 2단 판정 항목명 → 응답 checks name 매핑 (순서 고정)
_LLM_CHECK_NAMES = (
    ("answer_uniqueness", "llm_answer_uniqueness"),
    ("option_clarity", "llm_option_clarity"),
    ("concept_match", "llm_concept_match"),
)


# ── 2단 LLM 출력 스키마 (Pydantic 가드레일) ───────────────────────────────
class _LLMJudgement(BaseModel):
    passed: bool
    reason: str


class LLMValidationResult(BaseModel):
    answer_uniqueness: _LLMJudgement
    option_clarity: _LLMJudgement
    concept_match: _LLMJudgement


def _check(name: str, passed: bool, reason: str) -> dict:
    """계약 §3.4의 단일 체크 결과 형태."""
    return {"name": name, "passed": passed, "reason": reason}


# ── 1단 휴리스틱 (LLM 불필요, 결정적) ─────────────────────────────────────
def run_heuristic_checks(question: dict) -> list[dict]:
    """template_json 형식 문항에 대해 1단 휴리스틱 체크 목록을 반환한다.

    모든 체크는 {"name", "passed", "reason"} dict이며, 해당 없는 체크도
    passed=true("해당 없음")로 포함해 배열 구성을 결정적으로 유지한다.
    """
    checks: list[dict] = []

    question_type = question.get("question_type")
    question_text = question.get("question_text")
    options = question.get("options")
    correct_answer = question.get("correct_answer")
    is_mc = question_type == "multiple_choice"
    is_slider = question_type == "slider"

    # 1. required_fields — 필수 필드 존재 + question_type 허용값
    missing = [
        key
        for key, value in (
            ("question_text", question_text),
            ("question_type", question_type),
            ("correct_answer", correct_answer),
        )
        if value is None or (isinstance(value, str) and not value.strip())
    ]
    if is_mc and not options:
        missing.append("options")
    if question_type is not None and question_type not in ALLOWED_QUESTION_TYPES:
        checks.append(
            _check(
                "required_fields",
                False,
                f"question_type이 허용값({', '.join(ALLOWED_QUESTION_TYPES)})이 아님: {question_type}",
            )
        )
    elif missing:
        checks.append(
            _check("required_fields", False, f"필수 필드 누락: {', '.join(missing)}")
        )
    else:
        checks.append(_check("required_fields", True, "필수 필드 모두 존재"))

    # 2. options_count — 객관식 보기 4개
    if not is_mc:
        checks.append(
            _check("options_count", True, f"해당 없음 (question_type={question_type})")
        )
    elif not isinstance(options, list):
        checks.append(_check("options_count", False, "options가 리스트가 아니거나 없음"))
    elif len(options) != OPTION_COUNT:
        checks.append(
            _check(
                "options_count",
                False,
                f"options는 {OPTION_COUNT}개여야 함 (현재 {len(options)}개)",
            )
        )
    else:
        checks.append(_check("options_count", True, f"options {OPTION_COUNT}개 확인"))

    # 3. options_unique — 보기 중복 없음
    if not is_mc:
        checks.append(
            _check("options_unique", True, f"해당 없음 (question_type={question_type})")
        )
    elif not isinstance(options, list):
        checks.append(_check("options_unique", False, "options가 리스트가 아니거나 없음"))
    else:
        normalized = [str(o).strip() for o in options]
        duplicates = sorted({o for o in normalized if normalized.count(o) > 1})
        if duplicates:
            checks.append(
                _check(
                    "options_unique", False, f"중복 보기 존재: {', '.join(duplicates)}"
                )
            )
        else:
            checks.append(_check("options_unique", True, "보기 중복 없음"))

    # 4. answer_in_options — 객관식 정답이 보기에 포함
    if not is_mc:
        checks.append(
            _check(
                "answer_in_options", True, f"해당 없음 (question_type={question_type})"
            )
        )
    elif not isinstance(options, list) or correct_answer is None:
        checks.append(
            _check("answer_in_options", False, "options 또는 correct_answer 없음")
        )
    elif str(correct_answer).strip() not in [str(o).strip() for o in options]:
        checks.append(
            _check(
                "answer_in_options",
                False,
                f"correct_answer가 options에 없음: {correct_answer}",
            )
        )
    else:
        checks.append(_check("answer_in_options", True, "정답이 보기에 포함됨"))

    # 5. slider_range — 슬라이더 정답 0~100 숫자 (§3.3: 숫자 문자열 허용)
    if not is_slider:
        checks.append(
            _check("slider_range", True, f"해당 없음 (question_type={question_type})")
        )
    else:
        try:
            value = float(str(correct_answer).strip())
        except (TypeError, ValueError):
            checks.append(
                _check(
                    "slider_range",
                    False,
                    f"슬라이더 정답이 숫자가 아님: {correct_answer}",
                )
            )
        else:
            if SLIDER_MIN <= value <= SLIDER_MAX:
                checks.append(
                    _check(
                        "slider_range",
                        True,
                        f"정답 {value:g}이(가) {SLIDER_MIN}~{SLIDER_MAX} 범위 내",
                    )
                )
            else:
                checks.append(
                    _check(
                        "slider_range",
                        False,
                        f"슬라이더 정답이 {SLIDER_MIN}~{SLIDER_MAX} 범위를 벗어남: {value:g}",
                    )
                )

    # 6. question_length — 질문 길이 10~300자
    if not isinstance(question_text, str):
        checks.append(_check("question_length", False, "question_text가 문자열이 아니거나 없음"))
    else:
        length = len(question_text.strip())
        if QUESTION_TEXT_MIN <= length <= QUESTION_TEXT_MAX:
            checks.append(
                _check("question_length", True, f"질문 길이 {length}자 (기준 내)")
            )
        else:
            checks.append(
                _check(
                    "question_length",
                    False,
                    f"질문 길이 {length}자 — {QUESTION_TEXT_MIN}~{QUESTION_TEXT_MAX}자 범위를 벗어남",
                )
            )

    return checks


# ── 2단 LLM 검증 (Gemini, 키 있을 때만) ───────────────────────────────────
def _parse_llm_output(raw: str) -> LLMValidationResult:
    """모델 출력에서 JSON을 추출해 Pydantic으로 검증한다 (quiz_gen_chain 관례)."""
    text = raw.strip()
    # 마크다운 코드펜스 제거
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    # 앞뒤 설명 텍스트가 섞인 경우 첫 '{' ~ 마지막 '}' 구간만 사용
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        text = text[start : end + 1]
    return LLMValidationResult(**json.loads(text))


def run_llm_checks(question: dict, concept_tag: str, level_group: str) -> list[dict]:
    """Gemini로 정답 유일성·보기 모호성·concept_tag 부합을 판정한다.

    1차 시도(temperature 0.2) → 파싱/검증 실패 시 temperature 0.0으로 1회 재시도
    → 2회 연속 실패 시 예외를 올린다 (호출부가 llm_skipped로 폴백).
    """
    # LLM 의존성 부재 환경에서도 1단이 동작하도록 지연 임포트 (모듈 docstring 참고)
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.runnables import RunnableLambda
    from langchain_google_genai import ChatGoogleGenerativeAI

    def _build_messages(inputs: dict) -> list:
        payload = {
            "question": inputs["question"],
            "concept_tag": inputs["concept_tag"],
            "level_group": inputs["level_group"],
        }
        human_text = (
            f"검수 대상: {json.dumps(payload, ensure_ascii=False)}\n출력:"
        )
        return [
            SystemMessage(content=VALIDATE_SYSTEM_PROMPT),
            HumanMessage(content=human_text),
        ]

    inputs = {
        "question": question,
        "concept_tag": concept_tag,
        "level_group": level_group,
    }

    result: LLMValidationResult | None = None
    last_error: Exception | None = None
    for attempt, temperature in enumerate((0.2, 0.0), start=1):
        try:
            llm = ChatGoogleGenerativeAI(
                model=settings.GEMINI_MODEL,
                google_api_key=settings.GEMINI_API_KEY,
                temperature=temperature,
            )
            chain = RunnableLambda(_build_messages) | llm | StrOutputParser()
            result = _parse_llm_output(chain.invoke(inputs))
            break
        except Exception as exc:  # LLM 장애, JSON 파싱, Pydantic 검증 실패 모두 포함
            last_error = exc
            logger.warning("llm validation attempt %d failed: %s", attempt, exc)

    if result is None:
        raise RuntimeError(f"LLM 검증 2회 연속 실패: {last_error}")

    dumped = result.model_dump()
    return [
        _check(check_name, dumped[field]["passed"], dumped[field]["reason"])
        for field, check_name in _LLM_CHECK_NAMES
    ]


# ── 진입점 ─────────────────────────────────────────────────────────────────
def validate_quiz(question: dict, concept_tag: str, level_group: str) -> dict:
    """문항 1건을 2단 검증하고 계약 §3.4 응답 형태로 반환한다.

    Returns:
        {"passed": bool, "checks": [{"name", "passed", "reason"}, ...]}
    """
    checks = run_heuristic_checks(question)
    heuristic_passed = all(c["passed"] for c in checks)

    if not heuristic_passed:
        checks.append(
            _check("llm_skipped", True, "1단 휴리스틱 실패로 2단 LLM 검증 생략")
        )
    elif not settings.GEMINI_API_KEY:
        checks.append(
            _check("llm_skipped", True, "GEMINI_API_KEY 부재로 2단 LLM 검증 생략")
        )
    else:
        try:
            checks.extend(run_llm_checks(question, concept_tag, level_group))
        except Exception as exc:
            logger.warning("llm validation skipped after failures: %s", exc)
            checks.append(
                _check("llm_skipped", True, f"LLM 호출 실패로 2단 검증 생략: {exc}")
            )

    return {"passed": all(c["passed"] for c in checks), "checks": checks}

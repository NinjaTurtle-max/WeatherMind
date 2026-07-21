"""Validate Chain — 품질 게이트 (R2-01 §3.4 + R3-01 §3.7 확장, 스토리 R3-S8).

생성/저작 문항이 문항 뱅크(content_items)에 들어가기 전에 통과해야 하는
2단 검증 체인. 요청/응답 계약은 SPRINT_R2_01.md §3.4에 고정되어 있고,
SPRINT_R3_01.md §3.3·§3.6·§3.7이 신규 4유형(board/match/ordering/cloze)
검증을 추가한다.

검증 항목 표:

| 단계 | name                  | 대상 question_type | 기준                                              |
|------|-----------------------|--------------------|---------------------------------------------------|
| 1단  | required_fields       | 전체               | question_text·question_type·correct_answer 존재(§3.3-R3: board는 correct_answer 면제 — 빈 문자열 허용), 허용 type 7종, 객관식은 options 존재 |
| 1단  | options_count         | multiple_choice    | options가 정확히 4개                              |
| 1단  | options_unique        | multiple_choice    | 보기 간 중복 없음                                 |
| 1단  | answer_in_options     | multiple_choice    | correct_answer가 options에 포함                   |
| 1단  | slider_range          | slider             | 정답이 0~100 범위의 숫자(숫자 문자열 허용)        |
| 1단  | question_length       | 전체               | question_text 10~300자                            |
| 1단  | board_initial_state   | board              | §3.1 스키마 유효 — 요소 type·subtype enum, 존 0~3, 존당 기단/전선 최대 1, moisture/sun 수치 0~100 |
| 1단  | board_goal_conditions | board              | 비어있지 않음, 각 항목 zone 0~3·phenomenon이 §3.2 enum 내 |
| 1단  | board_palette         | board              | palette 비어있지 않음                              |
| 1단  | board_guide_steps     | board              | mode가 guided 또는 goal_only, guided면 guide_steps 존재 |
| 1단  | match_pairs           | match              | pairs 3~4쌍, 각 쌍 left/right 존재, left·right 각각 중복 없음 |
| 1단  | ordering_items        | ordering           | items 3~5개, 중복 없음                             |
| 1단  | cloze_blank           | cloze              | question_text에 빈칸("___") 정확히 1곳             |
| 1단  | board_time_limit      | board              | §3.6-R4 미니 미션: time_limit_sec 있으면 60~120 정수(없으면 선택 필드 통과) |
| 1단  | board_based_on        | board              | §3.6-R4 재현 퍼즐: based_on 있으면 event_name·event_date·region 3필드 + concept_tag가 anomaly(없으면 선택 필드 통과) |
| 2단  | llm_answer_uniqueness | 기존 3유형         | 정답이 유일하게 옳은가 (Gemini 판정, 신규 4유형은 "해당 없음" 통과) |
| 2단  | llm_option_clarity    | 기존 3유형         | 보기가 모호하지 않은가 (비객관식·신규 4유형은 통과) |
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

# ── 휴리스틱 기준값 (§3.4-R2 + §3.7-R3 고정 계약) ─────────────────────────
ALLOWED_QUESTION_TYPES = (
    "multiple_choice",
    "short_answer",
    "slider",
    "board",
    "match",
    "ordering",
    "cloze",
)
# R3 신규 4유형 — LLM 2단은 concept_match만 적용 (§3.7)
NEW_R3_QUESTION_TYPES = ("board", "match", "ordering", "cloze")
OPTION_COUNT = 4
SLIDER_MIN, SLIDER_MAX = 0, 100
QUESTION_TEXT_MIN, QUESTION_TEXT_MAX = 10, 300

# ── board 기준값 (§3.1·§3.2·§3.3) ─────────────────────────────────────────
BOARD_ZONE_MIN, BOARD_ZONE_MAX = 0, 3  # 한반도 단면 4존 (index 0~3 고정)
BOARD_LEVEL_MIN, BOARD_LEVEL_MAX = 0, 100  # moisture/sun 수치
BOARD_ELEMENT_SUBTYPES = {
    "air_mass": ("siberian", "north_pacific", "yangtze", "okhotsk"),
    "front": ("cold", "warm", "stationary"),
}
BOARD_LEVEL_TYPES = ("moisture", "sun")
# 존당 최대 1개 제약 대상 (§3.1: 존당 기단 최대 1, 전선 최대 1)
BOARD_PER_ZONE_UNIQUE_TYPES = ("air_mass", "front")
PHENOMENON_ENUM = (
    "shower",
    "rain",
    "persistent_rain",
    "snow",
    "fog",
    "heatwave",
    "clear",
    "cloudy",
)
BOARD_MODES = ("guided", "goal_only")

# ── match/ordering/cloze 기준값 (§3.6) ────────────────────────────────────
MATCH_PAIRS_MIN, MATCH_PAIRS_MAX = 3, 4
ORDERING_ITEMS_MIN, ORDERING_ITEMS_MAX = 3, 5
# 빈칸 = 밑줄 3개 이상 연속 1런. "____"(4개)도 빈칸 1곳으로 세어
# 저작 시 밑줄 개수 흔들림에 관대하되, 빈칸 위치는 정확히 1곳만 허용한다.
CLOZE_BLANK_PATTERN = re.compile(r"_{3,}")

# ── R4-S6 미니 미션·재현 퍼즐 기준값 (§3.5·§3.6) ──────────────────────────
# board template_json의 선택 필드. 부재 시 "해당 없음" 통과, 존재 시 값 검증.
TIME_LIMIT_MIN, TIME_LIMIT_MAX = 60, 120  # 미니 미션 카운트다운 초
BASED_ON_FIELDS = ("event_name", "event_date", "region")  # 재현 퍼즐 필수 3필드
BASED_ON_REQUIRED_CONCEPT = "anomaly"  # 재현 퍼즐은 anomaly 태그 필수 (§3.5)

# ── 2단 LLM System Prompt ─────────────────────────────────────────────────
# v1 (2026-07-19): 최초 작성 — 정답 유일성·보기 모호성·concept_tag 부합
#   3항목을 JSON으로 판정. 출력 스키마 강제 문구는 quiz_gen_chain 관례를 따름.
# v2 (2026-07-20, R3-S8 §3.7): 신규 4유형(board/match/ordering/cloze) 안내 추가.
#   신규 유형은 concept_match만 실제 판정 대상 — answer_uniqueness·option_clarity는
#   true로 반환하게 지시하고, 코드에서도 "해당 없음"으로 확정 덮어쓴다(이중 가드).
#   문항 형식(스키마) 판정은 1단 휴리스틱 소관이므로 LLM에게 요구하지 않는다.
VALIDATE_SYSTEM_PROMPT = """당신은 대한민국 초·중·고등학생과 일반 성인을 위한 기상·기후 교육 퀴즈의 품질 검수 AI입니다.
아래 퀴즈 1문항을 검토해 세 가지 항목을 각각 판정하세요.

판정 항목:
1. answer_uniqueness: correct_answer가 유일하게 옳은 답인가
   (다른 보기나 다른 해석도 정답이 될 수 있으면 false)
2. option_clarity: 보기(options)가 서로 명확히 구분되고 모호하지 않은가
   (객관식이 아니면 true)
3. concept_match: 문항 내용이 주어진 concept_tag 개념에 부합하는가
   (board 유형은 question_text·goal_conditions·initial_state가 concept_tag 개념의
   대기현상 만들기에 부합하는지, match/ordering/cloze는 문항 내용 기준으로 판정)

규칙:
1. level_group 눈높이(elementary=초등, middle_high=중고등, adult=성인)를 감안해 판정할 것
2. question_type이 board·match·ordering·cloze면 concept_match만 실제로 판정하고,
   answer_uniqueness와 option_clarity는 true로 반환할 것 (형식 검증은 별도 단계 소관)
3. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.

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
def run_heuristic_checks(question: dict, concept_tag: str | None = None) -> list[dict]:
    """template_json 형식 문항에 대해 1단 휴리스틱 체크 목록을 반환한다.

    모든 체크는 {"name", "passed", "reason"} dict이며, 해당 없는 체크도
    passed=true("해당 없음")로 포함해 배열 구성을 결정적으로 유지한다.

    concept_tag는 §3.6-R4 재현 퍼즐(based_on) 체크에서 anomaly 태그 여부를
    판정하는 데 쓰인다. board가 아니거나 based_on이 없으면 사용되지 않는다.
    """
    checks: list[dict] = []

    question_type = question.get("question_type")
    question_text = question.get("question_text")
    options = question.get("options")
    correct_answer = question.get("correct_answer")
    is_mc = question_type == "multiple_choice"
    is_slider = question_type == "slider"
    is_board = question_type == "board"

    # 1. required_fields — 필수 필드 존재 + question_type 허용값(7종).
    #    §3.3-R3: board는 correct_answer 미사용(빈 문자열 허용)이므로 필수 검사 면제.
    required_pairs = [
        ("question_text", question_text),
        ("question_type", question_type),
    ]
    if not is_board:
        required_pairs.append(("correct_answer", correct_answer))
    missing = [
        key
        for key, value in required_pairs
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

    # ── R3-S8 §3.7 신규 4유형 체크 (7~13) ─────────────────────────────────
    # 기존과 동일 원칙: 해당 없는 유형은 passed=true("해당 없음")로 포함해
    # 배열 구성을 결정적으로 유지한다.
    not_applicable = f"해당 없음 (question_type={question_type})"

    # 7. board_initial_state — §3.1 스키마 유효
    if not is_board:
        checks.append(_check("board_initial_state", True, not_applicable))
    else:
        errors = _board_initial_state_errors(question.get("initial_state"))
        if errors:
            checks.append(
                _check("board_initial_state", False, "; ".join(errors))
            )
        else:
            checks.append(
                _check("board_initial_state", True, "initial_state §3.1 스키마 유효")
            )

    # 8. board_goal_conditions — 비어있지 않고 zone 0~3·phenomenon enum 내
    if not is_board:
        checks.append(_check("board_goal_conditions", True, not_applicable))
    else:
        goals = question.get("goal_conditions")
        if not isinstance(goals, list) or not goals:
            checks.append(
                _check(
                    "board_goal_conditions",
                    False,
                    "goal_conditions가 비어 있거나 리스트가 아님",
                )
            )
        else:
            errors = []
            for i, goal in enumerate(goals):
                if not isinstance(goal, dict):
                    errors.append(f"goal_conditions[{i}]이(가) 객체가 아님")
                    continue
                zone = goal.get("zone")
                if not _is_int(zone) or not (BOARD_ZONE_MIN <= zone <= BOARD_ZONE_MAX):
                    errors.append(
                        f"goal_conditions[{i}] zone이 {BOARD_ZONE_MIN}~{BOARD_ZONE_MAX}"
                        f" 범위의 정수가 아님: {zone}"
                    )
                phenomenon = goal.get("phenomenon")
                if phenomenon not in PHENOMENON_ENUM:
                    errors.append(
                        f"goal_conditions[{i}] phenomenon이 enum"
                        f"({', '.join(PHENOMENON_ENUM)}) 밖: {phenomenon}"
                    )
            if errors:
                checks.append(_check("board_goal_conditions", False, "; ".join(errors)))
            else:
                checks.append(
                    _check(
                        "board_goal_conditions",
                        True,
                        f"goal_conditions {len(goals)}건 유효",
                    )
                )

    # 9. board_palette — 비어있지 않음
    if not is_board:
        checks.append(_check("board_palette", True, not_applicable))
    else:
        palette = question.get("palette")
        if not isinstance(palette, list) or not palette:
            checks.append(
                _check("board_palette", False, "palette가 비어 있거나 리스트가 아님")
            )
        else:
            checks.append(_check("board_palette", True, f"palette {len(palette)}종"))

    # 10. board_guide_steps — mode enum + guided면 guide_steps 존재
    if not is_board:
        checks.append(_check("board_guide_steps", True, not_applicable))
    else:
        mode = question.get("mode")
        guide_steps = question.get("guide_steps")
        if mode not in BOARD_MODES:
            checks.append(
                _check(
                    "board_guide_steps",
                    False,
                    f"mode가 {'|'.join(BOARD_MODES)}이(가) 아님: {mode}",
                )
            )
        elif mode == "guided" and (
            not isinstance(guide_steps, list) or not guide_steps
        ):
            checks.append(
                _check(
                    "board_guide_steps",
                    False,
                    "mode=guided인데 guide_steps가 비어 있거나 없음",
                )
            )
        else:
            reason = (
                f"guided — guide_steps {len(guide_steps)}단계"
                if mode == "guided"
                else "goal_only — guide_steps 불필요"
            )
            checks.append(_check("board_guide_steps", True, reason))

    # 11. match_pairs — 3~4쌍, 각 쌍 left/right 존재, left·right 각각 중복 없음
    if question_type != "match":
        checks.append(_check("match_pairs", True, not_applicable))
    else:
        pairs = question.get("pairs")
        if not isinstance(pairs, list):
            checks.append(_check("match_pairs", False, "pairs가 리스트가 아니거나 없음"))
        elif not (MATCH_PAIRS_MIN <= len(pairs) <= MATCH_PAIRS_MAX):
            checks.append(
                _check(
                    "match_pairs",
                    False,
                    f"pairs는 {MATCH_PAIRS_MIN}~{MATCH_PAIRS_MAX}쌍이어야 함"
                    f" (현재 {len(pairs)}쌍)",
                )
            )
        else:
            errors = []
            lefts: list[str] = []
            rights: list[str] = []
            for i, pair in enumerate(pairs):
                if not isinstance(pair, dict):
                    errors.append(f"pairs[{i}]이(가) 객체가 아님")
                    continue
                for side, bucket in (("left", lefts), ("right", rights)):
                    value = pair.get(side)
                    if not isinstance(value, str) or not value.strip():
                        errors.append(f"pairs[{i}].{side}이(가) 비어 있거나 없음")
                    else:
                        bucket.append(value.strip())
            for side, bucket in (("left", lefts), ("right", rights)):
                duplicates = sorted({v for v in bucket if bucket.count(v) > 1})
                if duplicates:
                    errors.append(f"{side} 중복: {', '.join(duplicates)}")
            if errors:
                checks.append(_check("match_pairs", False, "; ".join(errors)))
            else:
                checks.append(
                    _check("match_pairs", True, f"pairs {len(pairs)}쌍, 중복 없음")
                )

    # 12. ordering_items — 3~5개, 중복 없음
    if question_type != "ordering":
        checks.append(_check("ordering_items", True, not_applicable))
    else:
        items = question.get("items")
        if not isinstance(items, list):
            checks.append(
                _check("ordering_items", False, "items가 리스트가 아니거나 없음")
            )
        elif not (ORDERING_ITEMS_MIN <= len(items) <= ORDERING_ITEMS_MAX):
            checks.append(
                _check(
                    "ordering_items",
                    False,
                    f"items는 {ORDERING_ITEMS_MIN}~{ORDERING_ITEMS_MAX}개여야 함"
                    f" (현재 {len(items)}개)",
                )
            )
        else:
            normalized = [str(item).strip() for item in items]
            duplicates = sorted({v for v in normalized if normalized.count(v) > 1})
            if duplicates:
                checks.append(
                    _check(
                        "ordering_items", False, f"items 중복: {', '.join(duplicates)}"
                    )
                )
            else:
                checks.append(
                    _check("ordering_items", True, f"items {len(items)}개, 중복 없음")
                )

    # 13. cloze_blank — question_text에 빈칸("___") 정확히 1곳
    if question_type != "cloze":
        checks.append(_check("cloze_blank", True, not_applicable))
    elif not isinstance(question_text, str):
        checks.append(
            _check("cloze_blank", False, "question_text가 문자열이 아니거나 없음")
        )
    else:
        blank_count = len(CLOZE_BLANK_PATTERN.findall(question_text))
        if blank_count == 1:
            checks.append(_check("cloze_blank", True, "빈칸('___') 정확히 1곳"))
        else:
            checks.append(
                _check(
                    "cloze_blank",
                    False,
                    f"빈칸('___')은 정확히 1곳이어야 함 (현재 {blank_count}곳)",
                )
            )

    # ── R4-S6 §3.6 미니 미션·재현 퍼즐 필드 (14~15) ───────────────────────
    # board template_json의 선택 필드. 부재 시 passed=true("해당 없음")로 포함해
    # 배열 구성을 결정적으로 유지하고, 존재 시에만 값 유효성을 검증한다.

    # 14. board_time_limit — time_limit_sec 있으면 60~120 정수 (미니 미션)
    if not is_board:
        checks.append(_check("board_time_limit", True, not_applicable))
    elif "time_limit_sec" not in question:
        checks.append(
            _check("board_time_limit", True, "time_limit_sec 없음 — 해당 없음 (선택 필드)")
        )
    else:
        time_limit = question.get("time_limit_sec")
        if not _is_int(time_limit) or not (
            TIME_LIMIT_MIN <= time_limit <= TIME_LIMIT_MAX
        ):
            checks.append(
                _check(
                    "board_time_limit",
                    False,
                    f"time_limit_sec은 {TIME_LIMIT_MIN}~{TIME_LIMIT_MAX}"
                    f" 범위의 정수여야 함: {time_limit}",
                )
            )
        else:
            checks.append(
                _check(
                    "board_time_limit", True, f"time_limit_sec {time_limit}초 (범위 내)"
                )
            )

    # 15. board_based_on — based_on 있으면 3필드 존재 + concept_tag=anomaly (재현 퍼즐)
    if not is_board:
        checks.append(_check("board_based_on", True, not_applicable))
    elif "based_on" not in question:
        checks.append(
            _check("board_based_on", True, "based_on 없음 — 해당 없음 (선택 필드)")
        )
    else:
        based_on = question.get("based_on")
        errors = []
        if not isinstance(based_on, dict):
            errors.append("based_on이 객체가 아님")
        else:
            for field in BASED_ON_FIELDS:
                value = based_on.get(field)
                if not isinstance(value, str) or not value.strip():
                    errors.append(f"based_on.{field}이(가) 비어 있거나 없음")
        if concept_tag != BASED_ON_REQUIRED_CONCEPT:
            errors.append(
                f"재현 퍼즐(based_on)은 concept_tag가"
                f" '{BASED_ON_REQUIRED_CONCEPT}'여야 함: {concept_tag}"
            )
        if errors:
            checks.append(_check("board_based_on", False, "; ".join(errors)))
        else:
            checks.append(
                _check(
                    "board_based_on",
                    True,
                    f"based_on 3필드 존재 + concept_tag={concept_tag}",
                )
            )

    return checks


# ── board §3.1 스키마 검증 헬퍼 ───────────────────────────────────────────
def _is_int(value) -> bool:
    """bool을 제외한 정수 여부 (True/False가 zone으로 오인되는 것 방지)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _board_initial_state_errors(state) -> list[str]:
    """initial_state의 §3.1 스키마 위반 사유 목록을 반환한다 (없으면 빈 리스트).

    검증 항목(§3.7): 요소 type·subtype enum, zone 0~3, 존당 기단/전선 최대 1,
    moisture/sun 수치 0~100. 잠금 표시("locked": true) 등 부가 키는 허용.
    goal_only 퍼즐의 빈 보드(elements: [])는 유효하다.
    """
    if not isinstance(state, dict):
        return ["initial_state가 객체가 아니거나 없음"]
    elements = state.get("elements")
    if not isinstance(elements, list):
        return ["initial_state.elements가 리스트가 아니거나 없음"]

    errors: list[str] = []
    per_zone_count: dict[tuple[int, str], int] = {}
    for i, element in enumerate(elements):
        if not isinstance(element, dict):
            errors.append(f"elements[{i}]이(가) 객체가 아님")
            continue
        etype = element.get("type")
        if etype not in (*BOARD_ELEMENT_SUBTYPES, *BOARD_LEVEL_TYPES):
            errors.append(f"elements[{i}] type이 허용값이 아님: {etype}")
            continue
        zone = element.get("zone")
        if not _is_int(zone) or not (BOARD_ZONE_MIN <= zone <= BOARD_ZONE_MAX):
            errors.append(
                f"elements[{i}] zone이 {BOARD_ZONE_MIN}~{BOARD_ZONE_MAX}"
                f" 범위의 정수가 아님: {zone}"
            )
        elif etype in BOARD_PER_ZONE_UNIQUE_TYPES:
            key = (zone, etype)
            per_zone_count[key] = per_zone_count.get(key, 0) + 1
        if etype in BOARD_ELEMENT_SUBTYPES:
            subtype = element.get("subtype")
            if subtype not in BOARD_ELEMENT_SUBTYPES[etype]:
                errors.append(
                    f"elements[{i}] {etype} subtype이 enum"
                    f"({', '.join(BOARD_ELEMENT_SUBTYPES[etype])}) 밖: {subtype}"
                )
        else:  # moisture | sun
            level = element.get("level")
            if not _is_number(level) or not (
                BOARD_LEVEL_MIN <= level <= BOARD_LEVEL_MAX
            ):
                errors.append(
                    f"elements[{i}] {etype} level이 {BOARD_LEVEL_MIN}~"
                    f"{BOARD_LEVEL_MAX} 범위의 숫자가 아님: {level}"
                )
    for (zone, etype), count in sorted(per_zone_count.items()):
        if count > 1:
            errors.append(f"존 {zone}에 {etype} {count}개 — 존당 최대 1개(§3.1)")
    return errors


# ── 2단 LLM 검증 (Gemini, 키 있을 때만) ───────────────────────────────────
def _llm_checks_from_result(
    result: LLMValidationResult, question_type: str | None
) -> list[dict]:
    """LLM 판정 결과를 계약 checks 배열로 변환한다 (순서 고정).

    §3.7-R3: 신규 4유형(board/match/ordering/cloze)은 concept_match만 적용 —
    answer_uniqueness·option_clarity는 LLM 출력과 무관하게 "해당 없음" 통과로
    확정한다(프롬프트 v2 지시 + 코드 이중 가드). LLM 없이 테스트 가능하도록
    순수 함수로 분리했다.
    """
    dumped = result.model_dump()
    checks = []
    for field, check_name in _LLM_CHECK_NAMES:
        if question_type in NEW_R3_QUESTION_TYPES and field != "concept_match":
            checks.append(
                _check(
                    check_name,
                    True,
                    f"해당 없음 (question_type={question_type} — §3.7 신규 유형은"
                    " concept_match만 적용)",
                )
            )
        else:
            checks.append(
                _check(check_name, dumped[field]["passed"], dumped[field]["reason"])
            )
    return checks


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

    return _llm_checks_from_result(result, question.get("question_type"))


# ── 진입점 ─────────────────────────────────────────────────────────────────
def validate_quiz(question: dict, concept_tag: str, level_group: str) -> dict:
    """문항 1건을 2단 검증하고 계약 §3.4 응답 형태로 반환한다.

    Returns:
        {"passed": bool, "checks": [{"name", "passed", "reason"}, ...]}
    """
    checks = run_heuristic_checks(question, concept_tag)
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

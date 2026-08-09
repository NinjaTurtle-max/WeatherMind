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
| 1단  | knowledge_level_vocabulary | 전체          | R13 3일차: 신고된 knowledge_level(1~N 정수)보다 늦게 도입되는 용어가 문항 어디에도 없어야 함 — `database/seed/level_vocabulary.json`의 `introduced_at`/`name_ok_from` 대조(docs/specs/12 §7.4). 미신고면 "해당 없음" 통과 |
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
from collections import Counter

from pydantic import BaseModel

from app.chains import knowledge_level as kl
from app.chains.json_output import extract_json_object
from app.config import llm_configured, settings

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
    # R13 재난 축 (CO-A3·CO-K4) — board_engine.PHENOMENA와 같은 집합이어야 한다.
    # 이 두 값이 없으면 재난 board 문항의 goal_conditions가 lint_seed_items ⑧에서
    # 전건 탈락한다(재난 보드가 clear를 목표로 삼던 상태를 끝낸 것이 그 확장이다).
    "wildfire_risk",
    "flood_risk",
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


def _dupes(values: list[str]) -> list[str]:
    """2회 이상 등장한 값 목록(정렬) — 중복 메시지 구성용."""
    return sorted(v for v, n in Counter(values).items() if n > 1)


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
        duplicates = _dupes(normalized)
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
            # 범위는 **문항 자신의 것**을 쓴다. 하드코딩 0~100은 슬라이더 척도가
            # 암묵적으로 0~100이던 최초 설계(03번 스펙)의 흔적인데, 제품은 항목별
            # 범위로 옮겨갔다(시드 0~40 m/s 등, `QUESTION_PAYLOAD_FIELDS["slider"]`).
            # 그대로 두면 계약 G를 통과한 넓은 범위 문항 — 예: 기압 900~1100 hPa,
            # 정답 1008 — 을 1차 게이트가 **오탈락**시킨다(실측 확인).
            # min/max가 없는 구형 문항은 종전대로 0~100을 가정한다.
            low = question.get("min", SLIDER_MIN)
            high = question.get("max", SLIDER_MAX)
            if not (_is_number(low) and _is_number(high)) or float(low) >= float(high):
                low, high = SLIDER_MIN, SLIDER_MAX
            low, high = float(low), float(high)
            if low <= value <= high:
                checks.append(
                    _check(
                        "slider_range",
                        True,
                        f"정답 {value:g}이(가) {low:g}~{high:g} 범위 내",
                    )
                )
            else:
                checks.append(
                    _check(
                        "slider_range",
                        False,
                        f"슬라이더 정답이 {low:g}~{high:g} 범위를 벗어남: {value:g}",
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
                duplicates = _dupes(bucket)
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
            duplicates = _dupes(normalized)
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

    # ── R13 3일차 §7.4 신고 단계 검증 (16) ────────────────────────────────
    # 16. knowledge_level_vocabulary — 신고 단계보다 늦게 도입되는 용어가 있으면 탈락.
    #
    # **신고를 그대로 믿지 않는다는 것이 요점이다.** 생성 프롬프트가 단계를 신고하게
    # 되면(스펙 03 §2 규칙 2·3) 그 신고는 LLM의 자기 판단이고, 검증 없이 받으면
    # "6단계 용어를 쓴 2단계 문항"이 뱅크에 그대로 들어간다 — docs/specs/12 §8.2가
    # 실측한 사고([58] 건조 단열 감률·[98] 위험반원이 `adult` 면제로 통과한 것)의
    # 생성판 재현이다. 대조는 결정적이므로 **키 없이도 돈다**(1차 게이트인 이유).
    #
    # 미신고(키 부재)는 "해당 없음" 통과다 — board_time_limit·board_based_on과 같은
    # 선택 필드 관례. 생성 경로에서는 `QuizQuestion.knowledge_level`이 필수라 부재가
    # 나올 수 없고, 저작 시드는 `expand_like_server`가 이 키를 flat에 싣지 않으므로
    # (session_service 런타임 전개와 동형) `lint_seed_items` 검사 ⑤가 중첩 형태로
    # 본다. 즉 두 경로 중 어느 쪽도 무검사로 새지 않는다.
    if "knowledge_level" not in question or question.get("knowledge_level") is None:
        checks.append(
            _check(
                "knowledge_level_vocabulary",
                True,
                "knowledge_level 미신고 — 해당 없음 (저작 시드는 lint 검사 ⑤ 소관)",
            )
        )
    else:
        checks.append(_knowledge_level_check(question))

    return checks


def _knowledge_level_check(question: dict) -> dict:
    """신고된 knowledge_level의 형식과 어휘 정합을 본다 (체크 16의 본체).

    어휘표를 읽지 못하면 **통과시키지 않는다.** 게이트가 조용히 꺼지는 것은 게이트가
    없는 것과 같고, 그 상태로 G1 배치를 태우면 1,360건이 무검사로 들어간다.

    `knowledge_level` 모듈은 **최상단에서** 임포트한다(지연 임포트 금지). 이유는
    langchain 규약과 반대 방향이다: `scripts/author_items._import_isolated`가 임포트
    직후 `sys.path`에서 ai-worker를 빼고 `sys.modules`의 `app.*`를 지우므로, 함수
    안에서 `from app.chains import ...`를 하면 **저작 배치 실행 중에** ModuleNotFound가
    난다(실측). stdlib만 쓰는 모듈이라 최상단 임포트에 대가가 없다.
    """
    level = question.get("knowledge_level")
    if isinstance(level, bool) or not isinstance(level, int):
        return _check(
            "knowledge_level_vocabulary",
            False,
            f"knowledge_level이 정수가 아님: {level!r} (docs/specs/12 §2 — 1~N 정수)",
        )

    try:
        vocabulary = kl.load_vocabulary()
    except Exception as exc:  # 파일 부재·스키마 위반 — 검사 불능은 탈락이다
        return _check(
            "knowledge_level_vocabulary",
            False,
            f"어휘표를 읽을 수 없어 신고 단계를 검증하지 못함: {exc}",
        )

    max_level = kl.max_knowledge_level(vocabulary)
    if not kl.KNOWLEDGE_LEVEL_MIN <= level <= max_level:
        return _check(
            "knowledge_level_vocabulary",
            False,
            f"knowledge_level이 {kl.KNOWLEDGE_LEVEL_MIN}~{max_level} 밖: {level}",
        )

    violations = kl.vocabulary_violations(question, level, vocabulary)
    if violations:
        return _check("knowledge_level_vocabulary", False, "; ".join(violations))
    return _check(
        "knowledge_level_vocabulary",
        True,
        f"{level}단계 신고 — 도입 단계가 더 높은 용어 없음",
    )


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
    """모델 출력에서 JSON을 추출해 Pydantic으로 검증한다 (json_output 공용)."""
    return LLMValidationResult(**extract_json_object(raw))


# (model, api_key, temperature) → ChatGoogleGenerativeAI 캐시 (R7-02 S7 지연 완화).
# langchain 의존성 부재 환경에서도 모듈 임포트가 깨지지 않도록 lru_cache 대신
# 지연 임포트를 유지하는 모듈 전역 dict를 쓴다. 성공한 인스턴스만 캐시하므로
# 생성 실패 시 llm_skipped 폴백 동작은 기존과 동일하다.
_llm_cache: dict[tuple, object] = {}


def _cached_validate_llm(temperature: float):
    """settings 기준으로 검증용 Gemini 클라이언트를 캐시에서 얻는다 (지연 임포트)."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    key = (settings.GEMINI_MODEL, settings.GEMINI_API_KEY, temperature)
    llm = _llm_cache.get(key)
    if llm is None:
        llm = ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=temperature,
        )
        _llm_cache[key] = llm
    return llm


def run_llm_checks(question: dict, concept_tag: str, level_group: str) -> list[dict]:
    """Gemini로 정답 유일성·보기 모호성·concept_tag 부합을 판정한다.

    1차 시도(temperature 0.2) → 파싱/검증 실패 시 temperature 0.0으로 1회 재시도
    → 2회 연속 실패 시 예외를 올린다 (호출부가 llm_skipped로 폴백).
    """
    if not llm_configured():
        # 키 미설정 시 LLM 시도 없이 즉시 예외 → 호출부의 llm_skipped 폴백(기존 경로).
        raise RuntimeError("GEMINI 키 미설정 — 2단 LLM 검증 생략")

    # LLM 의존성 부재 환경에서도 1단이 동작하도록 지연 임포트 (모듈 docstring 참고)
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.runnables import RunnableLambda

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
            llm = _cached_validate_llm(temperature)
            chain = RunnableLambda(_build_messages) | llm | StrOutputParser()
            result = _parse_llm_output(chain.invoke(inputs))
            break
        except Exception as exc:  # LLM 장애, JSON 파싱, Pydantic 검증 실패 모두 포함
            last_error = exc
            logger.warning("llm validation attempt %d failed: %s", attempt, exc)

    if result is None:
        raise RuntimeError(f"LLM 검증 2회 연속 실패: {last_error}")

    return _llm_checks_from_result(result, question.get("question_type"))


# ── R5-S6 §3.6 커리큘럼 무결성 게이트 (휴리스틱, LLM 불필요) ────────────────
# units.json 시드가 문항 풀·잠금 규칙과 정합한지 결정적으로 검증한다. 게이트이므로
# 어떤 입력(누락 필드·잘못된 타입·units가 리스트 아님)도 예외 대신 "실패한 체크"로
# 환원한다. 체크 배열은 항상 6개·고정 순서로 구성해 응답을 결정적으로 유지한다.
CURRICULUM_CONCEPT_TAGS = (
    # 기초과학 코스 6종 (R12 §9 — specs/11 §1. 유닛 AI 게이트가 bs- 유닛을
    # concept_tag_valid로 탈락시키지 않도록 seed_content.ALLOWED_CONCEPT_TAGS와 동기)
    "temperature_heat",
    "radiation_budget",
    "pressure_basics",
    "phase_change",
    "density_buoyancy",
    "energy_transfer",
    "pressure_front",
    "typhoon",
    "air_mass",
    "heat_island",
    "co2_climate",
    "anomaly",
    # 재난 축 2종 (R13 §2.4 — seed_content.ALLOWED_CONCEPT_TAGS와 동기.
    # 재난 유닛이 concept_tag_valid로 탈락하지 않도록 개방한다. 지진은 범위 밖)
    "wildfire_weather",
    "flood_response",
)
UNIT_KINDS = ("quiz", "board")
BOARD_QUESTION_TYPE = "board"  # content_items에서 board 퍼즐 판별 (§3.7 유형과 동일)


def _find_prereq_cycle_units(units: list[dict]) -> set:
    """prereq_unit_id 그래프에서 순환에 속한 unit id 집합을 반환한다.

    각 유닛의 prereq_unit_id는 단일 FK이므로 그래프는 각 노드의 진출차수가
    최대 1인 함수형 그래프다(체인·ρ 형태만 가능). 존재하지 않는 id를 가리키는
    prereq는 순환이 아니라 dangling으로 취급하여 걷기를 종료한다(순환 오판 방지).
    """
    id_to_prereq: dict = {}
    for unit in units:
        if not isinstance(unit, dict):
            continue
        uid = unit.get("id")
        if uid is None:
            continue
        prereq = unit.get("prereq_unit_id")
        # 존재하는 unit을 가리킬 때만 간선으로 인정 (dangling은 prereq_exists 소관)
        if prereq is not None and prereq in {
            u.get("id") for u in units if isinstance(u, dict)
        }:
            id_to_prereq[uid] = prereq

    cycle_ids: set = set()
    safe: set = set()  # 순환에 이르지 않음이 확인된 노드 (재방문 방지)
    for start in id_to_prereq:
        if start in safe or start in cycle_ids:
            continue
        path: list = []
        seen: set = set()
        node = start
        while node in id_to_prereq and node not in seen and node not in safe:
            seen.add(node)
            path.append(node)
            node = id_to_prereq[node]
        if node in seen:  # 현재 경로로 되돌아옴 → node부터가 순환
            in_cycle = False
            for p in path:
                if p == node:
                    in_cycle = True
                if in_cycle:
                    cycle_ids.add(p)
        else:  # 체인이 순환 없이 끝남 → 경로 전체 안전
            safe.update(path)
    return cycle_ids


def validate_curriculum(units: list, content_items: list) -> dict:
    """units.json 시드의 §3.6 무결성을 검증한다 (순수 함수, LLM 불필요).

    Args:
        units: unit dict 목록. 각 unit은 id·section·unit_order·concept_tag·
            kind·prereq_unit_id(nullable) 필드를 가진다(§3.2).
        content_items: 문항 dict 목록. board 퍼즐은 question_type='board'.

    Returns:
        {"passed": bool, "checks": [{"name", "passed", "reason"}, ...]}
        체크는 항상 6개·고정 순서. passed = 모든 체크 통과.
    """
    checks: list[dict] = []
    unit_list = units if isinstance(units, list) else []
    item_list = content_items if isinstance(content_items, list) else []
    unit_dicts = [u for u in unit_list if isinstance(u, dict)]

    # 1. unit_order_unique — section 내에서 unit_order 유일
    if not isinstance(units, list):
        checks.append(_check("unit_order_unique", False, "units가 리스트가 아님"))
    else:
        seen_orders: dict[tuple, int] = {}
        for unit in unit_dicts:
            key = (unit.get("section"), unit.get("unit_order"))
            seen_orders[key] = seen_orders.get(key, 0) + 1
        dupes = sorted(
            (f"section={sec!r} unit_order={order!r}×{count}")
            for (sec, order), count in seen_orders.items()
            if count > 1
        )
        if dupes:
            checks.append(
                _check(
                    "unit_order_unique",
                    False,
                    f"section 내 unit_order 중복: {'; '.join(dupes)}",
                )
            )
        else:
            checks.append(
                _check("unit_order_unique", True, f"section별 unit_order 유일 ({len(unit_dicts)}개)")
            )

    # 2. prereq_exists — prereq_unit_id가 존재하는 unit id를 참조 (null 허용)
    known_ids = {u.get("id") for u in unit_dicts if u.get("id") is not None}
    dangling = sorted(
        f"{u.get('id')!r}→{u.get('prereq_unit_id')!r}"
        for u in unit_dicts
        if u.get("prereq_unit_id") is not None
        and u.get("prereq_unit_id") not in known_ids
    )
    if dangling:
        checks.append(
            _check(
                "prereq_exists",
                False,
                f"존재하지 않는 unit을 참조하는 prereq_unit_id: {', '.join(dangling)}",
            )
        )
    else:
        checks.append(_check("prereq_exists", True, "모든 prereq_unit_id가 존재하는 unit 참조"))

    # 3. prereq_no_cycle — prereq 그래프에 순환 없음 (자기참조 A→A 포함)
    cycle_ids = _find_prereq_cycle_units(unit_dicts)
    if cycle_ids:
        checks.append(
            _check(
                "prereq_no_cycle",
                False,
                f"prereq 순환에 속한 unit: {', '.join(sorted(str(i) for i in cycle_ids))}",
            )
        )
    else:
        checks.append(_check("prereq_no_cycle", True, "prereq 그래프에 순환 없음"))

    # 4. concept_tag_valid — 표준 concept_tag 목록(CURRICULUM_CONCEPT_TAGS)만 허용
    bad_tags = sorted(
        {
            f"{u.get('id')!r}:{u.get('concept_tag')!r}"
            for u in unit_dicts
            if u.get("concept_tag") not in CURRICULUM_CONCEPT_TAGS
        }
    )
    if bad_tags:
        checks.append(
            _check(
                "concept_tag_valid",
                False,
                f"concept_tag가 표준 목록({', '.join(CURRICULUM_CONCEPT_TAGS)}) 밖: "
                f"{', '.join(bad_tags)}",
            )
        )
    else:
        checks.append(_check("concept_tag_valid", True, "모든 concept_tag가 표준 목록 내"))

    # 5. kind_enum — kind가 'quiz'|'board'
    bad_kinds = sorted(
        {
            f"{u.get('id')!r}:{u.get('kind')!r}"
            for u in unit_dicts
            if u.get("kind") not in UNIT_KINDS
        }
    )
    if bad_kinds:
        checks.append(
            _check(
                "kind_enum",
                False,
                f"kind가 enum({'|'.join(UNIT_KINDS)}) 밖: {', '.join(bad_kinds)}",
            )
        )
    else:
        checks.append(_check("kind_enum", True, "모든 kind가 enum 내"))

    # 6. board_puzzle_exists — board 유닛은 해당 concept_tag board 퍼즐이 1건 이상 존재
    board_tags = {
        item.get("concept_tag")
        for item in item_list
        if isinstance(item, dict)
        and item.get("question_type") == BOARD_QUESTION_TYPE
    }
    missing_board = sorted(
        {
            f"{u.get('id')!r}(concept_tag={u.get('concept_tag')!r})"
            for u in unit_dicts
            if u.get("kind") == "board" and u.get("concept_tag") not in board_tags
        }
    )
    if missing_board:
        checks.append(
            _check(
                "board_puzzle_exists",
                False,
                f"board 유닛에 해당 concept_tag board 퍼즐 없음: {', '.join(missing_board)}",
            )
        )
    else:
        board_unit_count = sum(1 for u in unit_dicts if u.get("kind") == "board")
        checks.append(
            _check(
                "board_puzzle_exists",
                True,
                f"모든 board 유닛({board_unit_count}개)에 해당 concept_tag board 퍼즐 존재",
            )
        )

    return {"passed": all(c["passed"] for c in checks), "checks": checks}


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
    elif not llm_configured():
        # `settings.GEMINI_API_KEY` 진리값만 보면 **플레이스홀더 키**(.env.example의
        # "발급받은_키")에서 2단에 진입해 `run_llm_checks`가 즉시 예외를 내고, 사유가
        # "키 부재"가 아니라 "LLM 호출 실패"로 기록된다. 기능은 안 깨지지만 저작 배치
        # 리포트·`source.refs`에 남는 사유가 오해를 부른다 — 생성·게이트 다른 경로가
        # 이미 쓰는 `llm_configured()`(플레이스홀더 배제)로 통일한다.
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

"""품질 게이트 1단 휴리스틱 골든셋 회귀 테스트 (§3.4-R2 + §3.7-R3).

LLM(GEMINI_API_KEY) 없이 실행 가능해야 한다 (TEAM_PROCESS.md §1.4).
골든셋: tests/golden_validate.json — 정상 9건(R2 3 + R3 4 + R4 2) +
휴리스틱 위반 17건(R2 6 + R3 8 + R4 3, 다양한 위반 유형 커버).
R4-S6 §3.6: 미니 미션(time_limit_sec)·재현 퍼즐(based_on) board 필드 확장.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.chains import validate_chain

GOLDEN_PATH = Path(__file__).parent / "golden_validate.json"

with GOLDEN_PATH.open(encoding="utf-8") as f:
    GOLDEN_CASES = json.load(f)["cases"]

# 체크 배열은 §3.4(6종) + §3.7(신규 7종) + §3.6-R4(board 2종) = 15개 고정 순서
HEURISTIC_CHECK_NAMES = [
    "required_fields",
    "options_count",
    "options_unique",
    "answer_in_options",
    "slider_range",
    "question_length",
    "board_initial_state",
    "board_goal_conditions",
    "board_palette",
    "board_guide_steps",
    "match_pairs",
    "ordering_items",
    "cloze_blank",
    "board_time_limit",
    "board_based_on",
]


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["id"] for c in GOLDEN_CASES])
def test_golden_heuristic(case: dict) -> None:
    """골든셋 각 문항의 1단 휴리스틱 판정이 기대와 일치한다."""
    checks = validate_chain.run_heuristic_checks(
        case["request"]["question"], case["request"].get("concept_tag")
    )

    # 계약 §3.4: 각 체크는 {"name", "passed", "reason"} 형태
    for check in checks:
        assert set(check.keys()) == {"name", "passed", "reason"}
        assert isinstance(check["passed"], bool)
        assert check["reason"]

    # 체크 배열 구성은 결정적 (6개 고정 순서)
    assert [c["name"] for c in checks] == HEURISTIC_CHECK_NAMES

    passed = all(c["passed"] for c in checks)
    assert passed == case["expect_passed"], f"checks={checks}"

    failed_names = {c["name"] for c in checks if not c["passed"]}
    for name in case["expect_failed_checks"]:
        assert name in failed_names, f"'{name}' 실패 기대, 실제 실패: {failed_names}"


def test_validate_quiz_without_llm_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """키 부재 시 예외 없이 1단 결과 + llm_skipped로 응답한다."""
    monkeypatch.setattr(
        validate_chain,
        "settings",
        SimpleNamespace(GEMINI_API_KEY="", GEMINI_MODEL="gemini-3.1-flash-lite"),
    )
    good_case = next(c for c in GOLDEN_CASES if c["id"] == "ok_multiple_choice")
    request = good_case["request"]

    result = validate_chain.validate_quiz(
        question=request["question"],
        concept_tag=request["concept_tag"],
        level_group=request["level_group"],
    )

    assert result["passed"] is True
    skipped = [c for c in result["checks"] if c["name"] == "llm_skipped"]
    assert len(skipped) == 1 and skipped[0]["passed"] is True


def test_validate_quiz_heuristic_fail_skips_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """1단 실패 문항은 키가 있어도 2단을 호출하지 않고 반려된다."""
    monkeypatch.setattr(
        validate_chain,
        "settings",
        SimpleNamespace(GEMINI_API_KEY="dummy-key", GEMINI_MODEL="gemini-3.1-flash-lite"),
    )

    def _must_not_call(*args, **kwargs):  # pragma: no cover
        raise AssertionError("1단 실패 시 run_llm_checks가 호출되면 안 됨")

    monkeypatch.setattr(validate_chain, "run_llm_checks", _must_not_call)

    bad_case = next(c for c in GOLDEN_CASES if c["id"] == "bad_duplicate_options")
    request = bad_case["request"]

    result = validate_chain.validate_quiz(
        question=request["question"],
        concept_tag=request["concept_tag"],
        level_group=request["level_group"],
    )

    assert result["passed"] is False
    assert any(c["name"] == "llm_skipped" and c["passed"] for c in result["checks"])


# ── R3-S8 §3.7 신규 유형 계약 자기 점검 ───────────────────────────────────
def test_allowed_question_types_seven() -> None:
    """ALLOWED_QUESTION_TYPES가 §3.8의 7종으로 확장되었다."""
    assert set(validate_chain.ALLOWED_QUESTION_TYPES) == {
        "multiple_choice",
        "short_answer",
        "slider",
        "board",
        "match",
        "ordering",
        "cloze",
    }


def test_board_exempts_correct_answer_but_others_dont() -> None:
    """board는 correct_answer 빈 문자열을 required_fields에서 면제받는다.

    동일하게 correct_answer가 빈 문자열인 short_answer는 required_fields 실패해야
    한다(면제는 board 한정, §3.3-R3).
    """
    base_board = {
        "question_text": "수도권에 소나기를 내려 보세요 (테스트)",
        "question_type": "board",
        "correct_answer": "",
        "mode": "goal_only",
        "initial_state": {"elements": []},
        "palette": ["front:cold", "moisture"],
        "goal_conditions": [{"zone": 1, "phenomenon": "shower"}],
    }
    board_checks = {
        c["name"]: c for c in validate_chain.run_heuristic_checks(base_board)
    }
    assert board_checks["required_fields"]["passed"] is True

    short = {
        "question_text": "빈 정답을 가진 주관식 문항입니다 정말로요",
        "question_type": "short_answer",
        "correct_answer": "",
    }
    short_checks = {c["name"]: c for c in validate_chain.run_heuristic_checks(short)}
    assert short_checks["required_fields"]["passed"] is False


@pytest.mark.parametrize("qtype", ["board", "match", "ordering", "cloze"])
def test_new_types_options_checks_not_applicable(qtype: str) -> None:
    """신규 4유형에서 객관식 전용 체크는 '해당 없음' 통과여야 한다."""
    question = {
        "question_text": f"{qtype} 유형의 형식 점검용 더미 문항입니다 정말로",
        "question_type": qtype,
        "correct_answer": "x",
    }
    checks = {c["name"]: c for c in validate_chain.run_heuristic_checks(question)}
    for name in ("options_count", "options_unique", "answer_in_options", "slider_range"):
        assert checks[name]["passed"] is True
        assert "해당 없음" in checks[name]["reason"]


@pytest.mark.parametrize("qtype", ["board", "match", "ordering", "cloze"])
def test_llm_mapping_new_types_only_concept_match(qtype: str) -> None:
    """신규 유형은 LLM 판정과 무관하게 concept_match만 적용된다(§3.7).

    answer_uniqueness·option_clarity는 LLM이 false를 반환해도 '해당 없음' 통과로
    확정되어야 한다.
    """
    llm_result = validate_chain.LLMValidationResult(
        answer_uniqueness={"passed": False, "reason": "LLM이 실패로 판정했더라도"},
        option_clarity={"passed": False, "reason": "LLM이 실패로 판정했더라도"},
        concept_match={"passed": True, "reason": "개념 부합"},
    )
    checks = {
        c["name"]: c
        for c in validate_chain._llm_checks_from_result(llm_result, qtype)
    }
    assert checks["llm_answer_uniqueness"]["passed"] is True
    assert "해당 없음" in checks["llm_answer_uniqueness"]["reason"]
    assert checks["llm_option_clarity"]["passed"] is True
    assert "해당 없음" in checks["llm_option_clarity"]["reason"]
    assert checks["llm_concept_match"]["passed"] is True


def test_llm_mapping_legacy_types_all_applied() -> None:
    """기존 3유형은 세 항목 모두 LLM 판정 그대로 반영된다(회귀 방지)."""
    llm_result = validate_chain.LLMValidationResult(
        answer_uniqueness={"passed": False, "reason": "중복 정답"},
        option_clarity={"passed": True, "reason": "명확"},
        concept_match={"passed": True, "reason": "부합"},
    )
    checks = {
        c["name"]: c
        for c in validate_chain._llm_checks_from_result(llm_result, "multiple_choice")
    }
    assert checks["llm_answer_uniqueness"]["passed"] is False
    assert checks["llm_answer_uniqueness"]["reason"] == "중복 정답"

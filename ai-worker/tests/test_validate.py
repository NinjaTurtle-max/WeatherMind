"""품질 게이트(§3.4) 1단 휴리스틱 골든셋 회귀 테스트.

LLM(GEMINI_API_KEY) 없이 실행 가능해야 한다 (TEAM_PROCESS.md §1.4).
골든셋: tests/golden_validate.json — 정상 문항 3건 + 휴리스틱 위반 문항 6건.

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

HEURISTIC_CHECK_NAMES = [
    "required_fields",
    "options_count",
    "options_unique",
    "answer_in_options",
    "slider_range",
    "question_length",
]


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["id"] for c in GOLDEN_CASES])
def test_golden_heuristic(case: dict) -> None:
    """골든셋 각 문항의 1단 휴리스틱 판정이 기대와 일치한다."""
    checks = validate_chain.run_heuristic_checks(case["request"]["question"])

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

"""커리큘럼 무결성 게이트 테스트 (R5-S6 §3.6).

validate_chain.validate_curriculum은 units.json 시드가 문항 풀·잠금 규칙과
정합한지 결정적으로 검증하는 순수 함수(LLM 불필요)다. 정상 케이스와 각 위반
유형(unit_order 중복, prereq 미존재, prereq 순환, concept_tag 불량,
board 유닛 board 퍼즐 부재)을 커버한다.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q` (GEMINI_API_KEY 불필요)
"""

from __future__ import annotations

from app.chains import validate_chain

# 체크 배열은 항상 6개·고정 순서 (응답 결정성 계약)
CURRICULUM_CHECK_NAMES = [
    "unit_order_unique",
    "prereq_exists",
    "prereq_no_cycle",
    "concept_tag_valid",
    "kind_enum",
    "board_puzzle_exists",
]


def _checks_by_name(result: dict) -> dict:
    return {c["name"]: c for c in result["checks"]}


# ── 유효 픽스처 ───────────────────────────────────────────────────────────
def _valid_units() -> list[dict]:
    """정상 커리큘럼: 2섹션, prereq 체인(순환 없음), quiz+board 유닛."""
    return [
        {
            "id": "u1",
            "section": "하늘 읽기",
            "unit_order": 1,
            "concept_tag": "pressure_front",
            "kind": "quiz",
            "prereq_unit_id": None,
        },
        {
            "id": "u2",
            "section": "하늘 읽기",
            "unit_order": 2,
            "concept_tag": "pressure_front",
            "kind": "board",
            "prereq_unit_id": "u1",
        },
        {
            "id": "u3",
            "section": "공기의 힘",
            "unit_order": 1,
            "concept_tag": "air_mass",
            "kind": "board",
            "prereq_unit_id": "u2",
        },
    ]


def _valid_content_items() -> list[dict]:
    return [
        {"concept_tag": "pressure_front", "question_type": "multiple_choice"},
        {"concept_tag": "pressure_front", "question_type": "board"},
        {"concept_tag": "air_mass", "question_type": "board"},
    ]


# ── 정상 케이스 ───────────────────────────────────────────────────────────
def test_valid_curriculum_passes() -> None:
    result = validate_chain.validate_curriculum(
        _valid_units(), _valid_content_items()
    )
    # 계약: 체크는 {"name","passed","reason"} 형태 + 6개 고정 순서
    for check in result["checks"]:
        assert set(check.keys()) == {"name", "passed", "reason"}
        assert isinstance(check["passed"], bool)
        assert check["reason"]
    assert [c["name"] for c in result["checks"]] == CURRICULUM_CHECK_NAMES
    assert result["passed"] is True
    assert all(c["passed"] for c in result["checks"])


def test_check_array_deterministic_even_on_failure() -> None:
    """어떤 위반에서도 체크 배열은 6개·고정 순서로 유지된다."""
    units = _valid_units()
    units[1]["unit_order"] = 1  # section 내 중복 유발
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    assert [c["name"] for c in result["checks"]] == CURRICULUM_CHECK_NAMES


# ── 위반 1: unit_order 섹션 내 중복 ───────────────────────────────────────
def test_duplicate_unit_order_in_section() -> None:
    units = _valid_units()
    units[1]["unit_order"] = 1  # u1과 같은 section·unit_order
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["unit_order_unique"]["passed"] is False


def test_same_unit_order_across_sections_ok() -> None:
    """section이 다르면 같은 unit_order는 허용된다 (u1·u3 둘 다 order 1)."""
    result = validate_chain.validate_curriculum(
        _valid_units(), _valid_content_items()
    )
    assert _checks_by_name(result)["unit_order_unique"]["passed"] is True


# ── 위반 2: prereq_unit_id 미존재 ─────────────────────────────────────────
def test_prereq_references_missing_unit() -> None:
    units = _valid_units()
    units[0]["prereq_unit_id"] = "does_not_exist"
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["prereq_exists"]["passed"] is False
    # dangling은 순환이 아니므로 순환 체크는 통과해야 한다
    assert checks["prereq_no_cycle"]["passed"] is True


# ── 위반 3: prereq 순환 (A→B→A) ────────────────────────────────────────────
def test_prereq_cycle_two_units() -> None:
    """A→B→A 순환. 두 유닛 모두 존재하므로 prereq_exists는 통과, 순환만 실패."""
    units = _valid_units()
    units[0]["prereq_unit_id"] = "u2"  # u1→u2, u2→u1 (기존)
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["prereq_no_cycle"]["passed"] is False
    assert checks["prereq_exists"]["passed"] is True


def test_prereq_self_cycle() -> None:
    """자기참조 A→A도 순환으로 잡는다."""
    units = _valid_units()
    units[0]["prereq_unit_id"] = "u1"
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert checks["prereq_no_cycle"]["passed"] is False
    assert checks["prereq_exists"]["passed"] is True


# ── 위반 4: concept_tag 불량 ──────────────────────────────────────────────
def test_invalid_concept_tag() -> None:
    units = _valid_units()
    units[0]["concept_tag"] = "not_a_real_tag"
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["concept_tag_valid"]["passed"] is False


# ── 위반 5: board 유닛인데 해당 concept_tag board 퍼즐 없음 ──────────────────
def test_board_unit_without_board_puzzle() -> None:
    units = _valid_units()
    # air_mass board 퍼즐(u3용)을 content_items에서 제거
    items = [
        it
        for it in _valid_content_items()
        if not (it["concept_tag"] == "air_mass" and it["question_type"] == "board")
    ]
    result = validate_chain.validate_curriculum(units, items)
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["board_puzzle_exists"]["passed"] is False


def test_board_check_ignores_non_board_items_of_same_tag() -> None:
    """같은 concept_tag여도 question_type이 board가 아니면 퍼즐로 세지 않는다."""
    units = _valid_units()
    items = [
        {"concept_tag": "pressure_front", "question_type": "board"},
        {"concept_tag": "air_mass", "question_type": "multiple_choice"},  # board 아님
    ]
    result = validate_chain.validate_curriculum(units, items)
    checks = _checks_by_name(result)
    # u3(air_mass board)에 대한 board 퍼즐이 없으므로 실패
    assert checks["board_puzzle_exists"]["passed"] is False


# ── 위반 6: kind enum 밖 ──────────────────────────────────────────────────
def test_invalid_kind() -> None:
    units = _valid_units()
    units[0]["kind"] = "lesson"
    result = validate_chain.validate_curriculum(units, _valid_content_items())
    checks = _checks_by_name(result)
    assert result["passed"] is False
    assert checks["kind_enum"]["passed"] is False


# ── 게이트 견고성: 잘못된 입력도 예외 대신 실패 체크로 ───────────────────────
def test_units_not_a_list_fails_gracefully() -> None:
    result = validate_chain.validate_curriculum("not-a-list", [])
    assert result["passed"] is False
    assert _checks_by_name(result)["unit_order_unique"]["passed"] is False
    # 예외 없이 6개 체크 유지
    assert [c["name"] for c in result["checks"]] == CURRICULUM_CHECK_NAMES


def test_malformed_unit_entries_do_not_crash() -> None:
    """dict 아닌 유닛·필드 누락 유닛이 섞여도 예외 없이 판정한다."""
    units = [None, "bad", {"id": "x"}, {"section": "s", "unit_order": 1}]
    result = validate_chain.validate_curriculum(units, [{"bad": True}])
    assert [c["name"] for c in result["checks"]] == CURRICULUM_CHECK_NAMES
    # {"id":"x"}는 concept_tag·kind 누락 → 해당 체크 실패
    checks = _checks_by_name(result)
    assert checks["concept_tag_valid"]["passed"] is False
    assert checks["kind_enum"]["passed"] is False


def test_empty_curriculum_passes() -> None:
    """빈 커리큘럼은 위반이 없으므로 통과한다."""
    result = validate_chain.validate_curriculum([], [])
    assert result["passed"] is True
    assert [c["name"] for c in result["checks"]] == CURRICULUM_CHECK_NAMES

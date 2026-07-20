"""채점기 레지스트리 + board 제출 확장 단위 테스트 — 스프린트 R3-01 §3.6·§3.4·§3.5.

DB 없이 순수 채점 로직만 검증한다:
- 기존 3유형 채점 규칙 불변(레지스트리 이관 후에도 동작 동일)
- 신규 4유형(match·ordering·cloze·board) 채점
- §3.4 board 제출: resolve_answer가 board_state 필수(누락 → BoardStateRequiredError)·
  형식 위반(→ BoardValidationError)을 판별하고 정답이면 JSON 직렬화
- §3.5 최초 클리어 1회성 XP 규칙(board_clear_xp)
"""
import json
import uuid

import pytest

from app.models.quiz_log import QuizLog
from app.routers.board import board_clear_xp
from app.services import answer_service
from app.services import board_engine as be
from app.services.answer_service import BoardStateRequiredError
from app.services.board_engine import BoardValidationError

# test_board_engine의 인라인 미니 규칙 재사용 (단일 규칙 정의원)
from tests.test_board_engine import MINI_RULES


@pytest.fixture(autouse=True)
def _use_mini_rules(monkeypatch):
    """board 채점이 파일 대신 인라인 미니 규칙을 쓰도록 load_rules를 대체."""
    monkeypatch.setattr(be, "load_rules", lambda *a, **k: MINI_RULES)


# ═══════════════════ 레지스트리 등록 상태 ═══════════════════


def test_레지스트리_7유형_등록():
    assert set(answer_service.GRADERS) == {
        "multiple_choice",
        "short_answer",
        "slider",
        "cloze",
        "match",
        "ordering",
        "board",
    }


# ═══════════════════ 기존 3유형 불변 ═══════════════════


class TestLegacyGraders:
    def test_multiple_choice_대소문자_공백_무시(self):
        q = {"question_type": "multiple_choice", "correct_answer": "수증기 응결열"}
        assert answer_service.grade(q, "  수증기 응결열 ") is True

    def test_short_answer_불일치_오답(self):
        q = {"question_type": "short_answer", "correct_answer": "적란운"}
        assert answer_service.grade(q, "층운") is False

    def test_slider_오차_10허용_경계(self):
        q = {"question_type": "slider", "correct_answer": "50"}
        assert answer_service.grade(q, "60") is True   # ±10 경계
        assert answer_service.grade(q, "61") is False
        assert answer_service.grade(q, "숫자아님") is False


# ═══════════════════ 신규 4유형 ═══════════════════


class TestMatchGrader:
    Q = {
        "question_type": "match",
        "pairs": [
            {"left": "한랭전선", "right": "소나기"},
            {"left": "온난전선", "right": "지속성 비"},
            {"left": "정체전선", "right": "장마"},
        ],
    }

    def test_전쌍_일치_정답(self):
        ans = "한랭전선:소나기|온난전선:지속성 비|정체전선:장마"
        assert answer_service.grade(self.Q, ans) is True

    def test_순서_무관(self):
        ans = "정체전선:장마|한랭전선:소나기|온난전선:지속성 비"
        assert answer_service.grade(self.Q, ans) is True

    def test_한쌍_틀리면_오답(self):
        ans = "한랭전선:장마|온난전선:지속성 비|정체전선:소나기"
        assert answer_service.grade(self.Q, ans) is False

    def test_형식_위반_오답(self):
        assert answer_service.grade(self.Q, "한랭전선=소나기") is False


class TestOrderingGrader:
    Q = {"question_type": "ordering", "items": ["A", "B", "C", "D"], "shuffled": True}

    def test_정순열_항등_정답(self):
        assert answer_service.grade(self.Q, "0,1,2,3") is True

    def test_뒤섞인_순열_오답(self):
        assert answer_service.grade(self.Q, "0,2,1,3") is False

    def test_길이_불일치_오답(self):
        assert answer_service.grade(self.Q, "0,1,2") is False

    def test_숫자아님_오답(self):
        assert answer_service.grade(self.Q, "0,x,2,3") is False


class TestClozeGrader:
    def test_short_answer_규칙_재사용(self):
        q = {"question_type": "cloze", "correct_answer": "이슬점"}
        assert answer_service.grade(q, " 이슬점 ") is True
        assert answer_service.grade(q, "노점") is False


class TestBoardGrader:
    def _q(self, goal):
        return {"question_type": "board", "goal_conditions": goal}

    def test_goal_충족_정답(self):
        board = {
            "elements": [
                {"type": "front", "subtype": "cold", "zone": 1},
                {"type": "moisture", "level": 70, "zone": 1},
            ]
        }
        q = self._q([{"zone": 1, "phenomenon": "shower"}])
        assert answer_service.grade(q, json.dumps(board)) is True

    def test_goal_미충족_오답(self):
        board = {"elements": []}
        q = self._q([{"zone": 1, "phenomenon": "shower"}])
        assert answer_service.grade(q, json.dumps(board)) is False

    def test_evaluate_board_answer_phenomena_반환(self):
        board = {
            "elements": [
                {"type": "front", "subtype": "cold", "zone": 1},
                {"type": "moisture", "level": 70, "zone": 1},
            ]
        }
        q = self._q([{"zone": 1, "phenomenon": "shower"}])
        phenomena, passed, rules = answer_service.evaluate_board_answer(q, board)
        assert passed is True
        assert phenomena[1]["phenomenon"] == "shower"
        assert rules is MINI_RULES


# ═══════════════════ §3.4 board 제출 정규화 ═══════════════════


def _board_log():
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id="board-test",
        concept_tag="pressure_front",
        question_type="board",
        question_json={"question_type": "board", "goal_conditions": []},
    )


def _mc_log():
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id="20260720-001",
        concept_tag="typhoon",
        question_type="multiple_choice",
        question_json={"question_type": "multiple_choice", "correct_answer": "x"},
    )


class TestResolveAnswer:
    def test_board_누락시_BoardStateRequired(self):
        with pytest.raises(BoardStateRequiredError):
            answer_service.resolve_answer(_board_log(), "", None)

    def test_board_형식위반_BoardValidation(self):
        bad = {"elements": [{"type": "sun", "level": 200, "zone": 0}]}
        with pytest.raises(BoardValidationError):
            answer_service.resolve_answer(_board_log(), "", bad)

    def test_board_정상시_JSON_직렬화(self):
        board = {"elements": [{"type": "sun", "level": 60, "zone": 0}]}
        out = answer_service.resolve_answer(_board_log(), "", board)
        assert json.loads(out) == board

    def test_비board는_answer_그대로(self):
        assert answer_service.resolve_answer(_mc_log(), "정답", None) == "정답"


# ═══════════════════ §3.5 최초 클리어 XP 1회성 ═══════════════════


class TestBoardClearXp:
    def test_최초_클리어만_5xp(self):
        assert board_clear_xp(passed=True, already_cleared=False) == 5

    def test_재도전_클리어는_0(self):
        assert board_clear_xp(passed=True, already_cleared=True) == 0

    def test_미통과는_0(self):
        assert board_clear_xp(passed=False, already_cleared=False) == 0
        assert board_clear_xp(passed=False, already_cleared=True) == 0

"""피드백 출처 라벨 계약 (CO-I-1 후속, 2026-08-08 감사).

CO-I-1이 사람 저작 해설 158건을 피드백 경로에 붙이면서 새 거짓말이 생겼다 —
`FeedbackPanel`이 배지를 `t('feedback.ai')`("AI 피드백")로 **고정 렌더**하는데,
이제 그 배지 아래로 **사람이 쓴 글**이 나간다. 심사 배점 ⑤(생성형 AI 활용)에
직결되는 표기 오류라 서버가 출처를 말하고 프론트가 라벨을 고르게 했다.

`feedback_source()`와 `build_feedback()`은 **같은 우선순위를 두 번 적는다** —
그래서 갈라질 수 있다. 이 파일이 그 둘을 함께 돌려 대조한다.
"""

from __future__ import annotations

import pytest

from app.services import answer_service, board_engine

# 🔴 2026-08-20: 이 픽스처 값이 **「무시돼야 한다」**였다. 클라이언트 판정으로
# 뒤집혔다 — 퍼즐을 풀면 **규칙 설명 + 사람이 쓴 해설이 함께** 나간다. 그래서 값도
# 새 의도를 말하게 고친다(픽스처 문자열이 옛 의도를 계속 주장하면, 다음 사람이
# 그것을 계약으로 읽는다 — 이 파일이 생긴 사고와 같은 형태다).
# ⚠️ **출처 라벨은 여전히 `"board"`다**(같은 날 판정 ⓐ). 사람 글이 섞이지만 배지가
# 「AI 피드백」이라 말하지 않으므로 거짓이 아니다.
BOARD_Q = {"question_type": "board", "explanation_hint": "이어 붙어야 한다"}
AUTHORED_Q = {"question_type": "multiple_choice", "explanation_hint": "전선은 …"}
AI_Q = {"question_type": "multiple_choice", "explanation_hint": ""}
AI_Q_NONE = {"question_type": "short_answer"}


class TestSourceVerdict:
    @pytest.mark.parametrize(
        "question,expected",
        [
            (BOARD_Q, "board"),
            (AUTHORED_Q, "authored"),
            (AI_Q, "ai"),
            (AI_Q_NONE, "ai"),
            ({"question_type": "slider", "explanation_hint": "   "}, "ai"),
        ],
    )
    def test_출처_판정(self, question, expected):
        assert answer_service.feedback_source(question) == expected

    def test_board가_해설보다_우선한다(self):
        """board는 규칙 explain을 쓰고 RAG를 안 부른다 — 해설이 있어도 board다."""
        assert answer_service.feedback_source(BOARD_Q) == "board"


class TestVerdictMatchesActualBranch:
    """라벨과 실제 텍스트가 같은 갈래에서 나오는가 — 두 함수가 갈라지면 잡힌다."""

    @pytest.mark.anyio
    async def test_authored는_해설_원문을_그대로_돌려준다(self):
        text = await answer_service.build_feedback(
            db=None,
            user=None,
            question=AUTHORED_Q,
            answer="x",
            is_correct=False,
            concept_tag="pressure_front",
            phenomena=None,
            board_rules=None,
        )
        assert text == "전선은 …"
        assert answer_service.feedback_source(AUTHORED_Q) == "authored"

    @pytest.mark.anyio
    async def test_ai_갈래는_해설을_안_쓴다(self, monkeypatch):
        called = {}

        async def fake_rag(**kw):
            called["hit"] = True
            return "AI가 만든 문장"

        monkeypatch.setattr(answer_service.ai_client, "rag_feedback", fake_rag)
        monkeypatch.setattr(answer_service, "get_today_weather", lambda *a, **k: _async({}))
        monkeypatch.setattr(answer_service, "user_region", lambda u: "서울")
        text = await answer_service.build_feedback(
            db=None,
            user=None,
            question=AI_Q,
            answer="x",
            is_correct=False,
            concept_tag="pressure_front",
            phenomena=None,
            board_rules=None,
        )
        assert called.get("hit"), "해설이 없으면 RAG를 불러야 한다"
        assert text == "AI가 만든 문장"
        assert answer_service.feedback_source(AI_Q) == "ai"


class TestBoardAuthoredConcat:
    """🔴 **퍼즐을 풀면 규칙 설명 + 사람이 쓴 해설이 함께 나간다** (2026-08-20 판정).

    종전에는 `select_feedback`이 규칙 `explain`만 돌려주고 해설을 **무시**했다.
    이 클래스가 무는 것은 세 가지이고, **셋이 한 쌍**이다:

      ① 해설이 있으면 **이어 붙는다**(규칙 설명이 **앞**)
      ② 해설이 없으면 **종전과 바이트 동일** — 해설 없는 판의 회귀가 0이어야 한다
      ③ 실패 갈래는 **손대지 않았다**(`hints[0]`)

    ⚠️ ①만 물면 ②가 깨져도 초록이다(해설 있는 판만 보므로). 그래서 **둘을 갈라**
    적는다 — 오늘 이 저장소에서 「한 자리만 보는 단정」이 여러 번 통과했다.
    """

    RULES = [{"id": "r1", "when": ["sun>=80"], "then": {"phenomenon": "clear"},
              "explain": "규칙 설명"}]
    PHENOM = [{"zone": 0, "phenomenon": "clear", "cloud": "none", "rule_id": "r1"}]

    def _template(self, hint=None):
        t = {"goal_conditions": [{"zone": 0, "phenomenon": "clear"}], "hints": ["힌트 1단"]}
        if hint is not None:
            t["explanation_hint"] = hint
        return t

    def test_해설이_있으면_규칙_설명_뒤에_이어_붙는다(self):
        text = board_engine.select_feedback(
            self._template("한 걸음 더"), self.PHENOM, True, self.RULES
        )
        assert text.startswith("규칙 설명"), "판정 근거가 앞에 와야 한다"
        assert "한 걸음 더" in text, "사람이 쓴 해설이 함께 나가야 한다"

    @pytest.mark.parametrize("hint", [None, "", "   "])
    def test_해설이_없으면_규칙_설명만_나간다(self, hint):
        """🔴 회귀 0 — 해설 없는 판(2026-08-20 실측 board 64판 중 38판)은
        종전과 **같은 문자열**이어야 한다."""
        text = board_engine.select_feedback(
            self._template(hint), self.PHENOM, True, self.RULES
        )
        assert text == "규칙 설명", f"해설이 없는데 무언가 붙었다: {text!r}"

    def test_실패_갈래는_안_바뀐다(self):
        text = board_engine.select_feedback(
            self._template("한 걸음 더"), self.PHENOM, False, self.RULES
        )
        assert text == "힌트 1단", "실패 시에는 해설을 붙이지 않는다(손대지 않은 갈래)"

    @pytest.mark.anyio
    async def test_출처_배지는_board를_유지한다(self):
        """사람 글이 섞이지만 배지는 「보드 판정」이다 — 「AI」라고 말하지 않으므로
        거짓이 아니다(판정 ⓐ). 이 파일이 생긴 사고를 되풀이하지 않는 자리다."""
        q = {"question_type": "board", **self._template("한 걸음 더")}
        text = await answer_service.build_feedback(
            db=None, user=None, question=q, answer="x", is_correct=True,
            concept_tag="pressure_front", phenomena=self.PHENOM, board_rules=self.RULES,
        )
        assert "규칙 설명" in text and "한 걸음 더" in text
        assert answer_service.feedback_source(q) == "board"


async def _async(value):
    return value


@pytest.fixture
def anyio_backend():
    return "asyncio"

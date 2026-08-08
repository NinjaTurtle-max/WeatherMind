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

from app.services import answer_service

BOARD_Q = {"question_type": "board", "explanation_hint": "무시돼야 한다"}
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


async def _async(value):
    return value


@pytest.fixture
def anyio_backend():
    return "asyncio"

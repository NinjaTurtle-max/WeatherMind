"""answer_service 서비스층 단위 테스트 — 웨이브 1 리뷰 1·4번 고정.

- 멱등 가드: 이미 응답한 로그 재제출 시 AlreadyAnsweredError (부수효과 없음)
- 세션 XP 누적: log.session_id가 있으면 sessions.xp_total 원자 UPDATE 발행
  (제출 라우터 경로와 무관 — /quiz로 세션 문항을 제출해도 정확)
- 뱅크 통계: log.content_item_id가 있으면 content_items 원자 UPDATE 발행

DB 없이 검증: FakeDB가 실행된 statement를 수집하고, 외부 호출(날씨·RAG)은
monkeypatch로 대체한다.
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import Update

from app.models.quiz_log import QuizLog
from app.services import answer_service
from app.services.answer_service import AlreadyAnsweredError


class FakeResult:
    def scalar_one_or_none(self):
        return None


class FakeDB:
    """실행된 statement만 수집하는 AsyncSession 대역."""

    def __init__(self):
        self.executed = []
        self.added = []

    async def execute(self, stmt):
        self.executed.append(stmt)
        return FakeResult()

    async def get(self, model, pk):
        return None  # add_xp 생략 경로 (XP 계산 자체는 검증 대상)

    async def flush(self):
        pass

    def add(self, obj):
        self.added.append(obj)

    def updates_on(self, table_name: str) -> list:
        return [
            stmt
            for stmt in self.executed
            if isinstance(stmt, Update) and stmt.table.name == table_name
        ]


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    """날씨 조회·RAG 피드백을 정적 응답으로 대체 (네트워크 차단)."""

    async def fake_weather(*args, **kwargs):
        return {}

    async def fake_feedback(**kwargs):
        return "피드백"

    monkeypatch.setattr(answer_service, "get_today_weather", fake_weather)
    monkeypatch.setattr(answer_service.ai_client, "rag_feedback", fake_feedback)


def make_log(session_id=None, content_item_id=None, answered=False) -> QuizLog:
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id="20260720-001",
        concept_tag="typhoon",
        question_type="multiple_choice",
        question_json={
            "question_type": "multiple_choice",
            "question_text": "태풍의 에너지원은?",
            "options": ["수증기 응결열", "지열", "조력", "풍력"],
            "correct_answer": "수증기 응결열",
        },
        session_id=session_id,
        content_item_id=content_item_id,
        user_answer="수증기 응결열" if answered else None,
        is_correct=True if answered else None,
    )


def submit(db, log, answer="수증기 응결열"):
    user = SimpleNamespace(id=uuid.uuid4())
    return asyncio.run(
        answer_service.submit_answer_for_log(db, user, log, answer, None)
    )


class TestAlreadyAnsweredGuard:
    def test_재제출은_서비스층에서_거부(self):
        db = FakeDB()
        with pytest.raises(AlreadyAnsweredError):
            submit(db, make_log(answered=True))
        assert db.executed == []  # 채점·XP·통계 부수효과 없음

    def test_미응답_로그는_정상_처리(self):
        result = submit(FakeDB(), make_log())
        assert result.is_correct is True
        assert result.xp_earned == 15  # 정답 10 + 첫 시도 5 (07번)


class TestSessionXpAccrual:
    def test_세션_문항이면_sessions_원자_UPDATE(self):
        db = FakeDB()
        session_id = uuid.uuid4()
        result = submit(db, make_log(session_id=session_id))
        updates = db.updates_on("sessions")
        assert len(updates) == 1
        params = updates[0].compile().params
        assert result.xp_earned in params.values()  # xp_total + 15
        assert session_id in params.values()

    def test_비세션_문항은_sessions_UPDATE_없음(self):
        db = FakeDB()
        submit(db, make_log(session_id=None))
        assert db.updates_on("sessions") == []

    def test_오답도_참여_XP가_세션에_누적(self):
        db = FakeDB()
        result = submit(db, make_log(session_id=uuid.uuid4()), answer="지열")
        assert result.is_correct is False
        assert result.xp_earned == 2  # 오답 참여 XP (07번)
        params = db.updates_on("sessions")[0].compile().params
        assert 2 in params.values()


class TestContentItemStats:
    def test_뱅크_문항_정답시_원자_UPDATE_1_1(self):
        db = FakeDB()
        submit(db, make_log(content_item_id=uuid.uuid4()))
        updates = db.updates_on("content_items")
        assert len(updates) == 1
        params = updates[0].compile().params
        assert 1 in params.values()  # stat_total +1, stat_correct +1

    def test_생성_문항은_통계_UPDATE_없음(self):
        db = FakeDB()
        submit(db, make_log(content_item_id=None))
        assert db.updates_on("content_items") == []

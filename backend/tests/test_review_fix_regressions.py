"""웨이브 1 리뷰 확정 결함의 회귀 방지 테스트 (S9).

- 리뷰 1번(멱등 가드·세션 XP 누적을 서비스 층으로): 재제출 가드는 채점·XP·
  weak_tags·통계·세션 XP 등 **모든 부수효과가 0**이어야 하고, 세션 문항을
  공통 파이프라인(submit_answer_for_log)으로 제출하면 sessions.xp_total이
  누적되어야 한다. (레거시 /quiz 라우터는 제거 — 파이프라인 불변식만 상주.)

DB 없이 검증: FakeDB가 select 대상 테이블별로 준비된 객체를 돌려주고
실행된 statement를 수집한다. 외부 호출(날씨·RAG)은 monkeypatch로 대체
(기존 test_answer_service.py 패턴 준수).
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import Select, Update

from app.models.quiz_log import QuizLog
from app.services import answer_service
from app.services.answer_service import AlreadyAnsweredError


class FakeResult:
    def __init__(self, value=None, rows=None):
        self._value = value
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._value

    def all(self):
        return list(self._rows)


class FakeDB:
    """select 대상 테이블별 반환값을 갖고, 실행 statement를 수집하는 대역."""

    def __init__(self, quiz_log=None, abilities=None):
        self.quiz_log = quiz_log
        # user_concept_ability 행 튜플 (concept_tag, theta, theta_se, num_responses)
        # — θ 파생 약점 판정(R8-01 §3.5)의 load_abilities가 읽는다
        self.abilities = abilities or []
        self.executed = []
        self.added = []
        self.get_calls = 0

    async def execute(self, stmt):
        self.executed.append(stmt)
        if isinstance(stmt, Select):
            table = stmt.get_final_froms()[0].name
            if table == "quiz_logs":
                return FakeResult(self.quiz_log)
            if table == "user_concept_ability":
                return FakeResult(rows=self.abilities)
        return FakeResult()

    async def get(self, model, pk):
        self.get_calls += 1
        return None  # add_xp 생략 경로 (XP 계산 자체가 검증 대상)

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


def make_log(user_id=None, session_id=None, content_item_id=None, answered=False) -> QuizLog:
    return QuizLog(
        user_id=user_id or uuid.uuid4(),
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
        elapsed_sec=12 if answered else None,
    )


class TestResubmitZeroSideEffects:
    """리뷰 1번 회귀: 재제출 가드는 부수효과(XP·weak_tags·통계·세션 XP) 0을 보장."""

    def test_재제출시_DB_상호작용_전무(self):
        db = FakeDB()
        log = make_log(answered=True, session_id=uuid.uuid4(), content_item_id=uuid.uuid4())
        user = SimpleNamespace(id=log.user_id, xp=100)

        with pytest.raises(AlreadyAnsweredError):
            asyncio.run(
                answer_service.submit_answer_for_log(db, user, log, "지열", None)
            )

        assert db.executed == []      # weak_tags 조회·upsert, 통계·세션 XP UPDATE 없음
        assert db.added == []         # user XP 가산 없음
        assert db.get_calls == 0      # User 로드조차 없음
        assert user.xp == 100

    def test_재제출시_로그_필드_불변(self):
        log = make_log(answered=True)
        before = (log.user_answer, log.is_correct, log.elapsed_sec, log.answered_at)

        with pytest.raises(AlreadyAnsweredError):
            asyncio.run(
                answer_service.submit_answer_for_log(
                    FakeDB(), SimpleNamespace(id=log.user_id), log, "다른 답", 99
                )
            )

        assert (log.user_answer, log.is_correct, log.elapsed_sec, log.answered_at) == before

    def test_is_correct만_기록된_로그도_가드(self):
        """user_answer 또는 is_correct 어느 한쪽이라도 기록되어 있으면 재제출."""
        log = make_log()
        log.is_correct = False  # user_answer는 None
        with pytest.raises(AlreadyAnsweredError):
            asyncio.run(
                answer_service.submit_answer_for_log(
                    FakeDB(), SimpleNamespace(id=log.user_id), log, "답", None
                )
            )


def _submit(db, log, answer="수증기 응결열"):
    """세션 문항을 공통 채점 파이프라인으로 직접 제출."""
    user = SimpleNamespace(id=log.user_id, level_group="middle_high")
    return asyncio.run(
        answer_service.submit_answer_for_log(db, user, log, answer, None)
    )


class TestSessionXpAccrual:
    """리뷰 확정 1번 회귀: 공통 파이프라인 제출 시 세션 XP가 누적된다."""

    def test_제출시_sessions_xp_total_누적(self):
        session_id = uuid.uuid4()
        log = make_log(session_id=session_id)
        db = FakeDB(quiz_log=log)

        result = _submit(db, log)

        assert result.is_correct is True
        updates = db.updates_on("sessions")
        assert len(updates) == 1, "세션 XP 원자 UPDATE가 발행돼야 함"
        params = updates[0].compile().params
        assert result.xp_earned in params.values()
        assert session_id in params.values()

    def test_약점_보너스도_세션에_그대로_누적(self):
        """세션 누적액 = xp_earned (약점 1.5배 반영 후 금액) — 불일치 방지.

        약점 판정은 θ 파생(R8-01 §3.5): middle_high 임계 ≈ 0.405, θ=-1.0·n>0 → 약점.
        """
        session_id = uuid.uuid4()
        log = make_log(session_id=session_id)
        db = FakeDB(quiz_log=log, abilities=[("typhoon", -1.0, 0.3, 4)])

        result = _submit(db, log)

        assert result.xp_earned == 22  # (10+5)*1.5 반올림 — 07번 약점 극복 보너스
        params = db.updates_on("sessions")[0].compile().params
        assert 22 in params.values()

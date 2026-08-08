"""일일 목표 카운트의 하루 경계 — R13 CO-T-2. DB 불필요.

`progress.py:_count_answered_today`의 독스트링은 *"`_today_facts` 관례를 그대로
따른다"*고 **단정**한다. 그 단정이 거짓이면(한쪽만 KST 윈도우) 다음 수정자가 대조를
생략한다 — CO-T-2가 잡은 결함이다. 여기서는 두 함수가 **같은 경계 함수에서 나온 같은
구간**을 SQL에 내리는지를 문(statement) 수준에서 직접 대조해 독스트링을 계약으로 만든다.

배치고사 제외(R10-01 D10-2)는 그대로 유지되어야 한다 — 그 필터가 사라지면 목표 설정
직후 "6/3 달성"이 뜬다.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.routers import progress as progress_router
from app.services import placement_service, quest_service
from tests.test_quest_kst_day import (
    FakeDB,
    datetime_binds,
    entity_name,
    params_of,
    patch_weak,
    sql_of,
)

DAY = date(2026, 8, 7)
KST_0200 = datetime(2026, 8, 6, 17, 0, tzinfo=timezone.utc)  # = 8/7 02:00 KST


def _count_stmt(db: FakeDB):
    """실행된 문 중 quiz_logs 집계(count) 하나."""
    return next(s for s in db.statements if "count(*)" in sql_of(s))


def _run_count():
    db = FakeDB()
    user = SimpleNamespace(id=uuid.uuid4())
    total = asyncio.run(progress_router._count_answered_today(db, user, DAY))
    return db, user, total


class TestCountAnsweredTodayWindow:
    def test_KST_당일_구간을_SQL로_내린다(self):
        db, _user, total = _run_count()
        assert total == 0
        assert datetime_binds(_count_stmt(db)) == list(
            quest_service.kst_day_window(DAY)
        )

    def test_퀘스트_집계와_같은_경계를_쓴다(self, monkeypatch):
        """CO-T-2 독스트링을 계약화 — 두 함수의 구간 바인드가 바이트 동일해야 한다."""
        patch_weak(monkeypatch)
        facts_db = FakeDB()
        asyncio.run(
            quest_service._today_facts(facts_db, SimpleNamespace(id=uuid.uuid4()), DAY)
        )
        count_db, _user, _total = _run_count()
        assert datetime_binds(_count_stmt(count_db)) == datetime_binds(
            facts_db.first_of("QuizLog")
        )

    def test_새벽_2시_응답이_오늘_카운트_구간에_든다(self):
        db, _user, _total = _run_count()
        start, end = datetime_binds(_count_stmt(db))
        assert start <= KST_0200 < end

    def test_세션_소속으로_오늘을_가르지_않는다(self):
        """CO-T-3: 자정을 넘겨 푼 문항이 session_date 때문에 누락되면 안 된다."""
        db, _user, _total = _run_count()
        sql = sql_of(_count_stmt(db))
        assert "session_date" not in sql
        assert "answered_at" in sql


class TestPlacementStillExcluded:
    def test_배치고사_세션_로그는_빠진다(self):
        db, _user, _total = _run_count()
        sql = sql_of(_count_stmt(db))
        assert "sessions.mode" in sql
        assert "NOT IN" in sql.upper()
        assert placement_service.MODE_PLACEMENT in params_of(_count_stmt(db)).values()

    def test_세션_밖_로그는_NULL_분기로_통과한다(self):
        """보드 등 session_id IS NULL 로그가 NOT IN의 NULL 삼값논리에 먹히면 안 된다."""
        sql = sql_of(_count_stmt(_run_count()[0]))
        assert "session_id IS NULL" in sql

    def test_유저_스코프가_집계와_배치고사_서브쿼리_모두에_걸린다(self):
        db, user, _total = _run_count()
        stmt = _count_stmt(db)
        assert list(params_of(stmt).values()).count(user.id) == 2


class TestNoRegressionOnEntity:
    def test_집계는_quiz_logs_한_번만_읽는다(self):
        db, _user, _total = _run_count()
        assert len(db.statements) == 1
        assert entity_name(db.statements[0]) == "Select"  # select(func.count())

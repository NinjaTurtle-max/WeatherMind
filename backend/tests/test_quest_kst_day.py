"""퀘스트 하루 경계·귀속·동시성 회귀 — R13 CO-T-1·T-2·T-3·T-7·T-14. DB 불필요.

test_quest_recalc.py가 순수 함수(recompute_progress·plan_transitions)를 지키는 반면
여기서는 **DB 결합부의 계약**을 지킨다. 실DB 없이 검증하기 위해 FakeDB가 실행된
SQLAlchemy 문(statement)을 그대로 보관하고, 테스트는 그 문에서 바인드된 시각 구간과
락 절을 읽어 판정한다 — "코드가 어떤 질의를 내는가"가 곧 계약이기 때문이다.

지키는 것:
- CO-T-1: 하루 경계가 KST다. 00:00~09:00 KST 응답(=UTC로는 전날 15:00~24:00)이
  오늘 집계에 든다. `answered_at.date() == today`는 이 구간을 통째로 놓친다.
- CO-T-3: 퀘스트 행 귀속일은 **재계산 시각의 KST 날짜**다. 자정을 넘겨 끝난 세션의
  `session_date`(어제)를 넘겨받아도 어제 행을 되살리지 않는다(일일 퀘스트 2세트 차단).
- CO-T-7: 재계산은 유저 행 락을 **먼저** 잡는다(완료 버튼 더블클릭 이중 지급 차단).
- CO-T-14: 날짜 필터가 SQL WHERE에 있다(전체 quiz_logs 로드 금지).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from app.models.quest import UserQuestProgress
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.services import quest_service

# 고정 기준일 — 새벽 창(00:00~09:00 KST)이 UTC 전날로 넘어가는 날.
DAY = date(2026, 8, 7)
KST_0200 = datetime(2026, 8, 6, 17, 0, tzinfo=timezone.utc)   # = 8/7 02:00 KST
KST_2300_YESTERDAY = datetime(2026, 8, 6, 14, 0, tzinfo=timezone.utc)  # = 8/6 23:00 KST


# ═══════════════════════════════════════════════════════════════
# FakeDB — 실행된 문을 보관하고 미리 정한 행을 돌려준다
# ═══════════════════════════════════════════════════════════════


def entity_name(stmt) -> str:
    """문이 겨냥한 ORM 엔티티 이름 (select 계열만 — 그 외는 타입명)."""
    try:
        descriptions = stmt.column_descriptions
    except Exception:  # update()/insert() 등
        descriptions = None
    if descriptions:
        entity = descriptions[0].get("entity")
        if entity is not None:
            return entity.__name__
    return type(stmt).__name__


def sql_of(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


def params_of(stmt) -> dict:
    return dict(stmt.compile(dialect=postgresql.dialect()).params)


def datetime_binds(stmt) -> list[datetime]:
    return sorted(v for v in params_of(stmt).values() if isinstance(v, datetime))


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._rows[0] if self._rows else 0


class FakeDB:
    """엔티티 이름 → 반환 행. 실행된 문은 `statements`에 순서대로 쌓인다."""

    def __init__(self, rows: dict[str, list] | None = None):
        self.rows = rows or {}
        self.statements: list = []
        self.added: list = []
        self.flushes = 0

    async def execute(self, stmt):
        self.statements.append(stmt)
        return _Result(self.rows.get(entity_name(stmt), []))

    def add(self, obj):
        self.added.append(obj)
        # 후속 재계산이 방금 만든 행을 보도록 — 같은 트랜잭션 내 재조회 근사
        self.rows.setdefault("UserQuestProgress", []).append(obj)

    async def flush(self):
        self.flushes += 1

    def first_of(self, name: str):
        return next(s for s in self.statements if entity_name(s) == name)

    def index_of(self, name: str) -> int:
        return next(
            i for i, s in enumerate(self.statements) if entity_name(s) == name
        )


def fake_user():
    return SimpleNamespace(id=uuid.uuid4(), level_group="elementary")


def quest_rows():
    return [
        SimpleNamespace(
            id=uuid.uuid4(),
            code=code,
            title=quest_service.QUEST_DEFS[code]["title"],
            xp_reward=quest_service.QUEST_DEFS[code]["xp_reward"],
        )
        for code in quest_service.QUEST_ORDER
    ]


def log(answered_at, *, correct=True, session_id=None):
    return QuizLog(
        user_id=uuid.uuid4(),
        session_id=session_id,
        content_item_id=None,
        quiz_id="q",
        concept_tag="pressure_front",
        question_type="board",
        question_json={},
        is_correct=correct,
        answered_at=answered_at,
    )


def patch_weak(monkeypatch, weak: set[str] | None = None):
    async def _weak(db, user):
        return weak or set()

    monkeypatch.setattr(quest_service, "_weak_concepts", _weak)


# ═══════════════════════════════════════════════════════════════
# CO-T-1 — 하루 경계는 KST (순수 계산)
# ═══════════════════════════════════════════════════════════════


class TestKstDayWindow:
    def test_KST_당일_구간은_UTC_전날_15시부터_당일_15시까지(self):
        assert quest_service.kst_day_window(DAY) == (
            datetime(2026, 8, 6, 15, 0, tzinfo=timezone.utc),
            datetime(2026, 8, 7, 15, 0, tzinfo=timezone.utc),
        )

    def test_경계는_session_service가_단일_소유한다(self):
        """상수 사본 금지 — 시작 경계는 kst_day_start_utc가 계산한 값 그대로."""
        from app.services import session_service

        start, end = quest_service.kst_day_window(DAY)
        assert start == session_service.kst_day_start_utc(DAY)
        assert end == session_service.kst_day_start_utc(DAY + timedelta(days=1))

    def test_새벽_2시_KST_응답이_오늘_구간에_든다(self):
        """CO-T-1 재현: 옛 판정식 `answered_at.date() == today`는 이 응답을 놓쳤다."""
        start, end = quest_service.kst_day_window(DAY)
        assert start <= KST_0200 < end            # 새 판정 — 오늘
        assert KST_0200.date() != DAY             # 옛 판정 — 어제로 샜다

    def test_어제_23시_KST_응답은_오늘_구간_밖(self):
        start, _end = quest_service.kst_day_window(DAY)
        assert KST_2300_YESTERDAY < start

    def test_구간은_반열린_자정_정각은_다음날(self):
        _start, end = quest_service.kst_day_window(DAY)
        assert quest_service.kst_day_window(DAY + timedelta(days=1))[0] == end


# ═══════════════════════════════════════════════════════════════
# CO-T-1·T-14 — 날짜 필터가 SQL에 있고 KST 구간이다
# ═══════════════════════════════════════════════════════════════


class TestTodayFactsQuery:
    def _quiz_log_stmt(self, monkeypatch):
        patch_weak(monkeypatch)
        db = FakeDB()
        asyncio.run(quest_service._today_facts(db, fake_user(), DAY))
        return db, db.first_of("QuizLog")

    def test_quiz_logs_질의가_KST_구간을_WHERE로_내린다(self, monkeypatch):
        """CO-T-14: 전체 로드 후 파이썬 필터 금지 — 경계가 바인드로 들어가야 한다."""
        _db, stmt = self._quiz_log_stmt(monkeypatch)
        assert datetime_binds(stmt) == list(quest_service.kst_day_window(DAY))

    def test_새벽_보드_응답이_그_구간에_실제로_든다(self, monkeypatch):
        """질의가 실제로 CO-T-1의 응답을 잡는지 — 바인드된 구간으로 직접 판정."""
        _db, stmt = self._quiz_log_stmt(monkeypatch)
        start, end = datetime_binds(stmt)
        assert start <= KST_0200 < end

    def test_세션_로그도_answered_at으로_귀속한다(self, monkeypatch):
        """CO-T-3: session_date 분기 제거 — sessions를 조회하지 않는다."""
        db, stmt = self._quiz_log_stmt(monkeypatch)
        assert not any(entity_name(s) == "Session" for s in db.statements)
        assert "session_date" not in sql_of(stmt)

    def test_응답_완료분만_센다(self, monkeypatch):
        _db, stmt = self._quiz_log_stmt(monkeypatch)
        assert "is_correct IS NOT NULL" in sql_of(stmt)

    def test_구간_안_로그가_AnswerFact로_나온다(self, monkeypatch):
        patch_weak(monkeypatch)
        db = FakeDB({"QuizLog": [log(KST_0200), log(KST_0200, correct=False)]})
        facts = asyncio.run(quest_service._today_facts(db, fake_user(), DAY))
        assert [f.is_correct for f in facts] == [True, False]


# ═══════════════════════════════════════════════════════════════
# CO-T-3 — 귀속일은 재계산 시각(KST)
# ═══════════════════════════════════════════════════════════════


class TestQuestAttributionDay:
    def _run(self, monkeypatch, caller_day):
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        db = FakeDB({"Quest": quest_rows(), "QuizLog": []})
        asyncio.run(quest_service.recalculate_quests(db, fake_user(), caller_day))
        return db

    def test_어제_session_date로_불려도_오늘_행에_귀속(self, monkeypatch):
        """CO-T-3: 23:55 발급 → 00:05 완료 세션이 어제 퀘스트 행을 되살리면 안 된다."""
        yesterday = DAY - timedelta(days=1)
        db = self._run(monkeypatch, yesterday)
        assert db.added, "첫 재계산은 오늘 행을 새로 만든다"
        assert all(row.quest_date == DAY for row in db.added)
        assert yesterday not in params_of(db.first_of("UserQuestProgress")).values()

    def test_집계_구간도_오늘_KST다(self, monkeypatch):
        db = self._run(monkeypatch, DAY - timedelta(days=1))
        assert datetime_binds(db.first_of("QuizLog")) == list(
            quest_service.kst_day_window(DAY)
        )

    def test_today_생략_호출이_기본값(self, monkeypatch):
        """호출부가 날짜를 넘기지 않아도 동작해야 한다(session.py 정리 후 대비)."""
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        db = FakeDB({"Quest": quest_rows(), "QuizLog": []})
        asyncio.run(quest_service.recalculate_quests(db, fake_user()))
        assert all(row.quest_date == DAY for row in db.added)


# ═══════════════════════════════════════════════════════════════
# CO-T-7 — 더블클릭 이중 지급
# ═══════════════════════════════════════════════════════════════


class TestDoubleSubmitGuard:
    def _db_with_full_day(self):
        # 정답 2문항 = 30 XP → daily_xp_30·(약점 아님) 완료 전환이 일어나는 상태
        return FakeDB(
            {
                "Quest": quest_rows(),
                "QuizLog": [log(KST_0200), log(KST_0200)],
            }
        )

    def test_유저_행_락을_먼저_잡는다(self, monkeypatch):
        """CO-T-7: SELECT-then-UPDATE 사이 끼어들기 차단은 행 락이 유일하다."""
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        db = self._db_with_full_day()
        asyncio.run(quest_service.recalculate_quests(db, fake_user(), DAY))

        first = db.statements[0]
        assert entity_name(first) == "User"
        assert first._for_update_arg is not None, "유저 행 락(FOR UPDATE) 부재"
        assert "FOR UPDATE" in sql_of(first)
        # 락은 진행도 조회보다 앞서야 한다 — 뒤면 두 요청이 같은 prior_done을 읽는다
        assert db.index_of("User") < db.index_of("UserQuestProgress")
        assert db.index_of("User") < db.index_of("QuizLog")

    def test_락_대상은_현재_유저_행(self, monkeypatch):
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        user = fake_user()
        db = self._db_with_full_day()
        asyncio.run(quest_service.recalculate_quests(db, user, DAY))
        assert user.id in params_of(db.statements[0]).values()

    def test_두번_호출해도_보상은_1회(self, monkeypatch):
        """완료 버튼 더블클릭 회귀 — 두번째 재계산은 XP를 더 주지 않는다."""
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        granted: list[int] = []

        async def fake_add_xp(db, user_id, amount):
            granted.append(amount)
            return amount

        monkeypatch.setattr(quest_service.xp_service, "add_xp", fake_add_xp)

        db = self._db_with_full_day()
        user = fake_user()
        first = asyncio.run(quest_service.recalculate_quests(db, user, DAY))
        after_first = list(granted)
        second = asyncio.run(quest_service.recalculate_quests(db, user, DAY))

        assert sum(t.reward_xp for t in first) == 10   # daily_xp_30만 완료
        assert sum(t.reward_xp for t in second) == 0   # 재지급 없음
        assert granted == after_first == [10]
        # 행이 중복 생성되지 않는다 — 두번째는 첫 행을 재사용
        assert len(db.added) == len(quest_service.QUEST_ORDER)

    def test_quests_시드가_없으면_무동작(self, monkeypatch):
        patch_weak(monkeypatch)
        monkeypatch.setattr(quest_service, "kst_today", lambda: DAY)
        db = FakeDB({"Quest": []})
        assert asyncio.run(quest_service.recalculate_quests(db, fake_user())) == []
        assert db.added == []


# ═══════════════════════════════════════════════════════════════
# 모델 계약 — 하루 1행 보장(락과 함께 이중 지급을 막는 반쪽)
# ═══════════════════════════════════════════════════════════════


class TestUniqueRowContract:
    def test_유저_퀘스트_일자_UNIQUE가_살아있다(self):
        names = {
            c.name
            for c in UserQuestProgress.__table__.constraints
            if c.name is not None
        }
        assert "uq_user_quest_progress_daily" in names

    def test_users_테이블에_락을_걸_수_있다(self):
        assert User.__table__.name == "users"

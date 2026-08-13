"""하루 첫 유닛 세션의 **daily 배합 폴백** — 2026-08-13 코드 리뷰 결함 ②·③.

`curriculum_service.create_unit_session`의 첫 세션 분기는 daily 배합을 받아 오고,
실패하면 유닛 풀(`_unit_content_pool`)로 내려앉는다. 그 폴백에 결함이 둘 있었다.

**결함 ② — 빈 배합이 0문항 세션을 냈다.**
가드가 `if entries is None:`이라 `plan_daily_picks`가 **예외를 던질 때만** 폴백했다.
성공했지만 픽이 0건이면 `entries == []`라서 폴백을 안 타고 **0문항 세션이 발급**됐다.
도달 경로는 평범하다: 오래 쓴 학습자의 `served` 집합이 비실황 뱅크를 덮고 · 약점
개념 없음 · 오늘 실황 이미 응답 · θ에 맞는 보드 풀 없음. 프론트의 자동완료
이펙트가 `total > 0`으로 막혀 있어(CO-H12) 학습자는 **빈 세션에서 나갈 길이 없다.**

**결함 ③ — 폴백이 스스로 500을 냈다.**
`plan_daily_picks`는 **같은 `AsyncSession`으로 여러 문을 실행한다**
(`_load_weak_tag_rows`·`refresh_abilities`·`_fetch_pools`·`_fetch_board_pool`).
그중 하나가 SQLAlchemy 오류를 내면 트랜잭션이 이미 죽어 있고, `except` 가지가
같은 세션으로 `_unit_content_pool`을 부르는 순간 `PendingRollbackError` → 500이다.
**폴백이 막으려던 바로 그 일이 폴백 때문에 일어난다.** 수리는 `db.begin_nested()`
세이브포인트이고, **넓은 catch는 그대로 둔다** — 예외 종류를 열거하는 대안은
하나만 빠뜨려도 다시 500이 난다.

⚠️ **③의 대역은 「죽은 트랜잭션」을 진짜로 흉내 낸다.** 그냥 예외만 던지는 대역
DB로는 `PendingRollbackError`가 원리적으로 안 나므로 세이브포인트를 떼도 초록이고,
**계약이 조용히 헛돈다.** 그래서 `_FallbackDB`는 `broken` 플래그를 갖고, 깨진 뒤의
`execute`는 실제로 `PendingRollbackError`를 던지며, 세이브포인트 대역만이 그것을
되돌린다(진짜 `ROLLBACK TO SAVEPOINT`가 하는 일).

DB·Redis 불필요.
"""
from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError, PendingRollbackError

from app.services import curriculum_service as cs
from app.services import session_service as ss

TODAY = date(2026, 8, 13)


# ══════════════════════════════════════════════════════════════════════════
# 대역
# ══════════════════════════════════════════════════════════════════════════


def item(n: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type="short_answer",
        level_group="adult",
        knowledge_level=4,
        uses_live_slots=False,
        template_json={"question_text": f"문항 {n}", "correct_answer": "상승"},
    )


class _Result:
    def __init__(self, rows=(), scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one(self):
        return self._scalar


class _Savepoint:
    """`db.begin_nested()` 대역 — 진짜 세이브포인트의 두 성질을 그대로 갖는다.

    ⑴ 예외로 빠져나가면 **`ROLLBACK TO SAVEPOINT`**가 나가 세션이 되살아난다
       (여기서는 `broken = False`).
    ⑵ **예외를 삼키지 않는다**(`__aexit__`가 False를 돌려준다) — 삼키면
       `create_unit_session`의 `except` 가지가 안 돌아 폴백 자체가 검증되지 않는다.
    """

    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.db.broken = False
            self.db.rolled_back += 1
        return False


class _FallbackDB:
    """**죽은 트랜잭션 의미론**을 가진 대역 DB.

    `broken`이 서면 이후 모든 `execute`가 `PendingRollbackError`를 던진다 — 실제
    `AsyncSession`이 실패한 문 뒤에 하는 일과 같다. 세이브포인트 대역만이 그것을
    되돌리므로, `create_unit_session`에서 `async with db.begin_nested():`를 떼면
    이 파일의 ③ 계약이 **실제로 빨개진다**.
    """

    def __init__(self, *, rows=(), unit_sessions_today=0):
        self.rows = list(rows)
        self.unit_sessions_today = unit_sessions_today
        self.broken = False
        self.rolled_back = 0
        self.added: list = []

    async def execute(self, stmt):
        if self.broken:
            raise PendingRollbackError(
                "이 트랜잭션은 롤백되기 전까지 새 문을 실행할 수 없다"
            )
        text = str(stmt)
        if text.lstrip().lower().startswith("select count"):
            if "FROM sessions" in text:
                return _Result(scalar=self.unit_sessions_today)
            return _Result(scalar=0)
        if "FROM weak_tags" in text:
            return _Result([])
        return _Result(self.rows)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    def begin_nested(self):
        return _Savepoint(self)


USER = SimpleNamespace(id=uuid.uuid4(), level_group="adult", region="서울")
UNIT = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-pressure", kind="quiz",
    concept_tag="pressure_front",
)


def run(db):
    return asyncio.run(cs.create_unit_session(db, USER, UNIT, TODAY, abilities=[]))


# ══════════════════════════════════════════════════════════════════════════
# 결함 ② — 빈 배합도 폴백을 탄다
# ══════════════════════════════════════════════════════════════════════════


def empty_plan(monkeypatch):
    """배합이 **성공하고** 픽이 0건인 상황 — 예외가 아니라 빈 결과다."""

    async def _fake(db, user, today, *, abilities=None, target_level=None):
        return ss.DailyPlan(
            picks=[],
            generate_count=0,
            weather={},
            slot_values={},
            theta=None,
            route_decision={},
            block_unit=None,
            phenomenon=None,
            abilities=abilities or [],
        )

    monkeypatch.setattr(ss, "plan_daily_picks", _fake)


class TestEmptyRecipeFallsBackToUnitPool:
    def test_픽_0건이면_유닛_풀로_내려앉는다(self, monkeypatch):
        """종전에는 `entries == []`가 `is None` 가드를 통과해 **0문항 세션**이었다."""
        empty_plan(monkeypatch)
        _, entries = run(_FallbackDB(rows=[item(i) for i in range(10)]))
        assert len(entries) >= 1, "빈 배합이 그대로 0문항 세션이 됐다"
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert set(e["kind"] for e in entries) == {"unit"}

    def test_가드가_None이_아니라_빈_값을_본다(self, monkeypatch):
        """`is None`으로 되돌리면 이 단정이 먼저 운다 — 수리의 급소를 고정한다."""
        src = inspect.getsource(cs.create_unit_session)
        assert "if not entries:" in src
        assert "if entries is None:" not in src

    def test_도장은_여전히_True다(self, monkeypatch):
        """열화는 배합의 문제지 「오늘 첫 세션인가」의 문제가 아니다 — 빈 배합으로
        왕관을 뺏으면 학습자가 서버 사정으로 진도를 잃는다(장애 폴백과 같은 판정)."""
        empty_plan(monkeypatch)
        session, _ = run(_FallbackDB(rows=[item(0)]))
        assert session.recipe_json["daily_first"] is True

    def test_유닛_풀까지_비면_0문항_세션은_그대로_허용된다(self, monkeypatch):
        """**과잉 단정 금지.** 「0문항 세션은 절대 없다」로 못 박으면 CO-H12 판정
        (`test_curriculum_band_fallback.TestUnitSessionHasNoMinimumFloor`)과
        정면으로 충돌한다. 이 파일이 무는 것은 「폴백을 **타는가**」다."""
        empty_plan(monkeypatch)
        _, entries = run(_FallbackDB(rows=[]))
        assert entries == []


# ══════════════════════════════════════════════════════════════════════════
# 결함 ③ — 죽은 트랜잭션에서도 폴백이 산다
# ══════════════════════════════════════════════════════════════════════════


@pytest.fixture
def broken_pools(monkeypatch):
    """`_fetch_pools`가 **트랜잭션을 죽이면서** SQLAlchemy 오류를 낸다.

    상류(`decide_route`·`get_today_weather`)만 대역하고 `plan_daily_picks` 자체는
    **실물을 돌린다** — 결함의 본질이 "그 함수가 같은 세션으로 여러 문을 실행하다
    중간에 죽는다"이므로, 함수째 대역하면 재현하는 것이 아무것도 없다.
    """

    async def _fake_route(db, user, weak_tag_rows=None, abilities=None):
        return {}

    async def _fake_weather(region=None):
        return {}

    async def _boom(db, *args, **kwargs):
        db.broken = True  # 실패한 문이 트랜잭션을 죽인다
        raise OperationalError("SELECT content_items…", {}, Exception("conn reset"))

    monkeypatch.setattr(ss, "decide_route", _fake_route)
    monkeypatch.setattr(ss, "get_today_weather", _fake_weather)
    monkeypatch.setattr(ss, "_fetch_pools", _boom)


class TestSavepointKeepsFallbackUsable:
    def test_배합_중_DB_오류에도_세션이_발급된다(self, broken_pools):
        """세이브포인트가 없으면 폴백의 첫 `execute`가 `PendingRollbackError`를
        던져 **500**이 된다 — 폴백이 막으려던 바로 그 일이다."""
        db = _FallbackDB(rows=[item(i) for i in range(10)])
        session, entries = run(db)
        assert session.mode == cs.MODE_UNIT
        assert len(entries) == cs.UNIT_SESSION_SIZE

    def test_PendingRollbackError가_새어_나오지_않는다(self, broken_pools):
        db = _FallbackDB(rows=[item(i) for i in range(10)])
        try:
            run(db)
        except PendingRollbackError as exc:  # pragma: no cover - 회귀 시에만
            pytest.fail(f"폴백이 죽은 트랜잭션을 그대로 다시 썼다: {exc}")

    def test_세이브포인트가_실제로_되감았다(self, broken_pools):
        """되감기가 **일어났는지**를 대역이 센다 — 「예외를 잡았다」와 「세션을
        되살렸다」는 다르고, 500을 가르는 것은 뒤쪽이다."""
        db = _FallbackDB(rows=[item(0)])
        run(db)
        assert db.rolled_back == 1
        assert db.broken is False

    def test_도장은_True로_남는다(self, broken_pools):
        """외부 장애가 왕관을 뺏지 않는다(기존 PM 판정 ⓐ의 연장)."""
        db = _FallbackDB(rows=[item(0)])
        session, _ = run(db)
        assert session.recipe_json["daily_first"] is True

    def test_세이브포인트가_배합_호출을_감싼다(self):
        """소스 계약 — 세이브포인트가 `plan_daily_picks` **바깥**에 있어야 한다.
        안쪽(예: `_fetch_pools`만)에 걸면 다른 문이 죽는 경로가 그대로 남는다."""
        src = inspect.getsource(cs.create_unit_session)
        assert "db.begin_nested()" in src
        assert src.index("db.begin_nested()") < src.index(
            "session_service.plan_daily_picks("
        )

    def test_넓은_catch를_예외_열거로_좁히지_않았다(self):
        """예외 종류를 나열하는 대안은 하나만 빠뜨려도 다시 500이 난다 —
        되돌리는 사람이 이 단정에서 먼저 멈추게 한다."""
        src = inspect.getsource(cs.create_unit_session)
        assert "except Exception as exc:" in src

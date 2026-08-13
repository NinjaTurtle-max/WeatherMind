"""**하루의 첫 유닛 세션이 곧 데일리 세션이다** — 2026-08-13 클라이언트 확정.

DB·Redis 불필요(대역 DB + monkeypatch).

| | 문항 수 | 배합 | 왕관 |
|---|---|---|---|
| 하루 **첫** 유닛 세션 | **10** | `실황2·신규4·복습3·보드1` | **준다**(만점 시) |
| **두 번째 이후** | `UNIT_SESSION_SIZE`(4) | 실황 0 · 보드 0 — 순수 학습 | 안 준다 |

⚠️ **「두 번째 이후는 현행 유지」가 아니다.** 종전 4문항은 실황 2 + 일반 2였고,
그 화면이 바로 클라이언트가 「2+4+3+1인데 왜 2+2로 뜨니」라고 지적한 대상이다.

**설계의 핵심은 판정 시점**이다. 「오늘 첫 세션인가」를 **발급 시점**에 판정해
`recipe_json["daily_first"]`에 도장으로 남기고, 완료 경로(왕관)는 **읽기만** 한다.
완료 시점에 재계산하면 두 유닛을 열어 **역순으로** 완료할 때 둘 다 첫 세션이 되거나
둘 다 아니게 된다 — 그 경합을 이 파일이 `TestStampIsWrittenAtIssue`로 문다.

곁들여 두 계약을 더 소유한다:
  · `TestRecipeJsonKeySet` — **`recipe_json`에 예상 못 한 키가 붙는 것을 막는다.**
    `test_curriculum_band_fallback.py`가 dict 동등으로 갖고 있던 감시를 도장 도입과
    함께 여기로 옮겼다(2026-08-13 PM 조건 ⑴). 그 자리를 비우면 아무도 안 본다.
  · `TestDegradedFirstSessionStillGrantsCrown` — **외부 장애가 왕관을 뺏지 않는다**
    (PM 조건 ⑵). 도장의 뜻은 「오늘의 첫 유닛 세션이다」라는 **사실**이지
    「daily 배합을 실제로 받았다」는 **결과**가 아니다.
"""
from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import curriculum_service as cs
from app.services import session_service as ss

TODAY = date(2026, 8, 13)
RECIPE_TOTAL = sum(settings.SESSION_RECIPE.values())


# ══════════════════════════════════════════════════════════════════════════
# 대역
# ══════════════════════════════════════════════════════════════════════════


def item(n: int, *, question_type="short_answer", live=False) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type=question_type,
        level_group="adult",
        knowledge_level=4,
        uses_live_slots=live,
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

    def scalar_one(self):
        return self._scalar


class _DB:
    """대역 DB — 「오늘 이미 발급된 유닛 세션 수」를 마음대로 정할 수 있다.

    `FROM sessions`인 count 질의만 그 값을 답하고, 나머지 count(`allocate_quiz_ids`의
    채번 조회)는 0이다. 두 질의를 갈라 놓지 않으면 채번이 첫 세션 판정을 오염시킨다.
    """

    def __init__(self, *, unit_sessions_today=0, rows=()):
        self.unit_sessions_today = unit_sessions_today
        self.rows = list(rows)
        self.session_count_queries: list[str] = []
        self.added: list = []

    async def execute(self, stmt):
        text = str(stmt)
        if text.lstrip().lower().startswith("select count"):
            if "FROM sessions" in text:
                self.session_count_queries.append(text)
                return _Result(scalar=self.unit_sessions_today)
            return _Result(scalar=0)
        return _Result(self.rows)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    def begin_nested(self):
        """세이브포인트 대역 (2026-08-13 결함 ③) — `plan_daily_picks`가 죽은
        트랜잭션을 남기지 않게 감싸는 자리다. **예외를 삼키지 않는다**: 삼키면
        폴백 분기가 안 돌아 아래 `TestDegradedFirstSessionStillGrantsCrown`이
        조용히 헛돈다. 되감기 의미론까지 무는 계약은
        `test_unit_session_daily_fallback.py`가 소유한다."""
        return _Savepoint()


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


USER = SimpleNamespace(id=uuid.uuid4(), level_group="adult", region="서울")
UNIT = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-pressure", kind="quiz",
    concept_tag="pressure_front",
)


def fake_plan(monkeypatch, *, generate_count=0):
    """`plan_daily_picks`를 배합 그대로의 산출물로 대역한다.

    실물은 KMA·Redis·ai-worker에 닿으므로 여기서는 **배선**만 본다 — 배합 선택
    로직 자체는 `test_session_mix`·`test_unit_block_recipe`가 이미 소유한다.
    picks의 kind 분포는 `SESSION_RECIPE`에서 그대로 파생시킨다(수치를 여기 적으면
    배합이 바뀔 때 이 파일이 조용히 낡는다).
    """
    picks = []
    n = 0
    for kind, count in settings.SESSION_RECIPE.items():
        for _ in range(count):
            n += 1
            picks.append(
                {
                    "kind": kind,
                    "item": item(
                        n, question_type="board" if kind == "board" else "short_answer"
                    ),
                }
            )

    async def _fake(db, user, today, *, abilities=None, target_level=None):
        return ss.DailyPlan(
            picks=picks,
            generate_count=generate_count,
            weather={},
            slot_values={},
            theta=None,
            route_decision={},
            block_unit=None,
            phenomenon=None,
            abilities=abilities or [],
        )

    monkeypatch.setattr(ss, "plan_daily_picks", _fake)
    return picks


def run(db, day: date = TODAY):
    return asyncio.run(cs.create_unit_session(db, USER, UNIT, day, abilities=[]))


# ══════════════════════════════════════════════════════════════════════════
# ⑴ 하루 첫 유닛 세션 = 데일리 배합 10문항
# ══════════════════════════════════════════════════════════════════════════


class TestFirstUnitSessionIsDaily:
    def test_첫_세션은_배합_총합만큼_나온다(self, monkeypatch):
        fake_plan(monkeypatch)
        session, entries = run(_DB(unit_sessions_today=0))
        assert len(entries) == RECIPE_TOTAL == 10
        assert session.mode == cs.MODE_UNIT
        assert session.unit_id == UNIT.id

    def test_첫_세션에_실황과_보드가_들어온다(self, monkeypatch):
        """확정 사양 「실황2·신규4·복습3·보드1」 — 두 블록이 **0이 아니어야** 한다.

        블록별 개수는 배합에서 파생시킨다. 여기 숫자를 적으면 배합이 바뀔 때
        이 테스트가 낡은 채로 초록이 된다.
        """
        fake_plan(monkeypatch)
        _, entries = run(_DB(unit_sessions_today=0))
        kinds = [e["kind"] for e in entries]
        for kind, expected in settings.SESSION_RECIPE.items():
            assert kinds.count(kind) == expected, f"{kind} 블록이 배합과 다르다"
        assert kinds.count("live") > 0 and kinds.count("board") > 0

    def test_첫_세션은_daily와_같은_함수로_조립된다(self, monkeypatch):
        """복사하면 두 화면이 갈린다 — 「유닛 세션이 곧 데일리 세션」이 거짓이 된다."""
        src = inspect.getsource(cs.create_unit_session)
        assert "session_service.plan_daily_picks" in src
        assert "session_service.entries_from_picks" in src
        assert "session_service.order_session_entries" in src

    def test_첫_세션에는_생성_폴백이_없다(self, monkeypatch):
        """뱅크가 모자라도 **유료 생성으로 메우지 않는다** — 유닛 세션에 생성
        폴백이 없다는 기존 계약(CO-H12)이 첫 세션에도 그대로 선다.
        무키 실운영에서 이 경로가 상시 과금 지점이 되는 것을 막는다."""
        fake_plan(monkeypatch, generate_count=3)
        _, entries = run(_DB(unit_sessions_today=0))
        assert len(entries) == RECIPE_TOTAL  # 대역 picks는 그대로, 생성분 0
        assert all(e["source"] == "bank" for e in entries)
        src = inspect.getsource(cs.create_unit_session)
        assert "quiz_generate" not in src and "ai_client" not in src


# ══════════════════════════════════════════════════════════════════════════
# ⑵ 두 번째 이후 — 실황 0 · 보드 0
# ══════════════════════════════════════════════════════════════════════════


class TestSecondUnitSessionIsPlainLearning:
    """⚠️ **「두 번째 세션」의 뜻이 2026-08-13에 좁아졌다**(코드 리뷰 결함 ①).

    종전에는 **같은 유닛에 다시 들어오는 것**(새로고침 포함)도 여기 들어왔다.
    그것이 바로 결함이었다 — 새로고침 한 번에 `daily_first=False` 도장이 다시
    찍혀 그날의 왕관이 막혔다. 이제 라우터가 오늘·같은 유닛의 **미완료** 세션을
    재사용하므로, 이 클래스가 재는 「두 번째 이후」는 실사용에서 둘 중 하나다:
      · **다른 유닛**을 같은 날 여는 것, 또는
      · 같은 유닛을 **완료한 뒤** 다시 여는 것(재도전).

    `create_unit_session`은 재사용 판정 **밖**의 함수라 여기서는 그대로
    「오늘 유닛 세션이 이미 n건」을 주고 두 번째 이후 동작만 본다. 재사용 자체는
    `test_unit_session_reuse.py`가 라우터 수준에서 소유한다.
    """

    def test_두_번째부터는_UNIT_SESSION_SIZE다(self, monkeypatch):
        fake_plan(monkeypatch)  # 대역이 걸려 있어도 첫 세션이 아니면 안 쓴다
        _, entries = run(_DB(unit_sessions_today=1, rows=[item(i) for i in range(10)]))
        assert len(entries) == cs.UNIT_SESSION_SIZE == 4

    def test_두_번째부터는_live도_board도_0건이다(self, monkeypatch):
        """확정 사양의 본문 — 「순수 학습만」."""
        fake_plan(monkeypatch)
        _, entries = run(_DB(unit_sessions_today=1, rows=[item(i) for i in range(10)]))
        kinds = [e["kind"] for e in entries]
        assert kinds.count("live") == 0, "두 번째 이후 세션에 실황이 섞였다"
        assert kinds.count("board") == 0, "두 번째 이후 세션에 보드가 섞였다"
        assert set(kinds) == {"unit"}
        assert all(e["slot_filled"] is False for e in entries)

    def test_두_번째부터는_daily_경로를_아예_안_탄다(self, monkeypatch):
        """대역이 불렸는지로 본다 — 「안 쓴다」와 「안 부른다」는 다르다.
        불러 놓고 버리면 KMA·Redis 왕복이 매 세션 그대로 남는다."""
        called = []

        async def _spy(db, user, today, *, abilities=None, target_level=None):
            called.append(True)
            raise AssertionError("두 번째 이후 세션이 daily 배합을 조회했다")

        monkeypatch.setattr(ss, "plan_daily_picks", _spy)
        run(_DB(unit_sessions_today=1, rows=[item(i) for i in range(10)]))
        assert called == []


# ══════════════════════════════════════════════════════════════════════════
# ⑶ 도장 — 발급 시점에 찍고 완료 시점은 읽기만
# ══════════════════════════════════════════════════════════════════════════


class TestStampIsWrittenAtIssue:
    def test_첫_세션에_True가_찍힌다(self, monkeypatch):
        fake_plan(monkeypatch)
        session, _ = run(_DB(unit_sessions_today=0))
        assert session.recipe_json["daily_first"] is True

    def test_두_번째_이후에_False가_찍힌다(self, monkeypatch):
        fake_plan(monkeypatch)
        session, _ = run(_DB(unit_sessions_today=1, rows=[item(0)]))
        assert session.recipe_json["daily_first"] is False

    def test_도장은_양쪽_분기_모두_찍힌다(self, monkeypatch):
        """한쪽만 찍으면 키 부재가 「첫 세션 아님」과 「옛 세션」 둘 다를 뜻하게 되고,
        라우터가 그 둘을 구분할 수 없다."""
        fake_plan(monkeypatch)
        for count in (0, 1, 5):
            session, _ = run(_DB(unit_sessions_today=count, rows=[item(0)]))
            assert "daily_first" in session.recipe_json

    def test_판정은_오늘_그_유저의_유닛_세션만_센다(self, monkeypatch):
        """질의가 세 조건(user·session_date·mode='unit')을 모두 걸어야 한다 —
        하나라도 빠지면 남의 세션이나 어제 세션이 오늘 첫 세션을 잡아먹는다."""
        fake_plan(monkeypatch)
        db = _DB(unit_sessions_today=0)
        run(db)
        assert db.session_count_queries, "첫 세션 판정 질의 자체가 없다"
        sql = db.session_count_queries[0]
        assert "sessions.user_id =" in sql
        assert "sessions.session_date =" in sql
        assert "sessions.mode =" in sql

    def test_하루_경계는_KST다(self):
        """`session_date`가 `datetime.now(KST).date()` 파생이라 경계가 컬럼에
        들어 있다. UTC 타임스탬프로 다시 비교하면 09:00 KST에 하루가 넘어간다 —
        목의 `KST_OFFSET_MS`가 지키는 것과 같은 계약이다."""
        src = inspect.getsource(cs.create_unit_session)
        assert "datetime.now(KST)" in src
        judge = inspect.getsource(cs.is_first_unit_session_today)
        assert "Session.session_date == today" in judge, (
            "판정이 session_date(KST 파생)가 아닌 다른 축을 본다"
        )

    def test_KST_자정_경계에서_첫_세션이_새로_열린다(self, monkeypatch):
        """어제 유닛 세션을 아무리 많이 해도 오늘의 첫 세션은 다시 첫 세션이다.

        대역 DB는 「그 날짜의」 세션 수를 답하므로, 날짜가 넘어가 0이 되는 상황을
        그대로 재현한다 — 실제로 날짜를 가르는 것은 `session_date` 컬럼이다.
        """
        fake_plan(monkeypatch)
        yesterday = TODAY - timedelta(days=1)
        # 어제: 이미 3번 했다 → 첫 세션 아님
        s_y, e_y = run(
            _DB(unit_sessions_today=3, rows=[item(i) for i in range(10)]), yesterday
        )
        assert s_y.recipe_json["daily_first"] is False
        assert len(e_y) == cs.UNIT_SESSION_SIZE
        # 오늘: 날짜가 넘어가 0건 → 다시 첫 세션이고 10문항
        s_t, e_t = run(_DB(unit_sessions_today=0), TODAY)
        assert s_t.recipe_json["daily_first"] is True
        assert len(e_t) == RECIPE_TOTAL
        assert s_y.session_date != s_t.session_date

    def test_완료_경로는_도장을_읽기만_한다(self):
        """라우터가 세션 수를 다시 세면 역순 완료에서 판정이 뒤집힌다."""
        router_src = inspect.getsource(
            __import__("app.routers.session", fromlist=["x"])
        )
        code = "\n".join(
            line
            for line in router_src.splitlines()
            if not line.lstrip().startswith("#")
        )
        assert 'get("daily_first")' in code
        assert "is_first_unit_session_today" not in code


# ══════════════════════════════════════════════════════════════════════════
# ⑷ PM 조건 ⑴ — recipe_json 키 집합 감시
#
# `test_curriculum_band_fallback.py`가 dict 동등으로 갖고 있던 「예상 못 한 키가
# 붙는다」 감시를 도장 도입과 함께 여기로 옮겼다(2026-08-13 PM 승인).
# ══════════════════════════════════════════════════════════════════════════


class TestRecipeJsonKeySet:
    """유닛 세션 `recipe_json`의 키 집합을 못 박는다.

    ⚠️ **리터럴로 적는다.** 이 dict에는 파생시킬 단일 소유자가 없다 — 키마다
    출처가 다르기 때문이다(`kind`·`unit_id`는 유닛, `daily_first`는 발급 시점
    판정, `recipe`는 `SESSION_RECIPE`, `items`는 entries). 억지로 파생시키면
    "테스트가 코드를 그대로 다시 쓰는" 자기 대조가 되고, 그것이 CO-J-9가 생긴
    방식이다. 대신 **키가 늘거나 줄면 반드시 여기가 먼저 울도록** 집합 동등으로
    둔다 — 새 키를 붙이는 사람이 그 키의 소비자를 밝히게 하는 것이 목적이다.
    """

    EXPECTED = {"kind", "unit_id", "daily_first", "recipe", "issued_count", "items"}

    def test_첫_세션_키_집합(self, monkeypatch):
        fake_plan(monkeypatch)
        session, _ = run(_DB(unit_sessions_today=0))
        assert set(session.recipe_json) == self.EXPECTED

    def test_두_번째_이후_키_집합도_같다(self, monkeypatch):
        """두 분기가 다른 키를 내면 `session_today_response`가 한쪽에서만 동작한다."""
        fake_plan(monkeypatch)
        session, _ = run(_DB(unit_sessions_today=1, rows=[item(0)]))
        assert set(session.recipe_json) == self.EXPECTED

    def test_0문항_세션도_같은_키를_낸다(self, monkeypatch):
        fake_plan(monkeypatch)
        session, entries = run(_DB(unit_sessions_today=1))
        assert entries == []
        assert set(session.recipe_json) == self.EXPECTED

    def test_items_메타가_화면_계약_4필드를_싣는다(self, monkeypatch):
        """`session_today_response`가 재조회 응답을 이 메타에서 복원한다 —
        빠지면 재진입 화면에서 블록 표기·치환 표시가 사라진다."""
        fake_plan(monkeypatch)
        session, _ = run(_DB(unit_sessions_today=0))
        for meta in session.recipe_json["items"]:
            assert set(meta) == {"quiz_id", "source", "slot_filled", "kind"}


# ══════════════════════════════════════════════════════════════════════════
# ⑸ PM 조건 ⑵ — 외부 장애가 왕관을 뺏지 않는다
#
# 도장의 뜻은 ⓐ「오늘의 첫 유닛 세션이다」(사실)이지 ⓑ「daily 배합을 실제로
# 받았다」(결과)가 아니다. ⓑ로 두면 KMA·Redis 장애가 학습자의 왕관을 뺏는데,
# 학습자는 이유를 알 길이 없고 화면에도 안 뜬다.
# ══════════════════════════════════════════════════════════════════════════


class TestDegradedFirstSessionStillGrantsCrown:
    @pytest.fixture
    def broken_daily(self, monkeypatch):
        """daily 배합 경로가 터지는 상황 — 무키·KMA 장애·Redis 캐시 장애."""
        async def _boom(db, user, today, *, abilities=None, target_level=None):
            raise RuntimeError("redis down")

        monkeypatch.setattr(ss, "plan_daily_picks", _boom)

    def test_배합이_터져도_세션은_발급된다(self, broken_daily):
        """유닛 진입이 서버 사정으로 막히면 학습 자체가 멈춘다 — 철거된
        `unit_slot_values`가 갖고 있던 계약을 그대로 이어받는다."""
        _, entries = run(_DB(unit_sessions_today=0, rows=[item(i) for i in range(10)]))
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert set(e["kind"] for e in entries) == {"unit"}

    def test_배합이_터져도_daily_first는_True로_남는다(self, broken_daily):
        """**PM 판정 ⓐ** — 도장은 「오늘의 첫 세션이다」라는 사실의 기록이다.
        여기서 False로 내려가면 외부 장애가 왕관을 뺏는다."""
        session, _ = run(_DB(unit_sessions_today=0, rows=[item(0)]))
        assert session.recipe_json["daily_first"] is True

    def test_열화된_첫_세션도_만점이면_왕관이_나간다(self, broken_daily):
        """도장이 True인 이상 라우터의 왕관 분기가 그대로 성립한다 —
        판정식이 `all_correct and daily_first`이므로 이 두 값이 전부다."""
        session, _ = run(_DB(unit_sessions_today=0, rows=[item(0)]))
        daily_first = bool((session.recipe_json or {}).get("daily_first"))
        all_correct = True  # 만점 세션
        assert (all_correct and daily_first) is True

    def test_두_번째_이후는_장애와_무관하게_False다(self, broken_daily):
        """폴백이 도장을 True로 **밀어올리지** 않는다 — 장애가 왕관을 뺏지도,
        없던 왕관을 만들지도 않아야 한다."""
        session, _ = run(_DB(unit_sessions_today=2, rows=[item(0)]))
        assert session.recipe_json["daily_first"] is False

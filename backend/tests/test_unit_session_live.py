"""유닛 세션에는 **실황이 없다** — 2026-08-13 클라이언트 확정. DB·Redis 불필요.

⚠️ **이 파일의 계약은 통째로 뒤집혔다.** 2026-08-12 판은 정반대를 물었다
(「유닛 세션이 `UNIT_LIVE_CAP`건의 실황을 예약한다」·「10일 순환이 발급 경로까지
닿는다」). 경위를 남기는 이유는 그 계약이 **한 번도 사양대로 돈 적이 없었기**
때문이다 — 지우기만 하면 같은 설계가 다시 들어온다.

**무엇이 틀렸었나**: 유닛 실황 풀 조회가 `weak_concepts=[unit.concept_tag]`를
**하드 WHERE**로 걸었다. 그래서 「20종 위에서 하루 2칸씩 미는 창」이라는 순환의
전제가 깨져 있었다 — 실제 후보는 **개념당 1~4건**이고, `pressure_front`는 2건뿐이라
`UNIT_LIVE_CAP=2`가 **매일 같은 2건 전부**를 넣었다. 종전 순환 테스트가 초록이던
이유는 `live_rotation_window`를 **20건짜리 합성 풀**에 직접 먹였기 때문이다:
순수 함수는 사양대로 돌았고, 그 함수에 사양대로 된 재료가 들어간 적이 없었다.
(교훈: 순수 함수 계약과 **배선** 계약을 갈라 놓으면 배선 쪽이 조용히 죽는다.)

**새 계약** — 확정 사양에서 유닛 세션은 두 종류이고 **어느 쪽도 이 경로를 안 탄다**:
  · 하루 **첫** 유닛 세션 = 데일리 세션. 실황 2건을 **daily 배합 경로**가 준다
    (`session_service.plan_daily_picks`). 그쪽 계약은 `test_unit_daily_first.py`.
  · **두 번째 이후** = 실황 0 · 보드 0의 순수 학습. 이 파일이 그것을 문다.

이 파일이 못 박는 것 4가지:
  ⑴ 두 번째 이후 유닛 세션에 **`live`도 `board`도 0건**이고 실황 풀 조회 자체가 없다.
  ⑵ 철거된 심볼(`UNIT_LIVE_CAP`·`live_rotation_window`·`unit_slot_values`…)이
     **되살아나지 않았다** — 되살아나면 74% 오표적 결함이 함께 돌아온다.
  ⑶ 진도 블록(progress_block_pool)도 계속 실황을 안 받는다 — 그 풀은 daily가
     소비하고 daily는 kind="live"에만 슬롯을 치환하므로, 실황이 섞이면 미치환
     원문(「{today.temp_max}」)이 화면에 나간다.
  ⑷ `question_json`에 `knowledge_level`이 실린다(담당 E 이월 — 배지 통로).
"""
from __future__ import annotations

import asyncio
import inspect
import json
import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs

TODAY = date(2026, 8, 13)


def live_item() -> SimpleNamespace:
    """실황 문항 대역 — **풀에 들어오면 안 되는 것**의 표본."""
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type="multiple_choice",
        level_group="adult",
        knowledge_level=2,
        uses_live_slots=True,
        template_json={
            "question_text": "오늘 {today.region}의 비 올 확률은 {today.rain_prob}%다.",
            "options": ["높아진다", "낮아진다", "무관하다", "0%가 된다"],
            "correct_answer": "높아진다",
        },
    )


def plain_item(n: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type="short_answer",
        level_group="adult",
        knowledge_level=4,
        uses_live_slots=False,
        template_json={"question_text": f"저기압 설명 {n}", "correct_answer": "상승"},
    )


class _Result:
    def __init__(self, rows, scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class _PoolDB:
    """실황/비실황 풀 조회를 SQL 텍스트로 갈라 답하는 대역 DB.

    `uses_live_slots IS true`는 `build_pool_query(live=True)`의 자국이다.
    **이 대역은 실황 행을 갖고 있다** — 그런데도 세션에 안 들어오는 것이 계약이다.

    두 종류의 `SELECT count`를 갈라 답한다:
      · `FROM sessions` — 「오늘 이미 발급된 유닛 세션 수」(`unit_sessions_today`).
        이 파일은 **두 번째 이후** 세션을 검증하므로 기본 1이다.
      · `FROM quiz_logs` — `allocate_quiz_ids`의 채번 조회.
    """

    def __init__(self, *, live_rows=(), plain_rows=(), unit_sessions_today=1):
        self.live_rows = list(live_rows)
        self.plain_rows = list(plain_rows)
        self.unit_sessions_today = unit_sessions_today
        self.stmts: list[str] = []
        self.added: list = []

    async def execute(self, stmt):
        text = str(stmt)
        if text.lstrip().lower().startswith("select count"):
            if "FROM sessions" in text:
                return _Result([], scalar=self.unit_sessions_today)
            return _Result([], scalar=0)  # 채번 조회 — 풀 조회로 세지 않는다
        self.stmts.append(text)
        if "uses_live_slots IS true" in text or "uses_live_slots IS 1" in text:
            return _Result(self.live_rows)
        return _Result(self.plain_rows)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    @property
    def live_stmts(self) -> list[str]:
        return [s for s in self.stmts if "uses_live_slots IS true" in s]

    @property
    def logs(self) -> list:
        return [o for o in self.added if hasattr(o, "question_json")]


USER = SimpleNamespace(id=uuid.uuid4(), level_group="adult", region="서울")
UNIT = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-pressure", kind="quiz",
    concept_tag="pressure_front",
)


def run_session(db, day: date = TODAY):
    return asyncio.run(cs.create_unit_session(db, USER, UNIT, day, abilities=[]))


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


# ══════════════════════════════════════════════════════════════════════════
# ⑴ 두 번째 이후 유닛 세션 — 실황 0 · 보드 0
# ══════════════════════════════════════════════════════════════════════════


class TestSecondUnitSessionHasNoLive:
    def test_실황_풀_조회_자체가_없다(self):
        """조회가 남아 있으면 언젠가 결과가 쓰인다 — 왕복부터 없애는 것이 계약이다."""
        db = _PoolDB(live_rows=[live_item()], plain_rows=[plain_item(i) for i in range(6)])
        run_session(db)
        assert db.live_stmts == [], (
            "유닛 세션이 실황 풀을 조회한다 — 이 경로는 2026-08-13에 철거됐다"
        )

    def test_실황_문항이_세션에_들어오지_않는다(self):
        """대역 DB가 실황 행을 갖고 있어도 발급분에는 0건이다."""
        live = live_item()
        db = _PoolDB(live_rows=[live], plain_rows=[plain_item(i) for i in range(6)])
        _, entries = run_session(db)
        assert entries, "세션이 통째로 비었다 — 이 계약이 헛돈다"
        assert all(e["content_item_id"] != live.id for e in entries)
        assert all(e["slot_filled"] is False for e in entries)
        assert "{today." not in dumps([e["question"] for e in entries])
        assert "{today." not in dumps([log.question_json for log in db.logs])

    def test_kind가_전건_unit이라_live도_board도_0건이다(self):
        """확정 사양 「두 번째 이후는 실황 0 · 보드 0의 순수 학습」의 본문."""
        db = _PoolDB(live_rows=[live_item()], plain_rows=[plain_item(i) for i in range(6)])
        _, entries = run_session(db)
        kinds = [e["kind"] for e in entries]
        assert set(kinds) == {"unit"}, f"순수 학습이 아닌 블록이 섞였다: {set(kinds)}"
        assert kinds.count("live") == 0
        assert kinds.count("board") == 0

    def test_문항_수는_UNIT_SESSION_SIZE다(self):
        """첫 세션(10문항)과 달리 두 번째 이후의 크기는 이 상수가 소유한다."""
        db = _PoolDB(plain_rows=[plain_item(i) for i in range(10)])
        _, entries = run_session(db)
        assert len(entries) == cs.UNIT_SESSION_SIZE

    def test_비실황_조회는_2회_그대로다(self):
        """실황 1회가 빠졌다 — 신선도 1차 + 백필 2차만 남는다
        (test_unit_pool_theta가 소유한 계약이 실황 편입 전으로 되돌아왔다)."""
        db = _PoolDB(live_rows=[live_item()], plain_rows=[])
        items = asyncio.run(cs._unit_content_pool(db, USER, UNIT, []))
        assert items == []
        assert len(db.stmts) == 2

    def test_풀_조회에_live_False가_박혀_있다(self):
        """`build_pool_query(live=False)`가 `uses_live_slots`를 제외하는 자리다 —
        인자가 다시 열리면(=`live` 파라미터 부활) 여기서 먼저 운다."""
        src = inspect.getsource(cs._unit_content_pool)
        assert "live=False" in src
        assert "live=live" not in src, "실황 여부가 다시 인자로 갈렸다"


# ══════════════════════════════════════════════════════════════════════════
# ⑵ 철거된 심볼이 되살아나지 않았다
# ══════════════════════════════════════════════════════════════════════════


class TestLivePathStaysRemoved:
    """되살아나면 「개념당 1~4건 순환」 결함이 그대로 돌아온다.

    이름만 지우고 같은 일을 하는 코드가 들어오는 것은 못 막지만, **가장 흔한
    회귀 형태**(옛 커밋을 되돌려 붙이기)는 여기서 걸린다.
    """

    REMOVED = (
        "UNIT_LIVE_CAP",
        "UNIT_LIVE_POOL_LIMIT",
        "live_rotation_window",
        "unit_slot_values",
    )

    @pytest.mark.parametrize("name", REMOVED)
    def test_철거된_심볼이_없다(self, name):
        assert not hasattr(cs, name), (
            f"{name}이 되살아났다 — 유닛 실황 경로는 2026-08-13에 철거됐다. "
            "실황은 하루 첫 유닛 세션의 daily 배합 경로가 소유한다"
        )

    def test_풀_함수가_slot_values를_받지_않는다(self):
        """인자가 남아 있으면 호출측이 언젠가 다시 넘긴다."""
        params = inspect.signature(cs._unit_content_pool).parameters
        assert "slot_values" not in params
        # today는 남는다 — 당일 중복 제외의 기준일(KST)이라 실황과 무관하다.
        assert "today" in params

    def test_발급_경로가_실황_치환을_하지_않는다(self):
        """`fill_live_slots` 호출이 남아 있으면 실황이 다시 들어올 자리가 있다는 뜻이다.
        (첫 세션의 치환은 `session_service.entries_from_picks`가 소유한다.)"""
        src = "\n".join(
            line
            for line in inspect.getsource(cs.create_unit_session).splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "fill_live_slots" not in src


# ══════════════════════════════════════════════════════════════════════════
# ⑶ 진도 블록은 계속 실황을 받지 않는다 — daily 미치환 노출 방지
# ══════════════════════════════════════════════════════════════════════════


class TestProgressBlockStaysLiveFree:
    def test_progress_block_pool은_실황을_안_받는다(self):
        """넘길 인자 자체가 없어졌지만, 계약은 남긴다 — daily의 발급 루프는
        kind="live"에만 치환하므로 실황이 섞이면 원문이 화면에 나간다."""
        src = "\n".join(
            line
            for line in inspect.getsource(cs.progress_block_pool).splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "_unit_content_pool(db, user, unit, abilities)" in src
        assert "slot_values" not in src

    def test_진도_블록_조회에도_실황이_없다(self):
        db = _PoolDB(live_rows=[live_item()], plain_rows=[plain_item(0)])
        asyncio.run(cs._unit_content_pool(db, USER, UNIT, []))
        assert db.live_stmts == []


# ══════════════════════════════════════════════════════════════════════════
# ⑷ 담당 E 이월 — 유닛 세션에도 knowledge_level 배지 통로
# ══════════════════════════════════════════════════════════════════════════


class TestKnowledgeLevelReachesUnitSession:
    def test_question_json에_knowledge_level이_실린다(self):
        db = _PoolDB(plain_rows=[plain_item(i) for i in range(6)])
        _, entries = run_session(db)
        assert {e["question"]["knowledge_level"] for e in entries} == {4}
        assert all("knowledge_level" in log.question_json for log in db.logs)

    def test_미분류_문항은_None_그대로(self):
        """level_group에서 역산하지 않는다 — 없는 값을 지어내면 배지가 거짓말한다."""
        item = plain_item(0)
        item.knowledge_level = None
        db = _PoolDB(plain_rows=[item])
        _, entries = run_session(db)
        assert entries[0]["question"]["knowledge_level"] is None

    def test_0문항_풀이어도_예외_없이_발급된다(self):
        """CO-H12 판정(유닛 세션에 하한 없음)은 그대로다."""
        db = _PoolDB()
        session, entries = run_session(db)
        assert entries == []
        assert session.recipe_json["items"] == []

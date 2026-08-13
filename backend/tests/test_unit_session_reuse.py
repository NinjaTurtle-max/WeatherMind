"""유닛 세션 **멱등 재사용** — 2026-08-13 코드 리뷰 결함 ① 회귀 테스트.

PM이 실서버로 재현한 결함이 그대로 이 파일의 첫 계약이다:

    1번째 발급: 문항 10 | session_id e83e3aa3
    2번째 발급: 문항  4 | session_id 822d7940   ← 새로고침 한 번

`POST /curriculum/units/{slug}/session`이 호출마다 새 `Session` 행을 만들었고
`UnitSessionPage`가 마운트마다 다시 POST했다(`staleTime: 0`). 그래서 새로고침
한 번에 `is_first_unit_session_today`가 1을 세어 두 번째 세션에
`daily_first=False` 도장이 찍혔고, **그날 남은 시간 동안 어떤 유닛도 왕관을 못
줬다**(도장은 발급 시점에 찍히고 완료 경로는 읽기만 하므로 되돌릴 방법이 없다).
10문항 데일리 배합도 함께 사라졌다.

수리는 **오늘·같은 유닛의 미완료 세션 재사용**이다 — 목
(`frontend/mock/apiMockPlugin.js:startUnitSession`)이 처음부터 그 규칙이라
패리티가 덤으로 따라온다. 대안이었던 「완료 여부로 도장을 찍는다」는 채택하지
않았다: 유닛 A를 열고 완료 전에 B를 열면 둘 다 첫 세션이 되어 **왕관 2개**가
나간다(경합이 아니라 평범한 탐색 동선이다).

**D10-3(「유닛 세션은 재개 개념 없음」)은 드리프트가 아니라 대체다.** 그 판정은
유닛 세션이 데일리와 별개이던 시절의 것이고 재발급 비용이 「4문항 다시 뽑기」
였다. 지금 그 비용은 **그날의 왕관**이다. 경위는
`curriculum_service.get_open_unit_session` 독스트링과 `docs/team/CARRYOVER_R13.md`.

이 파일이 무는 것 넷:
  ⑴ 같은 유닛 두 번 POST → **같은 session_id · 두 번 다 10문항**(PM 재현)
  ⑵ 구름 0에서 재진입해도 **429가 아니다** — 「이미 발급된 세션은 잔량 0이어도
     끝까지 보장」(R10)이 재사용 경로에서 성립한다. 재사용 판정이 구름 게이트보다
     **앞**에 있어야만 참이 되는 계약이다.
  ⑶ **다른 유닛**을 같은 날 열면 `UNIT_SESSION_SIZE` · `daily_first=False`
  ⑷ **재개 상태가 실제로 복원된다** — 1문항 답한 뒤 재발급하면 progress가 살아
     있다. 프론트 `SessionRunner`에 복원 로직이 있었지만 이 경로에서는 한 번도
     실행된 적이 없었다(재발급이 매번 새 세션을 냈으므로).

DB·Redis 불필요 — 라우터 엔드포인트를 직접 호출하고(slowapi 데코레이터는
`inspect.unwrap`으로 벗긴다 — `test_unit_session_theta_refresh` 전례) 상태 있는
대역 DB를 쓴다. **`session_today_response`는 대역하지 않는다**: ⑷의 복원이
그 함수의 `is_correct`·`progress` 조립을 타고 나오므로, 대역하면 무엇을 검증하는지
사라진다.
"""
from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.models.session import Session
from app.routers import curriculum as curriculum_router
from app.services import curriculum_service as cs
from app.services import energy_service
from app.services import session_service as ss
from app.services import weatherbrain_service as wb
from app.services.energy_service import OutOfCloudsError

RECIPE_TOTAL = sum(settings.SESSION_RECIPE.values())


# ══════════════════════════════════════════════════════════════════════════
# 대역
# ══════════════════════════════════════════════════════════════════════════


def item(n: int, *, question_type="short_answer") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type=question_type,
        level_group="adult",
        knowledge_level=4,
        uses_live_slots=False,
        template_json={"question_text": f"문항 {n}", "correct_answer": "상승"},
    )


class _Result:
    def __init__(self, rows=(), scalar=0, one_or_none=None):
        self._rows = list(rows)
        self._scalar = scalar
        self._one_or_none = one_or_none

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one(self):
        return self._scalar

    def scalar_one_or_none(self):
        return self._one_or_none


class _Savepoint:
    """`db.begin_nested()` 대역 — **예외를 삼키지 않는다**(진짜 savepoint와 같다).

    삼키면 `create_unit_session`의 폴백 분기가 안 돌아 이 파일의 계약이 조용히
    헛돈다.
    """

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _RouterDB:
    """유닛 세션 발급 라우터가 실제로 던지는 질의만 아는 **상태 있는** 대역 DB.

    선두 테이블로 갈라 답한다 — 문자열 조각을 세는 것보다 질의의 의도가 드러난다:
      · `SELECT units …`       유닛 조회(라우터)
      · `SELECT count(*) … sessions`  「오늘 첫 유닛 세션인가」 판정
      · `SELECT count(*) … quiz_logs` quiz_id 채번
      · `SELECT sessions …`    **재사용 조회**(get_open_unit_session)
      · `SELECT content_items …` 유닛 풀
      · `SELECT quiz_logs …`   세션 응답 조립(_session_logs)

    재사용 조회는 **컴파일된 바인드 파라미터로 unit_id를 읽어 걸러낸다** — 그래야
    "질의가 유닛으로도 좁히는가"가 대역이 아니라 실제 질의로 확인된다.
    """

    def __init__(self, unit, *, pool_rows=()):
        self.unit = unit
        self.pool_rows = list(pool_rows)
        self.sessions: list[Session] = []
        self.logs: list = []
        self.reuse_queries: list = []

    async def execute(self, stmt):
        text = str(stmt)
        head = text.lstrip().split("\n")[0].lower()
        if head.startswith("select count"):
            if "FROM sessions" in text:
                return _Result(scalar=len(self.sessions))
            return _Result(scalar=len(self.logs))
        if head.startswith("select units"):
            return _Result(one_or_none=self.unit)
        if head.startswith("select sessions"):
            self.reuse_queries.append(text)
            params = stmt.compile().params
            rows = [
                s
                for s in self.sessions
                if s.unit_id == params.get("unit_id_1")
                and s.completed_at is None
            ]
            return _Result(rows=rows)
        if head.startswith("select quiz_logs"):
            params = stmt.compile().params
            rows = sorted(
                (
                    log
                    for log in self.logs
                    if log.session_id == params.get("session_id_1")
                ),
                key=lambda log: log.quiz_id,
            )
            return _Result(rows=rows)
        return _Result(rows=self.pool_rows)

    def add(self, obj):
        if isinstance(obj, Session):
            self.sessions.append(obj)
        else:
            self.logs.append(obj)

    async def flush(self):
        for obj in (*self.sessions, *self.logs):
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()

    def begin_nested(self):
        return _Savepoint()


class _User:
    id = uuid.uuid4()
    level_group = "adult"
    region = "서울"


UNIT_A = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-pressure", kind="quiz",
    concept_tag="pressure_front", prereq_unit_id=None,
)
UNIT_B = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-cloud", kind="quiz",
    concept_tag="pressure_front", prereq_unit_id=None,
)


@pytest.fixture
def wiring(monkeypatch):
    """라우터 주변부(θ 재추정·잠금·구름 게이트·daily 배합)를 대역으로 고정한다.

    반환 dict의 `gate`에 호출 횟수가 쌓인다 — ⑵가 "게이트를 **안 부른다**"로
    재사용을 재기 때문이다. 통과 여부가 아니라 호출 자체를 봐야 「이미 발급된
    세션은 잔량과 무관하다」가 코드에서 읽힌다.
    """
    state = {"gate": 0, "gate_raises": False}

    async def fake_refresh(db, user):
        return []

    async def fake_locked(db, user, unit, abilities=None):
        return False

    async def fake_gate(db, user, now=None):
        state["gate"] += 1
        if state["gate_raises"]:
            raise OutOfCloudsError(600)
        return {"clouds": 5, "max": 5, "next_regen_sec": 0, "updated_at": None}

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

    async def fake_plan(db, user, today, *, abilities=None, target_level=None):
        return ss.DailyPlan(
            picks=picks,
            generate_count=0,
            weather={},
            slot_values={},
            theta=None,
            route_decision={},
            block_unit=None,
            phenomenon=None,
            abilities=abilities or [],
        )

    monkeypatch.setattr(wb, "refresh_abilities", fake_refresh)
    monkeypatch.setattr(cs, "is_unit_locked", fake_locked)
    monkeypatch.setattr(energy_service, "require_entry", fake_gate)
    monkeypatch.setattr(ss, "plan_daily_picks", fake_plan)
    return state


def post(db, unit) -> object:
    """POST /curriculum/units/{slug}/session — slowapi 데코레이터를 벗겨 직접 호출."""
    db.unit = unit
    endpoint = inspect.unwrap(curriculum_router.create_unit_session)
    return asyncio.run(
        endpoint(
            request=SimpleNamespace(),
            slug=unit.slug,
            user=_User(),
            db=db,
        )
    )


# ══════════════════════════════════════════════════════════════════════════
# ⑴ PM 재현 — 같은 유닛 두 번 POST
# ══════════════════════════════════════════════════════════════════════════


class TestSameUnitReissueIsIdempotent:
    def test_두_번_POST하면_같은_세션이고_둘_다_배합_총합이다(self, wiring):
        """**PM의 재현 그대로다.** 종전에는 (10문항, id A) → (4문항, id B)였다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        first = post(db, UNIT_A)
        second = post(db, UNIT_A)

        assert first.session_id == second.session_id, (
            "새로고침 한 번에 새 세션이 발급됐다 — 그날의 왕관이 막힌다"
        )
        assert len(first.items) == len(second.items) == RECIPE_TOTAL == 10
        assert len(db.sessions) == 1, "재사용인데 Session 행이 늘었다"

    def test_재발급이_도장을_False로_덮지_않는다(self, wiring):
        """결함의 급소 — 도장이 False로 다시 찍히면 그날 왕관이 영영 막힌다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        post(db, UNIT_A)
        post(db, UNIT_A)
        assert [s.recipe_json["daily_first"] for s in db.sessions] == [True]

    def test_재사용_조회가_유저_유닛_날짜_모드_미완료를_모두_건다(self, wiring):
        """하나라도 빠지면 남의 세션·어제 세션·다른 유닛·이미 끝낸 세션이 잡힌다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        post(db, UNIT_A)
        assert db.reuse_queries, "재사용 조회 자체가 없다"
        sql = db.reuse_queries[0]
        for clause in (
            "sessions.user_id =",
            "sessions.unit_id =",
            "sessions.session_date =",
            "sessions.mode =",
            "sessions.completed_at IS NULL",
        ):
            assert clause in sql, f"재사용 조회에 {clause} 조건이 없다"

    def test_완료된_세션은_재사용하지_않는다(self, wiring):
        """같은 유닛 재도전은 **새 세션**이다 — 그리고 그것은 오늘 첫 세션이
        아니므로 `UNIT_SESSION_SIZE`짜리 순수 학습이 된다. 목의
        `if (!s || s.completed || …)`와 같은 규칙이다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        post(db, UNIT_A)
        db.sessions[0].completed_at = datetime(2026, 8, 13, 12, 0, 0)

        again = post(db, UNIT_A)
        assert len(db.sessions) == 2
        assert again.session_id == db.sessions[1].id
        assert len(again.items) == cs.UNIT_SESSION_SIZE
        assert db.sessions[1].recipe_json["daily_first"] is False


# ══════════════════════════════════════════════════════════════════════════
# ⑵ 재사용 판정은 구름 게이트보다 **먼저**
# ══════════════════════════════════════════════════════════════════════════


class TestReuseComesBeforeCloudGate:
    """R10 계약 — **「이미 발급된 세션은 잔량 0이어도 끝까지 보장」**.

    게이트가 재사용 판정보다 앞에 있으면 구름 0인 학습자가 세션 도중 새로고침할
    때 **계약이 보장한 그 세션에서 429로 쫓겨난다.** 종전에는 재사용 자체가
    없어서 이 결함이 잠재해 있었고, 재사용이 생기는 편집에서 함께 닫혔다.
    `GET /session/today`가 `if session is None:` 안에서만 게이트를 거는 것과 같다.
    """

    def test_재진입은_게이트를_아예_호출하지_않는다(self, wiring):
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        post(db, UNIT_A)
        assert wiring["gate"] == 1, "신규 발급에서 게이트가 빠졌다"
        post(db, UNIT_A)
        assert wiring["gate"] == 1, (
            "재진입이 게이트를 다시 탔다 — 구름 0이면 429로 쫓겨난다"
        )

    def test_구름_0이어도_재진입은_200이다(self, wiring):
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        first = post(db, UNIT_A)
        wiring["gate_raises"] = True  # 세션 도중 구름이 0이 됐다

        second = post(db, UNIT_A)
        assert second.session_id == first.session_id
        assert len(second.items) == RECIPE_TOTAL

    def test_신규_발급은_여전히_구름에_막힌다(self, wiring):
        """게이트를 뒤로 미룬 것이 「게이트를 없앤 것」이 되면 안 된다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        wiring["gate_raises"] = True
        with pytest.raises(OutOfCloudsError):
            post(db, UNIT_A)
        assert db.sessions == [], "차단됐는데 세션이 만들어졌다"


# ══════════════════════════════════════════════════════════════════════════
# ⑶ 다른 유닛 — 재사용은 유닛 단위다
# ══════════════════════════════════════════════════════════════════════════


class TestOtherUnitSameDay:
    def test_다른_유닛은_새_세션이고_daily_first가_False다(self, wiring):
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        first = post(db, UNIT_A)
        second = post(db, UNIT_B)

        assert second.session_id != first.session_id
        assert len(second.items) == cs.UNIT_SESSION_SIZE == 4
        assert db.sessions[1].recipe_json["daily_first"] is False

    def test_A로_돌아오면_10문항_세션이_그대로_있다(self, wiring):
        """독스트링에 남긴 귀결 — **그날의 왕관 세션은 처음 연 유닛에 묶인다.**
        B를 들렀다 와도 A의 10문항 세션은 사라지지 않는다(정합적이지만 말해 두지
        않으면 결함으로 읽히는 자리라 계약으로 고정한다)."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        first = post(db, UNIT_A)
        post(db, UNIT_B)
        back = post(db, UNIT_A)

        assert back.session_id == first.session_id
        assert len(back.items) == RECIPE_TOTAL


# ══════════════════════════════════════════════════════════════════════════
# ⑷ 재개 — 복원 로직이 이 경로에서 **처음으로** 돈다
# ══════════════════════════════════════════════════════════════════════════


class TestResumeRestoresProgress:
    """프론트 `SessionRunner`에 복원 로직이 있었지만 이 경로에서는 한 번도
    실행된 적이 없다 — 재발급이 매번 **답안이 하나도 없는 새 세션**을 냈으므로
    복원할 진행이 애초에 없었다. 재사용이 그 배선을 처음으로 살린다.
    """

    def test_1문항_답한_뒤_재발급하면_진행이_살아_있다(self, wiring):
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        first = post(db, UNIT_A)
        assert first.progress.answered == 0

        answered = sorted(db.logs, key=lambda log: log.quiz_id)[0]
        answered.is_correct = True

        second = post(db, UNIT_A)
        assert second.progress.answered == 1, "재발급이 진행을 지웠다"
        assert second.progress.total == RECIPE_TOTAL

    def test_문항별_정오가_그대로_내려온다(self, wiring):
        """만회 큐 복원의 재료(CO-A5) — 세션이 갈리면 전부 None으로 초기화된다."""
        db = _RouterDB(UNIT_A, pool_rows=[item(i) for i in range(10)])
        post(db, UNIT_A)
        ordered = sorted(db.logs, key=lambda log: log.quiz_id)
        ordered[0].is_correct = False
        ordered[0].retry_correct = True

        second = post(db, UNIT_A)
        assert second.items[0].is_correct is False
        assert second.items[0].retry_correct is True
        assert second.items[1].is_correct is None  # 아직 안 푼 문항


# ══════════════════════════════════════════════════════════════════════════
# ⑸ D10-3 대체가 **기록으로 남아 있는가**
#
# 이월 대장의 교훈: 수신자 이름이 없는 이월은 회수율 0%였다. 대체된 결정도 같다 —
# 「호출마다 새로 발급」이라고 적힌 주석이 남아 있으면 다음 사람이 그것을 계약으로
# 읽고 재사용을 다시 뜯어낸다.
# ══════════════════════════════════════════════════════════════════════════


class TestSupersessionIsRecorded:
    def test_라우터_주석이_D10_3을_대체로_기술한다(self):
        src = inspect.getsource(curriculum_router)
        assert "D10-3" in src, "D10-3이 어떻게 됐는지 라우터가 말하지 않는다"
        block = src[src.index("D10-3") - 400 : src.index("D10-3") + 800]
        assert "대체" in block, (
            "D10-3이 **대체**됐다는 사실이 안 적혀 있다 — 다음 사람이 옛 판정을 "
            "계약으로 읽고 재사용을 뜯어낸다"
        )

    def test_이월_대장에_행이_있다(self):
        from pathlib import Path

        ledger = (
            Path(__file__).resolve().parents[2] / "docs" / "team" / "CARRYOVER_R13.md"
        )
        text = ledger.read_text(encoding="utf-8")
        assert "D10-3" in text, (
            "이월 대장에 D10-3 대체 행이 없다 — 결정이 코드 주석에만 남으면 "
            "대장이 못 본다(CLAUDE.md의 이월 교훈)"
        )

"""결함 ⑩ 계약 — 문제를 풀면(만점이 아니어도) 다음 유닛이 열린다.

🔴 **2026-08-19 클라이언트 지적**: *"지금 문제를 풀어도 왜 다음단계가 안 여리니?"*

원인은 `is_locked`가 선행 유닛의 `crowns >= 1`을 본 것이다. 왕관은 세 조건이
동시에 참일 때만 나간다(`all_correct` ∧ `daily_first` ∧ `is_first_complete`)
⇒ 한 문항만 틀려도·그날 두 번째여도·전에 푼 유닛이어도 다음이 안 열렸다.

해법은 왕관 조건을 푸는 것이 **아니라**(셋 다 각각 타당하다) 축을 가르는 것이다:
진행 = `attempted_at`, 보상 = `crowns`. 사유의 단일 소유자는
`curriculum_service.is_locked` 독스트링이다.

⚠️ **이 파일이 있는 이유**: 수정만 하고 나면 `is_locked`를 종전(`crowns >= 1`
단독)으로 **되돌려도 전 시험이 초록이었다** — 6,165건 중 우는 것이 0건이었다.
고친 것을 지키는 계약이 없으면 다음 사람이 아무 경고 없이 되돌린다.
그래서 아래 단정들은 **되돌림 변이에 빨강이 나도록** 짜여 있다.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs

_NOW = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)


def _unit(prereq=None):
    return SimpleNamespace(id=uuid.uuid4(), prereq_unit_id=prereq, crown_target=1)


def _prog(*, crowns=0, attempted_at=None, cleared_at=None):
    return SimpleNamespace(crowns=crowns, attempted_at=attempted_at,
                           cleared_at=cleared_at)


class TestIsLockedProgressAxis:
    """`is_locked`(순수 함수) — 진행 축이 잠금을 푼다."""

    def test_선행_유닛을_해_본_적_없으면_잠긴다(self):
        prereq = _unit()
        target = _unit(prereq=prereq.id)
        # 진도 행 자체가 없다 — 시작도 안 했다.
        assert cs.is_locked(target, {}) is True
        # 행은 있지만 왕관 0 · 시도 없음(예: /dev로 행만 생긴 경우).
        assert cs.is_locked(target, {prereq.id: _prog()}) is True

    def test_만점이_아니어도_한_번_끝냈으면_다음이_열린다(self):
        """**결함의 실체.** 왕관 0인데 열려야 한다 — 되돌리면 이 줄이 빨강."""
        prereq = _unit()
        target = _unit(prereq=prereq.id)
        progress = {prereq.id: _prog(crowns=0, attempted_at=_NOW)}
        assert cs.is_locked(target, progress) is False

    def test_왕관만_있고_시도_기록이_없어도_열린다(self):
        """기존 학습자 보호 — 배지·`/dev`가 왕관만 올리는 유입로가 있다.

        `crowns >= 1`을 OR로 남긴 이유다. 이 단정이 빨강이면 **이미 쓰고 있던
        학습자의 다음 유닛이 도로 잠긴** 회귀다(마이그레이션 0017 백필이 2차 방어).
        """
        prereq = _unit()
        target = _unit(prereq=prereq.id)
        progress = {prereq.id: _prog(crowns=1, attempted_at=None)}
        assert cs.is_locked(target, progress) is False

    def test_attempted_at_을_모르는_대역물은_왕관_기준으로_내려간다(self):
        """`getattr` 기본값 — 새 축을 모르는 호출측을 **덜 여는 쪽**으로 처리.

        `is_locked`는 403 게이트도 겸하므로, 트리에 열려 보이는데 403이 나는
        어긋남(§CO-L1의 실제 사고)보다 덜 여는 편이 안전하다.
        """
        prereq = _unit()
        target = _unit(prereq=prereq.id)
        old_stub = SimpleNamespace(crowns=0)  # attempted_at 속성 자체가 없다
        assert cs.is_locked(target, {prereq.id: old_stub}) is True
        assert cs.is_locked(target, {prereq.id: SimpleNamespace(crowns=1)}) is False

    def test_첫_유닛과_배치_선해제는_종전과_같다(self):
        """회귀 감시 — 새 축이 기존 두 무잠금 경로를 건드리지 않았다."""
        first = _unit(prereq=None)
        assert cs.is_locked(first, {}) is False
        prereq = _unit()
        target = _unit(prereq=prereq.id)
        # order_index < unlock_floor 이면 prereq와 무관하게 열림(R7-02 §3.4).
        assert cs.is_locked(target, {}, unlock_floor=3, order_index=1) is False
        assert cs.is_locked(target, {}, unlock_floor=3, order_index=3) is True


class _AttemptDB:
    """`mark_unit_attempted`가 만지는 것만 응답(execute·add·flush)."""

    def __init__(self, prog=None):
        self.prog = prog
        self.added: list = []

    async def execute(self, stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: self.prog)

    def add(self, obj):
        self.added.append(obj)
        self.prog = obj

    async def flush(self):
        pass


_USER = SimpleNamespace(id=uuid.uuid4(), level_group="elementary", streak_count=1)


class TestMarkUnitAttempted:
    def test_진도_행이_없으면_만들고_시각을_찍는다(self):
        db = _AttemptDB(prog=None)
        unit_id = uuid.uuid4()
        asyncio.run(cs.mark_unit_attempted(db, _USER, unit_id))
        assert len(db.added) == 1
        created = db.added[0]
        assert created.user_id == _USER.id
        assert created.unit_id == unit_id
        assert created.crowns == 0
        assert created.attempted_at is not None

    def test_멱등이며_첫_시각을_덮지_않는다(self):
        """`grant_unit_crown`이 멱등이 **아닌** 것과 의도적으로 다르다."""
        first = _NOW - timedelta(days=2)
        db = _AttemptDB(prog=_prog(crowns=0, attempted_at=first))
        uid = uuid.uuid4()
        asyncio.run(cs.mark_unit_attempted(db, _USER, uid))
        asyncio.run(cs.mark_unit_attempted(db, _USER, uid))
        assert db.prog.attempted_at == first
        assert db.added == []  # 있는 행을 또 만들지 않는다


class _ResultDB(_AttemptDB):
    """`unit_result_for_session`이 추가로 쓰는 `get`까지 응답."""

    def __init__(self, unit, prog=None):
        super().__init__(prog=prog)
        self.unit = unit

    async def get(self, model, pk):
        return self.unit


class TestAttemptRecordedRegardlessOfCrown:
    """왕관 분기 **앞**에서 기록된다 — 종전 결함이 형태만 바꿔 되살아나지 않게."""

    @pytest.mark.parametrize(
        "all_correct,grant_crown",
        [(False, False), (True, False), (False, True)],
    )
    def test_오답이어도_재완료여도_해_봤다는_사실은_남는다(
        self, monkeypatch, all_correct, grant_crown
    ):
        """`grant_crown=False`가 결함의 실제 경로다 — 오답 1건이면 여기로 온다.

        이때 `attempted_at`이 안 찍히면 다음 유닛은 종전처럼 안 열린다.
        """
        unit = SimpleNamespace(id=uuid.uuid4(), crown_target=1)
        db = _ResultDB(unit, prog=_prog(crowns=0, attempted_at=None))

        async def fake_grant(_db, _user, _unit_id):
            return {"crowns": 1, "cleared": True, "xp_earned": 10}

        async def fake_progress(_db, _user):
            return {unit.id: db.prog}

        monkeypatch.setattr(cs, "grant_unit_crown", fake_grant)
        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)

        result = asyncio.run(
            cs.unit_result_for_session(
                db, _USER, unit.id,
                all_correct=all_correct, grant_crown=grant_crown,
            )
        )
        assert result is not None
        assert db.prog.attempted_at is not None, (
            "왕관 여부와 무관하게 진행이 기록돼야 한다 — 이것이 결함 ⑩의 실체"
        )

    def test_유닛이_없으면_아무것도_기록하지_않는다(self):
        db = _ResultDB(unit=None, prog=None)
        result = asyncio.run(
            cs.unit_result_for_session(
                db, _USER, uuid.uuid4(), all_correct=True, grant_crown=True
            )
        )
        assert result is None
        assert db.added == []


class TestEndToEndUnlockChain:
    """두 축을 한자리에서 — 오답 세션 뒤 다음 유닛이 열린다."""

    def test_오답_세션_완료가_다음_유닛의_잠금을_푼다(self, monkeypatch):
        u1 = SimpleNamespace(id=uuid.uuid4(), prereq_unit_id=None, crown_target=1)
        u2 = _unit(prereq=u1.id)
        prog1 = _prog(crowns=0, attempted_at=None)
        db = _ResultDB(u1, prog=prog1)

        async def fake_progress(_db, _user):
            return {u1.id: db.prog}

        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)

        # 세션 전 — u2는 잠겨 있다.
        assert cs.is_locked(u2, {u1.id: prog1}) is True

        # 한 문항 틀린 세션 완료(grant_crown=False — 왕관은 안 나간다).
        asyncio.run(
            cs.unit_result_for_session(
                db, _USER, u1.id, all_correct=False, grant_crown=False
            )
        )

        # 세션 후 — 왕관은 여전히 0이지만 u2가 열렸다.
        assert db.prog.crowns == 0
        assert cs.is_locked(u2, {u1.id: db.prog}) is False

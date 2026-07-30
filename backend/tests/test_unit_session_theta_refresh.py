"""유닛 세션 발급 θ 재추정 (R8-01 §3.2) — 배관 검증. DB 불필요.

결함 ② 해소: θ가 데일리 경로에서만 재추정되어 커리큘럼만 하는 유저의 θ가
배치 시점에 동결되던 문제. test_theta_difficulty의 FakeDB 패턴을 따른다.

증명 사슬:
1. POST /units/{slug}/session 발급 경로가 refresh_abilities를 정확히 1회 호출
   (데일리 session_service 전례와 동일 — 실패 폴백은 refresh_abilities 내부).
2. 그 결과 하나를 잠금 판정(is_unit_locked)과 풀 정렬(create_unit_session)이
   공유한다 — load_abilities 재조회 없이 신선한 θ 사용(이중 refresh 금지).
3. 404(미존재)는 refresh 이전에 반환 — 불필요한 재추정 없음.
4. 트리 GET(get_curriculum)·abilities 미전달 서비스 호출은 read-only
   (load_abilities) 유지 — ai-worker 미호출.
"""
from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import curriculum as curriculum_router
from app.services import curriculum_service as cs
from app.services import weatherbrain_service as wb

ABILITIES = [{"concept_tag": "pressure_front", "theta": 1.0, "se": 0.4, "n": 4}]


class _FakeResult:
    def __init__(self, unit=None):
        self._unit = unit

    def scalar_one_or_none(self):
        return self._unit

    def scalar_one(self):
        return 0

    def scalars(self):
        return self

    def all(self):
        return []


class FakeDB:
    """execute를 해석하지 않는 FakeDB — 첫 SELECT(유닛 조회)만 unit을 돌려준다."""

    def __init__(self, unit=None):
        self._unit = unit
        self._first = True
        self.added = []

    async def execute(self, stmt):
        if self._first:
            self._first = False
            return _FakeResult(self._unit)
        return _FakeResult()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()


class _FakeUser:
    id = uuid.uuid4()
    level_group = "elementary"


def make_unit(kind="quiz"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug="read-sky-1",
        kind=kind,
        concept_tag="pressure_front",
        prereq_unit_id=None,
    )


def make_session(unit):
    return SimpleNamespace(
        id=uuid.uuid4(),
        session_date=date(2026, 7, 30),
        mode="unit",
        recipe_json={"kind": "unit", "unit_id": str(unit.id), "items": []},
    )


def call_issue_route(db, monkeypatch, *, unit, locked=False):
    """POST /units/{slug}/session 라우터 직접 호출 (slowapi 데코레이터 해제).

    is_unit_locked·create_unit_session은 abilities 전달 캡처용 fake로 대체 —
    반환: (calls dict, 응답 또는 HTTPException).
    """
    calls = {"refresh": 0, "lock_abilities": [], "create_abilities": []}

    async def fake_refresh(db_, user):
        calls["refresh"] += 1
        return ABILITIES

    async def fake_locked(db_, user, unit_, abilities=None):
        calls["lock_abilities"].append(abilities)
        return locked

    async def fake_create(db_, user, unit_, today=None, abilities=None):
        calls["create_abilities"].append(abilities)
        return make_session(unit_), []

    monkeypatch.setattr(wb, "refresh_abilities", fake_refresh)
    monkeypatch.setattr(cs, "is_unit_locked", fake_locked)
    monkeypatch.setattr(cs, "create_unit_session", fake_create)

    endpoint = inspect.unwrap(curriculum_router.create_unit_session)
    try:
        result = asyncio.run(
            endpoint(
                request=SimpleNamespace(),
                slug="read-sky-1",
                user=_FakeUser(),
                db=db,
            )
        )
    except HTTPException as exc:
        result = exc
    return calls, result


class TestIssueRouteWiring:
    """발급 경로: refresh 1회 → 잠금·풀이 같은 abilities 공유 (§3.2)."""

    def test_발급시_refresh_1회_잠금과_풀에_동일_abilities(self, monkeypatch):
        unit = make_unit()
        calls, result = call_issue_route(FakeDB(unit), monkeypatch, unit=unit)
        assert calls["refresh"] == 1  # 이중 refresh 금지
        assert calls["lock_abilities"] == [ABILITIES]
        assert calls["create_abilities"] == [ABILITIES]
        assert calls["lock_abilities"][0] is calls["create_abilities"][0]
        assert result.mode == "unit"

    def test_미존재_404는_refresh_이전_반환(self, monkeypatch):
        calls, result = call_issue_route(
            FakeDB(unit=None), monkeypatch, unit=None
        )
        assert isinstance(result, HTTPException)
        assert result.status_code == 404
        assert calls["refresh"] == 0

    def test_잠금_403이어도_refresh는_1회_발급은_없음(self, monkeypatch):
        unit = make_unit()
        calls, result = call_issue_route(
            FakeDB(unit), monkeypatch, unit=unit, locked=True
        )
        assert isinstance(result, HTTPException)
        assert result.status_code == 403
        assert calls["refresh"] == 1
        assert calls["lock_abilities"] == [ABILITIES]  # 잠금 판정도 신선한 θ
        assert calls["create_abilities"] == []


class TestServiceAbilitiesThreading:
    """서비스: abilities 전달 시 재조회 없음 / 미전달 시 read-only 유지."""

    @pytest.fixture
    def guard(self, monkeypatch):
        calls = {"load": 0, "refresh": 0}

        async def fake_load(db, user):
            calls["load"] += 1
            return ABILITIES

        async def fail_refresh(db, user):
            calls["refresh"] += 1
            raise AssertionError("서비스 계층은 refresh_abilities를 호출하면 안 된다")

        monkeypatch.setattr(wb, "load_abilities", fake_load)
        monkeypatch.setattr(wb, "refresh_abilities", fail_refresh)
        return calls

    def test_is_unit_locked_abilities_전달시_load_생략(self, guard):
        locked = asyncio.run(
            cs.is_unit_locked(FakeDB(), _FakeUser(), make_unit(), abilities=ABILITIES)
        )
        assert locked is False
        assert guard == {"load": 0, "refresh": 0}

    def test_is_unit_locked_미전달은_read_only_load_1회(self, guard):
        asyncio.run(cs.is_unit_locked(FakeDB(), _FakeUser(), make_unit()))
        assert guard == {"load": 1, "refresh": 0}

    def test_create_unit_session_abilities_전달시_load_생략(self, guard):
        session, entries = asyncio.run(
            cs.create_unit_session(
                FakeDB(), _FakeUser(), make_unit(), date(2026, 7, 30),
                abilities=ABILITIES,
            )
        )
        assert entries == []  # FakeDB 풀 0건 — 배관만 검증
        assert session.mode == cs.MODE_UNIT
        assert guard == {"load": 0, "refresh": 0}

    def test_트리_GET은_read_only_유지(self, guard):
        sections = asyncio.run(cs.get_curriculum(FakeDB(), _FakeUser()))
        assert sections == []
        assert guard == {"load": 1, "refresh": 0}

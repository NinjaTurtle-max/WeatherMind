"""스파인(유닛 진도 축) 서버 집계 (R8-01 §3.3) — 순수 함수 + /me 배관. DB 불필요.

build_spine은 build_curriculum의 unit_view 위에서 집계하는 순수 함수라
빈/부분/전체 진행과 current 정의(잠기지 않은 첫 미클리어 = 트리 'current'
status와 동일)를 DB 없이 검증한다. test_curriculum_tree의 헬퍼 패턴을 따른다.

/progress/me는 GET(read-only) — get_spine의 θ 읽기는 load_abilities만
(refresh_abilities·ai-worker 호출 없음)임을 가드한다.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.routers import progress as progress_router
from app.services import curriculum_service as cs
from app.services import weatherbrain_service as wb


def make_unit(
    section, order, *, slug=None, prereq=None, crown_target=1, title=None,
):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug or f"{section}-{order}",
        section=section,
        unit_order=order,
        title=title or f"{section} {order}",
        concept_tag="pressure_front",
        kind="quiz",
        crown_target=crown_target,
        prereq_unit_id=prereq,
    )


def prog(crowns=0, cleared=False):
    return SimpleNamespace(
        crowns=crowns,
        cleared_at=datetime.now(timezone.utc) if cleared else None,
    )


def chain(n=3, section="하늘 읽기", crown_target=1):
    units = [make_unit(section, 1, crown_target=crown_target)]
    for i in range(2, n + 1):
        units.append(
            make_unit(section, i, prereq=units[-1].id, crown_target=crown_target)
        )
    return units


class TestBuildSpine:
    def test_유닛_0개면_전부_0_current_None(self):
        assert cs.build_spine([], {}) == {
            "units_total": 0,
            "units_cleared": 0,
            "crowns_earned": 0,
            "crowns_total": 0,
            "current_unit": None,
        }

    def test_신규_유저_진행_0_current는_첫_유닛(self):
        units = chain(3, crown_target=2)
        spine = cs.build_spine(units, {})
        assert spine["units_total"] == 3
        assert spine["units_cleared"] == 0
        assert spine["crowns_earned"] == 0
        assert spine["crowns_total"] == 6  # Σ crown_target
        assert spine["current_unit"] == {
            "slug": units[0].slug,
            "title": units[0].title,
        }

    def test_부분_진행_왕관_합산과_current_이동(self):
        u1, u2, u3 = units = chain(3, crown_target=2)
        progress = {
            u1.id: prog(crowns=2, cleared=True),   # 클리어
            u2.id: prog(crowns=1, cleared=False),  # 미클리어 부분 왕관도 합산
        }
        spine = cs.build_spine(units, progress)
        assert spine["units_cleared"] == 1
        assert spine["crowns_earned"] == 3  # 2 + 1
        assert spine["crowns_total"] == 6
        # current = 잠기지 않은 첫 미클리어 — u2 (u3는 u2 crowns>=1로 열렸지만 뒤)
        assert spine["current_unit"]["slug"] == u2.slug

    def test_전체_클리어면_current_None(self):
        units = chain(2)
        progress = {u.id: prog(crowns=1, cleared=True) for u in units}
        spine = cs.build_spine(units, progress)
        assert spine["units_cleared"] == 2
        assert spine["current_unit"] is None

    def test_current는_트리_status_current와_동일_유닛(self):
        """정의 재사용 검증 — build_curriculum의 'current'와 항상 일치."""
        u1, u2, u3 = units = chain(3)
        progress = {u1.id: prog(crowns=1, cleared=True)}
        tree_current = next(
            v
            for s in cs.build_curriculum(units, progress)
            for v in s["units"]
            if v["status"] == "current"
        )
        spine = cs.build_spine(units, progress)
        assert spine["current_unit"] == {
            "slug": tree_current["id"],
            "title": tree_current["title"],
        }
        assert spine["current_unit"]["slug"] == u2.slug

    def test_unlock_floor_선해제가_current에_반영(self):
        """배치 선해제(§3.4)와 동일 규칙 — 트리와 잠금 판정 공유."""
        u1, u2, u3 = units = chain(3)
        progress = {u1.id: prog(crowns=1, cleared=True)}
        # floor=3: 전부 선해제 — current는 여전히 첫 미클리어 u2 (순서 불변)
        spine = cs.build_spine(units, progress, unlock_floor=3)
        assert spine["current_unit"]["slug"] == u2.slug

    def test_섹션_교차_전체_순서로_집계(self):
        # 섹션명은 **SECTION_ORDER에 등재된 값**이어야 한다 — 미등재 섹션은
        # `_section_key`의 폴백을 타고 알파벳순으로 정렬되므로, 옛 이름을 쓰면
        # 이 테스트가 "섹션 순서"가 아니라 "가나다 순서"를 검증하게 된다
        # (CO-G1 재구조화로 옛 4섹션이 통째로 미등재가 됐다).
        a = make_unit(cs.SECTION_ORDER[0], 1)
        b = make_unit(cs.SECTION_ORDER[1], 1, prereq=a.id)
        progress = {a.id: prog(crowns=1, cleared=True)}
        spine = cs.build_spine([b, a], progress)  # 입력 순서 무관
        assert spine["units_total"] == 2
        assert spine["current_unit"]["slug"] == b.slug


# ═══════════════════════════════════════════════════════════════
# 배관 — get_spine(read-only)·/progress/me 응답 노출
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def scalars(self):
        return self

    def all(self):
        return []

    def scalar_one(self):
        # /me가 today_answered_count 집계로 SELECT count(*)를 실행한다 (R10-01 D4·D10-2).
        return 0


class FakeDB:
    async def execute(self, stmt):
        return _FakeResult()


class _FakeUser:
    id = uuid.uuid4()
    level_group = "elementary"
    xp = 120
    streak_count = 3
    streak_freeze_count = 1
    placement_completed_at = None
    daily_goal_items = None  # 일일 목표 미설정 (R10-01 D4 — /me additive 필드)
    region = None  # 지역 미설정 (R11-01 §8.2 — /me additive 필드, NULL=서울)


class TestGetSpineReadOnly:
    def test_θ_읽기는_load_abilities만_refresh_금지(self, monkeypatch):
        calls = {"load": 0}

        async def fake_load(db, user):
            calls["load"] += 1
            return []

        async def fail_refresh(db, user):
            raise AssertionError("/me 스파인 집계는 refresh_abilities 금지")

        monkeypatch.setattr(wb, "load_abilities", fake_load)
        monkeypatch.setattr(wb, "refresh_abilities", fail_refresh)
        spine = asyncio.run(cs.get_spine(FakeDB(), _FakeUser()))
        assert calls["load"] == 1
        assert spine["units_total"] == 0
        assert spine["current_unit"] is None


class TestProgressMeSpine:
    def test_me_응답에_spine_필드_노출(self, monkeypatch):
        spine = {
            "units_total": 12,
            "units_cleared": 4,
            "crowns_earned": 5,
            "crowns_total": 15,
            "current_unit": {"slug": "read-sky-3", "title": "구름 관찰"},
        }

        async def fake_tier(db, user_id):
            return "cumulus"

        async def fake_energy(db, user):
            return {"clouds": 5, "max": 5, "next_regen_sec": 0, "updated_at": None}

        async def fake_spine(db, user):
            return dict(spine)

        monkeypatch.setattr(
            progress_router.league_service, "get_current_tier", fake_tier
        )
        monkeypatch.setattr(progress_router.energy_service, "get_state", fake_energy)
        monkeypatch.setattr(
            progress_router.curriculum_service, "get_spine", fake_spine
        )
        me = asyncio.run(progress_router.get_me(user=_FakeUser(), db=FakeDB()))
        assert me.spine.model_dump() == spine
        assert me.xp == 120  # 기존 필드 불변 (additive)
        assert me.tier == "cumulus"

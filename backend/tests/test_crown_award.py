"""유닛 밖 활동 → 왕관 유입로 단위 테스트 — 스프린트 R8-01 §3.1·§3.4 (S1).

majority_concept·pick_crown_unit은 DB 의존이 없는 순수 함수라 최다 개념 선정
(동률: route target 우선→사전순)·잠금 통과·미클리어 필터·전체 순서 결정성을
DB 없이 검증한다 (test_curriculum_tree 관례). DB 결합부(find_crown_unit·
award_crown_for_activity·unit_result_for_session)는 로더를 monkeypatch한
FakeDB로 배선(unlock_floor 공급·grant 반환 노출)만 검증한다.

실행: backend 디렉토리에서 `python -m pytest tests/test_crown_award.py -q`.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services import curriculum_service as cs


def make_unit(
    section, order, *, slug=None, prereq=None, kind="quiz", crown_target=1,
    title="U", concept_tag="pressure_front",
):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug or f"{section}-{order}",
        section=section,
        unit_order=order,
        title=title,
        concept_tag=concept_tag,
        kind=kind,
        crown_target=crown_target,
        prereq_unit_id=prereq,
    )


def prog(crowns=0, cleared=False):
    return SimpleNamespace(
        crowns=crowns,
        cleared_at=datetime.now(timezone.utc) if cleared else None,
    )


class TestMajorityConcept:
    def test_최다_개념_선정(self):
        tags = ["air_mass", "typhoon", "air_mass", "humidity", "air_mass"]
        assert cs.majority_concept(tags) == "air_mass"

    def test_동률이면_route_target_우선(self):
        tags = ["typhoon", "air_mass", "typhoon", "air_mass"]
        assert cs.majority_concept(tags, route_target="typhoon") == "typhoon"

    def test_동률에_route_target이_없으면_사전순(self):
        tags = ["typhoon", "air_mass", "typhoon", "air_mass"]
        assert cs.majority_concept(tags) == "air_mass"
        # route target이 동률 후보 밖이면 무시하고 사전순
        assert cs.majority_concept(tags, route_target="humidity") == "air_mass"

    def test_route_target이_동률_아닌_소수면_무시(self):
        tags = ["typhoon", "typhoon", "air_mass"]
        assert cs.majority_concept(tags, route_target="air_mass") == "typhoon"

    def test_빈_입력은_None(self):
        assert cs.majority_concept([]) is None
        assert cs.majority_concept([None, None]) is None


class TestPickCrownUnit:
    def _fixtures(self):
        """하늘 읽기: quiz(pf)→board(pf), 공기의 힘: quiz(am, prereq=board)."""
        u_quiz = make_unit("하늘 읽기", 1, kind="quiz", concept_tag="pressure_front")
        u_board = make_unit(
            "하늘 읽기", 2, kind="board", concept_tag="pressure_front",
            prereq=u_quiz.id, crown_target=2,
        )
        u_am = make_unit(
            "공기의 힘", 1, kind="quiz", concept_tag="air_mass", prereq=u_board.id
        )
        return u_quiz, u_board, u_am

    def test_concept과_kind가_모두_일치해야_한다(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        found = cs.pick_crown_unit(
            units, {}, concept_tag="pressure_front", kind="quiz"
        )
        assert found is u_quiz
        # board kind는 잠금(선행 crowns 0) → None
        assert (
            cs.pick_crown_unit(
                units, {}, concept_tag="pressure_front", kind="board"
            )
            is None
        )

    def test_잠금_통과_유닛만_후보(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        progress = {u_quiz.id: prog(crowns=1)}  # 선행 충족 → board 열림
        found = cs.pick_crown_unit(
            units, progress, concept_tag="pressure_front", kind="board"
        )
        assert found is u_board

    def test_unlock_floor_배치_선해제로_열린_유닛도_후보(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        # 선행 crowns 0이지만 전체 순서 선두 2개가 선해제되면 board가 열린다
        found = cs.pick_crown_unit(
            units, {}, concept_tag="pressure_front", kind="board", unlock_floor=2
        )
        assert found is u_board

    def test_uncleared_only는_왕관_가득_찬_유닛을_건너뛴다(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        progress = {u_quiz.id: prog(crowns=1, cleared=True)}  # target 1 도달
        assert (
            cs.pick_crown_unit(
                units, progress,
                concept_tag="pressure_front", kind="quiz", uncleared_only=True,
            )
            is None
        )
        # crown_target 2에 crowns 1이면 미클리어 → 여전히 후보
        progress[u_board.id] = prog(crowns=1)
        found = cs.pick_crown_unit(
            units, progress,
            concept_tag="pressure_front", kind="board", uncleared_only=True,
        )
        assert found is u_board

    def test_전체_순서상_첫_유닛_결정성(self):
        """같은 concept·kind가 여럿이면 ordered_units 선두가 뽑힌다."""
        a = make_unit("하늘 읽기", 1, concept_tag="humidity")
        b = make_unit("하늘 읽기", 2, concept_tag="humidity")
        # 입력 순서를 뒤집어도 전체 순서(섹션→unit_order) 선두 a가 뽑힌다
        found = cs.pick_crown_unit(
            [b, a], {}, concept_tag="humidity", kind="quiz"
        )
        assert found is a

    def test_대상_없으면_None(self):
        u_quiz, *_ = self._fixtures()
        assert (
            cs.pick_crown_unit(
                [u_quiz], {}, concept_tag="typhoon", kind="quiz"
            )
            is None
        )


class FakeDB:
    """로더가 전부 monkeypatch되는 배선 테스트용 — get만 유닛을 돌려준다."""

    def __init__(self, unit=None):
        self.unit = unit

    async def get(self, model, pk):
        return self.unit

    async def flush(self):
        pass


_FAKE_USER = SimpleNamespace(id=uuid.uuid4(), level_group="elementary")


def _patch_loaders(monkeypatch, *, units, progress, abilities=None):
    async def fake_units(db):
        return units

    async def fake_progress(db, user):
        return progress

    async def fake_abilities(db, user):
        return abilities or []

    monkeypatch.setattr(cs, "load_units", fake_units)
    monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
    monkeypatch.setattr(cs.weatherbrain_service, "load_abilities", fake_abilities)


class TestFindCrownUnit:
    def test_잠금_맥락을_로드해_pick에_공급한다(self, monkeypatch):
        u1 = make_unit("하늘 읽기", 1, concept_tag="humidity", kind="board")
        _patch_loaders(monkeypatch, units=[u1], progress={})
        found = asyncio.run(
            cs.find_crown_unit(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="board"
            )
        )
        assert found is u1

    def test_배치_선해제_unlock_floor가_적용된다(self, monkeypatch):
        u1 = make_unit("하늘 읽기", 1, concept_tag="humidity")
        u2 = make_unit("하늘 읽기", 2, concept_tag="typhoon", prereq=u1.id)
        # θ≥0.5·n>0 이 u1(humidity)·u2(typhoon) 연속 성립 → floor 2 → u2 열림
        abilities = [
            {"concept_tag": "humidity", "theta": 0.8, "se": 0.4, "n": 3},
            {"concept_tag": "typhoon", "theta": 0.8, "se": 0.4, "n": 3},
        ]
        _patch_loaders(
            monkeypatch, units=[u1, u2], progress={}, abilities=abilities
        )
        found = asyncio.run(
            cs.find_crown_unit(
                FakeDB(), _FAKE_USER, concept_tag="typhoon", kind="quiz"
            )
        )
        assert found is u2


class TestAwardCrownForActivity:
    def test_grant_반환을_crown_award_형태로_노출(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, slug="sky-1", title="구름 읽기")
        calls = {}

        async def fake_find(db, user, *, concept_tag, kind, uncleared_only=False):
            calls["find"] = (concept_tag, kind, uncleared_only)
            return unit

        async def fake_grant(db, user, unit_id):
            calls["grant"] = unit_id
            return {
                "crowns": 1, "cleared": True, "newly_cleared": True, "xp_earned": 20,
            }

        monkeypatch.setattr(cs, "find_crown_unit", fake_find)
        monkeypatch.setattr(cs, "grant_unit_crown", fake_grant)
        award = asyncio.run(
            cs.award_crown_for_activity(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="board"
            )
        )
        assert award == {
            "unit_slug": "sky-1", "unit_title": "구름 읽기",
            "crowns": 1, "cleared": True,
        }
        assert calls["find"] == ("humidity", "board", True)  # 미클리어만 후보
        assert calls["grant"] == unit.id

    def test_대상_유닛_없으면_None_무동작(self, monkeypatch):
        async def fake_find(db, user, **kwargs):
            return None

        async def fail_grant(db, user, unit_id):
            raise AssertionError("대상이 없으면 grant를 호출하면 안 된다")

        monkeypatch.setattr(cs, "find_crown_unit", fake_find)
        monkeypatch.setattr(cs, "grant_unit_crown", fail_grant)
        award = asyncio.run(
            cs.award_crown_for_activity(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="quiz"
            )
        )
        assert award is None


class TestUnitResultForSession:
    def test_grant_crown이면_grant_반환을_그대로_노출(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, crown_target=2)

        async def fake_grant(db, user, unit_id):
            return {
                "crowns": 2, "cleared": True, "newly_cleared": True, "xp_earned": 20,
            }

        monkeypatch.setattr(cs, "grant_unit_crown", fake_grant)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=True, grant_crown=True,
            )
        )
        assert result == {
            "all_correct": True, "crowns": 2, "crown_target": 2,
            "cleared": True, "unit_xp": 20,
        }

    def test_grant_없는_경로는_저장된_진도_스냅샷(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, crown_target=2)

        async def fake_progress(db, user):
            return {unit.id: prog(crowns=1)}

        async def fail_grant(db, user, unit_id):
            raise AssertionError("grant_crown=False면 왕관을 가산하면 안 된다")

        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
        monkeypatch.setattr(cs, "grant_unit_crown", fail_grant)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=False, grant_crown=False,
            )
        )
        assert result == {
            "all_correct": False, "crowns": 1, "crown_target": 2,
            "cleared": False, "unit_xp": 0,
        }

    def test_진도_행_없으면_0_스냅샷(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1)

        async def fake_progress(db, user):
            return {}

        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=True, grant_crown=False,
            )
        )
        assert result["crowns"] == 0 and result["cleared"] is False

    def test_유닛_미존재면_None(self):
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(None), _FAKE_USER, uuid.uuid4(),
                all_correct=True, grant_crown=True,
            )
        )
        assert result is None

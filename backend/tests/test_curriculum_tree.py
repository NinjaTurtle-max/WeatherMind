"""커리큘럼 트리 구성·잠금 판정·왕관 가산 단위 테스트 — 스프린트 R5-01 §3.2.

is_locked·build_curriculum·plan_crown은 DB 의존이 없는 순수 함수라 선행 잠금
(선행 미완료/완료), 섹션 정렬, 유닛 clear 왕관/XP 1회를 DB 없이 검증한다.

추가로 실제 데이터 저작물(database/seed/units.json, slug 방식 12유닛)을 로드해
로더 스키마 정합·prereq 존재/순환·선행 잠금 체인 생존을 검증한다 — 백엔드 로더와
데이터 스키마 불일치(prereq 소실 → 잠금 붕괴) 재발을 가드한다.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from app.scripts.seed_units import validate_entry as validate_unit
from app.services import curriculum_service as cs
from app.services import xp_service

UNITS_JSON = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "units.json"
)


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


def ability(tag, theta, n=1):
    """load_abilities 반환 형식의 개념 θ 1건."""
    return {"concept_tag": tag, "theta": theta, "se": 0.4, "n": n}


def chain(n=3, section="하늘 읽기"):
    """prereq로 이어진 선형 유닛 체인 n개."""
    units = [make_unit(section, 1)]
    for i in range(2, n + 1):
        units.append(make_unit(section, i, prereq=units[-1].id))
    return units


def flat_views(tree):
    return {u["id"]: u for s in tree for u in s["units"]}


class TestIsLocked:
    def test_선행_없는_첫_유닛은_무잠금(self):
        u = make_unit("하늘 읽기", 1)
        assert cs.is_locked(u, {}) is False

    def test_선행_미완료면_잠금(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        assert cs.is_locked(u2, {}) is True
        assert cs.is_locked(u2, {u1.id: prog(crowns=0)}) is True

    def test_선행_crowns_1이상이면_열림(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        assert cs.is_locked(u2, {u1.id: prog(crowns=1)}) is False

    # ── 배치 선해제 (R7-02 §3.4) — unlock_floor·order_index ──

    def test_unlock_floor_안이면_prereq_무관_열림(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, unlock_floor=2, order_index=1) is False

    def test_unlock_floor_밖이면_기존_prereq_규칙(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, unlock_floor=1, order_index=1) is True
        assert (
            cs.is_locked(
                u2, {u1.id: prog(crowns=1)}, unlock_floor=1, order_index=1
            )
            is False
        )

    def test_기본값_floor_0은_현행_동작(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, order_index=1) is True
        assert cs.is_locked(u2, {}, unlock_floor=0, order_index=1) is True


class TestPlacementUnlockFloor:
    """§3.4 시작점 산출 — 선두 연속 "θ≥0.5 AND n>0"만 인정 (순수)."""

    def _units(self):
        # 전체 순서: 하늘 읽기(pressure_front×2) → 공기의 힘(air_mass) → 큰 바람(typhoon)
        return [
            make_unit("하늘 읽기", 1, concept_tag="pressure_front"),
            make_unit("하늘 읽기", 2, concept_tag="pressure_front"),
            make_unit("공기의 힘", 1, concept_tag="air_mass"),
            make_unit("큰 바람", 1, concept_tag="typhoon"),
        ]

    def test_빈_abilities는_0(self):
        assert cs.placement_unlock_floor([], self._units()) == 0

    def test_n_0_사전_θ는_불인정(self):
        abilities = [ability("pressure_front", 2.0, n=0)]
        assert cs.placement_unlock_floor(abilities, self._units()) == 0

    def test_경계_0_5는_포함_미만은_제외(self):
        units = self._units()
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 0.5)], units
        ) == 2  # 선두 pressure_front 2개
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 0.49)], units
        ) == 0

    def test_연속_끊기면_중단_중간_점프_없음(self):
        # air_mass가 낮으면 뒤의 typhoon이 높아도 3·4번째는 열리지 않는다
        abilities = [
            ability("pressure_front", 1.0),
            ability("air_mass", 0.0),
            ability("typhoon", 2.0),
        ]
        assert cs.placement_unlock_floor(abilities, self._units()) == 2

    def test_전부_통과면_전체_개수(self):
        abilities = [
            ability("pressure_front", 1.0),
            ability("air_mass", 0.7),
            ability("typhoon", 0.5),
        ]
        assert cs.placement_unlock_floor(abilities, self._units()) == 4

    def test_전체_순서는_SECTION_ORDER_기준(self):
        # 입력 순서를 섞어도 ordered_units(섹션 교육 순서)가 선두를 결정한다
        units = list(reversed(self._units()))
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 1.0)], units
        ) == 2


class TestStatus:
    """UnitOut.status 파생(§3.4) — cleared/current/unlocked/locked 각 1케이스."""

    def test_cleared(self):
        u1, u2, u3 = chain(3)
        tree = cs.build_curriculum(
            [u1, u2, u3], {u1.id: prog(crowns=1, cleared=True)}
        )
        assert flat_views(tree)[u1.slug]["status"] == "cleared"

    def test_current는_잠기지_않은_첫_미클리어_1개(self):
        u1, u2, u3 = chain(3)
        views = flat_views(cs.build_curriculum([u1, u2, u3], {}))
        assert views[u1.slug]["status"] == "current"
        statuses = [v["status"] for v in views.values()]
        assert statuses.count("current") == 1

    def test_unlocked_열렸으나_current_아님(self):
        u1, u2, u3 = chain(3)
        views = flat_views(cs.build_curriculum([u1, u2, u3], {}, unlock_floor=3))
        assert views[u1.slug]["status"] == "current"
        assert views[u2.slug]["status"] == "unlocked"
        assert views[u3.slug]["status"] == "unlocked"
        assert all(v["locked"] is False for v in views.values())

    def test_locked(self):
        u1, u2, u3 = chain(3)
        views = flat_views(cs.build_curriculum([u1, u2, u3], {}))
        assert views[u3.slug]["status"] == "locked"
        assert views[u3.slug]["locked"] is True

    def test_기존_필드는_불변_유지(self):
        """additive 계약 — crowns/cleared/locked 키가 그대로 남는다."""
        u1, u2, u3 = chain(3)
        views = flat_views(cs.build_curriculum([u1, u2, u3], {}))
        for v in views.values():
            assert {"crowns", "cleared", "locked", "status"} <= set(v)


class TestBuildCurriculum:
    def test_섹션은_교육적_순서_유닛은_order_오름차순(self):
        units = [
            make_unit("큰 바람", 2),
            make_unit("하늘 읽기", 2),
            make_unit("하늘 읽기", 1),
            make_unit("공기의 힘", 1),
        ]
        tree = cs.build_curriculum(units, {})
        assert [s["section"] for s in tree] == ["하늘 읽기", "공기의 힘", "큰 바람"]
        sky = tree[0]["units"]
        assert [u["unit_order"] for u in sky] == [1, 2]

    def test_id와_prereq는_slug로_노출(self):
        u1 = make_unit("하늘 읽기", 1, slug="read-1")
        u2 = make_unit("하늘 읽기", 2, slug="read-2", prereq=u1.id)
        tree = cs.build_curriculum([u1, u2], {})
        views = {v["unit_order"]: v for v in tree[0]["units"]}
        assert views[1]["id"] == "read-1"
        assert views[1]["prereq_unit_id"] is None
        assert views[2]["id"] == "read-2"
        assert views[2]["prereq_unit_id"] == "read-1"  # UUID FK → slug 변환 노출

    def test_진도_잠금_반영(self):
        u1 = make_unit("하늘 읽기", 1)
        u2 = make_unit("하늘 읽기", 2, prereq=u1.id)
        progress = {u1.id: prog(crowns=1, cleared=True)}
        tree = cs.build_curriculum([u1, u2], progress)
        views = {v["unit_order"]: v for v in tree[0]["units"]}
        assert views[1]["crowns"] == 1
        assert views[1]["cleared"] is True
        assert views[1]["locked"] is False
        assert views[2]["locked"] is False  # 선행 clear → 열림

    def test_미등재_섹션은_뒤로(self):
        units = [make_unit("특수 주제", 1), make_unit("하늘 읽기", 1)]
        tree = cs.build_curriculum(units, {})
        assert tree[0]["section"] == "하늘 읽기"
        assert tree[-1]["section"] == "특수 주제"


class TestPlanCrown:
    def test_최초_clear는_왕관1_XP20(self):
        assert cs.plan_crown(0, cleared=False, crown_target=1) == (
            1, True, xp_service.XP_UNIT_CLEAR
        )

    def test_이미_cleared면_XP_0(self):
        assert cs.plan_crown(1, cleared=True, crown_target=1) == (1, False, 0)

    def test_crown_target_다단계_중간은_XP_없음(self):
        assert cs.plan_crown(1, cleared=False, crown_target=3) == (2, False, 0)

    def test_crown_target_도달시_cleared_전환_XP1회(self):
        assert cs.plan_crown(2, cleared=False, crown_target=3) == (
            3, True, xp_service.XP_UNIT_CLEAR
        )

    def test_target_초과_미가산(self):
        assert cs.plan_crown(3, cleared=True, crown_target=3) == (3, False, 0)


class TestUnitSeedValidation:
    """units.json 로더 스키마 검증(§3.2, slug 방식) — 데이터 병렬 저작 계약 가드."""

    def test_정상_유닛_통과(self):
        entry = {
            "id": "read-sky-pressure",
            "section": "하늘 읽기",
            "unit_order": 1,
            "title": "구름 관찰",
            "concept_tag": "pressure_front",
            "kind": "quiz",
            "prereq_unit_id": None,
        }
        assert validate_unit(entry, 0) == []

    def test_prereq_slug_문자열_허용(self):
        entry = {
            "id": "read-sky-board",
            "section": "하늘 읽기",
            "unit_order": 3,
            "title": "지도 퍼즐",
            "concept_tag": "pressure_front",
            "kind": "board",
            "crown_target": 2,
            "prereq_unit_id": "read-sky-fronts",
        }
        assert validate_unit(entry, 0) == []

    def test_id_slug_누락_검출(self):
        entry = {
            "section": "s",
            "unit_order": 1,
            "title": "t",
            "concept_tag": "typhoon",
            "kind": "quiz",
        }
        assert any("id(slug)" in e for e in validate_unit(entry, 0))

    def test_kind_concept_tag_불허_검출(self):
        entry = {
            "id": "x",
            "section": "s",
            "unit_order": 1,
            "title": "t",
            "concept_tag": "unknown",
            "kind": "essay",
        }
        errors = validate_unit(entry, 0)
        assert any("concept_tag" in e for e in errors)
        assert any("kind" in e for e in errors)

    def test_prereq_형식_위반_검출(self):
        entry = {
            "id": "x",
            "section": "s",
            "unit_order": 1,
            "title": "t",
            "concept_tag": "typhoon",
            "kind": "quiz",
            "prereq_unit_id": 3,
        }
        assert any("prereq_unit_id" in e for e in validate_unit(entry, 0))


# ═══════════════════════════════════════════════════════════════
# 실제 데이터 저작물(database/seed/units.json) 통합 로드·검증
# ═══════════════════════════════════════════════════════════════


def _load_real_units() -> list[dict]:
    return json.loads(UNITS_JSON.read_text(encoding="utf-8"))


def _units_from_json(entries: list[dict]) -> list[SimpleNamespace]:
    """units.json 항목을 build_curriculum/is_locked가 쓰는 unit 유사 객체로 변환한다.

    적재 후 상태를 모사한다: 내부 키(id)와 slug를 모두 slug로 두어, prereq_unit_id도
    slug로 참조하게 한다(progress도 slug 키). 순수 함수는 키 타입에 무관하므로 실제
    적재(UUID 키)와 동일한 잠금 판정을 재현한다.
    """
    return [
        SimpleNamespace(
            id=e["id"],
            slug=e["id"],
            section=e["section"],
            unit_order=e["unit_order"],
            title=e["title"],
            concept_tag=e["concept_tag"],
            kind=e["kind"],
            crown_target=e.get("crown_target", 1),
            prereq_unit_id=e["prereq_unit_id"],
        )
        for e in entries
    ]


def _has_cycle(entries: list[dict]) -> bool:
    """prereq_unit_id 함수형 그래프(진출차수<=1)에 순환이 있는지 (자기참조 포함)."""
    edge = {
        e["id"]: e["prereq_unit_id"]
        for e in entries
        if e.get("prereq_unit_id") is not None
    }
    for start in edge:
        seen, node = set(), start
        while node in edge and node not in seen:
            seen.add(node)
            node = edge[node]
        if node in seen:  # 경로가 자기 자신으로 되돌아옴
            return True
    return False


# 선행 없는 루트 유닛 — 시드에서 파생(R12 AU-2: 기상 단일 루트 + 기초과학은
# specs/11 §2 "섹션 간 선행 없음" 규약이라 섹션 첫 유닛 3개가 루트).
def _real_roots() -> set[str]:
    return {u["id"] for u in _load_real_units() if u["prereq_unit_id"] is None}


class TestRealUnitsJson:
    """실제 units.json(기상 12 + 기초과학 8 = 20유닛, slug 방식) 적재 정합·잠금 체인 생존 검증."""

    def test_파일_로드_및_20유닛(self):
        units = _load_real_units()
        assert isinstance(units, list) and len(units) == 20
        by_course: dict[str, int] = {}
        for u in units:
            by_course[u.get("course")] = by_course.get(u.get("course"), 0) + 1
        assert by_course == {"weather": 12, "basic-science": 8}

    def test_로더_스키마_전부_통과(self):
        units = _load_real_units()
        errors = [e for i, u in enumerate(units) for e in validate_unit(u, i)]
        assert errors == [], f"로더가 실제 units.json을 거부: {errors}"

    def test_slug_유일(self):
        slugs = [u["id"] for u in _load_real_units()]
        assert len(slugs) == len(set(slugs))

    def test_prereq_존재_및_무순환(self):
        units = _load_real_units()
        known = {u["id"] for u in units}
        dangling = [
            (u["id"], u["prereq_unit_id"])
            for u in units
            if u["prereq_unit_id"] is not None and u["prereq_unit_id"] not in known
        ]
        assert dangling == [], f"존재하지 않는 prereq 참조: {dangling}"
        assert _has_cycle(units) is False

    def test_초기_잠금_체인_루트만_열림(self):
        """진도 0: prereq 없는 루트 유닛만 열리고 나머지는 전부 잠금(체인 생존)."""
        units = _units_from_json(_load_real_units())
        tree = cs.build_curriculum(units, {})
        flat = {u["id"]: u for s in tree for u in s["units"]}
        assert len(flat) == 20
        unlocked = {uid for uid, v in flat.items() if not v["locked"]}
        roots = {u.slug for u in units if u.prereq_unit_id is None}
        assert unlocked == roots
        # 데이터 핀: 기상 단일 루트 + 기초과학 섹션 첫 유닛 3개(specs/11 §2)
        assert roots == {
            "read-sky-pressure", "bs-temp-vs-heat", "bs-pressure", "bs-phase-change",
        }
        # prereq가 있는 유닛은 진도 0에서 전부 잠금 — 잠금 소실 회귀 가드
        assert sum(1 for v in flat.values() if v["locked"]) == len(flat) - len(roots)
        # status 파생: 전체 순서상 첫 루트(하늘 읽기)가 유일한 current
        assert flat["read-sky-pressure"]["status"] == "current"
        assert sum(1 for v in flat.values() if v["status"] == "current") == 1
        assert sum(1 for v in flat.values() if v["status"] == "locked") == len(
            flat
        ) - len(roots)

    def test_선행_clear시_다음_유닛만_열림(self):
        units = _units_from_json(_load_real_units())
        # 루트(read-sky-pressure) crowns=1 → 그 직후 유닛(read-sky-fronts)만 추가 해제
        progress = {"read-sky-pressure": prog(crowns=1)}
        tree = cs.build_curriculum(units, progress)
        flat = {u["id"]: u for s in tree for u in s["units"]}
        assert flat["read-sky-pressure"]["locked"] is False
        assert flat["read-sky-fronts"]["locked"] is False  # 선행 clear → 열림
        assert flat["read-sky-board"]["locked"] is True  # 그 다음은 여전히 잠금
        # status: 미클리어 선두(pressure)가 current, fronts는 unlocked
        assert flat["read-sky-pressure"]["status"] == "current"
        assert flat["read-sky-fronts"]["status"] == "unlocked"
        assert flat["read-sky-board"]["status"] == "locked"

    def test_배치_선해제_실데이터_시작점(self):
        """§3.4 소급 적용: pressure_front θ≥0.5(실응답)면 하늘 읽기 3유닛 선해제.

        선해제 유닛은 왕관 0 그대로(잠금만 해제)이고, current는 첫 미클리어
        유닛(read-sky-pressure — 클리어 강제 아님)에 남는다.
        """
        units = _units_from_json(_load_real_units())
        abilities = [ability("pressure_front", 0.8, n=5)]
        floor = cs.placement_unlock_floor(abilities, units)
        assert floor == 3  # 하늘 읽기 pressure_front 3유닛(선두 연속)
        tree = cs.build_curriculum(units, {}, unlock_floor=floor)
        flat = {u["id"]: u for s in tree for u in s["units"]}
        opened = {uid for uid, v in flat.items() if not v["locked"]}
        # 선해제 3유닛 + 진도 0에서도 열려 있는 루트 유닛(기초과학 섹션 첫 유닛 포함)
        assert opened == {
            "read-sky-pressure", "read-sky-fronts", "read-sky-board",
        } | _real_roots()
        # 잠금만 해제 — 왕관·클리어는 소급되지 않는다
        assert all(flat[uid]["crowns"] == 0 for uid in opened)
        assert flat["read-sky-pressure"]["status"] == "current"
        assert flat["read-sky-fronts"]["status"] == "unlocked"
        assert flat["air-power-masses"]["status"] == "locked"

    def test_순차_클리어로_전_체인_해제(self):
        """의존 순서대로 각 유닛을 clear하면 다음이 열려 결국 20유닛 전부 해제된다."""
        entries = _load_real_units()
        units = _units_from_json(entries)
        # prereq_unit_id로 위상 순서(루트→말단) 구성 (선형·분기 무관)
        by_slug = {e["id"]: e for e in entries}
        progress: dict[str, SimpleNamespace] = {}
        cleared_order: list[str] = []
        remaining = {e["id"] for e in entries}
        # 반복적으로 "선행이 모두 clear된" 유닛을 clear
        while remaining:
            newly = [
                slug
                for slug in remaining
                if by_slug[slug]["prereq_unit_id"] is None
                or by_slug[slug]["prereq_unit_id"] in progress
            ]
            assert newly, f"진행 불가 — 잠금 교착(체인 붕괴): 남은 {remaining}"
            for slug in newly:
                progress[slug] = prog(crowns=1)
                cleared_order.append(slug)
                remaining.discard(slug)
        # 전부 clear된 최종 상태: 잠금 0
        tree = cs.build_curriculum(units, progress)
        locked = [u["id"] for s in tree for u in s["units"] if u["locked"]]
        assert locked == []
        assert len(cleared_order) == 20
        # 첫 배치는 정확히 루트 집합(진도 0에서 열려 있는 유닛들 — 순서는
        # 집합 순회라 비결정이므로 집합으로 판정)
        roots = _real_roots()
        assert set(cleared_order[: len(roots)]) == roots

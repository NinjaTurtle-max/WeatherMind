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


#: 픽스처용 섹션명 — **리터럴을 쓰지 않고 SECTION_ORDER에서 뽑는다**.
#:
#: ⚠️ 2026-08-12: 종전엔 "하늘 읽기"·"공기의 힘"·"큰 바람"을 그대로 적었다.
#: CO-G1 순환식 재구조화로 그 이름들이 SECTION_ORDER에서 빠지면서, 섹션 **순서**를
#: 단정하는 테스트들이 `_section_key`의 미등재 폴백(알파벳 정렬)을 타고 조용히
#: 뒤집혔다 — 값이 틀린 게 아니라 검사 대상이 바뀌어 버린 형태다. 등재된 앞
#: 3섹션을 뽑아 쓰면 섹션명이 또 바뀌어도 이 파일은 고칠 데가 없다.
SEC1, SEC2, SEC3 = cs.SECTION_ORDER[:3]
#: SECTION_ORDER **미등재** 섹션 — 정렬 폴백(뒤로 밀림)을 검증하는 케이스 전용.
UNREGISTERED_SECTION = "특수 주제"
assert UNREGISTERED_SECTION not in cs.SECTION_ORDER


def prog(crowns=0, cleared=False):
    return SimpleNamespace(
        crowns=crowns,
        cleared_at=datetime.now(timezone.utc) if cleared else None,
    )


def ability(tag, theta, n=1):
    """load_abilities 반환 형식의 개념 θ 1건."""
    return {"concept_tag": tag, "theta": theta, "se": 0.4, "n": n}


def chain(n=3, section=SEC1):
    """prereq로 이어진 선형 유닛 체인 n개."""
    units = [make_unit(section, 1)]
    for i in range(2, n + 1):
        units.append(make_unit(section, i, prereq=units[-1].id))
    return units


def flat_views(tree):
    return {u["id"]: u for s in tree for u in s["units"]}


class TestIsLocked:
    def test_선행_없는_첫_유닛은_무잠금(self):
        u = make_unit(SEC1, 1)
        assert cs.is_locked(u, {}) is False

    def test_선행_미완료면_잠금(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        assert cs.is_locked(u2, {}) is True
        assert cs.is_locked(u2, {u1.id: prog(crowns=0)}) is True

    def test_선행_crowns_1이상이면_열림(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        assert cs.is_locked(u2, {u1.id: prog(crowns=1)}) is False

    # ── 배치 선해제 (R7-02 §3.4) — unlock_floor·order_index ──

    def test_unlock_floor_안이면_prereq_무관_열림(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, unlock_floor=2, order_index=1) is False

    def test_unlock_floor_밖이면_기존_prereq_규칙(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, unlock_floor=1, order_index=1) is True
        assert (
            cs.is_locked(
                u2, {u1.id: prog(crowns=1)}, unlock_floor=1, order_index=1
            )
            is False
        )

    def test_기본값_floor_0은_현행_동작(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        assert cs.is_locked(u2, {}, order_index=1) is True
        assert cs.is_locked(u2, {}, unlock_floor=0, order_index=1) is True


class TestPlacementUnlockFloor:
    """§3.4 시작점 산출 — 선두 연속 "θ≥임계 AND n>0"만 인정 (순수).

    임계는 **학령 상대**다(R13 CO-V-2 = CO-U-3-B) — middle_high가 0.5라 아래
    기존 수치는 그대로 유지되고, 학령별 이동은 test_weatherbrain_relative_thresholds.py::TestUnlockWiring가
    별도로 고정한다.
    """

    def _units(self):
        # 전체 순서: SEC1(pressure_front×2) → SEC2(air_mass) → SEC3(typhoon)
        return [
            make_unit(SEC1, 1, concept_tag="pressure_front"),
            make_unit(SEC1, 2, concept_tag="pressure_front"),
            make_unit(SEC2, 1, concept_tag="air_mass"),
            make_unit(SEC3, 1, concept_tag="typhoon"),
        ]

    def test_빈_abilities는_0(self):
        assert cs.placement_unlock_floor([], self._units(), "middle_high") == 0

    def test_n_0_사전_θ는_불인정(self):
        abilities = [ability("pressure_front", 2.0, n=0)]
        assert cs.placement_unlock_floor(abilities, self._units(), "middle_high") == 0

    def test_경계_0_5는_포함_미만은_제외(self):
        units = self._units()
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 0.5)], units, "middle_high"
        ) == 2  # 선두 pressure_front 2개
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 0.49)], units, "middle_high"
        ) == 0

    def test_연속_끊기면_중단_중간_점프_없음(self):
        # air_mass가 낮으면 뒤의 typhoon이 높아도 3·4번째는 열리지 않는다
        abilities = [
            ability("pressure_front", 1.0),
            ability("air_mass", 0.0),
            ability("typhoon", 2.0),
        ]
        assert cs.placement_unlock_floor(abilities, self._units(), "middle_high") == 2

    def test_전부_통과면_전체_개수(self):
        abilities = [
            ability("pressure_front", 1.0),
            ability("air_mass", 0.7),
            ability("typhoon", 0.5),
        ]
        assert cs.placement_unlock_floor(abilities, self._units(), "middle_high") == 4

    def test_전체_순서는_SECTION_ORDER_기준(self):
        # 입력 순서를 섞어도 ordered_units(섹션 교육 순서)가 선두를 결정한다
        units = list(reversed(self._units()))
        assert cs.placement_unlock_floor(
            [ability("pressure_front", 1.0)], units, "middle_high"
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
            make_unit(SEC3, 2),
            make_unit(SEC1, 2),
            make_unit(SEC1, 1),
            make_unit(SEC2, 1),
        ]
        tree = cs.build_curriculum(units, {})
        assert [s["section"] for s in tree] == [SEC1, SEC2, SEC3]
        sky = tree[0]["units"]
        assert [u["unit_order"] for u in sky] == [1, 2]

    def test_id와_prereq는_slug로_노출(self):
        u1 = make_unit(SEC1, 1, slug="read-1")
        u2 = make_unit(SEC1, 2, slug="read-2", prereq=u1.id)
        tree = cs.build_curriculum([u1, u2], {})
        views = {v["unit_order"]: v for v in tree[0]["units"]}
        assert views[1]["id"] == "read-1"
        assert views[1]["prereq_unit_id"] is None
        assert views[2]["id"] == "read-2"
        assert views[2]["prereq_unit_id"] == "read-1"  # UUID FK → slug 변환 노출

    def test_진도_잠금_반영(self):
        u1 = make_unit(SEC1, 1)
        u2 = make_unit(SEC1, 2, prereq=u1.id)
        progress = {u1.id: prog(crowns=1, cleared=True)}
        tree = cs.build_curriculum([u1, u2], progress)
        views = {v["unit_order"]: v for v in tree[0]["units"]}
        assert views[1]["crowns"] == 1
        assert views[1]["cleared"] is True
        assert views[1]["locked"] is False
        assert views[2]["locked"] is False  # 선행 clear → 열림

    def test_미등재_섹션은_뒤로(self):
        units = [make_unit(UNREGISTERED_SECTION, 1), make_unit(SEC1, 1)]
        tree = cs.build_curriculum(units, {})
        assert tree[0]["section"] == SEC1
        assert tree[-1]["section"] == UNREGISTERED_SECTION


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
            "section": SEC1,
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
            "section": SEC1,
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
    """실제 units.json(기상 138 · 기초과학 99 = **237유닛 · 13섹션**) 적재 정합·잠금 체인 검증.

    ⚠️ **2026-08-12: 24 → 93 → 237.** 기상 코스 섹션을 주제 5종에서 **지식 단계 10종**으로
    바꾼 순환식 재구조화다(CO-G1 · 설계 근거 `docs/design/cyclic_sections.md`).
    기초과학은 **별도 코스로 유지**되어 자기 3섹션을 그대로 갖는다(10 + 3 = 13섹션).
    기존 24유닛은 **하나도 지우지 않고** id를 보존한 채 재배치했으므로, 여기 리터럴이
    바뀐 것은 유닛이 사라져서가 아니라 **선두가 바뀌어서**다 —
    `read-sky-pressure`는 여전히 존재하고 「중학교 유체 지구」(kl4)에 앉아 있다.

    237로의 2차 확대는 **문항 소진율**이 이유다(45% → 97.7%): 유닛이 93개면
    `UNIT_SESSION_SIZE`를 곱해도 뱅크 1,012건의 절반이 학습 경로에서 도달 불가였다.
    같은 산출에서 `UNIT_SESSION_SIZE`가 5 → 4로 내려갔다(config.py 주석의 부등식
    `quiz 유닛 수 × UNIT_SESSION_SIZE ≤ 946`).

    아래 수치는 전부 2026-08-12 시드 실측이다. 저작이 진행되면 여기가 먼저 운다 —
    그것이 이 핀의 목적이다(유닛이 조용히 사라지는 것을 잡는 트립와이어).
    """

    def test_파일_로드_및_237유닛(self):
        units = _load_real_units()
        assert isinstance(units, list) and len(units) == 237
        by_course: dict[str, int] = {}
        for u in units:
            by_course[u.get("course")] = by_course.get(u.get("course"), 0) + 1
        assert by_course == {"weather": 138, "basic-science": 99}

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
        assert len(flat) == 237
        unlocked = {uid for uid, v in flat.items() if not v["locked"]}
        roots = {u.slug for u in units if u.prereq_unit_id is None}
        assert unlocked == roots
        # 데이터 핀: 기상 단일 루트(CO-G1 §4.1 규칙 6 — 섹션 안에서 이어지고 섹션
        # 첫 유닛은 앞 섹션 마지막을 가리키는 단일 사슬) + 기초과학 섹션 첫 유닛
        # 3개(specs/11 §2 "섹션 간 선행 없음").
        # 기상 루트가 read-sky-pressure → **w01-pressure-front**로 옮겨간 것은
        # 순환식 재구조화의 귀결이다: 선두 섹션이 「하늘 읽기」에서
        # 「초등 3~4학년」(kl1)이 됐고, 그 섹션 첫 유닛이 새 루트다.
        # ⚠️ 237유닛 재산출에서 기초과학 루트 하나가 `bs-pressure` →
        # **`pressure-basics-kl01-mc`**로 바뀌었다(그 섹션 첫 유닛이 새 유닛이 됐다).
        # `bs-pressure`는 사라진 게 아니라 **선두가 아니게** 된 것이다 —
        # 기존 93 id는 전건 보존됐다(사라진 id 0건).
        assert roots == {
            "w01-pressure-front", "bs-temp-vs-heat",
            "pressure-basics-kl01-mc", "bs-phase-change",
        }
        # prereq가 있는 유닛은 진도 0에서 전부 잠금 — 잠금 소실 회귀 가드
        assert sum(1 for v in flat.values() if v["locked"]) == len(flat) - len(roots)
        # status 파생: 전체 순서상 첫 루트(초등 3~4학년 선두)가 유일한 current
        assert flat["w01-pressure-front"]["status"] == "current"
        assert sum(1 for v in flat.values() if v["status"] == "current") == 1
        assert sum(1 for v in flat.values() if v["status"] == "locked") == len(
            flat
        ) - len(roots)

    def test_선행_clear시_다음_유닛만_열림(self):
        units = _units_from_json(_load_real_units())
        # 루트(w01-pressure-front) crowns=1 → 그 직후 유닛(w01-air-mass)만 추가 해제.
        # 선행 사슬이 섹션 안에서 **개념을 가로지른다**(pressure_front → air_mass →
        # typhoon)는 것이 순환식 구조의 정의다 — 종전엔 같은 개념 3연속이었다
        # (CO-G1 §4.1 규칙 5·6).
        progress = {"w01-pressure-front": prog(crowns=1)}
        tree = cs.build_curriculum(units, progress)
        flat = {u["id"]: u for s in tree for u in s["units"]}
        assert flat["w01-pressure-front"]["locked"] is False
        assert flat["w01-air-mass"]["locked"] is False  # 선행 clear → 열림
        assert flat["w01-typhoon"]["locked"] is True  # 그 다음은 여전히 잠금
        # status: 미클리어 선두(pressure)가 current, air-mass는 unlocked
        assert flat["w01-pressure-front"]["status"] == "current"
        assert flat["w01-air-mass"]["status"] == "unlocked"
        assert flat["w01-typhoon"]["status"] == "locked"

    def test_배치_선해제_실데이터_시작점(self):
        """§3.4 소급 적용: pressure_front θ≥임계(실응답)면 선두 1유닛 선해제.

        ⚠️ **2026-08-12: floor 3 → 1.** 결함이 아니라 순환식 구조의 귀결이다
        (`docs/design/cyclic_sections.md` §5-④). 종전 「하늘 읽기」는 선두 3유닛이
        전부 `pressure_front`라 θ 하나로 3유닛이 열렸다. 새 구조는 섹션 안에서
        개념이 **교차**하므로(pressure_front → air_mass → typhoon …) 선두 연속
        구간이 1유닛뿐이다. `placement_unlock_floor`는 "선두 연속"만 인정하고
        중간 점프를 하지 않으므로, 개념이 바뀌는 두 번째 유닛에서 즉시 멈춘다.

        선해제를 되살리려면 floor가 "선두 연속"이 아니라 "개념별 최고 도달 섹션"을
        보게 바꿔야 한다 — 별도 판정 사항이고 이 테스트의 범위가 아니다.

        선해제 유닛은 왕관 0 그대로(잠금만 해제)이고, current는 첫 미클리어
        유닛(w01-pressure-front — 클리어 강제 아님)에 남는다.
        """
        units = _units_from_json(_load_real_units())
        # 선두 유닛의 개념 = pressure_front (「초등 3~4학년」 첫 칸)
        abilities = [ability("pressure_front", 0.8, n=5)]
        floor = cs.placement_unlock_floor(abilities, units, "middle_high")
        assert floor == 1  # 선두 1유닛에서 개념이 바뀌어 중단
        tree = cs.build_curriculum(units, {}, unlock_floor=floor)
        flat = {u["id"]: u for s in tree for u in s["units"]}
        opened = {uid for uid, v in flat.items() if not v["locked"]}
        # 선해제 1유닛 + 진도 0에서도 열려 있는 루트 유닛(기초과학 섹션 첫 유닛 포함).
        # 선해제분이 마침 기상 루트와 같은 유닛이라 합집합이 루트 집합과 일치한다 —
        # 그래도 왼쪽 항을 남긴다: floor가 2 이상으로 돌아오면 이 등식이 깨져야 한다.
        assert opened == {"w01-pressure-front"} | _real_roots()
        # 잠금만 해제 — 왕관·클리어는 소급되지 않는다
        assert all(flat[uid]["crowns"] == 0 for uid in opened)
        assert flat["w01-pressure-front"]["status"] == "current"
        # floor가 1이라 두 번째 유닛부터 잠금 — 선해제가 개념 경계에서 멈춘 증거
        assert flat["w01-air-mass"]["status"] == "locked"
        assert flat["w01-typhoon"]["status"] == "locked"

    def test_순차_클리어로_전_체인_해제(self):
        """의존 순서대로 각 유닛을 clear하면 다음이 열려 결국 237유닛 전부 해제된다."""
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
        assert len(cleared_order) == 237
        # 첫 배치는 정확히 루트 집합(진도 0에서 열려 있는 유닛들 — 순서는
        # 집합 순회라 비결정이므로 집합으로 판정)
        roots = _real_roots()
        assert set(cleared_order[: len(roots)]) == roots

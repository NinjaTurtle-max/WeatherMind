"""배치고사 선해제가 **배정된 지식 단계까지** 연다 — 2026-08-13 클라이언트 제보.

> *"내가 배치고사를 봐서 나온 수준까지는 학습 세션이 열려야 하는데 안 열리네."*

배선이 끊긴 것이 아니었다. `placement_unlock_floor`는 호출부 6곳에서 정상적으로
불리고 있었고 실서버에서 floor=10을 돌려주고 있었다 — 138유닛 중 10유닛,
**전부 1섹션(초등 3~4학년) 안**. 같은 유저의 `/progress/me`는
`knowledge_level: 5`였다. 화면이 말하는 단계와 트리가 여는 단계가 어긋나 있었다.

원인은 판정 축이다(`placement_unlock_floor` 독스트링 §⑴ 참조):
  ⓐ 배치 도메인(6개념) 밖의 개념(`wildfire_weather` — 기상 11번째 유닛)은 n이
    영원히 0이라 종전 규칙이 "미측정"을 "탈락"으로 읽고 선두 구간을 끊었다.
  ⓑ 종전 임계는 학령 상대일 뿐 **단계 상대가 아니라서**, ⓐ만 풀면 같은 개념이
    재등장하는 10섹션 전건이 열린다(전체 개방 — 금지).

그래서 단계 축이 있는 코스에서는 "유닛 표적 단계 ≤ 배정 단계"로 판정한다.

이 파일이 고정하는 계약 5종:
  1. 상위 수준이 나온 사용자의 유닛이 **그 수준까지** 열린다 (밴드 4종 전건)
  2. 배치 미응시(사전 θ 행 n=0)는 **종전대로** 선해제 0
  3. 선해제가 **선두 연속 구간**을 넘지 않는다 (중간 점프 없음)
  4. **코스 경계**를 넘지 않는다 (기상 배치가 기초과학을 열지 않는다)
  5. **상한이 존재한다** — 얇은 근거로 너무 많이 열지 않는다 (PM 조건 ⑵)

⚠️ **5는 새 축의 반대쪽 실패를 문다.** 옛 규칙의 실패는 「너무 적게 여는 것」이었고
새 규칙의 실패는 「얇은 근거로 너무 많이 여는 것」이다. 3·4는 배관이 부수 효과로
지켜 주지만 **부수 효과는 계약이 아니다** — 각각 변이로 우는지 확인해 두었다
(보고서의 되돌림 표).

──────────────────────────────────────────────────────────────────────────────
**대체되는 의미론 — 다음 감사자를 위해 원문을 인용해 남긴다.**

종전 `placement_unlock_floor`는 이렇게 판정했다(2026-08-13 이전):

    전체 순서(ordered_units) 선두부터 "그 유닛 concept_tag의
    θ ≥ weatherbrain_service.unlock_theta_threshold(level_group) — 자기 학령 밴드의
    **상단 경계** AND num_responses>0"가 연속으로 성립하는 유닛 개수.

이 규칙은 **CO-G1 이전**의 것이다. 섹션이 곧 지식 단계가 된 뒤로는 「개념별 θ vs
밴드 임계」가 **축 자체가 틀린** 것이고, 아래 두 부조리는 그 옛 규칙이 이후 트리를
만났을 때 나오는 증상이다(2026-08-13 합성 실측, 10문항 **전건 정답**):

    adult  — co2_climate·anomaly가 1.407 < 1.5 → floor 5
    expert — 6개념 전건 탈락                    → floor 0

즉 **만점을 받아도 열리지 않는** 밴드가 둘 있었다. 개념당 1~2문항으로는 EAP가
`band_prior + 0.5`에 원리적으로 닿지 못한다.

그리고 이 대체는 **새로 발명한 것이 아니라 미룬 판정을 집행한 것**이다 —
`test_curriculum_tree.py::TestRealUnitsJson::test_배치_선해제_실데이터_시작점`이
2026-08-12에 이렇게 적어 두었다:

    선해제를 되살리려면 floor가 "선두 연속"이 아니라 "개념별 최고 도달 섹션"을
    보게 바꿔야 한다 — 별도 판정 사항이고 이 테스트의 범위가 아니다.
──────────────────────────────────────────────────────────────────────────────
"""
import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs
from app.services import weatherbrain_service as wb

UNITS_JSON = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "units.json"
)

# 기상 코스 = SECTION_ORDER 앞 10섹션 = 지식 단계 1~10 (CO-G1).
WEATHER_SECTIONS = cs.SECTION_ORDER[: cs.WEATHER_SECTION_COUNT]
# 기초과학 섹션 — 단계 축이 **없는** 코스(SECTION_KNOWLEDGE_LEVEL 미등재).
BASIC_SECTIONS = cs.SECTION_ORDER[cs.WEATHER_SECTION_COUNT :]

BANDS = ("elementary", "middle_high", "adult", "expert")


def _unit(section, order, concept_tag="pressure_front", course="weather"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=f"{section}-{order}",
        section=section,
        unit_order=order,
        title="U",
        concept_tag=concept_tag,
        kind="quiz",
        crown_target=1,
        prereq_unit_id=None,
        course_id=course,
    )


def _weather_tree(per_section=2):
    """기상 10섹션 × per_section 유닛 — 섹션 순서가 곧 단계 순서."""
    return [
        _unit(section, order)
        for section in WEATHER_SECTIONS
        for order in range(1, per_section + 1)
    ]


def _measured(theta, tags=wb.PLACEMENT_QUIZ_TAGS, n=2):
    """배치고사 **실응답** 뒤의 abilities — 측정 6개념 n>0 + 나머지 사전값 n=0.

    프로덕션 형태 그대로다: `seed_placement`가 가입 시 CONCEPT_TAGS 전건에 행을
    심고(n=0), 배치 응답이 있는 개념만 n>0으로 갱신된다.
    """
    return [
        {
            "concept_tag": tag,
            "theta": theta if tag in tags else 0.0,
            "se": 0.9,
            "n": n if tag in tags else 0,
        }
        for tag in wb.CONCEPT_TAGS
    ]


def _seeded_only():
    """배치 **미응시** — 가입 시드 사전 θ 행만 존재(전건 n=0).

    ⚠️ 여기서 빈 리스트를 쓰면 안 된다. 프로덕션에 빈 abilities는 없다
    (`seed_placement`가 행을 심는다). 빈 리스트로 쓴 계약은 통과하면서
    실서버는 열려 버리는 것이 이 축의 함정이다.
    """
    return [
        {"concept_tag": tag, "theta": 0.0, "se": 1.0, "n": 0}
        for tag in wb.CONCEPT_TAGS
    ]


def _chain_prereq(units):
    """전체 순서대로 prereq를 이어 붙인다 — 선해제가 없으면 첫 유닛만 열리는 트리."""
    ordered = cs.ordered_units(units)
    for prev, unit in zip(ordered, ordered[1:]):
        unit.prereq_unit_id = prev.id
    return units


def _real_units():
    """`database/seed/units.json` 실데이터 — 대역이 못 보는 층을 위해."""
    rows = json.loads(UNITS_JSON.read_text(encoding="utf-8"))
    by_slug = {r["id"]: uuid.uuid4() for r in rows}
    return [
        SimpleNamespace(
            id=by_slug[r["id"]],
            slug=r["id"],
            section=r["section"],
            unit_order=r["unit_order"],
            title=r["title"],
            concept_tag=r["concept_tag"],
            kind=r.get("kind", "quiz"),
            crown_target=r.get("crown_target", 1),
            prereq_unit_id=by_slug.get(r.get("prereq_unit_id")),
            course_id=r.get("course"),
        )
        for r in rows
    ]


def _real_weather_units():
    return [u for u in _real_units() if u.course_id == "weather"]


def _real_basic_units():
    return [u for u in _real_units() if u.course_id != "weather"]


def _theta_for_level(level):
    """그 지식 단계로 이산화되는 대표 θ (경계값이 아니라 칸 안쪽)."""
    bounds = wb.THETA_KNOWLEDGE_LEVEL_BOUNDS
    lo = bounds[level - 2] if level >= 2 else bounds[0] - 1.0
    hi = bounds[level - 1] if level - 1 < len(bounds) else bounds[-1] + 1.0
    theta = (lo + hi) / 2.0
    assert wb.theta_to_knowledge_level(theta) == level
    return theta


def _band_prior(level_group):
    return wb.band_prior_theta(level_group)


def _placeable(level, level_group):
    """그 밴드에서 단계 L 배정이 **가드 ⑵를 통과하는가**(θ ≥ 밴드 사전평균)."""
    return _theta_for_level(level) >= _band_prior(level_group)


def _expected_level(level, level_group):
    """가드 ⑵·⑶을 통과한 뒤 실제로 배정되는 단계 (없으면 None)."""
    if not _placeable(level, level_group):
        return None
    return min(level, wb.KNOWLEDGE_LEVEL_MAX - 1)


# middle_high(사전평균 0.0)가 배정될 수 있는 대표 단계 — 실서버 재현값과 같다
# (게스트 만점 배치 → /progress/me knowledge_level 5).
MH_LEVEL = 5


# ═══════════════════════════════════════════════════════════════
# 계약 1 — 나온 수준까지 열린다
# ═══════════════════════════════════════════════════════════════


class TestUnlocksUpToPlacedLevel:
    @pytest.mark.parametrize("level", range(1, wb.KNOWLEDGE_LEVEL_MAX + 1))
    @pytest.mark.parametrize("level_group", BANDS)
    def test_배정_단계까지_열린다_포함(self, level, level_group):
        """단계 L로 배정되면 1~L단계 유닛이 열리고 L+1단계부터 잠긴다.

        ⚠️ **밴드 전건 × 단계 전건을 돈다.** 종전 규칙이 adult·expert에서 도달
        불가능했던 것을 middle_high만 보는 테스트가 놓쳤다 — CO-U-3와 같은
        사각지대다. 격자를 다 도는 김에 가드 ⑵(밴드 사전평균 미달이면 선해제
        없음)·⑶(최고 단계는 배정 안 함)도 같은 표에서 고정된다.
        """
        units = _weather_tree(per_section=2)
        abilities = _measured(_theta_for_level(level))

        floor = cs.placement_unlock_floor(abilities, units, level_group)

        placed = _expected_level(level, level_group)
        expected = 0 if placed is None else placed * 2
        assert floor == expected, (
            f"{level_group}·θ단계{level}(배정 {placed}): {expected}유닛이 열려야 "
            f"하는데 {floor}유닛"
        )

    def test_배치_도메인_밖_개념이_선두를_막지_않는다(self):
        """`wildfire_weather`(배치가 묻지 않는 개념)가 선두에 있어도 통과.

        재현 그대로의 형태다 — 기상 **11번째** 유닛이 이 개념이라 실서버 floor가
        138 중 10에서 상한이 걸렸다. 이 개념은 `PLACEMENT_QUIZ_TAGS` 밖이라
        n이 영원히 0이고, 종전 규칙은 그 "미측정"을 "탈락"으로 읽었다.
        """
        units = [
            _unit(WEATHER_SECTIONS[0], 1, concept_tag="pressure_front"),
            _unit(WEATHER_SECTIONS[0], 2, concept_tag="wildfire_weather"),
            _unit(WEATHER_SECTIONS[0], 3, concept_tag="flood_response"),
            _unit(WEATHER_SECTIONS[1], 1, concept_tag="pressure_front"),
        ]
        abilities = _measured(_theta_for_level(MH_LEVEL))
        unmeasured = {"wildfire_weather", "flood_response"}
        assert all(
            ab["n"] == 0 for ab in abilities if ab["concept_tag"] in unmeasured
        ), "픽스처 전제: 배치 도메인 밖 개념은 n=0이어야 한다"

        assert cs.placement_unlock_floor(abilities, units, "middle_high") == 4

    def test_트리에서도_같은_수가_열린다(self):
        """floor가 `build_curriculum`을 통과해 status까지 닿는다(배선 확인).

        prereq 체인을 건 트리라야 의미가 있다 — 체인이 없으면 전 유닛이 어차피
        prereq 무잠금이라 floor가 0이어도 초록이 된다.
        """
        units = _chain_prereq(_weather_tree(per_section=2))
        floor = cs.placement_unlock_floor(
            _measured(_theta_for_level(MH_LEVEL)), units, "middle_high"
        )
        tree = cs.build_curriculum(units, {}, unlock_floor=floor)
        opened = [
            v for section in tree for v in section["units"] if not v["locked"]
        ]
        assert len(opened) == MH_LEVEL * 2
        assert {v["section"] for v in opened} == set(WEATHER_SECTIONS[:MH_LEVEL])

    def test_실데이터_기상_138유닛에서_5단계는_62유닛(self):
        """실서버 재현과 같은 조건을 `units.json` 실데이터로 못 박는다.

        2026-08-13 실측: 게스트(middle_high) 배치 10문항 전건 정답 →
        `/progress/me` `knowledge_level: 5`. 수리 전에는 **10유닛**만 열렸다.
        """
        units = _real_weather_units()
        assert len(units) == 138, "기상 코스 유닛 수가 바뀌었다 — 아래 62도 재확인"
        floor = cs.placement_unlock_floor(
            _measured(_theta_for_level(MH_LEVEL)), units, "middle_high"
        )
        assert floor == 62
        # 열린 것이 정확히 1~5단계 섹션이고, 6단계 이후는 한 건도 없다
        ordered = cs.ordered_units(units)
        assert {u.section for u in ordered[:floor]} == set(
            WEATHER_SECTIONS[:MH_LEVEL]
        )
        assert not {u.section for u in ordered[floor:]} & set(
            WEATHER_SECTIONS[:MH_LEVEL]
        )


# ═══════════════════════════════════════════════════════════════
# 계약 2 — 배치 미응시는 종전대로
# ═══════════════════════════════════════════════════════════════


class TestNoPlacementUnchanged:
    @pytest.mark.parametrize("level_group", BANDS)
    def test_사전_θ_행만_있으면_선해제_0(self, level_group):
        units = _weather_tree(per_section=2)
        assert cs.placement_unlock_floor(_seeded_only(), units, level_group) == 0

    def test_빈_abilities도_0(self):
        assert cs.placement_unlock_floor([], _weather_tree(), "middle_high") == 0

    def test_미응시_트리는_첫_유닛만_열린다(self):
        """prereq 체인 위에서 종전 동작(첫 유닛만)이 그대로인지."""
        units = _chain_prereq(_weather_tree(per_section=2))
        floor = cs.placement_unlock_floor(_seeded_only(), units, "middle_high")
        tree = cs.build_curriculum(units, {}, unlock_floor=floor)
        opened = [
            v for section in tree for v in section["units"] if not v["locked"]
        ]
        assert len(opened) == 1
        assert opened[0]["status"] == "current"

    def test_placed_knowledge_level은_n_0_전건에서_None(self):
        assert cs.placed_knowledge_level(_seeded_only(), "middle_high") is None
        assert cs.placed_knowledge_level([], "middle_high") is None
        assert (
            cs.placed_knowledge_level(
                _measured(_theta_for_level(MH_LEVEL)), "middle_high"
            )
            == MH_LEVEL
        )


# ═══════════════════════════════════════════════════════════════
# 계약 3 — 선두 연속 구간을 넘지 않는다
# ═══════════════════════════════════════════════════════════════


class TestLeadingRunOnly:
    def test_상위_단계_유닛은_뒤에_있어도_안_열린다(self):
        units = _weather_tree(per_section=2)
        floor = cs.placement_unlock_floor(
            _measured(_theta_for_level(MH_LEVEL)), units, "middle_high"
        )
        assert floor == MH_LEVEL * 2
        ordered = cs.ordered_units(units)
        assert all(
            cs.SECTION_KNOWLEDGE_LEVEL[u.section] <= MH_LEVEL
            for u in ordered[:floor]
        )
        assert all(
            cs.SECTION_KNOWLEDGE_LEVEL[u.section] > MH_LEVEL
            for u in ordered[floor:]
        )

    def test_순서가_단조가_아니어도_선두에서_멈춘다(self, monkeypatch):
        """**클램프가 계약이다 — 정렬의 부수 효과가 아니라.**

        ⚠️ 오늘의 `SECTION_ORDER`는 단계 오름차순이라 `break`를 `continue`로
        바꿔도 답이 안 바뀐다(변이 M7이 아무 테스트도 못 울렸다). 즉 "중간을
        건너뛰지 않는다"가 **검증되지 않은 채 참**이었다. 섹션 순서와 단계가
        어긋나는 배치를 만들어 클램프 자체를 문다 — 순서가 언제든 편집될 수 있는
        상수인 이상(실제로 CO-G1에서 통째로 갈렸다) 이 축은 계약이어야 한다.
        """
        # 선두 섹션이 3단계, 그 뒤가 1·2단계 — 단조가 아니다
        remap = {
            WEATHER_SECTIONS[0]: 3,
            WEATHER_SECTIONS[1]: 1,
            WEATHER_SECTIONS[2]: 2,
        }
        monkeypatch.setattr(cs, "SECTION_KNOWLEDGE_LEVEL", remap)
        units = [
            _unit(WEATHER_SECTIONS[0], 1),
            _unit(WEATHER_SECTIONS[1], 1),
            _unit(WEATHER_SECTIONS[2], 1),
        ]
        abilities = _measured(_theta_for_level(MH_LEVEL))

        # 배정 2단계 → 선두(3단계)에서 즉시 중단. 뒤의 1·2단계는 **열리지 않는다**
        monkeypatch.setattr(cs, "placed_knowledge_level", lambda ab, lg: 2)
        assert cs.placement_unlock_floor(abilities, units, "middle_high") == 0

        # 배정 3단계 → 선두부터 연속 성립 → 3유닛 전부
        monkeypatch.setattr(cs, "placed_knowledge_level", lambda ab, lg: 3)
        assert cs.placement_unlock_floor(abilities, units, "middle_high") == 3

    def test_입력_순서를_섞어도_선두는_섹션_순서가_정한다(self):
        units = _weather_tree(per_section=2)
        shuffled = list(reversed(units))
        abilities = _measured(_theta_for_level(4))
        assert cs.placement_unlock_floor(abilities, shuffled, "middle_high") == 8

    def test_구간_밖_유닛은_is_locked가_prereq로_판정한다(self):
        """선해제 밖에서는 선행 잠금이 그대로 산다(prereq를 없앤 것이 아니다)."""
        units = _chain_prereq(_weather_tree(per_section=2))
        floor = cs.placement_unlock_floor(
            _measured(_theta_for_level(MH_LEVEL)), units, "middle_high"
        )
        ordered = cs.ordered_units(units)
        assert floor == MH_LEVEL * 2
        assert cs.is_locked(ordered[floor], {}, floor, floor) is True


# ═══════════════════════════════════════════════════════════════
# 계약 4 — 코스 경계를 넘지 않는다
# ═══════════════════════════════════════════════════════════════


class TestCourseBoundary:
    def test_기상_배치가_기초과학을_열지_않는다(self):
        """기초과학 섹션은 단계 축이 없다 — 종전 개념별 θ 규칙이 걸러 0."""
        units = [
            _unit(section, order, concept_tag="temperature_heat",
                  course="basic-science")
            for section in BASIC_SECTIONS
            for order in (1, 2)
        ]
        abilities = _measured(_theta_for_level(9))  # 기상 만점급 배치
        assert cs.placement_unlock_floor(abilities, units, "middle_high") == 0

    def test_기상_floor가_62여도_기초과학은_0이다(self):
        """PM 조건 ⑵ⓐ — 실데이터에서 두 코스의 floor를 같은 abilities로 대조."""
        weather = _real_weather_units()
        basic = _real_basic_units()
        abilities = _measured(_theta_for_level(MH_LEVEL))

        assert cs.placement_unlock_floor(abilities, weather, "middle_high") == 62
        assert cs.placement_unlock_floor(abilities, basic, "middle_high") == 0

        scoped, floor = cs.active_course_units(
            weather + basic, {}, abilities, "middle_high"
        )
        assert floor == 62
        assert {u.section for u in scoped} <= set(WEATHER_SECTIONS)

    def test_코스_묶음별로_따로_센다(self):
        """`course_groups`가 코스별로 floor를 산출한다 — 인덱스 누수 없음."""
        weather = _weather_tree(per_section=2)
        basic = [
            _unit(section, 1, concept_tag="temperature_heat",
                  course="basic-science")
            for section in BASIC_SECTIONS
        ]
        abilities = _measured(_theta_for_level(MH_LEVEL))

        groups = cs.course_groups(weather + basic)
        assert len(groups) == 2
        floors = [
            cs.placement_unlock_floor(abilities, g, "middle_high") for g in groups
        ]
        assert floors == [MH_LEVEL * 2, 0]

    def test_기초과학_유닛은_기상_단계로_평가되지_않는다(self):
        """섹션이 SECTION_KNOWLEDGE_LEVEL에 없으면 단계 판정 대상이 아니다."""
        for section in BASIC_SECTIONS:
            assert section not in cs.SECTION_KNOWLEDGE_LEVEL
            assert cs.unit_target_level(_unit(section, 1), None) is None


# ═══════════════════════════════════════════════════════════════
# 계약 5 — 상한이 존재한다 (PM 조건 ⑵ⓑ)
# ═══════════════════════════════════════════════════════════════


class TestUpperBound:
    """얇은 근거로 너무 많이 열지 않는다.

    ⚠️ **이 계약이 없으면 이 대체가 퇴행을 들여온다.** EAP는 사전으로 수축하므로
    응답이 전부 오답이어도 θ가 신고 밴드 근처에 남는다 — 옛 규칙에서는 floor 0이던
    「배치 전건 오답」이 단계 축에서는 코스 절반을 여는 값이 된다.
    """

    # 10문항 전건 오답 시의 overall θ (2026-08-13 ai-worker EAP 합성 실측).
    # 값의 소유자는 ai-worker estimate_ability이고, 여기서는 **가드가 이 값들을
    # 전건 탈락시키는지**만 본다.
    ALL_WRONG_THETA = {
        "elementary": -1.320,
        "middle_high": -0.513,
        "adult": 0.269,
        "expert": 1.035,
    }
    # 10문항 전건 정답 시의 overall θ — 전건이 가드를 통과해야 한다.
    ALL_RIGHT_THETA = {
        "elementary": 0.100,
        "middle_high": 0.871,
        "adult": 1.631,
        "expert": 2.352,
    }

    @pytest.mark.parametrize("level_group", BANDS)
    def test_전건_오답은_선해제_0(self, level_group):
        """배치를 다 틀렸는데 열리면 그건 「신고한 수준」이지 「나온 수준」이 아니다."""
        units = _weather_tree(per_section=2)
        abilities = _measured(self.ALL_WRONG_THETA[level_group])
        assert (
            cs.placement_unlock_floor(abilities, units, level_group) == 0
        ), f"{level_group}: 전건 오답인데 열린다"

    @pytest.mark.parametrize("level_group", BANDS)
    def test_전건_정답은_선해제된다(self, level_group):
        """가드가 너무 세서 만점이 막히면 옛 결함(도달 불가)이 되살아난다."""
        units = _weather_tree(per_section=2)
        abilities = _measured(self.ALL_RIGHT_THETA[level_group])
        assert (
            cs.placement_unlock_floor(abilities, units, level_group) > 0
        ), f"{level_group}: 만점인데 안 열린다 — 옛 결함 재발"

    @pytest.mark.parametrize("level_group", BANDS)
    def test_전체_개방은_어느_밴드에서도_안_난다(self, level_group):
        """실데이터 138유닛이 통째로 열리는 일은 없다 — 최고 단계는 학습으로 닿는다."""
        units = _real_weather_units()
        abilities = _measured(self.ALL_RIGHT_THETA[level_group])
        floor = cs.placement_unlock_floor(abilities, units, level_group)
        assert 0 < floor < len(units), f"{level_group}: floor {floor}/{len(units)}"

    def test_최고_단계는_배정되지_않는다(self):
        """가드 ⑶ — θ가 아무리 높아도 배정 단계는 MAX−1에서 멈춘다."""
        top = wb.KNOWLEDGE_LEVEL_MAX
        huge = _measured(_theta_for_level(top) + 5.0)
        assert cs.placed_knowledge_level(huge, "expert") == top - 1
        units = _weather_tree(per_section=2)
        assert cs.placement_unlock_floor(huge, units, "expert") == (top - 1) * 2

    def test_신고_가능한_3밴드는_상한에_닿지_않는다(self):
        """오늘의 실사용자에게 ⑶은 무영향이라는 근거 — 만점이 단계 4·5·7."""
        expected = {"elementary": 4, "middle_high": 5, "adult": 7}
        for band, level in expected.items():
            placed = cs.placed_knowledge_level(
                _measured(self.ALL_RIGHT_THETA[band]), band
            )
            assert placed == level, f"{band}: 만점 배정이 {placed}단계"
            assert placed < wb.KNOWLEDGE_LEVEL_MAX - 1


# ═══════════════════════════════════════════════════════════════
# 호출부 — 순수 함수가 옳아도 트리 GET·403 게이트가 안 부르면 화면은 그대로다
# ═══════════════════════════════════════════════════════════════


class TestCallSitesConsumeFloor:
    """`get_curriculum`·`is_unit_locked`가 floor를 실제로 소비하는지.

    ⚠️ 위 계약 대부분이 **순수 함수**를 본다. 순수 함수가 옳아도 호출부가
    `unlock_floor=0`으로 되돌아가면 클라이언트 증상이 그대로 되살아나고, 순수
    테스트는 한 건도 울지 않는다 — 그 축을 여기서 따로 문다.
    """

    @staticmethod
    def _patch(monkeypatch, units, abilities):
        async def fake_scoped(db, course_slug=None):
            return units

        async def fake_units(db):
            return units

        async def fake_progress(db, user):
            return {}

        async def fake_abilities(db, user):
            return abilities

        monkeypatch.setattr(cs, "load_scoped_units", fake_scoped)
        monkeypatch.setattr(cs, "load_units", fake_units)
        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
        monkeypatch.setattr(
            cs.weatherbrain_service, "load_abilities", fake_abilities
        )

    def test_트리_GET이_선해제를_반영한다(self, monkeypatch):
        units = _chain_prereq(_weather_tree(per_section=2))
        self._patch(monkeypatch, units, _measured(_theta_for_level(MH_LEVEL)))
        user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")

        tree = asyncio.run(cs.get_curriculum(object(), user))
        opened = [
            v for section in tree for v in section["units"] if not v["locked"]
        ]
        assert len(opened) == MH_LEVEL * 2, "GET /curriculum이 unlock_floor를 안 먹는다"

    def test_유닛_403_게이트가_선해제를_반영한다(self, monkeypatch):
        units = _chain_prereq(_weather_tree(per_section=2))
        self._patch(monkeypatch, units, _measured(_theta_for_level(MH_LEVEL)))
        user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
        ordered = cs.ordered_units(units)
        floor = MH_LEVEL * 2

        # 배정 단계의 마지막 유닛(선해제 안, 선행 미완료) → 열려야 한다
        assert (
            asyncio.run(cs.is_unit_locked(object(), user, ordered[floor - 1]))
            is False
        )
        # 그 다음 단계 첫 유닛(선해제 밖, 선행 미완료) → 잠겨야 한다
        assert (
            asyncio.run(cs.is_unit_locked(object(), user, ordered[floor])) is True
        )

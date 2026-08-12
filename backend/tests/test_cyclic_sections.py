"""섹션 순환식 구조(CO-G1)의 **런타임 계약** — 2026-08-12. DB 불필요.

설계안은 `docs/design/cyclic_sections.md`(담당 C)이고, 데이터는
`database/seed/units.json`이 소유한다. 커리큘럼 **전체가 10섹션 = 지식 단계
1~10**이다(2026-08-12 클라이언트 지시 — 코스로 나누지 않는다). 이 파일이 지키는
것은 그 데이터가 **코드에 실제로 닿는지** 둘이다.

⑴ **순서** — `SECTION_ORDER`에 새 10섹션이 없으면 `_section_key`가 미등재 섹션을
   뒤로(알파벳) 보내 **초등이 뒤쪽에서** 렌더된다. 교육과정이 거꾸로 서는
   회귀이고, 실제로 한 번 그 상태로 실측됐다(담당 D, 재구조화 직후 10번째).

⑵ **실질** — C가 설계안 §5-①에 스스로 적은 경고: 배선 전의 `_unit_content_pool`은
   `concept_tag + kind`로만 풀을 골랐고 단계 표적은 유저 θ에서만 나왔다. 그래서
   `w01-pressure-front`(섹션1)와 `w09-pressure-front`(섹션9)가 **완전히 같은
   5문항**을 냈다 — 10섹션이 화장이었다. 여기서 그 둘이 **겹치지 않는 단계**의
   문항을 내는지 본다. 이 클래스가 초록이어야 "10섹션이 실질"이다.

⚠️ 표적은 **정렬 표적이지 필터가 아니다**(C의 경고 · `test_curriculum_band_fallback`
의 `test_지식수준_고정반경으로는_굶주림이_안_풀린다`). 표적 단계가 비어도 굶지
않는다는 것을 마지막 클래스가 못 박는다.
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs
from app.services import weatherbrain_service as wb

REPO = Path(__file__).resolve().parents[2]
SEED_DIR = REPO / "database" / "seed"
KO_JS = REPO / "frontend" / "src" / "i18n" / "resources" / "ko.js"

WEATHER_SECTION_COUNT = 10  # 기상 코스 = 지식 단계 1~10


def load_units() -> list[dict]:
    return json.loads((SEED_DIR / "units.json").read_text(encoding="utf-8"))


def sections_in_seed(course: str | None = None) -> list[str]:
    """units.json 섹션의 **등장 순서**(중복 제거). course를 주면 그 코스만.

    코스 판정은 `units.json`의 `course` 키이고 누락은 기본 코스(weather)다 —
    `units.course_id` NULL을 weather로 보는 R11 하위 호환 규칙과 같은 자리.
    """
    seen: list[str] = []
    for unit in load_units():
        if course is not None and unit.get("course", "weather") != course:
            continue
        if unit["section"] not in seen:
            seen.append(unit["section"])
    return seen


# ══════════════════════════════════════════════════════════════════════════
# ⑴ 순서 — 초등이 첫 섹션이다
# ══════════════════════════════════════════════════════════════════════════


class TestSectionOrderCoversSeed:
    def test_배열은_기상10_기초3이고_중복이_없다(self):
        assert cs.WEATHER_SECTION_COUNT == WEATHER_SECTION_COUNT
        assert len(cs.SECTION_ORDER) == WEATHER_SECTION_COUNT + 3
        assert len(set(cs.SECTION_ORDER)) == len(cs.SECTION_ORDER)

    def test_시드의_전_섹션이_등재돼_있다(self):
        """미등재 섹션은 `_section_key`가 뒤로 보낸다 — 등재 누락 = 순서 붕괴."""
        missing = sorted({u["section"] for u in load_units()} - set(cs.SECTION_ORDER))
        assert missing == [], (
            f"SECTION_ORDER에 없는 섹션이 시드에 있다 — 알파벳 정렬로 밀린다: {missing}"
        )

    def test_커리큘럼은_초등부터_시작한다(self):
        """실렌더 순서로 단정한다 — 상수 배열이 아니라 `ordered_units`의 결과다.

        클라이언트가 지적한 증상("열과빛 → 공기의무게"로 시작하는 화면)이 바로
        이 단정이 깨진 상태다.
        """
        units = [SimpleNamespace(**u) for u in load_units()]
        order: list[str] = []
        for unit in cs.ordered_units(units):
            if unit.section not in order:
                order.append(unit.section)
        assert order[0] == "초등 3~4학년", f"교육과정이 거꾸로 섰다: {order[:3]}"
        assert order == [name for name in cs.SECTION_ORDER if name in set(order)]

    def test_기초과학_섹션은_기상_뒤에_온다(self):
        """코스가 갈려도 정렬 키는 전역 하나 — 기초과학이 기상 사이에 끼면 안 된다."""
        idx = [
            cs.SECTION_ORDER.index(name)
            for name in ("열과 빛", "공기의 무게", "물과 에너지")
        ]
        assert idx == sorted(idx)
        assert min(idx) >= WEATHER_SECTION_COUNT


# 섹션명 3자 패리티(units.json ↔ SECTION_ORDER ↔ ko.js)는 여기 있었으나
# `test_section_name_parity.py`로 **단일화**했다(2026-08-12). 두 벌이 같은 관계를
# 지키고 있었고, 그건 이 저장소가 가장 자주 겪는 「두 번째 사본」 실패가 테스트
# 옷을 입은 형태다. 남긴 쪽은 섹션명 리터럴이 0개이고, 판정 함수를 순수 함수로
# 갈라 **위조 입력으로 스스로 우는지 검증**하는 7건(TestContractActuallyBites)을
# 함께 갖는다 — 공허하게 통과하지 않는다는 증거가 그 파일 안에 있다.

class TestSectionKnowledgeLevelMap:
    def test_기상_10섹션이_1부터_10까지(self):
        assert cs.SECTION_KNOWLEDGE_LEVEL == {
            name: i + 1
            for i, name in enumerate(cs.SECTION_ORDER[:WEATHER_SECTION_COUNT])
        }
        assert sorted(cs.SECTION_KNOWLEDGE_LEVEL.values()) == list(
            range(1, WEATHER_SECTION_COUNT + 1)
        )

    def test_기초과학과_구섹션은_매핑에_없다(self):
        """기초과학은 단계 축이 아니라 코스다 — 넣으면 θ 파생 표적이 조용히 덮인다.
        재구조화 전 섹션명이 남아도 엉뚱한 단계가 표적이 된다."""
        for name in ("열과 빛", "공기의 무게", "물과 에너지", "하늘 읽기", "위험한 하늘"):
            assert name not in cs.SECTION_KNOWLEDGE_LEVEL

    def test_단계_상한이_지식_단계_축과_같다(self):
        """10을 여기 또 적지 않는다 — 축의 소유자는 weatherbrain이다."""
        assert max(cs.SECTION_KNOWLEDGE_LEVEL.values()) == wb.KNOWLEDGE_LEVEL_MAX


class TestUnitTargetLevel:
    def test_섹션이_단계를_말하면_그것이_이긴다(self):
        unit = SimpleNamespace(section="학부 고학년")
        assert cs.unit_target_level(unit, 3) == 9
        assert cs.unit_target_level(unit, None) == 9  # θ 없어도 섹션이 산다

    def test_섹션이_없거나_미등재면_폴백(self):
        assert cs.unit_target_level(SimpleNamespace(), 4) == 4
        assert cs.unit_target_level(SimpleNamespace(section="하늘 읽기"), 4) == 4
        assert cs.unit_target_level(SimpleNamespace(section="사라진 섹션"), None) is None

    def test_기초과학_유닛은_θ_표적을_그대로_쓴다(self):
        """코스가 다르면 단계 축이 아니다 — 폴백이 살아 있어야 한다."""
        assert cs.unit_target_level(SimpleNamespace(section="열과 빛"), 5) == 5

    def test_시드_전_기상_유닛이_표적을_받는다(self):
        """한 유닛이라도 표적 없이 남으면 그 유닛만 조용히 옛 동작(θ 표적)으로 돈다."""
        without = [
            u["id"]
            for u in load_units()
            if u.get("course", "weather") == "weather"
            and cs.unit_target_level(SimpleNamespace(**u), None) is None
        ]
        assert without == []


# ══════════════════════════════════════════════════════════════════════════
# ⑵ 실질 — 같은 개념의 낮은 섹션과 높은 섹션이 다른 단계를 낸다
# ══════════════════════════════════════════════════════════════════════════


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _RowsDB:
    """풀 조회에 같은 후보를 돌려주는 대역 — 유닛 차이만 남긴다."""

    def __init__(self, rows):
        self.rows = list(rows)

    async def execute(self, stmt):
        return _Result(self.rows)


def item(kl: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        knowledge_level=kl,
        level_group=wb.level_group_of_knowledge_level(kl),
        concept_tag="pressure_front",
        question_type="short_answer",
        uses_live_slots=False,
        template_json={"question_text": f"kl{kl}"},
    )


def unit_in(section: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(), slug=f"u-{section}", kind="quiz",
        concept_tag="pressure_front", section=section,
    )


USER = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
# θ 경로(배치 완료 유저) — 콜드스타트는 선취가 없어 후보가 5건에서 끊긴다.
ABILITIES = [{"concept_tag": "pressure_front", "theta": 0.0, "se": 0.4, "n": 6}]


def pick(section: str, rows) -> list[int]:
    db = _RowsDB(rows)
    items = asyncio.run(cs._unit_content_pool(db, USER, unit_in(section), ABILITIES))
    return [it.knowledge_level for it in items]


class TestSameConceptDiffersBySection:
    """PM 계약 — 이게 통과해야 10섹션이 장식이 아니다."""

    ROWS = [item(kl) for kl in range(1, 11) for _ in range(2)]  # kl 1~10 × 2건

    def test_낮은_섹션과_높은_섹션이_겹치지_않는다(self):
        low = pick("초등 3~4학년", self.ROWS)     # 단계 1
        high = pick("학부 고학년", self.ROWS)      # 단계 9
        assert len(low) == len(high) == cs.UNIT_SESSION_SIZE
        assert max(low) < min(high), f"같은 풀에서 같은 단계가 나왔다: {low} / {high}"

    def test_같은_문항을_공유하지_않는다(self):
        db_low, db_high = _RowsDB(self.ROWS), _RowsDB(self.ROWS)
        low = asyncio.run(
            cs._unit_content_pool(db_low, USER, unit_in("초등 3~4학년"), ABILITIES)
        )
        high = asyncio.run(
            cs._unit_content_pool(db_high, USER, unit_in("학부 고학년"), ABILITIES)
        )
        assert {i.id for i in low}.isdisjoint({i.id for i in high})

    def test_표적_단계_주변부터_고른다(self):
        """섹션 5는 kl5를 중심으로 — 위아래로 균형 있게 내려앉는다."""
        mid = pick("고등학교 공통", self.ROWS)
        assert 5 in mid
        assert max(abs(kl - 5) for kl in mid) <= 2

    @pytest.mark.parametrize(
        ("section", "level"),
        [(name, lv) for name, lv in cs.SECTION_KNOWLEDGE_LEVEL.items()],
    )
    def test_10섹션_전건이_자기_단계를_뽑는다(self, section, level):
        assert level in pick(section, self.ROWS)


class TestTargetIsSortOnlyNotFilter:
    """C의 경고 — 하드 필터로 만들면 밴드 공백이 단계 공백으로 옮겨갈 뿐이다."""

    def test_표적_단계가_비어도_굶지_않는다(self):
        rows = [item(1) for _ in range(5)] + [item(2) for _ in range(5)]
        got = pick("기상청 현업", rows)  # 표적 10 — 후보에 0건
        assert len(got) == cs.UNIT_SESSION_SIZE
        assert set(got) <= {1, 2}

    def test_후보가_적으면_있는_만큼(self):
        assert len(pick("초등 3~4학년", [item(4), item(5)])) == 2

    def test_SQL_WHERE에_단계_조건이_실리지_않는다(self):
        """정렬 표적이 where로 새면(=하드 필터가 되면) 여기서 먼저 운다.

        SELECT 목록에는 `content_items.knowledge_level`이 늘 들어 있으므로
        (전 컬럼을 읽는다) 검사 대상은 **WHERE 절뿐**이다.
        """
        class _Capture(_RowsDB):
            def __init__(self):
                super().__init__([])
                self.stmts: list = []

            async def execute(self, stmt):
                self.stmts.append(stmt)
                return _Result([])

        db = _Capture()
        asyncio.run(cs._unit_content_pool(db, USER, unit_in("학부 고학년"), ABILITIES))
        assert db.stmts
        wheres = [str(stmt.whereclause) for stmt in db.stmts]
        assert all("knowledge_level" not in where for where in wheres), wheres
        # 필터 축은 종전 그대로 — 개념·밴드·상태·유형뿐이다.
        assert all("concept_tag" in where for where in wheres)

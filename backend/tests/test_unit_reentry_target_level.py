"""유닛 **재진입**(두 번째 이후 세션)이 유닛의 지식 단계를 따른다 — 2026-08-13 담당 Z.

**이 파일이 존재하는 이유 — 기존 하네스의 사각지대**

하루 첫 유닛 세션은 `9b72d70`이 고쳤다(`test_unit_session_target_level.py`). 그런데
같은 기제가 **한 층 아래**에 남아 있었다: `_unit_content_pool`(두 번째 이후 세션 ·
daily 진도 블록)은 표적을 `rank_by_knowledge_level`에 넘기지만, **그 전에 SQL이
`|b − θ|` + LIMIT으로 후보를 선취**한다. 학습자 θ로 정렬하면 표적 밴드가 재정렬에
닿기도 전에 잘려 나간다.

`test_cyclic_sections.py`가 이 결함을 못 본 이유가 요점이다 — 그쪽 하네스(`_RowsDB`)는
**정렬도 LIMIT도 적용하지 않고 행을 그대로 돌려준다**. 그래서 `rank_by_knowledge_level`
한 겹만 검증되고 **SQL이 자르는 층은 한 번도 검증되지 않았다**. 여기서는
`_SortingDB`가 컴파일된 SELECT의 ORDER BY 기준점과 LIMIT을 **실제로 적용**한다.

화면상 증상: 초등 유닛의 첫 세션을 끝내고 **같은 날 그 유닛에 다시 들어가면 중학교
문항이 다시 보인다**(클라이언트가 세 번 지적한 그 증상의 재진입판).

검증 사슬:
  1. 재진입 문항이 유닛 단계를 따른다 (결함 재현 — 정렬 기준점을 θ로 되돌리면 부활)
  2. **하드 밴드 필터로 바꾸면 굶는다** — 왜 필터가 아니라 정렬인지의 증명
  3. 섹션이 단계를 말하지 않는 유닛은 SQL이 한 글자도 안 바뀐다 (하위 호환)
  4. 콜드스타트(θ None)도 불변
  5. 기준점은 새 상수가 아니라 `weatherbrain_service.band_prior_theta` 재사용

실행: backend 디렉토리에서 `python -m pytest tests/test_unit_reentry_target_level.py -q`.
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
from app.services import session_service as ss
from app.services import weatherbrain_service as wb

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"
SIZE = cs.UNIT_SESSION_SIZE


def load_items() -> list[dict]:
    return json.loads((SEED_DIR / "content_items.json").read_text(encoding="utf-8"))


def load_units() -> list[dict]:
    return json.loads((SEED_DIR / "units.json").read_text(encoding="utf-8"))


def unit_candidates(items: list[dict], unit: dict) -> list[dict]:
    """`_unit_content_pool`의 **level_group 이외** 필터 재현 (band_fallback와 동일 규칙)."""
    is_board = unit["kind"] == "board"
    return [
        it
        for it in items
        if it["concept_tag"] == unit["concept_tag"]
        and not it.get("uses_live_slots")
        and (it["question_type"] == "board") == is_board
    ]


def row(level_group: str, knowledge_level: int | None, question_type="short_answer"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        level_group=level_group,
        knowledge_level=knowledge_level,
        question_type=question_type,
        concept_tag="pressure_front",
        uses_live_slots=False,
        template_json={},
    )


def rows_from_seed(unit: dict) -> list[SimpleNamespace]:
    return [
        row(it["level_group"], it.get("knowledge_level"), it["question_type"])
        for it in unit_candidates(load_items(), unit)
    ]


def seed_unit(unit_id: str) -> dict:
    return next(u for u in load_units() if u["id"] == unit_id)


def unit_obj(section: str | None, *, kind="quiz", concept_tag="pressure_front"):
    unit = SimpleNamespace(
        id=uuid.uuid4(), slug="u-test", kind=kind, concept_tag=concept_tag
    )
    if section is not None:
        unit.section = section
    return unit


def unit_from_seed(unit: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=unit["id"],
        kind=unit["kind"],
        concept_tag=unit["concept_tag"],
        section=unit["section"],
    )


# ══════════════════════════════════════════════════════════════════════════
# 하네스 — SELECT의 ORDER BY 기준점과 LIMIT을 **실제로 적용**한다
# ══════════════════════════════════════════════════════════════════════════

# `build_pool_query`의 θ 정렬식은 `abs(coalesce(item_params.b, CASE …) - :기준점)`이다.
# 기준점을 **값이 아니라 바인드 이름**으로 뽑는 것이 요점이다 — 유닛 파생 기준점은
# LEVEL_GROUP_ITEM_B 값과 정확히 겹치므로(둘 다 −1.0·0.0·1.0·2.0) 값으로 찾으면
# CASE 안의 사전 b와 구분되지 않는다.
_ANCHOR_BIND = re.compile(r"END\) - :(\w+)\)\Z")


def sort_anchor(stmt) -> float | None:
    """컴파일된 SELECT의 정렬 기준점. random 정렬(콜드스타트)이면 None."""
    for clause in stmt._order_by_clauses:
        match = _ANCHOR_BIND.search(str(clause))
        if match:
            return stmt.compile().params[match.group(1)]
    return None


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _SortingDB:
    """밴드 IN · ORDER BY 기준점 거리 · LIMIT을 적용하는 가짜 DB.

    보정 이력(`item_params.b`)은 재보정(8/18) 전까지 비어 있으므로 거리는 전건
    밴드 사전 b다 — `TestWideningDoesNotBlurHealthyCells`가 쓰는 것과 같은 가정.
    정렬은 **안정 정렬**이라 동률은 입력 순서를 지킨다: 테스트가 입력을 적대적으로
    (표적 밴드를 뒤에) 놓아 "거리 정렬이 이겼다"를 단정할 수 있게 하기 위해서다.
    """

    def __init__(self, rows: list):
        self.rows = list(rows)
        self.stmts: list = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        params = stmt.compile().params
        allowed = set(params["level_group_1"])
        rows = [r for r in self.rows if r.level_group in allowed]
        anchor = sort_anchor(stmt)
        if anchor is not None:
            rows = sorted(
                rows, key=lambda r: abs(wb.LEVEL_GROUP_ITEM_B[r.level_group] - anchor)
            )
        return _Result(rows[: stmt._limit_clause.value])


USER = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
# 배치 완료 학습자 — θ=0.0(middle_high 사전평균). 결함 재현의 전제다.
ABILITIES = [{"concept_tag": "pressure_front", "theta": 0.0, "se": 0.4, "n": 6}]


def pool(rows, unit, user=USER, abilities=ABILITIES):
    db = _SortingDB(rows)
    items = asyncio.run(cs._unit_content_pool(db, user, unit, abilities))
    return items, db


def levels(items) -> list[int]:
    return [wb.effective_knowledge_level(it) for it in items]


# ══════════════════════════════════════════════════════════════════════════
# 1. 재현 — 재진입이 유닛 단계를 따른다
# ══════════════════════════════════════════════════════════════════════════


class TestReentryFollowsUnitLevel:
    """PM 계약 ①: `middle_high` 학습자 + kl1 유닛 → 재진입 문항이 kl 2 이하."""

    UNIT_ID = "w01-pressure-front"  # 섹션 「초등 3~4학년」 = 지식 단계 1

    def _run(self):
        seed = seed_unit(self.UNIT_ID)
        return pool(rows_from_seed(seed), unit_from_seed(seed))[0]

    def test_실_시드_재진입이_초등_단계다(self):
        """개정 전 실측은 **kl {3: 4}**였다 — middle_high 후보 16건이 선취창
        (UNIT_SESSION_SIZE × UNIT_POOL_PREFETCH = 16)을 정확히 채워
        elementary가 `rank_by_knowledge_level`에 닿지 못했다."""
        got = levels(self._run())
        assert len(got) == SIZE
        assert max(got) <= 2, f"재진입에 중학교 이상 문항이 섞였다: {got}"

    def test_표적_단계가_실제로_들어간다(self):
        assert 1 in levels(self._run())

    def test_정렬_기준점이_유닛_표적_밴드다(self):
        seed = seed_unit(self.UNIT_ID)
        _, db = pool(rows_from_seed(seed), unit_from_seed(seed))
        assert sort_anchor(db.stmts[0]) == wb.LEVEL_GROUP_ITEM_B["elementary"]
        # 학습자 θ(0.0)가 아니어야 한다 — 그것이 이 개정의 전부다.
        assert sort_anchor(db.stmts[0]) != ABILITIES[0]["theta"]

    # kl 1~10 × 2건. 표적 밴드가 뒤에 오도록 **역순**으로 넣어 동률 운을 배제한다.
    ROWS = [
        row(wb.level_group_of_knowledge_level(kl), kl)
        for kl in range(wb.KNOWLEDGE_LEVEL_MAX, wb.KNOWLEDGE_LEVEL_MIN - 1, -1)
        for _ in range(2)
    ]

    @pytest.mark.parametrize(
        ("section", "level"), sorted(cs.SECTION_KNOWLEDGE_LEVEL.items(), key=lambda p: p[1])
    )
    def test_10섹션_전건이_자기_단계_주변을_받는다(self, section, level):
        """섹션이 무엇이든 재진입 풀은 **그 섹션의 단계 ±1**에서 나온다.

        `middle_high` 학습자 하나로 10섹션을 다 돌리는 것이 요점이다 — 개정 전에는
        어느 섹션을 열어도 middle_high(kl 3~4)가 나왔다.

        ⚠️ 밴드 단일(`== {표적 밴드}`)로 단정하지 않는다. `rank_by_knowledge_level`이
        **동률에서 쉬운 쪽을 택하는** 것이 계약이라(그 독스트링), 표적이 밴드 하단
        단계일 때 한 칸 아래 밴드가 정당하게 섞인다(kl 3 → kl 2 = elementary).
        여기서 밴드 단일을 요구하면 그 계약과 싸우게 된다.
        """
        items, _ = pool(self.ROWS, unit_obj(section))
        got = levels(items)
        assert len(items) == SIZE
        assert level in got, got
        assert max(abs(kl - level) for kl in got) <= 1, got

    def test_표적_단계가_비어도_굶지_않는다(self):
        """표적(kl 10 = expert)에 재료가 0건 — 필터가 아니므로 아래로 내려앉는다."""
        rows = [row("elementary", 1) for _ in range(5)]
        items, _ = pool(rows, unit_obj("기상청 현업"))
        assert len(items) == SIZE
        assert set(levels(items)) == {1}

    def test_SQL_WHERE에_단계_조건이_실리지_않는다(self):
        """기준점을 옮긴 것이지 필터를 건 것이 아니다 — where로 새면 여기서 운다."""
        _, db = pool(self.ROWS, unit_obj("초등 3~4학년"))
        wheres = [str(stmt.whereclause) for stmt in db.stmts]
        assert wheres
        assert all("knowledge_level" not in where for where in wheres), wheres

    def test_밴드는_계속_전부_열려_있다(self):
        _, db = pool(self.ROWS, unit_obj("초등 3~4학년"))
        params = db.stmts[0].compile().params
        assert set(params["level_group_1"]) == set(wb.LEVEL_GROUP_BANDS)


# ══════════════════════════════════════════════════════════════════════════
# 2. 되돌림 증명 — **하드 밴드 필터로 바꾸면 굶는다**
# ══════════════════════════════════════════════════════════════════════════


class TestFilterWouldStarve:
    """왜 필터가 아니라 정렬인가 — 대안(하드 밴드 필터)을 테스트가 반증한다.

    비교 대상은 가상의 구현이 아니라 **하루 첫 세션이 실제로 쓰는 기제**다:
    `session_service.pool_level_groups(..., target_level=...)`가 표적 밴드 하나만
    돌려준다(9b72d70). 그쪽에서 안전한 이유는 부족분을 `plan_bank_picks`가 다른
    블록으로 메우기 때문인데, **재진입 경로에는 그 교차 보충이 없다** — 부족분이
    그대로 짧은 세션이 된다.
    """

    def _hard_filter_pool(self, rows, section, *, size=SIZE):
        """유닛 풀이 밴드를 하드 필터한다면 무엇이 나오는지 — 변이 시뮬레이션."""
        level = cs.SECTION_KNOWLEDGE_LEVEL[section]
        allowed = set(ss.pool_level_groups(USER.level_group, 0.0, level))
        kept = [r for r in rows if r.level_group in allowed]
        return cs.rank_by_knowledge_level(kept, level)[:size]

    def test_하드_필터는_0문항_세션을_만든다(self):
        """표적 밴드(expert)가 통째로 빈 조합 — 필터면 0, 열어 두면 정원."""
        rows = [row("elementary", 1) for _ in range(5)]
        assert self._hard_filter_pool(rows, "기상청 현업") == []
        items, _ = pool(rows, unit_obj("기상청 현업"))
        assert len(items) == SIZE

    def test_하드_필터는_실_시드에서도_세션을_짧게_만든다(self):
        """실 시드 board 유닛 — 표적 밴드에 3건뿐이라 4문항 정원을 못 채운다.

        저작이 그 칸을 채우면 이 사례는 사라진다. 그때 **조용히 초록이 되지 않게**
        사례를 테스트가 스스로 고르고, 하나도 없으면 skip에 사유를 남긴다
        (`test_curriculum_band_fallback._first_fallback_case`와 같은 관례).
        """
        for unit in load_units():
            level = cs.SECTION_KNOWLEDGE_LEVEL.get(unit["section"])
            if level is None:
                continue
            rows = rows_from_seed(unit)
            if len(rows) < SIZE:
                continue  # 재료 자체가 없는 칸은 정렬로도 못 메운다
            if len(self._hard_filter_pool(rows, unit["section"])) < SIZE:
                got, _ = pool(rows, unit_from_seed(unit))
                assert len(got) == SIZE, (
                    f"{unit['id']}: 하드 필터는 굶는데 정렬도 못 채웠다"
                )
                return
        pytest.skip(
            "표적 밴드가 정원보다 얇은 (유닛)이 하나도 없다 — 저작이 전 칸을 채웠다는 뜻이다. "
            "필터가 굶는다는 사실은 위 합성 계약(test_하드_필터는_0문항_세션을_만든다)이 계속 지킨다."
        )

    def test_정렬은_같은_kl_분포를_필터_없이_얻는다(self):
        """필터를 포기해도 정밀도를 잃지 않는다 — 그것이 정렬을 고른 근거다."""
        seed = seed_unit("w01-pressure-front")
        rows = rows_from_seed(seed)
        sorted_levels = sorted(levels(pool(rows, unit_from_seed(seed))[0]))
        filtered = self._hard_filter_pool(rows, seed["section"])
        assert sorted_levels == sorted(levels(filtered))


# ══════════════════════════════════════════════════════════════════════════
# 3~4. 하위 호환 — 섹션 없는 유닛 · 콜드스타트
# ══════════════════════════════════════════════════════════════════════════


class TestSectionlessUnitsUnchanged:
    """PM 계약 ③: 섹션이 단계를 말하지 않는 유닛은 종전대로 θ 파생."""

    @pytest.mark.parametrize("section", [None, "열과 빛", "공기의 무게", "물과 에너지"])
    def test_정렬_기준점이_학습자_θ다(self, section):
        assert section is None or section not in cs.SECTION_KNOWLEDGE_LEVEL
        _, db = pool([row("middle_high", 3)], unit_obj(section))
        assert sort_anchor(db.stmts[0]) == ABILITIES[0]["theta"]

    def test_순수_함수도_θ를_그대로_돌려준다(self):
        assert cs.unit_pool_sort_theta(None, 0.7) == 0.7
        assert cs.unit_pool_sort_theta(None, None) is None

    def test_기초과학은_θ_파생_표적으로_재정렬된다(self):
        """유닛이 아니라 **학습자 θ**가 표적을 정한다 — 기초과학 유닛의 종전 동작.

        기대값을 리터럴로 적지 않고 `rank_by_knowledge_level`에 θ 파생 표적을 직접
        먹여 대조한다 — 단계 경계(THETA_KNOWLEDGE_LEVEL_BOUNDS)는 파생값이라
        여기 숫자를 적으면 두 번째 사본이 된다.
        """
        rows = [row(wb.level_group_of_knowledge_level(kl), kl) for kl in (1, 3, 5, 7)]
        items, _ = pool(rows, unit_obj("열과 빛"))
        expected = cs.rank_by_knowledge_level(
            rows, wb.theta_to_knowledge_level(ABILITIES[0]["theta"])
        )
        assert levels(items) == levels(expected)[:SIZE]


class TestColdStartUnchanged:
    """PM 계약 ④ / 기존 밴드 폴백 계약: θ None은 유닛 표적이 있어도 불변.

    `sort_theta is None ⟺ theta is None`이 계약이다 — 콜드스타트는
    `unit_pool_level_groups`가 가입 밴드 하나로 좁히고 선취도 없는 별개 경로라
    (`test_curriculum_band_fallback.TestQueryShapeUnchanged`가 소유),
    여기서만 정렬을 붙이면 반쪽 상태가 된다.
    """

    def test_유닛_표적이_있어도_기준점이_없다(self):
        assert cs.unit_pool_sort_theta(1, None) is None

    def test_콜드스타트_SQL은_random_정렬_가입밴드_하나(self):
        _, db = pool([row("middle_high", 3)], unit_obj("초등 3~4학년"), abilities=[])
        stmt = db.stmts[0]
        assert sort_anchor(stmt) is None
        assert "random()" in [str(c) for c in stmt._order_by_clauses]
        assert stmt.compile().params["level_group_1"] == [USER.level_group]

    def test_콜드스타트는_선취하지_않는다(self):
        _, db = pool([row("middle_high", 3)], unit_obj("초등 3~4학년"), abilities=[])
        assert db.stmts[0]._limit_clause.value == SIZE

    def test_θ_경로는_선취한다(self):
        _, db = pool([row("middle_high", 3)], unit_obj("초등 3~4학년"))
        assert db.stmts[0]._limit_clause.value == SIZE * cs.UNIT_POOL_PREFETCH


# ══════════════════════════════════════════════════════════════════════════
# 5. 기준점의 소유자 — 새 상수를 만들지 않았다
# ══════════════════════════════════════════════════════════════════════════


class TestAnchorReusesExistingOwner:
    """b 표의 두 번째 사본을 만들면 여기서 운다 (교차 상수 이원화 관례)."""

    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_band_prior_theta와_동치다(self, level):
        assert cs.unit_pool_sort_theta(level, 0.0) == wb.band_prior_theta(
            wb.level_group_of_knowledge_level(level)
        )

    def test_LEVEL_GROUP_ITEM_B를_바꾸면_기준점도_따라_움직인다(self, monkeypatch):
        monkeypatch.setitem(wb.LEVEL_GROUP_ITEM_B, "elementary", -9.0)
        assert cs.unit_pool_sort_theta(1, 0.0) == -9.0

    def test_난이도_리터럴을_재기술하지_않는다(self):
        import inspect

        src = inspect.getsource(cs.unit_pool_sort_theta)
        body = src.split('"""')[-1]
        assert "band_prior_theta" in body
        assert not re.search(r"-?\d+\.\d", body), body

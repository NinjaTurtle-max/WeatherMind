"""유닛 풀의 밴드 공백 폴백 계약 — CO-L2 · CO-L-F2 · CO-L-F3 (R13 웨이브 2).

**이 파일이 존재하는 이유**: 2026-08-07 전수 감사가 "L절 전건이 297 테스트에서
초록으로 통과했다"고 결론냈다. 성인 유저가 basic-science 8유닛 전부에서 0문항
세션을 받는데도 어느 테스트도 울지 않았다 — 기존 유닛 풀 테스트
(`test_unit_pool_theta`·`test_r10_pool_dedup_contract`)가 **쿼리 구조**와
**중복 제거**만 보고 **그 쿼리가 실제 시드에서 몇 건을 건지는지**는 한 번도 세지
않았기 때문이다. 그래서 여기서는 SQL이 아니라 **실 시드의 칸 인구**를 센다.

검증 사슬:
  1. 밴드 정확 일치 필터에는 0문항 칸이 실재한다 (결함 재현 — 폴백을 지우면 부활)
  2. 넓힌 집합에서는 (유닛 × 신고 밴드) 96칸 전부가 1건 이상이다 (CO-L2 봉인)
  3. 넓힘은 정상 칸을 흐리지 않는다 — |b−θ| 정렬 시뮬레이션에서 자기 밴드가 선점
  4. 콜드스타트(θ None)는 오늘과 **완전 불변**이다
  5. 넓힘은 쿼리를 늘리지 않는다 (2단 조회 계약 유지 — 사다리 추가 금지 가드)

실행: backend 디렉토리에서 `python -m pytest tests/test_curriculum_band_fallback.py -q`.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs
from app.services import session_service, weatherbrain_service as wb

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"
BANDS = wb.LEVEL_GROUP_BANDS


def load_items() -> list[dict]:
    return json.loads((SEED_DIR / "content_items.json").read_text(encoding="utf-8"))


def load_units() -> list[dict]:
    return json.loads((SEED_DIR / "units.json").read_text(encoding="utf-8"))


def unit_candidates(items: list[dict], unit: dict) -> list[dict]:
    """`_unit_content_pool`의 **level_group 이외** 필터를 그대로 재현한다.

    concept_tag 일치 · uses_live_slots=false · kind별 board/비board.
    (status는 시드가 전건 active — 로더 기본값이라 시드 JSON에 키가 없다.)
    """
    is_board_unit = unit["kind"] == "board"
    return [
        it
        for it in items
        if it["concept_tag"] == unit["concept_tag"]
        and not it.get("uses_live_slots")
        and (it["question_type"] == "board") == is_board_unit
    ]


def cell_counts() -> dict[tuple[str, str], int]:
    """(유닛 id, 문항 밴드) → 건수 — 밴드 정확 일치 필터가 보는 칸."""
    items = load_items()
    counts: dict[tuple[str, str], int] = {}
    for unit in load_units():
        pool = unit_candidates(items, unit)
        for band in BANDS:
            counts[(unit["id"], band)] = sum(
                1 for it in pool if it["level_group"] == band
            )
    return counts


class TestWidenedBandSetIsPure:
    """`unit_pool_level_groups`는 DB 없이 검증 가능한 순수 함수여야 한다."""

    @pytest.mark.parametrize("band", BANDS)
    def test_콜드스타트는_오늘과_완전_불변(self, band):
        """θ None에서 넓히면 정렬이 random이라 학령 표적이 통째로 무너진다 —
        session_service.pool_level_groups와 **같은 값**이어야 한다."""
        assert cs.unit_pool_level_groups(band, None) == (
            session_service.pool_level_groups(band, None)
        ) == [band]

    @pytest.mark.parametrize("band", BANDS)
    @pytest.mark.parametrize("theta", [-3.0, -1.0, 0.0, 1.0, 2.5])
    def test_θ가_있으면_전_밴드가_열린다(self, band, theta):
        assert cs.unit_pool_level_groups(band, theta) == sorted(BANDS)

    def test_기존_집합의_상위집합이다(self):
        """넓힘은 **순수 추가**여야 한다 — 오늘 뽑히던 문항이 빠지면 회귀다."""
        for band in BANDS:
            for theta in (-2.0, -0.5, 0.5, 1.5, 3.0):
                assert set(
                    session_service.pool_level_groups(band, theta)
                ) <= set(cs.unit_pool_level_groups(band, theta))

    def test_미지_신고값도_풀에_남는다(self):
        """방어: users.level_group에 밴드 밖 값이 있어도 그 값이 사라지지 않는다."""
        assert "ghost" in cs.unit_pool_level_groups("ghost", 0.0)

    def test_밴드_목록을_재기술하지_않는다(self):
        """단일 공급원 — 밴드가 5종이 되면 이 함수가 따라가야 한다."""
        import inspect

        src = inspect.getsource(cs.unit_pool_level_groups)
        assert "LEVEL_GROUP_BANDS" in src
        for literal in ('"elementary"', '"middle_high"', '"adult"', '"expert"'):
            assert literal not in src, f"밴드 리터럴 하드코딩: {literal}"


class TestBandHolesExistInRealSeed:
    """결함 재현 — 폴백이 필요한 이유가 실 시드에 실재함을 고정한다.

    이 클래스가 빨개지는 것은 **저작으로 칸이 채워졌다**는 뜻이라 좋은 신호다.
    그때는 CO-L-F1이 닫힌 것이므로 기대값을 줄이고 사유를 남기면 된다.
    """

    BS_UNITS = (
        "bs-temp-vs-heat", "bs-specific-heat", "bs-radiation", "bs-pressure",
        "bs-density-buoyancy", "bs-convection-board", "bs-phase-change",
        "bs-energy-transfer",
    )

    @pytest.mark.parametrize("unit_id", BS_UNITS)
    def test_adult_밴드에_basic_science가_0건(self, unit_id):
        """CO-L-F1 — 강등 폴백이 없으면 성인은 bs 8유닛 전부 0문항 세션."""
        assert cell_counts()[(unit_id, "adult")] == 0

    @pytest.mark.parametrize(
        "unit_id", ["air-power-board", "city-anomaly-board", "risk-wildfire-board"]
    )
    def test_elementary_밴드에_board가_0건(self, unit_id):
        assert cell_counts()[(unit_id, "elementary")] == 0

    def test_0문항_칸이_실제로_다수다(self):
        """숫자를 단정하지 않고 '충분히 많다'만 고정 — 저작이 진행돼도 안 깨진다."""
        holes = [key for key, n in cell_counts().items() if n == 0]
        assert len(holes) >= 20, f"칸이 다 찼다면 이 계약을 갱신할 것: {holes}"

    def test_지식수준_고정반경으로는_굶주림이_안_풀린다(self):
        """**판단 근거의 실측 고정** — "kl ±1로 필터를 좁게 넓히면 되지 않나"에
        대한 답이다. 시드가 태그마다 특정 단계에 통째로 비어 있어(예 `kl 3`이
        기상 6태그 중 4태그에서 0건) **고정 반경은 밴드 공백을 단계 공백으로
        옮길 뿐**이다. 그래서 필터는 전 밴드로 열고, 정보 손실은 정렬
        (`rank_by_knowledge_level`)로 줄인다.

        저작이 진행돼 이 테스트가 빨개지면 반경 필터를 재검토할 때다(G1 이후).
        """
        items = load_items()
        starved = []
        for band in BANDS:
            target = wb.theta_to_knowledge_level(wb.LEVEL_GROUP_ITEM_B[band])
            window = set(range(target - 1, target + 2))
            for unit in load_units():
                pool = [
                    it
                    for it in unit_candidates(items, unit)
                    if it["knowledge_level"] in window
                ]
                if not pool:
                    starved.append((band, unit["id"]))
        assert starved, "반경 1이 전 칸을 덮는다면 필터 축소를 재검토할 것"
        assert ("adult", "bs-energy-transfer") in starved


class TestWidenedPoolNeverStarves:
    """CO-L2 봉인 — 넓힌 집합에서는 어느 (유닛 × 신고 밴드)도 0문항이 아니다."""

    @pytest.fixture
    def by_unit(self):
        items = load_items()
        return {u["id"]: unit_candidates(items, u) for u in load_units()}

    def test_전_유닛이_최소_1문항(self, by_unit):
        """넓힌 필터는 밴드를 전부 열므로, 유닛 풀이 통째로 비지 않는 한 0이 없다."""
        empty = [uid for uid, pool in by_unit.items() if not pool]
        assert empty == [], f"태그 자체가 비어 폴백으로도 못 살리는 유닛: {empty}"

    @pytest.mark.parametrize("reported", BANDS)
    def test_전_유닛_전_신고밴드가_0문항이_아니다(self, by_unit, reported):
        theta = wb.LEVEL_GROUP_ITEM_B[reported]
        allowed = set(cs.unit_pool_level_groups(reported, theta))
        starved = [
            uid
            for uid, pool in by_unit.items()
            if not [it for it in pool if it["level_group"] in allowed]
        ]
        assert starved == [], f"{reported} 신고 유저가 0문항 세션을 받는 유닛: {starved}"

    def test_성인의_basic_science_진도_블록이_5를_채운다(self, by_unit):
        """CO-L-F3 — 감사 실측 '성인 진도 블록은 5가 아니라 2'의 해소.

        진도 블록은 열린 유닛을 이어붙여 UNIT_SESSION_SIZE개를 모은다. bs 8유닛
        **각각**이 단독으로 5를 채우면 이어붙이기 없이도 계약이 선다.
        """
        allowed = set(
            cs.unit_pool_level_groups("adult", wb.LEVEL_GROUP_ITEM_B["adult"])
        )
        for uid in TestBandHolesExistInRealSeed.BS_UNITS:
            n = len([it for it in by_unit[uid] if it["level_group"] in allowed])
            assert n >= cs.UNIT_SESSION_SIZE, f"{uid}: {n}건 (넓힌 뒤에도 부족)"


class TestKnowledgeLevelReranking:
    """`rank_by_knowledge_level` 단위 계약 — 넓힘의 정보 손실을 상쇄하는 겹."""

    def _item(self, level, item_id):
        return SimpleNamespace(id=item_id, knowledge_level=level)

    def test_거리_오름차순(self):
        pool = [self._item(k, k) for k in (1, 6, 4, 2)]
        assert [it.id for it in cs.rank_by_knowledge_level(pool, 5)] == [4, 6, 2, 1]

    def test_동률이면_쉬운_쪽이_이긴다(self):
        """CO-L2 강등 방향 판정 — 한 단계 위는 못 풀어서 막고, 한 단계 아래는
        쉬워도 가르친다(`knowledge_level_of_level_group` 독스트링과 같은 취지)."""
        pool = [self._item(6, "harder"), self._item(4, "easier")]
        assert [it.id for it in cs.rank_by_knowledge_level(pool, 5)] == [
            "easier",
            "harder",
        ]

    def test_자기_단계가_있으면_편향이_작동하지_않는다(self):
        """1차 키가 거리이므로 쉬운 쪽 편향은 **동률에서만** 작동한다."""
        pool = [self._item(4, "easier"), self._item(5, "exact")]
        assert [it.id for it in cs.rank_by_knowledge_level(pool, 5)][0] == "exact"

    def test_남은_동률은_입력_순서_유지(self):
        """안정 정렬 — SQL이 정한 순서(|b−θ| → random, 백필은 신선도 우선)를
        재정렬이 뒤집으면 안 된다."""
        pool = [self._item(4, "a"), self._item(6, "b"), self._item(4, "c")]
        assert [it.id for it in cs.rank_by_knowledge_level(pool, 5)] == ["a", "c", "b"]

    def test_target_None이면_입력_그대로(self):
        pool = [self._item(6, "x"), self._item(1, "y")]
        assert cs.rank_by_knowledge_level(pool, None) == pool

    def test_미분류_문항도_폴백_경로로_받는다(self):
        """knowledge_level NULL(생성 문항)·컬럼 없는 대역 객체에서 터지지 않는다."""
        pool = [
            SimpleNamespace(id="null-kl", knowledge_level=None, level_group="adult"),
            SimpleNamespace(id="no-column"),
        ]
        assert [it.id for it in cs.rank_by_knowledge_level(pool, 5)] == [
            "null-kl",
            "no-column",
        ]

    def test_단계_리터럴을_재기술하지_않는다(self):
        import inspect

        src = inspect.getsource(cs.rank_by_knowledge_level)
        assert "effective_knowledge_level" in src


class TestWideningDoesNotBlurHealthyCells:
    """넓힘이 **빈 칸에만** 작용함을 실제 정렬 사슬로 못 박는다.

    `_unit_content_pool`의 두 겹을 그대로 재현한다:
      ⑴ SQL — 사전 b(LEVEL_GROUP_ITEM_B) 기준 |b − θ| 오름차순, LIMIT 선취분
      ⑵ 파이썬 — `rank_by_knowledge_level`로 |kl − θ의 단계| 재정렬 후 5건
    item_params는 재보정(8/18) 전까지 비어 있으므로 ⑴의 b는 전건 사전값이다.
    """

    def _top(self, unit_id: str, reported: str, size: int | None = None):
        size = size or cs.UNIT_SESSION_SIZE
        items = load_items()
        unit = next(u for u in load_units() if u["id"] == unit_id)
        theta = wb.LEVEL_GROUP_ITEM_B[reported]
        allowed = set(cs.unit_pool_level_groups(reported, theta))
        pool = [it for it in unit_candidates(items, unit) if it["level_group"] in allowed]
        pool.sort(key=lambda it: abs(wb.LEVEL_GROUP_ITEM_B[it["level_group"]] - theta))
        pool = pool[: size * cs.UNIT_POOL_PREFETCH]
        return cs.rank_by_knowledge_level(
            [SimpleNamespace(**it) for it in pool],
            wb.theta_to_knowledge_level(theta),
        )[:size]

    @pytest.mark.parametrize(
        ("unit_id", "reported"),
        [
            ("read-sky-pressure", "middle_high"),   # 자기 밴드 10건
            ("air-power-masses", "middle_high"),    # 자기 밴드 12건
            ("big-wind-birth", "adult"),            # 자기 밴드 8건
            ("city-heat-island", "elementary"),     # 자기 밴드 10건
        ],
    )
    def test_자기_밴드가_넉넉하면_전부_자기_밴드(self, unit_id, reported):
        top = self._top(unit_id, reported)
        assert len(top) == cs.UNIT_SESSION_SIZE
        assert {it.level_group for it in top} == {reported}

    def test_성인의_bs_공백은_한_단계만_강등된다(self):
        """CO-L-F2 판정의 핵심 — 성인(kl 5)이 bs에서 **kl 4**를 먼저 받는다.

        밴드 필터만이었다면 middle_high 밴드 안에서 kl 3과 4가 사전 b가 같아
        random으로 섞인다. 지식 수준 재정렬이 그 한 겹을 메운다.
        """
        top = self._top("bs-radiation", "adult")
        assert top[0].knowledge_level == 4
        # 거리 1(kl 4·6) → 거리 2(kl 3) 순. kl 2(거리 3)까지는 안 내려간다.
        assert min(it.knowledge_level for it in top) >= 3
        assert [it.knowledge_level for it in top].count(4) == 4  # 쉬운 쪽 우선

    def test_강등은_필요한_만큼만_깊어진다(self):
        """kl 4가 1건뿐인 유닛 — 모자란 만큼만 kl 3으로 내려간다."""
        top = self._top("bs-temp-vs-heat", "adult")
        assert [it.knowledge_level for it in top] == [4, 3, 3, 3, 3]

    def test_초등_board_공백은_승격으로_해소된다(self):
        """초등(kl 2) × `air-power-board` — 자기 단계 0건이라 위로 올라간다.

        방향을 상수로 박지 않았기 때문에 **같은 함수가 강등도 승격도 한다**.
        """
        top = self._top("air-power-board", "elementary")
        assert all(it.question_type == "board" for it in top)
        assert {it.level_group for it in top} == {"middle_high"}
        assert max(it.knowledge_level for it in top) == 4


class _FakeResult:
    def scalars(self):
        return self

    def all(self):
        return []


class _CapturingDB:
    def __init__(self):
        self.stmts = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        return _FakeResult()


class TestQueryShapeUnchanged:
    """넓힘은 **한 쿼리 안에서** 일어난다 — 사다리(추가 조회) 금지 가드.

    폴백을 "짧으면 한 번 더 조회"로 구현하면 `test_unit_pool_theta`의
    `len(db.stmts) == 2` 계약(제 소유 밖 파일)이 깨진다. 그 계약을 여기서도 못 박아,
    누가 나중에 사다리로 되돌려도 **이 파일에서 먼저** 울게 한다.
    """

    USER = SimpleNamespace(id=uuid.uuid4(), level_group="adult")
    UNIT = SimpleNamespace(kind="quiz", concept_tag="temperature_heat")
    ABILITIES = [{"concept_tag": "temperature_heat", "theta": 1.0, "se": 0.4, "n": 4}]

    def _run(self, abilities, unit=None):
        db = _CapturingDB()
        items = asyncio.run(
            cs._unit_content_pool(db, self.USER, unit or self.UNIT, abilities)
        )
        assert items == []
        return db

    def test_θ_경로도_조회는_정확히_2회(self):
        assert len(self._run(self.ABILITIES).stmts) == 2

    def test_콜드스타트도_조회는_정확히_2회(self):
        assert len(self._run([]).stmts) == 2

    def test_θ_경로_SQL의_밴드_IN에_전_밴드가_들어간다(self):
        params = self._run(self.ABILITIES).stmts[0].compile().params
        assert set(params["level_group_1"]) == set(BANDS)

    def test_콜드스타트_SQL은_가입_밴드_하나뿐(self):
        params = self._run([]).stmts[0].compile().params
        assert params["level_group_1"] == ["adult"]

    def test_선취는_θ_경로에만_걸린다(self):
        """콜드스타트는 재정렬이 없으므로 여유분을 읽을 이유도 없다 —
        조회량이 조용히 늘어나는 것을 여기서 막는다."""
        cold = self._run([]).stmts[0].compile().params
        warm = self._run(self.ABILITIES).stmts[0].compile().params
        limits = lambda p: [v for k, v in p.items() if k.startswith("param_")]
        assert cs.UNIT_SESSION_SIZE in limits(cold)
        assert cs.UNIT_SESSION_SIZE * cs.UNIT_POOL_PREFETCH in limits(warm)

    def test_두_조회가_같은_필터를_쓴다(self):
        """백필(2차)이 밴드를 좁히면 굶주림이 그 경로에서 되살아난다."""
        stmts = self._run(self.ABILITIES).stmts
        assert set(stmts[0].compile().params["level_group_1"]) == set(
            stmts[1].compile().params["level_group_1"]
        )

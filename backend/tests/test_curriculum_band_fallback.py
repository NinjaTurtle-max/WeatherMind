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
from app.services import weatherbrain_service as wb
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

    **2026-08-08 갱신 — 그 일이 실제로 일어났다.** 시드가 237 → 272건이 되면서
    basic-science **비board 7유닛의 adult 공백이 전부 채워졌다**(유닛당 5건).
    CO-L-F1의 원 사례("성인은 bs 8유닛 전부 0문항")는 이제 거짓이고, 남은 것은
    저작 대상이 아니었던 **`bs-convection-board` 하나**뿐이다.
    """

    #: basic-science 유닛 **전체** — CO-L-F3(진도 블록 5 충족)이 8유닛 전건을 본다.
    #: adult 공백 여부와는 별개의 목록이라 저작이 진행돼도 줄이지 않는다.
    BS_UNITS = (
        "bs-temp-vs-heat", "bs-specific-heat", "bs-radiation", "bs-pressure",
        "bs-density-buoyancy", "bs-convection-board", "bs-phase-change",
        "bs-energy-transfer",
    )

    #: 그중 **아직** adult 밴드가 비어 있는 것 — 2026-08-08 실측으로 1개.
    #: board 유닛이라 이번 저작 배치의 대상이 아니었다.
    BS_UNITS_ADULT_EMPTY = ("bs-convection-board",)

    @pytest.mark.parametrize("unit_id", BS_UNITS_ADULT_EMPTY)
    def test_adult_밴드에_basic_science가_0건(self, unit_id):
        """CO-L-F1 — 강등 폴백이 없으면 성인이 이 유닛에서 0문항 세션을 받는다."""
        assert cell_counts()[(unit_id, "adult")] == 0

    def test_저작으로_채워진_bs_7유닛은_더_이상_공백이_아니다(self):
        """CO-L-F1 해소분의 **기록** — 되돌아가면(시드 롤백) 여기가 먼저 운다."""
        filled = set(self.BS_UNITS) - set(self.BS_UNITS_ADULT_EMPTY)
        empty = [uid for uid in filled if cell_counts()[(uid, "adult")] == 0]
        assert empty == [], f"adult 저작이 사라진 bs 유닛: {empty}"

    @pytest.mark.parametrize("unit_id", ["city-anomaly-board"])
    def test_elementary_밴드에_board가_0건(self, unit_id):
        """⚠️ 2026-08-09 축소 — CO-A2 저작으로 `air-power-board`·`risk-wildfire-board`가
        채워져 목록에서 빠졌다. 남은 것은 `city-anomaly-board` 하나뿐이다.
        (이 클래스가 빨개지는 것은 저작이 진행됐다는 뜻이라 좋은 신호다 — 그때는
        기대값을 줄이고 사유를 남기면 된다. `TestBandHolesExistInRealSeed` 도크스트링 참조.)
        """
        assert cell_counts()[(unit_id, "elementary")] == 0

    def test_0문항_칸이_실제로_다수다(self):
        """숫자를 단정하지 않고 '충분히 많다'만 고정 — 저작이 진행돼도 안 깨진다.

        **하한을 5로 잡은 산수**(2026-08-08 실측): 현재 공백 16칸 중 **10칸이
        board 유닛**이고, CO-I-2(staging board 24건 투입)가 그 10칸을 정조준한다.
        최선의 경우 board가 전부 채워져도 **비board 6칸**(bs-* × expert 3 ·
        city-greenhouse × expert · risk-wildfire/flood × middle_high)은 남고,
        어떤 배치도 그 6칸을 표적하고 있지 않다. 5는 거기서 한 칸의 여유다.

        ⚠️ 직전 값 `>= 20`은 이번 저작(16칸)에 깨졌다. 인계받은 권고값 `>= 12`도
        CO-I-2 뒤에 다시 깨진다(16 − 10 = 6 < 12) — **두 번 고치지 않으려면
        "저작이 표적하지 않는 칸 수"를 하한으로 삼아야 한다.**
        """
        holes = [key for key, n in cell_counts().items() if n == 0]
        assert len(holes) >= 5, f"칸이 다 찼다면 이 계약을 갱신할 것: {holes}"

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
        # 2026-08-08 갱신: 저작으로 bs 비board 7유닛이 채워져 반경1 굶주림이
        # 17 → 6칸이 됐고, adult 축의 잔여는 이 한 칸뿐이다(원 사례
        # ("adult","bs-energy-transfer")는 해소됐다).
        assert ("adult", "bs-convection-board") in starved


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

    ⚠️ **여기서 재현하는 것은 이제 폴백 경로다**(2026-08-12 CO-G1 배선). 실제
    `_unit_content_pool`의 표적은 `unit_target_level`이 정하고, 섹션이 단계를
    말하는 유닛은 **섹션 kl**이 이긴다 — θ 파생 표적은 섹션이 없거나 미등재일
    때만 산다. 이 클래스가 보는 것(넓힘이 건강한 칸을 흐리지 않는다)은 표적이
    어디서 오든 같은 성질이라 그대로 유효하다. 섹션 표적 자체의 계약은
    `test_cyclic_sections.py`가 소유한다.
    """

    @staticmethod
    def _rank_target(reported: str) -> int:
        """이 클래스가 재현하는 **표적 단계의 단일 소유자**.

        `_unit_content_pool`이 섹션 없는 유닛에서 쓰는 산출과 같은 식이다
        (`curriculum_service.py:1067` — `theta_to_knowledge_level(θ)`). 시뮬레이션의
        학습자 θ는 신고 밴드의 사전 b이므로 표적은 `theta_to_knowledge_level(
        LEVEL_GROUP_ITEM_B[band])`가 된다. `unit_pool_level_groups` 독스트링이
        **이 파일을 이름으로 지목하며** 그 산출을 쓴다고 적어 두었고,
        `test_지식수준_고정반경으로는_굶주림이_안_풀린다`도 같은 식으로 센다.

        ⚠️ **`knowledge_level_of_level_group`을 표적으로 쓰지 말 것.** 그것은
        `knowledge_level`이 NULL인 **문항**의 폴백 대표값(밴드의 최하 단계)이지
        학습자의 표적이 아니다 — 두 값은 전 밴드에서 정확히 한 단계씩 갈린다
        (1↔2 · 3↔4 · 5↔6 · 7↔9). 실제로 그 혼용이 없는 위반을 만들어 냈다
        (2026-08-18 — 아래 KNOWN_ORDER_VIOLATIONS 주석).
        """
        return wb.theta_to_knowledge_level(wb.LEVEL_GROUP_ITEM_B[reported])

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
            self._rank_target(reported),
        )[:size]

    @pytest.mark.parametrize(
        ("unit_id", "reported"),
        [
            ("read-sky-pressure", "middle_high"),   # 자기 밴드 10건
            ("air-power-masses", "middle_high"),    # 자기 밴드 12건
            ("big-wind-birth", "adult"),            # 자기 밴드 8건
            ("city-heat-island", "elementary"),     # 자기 밴드 10건
            # 2026-08-08 저작 이관분 — 아래 두 유닛은 adult 5건이 채워지면서
            # **강등 사례가 아니라 정상 칸**이 됐다(kl 전건 5). 원래 CO-L-F2
            # 강등 예시였다는 이력은 그 자리의 주석에 남겼다.
            ("bs-radiation", "adult"),              # 자기 밴드 5건 (신규)
            ("bs-temp-vs-heat", "adult"),           # 자기 밴드 5건 (신규)
        ],
    )
    def test_자기_밴드가_넉넉하면_전부_자기_밴드(self, unit_id, reported):
        top = self._top(unit_id, reported)
        assert len(top) == cs.UNIT_SESSION_SIZE
        assert {it.level_group for it in top} == {reported}

    # ── 강등 사례를 남기는 이유 (2026-08-08 판단) ──────────────────────────
    # 저작으로 bs 비board 7유닛이 채워지면서 **강등 예시 2건이 통째로 사라졌다**
    # (위 파라미터로 이관). 승격 사례(`test_초등_board_공백은_승격으로_해소된다`)
    # 하나만 남기지 않고 아래 둘을 새로 고른 이유:
    #   ⑴ `rank_by_knowledge_level`의 설계 주장이 *"방향을 상수로 박지 않았다 —
    #      같은 함수가 강등도 승격도 한다"*이다. 승격만 물면 그 주장의 절반이
    #      무검증이 되고, 강등 경로가 조용히 회귀해도 아무도 모른다.
    #   ⑵ 순수 함수 단위 계약(`TestKnowledgeLevelReranking`)이 양방향을 물지만,
    #      **실 시드 위에서 강등이 실제로 발생하는지**는 이 클래스에서만 본다.
    # 사례는 추측이 아니라 전수 측정으로 골랐다 — 자기 밴드 0인 (유닛 × 신고밴드)
    # 9칸을 전부 돌려 순수 강등 1건과 계단식 1건을 집었다.

    def test_성인의_bs_board_공백은_강등으로_해소된다(self):
        """CO-L-F2 강등 축 — 유일하게 남은 순수 강등 사례(`bs-convection-board`).

        성인(kl 5) × 이 유닛은 adult·expert가 0건이라 middle_high로 내려간다.
        **"한 단계만"은 여기서 참이 아니다** — 그 유닛의 문항이 kl 2·3뿐이라
        거리 2가 최선이다. 한 단계 강등을 물던 원 사례(`bs-radiation` adult
        → kl 4)는 저작으로 사라졌고, 대신 "필요한 만큼만"은 아래가 지킨다.
        """
        top = self._top("bs-convection-board", "adult")
        assert len(top) == cs.UNIT_SESSION_SIZE
        assert {it.level_group for it in top} == {"middle_high"}  # 강등 방향
        assert {it.knowledge_level for it in top} == {3}  # kl 2(거리 3)는 안 쓴다

    def test_강등은_필요한_만큼만_깊어진다(self):
        """거리 오름차순이 방향과 무관하게 작동한다 — **자기 밴드가 빈 칸 전수**.

        자기 밴드 0건이라 **가까운 것부터 쓰고 모자란 만큼만** 멀어진다. 강등도
        승격도 같은 함수가 하므로 표적보다 위·아래가 섞여 나오는 것이 정상이다.
        표적의 소유자는 `_rank_target` 하나다.

        ⚠️ **사례 이름을 여기 적지 않는다**(2026-08-18). 종전 독스트링은
        "(`risk-flood` × middle_high)"를 예시로 박아 두었는데, **전수 스캔으로
        바뀐 뒤에도 그대로 남아** 그 칸이 더는 폴백 칸이 아닌 지금까지 낡은 채
        살아 있었다. 어느 칸이 폴백인지는 저작에 따라 옮겨 다니므로
        `_all_fallback_cases`가 매번 다시 센다.

        ⚠️ **골든 벡터를 쓰지 않는다**(2026-08-10 전환). 종전에는 기대 벡터를
        `[5, 6, 1, 1, 1]`로 박아 뒀는데, 같은 날 **두 번 깨졌다**:
          ⑴ 6 → 10단계 확장에서 이 유닛의 kl 6 문항이 7로 올라가 `[5, 1, 1, 1, 7]`
          ⑵ 저작 배치가 이 유닛에 문항을 더하자 또 바뀜
        이 유닛의 문항 구성은 **저작이 진행되는 내내 계속 바뀐다** — 1,000건 목표
        중 700건 넘게 남았다. 벡터를 박으면 저작할 때마다 무관한 테스트가 빨개져
        **진짜 회귀 신호를 덮는다.** 그래서 벡터가 아니라 `rank_by_knowledge_level`이
        보장하는 **성질 두 개**를 직접 문다. 성질은 시드가 어떻게 바뀌어도 참이고,
        깨지면 그때는 정말로 정렬이 회귀한 것이다.
        """
        cases = self._all_fallback_cases(require_demotion=True)
        assert cases, "강등이 일어나는 폴백 칸이 하나도 없다 — 저작이 전 칸을 채웠는지 확인"

        violations = []
        for unit_id, reported, top in cases:
            assert len(top) == cs.UNIT_SESSION_SIZE
            target = self._rank_target(reported)
            keys = [
                (abs(it.knowledge_level - target), 0 if it.knowledge_level <= target else 1)
                for it in top
            ]
            # 🔴 **이 단정이 못 잡는 것 하나를 적어 둔다 — 「3종 다 잡는다」로 읽지 말 것.**
            #    2026-08-18 변이 실측:
            #      ⑴ 거리 키 부호 역전        → FAILED (여기서 운다)
            #      ⑵ 타이브레이크 방향 역전    → FAILED (여기서 운다)
            #      ⑶ 타이브레이크 **소멸**     → PASSED ⚠️ **안 운다**
            #    ⑶이 안 우는 이유: 파이썬 안정 정렬이 시드 JSON의 **파일 순서를 우연히
            #    보존**한다. 프로덕션 SQL은 동률을 random으로 흩으므로 그 순서는
            #    보장이 아니라 artifact다 — 즉 **타이브레이크가 사라져도 이 픽스처에서는
            #    티가 안 난다.** 잡으려면 시드에 안 기대는 인위 픽스처가 필요한데
            #    그것은 이 파일의 「골든 벡터 금지」 원칙과 충돌한다(판단 대기).
            # ⑴ 거리 오름차순 — "가까운 것을 먼저 쓰고 모자란 만큼만 멀어진다"
            # ⑵ 거리가 같으면 쉬운 쪽이 먼저 — CO-L2의 강등 방향 판단
            #    (한 단계 위는 못 풀어서 막지만, 한 단계 아래는 쉬워도 가르친다)
            if keys != sorted(keys):
                violations.append(
                    (unit_id, reported, [it.knowledge_level for it in top], [k[0] for k in keys])
                )

        unexpected = [v for v in violations if (v[0], v[1]) not in self.KNOWN_ORDER_VIOLATIONS]
        assert not unexpected, f"거리 오름차순이 깨진 폴백 칸: {unexpected}"
        # 기지 위반이 고쳐지면 목록을 줄여야 한다 — 낡은 면제가 새 회귀를 덮지 않게.
        fixed = self.KNOWN_ORDER_VIOLATIONS - {(v[0], v[1]) for v in violations}
        assert not fixed, (
            f"기지 위반이 해소됐다: {fixed} — KNOWN_ORDER_VIOLATIONS에서 지울 것"
        )

    # 🔴 **기지 위반 목록 — 지금은 비어 있다.** 전수 스캔으로 새 위반이 생기면
    # 위 `unexpected`가 울고, 여기 적힌 것이 고쳐지면 `fixed`가 운다(양방향 래칫).
    #
    # ⚠️ **경위를 남긴다 — 여기 적혀 있던 1건은 실재하지 않는 위반이었다**
    # (2026-08-18 정정. 종전 기술: *"`city-anomaly-board × adult`는 kl [7,4,4,4]
    # (표적 5)라 거리 2가 거리 1보다 먼저 나온다 · 이 위반은 board 유닛 특유의
    # 경로(파이썬 측 정렬)에서 나온 것으로 보인다"* — **둘 다 거짓**이었다).
    #   · 계측: 그 칸의 풀은 kl `[4,4,4,4,7]`이고 `rank_by_knowledge_level`이 받는
    #     표적은 **6**이다(θ=사전 b 1.0 → `theta_to_knowledge_level` = 6). 거리는
    #     `[1,2,2,2]`로 **오름차순이 성립**한다. 정렬은 회귀하지 않았다.
    #   · 진짜 원인은 **단정 쪽의 표적 산출**이었다. 이 파일 안에서 표적을 두 가지
    #     식으로 세고 있었고(`_top`은 `theta_to_knowledge_level`, 단정은
    #     `knowledge_level_of_level_group`), 그 둘은 전 밴드에서 정확히 한 단계씩
    #     갈린다 — 밴드 사전 b가 `THETA_KNOWLEDGE_LEVEL_BOUNDS`의 내부 경계에
    #     **정확히 얹혀** 있어 `theta < bound` 관례가 늘 위쪽 칸을 준다.
    #   · 수리: 표적 산출을 `_rank_target` 하나로 모았다(그 독스트링이 소유자).
    # ⚠️ **전수 스캔 전환 자체는 유효했다** — 종전 `_first_fallback_case()`는 칸
    # 하나만 봤고 그 자리가 저작에 따라 옮겨 다녔으므로, 진짜 위반이 첫 칸이
    # 아니면 조용했다. 되돌리지 말 것.
    KNOWN_ORDER_VIOLATIONS: set[tuple[str, str]] = set()

    def _all_fallback_cases(self, *, require_demotion: bool = False):
        """자기 밴드가 빈 (유닛 × 신고밴드)를 **전부** 돌려준다."""
        out = []
        for unit in load_units():
            unit_id = unit["id"]
            for reported in wb.LEVEL_GROUP_BANDS:
                top = self._top(unit_id, reported)
                if len(top) != cs.UNIT_SESSION_SIZE:
                    continue
                if reported in {it.level_group for it in top}:
                    continue
                if require_demotion:
                    target = self._rank_target(reported)
                    if not any(it.knowledge_level < target for it in top):
                        continue
                out.append((unit_id, reported, top))
        return out


    def test_초등_board_공백은_승격으로_해소된다(self):
        """초등(kl 2) × `city-anomaly-board` — 자기 단계 0건이라 위로 올라간다.

        방향을 상수로 박지 않았기 때문에 **같은 함수가 강등도 승격도 한다**.

        ⚠️ 2026-08-09 사례 교체 — 원래 `air-power-board`를 썼는데 CO-A2 저작으로
        그 유닛에 초등 board가 생겨 **승격 사례가 아니게 됐다**(자기 밴드가 있으면
        올라갈 이유가 없다). 초등 board가 아직 0건인 유닛으로 옮겼다.
        여기도 채워지면 같은 방식으로 옮기거나, 강등 축만 남기고 사유를 적을 것.
        """
        top = self._top("city-anomaly-board", "elementary")
        assert all(it.question_type == "board" for it in top)
        # 자기 밴드(elementary)가 0건이라 **한 칸도 안 남는다** — 전부 위로 올라간다.
        assert "elementary" not in {it.level_group for it in top}
        # 가까운 단계부터 채운다: kl 4(middle_high)가 kl 6(expert)보다 앞선다.
        assert min(it.knowledge_level for it in top) >= 4
        assert top[0].level_group == "middle_high"


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

    # 섹션이 **단계를 말하는** 유닛 — 위 UNIT(섹션 없음)과 짝이다.
    # 값은 `SECTION_KNOWLEDGE_LEVEL`의 실제 키여야 한다(테스트가 지어내면
    # `unit_target_level`이 None을 내고 이 짝 자체가 무의미해진다).
    SECTIONED_UNIT = SimpleNamespace(
        kind="quiz",
        concept_tag="temperature_heat",
        section=next(iter(cs.SECTION_KNOWLEDGE_LEVEL)),
    )

    @staticmethod
    def _limits(params):
        return [v for k, v in params.items() if k.startswith("param_")]

    def test_선취는_재정렬이_도는_경로에만_걸린다(self):
        """**기준은 θ의 유무가 아니라 표적 단계의 유무다.**

        이 테스트는 `test_선취는_θ_경로에만_걸린다`였고 근거를 "콜드스타트는
        재정렬이 없으므로"라고 적었는데, **CO-G1 순환식 배선(10섹션 = 지식 단계)
        이후로 거짓**이다: `section_level`이 θ 없이도 표적을 내므로 콜드스타트
        에서도 `rank_by_knowledge_level`이 돈다. 그때 선취가 없으면 SQL의
        `ORDER BY random() LIMIT 4`가 먼저 자른 4건만 재정렬 대상이라 재정렬이
        사실상 무력했다. 종전 픽스처의 유닛에 `section`이 없어서 이 자리가
        **초록인 채로** 그 공백을 덮고 있었다.
        """
        # ⓐ 표적이 없다(섹션 없음 + θ 없음) → 여유분을 읽을 이유가 없다
        cold_no_target = self._run([]).stmts[0].compile().params
        assert cs.UNIT_SESSION_SIZE in self._limits(cold_no_target)
        # ⓑ 🔴 표적이 있다(섹션이 단계를 말한다) → θ가 없어도 선취한다
        cold_with_target = (
            self._run([], unit=self.SECTIONED_UNIT).stmts[0].compile().params
        )
        assert (
            cs.UNIT_SESSION_SIZE * cs.UNIT_POOL_PREFETCH
            in self._limits(cold_with_target)
        )
        # ⓒ θ 경로는 종전 그대로
        warm = self._run(self.ABILITIES).stmts[0].compile().params
        assert cs.UNIT_SESSION_SIZE * cs.UNIT_POOL_PREFETCH in self._limits(warm)

    def test_선취를_넓혀도_콜드스타트_밴드는_가입_밴드_하나다(self):
        """ⓑ의 경계 — 넓어지는 것은 **표본 수**지 밴드가 아니다.

        여기가 갈리면 콜드스타트에서 학령 표적이 통째로 무너진다
        (`unit_pool_level_groups` 독스트링의 「random 정렬에서는 넓히지 않는다」).
        """
        params = self._run([], unit=self.SECTIONED_UNIT).stmts[0].compile().params
        assert params["level_group_1"] == ["adult"]

    def test_표적이_있는_콜드스타트도_조회는_정확히_2회(self):
        assert len(self._run([], unit=self.SECTIONED_UNIT).stmts) == 2

    def test_두_조회가_같은_필터를_쓴다(self):
        """백필(2차)이 밴드를 좁히면 굶주림이 그 경로에서 되살아난다."""
        stmts = self._run(self.ABILITIES).stmts
        assert set(stmts[0].compile().params["level_group_1"]) == set(
            stmts[1].compile().params["level_group_1"]
        )


# ══════════════════════════════════════════════════════════════════════════
# CO-H12 판정 — 유닛 세션 0문항 경로에 하한(MIN_QUESTIONS)을 걸지 않는다
#
# H12는 "`MIN_QUESTIONS=1`이 daily에만 걸렸고 유닛 세션 0문항 경로가 존치한다"고
# 적었다. 2026-08-08 실측으로 판정한다 — **θ 경로에서는 시드상 도달 불가**이고,
# 남은 도달로는 콜드스타트(θ None) 하나뿐이며 그것은 ai-worker 장애의 그림자다.
# 따라서 수리 지점은 `create_unit_session`의 하한이 아니라 그 장애 경로다.
#
# 하한을 여기 걸면 안 되는 이유가 하나 더 있다: 0문항 세션은 **프론트가 소비하는
# 표면**이다(CO-S-3 빈 세션 탈출 카드 — 같은 웨이브에서 배선 중). 발급을 4xx/5xx로
# 바꾸면 그 화면이 도달 불가가 된다.
# ══════════════════════════════════════════════════════════════════════════


class _EmptyPoolDB(_CapturingDB):
    """0문항 발급을 끝까지 태우는 최소 대역 DB (풀 조회는 부모가 빈 결과)."""

    def __init__(self):
        super().__init__()
        self.added = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        return _EmptyPoolResult()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None


class _EmptyPoolResult(_FakeResult):
    def scalar_one(self):
        return 0  # allocate_quiz_ids의 오늘자 기존 발급 수


class TestZeroItemUnitSessionIsUnreachableOnThetaPath:
    """H12 ①: θ가 있으면 시드상 0문항 유닛 세션이 **구조적으로** 안 나온다.

    근거의 사슬은 이미 위에 서 있다 — `unit_pool_level_groups`가 θ 경로에서 전
    밴드를 열고(TestWidenedBandSetIsPure), 그 집합에서 어느 유닛도 0이 아니다
    (TestWidenedPoolNeverStarves). 여기서는 그 둘을 **세션 발급의 언어로** 한 번
    더 못 박는다: 0문항이 나오려면 (concept_tag, kind) 칸이 **전 밴드에서** 비어야
    한다.
    """

    def test_전_밴드_공백_유닛이_시드에_없다(self):
        items = load_items()
        empty = [
            u["id"] for u in load_units() if not unit_candidates(items, u)
        ]
        assert empty == [], (
            f"전 밴드가 빈 유닛이 생겼다 — θ 경로에서도 0문항 세션이 난다: {empty}"
        )

    def test_가장_얇은_유닛도_1건_이상이다(self):
        """여유가 얼마나 얇은지 기록으로 남긴다 — 저작이 줄면 여기가 먼저 운다.

        **부분집합으로 단정한다.** 얇은 칸이 저작으로 채워지는 것(CO-I-2 staging
        board 24건이 정확히 이 태그들에 떨어진다)은 좋은 소식이므로 울면 안 되고,
        **새로 얇아진 유닛**만 울려야 한다.
        """
        items = load_items()
        counts = {u["id"]: len(unit_candidates(items, u)) for u in load_units()}
        assert min(counts.values()) >= 1
        thin = {uid: n for uid, n in counts.items() if n < cs.UNIT_SESSION_SIZE}
        # board 3유닛은 얇지만 0은 아니다 — 진도 블록은 다음 유닛으로 이어붙인다.
        assert set(thin) <= {
            "city-anomaly-board", "risk-wildfire-board", "risk-flood-board"
        }, f"새로 얇아진 유닛이 있다: {thin}"


class TestZeroItemUnitSessionRemainsOnColdStart:
    """H12 ②: 남은 도달로는 콜드스타트 하나뿐 — 그 사실을 수치로 고정한다.

    θ None이면 필터가 가입 밴드 하나로 좁아지고(계약 — 위 `test_콜드스타트_SQL은_
    가입_밴드_하나뿐`), 그 단일 밴드에는 공백 칸이 실재한다. 그리고 θ None은
    `overall_theta`가 **abilities가 통째로 빌 때만** 내는 값이라, 가입 시
    `seed_placement`와 발급 시 `refresh_abilities`가 **둘 다** ai-worker에 닿지
    못한 유저에게만 생긴다. 즉 이것은 문항 저작의 결함이 아니라 **장애의 그림자**다.
    """

    def test_콜드스타트_공백_칸이_아직_있다(self):
        holes = [
            key
            for key, n in cell_counts().items()
            if n == 0 and key[1] != "expert"
        ]
        # 이 단정이 빨개지는 것은 **좋은 신호**다(TestBandHolesExistInRealSeed와
        # 같은 성격) — 저작으로 칸이 다 찼다는 뜻이고, 그때 H12 잔여가 닫힌다.
        assert holes, "콜드스타트 공백이 사라졌다 — H12 잔여가 닫혔으니 갱신할 것"

    def test_abilities가_비어야만_θ가_None이다(self):
        """도달 조건의 유일성 — 개념 하나만 있어도 θ가 나온다(폴백 평균)."""
        assert wb.overall_theta([]) is None
        one = [{"concept_tag": "typhoon", "theta": 0.3, "se": 0.9, "n": 0}]
        assert wb.overall_theta(one, "air_mass") is not None


class TestUnitSessionHasNoMinimumFloor:
    """H12 판정의 본체 — 0문항 풀에서도 **예외 없이** 세션이 발급된다.

    daily의 `MIN_QUESTIONS` 하한을 유닛 세션에 이식하지 **않는다**는 결정을 계약으로
    고정한다. 되돌리려면 이 테스트를 지워야 하고, 그때 CO-S-3(빈 세션 탈출 카드)의
    수신자가 사라진다는 사실이 함께 보인다.
    """

    def test_0문항_풀이면_0문항_세션이_발급된다(self):
        db = _EmptyPoolDB()
        user = SimpleNamespace(id=uuid.uuid4(), level_group="adult")
        unit = SimpleNamespace(
            id=uuid.uuid4(), kind="quiz", concept_tag="temperature_heat"
        )
        session, entries = asyncio.run(
            cs.create_unit_session(db, user, unit, abilities=[])
        )
        assert entries == []
        # ⚠️ **dict 동등에서 부분 단정으로 낮췄다**(2026-08-13, PM 승인).
        # `recipe_json`에 「오늘 첫 유닛 세션인가」 도장(`daily_first`)이 들어오면서
        # 이 자리에서 키 집합을 통째로 못 박을 수 없게 됐다 — 그 도장이 왕관 판정의
        # 유일한 근거라 뺄 수 없다. **여기서 잃은 「예상 못 한 키가 붙는다」 감시는
        # `test_unit_daily_first.py::TestRecipeJsonKeySet`이 이어받는다**(느슨하게
        # 바꾸면서 대체물을 안 세우면 그 축을 아무도 안 보게 된다).
        # 이 테스트가 소유한 계약은 **0문항 풀이어도 세션이 발급된다**이므로
        # 그것만 남긴다.
        assert session.recipe_json["kind"] == "unit"
        assert session.recipe_json["unit_id"] == str(unit.id)
        assert session.recipe_json["items"] == []
        assert session.mode == cs.MODE_UNIT

    def test_daily_하한은_유닛_세션에_적용되지_않는다(self):
        """`MIN_QUESTIONS`를 참조하는 곳이 session_service 안에만 있음을 고정한다."""
        import inspect

        src = inspect.getsource(cs)
        assert "MIN_QUESTIONS" not in src, (
            "유닛 세션에 하한이 생겼다 — CO-H12 판정을 뒤집는 변경이라 "
            "CO-S-3 빈 세션 카드의 도달 가능성부터 다시 볼 것"
        )

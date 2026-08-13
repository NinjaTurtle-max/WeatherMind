"""문항 선택 축 = `knowledge_level` 단독 — 2026-08-12 클라이언트 확정 계약.

> "무조건 배치고사에 따른 위치 배정이고, 말투만 선택 수준에 따른 변환이야"

**이 파일이 존재하는 이유** — 실측(2026-08-12): 밴드 × 지식단계 격자가 완전한
1:1이다(elementary = kl 1~2 · middle_high = 3~4 · adult = 5~6 · expert = 7~10).
그 위에서 종전 `pool_level_groups`가 "가입 그룹 ∪ θ 그룹"만 열었으므로,

  · 「성인 신고 + 지식은 초등 수준」인 학습자의 도달 범위는 kl 3~6 뿐이었고
    (`adult × kl 1~3` = 0건 — 줄 문항이 **없다**),
  · `expert`는 가입 축에 없는 값이라 어느 학령으로 신고해도 kl 7~10 (전체 404건,
    2026-08-12 실측)에 **한 건도 닿지 못했다**.

즉 신고 학령이 난이도 상한·하한을 동시에 자르고 있었다. 이제 문항 선택은 배치고사가
준 θ에서만 나오고(정렬 표적 + 창 확장 — **필터가 아니다**), `level_group`은 말투
축으로만 남는다.

검증 사슬:
  1. 성인 신고 + θ 낮음 → kl 1~2 (사양의 본체)
  2. 초등 신고 + θ 높음 → kl 7~10
  3. 배치고사가 kl 1~10 전 구간에서 뽑는다
  4. 밴드는 문항 선택에 영향을 주지 않는다 (같은 θ면 신고값이 달라도 같은 결과)
  5. 굶주림이 없다 — 어떤 (θ, 밴드)에서도 세션 정원이 찬다

**시뮬레이션 원칙**: `test_curriculum_band_fallback`의 관례를 그대로 따라 실 시드
(`database/seed/content_items.json`)를 로드하고 서빙 사슬 두 겹을 재현한다 —
⑴ SQL의 `|사전 b − θ|` 오름차순 + LIMIT 선취, ⑵ `rank_by_knowledge_level`의
`|kl − θ의 단계|` 재정렬. **SQL 2차 키가 `random()`이므로 무작위 셔플을 여러 시드로
돌려** 결론이 뽑기 운에 기대지 않음을 확인한다.

실행: backend 디렉토리에서
`python -m pytest tests/test_selection_by_knowledge_level.py -q`.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs
from app.services import placement_service as ps
from app.services import session_service
from app.services import weatherbrain_service as wb

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"
BANDS = wb.LEVEL_GROUP_BANDS
#: SQL `random()` 2차 키 재현용 셔플 시드 — 결론이 뽑기 운에 걸리지 않게 반복한다.
SHUFFLE_SEEDS = (0, 1, 2, 3, 4)


def load_items() -> list[dict]:
    """실 시드 문항 — 시드에 없는 `id`는 순번으로 채운다(test_placement 관례).

    시드의 멱등 키는 concept_tag + question_text라 JSON에 id가 없다. 여기서 id는
    "같은 문항인지"를 비교하기 위한 표지일 뿐이고, 순번은 파일 순서라 결정적이다.
    """
    return [
        {"id": f"seed-{index:04d}", **entry}
        for index, entry in enumerate(
            json.loads(
                (SEED_DIR / "content_items.json").read_text(encoding="utf-8")
            )
        )
    ]


def load_units() -> list[dict]:
    return json.loads((SEED_DIR / "units.json").read_text(encoding="utf-8"))


def daily_new_pool(reported: str, theta: float, shuffle_seed: int) -> list:
    """`_fetch_pools`의 new 풀을 실 시드 위에서 재현한다 (필터 → SQL 정렬 → 재정렬).

    - 필터: `pool_level_groups`(밴드) + `uses_live_slots == false` + board 포함
      (new 풀은 유형을 가리지 않는다).
    - SQL: `|사전 b − θ|` 오름차순, 동률은 random — 셔플로 재현한다.
      `item_params`는 재보정(8/18) 전까지 비어 있으므로 b는 전건 사전값이다.
    - 파이썬: 선취분(`DAILY_POOL_PREFETCH` 배)을 `rank_by_knowledge_level`로 다시
      세우고 `NEW_POOL_LIMIT`으로 자른다.
    """
    limit = session_service.NEW_POOL_LIMIT
    allowed = set(session_service.pool_level_groups(reported, theta))
    pool = [
        it
        for it in load_items()
        if it["level_group"] in allowed and not it.get("uses_live_slots")
    ]
    random.Random(shuffle_seed).shuffle(pool)
    pool.sort(key=lambda it: abs(wb.LEVEL_GROUP_ITEM_B[it["level_group"]] - theta))
    prefetched = pool[: limit * session_service.DAILY_POOL_PREFETCH]
    return cs.rank_by_knowledge_level(
        [SimpleNamespace(**it) for it in prefetched],
        None if theta is None else wb.theta_to_knowledge_level(theta),
    )[:limit]


def levels_of(items) -> list[int]:
    return [wb.effective_knowledge_level(it) for it in items]


# ═══════════════════════════════════════════════════════════════
# ⑴·⑵ 본체 — 신고 학령이 난이도의 상한도 하한도 자르지 않는다
# ═══════════════════════════════════════════════════════════════


class TestReportedBandNoLongerCapsDifficulty:
    @pytest.mark.parametrize("shuffle_seed", SHUFFLE_SEEDS)
    @pytest.mark.parametrize("theta", (-1.6, -1.2, -0.8))
    def test_성인_신고_θ_낮음이_초등_단계_문항을_받는다(self, theta, shuffle_seed):
        """사양의 본체. 종전에는 `adult × kl 1~3` = 0건이라 **줄 문항이 없었다**."""
        levels = levels_of(daily_new_pool("adult", theta, shuffle_seed))
        assert levels, "풀이 비었다 — 굶주림"
        assert set(levels) <= {1, 2}, Counter(levels)
        assert wb.theta_to_knowledge_level(theta) in levels

    @pytest.mark.parametrize("shuffle_seed", SHUFFLE_SEEDS)
    @pytest.mark.parametrize("theta", (1.9, 2.1, 2.4))
    def test_초등_신고_θ_높음이_전문_단계_문항을_받는다(self, theta, shuffle_seed):
        """expert(kl 7~10)는 가입 축에 없는 값이라 종전에 **누구도 도달 못 했다**."""
        levels = levels_of(daily_new_pool("elementary", theta, shuffle_seed))
        assert levels, "풀이 비었다 — 굶주림"
        assert set(levels) <= {7, 8, 9, 10}, Counter(levels)
        assert wb.theta_to_knowledge_level(theta) in levels

    @pytest.mark.parametrize("reported", BANDS)
    def test_전_밴드_전_단계가_도달_가능하다(self, reported):
        """어떤 신고 학령이어도 θ만 옮기면 kl 1~10 전 구간에 닿는다."""
        reached = set()
        for level in range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1):
            theta = theta_for_level(level)
            reached.update(levels_of(daily_new_pool(reported, theta, 0)))
        assert reached == set(
            range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
        ), sorted(reached)


def theta_for_level(level: int) -> float:
    """그 지식 단계로 이산화되는 대표 θ — 경계 튜플에서 파생(리터럴 금지)."""
    bounds = wb.THETA_KNOWLEDGE_LEVEL_BOUNDS
    index = level - wb.KNOWLEDGE_LEVEL_MIN
    low = bounds[index - 1] if index > 0 else bounds[0] - 0.5
    high = bounds[index] if index < len(bounds) else bounds[-1] + 0.5
    return (low + high) / 2


# ═══════════════════════════════════════════════════════════════
# ⑷ 밴드는 선택에 영향을 주지 않는다
# ═══════════════════════════════════════════════════════════════


class TestBandDoesNotAffectSelection:
    @pytest.mark.parametrize("shuffle_seed", SHUFFLE_SEEDS)
    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_같은_θ면_신고_학령이_달라도_같은_문항(self, level, shuffle_seed):
        """같은 뽑기(같은 셔플 시드)에서 결과가 **문항 id 수준으로** 같아야 한다."""
        theta = theta_for_level(level)
        picks = {
            band: [it.id for it in daily_new_pool(band, theta, shuffle_seed)]
            for band in BANDS
        }
        first = picks[BANDS[0]]
        for band in BANDS[1:]:
            assert picks[band] == first, band

    def test_밴드_필터_집합이_신고값에_의존하지_않는다(self):
        """`pool_level_groups`의 θ 경로 — 미지 신고값 방어항만 다르다."""
        theta = 0.0
        for band in BANDS:
            assert set(session_service.pool_level_groups(band, theta)) == set(BANDS)
        # 미지 값 방어(unit_pool_level_groups의 같은 계약): 값이 사라지지 않는다
        assert "ghost" in session_service.pool_level_groups("ghost", theta)
        assert set(BANDS) <= set(session_service.pool_level_groups("ghost", theta))

    @pytest.mark.parametrize("band", BANDS)
    def test_콜드스타트는_오늘과_불변(self, band):
        """θ None은 정렬이 random이라 넓히면 표적이 통째로 무너진다 — 단일 밴드 유지.

        실사용의 θ None은 `seed_placement` 실패 유저뿐이며, 이 경로가 신고 학령을
        읽는 **유일한 잔존 지점**이다(보고 대상).
        """
        assert session_service.pool_level_groups(band, None) == [band]

    def test_유닛_풀_밴드_집합은_daily와_같아졌다(self):
        """`unit_pool_level_groups`가 먼저 옳았고 daily가 따라왔다 — 이제 동치."""
        for band in BANDS:
            for theta in (-1.2, 0.0, 2.2):
                assert cs.unit_pool_level_groups(band, theta) == (
                    session_service.pool_level_groups(band, theta)
                )


def board_pool(reported: str, theta: float, shuffle_seed: int = 0) -> list:
    """`_fetch_board_pool`을 재현한다 — **작은 풀**이라 꼬리가 실제로 드러난다.

    new 풀(1012건 중 60건 선취)에서는 θ에 가장 가까운 밴드만으로 선취가 다 차서
    신고 학령이 결과에 닿지 못한다. board는 전 밴드 합쳐 46건뿐이고 한도가
    `BOARD_POOL_LIMIT`(40)이라 **꼬리가 반드시 다른 밴드로 넘어간다** — 신고
    학령이 선택을 오염시키던 자리가 여기다. board 풀은 kl 재정렬을 걸지 않으므로
    (`order_boards_for_today`가 현상 축으로 다시 세운다) 순서는 SQL 정렬 그대로다.
    """
    allowed = set(session_service.pool_level_groups(reported, theta))
    pool = [
        it
        for it in load_items()
        if it["level_group"] in allowed
        and not it.get("uses_live_slots")
        and it["question_type"] == "board"
    ]
    random.Random(shuffle_seed).shuffle(pool)
    pool.sort(key=lambda it: abs(wb.LEVEL_GROUP_ITEM_B[it["level_group"]] - theta))
    return [SimpleNamespace(**it) for it in pool[: session_service.BOARD_POOL_LIMIT]]


class TestSmallPoolsFallToNearestLevel:
    """꼬리가 **한 단계씩** 내려앉는다 — 신고 학령으로 건너뛰지 않는다."""

    def test_성인_신고_θ_초등이면_board_꼬리가_중등으로_간다(self):
        """종전에는 허용 밴드가 (초등 8 · 성인 5)뿐이라 kl 1~2 다음이 **kl 5**였다.

        같은 사람에게 초등 보드와 성인 보드를 번갈아 주는 것이 밴드 필터의 실제
        증상이다. 지금은 kl 1~2 → 3~4 → 5 순으로 한 단계씩 멀어진다.
        """
        theta = theta_for_level(1)
        head = levels_of(board_pool("adult", theta))[:13]
        assert set(head) <= {1, 2, 3, 4}, Counter(head)

    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_같은_θ면_board_풀도_신고값과_무관(self, level):
        theta = theta_for_level(level)
        pools = {band: [it.id for it in board_pool(band, theta)] for band in BANDS}
        for band in BANDS[1:]:
            assert pools[band] == pools[BANDS[0]], band


# ═══════════════════════════════════════════════════════════════
# ⑸ 굶주림 — 어떤 (θ, 밴드)에서도 정원이 찬다
# ═══════════════════════════════════════════════════════════════


class TestNeverStarves:
    @pytest.mark.parametrize("reported", BANDS)
    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_daily_new_풀이_정원을_채운다(self, reported, level):
        pool = daily_new_pool(reported, theta_for_level(level), 0)
        assert len(pool) == session_service.NEW_POOL_LIMIT

    @pytest.mark.parametrize("reported", BANDS)
    @pytest.mark.parametrize(
        "level", range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    )
    def test_전_유닛이_UNIT_SESSION_SIZE를_채운다(self, reported, level):
        """유닛 세션·진도 블록의 굶주림 — 밴드 필터를 통과한 뒤의 칸 인구를 센다.

        `test_curriculum_band_fallback`은 θ = 자기 밴드 사전값 한 점만 봤다.
        사양 변경으로 (신고 밴드 × θ)가 자유 조합이 되므로 전 조합을 센다.
        """
        theta = theta_for_level(level)
        allowed = set(cs.unit_pool_level_groups(reported, theta))
        items = load_items()
        starved = []
        for unit in load_units():
            is_board = unit["kind"] == "board"
            pool = [
                it
                for it in items
                if it["concept_tag"] == unit["concept_tag"]
                and not it.get("uses_live_slots")
                and (it["question_type"] == "board") == is_board
                and it["level_group"] in allowed
            ]
            if len(pool) < cs.UNIT_SESSION_SIZE:
                starved.append((unit["id"], len(pool)))
        assert starved == [], f"{reported}·kl{level}: {starved}"


# ═══════════════════════════════════════════════════════════════
# ⑶ 배치고사가 10단계를 변별한다
# ═══════════════════════════════════════════════════════════════


def placement_candidates() -> list[dict]:
    """실 시드를 `plan_placement_picks` 후보 형식으로 (test_placement 관례)."""
    return [
        {
            "id": entry["id"],
            "concept_tag": entry["concept_tag"],
            "level_group": entry["level_group"],
            "knowledge_level": entry.get("knowledge_level"),
            "question_type": entry["question_type"],
            "uses_live_slots": bool(entry.get("uses_live_slots")),
        }
        for entry in load_items()
    ]


class TestPlacementSpansAllLevels:
    def test_목표_시퀀스가_전_구간을_덮는다(self):
        """size = 단계 수면 **전 단계가 정확히 한 번씩**. 리터럴 10을 쓰지 않는다."""
        levels = list(range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1))
        assert ps.target_level_sequence(len(levels)) == levels

    def test_기본_size에서도_양_끝과_중단이_들어온다(self):
        """`PLACEMENT_SIZE`(설정 소유)가 단계 수보다 작아도 변별 범위는 전 구간."""
        seq = ps.target_level_sequence(ps.PLACEMENT_SIZE)
        assert len(seq) == ps.PLACEMENT_SIZE
        assert seq == sorted(seq)
        assert seq[0] == wb.KNOWLEDGE_LEVEL_MIN
        assert seq[-1] == wb.KNOWLEDGE_LEVEL_MAX
        assert len(set(seq)) == ps.PLACEMENT_SIZE  # 슬롯이 겹쳐 낭비되지 않는다

    def test_실_시드_선발이_목표_단계에_정확히_맞는다(self):
        picks = ps.plan_placement_picks(placement_candidates(), "middle_high")
        assert len(picks) == ps.PLACEMENT_SIZE
        assert [p["knowledge_level"] for p in picks] == ps.target_level_sequence(
            ps.PLACEMENT_SIZE
        )

    def test_size를_단계_수로_올리면_전_단계_표본(self):
        """PM 판정용 근거 — `PLACEMENT_SIZE`를 단계 수로 올리면 전 구간 1건씩."""
        size = wb.KNOWLEDGE_LEVEL_MAX - wb.KNOWLEDGE_LEVEL_MIN + 1
        picks = ps.plan_placement_picks(placement_candidates(), "adult", size=size)
        assert [p["knowledge_level"] for p in picks] == list(
            range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
        )

    @pytest.mark.parametrize("size", (ps.PLACEMENT_SIZE, 10))
    def test_신고_학령이_배치고사를_바꾸지_않는다(self, size):
        """배치고사는 위치를 **재는 자**다 — 신고값에 따라 눈금이 달라지면 안 된다.

        ⚠️ 이 성질이 R7-02 §3.2 **서로소 배치를 폐기**한다(모듈 독스트링).
        """
        candidates = placement_candidates()
        picks = {
            band: [p["item"]["id"] for p in ps.plan_placement_picks(candidates, band, size=size)]
            for band in (*BANDS, "ghost")
        }
        first = picks[BANDS[0]]
        for band, ids in picks.items():
            assert ids == first, band

    def test_board와_live는_여전히_제외(self):
        picks = ps.plan_placement_picks(placement_candidates(), "adult")
        assert all(p["item"]["question_type"] != "board" for p in picks)
        assert all(not p["item"]["uses_live_slots"] for p in picks)

    def test_개념_커버리지_유지(self):
        """전 개념이 **최소 1회** — 「개념당 정확히 1」이 아니다 (2026-08-12).

        `PLACEMENT_SIZE`가 10으로 오르면서 슬롯 수가 진단 개념 수(6)를 넘었다.
        슬롯은 개념을 순환 배정하므로 앞 4개념이 2회, 뒤 2개념이 1회 나온다 —
        살아 있는 계약은 «변별이 한 개념에 쏠리지 않는다»이지 등장 횟수가 아니다.
        """
        picks = ps.plan_placement_picks(placement_candidates(), "adult")
        counts = Counter(p["concept_tag"] for p in picks)
        assert set(counts) == set(wb.PLACEMENT_QUIZ_TAGS)
        assert max(counts.values()) - min(counts.values()) <= 1


class TestPlacementLevelFallback:
    """목표 단계가 비면 **가장 가까운 단계**로 내려앉는다 — 고정 창이 아니다."""

    def _item(self, concept, level, item_id, **kw):
        return {
            "id": item_id,
            "concept_tag": concept,
            "level_group": wb.level_group_of_knowledge_level(level),
            "knowledge_level": level,
            "question_type": kw.get("question_type", "multiple_choice"),
            "uses_live_slots": kw.get("live", False),
        }

    def test_목표가_비면_가장_가까운_단계(self):
        bank = [self._item("typhoon", 8, "kl8"), self._item("typhoon", 2, "kl2")]
        picks = ps.plan_placement_picks(
            bank, "adult", size=1, concept_tags=["typhoon"]
        )
        # size=1 → 목표는 최하 단계 → kl2가 더 가깝다
        assert picks[0]["item"]["id"] == "kl2"

    def test_동률이면_쉬운_쪽(self):
        """`rank_by_knowledge_level`과 같은 2차 키 — 위 단계는 막고 아래는 가르친다."""
        bank = [self._item("typhoon", 6, "harder"), self._item("typhoon", 4, "easier")]
        picks = ps.plan_placement_picks(
            bank, "adult", size=1, concept_tags=["typhoon"]
        )
        assert picks[0]["item"]["id"] == "easier"  # 목표 5 기준 양쪽 거리 1

    def test_미분류_문항은_밴드에서_파생한다(self):
        """dict 후보에 `knowledge_level` 키가 없어도 터지지 않는다(0012 폴백)."""
        bank = [
            {
                "id": "no-kl",
                "concept_tag": "typhoon",
                "level_group": "elementary",
                "question_type": "multiple_choice",
                "uses_live_slots": False,
            }
        ]
        picks = ps.plan_placement_picks(
            bank, "adult", size=1, concept_tags=["typhoon"]
        )
        assert picks[0]["knowledge_level"] == wb.knowledge_level_of_level_group(
            "elementary"
        )

    def test_개념에_문항이_없으면_슬롯_생략(self):
        assert ps.plan_placement_picks([], "adult") == []


class TestAdjacentGroupsExpert:
    """⑵ CO-Y-11 — 클라이언트 확정. 선발 경로 밖이지만 표는 완결돼야 한다."""

    def test_adult의_인접에_expert가_있다(self):
        assert "expert" in ps.ADJACENT_GROUPS["adult"]

    def test_expert_자신의_항목이_있다(self):
        assert ps.ADJACENT_GROUPS["expert"] == ("adult", "expert")

    def test_표가_전_밴드를_덮는다(self):
        assert set(ps.ADJACENT_GROUPS) == set(BANDS)

    def test_신고_축은_3종_그대로(self):
        """`LEVEL_GROUPS`는 가입 화면·ai-worker 계약이 고정한다(확장 금지)."""
        assert "expert" not in ps.LEVEL_GROUPS


class TestSelectionAxisIsSingleOwner:
    """소스 계약 — 선택 축이 두 곳으로 갈리지 않는다."""

    def test_선택_필터에_신고_학령이_남지_않았다(self):
        """`pool_level_groups`의 θ 경로는 밴드 목록을 재기술하지 않는다."""
        import inspect

        src = inspect.getsource(session_service.pool_level_groups)
        assert "LEVEL_GROUP_BANDS" in src
        for literal in ('"elementary"', '"middle_high"', '"adult"', '"expert"'):
            assert literal not in src, f"밴드 리터럴 하드코딩: {literal}"

    def test_배치_배합은_신고_학령을_안_읽는다(self):
        import inspect

        src = inspect.getsource(ps.plan_placement_picks)
        assert "target_level_sequence" in src
        assert "target_group_sequence" not in src

    def test_말투_축은_살아_있다(self):
        """`level_group`은 표현 톤으로 계속 쓰인다 — 선택에서만 떼어냈다."""
        assert session_service.generation_tone("elementary") == "elementary"
        assert session_service.generation_tone("expert") == "adult"
        assert wb.effective_tone(SimpleNamespace(level_group="elementary")) == "child"

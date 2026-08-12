"""실황 순환 계약 — 클라이언트 결정 ④ 「실황 20유형 · 세션당 2건 · 10일 순환」.

**이 파일이 존재하는 이유.** 2026-08-13 유닛 실황 경로 철거로
`curriculum_service.live_rotation_window`가 사라졌고, 그것이 저장소에서 「날짜
결정적 순환」의 **유일한 구현**이었다. 철거는 옳았지만(그 경로는 개념당 1~4건
짜리 하드 필터 위에서 돌아 20종 순환이 한 번도 성립한 적이 없었다) 사양은
남았고 수신자가 없어졌다 — 이 저장소가 가장 크게 기록한 실패 유형이 정확히
**"수신자 없는 이월은 회수율 0%"**다. 그래서 순환의 소유자를
`session_service.live_rotation_order`로 옮기고, 그 사실을 여기서 문다.

계약 4종:
  ⑴ 같은 유저·같은 θ라도 **날짜가 다르면 실황 픽이 다르다**
  ⑵ 20건 풀 위에서 **주기**가 성립한다 (주기 = 코호트 ÷ gcd(코호트, cap))
  ⑶ 하루 경계는 **KST**다
  ⑷ **kl 표적이 회귀하지 않는다** — 순환이 표적을 통째로 버리지 않는다

풀은 합성이 아니라 **실 시드**(`database/seed/content_items.json`의
`uses_live_slots` 20건)에서 만든다. 철거된 유닛 테스트가 남긴 교훈이 그것이다:
그쪽은 20건짜리 합성 풀을 함수에 직접 먹여 초록이었고, 실제 서빙 경로에는 그
20건이 도달한 적이 없었다.
"""
import asyncio
import json
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import session_service as ss
from app.services import weatherbrain_service as wb

KST = timezone(timedelta(hours=9))
SEED = Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
CAP = ss.DEFAULT_RECIPE.get("live", 0)
# 기준일 — 특정 날짜에 우연히 성립하는 성질을 잡으려고 창을 길게 돌린다.
DAY0 = date(2026, 8, 13)
HORIZON = 60
TARGETS = list(range(1, len(wb.KNOWLEDGE_LEVEL_BANDS) + 1))


def _seed_live_items() -> list[SimpleNamespace]:
    raw = json.loads(SEED.read_text(encoding="utf-8"))
    items = raw if isinstance(raw, list) else raw["items"]
    return [
        SimpleNamespace(
            id=f"{i:04d}",
            knowledge_level=row.get("knowledge_level"),
            level_group=row.get("level_group"),
            concept_tag=row.get("concept_tag"),
        )
        for i, row in enumerate(items)
        if row.get("uses_live_slots")
    ]


@pytest.fixture(scope="module")
def live_pool() -> list[SimpleNamespace]:
    pool = _seed_live_items()
    assert len(pool) >= 2 * CAP, (
        f"실황 시드가 {len(pool)}건이라 순환을 검증할 재료가 없다 — 순환 계약이 "
        "아니라 저작을 먼저 볼 것"
    )
    return pool


def picks(pool, day: date, target: int | None) -> list:
    """그날 실제로 세션에 실리는 실황 픽 — 풀 앞에서 cap건(plan_bank_picks와 같다)."""
    return ss.live_rotation_order(pool, day, target)[:CAP]


def pick_ids(pool, day: date, target: int | None) -> frozenset:
    return frozenset(item.id for item in picks(pool, day, target))


def distances(pool, day: date, target: int) -> list[int]:
    return [
        abs(wb.effective_knowledge_level(item) - target)
        for item in picks(pool, day, target)
    ]


def cohort_size(pool, target: int | None) -> int:
    ordered = ss.live_rotation_order(pool, DAY0, target)
    return ss.live_rotation_cohort(
        sorted(ss._live_distance_tier(item, target) for item in ordered), CAP
    )


# ═══════════════════════════════════════════════════════════════
# ⑴ 날마다 다르다
# ═══════════════════════════════════════════════════════════════


class TestRotatesDaily:
    """같은 유저·같은 θ라도 날짜가 바뀌면 실황 픽이 바뀐다.

    ⚠️ **집합으로 비교한다.** 코호트가 cap의 배수가 아니면 이웃한 두 날의 창은
    한 건을 공유한다(코호트 3 · cap 2면 {0,1} → {2,0}). 재료가 3건뿐인 자리에서
    "전건 교체"는 나올 수 없고, 사양이 요구하는 것도 **어제 본 세트가 오늘
    그대로 반복되지 않는 것**이다.
    """

    @pytest.mark.parametrize("target", TARGETS + [None])
    def test_이웃한_두_날의_실황_세트가_같지_않다(self, live_pool, target):
        same = [
            k
            for k in range(HORIZON)
            if pick_ids(live_pool, DAY0 + timedelta(days=k), target)
            == pick_ids(live_pool, DAY0 + timedelta(days=k + 1), target)
        ]
        assert not same, (
            f"표적 {target}: {len(same)}일에서 어제와 오늘의 실황이 같은 세트다 — "
            "순환이 죽었다(코호트가 cap 이하로 좁아졌는지 확인할 것)"
        )

    @pytest.mark.parametrize("target", TARGETS + [None])
    def test_한_바퀴_안에_코호트_전건이_나온다(self, live_pool, target):
        """창이 `cap`칸씩 미므로 ⌈코호트÷cap⌉일이면 코호트를 다 훑는다.

        ⚠️ "한 바퀴 안에 중복이 없다"까지는 단정하지 **않는다** — 코호트가 cap의
        배수가 아니면 마지막 창이 앞으로 감기며 한 건을 다시 집는다(코호트 3 ·
        cap 2면 {0,1} → {2,0}). 배수일 때 겹치지 않는다는 성질은 표적 없는
        20종 케이스가 따로 문다(TestPeriod).
        """
        cohort = cohort_size(live_pool, target)
        lap = math.ceil(cohort / CAP)
        allowed = {
            item.id for item in ss.live_rotation_order(live_pool, DAY0, target)[:cohort]
        }
        seen: set = set()
        for k in range(lap):
            seen |= pick_ids(live_pool, DAY0 + timedelta(days=k), target)
        assert seen == allowed, (
            f"표적 {target}: 한 바퀴({lap}일)에 코호트 {cohort}건을 다 못 훑었다 — "
            f"빠진 것 {sorted(allowed - seen)}"
        )


# ═══════════════════════════════════════════════════════════════
# ⑵ 주기 — 사양의 "20종 · 2건 · 10일"이 어디서 성립하는가
# ═══════════════════════════════════════════════════════════════


class TestPeriod:
    """**주기 = 코호트 ÷ gcd(코호트, cap)일.**

    사양 원문의 "10일"은 이 식에 코호트 = 풀 전체(20)를 넣은 특수해다(20/2).
    표적이 있으면 코호트가 의도적으로 좁아지므로 주기도 함께 짧아진다 — 그것이
    「표적을 지키면서 순환한다」의 대가이고, 여기서 수치로 고정한다.
    """

    def test_표적이_없으면_20종이_정확히_10일에_한_바퀴다(self, live_pool):
        assert len(live_pool) == 20, (
            f"실황 시드가 {len(live_pool)}건이다 — 사양 원문의 '20유형'이 움직였다면 "
            "10일이라는 수치도 함께 재확인할 것(주기 = 종수 ÷ 세션당 건수)"
        )
        assert CAP == 2, f"세션당 실황이 {CAP}건이다 — 사양의 2건이 움직였다"
        window = [
            pick_ids(live_pool, DAY0 + timedelta(days=k), None) for k in range(11)
        ]
        covered: set = set()
        for k in range(10):
            assert not (covered & window[k]), f"{k + 1}일차에 이미 나온 문항이 다시 나왔다"
            covered |= window[k]
        assert covered == {item.id for item in live_pool}, (
            "10일 동안 20종 전건이 나오지 않았다 — 한 바퀴가 성립하지 않는다"
        )
        assert window[10] == window[0], "11일차가 1일차와 같지 않다 — 주기가 10일이 아니다"

    @pytest.mark.parametrize("target", TARGETS + [None])
    def test_실측_주기가_코호트에서_파생된다(self, live_pool, target):
        cohort = cohort_size(live_pool, target)
        expected = cohort // math.gcd(cohort, CAP)
        seq = [pick_ids(live_pool, DAY0 + timedelta(days=k), target) for k in range(HORIZON)]
        actual = next(
            p
            for p in range(1, HORIZON)
            if all(seq[i] == seq[i + p] for i in range(HORIZON - p))
        )
        assert actual == expected, (
            f"표적 {target}: 코호트 {cohort} · cap {CAP}이면 주기가 {expected}일이어야 "
            f"하는데 실측 {actual}일이다"
        )

    @pytest.mark.parametrize("target", TARGETS + [None])
    def test_코호트가_cap보다_크다(self, live_pool, target):
        """순환이 존재할 **구조적** 조건. 코호트 == cap이면 창이 밀 자리가 없다."""
        assert cohort_size(live_pool, target) > CAP, (
            f"표적 {target}: 코호트가 cap({CAP}) 이하다 — 매일 같은 실황이 나간다"
        )


# ═══════════════════════════════════════════════════════════════
# ⑶ 하루 경계는 KST
# ═══════════════════════════════════════════════════════════════


class TestKstBoundary:
    def test_KST_자정에_실황이_갈린다(self, live_pool):
        """15:00Z가 경계다 — 그 앞뒤로 실황이 갈리고, 같은 KST 하루 안에서는 안 갈린다."""
        before = datetime(2026, 8, 13, 14, 59, tzinfo=timezone.utc)
        after = datetime(2026, 8, 13, 15, 0, tzinfo=timezone.utc)
        assert before.astimezone(KST).date() == date(2026, 8, 13)
        assert after.astimezone(KST).date() == date(2026, 8, 14)
        for target in TARGETS + [None]:
            same_day = datetime(2026, 8, 13, 6, 0, tzinfo=timezone.utc)
            assert pick_ids(
                live_pool, same_day.astimezone(KST).date(), target
            ) == pick_ids(live_pool, before.astimezone(KST).date(), target), (
                f"표적 {target}: 같은 KST 하루(06:00Z ↔ 14:59Z) 안에서 실황이 바뀌었다"
            )
            assert pick_ids(
                live_pool, before.astimezone(KST).date(), target
            ) != pick_ids(live_pool, after.astimezone(KST).date(), target), (
                f"표적 {target}: KST 자정(15:00Z)을 넘었는데 실황이 그대로다"
            )

    def test_UTC_자정으로_세면_경계가_9시간_어긋난다(self, live_pool):
        """UTC로 세면 KST 00:00~09:00 응답이 '어제'가 된다 — 되돌림 방지 단정."""
        instant = datetime(2026, 8, 13, 20, 0, tzinfo=timezone.utc)  # = 8/14 05:00 KST
        assert instant.date() != instant.astimezone(KST).date()
        assert pick_ids(live_pool, instant.date(), 5) != pick_ids(
            live_pool, instant.astimezone(KST).date(), 5
        ), "UTC 달력일과 KST 달력일이 같은 창을 낸다 — 경계 검증이 무의미해졌다"


# ═══════════════════════════════════════════════════════════════
# ⑷ kl 표적이 회귀하지 않는다
# ═══════════════════════════════════════════════════════════════


class TestTargetNoRegression:
    """순환이 표적을 통째로 버리지 않는다.

    단정의 형태가 "가장 가까운 것만 나온다"가 **아닌** 이유: 그러면 kl 7~10에
    실황이 각 1건뿐인 시드에서 표적 10은 매일 같은 문항이 되어 순환이 죽는다.
    PM 판정이 "어쩔 수 없이 하나를 골라야 하면 순환을 살리라"이므로, 여기서
    무는 것은 **코호트 경계**다 — 코호트 밖(더 먼) 문항은 절대 나오지 않고,
    코호트는 「cap을 채우는 최소 계층 + 순환에 필요한 최소치」다.
    """

    @pytest.mark.parametrize("target", TARGETS)
    def test_코호트_밖_문항은_한_번도_안_나온다(self, live_pool, target):
        cohort = cohort_size(live_pool, target)
        allowed = {
            item.id for item in ss.live_rotation_order(live_pool, DAY0, target)[:cohort]
        }
        for k in range(HORIZON):
            got = pick_ids(live_pool, DAY0 + timedelta(days=k), target)
            assert got <= allowed, (
                f"표적 {target}: 코호트 밖 문항이 실렸다 — {sorted(got - allowed)}"
            )

    @pytest.mark.parametrize("target", TARGETS)
    def test_거리가_두_계층_넘게_벌어지지_않는다(self, live_pool, target):
        """코호트의 최원거리는 최근거리에서 몇 계층 안이어야 한다.

        kl 정렬을 걷어내면 이 단정이 즉시 깨진다(코호트가 풀 전체가 되어 표적
        3에서 거리 7짜리가 실린다) — 되돌림 검증이 보는 자리가 여기다.
        """
        nearest = min(
            abs(wb.effective_knowledge_level(item) - target) for item in live_pool
        )
        worst = max(
            max(distances(live_pool, DAY0 + timedelta(days=k), target))
            for k in range(HORIZON)
        )
        assert worst <= nearest + 2, (
            f"표적 {target}: 최근거리 {nearest}인데 실황 픽이 거리 {worst}까지 벌어졌다"
        )

    @pytest.mark.parametrize("target", TARGETS)
    def test_표적_단계에_재료가_충분하면_그_단계만_나온다(self, live_pool, target):
        """거리 0 계층이 cap+1건 이상이면 순환도 그 안에서 끝난다 — 표적 우선의 증거."""
        exact = [
            item
            for item in live_pool
            if wb.effective_knowledge_level(item) == target
        ]
        if len(exact) <= CAP:
            pytest.skip(f"표적 {target}: 거리 0 문항이 {len(exact)}건이라 순환 재료가 없다")
        for k in range(HORIZON):
            assert set(distances(live_pool, DAY0 + timedelta(days=k), target)) == {0}, (
                f"표적 {target}: 그 단계에 {len(exact)}건이 있는데 다른 단계가 실렸다"
            )

    def test_전_표적_평균_거리가_밴드_정렬보다_낫다(self, live_pool):
        """복원이 표적 축에서도 **개선**임을 수치로 못박는다(2026-08-13 실측).

        복원 전 경로는 `|사전 b(밴드) − θ| → random → limit 5`라 밴드 해상도였다.
        같은 시드 20건·60일에서 전 표적 평균 |Δ| 0.80 · P(|Δ|≥2) 15.0%였고,
        복원 후는 0.47 · 3.3%다. 여기서는 그 상한을 계약으로 남긴다 —
        저작이 늘면 값은 좋아질 뿐이고, 나빠지면 코호트 규칙이 흔들린 것이다.
        """
        deltas = [
            d
            for target in TARGETS
            for k in range(HORIZON)
            for d in distances(live_pool, DAY0 + timedelta(days=k), target)
        ]
        mean = sum(deltas) / len(deltas)
        far = sum(1 for d in deltas if d >= 2) / len(deltas)
        assert mean <= 0.80, f"전 표적 평균 |Δ| {mean:.2f} — 밴드 정렬(0.80)보다 나쁘다"
        assert far <= 0.15, f"P(|Δ|≥2) {far:.1%} — 밴드 정렬(15.0%)보다 나쁘다"


# ═══════════════════════════════════════════════════════════════
# 서빙 경로 배선 — 함수가 아니라 **세션이** 순환하는가
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class LivePoolDB:
    """live 쿼리에만 실황 풀을 돌려주는 대역 — 나머지 풀은 비운다."""

    def __init__(self, rows):
        self.rows = rows
        self.limits: list[int] = []

    async def execute(self, stmt):
        sql = str(stmt).lower()
        if "uses_live_slots is true" in sql or "uses_live_slots is 1" in sql:
            self.limits.append(getattr(stmt._limit_clause, "value", None))
            return _FakeResult(list(self.rows))
        return _FakeResult([])


def _fetch_live(db, theta, day):
    return asyncio.run(
        ss._fetch_pools(
            db,
            SimpleNamespace(id=uuid.uuid4(), level_group="adult"),
            [],
            theta=theta,
            today=day,
        )
    )[2]


class TestWiredIntoDailyPath:
    def test_실황_풀_조회가_20종을_자르지_않는다(self, live_pool):
        """`limit 5`가 남아 있으면 순환의 재료가 SQL에서 먼저 사라진다."""
        db = LivePoolDB(live_pool)
        _fetch_live(db, 0.0, DAY0)
        assert db.limits and db.limits[0] >= len(live_pool), (
            f"실황 쿼리 LIMIT이 {db.limits}다 — 시드 {len(live_pool)}종을 다 못 본다"
        )
        assert ss.LIVE_POOL_LIMIT >= len(live_pool)

    def test_daily_풀이_날짜에_따라_다른_실황을_낸다(self, live_pool):
        a = _fetch_live(LivePoolDB(live_pool), 0.0, DAY0)[:CAP]
        b = _fetch_live(LivePoolDB(live_pool), 0.0, DAY0 + timedelta(days=1))[:CAP]
        assert {i.id for i in a} != {i.id for i in b}, (
            "_fetch_pools가 날짜를 무시한다 — 순환이 서빙 경로에 배선되지 않았다"
        )

    def test_같은_날_같은_θ면_몇_번_불러도_같다(self, live_pool):
        a = _fetch_live(LivePoolDB(live_pool), 0.0, DAY0)[:CAP]
        b = _fetch_live(LivePoolDB(live_pool), 0.0, DAY0)[:CAP]
        assert [i.id for i in a] == [i.id for i in b], (
            "같은 날 두 번 발급하면 다른 실황이 나온다 — 결정성이 깨졌다"
        )

    def test_기준일을_안_넘기면_KST_오늘로_떨어진다(self, live_pool):
        today = datetime.now(KST).date()
        assert [i.id for i in _fetch_live(LivePoolDB(live_pool), 0.0, None)[:CAP]] == [
            i.id for i in _fetch_live(LivePoolDB(live_pool), 0.0, today)[:CAP]
        ], "today 생략 시 기본값이 KST 달력일이 아니다"

"""**유닛에서 진입한 세션은 유닛의 지식 단계를 따른다** — 2026-08-13 PM 판정.

클라이언트가 세 번째로 지적한 결함의 계약이다: 「섹션 1 · 초등 3~4학년」 유닛을
열었는데 문항 태그가 「중학교 유체 지구」(kl4)로 떴다. 원인은 **하루 첫 유닛
세션이 데일리 배합 경로**(`session_service.plan_daily_picks`)를 타면서, 그 경로가
풀을 **학습자의 θ·밴드**로만 골랐다는 것이다. 게스트 기본값이 `middle_high`라
초등 유닛에서도 kl 3~4가 나왔다.

기계는 이미 있었다 — `curriculum_service.unit_target_level`(CO-G1)이 그것이고
**두 번째 이후 유닛 세션**(`_unit_content_pool`)은 *"표적 단계는 유닛이 먼저다"*
라고 적으며 이미 쓰고 있었다. 첫 세션만 그 원칙에서 빠져 있었다.

⚠️ **정렬만 고치면 안 된다 — 이 파일의 존재 이유가 그것이다.**
`middle_high` 학습자의 풀은 `rank_by_knowledge_level`이 돌기 **전에** 이미
kl 3~4로 밴드 필터돼 있다. 표적 1에 대한 거리로 정렬하면 kl 3이 이기므로 태그가
「중학교 유체 지구」 → 「중학교 물질·에너지」로 바뀔 뿐 **여전히 중학교**다.
그래서 **밴드 필터 자체가 유닛을 따라간다**(`pool_level_groups`의 `target_level`
인자). `TestSortingAloneIsNotEnough`가 그 사실을 실측으로 못 박는다.

**왜 새 결정이 아닌가**: CO-G1이 「섹션 = 지식 단계」를 이미 정했다. 순환식
커리큘럼에서 유닛이 무엇을 가르치는지는 **유닛이** 정하고, 학습자의 수준은
**경로 위 어디에 서는지**(배치고사)를 정한다. 성인이 kl 1 유닛을 열면 kl 1
문항을 받는 것이 맞다.

**시뮬레이션 원칙**은 `test_selection_by_knowledge_level`·
`test_curriculum_band_fallback`의 관례를 따른다 — 실 시드
(`database/seed/content_items.json`)를 대역 DB의 카탈로그로 쓰고, 서빙 사슬
두 겹을 **실제 SQL에서 읽어** 재현한다: ⑴ `level_group IN (…)` 필터와
`|사전 b − θ|` 오름차순 + LIMIT 선취(대역 DB가 컴파일된 statement의 파라미터를
그대로 읽는다), ⑵ `rank_by_knowledge_level`의 `|kl − 표적|` 재정렬(실물).
⑴을 재현하지 않으면 **밴드 파생을 제거해도 테스트가 초록으로 남는다** —
정렬만으로 elementary 문항을 찾아내기 때문이다.

실행: backend 디렉토리에서
`python -m pytest tests/test_unit_session_target_level.py -q`.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import random
import re
import uuid
from collections import Counter
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import curriculum_service as cs
from app.services import session_service as ss
from app.services import weatherbrain_service as wb

SEED_DIR = Path(__file__).resolve().parents[2] / "database" / "seed"
TODAY = date(2026, 8, 13)
RECIPE_TOTAL = sum(settings.SESSION_RECIPE.values())

#: 기상 코스 1섹션 = 지식 단계 1(초등 3~4학년) — 클라이언트 재현의 그 유닛.
SECTION_LEVEL_1 = cs.SECTION_ORDER[0]
#: 대조군 — 같은 개념이 재등장하는 상위 섹션(지식 단계 9).
SECTION_LEVEL_9 = cs.SECTION_ORDER[8]


# ══════════════════════════════════════════════════════════════════════════
# 실 시드 카탈로그
# ══════════════════════════════════════════════════════════════════════════


def load_catalog() -> list[SimpleNamespace]:
    """실 시드를 `ContentItem` 대역으로 — 발급 경로가 읽는 필드만 갖춘다.

    시드의 멱등 키는 concept_tag + question_text라 JSON에 id가 없다. 여기서 id는
    "같은 문항인지"를 비교하기 위한 표지일 뿐이고, 순번은 파일 순서라 결정적이다
    (`test_selection_by_knowledge_level`과 같은 관례).
    """
    rows = json.loads(
        (SEED_DIR / "content_items.json").read_text(encoding="utf-8")
    )
    return [
        SimpleNamespace(
            id=f"seed-{index:04d}",
            concept_tag=entry["concept_tag"],
            question_type=entry["question_type"],
            level_group=entry["level_group"],
            knowledge_level=entry.get("knowledge_level"),
            uses_live_slots=bool(entry.get("uses_live_slots")),
            template_json=entry["template_json"],
            status=entry.get("status", "active"),
        )
        for index, entry in enumerate(rows)
    ]


CATALOG = load_catalog()


def all_slot_values() -> dict[str, str]:
    """시드 실황 문항이 쓰는 `{today.*}` 슬롯 전건 — 치환 가능 상태를 만든다.

    KMA 없이 도는 테스트라 `get_today_weather`가 `{}`를 주고, 그러면 CO-M1의
    「치환 불가 실황은 배합 전에 제외」가 **실황 블록을 통째로** 걷어낸다.
    그 상태에서는 실황 kind가 검사되지 않으므로 슬롯을 손으로 채워 준다.
    """
    keys = set()
    for item in CATALOG:
        keys |= set(re.findall(r"\{(today\.[a-z_]+)\}", json.dumps(item.template_json, ensure_ascii=False)))
    return {key: "18" for key in sorted(keys)}


SLOT_VALUES = all_slot_values()


# ══════════════════════════════════════════════════════════════════════════
# 대역 DB — 컴파일된 statement를 읽어 카탈로그에 적용한다
# ══════════════════════════════════════════════════════════════════════════


class _Rows:
    def __init__(self, rows=(), scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class _CatalogDB:
    """`content_items` 질의만 실제로 "실행"하는 대역 DB.

    **SQL을 재구현하지 않는다** — 컴파일된 statement의 바인드 파라미터에서
    `level_group IN (…)` · `question_type` · `concept_tag` · LIMIT · θ를 읽어
    카탈로그에 적용한다. 그래서 프로덕션이 밴드 필터를 바꾸면 여기 결과도 바뀐다
    (이 성질이 「밴드 파생 제거 → 붉어짐」 변이 검증의 전제다).

    `random()` 2차 키는 **DB 인스턴스마다 고정된 셔플**로 재현한다 — 같은 시드로
    두 번 부르면 같은 결과라야 「target_level=None은 종전과 동일」을 잴 수 있다.
    """

    def __init__(self, *, shuffle_seed: int = 0, unit_sessions_today: int = 0):
        self.unit_sessions_today = unit_sessions_today
        self.statements: list[str] = []
        self.level_groups: list[list[str]] = []
        self.added: list = []
        order = list(range(len(CATALOG)))
        random.Random(shuffle_seed).shuffle(order)
        self._rank = {CATALOG[i].id: pos for pos, i in enumerate(order)}

    # ── 실행 ────────────────────────────────────────────────────────────
    async def execute(self, stmt):
        text = str(stmt)
        if text.lstrip().lower().startswith("select count"):
            if "FROM sessions" in text:
                return _Rows(scalar=self.unit_sessions_today)
            return _Rows(scalar=0)
        if "FROM content_items" not in text:
            return _Rows()
        return _Rows(self._select(stmt, text))

    def _select(self, stmt, text: str) -> list[SimpleNamespace]:
        params = stmt.compile().params
        groups = params.get("level_group_1") or []
        self.statements.append(text)
        self.level_groups.append(list(groups))
        theta = params.get("coalesce_1")
        live = "uses_live_slots IS true" in text
        rows = [
            item
            for item in CATALOG
            if item.status == "active"
            and item.level_group in groups
            and item.uses_live_slots is live
        ]
        tags = params.get("concept_tag_1")
        if tags:
            rows = [item for item in rows if item.concept_tag in tags]
        qtype = params.get("question_type_1")
        if qtype is not None:
            if "question_type IN" in text:
                rows = [item for item in rows if item.question_type in qtype]
            else:  # `!=` — `_unit_content_pool`의 board 배제
                rows = [item for item in rows if item.question_type != qtype]
        if theta is None:
            rows.sort(key=lambda item: self._rank[item.id])
        else:
            rows.sort(
                key=lambda item: (
                    abs(
                        wb.LEVEL_GROUP_ITEM_B.get(item.level_group, wb.DEFAULT_ITEM_B)
                        - theta
                    ),
                    self._rank[item.id],
                )
            )
        limit = getattr(stmt._limit_clause, "value", None)
        return rows[:limit] if limit else rows

    # ── 쓰기 ────────────────────────────────────────────────────────────
    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    def begin_nested(self):
        return _Savepoint()


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


# ══════════════════════════════════════════════════════════════════════════
# 유저·유닛·상류 대역
# ══════════════════════════════════════════════════════════════════════════


def user(level_group: str) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), level_group=level_group, region="서울")


def unit(section: str | None, *, kind: str = "quiz") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug="w01-pressure-front",
        kind=kind,
        concept_tag="pressure_front",
        section=section,
    )


def abilities_at(theta: float) -> list[dict]:
    """전 개념 θ 고정 — 학습자의 밴드 표적을 한 값으로 못 박는다."""
    tags = sorted({item.concept_tag for item in CATALOG})
    return [
        {"concept_tag": tag, "theta": theta, "se": 0.3, "n": 12} for tag in tags
    ]


@pytest.fixture(autouse=True)
def quiet_upstreams(monkeypatch):
    """KMA·ai-worker·weak_tags 조회를 걷어낸다 — 이 파일이 재는 것은 **선택 축**이다."""

    async def _no_weak_rows(db, u):
        return []

    async def _route(db, u, weak_tag_rows=None, abilities=None):
        return {"route": "general"}

    async def _weather(region=None):
        return {}

    async def _abilities(db, u):
        """`create_daily_session`은 abilities를 안 받으므로 여기서 고정한다 —
        θ가 None이면 daily가 콜드스타트 경로로 새어 「전 밴드를 연다」는 계약이
        검사되지 않는다."""
        return abilities_at(0.0)

    monkeypatch.setattr(wb, "refresh_abilities", _abilities)
    monkeypatch.setattr(ss, "_load_weak_tag_rows", _no_weak_rows)
    monkeypatch.setattr(ss, "decide_route", _route)
    monkeypatch.setattr(ss, "get_today_weather", _weather)
    monkeypatch.setattr(ss, "extract_slot_values", lambda weather: dict(SLOT_VALUES))


# ══════════════════════════════════════════════════════════════════════════
# 실행 헬퍼
# ══════════════════════════════════════════════════════════════════════════


def unit_session_levels(
    *, reported: str, theta: float, section: str | None, shuffle_seed: int = 0
) -> list[dict]:
    """하루 첫 유닛 세션을 발급하고 entries를 돌려준다."""
    db = _CatalogDB(shuffle_seed=shuffle_seed)
    _, entries = asyncio.run(
        cs.create_unit_session(
            db, user(reported), unit(section), TODAY, abilities=abilities_at(theta)
        )
    )
    return entries


def levels_of(entries: list[dict]) -> list[int]:
    return [
        wb.effective_knowledge_level(SimpleNamespace(**entry["question"]))
        for entry in entries
    ]


def daily_plan(*, reported: str, theta: float, shuffle_seed: int = 0, **kwargs):
    db = _CatalogDB(shuffle_seed=shuffle_seed)
    plan = asyncio.run(
        ss.plan_daily_picks(
            db, user(reported), TODAY, abilities=abilities_at(theta), **kwargs
        )
    )
    return db, plan


# ══════════════════════════════════════════════════════════════════════════
# ⑴ 회귀 계약 — `target_level=None`은 지금 동작과 동일하다
#
# **이 절이 먼저다.** 새 인자가 daily 경로를 한 글자도 움직이지 않는다는 것이
# 기존 daily 테스트 전건을 지키는 유일한 보증이다.
# ══════════════════════════════════════════════════════════════════════════


class TestNoneIsIdentity:
    def test_인자를_생략한_것과_None을_넘긴_것이_같다(self):
        db_a, plan_a = daily_plan(reported="middle_high", theta=0.0)
        db_b, plan_b = daily_plan(
            reported="middle_high", theta=0.0, target_level=None
        )
        assert [p["item"].id for p in plan_a.picks] == [
            p["item"].id for p in plan_b.picks
        ]
        assert [p["kind"] for p in plan_a.picks] == [p["kind"] for p in plan_b.picks]
        assert plan_a.generate_count == plan_b.generate_count

    def test_SQL도_한_글자_안_바뀐다(self):
        """결과만 같은 것으로는 부족하다 — 조회 자체가 같아야 캐시·인덱스·비용이 같다."""
        db_a, _ = daily_plan(reported="adult", theta=1.0)
        db_b, _ = daily_plan(reported="adult", theta=1.0, target_level=None)
        assert db_a.statements == db_b.statements
        assert db_a.level_groups == db_b.level_groups

    def test_풀_밴드_함수는_표적_없이_종전_값이다(self):
        """`pool_level_groups`의 기존 두 계약 — θ None은 가입 밴드 단일,
        θ 있으면 전 밴드. 표적을 안 넘기면 이 값들이 그대로다."""
        assert ss.pool_level_groups("elementary", None) == ["elementary"]
        assert ss.pool_level_groups("middle_high", 0.0) == sorted(
            set(wb.LEVEL_GROUP_BANDS)
        )
        # 명시적 None도 같은 자리
        assert ss.pool_level_groups("elementary", None, None) == ["elementary"]
        assert ss.pool_level_groups("middle_high", 0.0, None) == sorted(
            set(wb.LEVEL_GROUP_BANDS)
        )

    def test_daily_발급은_표적을_넘기지_않는다(self):
        """`GET /session/today`가 표적을 흘리면 밴드 축이 통째로 뒤집힌다 —
        행동 계약(`TestDailyPathUnmoved`)의 급소를 소스에서도 고정한다."""
        src = inspect.getsource(ss.create_daily_session)
        assert "target_level" not in src


# ══════════════════════════════════════════════════════════════════════════
# ⑵ PM 재현 — 초등 유닛에서 중학교 문항이 나오지 않는다
# ══════════════════════════════════════════════════════════════════════════


class TestUnitLevelBeatsLearnerBand:
    def test_middle_high_게스트가_kl1_유닛에서_kl2_이하만_받는다(self):
        """**클라이언트 재현 그대로.** 게스트 기본값이 middle_high다."""
        entries = unit_session_levels(
            reported="middle_high", theta=0.0, section=SECTION_LEVEL_1
        )
        assert entries, "세션이 0문항으로 나왔다 — 밴드 파생이 풀을 굶겼다"
        levels = levels_of(entries)
        assert max(levels) <= 2, f"중학교 문항이 섞였다: {Counter(levels)}"

    def test_kind_무관이다(self):
        """실황·보드·복습·신규 어느 블록도 예외가 아니다 — 화면에서 한 문항만
        중학교로 떠도 클라이언트의 지적은 그대로 남는다."""
        entries = unit_session_levels(
            reported="middle_high", theta=0.0, section=SECTION_LEVEL_1
        )
        by_kind: dict[str, list[int]] = {}
        for entry, level in zip(entries, levels_of(entries)):
            by_kind.setdefault(entry["kind"], []).append(level)
        assert "live" in by_kind, "실황 블록이 통째로 빠졌다 — 검사가 헛돈다"
        for kind, levels in by_kind.items():
            assert max(levels) <= 2, f"{kind} 블록에 kl>2가 있다: {levels}"

    def test_adult_학습자도_유닛을_이기지_못한다(self):
        """학습자의 수준은 **경로 위 어디에 서는지**를 정하지, 특정 유닛이 무엇을
        내는지를 정하지 않는다(CO-G1)."""
        entries = unit_session_levels(
            reported="adult", theta=1.0, section=SECTION_LEVEL_1
        )
        assert entries
        assert max(levels_of(entries)) <= 2, Counter(levels_of(entries))

    def test_상위_섹션은_상위_단계를_낸다(self):
        """같은 개념·같은 학습자라도 섹션이 9면 kl 7~10이 나온다 — 밴드 파생이
        「초등으로 고정」이 아니라 **유닛을 따라간다**는 것의 증거다."""
        entries = unit_session_levels(
            reported="middle_high", theta=0.0, section=SECTION_LEVEL_9
        )
        assert entries
        assert min(levels_of(entries)) >= 7, Counter(levels_of(entries))

    def test_섹션이_없는_유닛은_종전대로_학습자를_따른다(self):
        """기초과학 3섹션·대역 유닛은 `SECTION_KNOWLEDGE_LEVEL`에 없다 —
        `unit_target_level`의 fallback(None)이 그대로 살아 하위 호환이 된다."""
        entries = unit_session_levels(
            reported="middle_high", theta=0.0, section=None
        )
        assert entries
        assert set(levels_of(entries)) <= {3, 4}, Counter(levels_of(entries))


# ══════════════════════════════════════════════════════════════════════════
# ⑶ 「정렬만으로는 부족하다」 — 밴드 파생이 본체다
# ══════════════════════════════════════════════════════════════════════════


class TestSortingAloneIsNotEnough:
    """PM 판정의 근거를 **실측으로** 남긴다.

    표적을 `rank_by_knowledge_level`에만 넘기고 밴드를 학습자에게 두면, 풀은
    정렬이 돌기 전에 이미 kl 3~4로 잘려 있어 표적 1이 kl 3을 고를 뿐이다.
    태그가 「중학교 유체 지구」 → 「중학교 물질·에너지」로 바뀌어도 **여전히
    중학교**이고 클라이언트의 지적은 남는다.
    """

    def test_학습자_밴드_풀에는_kl2_이하가_아예_없다(self):
        pool = [
            item
            for item in CATALOG
            if item.level_group == "middle_high" and item.status == "active"
        ]
        assert pool
        assert min(item.knowledge_level for item in pool) >= 3

    def test_그_풀을_표적1로_정렬해도_중학교가_이긴다(self):
        pool = [item for item in CATALOG if item.level_group == "middle_high"]
        ranked = cs.rank_by_knowledge_level(pool, 1)
        assert ranked[0].knowledge_level == 3
        assert wb.level_group_of_knowledge_level(ranked[0].knowledge_level) == (
            "middle_high"
        )

    def test_밴드_파생이_kl1_유닛의_밴드를_바꾼다(self):
        assert ss.pool_level_groups("middle_high", 0.0, 1) == ["elementary"]
        assert ss.pool_level_groups("middle_high", 0.0, 9) == ["expert"]
        assert ss.pool_level_groups("elementary", -1.0, 5) == ["adult"]

    def test_밴드_표는_단일_소유자에서_파생된다(self):
        """kl→밴드 표를 두 번째로 적으면 드리프트한다 — 소유자는
        `weatherbrain_service.KNOWLEDGE_LEVEL_BANDS` 하나다."""
        for level in range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1):
            assert ss.pool_level_groups("middle_high", 0.0, level) == [
                wb.level_group_of_knowledge_level(level)
            ]
        src = inspect.getsource(ss.pool_level_groups)
        assert "level_group_of_knowledge_level" in src


# ══════════════════════════════════════════════════════════════════════════
# ⑷ daily 경로는 움직이지 않았다
# ══════════════════════════════════════════════════════════════════════════


class TestDailyPathUnmoved:
    def test_같은_게스트의_오늘_세션은_밴드대로다(self):
        """**`create_daily_session`을 실제로 돌린다** — `GET /session/today`가
        표적을 실수로 흘리면 여기가 붉어야 한다. `plan_daily_picks`를 직접
        부르면 그 실수를 **구조적으로 볼 수 없다**(변이 ⓒ 실측으로 확인)."""
        db = _CatalogDB()
        _, entries = asyncio.run(
            ss.create_daily_session(db, user("middle_high"), TODAY)
        )
        levels = levels_of(entries)
        assert len(entries) == RECIPE_TOTAL
        assert set(levels) <= {3, 4}, Counter(levels)

    def test_배합_선택도_밴드대로다(self):
        """발급 정책을 걷어낸 배합 선택 자체 — 위 계약의 상류."""
        _, plan = daily_plan(reported="middle_high", theta=0.0)
        levels = [
            wb.effective_knowledge_level(pick["item"]) for pick in plan.picks
        ]
        assert levels
        assert set(levels) <= {3, 4}, Counter(levels)

    def test_daily_는_전_밴드를_연다(self):
        """θ 경로의 「필터는 열고 정렬로 좁힌다」 계약(2026-08-12)이 그대로다."""
        db, _ = daily_plan(reported="middle_high", theta=0.0)
        assert db.level_groups
        for groups in db.level_groups:
            assert groups == sorted(set(wb.LEVEL_GROUP_BANDS))

    def test_배합_총합은_양쪽_경로에서_같다(self):
        """밴드를 좁혀도 부족분은 `plan_bank_picks`가 new로 메운다 —
        「필터가 굶주림을 만든다」는 이 저장소의 실측이 여기서도 성립해야 한다."""
        _, daily = daily_plan(reported="middle_high", theta=0.0)
        assert len(daily.picks) == RECIPE_TOTAL
        entries = unit_session_levels(
            reported="middle_high", theta=0.0, section=SECTION_LEVEL_1
        )
        assert len(entries) == RECIPE_TOTAL


# ══════════════════════════════════════════════════════════════════════════
# ⑸ 굶주림 — 어느 단계의 유닛에서도 세션이 찬다
# ══════════════════════════════════════════════════════════════════════════


class TestNoStarvationAtAnyLevel:
    @pytest.mark.parametrize("index", range(cs.WEATHER_SECTION_COUNT))
    def test_10섹션_전건이_정원을_채운다(self, index):
        entries = unit_session_levels(
            reported="middle_high",
            theta=0.0,
            section=cs.SECTION_ORDER[index],
            shuffle_seed=index,
        )
        assert len(entries) == RECIPE_TOTAL, (
            f"{cs.SECTION_ORDER[index]}(kl {index + 1}) 유닛이 굶었다"
        )
        band = wb.level_group_of_knowledge_level(index + 1)
        for level in levels_of(entries):
            assert wb.level_group_of_knowledge_level(level) == band

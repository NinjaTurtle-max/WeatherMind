"""knowledge_level이 진도·능력 API로 실제로 나가는지 — R13-02 T3.

배경: 2026-08-10에 지식 단계를 6 → 10칸으로 넓히고 문항 1,000건을 그 축으로
분류했는데, **그 축이 API 응답에 없었다**. 학습자에게는 여전히 4밴드(초급/중급/
고급/최상급)만 보였다. 이 파일은 그 구멍이 다시 열리는 것을 막는다.

여기서 보는 것은 스키마 선언이 아니라 **직렬화 결과**(`model_dump()`)다 —
필드를 선언해 두고 라우터가 안 채우면 스키마 테스트는 초록인데 화면은 비는데,
그게 정확히 이번에 벌어진 일의 축소판이다.

세 계약:
  1. 두 필드가 응답에 실제로 실린다 (`/me` · `/abilities` · `/mastery`)
  2. `knowledge_level_max`가 서버 상수와 같다 — 프론트가 볼 분모의 유일한 출처
  3. **두 축이 공존한다** — 10단계는 4밴드를 대체하지 않고 더 잘게 나눈 뷰다.
     `level_group_of_knowledge_level(knowledge_level)`이 기존 `level_label`과
     같은 밴드를 가리켜야 한다.

⚠️ `/mastery`의 `level_label`은 **BKT 축**(insufficient|beginning|learning|
mastered)이라 4밴드 정합의 상대가 아니다. 그쪽 정합은 같은 사용자의
`/abilities`(θ 축)와 대조한다 — 두 엔드포인트가 같은 개념에 다른 단계를
말하면 안 된다.

단계 수 N을 이 파일에 박지 않는다 — 전부 KNOWLEDGE_LEVEL_BANDS 길이에서 나온다.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import pytest

from app.routers import progress as progress_router
from app.schemas.progress import ConceptAbilityOut, ConceptMasteryOut, ProgressMe
from app.services import weatherbrain_service as wb

BASE = datetime(2026, 8, 11, 9, 0, tzinfo=timezone.utc)

# θ 스윕 — 밴드 경계(−0.5·0.5·1.5)와 단계 경계를 모두 지난다.
THETA_SWEEP = [i / 20.0 for i in range(-60, 61)]


class _FakeUser:
    id = uuid.uuid4()
    level_group = "middle_high"
    tone = None
    xp = 120
    streak_count = 3
    streak_freeze_count = 1
    placement_completed_at = None
    daily_goal_items = None
    region = None


class _AbilityRow:
    """UserConceptAbility 대역 — 라우터가 읽는 속성만 갖는다."""

    def __init__(self, concept_tag: str, theta: float, n: int = 0):
        self.concept_tag = concept_tag
        self.theta = theta
        self.theta_se = 0.5
        self.num_responses = n
        self.updated_at = BASE


class _ScalarsResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _AbilitiesDB:
    """`select(UserConceptAbility)` 한 종류만 받는 대역 (get_abilities용)."""

    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _ScalarsResult(self._rows)


class _TupleResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _LoadAbilitiesDB:
    """load_abilities(튜플 select + .all())만 받는 대역 (get_mastery용)."""

    def __init__(self, rows):
        # load_abilities가 푸는 순서: concept_tag, theta, theta_se, num_responses
        self._rows = [(r.concept_tag, r.theta, r.theta_se, r.num_responses)
                      for r in rows]

    async def execute(self, _stmt):
        return _TupleResult(self._rows)


class _ScalarOneDB:
    """집계 1행만 돌려주는 대역 (get_me용 — count와 대표 θ 둘 다 이 모양)."""

    def __init__(self, value):
        self._value = value

    async def execute(self, _stmt):
        db = self

        class _R:
            def scalar_one(self):
                return db._value

        return _R()


# ═══════════════════════════════════════════════════════════════
# GET /progress/abilities — θ 축의 본진
# ═══════════════════════════════════════════════════════════════
class TestAbilitiesExposesKnowledgeLevel:
    def _call(self, rows):
        return asyncio.run(
            progress_router.get_abilities(user=_FakeUser(), db=_AbilitiesDB(rows))
        )

    def test_직렬화_결과에_두_필드가_있다(self):
        """스키마가 아니라 dump를 본다 — 선언만 하고 안 채우는 실패를 막는다."""
        out = self._call([_AbilityRow("typhoon", 1.7, n=12)])
        dumped = out[0].model_dump()
        assert "knowledge_level" in dumped
        assert "knowledge_level_max" in dumped
        assert dumped["knowledge_level"] is not None

    def test_분모가_서버_상수와_같다(self):
        """프론트가 10을 하드코딩하면 다음 확장에서 조용히 깨진다 — 분모는 서버 것."""
        out = self._call([_AbilityRow("typhoon", 0.0)])
        assert out[0].model_dump()["knowledge_level_max"] == wb.KNOWLEDGE_LEVEL_MAX
        # 상수 자체가 단계 표에서 파생돼야 한다(어디에도 리터럴 N 없음).
        assert wb.KNOWLEDGE_LEVEL_MAX == (
            wb.KNOWLEDGE_LEVEL_MIN + len(wb.KNOWLEDGE_LEVEL_BANDS) - 1
        )

    @pytest.mark.parametrize("theta", THETA_SWEEP)
    def test_범위_안이다(self, theta):
        level = self._call([_AbilityRow("typhoon", theta)])[0].knowledge_level
        assert wb.KNOWLEDGE_LEVEL_MIN <= level <= wb.KNOWLEDGE_LEVEL_MAX

    @pytest.mark.parametrize("theta", THETA_SWEEP)
    def test_4밴드와_정합_같은_응답_안에서(self, theta):
        """**API 표면의** 2축 공존 계약 — 순수 함수 스윕(test_weatherbrain_theta_
        pipeline)이 이미 있지만, 그것이 초록이어도 라우터가 두 필드를 서로 다른
        θ에서 뽑으면 한 응답 안에서 어긋날 수 있다. 여기서는 **같은 항목의**
        두 값을 대조한다.
        """
        item = self._call([_AbilityRow("typhoon", theta)])[0]
        folded = wb.level_group_of_knowledge_level(item.knowledge_level)
        # level_label(THETA_BAND_LABELS)과 밴드(LEVEL_GROUP_BANDS)는 같은 순서의
        # 1:1 대응이므로 색인으로 대조한다.
        assert wb.LEVEL_GROUP_BANDS.index(folded) == wb.THETA_BAND_LABELS.index(
            item.level_label
        ), f"θ={theta}: {item.level_label} vs {folded}"

    def test_기본값은_null이라_남의_생성자를_깨지_않는다(self):
        """placement_service.to_progress_abilities도 이 스키마를 만든다 —
        필수 필드로 만들면 그쪽이 TypeError로 죽는다."""
        bare = ConceptAbilityOut(
            concept_tag="typhoon", theta=0.0, theta_se=0.5,
            num_responses=0, level_label="intermediate",
        )
        assert bare.knowledge_level is None
        assert bare.knowledge_level_max == wb.KNOWLEDGE_LEVEL_MAX


# ═══════════════════════════════════════════════════════════════
# GET /progress/mastery — BKT 축 카드에 난이도 축을 얹는다
# ═══════════════════════════════════════════════════════════════
class TestMasteryExposesKnowledgeLevel:
    def _call(self, monkeypatch, mastery_rows, ability_rows):
        async def fake_load(_db, _user):
            return mastery_rows

        monkeypatch.setattr(
            progress_router.weatherbrain_service, "load_mastery", fake_load
        )
        return asyncio.run(
            progress_router.get_mastery(
                user=_FakeUser(), db=_LoadAbilitiesDB(ability_rows)
            )
        )

    @staticmethod
    def _mastery(tag, p=0.5, n=5, cold=False):
        return {"concept_tag": tag, "p_mastery": p, "p_next_correct": p,
                "n": n, "cold_start": cold, "params_source": "prior"}

    def test_직렬화_결과에_두_필드가_있다(self, monkeypatch):
        out = self._call(
            monkeypatch,
            [self._mastery("typhoon")],
            [_AbilityRow("typhoon", 1.7, n=12)],
        )
        dumped = out[0].model_dump()
        assert dumped["knowledge_level"] == wb.theta_to_knowledge_level(1.7)
        assert dumped["knowledge_level_max"] == wb.KNOWLEDGE_LEVEL_MAX

    def test_θ_행이_없는_개념은_null(self, monkeypatch):
        """숫자를 지어내지 않는다 — null은 "θ를 모른다"이지 "1단계"가 아니다.
        폴백으로 MIN을 채우면 화면이 그 학습자를 초등 1단계로 그린다.
        """
        out = self._call(monkeypatch, [self._mastery("anomaly")], [])
        assert out[0].knowledge_level is None
        assert out[0].knowledge_level_max == wb.KNOWLEDGE_LEVEL_MAX

    def test_숙련_축과_섞이지_않는다(self, monkeypatch):
        """p_mastery가 낮아도 knowledge_level은 θ에서만 온다 — 축 오염 감시.
        (BKT 콜드스타트가 난이도 단계를 끌어내리면 두 축이 하나로 붕괴한다.)
        """
        out = self._call(
            monkeypatch,
            [self._mastery("typhoon", p=0.02, n=1, cold=True)],
            [_AbilityRow("typhoon", 2.4, n=30)],
        )
        assert out[0].level_label == "insufficient"  # BKT 축은 데이터 부족
        assert out[0].knowledge_level == wb.theta_to_knowledge_level(2.4)

    def test_abilities와_같은_개념에_같은_단계를_말한다(self, monkeypatch):
        """두 엔드포인트가 한 사용자에게 다른 단계를 말하면 안 된다."""
        rows = [_AbilityRow("typhoon", 1.7, n=12), _AbilityRow("anomaly", -0.8, n=4)]
        mastery = self._call(
            monkeypatch, [self._mastery(r.concept_tag) for r in rows], rows
        )
        abilities = asyncio.run(
            progress_router.get_abilities(user=_FakeUser(), db=_AbilitiesDB(rows))
        )
        by_tag = {a.concept_tag: a.knowledge_level for a in abilities}
        for item in mastery:
            assert item.knowledge_level == by_tag[item.concept_tag]

    def test_기본값이_있어_생성자가_깨지지_않는다(self):
        bare = ConceptMasteryOut(
            concept_tag="typhoon", p_mastery=0.5, p_next_correct=0.5,
            num_responses=3, cold_start=False, level_label="learning",
            params_source="prior",
        )
        assert bare.knowledge_level is None
        assert bare.knowledge_level_max == wb.KNOWLEDGE_LEVEL_MAX


# ═══════════════════════════════════════════════════════════════
# GET /progress/me — 헤더가 그릴 "N / MAX" 한 칸
# ═══════════════════════════════════════════════════════════════
@pytest.fixture()
def me_deps(monkeypatch):
    async def fake_tier(_db, _user_id):
        return "stratus"

    async def fake_energy(_db, _user):
        return {"clouds": 5, "max": 5, "next_regen_sec": 0, "updated_at": None}

    async def fake_spine(_db, _user):
        return {"units_total": 0, "units_cleared": 0, "crowns_earned": 0,
                "crowns_total": 0, "current_unit": None}

    monkeypatch.setattr(progress_router.league_service, "get_current_tier", fake_tier)
    monkeypatch.setattr(progress_router.energy_service, "get_state", fake_energy)
    monkeypatch.setattr(progress_router.curriculum_service, "get_spine", fake_spine)


class TestMeExposesKnowledgeLevel:
    def _me(self, theta):
        return asyncio.run(
            progress_router.get_me(user=_FakeUser(), db=_ScalarOneDB(theta))
        )

    def test_직렬화_결과에_두_필드가_있다(self, me_deps):
        dumped = self._me(1.7).model_dump()
        assert dumped["knowledge_level"] == wb.theta_to_knowledge_level(1.7)
        assert dumped["knowledge_level_max"] == wb.KNOWLEDGE_LEVEL_MAX

    @pytest.mark.parametrize("theta", THETA_SWEEP)
    def test_범위_안이다(self, me_deps, theta):
        assert (
            wb.KNOWLEDGE_LEVEL_MIN
            <= self._me(theta).knowledge_level
            <= wb.KNOWLEDGE_LEVEL_MAX
        )

    def test_θ가_아예_없으면_null(self, me_deps):
        """콜드스타트 계약 — 신고 학령에서 숫자를 지어내지 않는다.
        (mastery의 level_label이 관측 부족에 insufficient를 주는 것과 같은 원칙.)
        분모는 그래도 내려간다 — 프론트가 "— / MAX"를 그릴 수 있어야 한다.
        """
        me = self._me(None)
        assert me.knowledge_level is None
        assert me.knowledge_level_max == wb.KNOWLEDGE_LEVEL_MAX

    def test_tone과_다른_축이다(self, me_deps):
        """2축 분리 — tone은 말투, knowledge_level은 난이도(docs/specs/12 §5.3).
        같은 응답에 둘 다 있고 서로를 결정하지 않는다.
        """
        me = self._me(2.4)
        assert me.tone in wb.TONES
        assert me.knowledge_level == wb.theta_to_knowledge_level(2.4)

    def test_기본값이_있어_생성자가_깨지지_않는다(self):
        assert ProgressMe.model_fields["knowledge_level"].default is None
        assert (
            ProgressMe.model_fields["knowledge_level_max"].default
            == wb.KNOWLEDGE_LEVEL_MAX
        )


# ═══════════════════════════════════════════════════════════════
# 대표 θ 두 구현(SQL 집계 · overall_theta)의 드리프트 감시
# ═══════════════════════════════════════════════════════════════
class TestOverallKnowledgeLevelMirrorsOverallTheta:
    """`overall_knowledge_level`은 /me를 1행으로 끝내려고 `overall_theta`의
    규칙을 SQL로 한 번 더 쓴다. 의미의 소유자는 overall_theta이므로 같은
    입력에서 같은 단계가 나와야 한다 — 한쪽만 고치는 순간 여기서 운다.
    """

    @pytest.mark.parametrize(
        "abilities",
        [
            [{"concept_tag": "a", "theta": 1.7, "se": 0.4, "n": 12}],
            [
                {"concept_tag": "a", "theta": -1.2, "se": 0.4, "n": 0},
                {"concept_tag": "b", "theta": 0.8, "se": 0.4, "n": 0},
            ],
            [
                {"concept_tag": "a", "theta": -1.2, "se": 0.4, "n": 1},
                {"concept_tag": "b", "theta": 2.2, "se": 0.4, "n": 9},
            ],
        ],
        ids=["단일", "전부_n0_단순평균", "n가중평균"],
    )
    def test_같은_입력에_같은_단계(self, abilities):
        theta = wb.overall_theta(abilities)
        # SQL 집계가 돌려줄 값을 파이썬으로 재현해 같은 파생 함수에 넣는다.
        total_n = sum(a["n"] for a in abilities)
        if total_n > 0:
            aggregated = sum(a["theta"] * a["n"] for a in abilities) / total_n
        else:
            aggregated = sum(a["theta"] for a in abilities) / len(abilities)
        assert aggregated == pytest.approx(theta)
        expected = wb.theta_to_knowledge_level(theta)
        assert asyncio.run(
            wb.overall_knowledge_level(_ScalarOneDB(aggregated), _FakeUser())
        ) == expected

    def test_행이_없으면_None(self):
        """SQL 집계는 0행에서 NULL을 준다 — 그것이 /me의 null로 이어진다."""
        assert (
            asyncio.run(wb.overall_knowledge_level(_ScalarOneDB(None), _FakeUser()))
            is None
        )

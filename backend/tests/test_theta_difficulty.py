"""θ→출제 난이도 연결 (R7-01 S2 §3.2) — 순수 함수·쿼리 구성 테스트. DB 불필요.

"θ가 오르면 더 어려운 문항이 나온다"의 증명 사슬(각 고리를 아래 테스트가 고정):
1. theta_to_level_group이 θ에 단조증가 — quiz-generate 난이도와 풀 그룹 확장이
   θ를 따라 올라간다 (TestThetaToLevelGroup).
2. 사전 b 상수가 elementary(-1) < middle_high(0) < adult(1)로 단조 — |b−θ| 정렬에서
   θ가 높을수록 높은 b(어려운 문항)가 앞으로 온다 (TestDifficultyOrderSemantics).
3. build_pool_query가 실제로 item_params outerjoin + abs(coalesce(b, 사전 CASE) − θ)
   정렬을 구성하고, θ None이면 기존 random 정렬만 남는다 (TestBuildPoolQuery).
4. create_daily_session이 refresh_abilities를 정확히 1회 호출해 decide_route와
   quiz-generate 양쪽에 θ를 공급한다 (TestSessionWiring).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date

import pytest

from app.services import ai_client, session_service, weatherbrain_service as wb
from app.services.session_service import build_pool_query, pool_level_groups


class TestThetaToLevelGroup:
    def test_경계_4분기(self):
        """경계 −0.5·0.5·1.5: 하위 구간 제외·상위 구간 포함 (ai-worker priors와 동일).

        R13 §2.2에서 expert(경계 1.5)가 4번째 밴드로 붙었다 — 기존 두 경계는 불변.
        """
        assert wb.theta_to_level_group(-2.0) == "elementary"
        assert wb.theta_to_level_group(-0.51) == "elementary"
        assert wb.theta_to_level_group(-0.5) == "middle_high"  # 경계는 상위 구간
        assert wb.theta_to_level_group(0.0) == "middle_high"
        assert wb.theta_to_level_group(0.49) == "middle_high"
        assert wb.theta_to_level_group(0.5) == "adult"  # 경계는 상위 구간
        assert wb.theta_to_level_group(1.49) == "adult"
        assert wb.theta_to_level_group(1.5) == "expert"  # 경계는 상위 구간
        assert wb.theta_to_level_group(3.0) == "expert"

    def test_θ에_단조증가(self):
        """θ가 오르면 목표 난이도 그룹도 오른다 — 증명 사슬 1번 고리.

        서열은 LEVEL_GROUP_BANDS 순서(난이도 오름차순)에서 파생한다 — 밴드가
        늘어도 이 고리는 그대로 성립해야 한다.
        """
        rank = {band: i for i, band in enumerate(wb.LEVEL_GROUP_BANDS)}
        thetas = [-2.0, -0.5, 0.0, 0.5, 1.5, 3.0]
        ranks = [rank[wb.theta_to_level_group(t)] for t in thetas]
        assert ranks == sorted(ranks) and ranks[0] < ranks[-1]
        assert ranks[-1] == len(wb.LEVEL_GROUP_BANDS) - 1  # 최상위 밴드 도달


class TestOverallTheta:
    def test_빈_리스트는_None(self):
        assert wb.overall_theta([]) is None

    def test_num_responses_가중_평균(self):
        abilities = [
            {"concept_tag": "typhoon", "theta": 1.0, "se": 0.5, "n": 1},
            {"concept_tag": "air_mass", "theta": -1.0, "se": 0.5, "n": 3},
        ]
        assert wb.overall_theta(abilities) == pytest.approx(-0.5)  # (1−3)/4

    def test_전부_n_0이면_단순_평균(self):
        abilities = [
            {"concept_tag": "typhoon", "theta": 1.0, "se": 1.0, "n": 0},
            {"concept_tag": "air_mass", "theta": 0.0, "se": 1.0, "n": 0},
        ]
        assert wb.overall_theta(abilities) == pytest.approx(0.5)

    def test_target_개념이_있으면_그_θ_우선(self):
        abilities = [
            {"concept_tag": "typhoon", "theta": 1.5, "se": 0.5, "n": 1},
            {"concept_tag": "air_mass", "theta": -1.0, "se": 0.5, "n": 9},
        ]
        assert wb.overall_theta(abilities, "typhoon") == pytest.approx(1.5)

    def test_target_개념이_없으면_가중_평균_폴백(self):
        abilities = [
            {"concept_tag": "typhoon", "theta": 1.0, "se": 0.5, "n": 1},
            {"concept_tag": "air_mass", "theta": -1.0, "se": 0.5, "n": 3},
        ]
        assert wb.overall_theta(abilities, "anomaly") == pytest.approx(-0.5)


class TestPoolLevelGroups:
    def test_콜드스타트_θ_None이면_단일_그룹(self):
        """기존 동작 불변 — 가입 level_group 하나만."""
        assert pool_level_groups("elementary", None) == ["elementary"]

    def test_θ가_있으면_가입_그룹과_θ_그룹의_합집합(self):
        assert pool_level_groups("elementary", 1.0) == ["adult", "elementary"]

    def test_θ_그룹이_가입_그룹과_같으면_단일(self):
        assert pool_level_groups("middle_high", 0.0) == ["middle_high"]


class TestDifficultyOrderSemantics:
    """|b−θ| 정렬 + 사전 b 단조 ⇒ θ가 높을수록 높은 b가 앞 — 증명 사슬 2번 고리."""

    def test_사전_b_상수는_난이도_단조(self):
        """밴드 순서(LEVEL_GROUP_BANDS)와 사전 b의 대소가 일치해야 한다 —
        expert(2.0)까지 포함해 단조여야 |b−θ| 정렬의 의미가 유지된다."""
        b = wb.LEVEL_GROUP_ITEM_B
        values = [b[band] for band in wb.LEVEL_GROUP_BANDS]
        assert values == sorted(values) and len(set(values)) == len(values)
        assert b["elementary"] < b["middle_high"] < b["adult"] < b["expert"]

    @pytest.mark.parametrize(
        ("theta", "expected_first", "expected_last"),
        [(1.0, "adult", "elementary"), (-1.0, "elementary", "expert")],
    )
    def test_거리_정렬은_θ에_가까운_난이도부터(self, theta, expected_first, expected_last):
        """쿼리의 ORDER BY abs(b−θ)와 같은 키로 사전 b들을 정렬해 보인다."""
        ordered = sorted(
            wb.LEVEL_GROUP_ITEM_B, key=lambda lg: abs(wb.LEVEL_GROUP_ITEM_B[lg] - theta)
        )
        assert ordered[0] == expected_first
        assert ordered[-1] == expected_last


class TestBuildPoolQuery:
    """쿼리 구성은 순수(실행 없음) — FakeDB가 outerjoin/ORDER BY를 해석할 필요 없이
    컴파일된 SQL 문자열로 구조를 고정한다 — 증명 사슬 3번 고리."""

    def test_θ가_있으면_outerjoin과_거리_정렬(self):
        sql = str(
            build_pool_query(
                level_groups=["elementary", "adult"], theta=1.0, live=False, limit=10
            )
        ).lower()
        assert "left outer join item_params" in sql
        assert "order by abs(coalesce(item_params.b, case" in sql
        assert "random()" in sql
        assert "content_items.level_group in" in sql

    def test_θ_None이면_기존_random_정렬만(self):
        sql = str(
            build_pool_query(
                level_groups=["elementary"], theta=None, live=False, limit=10
            )
        ).lower()
        assert "item_params" not in sql  # join 없음
        assert "order by random()" in sql
        assert "coalesce" not in sql

    def test_거리_정렬이_random보다_우선(self):
        sql = str(
            build_pool_query(level_groups=["adult"], theta=0.5, live=True, limit=5)
        ).lower()
        order_by = sql.split("order by", 1)[1]
        assert order_by.index("abs(") < order_by.index("random()")

    def test_review_전용_weak_concepts_필터(self):
        sql = str(
            build_pool_query(
                level_groups=["adult"],
                theta=0.5,
                live=False,
                weak_concepts=["typhoon"],
                limit=10,
            )
        ).lower()
        assert "content_items.concept_tag in" in sql


# ═══════════════════════════════════════════════════════════════
# 배관 검증 — FakeDB(쿼리 미해석, 빈 결과만 반환) + monkeypatch
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def __init__(self, rows=None, scalar=0):
        self._rows = rows or []
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class FakeDB:
    """execute를 해석하지 않고 빈 결과만 반환 — 배관(호출 횟수·인자)만 검증."""

    def __init__(self):
        self.added = []

    async def execute(self, stmt):
        return _FakeResult()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


class _FakeUser:
    id = uuid.uuid4()
    level_group = "elementary"


SESSION_WIRING_THETA = 1.0


class TestSessionWiring:
    """refresh_abilities 정확히 1회 + θ가 quiz-generate 난이도로 주입 — 사슬 4번 고리.

    **난이도 운반자가 바뀌었다** (R13 CO-E-4): 종전에는 θ 파생 밴드를 `level_group`
    자리에 실었으나, 스펙 03 §2 규칙 2가 `level_group`을 "난이도가 아니라 표현 톤"으로
    못박아 모델이 θ를 말투로 읽었다. 이제 난이도는 `knowledge_level`이 나르고
    `level_group`은 유저 신고 학령(톤)이다 — 이 클래스가 단정하는 것은 그 두 축이
    **각자 제 자리로** 간다는 것이지, 어느 한쪽이 사라졌다는 것이 아니다.
    """

    @pytest.fixture
    def wired(self, monkeypatch):
        calls = {
            "refresh": 0,
            "generate_level_groups": [],
            "generate_knowledge_levels": [],
            "router": 0,
        }
        abilities = [
            {"concept_tag": "typhoon", "theta": SESSION_WIRING_THETA, "se": 0.4, "n": 4}
        ]

        async def fake_refresh(db, user):
            calls["refresh"] += 1
            return abilities

        async def fake_router(user_id, weak_tags, recent, abs_, level_group=None):
        # level_group은 R13 CO-V-1(U-3 학령 상대 임계) 배선으로 추가된 kwarg다.
        # 기본값이 있어 이 목은 값을 무시해도 되지만, 받지 않으면 TypeError로 죽는다.
            calls["router"] += 1
            return {"route": "general", "target_concept_tag": None}

        async def fake_generate(**kwargs):
            calls["generate_level_groups"].append(kwargs["level_group"])
            # KeyError로 죽는 것이 의도다 — 키가 사라지면 "난이도가 안 간다"이고,
            # .get(...)으로 받으면 그 회귀가 None으로 조용히 통과한다.
            calls["generate_knowledge_levels"].append(kwargs["knowledge_level"])
            return {"question_type": "multiple_choice", "concept_tag": "typhoon"}

        async def fake_weather(*args, **kwargs):  # region 인자 수용 (R11-01 §8 지역화)
            return {"region": "서울", "forecasts": []}

        monkeypatch.setattr(wb, "refresh_abilities", fake_refresh)
        monkeypatch.setattr(ai_client, "router_decide", fake_router)
        monkeypatch.setattr(ai_client, "quiz_generate", fake_generate)
        monkeypatch.setattr(session_service, "get_today_weather", fake_weather)
        return calls

    def test_발급_경로_refresh_1회_θ가_생성_난이도로(self, wired):
        session, entries = asyncio.run(
            session_service.create_daily_session(
                FakeDB(), _FakeUser(), date(2026, 7, 23)
            )
        )
        assert wired["refresh"] == 1  # 이중 refresh 금지 (decide_route와 공유)
        assert wired["router"] == 1
        # 뱅크 0건 → 전량 생성 폴백.
        # 난이도 축: θ에서 파생된 지식 수준이 그대로 간다. 기대값을 상수로 박지
        # 않는다 — θ 경계는 b 재보정(CO-U-13)에서 움직이는 값이고, 상수를 박으면
        # 재보정 때 무관한 이 테스트가 빨개져 진짜 신호를 덮는다.
        expected_kl = wb.theta_to_knowledge_level(SESSION_WIRING_THETA)
        assert wired["generate_knowledge_levels"] == (
            [expected_kl] * session_service.SESSION_SIZE
        )
        # 톤 축: θ가 아니라 **가입 신고 학령**이다(스펙 03 §2 규칙 2 · 스펙 12 §5.1).
        # θ=1.0의 파생 밴드는 elementary가 아니므로, 이 단정이 두 축의 분리를 증명한다.
        assert wb.theta_to_level_group(SESSION_WIRING_THETA) != _FakeUser.level_group
        assert wired["generate_level_groups"] == (
            [_FakeUser.level_group] * session_service.SESSION_SIZE
        )
        assert len(entries) == session_service.SESSION_SIZE

    def test_레거시_decide_route_단독_호출은_내부_refresh(self, wired):
        """abilities 미전달(quiz.py 경로) 하위 호환 — 내부에서 1회 refresh."""
        decision = asyncio.run(session_service.decide_route(FakeDB(), _FakeUser()))
        assert decision["route"] == "general"
        assert wired["refresh"] == 1

    def test_콜드스타트는_가입_그룹으로_생성(self, wired, monkeypatch):
        async def empty_refresh(db, user):
            wired["refresh"] += 1
            return []

        monkeypatch.setattr(wb, "refresh_abilities", empty_refresh)
        _, entries = asyncio.run(
            session_service.create_daily_session(
                FakeDB(), _FakeUser(), date(2026, 7, 23)
            )
        )
        assert wired["generate_level_groups"] == (
            ["elementary"] * session_service.SESSION_SIZE
        )
        # θ가 없으면 난이도를 **지어내지 않는다** — None을 보내면 모델이 스스로
        # 판정해 신고한다(스펙 03 §2 규칙 3). 이 단정이 없으면 나중에 누가 "안전하게"
        # 중간값 3을 채워 넣어도 CI가 초록이고, 그러면 신규 사용자 전원이 중간
        # 난이도를 받는 실패가 조용히 지나간다.
        assert wired["generate_knowledge_levels"] == (
            [None] * session_service.SESSION_SIZE
        )
        assert len(entries) == session_service.SESSION_SIZE

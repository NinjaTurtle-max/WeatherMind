"""07번 게이미피케이션 공식 회귀 테스트 (S9) — docs/specs/07_gamification_spec.md 원전.

수치 공식(level_from_xp · quiz_xp · accuracy_score · update_elo)이 스펙의
숫자 예제와 정확히 일치하는지 고정한다. 순수 함수만 — DB 불필요.

참고: quiz_xp 약점 1.5배는 파이썬 round()(banker's rounding)를 따른다 —
15 * 1.5 = 22.5 → 22. 스펙은 반올림 방식을 규정하지 않으므로 현재 구현값을
회귀 기준으로 고정한다 (변경 시 이 테스트가 알려준다). TEST_PLAN.md 참조.
"""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.league_service import (
    ELO_INITIAL,
    ELO_K,
    accuracy_score,
    update_elo,
)
from app.services.weatherbrain_service import weak_concepts, weak_theta_threshold
from app.services.xp_service import (
    WEAK_ACCURACY_THRESHOLD,
    is_weak_concept,
    level_from_xp,
    next_level_xp,
    quiz_xp,
)


class TestLevelFromXp:
    """레벨 N 필요 누적 XP = 50 * N^2. Lv1: 0~49, Lv2: 50~199, Lv3: 200~449."""

    @pytest.mark.parametrize(
        ("xp", "expected_level"),
        [
            (0, 1),
            (49, 1),    # Lv1 상한
            (50, 2),    # Lv2 진입 경계
            (199, 2),   # Lv2 상한
            (200, 3),   # Lv3 진입 경계
            (449, 3),
            (450, 4),
        ],
    )
    def test_경계값(self, xp, expected_level):
        assert level_from_xp(xp) == expected_level

    def test_next_level_xp_정의(self):
        assert next_level_xp(1) == 50
        assert next_level_xp(2) == 200
        assert next_level_xp(3) == 450

    def test_next_level_xp_도달시_정확히_레벨업(self):
        """next_level_xp(N)에 도달하는 순간 레벨 N+1, 1 모자라면 레벨 N."""
        for level in range(1, 10):
            need = next_level_xp(level)
            assert level_from_xp(need) == level + 1
            assert level_from_xp(need - 1) == level


class TestQuizXp:
    """정답 +10, 오답 +2, 첫 시도 정답 +5, 약점 개념 정답 1.5배."""

    def test_정답_첫시도(self):
        assert quiz_xp(is_correct=True, is_first_try=True, is_weak=False) == 15

    def test_정답_재시도(self):
        assert quiz_xp(is_correct=True, is_first_try=False, is_weak=False) == 10

    def test_오답은_참여_XP_2(self):
        assert quiz_xp(is_correct=False, is_first_try=True, is_weak=False) == 2

    def test_오답은_약점이어도_배율_없음(self):
        """1.5배는 '약점 개념 문제를 맞히면' — 오답에는 적용되지 않는다."""
        assert quiz_xp(is_correct=False, is_first_try=True, is_weak=True) == 2

    def test_약점_정답_재시도_15(self):
        assert quiz_xp(is_correct=True, is_first_try=False, is_weak=True) == 15  # 10*1.5

    def test_약점_정답_첫시도_반올림(self):
        """(10+5)*1.5 = 22.5 → 파이썬 round() 기준 22 (banker's rounding).

        구현이 반올림 방식을 바꾸면(예: 올림 23) 이 테스트가 잡는다.
        """
        assert quiz_xp(is_correct=True, is_first_try=True, is_weak=True) == round(22.5) == 22


class TestWeakConceptJudgment:
    """약점 판정(XP 1.5배 대상 선별)은 θ 파생 단일 공급원 — R8-01 §3.5.

    weatherbrain_service.weak_concepts: num_responses > 0 AND
    θ < weak_theta_threshold(level_group) = 사전 b + ln(0.6/0.4).
    구 accuracy_rate < 60 기준(is_weak_concept)은 deprecated shim.
    """

    @staticmethod
    def _ab(theta, n=4):
        return [{"concept_tag": "typhoon", "theta": theta, "se": 0.3, "n": n}]

    def test_임계_미만은_약점(self):
        thr = weak_theta_threshold("middle_high")  # ≈ 0.405
        assert weak_concepts(self._ab(thr - 0.01), "middle_high") == ["typhoon"]

    def test_임계_정확히는_약점_아님(self):
        thr = weak_theta_threshold("middle_high")
        assert weak_concepts(self._ab(thr), "middle_high") == []

    def test_기록_없으면_약점_아님(self):
        assert weak_concepts([], "middle_high") == []

    def test_응답_0건_사전값뿐이면_약점_아님(self):
        # 한 번도 안 푼 태그는 약점 아님 — placement 사전 θ(n=0)만으로는 미판정
        assert weak_concepts(self._ab(-3.0, n=0), "middle_high") == []

    def test_임계는_학령_상대적(self):
        """같은 θ=0.0이라도 초등(임계 −0.594)은 정상, 성인(임계 1.405)은 약점."""
        assert weak_concepts(self._ab(0.0), "elementary") == []
        assert weak_concepts(self._ab(0.0), "adult") == ["typhoon"]


class TestIsWeakConceptDeprecatedShim:
    """deprecated shim(구 accuracy_rate < 60) 동작 보존 — 신규 소비 금지."""

    @staticmethod
    def _tag(rate, total=10):
        return SimpleNamespace(total_count=total, accuracy_rate=Decimal(str(rate)))

    def test_구_기준_동작_유지(self):
        assert is_weak_concept(self._tag("59.99")) is True
        assert is_weak_concept(self._tag(WEAK_ACCURACY_THRESHOLD)) is False
        assert is_weak_concept(None) is False
        assert is_weak_concept(self._tag(0, total=0)) is False

    def test_docstring이_deprecated를_명시(self):
        assert "Deprecated" in is_weak_concept.__doc__


class TestAccuracyScore:
    """기온 1도당 -10점, 강수확률 1%당 -1점, 두 점수 평균 (0 하한, 소수 2자리)."""

    def test_완전_적중은_100(self):
        assert accuracy_score(
            {"temp_max": 30, "rain_prob": 40}, {"temp_max": 30, "rain_prob": 40}
        ) == 100.0

    def test_수치_예제_기온2도_강수10퍼_오차(self):
        # temp_score = 100 - 2*10 = 80, rain_score = 100 - 10 = 90 → 평균 85.0
        assert accuracy_score(
            {"temp_max": 25, "rain_prob": 60}, {"temp_max": 27, "rain_prob": 50}
        ) == 85.0

    def test_큰_오차는_0으로_클램프(self):
        # 기온 오차 15도 → max(0, -50) = 0, 강수 오차 100 → 0 → 평균 0.0
        assert accuracy_score(
            {"temp_max": 10, "rain_prob": 0}, {"temp_max": 25, "rain_prob": 100}
        ) == 0.0

    def test_오차_방향_무관_절대값(self):
        low = accuracy_score(
            {"temp_max": 23, "rain_prob": 50}, {"temp_max": 25, "rain_prob": 50}
        )
        high = accuracy_score(
            {"temp_max": 27, "rain_prob": 50}, {"temp_max": 25, "rain_prob": 50}
        )
        assert low == high == 90.0

    def test_소수_2자리_반올림(self):
        # temp_score = 100 - 0.33*10 = 96.7, rain 100 → (196.7)/2 = 98.35
        assert accuracy_score(
            {"temp_max": 25.33, "rain_prob": 60}, {"temp_max": 25.0, "rain_prob": 60}
        ) == 98.35


class TestUpdateElo:
    """rating + k*(score - expected), 반올림. 초기 1200, K=32."""

    def test_상수_계약(self):
        assert ELO_INITIAL == 1200
        assert ELO_K == 32

    def test_기대치_상회시_상승(self):
        # 1200 + 32*(0.8-0.5) = 1209.6 → 1210
        assert update_elo(1200, score=0.8, expected=0.5) == 1210

    def test_기대치_하회시_하락(self):
        # 1200 + 32*(0.2-0.5) = 1190.4 → 1190
        assert update_elo(1200, score=0.2, expected=0.5) == 1190

    def test_기대치_일치시_무변동(self):
        assert update_elo(1200, score=0.5, expected=0.5) == 1200

    def test_커스텀_k(self):
        # 1200 + 16*(0.75-0.5) = 1204
        assert update_elo(1200, score=0.75, expected=0.5, k=16) == 1204

    def test_완승_최대_변동은_k(self):
        assert update_elo(1200, score=1.0, expected=0.0) == 1200 + ELO_K

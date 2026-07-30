"""적응형 캐스터 밸런스 계약 — 스프린트 R9-01 §3.2 (R9-S2).

결정적 시드 배치 시뮬레이션(유저 오차 가정 3구간 × 캐스터 티어 5계단 = 15셀)으로
기대 승률 분포를 고정한다. 계약 불변식:
- **단조성**: 티어가 높을수록(noise_scale↓) 유저 기대 승률이 내려간다
- **극단 부재**: 어떤 셀도 승률 <20% 또는 >85%가 아니다

시뮬레이션 모델 — 전부 시드 고정 결정적(재실행 시 동일 수치, 드리프트=코드 변경):
- 기준 예보(base)는 실측과 ±TEMP_NOISE/±RAIN_NOISE만큼 어긋난다(예보 자체 오차,
  모든 티어 공통). 캐스터는 base 위에 얹는 노이즈만 줄일 수 있으므로 최고 티어도
  기준 예보 오차만큼은 틀린다 — 이 가정이 typhoon_eye "무적"(승률<20%)을 막는다.
- 유저는 실측 주변 ±(오차 구간)에서 예측한다(구간이 유저 실력 가정).
- 같은 트라이얼 인덱스는 모든 셀에서 동일한 환경 난수·동일한 AI 원시 난수를 공유
  (공통 난수 — noise_scale이 진폭에만 곱해지는 §3.2 결정성 덕에 가능. 셀 간 비교
  분산이 줄어 N=2000으로도 단조성이 안정적으로 고정된다).
- 승률 = (win + 0.5×draw) / N.

보정 기준표 (N=2000, 2026-07-30 보정 — 회귀 시 참고용 근사치):
              stratus  cumulus  nimbo   cb     typhoon_eye
  정확(±1.2℃/±12%p)   80.1     78.2    75.9   74.1   73.0
  보통(±2.0℃/±20%p)   59.1     55.3    51.3   47.4   45.1
  부정확(±3.0℃/±28%p) 37.8     34.4    31.8   29.1   26.7
"""
import random
from datetime import date

import pytest

from app.services.duel_service import (
    CASTER_NOISE_SCALES,
    RAIN_NOISE,
    TEMP_NOISE,
    ai_caster_prediction,
    settle_scores,
)
from app.services.league_service import TIER_ORDER

DAY = date(2026, 8, 21)
N = 2000

# 유저 오차 가정 3구간 — (온도 ±℃, 강수확률 ±%p). §3.2 "유저 오차 가정 3구간".
USER_ERROR_BINS: dict[str, tuple[float, float]] = {
    "정확": (1.2, 12.0),
    "보통": (2.0, 20.0),
    "부정확": (3.0, 28.0),
}

# 계약 경계 — 극단(<20% 또는 >85%) 부재 (§3.2)
WIN_RATE_FLOOR = 0.20
WIN_RATE_CEIL = 0.85


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def _win_rate(temp_err: float, rain_err: float, noise_scale: float) -> float:
    """유저 오차 구간 × noise_scale 셀 하나의 결정적 기대 승률."""
    score = 0.0
    for i in range(N):
        env = random.Random(f"balance-env:{i}")  # 티어와 무관 — 공통 난수
        base_t = env.uniform(12.0, 32.0)
        base_r = env.uniform(0.0, 100.0)
        actual = {
            "temp_max": base_t + env.uniform(-TEMP_NOISE, TEMP_NOISE),
            "rain_prob": _clamp(base_r + env.uniform(-RAIN_NOISE, RAIN_NOISE)),
        }
        user_pred = {
            "temp_max": actual["temp_max"] + env.uniform(-temp_err, temp_err),
            "rain_prob": _clamp(actual["rain_prob"] + env.uniform(-rain_err, rain_err)),
        }
        ai_pred = ai_caster_prediction(
            base_t, base_r, f"user-{i}", DAY, noise_scale=noise_scale
        )
        _, _, result = settle_scores(user_pred, ai_pred, actual)
        score += 1.0 if result == "win" else (0.5 if result == "draw" else 0.0)
    return score / N


@pytest.fixture(scope="module")
def win_table() -> dict[str, list[tuple[str, float]]]:
    """{유저구간: [(티어, 승률)]} — 티어는 리그 서열(TIER_ORDER) 순."""
    return {
        bin_name: [
            (tier, _win_rate(temp_err, rain_err, CASTER_NOISE_SCALES[tier]))
            for tier in TIER_ORDER
        ]
        for bin_name, (temp_err, rain_err) in USER_ERROR_BINS.items()
    }


class TestCasterBalanceContract:
    def test_전_셀_극단_부재(self, win_table):
        """15셀 모두 20% ≤ 승률 ≤ 85% — 어떤 실력대도 무의미한 대결이 없다."""
        for bin_name, rates in win_table.items():
            for tier, rate in rates:
                assert WIN_RATE_FLOOR <= rate <= WIN_RATE_CEIL, (
                    f"{bin_name}×{tier} 승률 {rate:.1%} — 극단 발생"
                )

    def test_티어_단조성(self, win_table):
        """각 유저 구간에서 티어↑(scale↓) → 승률 비증가, 양끝은 강한 감소."""
        for bin_name, rates in win_table.items():
            values = [rate for _, rate in rates]
            for higher, lower in zip(values, values[1:]):
                assert higher >= lower, f"{bin_name} 단조성 위반: {rates}"
            assert values[0] > values[-1], (
                f"{bin_name} stratus↔typhoon_eye 차이 없음: {rates}"
            )

    def test_유저_실력_단조성(self, win_table):
        """같은 티어에서 유저 오차↑ → 승률↓ — 시뮬 모델 자체의 건전성."""
        for idx, tier in enumerate(TIER_ORDER):
            accurate = win_table["정확"][idx][1]
            medium = win_table["보통"][idx][1]
            poor = win_table["부정확"][idx][1]
            assert accurate > medium > poor, (
                f"{tier}: 정확 {accurate:.1%} / 보통 {medium:.1%} / 부정확 {poor:.1%}"
            )

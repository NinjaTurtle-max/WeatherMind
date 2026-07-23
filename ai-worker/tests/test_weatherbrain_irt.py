"""WeatherBrain IRT 코어 테스트 — 모델이 "진짜"임을 합성 복원으로 증명.

정의: 알려진 θ·b로 응답을 합성하고 추정기가 그 값을 표준오차/허용오차 이내로
복원하면 통과. 이것이 통과하면 이 레이어는 스텁이 아니라 실제로 동작하는 IRT다.
LLM·DB·네트워크 불필요(순수 파이썬). 재현성을 위해 난수 시드를 고정한다.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""

from __future__ import annotations

import random

import pytest

from app.weatherbrain.irt import (
    calibrate_items,
    estimate_ability,
    irf,
)
from app.weatherbrain.placement import initial_abilities
from app.weatherbrain.priors import level_group_prior, theta_to_target_level_group


def _simulate(theta: float, bs: list[float], rng: random.Random) -> list[tuple]:
    """능력 θ인 학습자가 난이도 bs 문항들을 푼 응답을 2PL로 합성한다."""
    return [(b, 1.0, rng.random() < irf(theta, b)) for b in bs]


class TestIRF:
    def test_능력_난이도_같으면_정답확률_절반(self):
        assert irf(0.0, 0.0) == pytest.approx(0.5, abs=1e-6)

    def test_능력이_높을수록_정답확률_증가(self):
        assert irf(2.0, 0.0) > irf(0.0, 0.0) > irf(-2.0, 0.0)

    def test_극단_입력_수치안정(self):
        # 오버플로 없이 [eps, 1-eps]에 갇힌다.
        assert 0.0 < irf(1000.0, -1000.0) < 1.0
        assert 0.0 < irf(-1000.0, 1000.0) < 1.0


class TestEstimateAbility:
    def test_응답없으면_사전값_그대로(self):
        est = estimate_ability([], prior_mean=1.0, prior_sd=0.8)
        assert est.theta == pytest.approx(1.0)
        assert est.se == pytest.approx(0.8)
        assert est.n == 0

    def test_전부정답이면_θ_사전보다_상승(self):
        resp = [(0.0, 1.0, True)] * 8
        est = estimate_ability(resp, prior_mean=0.0, prior_sd=1.0)
        assert est.theta > 0.5

    def test_전부오답이면_θ_사전보다_하락(self):
        resp = [(0.0, 1.0, False)] * 8
        est = estimate_ability(resp, prior_mean=0.0, prior_sd=1.0)
        assert est.theta < -0.5

    def test_응답많을수록_표준오차_감소(self):
        few = estimate_ability(_fixed_mix(4), 0.0, 1.0)
        many = estimate_ability(_fixed_mix(40), 0.0, 1.0)
        assert many.se < few.se

    @pytest.mark.parametrize("true_theta", [-2.0, -1.0, 0.0, 1.0, 2.0])
    def test_θ_복원(self, true_theta: float):
        """알려진 θ를 표준오차의 2배 이내로 복원한다(합성 응답 60문항)."""
        rng = random.Random(20260723 + int(true_theta * 10))
        # 난이도를 θ 주변에 퍼뜨려 정보량 확보.
        bs = [true_theta - 2 + 4 * i / 59 for i in range(60)]
        resp = _simulate(true_theta, bs, rng)
        est = estimate_ability(resp, prior_mean=0.0, prior_sd=2.0)
        assert abs(est.theta - true_theta) < 2 * est.se + 0.15


def _fixed_mix(k: int) -> list[tuple]:
    """정답/오답이 반반 섞인 k개 응답(난이도 0)."""
    return [(0.0, 1.0, i % 2 == 0) for i in range(k)]


class TestCalibrateItems:
    def test_빈응답이면_빈결과(self):
        assert calibrate_items([]) == {}

    def test_문항난이도_순서_복원(self):
        """쉬운/중간/어려운 3문항의 난이도 순서(b)를 복원한다.

        200명의 학습자(θ ~ N(0,1))가 세 문항을 모두 푼 응답을 합성한다.
        추정 b는 센터링돼 절대값은 스케일에 의존하지만, 순서(쉬움<중간<어려움)와
        상대 간격은 보존돼야 한다.
        """
        rng = random.Random(42)
        true_b = {"easy": -1.5, "mid": 0.0, "hard": 1.5}
        responses: list[tuple] = []
        for u in range(200):
            theta = rng.gauss(0.0, 1.0)
            uid = f"u{u}"
            for item_id, b in true_b.items():
                responses.append((uid, item_id, rng.random() < irf(theta, b)))
        est_b = calibrate_items(responses, iterations=25)
        assert est_b["easy"] < est_b["mid"] < est_b["hard"]
        # 상대 간격 복원 — easy↔hard 실제 간격 3.0을 대략(±1.0) 복원.
        assert abs((est_b["hard"] - est_b["easy"]) - 3.0) < 1.0


class TestPlacementAndPriors:
    def test_level_group_사전_순서(self):
        assert level_group_prior("elementary")[0] < level_group_prior("adult")[0]

    def test_미지_level_group_중립사전(self):
        assert level_group_prior("unknown") == (0.0, 1.0)

    def test_배치응답없으면_사전으로_배정(self):
        ab = initial_abilities("elementary", ["pressure", "typhoon"])
        assert set(ab) == {"pressure", "typhoon"}
        assert ab["pressure"]["theta"] == pytest.approx(-1.0)
        assert ab["pressure"]["n"] == 0

    def test_배치고사_정답이면_사전보다_상승(self):
        # 어려운 문항(b=1.0)을 초등 사전(-1.0)의 학습자가 다 맞히면 θ 상승.
        placement = {"typhoon": [(1.0, 1.0, True)] * 5}
        ab = initial_abilities("elementary", ["typhoon"], placement)
        assert ab["typhoon"]["theta"] > -1.0
        assert ab["typhoon"]["n"] == 5

    def test_θ를_목표_level_group으로_역매핑(self):
        assert theta_to_target_level_group(-2.0) == "elementary"
        assert theta_to_target_level_group(0.0) == "middle_high"
        assert theta_to_target_level_group(2.0) == "adult"

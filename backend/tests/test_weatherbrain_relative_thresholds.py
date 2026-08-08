"""θ 임계의 학령 상대성 계약 — R13 CO-U-3.

θ는 절대 스케일이지만 응답이 적을 때는 사전분포로 수축하고, 그 사전평균은 가입 시
**신고한** level_group에서 온다. 그래서 θ에 절대 임계를 걸면 "무엇을 맞혔나"가 아니라
"가입할 때 무엇이라고 적었나"를 재게 되고, 실제로 판정이 의도와 반대로 뒤집혔다.

이 파일이 고정하는 것 넷:
  ① 상대 임계의 값(자기 밴드 경계 = 사전평균 ± 반폭)과 middle_high에서의 현행값 일치
  ② 판정의 학령 균일성 — 같은 (정답수, 응답수)면 네 밴드가 같은 판정
  ③ 사다리 단조성 — focus < weak < unlock
  ④ backend ↔ ai-worker router_chain 임계 드리프트

②·④는 **실제 EAP 추정기를 돌려** 확인한다(수치를 손으로 적으면 추정기가 바뀔 때
계약이 조용히 거짓이 된다 — CO-U-2가 정확히 그 실패였다: 함수 경계에서 참인 성질이
합성에서 거짓이었고 계약 테스트는 θ를 직접 주입해 통과했다).
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

from app.services import weatherbrain_service as wb

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_WORKER_DIR = REPO_ROOT / "ai-worker"


def _import_ai_worker(dotted: str):
    """ai-worker 모듈을 backend `app` 패키지와 충돌 없이 임포트
    (test_weatherbrain_contract._import_ai_worker_priors 관례 답습)."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module(dotted)
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


irt = _import_ai_worker("app.weatherbrain.irt")
priors = _import_ai_worker("app.weatherbrain.priors")
router_chain = _import_ai_worker("app.chains.router_chain")

BANDS = wb.LEVEL_GROUP_BANDS
# 가입 시 **신고 가능한** 학령 — expert는 파생 밴드라 신고 경로가 없다
# (schemas.auth.LevelGroup · placement_service.LEVEL_GROUPS).
DECLARABLE_BANDS = tuple(b for b in BANDS if b != "expert")


def _theta_after(level_group: str, correct: list[bool]) -> float:
    """학령 표준문항(사전 b)만 푼 학습자의 추정 θ — 오늘의 기본 출제 경로.

    풀 필터가 level_group이고 item_params가 비어 있어 밴드 내 b가 상수이므로,
    실제 파이프라인이 만드는 응답이 정확히 이 모양이다(CO-U-3 재현 조건).
    """
    prior_mean, prior_sd = priors.level_group_prior(level_group)
    b = priors.prior_item_b(level_group)
    responses = [(b, 1.0, ok) for ok in correct]
    return irt.estimate_ability(responses, prior_mean, prior_sd).theta


class TestThresholdValues:
    """① 값 — 자기 밴드 경계이고, middle_high에서는 현행 절대값과 같다."""

    def test_반폭은_경계_튜플에서_파생된다(self):
        assert wb.THETA_BAND_HALF_WIDTH == pytest.approx(0.5)
        assert wb.THETA_FOCUS_DELTA == -wb.THETA_BAND_HALF_WIDTH
        assert wb.THETA_UNLOCK_DELTA == wb.THETA_BAND_HALF_WIDTH

    @pytest.mark.parametrize("level_group", BANDS)
    def test_임계는_자기_밴드의_경계다(self, level_group):
        prior_mean = wb.band_prior_theta(level_group)
        assert wb.focus_theta_threshold(level_group) == pytest.approx(prior_mean - 0.5)
        assert wb.unlock_theta_threshold(level_group) == pytest.approx(prior_mean + 0.5)

    def test_middle_high는_현행_절대임계와_동일(self):
        """순수 확장 계약 — 중립 밴드의 판정은 한 건도 바뀌지 않는다."""
        assert wb.focus_theta_threshold("middle_high") == pytest.approx(
            router_chain.THETA_FOCUS_THRESHOLD
        )
        assert wb.unlock_theta_threshold("middle_high") == pytest.approx(
            wb._THETA_INTERMEDIATE_MAX
        )

    def test_미지_학령은_중립으로_폴백(self):
        assert wb.band_prior_theta("nope") == wb.DEFAULT_ITEM_B
        assert wb.focus_theta_threshold("nope") == pytest.approx(-0.5)
        assert wb.unlock_theta_threshold("nope") == pytest.approx(0.5)

    def test_사다리가_단조다(self):
        """③ focus < weak < unlock — "약점 아님"보다 "선해금"이 항상 엄격하다.

        순서가 뒤집히면 약점으로 분류된 개념의 유닛이 선해제되는 모순이 생긴다.
        """
        for level_group in BANDS:
            assert (
                wb.focus_theta_threshold(level_group)
                < wb.weak_theta_threshold(level_group)
                < wb.unlock_theta_threshold(level_group)
            )


class TestVerdictIsUniformAcrossBands:
    """② 학령 균일성 — 실제 EAP를 돌려 확인한다.

    이것이 CO-U-3의 본체다. 절대 임계에서는 아래 단정이 전부 거짓이었다
    (elementary는 1정답에도 focused, adult는 1오답에도 선해금).
    """

    @pytest.mark.parametrize("level_group", BANDS)
    def test_학령표준문항_1정답으로는_선해금되지_않는다(self, level_group):
        theta = _theta_after(level_group, [True])
        assert theta < wb.unlock_theta_threshold(level_group), (
            f"{level_group}: 1문항 근거로 유닛이 열린다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_학령표준문항_2연속정답이면_선해금된다(self, level_group):
        theta = _theta_after(level_group, [True, True])
        assert theta >= wb.unlock_theta_threshold(level_group), (
            f"{level_group}: 2연속 정답인데 선해금이 영영 안 열린다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_반타작은_선해금되지_않는다(self, level_group):
        theta = _theta_after(level_group, [True, False])
        assert theta < wb.unlock_theta_threshold(level_group)

    @pytest.mark.parametrize("level_group", BANDS)
    def test_1오답으로는_focused가_되지_않는다(self, level_group):
        theta = _theta_after(level_group, [False])
        assert theta >= wb.focus_theta_threshold(level_group), (
            f"{level_group}: 1오답에 보강 집중으로 떨어진다 (θ={theta:.4f})"
        )

    @pytest.mark.parametrize("level_group", BANDS)
    def test_2연속오답이면_focused다(self, level_group):
        theta = _theta_after(level_group, [False, False])
        assert theta < wb.focus_theta_threshold(level_group), (
            f"{level_group}: 2연속 오답인데 보강이 안 걸린다 (θ={theta:.4f})"
        )

    def test_신고_가능한_세_학령의_판정이_전건_같다(self):
        """(정답수, 응답수) 격자 20칸 전건에서 세 밴드의 두 판정이 일치해야 한다.

        범위를 **신고 가능한 학령**(placement_service.LEVEL_GROUPS 3종)으로 두는
        이유는 U-3이 "가입할 때 적은 값이 판정을 가른다"는 결함이기 때문이다.
        expert는 신고 경로가 없는 파생 밴드이고, EAP 격자 상한에 눌려 같은 응답의
        이동폭이 작다(U-8) — 그 편차는 아래 테스트가 따로 기록한다.
        """
        grid = [(k, n) for n in range(1, 6) for k in range(0, n + 1)]
        for k, n in grid:
            pattern = [True] * k + [False] * (n - k)
            verdicts = set()
            for level_group in DECLARABLE_BANDS:
                theta = _theta_after(level_group, pattern)
                verdicts.add(
                    (
                        theta < wb.focus_theta_threshold(level_group),
                        theta >= wb.unlock_theta_threshold(level_group),
                    )
                )
            assert len(verdicts) == 1, f"k={k}/n={n}에서 학령별 판정이 갈린다: {verdicts}"

    def test_expert_밴드의_잔여_편차를_기록한다(self):
        """열린 채로 남는 것 — CO-U-8의 재확인이지 이 수리의 범위가 아니다.

        expert 밴드는 EAP 격자 상한(4.0)에 붙어 같은 응답의 θ 이동폭이 작다. 그래서
        임계 바로 옆 칸에서만 세 학령과 갈린다. 20칸 중 **정확히 두 칸**이다:

          k/n = 1/1  약점 판정 — expert만 rel +0.3362 < logit(0.6) +0.40547 → 약점
                     (나머지 셋은 +0.4068~+0.4135. 마진 0.0013~0.0081의 칼날이라
                      격자·사전 sd가 바뀌면 셋도 함께 넘어간다)
          k/n = 3/4  선해금 판정 — expert만 rel +0.4925 < +0.5 → 선해금 안 됨
                     (나머지 셋은 +0.5318~+0.5335)

        weak 임계(logit 0.6)는 R8-01 §3.5 계약이고 격자 범위는 ai-worker irt 소유라
        이 수리에서 건드리지 않았다. 이 테스트는 상태를 **기록으로 고정**한다 —
        U-8을 고치면 여기가 깨져서 알게 된다.
        """
        assert _theta_after("expert", [True]) < wb.weak_theta_threshold("expert")
        for level_group in DECLARABLE_BANDS:
            assert _theta_after(level_group, [True]) >= wb.weak_theta_threshold(
                level_group
            )

        pattern = [True] * 3 + [False]
        assert _theta_after("expert", pattern) < wb.unlock_theta_threshold("expert")
        for level_group in DECLARABLE_BANDS:
            assert _theta_after(level_group, pattern) >= wb.unlock_theta_threshold(
                level_group
            )

    def test_절대임계였다면_판정이_갈렸다(self):
        """반증 대조 — 이 테스트가 깨지면 U-3이 애초에 없었다는 뜻이다.

        고치기 전 실제 동작을 고정한다: 절대 임계 −0.5/+0.5에서는 elementary가
        1정답에도 focused이고 adult는 1오답에도 선해금이었다.
        """
        assert _theta_after("elementary", [True]) < -0.5
        assert _theta_after("adult", [False]) >= 0.5
        assert _theta_after("middle_high", [True]) < 0.5


class TestRouterChainParity:
    """④ backend ↔ ai-worker 드리프트 (상수 이원화 관례)."""

    @pytest.mark.parametrize("level_group", BANDS)
    def test_임계값이_두_서비스에서_같다(self, level_group):
        assert router_chain.focus_theta_threshold(level_group) == pytest.approx(
            wb.focus_theta_threshold(level_group)
        )

    def test_level_group_None이면_종전_절대임계로_폴백(self):
        """하위호환 — 호출측이 학령을 아직 안 넘기는 동안 동작이 변하지 않는다."""
        assert router_chain.focus_theta_threshold(None) == pytest.approx(
            router_chain.THETA_FOCUS_THRESHOLD
        )

    def test_route가_학령을_받으면_판정이_뒤집힌다(self):
        """elementary 학습자가 학령 표준문항을 1개 맞힌 상황."""
        theta = _theta_after("elementary", [True])
        abilities = [{"concept_tag": "typhoon", "theta": theta, "se": 0.9, "n": 1}]

        legacy = router_chain.route([], [], abilities)
        assert legacy["route"] == "focused"  # 절대 임계 — 맞혀도 보강 대상

        fixed = router_chain.route([], [], abilities, level_group="elementary")
        assert fixed["route"] == "general"

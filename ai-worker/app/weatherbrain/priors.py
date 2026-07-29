"""WeatherBrain 사전분포 — level_group을 IRT 스케일로 변환.

신규 유저는 개인 응답 이력이 없다. 회원가입 시 선택한 level_group(초등/중고/성인)을
θ 사전분포와 문항난이도 b 사전값으로 매핑해 "모델 기반 초기 난이도 배정"의 출발점으로
삼는다(03_ai_chains_spec.md §0 콜드스타트). 이후 응답이 쌓이면 EAP가 사전을 데이터로
갱신한다 — 즉 배정값은 고정이 아니라 사전(prior)일 뿐이다.

로짓 스케일 정합: level_group의 θ 사전평균과 그 그룹 대상 문항의 b 사전값을 같은 값으로
두면, 그룹 내에서 기대 정답확률이 0.5 근방에서 시작한다(적정 난이도).
"""

from __future__ import annotations

# level_group → (θ 사전평균, θ 사전표준편차)
LEVEL_GROUP_PRIORS: dict[str, tuple[float, float]] = {
    "elementary": (-1.0, 1.0),
    "middle_high": (0.0, 1.0),
    "adult": (1.0, 1.0),
}

# level_group → 그 그룹 대상 문항의 사전 난이도 b (calibrate 전 콜드스타트 값)
LEVEL_GROUP_ITEM_B: dict[str, float] = {
    "elementary": -1.0,
    "middle_high": 0.0,
    "adult": 1.0,
}

# 미지의 level_group 방어값 — 중립(표준정규).
_DEFAULT_PRIOR: tuple[float, float] = (0.0, 1.0)
_DEFAULT_ITEM_B: float = 0.0


def level_group_prior(level_group: str) -> tuple[float, float]:
    """level_group의 θ 사전분포 (평균, 표준편차)."""
    return LEVEL_GROUP_PRIORS.get(level_group, _DEFAULT_PRIOR)


def prior_item_b(level_group: str) -> float:
    """level_group 대상 문항의 사전 난이도 b (보정 이력이 없을 때)."""
    return LEVEL_GROUP_ITEM_B.get(level_group, _DEFAULT_ITEM_B)


def theta_to_target_level_group(theta: float) -> str:
    """추정 θ를 문제 생성용 목표 난이도(level_group)로 역매핑한다.

    quiz-generate가 학습자 능력에 맞는 난이도로 문항을 생성하도록, θ를 세 구간의
    level_group으로 이산화한다. 경계는 인접 그룹 사전평균의 중점(-0.5, 0.5).
    """
    if theta < -0.5:
        return "elementary"
    if theta < 0.5:
        return "middle_high"
    return "adult"

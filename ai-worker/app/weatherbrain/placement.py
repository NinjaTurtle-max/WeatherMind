"""WeatherBrain 초기 난이도 배정 — 신규 유저 콜드스타트.

"자체 모델을 통한 초기 난이도 배정"의 실체. 두 경로를 하나의 계약으로 처리한다.
  1) 사전(prior)만: level_group만으로 개념별 초기 θ를 배정(추가 UI 불필요).
  2) 배치고사: 온보딩에서 난이도가 퍼진 몇 문항을 풀게 하고, 그 응답을 사전과 결합해
     개인화된 초기 θ를 추정(EAP). 사전보다 정밀한 개인 배정.

두 경우 모두 estimate_ability를 사용하므로 수학은 하나뿐이다(응답 0개면 사전 그대로).
"""

from __future__ import annotations

from app.weatherbrain.irt import estimate_ability
from app.weatherbrain.priors import level_group_prior


def initial_abilities(
    level_group: str,
    concept_tags: list[str],
    placement_responses: dict[str, list[tuple[float, float, bool]]] | None = None,
) -> dict[str, dict[str, float]]:
    """개념별 초기 능력 θ를 배정한다.

    Args:
        level_group: 유저가 가입 시 선택한 수준(사전분포 결정).
        concept_tags: 초기화할 개념 슬러그 목록.
        placement_responses: {concept_tag: [(b, a, correct), ...]} — 배치고사 응답(선택).
                             없거나 특정 개념에 응답이 없으면 그 개념은 사전값으로 배정.

    Returns:
        {concept_tag: {"theta": float, "se": float, "n": int}}.
    """
    mean, sd = level_group_prior(level_group)
    responses = placement_responses or {}
    result: dict[str, dict[str, float]] = {}
    for tag in concept_tags:
        est = estimate_ability(responses.get(tag, []), prior_mean=mean, prior_sd=sd)
        result[tag] = {"theta": est.theta, "se": est.se, "n": est.n}
    return result

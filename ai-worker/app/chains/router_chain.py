"""Router Chain — 03_ai_chains_spec.md 섹션 1.

LLM 호출 없이 순수 로직으로 구현 (비용 절감).

R6 WeatherBrain 통합: 분기 신호의 1순위는 IRT 능력 추정치 θ(abilities)이고,
weak_tags 정답률은 θ가 없을 때(콜드스타트·추정 실패)의 폴백이다. θ는 개념별 실력을
로짓 스케일로 나타내며, 정답률(0~100)보다 희소 데이터에서 견고하고 난이도를 반영한다.

분기 규칙:
1. 신호가 아무것도 없으면(콜드스타트) → "general"
2. 최저 실력 개념이 임계 미만이면 → "focused" + 해당 concept_tag
   - θ 경로: 최저 θ 개념의 θ < focus_theta_threshold(level_group)
   - 폴백:   최저 정답률 개념의 accuracy_rate < ACCURACY_FOCUS_THRESHOLD
3. 최근 3개 연속 정답이면 → "advanced"
4. 그 외 → "general"

recent_results는 시간순(과거 → 최근) bool 리스트로 가정하며, 마지막 3개가 모두 True일
때 "연속 정답"으로 판단한다.
"""

from __future__ import annotations

from typing import Any

from app.weatherbrain.priors import THETA_BAND_BOUNDS, level_group_prior

ACCURACY_FOCUS_THRESHOLD = 60  # DEVELOPMENT_PLAN.md 표준 결정사항 (폴백 경로)
# θ 집중 임계 — 로짓 스케일. 정답률 60%(≈θ 0 대비 다소 낮음)에 대응하는 실력 하한.
# 사전평균 0 기준 -0.5σ 아래를 "보강 필요"로 본다(정답률 임계와 의미론 정합).
#
# ⚠️ R13 CO-U-3: 이 상수의 원 주석이 스스로 **"사전평균 0 기준"**이라 적는다. 그런데
# 사전평균이 0인 학령은 middle_high뿐이다 — elementary는 −1.0, adult는 +1.0,
# expert는 +2.0이다. 절대값 −0.5를 전 학령에 그대로 적용하면 판정이 뒤집힌다:
#   elementary 학습자는 학령 표준문항을 **맞혀도** θ −0.5865 → 항상 focused
#   adult 학습자는 학령 표준문항을 **8연속 틀려야** θ −0.555 → 비로소 focused
# (2026-08-08 실측. CO-U-1 수리 후에도 동일 — 출제가 학령 정합이면 문항 b가 다시
#  유저 사전 b와 같아지기 때문이다.)
#
# 그래서 아래 focus_theta_threshold(level_group)가 정본이고, 이 상수는 그 함수의
# middle_high 값이자 **level_group을 모를 때의 하위호환 폴백**이다. backend
# weatherbrain_service.THETA_FOCUS_DELTA·focus_theta_threshold와 값이 같아야 하고,
# 드리프트는 backend test_weatherbrain_relative_thresholds가 감시한다.
THETA_FOCUS_THRESHOLD = -0.5

# 밴드 반폭 — 인접 사전평균 간격 1.0의 절반. 경계 튜플에서 파생(매직넘버 없음).
_THETA_BAND_HALF_WIDTH = (
    (THETA_BAND_BOUNDS[1] - THETA_BAND_BOUNDS[0]) / 2.0
    if len(THETA_BAND_BOUNDS) >= 2
    else 0.5
)


def focus_theta_threshold(level_group: str | None) -> float:
    """"focused" θ 임계 — 학령 상대. 자기 밴드의 **하단 경계**.

    level_group이 None/미지면 THETA_FOCUS_THRESHOLD(= middle_high 값)로 폴백한다.
    호출측이 학령을 아직 안 넘기는 동안 종전 동작이 그대로 유지된다.
    """
    if level_group is None:
        return THETA_FOCUS_THRESHOLD
    prior_mean, _ = level_group_prior(level_group)
    return prior_mean - _THETA_BAND_HALF_WIDTH


def route(
    weak_tags: list[dict],
    recent_results: list[bool] | None = None,
    abilities: list[dict[str, Any]] | None = None,
    level_group: str | None = None,
) -> dict:
    """Router Chain 분기 결과를 반환한다.

    Args:
        weak_tags: [{"concept_tag": str, "accuracy_rate": float, ...}, ...] (폴백 신호)
        recent_results: quiz_logs 최근 풀이 정오답 (시간순, 과거 → 최근)
        abilities: [{"concept_tag": str, "theta": float, "se": float, "n": int}, ...]
                   WeatherBrain IRT 추정치. 있으면 1순위 분기 신호.
        level_group: 학습자 학령 밴드 — θ 임계의 기준점(R13 CO-U-3). None이면
                   종전 절대 임계(= middle_high 값)로 폴백해 동작이 변하지 않는다.

    Returns:
        {"route": "focused"|"general"|"advanced", "target_concept_tag": str|None}
    """
    recent_results = recent_results or []
    focus_threshold = focus_theta_threshold(level_group)

    # ── 1순위: WeatherBrain θ ────────────────────────────────────────────
    # 실제 응답이 반영된 개념(n>0)만 신호로 쓴다. 사전값 그대로인 개념(n=0)은
    # "약점"이 아니라 "정보 없음"이므로 focused 트리거에서 제외한다.
    scored = [a for a in (abilities or []) if a.get("n", 0) > 0]
    if scored:
        worst = min(scored, key=lambda a: a["theta"])
        if worst["theta"] < focus_threshold:
            return {"route": "focused", "target_concept_tag": worst["concept_tag"]}
        if len(recent_results) >= 3 and all(recent_results[-3:]):
            return {"route": "advanced", "target_concept_tag": None}
        return {"route": "general", "target_concept_tag": None}

    # ── 폴백: weak_tags 정답률 (θ 부재 — 콜드스타트/추정 실패) ────────────
    if not weak_tags:
        return {"route": "general", "target_concept_tag": None}  # 콜드스타트

    worst_tag = min(weak_tags, key=lambda t: t["accuracy_rate"])
    if worst_tag["accuracy_rate"] < ACCURACY_FOCUS_THRESHOLD:
        return {"route": "focused", "target_concept_tag": worst_tag["concept_tag"]}

    if len(recent_results) >= 3 and all(recent_results[-3:]):
        return {"route": "advanced", "target_concept_tag": None}

    return {"route": "general", "target_concept_tag": None}

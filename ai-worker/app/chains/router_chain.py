"""Router Chain — 03_ai_chains_spec.md 섹션 1.

LLM 호출 없이 순수 로직으로 구현 (비용 절감).

R6 WeatherBrain 통합: 분기 신호의 1순위는 IRT 능력 추정치 θ(abilities)이고,
weak_tags 정답률은 θ가 없을 때(콜드스타트·추정 실패)의 폴백이다. θ는 개념별 실력을
로짓 스케일로 나타내며, 정답률(0~100)보다 희소 데이터에서 견고하고 난이도를 반영한다.

분기 규칙:
1. 신호가 아무것도 없으면(콜드스타트) → "general"
2. 최저 실력 개념이 임계 미만이면 → "focused" + 해당 concept_tag
   - θ 경로: 최저 θ 개념의 θ < THETA_FOCUS_THRESHOLD
   - 폴백:   최저 정답률 개념의 accuracy_rate < ACCURACY_FOCUS_THRESHOLD
3. 최근 3개 연속 정답이면 → "advanced"
4. 그 외 → "general"

recent_results는 시간순(과거 → 최근) bool 리스트로 가정하며, 마지막 3개가 모두 True일
때 "연속 정답"으로 판단한다.
"""

from __future__ import annotations

from typing import Any

ACCURACY_FOCUS_THRESHOLD = 60  # DEVELOPMENT_PLAN.md 표준 결정사항 (폴백 경로)
# θ 집중 임계 — 로짓 스케일. 정답률 60%(≈θ 0 대비 다소 낮음)에 대응하는 실력 하한.
# 사전평균 0 기준 -0.5σ 아래를 "보강 필요"로 본다(정답률 임계와 의미론 정합).
THETA_FOCUS_THRESHOLD = -0.5


def route(
    weak_tags: list[dict],
    recent_results: list[bool] | None = None,
    abilities: list[dict[str, Any]] | None = None,
) -> dict:
    """Router Chain 분기 결과를 반환한다.

    Args:
        weak_tags: [{"concept_tag": str, "accuracy_rate": float, ...}, ...] (폴백 신호)
        recent_results: quiz_logs 최근 풀이 정오답 (시간순, 과거 → 최근)
        abilities: [{"concept_tag": str, "theta": float, "se": float, "n": int}, ...]
                   WeatherBrain IRT 추정치. 있으면 1순위 분기 신호.

    Returns:
        {"route": "focused"|"general"|"advanced", "target_concept_tag": str|None}
    """
    recent_results = recent_results or []

    # ── 1순위: WeatherBrain θ ────────────────────────────────────────────
    # 실제 응답이 반영된 개념(n>0)만 신호로 쓴다. 사전값 그대로인 개념(n=0)은
    # "약점"이 아니라 "정보 없음"이므로 focused 트리거에서 제외한다.
    scored = [a for a in (abilities or []) if a.get("n", 0) > 0]
    if scored:
        worst = min(scored, key=lambda a: a["theta"])
        if worst["theta"] < THETA_FOCUS_THRESHOLD:
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

"""Router Chain — 03_ai_chains_spec.md 섹션 1.

LLM 호출 없이 순수 로직으로 구현 (비용 절감).

분기 규칙:
1. weak_tags가 비어 있으면(콜드스타트) → "general"
2. accuracy_rate 최저 태그가 60 미만이면 → "focused" + 해당 concept_tag
3. quiz_logs 최근 3개가 연속 정답이면 → "advanced"
4. 그 외 → "general"

recent_results는 시간순(과거 → 최근) bool 리스트로 가정하며,
마지막 3개가 모두 True일 때 "연속 정답"으로 판단한다.
"""

from __future__ import annotations

ACCURACY_FOCUS_THRESHOLD = 60  # DEVELOPMENT_PLAN.md 표준 결정사항


def route(weak_tags: list[dict], recent_results: list[bool] | None = None) -> dict:
    """Router Chain 분기 결과를 반환한다.

    Args:
        weak_tags: [{"concept_tag": str, "accuracy_rate": float, ...}, ...]
        recent_results: quiz_logs 최근 풀이 정오답 (시간순, 과거 → 최근)

    Returns:
        {"route": "focused"|"general"|"advanced", "target_concept_tag": str|None}
    """
    recent_results = recent_results or []

    if not weak_tags:
        return {"route": "general", "target_concept_tag": None}  # 콜드스타트

    worst = min(weak_tags, key=lambda t: t["accuracy_rate"])
    if worst["accuracy_rate"] < ACCURACY_FOCUS_THRESHOLD:
        return {"route": "focused", "target_concept_tag": worst["concept_tag"]}

    if len(recent_results) >= 3 and all(recent_results[-3:]):
        return {"route": "advanced", "target_concept_tag": None}

    return {"route": "general", "target_concept_tag": None}

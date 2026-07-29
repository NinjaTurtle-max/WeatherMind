"""ai-worker 내부 API 비동기 클라이언트.

계약: DEVELOPMENT_PLAN.md 2.1 (backend → ai-worker, 포트 8001)
  POST /internal/router-decide  {user_id, weak_tags, recent_results} → {route, target_concept_tag}
  POST /internal/rag-feedback   {question_text, user_answer, is_correct, concept_tag, today_weather} → {feedback}
  POST /internal/quiz-generate  {weather_data, level_group, route, target_concept_tag} → QuizQuestion JSON

인증: X-Internal-API-Key 헤더 (AI_WORKER_INTERNAL_API_KEY).
"""
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class AIWorkerError(Exception):
    """ai-worker 호출 실패 (호출부에서 fallback 처리)."""


# rag-feedback 타임아웃 (R7-02 §3.7) — 기존 60s(_post 기본값)가 문항별 answer
# 경로의 채점 지연 원인이었다. 다른 내부 호출(15s)과 정합하는 10s로 제한하고,
# 초과 시 rag_feedback의 정적 문구 fallback이 그대로 동작한다(UX 무손실).
# 계약 테스트(test_placement_bulk)가 드리프트를 감시한다.
RAG_FEEDBACK_TIMEOUT = 10.0


async def _post(path: str, payload: dict, timeout: float = 60.0) -> dict:
    url = f"{settings.AI_WORKER_INTERNAL_URL}{path}"
    headers = {"X-Internal-API-Key": settings.AI_WORKER_INTERNAL_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("ai-worker %s 호출 실패: %s", path, exc)
        raise AIWorkerError(f"ai-worker {path} failed: {exc}") from exc


async def router_decide(
    user_id: str,
    weak_tags: list[dict[str, Any]],
    recent_results: list[bool],
    abilities: list[dict[str, Any]] | None = None,
) -> dict:
    """Router Chain 분기. 반환: {route, target_concept_tag}.

    recent_results는 시간순(과거 → 최근) bool 리스트.
    abilities는 WeatherBrain IRT θ 추정치 — 있으면 θ가 1순위 분기 신호(폴백: weak_tags).
    실패 시 general로 fallback (콜드스타트와 동일 동작 — 서비스는 항상 진행).
    """
    try:
        return await _post(
            "/internal/router-decide",
            {
                "user_id": user_id,
                "weak_tags": weak_tags,
                "recent_results": recent_results,
                "abilities": abilities or [],
            },
            timeout=15.0,
        )
    except AIWorkerError:
        return {"route": "general", "target_concept_tag": None}


async def weatherbrain_estimate(
    level_group: str, concepts: list[dict[str, Any]]
) -> dict:
    """WeatherBrain IRT 개념별 θ 추정. 반환: {abilities: [{concept_tag, theta, se, n}]}.

    concepts: [{concept_tag, responses: [{b|null, a, correct}]}]. 실패 시 AIWorkerError
    전파(호출측 refresh_abilities가 저장된 θ로 폴백).
    """
    return await _post(
        "/internal/weatherbrain/estimate",
        {"level_group": level_group, "concepts": concepts},
        timeout=15.0,
    )


async def weatherbrain_placement(
    level_group: str,
    concept_tags: list[str],
    placement_responses: dict | None = None,
) -> dict:
    """WeatherBrain 초기 난이도 배정. 반환: {abilities: [...]}.

    placement_responses가 None이면 사전(prior)만으로 배정(가입 시 시드 경로),
    None이 아니면 배치고사 응답({concept_tag: [{b|null, a, correct}]})을 사전과
    결합해 개인화 배정한다(R7-01 §3.3 — ai-worker PlacementRequest가 이미 수신).
    """
    payload: dict = {"level_group": level_group, "concept_tags": concept_tags}
    if placement_responses is not None:
        payload["placement_responses"] = placement_responses
    return await _post(
        "/internal/weatherbrain/placement",
        payload,
        timeout=15.0,
    )


async def rag_feedback(
    question_text: str,
    user_answer: str | None,
    is_correct: bool,
    concept_tag: str,
    today_weather: dict,
) -> str:
    """RAG Chain 피드백 생성. 실패 시 정적 문구 fallback."""
    try:
        result = await _post(
            "/internal/rag-feedback",
            {
                "question_text": question_text,
                "user_answer": user_answer,
                "is_correct": is_correct,
                "concept_tag": concept_tag,
                "today_weather": today_weather,
            },
            timeout=RAG_FEEDBACK_TIMEOUT,
        )
        return result.get("feedback", "")
    except AIWorkerError:
        if is_correct:
            return "정답이에요! 오늘 배운 개념을 실제 날씨에서도 찾아보세요."
        return "아쉽지만 괜찮아요. 해설을 다시 읽어보고 내일 비슷한 문제로 다시 도전해봐요!"


async def quiz_generate(
    weather_data: dict,
    level_group: str,
    route: str = "general",
    target_concept_tag: str | None = None,
) -> dict:
    """Quiz Gen Chain 문제 생성. 반환: QuizQuestion JSON (03번 스키마).

    {concept_tag, question_type, question_text, options?, correct_answer}
    실패 시 AIWorkerError 전파 (호출부에서 503 처리).
    """
    return await _post(
        "/internal/quiz-generate",
        {
            "weather_data": weather_data,
            "level_group": level_group,
            "route": route,
            "target_concept_tag": target_concept_tag,
        },
    )

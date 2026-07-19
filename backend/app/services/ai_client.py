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
) -> dict:
    """Router Chain 분기. 반환: {route, target_concept_tag}.

    recent_results는 시간순(과거 → 최근) bool 리스트.
    실패 시 general로 fallback (콜드스타트와 동일 동작 — 서비스는 항상 진행).
    """
    try:
        return await _post(
            "/internal/router-decide",
            {
                "user_id": user_id,
                "weak_tags": weak_tags,
                "recent_results": recent_results,
            },
            timeout=15.0,
        )
    except AIWorkerError:
        return {"route": "general", "target_concept_tag": None}


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

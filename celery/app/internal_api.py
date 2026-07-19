"""ai-worker 내부 API 호출 (httpx 동기 + X-Internal-API-Key 헤더).

계약: DEVELOPMENT_PLAN.md 2.1 (POST /internal/quiz-generate 등, 포트 8001)
"""
import httpx

from app import config


def ai_worker_post(path: str, payload: dict, timeout: float = 60.0) -> dict:
    """ai-worker 내부 엔드포인트 POST. 실패 시 httpx 예외 전파."""
    url = f"{config.AI_WORKER_INTERNAL_URL}{path}"
    headers = {"X-Internal-API-Key": config.AI_WORKER_INTERNAL_API_KEY}
    resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()

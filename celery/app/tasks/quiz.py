"""(b) 매일 새벽 2시 30분 — 일일 퀴즈 생성.

레벨그룹 3종(elementary / middle_high / adult) 각각에 대해
ai-worker POST /internal/quiz-generate 를 호출하고,
결과 QuizQuestion JSON을 Redis quiz:{date}:{level_group}에 24h 캐시한다.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from celery import shared_task

from app import config
from app.internal_api import ai_worker_post
from app.redis_client import get_redis, quiz_key, weather_key

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))


def _today_weather(r, today: str) -> dict:
    """기준 지역(서울)의 당일 날씨 캐시. 없으면 빈 dict(ai-worker가 일반 문제 생성)."""
    raw = r.get(weather_key(today, config.DEFAULT_REGION))
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[quiz] weather 캐시 JSON 파싱 실패 — 빈 데이터로 진행")
    else:
        logger.warning("[quiz] weather:%s:%s 캐시 없음 — 빈 데이터로 진행",
                       today, config.DEFAULT_REGION)
    return {}


@shared_task(name="app.tasks.quiz.generate_daily_quiz", bind=True, max_retries=2)
def generate_daily_quiz(self):
    today = datetime.now(KST).strftime("%Y%m%d")
    r = get_redis()
    weather_data = _today_weather(r, today)

    generated: list[str] = []
    for level_group in config.LEVEL_GROUPS:
        try:
            question = ai_worker_post("/internal/quiz-generate", {
                "weather_data": weather_data,
                "level_group": level_group,
                "route": "general",           # 일일 공통 문제 (개인화 route는 backend가 실시간 처리)
                "target_concept_tag": None,
            })
            r.setex(
                quiz_key(today, level_group),
                config.QUIZ_CACHE_TTL_SEC,
                json.dumps(question, ensure_ascii=False),
            )
            generated.append(level_group)
            logger.info("[quiz] %s 일일 퀴즈 캐시 완료 (quiz:%s:%s)", level_group, today, level_group)
        except Exception as exc:
            logger.error("[quiz] %s 퀴즈 생성 실패: %s", level_group, exc)

    if not generated:
        # 전부 실패 시 재시도 (5분 간격)
        raise self.retry(countdown=300)

    return {"date": today, "generated": generated}

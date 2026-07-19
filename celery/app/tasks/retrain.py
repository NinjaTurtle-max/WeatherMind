"""(d) 매일 새벽 3시 — WeatherBrain 재학습 트리거 (placeholder).

로드맵 2단계(IRT 기반 WeatherBrain) 항목. 현재 MVP에서는 로그만 남긴다.
콜드스타트 대응은 weak_tags 정답률 기반 Router Chain으로 동작 중.
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="app.tasks.retrain.retrain_weatherbrain")
def retrain_weatherbrain():
    logger.info(
        "[retrain] WeatherBrain 재학습 트리거 (placeholder — 로드맵 2단계에서 구현 예정)"
    )
    return {"status": "skipped", "reason": "roadmap-phase-2 placeholder"}

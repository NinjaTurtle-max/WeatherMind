"""(a) 매일 새벽 2시 — 날씨 수집 + Chroma weather_daily 갱신 트리거.

1. KMA 단기예보를 지역별로 수집해 Redis weather:{date}:{region}에 캐시(1h TTL).
2. 수집 결과를 ai-worker에 전달해 Chroma weather_daily 컬렉션 갱신을 트리거.
   (임베딩 생성은 ai-worker 소유 — Celery는 트리거만 담당)
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from celery import shared_task

from app import config
from app.internal_api import ai_worker_post
from app.kma_client import KMA_GRID, KMAApiError, get_short_forecast
from app.redis_client import get_redis, weather_key

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))


def _base_datetime() -> tuple[str, str]:
    """새벽 2시 실행 시점 기준 가장 안전한 발표시각 = 전날 23:00."""
    yesterday = datetime.now(KST) - timedelta(days=1)
    return yesterday.strftime("%Y%m%d"), "2300"


@shared_task(name="app.tasks.weather.collect_daily_weather", bind=True, max_retries=2)
def collect_daily_weather(self):
    today = datetime.now(KST).strftime("%Y%m%d")
    base_date, base_time = _base_datetime()
    r = get_redis()

    collected: dict[str, dict] = {}
    for region in KMA_GRID:
        try:
            forecast = get_short_forecast(region, base_date, base_time)
            if not forecast["forecasts"]:
                logger.warning("[weather] %s NODATA — 이전 캐시 유지", region)
                continue
            r.setex(
                weather_key(today, region),
                config.WEATHER_CACHE_TTL_SEC,
                json.dumps(forecast, ensure_ascii=False),
            )
            collected[region] = forecast
        except KMAApiError as exc:
            logger.error("[weather] %s 수집 실패: %s", region, exc)

    logger.info("[weather] %d/%d개 지역 수집 완료 (%s)", len(collected), len(KMA_GRID), today)

    # Chroma weather_daily 갱신 트리거 (ai-worker가 임베딩·업서트 수행)
    if collected:
        try:
            ai_worker_post(
                "/internal/embed-weather",
                {"date": today, "weather_by_region": collected},
                timeout=120.0,
            )
            logger.info("[weather] Chroma weather_daily 갱신 트리거 완료")
        except Exception as exc:  # 트리거 실패가 수집 자체를 무효화하진 않음
            logger.error("[weather] Chroma 갱신 트리거 실패 (수집 캐시는 유효): %s", exc)

    return {"date": today, "regions_collected": sorted(collected)}

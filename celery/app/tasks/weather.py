"""(a) 매일 새벽 2시 — KMA 단기예보 수집.

KMA 단기예보를 지역별로 수집해 Redis weather:{date}:{region}에 캐시(1h TTL).

## 왜 ai-worker 트리거가 사라졌는가 (R13 3일차, 2026-08-07)

여기엔 수집 직후 `POST /internal/embed-weather`로 Chroma `weather_daily` 컬렉션
갱신을 트리거하는 블록이 있었다. 셋 다 문제였다:

1. **그 엔드포인트는 ai-worker에 존재한 적이 없다.** `main.py`가 선언한 내부 API에
   `embed-weather`는 없다 — 이 호출은 매일 404를 받고 except로 삼켜졌다.
2. **같은 정보가 이미 다른 경로로 들어간다.** 오늘 날씨는 피드백 프롬프트에
   `today_weather_json`으로 직접 주입된다. 벡터로 한 번 더 넣을 이유가 없었다.
3. **소비처가 사라졌다.** 피드백 체인이 벡터 검색을 쓰지 않는다(docs/specs/03 §3).

수집·캐시(이 태스크의 본체)는 그대로다 — 브리핑·리그 정산이 Redis 캐시를 읽는다.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from celery import shared_task

from app import config
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

    return {"date": today, "regions_collected": sorted(collected)}

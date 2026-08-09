"""WeatherMind Celery 애플리케이션 + Beat 스케줄.

- 브로커/결과 백엔드: Redis (REDIS_URL)
- 스케줄 (Asia/Seoul 기준):
  (a) 매일 02:00  KMA 날씨 수집 → Redis 캐시
  (c) 매주 월 03:30  지난주 리그 정산 (KMA 실측 반영 → accuracy_score·ELO)
  (d) 매일 03:00  WeatherBrain 재학습 트리거 (로드맵 2단계 placeholder)
"""
from celery import Celery
from celery.schedules import crontab

from app import config

celery_app = Celery(
    "weathermind",
    broker=config.REDIS_URL,
    backend=config.REDIS_URL,
    include=[
        "app.tasks.weather",
        "app.tasks.league",
        "app.tasks.retrain",
    ],
)

celery_app.conf.update(
    timezone="Asia/Seoul",
    enable_utc=False,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    result_expires=60 * 60 * 24,
)

celery_app.conf.beat_schedule = {
    # (a) 매일 새벽 2시 — 기상청 날씨 수집 → Redis 캐시(브리핑·리그 정산이 읽는다)
    "collect-daily-weather": {
        "task": "app.tasks.weather.collect_daily_weather",
        "schedule": crontab(hour=2, minute=0),
    },
    # (c) 매주 월요일 — 지난주 리그 정산 (실측 반영 → accuracy_score·ELO 갱신)
    "settle-weekly-league": {
        "task": "app.tasks.league.settle_weekly_league",
        "schedule": crontab(hour=3, minute=30, day_of_week=1),  # 월요일
    },
    # (d) 매일 새벽 3시 — WeatherBrain 재학습 트리거 (placeholder, 로드맵 2단계)
    "retrain-weatherbrain": {
        "task": "app.tasks.retrain.retrain_weatherbrain",
        "schedule": crontab(hour=3, minute=0),
    },
    # (e) 매일 새벽 4시 — 어제 예보 대결 정산 (R4-01 §3.4, 실측 반영 → 승패·XP)
    "settle-daily-duel": {
        "task": "app.tasks.league.settle_daily_duel",
        "schedule": crontab(hour=4, minute=0),
    },
}

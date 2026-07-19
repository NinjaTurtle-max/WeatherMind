"""Redis 동기 클라이언트 (캐시 키 규칙: docs/specs/01_database_schema.md)."""
import redis

from app import config

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
    return _client


def weather_key(date_str: str, region: str) -> str:
    return f"weather:{date_str}:{region}"


def quiz_key(date_str: str, level_group: str) -> str:
    return f"quiz:{date_str}:{level_group}"

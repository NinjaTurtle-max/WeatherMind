"""애플리케이션 설정 — 05번 스펙(.env.example)의 변수명 그대로 사용한다."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── PostgreSQL ──
    DATABASE_URL: str = "postgresql+asyncpg://weathermind:changeme@postgres:5432/weathermind"

    # ── Redis ──
    REDIS_URL: str = "redis://redis:6379/0"

    # ── JWT ──
    JWT_SECRET_KEY: str = "changeme-use-openssl-rand-hex-32"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_EXPIRE_DAYS: int = 7

    # ── 기상청 API ──
    KMA_API_KEY: str = ""
    KMA_VILAGE_FCST_URL: str = (
        "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
    )
    KMA_MID_LAND_FCST_URL: str = (
        "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst"
    )
    KMA_ASOS_DALY_URL: str = (
        "https://apis.data.go.kr/1360000/AsosDalyInfoService/getAsosDalyInfoList"
    )

    # ── 내부 서비스 간 통신 ──
    AI_WORKER_INTERNAL_URL: str = "http://ai-worker:8001"
    AI_WORKER_INTERNAL_API_KEY: str = "changeme-internal-secret"

    # ── 구름 에너지 (R5-01 §3.3·§3.4) ──
    # false면 무제한(소모 없음) — 기존 동작, 데모·테스트 유연성. 레이트리밋과 별개 층.
    ENERGY_ENABLED: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

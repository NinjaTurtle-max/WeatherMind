"""애플리케이션 설정 — 05번 스펙(.env.example)의 변수명 그대로 사용한다."""
from functools import lru_cache

from pydantic import field_validator
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

    # ── 밸런스 튜닝 외부화 (R5.5) ─────────────────────────────────────────
    # 아래 기본값은 계약 수치(§3.2 배합·§3.3 에너지)와 동일 — 재배포 없이 env로만
    # 조정하기 위한 통로다. 기본값을 바꾸면 스펙 드리프트이므로 계약 테스트가 감시한다
    # (test_r3_r5_contract.TestCloudEnergyConstants / test_session_mix).

    # 세션 배합(§3.2): kind→개수. env는 JSON 문자열(예: '{"new":3,"review":2,"live":1}').
    # SESSION_SIZE(총 문항 수)는 이 합에서 파생 — 둘을 독립 구성하지 않는다(드리프트 방지).
    SESSION_RECIPE: dict[str, int] = {"new": 2, "review": 2, "live": 1}
    UNIT_SESSION_SIZE: int = 5           # 커리큘럼 유닛 세션 문항 수

    # 구름 에너지 경제(§3.3): 기본값 = 계약 수치(만렙 5·20분당 1 회복·시도당 1 소모).
    CLOUD_MAX: int = 5
    CLOUD_REGEN_MINUTES: int = 20
    CLOUD_COST: int = 1

    @field_validator("SESSION_RECIPE")
    @classmethod
    def _validate_recipe(cls, value: dict[str, int]) -> dict[str, int]:
        allowed = {"new", "review", "live"}
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"SESSION_RECIPE 알 수 없는 kind: {sorted(unknown)}")
        if any(n < 0 for n in value.values()):
            raise ValueError("SESSION_RECIPE 개수는 음수일 수 없습니다")
        if sum(value.values()) < 1:
            raise ValueError("SESSION_RECIPE 총합은 1 이상이어야 합니다")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

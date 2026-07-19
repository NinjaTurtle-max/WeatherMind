"""환경변수 설정 (docs/specs/05_env_deploy_spec.md의 .env 키와 1:1 대응)."""
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://weathermind:changeme@postgres:5432/weathermind",
)

# ── 기상청 API ──
KMA_API_KEY = os.getenv("KMA_API_KEY", "")
KMA_VILAGE_FCST_URL = os.getenv(
    "KMA_VILAGE_FCST_URL",
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst",
)
KMA_MID_LAND_FCST_URL = os.getenv(
    "KMA_MID_LAND_FCST_URL",
    "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst",
)
KMA_ASOS_DALY_URL = os.getenv(
    "KMA_ASOS_DALY_URL",
    "https://apis.data.go.kr/1360000/AsosDalyInfoService/getAsosDalyInfoList",
)

# ── 내부 서비스 간 통신 ──
AI_WORKER_INTERNAL_URL = os.getenv("AI_WORKER_INTERNAL_URL", "http://ai-worker:8001")
AI_WORKER_INTERNAL_API_KEY = os.getenv("AI_WORKER_INTERNAL_API_KEY", "")

# ── Redis 키 TTL (docs/specs/01_database_schema.md Redis 키 네이밍 규칙) ──
WEATHER_CACHE_TTL_SEC = 60 * 60          # weather:{date}:{region} — 1시간
QUIZ_CACHE_TTL_SEC = 24 * 60 * 60       # quiz:{date}:{level_group} — 24시간

# 일일 퀴즈 대상 레벨 그룹 3종 (01번 스펙 users.level_group CHECK)
LEVEL_GROUPS = ("elementary", "middle_high", "adult")

# 퀴즈/리그 기준 지역 (MVP 기본값)
DEFAULT_REGION = "서울"

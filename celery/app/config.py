"""환경변수 설정 (docs/specs/05_env_deploy_spec.md의 .env 키와 1:1 대응)."""
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://weathermind:changeme@postgres:5432/weathermind",
)

# ── 배치 전용 접속 채널 (R13 4일차 — CO-Q-1 / CO-J-2 합동 판정) ──────────────
# 왜 별도 변수인가:
#   `DATABASE_URL`은 **backend 런타임의 변수**이고, 그 변수는 RLS가 실제로
#   강제되도록 **비특권 앱 롤(weathermind_app, NOBYPASSRLS)** 이어야 한다(CO-J-2).
#   그런데 celery 배치는 정의상 **전 유저 횡단 집계**다 — quiz_logs 전건으로 IRT를
#   재보정하고, duels 전건을 정산하고, league_results를 전원 갱신한다. 앱 롤로
#   붙으면 `app.current_user_id` GUC가 없어 user_isolation이 전부 참이 되지 않고
#   **0행**이 된다(라이브 실측: app 롤 quiz_logs 0 / duels 0 / user_badges 0 ↔
#   소유자 롤 quiz_logs 119).
#
#   변수가 하나뿐인 동안은 **두 요구를 동시에 만족시키는 값이 존재하지 않았다** —
#   J-2를 고치면 Q-1이 발현하고, Q-1을 피하면 J-2가 남는다. `database/init.sql:24`가
#   *"celery 배치는 소유자 롤 유지"*라고 답을 적어 뒀지만 **그렇게 만들 수단이 코드에
#   없었다.** 이 변수가 그 수단이다.
#
# 해석 순서 (앞이 우선):
#   1. CELERY_DATABASE_URL    — 배치 전용 명시 지정
#   2. MIGRATION_DATABASE_URL — alembic이 이미 쓰는 소유자 롤 채널. 롤 분리를
#      제대로 한 배포는 이 값이 반드시 있으므로 **배치가 자동으로 올바른 롤을 탄다**.
#      J-2를 고치는 것만으로 Q-1이 함께 닫히는 이유가 이 한 줄이다.
#   3. DATABASE_URL           — 롤을 아직 안 가른 배포(=오늘의 dev)의 종전 동작.
#      셋 다 미설정 시 동작이 **한 글자도 바뀌지 않는다**(완전 하위 호환).
#
# 이 채널은 소유자/BYPASSRLS 롤이어야 한다. 아니면 조용히 0행이 되는 대신
# `app.db`의 접속 단정이 예외를 던진다 — Q-1의 본질은 "틀렸는데 성공 로그를
# 남긴다"였고, 그 조용함을 없애는 것이 수정의 절반이다.
def _resolve_batch_dsn() -> tuple[str, str]:
    """(URL, 그 URL을 준 환경변수 이름) — 이름은 로그·오류 메시지 전용."""
    for name in ("CELERY_DATABASE_URL", "MIGRATION_DATABASE_URL"):
        value = os.getenv(name)
        if value:
            return value, name
    return DATABASE_URL, "DATABASE_URL"


CELERY_DATABASE_URL, CELERY_DATABASE_URL_SOURCE = _resolve_batch_dsn()

# ── 기상청 API (출처 = 기상청 API허브, R13) ──
# backend/app/core/config.py와 같은 값이어야 한다 — 교차 빌드 컨텍스트라 import로
# 묶을 수 없다. `KMA_ASOS_DALY_URL`은 이름만 ASOS고 실제 서비스는
# `SfcMtlyInfoService/getDailyWthrData`다(월 단위 조회 — kma_client 어댑터가 흡수).
KMA_API_KEY = os.getenv("KMA_API_KEY", "")
KMA_VILAGE_FCST_URL = os.getenv(
    "KMA_VILAGE_FCST_URL",
    "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst",
)
KMA_ASOS_DALY_URL = os.getenv(
    "KMA_ASOS_DALY_URL",
    "https://apihub.kma.go.kr/api/typ02/openApi/SfcMtlyInfoService/getDailyWthrData",
)

# ── 내부 서비스 간 통신 ──
AI_WORKER_INTERNAL_URL = os.getenv("AI_WORKER_INTERNAL_URL", "http://ai-worker:8001")
AI_WORKER_INTERNAL_API_KEY = os.getenv("AI_WORKER_INTERNAL_API_KEY", "")

# ── Redis 키 TTL (docs/specs/01_database_schema.md Redis 키 네이밍 규칙) ──
WEATHER_CACHE_TTL_SEC = 60 * 60          # weather:{date}:{region} — 1시간

# 리그 기준 지역 (MVP 기본값)
DEFAULT_REGION = "서울"

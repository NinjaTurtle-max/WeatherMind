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

    # 세션 배합(§3.2 → R11-01 §9.2 10문항 → R13-01 §2.10 15문항): kind→개수.
    # env는 JSON 문자열(예: '{"new":3,"review":2,"live":1,"unit":5}').
    # SESSION_SIZE(총 문항 수)는 이 합에서 파생 — 둘을 독립 구성하지 않는다(드리프트 방지).
    # unit(진도 블록, R13-01 §2.10): 현재 진행 유닛의 다음 문항 5건을 **덧붙인다**
    # (기존 3종을 대체하지 않는다). 유닛 잔여가 모자라면 부족분은 new로 메운다 —
    # review 부족분을 new로 대체하는 기존 선례 준용이라 총합은 항상 15다.
    # 에너지와의 관계: 오답 최대 15 > CLOUD_MAX 5이지만 "진행 중 세션은 잔량 0에도
    # 완주 보장"(R10 에너지 계약)이 이미 흡수한다 — daily-goal(3·5·9)·CLOUD_*는 불변.
    SESSION_RECIPE: dict[str, int] = {"new": 5, "review": 4, "live": 1, "unit": 5}
    UNIT_SESSION_SIZE: int = 5           # 커리큘럼 유닛 세션 문항 수

    # 구름 에너지 경제(§3.3): 기본값 = 계약 수치(만렙 5·20분당 1 회복·시도당 1 소모).
    CLOUD_MAX: int = 5
    CLOUD_REGEN_MINUTES: int = 20
    CLOUD_COST: int = 1

    # 배치고사(진단 퀴즈) 문항 수 (R7-01 §3.1): 기본값 = 계약 수치(6문항 —
    # CONCEPT_TAGS 6개념당 1문항). 드리프트는 test_placement가 감시.
    PLACEMENT_SIZE: int = 6

    # 분반 리더보드 (R13-01 §2.8): 기본값 = 계약 수치(소집단 30인 · 이웃 위아래 3명).
    # 드리프트는 test_league_division이 감시한다(PLACEMENT_SIZE 전례).
    LEAGUE_DIVISION_SIZE: int = 30
    LEAGUE_NEIGHBOR_SPAN: int = 3

    # ── 개발자 모드 (R7-03) ──
    # true면 /api/v1/dev 라우터(자기 계정 상태 진단·조작)가 등록된다. 개발 전용 —
    # 운영 금지. 기본 false 고정은 계약 테스트가 감시한다(test_dev_mode —
    # PLACEMENT_SIZE 드리프트 감시 전례): 운영에 켜진 채 배포되는 실수 방지 가드.
    DEV_MODE: bool = False

    @field_validator("SESSION_RECIPE")
    @classmethod
    def _validate_recipe(cls, value: dict[str, int]) -> dict[str, int]:
        allowed = {"new", "review", "live", "unit"}
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


# ── 시크릿 플레이스홀더 감지 (R11-01 웨이브 3 — 마일스톤 5 하드닝) ──────────
# ai-worker `llm_configured()` 선례: 값에 아래 마커가 포함되면 미설정 기본값으로
# 간주한다(.env.example의 "changeme" 계열). 판정만 여기서 하고, 경고(dev)/기동
# 거부(비-dev) 분기는 main.py lifespan이 담당한다 — 교차 계약 ③.
SECRET_PLACEHOLDER_MARKERS = ("changeme", "발급받은", "your-", "placeholder")

# 유출·오설정 시 피해가 큰 시크릿성 설정만 감시한다 (기본값이 changeme 계열인 3개).
GUARDED_SECRET_NAMES = ("DATABASE_URL", "JWT_SECRET_KEY", "AI_WORKER_INTERNAL_API_KEY")


def insecure_secret_defaults(s: Settings | None = None) -> list[str]:
    """플레이스홀더 기본값이 남아 있는 시크릿 설정 이름 목록 (없으면 빈 리스트)."""
    s = s or settings
    flagged = []
    for name in GUARDED_SECRET_NAMES:
        value = (getattr(s, name) or "").strip()
        if not value or any(marker in value for marker in SECRET_PLACEHOLDER_MARKERS):
            flagged.append(name)
    return flagged

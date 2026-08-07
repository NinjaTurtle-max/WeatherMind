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

    # 생성 문항 영속화 상태 (R13 A-1/D 선행 — session_service.persist_generated_items).
    # quiz-generate 폴백 산출물을 content_items에 적재할 때 부여하는 status다.
    #   'active' — 다음 세션부터 **뱅크로 재사용**된다. 생성 1회 비용이 영구 자산이
    #              되는 유일한 값이고, 그것이 이 기능의 목적이다(기본값).
    #   'draft'  — 저장만 하고 재출제하지 않는다(사람 검수 후 승격 전제).
    #              θ·복습 큐·간격반복 배선(quiz_logs.content_item_id)은 status와
    #              무관하게 살아 있으므로 draft로 내려도 절반은 남는다.
    # 값 판단 근거·되돌리는 법은 persist_generated_items 독스트링에 있다.
    GENERATED_ITEM_STATUS: str = "active"

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

    # ── 레이트리밋 (R2-01 §3.6 → R13 P-2) ─────────────────────────────────
    # 인증 계열(login·register·guest·guest/convert) IP 기준 한도. slowapi 문법.
    #
    # 기본값을 5/minute → 30/minute으로 올린다. 근거(CARRYOVER_R13 §P-2 실측
    # `[201×5, 429×3]`): 심사장·교실은 **NAT 뒤 단일 공인 IP**라 같은 와이파이의
    # 6번째 사람부터 게스트 시작이 429로 막힌다. 화면엔 카운트다운도 자동 재시도도
    # 없어서 "서비스가 죽었다"로 보인다. 게스트 시작은 부작용이 사실상 멱등(행 1개
    # 생성)이고 비밀번호 추측 공격의 표적도 아니라 5라는 값이 지키는 것이 없다.
    # 30이면 한 교실(≈30인)이 1분 안에 전원 진입할 수 있으면서, 로그인 무차별
    # 대입은 여전히 분당 30회로 묶인다(bcrypt cost 12가 실질 상한을 더 낮춘다).
    # env로 더 올리거나(대규모 시연) 내릴 수 있고, 기본값 드리프트는
    # test_rate_limit_contract가 감시한다(PLACEMENT_SIZE 전례).
    LIMIT_AUTH: str = "30/minute"

    # X-Forwarded-For 첫 홉을 클라이언트 원 IP로 신뢰할지 여부.
    # true(기본 — 현행 동작 유지): 리버스 프록시(Caddy) 뒤 배포 전제. 프록시가
    #   없으면 헤더 위조로 한도를 무력화할 수 있다(P-7 실측: XFF 변조 시 8/8 전부 201).
    # false: XFF를 무시하고 소켓 IP만 쓴다. **프록시 뒤에서 false로 두면 전 유저가
    #   한 버킷에 묶인다** — 백엔드를 인터넷에 직접 노출할 때만 끈다.
    # 기본값을 바꾸지 않는 이유: prod는 Caddy가 앞에 있고, 여기서 뒤집으면 심사장
    # 전원이 한 버킷이 되어 P-2보다 나쁜 상태가 된다.
    TRUST_PROXY_HEADERS: bool = True

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

    @field_validator("GENERATED_ITEM_STATUS")
    @classmethod
    def _validate_generated_status(cls, value: str) -> str:
        # 'retired'는 뜻이 없다(적재 직후 은퇴). DB CHECK 3종 중 2종만 허용한다.
        if value not in ("draft", "active"):
            raise ValueError(
                f"GENERATED_ITEM_STATUS는 'draft'|'active'만 허용: {value!r}"
            )
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

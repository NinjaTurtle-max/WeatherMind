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

    # ── 기상청 API (출처 = 기상청 API허브, R13) ──────────────────────────
    # 종전 공공데이터포털(`apis.data.go.kr/1360000/...` + `serviceKey`)에서 옮겼다.
    # 두 곳은 **별개 시스템이고 키도 따로**다 — API허브 키를 옛 URL에 넣으면 인증이
    # 깨지는데, 실패가 degraded 200으로 흡수돼 화면상 아무 티가 안 난다.
    # `KMA_API_KEY`에는 **API허브 마이페이지의 인증키**를 넣는다(`authKey`로 부착).
    #
    # ⚠️ `KMA_ASOS_DALY_URL`만 **계열이 다르다**(typ01). API허브에는
    # `AsosDalyInfoService`가 없고, openApi 일자료(`SfcMtlyInfoService/
    # getDailyWthrData`)는 **월보라 당월을 주지 않는다** — 어제 날짜로 부르면
    # `resultCode=99 "발간되지 않은 기간입니다"`다(2026-08-10 실측). 정산·브리핑이
    # 필요로 하는 건 전부 당월이라 typ01 `kma_sfcdd.php`로 **교체**했다. 응답이
    # JSON이 아니라 텍스트라 파서가 다르다(weather_api.py ASOS 어댑터가 흡수).
    # env 변수 이름을 그대로 두는 것은 기존 `.env` 호환을 깨지 않기 위해서다.
    #
    # `KMA_API_KEY_SPARE`는 **주키가 죽을 날짜가 이미 정해져 있어서** 있다: 대회
    # 제공 계정 키는 8/22 만료인데 URL은 9월 셋째 주까지 살아 있어야 한다. 개인
    # 계정 키를 스페어로 두면 그날 사람이 개입하지 않아도 날씨가 안 죽는다.
    # 주키 실패 시 자동으로 넘어간다(weather_api.auth_keys). 비워 두면 종전 동작.
    KMA_API_KEY: str = ""
    KMA_API_KEY_SPARE: str = ""
    KMA_VILAGE_FCST_URL: str = (
        "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst"
    )
    KMA_MID_LAND_FCST_URL: str = (
        "https://apihub.kma.go.kr/api/typ02/openApi/MidFcstInfoService/getMidLandFcst"
    )
    KMA_ASOS_DALY_URL: str = "https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php"

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

    # 세션 배합(§3.2 → R11-01 §9.2 10문항 → R13-01 §2.10 15문항 →
    # **SPRINT_R13_02 §T3 / MT-6 10문항**): kind→개수.
    # env는 JSON 문자열(예: '{"new":3,"review":2,"live":1,"board":1}').
    # SESSION_SIZE(총 문항 수)는 이 합에서 파생 — 둘을 독립 구성하지 않는다(드리프트 방지).
    #
    # ⚠️ **2026-08-12: 15 → 10, 그리고 `unit` → `board`.** 근거는 `docs/team/
    # SPRINT_R13_02.md:68`의 T3 계약(「오늘 날씨 2 · 신규 4 · 복습 3 · 오늘 날씨 반영
    # 보드 1」)이고, 그것이 클라이언트 사양이라 이 값의 SSOT다. 두 가지를 동시에 고쳤다:
    #   ⑴ **합 10** — 화면 문구가 R11 이래 「오늘의 10문항」인데 실배합이 15였다
    #      (대장 CO-S-6). 이 변경으로 문구 쪽이 옳아진다(문구는 안 건드린다).
    #   ⑵ **`board` kind 신설** — T3 계약은 이 배합을 문자 그대로 적어 놓고도
    #      **설정 불가능**했다: 아래 `_validate_recipe`의 `allowed`에 `board`가 없어
    #      그대로 넣으면 ValueError로 기동이 죽었다. 계약서에만 있고 코드가 못 받는
    #      상태였으므로 `allowed`를 함께 넓힌다(감사 담당 D 독립 발견).
    # 순서(live 먼저)는 클라이언트 사양의 서술 순서 그대로다. **다만 dict 키 순서가
    # 출제 순서를 정하지 않는다** — 출제 순서의 소유자는
    # `session_service.plan_bank_picks`의 블록 호출 순서다. 2026-08-12 그쪽도
    # **`live → new → review → board → unit`**으로 바뀌어(클라이언트 사양 「실황이
    # 앞」) 지금은 두 순서가 일치한다. 여기 키 순서를 고쳐도 화면 순서는 안 바뀐다.
    #
    # ⚠️ `unit`(진도 블록)은 배합에서 빠졌지만 **kind 자체는 살려 둔다**: env로
    # 되돌릴 수 있어야 하고(`{"new":5,"review":4,"live":1,"unit":5}`가 종전 계약),
    # `plan_bank_picks`가 `recipe.get("unit", 0)`으로 읽어 0이면 블록을 통째로
    # 건너뛴다. 부작용은 **daily 세션의 왕관 유입로**였다 —
    # `routers/session.py:_crown_scope_logs`가 `kind == "unit"` 문항만 왕관 판정
    # 대상으로 삼으므로, unit 0이면 daily 왕관이 조용히 0이 된다.
    # ✅ **해소됨(2026-08-12 클라이언트 확정)**: 왕관을 **유닛 세션 완료**로
    # 되돌렸다(`routers/session.py`가 만점이면 `grant_crown=True`로 호출). 이중
    # 수여를 막는 것은 분기가 아니라 `grant_unit_crown`의 멱등 판정이다
    # (crown_target 상한 · cleared 전환 1회). 보드 퍼즐 경로의 왕관은 불변.
    #
    # 에너지와의 관계: 오답 최대 10 = CLOUD_MAX 10이라 이제 한 세션 전건 오답이
    # 정확히 만렙을 소진한다(종전 15 > 10). 어느 쪽이든 "진행 중 세션은 잔량 0에도
    # 완주 보장"(R10 에너지 계약)이 흡수한다 — daily-goal(3·5·9)·CLOUD_*는 불변.
    SESSION_RECIPE: dict[str, int] = {"live": 2, "new": 4, "review": 3, "board": 1}
    # 커리큘럼 유닛 세션 문항 수 — **「두 번째 이후」 전용**.
    #
    # ⚠️ **2026-08-13: 뜻이 바뀌었다(이름은 그대로).** 클라이언트 확정
    # 「하루의 첫 유닛 세션이 곧 데일리 세션이다」로 유닛 세션이 두 종류가 됐다:
    #   · 하루 **첫** 유닛 세션 → **10문항**, 배합 `실황2·신규4·복습3·보드1`,
    #     만점이면 왕관. 크기의 소유자는 이 상수가 아니라 **`SESSION_RECIPE`의
    #     총합**이다.
    #   · **두 번째 이후** → 이 상수, 실황 0 · 보드 0의 순수 학습, 왕관 없음.
    # 갈림은 발급 시점에 판정해 `recipe_json["daily_first"]`에 도장으로 남는다
    # (`curriculum_service.create_unit_session`).
    #
    # 이름을 `UNIT_SESSION_SIZE` 그대로 둔 이유: `test_ci_workflow_contract.py`와
    # `test_section_est_minutes.py`가 이 **식별자**를 문자열·속성으로 물고 있고
    # 두 파일 모두 이 개정의 소유 밖이다. 개명은 그 두 계약과 함께 옮겨야 한다.
    #
    # 아래 부등식은 **여전히 유효**하다 — 두 번째 이후 세션이 유닛 풀에서 이
    # 개수를 뽑는 구조는 그대로이기 때문이다.
    #
    # ⚠️ **2026-08-12: 5 → 4 (클라이언트 승인).** 시드 재산출(13섹션 **237유닛** —
    # quiz 231 · board 6)이 **4를 전제로** 유닛을 잘랐다. 5로 남기면 231유닛이
    # 5문항씩 요구해 1,155건이 필요한데 유닛이 실제로 볼 수 있는 문항은 946건뿐이라
    # **칸마다 마지막 유닛이 굶는다**(0문항 세션 = 과거 L2 결함의 재발 형태이고,
    # `TestZeroItemUnitSessionIsUnreachableOnThetaPath`가 그때 운다).
    #
    # 성립 조건 — **`quiz 유닛 수 × UNIT_SESSION_SIZE ≤ 946`**:
    #   231 × 4 = **924 ≤ 946** ✅  /  231 × 5 = 1,155 > 946 ❌
    # 분모 946의 출처(**2026-08-18 재실측**: 시드 **1,021**건 − board **55**건 = 비board
    # 966건 — **board가 늘 때 총계와 board 수를 함께 올리므로 분모는 안 바뀐다**.
    # 8/18 아침 1,019 − 53, 8/14 1,018 − 52, 8/12 1,012 − 46 — **넷 다 결과가 같다.**
    # ⚠️ 그래서 **946을 「정정」하지 말 것** — 시드가 자라도 이 수는 그대로다),
    # 거기서 다시 **`uses_live_slots=true` 20건을 뺀다**. `_unit_content_pool`이
    # 실황 문항을 제외하기 때문이다 — 966을 분모로 쓰면 20건을 두 번 세는 셈이라
    # 상한을 넘긴다(담당 C 정정).
    # 이 부등식의 감시자는 `test_curriculum_band_fallback`이다: 저작이 늘거나
    # 유닛이 늘어 부등식이 깨지면 "가장 얇은 유닛" 핀이 먼저 운다.
    UNIT_SESSION_SIZE: int = 4
    # daily 세션의 **일반 블록**(new·review·live 9문항)에 우발적으로 섞이는 board 상한.
    # 상한을 넘으면 **버리는 게 아니라 뒤로 미룬다**(대체 후보가 없으면 그대로 채운다):
    # 버리면 배합이 덜 차고 그 자리가 유료 생성으로 새기 때문이다(CO-H5·CO-M1).
    #
    # ⚠️ **2026-08-12: 2 → 1 (클라이언트 확정).** 근거 산술이 두 번 낡아 있었다.
    #   ⑴ 종전 근거 "시드 board 비중 46/284 = 16% × 10문항 = 1.6"의 **분모가 낡았다**.
    #      🔴 **이 줄이 8/18 하루에 세 번 무효화됐다**(52/998 → 53/999 → 55/1001).
    #      그래서 수치를 정성으로 바꾼다: **board 비중은 비실황 풀의 5%대이고, 일반 블록
    #      9칸에 적용한 기대값은 0.5 미만**이다 — 상한 2는 사실상 아무것도 막지 않는다.
    #      이 판단은 비중이 5%대인 동안 유지되고, 세는 곳은 `content_items.json`이다.
    #      (참고 실측: 8/12 46/992 = 4.6% · 8/14 52/998 = 5.2% · 8/18 저녁 55/1001 = 5.5%.
    #       board 저작이 비중을 조금씩 올릴 뿐 판단은 네 번 다 그대로였다.)
    #   ⑵ 배합에 `board: 1`이 **명시 블록으로 들어왔다**(위 SESSION_RECIPE). 이 상한이
    #      막는 것은 이제 "board 총량"이 아니라 **일반 블록(new·review·live)에
    #      우발적으로 섞이는 board**뿐이다. 2로 두면 보장 1 + 우발 2 = 최악 3/10(30%)이라
    #      "오늘 날씨 반영 보드 **1**"이라는 T3 계약이 화면에서 3보드로 보일 수 있었다.
    #      1이면 「명시 1 + 우발 0」이 기대값이고(우발 확률 4.6%) 최악도 2/10이다.
    #   ⑶ **0으로 내리지 않은 이유**: 명시 블록이 board를 못 찾은 날(오늘 현상 매칭
    #      실패 → board 풀 빔)에 일반 블록의 board가 대체로 남아야 한다.
    #   ⑷ 명시 `board` 블록은 이 상한의 **적용을 받지 않는다** — `plan_bank_picks`가
    #      진도 블록 선례대로 `cap_board=False`로 뽑는다. 보장된 자리를 자기 상한이
    #      막으면 배합이 덜 차고 그 자리가 유료 생성으로 새기 때문이다(CO-H5·CO-M1).
    DAILY_BOARD_CAP: int = 1

    # 생성 문항 영속화 상태 (R13 A-1/D 선행 — session_service.persist_generated_items).
    # quiz-generate 폴백 산출물을 content_items에 적재할 때 부여하는 status다.
    #   'active' — 다음 세션부터 **뱅크로 재사용**된다. 생성 1회 비용이 영구 자산이
    #              되는 유일한 값이고, 그것이 이 기능의 목적이다(기본값).
    #   'draft'  — 저장만 하고 재출제하지 않는다(사람 검수 후 승격 전제).
    #              θ·복습 큐·간격반복 배선(quiz_logs.content_item_id)은 status와
    #              무관하게 살아 있으므로 draft로 내려도 절반은 남는다.
    # 값 판단 근거·되돌리는 법은 persist_generated_items 독스트링에 있다.
    GENERATED_ITEM_STATUS: str = "active"

    # 구름 에너지 경제(§3.3): 기본값 = 계약 수치(만렙 10·20분당 1 회복·시도당 1 소모).
    # 만렙 10은 2026-08-11 멘토링 피드백(MT-7)이다 — 5는 한 세션(15문항)을
    # 마치기 전에 바닥나서, 학습을 끊는 것이 아니라 **시작을 막는** 자원이었다.
    CLOUD_MAX: int = 10
    CLOUD_REGEN_MINUTES: int = 20
    CLOUD_COST: int = 1

    # 배치고사(진단 퀴즈) 문항 수 (R7-01 §3.1 → **2026-08-12 MT / advisor 판정**).
    #
    # ⚠️ **6 → 10.** 종전 근거는 "CONCEPT_TAGS 6개념당 1문항"이라 **개념 축**에서
    # 나온 값이었다. 배치고사의 축이 밴드에서 **지식 단계(kl 1~10)**로 바뀌면서
    # (`placement_service.target_level_sequence`) 그 근거가 재는 대상과 어긋났다:
    # 슬롯이 10개여야 `target_level_sequence`가 kl 1~10을 **정확히 한 번씩** 낸다.
    # 6이나 8이면 결번이 남아 "10단계를 변별한다"가 반쪽이 된다 — 못 본 단계는
    # 배치 결과가 추정으로만 채우고, 그 오차가 첫 세션 난이도로 그대로 간다.
    # 개념 커버리지는 잃지 않는다(슬롯이 개념을 순환 배정하므로 10슬롯이면
    # 14개념 중 10개, 6슬롯이면 6개 — 오히려 넓어진다).
    # 드리프트는 test_placement·test_selection_by_knowledge_level이 감시한다.
    PLACEMENT_SIZE: int = 10

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
        # `board`는 2026-08-12 추가 (SPRINT_R13_02 §T3 / MT-6). 그 전까지 T3 계약이
        # 적어 둔 배합을 **문자 그대로 설정하면 여기서 ValueError로 죽었다** —
        # 계약서와 코드가 갈린 것이 아니라 계약서가 코드에 도달할 수 없었다.
        # `unit`은 배합에서 빠졌어도 남긴다: env 롤백 통로이자 진도 블록의 kind다.
        allowed = {"new", "review", "live", "unit", "board"}
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
# `weathermind_app_dev`는 init.sql이 만드는 **앱 롤의 dev 비밀번호**다. 공개 저장소에
# 평문으로 있으므로(CO-Q-11) placeholder로 취급한다 — 그러면 비-dev 기동 시
# `insecure_secret_defaults`가 걸어 **운영 배포 전 `ALTER ROLE`을 강제**한다.
# CO-J-2 수리로 `.env.example`의 DATABASE_URL이 앱 롤이 되면서 이 자리가 생겼다.
SECRET_PLACEHOLDER_MARKERS = (
    "changeme",
    "발급받은",
    "your-",
    "placeholder",
    "weathermind_app_dev",
)

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

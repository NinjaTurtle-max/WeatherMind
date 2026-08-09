"""WeatherMind backend FastAPI 앱 (포트 8000).

- 라우터: /api/v1/auth, /api/v1/session (R2-01 §3.1),
  /api/v1/progress, /api/v1/league (02번 스펙) 외
- 에러 응답 포맷: {"detail": "메시지", "code": "ERROR_CODE"} (02번 공통 규칙)
- 레이트리밋(slowapi): R2-01 §3.6 — 초과 시 429 + code=RATE_LIMITED
- /health: 05번 스펙 필수 구현
- CORS: 프론트엔드 origin 허용 (nginx 80 / vite dev 5173)
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import insecure_secret_defaults, settings
from app.core.database import engine, runtime_role_privilege
from app.core.logging import RequestLogMiddleware, setup_logging
from app.core.rate_limit import limiter
from app.core.redis import close_redis, get_redis
from app.routers import (
    auth,
    board,
    curriculum,
    dev,
    duel,
    league,
    onboarding,
    progress,
    session,
)
from app.services.answer_service import AlreadyAnsweredError, BoardStateRequiredError
from app.services.board_engine import BoardRulesError, BoardValidationError
from app.services.energy_service import OutOfCloudsError

setup_logging()  # 구조적(JSON) 로깅 — uvicorn 로거는 건드리지 않는다 (core/logging.py)

logger = logging.getLogger(__name__)


# ── 시크릿 fail-fast (R11-01 웨이브 3 §7.0 — 교차 계약 ③) ────────────────────
# 비-dev(DEV_MODE!=true)에서 changeme 계열 기본값이 남아 있으면 **기동을 거부**한다.
# dev에서는 경고 1회 후 기동 — 로컬 개발·CI·스모크는 깨지지 않는다.
# lifespan startup에서 검사한다: import 시점 검사는 pytest 수집만으로 전체 테스트를
# 죽이고, 기동(uvicorn lifespan) 시점 검사가 "기동 거부"의 정확한 의미다.
_SECRET_GUIDE = (
    "생성 방법: JWT_SECRET_KEY·AI_WORKER_INTERNAL_API_KEY는 `openssl rand -hex 32` "
    "출력값을 .env에 설정하고, DATABASE_URL은 실제 DB 계정으로 교체하세요 "
    "(예: postgresql+asyncpg://weathermind:<실제_암호>@postgres:5432/weathermind). "
    "backend·ai-worker·celery가 같은 .env를 읽으므로 AI_WORKER_INTERNAL_API_KEY는 "
    "한 곳만 바꾸면 됩니다."
)


def _enforce_secret_hygiene() -> None:
    flagged = insecure_secret_defaults()
    if not flagged:
        return
    names = ", ".join(flagged)
    if settings.DEV_MODE:
        logger.warning(
            "[시크릿 경고] %s 가 기본 플레이스홀더(changeme 계열)입니다. "
            "DEV_MODE=true라 기동은 계속하지만, 운영(DEV_MODE!=true)에서는 "
            "기동이 거부됩니다. %s",
            names,
            _SECRET_GUIDE,
        )
        return
    raise RuntimeError(
        f"[기동 거부] 시크릿이 기본 플레이스홀더(changeme 계열)입니다: {names}. "
        f"운영(DEV_MODE!=true)에서는 이 값으로 기동할 수 없습니다. {_SECRET_GUIDE} "
        "(로컬 개발 한정으로 DEV_MODE=true 설정 시 경고로 완화됩니다.)"
    )


# ── 런타임 접속 롤 fail-fast (R13 4일차 — CO-J-2) ────────────────────────────
# `_enforce_secret_hygiene`와 **같은 형태**다: 판정은 core(database.py), dev 경고 /
# 비-dev 기동 거부 분기는 여기. 막는 것은 "런타임이 RLS를 우회하는 롤로 붙는 것"이다
# — 그러면 유저 격리 2층 중 DB 층이 통째로 사라지는데 **화면은 멀쩡해 보인다**
# (앱 계층 user_id 필터가 남아 있어서). 지금까지 이걸 알려 주는 것이 없었다.
#
# 판정 불가(None = DB 미도달)는 거부하지 않는다. compose에 depends_on:
# service_healthy가 없어 backend가 postgres보다 먼저 뜨는 것이 정상 경로이고
# (CO-J-16), 여기서 죽이면 restart 정책도 없는 컨테이너가 그대로 사망한다.
# 대신 "확인하지 못했다"를 경고로 남긴다 — 침묵은 만들지 않는다.
_RLS_ROLE_GUIDE = (
    "조치: .env의 DATABASE_URL을 비특권 앱 롤로 바꾸세요 "
    "(postgresql+asyncpg://weathermind_app:<암호>@postgres:5432/weathermind). "
    "소유자 롤은 MIGRATION_DATABASE_URL(alembic)과 CELERY_DATABASE_URL(배치)이 "
    "따로 씁니다. 앱 롤 전환 전에 backend/app/scripts/rls_app_role.sql을 1회 "
    "실행해야 예외 정책 2건(users 인증·리더보드 SELECT)이 생깁니다 — 없으면 "
    "로그인·게스트·리더보드가 전면 0행이 됩니다. 근거: docs/specs/08, "
    "docs/team/CARRYOVER_R13.md §J-2."
)


async def _enforce_runtime_rls_role() -> None:
    verdict = await runtime_role_privilege()
    if verdict is None:
        logger.warning(
            "[RLS 경고] 기동 시점에 DB에 닿지 못해 런타임 접속 롤을 확인하지 "
            "못했습니다. RLS 강제 여부가 미검증 상태입니다."
        )
        return
    role, bypasses_rls = verdict
    if not bypasses_rls:
        logger.info("런타임 DB 접속 롤=%s (RLS 강제됨)", role)
        return
    if settings.DEV_MODE:
        logger.warning(
            "[RLS 경고] 런타임이 특권 롤(%s)로 접속했습니다 — RLS(user_isolation)가 "
            "무력화된 상태이고 유저 격리가 앱 계층 필터 하나에만 의존합니다. "
            "DEV_MODE=true라 기동은 계속하지만 운영에서는 거부됩니다. %s",
            role,
            _RLS_ROLE_GUIDE,
        )
        return
    raise RuntimeError(
        f"[기동 거부] 런타임이 RLS를 우회하는 특권 롤({role})로 접속했습니다. "
        f"유저 격리 2층 중 DB 층이 사라지며, 화면상으로는 정상으로 보이기 때문에 "
        f"운영에서 이 상태로 기동할 수 없습니다. {_RLS_ROLE_GUIDE} "
        "(로컬 개발 한정으로 DEV_MODE=true 설정 시 경고로 완화됩니다.)"
    )


# 상태코드 → 기본 에러 코드
_DEFAULT_CODES = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "VALIDATION_ERROR",
    status.HTTP_503_SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    _enforce_secret_hygiene()  # 비-dev + changeme 기본값 → 기동 거부 (RuntimeError)
    await _enforce_runtime_rls_role()  # 비-dev + 특권 롤 → 기동 거부 (CO-J-2)
    yield
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="WeatherMind Backend",
    version="0.1.0",
    lifespan=lifespan,
)
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:80",
        "http://localhost:5173",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 요청 로그(JSON 1줄: method·path·status·duration_ms) — 나중에 add한 미들웨어가
# 바깥층이므로 CORS 처리(프리플라이트 포함)까지 전부 관측된다.
app.add_middleware(RequestLogMiddleware)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTPException.detail이 {"detail", "code"} dict면 그대로 평탄화,
    문자열이면 상태코드 기반 기본 코드를 붙인다 → 항상 02번 에러 포맷."""
    if isinstance(exc.detail, dict) and "detail" in exc.detail:
        content = {
            "detail": exc.detail["detail"],
            "code": exc.detail.get("code", _DEFAULT_CODES.get(exc.status_code, "ERROR")),
        }
        # detail/code 외 부가 필드는 그대로 통과 (예: OUT_OF_CLOUDS의 next_regen_sec)
        for key, value in exc.detail.items():
            if key not in ("detail", "code"):
                content[key] = value
    else:
        content = {
            "detail": exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            "code": _DEFAULT_CODES.get(exc.status_code, "ERROR"),
        }
    return JSONResponse(
        status_code=exc.status_code, content=content, headers=exc.headers
    )


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """R2-01 §3.6 — 한도 초과 시 429 + 표준 에러 포맷."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": f"요청이 너무 잦습니다. 잠시 후 다시 시도해주세요. (한도: {exc.detail})",
            "code": "RATE_LIMITED",
        },
    )


# ── 도메인 예외 → 표준 에러 응답 (라우터별 try/except 글루 일원화) ────────────
# 소모·검증은 요청 트랜잭션(get_db_with_rls) 안에서 일어나므로, 여기서 변환되는
# 예외도 HTTPException과 동일하게 롤백을 거친다 — "제출 성공 시에만 소모" 불변.


@app.exception_handler(OutOfCloudsError)
async def out_of_clouds_handler(request: Request, exc: OutOfCloudsError):
    """구름 소진 → 429 OUT_OF_CLOUDS (다음 회복 ETA 포함, §3.3·§3.5)."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": "구름이 부족합니다. 시간이 지나면 회복됩니다.",
            "code": "OUT_OF_CLOUDS",
            "next_regen_sec": exc.next_regen_sec,
        },
    )


@app.exception_handler(BoardStateRequiredError)
async def board_state_required_handler(request: Request, exc: BoardStateRequiredError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "보드 유형 문항은 board_state가 필요합니다.",
            "code": "BOARD_STATE_REQUIRED",
        },
    )


@app.exception_handler(BoardValidationError)
async def board_validation_handler(request: Request, exc: BoardValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": f"보드 상태가 올바르지 않습니다: {exc}",
            "code": "BOARD_STATE_INVALID",
        },
    )


@app.exception_handler(AlreadyAnsweredError)
async def already_answered_handler(request: Request, exc: AlreadyAnsweredError):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "이미 답안을 제출한 퀴즈입니다.", "code": "ALREADY_ANSWERED"},
    )


@app.exception_handler(BoardRulesError)
async def board_rules_handler(request: Request, exc: BoardRulesError):
    """규칙 파일 부재·스키마 오류 → 503 (데이터 저작 대기 또는 데이터 오류)."""
    logger.warning("보드 규칙 로드 실패: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": str(exc), "code": "BOARD_RULES_UNAVAILABLE"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    loc = ".".join(str(p) for p in first.get("loc", ()))
    msg = first.get("msg", "요청 형식이 올바르지 않습니다.")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": f"{loc}: {msg}" if loc else msg,
            "code": "VALIDATION_ERROR",
        },
    )


# ── /health — 의존 상태 반영 (R11-01 웨이브 3 §7.0) ─────────────────────────
# 503 판정 근거: DB·Redis는 이 서비스의 **하드 의존**이다 — 인증된 모든 요청이
# Redis 세션 확인(get_current_user)과 DB 로드를 거치므로, 어느 하나가 죽으면
# 사실상 전 엔드포인트가 5xx다. 그 상태에서 /health 200은 오케스트레이터
# (compose healthcheck·k8s readiness·LB)가 죽은 인스턴스로 트래픽을 계속
# 보내게 만든다 → 어느 하나라도 실패면 503(트래픽 차단이 올바른 신호).
# 하위 호환: 스모크(smoke*.sh)는 "/health가 200"을 폴링한다 — 정상 기동 시
# 응답은 여전히 200 + {"status": "ok", "service": ...}(기존 키 유지)이고,
# 오히려 "200 = 의존까지 준비 완료"가 되어 폴링의 의미가 강해진다.
# 각 검사는 2초 타임아웃 — 의존이 행에 걸려도 /health 자체는 즉응한다.

_HEALTH_CHECK_TIMEOUT_SEC = 2.0


async def _check_db() -> None:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


async def _check_redis() -> None:
    await get_redis().ping()


@app.get("/health")
async def health():
    checks: dict[str, str] = {}
    for name, probe in (("db", _check_db), ("redis", _check_redis)):
        try:
            await asyncio.wait_for(probe(), timeout=_HEALTH_CHECK_TIMEOUT_SEC)
            checks[name] = "ok"
        except Exception as exc:  # 연결 거부·타임아웃·미기동 전부 "fail"
            logger.warning("/health %s 검사 실패: %s", name, exc)
            checks[name] = "fail"

    healthy = all(v == "ok" for v in checks.values())
    body = {
        "status": "ok" if healthy else "unavailable",
        "service": "weathermind-backend",
        "checks": checks,
    }
    if healthy:
        return body
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=body
    )


app.include_router(auth.router)
app.include_router(session.router)
app.include_router(board.router)
app.include_router(progress.router)
app.include_router(league.router)
app.include_router(duel.router)
app.include_router(curriculum.router)
app.include_router(onboarding.router)

# 개발자 모드(R7-03) — DEV_MODE=true일 때만 등록. 꺼져 있으면(기본 false,
# test_dev_mode 계약이 감시) /api/v1/dev 경로 자체가 존재하지 않아 404.
if settings.DEV_MODE:
    app.include_router(dev.router)

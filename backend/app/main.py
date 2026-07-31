"""WeatherMind backend FastAPI 앱 (포트 8000).

- 라우터: /api/v1/auth, /api/v1/session (R2-01 §3.1),
  /api/v1/progress, /api/v1/league (02번 스펙) 외
- 에러 응답 포맷: {"detail": "메시지", "code": "ERROR_CODE"} (02번 공통 규칙)
- 레이트리밋(slowapi): R2-01 §3.6 — 초과 시 429 + code=RATE_LIMITED
- /health: 05번 스펙 필수 구현
- CORS: 프론트엔드 origin 허용 (nginx 80 / vite dev 5173)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.database import engine
from app.core.rate_limit import limiter
from app.core.redis import close_redis
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "weathermind-backend"}


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

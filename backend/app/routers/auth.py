"""Auth API (/api/v1/auth) — 02번 스펙.

| POST | /register | {email, password, nickname, level_group} → {user_id, access_token} |
| POST | /login    | {email, password} → {access_token, refresh_token} |
| POST | /refresh  | {refresh_token} → {access_token} |
| POST | /logout   | - → {"success": true} (Redis 세션 삭제) |

refresh token은 Redis session:{user_id}에 7일 TTL로 저장 (08번 스펙).
로그아웃 시 세션 삭제 → 이후 모든 access token 무효화.
레이트리밋 (R2-01 §3.6): login·register 5회/분/IP.
"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.core.rate_limit import LIMIT_AUTH, limiter
from app.core.redis import get_redis
from app.core.security import (
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SESSION_TTL = timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)


async def _store_session(user_id: uuid.UUID, refresh_token: str) -> None:
    """Redis session:{user_id} — refresh token 저장, TTL 7일."""
    redis = get_redis()
    await redis.setex(f"session:{user_id}", SESSION_TTL, refresh_token)


@router.post(
    "/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit(LIMIT_AUTH)
async def register(
    request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)
) -> RegisterResponse:
    exists = await db.execute(select(User.id).where(User.email == body.email))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 등록된 이메일입니다.", "code": "EMAIL_ALREADY_EXISTS"},
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        nickname=body.nickname,
        level_group=body.level_group,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 가입 직후 발급되는 access token이 즉시 유효하도록 세션 생성
    refresh_token = create_refresh_token(str(user.id))
    await _store_session(user.id, refresh_token)

    return RegisterResponse(
        user_id=user.id,
        access_token=create_access_token(str(user.id), user.level_group),
    )


@router.post("/login", response_model=LoginResponse)
@limiter.limit(LIMIT_AUTH)
async def login(
    request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)
) -> LoginResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "이메일 또는 비밀번호가 올바르지 않습니다.", "code": "INVALID_CREDENTIALS"},
        )

    refresh_token = create_refresh_token(str(user.id))
    await _store_session(user.id, refresh_token)

    return LoginResponse(
        access_token=create_access_token(str(user.id), user.level_group),
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    body: RefreshRequest, db: AsyncSession = Depends(get_db)
) -> RefreshResponse:
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"detail": "유효하지 않은 refresh token입니다.", "code": "INVALID_REFRESH_TOKEN"},
    )
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise invalid

    user_id = payload.get("sub")
    if user_id is None or payload.get("type") != "refresh":
        raise invalid

    # Redis 세션의 refresh token과 일치해야 함 (로그아웃/재발급 시 무효화)
    redis = get_redis()
    stored = await redis.get(f"session:{user_id}")
    if stored != body.refresh_token:
        raise invalid

    user = await db.get(User, uuid.UUID(user_id))
    if user is None:
        raise invalid

    return RefreshResponse(
        access_token=create_access_token(str(user.id), user.level_group)
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(user: User = Depends(get_current_user)) -> LogoutResponse:
    redis = get_redis()
    await redis.delete(f"session:{user.id}")
    return LogoutResponse(success=True)

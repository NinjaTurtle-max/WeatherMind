"""FastAPI 의존성 — 08번 스펙(JWT 검증 + Redis 세션 확인 + RLS 주입) 흐름 그대로."""
import uuid
from typing import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import text

from app.core.database import async_session
from app.core.redis import get_redis
from app.core.security import JWTError, decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"detail": detail, "code": "UNAUTHORIZED"},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_db() -> AsyncGenerator:
    """RLS 주입 없는 일반 세션 — 유저 컨텍스트가 없는 auth 라우터와
    전체 공개 집계(리그 순위표) 전용."""
    async with async_session() as session:
        yield session


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """토큰 검증 → user_id 추출 → Redis session:{user_id} 존재 확인 → User 로드."""
    try:
        payload = decode_token(token)
    except JWTError:
        raise _unauthorized("Invalid token")

    user_id = payload.get("sub")
    if user_id is None:
        raise _unauthorized("Invalid token")

    # Redis 세션 유효성 확인 (로그아웃된 토큰 차단)
    redis = get_redis()
    if not await redis.exists(f"session:{user_id}"):
        raise _unauthorized("Session expired")

    async with async_session() as session:
        user = await session.get(User, uuid.UUID(user_id))

    if user is None:
        raise _unauthorized("User not found")
    return user


async def get_db_with_rls(
    user: User = Depends(get_current_user),
) -> AsyncGenerator:
    """RLS 정책이 참조하는 세션 변수(app.current_user_id)를 SET LOCAL로 주입.

    set_config(..., is_local := true)는 SET LOCAL과 동일하며 바인드 파라미터를
    지원한다. 트랜잭션 단위로만 유효하므로 커넥션 풀 오염이 없다.
    """
    async with async_session() as session:
        async with session.begin():
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user.id)},
            )
            yield session

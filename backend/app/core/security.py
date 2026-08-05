"""JWT 생성/검증(python-jose) + bcrypt 해싱(passlib, rounds=12) — 08번 스펙.

R11-01 웨이브 3(+jti): 모든 발급 토큰에 uuid4 jti를 넣는다. exp는 초 단위라
같은 초에 발급된 두 토큰이 **바이트 동일**해지는 문제가 있었다 — refresh는
session:{user_id} 슬롯 덮어쓰기(회전)가 "이전 토큰 != 저장 토큰" 문자열 비교로
성립하는데, 바이트가 같으면 이전 토큰이 계속 통과했다. jti로 발급마다 유일해져
회전이 항상 실효한다. access에도 넣는다: 같은 이유의 유일성 보장 + 감사·로그
상관관계용 토큰 식별자(비용 0, 검증 로직 무변경 — 미지 클레임은 무시된다).
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def _create_token(payload: dict[str, Any], expires_delta: timedelta) -> str:
    to_encode = payload.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + expires_delta
    to_encode["jti"] = uuid.uuid4().hex  # 발급 단위 유일성 (같은 초 발급도 서로 다른 토큰)
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, level_group: str) -> str:
    """JWT payload: {"sub": user_id, "level_group": ..., "exp": ..., "jti": ...} (02번 스펙 + R11 jti)."""
    return _create_token(
        {"sub": str(user_id), "level_group": level_group, "type": "access"},
        timedelta(minutes=settings.JWT_ACCESS_EXPIRE_MINUTES),
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(
        {"sub": str(user_id), "type": "refresh"},
        timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS),
    )


def decode_token(token: str) -> dict[str, Any]:
    """유효하지 않으면 JWTError를 그대로 전파한다 (호출부에서 401 처리)."""
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "JWTError",
]

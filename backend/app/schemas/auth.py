import uuid
from typing import Literal

from pydantic import BaseModel, Field

LevelGroup = Literal["elementary", "middle_high", "adult"]

# email-validator 의존성을 추가하지 않기 위해(10번 스펙 버전 고정) 간단한 패턴 검증 사용
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class RegisterRequest(BaseModel):
    email: str = Field(max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=50)
    level_group: LevelGroup


class RegisterResponse(BaseModel):
    user_id: uuid.UUID
    access_token: str


class ConvertRequest(BaseModel):
    """게스트→정식 전환(R11-01 웨이브 2) — 검증 규칙은 register와 동일 재사용.

    email 패턴·길이, password 8~128자가 RegisterRequest와 같은 제약이다.
    nickname은 선택 — 생략 시 기존(게스트) 닉네임 유지. level_group은 받지 않는다
    (같은 행 갱신이므로 기존 값 유지 — θ·진도 보존과 같은 원리).
    """

    email: str = Field(max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)
    nickname: str | None = Field(default=None, min_length=1, max_length=50)


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str


class LogoutResponse(BaseModel):
    success: bool = True

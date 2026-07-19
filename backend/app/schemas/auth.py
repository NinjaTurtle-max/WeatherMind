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

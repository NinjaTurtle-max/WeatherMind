import uuid
from typing import Literal

from pydantic import BaseModel, Field

# 🔴 **`expert`가 없는 것은 빠뜨린 것이 아니다**(2026-08-21 클라이언트 판정 명시).
# 신고할 수 있는 밴드는 이 셋뿐이고, 그래서 **재신고만으로 닿는 보드 천장에는
# 상한이 있다** — 밴드 사전값이 θ의 초기값이 되고 천장은 그 θ에서 파생되므로,
# `adult` 사전값의 파생 단계가 신고 경로의 끝이다. **상위 4층(전문가 보드)은
# 측정(배치고사·응답 누적)으로만 열린다.**
#
# ⚠️ **그것이 결함이 아니라 이 제품 축의 결과다.** 「나는 전문가입니다」라고
# **자기 신고해서 최고 난도를 여는 것**은 θ로 실력을 재서 여는 이 제품과 어긋난다.
# 이 주석이 없으면 다음 사람이 「expert가 빠졌다」를 결함으로 보고 되살린다 —
# **이유가 없어진 결정은 결함으로 읽힌다**(오늘 이 저장소가 여러 번 당한 형태).
#
# ⚠️ 이 값을 늘리면 파급이 크다: 마이그레이션(CHECK 제약)·목·계약·화면.
# `weatherbrain_service.LEVEL_GROUP_BANDS`(4종 — θ 파생 표시용)와 **일부러 다르다.**
# 계약도 그 구분대로 갈라 문다 — 라우터는 `get_args(LevelGroup)` 3종,
# 서비스는 4밴드 전건(`test_relevel_reseed.py`).
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

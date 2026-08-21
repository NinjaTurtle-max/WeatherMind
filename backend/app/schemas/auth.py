import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

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


def normalize_nickname(value: object) -> object:
    """닉네임 정규화 — **닉네임 writer 전건의 유일한 소유자**(2026-08-21).

    🔴 **이것이 유일성 검사의 전제다.** 검사가 보는 값과 실제로 저장되는 값이
    다르면 유일성은 이름만 남는다 — `"홍길동 "`이 검사(다듬은 `"홍길동"`은 아직
    없다고 판정)를 통과한 뒤 다듬지 않은 채 저장되면, 화면에서 구분되지 않는
    **눈에 보이지 않는 중복**이 그대로 생긴다. 그래서 정규화는 라우터가 아니라
    **스키마**가 한다: 라우터가 보는 `body.nickname`이 이미 다듬어진 값 하나뿐이면
    검사값과 저장값이 **구조적으로** 같아진다(맞춰야 할 두 자리가 애초에 없다).

    ⚠️ **대소문자는 접지 않는다** — 한글에는 무의미하고 영문 닉네임에만 작용해
    「Cloud」와 「cloud」를 같은 이름으로 만든다. 그건 유일성 규칙이 아니라 **표시
    이름 정책**이라 인증 계층이 혼자 정할 것이 아니다(`GuestStartRequest`의
    검증기 주석이 이 비대칭의 근거를 소유한다).

    ⚠️ 문자열이 아닌 입력은 그대로 흘려보내 pydantic의 타입 오류에 맡긴다.
    호출은 전부 `mode="before"`여야 한다 — 다듬은 **뒤에** 길이 제약이 걸려야
    공백뿐인 이름이 422로 떨어지고, 50자 이름 뒤의 공백 하나가 상한 초과로
    거절되지 않는다.
    """
    return value.strip() if isinstance(value, str) else value


class RegisterRequest(BaseModel):
    email: str = Field(max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=50)
    level_group: LevelGroup

    # 종전에는 여기만 **다듬지 않았다** — 유일성 검사가 `guest_login`에만 있어서
    # 「검사값 = 저장값」이 성립해야 할 자리가 register에는 아예 없었기 때문이다.
    # 검사가 writer 전건으로 넓어진 지금은 다듬기도 전건이어야 한다.
    _trim_nickname = field_validator("nickname", mode="before")(normalize_nickname)


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

    # 종전에는 여기도 다듬지 않았다(위 `RegisterRequest`와 같은 사유·같은 정정).
    # 상한·하한이 `GuestStartRequest.nickname`과 같은 값이어야 하듯(진입 화면과
    # 전환 화면이 다른 규칙을 쓰면 「여기선 되고 저기선 안 되는」 이름이 생긴다)
    # 정규화도 같은 함수여야 한다.
    _trim_nickname = field_validator("nickname", mode="before")(normalize_nickname)


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

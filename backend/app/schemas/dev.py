"""개발자 모드 API 스키마 (R7-03) — /api/v1/dev 요청·응답.

요청 스키마는 전부 extra='forbid' — dev 도구는 오타(예: cloud→clouds)를 조용히
무시하면 "조작이 안 먹었는데 200"이 되므로 명시적 422로 거부한다(onboarding 관례).
검증 규칙 중 env로 튜닝되는 상한(구름 CLOUD_MAX)은 라우터가 런타임 검증한다 —
스키마 리터럴로 굳히면 env 튜닝과 드리프트가 나기 때문.
"""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DevAbilityOut(BaseModel):
    """GET /dev/state의 abilities 원소 — user_concept_ability 원값 그대로."""

    concept_tag: str
    theta: float
    theta_se: float
    num_responses: int


class DevState(BaseModel):
    """GET /dev/state 응답 — 프론트는 이 엔드포인트 200 여부로 패널 노출을 결정."""

    dev_mode: bool = True
    abilities: list[DevAbilityOut]
    overall_theta: float | None
    target_level_group: str
    unlock_floor: int
    clouds: int
    streak_count: int
    placement_done: bool
    weak_tags: list[str]


class DevResetResult(BaseModel):
    """POST /dev/reset-me 응답."""

    reset: bool = True


class DevThetaAbilityIn(BaseModel):
    """POST /dev/theta의 abilities 원소 — theta_se는 서버 기본(0.3)."""

    model_config = ConfigDict(extra="forbid")

    concept_tag: str
    theta: float
    num_responses: int = Field(default=1, ge=0)


class DevThetaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    abilities: list[DevThetaAbilityIn] = Field(min_length=1)


class DevThetaResult(BaseModel):
    updated: int


class DevPlacementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["reset", "complete"]


class DevPlacementResult(BaseModel):
    placement_done: bool


class DevCloudsRequest(BaseModel):
    """상한(CLOUD_MAX)은 env 튜닝값이라 라우터가 런타임 검증한다."""

    model_config = ConfigDict(extra="forbid")

    clouds: int = Field(ge=0)


class DevCloudsResult(BaseModel):
    clouds: int
    max: int


class DevCurriculumRequest(BaseModel):
    """unit_slug·crowns는 action='crown'일 때만 필수 — 라우터가 검증."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["unlock_all", "crown", "reset"]
    unit_slug: str | None = None
    crowns: int | None = Field(default=None, ge=0)


class DevCurriculumResult(BaseModel):
    """affected: 조작이 닿은 유닛 진도 행 수(unlock_all=유닛 수, crown=1, reset=삭제 행)."""

    action: str
    affected: int


class DevStreakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    streak_count: int = Field(ge=0)
    last_login_days_ago: int = Field(default=0, ge=0)


class DevStreakResult(BaseModel):
    streak_count: int
    last_login_date: date

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ProgressMe(BaseModel):
    xp: int
    level: int
    streak_count: int
    # 스트릭 프리즈("구름 방패") 보유 수 — R2-01 §3.5
    streak_freeze_count: int
    next_level_xp: int
    # 현재 리그 티어(최근 정산 기준, 없으면 stratus) — R4-01 §3.2
    tier: str
    # 구름 에너지 잔량·다음 회복 ETA(초) — R5-01 §3.3 (clouds=플레이 에너지)
    clouds: int
    next_regen_sec: int


class EnergyState(BaseModel):
    """GET /progress/energy 응답 — R5-01 §3.3."""

    clouds: int
    max: int
    next_regen_sec: int
    updated_at: datetime | None = None


class QuestOut(BaseModel):
    """GET /progress/quests 응답 항목 — R4-01 §3.1."""

    code: str
    title: str
    progress: int
    target: int
    done: bool
    xp_reward: int


class BadgeOut(BaseModel):
    """GET /progress/badges 응답 항목 — R4-01 §3.3 (미획득은 earned_at=null)."""

    code: str
    title: str
    description: str
    earned_at: datetime | None = None


class WeakTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    concept_tag: str
    wrong_count: int
    total_count: int
    accuracy_rate: Decimal
    updated_at: datetime | None = None


class AttendanceResult(BaseModel):
    streak_count: int
    is_new_record: bool

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ProgressMe(BaseModel):
    xp: int
    level: int
    streak_count: int
    next_level_xp: int


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

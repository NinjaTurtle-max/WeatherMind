import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LeagueCurrent(BaseModel):
    week_start: date
    region: str
    mid_forecast: dict[str, Any]


class PredictRequest(BaseModel):
    temp_max: float
    temp_min: float
    rain_prob: int = Field(ge=0, le=100)


class PredictResponse(BaseModel):
    submitted: bool = True


class LeagueRank(BaseModel):
    rank: int
    nickname: str
    accuracy_score: Decimal | None = None
    elo_rating: int | None = None
    # 정산 시점 ELO로 산정한 구름 티어 (R4-01 §3.2, 미정산은 null)
    tier: str | None = None


class LeagueResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    week_start: date
    predicted_value: dict[str, Any]
    actual_value: dict[str, Any] | None = None
    accuracy_score: Decimal | None = None
    elo_rating_after: int | None = None
    tier: str | None = None

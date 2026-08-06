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


class DivisionRank(LeagueRank):
    """분반 리더보드 한 줄 — rank는 **분반 내 지역 순위**다 (R13-01 §2.8)."""

    global_rank: int
    is_me: bool = False


class LeagueDivision(BaseModel):
    """내 분반 + 이웃 격차 (R13-01 §2.8).

    entries는 나를 중심으로 위·아래 각 `neighbors`명(분반 경계에서 잘림).
    이번 주 미참가면 my_rank·my_global_rank·격차가 null이고 entries는 0번 분반
    상단 미리보기다(is_me 전부 false).
    """

    week_start: date
    division_size: int
    division_index: int
    division_count: int
    division_member_count: int
    total_participants: int
    my_rank: int | None = None
    my_global_rank: int | None = None
    # 바로 위/아래와의 accuracy_score 격차. 미정산(null 점수)이거나 이웃이 없으면 null.
    gap_above: Decimal | None = None
    gap_below: Decimal | None = None
    entries: list[DivisionRank]


class LeagueResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    week_start: date
    predicted_value: dict[str, Any]
    actual_value: dict[str, Any] | None = None
    accuracy_score: Decimal | None = None
    elo_rating_after: int | None = None
    tier: str | None = None

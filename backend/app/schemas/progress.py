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


class ConceptAbilityOut(BaseModel):
    """WeatherBrain IRT 개념별 능력 θ (로짓 스케일). R6 §5.

    theta: 능력 추정치(높을수록 강함). theta_se: 불확실성(응답 적을수록 큼).
    num_responses: 반영된 실제 응답 수(0이면 가입 시 사전 배정값).
    level_label: θ를 초급/중급/고급으로 이산화한 사람이 읽는 난이도 라벨.
    """

    model_config = ConfigDict(from_attributes=True)

    concept_tag: str
    theta: float
    theta_se: float
    num_responses: int
    level_label: str
    updated_at: datetime | None = None


class AttendanceResult(BaseModel):
    streak_count: int
    is_new_record: bool

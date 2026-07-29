"""user_concept_ability — WeatherBrain IRT 개념별 능력(θ) 영속화. R6 §5.

유저×개념별 능력 추정치(θ)와 불확실성(se), 반영 응답 수를 저장한다. ai-worker의 IRT
코어가 계산하고 backend가 소유·영속화한다(무상태 계약 — ai-worker는 DB에 쓰지 않음).
세션 발급 시 갱신되며 Router Chain·quiz-generate의 난이도 결정에 쓰인다.

RLS user_isolation: 0001 패턴 복제(weak_tags·user_unit_progress와 동일).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserConceptAbility(Base):
    __tablename__ = "user_concept_ability"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "concept_tag", name="uq_user_concept_ability_user_concept"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    concept_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    # IRT 능력 추정치 θ (로짓 스케일). se는 사후표준편차(불확실성).
    theta: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    theta_se: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("1")
    )
    # 이 추정에 반영된 실제 응답 수(0이면 사전값 — "약점"이 아니라 "정보 없음").
    num_responses: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    user: Mapped["User"] = relationship(back_populates="concept_abilities")  # noqa: F821

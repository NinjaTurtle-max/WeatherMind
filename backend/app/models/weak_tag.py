import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Computed,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

ACCURACY_RATE_SQL = (
    "CASE WHEN total_count = 0 THEN 0 "
    "ELSE round(100.0 * (total_count - wrong_count) / total_count, 2) END"
)


class WeakTag(Base):
    __tablename__ = "weak_tags"
    __table_args__ = (
        UniqueConstraint("user_id", "concept_tag", name="uq_weak_tags_user_concept"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    concept_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    wrong_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    total_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    accuracy_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), Computed(ACCURACY_RATE_SQL, persisted=True)
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    user: Mapped["User"] = relationship(back_populates="weak_tags")  # noqa: F821

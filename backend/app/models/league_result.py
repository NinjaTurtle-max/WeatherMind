import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LeagueResult(Base):
    __tablename__ = "league_results"
    # 주 1회 제출을 DB가 보증한다 (CO-R-4, 마이그레이션 0013).
    # 라우터의 SELECT-then-INSERT는 경합에서 두 행을 만들고, 그러면 순위표에 같은
    # 유저가 두 번 떠서 분반 슬라이싱이 다른 사람들까지 밀어낸다. duel이 이미 같은
    # 계약을 UNIQUE로 갖고 있어 — 리그를 그 선례에 맞춘다.
    __table_args__ = (
        UniqueConstraint("user_id", "week_start", name="uq_league_results_user_week"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    predicted_value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    actual_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    accuracy_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    elo_rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 정산 시점 ELO(elo_rating_after)로 산정한 구름 티어 (스프린트 R4-01 §3.2)
    tier: Mapped[str | None] = mapped_column(String(20), nullable=True)

    user: Mapped["User"] = relationship(back_populates="league_results")  # noqa: F821

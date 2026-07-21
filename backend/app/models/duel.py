"""예보 대결(duels) — 스프린트 R4-01 §3.4.

매일 유저가 내일 예보(최고기온·강수확률)를 제출하면, AI 캐스터 예측을 결정적
노이즈로 함께 생성·고정한다(LLM 불필요 — 제출 시점 확정). UNIQUE(user_id, duel_date)로
1일 1회를 보장하고(재제출 409), 다음날 실측(actual)으로 셀러리 일일 태스크가 정산해
user_score/ai_score·result를 기록한다. RLS user_isolation은 0004에서 0001 패턴 복제.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Duel(Base):
    __tablename__ = "duels"
    __table_args__ = (
        UniqueConstraint("user_id", "duel_date", name="uq_duels_user_date"),
        CheckConstraint("result IN ('win', 'lose', 'draw')", name="ck_duels_result"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    duel_date: Mapped[date] = mapped_column(Date, nullable=False)
    user_pred: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    ai_pred: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    actual: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    user_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    ai_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    result: Mapped[str | None] = mapped_column(String(4), nullable=True)

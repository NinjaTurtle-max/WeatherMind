"""일일 학습 세션(sessions) — 스프린트 R2-01 §3.1·§3.7.

하루 1세션: UNIQUE(user_id, session_date, mode)로 멱등 발급을 보장한다.
recipe_json에는 배합 결과(§3.2)와 발급 문항 메타({quiz_id, source, slot_filled})를,
route_decision에는 router-decide 응답을 저장한다 (1라운드 부채 "route 미로깅" 상환).
xp_total은 answer 시마다 누적되어 complete 응답의 합산값이 된다.
RLS user_isolation은 0002 마이그레이션에서 0001 패턴 그대로 복제 적용.
"""
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "session_date", "mode", name="uq_sessions_user_date_mode"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    mode: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'daily'")
    )
    recipe_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    route_decision: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    xp_total: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    user: Mapped["User"] = relationship(back_populates="sessions")  # noqa: F821
    quiz_logs: Mapped[list["QuizLog"]] = relationship(back_populates="session")  # noqa: F821

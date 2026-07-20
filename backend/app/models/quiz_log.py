import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class QuizLog(Base):
    __tablename__ = "quiz_logs"
    __table_args__ = (
        CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer', 'slider', "
            "'board', 'match', 'ordering', 'cloze')",
            name="ck_quiz_logs_question_type",
        ),
        Index("idx_quiz_logs_user_concept", "user_id", "concept_tag"),
        Index("idx_quiz_logs_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # 세션 발급 문항이면 소속 세션, 뱅크 출제 문항이면 원본 문항 (R2-01 §3.7, 기존 행은 NULL)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True
    )
    content_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_items.id"), nullable=True
    )
    quiz_id: Mapped[str] = mapped_column(String(50), nullable=False)
    concept_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    question_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    question_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    user_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    elapsed_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    user: Mapped["User"] = relationship(back_populates="quiz_logs")  # noqa: F821
    session: Mapped[Optional["Session"]] = relationship(back_populates="quiz_logs")  # noqa: F821

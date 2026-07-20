"""문항 뱅크(content_items) — 스프린트 R2-01 §3.3 시드 스키마 / §3.7 DDL.

전역 공용 콘텐츠이므로 RLS를 적용하지 않는다 (유저 소유 데이터가 아님).
template_json은 §3.3의 {question_text, options?, correct_answer, explanation_hint?} 형식.
uses_live_slots=true 문항은 서빙 시점에 {today.*} 슬롯이 실황으로 치환된다 (§3.2 live).
stat_total/stat_correct는 노출·정답 통계로, 답안 제출 시 갱신된다 (품질 관측용).
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ContentItem(Base):
    __tablename__ = "content_items"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'active', 'retired')",
            name="ck_content_items_status",
        ),
        CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer', 'slider', "
            "'board', 'match', 'ordering', 'cloze')",
            name="ck_content_items_question_type",
        ),
        CheckConstraint(
            "level_group IN ('elementary', 'middle_high', 'adult')",
            name="ck_content_items_level_group",
        ),
        Index(
            "idx_content_items_serving", "status", "level_group", "uses_live_slots"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    concept_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    level_group: Mapped[str] = mapped_column(String(20), nullable=False)
    question_type: Mapped[str] = mapped_column(String(20), nullable=False)
    template_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    uses_live_slots: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    source: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'draft'")
    )
    stat_total: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    stat_correct: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

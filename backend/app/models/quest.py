"""일일 퀘스트 정의(quests) + 유저 진행(user_quest_progress) — 스프린트 R4-01 §3.1.

quests는 코드 고정 3종(daily_xp_30 / weak_correct_1 / live_answered)으로,
정적 시드를 0004 마이그레이션이 INSERT 한다(전역 정의 — RLS 없음).
user_quest_progress는 유저·퀘스트·일자별 진행/완료 상태이며 세션 complete·보드
attempt 성공 시 당일 집계로 재계산된다(멱등). UNIQUE(user_id, quest_id, quest_date)로
하루 1행을 보장하고, RLS user_isolation은 0004에서 0001 패턴 그대로 복제한다.
"""
import uuid
from datetime import date
from typing import Any

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Quest(Base):
    __tablename__ = "quests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    xp_reward: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )


class UserQuestProgress(Base):
    __tablename__ = "user_quest_progress"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "quest_id", "quest_date", name="uq_user_quest_progress_daily"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    quest_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False
    )
    quest_date: Mapped[date] = mapped_column(Date, nullable=False)
    progress: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

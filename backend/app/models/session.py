"""일일 학습 세션(sessions) — 스프린트 R2-01 §3.1·§3.7.

하루 1세션: UNIQUE(user_id, session_date, mode)로 멱등 발급을 보장한다.
recipe_json에는 배합 결과(§3.2)와 발급 문항 메타({quiz_id, source, slot_filled, kind})를
저장한다. `kind`는 문항이 어느 블록에서 왔는지(new·review·live·unit)이고, 진도 블록이
있는 세션은 `unit_block` 메타가 함께 붙는다 — 왕관 판정을 세션 전체가 아니라 진도
5문항으로 좁히는 근거다(R13 §2.10). 메타가 없는 개정 전 세션은 전체 판정으로 폴백한다.
route_decision에는 router-decide 응답을 저장한다 (1라운드 부채 "route 미로깅" 상환).
xp_total은 answer 시마다 누적되어 complete 응답의 합산값이 된다.
RLS user_isolation은 0002 마이그레이션에서 0001 패턴 그대로 복제 적용.
"""
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Session(Base):
    __tablename__ = "sessions"
    # daily 멱등성은 unit_id IS NULL 행에만 적용하는 부분 유니크 인덱스로 보장한다
    # (R5-01 §3.2, 0005). 유닛 세션(unit_id NOT NULL, mode='unit')은 같은 날 여러
    # 유닛을 발급하므로 이 제약 밖이다. get_today_session의 동시 발급 IntegrityError
    # 재조회 경로는 daily 부분 인덱스가 그대로 발생시키므로 동작 불변.
    __table_args__ = (
        Index(
            "uq_sessions_daily",
            "user_id",
            "session_date",
            "mode",
            unique=True,
            postgresql_where=text("unit_id IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # 유닛 세션 발급 시 소속 유닛 (R5-01 §3.2). daily/일일 세션은 NULL.
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id"), nullable=True
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

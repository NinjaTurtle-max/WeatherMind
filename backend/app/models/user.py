import uuid
from datetime import date, datetime, timezone

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "level_group IN ('elementary', 'middle_high', 'adult')",
            name="ck_users_level_group",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    level_group: Mapped[str] = mapped_column(String(20), nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    streak_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # 스트릭 프리즈("구름 방패") 보유 수 — R2-01 §3.5, 최대 2.
    # 파이썬측 default=0: flush 전 인스턴스의 None 산술 비교 방지 (리뷰 5번)
    streak_freeze_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    last_login_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # ── 구름 에너지 (R5-01 §3.3) — 스트릭 프리즈("구름 방패")와 독립 자원 ──
    # 파이썬측 default 포함: flush 전 인스턴스의 None 산술/시각 비교 방지 (R4 교훈)
    clouds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=5, server_default=text("5")
    )
    clouds_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    quiz_logs: Mapped[list["QuizLog"]] = relationship(back_populates="user")  # noqa: F821
    weak_tags: Mapped[list["WeakTag"]] = relationship(back_populates="user")  # noqa: F821
    attendances: Mapped[list["Attendance"]] = relationship(back_populates="user")  # noqa: F821
    league_results: Mapped[list["LeagueResult"]] = relationship(back_populates="user")  # noqa: F821
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")  # noqa: F821

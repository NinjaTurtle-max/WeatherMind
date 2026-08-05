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
    # 배치고사(진단 퀴즈) 완료 시각 (R7-01 §3.1) — NULL이면 미완료(온보딩 진행 가능)
    placement_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 일일 목표 문항 수 (R10-01 §3.4·D4) — NULL이면 미설정(온보딩 커밋 스텝 노출).
    # 허용값 {3, 5, 9}는 API 계층에서 검증한다. SESSION_RECIPE(합 10)와 독립된
    # 표시용 타깃이라 세션 배합에 영향을 주지 않는다.
    daily_goal_items: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 사용자 지역 (R11-01 §8.2) — NULL이면 서울(weather_api.user_region이 폴백의
    # 단일 소유자). courses의 NULL=weather와 같은 하위 호환 패턴: 기존 유저·게스트
    # 무변경, backfill 불필요. KMA_GRID 12도시 화이트리스트는 API 계층
    # (PUT /progress/region, 422)에서 검증한다 — daily_goal_items 선례(CHECK 제약
    # 없음: 도시 추가 시 마이그레이션 없이 KMA_GRID만 확장).
    region: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    quiz_logs: Mapped[list["QuizLog"]] = relationship(back_populates="user")  # noqa: F821
    weak_tags: Mapped[list["WeakTag"]] = relationship(back_populates="user")  # noqa: F821
    concept_abilities: Mapped[list["UserConceptAbility"]] = relationship(back_populates="user")  # noqa: F821
    attendances: Mapped[list["Attendance"]] = relationship(back_populates="user")  # noqa: F821
    league_results: Mapped[list["LeagueResult"]] = relationship(back_populates="user")  # noqa: F821
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")  # noqa: F821

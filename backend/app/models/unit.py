"""커리큘럼 유닛(units) + 유저 진도(user_unit_progress) — 스프린트 R5-01 §3.2.

units는 섹션→유닛 트리의 전역 정의(RLS 없음)로, 시드는 database/seed/units.json
로더가 적재한다(seed_content 패턴). prereq_unit_id 자기참조 FK로 선행 잠금을 표현하고
(prereq crowns>=1 이어야 열림), kind는 'quiz'|'board' 중 하나다. 각 유닛은 unit_id를
content_items에 추가하지 않고 concept_tag+kind로 문항 풀을 결정한다(기존 시드 하위 호환).

user_unit_progress는 유저·유닛별 왕관(crowns)과 clear 시각으로, 유닛 세션 5/5 또는
board 클리어 시 crowns +1(crown_target까지)·cleared 전환 시 +20 XP 1회로 갱신된다.
UNIQUE(user_id, unit_id), RLS user_isolation은 0005에서 0001 패턴 그대로 복제한다.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Unit(Base):
    __tablename__ = "units"
    __table_args__ = (
        CheckConstraint("kind IN ('quiz', 'board')", name="ck_units_kind"),
        UniqueConstraint("slug", name="uq_units_slug"),
        UniqueConstraint("section", "unit_order", name="uq_units_section_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # 데이터 저작 units.json의 안정 식별자 — 시드 upsert 키·prereq 참조 키·API 노출 id (§3.2)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    section: Mapped[str] = mapped_column(String(50), nullable=False)
    unit_order: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    concept_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    prereq_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    crown_target: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    # 코스 귀속 (R11-01 §3 F, 0009 additive) — NULL은 기본 코스(weather) 소속으로
    # 간주한다(하위 호환: 0009 이전 시드·기존 픽스처 동일 동작). 판정 유일 지점은
    # curriculum_service.scope_units_to_course.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id"), nullable=True
    )


class UserUnitProgress(Base):
    __tablename__ = "user_unit_progress"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "unit_id", name="uq_user_unit_progress_user_unit"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id"), nullable=False
    )
    # 파이썬측 default=0: flush 전 인스턴스의 None 산술 비교 방지 (R4 교훈)
    crowns: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    cleared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 이 유닛 세션을 **한 번이라도 끝냈는가** — 진행(잠금 해제)의 소유자다.
    # 🔴 `crowns`와 **다른 축**이다(2026-08-19 결함 ⑩): 왕관은 만점·하루 첫·최초
    # 완료가 모두 참일 때만 나가는 **보상**이고, 이것은 「해 봤다」는 **사실**이다.
    # 종전에는 `is_locked`가 `crowns >= 1`을 봐서 **한 문항만 틀려도 다음 유닛이
    # 안 열렸다.** 사유는 `curriculum_service.is_locked` 독스트링이 소유한다.
    attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

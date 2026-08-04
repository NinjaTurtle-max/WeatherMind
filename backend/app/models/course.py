"""코스(courses) — 스프린트 R11-01 §3 F (다과정 구조, 마일스톤 6 선행).

courses는 코스(과정)의 전역 정의(RLS 없음 — units 선례)로, 시드는
database/seed/courses.json 로더(seed_courses)가 slug 기준 멱등 upsert 한다.
prereq_course_id 자기참조 FK는 코스 간 선행 관계의 **구조**만 표현한다
(ROADMAP §5.1.1 — 기초과학은 기상의 선행 코스). 잠금 UX·판정은 웨이브 2.

유닛의 코스 귀속은 units.course_id(0009, nullable additive)가 표현하되,
**NULL은 기본 코스(weather) 소속으로 간주**한다 — 0009 이전 시드·기존 테스트
픽스처가 무변경으로 동일 동작하는 하위 호환 규칙이다
(curriculum_service.scope_units_to_course가 유일 판정 지점).

θ(user_concept_ability)는 코스를 가로질러 개념 태그 단위로 유지한다 —
코스별 θ 분리 금지(ROADMAP §5.1.1: 마일스톤 2 "θ 단일 통화"의 확장).
"""
import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_courses_slug"),
        UniqueConstraint("course_order", name="uq_courses_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # courses.json의 안정 식별자 — 시드 upsert 키·prereq 참조 키·API 노출 id (units.slug 선례)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    course_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # 코스 간 선행 — 구조만(R11-01 §3 F). 잠금 판정·UX는 웨이브 2.
    prereq_course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id"), nullable=True
    )

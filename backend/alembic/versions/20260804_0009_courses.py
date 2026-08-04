"""다과정 구조 — courses 테이블 + units.course_id. R11-01 §3 F

0008 위 증분(additive) — 기존 스키마 불변. 새 테이블 1개 + 기존 테이블 컬럼 1개.

- courses: 코스 전역 정의(RLS 없음 — 0005 units 선례). slug 유일(시드 upsert 키),
  course_order 유일(노출 순서), prereq_course_id 자기참조 FK는 코스 간 선행의
  **구조만** 표현한다(ROADMAP §5.1.1 — 기초과학은 기상의 선행 코스. 잠금 UX는 웨이브 2).
- units.course_id: nullable FK(courses). **NULL은 기본 코스(weather) 소속으로 간주**
  — 0009 이전 시드·기존 데이터가 무변경으로 동일 동작하는 하위 호환 규칙이라
  backfill이 필요 없다(귀속은 seed_units가 units.json의 course 필드로 채운다).
- user_concept_ability 불변 — θ는 코스를 가로질러 개념 태그 단위 유지(§3 F).

downgrade는 역순: units.course_id 드롭(FK 동반 제거) → courses 드롭.
손실은 코스 정의·유닛 귀속에 한정되며 유닛·진도·θ는 건드리지 않는다.

Revision ID: 0009_courses
Revises: 0008_daily_goal
Create Date: 2026-08-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0009_courses"
down_revision: Union[str, None] = "0008_daily_goal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. courses (전역 정의, RLS 없음 — 시드는 courses.json 로더) ──
    op.create_table(
        "courses",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("course_order", sa.Integer(), nullable=False),
        sa.Column(
            "prereq_course_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("courses.id"),
            nullable=True,
        ),
        sa.UniqueConstraint("slug", name="uq_courses_slug"),
        sa.UniqueConstraint("course_order", name="uq_courses_order"),
    )

    # ── 2. units.course_id (nullable additive — NULL=기본 코스 weather) ──
    op.add_column(
        "units",
        sa.Column(
            "course_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("courses.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # 2. units.course_id 제거 (컬럼 드롭이 FK를 동반 제거)
    op.drop_column("units", "course_id")

    # 1. courses 제거
    op.drop_table("courses")

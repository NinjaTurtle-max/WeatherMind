"""커리큘럼(유닛 트리) + 구름 에너지 — 스프린트 R5-01 §3.2·§3.3

0004 위 증분. R5 리텐션 3축 중 백엔드 영속 자산을 추가한다.

- units: 섹션→유닛 트리 정의(전역, RLS 없음). prereq_unit_id 자기참조 FK로 선행 잠금을
  표현하고, kind는 CHECK('quiz','board'). 시드는 database/seed/units.json 로더가 적재(§3.2).
- user_unit_progress: 유저·유닛별 진도(왕관)와 clear 시각. UNIQUE(user_id, unit_id),
  0001 user_isolation RLS 패턴 복제.
- users.clouds INT NOT NULL DEFAULT 5 / clouds_updated_at TIMESTAMPTZ — 구름 에너지(§3.3).
- sessions.unit_id nullable FK(units) — 유닛 세션 발급 시 소속 유닛 기록(§3.2).
  기존 UNIQUE(user_id, session_date, mode)는 daily 세션 멱등 전용이었으나, 유닛 세션은
  같은 날 여러 유닛을 발급하므로 mode='unit'끼리 충돌한다. 따라서 unique 제약을
  **unit_id IS NULL(daily) 부분 유니크 인덱스**로 교체한다 — daily 멱등성은 그대로
  보존(unit_id NULL 행에만 적용)하고 유닛 세션은 제약 밖에 둔다.
  ⚠ 공유 시그니처 변경(R4 교훈): 소비자는 routers/session.py get_today_session의
  동시 발급 IntegrityError 재조회 경로뿐이며, daily(unit_id NULL) 부분 인덱스가
  그 충돌을 여전히 발생시키므로 동작 불변.

downgrade는 역순으로 내리며 부분 인덱스를 원래 unique 제약으로 되돌린다.
--sql 양방향 렌더 가능하도록 RLS·CHECK·부분 인덱스는 리터럴 SQL(op.execute)로 기술한다.

Revision ID: 0005_curriculum_energy
Revises: 0004_rewards_loop
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_curriculum_energy"
down_revision: Union[str, None] = "0004_rewards_loop"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. units (전역 정의, RLS 없음 — 시드는 units.json 로더) ──
    op.create_table(
        "units",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # slug: 데이터 저작 units.json의 안정 식별자(§3.2). 시드 upsert 키이자
        # prereq_unit_id 참조 키이며, API·URL에 노출하는 안정 참조다(UUID 대신).
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("section", sa.String(50), nullable=False),
        sa.Column("unit_order", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("concept_tag", sa.String(50), nullable=False),
        sa.Column(
            "prereq_unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column(
            "crown_target", sa.Integer(), nullable=False, server_default=sa.text("1")
        ),
        sa.CheckConstraint("kind IN ('quiz', 'board')", name="ck_units_kind"),
        sa.UniqueConstraint("slug", name="uq_units_slug"),
        sa.UniqueConstraint("section", "unit_order", name="uq_units_section_order"),
    )

    # ── 2. user_unit_progress (RLS user_isolation) ──
    op.create_table(
        "user_unit_progress",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id"),
            nullable=False,
        ),
        sa.Column("crowns", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "cleared_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.UniqueConstraint(
            "user_id", "unit_id", name="uq_user_unit_progress_user_unit"
        ),
    )
    op.execute("ALTER TABLE user_unit_progress ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY user_isolation ON user_unit_progress "
        "USING (user_id = current_setting('app.current_user_id', true)::uuid)"
    )

    # ── 3. users 구름 에너지 컬럼 (§3.3) ──
    op.add_column(
        "users",
        sa.Column("clouds", sa.Integer(), nullable=False, server_default=sa.text("5")),
    )
    op.add_column(
        "users",
        sa.Column(
            "clouds_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
    )

    # ── 4. sessions.unit_id + daily 부분 유니크 인덱스 교체 (§3.2) ──
    op.add_column(
        "sessions",
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id"),
            nullable=True,
        ),
    )
    # 기존 제약: daily 전용으로 좁힌다 (유닛 세션은 mode='unit'끼리 충돌하지 않도록 제외)
    op.drop_constraint("uq_sessions_user_date_mode", "sessions", type_="unique")
    op.execute(
        "CREATE UNIQUE INDEX uq_sessions_daily "
        "ON sessions (user_id, session_date, mode) WHERE unit_id IS NULL"
    )


def downgrade() -> None:
    # 4. sessions 부분 인덱스 → 원래 unique 제약 복원
    op.drop_index("uq_sessions_daily", table_name="sessions")
    op.create_unique_constraint(
        "uq_sessions_user_date_mode",
        "sessions",
        ["user_id", "session_date", "mode"],
    )
    op.drop_column("sessions", "unit_id")

    # 3. users 구름 에너지 컬럼 제거
    op.drop_column("users", "clouds_updated_at")
    op.drop_column("users", "clouds")

    # 2. user_unit_progress (RLS 먼저 해제)
    op.execute("DROP POLICY IF EXISTS user_isolation ON user_unit_progress")
    op.execute("ALTER TABLE user_unit_progress DISABLE ROW LEVEL SECURITY")
    op.drop_table("user_unit_progress")

    # 1. units
    op.drop_table("units")

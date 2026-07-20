"""문항 뱅크 + 일일 세션 — 스프린트 R2-01 §3.7 (0001 위 증분)

- content_items: 전역 문항 뱅크. 유저 소유 데이터가 아닌 공용 콘텐츠이므로 RLS 없음.
- sessions: 하루 1세션(UNIQUE(user_id, session_date, mode)),
  0001의 user_isolation RLS 패턴을 그대로 복제.
- quiz_logs: session_id·content_item_id NULL FK 추가 — 기존 /quiz/* 행과 호환.
- users: streak_freeze_count 추가 (§3.5 스트릭 프리즈, 최대 2 보유).

Revision ID: 0002_session_bank
Revises: 0001_initial
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002_session_bank"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. content_items (전역 문항 뱅크, RLS 없음) ────────────
    op.create_table(
        "content_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("concept_tag", sa.String(50), nullable=False),
        sa.Column("level_group", sa.String(20), nullable=False),
        sa.Column("question_type", sa.String(20), nullable=False),
        sa.Column("template_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "uses_live_slots",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("source", postgresql.JSONB(), nullable=True),
        sa.Column(
            "status", sa.String(10), nullable=False, server_default=sa.text("'draft'")
        ),
        sa.Column(
            "stat_total", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "stat_correct", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'retired')",
            name="ck_content_items_status",
        ),
        sa.CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer', 'slider')",
            name="ck_content_items_question_type",
        ),
        sa.CheckConstraint(
            "level_group IN ('elementary', 'middle_high', 'adult')",
            name="ck_content_items_level_group",
        ),
    )
    # 세션 배합 조회용 인덱스 (status·level_group·uses_live_slots 필터)
    op.create_index(
        "idx_content_items_serving",
        "content_items",
        ["status", "level_group", "uses_live_slots"],
    )

    # ── 2. sessions (하루 1세션, RLS user_isolation 복제) ──────
    op.create_table(
        "sessions",
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
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column(
            "mode", sa.String(10), nullable=False, server_default=sa.text("'daily'")
        ),
        sa.Column("recipe_json", postgresql.JSONB(), nullable=True),
        sa.Column("route_decision", postgresql.JSONB(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "xp_total", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.UniqueConstraint(
            "user_id", "session_date", "mode", name="uq_sessions_user_date_mode"
        ),
    )
    op.execute("ALTER TABLE sessions ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY user_isolation ON sessions "
        "USING (user_id = current_setting('app.current_user_id', true)::uuid)"
    )

    # ── 3. quiz_logs 컬럼 추가 (NULL 허용 — 기존 행 호환) ──────
    op.add_column(
        "quiz_logs",
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "quiz_logs",
        sa.Column(
            "content_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("content_items.id"),
            nullable=True,
        ),
    )
    # 세션 진행도(answered/total) 집계용 인덱스
    op.create_index("idx_quiz_logs_session", "quiz_logs", ["session_id"])

    # ── 4. users.streak_freeze_count (§3.5) ───────────────────
    op.add_column(
        "users",
        sa.Column(
            "streak_freeze_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "streak_freeze_count")

    op.drop_index("idx_quiz_logs_session", table_name="quiz_logs")
    op.drop_column("quiz_logs", "content_item_id")
    op.drop_column("quiz_logs", "session_id")

    op.execute("DROP POLICY IF EXISTS user_isolation ON sessions")
    op.execute("ALTER TABLE sessions DISABLE ROW LEVEL SECURITY")
    op.drop_table("sessions")

    op.drop_index("idx_content_items_serving", table_name="content_items")
    op.drop_table("content_items")

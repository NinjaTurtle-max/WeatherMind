"""initial schema — 테이블 5종 + 인덱스 + RLS 정책

docs/specs/01_database_schema.md 전체 + docs/specs/08_auth_rls_spec.md RLS.
init.sql은 EXTENSION 생성만 담당하며, 스키마·RLS는 이 마이그레이션이 소유한다
(DEVELOPMENT_PLAN.md 표준 결정사항).

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# weak_tags.accuracy_rate GENERATED 식 (models/weak_tag.py와 동일)
ACCURACY_RATE_SQL = (
    "CASE WHEN total_count = 0 THEN 0 "
    "ELSE round(100.0 * (total_count - wrong_count) / total_count, 2) END"
)

# RLS 대상: (테이블, 격리 기준 컬럼)
RLS_TABLES = (
    ("users", "id"),
    ("quiz_logs", "user_id"),
    ("weak_tags", "user_id"),
    ("attendance", "user_id"),
    ("league_results", "user_id"),
)


def upgrade() -> None:
    # ── 1. users ──────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("nickname", sa.String(50), nullable=False),
        sa.Column("level_group", sa.String(20), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "streak_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("last_login_date", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "level_group IN ('elementary', 'middle_high', 'adult')",
            name="ck_users_level_group",
        ),
    )

    # ── 2. quiz_logs ──────────────────────────────────────────
    op.create_table(
        "quiz_logs",
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
        sa.Column("quiz_id", sa.String(50), nullable=False),
        sa.Column("concept_tag", sa.String(50), nullable=False),
        sa.Column("question_type", sa.String(20), nullable=True),
        sa.Column("question_json", postgresql.JSONB(), nullable=False),
        sa.Column("user_answer", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("elapsed_sec", sa.Integer(), nullable=True),
        sa.Column(
            "answered_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer', 'slider')",
            name="ck_quiz_logs_question_type",
        ),
    )
    # Router Chain 집계용 인덱스
    op.create_index(
        "idx_quiz_logs_user_concept", "quiz_logs", ["user_id", "concept_tag"]
    )

    # ── 3. weak_tags ──────────────────────────────────────────
    op.create_table(
        "weak_tags",
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
            nullable=True,
        ),
        sa.Column("concept_tag", sa.String(50), nullable=False),
        sa.Column("wrong_count", sa.Integer(), server_default=sa.text("0")),
        sa.Column("total_count", sa.Integer(), server_default=sa.text("0")),
        sa.Column(
            "accuracy_rate",
            sa.Numeric(5, 2),
            sa.Computed(ACCURACY_RATE_SQL, persisted=True),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("user_id", "concept_tag", name="uq_weak_tags_user_concept"),
    )

    # ── 4. attendance ─────────────────────────────────────────
    op.create_table(
        "attendance",
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
            nullable=True,
        ),
        sa.Column("attend_date", sa.Date(), nullable=False),
        sa.Column("streak_count_snapshot", sa.Integer(), nullable=True),
        sa.UniqueConstraint("user_id", "attend_date", name="uq_attendance_user_date"),
    )

    # ── 5. league_results ─────────────────────────────────────
    op.create_table(
        "league_results",
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
            nullable=True,
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("predicted_value", postgresql.JSONB(), nullable=False),
        sa.Column("actual_value", postgresql.JSONB(), nullable=True),
        sa.Column("accuracy_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("elo_rating_after", sa.Integer(), nullable=True),
    )

    # ── RLS 정책 (08번 스펙) ───────────────────────────────────
    # current_setting(..., true): 세션 변수 미설정 시 에러 대신 NULL
    # → RLS 적용 롤에서는 행이 보이지 않음. 앱 접속 계정(테이블 소유자)은
    #   FORCE RLS가 아니므로 auth(로그인/가입)·전체 집계 쿼리가 정상 동작한다.
    for table, column in RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY user_isolation ON {table} "
            f"USING ({column} = current_setting('app.current_user_id', true)::uuid)"
        )


def downgrade() -> None:
    for table, _ in reversed(RLS_TABLES):
        op.execute(f"DROP POLICY IF EXISTS user_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("league_results")
    op.drop_table("attendance")
    op.drop_table("weak_tags")
    op.drop_index("idx_quiz_logs_user_concept", table_name="quiz_logs")
    op.drop_table("quiz_logs")
    op.drop_table("users")

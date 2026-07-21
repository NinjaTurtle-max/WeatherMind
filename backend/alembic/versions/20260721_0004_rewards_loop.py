"""보상 루프 — 퀘스트·배지·예보 대결 + 리그 티어 (스프린트 R4-01 §3.1~§3.4)

0003 위 증분. R4 보상 루프의 영속 자산을 추가한다.

- quests: 일일 퀘스트 정의 3종(코드 고정). 정적 시드를 이 마이그레이션이 INSERT 한다
  (§3.1 — daily_xp_30 / weak_correct_1 / live_answered). 전역 콘텐츠이므로 RLS 없음.
- user_quest_progress: 유저·퀘스트·일자별 진행/완료. UNIQUE(user_id, quest_id, quest_date),
  0001 user_isolation RLS 패턴 복제.
- badges: 배지 정의(코드 고정, 시드는 database/seed/badges.json 로더가 적재 — §3.3).
  전역 콘텐츠, RLS 없음.
- user_badges: 유저 획득 배지. UNIQUE(user_id, badge_id)로 중복 지급 방지, RLS 복제.
- duels: 일일 예보 대결. UNIQUE(user_id, duel_date)로 1일 1회, RLS 복제.
- league_results.tier: 정산 시점 ELO로 산정한 구름 티어(§3.2) VARCHAR(20).

downgrade는 역순으로 내리며 tier 컬럼을 제거한다. --sql 양방향 렌더 가능하도록
정적 시드·RLS·CHECK는 모두 리터럴 SQL(op.execute)로 기술한다.

Revision ID: 0004_rewards_loop
Revises: 0003_question_type_7
Create Date: 2026-07-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_rewards_loop"
down_revision: Union[str, None] = "0003_question_type_7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# RLS 대상: (테이블, 격리 기준 컬럼) — 0001 user_isolation 패턴 복제
_RLS_TABLES = (
    ("user_quest_progress", "user_id"),
    ("user_badges", "user_id"),
    ("duels", "user_id"),
)


def _enable_rls(table: str, column: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY user_isolation ON {table} "
        f"USING ({column} = current_setting('app.current_user_id', true)::uuid)"
    )


def upgrade() -> None:
    # ── 1. quests (전역 정의, RLS 없음) + 정적 3행 시드 (§3.1) ──
    op.create_table(
        "quests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("rule_json", postgresql.JSONB(), nullable=False),
        sa.Column("xp_reward", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    # 정적 시드 — 코드 고정 3종 (id는 gen_random_uuid() 기본값)
    op.execute(
        """
        INSERT INTO quests (code, title, rule_json, xp_reward) VALUES
        ('daily_xp_30', '오늘 XP 30 모으기',
            '{"type": "daily_xp", "target": 30}'::jsonb, 10),
        ('weak_correct_1', '약점 개념 1문제 정복',
            '{"type": "weak_correct", "target": 1}'::jsonb, 10),
        ('live_answered', '실황 문항에 답하기',
            '{"type": "live_answered", "target": 1}'::jsonb, 5)
        """
    )

    # ── 2. user_quest_progress (RLS user_isolation) ──
    op.create_table(
        "user_quest_progress",
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
            "quest_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("quests.id"),
            nullable=False,
        ),
        sa.Column("quest_date", sa.Date(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.UniqueConstraint(
            "user_id", "quest_id", "quest_date", name="uq_user_quest_progress_daily"
        ),
    )
    _enable_rls("user_quest_progress", "user_id")

    # ── 3. badges (전역 정의, RLS 없음 — 시드는 badges.json 로더) ──
    op.create_table(
        "badges",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
    )

    # ── 4. user_badges (RLS user_isolation, 중복 지급 방지) ──
    op.create_table(
        "user_badges",
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
            "badge_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("badges.id"),
            nullable=False,
        ),
        sa.Column(
            "earned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("user_id", "badge_id", name="uq_user_badges_user_badge"),
    )
    _enable_rls("user_badges", "user_id")

    # ── 5. duels (일일 예보 대결, RLS + 1일 1회) ──
    op.create_table(
        "duels",
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
        sa.Column("duel_date", sa.Date(), nullable=False),
        sa.Column("user_pred", postgresql.JSONB(), nullable=False),
        sa.Column("ai_pred", postgresql.JSONB(), nullable=False),
        sa.Column("actual", postgresql.JSONB(), nullable=True),
        sa.Column("user_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("ai_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("result", sa.String(4), nullable=True),
        sa.UniqueConstraint("user_id", "duel_date", name="uq_duels_user_date"),
        sa.CheckConstraint(
            "result IN ('win', 'lose', 'draw')", name="ck_duels_result"
        ),
    )
    _enable_rls("duels", "user_id")

    # ── 6. league_results.tier (§3.2 구름 티어) ──
    op.add_column(
        "league_results",
        sa.Column("tier", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("league_results", "tier")

    for table, _ in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS user_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("duels")
    op.drop_table("user_badges")
    op.drop_table("badges")
    op.drop_table("user_quest_progress")
    op.drop_table("quests")

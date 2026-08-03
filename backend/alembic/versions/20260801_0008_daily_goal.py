"""일일 목표 문항 수 — users.daily_goal_items. R10-01 §3.4·D4

0007 위 증분(additive) — 기존 스키마 불변, 컬럼 1개 추가만 한다(0005 clouds ·
0007 placement_completed_at 선례와 동형).
NULL = 목표 미설정(온보딩 커밋 스텝을 노출), 값이 있으면 {3, 5, 9} 중 하나
(허용값 검증은 API 계층 — PUT /api/v1/progress/daily-goal).
users는 0001에서 이미 RLS(user_isolation) 대상이라 정책 선언이 필요 없다.
downgrade는 컬럼 드롭이라 손실이 목표 설정값에 한정된다.

Revision ID: 0008_daily_goal
Revises: 0007_placement
Create Date: 2026-08-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_daily_goal"
down_revision: Union[str, None] = "0007_placement"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("daily_goal_items", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "daily_goal_items")

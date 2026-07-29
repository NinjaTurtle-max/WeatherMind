"""배치고사(진단 퀴즈) 완료 시각 — users.placement_completed_at. R7-01 §3.1

0006 위 증분(additive) — 기존 스키마 불변, 컬럼 1개 추가만 한다.
NULL = 배치고사 미완료(온보딩에서 진행 가능), NOT NULL = 완료(재응시 409).
downgrade는 컬럼 드롭이라 손실이 배치고사 완료 기록에 한정된다.

Revision ID: 0007_placement
Revises: 0006_weatherbrain
Create Date: 2026-07-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_placement"
down_revision: Union[str, None] = "0006_weatherbrain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "placement_completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "placement_completed_at")

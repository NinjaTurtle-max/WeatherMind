"""WeatherBrain IRT 영속화 — user_concept_ability + item_params. R6 §5

0005 위 증분. 자체 적응형 엔진(IRT)의 상태를 저장하는 두 테이블을 **추가만** 한다
(기존 스키마 불변 — downgrade는 단순 드롭이라 데이터 손실이 신규 자산에 한정).

- user_concept_ability: 유저×개념 능력 θ·불확실성 se·반영 응답 수. UNIQUE(user_id,
  concept_tag). 0001 user_isolation RLS 패턴 복제(개인 학습 데이터 격리).
- item_params: 뱅크 문항(content_items)별 보정 난이도 b·변별도 a. 전역 자산(RLS 없음).
  celery 재학습이 upsert. 보정 이력 없는 문항은 행이 없고 소비자가 사전값으로 폴백.

--sql 양방향 렌더 가능하도록 RLS는 리터럴 SQL(op.execute)로 기술한다.

Revision ID: 0006_weatherbrain
Revises: 0005_curriculum_energy
Create Date: 2026-07-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_weatherbrain"
down_revision: Union[str, None] = "0005_curriculum_energy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. user_concept_ability (RLS user_isolation) ──
    op.create_table(
        "user_concept_ability",
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
        sa.Column("concept_tag", sa.String(50), nullable=False),
        sa.Column(
            "theta", sa.Float(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "theta_se", sa.Float(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "num_responses", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "concept_tag", name="uq_user_concept_ability_user_concept"
        ),
    )
    op.execute("ALTER TABLE user_concept_ability ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY user_isolation ON user_concept_ability "
        "USING (user_id = current_setting('app.current_user_id', true)::uuid)"
    )

    # ── 2. item_params (전역 자산, RLS 없음) ──
    op.create_table(
        "item_params",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "content_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("content_items.id"),
            nullable=False,
        ),
        sa.Column("b", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("a", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "calibrated_n", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("content_item_id", name="uq_item_params_content_item"),
    )


def downgrade() -> None:
    # 신규 자산만 드롭 — 기존 스키마 불변이었으므로 손실은 WeatherBrain 상태에 한정.
    op.drop_table("item_params")
    op.execute("DROP POLICY IF EXISTS user_isolation ON user_concept_ability")
    op.execute("ALTER TABLE user_concept_ability DISABLE ROW LEVEL SECURITY")
    op.drop_table("user_concept_ability")

"""0016 — hindcast_attempts (과거 예보 시도 기록, MT-30)

회차(case)는 코드 픽스처(`hindcast_service.HINDCAST_CASES`)가 소유하므로 테이블은
**유저의 시도만** 담는다. 회차 테이블·FK가 없는 것은 의도다.

채점을 제출 시점에 서버가 동기로 확정하므로(실측이 픽스처에 있어 정산 배치가 불필요)
actual·user_score·ai_score·result는 **NOT NULL**이다 — `duels`가 정산 대기 때문에
그 넷을 nullable로 둔 것과 다른 점.

UNIQUE(user_id, case_id): 회차당 1회를 DB가 보증한다. 정답이 고정된 회차라
재제출을 막지 않으면 100점을 긁을 수 있다(라우터 409 ALREADY_SUBMITTED의 뒷받침).

RLS user_isolation은 0001/0004 패턴 복제. 앱 롤 예외는 **늘리지 않는다** —
이 테이블은 예외 없이 격리 대상이다(`test_rls_role_contract.RLS_TABLES` 갱신 동반).

Revision ID: 0016_hindcast_attempts
Revises: 0015_level_group_declared_at
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0016_hindcast_attempts"
down_revision: Union[str, None] = "0015_level_group_declared_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "hindcast_attempts"


def upgrade() -> None:
    op.create_table(
        _TABLE,
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
        # 픽스처 회차 id — FK 대상 테이블 없음(회차는 코드가 소유)
        sa.Column("case_id", sa.String(64), nullable=False),
        sa.Column("user_pred", postgresql.JSONB, nullable=False),
        sa.Column("ai_pred", postgresql.JSONB, nullable=False),
        sa.Column("actual", postgresql.JSONB, nullable=False),
        sa.Column("user_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("ai_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("result", sa.String(4), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("user_id", "case_id", name="uq_hindcast_attempts_user_case"),
        sa.CheckConstraint(
            "result IN ('win', 'lose', 'draw')", name="ck_hindcast_attempts_result"
        ),
    )
    # 내 이력 조회(GET /hindcast/attempts)가 타는 경로
    op.create_index(
        "ix_hindcast_attempts_user", _TABLE, ["user_id", "created_at"]
    )

    # ── RLS (0001/0004 user_isolation 패턴 복제) ──
    op.execute(f"ALTER TABLE {_TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY user_isolation ON {_TABLE} "
        f"USING (user_id = current_setting('app.current_user_id', true)::uuid)"
    )


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS user_isolation ON {_TABLE}")
    op.execute(f"ALTER TABLE {_TABLE} DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_hindcast_attempts_user", table_name=_TABLE)
    op.drop_table(_TABLE)

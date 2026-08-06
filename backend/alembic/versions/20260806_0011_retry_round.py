"""quiz_logs.retry_correct — 만회 라운드 (R13-01 §2.1)

0010 위 증분(additive) — 기존 테이블 컬럼 1개, 새 테이블 없음.

- quiz_logs.retry_correct: nullable Boolean. **NULL = 만회 시도 없음**이며
  최초 오답(is_correct=false)인 문항을 같은 세션에서 다시 풀었을 때만 채워진다.
  기존 행은 전부 NULL이라 backfill이 필요 없다(하위 호환 — 0010 users.region 전례).
- 원래 `is_correct`는 **불변 보존**한다. 최초 정오 기록이 θ 추정·뱅크 통계·약점
  태그의 근거이므로 만회 결과로 덮으면 능력 추정이 부풀려진다. 만회는 별도 컬럼에
  기록하고, "왕관 판정"만 (is_correct OR retry_correct)로 읽는다.
- 인덱스를 두지 않는 이유: 조회는 항상 세션 단위(idx_quiz_logs_session 경유)로
  일어나고 retry_correct 단독 필터가 없다.

downgrade: quiz_logs.retry_correct 드롭. 손실은 만회 이력에 한정되며(재도전 가능)
is_correct·θ·진도·왕관 적립분은 건드리지 않는다.

Revision ID: 0011_retry_round
Revises: 0010_user_region
Create Date: 2026-08-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011_retry_round"
down_revision: Union[str, None] = "0010_user_region"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # nullable additive — NULL=만회 시도 없음, 기존 행 무변경
    op.add_column(
        "quiz_logs", sa.Column("retry_correct", sa.Boolean(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("quiz_logs", "retry_correct")

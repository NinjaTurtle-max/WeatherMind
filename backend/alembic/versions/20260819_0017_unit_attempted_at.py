"""user_unit_progress.attempted_at — 진행과 보상을 가른다

🔴 **2026-08-19 결함 ⑩: 문제를 풀어도 다음 단계가 안 열린다**(클라이언트 지적).

`is_locked`가 선행 유닛의 `crowns >= 1`을 봤는데, 왕관은 세 조건이 동시에 참일
때만 나간다(`all_correct` ∧ `daily_first` ∧ `is_first_complete`). 그래서 한 문항만
틀려도, 그날 두 번째 유닛이어도, 전에 한 번 푼 유닛이어도 다음이 안 열렸다 —
**하루에 열 수 있는 유닛이 사실상 1개이고 그것도 만점이어야 했다.**

왕관 조건 셋은 각각 타당하므로(무제한 획득·재완료 파밍 차단) **조건을 풀지 않고
축을 가른다**: 진행은 `attempted_at`, 보상은 `crowns`.

**기존 행 백필**: `cleared_at`이 있거나 `crowns > 0`인 행은 이미 그 유닛을 한 번
끝낸 것이므로 `attempted_at`을 채운다. 안 채우면 **이미 진행하던 학습자의 다음
유닛이 도로 잠긴다**(왕관으로 열려 있던 자리가 `attempted_at IS NULL`이 되므로 —
`is_locked`가 `crowns >= 1`을 OR로 남긴 것이 1차 방어이고, 이 백필이 2차다).
시각은 `cleared_at`이 있으면 그것, 없으면 `now()`를 쓴다. ⚠️ 이 표에는
`created_at`·`updated_at`이 **없다**(컬럼은 id·user_id·unit_id·crowns·cleared_at
다섯뿐) — 처음 쓴 백필이 그 둘을 참조해 실패했다. **시각의 정확도는 중요하지
않다**: `is_locked`는 NULL 여부만 본다.

Revision ID: 0017_unit_attempted_at
Revises: 0016_hindcast_attempts
Create Date: 2026-08-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_unit_attempted_at"
down_revision: Union[str, None] = "0016_hindcast_attempts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_unit_progress",
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # 백필 — 이미 한 번 끝낸 행. COALESCE로 있는 시각 중 가장 그럴듯한 것을 쓴다.
    op.execute(
        """
        UPDATE user_unit_progress
           SET attempted_at = COALESCE(cleared_at, now())
         WHERE attempted_at IS NULL
           AND (cleared_at IS NOT NULL OR crowns > 0)
        """
    )


def downgrade() -> None:
    op.drop_column("user_unit_progress", "attempted_at")

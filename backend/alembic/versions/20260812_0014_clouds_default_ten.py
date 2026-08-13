"""users.clouds 기본값 5 → 10 (MT-7)

만렙을 10으로 올렸는데(`Settings.CLOUD_MAX`) 이 열의 `server_default`가 5로
남아 있었다. 앱이 항상 값을 채우므로 신규 가입은 모델 쪽 `default`로 이미
고쳐지지만, **열 정의가 앱과 다른 값을 말하는 상태**를 남겨 두지 않는다 —
다음에 누가 SQL로 직접 INSERT하거나 열 정의를 근거로 판단하면 5를 본다.

⚠️ **기존 행은 건드리지 않는다.** 이미 가입한 사람의 잔량은 그 사람이 쓴 결과다.
5로 시작해 3을 쓴 사람을 10으로 올리면 그건 보정이 아니라 선물이고, 회복
타이머(`clouds_updated_at`) 기준과도 어긋난다. 만렙이 10이 됐으므로 그들도
회복으로 10까지 차오른다 — `regen_amount`가 `CLOUD_MAX`로 clamp하기 때문이다.

⚠️ downgrade는 5로 되돌린다. 그때도 기존 행은 안 건드린다 — 되돌리는 것은
정책값이지 사람들의 잔량이 아니다.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014_clouds_default_ten"
down_revision: Union[str, None] = "0013_league_result_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "clouds", server_default="10")


def downgrade() -> None:
    op.alter_column("users", "clouds", server_default="5")

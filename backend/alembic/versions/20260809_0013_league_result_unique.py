"""league_results(user_id, week_start) UNIQUE — 주 1회 제출을 DB가 보증한다 (CO-R-4)

`POST /league/predict`는 **SELECT → 없으면 INSERT**로 주 1회를 지켜 왔다. 그 사이에
DB 제약이 없어서, 같은 유저의 두 요청이 겹치면 둘 다 SELECT에서 "없음"을 보고 둘 다
INSERT한다. 결과는 한 유저의 같은 주 행 2개다.

**왜 지금인가**: 리그는 아직 정산 이력이 0이고 `league_results` 행도 없다. 제약은
**행이 생기기 전이 가장 싸다** — 8/11~18 실운영에서 중복 행이 생긴 뒤에는 정리부터
해야 하고, 그 정리는 "어느 예측이 진짜인가"라는 답 없는 질문을 만든다.

**중복이 만드는 것**은 단순 오염이 아니다. `_ranked_leaderboard`가 주간 순위를
`league_results` 행으로 세우므로 **한 유저가 순위표에 두 번 뜨고**, 분반
(`LEAGUE_DIVISION_SIZE` 단위 슬라이싱)이 밀려 다른 사람들의 소속까지 바뀐다.
정산(celery `settle_daily_duel` 계열)도 유저당 1행을 전제로 ELO를 갱신한다.

`duel`은 이미 같은 계약을 UNIQUE로 갖고 있다 — 이 마이그레이션은 리그를 그 선례에
맞추는 것이지 새 정책을 만드는 것이 아니다.

**upgrade가 실패할 수 있는 유일한 경우**는 이미 중복 행이 있는 DB다. 그때는 제약을
거는 대신 실패하는 것이 옳다 — 어떤 행을 지울지는 마이그레이션이 결정할 문제가
아니라 운영자가 볼 문제다(0012가 expert 행에 대해 남긴 것과 같은 전제).

downgrade: 제약만 드롭한다. 데이터 손실 없음.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013_league_result_unique"
down_revision: Union[str, None] = "0012_two_axis_levels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "uq_league_results_user_week"


def upgrade() -> None:
    op.create_unique_constraint(
        CONSTRAINT, "league_results", ["user_id", "week_start"]
    )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT, "league_results", type_="unique")

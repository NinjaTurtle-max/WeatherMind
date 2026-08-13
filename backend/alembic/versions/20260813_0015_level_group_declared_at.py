"""users.level_group_declared_at — 학령이 신고값인지 기본값인지 (MT-26)

0014 위 증분(additive) — 기존 테이블 컬럼 1개, 새 테이블 없음.

**왜**: 온보딩의 「건너뛰기」(대회 규정상 로그인 없이 열려야 하므로 필수)와
`/learn` 딥링크 진입은 학령을 묻지 않고 `middle_high`로 들어온다. 그러면 실운영
로그(8/11~18)에 **신고한 middle_high**와 **묻지 않은 middle_high**가 같은 값으로
섞이고, 8/18 IRT b-재보정은 둘을 구분할 방법이 없다. **로그는 되감을 수 없다** —
쌓인 뒤에는 "이 사람이 신고했었나"를 되살릴 수 없으므로 DB가 비어 있는 지금이
유일하게 싼 시점이다.

- users.level_group_declared_at: nullable TIMESTAMPTZ. **NULL은 미신고(=기본값)**로
  간주한다 — 0010 region의 NULL=서울, 0012 tone의 NULL=파생과 같은 하위 호환
  규칙이라 **backfill이 필요 없다**: 기존 행은 신고한 적이 없으므로 NULL이 곧
  참값이다(요구된 "기존 행 기본값 = default"가 그대로 성립).
- server_default를 두지 않는다. 도장을 찍는 주체는 DB가 아니라 **명시 신고 경로
  셋**(POST /auth/register · POST /auth/guest에 level_group이 실려 온 경우 ·
  PATCH /auth/me)뿐이고, 그 경계는 `routers/auth.py:_declared_now`가 단독으로
  소유한다. now() 기본값을 달면 SQL 직접 INSERT가 조용히 declared를 찍어 이
  컬럼 전체가 무의미해진다.
- CHECK 제약도 두지 않는다 — 값 도메인이 시각 하나라 검증할 열거가 없다
  (region 0010 선례).

왜 `declared|default` 열거가 아니라 **시각**인가: 열거의 상위집합이다. 건너뛴 뒤
나중에 `PATCH /auth/me`로 신고한 사람의 로그는 신고 시각 전후로 성격이 갈리는데,
열거는 과거 로그까지 소급해 declared로 물들인다. 시각이면 재보정 쿼리가
`quiz_logs.answered_at < users.level_group_declared_at`으로 가른다.

재보정 쿼리 예: 신고 인구만 = `WHERE level_group_declared_at IS NOT NULL`,
딥링크·건너뛰기 비율 = `count(*) FILTER (WHERE level_group_declared_at IS NULL)`.

downgrade: 컬럼 드롭. ⚠️ **되돌리면 신고 여부 신호가 영구 소실된다** — 이 컬럼이
존재하는 이유 자체가 "로그는 되감을 수 없다"이므로, 실운영(8/11~18) 중 downgrade는
그 기간에 신고한 사람들의 구분을 통째로 버리는 손실 연산이다. 진도·θ·스트릭·
level_group 자체는 건드리지 않는다.

Revision ID: 0015_level_group_declared_at
Revises: 0014_clouds_default_ten
Create Date: 2026-08-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015_level_group_declared_at"
down_revision: Union[str, None] = "0014_clouds_default_ten"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # nullable additive — NULL=미신고(기본값). 기존 행 무변경 = 요구된 백필 결과.
    op.add_column(
        "users",
        sa.Column(
            "level_group_declared_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # ⚠️ 신고 여부 신호가 영구 소실된다(위 docstring). level_group 값 자체는 남는다.
    op.drop_column("users", "level_group_declared_at")

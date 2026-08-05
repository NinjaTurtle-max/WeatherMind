"""users.region — 사용자 지역화 (R11-01 §8, R12 선행)

0009 위 증분(additive) — 기존 테이블 컬럼 1개, 새 테이블 없음.

- users.region: nullable String(20). **NULL은 서울로 간주** — 0009 units.course_id의
  NULL=weather와 같은 하위 호환 규칙이라 backfill이 필요 없다(기존 유저·게스트
  무변경 동작). 폴백의 단일 소유자는 weather_api.user_region.
- 허용값(KMA_GRID 12도시 화이트리스트)은 API 계층(PUT /progress/region, 422)에서
  검증한다 — daily_goal_items(0008) 선례. CHECK 제약을 두지 않는 이유: 도시 추가가
  마이그레이션 없이 KMA_GRID 확장만으로 끝나게 한다.
- 리그 정산·중기예보 기준은 이 컬럼과 무관하게 서울 고정(§8.2 — 경로 분리).

downgrade: users.region 드롭. 손실은 유저별 지역 설정에 한정되며(재설정 가능)
진도·θ·스트릭은 건드리지 않는다.

Revision ID: 0010_user_region
Revises: 0009_courses
Create Date: 2026-08-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010_user_region"
down_revision: Union[str, None] = "0009_courses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # nullable additive — NULL=서울(weather_api.user_region), 기존 행 무변경
    op.add_column("users", sa.Column("region", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "region")

"""2축 분리 골격 — content_items.knowledge_level · users.tone (R13-0 §3.1·§4)

`level_group` 하나가 겸하던 두 일(지식 수준·표현 톤)을 담을 **그릇**을 만든다.
단계 정의값(6단계 표)은 CU-1의 교육과정 조사가 확정하므로 **여기에는 숫자가 없다**.

컬럼(둘 다 nullable additive — backfill 불필요, 0010 users.region·0011
quiz_logs.retry_correct 선례):
- content_items.knowledge_level SMALLINT NULL — 지식 수준 1~N.
  **NULL = 미분류**이고 소비자는 level_group에서 파생 폴백한다
  (weatherbrain_service.effective_knowledge_level가 폴백의 단일 소유자).
- users.tone VARCHAR(16) NULL — 표현 톤(가입 시 신고).
  **NULL = 미신고**이고 level_group에서 파생 폴백한다(elementary→child ·
  middle_high→teen · adult/expert→adult, effective_tone가 단일 소유자).

CHECK 제약 — **한 번에 끝내고 다시 열지 않는 것**이 이 마이그레이션의 설계 목표다(§4):
1. level_group 두 제약을 3종 → `LEVEL_GROUP_BANDS` 4종(expert 포함)으로 확장.
   R13 1일차에 expert가 밴드로 들어왔는데 실DB 제약이 3종이라 전문가 문항이
   적재에서 전건 거부된다(§5, seed_content.py 주석). level_group은 R13-0 이후
   **파생 뷰로 동결**되는 축이라 어휘가 더 늘지 않는다 — 그래서 값 목록 확대가
   안전하다. 신고 학령을 3종으로 좁히는 것은 API 계층(schemas/auth.LevelGroup
   Literal)의 일이고, DB 제약은 데이터 무결성 바닥선이다(§5 — 신고는 톤 축이 가져간다).
2. knowledge_level은 **상한 없는 하한 검사**만 건다. 단계 수 N을 DDL에 박으면
   조사 결과가 6→7로 움직일 때 마이그레이션을 또 열어야 한다 — 정확히 §4가
   피하라는 2회 개정이다. 상한은 앱(KNOWLEDGE_LEVEL_MAX)이 본다.
   users.daily_goal_items·users.region이 이미 같은 판단(CHECK 없이 앱 검증)이다.
3. tone은 값 집합이 설계로 고정된 3종(§1 표)이라 목록 제약을 건다.

CHECK 제약은 값 확장만으로 재정의가 안 되므로 drop 후 재생성한다(0003 선례).

downgrade: 새 제약·컬럼을 내리고 0001/0002의 3종 level_group 제약을 복원한다.
**expert 밴드 행이 남아 있으면 복원이 CHECK 위반으로 실패한다** — 롤백 전
expert 행 정리가 선행되어야 한다(0003이 신규 question_type에 대해 남긴 것과 같은
전제). 컬럼 드롭 손실은 knowledge_level·tone 두 값에 한정되고, 둘 다 NULL 폴백
경로가 살아 있어 서비스는 R13-0 이전 동작으로 되돌아간다.

Revision ID: 0012_two_axis_levels
Revises: 0011_retry_round
Create Date: 2026-08-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012_two_axis_levels"
down_revision: Union[str, None] = "0011_retry_round"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# level_group CHECK 대상 (테이블, 제약명) — 0003의 _TARGETS 관례.
_LEVEL_GROUP_TARGETS = (
    ("users", "ck_users_level_group"),
    ("content_items", "ck_content_items_level_group"),
)
# 값 목록은 weatherbrain_service.LEVEL_GROUP_BANDS·TONES와 같아야 한다. 마이그레이션은
# 앱 상수를 임포트하지 않는다(이미 적용된 리비전의 의미가 나중 상수 변경으로 흔들리면
# 안 된다) — 이원 정의의 드리프트는 test_two_axis_levels가 감시한다.
_LEVEL_GROUPS_3 = "'elementary', 'middle_high', 'adult'"
_LEVEL_GROUPS_4 = "'elementary', 'middle_high', 'adult', 'expert'"
_TONES = "'child', 'teen', 'adult'"


def _reset_level_group_check(table: str, constraint: str, groups: str) -> None:
    op.drop_constraint(constraint, table, type_="check")
    op.create_check_constraint(constraint, table, f"level_group IN ({groups})")


def upgrade() -> None:
    # nullable additive — NULL=미분류/미신고, 기존 행 무변경
    op.add_column(
        "content_items", sa.Column("knowledge_level", sa.SmallInteger(), nullable=True)
    )
    op.add_column("users", sa.Column("tone", sa.String(16), nullable=True))

    for table, constraint in _LEVEL_GROUP_TARGETS:
        _reset_level_group_check(table, constraint, _LEVEL_GROUPS_4)

    # 상한 없음 — 단계 수 N은 앱 상수(KNOWLEDGE_LEVEL_MAX)가 소유한다.
    op.create_check_constraint(
        "ck_content_items_knowledge_level",
        "content_items",
        "knowledge_level IS NULL OR knowledge_level >= 1",
    )
    op.create_check_constraint(
        "ck_users_tone", "users", f"tone IS NULL OR tone IN ({_TONES})"
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_tone", "users", type_="check")
    op.drop_constraint(
        "ck_content_items_knowledge_level", "content_items", type_="check"
    )
    for table, constraint in _LEVEL_GROUP_TARGETS:
        _reset_level_group_check(table, constraint, _LEVEL_GROUPS_3)
    op.drop_column("users", "tone")
    op.drop_column("content_items", "knowledge_level")

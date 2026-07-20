"""question_type CHECK 7종 확장 — 스프린트 R3-01 §3.8 (R3-S2·S3·S6 지원)

대기 보드 퍼즐(board)과 신규 유형(match·ordering·cloze)을 content_items·quiz_logs가
수용하도록 question_type CHECK 제약을 3종 → 7종으로 확장한다. 보드 퍼즐은
content_items를 재사용하므로 그 외 스키마 변경은 없다.

CHECK 제약은 값 확장만으로는 재정의가 안 되므로 drop 후 재생성한다. downgrade는
7종 제약을 내리고 0002의 3종 제약을 복원한다(신규 유형 데이터가 남아 있으면
복원 시 CHECK 위반으로 실패 — 롤백 전 신규 유형 행 정리가 선행되어야 함).

Revision ID: 0003_question_type_7
Revises: 0002_session_bank
Create Date: 2026-07-20
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_question_type_7"
down_revision: Union[str, None] = "0002_session_bank"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 대상 (테이블, 제약명)
_TARGETS = (
    ("content_items", "ck_content_items_question_type"),
    ("quiz_logs", "ck_quiz_logs_question_type"),
)
_TYPES_3 = "'multiple_choice', 'short_answer', 'slider'"
_TYPES_7 = (
    "'multiple_choice', 'short_answer', 'slider', "
    "'board', 'match', 'ordering', 'cloze'"
)


def _reset_check(table: str, constraint: str, types: str) -> None:
    op.drop_constraint(constraint, table, type_="check")
    op.create_check_constraint(constraint, table, f"question_type IN ({types})")


def upgrade() -> None:
    for table, constraint in _TARGETS:
        _reset_check(table, constraint, _TYPES_7)


def downgrade() -> None:
    for table, constraint in _TARGETS:
        _reset_check(table, constraint, _TYPES_3)

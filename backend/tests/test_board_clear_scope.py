"""보드 탭 클리어 판정 범위 — R13 4일차 CO-K1 회귀 테스트.

**결함**: `board.py _cleared_item_ids()`가 `question_type` 필터 없이 정답 로그를
전부 긁었는데, daily 세션 풀은 board 문항을 제외하지 않는다(`build_pool_query`에
유형 조건 없음). 그래서 **세션에서 보드 문항을 맞히면 보드 탭 칸이 이미 ✅**가 되고,
그 칸을 실제로 눌러 풀어도 `already_cleared`라 **XP 0·왕관 0이 영구 확정**됐다.

**수리**: 클리어 집합을 `session_id IS NULL AND question_type = 'board'`
— 즉 **보드 탭 attempt가 남긴 로그**로 좁혔다.

이 파일이 지키는 것은 두 가지다:
1. 쿼리에 두 조건이 실제로 걸려 있다(컴파일된 SQL로 확인 — DB 없이도 단정 가능).
2. 그 조건이 **의미를 갖는 전제**, 즉 "세션 계열 3경로는 session_id를 채우고
   보드 탭만 NULL"이 소스에서 유지된다. 전제가 깨지면 1번은 통과하면서 결함이
   되살아나므로 함께 물어야 한다.

DB 왕복이 없는 이유: 백엔드 테스트에 라이브 DB·sqlite 하네스가 없다
(test_r10_energy_contract의 소스 계약 관례를 따른다).

실행: backend 디렉토리에서 `python -m pytest tests/test_board_clear_scope.py -q`.
"""
import asyncio
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

from app.routers.board import _cleared_item_ids

APP_DIR = Path(__file__).resolve().parents[1] / "app"


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _CaptureDB:
    """실행된 select 문을 붙잡아 두는 최소 AsyncSession 대역."""

    def __init__(self, rows=()):
        self.stmt = None
        self._rows = list(rows)

    async def execute(self, stmt):
        self.stmt = stmt
        return _Result(self._rows)


def _cleared_sql() -> str:
    db = _CaptureDB()
    asyncio.run(_cleared_item_ids(db, SimpleNamespace(id=uuid.uuid4())))
    return str(db.stmt.compile(compile_kwargs={"literal_binds": True}))


def _source(rel: str) -> str:
    return (APP_DIR / rel).read_text(encoding="utf-8")


def _quizlog_block(src: str) -> str:
    """`QuizLog(` 생성 블록(닫는 괄호까지)을 대충 잘라 온다 — 인자 존재 확인용."""
    start = src.index("QuizLog(")
    return src[start : start + 500]


class TestClearedScopeQuery:
    def test_보드_탭_로그만_센다_session_id_NULL(self):
        """세션 경로에서 맞힌 board 정답이 보드 탭 클리어로 새지 않는다 (CO-K1)."""
        sql = _cleared_sql()
        assert "session_id IS NULL" in sql, sql

    def test_board_유형만_센다(self):
        """R2-01 이전 레거시 행도 session_id가 NULL이라 유형 조건이 함께 필요하다."""
        sql = _cleared_sql()
        assert "question_type = 'board'" in sql, sql

    def test_정답_로그만_그리고_내_것만(self):
        """기존 두 조건(is_correct=true · 본인)도 남아 있다 — 좁히다 잃지 않았다."""
        sql = _cleared_sql()
        assert "is_correct IS true" in sql or "is_correct = true" in sql, sql
        assert "user_id = " in sql, sql

    def test_content_item_id_기준_집합을_돌려준다(self):
        """select 대상이 content_item_id 하나 — cleared 표시의 키다."""
        sql = _cleared_sql()
        assert re.search(r"SELECT\s+quiz_logs\.content_item_id", sql), sql

    def test_None_행은_집합에서_빠진다(self):
        db = _CaptureDB(rows=[None])
        got = asyncio.run(_cleared_item_ids(db, SimpleNamespace(id=uuid.uuid4())))
        assert got == set()

    def test_반환은_id_집합이다(self):
        item = uuid.uuid4()
        db = _CaptureDB(rows=[item, item])
        got = asyncio.run(_cleared_item_ids(db, SimpleNamespace(id=uuid.uuid4())))
        assert got == {item}


class TestSessionIdIsTheBoardTabMarker:
    """`session_id IS NULL`이 "보드 탭"을 뜻한다는 **전제**를 고정한다.

    세션·유닛·배치고사 세 경로 중 하나라도 session_id를 비우기 시작하면
    위 쿼리는 통과하면서 CO-K1이 되살아난다 — 전제 자체를 테스트가 물어야 한다.
    """

    def test_세션_유닛_배치고사는_session_id를_채운다(self):
        for rel in (
            "services/session_service.py",
            "services/curriculum_service.py",
            "services/placement_service.py",
        ):
            block = _quizlog_block(_source(rel))
            assert "session_id=session.id" in block, rel

    def test_보드_탭만_session_id를_비운다(self):
        block = _quizlog_block(_source("routers/board.py"))
        assert "session_id=None" in block
        assert 'question_type="board"' in block

    # 뿌리(daily 풀이 board를 제외하지 않는 것)는 session_service 소유라 여기서
    # 고치지도, 현 상태를 테스트로 못 박지도 않는다. 뿌리가 수리돼 세션에 board가
    # 더는 섞이지 않더라도 위 범위 조건은 옳은 상태로 남는다(걸러낼 것이 없어질 뿐).

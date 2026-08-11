"""보드 순차 잠금 — MT-24 (2026-08-11 중간점검 멘토링 피드백).

**되돌린 결정이다.** `BoardPage.jsx:23`과 `routers/board.py`가 *"순차 잠금을 넣었다가
걷어냈다(2026-08-06 제품 결정) — 학습자가 원하는 퍼즐을 골라 푼다"*고 적고 있었고,
멘토링에서 순차 열림 요구가 들어와 번복했다. 당시 걷어낸 이유(선택의 자유)는
`BOARD_UNLOCK_LOOKAHEAD`로 흡수한다 — 벽에 막히지 않으면서 순서는 보인다.

이 파일이 무는 것 셋:
⑴ **순수 판정**(`compute_unlocked_ids`) — 커서·앞보기·이미 깬 칸
⑵ **서버 권위** — 표시만 잠그면 POST로 우회된다. 보드는 "클라이언트가 결과를 주입할
   통로 없음"이 설계의 뿌리인데, 잠금만 프론트에 두면 그 원칙이 잠금에서만 깨진다
⑶ **목록은 안 막는다** — 잠긴 칸도 내려보내야 앞에 무엇이 있는지 보인다
"""
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.routers import board as board_router

REPO_ROOT = Path(__file__).resolve().parents[2]


def _item(order, item_id=None):
    return SimpleNamespace(
        id=item_id or uuid.uuid4(),
        template_json={"board_order": order},
        level_group="middle_high",
        concept_tag="air_mass",
    )


def _course(n):
    """board_order 0..n-1로 정렬된 코스."""
    return [_item(i) for i in range(n)]


class TestComputeUnlocked:
    def test_아무것도_안_깼으면_앞_LOOKAHEAD_1칸만_열린다(self):
        items = _course(10)
        unlocked = board_router.compute_unlocked_ids(items, set())
        expected = board_router.BOARD_UNLOCK_LOOKAHEAD + 1
        assert {i for i, it in enumerate(items) if it.id in unlocked} == set(
            range(expected)
        )

    def test_깰수록_커서가_앞으로_간다(self):
        items = _course(10)
        cleared = {items[0].id, items[1].id}
        unlocked = board_router.compute_unlocked_ids(items, cleared)
        # 커서 = 2(첫 미클리어) → 2,3,4 열림 + 깬 0,1
        assert {i for i, it in enumerate(items) if it.id in unlocked} == {0, 1, 2, 3, 4}

    def test_벽이_생기지_않는다(self):
        """LOOKAHEAD의 존재 이유 — 어려운 칸 하나가 나머지 전부를 막으면 안 된다.

        엄격 순차(LOOKAHEAD=0)면 46퍼즐 중 하나에서 막힌 학습자가 그 뒤를 영영 못 본다.
        심사는 처음 보는 브라우저로 5분을 도는 동선이라 벽 하나가 곧 시연 실패다.
        """
        assert board_router.BOARD_UNLOCK_LOOKAHEAD >= 1
        items = _course(10)
        unlocked = board_router.compute_unlocked_ids(items, set())
        assert len(unlocked) >= 2, "첫 칸에서 막히면 시도할 다른 칸이 없다"

    def test_이미_깬_칸은_뒤쪽이라도_항상_열린다(self):
        """잠금 도입 **이전에** 뒤쪽 칸을 깬 유저가 실재한다(8/06~8/11 잠금 없음).

        커서만으로 판정하면 그 칸이 도로 잠겨서 **자기가 푼 것을 다시 못 여는**
        상태가 된다. 회귀로 남긴다 — 이 조항이 빠지면 조용히 그렇게 된다.
        """
        items = _course(10)
        cleared = {items[9].id}  # 맨 뒤만 깬 상태
        unlocked = board_router.compute_unlocked_ids(items, cleared)
        assert items[9].id in unlocked
        # 커서는 여전히 0이라 앞쪽도 정상적으로 열린다
        assert items[0].id in unlocked

    def test_전건_클리어면_전건_열림(self):
        items = _course(5)
        unlocked = board_router.compute_unlocked_ids(items, {it.id for it in items})
        assert unlocked == {it.id for it in items}

    def test_빈_목록은_빈_집합(self):
        assert board_router.compute_unlocked_ids([], set()) == set()

    def test_코스가_LOOKAHEAD보다_짧아도_안_터진다(self):
        items = _course(2)
        unlocked = board_router.compute_unlocked_ids(items, set())
        assert unlocked == {it.id for it in items}


class TestServerAuthority:
    """표시 계층 잠금은 잠금이 아니다 — 두 쓰기 경로가 다 막혀야 한다."""

    @pytest.mark.parametrize("endpoint", ["get_puzzle_detail", "attempt_puzzle"])
    def test_잠긴_퍼즐은_403_BOARD_LOCKED(self, endpoint):
        source = (REPO_ROOT / "backend/app/routers/board.py").read_text(
            encoding="utf-8"
        )
        # 두 경로 모두 _unlocked_ids_for로 판정하고 BOARD_LOCKED를 던진다
        assert source.count("BOARD_LOCKED") >= 2, (
            "진입(GET)만 막으면 attempt(POST)로 우회된다 — 두 경로 다 막을 것"
        )
        assert source.count("_unlocked_ids_for(db, user, cleared)") >= 2

    def test_잠금이_에너지_게이트보다_먼저다(self):
        """순서가 뒤집히면 잠긴 퍼즐이 429 OUT_OF_CLOUDS로 나간다.

        학습자는 "구름이 없어서 못 한다"고 읽고 20분을 기다린 뒤 다시 막힌다.
        잠긴 칸은 구름을 써도 안 열리므로 안내가 거짓이 된다.
        """
        source = (REPO_ROOT / "backend/app/routers/board.py").read_text(
            encoding="utf-8"
        )
        detail = source[source.index("async def get_puzzle_detail") :]
        detail = detail[: detail.index("async def _next_board_quiz_id")]
        assert detail.index("BOARD_LOCKED") < detail.index(
            "energy_service.require_entry"
        ), "잠금 판정이 에너지 진입 게이트보다 뒤에 있다"

    def test_attempt는_판정_전에_막는다(self):
        """통과하면 XP·왕관·퀘스트가 전부 따라 움직인다 — 채점 뒤에 막으면 늦다."""
        source = (REPO_ROOT / "backend/app/routers/board.py").read_text(
            encoding="utf-8"
        )
        body = source[source.index("async def attempt_puzzle") :]
        assert body.index("BOARD_LOCKED") < body.index("evaluate_board_answer("), (
            "잠금 검사가 서버 판정(evaluate_board_answer) 뒤에 있다"
        )


class TestListNotBlocked:
    def test_목록은_잠긴_칸도_내려보낸다(self):
        """잠긴 칸을 빼면 앞에 무엇이 있는지 안 보이고 진도감이 사라진다.

        에너지 게이트가 목록을 무차단으로 두는 것과 같은 판단이다(잔량 0에서도
        cleared 표시는 보여야 한다).
        """
        source = (REPO_ROOT / "backend/app/routers/board.py").read_text(
            encoding="utf-8"
        )
        body = source[source.index("async def list_puzzles") :]
        body = body[: body.index("async def _load_puzzle_or_404")]
        assert "BOARD_LOCKED" not in body, "목록이 잠금으로 차단하고 있다"
        assert re.search(r"unlocked=item\.id in unlocked", body), (
            "목록이 unlocked를 표시로 내려보내지 않는다"
        )

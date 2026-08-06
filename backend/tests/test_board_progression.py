"""보드 순차 진행 — 저작 순서 정렬 + 잠금 규칙 (2026-08-05 제품 결정).

순서와 잠금은 DB 의존이 없는 순수 함수(`order_puzzles_for_progress`·`locked_flags`)라
DB 없이 고정한다(test_board_difficulty 관례). 시드 실물의 저작 상태(제목·요약·
순서 완비)도 여기서 함께 지킨다 — 하나만 빠져도 카드가 빈 칸으로 뜬다.

실행: backend 디렉토리에서 `python -m pytest tests/test_board_progression.py -q`.
"""
import json
from pathlib import Path
from types import SimpleNamespace

from app.routers.board import (
    board_difficulty,
    locked_flags,
    order_puzzles_for_progress,
)

SEED_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
)


def _p(pid: str, order: int | None):
    return SimpleNamespace(
        id=pid, template_json=({} if order is None else {"board_order": order})
    )


def _board_items() -> list[dict]:
    items = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return [i for i in items if i.get("question_type") == "board"]


class TestOrder:
    def test_board_order_오름차순으로_세운다(self):
        items = [_p("c", 3), _p("a", 1), _p("b", 2)]
        assert [p.id for p in order_puzzles_for_progress(items)] == ["a", "b", "c"]

    def test_board_order_없는_문항은_뒤로_가되_사라지지_않는다(self):
        """구 시드·새로 생성된 문항이 섞여도 목록이 비면 안 된다."""
        items = [_p("new", None), _p("a", 1)]
        assert [p.id for p in order_puzzles_for_progress(items)] == ["a", "new"]

    def test_순서가_같으면_입력_순서를_유지한다(self):
        items = [_p("x", 1), _p("y", 1)]
        assert [p.id for p in order_puzzles_for_progress(items)] == ["x", "y"]


class TestLock:
    def test_첫_퍼즐은_항상_열린다(self):
        items = [_p("a", 1), _p("b", 2), _p("c", 3)]
        assert locked_flags(items, set()) == [False, True, True]

    def test_앞을_깨면_다음_하나가_열린다(self):
        items = [_p("a", 1), _p("b", 2), _p("c", 3)]
        assert locked_flags(items, {"a"}) == [False, False, True]

    def test_열려_있는_미클리어_퍼즐은_항상_하나다(self):
        items = [_p(x, i + 1) for i, x in enumerate("abcde")]
        for cleared in (set(), {"a"}, {"a", "b"}, {"a", "b", "c"}):
            flags = locked_flags(items, cleared)
            open_unsolved = [
                p.id for p, f in zip(items, flags) if not f and p.id not in cleared
            ]
            assert len(open_unsolved) == 1, (cleared, open_unsolved)

    def test_이미_깬_퍼즐은_앞을_건너뛰었어도_잠기지_않는다(self):
        """순차 잠금 도입 전에는 아무 퍼즐이나 열 수 있었다 — 그때 깬 진도를
        되돌리면 어제 깬 퍼즐이 오늘 잠긴다."""
        items = [_p("a", 1), _p("b", 2), _p("c", 3)]
        flags = locked_flags(items, {"c"})
        assert flags == [False, True, False], flags

    def test_전부_깨면_전부_열려_있다(self):
        items = [_p("a", 1), _p("b", 2)]
        assert locked_flags(items, {"a", "b"}) == [False, False]


class TestSeedAuthoring:
    """시드 실물 — 카드가 빈 칸으로 뜨지 않으려면 셋 다 있어야 한다."""

    def test_board_문항은_전부_순서_제목_요약을_갖는다(self):
        missing = [
            i["template_json"].get("question_text", "?")[:30]
            for i in _board_items()
            if not all(
                str(i["template_json"].get(k, "")).strip()
                for k in ("board_order", "title", "summary")
            )
        ]
        assert not missing, f"board_order·title·summary가 빠진 문항: {missing}"

    def test_board_order는_1부터_빈틈없이_유일하다(self):
        orders = sorted(i["template_json"]["board_order"] for i in _board_items())
        assert orders == list(range(1, len(orders) + 1)), (
            f"순서에 중복·빈틈이 있다: {orders} — 순차 진행에서 순서는 곧 코스라 "
            "두 퍼즐이 같은 자리를 차지하면 어느 쪽을 먼저 열지가 입력 순서에 달린다"
        )

    def test_첫_퍼즐은_가장_쉬운_난이도다(self):
        """처음 들어온 학습자가 만나는 한 칸 — 여기가 어려우면 문이 닫힌다."""
        first = min(_board_items(), key=lambda i: i["template_json"]["board_order"])
        assert board_difficulty(first["template_json"], first["level_group"]) == 1

    def test_난이도가_뒤로_갈수록_오른다(self):
        """리듬(중간 스파이크)은 허용하되 **전체 추세**는 올라야 한다 —
        앞·뒤 절반의 평균 난이도로 본다."""
        rows = sorted(_board_items(), key=lambda i: i["template_json"]["board_order"])
        diffs = [board_difficulty(i["template_json"], i["level_group"]) for i in rows]
        half = len(diffs) // 2
        front, back = diffs[:half], diffs[-half:]
        assert sum(back) / len(back) > sum(front) / len(front), (
            f"뒤가 더 쉽거나 같다 — 앞 {front} / 뒤 {back}"
        )

    def test_요약은_카드_한_줄에_들어가는_길이다(self):
        """퍼즐 칸은 좁다 — 길면 잘려서 무슨 미션인지 알 수 없다."""
        long = [
            (i["template_json"]["title"], len(i["template_json"]["summary"]))
            for i in _board_items()
            if len(i["template_json"]["summary"]) > 40
        ]
        assert not long, f"요약이 너무 길다(40자 초과): {long}"

    def test_제목은_짧고_서로_다르다(self):
        titles = [i["template_json"]["title"] for i in _board_items()]
        assert len(set(titles)) == len(titles), f"제목 중복: {titles}"
        long = [t for t in titles if len(t) > 14]
        assert not long, f"제목이 너무 길다(14자 초과): {long}"

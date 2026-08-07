"""보드 난이도 라벨·θ 정렬 테스트 — 스프린트 R7-02 §3.5 (제품 결정: 잠금 없음).

board_difficulty·order_puzzles_for_theta는 DB 의존이 없는 순수 함수라 축별
가중·클램프·θ 유/무 분기를 DB 없이 검증한다 (board_clear_xp를 검증하는
test_grader_registry 관례). 난이도 분포는 실 시드(content_items.json)의 board
12건을 직접 로드해 1~3이 모두 나옴을 고정한다 (test_seed_contract 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_board_difficulty.py -q`.
"""
import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from app.routers.board import board_difficulty, order_puzzles_for_theta
from app.services import weatherbrain_service as wb

SEED_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
)


class TestBoardDifficultyAxes:
    """규칙 고정: guided 1·goal_only 2 기본 + time_limit/palette≥3/adult 각 +1, 1~3 클램프."""

    def test_guided_기본_1(self):
        assert board_difficulty({"mode": "guided", "palette": ["a", "b"]}, "middle_high") == 1

    def test_goal_only_기본_2(self):
        assert board_difficulty({"mode": "goal_only", "palette": ["a", "b"]}, "middle_high") == 2

    def test_mode_미상은_goal_only_취급_2(self):
        assert board_difficulty({}, "middle_high") == 2

    def test_time_limit_가산(self):
        assert board_difficulty({"mode": "goal_only", "time_limit_sec": 60}, "middle_high") == 3
        assert board_difficulty({"mode": "guided", "time_limit_sec": 60}, "middle_high") == 2

    def test_palette_3요소_이상_가산(self):
        assert board_difficulty({"mode": "guided", "palette": ["a", "b", "c"]}, "middle_high") == 2
        assert board_difficulty({"mode": "goal_only", "palette": ["a", "b", "c"]}, "middle_high") == 3
        # 2요소는 가산 없음
        assert board_difficulty({"mode": "goal_only", "palette": ["a", "b"]}, "middle_high") == 2

    def test_adult_가산(self):
        assert board_difficulty({"mode": "goal_only"}, "adult") == 3
        assert board_difficulty({"mode": "guided"}, "adult") == 2
        assert board_difficulty({"mode": "goal_only"}, "elementary") == 2

    def test_상한_3_클램프(self):
        # goal_only(2) + time(+1) + palette(+1) + adult(+1) = 5 → 3
        template = {
            "mode": "goal_only",
            "time_limit_sec": 30,
            "palette": ["a", "b", "c", "d"],
        }
        assert board_difficulty(template, "adult") == 3

    def test_하한_1_빈_template(self):
        assert board_difficulty(None, "elementary") == 2  # 방어: None → goal_only 취급
        assert board_difficulty({"mode": "guided"}, "elementary") == 1


class TestBoardDifficultySeedDistribution:
    """AC(§3.5): 실 시드 board 12건에서 난이도 1~3이 모두 존재."""

    def _seed_boards(self):
        entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        return [e for e in entries if e["question_type"] == "board"]

    def test_12건_분포_1_2_3_모두_존재(self):
        boards = self._seed_boards()
        assert len(boards) == 13  # R12 §9 — bs 대류 퍼즐(guided·elementary) 추가
        dist = Counter(
            board_difficulty(e["template_json"], e["level_group"]) for e in boards
        )
        assert set(dist) == {1, 2, 3}, f"난이도 결손: {dict(dist)}"

    def test_현_시드_분포_고정(self):
        """가중 조정이나 시드 증보로 분포가 바뀌면 여기서 드러난다(의도 확인 후 갱신)."""
        boards = self._seed_boards()
        dist = Counter(
            board_difficulty(e["template_json"], e["level_group"]) for e in boards
        )
        # R12 §9: bs 대류 퍼즐이 guided(난이도 1)로 합류 — 1이 3→4.
        # R13 2일차: 전수 재분류로 board 13건 중 12건이 4단계(→middle_high)로 모이면서
        # adult 가중을 받던 2건이 내려왔다 — 3이 4→2, 2가 5→7. 의도한 이동이다:
        # 그 2건은 "실화 재현" 퍼즐이라 성인 신고값을 달고 있었을 뿐 요구 지식은
        # 전선·기단(§2.5 4단계)이었다. 다만 이 이동은 board 난이도가 사실상 한 칸에
        # 몰려 있다는 뜻이기도 하다(docs/specs/12 재분류 보고 — board 12/13이 4단계).
        assert dist == {1: 4, 2: 7, 3: 2}


def _puzzle(name: str, level_group: str):
    return SimpleNamespace(id=name, level_group=level_group)


class TestOrderPuzzlesForTheta:
    """§3.5 정렬: |사전 b(level_group) − θ| 오름차순, θ None이면 입력(created_at) 순."""

    def _items(self):
        # created_at 순 입력 가정 (쿼리가 보장)
        return [
            _puzzle("mh-1", "middle_high"),  # b=0.0
            _puzzle("mh-2", "middle_high"),
            _puzzle("adult-1", "adult"),  # b=1.0
            _puzzle("adult-2", "adult"),
        ]

    def test_θ_None_콜드스타트는_입력_순서_유지(self):
        items = self._items()
        assert order_puzzles_for_theta(items, None) == items

    def test_높은_θ는_adult_먼저(self):
        ordered = order_puzzles_for_theta(self._items(), 1.0)
        assert [p.id for p in ordered] == ["adult-1", "adult-2", "mh-1", "mh-2"]

    def test_낮은_θ는_middle_high_먼저(self):
        ordered = order_puzzles_for_theta(self._items(), -0.5)
        assert [p.id for p in ordered] == ["mh-1", "mh-2", "adult-1", "adult-2"]

    def test_동률은_입력_순서_안정_유지(self):
        # θ=0.5 → 두 그룹 모두 |b−θ|=0.5 동률 — created_at(입력) 순 그대로
        ordered = order_puzzles_for_theta(self._items(), 0.5)
        assert [p.id for p in ordered] == ["mh-1", "mh-2", "adult-1", "adult-2"]

    def test_미지_그룹은_DEFAULT_ITEM_B(self):
        items = [_puzzle("unknown", "mystery"), _puzzle("adult", "adult")]
        ordered = order_puzzles_for_theta(items, 1.0)
        assert [p.id for p in ordered] == ["adult", "unknown"]  # 0.0 vs 1.0 거리
        assert wb.DEFAULT_ITEM_B == 0.0  # 미지 그룹 폴백 상수(단일 소유) 전제

    def test_사전_b는_weatherbrain_단일_소유_재사용(self):
        """session_service 뱅크 풀 정렬과 동일 상수(LEVEL_GROUP_ITEM_B)를 쓴다 —
        값 자체의 드리프트 감시는 test_weatherbrain_contract 소유."""
        from app.routers import board

        assert board.weatherbrain_service.LEVEL_GROUP_ITEM_B is wb.LEVEL_GROUP_ITEM_B


class TestBoardPuzzleSchema:
    def test_difficulty_필드_additive(self):
        """BoardPuzzle에 difficulty(int)가 추가됐고 기존 필드는 유지된다."""
        import uuid

        from app.schemas.board import BoardPuzzle

        puzzle = BoardPuzzle(
            content_item_id=uuid.uuid4(),
            template_json={"mode": "guided"},
            cleared=False,
            difficulty=1,
        )
        assert puzzle.difficulty == 1

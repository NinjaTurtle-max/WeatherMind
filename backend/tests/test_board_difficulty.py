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

    def test_분포_1_2_3_모두_존재(self):
        boards = self._seed_boards()
        # R12 §9 13건 → R13 2일차 통합에서 +21(2일차 저작 7 + 규칙 확장 10 + 재난 4)
        assert len(boards) == 34
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
        # adult 가중을 받던 2건이 내려왔다 — 3이 4→2, 2가 5→7.
        # 같은 날 통합 병합으로 13→34건. 재분류 시점에 "한 칸에 몰려 있다"고 적었던
        # 상태가 실제로 풀렸다 — 3단계 보드가 개통되고(전선·기단을 안 쓰는 대류 규칙)
        # 양쯔강·오호츠크 기단 퍼즐이 5·6단계로 붙으면서 1·2·3이 11·13·10으로 고르다.
        # R13 재난 축(CO-A3·CO-K4, 2026-08-09): 재난 board 4건을 wind 문법으로 재저작했지만
        # **분포는 그대로다** — 팔레트를 4건 모두 2개(습기·바람)로 유지했기 때문이다.
        # 이것은 우연이 아니라 제약이다: 산불 규칙에 일사를 세 번째 조건으로 넣으면
        # 팔레트가 3이 되고, palette≥3 가산이 「산불 나기 쉬운 날」(board_order 9)을
        # guided 1 → 2로 올려 바로 뒤 board_order 10·11(난이도 1)보다 앞서 어려워진다
        # → test_board_progression의 단조 증가 계약이 깨진다. board_order는 순서 계약상
        # 고정이고 board_difficulty는 순수 함수라 낮출 길이 없다.
        # 사유 전문은 board_rules.json wildfire_risk_dry_gale의 note_authoring.
        assert dist == {1: 11, 2: 13, 3: 10}


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


class TestMockParity:
    """목(frontend/mock)의 boardDifficulty가 서버와 같은 규칙인지 소스로 대조한다.

    왜 소스 대조인가: 목은 JS라 파이썬 테스트가 실행할 수 없다. 그래서 "같은 값이
    나오는가"가 아니라 "같은 **규칙**을 쓰는가"를 본다.

    실제로 갈렸다(2026-08-07). R13에서 밴드가 4종(expert 추가)이 되면서 서버는
    `level_group == "adult"` 문자열 비교를 버리고 사전 b 임계로 바꿨는데 목은 그대로
    남아, expert 문항이 서버에선 어려움(3)인데 목에선 보통(2)으로 떴다. 화면상
    난이도가 되돌아가는 것처럼 보였고, 목으로 도는 프론트 스모크는 이를 못 잡았다.
    """

    MOCK_PATH = (
        Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
    )

    def test_목이_문자열_비교로_되돌아가지_않았다(self):
        src = self.MOCK_PATH.read_text(encoding="utf-8")
        assert "levelGroup === 'adult'" not in src, (
            "목이 밴드를 문자열로 비교한다 — expert 등 상위 밴드가 추가되면 서버와 "
            "난이도가 갈린다. 서버처럼 사전 b 임계로 판정할 것"
        )

    def test_목의_사전_b_표가_서버와_같다(self):
        src = self.MOCK_PATH.read_text(encoding="utf-8")
        for band, b in wb.LEVEL_GROUP_ITEM_B.items():
            assert f"{band}: {b}" in src, (
                f"목의 LEVEL_GROUP_ITEM_B에 {band}: {b} 가 없다 — 서버 표와 어긋나면 "
                "같은 문항이 화면마다 다른 난이도로 보인다"
            )
        assert "priorB >= LEVEL_GROUP_ITEM_B.adult" in src, (
            "목이 서버와 같은 임계(adult 이상)를 쓰지 않는다"
        )

"""보드 진행 순서 — 저작 순서 정렬 + 시드 저작 상태.

정렬은 DB 의존이 없는 순수 함수(`order_puzzles_for_progress`)라 DB 없이 고정한다
(test_board_difficulty 관례). 시드 실물의 저작 상태(제목·요약·순서 완비)도 여기서
함께 지킨다 — 하나만 빠져도 카드가 빈 칸으로 뜬다.

⚠️ 순차 잠금은 넣었다가 걷어냈다(2026-08-06) — 학습자가 아무 퍼즐이나 고른다.
순서는 화면 배치(난이도 오름차순 격자)의 근거일 뿐 강제가 아니다.

실행: backend 디렉토리에서 `python -m pytest tests/test_board_progression.py -q`.
"""
import json
import re
from pathlib import Path
from types import SimpleNamespace

from app.routers.board import board_difficulty, order_puzzles_for_progress

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

    def test_난이도가_쉬움_보통_어려움_순으로_단조_증가한다(self):
        """화면이 난이도 순 격자라 순서가 곧 난이도 흐름이다 — 되돌아가면 안 된다."""
        rows = sorted(_board_items(), key=lambda i: i["template_json"]["board_order"])
        diffs = [board_difficulty(i["template_json"], i["level_group"]) for i in rows]
        assert diffs == sorted(diffs), f"난이도가 되돌아간다: {diffs}"

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


class TestDisasterBoards:
    """재난 board 4건이 **실제로 재난을 판정 결과로 낸다** (R13 CO-A3·CO-K4).

    왜 이 테스트가 필요한가 — 이 4건은 원래 「산불 나기 쉬운 날」이라는 제목과
    「산불이 번지기 쉬운」이라는 문두를 달고서 목표가 `clear`(맑음)였다. 제목과
    요약에만 재난이 있고 화면에는 없었다는 뜻이다. 엔진에 재난 현상이 생긴 지금,
    그 상태로 되돌아가는 것을 데이터 쪽에서 막는다:

      ① 재난 개념 태그의 board는 목표 현상이 재난 enum 안이어야 한다
      ② 그 목표가 현행 규칙으로 **실제 도달 가능**해야 한다(팔레트만으로)
      ③ 도달에 쓰는 조절값이 전부 팔레트에 있어야 한다 — 없으면 기본값에 갇혀
        아무리 만져도 목표에 닿지 않는 「풀 수 없는 퍼즐」이 된다
    """

    DISASTER_TAGS = ("wildfire_weather", "flood_response")
    DISASTER_PHENOMENA = frozenset({"wildfire_risk", "flood_risk"})

    def _disaster_items(self) -> list[dict]:
        return [i for i in _board_items() if i["concept_tag"] in self.DISASTER_TAGS]

    def test_재난_board가_4건이다(self):
        assert len(self._disaster_items()) == 10

    def test_목표가_재난_현상이다(self):
        for item in self._disaster_items():
            template = item["template_json"]
            goals = template["goal_conditions"]
            assert goals, template["title"]
            for goal in goals:
                assert goal["phenomenon"] in self.DISASTER_PHENOMENA, (
                    f"{template['title']}: 목표가 {goal['phenomenon']} — 재난 문항의 "
                    "목표가 재난이 아니면 제목만 재난이고 화면은 다른 말을 한다"
                )

    def test_현행_규칙으로_실제_도달_가능하다(self):
        """팔레트가 허용하는 조절값만으로 목표 현상을 만들어 낼 수 있는가."""
        from app.services import board_engine

        rules = board_engine.load_rules()
        for item in self._disaster_items():
            template = item["template_json"]
            palette = template["palette"]
            goals = template["goal_conditions"]

            # 목표 현상을 내는 규칙을 찾아 그 조건을 팔레트 조절값으로 만족시킨다
            for goal in goals:
                matching = [
                    r for r in rules if r["then"]["phenomenon"] == goal["phenomenon"]
                ]
                assert matching, f"{goal['phenomenon']}을(를) 내는 규칙이 없다"
                rule = matching[0]
                for condition in rule["when"]:
                    kind, *rest = board_engine.parse_condition(condition)
                    assert kind == "numeric", (
                        f"{template['title']}: 재난 규칙이 배치 요소를 요구하는데 "
                        "팔레트 도달 가능성을 여기서 보장할 수 없다"
                    )
                    field = rest[0]
                    assert field in palette, (
                        f"{template['title']}: 규칙이 {field}를 요구하는데 팔레트에 "
                        f"없다({palette}) — 기본값에 갇혀 풀 수 없는 퍼즐이 된다"
                    )

            # 실제로 판정을 돌려 목표가 성립하는지 확인 (권위 엔진 그대로)
            elements = []
            for goal in goals:
                rule = next(
                    r for r in rules if r["then"]["phenomenon"] == goal["phenomenon"]
                )
                for condition in rule["when"]:
                    _, field, op, value = board_engine.parse_condition(condition)
                    elements.append(
                        {
                            "type": field,
                            "level": min(100, value + 5) if op == ">=" else max(0, value - 5),
                            "zone": goal["zone"],
                        }
                    )
            board = {"zones": list(board_engine.ZONES), "elements": elements}
            phenomena = board_engine.evaluate(board, rules)
            assert board_engine.check_goals(phenomena, goals), (
                f"{template['title']}: 팔레트대로 조절해도 목표에 닿지 않는다 — "
                f"{[p['phenomenon'] for p in phenomena]}"
            )


# ── 학습 수준 잠금 (2026-08-10 사용자 지시) ──────────────────────────────────
#
# 초등은 쉬움만, 중·고등은 쉬움·보통, 성인은 전부. 열쇠는 진도가 아니라
# `users.level_group`이다.
#
# ⚠️ 이 파일 머리말이 「순차 잠금은 걷어냈다」고 적어 둔 것과 **어긋나지 않는다**.
# 걷어낸 것은 퍼즐 하나하나가 앞 퍼즐을 요구하던 잠금이고(고를 자유가 없었다),
# 여기는 난이도 묶음 자체를 수준으로 여닫을 뿐 묶음 **안에서는** 아무거나 고른다.
#
# ⚠️ 같은 날의 첫 판은 「쉬움 전건 클리어 → 보통 개방」이었고 그 테스트가 여기
# 있었다. 뒤집힌 이유는 심사다 — 로그인 없이 여는 화면에서 쉬움 23칸을 깨야
# 보통이 열리면 심사위원은 보통·어려움을 못 본다(HACKATHON_RULES).
#
# 규칙은 DB를 안 타는 순수 함수라 여기서 전 분기를 고정한다.
import pytest

from app.routers.board import BAND_MAX_DIFFICULTY, locked_difficulties


def test_초등은_쉬움만_열린다():
    assert locked_difficulties("elementary") == {2, 3}


def test_중고등은_쉬움과_보통이_열린다():
    assert locked_difficulties("middle_high") == {3}


def test_성인은_전부_열린다():
    assert locked_difficulties("adult") == set()


def test_expert도_전부_열린다():
    # board_difficulty가 3에서 클램프하므로 adult 위가 없다 — 같은 결과여야 한다.
    assert locked_difficulties("expert") == locked_difficulties("adult") == set()


@pytest.mark.parametrize("band", [None, "", "unknown_band"])
def test_미상_밴드는_잠그지_않는다(band):
    """표에 없는 밴드가 보드를 통째로 잃는 쪽이 열리는 쪽보다 나쁘다."""
    assert locked_difficulties(band) == set()


def test_진도는_잠금을_바꾸지_않는다():
    """열쇠는 클리어 수가 아니라 수준이다 — 인자에 진도가 들어갈 자리가 없다."""
    import inspect

    params = list(inspect.signature(locked_difficulties).parameters)
    assert params == ["level_group"], (
        f"시그니처가 {params} — 진도 기반 사다리로 되돌아갔는지 확인할 것"
    )


def test_밴드_표가_users_level_group_CHECK와_같다():
    """모델 CHECK 제약이 허용하는 밴드는 전부 표에 있어야 한다 — 빠지면 그 밴드
    유저가 조용히 DEFAULT(전부 열림)로 떨어져 잠금이 무력해진다."""
    from app.models.user import User

    constraint = next(
        c for c in User.__table_args__ if getattr(c, "name", "") == "ck_users_level_group"
    )
    bands = set(re.findall(r"'([a-z_]+)'", str(constraint.sqltext)))
    assert bands == set(BAND_MAX_DIFFICULTY), (
        f"CHECK 제약 {bands} ↔ BAND_MAX_DIFFICULTY {set(BAND_MAX_DIFFICULTY)}"
    )

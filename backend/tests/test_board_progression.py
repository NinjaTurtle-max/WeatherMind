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
import uuid
from pathlib import Path
from types import SimpleNamespace

from app.routers import board as board_router
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


ROUTER_SRC = (
    Path(__file__).resolve().parents[1] / "app" / "routers" / "board.py"
).read_text(encoding="utf-8")


def _func_block(name: str) -> str:
    """`async def <name>(`부터 다음 최상위 정의 직전까지 (test_r10_energy_contract 관례)."""
    start = ROUTER_SRC.index(f"async def {name}(")
    rest = ROUTER_SRC[start:]
    end = re.search(r"\n(?:@router|async def |def )", rest[1:])
    return rest[: end.start() + 1] if end else rest


@pytest.mark.parametrize(
    "func,must_precede",
    [
        # 진입: 구름 검사보다 **먼저** — 순서가 바뀌면 잔량 0인 사람이
        # "구름이 없어서"라는 틀린 이유를 듣는다.
        ("get_puzzle_detail", "require_entry"),
        # 채점: 판정보다 **먼저**. 진입만 막으면 attempt를 직접 POST해서 판정·XP·
        # 왕관·클리어 기록을 다 받아간다 — 잠금이 화면 장식이 된다
        # (2026-08-10 코드 리뷰에서 실제로 뚫려 있던 구멍).
        ("attempt_puzzle", "evaluate_board_answer"),
    ],
)
def test_잠금은_진입과_채점_양쪽에_먼저_걸린다(func, must_precede):
    block = _func_block(func)
    assert "locked_difficulties(user.level_group)" in block, (
        f"{func}에 학습 수준 잠금 검사가 없다"
    )
    assert block.index("locked_difficulties") < block.index(must_precede), (
        f"{func}: 잠금 검사가 {must_precede}보다 뒤에 있다"
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


# ── MT-24 순차 잠금 (2026-08-11 멘토링 피드백) ─────────────────────────────
# ⚠️ 위 **학습 수준 잠금**과 축이 다르다. 둘 다 사용자 지시라 어느 한쪽을
# 버리면 지시 하나를 되돌리게 되므로 두 벌이 함께 산다 — 이 파일이 통째로
# 통과하는 것이 곧 합성이 두 지시를 다 지켰다는 증거다.
# 두 파일이 같은 이름으로 각각 만들어져 병합이 서로를 밀어냈고, 최상위
# 이름 충돌 0을 확인한 뒤 결합했다(2026-08-12).
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


# ── 두 잠금의 합성 (2026-08-12) ────────────────────────────────────────────────
# 이 절이 무는 것은 **합성이 만든 새 실패 모드** 하나다. 두 잠금은 각각 정상인데
# 순서를 잘못 세면 그 조합에서만 학습자가 갇힌다 — 어느 한쪽 테스트로도 안 잡힌다.


def _graded_item(order, difficulty):
    """난이도가 정해진 퍼즐 — board_difficulty가 그 값을 내도록 template를 짠다.

    ⚠️ 난이도를 인자로 받는 대신 **실제 산출 규칙을 태운다.** 여기서 값을 꾸며
    넣으면 규칙이 바뀌었을 때 이 테스트만 옛 세계에서 초록으로 남는다.
    """
    template = {"board_order": order}
    if difficulty >= 2:
        template["mode"] = "goal_only"
    else:
        template["mode"] = "guided"
    if difficulty >= 3:
        template["time_limit_sec"] = 120
    return SimpleNamespace(
        id=uuid.uuid4(),
        template_json=template,
        level_group="middle_high",
        concept_tag="air_mass",
    )


class TestTwoLocksCompose:
    def test_초등의_사슬이_보통_칸에서_끊기지_않는다(self):
        """**이 파일에서 가장 중요한 한 건.**

        난이도로 거르지 않고 전체 위에서 순서를 세면, 초등 학습자의 진행 커서
        다음 칸이 「보통」인 순간 거기서 영구히 멈춘다 — 그 칸은 수준 잠금으로
        못 깨고, 커서는 깨야만 넘어간다. 두 잠금이 각각은 옳은데 **조합에서만**
        생기는 갇힘이라, 어느 한쪽 테스트도 이걸 못 본다.
        """
        # 쉬움·보통이 번갈아 나오는 코스 — 2번째가 벌써 보통이다.
        course = [
            _graded_item(0, 1), _graded_item(1, 2), _graded_item(2, 1),
            _graded_item(3, 2), _graded_item(4, 1),
        ]
        pool = board_router.sequenceable(course, "elementary")
        assert [i.template_json["board_order"] for i in pool] == [0, 2, 4], (
            "초등에게 남아야 할 것은 쉬움 3칸이다"
        )

        # 첫 칸을 깨면 **다음 쉬움 칸**이 열려야 한다 — 보통 칸에서 막히면 안 된다.
        unlocked = board_router.compute_unlocked_ids(pool, {pool[0].id})
        assert pool[1].id in unlocked, "쉬움을 깼는데 다음 쉬움이 안 열렸다 — 사슬이 끊겼다"

        # 끝까지 간다: 매번 하나씩 깨도 다음이 계속 열린다.
        cleared = set()
        for item in pool:
            assert item.id in board_router.compute_unlocked_ids(pool, cleared), (
                "초등 학습자가 자기 수준 안에서 끝까지 못 간다"
            )
            cleared.add(item.id)

    def test_잠긴_난이도는_순서_계산에서_빠진다(self):
        """성인은 전부 세고, 초등은 쉬움만 센다 — 세는 대상 자체가 다르다."""
        course = [_graded_item(0, 1), _graded_item(1, 3), _graded_item(2, 1)]
        assert len(board_router.sequenceable(course, "adult")) == 3
        assert len(board_router.sequenceable(course, "elementary")) == 2

    def test_수준을_올리면_셀_대상이_넓어진다(self):
        """PATCH /auth/me로 수준이 바뀌면 재계산이 공짜로 따라온다는 것의 근거."""
        course = [_graded_item(0, 1), _graded_item(1, 2)]
        assert len(board_router.sequenceable(course, "elementary")) == 1
        assert len(board_router.sequenceable(course, "middle_high")) == 2

    def test_순서를_세는_모든_곳이_난이도로_먼저_거른다(self):
        """위 계약이 **실제 경로에 연결돼 있는가** — 순수 함수 테스트의 사각이다.

        `sequenceable`을 직접 부르는 테스트는 라우터가 그것을 **안 써도** 초록이다.
        순서를 세는 곳이 둘(목록·단건)이라 한 곳만 고치면 목록은 열렸다고 그리는데
        진입은 막는 상태가 되고, 그게 이 저장소가 반복해서 겪은 실패다.
        그래서 `compute_unlocked_ids` 호출 전건이 걸러진 목록을 받는지 소스로 본다.
        """
        # `def ` 뒤는 정의라 뺀다 — 거기 오는 것은 인자 이름이지 호출 인자가 아니다.
        for call in re.finditer(r"(?<!def )compute_unlocked_ids\(\s*([^,]+),", ROUTER_SRC):
            arg = call.group(1).strip()
            assert "sequenceable" in arg, (
                f"난이도로 거르지 않은 목록으로 순서를 센다: compute_unlocked_ids({arg}…) "
                "— 초등 학습자의 사슬이 보통 칸에서 영구히 끊긴다"
            )
        assert ROUTER_SRC.count("compute_unlocked_ids(") >= 3, (
            "정의 1 + 호출 2(목록·단건)를 기대했다 — 호출 지점이 줄었다면 "
            "어느 경로가 순차 잠금을 안 보게 된 것이다"
        )

"""보드 진행 순서 — 저작 순서 정렬 + 시드 저작 상태.

정렬은 DB 의존이 없는 순수 함수(`order_puzzles_for_progress`)라 DB 없이 고정한다
(`test_board_difficulty.py` 관례 — 그 파일이 무는 **파생 난이도 축은 2026-08-20에
철거됐고** 지금은 철거 경위만 남았지만, 「순수 규칙은 DB 없이 고정한다」는 관례는
그대로 살아 있다). 시드 실물의 저작 상태(제목·요약·순서 완비)도 여기서 함께 지킨다
— 하나만 빠져도 카드가 빈 칸으로 뜬다.

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
from app.routers.board import order_puzzles_for_progress


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

    def test_목록_첫_칸은_가장_쉬운_입력이다(self):
        """처음 들어온 학습자가 만나는 한 칸 — 여기가 어려우면 문이 닫힌다.

        🔴 **2026-08-20: 파생 점수(`board_difficulty`)가 아니라 입력을 직접 문다**
        (어드바이저 판정). 파생 축이 죽었으므로 그 점수로 물면 **아무 화면에도 없는
        축을 초록 계약이 지키는** 상태가 된다 — 「옳게 돌며 아무것도 안 지킨다」다.
        입력 단정이 임계 비교보다 **강하고 명확**하다.

        ⚠️ 「첫 칸」의 뜻이 바뀌었다 — **런타임 목록의 첫 칸**이다(`board_order` 1번이
        아니다). 정렬 키가 `(층, board_order)`라 층이 먼저 선다.
        🔴 실측으로 남긴다: `board_order` **1번의 지식 단계는 2**이고 전체 최솟값은
        1이다. 새 정렬에서 1번은 **5번째**로 밀린다. 시드를 고치지 않았다 — 클라이언트가
        시드 단계값 손대기를 막았고, 정렬이 그 어긋남을 흡수한다.
        """
        first = order_puzzles_for_progress([
            SimpleNamespace(
                id=i["template_json"]["board_order"],
                template_json=i["template_json"],
                level_group=i["level_group"],
                knowledge_level=i.get("knowledge_level"),
            )
            for i in _board_items()
        ])[0]
        tj = first.template_json
        tiers = [i.get("knowledge_level") for i in _board_items()]
        assert first.knowledge_level == min(t for t in tiers if t), (
            f"목록 첫 칸의 층이 최하층이 아니다: {first.knowledge_level}"
        )
        assert tj.get("mode") == "guided", f"첫 칸이 안내 모드가 아니다: {tj.get('mode')}"
        assert not tj.get("time_limit_sec"), "첫 칸에 시간제한이 걸려 있다"
        assert len(tj.get("palette") or []) <= 2, (
            f"첫 칸 팔레트가 {len(tj.get('palette') or [])}종 — 처음 만나는 칸은 조작이 적어야 한다"
        )

    def test_목록이_층_오름차순으로_선다(self):
        """화면이 순서 격자라 **목록 순서가 곧 흐름**이다 — 되돌아가면 안 된다.

        🔴 **2026-08-20: 지키는 자리가 시드 파일에서 런타임 목록으로 옮겨졌다**
        (어드바이저 판정). 종전에는 시드의 `board_order` 순으로 파생 난이도가 비감소인지
        물었고, 그것이 저작자에게 **「난이도 3짜리는 말미에 append」**라는 규율을
        강제했다. 정렬 키가 `(층, board_order)`가 된 지금 그 규율은 **정렬이 흡수한다** —
        버리는 것이 아니라 **필요 없어진다.**

        ⚠️ **시드를 옛 축 그대로 두고 층 단조를 시드에 물면 빨강이다** — 실측 역전 쌍
        52개가 전부 단계 4 행에서 나오고, 고치려면 시드 단계값을 손대야 하는데 그것이
        막혀 있다. 그래서 **런타임 순서**를 문다.

        ⚠️⚠️ **이 계약은 동어반복 근처다** — 정렬로 만든 성질을 정렬로 확인한다. 값은
        「지금 맞나」가 아니라 **「다음 사람이 키를 되돌리는 회귀를 막는 래칫」**이다.
        정렬 키를 `board_order` 단독으로 되돌리면 **정확히 층 4 → 층 2 이음새에서** 운다.
        """
        rows = order_puzzles_for_progress([
            SimpleNamespace(
                id=i["template_json"]["board_order"],
                template_json=i["template_json"],
                level_group=i["level_group"],
                knowledge_level=i.get("knowledge_level"),
            )
            for i in _board_items()
        ])
        tiers = [r.knowledge_level for r in rows]
        assert tiers == sorted(tiers), f"목록에서 층이 되돌아간다: {tiers}"
        # 2차 키 — 같은 층 안에서는 저작 순서(board_order)가 산다
        for tier in set(tiers):
            same = [r.template_json["board_order"] for r in rows if r.knowledge_level == tier]
            assert same == sorted(same), f"층 {tier} 안에서 저작 순서가 뒤집혔다: {same}"

    def test_시드_board의_층이_정의역_안이다(self):
        """🔴 **파생 라벨 정의역 단정의 새 축 짝** (2026-08-20).

        종전에는 `board_difficulty(...) in (1, 2, 3)`으로 **파생 라벨**이 정의역
        안인지를 가짜 픽스처 위에서 봤다. 새 축은 저작값이라 정의역을 벗어날 수 있는
        곳이 **시드 실물**이고, 벗어나면 그 퍼즐은 `locked_tiers`의 어느 층에도 안
        걸려 **천장을 올려도 영구히 안 열린다**(`BOARD_TIERS` 밖이므로).

        ⚠️ **미저작(`None`)은 탈락 사유로 쓰지 않는다.** 「반드시 있다」로 물면
        `locked_tiers(None)`·`board_tier`의 **「미상은 잠그지 않는다」 정책과 정면으로
        어긋난다** — 정책이 허용하는 상태를 계약이 금지하면 둘 중 하나가 거짓이 된다.
        실측(2026-08-20): board **64건 · knowledge_level 전건 정수 · None 0건 ·
        분포 1:4 2:4 3:7 4:26 5:5 6:2 7:4 8:4 9:5 10:3**. 지금 0건이라도 계약은
        None을 허용한 채 **정의역만** 문다.
        ⚠️ 그래서 아래 첫 두 단정이 있다 — 전건 미저작·빈 목록이면 정의역 단정이
        아무것도 안 보면서 초록이 된다(빈 필터가 통과하는 그 형태).
        """
        tiers = [i.get("knowledge_level") for i in _board_items()]
        assert tiers, "시드에 board 문항이 없다 — 아래 단정이 공허해진다"
        assert any(isinstance(t, int) for t in tiers), (
            "board 전건이 미저작(knowledge_level=None)이다 — 정의역 단정이 공허해진다"
        )
        out = [t for t in tiers if t is not None and t not in board_router.BOARD_TIERS]
        assert not out, (
            f"층이 정의역({board_router.BOARD_TIERS[0]}~{board_router.BOARD_TIERS[-1]}) 밖인 퍼즐: {out} "
            "— 어느 층에도 안 걸려 천장을 올려도 영구히 안 열린다"
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


def _reachable_with(rule: dict, palette: list) -> bool:
    """이 팔레트로 규칙의 **모든** 조건에 도달할 수 있는가.

    🔴 **2026-08-18 정정 — 종전 판은 「전 조건이 numeric」을 요구했다.** 그래서
    존재 조건(`air_mass:siberian`·`front:stationary`)을 가진 규칙이 **통째로
    제외**됐고, 도달성 검사가 **레거시 2조건 규칙으로 인증**하며 헤드라인 규칙을
    한 번도 밟지 않았다. 계측기가 눈을 감은 것이다(리뷰 차단 4).
    ⚠️ 그때 주석에 *"재난 퍼즐 팔레트에는 슬라이더뿐"*이라 적었는데 ㉣이 추가한
    보드에서는 **거짓**이다 — 둘 다 팔레트에 존재 조건이 있다.

    프론트 `conditionReachable`과 같은 의미로 판정한다: 존재 조건은 팔레트에
    그 요소가 있으면 도달 가능(초기 배치가 비어 있는 시드에서는 그것이 유일한 길),
    수치 조건은 그 슬라이더가 팔레트에 있으면 도달 가능.
    """
    from app.services import board_engine

    for condition in rule["when"]:
        parsed = board_engine.parse_condition(condition)
        if parsed[0] == "presence":
            if f"{parsed[1]}:{parsed[2]}" not in palette:
                return False
        elif parsed[1] not in palette:
            return False
    return True


def _placement_for(rule: dict, zone: int) -> list[dict]:
    """규칙이 성립하는 최소 배치 — 존재 조건은 놓고, 수치 조건은 임계를 ±5 넘긴다."""
    from app.services import board_engine

    out = []
    for condition in rule["when"]:
        parsed = board_engine.parse_condition(condition)
        if parsed[0] == "presence":
            out.append({"type": parsed[1], "subtype": parsed[2], "zone": zone})
            continue
        _, field, op, value = parsed
        out.append({
            "type": field,
            "level": min(100, value + 5) if op == ">=" else max(0, value - 5),
            "zone": zone,
        })
    return out


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
    DISASTER_PHENOMENA = frozenset({"wildfire_risk", "flood_risk", "wildfire_warning", "flood_warning"})

    def _disaster_items(self) -> list[dict]:
        return [i for i in _board_items() if i["concept_tag"] in self.DISASTER_TAGS]

    def test_재난_board_수_고정(self):
        """⚠️ 이름이 「4건이다」였는데 값은 이미 10이었다 — 이름과 값이 갈려 있었다.
        개수는 저작으로 계속 자라므로 **이름에 수를 적지 않는다**(2026-08-18 정정).

        ㉣ 개통(2026-08-18): 10 → **12**. 새 4조건 규칙을 쓰는 상위 보드 2판
        (산불 kl9 · 침수 kl10)이 재난 축에 들어왔다 — 소나기판은 재난이 아니다.
        """
        assert len(self._disaster_items()) == 12

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
                # ⚠️ **종전에는 `matching[0]`을 그대로 썼다** — 규칙 파일이 priority
                # 내림차순이라 「그 현상을 내는 첫 규칙」이 곧 이 퍼즐이 쓰는 규칙이라는
                # 가정이었다. 2026-08-18 ㉣ 개통으로 **조건 4개짜리 재난 규칙이 맨 위로
                # 오면서** 그 가정이 깨졌다(그 규칙은 `front:stationary` 같은 배치 요소를
                # 요구하는데 재난 퍼즐 팔레트에는 슬라이더뿐이다).
                # 퍼즐이 실제로 쓰는 것은 **그 팔레트로 도달 가능한 규칙**이므로 그것을
                # 고른다 — 이러면 규칙이 더 늘어도 이 테스트가 흔들리지 않는다.
                reachable = [r for r in matching if _reachable_with(r, palette)]
                assert reachable, (
                    f"{template['title']}: 목표 {goal['phenomenon']}을(를) 이 팔레트"
                    f"({palette})로 도달 가능한 규칙이 하나도 없다 — 풀 수 없는 퍼즐이다"
                )
                # ⚠️ 종전에는 여기서 「전 조건이 numeric이고 팔레트에 있다」를 단정했다.
                # `_reachable_with`가 존재 조건까지 같은 의미로 판정하므로 중복이고,
                # 그 단정이 **존재 조건을 가진 규칙을 거부**해 계측기를 눈감게 했다
                # (리뷰 차단 4). 도달 가능성은 위 `reachable` 필터가 소유한다.
                rule = reachable[0]

            # 실제로 판정을 돌려 목표가 성립하는지 확인 (권위 엔진 그대로)
            elements = []
            for goal in goals:
                # 위와 같은 이유로 **팔레트로 도달 가능한** 규칙을 고른다(2026-08-18).
                # `next(...)`로 첫 규칙을 집으면 조건에 배치 요소가 섞여 unpack이 깨진다.
                rule = next(
                    r for r in rules
                    if r["then"]["phenomenon"] == goal["phenomenon"]
                    and _reachable_with(r, palette)
                )
                elements.extend(_placement_for(rule, goal["zone"]))
            board = {"zones": list(board_engine.ZONES), "elements": elements}
            phenomena = board_engine.evaluate(board, rules)
            assert board_engine.check_goals(phenomena, goals), (
                f"{template['title']}: 팔레트대로 조절해도 목표에 닿지 않는다 — "
                f"{[p['phenomenon'] for p in phenomena]}"
            )


# ── 학습 수준 잠금 (2026-08-10 사용자 지시) ──────────────────────────────────
#
# **천장 위 층은 잠기고 천장 이하는 열린다.** 열쇠는 진도가 아니라 학습 수준이다.
#
# 🔴 **2026-08-20 축 교체**: 종전에는 열쇠가 `users.level_group`이고 잠기는 것이
# **학령 파생 난이도 3칸**이었다(*"초등은 쉬움만, 중·고등은 쉬움·보통, 성인은 전부"*).
# 지금은 **지식 단계(1~N, 유닛과 같은 축)**이고 천장의 출처는 `learner_tier()`
# (θ 파생 1순위 · 밴드 폴백 2순위)다. **규칙의 형태는 그대로**라 아래 단정들은
# 뜻을 그대로 옮겨 적은 것이다 — 바뀐 것은 층의 개수와 천장의 출처뿐이다.
# ⚠️ 그래서 **테스트 이름을 밴드로 부르면 거짓이 된다**: 실측 밴드 폴백은
# 초등 1 · 중고등 3 · 성인 5 · expert 7이므로 「성인 = 천장 10」 같은 이름은
# 아무 근거가 없다(2026-08-20 개명 — 이름을 성질로 되돌렸다).
#
# ⚠️ 이 파일 머리말이 「순차 잠금은 걷어냈다」고 적어 둔 것과 **어긋나지 않는다**.
# 걷어낸 것은 퍼즐 하나하나가 앞 퍼즐을 요구하던 잠금이고(고를 자유가 없었다),
# 여기는 층 자체를 수준으로 여닫는다. ⚠️ 다만 「열린 묶음 안에서는 아무거나」는
# 더 이상 참이 아니다 — MT-24·결함 ⑨가 **자기 층 안의 순차**를 되살렸다.
#
# ⚠️ 같은 날의 첫 판은 「쉬움 전건 클리어 → 보통 개방」이었고 그 테스트가 여기
# 있었다. 뒤집힌 이유는 심사다 — 로그인 없이 여는 화면에서 쉬움 23칸을 깨야
# 보통이 열리면 심사위원은 보통·어려움을 못 본다(HACKATHON_RULES). 새 축도 이
# 판단을 물려받는다: **천장이 진도가 아니라 수준에서 온다.**
#
# 규칙은 DB를 안 타는 순수 함수라 여기서 전 분기를 고정한다(천장 조회만 DB를 탄다).
import pytest

from app.routers.board import locked_tiers
# 층의 개수를 여기 적지 않는다(CLAUDE.md §0-2) — 소유자는 라우터가 인용하는 그 한 곳이다.
from app.schemas.progress import KNOWLEDGE_LEVEL_MAX
from app.services import weatherbrain_service


@pytest.mark.parametrize("ceiling", list(range(1, KNOWLEDGE_LEVEL_MAX + 1)))
def test_천장_위_전_층이_잠긴다(ceiling):
    """종전 이름은 「초등은 쉬움만」·「중고등은 쉬움과 보통」이었고 **거짓이 됐다**
    (초등의 천장은 1이 아니라 밴드 폴백 1·θ 기본 2이고, 중고등은 3이다).
    단정이 물던 것은 밴드 매핑이 아니라 `locked_tiers`의 **정의역 성질**이라
    이름만 성질로 되돌리고, 두 칸만 보던 것을 **전 천장으로 넓혔다**(2026-08-20).

    ⚠️ 기대값을 `{t for t in BOARD_TIERS if t > ceiling}`로 쓰지 않는다 — 그것은
    프로덕션 식 그대로라 계약이 자기 자신을 읽고 만족한다. `range`로 독립 서술한다.
    """
    assert locked_tiers(ceiling) == set(range(ceiling + 1, KNOWLEDGE_LEVEL_MAX + 1))


@pytest.mark.parametrize("ceiling", list(range(1, KNOWLEDGE_LEVEL_MAX + 1)))
def test_천장_이하는_한_층도_잠기지_않는다(ceiling):
    """반대 방향의 off-by-one — 자기 층이 잠기면 그 학습자는 열린 판이 0이 된다."""
    assert not locked_tiers(ceiling) & set(range(1, ceiling + 1))


def test_천장이_정의역_상한이면_아무것도_잠기지_않는다():
    assert locked_tiers(KNOWLEDGE_LEVEL_MAX) == set()


def test_천장이_정의역을_넘어도_같다():
    """종전 이름은 「expert도 전부 열린다」였고 사유가 *"board_difficulty가 3에서
    클램프하므로"*였다 — 그 함수는 철거됐다. 단정이 실제로 물던 것은 **정의역을
    넘는 천장에서도 결과가 같다**(위쪽 클램프)는 성질이다."""
    assert locked_tiers(KNOWLEDGE_LEVEL_MAX + 1) == locked_tiers(KNOWLEDGE_LEVEL_MAX) == set()


def test_천장_미상은_아무것도_잠그지_않는다():
    """못 여는 것이 열리는 것보다 나쁘다 — `DEFAULT_MAX_DIFFICULTY`의 관례 승계."""
    assert locked_tiers(None) == set()


@pytest.mark.parametrize("band", [None, "", "unknown_band"])
def test_미상_밴드는_보드를_통째로_잃지_않는다(band):
    """표에 없는 밴드가 보드를 통째로 잃는 쪽이 열리는 쪽보다 나쁘다.

    🔴 **축 교체로 단정 모양이 바뀌었다**(2026-08-20). 종전에는 밴드가 잠금 표의
    **키**여서 표에 없으면 `DEFAULT_MAX_DIFFICULTY`(전부 열림)로 떨어졌고, 그래서
    「밴드가 미상이면 안 잠근다」로 물었다. 새 축에서 밴드는 천장의 **폴백 출처**일
    뿐이다 — `learner_tier`가 `if band:`로 갈라 참일 때만 밴드 표를 읽으므로
    여기서도 같은 분기를 태운다(안 태우면 프로덕션이 가지 않는 길을 무는 셈이다).
    """
    ceiling = weatherbrain_service.knowledge_level_of_level_group(band) if band else None
    opened = set(range(1, KNOWLEDGE_LEVEL_MAX + 1)) - locked_tiers(ceiling)
    assert opened, f"밴드 {band!r}의 천장 {ceiling}에서 전 층이 잠겼다"
    if ceiling is not None:
        assert ceiling in opened, "자기 천장 층이 잠겼다"


def test_진도는_잠금을_바꾸지_않는다():
    """열쇠는 클리어 수가 아니라 수준이다 — 인자에 진도가 들어갈 자리가 없다.

    🔴 축 교체(2026-08-20): 종전에는 `locked_difficulties(level_group)`의 시그니처를
    봤다. 그 함수는 철거됐고 성질은 `locked_tiers(ceiling)`가 이어받았다 — 인자가
    학령에서 **정수 천장**으로 바뀌었을 뿐 「진도가 인자에 없다」는 그대로다.
    """
    import inspect

    params = list(inspect.signature(locked_tiers).parameters)
    assert params == ["ceiling"], (
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
    assert "locked_tiers(" in block, (
        f"{func}에 학습 수준 잠금 검사가 없다"
    )
    assert block.index("locked_tiers") < block.index(must_precede), (
        f"{func}: 잠금 검사가 {must_precede}보다 뒤에 있다"
    )


def _check_constraint_bands() -> set[str]:
    """`users.level_group` CHECK 제약이 허용하는 밴드 — DB가 실제로 받는 값 집합."""
    from app.models.user import User

    constraint = next(
        c for c in User.__table_args__ if getattr(c, "name", "") == "ck_users_level_group"
    )
    return set(re.findall(r"'([a-z_]+)'", str(constraint.sqltext)))


@pytest.mark.parametrize("band", sorted(_check_constraint_bands()))
def test_CHECK가_받는_밴드는_전부_자기_천장을_갖는다(band):
    """CHECK 제약이 허용하는 밴드는 전부 **천장 표**에 있어야 한다 — 빠지면 그 밴드
    유저의 천장이 조용히 **중립 밴드의 천장**으로 떨어진다.

    🔴 **축 교체로 실패 모드가 바뀌었다**(2026-08-20). 종전 단정은
    `set(BAND_MAX_DIFFICULTY)`와 대조했고 독스트링이 *"빠지면 그 밴드 유저가 조용히
    DEFAULT(전부 열림)로 떨어져 잠금이 무력해진다"*고 적었다. 새 축의 천장 표는
    `weatherbrain_service.KNOWLEDGE_LEVEL_BANDS`이고 그 표에 없는 밴드는
    `knowledge_level_of_level_group`이 **NEUTRAL_LEVEL_GROUP(중고등)의 최하 단계**로
    받는다 — 즉 결과가 「전부 열림」이 아니라 **반대로 과잉 잠금**이다(expert 유저가
    천장 7이 아니라 3을 받아 4층 이상을 통째로 잃는다). 실패 모드가 뒤집혔으므로
    옛 문장을 지우지 않고 정정해 남긴다(CLAUDE.md §0-5).

    ⚠️ **`test_two_axis_levels.py`와 중복이 아니다.** 그쪽은 표 자체의 정합
    (CHECK ↔ `LEVEL_GROUP_BANDS` ↔ `KNOWLEDGE_LEVEL_BANDS` 왕복)을 소유하고,
    여기가 무는 것은 **보드 잠금의 천장 출처가 그 표에 묶여 있다**는 것이다
    (`learner_tier`의 밴드 폴백 → `locked_tiers`). 나중에 「중복이니 지우자」로
    읽히지 않게 이 차이를 적어 둔다.
    """
    ceiling = weatherbrain_service.knowledge_level_of_level_group(band)
    assert ceiling in range(1, KNOWLEDGE_LEVEL_MAX + 1), (
        f"{band}의 천장 {ceiling}이 층의 정의역 밖이다"
    )
    # 판별 단정 — 표에서 밴드가 빠지면 중립 폴백으로 떨어지고 왕복이 깨진다.
    assert weatherbrain_service.level_group_of_knowledge_level(ceiling) == band, (
        f"{band}의 천장 {ceiling}이 다른 밴드({weatherbrain_service.level_group_of_knowledge_level(ceiling)})"
        "의 층이다 — CHECK가 받는 밴드가 천장 표에서 빠졌다"
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


def _graded_item(order, tier):
    """🔴 **층이 정해진 퍼즐** (2026-08-20 축 교체).

    종전에는 `board_difficulty`가 목표값을 내도록 `template`을 꾸몄다 — *"난이도를
    인자로 받는 대신 실제 산출 규칙을 태운다"*는 이유였고 그때는 옳았다(난이도가
    **파생값**이었으므로 규칙을 안 태우면 이 테스트만 옛 세계에 남았다).

    ⚠️ **새 축은 파생이 아니라 저작값**이다(`content_items.knowledge_level`). 태울
    규칙이 없으므로 값을 그대로 붙이는 것이 옳고, 오히려 template을 꾸미면
    **없는 파생을 흉내내는** 것이 된다.
    """
    return SimpleNamespace(
        id=uuid.uuid4(),
        template_json={"board_order": order},
        level_group="middle_high",
        concept_tag="air_mass",
        knowledge_level=tier,
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
        pool = board_router.sequenceable(course, 1)
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
        assert len(board_router.sequenceable(course, 3)) == 3
        assert len(board_router.sequenceable(course, 1)) == 2

    def test_수준을_올리면_셀_대상이_넓어진다(self):
        """PATCH /auth/me로 수준이 바뀌면 재계산이 공짜로 따라온다는 것의 근거."""
        course = [_graded_item(0, 1), _graded_item(1, 2)]
        assert len(board_router.sequenceable(course, 1)) == 1
        assert len(board_router.sequenceable(course, 2)) == 2

    def test_순서를_세는_모든_곳이_난이도로_먼저_거른다(self):
        """위 계약이 **실제 경로에 연결돼 있는가** — 순수 함수 테스트의 사각이다.

        `sequenceable`을 직접 부르는 테스트는 라우터가 그것을 **안 써도** 초록이다.
        순서를 세는 곳이 둘(목록·단건)이라 한 곳만 고치면 목록은 열렸다고 그리는데
        진입은 막는 상태가 되고, 그게 이 저장소가 반복해서 겪은 실패다.
        그래서 `compute_unlocked_ids` 호출 전건이 걸러진 목록을 받는지 소스로 본다.

        🔴 **2026-08-19 갱신(결함 ⑨)**: 허용 목록에 `ceiling_tier`를 더한다.
        그 함수는 난이도가 **천장과 같은 것만** 남기므로 `sequenceable`(천장 **이하**
        전부)보다 **더 강한 필터**다 — 이 계약의 의도(「난이도로 먼저 거른다」)를
        더 좁게 만족한다. 이름만 보는 가드라 **의도는 지켰는데 빨강이 났고**, 그것이
        이 가드가 값을 한다는 증거이기도 하다(경로가 바뀌면 사람이 보게 만든다).
        ⚠️ 허용 목록을 늘릴 때는 **그 함수가 정말 난이도로 거르는지** 확인할 것 —
        이름만 맞고 안 거르면 이 계약이 장식이 된다.
        """
        # `def ` 뒤는 정의라 뺀다 — 거기 오는 것은 인자 이름이지 호출 인자가 아니다.
        DIFFICULTY_FILTERS = ("sequenceable", "ceiling_tier")
        for call in re.finditer(r"(?<!def )compute_unlocked_ids\(\s*([^,]+),", ROUTER_SRC):
            arg = call.group(1).strip()
            assert any(f in arg for f in DIFFICULTY_FILTERS), (
                f"난이도로 거르지 않은 목록으로 순서를 센다: compute_unlocked_ids({arg}…) "
                "— 초등 학습자의 사슬이 보통 칸에서 영구히 끊긴다"
            )
        assert ROUTER_SRC.count("compute_unlocked_ids(") >= 3, (
            "정의 1 + 호출 2(목록·단건)를 기대했다 — 호출 지점이 줄었다면 "
            "어느 경로가 순차 잠금을 안 보게 된 것이다"
        )


class TestLevelUnlocksBelowCeiling:
    """🔴 결함 ⑨ — **수준이 천장만 올리고 시작 위치를 안 옮기던 것** (2026-08-19).

    실서버 실측: `level_group=adult` 계정이 `/board`에서 **49판 중 01~04만** 열렸고
    05부터 전건 🔒「앞 퍼즐부터」였다. `ko.js`가 *"보드에서 열리는 난이도가 이 설정을
    따라가요"*라고 약속하는데 지켜지지 않았다.

    실측한 원인은 `sequenceable`이 **아니다** — 그것은 이미 난이도로 먼저 거르고
    있었다(2026-08-12 판정이 그 자리를 고쳤다). 원인은 `compute_unlocked_ids`가
    **거른 목록의 맨 앞부터** 센다는 것이었다: 갓 시작한 성인은 `cursor=0`이라
    LOOKAHEAD 3칸만 열린다. **⑧과 같은 뿌리**(수준이 「최대치」만 정하고 시작 위치는
    언제나 1번)다.

    고침은 선행 학습 앱의 관례를 따른다 — **「수준을 인정받으면 그 아래는 열린다」**이지
    **「순서를 없앤다」가 아니다.** 순차(MT-24)는 **천장 난이도 안에서 그대로** 산다.
    """

    @staticmethod
    def _items(counts: dict[int, int]):
        """**층별 개수**로 가짜 퍼즐 목록을 만든다 (2026-08-20 축 교체).

        ⚠️ 종전에는 `board_difficulty`가 목표 난이도를 내도록 `mode`·`palette`·밴드를
        꾸몄다. 새 축은 **저작값**이라 꾸밀 파생이 없다 — 층을 그대로 붙인다.
        """
        out = []
        n = 0
        for tier, count in sorted(counts.items()):
            for _ in range(count):
                n += 1
                out.append(SimpleNamespace(
                    id=n,
                    template_json={"board_order": n},
                    level_group="middle_high",
                    knowledge_level=tier,
                ))
        return out

    def test_천장3은_아래_층이_전부_열린다(self):
        """AC(결함 ⑨): 자기 층보다 아래가 있는 학습자는 열린 판이 **4판보다 많아야**
        한다 — 실서버에서 `adult` 계정이 49판 중 01~04만 봤다.

        🔴 종전 이름은 「성인은…」이었고 **거짓이 됐다**(2026-08-20 개명): 새 축에서
        성인의 밴드 폴백 천장은 3이 아니라 **5**다. 여기서 3은 「학령」이 아니라
        픽스처가 만든 세 층 중 맨 위라는 뜻이고, 무는 성질(아래층 인정 + 자기 층
        순차)은 천장이 몇이든 같다.
        """
        items = self._items({1: 10, 2: 8, 3: 6})
        # 🔴 축 교체(2026-08-20). 종전 단정은 픽스처가 꾸민 `template_json`에서
        # `board_difficulty`가 정말 1·2·3을 내는지 봤다 — 파생축 시절에는 픽스처가
        # 규칙을 태워야 뜻이 있었기 때문이다. 새 축은 **저작값**이므로 같은 자리에서
        # 물 것은 「라우터가 읽는 층 = 저작값」이다(`board_tier`가 다른 속성을 보게
        # 바뀌면 아래 개수 단정이 통째로 무의미해지므로 여기서 먼저 잡는다).
        for it in items:
            assert board_router.board_tier(it) == it.knowledge_level
        unlocked = board_router.compute_unlocked_ids(
            board_router.ceiling_tier(items, 3), set()
        ) | board_router.below_ceiling_ids(items, 3)
        # 1·2층 18판이 인정되고 3층에서 순차(커서 + LOOKAHEAD 2 = 3판)
        assert len(unlocked) > 4, f"천장 3인데 {len(unlocked)}판만 열렸다"
        assert len(unlocked) == 18 + 3, sorted(unlocked)

    def test_최하층_천장은_아무것도_안_바뀐다(self):
        """🔴 **천장을 여는 수정이 바닥을 무너뜨리지 않는다.**

        천장이 1이면 「아래」가 비어 있고 1층이 곧 자기 층이라 순차 그대로다.
        어려운 판이 갑자기 열리면 안 된다.

        🔴 종전 이름은 「초등은…」이었다. 밴드 폴백으로는 초등이 실제로 1이지만
        θ 파생 기본값은 **2**라 이름이 밴드·θ 둘 중 어느 사다리를 말하는지 갈린다
        (라우터가 그 어긋남을 대장에 남겼다) — 그래서 **천장 값**으로 부른다.
        """
        items = self._items({1: 10, 2: 8, 3: 6})
        unlocked = board_router.compute_unlocked_ids(
            board_router.ceiling_tier(items, 1), set()
        ) | board_router.below_ceiling_ids(items, 1)
        assert len(unlocked) == 3, f"천장 1에 {len(unlocked)}판이 열렸다"
        opened = [i for i in items if i.id in unlocked]
        # 🔴 뜻은 그대로, 축만 새것 — 「자기 층 밖이 열리지 않았다」.
        assert all(board_router.board_tier(i) == 1 for i in opened), (
            "천장 1인 학습자에게 1층 밖 퍼즐이 열렸다"
        )

    def test_천장2는_1층만_인정된다(self):
        """🔴 종전 이름은 「중고등은…」이었고 거짓이다 — 중고등의 밴드 폴백 천장은
        2가 아니라 **3**이다(2026-08-20 개명). 무는 성질은 「천장 아래 한 층은 전부
        인정 + 자기 층은 순차」로 천장 값과 무관하게 같다.
        """
        items = self._items({1: 10, 2: 8, 3: 6})
        unlocked = board_router.compute_unlocked_ids(
            board_router.ceiling_tier(items, 2), set()
        ) | board_router.below_ceiling_ids(items, 2)
        assert len(unlocked) == 10 + 3, sorted(unlocked)

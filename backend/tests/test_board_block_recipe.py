"""board 블록(오늘 날씨 반영 보드) 배선 계약 — SPRINT_R13_02 §T3 ⑵·⑶.

배합이 `{live:2, new:4, review:3, board:1}`로 바뀌면서 `board`가 **kind**로
들어왔다. 계약서에는 있는데 발급 루프가 모르는 kind였고, 그 상태에서는 배합의
한 자리가 그냥 빠져 유료 생성으로 샜다. 이 파일이 고정하는 것 다섯:

1. board 블록이 실제로 board 문항을 낸다 (kind='board')
2. **선점** — 오늘 현상에 맞춰 고른 그 보드를 new 블록이 집어가지 않는다
3. board 풀이 비어도 **총합이 유지**되고 유료 생성이 안 불린다 (0문항 세션 금지)
4. 실황 캐시가 비면(KMA 부재) 판정이 None이고 **board_order 폴백으로 성립**한다
5. **라우터까지 간다** — `SessionItem.kind` Literal에 'board'가 없으면 서비스
   계층은 전부 초록인데 `GET /session/today`만 응답 검증에서 500이다.
   그 결함이 실제로 있었고(2026-08-12 PM이 닫음) 서비스 테스트만으로는 다시 숨는다.

board 문항은 `uses_live_slots=false`라 **슬롯 치환 대상이 아니다** — 오늘 현상은
문항을 *고르는* 데만 쓴다. 그 사실도 계약으로 박는다(계약 6).

DB 불필요(풀 조회·채번만 대역). 실행: backend에서
`python -m pytest tests/test_board_block_recipe.py -q`.
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.routers import session as session_router
from app.services import session_service as ss
from app.services import weather_phenomenon as wp

RECIPE = ss.DEFAULT_RECIPE
BOARD_COUNT = RECIPE.get("board", 0)

pytestmark = pytest.mark.skipif(
    not BOARD_COUNT, reason="SESSION_RECIPE에 board 블록이 없다 (env 튜닝)"
)

# 판정이 'shower'로 떨어지는 예보 — 사다리의 PTY 소나기 분기.
SHOWER_WEATHER = {
    "region": "서울",
    "forecasts": [{"datetime": "202608120900", "PTY": 4.0, "POP": 60.0, "TMP": 30.0}],
}


# ═══════════════════════════════════════════════════════════════
# 대역
# ═══════════════════════════════════════════════════════════════


def make_item(prefix, i, question_type="multiple_choice", template=None):
    """뱅크 문항 대역 — create_daily_session이 읽는 필드만."""
    return SimpleNamespace(
        id=f"{prefix}-{i}",
        template_json=template or {"question_text": f"{prefix}-{i}?", "correct_answer": "a"},
        concept_tag="pressure_front",
        question_type=question_type,
        knowledge_level=3,
    )


def make_board(item_id, phenomenon=None, order=None, kl=3):
    template = {"question_text": f"{item_id} 퍼즐", "palette": ["sun", "moisture"]}
    if phenomenon is not None:
        template["goal_conditions"] = [{"zone": 1, "phenomenon": phenomenon}]
    if order is not None:
        template["board_order"] = order
    item = make_item(item_id, "", "board", template)
    item.knowledge_level = kl   # 컬럼이다 — template_json 밖
    return item


class _DB:
    """create_daily_session이 쓰는 add/flush만 — 조회는 전부 monkeypatch."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


def issue(
    monkeypatch, *, boards=None, weather=SHOWER_WEATHER, new=20, shared_pool=None,
    theta=None,
):
    """실제 `create_daily_session`을 돌린다 — 배합·매칭·메타 기록은 실코드가 한다."""
    new_pool = shared_pool if shared_pool is not None else [
        make_item("new", i) for i in range(new)
    ]
    # review·live는 넉넉히 채운다 — 비워 두면 그 부족분까지 new로 흘러
    # "new가 몇 자리를 메웠나"라는 단정이 board 블록의 것인지 알 수 없게 된다.
    review_pool = [] if shared_pool is not None else [
        make_item("rev", i) for i in range(RECIPE["review"])
    ]
    live_pool = [] if shared_pool is not None else [
        make_item("live", i) for i in range(RECIPE["live"])
    ]
    board_pool = [] if boards is None else list(boards)

    async def fake_pools(db, u, weak, theta=None, today=None):
        return list(new_pool), list(review_pool), list(live_pool)

    async def fake_board_pool(db, u, theta, today_subq, limit=ss.BOARD_POOL_LIMIT):
        return list(board_pool)

    async def fake_unit_pool(db, u, abilities, count):
        return [], None

    async def fake_weather(*args, **kwargs):
        return weather

    async def no_generate(**kwargs):
        raise AssertionError(
            "quiz-generate 폴백이 불렸다 — board 자리가 유료 생성으로 샜다"
        )

    monkeypatch.setattr(ss, "_fetch_pools", fake_pools)
    monkeypatch.setattr(ss, "_fetch_board_pool", fake_board_pool)
    monkeypatch.setattr(ss, "_fetch_unit_pool", fake_unit_pool)
    monkeypatch.setattr(ss, "_load_weak_tag_rows", lambda db, u: _async([]))
    monkeypatch.setattr(ss.weatherbrain_service, "refresh_abilities", lambda db, u: _async([]))
    monkeypatch.setattr(
        ss, "decide_route", lambda *a, **k: _async({"route": "general", "target_concept_tag": None})
    )
    monkeypatch.setattr(ss.weatherbrain_service, "weak_concepts", lambda a, lg: [])
    monkeypatch.setattr(ss.weatherbrain_service, "overall_theta", lambda a, t=None: theta)
    monkeypatch.setattr(ss, "get_today_weather", fake_weather)
    monkeypatch.setattr(ss.ai_client, "quiz_generate", no_generate)
    monkeypatch.setattr(
        ss, "allocate_quiz_ids",
        lambda db, uid, today_str, count: _async(
            [f"{today_str}-{i + 1:03d}" for i in range(count)]
        ),
    )

    user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high", region=None)
    db = _DB()
    session, entries = asyncio.run(ss.create_daily_session(db, user))
    return session, entries, db, user


async def _async(value):
    return value


def kinds_of(entries):
    return [e["kind"] for e in entries]


def board_entries(entries):
    return [e for e in entries if e["kind"] == "board"]


# ═══════════════════════════════════════════════════════════════
# 계약 1·2 — 배합 소비 루프가 board kind를 처리한다
# ═══════════════════════════════════════════════════════════════


class TestBoardBlock:
    def test_계약1_board_블록이_board_문항을_낸다(self, monkeypatch):
        boards = [make_board("b-shower", "shower", 5), make_board("b-clear", "clear", 1)]
        session, entries, _, _ = issue(monkeypatch, boards=boards)

        assert len(entries) == ss.SESSION_SIZE == sum(RECIPE.values())
        assert kinds_of(entries).count("board") == BOARD_COUNT
        picked = board_entries(entries)[0]
        assert picked["question"]["question_type"] == "board"
        assert session.recipe_json["phenomenon"] == "shower"

    def test_계약2_오늘_현상에_맞는_보드가_뽑힌다(self, monkeypatch):
        """board_order가 더 낮은 후보가 있어도 현상 일치가 이긴다."""
        boards = [make_board("b-clear", "clear", 1), make_board("b-shower", "shower", 9)]
        _, entries, _, _ = issue(monkeypatch, boards=boards)
        assert board_entries(entries)[0]["content_item_id"] == "b-shower-"

    def test_계약2_new_블록이_그_보드를_선점하지_못한다(self, monkeypatch):
        """board는 uses_live_slots=false라 new 풀에도 들어 있다 — 먼저 집히면 뒤집힌다."""
        target = make_board("b-shower", "shower", 9)
        # new 풀과 board 풀이 **같은 문항 객체**를 공유하는 상황 (실제 조회와 같다)
        shared = [target] + [make_item("new", i) for i in range(20)]
        _, entries, _, _ = issue(monkeypatch, boards=[target], shared_pool=shared)

        assert board_entries(entries)[0]["content_item_id"] == "b-shower-"
        assert kinds_of(entries).count("board") == BOARD_COUNT
        assert [e["content_item_id"] for e in entries].count("b-shower-") == 1, (
            "같은 문항이 두 블록에 두 번 나갔다"
        )

    def test_계약6_board는_슬롯_치환_대상이_아니다(self, monkeypatch):
        boards = [make_board("b-shower", "shower", 5)]
        _, entries, _, _ = issue(monkeypatch, boards=boards)
        assert board_entries(entries)[0]["slot_filled"] is False

    def test_board_문항_메타가_세션_행에_남는다(self, monkeypatch):
        """완료 화면 블록 표기의 유일한 근거 — 멱등 재조회 때 여기서 복원된다."""
        boards = [make_board("b-shower", "shower", 5)]
        session, entries, _, _ = issue(monkeypatch, boards=boards)
        meta = {m["quiz_id"]: m["kind"] for m in session.recipe_json["items"]}
        assert meta == {e["quiz_id"]: e["kind"] for e in entries}
        assert list(meta.values()).count("board") == BOARD_COUNT


# ═══════════════════════════════════════════════════════════════
# 계약 3·4 — 폴백으로 성립한다 (0문항 세션 금지)
# ═══════════════════════════════════════════════════════════════


class TestFallback:
    def test_계약3_board_풀이_비면_new가_메우고_총합이_유지된다(self, monkeypatch):
        """버리면 그 자리가 유료 생성으로 샌다(CO-M1·CO-H5가 겪은 누수)."""
        _, entries, _, _ = issue(monkeypatch, boards=[])
        assert len(entries) == ss.SESSION_SIZE
        assert not board_entries(entries)
        assert kinds_of(entries).count("new") == RECIPE["new"] + BOARD_COUNT

    def test_계약4_실황_캐시가_비어도_보드가_나간다(self, monkeypatch):
        """KMA 부재 = 판정 None = 「board_order 순」이지 「보드 없음」이 아니다."""
        boards = [make_board("b-late", "snow", 9), make_board("b-first", "heatwave", 1)]
        session, entries, _, _ = issue(monkeypatch, boards=boards, weather={})

        assert session.recipe_json["phenomenon"] is None
        assert len(entries) == ss.SESSION_SIZE
        assert board_entries(entries)[0]["content_item_id"] == "b-first-"

    def test_계약4_현상에_맞는_보드가_없어도_보드가_나간다(self, monkeypatch):
        """판정은 됐는데(shower) 그 목표를 가진 보드가 이 밴드에 없는 날."""
        boards = [make_board("b-snow", "snow", 4), make_board("b-fog", "fog", 2)]
        _, entries, _, _ = issue(monkeypatch, boards=boards)
        assert board_entries(entries)[0]["content_item_id"] == "b-fog-"

    def test_0문항_세션이_되지_않는다(self, monkeypatch):
        """풀이 전부 비어도(생성 없음) 하한 계약은 살아 있어야 한다."""
        with pytest.raises(Exception):
            issue(monkeypatch, boards=[], shared_pool=[])


# ═══════════════════════════════════════════════════════════════
# 계약 3 (순수 함수 층) — plan_bank_picks 자체
# ═══════════════════════════════════════════════════════════════


class TestBlockOrder:
    """출제 순서 `live → new → review → board` — **사양이 순서를 포함한다**.

    ⚠️ 이 계약이 없으면 다음 사람이 조용히 뒤집는다. 실제로 그랬다:
    `SESSION_RECIPE`를 `{live:2, new:4, review:3, board:1}`로 적어 놓고도 학습자는
    **신규부터** 받았다 — dict 키 순서는 출제 순서를 정하지 않고, 순서의 소유자는
    `plan_bank_picks`의 블록 호출 순서이기 때문이다(담당 F 발견, 2026-08-12).
    """

    def test_블록_순서가_사양_그대로다(self):
        picks, generate = ss.plan_bank_picks(
            [make_item("new", i) for i in range(20)],
            [make_item("rev", i) for i in range(10)],
            [make_item("live", i) for i in range(5)],
            board_pool=[make_board("b", "fog", 1)],
        )
        assert generate == 0
        expected = (
            ["live"] * RECIPE["live"]
            + ["new"] * RECIPE["new"]
            + ["review"] * RECIPE["review"]
            + ["board"] * BOARD_COUNT
        )
        assert [p["kind"] for p in picks] == expected

    def test_발급까지_순서가_보존된다(self, monkeypatch):
        """quiz_id 채번 순서 = 응답 순서다 — 배합 순서가 여기까지 와야 의미가 있다."""
        _, entries, _, _ = issue(monkeypatch, boards=[make_board("b", "shower", 1)])
        kinds = kinds_of(entries)
        assert kinds[0] == "live", "하루는 오늘의 날씨로 연다"
        assert kinds[-1] == "board", "하루는 오늘의 보드로 닫는다"
        assert [e["quiz_id"] for e in entries] == sorted(
            e["quiz_id"] for e in entries
        ), "발급 순서와 quiz_id 정렬이 어긋나면 응답 순서가 배합과 달라진다"

    def test_유형_3연속_금지가_board_자리를_뺏지_않는다(self, monkeypatch):
        """§3.2 다양화와 §T3 순서가 **둘 다** 성립해야 한다.

        실제로 충돌했다: 앞 구간이 전부 같은 유형이면 3연속 해소 교환이 "다른
        유형"을 찾는데, board는 유형이 하나뿐이라 **1순위 표적**이 되어 세션
        중간으로 끌려 나왔다. 한쪽만 고치고 넘어가면 다른 쪽이 조용히 죽는다.

        풀은 **선두 3건이 같은 유형(=위반 상태)**이고 뒤에 교환 상대가 있는
        구성이다 — board를 빼고도 3연속이 해소돼야 둘 다 성립한 것이다.
        """
        head = ["multiple_choice"] * 3 + ["slider", "match", "cloze"]
        pool = [make_item("new", i, t) for i, t in enumerate(head)]
        pool += [
            make_item("new", 100 + i, ["slider", "match", "cloze"][i % 3])
            for i in range(15)
        ]
        _, entries, _, _ = issue(
            monkeypatch, boards=[make_board("b", "shower", 1)], shared_pool=pool
        )
        kinds, types = kinds_of(entries), [
            e["question"]["question_type"] for e in entries
        ]
        assert kinds[-1] == "board"
        assert not any(
            types[i] == types[i - 1] == types[i - 2] for i in range(2, len(types))
        ), "3연속 금지가 죽었다"

    def test_실황이_모자라도_첫_자리는_실황_블록이다(self, monkeypatch):
        """live 풀이 비면 그 자리는 new가 메운다 — 자리는 남고 kind만 바뀐다."""
        picks, generate = ss.plan_bank_picks(
            [make_item("new", i) for i in range(20)],
            [make_item("rev", i) for i in range(10)],
            [],
            board_pool=[make_board("b", "fog", 1)],
        )
        assert generate == 0
        assert len(picks) == ss.SESSION_SIZE
        assert [p["kind"] for p in picks][-BOARD_COUNT:] == ["board"] * BOARD_COUNT


class TestPlanBankPicks:
    def test_board_풀_순서를_그대로_믿는다(self):
        """정렬은 호출측(order_boards_for_today)이 이미 했다 — 여기서 다시 고르지 않는다."""
        boards = [make_board("first", "snow", 9), make_board("second", "fog", 1)]
        picks, generate = ss.plan_bank_picks(
            [make_item("new", i) for i in range(20)], [], [], board_pool=boards
        )
        chosen = [p["item"].id for p in picks if p["kind"] == "board"]
        assert chosen == ["first-"] and generate == 0

    def test_board_없는_배합에서는_아무것도_안_바뀐다(self):
        """env로 board를 뺀 배합(`recipe.get`)에서 KeyError가 나면 기동이 죽는다."""
        legacy = {"new": 5, "review": 4, "live": 1, "unit": 5}
        picks, generate = ss.plan_bank_picks(
            [make_item("new", i) for i in range(30)], [], [],
            recipe=legacy, unit_pool=[make_item("u", i) for i in range(5)],
        )
        assert len(picks) == sum(legacy.values()) and generate == 0
        assert not [p for p in picks if p["kind"] == "board"]

    def test_진도_블록이_있으면_board는_그_앞이다(self):
        """§2.10 「진도 블록은 항상 마지막」은 board가 들어와도 유지된다."""
        recipe = {"new": 2, "review": 1, "live": 1, "board": 1, "unit": 3}
        picks, _ = ss.plan_bank_picks(
            [make_item("new", i) for i in range(20)], [], [],
            recipe=recipe,
            unit_pool=[make_item("u", i) for i in range(3)],
            board_pool=[make_board("b", "fog", 1)],
        )
        kinds = [p["kind"] for p in picks]
        assert kinds[-3:] == ["unit"] * 3
        assert kinds.index("board") < kinds.index("unit")


# ═══════════════════════════════════════════════════════════════
# 계약 5 — 라우터까지 (여기서만 터지는 결함이 있다)
# ═══════════════════════════════════════════════════════════════


class TestRouterLevel:
    def test_계약5_board_kind가_응답_스키마를_통과한다(self, monkeypatch):
        """`SessionItem.kind` Literal에 'board'가 없으면 **여기서만** 터진다.

        서비스 계층은 스키마를 안 타서 전부 초록인 채로 숨는다 — 그래서 이
        단정이 서비스 테스트와 별도로 존재한다.
        """
        from app.models.quiz_log import QuizLog

        boards = [make_board("b-shower", "shower", 5)]
        session, entries, db, user = issue(monkeypatch, boards=boards)
        session.id = uuid.uuid4()
        session.mode = ss.MODE_DAILY
        logs = [o for o in db.added if isinstance(o, QuizLog)]
        assert logs, "세션 발급이 quiz_logs를 안 남겼다"

        async def fake_logs(_db, _session):
            return sorted(logs, key=lambda log: log.quiz_id)

        async def no_closing(_db, _session, _user):
            return None

        monkeypatch.setattr(session_router, "_session_logs", fake_logs)
        monkeypatch.setattr(session_router, "_closing_step", no_closing)

        payload = asyncio.run(
            session_router.session_today_response(object(), session, user)
        )
        kinds = [item.kind for item in payload.items]
        assert kinds.count("board") == BOARD_COUNT, (
            "recipe_json 메타의 board kind가 응답까지 오지 않았다"
        )
        assert len(payload.items) == len(entries)

        board_item = next(i for i in payload.items if i.kind == "board")
        assert board_item.question_type == "board"
        assert board_item.template_json is not None, (
            "board는 palette·initial_state 없이는 프론트가 렌더하지 못한다"
        )

    def test_스키마가_board_토큰을_갖는다(self):
        """계약을 코드가 아니라 **타입**으로 못박는다 — 토큰이 빠지면 즉시 빨개진다."""
        from typing import get_args

        from app.schemas.session import SessionItem

        assert "board" in get_args(SessionItem.model_fields["kind"].annotation)


# ═══════════════════════════════════════════════════════════════
# 판정 → 매칭 배선 (모듈 경유가 실제로 일어나는가)
# ═══════════════════════════════════════════════════════════════


class TestWiring:
    def test_발급이_현상_판정을_거친다(self, monkeypatch):
        seen = []
        real = wp.classify_phenomenon

        def spy(weather):
            seen.append(weather)
            return real(weather)

        monkeypatch.setattr(ss.weather_phenomenon, "classify_phenomenon", spy)
        issue(monkeypatch, boards=[make_board("b", "shower", 1)])
        assert seen == [SHOWER_WEATHER], (
            "판정이 슬롯 치환과 **같은 실황 캐시**를 봐야 화면의 오늘 날씨와 "
            "보드가 어긋나지 않는다"
        )

    def test_표적_지식_단계가_매칭까지_전달된다(self, monkeypatch):
        """밴드 필터가 사라진 뒤 보드의 유일한 난이도 방벽 — 배선이 끊기면 침묵한다.

        θ→단계 매핑은 하드코딩하지 않는다(`theta_to_knowledge_level`이 소유).
        낮은 θ의 유저에게 **같은 현상의 쉬운 보드**가 나가는지만 본다.
        """
        low_theta = -1.5
        target = ss.weatherbrain_service.theta_to_knowledge_level(low_theta)
        easy = make_board("easy", "shower", order=40, kl=target)
        hard = make_board("hard", "shower", order=1, kl=target + 4)

        _, entries, _, _ = issue(
            monkeypatch, boards=[hard, easy], theta=low_theta
        )
        assert board_entries(entries)[0]["content_item_id"] == "easy-", (
            "board_order가 앞선 어려운 보드가 나갔다 — 표적 단계가 "
            "order_boards_for_today까지 전달되지 않는다"
        )

    def test_daily_풀과_같은_단계_함수를_쓴다(self, monkeypatch):
        """세 경로(신규 풀·생성 난이도·보드)가 다른 단계를 보면 안 된다."""
        seen = {}
        real = ss.weather_phenomenon.order_boards_for_today

        def spy(items, phenomenon, target_level=None):
            seen["target"] = target_level
            return real(items, phenomenon, target_level)

        monkeypatch.setattr(ss.weather_phenomenon, "order_boards_for_today", spy)
        issue(monkeypatch, boards=[make_board("b", "shower", 1)], theta=0.8)
        assert seen["target"] == ss.weatherbrain_service.theta_to_knowledge_level(0.8)

    def test_콜드스타트면_표적이_None이다(self, monkeypatch):
        seen = {}
        real = ss.weather_phenomenon.order_boards_for_today

        def spy(items, phenomenon, target_level=None):
            seen["target"] = target_level
            return real(items, phenomenon, target_level)

        monkeypatch.setattr(ss.weather_phenomenon, "order_boards_for_today", spy)
        issue(monkeypatch, boards=[make_board("b", "shower", 1)], theta=None)
        assert seen["target"] is None

    def test_board_풀_조회는_유형을_board로_한정한다(self):
        """유형 한정이 빠지면 board 블록이 아무 문항이나 집는다."""
        stmt = ss.build_pool_query(
            level_groups=["middle_high"], theta=None, live=False,
            question_types=("board",), limit=10,
        )
        assert "question_type IN" in str(stmt).replace("\n", " ")

    def test_유형_한정이_없으면_SQL이_종전과_같다(self):
        """new/review/live 3풀의 쿼리는 한 글자도 바뀌면 안 된다."""
        base = str(
            ss.build_pool_query(
                level_groups=["middle_high"], theta=None, live=False, limit=10
            )
        )
        # SELECT 목록에는 늘 나오는 컬럼이므로 **WHERE 절**에 안 붙었는지를 본다.
        assert "question_type IN" not in base.replace("\n", " ")

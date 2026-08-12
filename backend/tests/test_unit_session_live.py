"""유닛(학습) 세션의 실황 반영 계약 — 2026-08-12 클라이언트 지시. DB·Redis 불필요.

지시: **「자유 일일 세션을 없애고 학습 세션에 오늘 날씨를 반영한다」**의 후반부.
종전 상태는 정반대였다 — `_unit_content_pool`이 `live=False`로 실황 문항을 명시적
으로 **제외**했고, `create_unit_session`은 슬롯 치환을 아예 하지 않았으며
`slot_filled`가 항상 False로 박혀 있었다.

이 파일이 못 박는 것 4가지:
  ⑴ 유닛 세션이 실황 문항을 **받는다**(UNIT_LIVE_CAP건 예약 — 섞기만 하면
     실황 8/1000이라 5칸 안에 사실상 못 들어온다).
  ⑵ 치환이 **적재 전에** 일어난다 — `QuizLog.question_json`에 「{today.」가 남지
     않는다. 라우터는 entries를 버리고 로그에서 응답을 다시 조립하므로
     (`session_today_response`) 검증 지점은 entries가 아니라 **로그**다.
  ⑶ 실황이 없거나(무키·KMA 장애) 치환이 실패하면 그 문항이 **빠지고**, 세션은
     비실황 문항으로 그대로 성립한다(유닛 세션에는 daily의 quiz-generate 폴백이
     없으므로 "조용히 빼는" 쪽이 유일하게 안전한 실패다).
  ⑷ 진도 블록(progress_block_pool)은 계속 실황을 **안 받는다** — 그 풀은 daily
     세션이 소비하고 daily는 kind="live"에만 슬롯을 치환하므로, 실황을 넣으면
     미치환 원문이 화면에 나간다.

곁들여 담당 E 이월 1건: 유닛 세션 `question_json`에 `knowledge_level`이 실린다.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.services import curriculum_service as cs

TODAY = date(2026, 8, 12)

# 실황 전체 슬롯 값 — extract_slot_values의 반환 형식(문자열 dict) 그대로.
SLOT_VALUES = {
    "today.region": "서울",
    "today.temp_max": "31",
    "today.temp_min": "24",
    "today.sky": "구름많음",
    "today.rain_prob": "60",
}

LIVE_TEXT = "오늘 {today.region}의 하늘은 '{today.sky}', 비 올 확률은 {today.rain_prob}%다."


def live_item(knowledge_level: int = 2, text: str = LIVE_TEXT) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type="multiple_choice",
        level_group="adult",
        knowledge_level=knowledge_level,
        uses_live_slots=True,
        template_json={
            "question_text": text,
            "options": ["높아진다", "낮아진다", "무관하다", "0%가 된다"],
            "correct_answer": "높아진다",
        },
    )


def plain_item(n: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag="pressure_front",
        question_type="short_answer",
        level_group="adult",
        knowledge_level=4,
        uses_live_slots=False,
        template_json={"question_text": f"저기압 설명 {n}", "correct_answer": "상승"},
    )


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):  # allocate_quiz_ids의 오늘자 기존 발급 수
        return 0


class _PoolDB:
    """실황/비실황 풀 조회를 SQL 텍스트로 갈라 답하는 대역 DB.

    `uses_live_slots IS true`는 `build_pool_query(live=True)`의 자국이다
    (test_unit_block_recipe이 daily 풀을 가르는 데 쓰는 것과 같은 방식).
    """

    def __init__(self, *, live_rows=(), plain_rows=()):
        self.live_rows = list(live_rows)
        self.plain_rows = list(plain_rows)
        self.stmts: list[str] = []
        self.stmt_objs: list = []
        self.added: list = []

    async def execute(self, stmt):
        text = str(stmt)
        if text.lstrip().lower().startswith("select count"):
            return _Result([])  # 채번 조회 — 풀 조회로 세지 않는다
        self.stmts.append(text)
        self.stmt_objs.append(stmt)
        if "uses_live_slots IS true" in text or "uses_live_slots IS 1" in text:
            return _Result(self.live_rows)
        return _Result(self.plain_rows)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    # 편의 —
    @property
    def live_stmts(self) -> list[str]:
        return [s for s in self.stmts if "uses_live_slots IS true" in s]

    @property
    def live_stmt_params(self) -> list[dict]:
        return [
            obj.compile().params
            for obj, text in zip(self.stmt_objs, self.stmts)
            if "uses_live_slots IS true" in text
        ]

    @property
    def logs(self) -> list:
        return [o for o in self.added if hasattr(o, "question_json")]


USER = SimpleNamespace(id=uuid.uuid4(), level_group="adult", region="서울")
UNIT = SimpleNamespace(
    id=uuid.uuid4(), slug="read-sky-pressure", kind="quiz",
    concept_tag="pressure_front",
)


@pytest.fixture
def weather(monkeypatch):
    """`get_today_weather`를 대역으로 — 실 KMA·Redis에 닿지 않는다.

    반환 dict를 그대로 `extract_slot_values`가 소화하도록 forecasts를 만든다.
    """
    def _set(values: dict | None):
        async def fake(region="서울"):
            if values is None:
                return {}
            return {
                "region": values["today.region"],
                "forecasts": [
                    {
                        "datetime": "202608121200",
                        "TMX": float(values["today.temp_max"]),
                        "TMN": float(values["today.temp_min"]),
                        "TMP": float(values["today.temp_max"]),
                        "SKY": 3.0,
                        "POP": float(values["today.rain_prob"]),
                    }
                ],
            }
        monkeypatch.setattr(cs, "get_today_weather", fake)

    return _set


def run_session(db, day: date = TODAY):
    return asyncio.run(cs.create_unit_session(db, USER, UNIT, day, abilities=[]))


def live_ids(entries) -> list:
    return [e["content_item_id"] for e in entries if e["slot_filled"]]


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


# ══════════════════════════════════════════════════════════════════════════
# ⑴ 유닛 세션이 실황 문항을 받는다
# ══════════════════════════════════════════════════════════════════════════


class TestUnitSessionReceivesLiveItem:
    def test_실황_문항이_풀에_들어온다(self, weather):
        weather(SLOT_VALUES)
        live = live_item()
        db = _PoolDB(live_rows=[live], plain_rows=[plain_item(i) for i in range(5)])
        _, entries = run_session(db)

        assert db.live_stmts, "실황 풀 조회 자체가 사라졌다 — live=False로 되돌아갔다"
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert entries[0]["content_item_id"] == live.id, "실황은 예약 앞자리다"
        assert sum(1 for e in entries if e["slot_filled"]) == 1

    def test_사양_수치는_세션당_2건이다(self):
        """클라이언트 사양(2026-08-12): 세션당 2건 · 20종 · 10일 순환.

        세 수치는 한 덩어리다 — 20 ÷ 2 = 10. 이 값을 바꾸면 순환 주기가 함께
        바뀌므로, 바꾸는 사람이 사양을 다시 확인하도록 여기서 못 박는다.
        """
        assert cs.UNIT_LIVE_CAP == 2

    def test_재료가_충분하면_정확히_2건(self, weather):
        weather(SLOT_VALUES)
        db = _PoolDB(
            live_rows=[live_item() for _ in range(6)],
            plain_rows=[plain_item(i) for i in range(5)],
        )
        _, entries = run_session(db)
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert len(live_ids(entries)) == cs.UNIT_LIVE_CAP == 2
        assert len(set(live_ids(entries))) == 2, "같은 문항이 두 자리를 먹었다"

    def test_재료가_2건_미만이어도_세션이_성립한다(self, weather):
        """저작(담당 F 20종)이 끝나기 전에도 학습이 막히면 안 된다 —
        사양의 2건을 못 채우면 **채워지는 만큼만** 넣고 나머지는 비실황이다."""
        weather(SLOT_VALUES)
        db = _PoolDB(
            live_rows=[live_item()], plain_rows=[plain_item(i) for i in range(5)]
        )
        _, entries = run_session(db)
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert len(live_ids(entries)) == 1

    def test_실황_조회는_유닛_필터를_그대로_쓴다(self, weather):
        """개념 태그·유형(board 여부) 필터가 실황 조회에서 빠지면 유닛과 무관한
        문항이 학습 세션에 섞인다."""
        weather(SLOT_VALUES)
        db = _PoolDB(live_rows=[live_item()], plain_rows=[])
        run_session(db)
        sql = db.live_stmts[0]
        assert "concept_tag IN" in sql
        assert "question_type !=" in sql  # quiz 유닛 — board 제외


# ══════════════════════════════════════════════════════════════════════════
# ⑴-b 10일 순환 — 클라이언트 사양(세션당 2건 · 20종 · 10일)
#
# 순수 함수(`live_rotation_window`)로 날짜를 자유롭게 밀어 검증하고, 발급 경로가
# 그 함수를 실제로 쓰는지는 아래 통합 테스트가 확인한다.
# ══════════════════════════════════════════════════════════════════════════


def rot_items(n: int) -> list:
    """id만 다른 후보 n건 — 정렬 키가 id이므로 순환 검증에 충분하다."""
    return [SimpleNamespace(id=f"live-{i:03d}") for i in range(n)]


def ids(items) -> list:
    return [it.id for it in items]


class TestTenDayRotation:
    DAY = date(2026, 8, 12)

    def test_같은_날은_항상_같은_문항(self):
        """랜덤이면 어제 본 것을 오늘 또 볼 수 있어 순환이 성립하지 않는다."""
        pool = rot_items(20)
        first = ids(cs.live_rotation_window(pool, self.DAY))
        for _ in range(5):
            assert ids(cs.live_rotation_window(pool, self.DAY)) == first
        # 후보를 섞어 넣어도 같은 창 — DB 행 순서에 기대지 않는다.
        shuffled = list(reversed(pool))
        assert ids(cs.live_rotation_window(shuffled, self.DAY)) == first

    def test_다음_날은_다른_문항(self):
        pool = rot_items(20)
        today = set(ids(cs.live_rotation_window(pool, self.DAY)))
        tomorrow = set(ids(cs.live_rotation_window(pool, self.DAY + timedelta(days=1))))
        assert today.isdisjoint(tomorrow)

    def test_20종이면_10일에_한_바퀴_중복_없음(self):
        """사양의 본문 — 10일 창의 합집합이 20종 전건이고 중복이 0이다."""
        pool = rot_items(20)
        seen: list = []
        for offset in range(20 // cs.UNIT_LIVE_CAP):
            seen += ids(
                cs.live_rotation_window(pool, self.DAY + timedelta(days=offset))
            )
        assert len(seen) == 20
        assert len(set(seen)) == 20, f"10일 안에 같은 문항이 두 번 나왔다: {seen}"
        assert set(seen) == set(ids(pool))
        # 11일째는 첫날로 되돌아온다 — 바퀴가 닫힌다.
        assert ids(cs.live_rotation_window(pool, self.DAY + timedelta(days=10))) == ids(
            cs.live_rotation_window(pool, self.DAY)
        )

    def test_월_해_경계에서도_하루씩_민다(self):
        """toordinal 기준이라 8/31→9/1, 12/31→1/1에서 순환이 튀지 않는다."""
        pool = rot_items(20)
        for last, first in [
            (date(2026, 8, 31), date(2026, 9, 1)),
            (date(2026, 12, 31), date(2027, 1, 1)),
        ]:
            assert set(ids(cs.live_rotation_window(pool, last))).isdisjoint(
                ids(cs.live_rotation_window(pool, first))
            )

    def test_재료가_적으면_있는_만큼_돈다(self):
        """저작 진행 중(현재 8건대)에도 순환은 그대로 성립한다 — 8건이면 4일."""
        pool = rot_items(8)
        seen: list = []
        for offset in range(8 // cs.UNIT_LIVE_CAP):
            seen += ids(
                cs.live_rotation_window(pool, self.DAY + timedelta(days=offset))
            )
        assert sorted(seen) == sorted(ids(pool))

    def test_재료가_cap보다_적으면_있는_만큼만(self):
        assert len(cs.live_rotation_window(rot_items(1), self.DAY)) == 1
        assert cs.live_rotation_window([], self.DAY) == []

    def test_홀수_재료도_결정적이고_굶지_않는다(self):
        """종수가 cap의 배수가 아니면 창이 감기지만, 건수와 결정성은 유지된다."""
        pool = rot_items(5)
        for offset in range(12):
            day = self.DAY + timedelta(days=offset)
            window = cs.live_rotation_window(pool, day)
            assert len(window) == cs.UNIT_LIVE_CAP
            assert len(set(ids(window))) == cs.UNIT_LIVE_CAP  # 창 안 중복 없음
            assert ids(cs.live_rotation_window(pool, day)) == ids(window)

    def test_기준일은_KST다(self):
        """하루 경계가 UTC로 넘어가면 순환이 09:00 KST에 튄다 —
        이 저장소의 하루 경계 계약(목의 KST_OFFSET_MS와 같은 것)."""
        src = inspect.getsource(cs._unit_content_pool)
        assert "today or datetime.now(KST).date()" in src, (
            "실황 순환의 기준일이 KST가 아니다"
        )


class TestRotationReachesIssuedSession:
    """발급 경로가 순환을 **실제로** 쓴다 — 순수 함수만 초록인 배선 누락 방지."""

    def _db(self):
        return _PoolDB(
            live_rows=[live_item() for _ in range(6)],
            plain_rows=[plain_item(i) for i in range(5)],
        )

    def test_같은_날_같은_유저는_같은_실황_문항(self, weather):
        weather(SLOT_VALUES)
        db = self._db()
        # 같은 후보 집합을 두 번 발급 — 하루에 두 번 들어와도 같아야 한다.
        first = live_ids(run_session(db, TODAY)[1])
        second = live_ids(run_session(db, TODAY)[1])
        assert first == second != []

    def test_다음_날_발급은_다른_실황_문항(self, weather):
        weather(SLOT_VALUES)
        db = self._db()
        today = set(live_ids(run_session(db, TODAY)[1]))
        tomorrow = set(live_ids(run_session(db, TODAY + timedelta(days=1))[1]))
        assert today and tomorrow and today.isdisjoint(tomorrow)

    def test_순환은_오늘_응답분_제외에_흔들리지_않는다(self, weather):
        """실황 조회에 `answered_today` 제외가 걸리면 두 번째 발급이 달라져
        '같은 날 같은 문항'이 깨진다 — 조회 SQL에 그 제외가 없어야 한다."""
        weather(SLOT_VALUES)
        db = self._db()
        run_session(db)
        assert db.live_stmts
        assert "NOT IN" not in db.live_stmts[0]

    def test_실황_후보_조회는_절단되지_않는다(self, weather):
        """LIMIT이 후보보다 작으면 무작위 절단이 순환을 깬다."""
        weather(SLOT_VALUES)
        db = self._db()
        run_session(db)
        limits = [
            v
            for k, v in db.live_stmt_params[0].items()
            if k.startswith("param_")
        ]
        assert cs.UNIT_LIVE_POOL_LIMIT in limits


# ══════════════════════════════════════════════════════════════════════════
# ⑵ 치환이 실제로 일어난다 — 적재된 question_json에 원문이 없다
# ══════════════════════════════════════════════════════════════════════════


class TestSlotsAreFilledBeforePersist:
    def _issued(self, weather):
        weather(SLOT_VALUES)
        live = live_item()
        db = _PoolDB(live_rows=[live], plain_rows=[plain_item(i) for i in range(5)])
        session, entries = run_session(db)
        return db, session, entries, live

    def test_적재된_question_json에_슬롯_원문이_없다(self, weather):
        db, session, entries, _ = self._issued(weather)
        # 라우터는 entries를 버리고 QuizLog에서 응답을 재조립한다 — 검증 지점은 로그다.
        assert db.logs
        assert "{today." not in dumps([log.question_json for log in db.logs])
        assert "{today." not in dumps([e["question"] for e in entries])

    def test_실황값이_실제로_박힌다(self, weather):
        db, _, entries, live = self._issued(weather)
        text = next(
            e["question"]["question_text"]
            for e in entries
            if e["content_item_id"] == live.id
        )
        assert "서울" in text and "구름많음" in text and "60%" in text

    def test_slot_filled가_recipe_json까지_간다(self, weather):
        """`session_today_response`가 읽는 것은 entries가 아니라 recipe_json이다 —
        여기서 False로 박히면 재조회 응답에서 치환이 통째로 사라진다."""
        _, session, entries, live = self._issued(weather)
        quiz_id = next(e["quiz_id"] for e in entries if e["content_item_id"] == live.id)
        meta = {m["quiz_id"]: m for m in session.recipe_json["items"]}
        assert meta[quiz_id]["slot_filled"] is True
        assert sum(1 for m in meta.values() if m["slot_filled"]) == 1


# ══════════════════════════════════════════════════════════════════════════
# ⑶ 실황이 없어도 세션은 성립한다
# ══════════════════════════════════════════════════════════════════════════


class TestSessionSurvivesWithoutLiveWeather:
    def test_캐시가_비면_실황_조회_자체를_안_한다(self, weather):
        weather(None)  # get_today_weather → {} (무키·KMA 장애)
        db = _PoolDB(
            live_rows=[live_item()], plain_rows=[plain_item(i) for i in range(5)]
        )
        _, entries = run_session(db)
        assert db.live_stmts == [], "슬롯 값이 없는데 실황을 조회했다(무의미한 왕복)"
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert all(e["slot_filled"] is False for e in entries)
        assert "{today." not in dumps([e["question"] for e in entries])

    def test_슬롯_일부만_있으면_그_문항만_빠지고_세션은_찬다(self, weather):
        """region만 아는 날 — temp/rain 슬롯이 치환 불가라 실황 문항은 탈락한다."""
        weather(SLOT_VALUES)
        db = _PoolDB(
            live_rows=[live_item(text="최고 {today.pressure}hPa")],  # 허용 밖 슬롯
            plain_rows=[plain_item(i) for i in range(5)],
        )
        _, entries = run_session(db)
        assert len(entries) == cs.UNIT_SESSION_SIZE
        assert all(e["slot_filled"] is False for e in entries)
        assert "{today." not in dumps([e["question"] for e in entries])

    def test_실황_조회가_터져도_세션은_발급된다(self, monkeypatch):
        """Redis·KMA 장애가 학습 세션 발급 자체를 막으면 안 된다."""
        async def boom(region="서울"):
            raise RuntimeError("redis down")

        monkeypatch.setattr(cs, "get_today_weather", boom)
        db = _PoolDB(plain_rows=[plain_item(i) for i in range(5)])
        _, entries = run_session(db)
        assert len(entries) == cs.UNIT_SESSION_SIZE

    def test_치환_실패분은_발급_루프에서도_버려진다(self, weather, monkeypatch):
        """풀이 이미 걸러 주지만, 그 겹이 무너져도 원문은 나가지 않는다(이중 안전).

        풀을 대역으로 갈아 끼워 **치환 불가 실황 문항을 강제로** 밀어 넣는다.
        """
        weather(SLOT_VALUES)
        bad = live_item(text="최고 {today.pressure}hPa")

        async def fake_pool(
            db, user, unit, abilities=None, slot_values=None, today=None
        ):
            return [bad, plain_item(0), plain_item(1)]

        monkeypatch.setattr(cs, "_unit_content_pool", fake_pool)
        db = _PoolDB()
        _, entries = run_session(db)
        assert len(entries) == 2, "치환 못 한 실황 문항이 그대로 나갔다"
        assert "{today." not in dumps([e["question"] for e in entries])
        assert "{today." not in dumps([log.question_json for log in db.logs])

    def test_0문항_풀이어도_예외_없이_발급된다(self, weather):
        """CO-H12 판정(유닛 세션에 하한 없음)이 실황 편입으로 흔들리지 않는다."""
        weather(SLOT_VALUES)
        db = _PoolDB()
        session, entries = run_session(db)
        assert entries == []
        assert session.recipe_json["items"] == []


# ══════════════════════════════════════════════════════════════════════════
# ⑷ 진도 블록은 실황을 받지 않는다 — daily 미치환 노출 방지
# ══════════════════════════════════════════════════════════════════════════


class TestProgressBlockStaysLiveFree:
    def test_기본_호출은_실황_조회를_하지_않는다(self):
        """`slot_values` 미전달 = 종전과 완전 동일(조회 2회·비실황만)."""
        db = _PoolDB(live_rows=[live_item()], plain_rows=[])
        items = asyncio.run(cs._unit_content_pool(db, USER, UNIT, []))
        assert items == []
        assert db.live_stmts == []
        assert len(db.stmts) == 2  # 신선도 1차 + 백필 2차 (test_unit_pool_theta 계약)

    def test_실황_경로의_조회는_3회다(self):
        """실황 1회가 얹힌다 — 조용히 늘어나는 것을 여기서 막는다."""
        db = _PoolDB(live_rows=[], plain_rows=[])
        asyncio.run(cs._unit_content_pool(db, USER, UNIT, [], SLOT_VALUES))
        assert len(db.stmts) == 3

    def test_progress_block_pool은_slot_values를_넘기지_않는다(self):
        """넘기면 daily 진도 블록에 실황이 섞이고, daily의 발급 루프는
        kind="live"에만 치환하므로 「{today.*}」 원문이 화면에 나간다."""
        # 주석은 걷어낸다 — 왜 안 넘기는지를 적은 주석까지 위반으로 세면
        # 근거를 남길수록 테스트가 우는 뒤집힌 유인이 생긴다.
        src = "\n".join(
            line
            for line in inspect.getsource(cs.progress_block_pool).splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "_unit_content_pool(db, user, unit, abilities)" in src
        assert "slot_values" not in src, (
            "진도 블록에 실황이 들어갔다 — session_service의 치환은 kind='live'"
            "에만 걸리므로 미치환 원문이 daily 화면에 노출된다"
        )


# ══════════════════════════════════════════════════════════════════════════
# 담당 E 이월 — 유닛 세션에도 knowledge_level 배지 통로
# ══════════════════════════════════════════════════════════════════════════


class TestKnowledgeLevelReachesUnitSession:
    def test_question_json에_knowledge_level이_실린다(self, weather):
        weather(SLOT_VALUES)
        db = _PoolDB(
            live_rows=[live_item(knowledge_level=2)],
            plain_rows=[plain_item(i) for i in range(5)],
        )
        _, entries = run_session(db)
        levels = [e["question"]["knowledge_level"] for e in entries]
        assert levels[0] == 2                      # 실황 문항
        assert set(levels[1:]) == {4}              # 비실황 문항
        assert all("knowledge_level" in log.question_json for log in db.logs)

    def test_미분류_문항은_None_그대로(self, weather):
        """level_group에서 역산하지 않는다 — 없는 값을 지어내면 배지가 거짓말한다."""
        weather(None)
        item = plain_item(0)
        item.knowledge_level = None
        db = _PoolDB(plain_rows=[item])
        _, entries = run_session(db)
        assert entries[0]["question"]["knowledge_level"] is None

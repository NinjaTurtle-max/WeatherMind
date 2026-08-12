"""유닛 블록(진도 5문항) 계약 테스트 — 스프린트 R13-01 §2.10 (BE-1).

⚠️ **2026-08-12: 진도 블록은 더 이상 기본 배합에 없다.** SPRINT_R13_02 §T3 계약이
배합을 `{live:2, new:4, review:3, board:1}` = **10문항**으로 바꾸면서 `unit` kind가
기본값에서 빠졌다. 하지만 **코드는 그대로 살아 있다** — `plan_bank_picks`가
`recipe.get("unit", 0)`으로 읽고, `SESSION_RECIPE`의 validator도 `unit`을 계속
허용하므로 env 한 줄(`SESSION_RECIPE={"new":5,"review":4,"live":1,"unit":5}`)로
되돌릴 수 있다. 그래서 이 파일을 지우지 않는다: **지우면 되돌릴 수 있는 경로가
무검증 코드가 된다.**

대신 아래 `LEGACY_UNIT_RECIPE`로 **명시 전환**해서 돌린다. 기본 배합이 무엇인지는
`TestDefaultRecipeContract`가 따로 못 박으므로, 이 파일이 옛 기본값을 계약인 것처럼
주장하는 일은 없다.

원 개정(R13-01 §2.10)의 계약 6건:

1. `create_daily_session`이 **15문항(5+4+1+5)을 실발급**한다 (배합 recorder)
2. 진도 블록이 **현재 유닛(열린 첫 미클리어)**의 문항이고, 소진되면 다음 열린 유닛
3. 블록 간 중복 없음 (신규·복습·진도가 같은 뱅크를 봐도 같은 문항이 두 번 안 나온다)
4. 유닛 잔여가 5 미만이면 부족분을 new가 메워 **총합 15 유지**
5. 왕관은 **진도 블록 5문항의 all_resolved**로 판정 (§2.1 all_resolved 재사용)
6. 유닛 직접 진입(`POST /units/{slug}/session`)은 **왕관 없이 연습만**

순수 함수·배선 검증이라 DB가 필요 없다. 왕관 경로는 test_crown_award의
`run_complete` 하네스를 **재사용**한다(사본 금지 — 라우터 배선의 단일 대역).
문항 수 단정은 전부 `LEGACY_SESSION_SIZE`/`RECIPE` 파생이다: 숫자를 손으로
박으면 env 튜닝(R5.5) 때 계약이 아니라 상수가 깨진다.

실행: backend 디렉토리에서 `python -m pytest tests/test_unit_block_recipe.py -q`.
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.routers import session as session_router
from app.services import curriculum_service as cs
from app.services import session_service as ss
from test_crown_award import (
    AWARD,
    _no_closing_step,
    make_log,
    make_session,
    run_complete,
)

#: 진도 블록이 살아 있는 배합 — **옛 기본값이자, 지금은 env 전용 경로**다.
#: `settings.SESSION_RECIPE`에서 읽지 않고 여기 적는 이유: 기본값이 바뀔 때마다
#: 이 파일이 수집 단계에서 `KeyError: 'unit'`으로 죽는 것이 2026-08-12에 실제로
#: 일어났다. 이 파일이 검증하는 것은 "기본 배합"이 아니라 **unit 블록 기계**다.
LEGACY_UNIT_RECIPE = {"new": 5, "review": 4, "live": 1, "unit": 5}
RECIPE = LEGACY_UNIT_RECIPE
LEGACY_SESSION_SIZE = sum(RECIPE.values())
UNIT_COUNT = RECIPE["unit"]


@pytest.fixture(autouse=True)
def _use_legacy_unit_recipe(monkeypatch):
    """이 파일 전 테스트를 **진도 블록이 켜진 배합**으로 돌린다.

    `create_daily_session`은 모듈 상수 `ss.DEFAULT_RECIPE`/`ss.SESSION_SIZE`를
    읽으므로(인자로 안 받는다) 그 둘을 갈아끼운다. env로 되돌렸을 때와 같은 상태다.
    """
    monkeypatch.setattr(ss, "DEFAULT_RECIPE", LEGACY_UNIT_RECIPE)
    monkeypatch.setattr(ss, "SESSION_SIZE", LEGACY_SESSION_SIZE)


# ═══════════════════════════════════════════════════════════════
# 대역
# ═══════════════════════════════════════════════════════════════


def make_item(prefix: str, i: int, question_type: str = "multiple_choice"):
    """뱅크 문항 대역 — create_daily_session이 읽는 필드만 갖춘다."""
    return SimpleNamespace(
        id=f"{prefix}-{i}",
        template_json={"question_text": f"{prefix}-{i}?", "correct_answer": "a"},
        concept_tag="air_mass" if prefix == "unit" else "typhoon",
        question_type=question_type,
    )


def make_unit(slug: str, order: int, *, kind="quiz", concept="air_mass", prereq=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug,
        title=slug,
        section="하늘 읽기",
        unit_order=order,
        concept_tag=concept,
        kind=kind,
        crown_target=1,
        prereq_unit_id=prereq,
        course_id=None,
    )


class _DB:
    """create_daily_session이 쓰는 add/flush만 — 조회는 전부 monkeypatch로 대체."""

    def add(self, obj):
        pass

    async def flush(self):
        pass


def issue_session(monkeypatch, *, new=20, review=8, live=3, unit_items=None,
                  unit=None, shared_pool=None):
    """배합 recorder — 실제 create_daily_session을 돌려 발급 결과를 돌려준다.

    풀 조회(_fetch_pools·_fetch_unit_pool)와 채번만 대역으로 바꾸고 배합·순서·
    메타 기록은 **실코드**가 수행한다. 반환: (session, entries).
    """
    new_pool = shared_pool or [make_item("new", i) for i in range(new)]
    review_pool = shared_pool or [make_item("rev", i) for i in range(review)]
    live_pool = shared_pool or [make_item("live", i) for i in range(live)]
    if unit_items is None:
        unit_items = [make_item("unit", i) for i in range(UNIT_COUNT)]

    async def fake_pools(db, u, weak, theta=None):
        return list(new_pool), list(review_pool), list(live_pool)

    async def fake_unit_pool(db, u, abilities, count):
        return list(unit_items)[:count], unit

    async def fake_weak_rows(db, u):
        return []

    async def fake_refresh(db, u):
        return []

    async def fake_route(db, u, rows, abilities=None):
        return {"route": "general", "target_concept_tag": None}

    async def fake_weather(*args, **kwargs):
        return {}

    async def fake_quiz_ids(db, uid, today_str, count):
        return [f"{today_str}-{i + 1:03d}" for i in range(count)]

    monkeypatch.setattr(ss, "_fetch_pools", fake_pools)
    monkeypatch.setattr(ss, "_fetch_unit_pool", fake_unit_pool)
    monkeypatch.setattr(ss, "_load_weak_tag_rows", fake_weak_rows)
    monkeypatch.setattr(ss.weatherbrain_service, "refresh_abilities", fake_refresh)
    monkeypatch.setattr(ss, "decide_route", fake_route)
    monkeypatch.setattr(ss.weatherbrain_service, "weak_concepts", lambda a, lg: [])
    monkeypatch.setattr(ss.weatherbrain_service, "overall_theta", lambda a, t=None: None)
    monkeypatch.setattr(ss, "get_today_weather", fake_weather)
    # 뱅크가 배합을 다 채우면 폴백 생성은 0회여야 한다 — 새면 여기서 문다.
    async def no_generate(**kwargs):
        raise AssertionError("quiz-generate 폴백이 불렸다 — 뱅크가 배합을 못 채웠다")

    monkeypatch.setattr(ss.ai_client, "quiz_generate", no_generate)
    monkeypatch.setattr(ss, "allocate_quiz_ids", fake_quiz_ids)

    user = SimpleNamespace(
        id=uuid.uuid4(), level_group="middle_high", region=None
    )
    return asyncio.run(ss.create_daily_session(_DB(), user))


def kinds_of(entries):
    return [e["kind"] for e in entries]


# ═══════════════════════════════════════════════════════════════
# 계약 1 · 15문항 실발급
# ═══════════════════════════════════════════════════════════════


class TestDefaultRecipeContract:
    """**기본 배합**의 계약 — 위 LEGACY 전환과 독립이다(여기만 settings를 본다)."""

    def test_배합_기본값이_10문항_계약값(self):
        """env 기본값 = 계약값 (CLAUDE.md 드리프트 감시 관례).

        SPRINT_R13_02 §T3 / MT-6: 오늘 날씨 2 · 신규 4 · 복습 3 · 보드 1 = 10.
        화면 문구가 R11 이래 「오늘의 10문항」인데 실배합이 15였던 어긋남
        (대장 CO-S-6)이 이 값으로 닫힌다.
        """
        assert settings.SESSION_RECIPE == {
            "live": 2, "new": 4, "review": 3, "board": 1
        }
        assert sum(settings.SESSION_RECIPE.values()) == 10

    def test_진도_블록은_기본_배합에_없다(self):
        """`unit`이 빠진 것이 사고가 아니라 계약임을 못 박는다."""
        assert "unit" not in settings.SESSION_RECIPE

    def test_validator_허용집합이_unit과_board를_모두_받는다(self):
        """`unit`이 빠져도 **허용집합에는 남는다** — env 롤백 통로다.

        `board`는 2026-08-12에 추가됐다: T3 계약이 적어 둔 배합을 문자 그대로
        넣으면 그때까지 ValueError로 기동이 죽었다(계약서가 코드에 도달 불가).
        """
        from app.core.config import Settings

        rollback = Settings(SESSION_RECIPE=LEGACY_UNIT_RECIPE)
        assert rollback.SESSION_RECIPE == LEGACY_UNIT_RECIPE
        current = Settings(SESSION_RECIPE={"live": 2, "new": 4, "review": 3, "board": 1})
        assert sum(current.SESSION_RECIPE.values()) == 10
        with pytest.raises(ValueError):
            Settings(SESSION_RECIPE={"new": 1, "bogus": 2})


class TestFifteenItemSession:

    def test_new_풀_한도가_대체_수요를_덮는다(self):
        """new는 **다른 전 블록의** 대체 공급원 — 한도가 배합 총합 미만이면
        뱅크에 문항이 있어도 부족분이 quiz-generate(유료)로 샌다.

        CO-M1에서 live까지 대체 대상이 되면서 최악의 수요가 new+review+unit(14)에서
        배합 전체(15)로 올라갔다 — 한도도 함께 올린다.

        조회 SELECT의 실제 LIMIT을 본다(상수 재선언이 아니라 배선 검증).
        """
        from test_r10_pool_dedup_contract import FakeDB, make_user

        db = FakeDB()
        asyncio.run(ss._fetch_pools(db, make_user(), ["typhoon"], None))
        limits = [
            stmt._limit_clause.value
            for stmt in db.stmts
            if "uses_live_slots IS true" in str(stmt)
            and "concept_tag IN" not in str(stmt)
        ]
        new_limits = [
            stmt._limit_clause.value
            for stmt in db.stmts
            if "uses_live_slots IS false" in str(stmt)
            and "concept_tag IN" not in str(stmt)
        ]
        # NEW_POOL_LIMIT은 import 시점의 **기본** 배합에서 파생된다
        # (LEGACY 전환은 모듈 상수 재계산까지 되돌리지 않는다).
        assert new_limits == [sum(settings.SESSION_RECIPE.values())]
        assert limits, "live 풀 조회가 사라졌다 — 분류 조건을 확인할 것"

    def test_계약1_15문항_5_4_1_5를_실발급(self, monkeypatch):
        session, entries = issue_session(monkeypatch)
        assert len(entries) == ss.SESSION_SIZE == LEGACY_SESSION_SIZE
        counts = {k: kinds_of(entries).count(k) for k in RECIPE}
        assert counts == {"new": 5, "review": 4, "live": 1, "unit": 5}
        assert session.recipe_json["recipe"] == RECIPE
        assert session.recipe_json["generated_count"] == 0

    def test_진도_블록이_세션_마지막_5문항(self, monkeypatch):
        """§2.10 "마지막 5문항 = 내 진도" — quiz_id 순서(=응답 순서)로 성립."""
        _, entries = issue_session(monkeypatch)
        assert kinds_of(entries)[-UNIT_COUNT:] == ["unit"] * UNIT_COUNT
        assert [e["quiz_id"] for e in entries] == sorted(
            e["quiz_id"] for e in entries
        ), "발급 순서와 quiz_id 정렬이 어긋나면 응답 순서가 블록과 달라진다"

    def test_문항별_kind가_세션_행에_기록된다(self, monkeypatch):
        """완료 화면 구분 표기(FE)와 왕관 판정 범위의 유일한 근거."""
        session, entries = issue_session(monkeypatch)
        meta = {m["quiz_id"]: m["kind"] for m in session.recipe_json["items"]}
        assert meta == {e["quiz_id"]: e["kind"] for e in entries}
        assert list(meta.values()).count("unit") == UNIT_COUNT

    def test_유형_3연속_금지가_블록_경계와_공존한다(self, monkeypatch):
        """블록 경계를 지키느라 유형 다양화(§3.2)가 죽으면 안 된다.

        앞 10문항 풀은 선두 3건이 같은 유형(=위반 상태)이고, 진도 풀은 교대
        유형이다. 결과는 3연속 0건이면서 진도 블록이 여전히 마지막이어야 한다.
        """
        head_types = ["multiple_choice"] * 3 + [
            "slider", "match", "cloze", "slider", "match", "cloze", "slider"
        ]
        pool = [make_item("new", i, t) for i, t in enumerate(head_types)]
        pool += [make_item("new", 100 + i, "match") for i in range(10)]
        unit_items = [
            make_item("unit", i, "slider" if i % 2 else "match")
            for i in range(UNIT_COUNT)
        ]
        _, entries = issue_session(
            monkeypatch, shared_pool=pool, unit_items=unit_items
        )
        types = [e["question"]["question_type"] for e in entries]
        assert not any(
            types[i] == types[i - 1] == types[i - 2] for i in range(2, len(types))
        )
        assert kinds_of(entries)[-UNIT_COUNT:] == ["unit"] * UNIT_COUNT


# ═══════════════════════════════════════════════════════════════
# 계약 3·4 · 중복 없음 · 풀 고갈 시 총합 유지
# ═══════════════════════════════════════════════════════════════


class TestBlockIntegrity:
    def test_계약3_블록_간_중복_없음(self, monkeypatch):
        """신규·복습·진도가 **같은 풀**을 봐도 같은 문항이 두 번 나오지 않는다."""
        shared = [make_item("shared", i) for i in range(30)]
        _, entries = issue_session(
            monkeypatch, shared_pool=shared, unit_items=shared
        )
        ids = [e["content_item_id"] for e in entries]
        assert len(ids) == ss.SESSION_SIZE
        assert len(set(ids)) == len(ids)

    def test_계약4_유닛_잔여_부족시_new가_메워_총합_유지(self, monkeypatch):
        """유닛 문항 2건 → 진도 2 + 신규 대체 3 = 여전히 15문항."""
        _, entries = issue_session(
            monkeypatch, unit_items=[make_item("unit", i) for i in range(2)]
        )
        assert len(entries) == ss.SESSION_SIZE
        assert kinds_of(entries).count("unit") == 2
        assert kinds_of(entries).count("new") == RECIPE["new"] + 3

    def test_열린_유닛_없어도_15문항(self, monkeypatch):
        """신규 유저(진도 블록 0) — 부족분 new 대체로 총합·발급 성공 불변."""
        session, entries = issue_session(monkeypatch, unit_items=[], unit=None)
        assert len(entries) == ss.SESSION_SIZE
        assert "unit" not in kinds_of(entries)
        assert session.recipe_json["unit_block"] is None


# ═══════════════════════════════════════════════════════════════
# 계약 2 · 진도 블록 = 현재 유닛의 다음 진도 (풀 선정)
# ═══════════════════════════════════════════════════════════════


def wire_units(monkeypatch, units, *, progress=None, pools):
    """progress_block_pool의 조회부를 대역으로 — 어느 유닛에 물었는지 기록한다.

    pools: {unit.slug: [item, ...]} — `_unit_content_pool` 재사용 지점의 반환값.
    """
    asked: list[str] = []

    async def fake_units(db):
        return list(units)

    async def fake_progress(db, user):
        return dict(progress or {})

    async def fake_abilities(db, user):
        return []

    async def fake_pool(db, user, unit, abilities=None):
        asked.append(unit.slug)
        return list(pools.get(unit.slug, []))

    monkeypatch.setattr(cs, "load_units", fake_units)
    monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
    monkeypatch.setattr(cs.weatherbrain_service, "load_abilities", fake_abilities)
    monkeypatch.setattr(cs, "_unit_content_pool", fake_pool)
    return asked


def run_block(count=UNIT_COUNT):
    user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
    return asyncio.run(cs.progress_block_pool(None, user, [], count=count))


class TestProgressBlockPool:
    def test_계약2_현재_유닛의_문항을_뽑는다(self, monkeypatch):
        u1, u2 = make_unit("sky-1", 1), make_unit("sky-2", 2)
        items = [make_item("u1", i) for i in range(UNIT_COUNT)]
        asked = wire_units(monkeypatch, [u1, u2], pools={"sky-1": items})
        picked, unit = run_block()
        assert [p.id for p in picked] == [i.id for i in items]
        assert unit is u1 and asked == ["sky-1"]  # 다음 유닛은 묻지도 않는다

    def test_클리어한_유닛은_건너뛴다(self, monkeypatch):
        u1, u2 = make_unit("sky-1", 1), make_unit("sky-2", 2)
        progress = {
            u1.id: SimpleNamespace(crowns=1, cleared_at="2026-08-05"),
        }
        items = [make_item("u2", i) for i in range(UNIT_COUNT)]
        asked = wire_units(
            monkeypatch, [u1, u2], progress=progress, pools={"sky-2": items}
        )
        _, unit = run_block()
        assert unit is u2 and asked == ["sky-2"]

    def test_잠긴_유닛은_후보가_아니다(self, monkeypatch):
        """트리 노출과 같은 잠금 규칙(is_locked 단일 정의)."""
        u1 = make_unit("sky-1", 1)
        u2 = make_unit("sky-2", 2, prereq=u1.id)  # u1 무왕관 → u2 잠김
        asked = wire_units(
            monkeypatch, [u1, u2], pools={"sky-1": [], "sky-2": [make_item("u2", 0)]}
        )
        picked, unit = run_block()
        assert asked == ["sky-1"] and picked == [] and unit is None

    def test_유닛_소진시_다음_열린_유닛으로_자동_진행(self, monkeypatch):
        """§2.10 풀 고갈 처리 — 잔여 2건이면 다음 유닛이 나머지를 잇는다."""
        u1, u2 = make_unit("sky-1", 1), make_unit("sky-2", 2)
        asked = wire_units(
            monkeypatch,
            [u1, u2],
            pools={
                "sky-1": [make_item("u1", i) for i in range(2)],
                "sky-2": [make_item("u2", i) for i in range(UNIT_COUNT)],
            },
        )
        picked, unit = run_block()
        assert len(picked) == UNIT_COUNT
        assert [p.id for p in picked][:2] == ["u1-0", "u1-1"]
        assert asked == ["sky-1", "sky-2"]
        assert unit is u1  # 왕관 대상은 블록 첫 문항의 유닛

    def test_유닛이_없으면_빈_블록(self, monkeypatch):
        wire_units(monkeypatch, [], pools={})
        assert run_block() == ([], None)

    def test_count_0이면_조회하지_않는다(self, monkeypatch):
        asked = wire_units(monkeypatch, [make_unit("sky-1", 1)], pools={})
        assert run_block(count=0) == ([], None)
        assert asked == []

    def test_세션_서비스가_진도_풀을_커리큘럼에_위임한다(self, monkeypatch):
        """지연 import 경유 배선 — 끊기면 진도 블록이 조용히 0이 된다."""
        called = {}

        async def fake_block(db, user, abilities=None, count=0):
            called["count"] = count
            return ["item"], "unit"

        monkeypatch.setattr(cs, "progress_block_pool", fake_block)
        got = asyncio.run(ss._fetch_unit_pool(None, None, [], UNIT_COUNT))
        assert got == (["item"], "unit") and called["count"] == UNIT_COUNT


# ═══════════════════════════════════════════════════════════════
# 계약 5·6 · 왕관 소유권 이전
# ═══════════════════════════════════════════════════════════════


def daily_session_with_block(*, unit_kind="quiz", block_size=UNIT_COUNT):
    """진도 블록 메타를 갖춘 데일리 세션 대역 (create_daily_session 기록 형식)."""
    session = make_session()
    items = [
        {"quiz_id": f"q{i}", "source": "bank", "slot_filled": False, "kind": kind}
        for i, kind in enumerate(
            ["new"] * 5 + ["review"] * 4 + ["live"] + ["unit"] * block_size
        )
    ]
    session.recipe_json = {
        "recipe": RECIPE,
        "generated_count": 0,
        "unit_block": {
            "unit_id": str(uuid.uuid4()), "unit_slug": "sky-1", "kind": unit_kind,
        },
        "items": items,
    }
    return session, items


def block_logs(items, *, block_correct=True, block_retry=None, others_correct=True):
    """세션 로그 대역 — 진도 블록과 나머지 블록의 정오를 따로 준다."""
    logs = []
    for meta in items:
        is_unit = meta["kind"] == "unit"
        log = make_log(
            "air_mass" if is_unit else "typhoon",
            correct=block_correct if is_unit else others_correct,
            retry_correct=block_retry if is_unit else None,
        )
        log.quiz_id = meta["quiz_id"]
        logs.append(log)
    return logs


class TestCrownOwnership:
    def test_계약5_진도_블록_전건_해결이면_왕관(self, monkeypatch):
        """나머지 10문항에 오답이 있어도 진도 블록이 깨끗하면 왕관이다(§2.10)."""
        session, items = daily_session_with_block()
        logs = block_logs(items, others_correct=False)
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert calls["award"] == ("air_mass", "quiz")  # 블록 개념으로 유입
        assert result.crown_award is not None
        assert result.all_resolved is False  # 세션 전체 표기는 그대로 미해결

    def test_계약5_진도_블록_만회_성공도_왕관(self, monkeypatch):
        """§2.1 all_resolved를 블록에 적용 — 만회로 고쳐 끝내면 인정한다."""
        session, items = daily_session_with_block()
        logs = block_logs(items, block_correct=False, block_retry=True)
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert calls["award"] == ("air_mass", "quiz")
        assert result.crown_award is not None

    def test_진도_블록_미해결이면_다른_문항이_만점이어도_왕관_없음(self, monkeypatch):
        session, items = daily_session_with_block()
        logs = block_logs(items, block_correct=False)
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert "award" not in calls and result.crown_award is None

    def test_보드_유닛_블록은_board_kind로_유입(self, monkeypatch):
        """진도 블록 유닛이 board면 왕관 대상도 board 유닛이어야 한다."""
        session, items = daily_session_with_block(unit_kind="board")
        result, calls = run_complete(
            monkeypatch, session, block_logs(items), award=AWARD
        )
        assert calls["award"] == ("air_mass", "board")

    def test_kind_메타_없는_구세션은_기존_판정_유지(self, monkeypatch):
        """개정 전 발급 세션(진도 블록 표기 없음)은 세션 전체로 폴백한다."""
        session = make_session()
        logs = [make_log("air_mass") for _ in range(3)]
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert calls["award"] == ("air_mass", "quiz")
        assert result.crown_award is not None

    def test_하루_1왕관_상한_유지_재완료는_미부여(self, monkeypatch):
        session, items = daily_session_with_block()
        session.completed_at = "2026-08-06T00:00:00+00:00"  # 이미 완료
        result, calls = run_complete(
            monkeypatch, session, block_logs(items), award=AWARD
        )
        assert "award" not in calls and result.crown_award is None

    def test_계약6_유닛_직접_진입이_왕관_유입로다(self, monkeypatch):
        """⚠️ **2026-08-12 계약 반전** — 원 계약 6은 "왕관 없이 연습만"이었다.

        종전 논리는 "왕관은 daily 세션의 **진도 블록**이 소유하므로 유닛 직접
        진입에서 또 주면 이중 수여"였다. 그 전제가 **배합에서 사라졌다** —
        `unit` kind가 기본 배합에서 빠지면서 진도 블록이 발급되지 않고,
        `routers/session.py:_crown_scope_logs`가 `kind == "unit"` 문항만 왕관 판정
        대상으로 삼으므로 daily 왕관 유입로가 통째로 0이 됐다. 왕관이 도달 불가가
        되므로 **유닛 세션 완료로 되돌린다**(클라이언트 확정).

        이중 수여를 막는 것은 이제 이 분기가 아니라 `grant_unit_crown`의 멱등
        판정이다(`crown_target` 상한 · `cleared` 전환 1회). 같은 계약을
        `test_crown_award.py`가 라우터 쪽에서 소유하고, 여기서는 **진도 블록이
        켜져 있어도(LEGACY 배합) 유닛 세션은 만점이면 왕관을 요청한다**를 본다.
        """
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)
        logs = [make_log("air_mass") for _ in range(UNIT_COUNT)]
        payload = {
            "all_correct": True, "crowns": 0, "crown_target": 1,
            "cleared": False, "unit_xp": 0,
        }
        result, calls = run_complete(
            monkeypatch, session, logs, award=AWARD, unit_payload=payload
        )
        assert calls["unit_result"] == (unit_id, True, True)
        # daily 전용 유입로(award_crown_for_activity)는 여전히 안 탄다 —
        # 유닛 세션의 왕관은 grant_unit_crown 하나로만 간다(경로 이중화 금지).
        assert "award" not in calls and result.crown_award is None
        assert result.unit_result.all_correct is True


# ═══════════════════════════════════════════════════════════════
# 응답 노출 — SessionItem.kind (3일차 FE 완료 화면 구분 표기)
# ═══════════════════════════════════════════════════════════════


class TestSessionItemKind:
    def _respond(self, monkeypatch, session, logs):
        async def fake_logs(db, s):
            return logs

        monkeypatch.setattr(session_router, "_session_logs", fake_logs)
        # 예보 마감 단계(R13 A-1)는 db=None인 이 하네스의 관심사가 아니다.
        monkeypatch.setattr(
            session_router.session_service,
            "forecast_closing_step",
            _no_closing_step,
        )
        user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
        return asyncio.run(session_router.session_today_response(None, session, user))

    def _log(self, quiz_id, is_correct=None, retry_correct=None):
        return SimpleNamespace(
            quiz_id=quiz_id,
            question_json={
                "question_type": "multiple_choice",
                "question_text": "q",
                "concept_tag": "air_mass",
            },
            is_correct=is_correct,
            # CO-A5 — 재진입 복원용 만회 결과. 응답에 그대로 실린다.
            retry_correct=retry_correct,
        )

    def test_kind가_문항마다_응답에_실린다(self, monkeypatch):
        session, items = daily_session_with_block()
        session.session_date = "2026-08-06"
        session.mode = ss.MODE_DAILY
        logs = [self._log(m["quiz_id"]) for m in items]
        payload = self._respond(monkeypatch, session, logs)
        assert [i.kind for i in payload.items] == [m["kind"] for m in items]
        assert [i.kind for i in payload.items][-UNIT_COUNT:] == ["unit"] * UNIT_COUNT

    def test_유닛_세션은_전_문항이_진도(self, monkeypatch):
        """유닛 직접 진입 세션은 recipe_json에 kind가 없다 — mode에서 파생한다."""
        session = make_session(mode=cs.MODE_UNIT, unit_id=uuid.uuid4())
        session.session_date = "2026-08-06"
        session.recipe_json = {"kind": "unit", "items": []}
        payload = self._respond(monkeypatch, session, [self._log("q0")])
        assert [i.kind for i in payload.items] == ["unit"]

    def test_배치고사는_new로_표기(self, monkeypatch):
        session = make_session(mode="placement")
        session.session_date = "2026-08-06"
        session.recipe_json = {"items": []}
        payload = self._respond(monkeypatch, session, [self._log("q0")])
        assert [i.kind for i in payload.items] == ["new"]


# ═══════════════════════════════════════════════════════════════
# CO-H5 — board 출제 상한 (비진도 블록)
# ═══════════════════════════════════════════════════════════════
class TestBoardCap:
    """`DAILY_BOARD_CAP` 계약 — 편향은 막되 배합은 덜 차지 않는다.

    R10.7 실측이 "시드 22.6% → 실출제 30.8%(1.36×)"를 남겼는데, 원인은
    `build_pool_query`에 유형 조건이 없고 `enforce_type_variety`가 **3연속만**
    보기 때문이다. 상한을 걸되 **버리지 않는다** — 버리면 그 자리가
    quiz-generate로 새고(CO-M1이 live에서 겪은 누수), 편향을 고치려다 과금이 는다.
    """

    def test_board뿐인_풀이어도_배합은_덜_차지_않는다(self):
        """상한의 대가가 '덜 발급'이면 안 된다 — 대체 후보가 없으면 그대로 채운다."""
        pool = [make_item("new", i, question_type="board") for i in range(20)]
        picks, generate_count = ss.plan_bank_picks(pool, [], [], RECIPE, [])
        assert len(picks) == sum(RECIPE.values())
        assert generate_count == 0

    def test_대체_후보가_있으면_상한을_지킨다(self):
        """board가 앞줄을 다 차지해도 비진도 블록에는 상한까지만 들어간다."""
        pool = [make_item("b", i, question_type="board") for i in range(10)]
        pool += [make_item("m", i) for i in range(20)]
        picks, _ = ss.plan_bank_picks(pool, [], [], RECIPE, [])
        non_unit = [p for p in picks if p["kind"] != "unit"]
        boards = [p for p in non_unit if p["item"].question_type == "board"]
        assert len(boards) == settings.DAILY_BOARD_CAP

    def test_진도_블록은_상한_면제(self):
        """board 유닛의 진도가 board인 것은 편향이 아니라 그 유닛의 정의다."""
        unit_pool = [make_item("unit", i, question_type="board") for i in range(10)]
        new_pool = [make_item("m", i) for i in range(20)]
        picks, _ = ss.plan_bank_picks(new_pool, [], [], RECIPE, unit_pool)
        unit_picks = [p for p in picks if p["kind"] == "unit"]
        assert len(unit_picks) == RECIPE["unit"]
        assert all(p["item"].question_type == "board" for p in unit_picks)

    def test_상한_0이면_대체_가능할_때_board가_사라진다(self, monkeypatch):
        """env로 완전히 끌 수 있다 — 보드 탭·진도 블록은 영향받지 않는다."""
        monkeypatch.setattr(settings, "DAILY_BOARD_CAP", 0)
        pool = [make_item("b", i, question_type="board") for i in range(10)]
        pool += [make_item("m", i) for i in range(20)]
        picks, _ = ss.plan_bank_picks(pool, [], [], RECIPE, [])
        non_unit = [p for p in picks if p["kind"] != "unit"]
        assert not any(p["item"].question_type == "board" for p in non_unit)

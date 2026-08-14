"""생성 문항 영속화 계약 테스트 — R13 D 선행 (BE-1).

발단: `create_daily_session`이 quiz-generate 산출물을 `content_item_id=None`으로
버렸다. 결과가 둘이다 —
- **θ·복습 큐·간격반복·문항 통계가 그 문항을 영원히 못 본다**(quiz_logs가 뱅크
  행을 가리키지 않으니 read-model이 붙을 데가 없다)
- **세션마다·유저마다 재생성**된다. G1 배치(~1,360건) 이후에는 생성 비용이 영구
  자산이 아니라 상시 트래픽 과금이 된다.

계약 6건:
1. 게이트 통과분이 `content_items`에 적재되고 **그 id로 세션에 편성**된다
2. 게이트 **탈락분은 적재하지 않고** 지금처럼 일회용으로 서빙한다(총합 15 유지)
3. 멱등 — 같은 `(concept_tag, question_text)`면 기존 행 재사용, 조회는 **배치 1회**
4. `knowledge_level`은 **미분류(NULL)** 로 저장된다(신고값이 오면 그대로 저장)
5. `status`는 `settings.GENERATED_ITEM_STATUS`(기본 `active`)
6. 다음 세션에서 **뱅크로 재사용**된다 — 두 번째 발급은 생성 0회

실행: backend 디렉토리에서 `python -m pytest tests/test_generated_item_persist.py -q`.
"""
import asyncio
import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.core.config import Settings, settings
from app.models.content_item import ContentItem
from app.services import session_service as ss

TODAY = date(2026, 8, 7)


def gen_question(n: int = 0, **overrides) -> dict:
    """quiz-generate 산출물 형식(payload_contract.QuizQuestion + quiz_id)."""
    return {
        "concept_tag": "typhoon",
        "question_type": "multiple_choice",
        "question_text": f"태풍이 에너지를 얻는 원천은 무엇일까요? ({n})",
        "options": ["따뜻한 바닷물", "차가운 육지", "높은 산의 눈", "사막의 모래"],
        "correct_answer": "따뜻한 바닷물",
        "quiz_id": f"20260807-{n:03d}",
        **overrides,
    }


class BankDB:
    """content_items 인메모리 뱅크 — add로 쌓고 멱등 조회에 응답한다.

    `execute`는 이 모듈이 실제로 내는 SELECT 두 종만 안다:
    - 멱등 조회(`template_json->>'question_text' IN (...)`) → scalars().all()
    - duels 조회(마감 단계) → scalar_one_or_none()
    """

    def __init__(self, bank=None):
        self.bank: list[ContentItem] = list(bank or [])
        self.selects: list = []

    def add(self, obj):
        if isinstance(obj, ContentItem):
            self.bank.append(obj)

    async def flush(self):
        pass

    async def execute(self, stmt):
        sql = str(stmt)
        if "content_items" in sql:
            self.selects.append(stmt)
            texts: set = set()
            for value in stmt.compile().params.values():
                # IN (...) 확장 파라미터는 리스트 하나로 컴파일된다
                texts.update(value if isinstance(value, (list, tuple)) else [value])
            rows = [
                it
                for it in self.bank
                if (it.template_json or {}).get("question_text") in texts
            ]
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))
        return SimpleNamespace(scalar_one_or_none=lambda: None)


def make_user():
    return SimpleNamespace(id=uuid.uuid4(), level_group="middle_high", region=None)


def persist(db, questions, **kwargs):
    return asyncio.run(
        ss.persist_generated_items(
            db, questions, level_group="middle_high", today=TODAY, **kwargs
        )
    )


# ═══════════════════════════════════════════════════════════════
# 계약 1·2 · 게이트 통과분만 적재
# ═══════════════════════════════════════════════════════════════


class TestQualityGate:
    def test_계약1_통과분이_뱅크에_적재된다(self):
        db = BankDB()
        items = persist(db, [gen_question(0), gen_question(1)])
        assert len(db.bank) == 2
        assert all(i is not None for i in items)
        row = db.bank[0]
        assert row.concept_tag == "typhoon"
        assert row.level_group == "middle_high"
        assert row.question_type == "multiple_choice"
        assert row.template_json["question_text"] == gen_question(0)["question_text"]
        assert row.template_json["correct_answer"] == "따뜻한 바닷물"
        # 컬럼으로 가는 키는 본문에 섞이지 않는다(quiz_id는 발급 채번값이다)
        for key in ss.GENERATED_COLUMN_KEYS:
            assert key not in row.template_json

    def test_생성_문항에는_실황_슬롯이_없다(self):
        """`{today.*}` 슬롯이 아니라 값이 이미 본문에 박혀 있다 — live 풀이 아니다."""
        db = BankDB()
        persist(db, [gen_question()])
        assert db.bank[0].uses_live_slots is False

    def test_미치환_슬롯이_섞이면_적재하지_않는다(self):
        """uses_live_slots=False로 적재되면 new 풀에 들어가고 그 풀은 치환을 안 한다.

        적재했다면 다음 세션에서 유저가 "{today.temp_max}" 원문을 보게 된다.
        """
        db = BankDB()
        items = persist(
            db,
            [gen_question(question_text="오늘 최고기온 {today.temp_max}도의 원인은?")],
        )
        assert items == [None]
        assert db.bank == []

    def test_출처_마커가_남는다(self):
        """생성분만 골라 은퇴·검수·통계 낼 수 있어야 한다."""
        db = BankDB()
        persist(db, [gen_question()], route="weakness", region="부산")
        source = db.bank[0].source
        assert source["origin"] == ss.GENERATED_ITEM_ORIGIN == "session_generate"
        assert source["route"] == "weakness"
        assert source["region"] == "부산"
        # 생성 프롬프트가 "그날의 실제 기상 수치"를 본문에 박게 하므로, 언제 만든
        # 문항인지가 나중에 은퇴 대상을 고르는 유일한 근거다.
        assert source["generated_on"] == TODAY.isoformat()

    @pytest.mark.parametrize(
        "bad",
        [
            {"concept_tag": "made_up_tag"},            # 화이트리스트 밖 개념
            {"options": ["하나", "둘", "셋"]},           # 객관식 보기 4개 아님
            {"correct_answer": "보기에 없는 답"},        # 정답이 보기에 없음
            {"question_text": ""},                     # 본문 없음
            # board·match·ordering은 채점에 template_json 밖의 구조가 필요한데
            # 시드 게이트가 그 존재를 안 본다 — 뱅크에 못 푸는 문항을 넣지 않는다
            {"question_type": "board"},
            {"question_type": "match"},
            {"knowledge_level": 99},                   # 단계 범위 밖
        ],
    )
    def test_계약2_탈락분은_적재하지_않는다(self, bad):
        """사람 저작 시드가 통과하는 것과 **같은** 결정적 휴리스틱을 적용한다."""
        db = BankDB()
        items = persist(db, [gen_question(**bad)])
        assert items == [None]
        assert db.bank == []

    def test_계약2_탈락분도_세션에서는_일회용으로_서빙된다(self):
        """버리면 배합 총합 15가 깨진다 — 적재만 생략하고 문항은 살린다."""
        db = BankDB()
        items = persist(db, [gen_question(0), gen_question(1, concept_tag="bogus")])
        assert items[0] is not None and items[1] is None
        assert len(items) == 2, "반환은 입력과 같은 길이·같은 순서다"

    def test_게이트는_시드_로더와_같은_함수다(self):
        """사본을 만들면 갈라지고, 갈라진 쪽이 반드시 느슨해진다."""
        import inspect

        assert "seed_content import validate_entry" in inspect.getsource(
            ss.persist_generated_items
        )

    def test_LLM_2단_게이트는_부르지_않는다(self):
        """문항당 유료 1콜 — 상시 과금 지점을 새로 열지 않는다(승격 검수 소관)."""
        import inspect

        src = inspect.getsource(ss.persist_generated_items)
        assert "quiz_validate" not in src and "ai_client" not in src


# ═══════════════════════════════════════════════════════════════
# 계약 3 · 멱등
# ═══════════════════════════════════════════════════════════════


class TestIdempotency:
    def test_계약3_같은_문항은_기존_행을_재사용한다(self):
        db = BankDB()
        first = persist(db, [gen_question(0)])
        second = persist(db, [gen_question(0)])
        assert len(db.bank) == 1
        assert second[0] is first[0]

    def test_계약3_같은_배치_안의_중복도_한_번만_적재(self):
        db = BankDB()
        items = persist(db, [gen_question(0), gen_question(0)])
        assert len(db.bank) == 1
        assert items[0] is items[1]

    def test_계약3_멱등_조회는_세션당_SELECT_1회(self):
        """문항마다 돌리면 인덱스 없는 JSONB 표현식 스캔이 최대 15회가 된다."""
        db = BankDB()
        persist(db, [gen_question(i) for i in range(15)])
        assert len(db.selects) == 1

    def test_계약3_적재할_것이_없으면_조회도_없다(self):
        db = BankDB()
        assert persist(db, []) == []
        # 전건 탈락이면 조회할 텍스트가 없다
        persist(db, [gen_question(concept_tag="bogus")])
        assert db.selects == []

    def test_멱등_키가_시드_로더와_같다(self):
        """`(concept_tag, question_text)` — 개념이 다르면 같은 문장이어도 별개."""
        db = BankDB()
        persist(db, [gen_question(0)])
        persist(db, [gen_question(0, concept_tag="air_mass")])
        assert len(db.bank) == 2


# ═══════════════════════════════════════════════════════════════
# 계약 4·5 · 미분류 저장 · status
# ═══════════════════════════════════════════════════════════════


class TestLevelAndStatus:
    def test_계약4_미분류_NULL로_저장된다(self):
        """단계 판정(specs/12 §4 R2~R6)은 사람 몫이고 §5.3이 기계 복원을 금지한다.

        `level_group`에서 파생해 채우는 것은 **무근거 난이도 판정**이므로 하지
        않는다 — 비워 두는 것이 계약이다.
        """
        db = BankDB()
        persist(db, [gen_question()])
        assert db.bank[0].knowledge_level is None
        assert db.bank[0].level_group == "middle_high", "학령 축은 그대로 저장된다"

    def test_계약4_신고값이_오면_그대로_저장된다(self):
        """생성 프롬프트가 단계를 신고하게 되면(다른 담당 병행) 이 자리가 채워진다."""
        db = BankDB()
        persist(db, [gen_question(knowledge_level=4)])
        assert db.bank[0].knowledge_level == 4

    def test_계약5_status는_설정값이고_기본은_active(self):
        db = BankDB()
        persist(db, [gen_question()])
        assert db.bank[0].status == settings.GENERATED_ITEM_STATUS == "active"

    def test_계약5_status는_draft_active만_허용(self):
        """'retired'는 뜻이 없다(적재 직후 은퇴). env 오설정을 기동에서 문다."""
        assert Settings(GENERATED_ITEM_STATUS="draft").GENERATED_ITEM_STATUS == "draft"
        with pytest.raises(ValueError):
            Settings(GENERATED_ITEM_STATUS="retired")

    def test_계약5_draft로_내리면_뱅크_재사용이_닫힌다(self, monkeypatch):
        """되돌리는 법의 실증 — 한 줄(env)로 재출제만 끄고 배선은 남긴다."""
        monkeypatch.setattr(ss.settings, "GENERATED_ITEM_STATUS", "draft")
        db = BankDB()
        persist(db, [gen_question()])
        assert db.bank[0].status == "draft"
        # 서빙 풀은 status='active'만 본다 → draft는 다시 안 뽑힌다
        assert "status = " in str(
            ss.build_pool_query(
                level_groups=["middle_high"], theta=None, live=False, limit=5
            )
        )


# ═══════════════════════════════════════════════════════════════
# 계약 1·6 · 세션 편성 · 다음 세션 재사용
# ═══════════════════════════════════════════════════════════════


def issue_session(monkeypatch, db, *, bank_pool=(), live_pool=(), board_pool=(),
                  generated=()):
    """create_daily_session을 실제로 돌린다 — 풀 조회·채번만 대역.

    영속화·편성·메타 기록은 실코드가 수행한다.

    ⚠️ **`_fetch_board_pool`도 반드시 대역해야 한다**(2026-08-12). R13-02 §T3의
    board 블록이 실 SELECT를 내는데, 이 하네스의 `BankDB.execute`는 `content_items`가
    걸린 쿼리를 **전부 `self.selects`에 기록**한다. 대역하지 않으면 board 풀 조회
    1건이 섞여 들어와 `test_뱅크가_배합을_채우면_적재_조회조차_없다`의
    `db.selects == []`가 깨진다 — **적재 멱등 조회가 아닌 것이 그 단정에 잡히는**
    형태라, 그걸 「고치려고」 board 쿼리를 되돌리면 T3 계약이 죽는다.
    """
    calls = {"generate": 0}

    async def fake_pools(_db, u, weak, theta=None, today=None, target_level=None):
        return list(bank_pool), [], list(live_pool)

    async def fake_unit_pool(_db, u, abilities, count):
        return [], None

    async def fake_board_pool(
        _db, u, theta, today_subq, limit=None, target_level=None
    ):
        return list(board_pool)

    async def fake_quiz_generate(**kwargs):
        question = generated[calls["generate"] % len(generated)]
        calls["generate"] += 1
        return dict(question)

    async def empty_async(*args, **kwargs):
        return []

    monkeypatch.setattr(ss, "_fetch_pools", fake_pools)
    monkeypatch.setattr(ss, "_fetch_unit_pool", fake_unit_pool)
    monkeypatch.setattr(ss, "_fetch_board_pool", fake_board_pool)
    monkeypatch.setattr(ss, "_load_weak_tag_rows", empty_async)
    monkeypatch.setattr(ss.weatherbrain_service, "refresh_abilities", empty_async)
    monkeypatch.setattr(ss, "decide_route", lambda *a, **k: _route())
    monkeypatch.setattr(ss.weatherbrain_service, "weak_concepts", lambda a, lg: [])
    monkeypatch.setattr(ss.weatherbrain_service, "overall_theta", lambda a, t=None: None)
    monkeypatch.setattr(ss, "get_today_weather", _weather())
    monkeypatch.setattr(ss.ai_client, "quiz_generate", fake_quiz_generate)
    monkeypatch.setattr(
        ss,
        "allocate_quiz_ids",
        lambda _db, uid, ts, count: _ids(ts, count),
    )
    session, entries = asyncio.run(ss.create_daily_session(db, make_user(), TODAY))
    return session, entries, calls


async def _route():
    return {"route": "general", "target_concept_tag": None}


def _weather():
    async def _stub(*args, **kwargs):
        return {"region": "서울", "forecasts": []}

    return _stub


async def _ids(today_str, count):
    return [f"{today_str}-{i + 1:03d}" for i in range(count)]


def make_bank_item(i: int) -> ContentItem:
    return ContentItem(
        id=uuid.uuid4(),
        concept_tag="air_mass",
        level_group="middle_high",
        question_type="multiple_choice",
        template_json={"question_text": f"bank-{i}?", "correct_answer": "a"},
        uses_live_slots=False,
        status="active",
    )


class TestSessionWiring:
    def test_계약1_생성_문항이_content_item_id를_달고_편성된다(self, monkeypatch):
        db = BankDB()
        session, entries, _ = issue_session(
            monkeypatch, db, generated=[gen_question(i) for i in range(ss.SESSION_SIZE)]
        )
        assert len(entries) == ss.SESSION_SIZE
        generated_entries = [e for e in entries if e["source"] == "generated"]
        assert len(generated_entries) == ss.SESSION_SIZE
        assert all(e["content_item_id"] is not None for e in generated_entries), (
            "id가 없으면 θ·복습 큐·간격반복이 이 문항을 영원히 못 본다"
        )
        assert {e["content_item_id"] for e in generated_entries} == {
            it.id for it in db.bank
        }
        assert session.recipe_json["generated_count"] == ss.SESSION_SIZE
        assert session.recipe_json["persisted_count"] == ss.SESSION_SIZE

    def test_탈락분은_id_없이_편성되고_총합은_그대로(self, monkeypatch):
        db = BankDB()
        bad = [gen_question(i, concept_tag="bogus") for i in range(ss.SESSION_SIZE)]
        session, entries, _ = issue_session(monkeypatch, db, generated=bad)
        assert len(entries) == ss.SESSION_SIZE
        assert all(e["content_item_id"] is None for e in entries)
        assert db.bank == []
        assert session.recipe_json["generated_count"] == ss.SESSION_SIZE
        assert session.recipe_json["persisted_count"] == 0

    def test_계약6_다음_세션은_뱅크에서_재사용해_생성_0회(self, monkeypatch):
        """영속화의 목적 — 생성 1회 비용이 영구 자산이 된다.

        1회차: 뱅크 0건 → 15문항 전량 생성 → 15건 적재.
        2회차: 그 15건이 뱅크 풀로 들어온다 → quiz-generate **0회**.
        """
        db = BankDB()
        _, first, calls1 = issue_session(
            monkeypatch, db, generated=[gen_question(i) for i in range(ss.SESSION_SIZE)]
        )
        assert calls1["generate"] == ss.SESSION_SIZE
        assert len(db.bank) == ss.SESSION_SIZE

        # 적재분이 서빙 조건(status active · 슬롯 없음)을 만족하므로 new 풀에 들어온다
        assert all(it.status == "active" for it in db.bank)
        persisted_ids = {it.id for it in db.bank}
        _, second, calls2 = issue_session(
            monkeypatch,
            db,
            bank_pool=list(db.bank),
            live_pool=list(db.bank[-1:]),  # 실황 1칸도 뱅크가 채워야 생성이 0이 된다
            generated=[gen_question(99)],
        )
        assert calls2["generate"] == 0, "뱅크에 있는데 또 생성하면 비용이 증발한다"
        assert all(e["source"] == "bank" for e in second)
        assert {e["content_item_id"] for e in second} <= persisted_ids
        assert len(db.bank) == ss.SESSION_SIZE, "재사용은 새 행을 만들지 않는다"

    def test_뱅크가_배합을_채우면_적재_조회조차_없다(self, monkeypatch):
        """생성 폴백이 0이면 멱등 조회 비용도 0이다.

        ✅ **xfail 해제(2026-08-12)** — 여기 걸려 있던 표식의 사유는 "배합에 board가
        생겼는데 `plan_bank_picks`에 board 분기가 없어 매 세션 quiz-generate 1콜이
        샌다"였다. 담당 H가 board 블록을 배선해 **누수는 닫혔다**.

        ⚠️ 표식을 **그냥 걷으면 안 됐다**: 누수와 별개로 H의 board 풀 SELECT 1건이
        `db.selects`에 잡혀 이 테스트가 계속 붉었다. 그건 결함이 아니라 **하네스가
        `_fetch_board_pool`을 대역하지 않은 것**이라, 위 `issue_session`에 대역을
        추가해서 닫았다. 여기서 세는 `db.selects`는 **적재 멱등 조회**이지 풀 조회가
        아니다.
        """
        db = BankDB()
        _, entries, calls = issue_session(
            monkeypatch,
            db,
            bank_pool=[make_bank_item(i) for i in range(ss.SESSION_SIZE)],
            live_pool=[make_bank_item(99)],
            generated=[gen_question(0)],
        )
        assert calls["generate"] == 0
        assert db.selects == []
        assert len(entries) == ss.SESSION_SIZE

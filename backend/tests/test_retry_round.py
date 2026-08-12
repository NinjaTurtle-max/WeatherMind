"""만회 라운드 계약 테스트 — 스프린트 R13-01 §2.1 (BE-1).

계약 5건(§2.1 검증 목록)을 기계 검증한다:

1. 만회 성공 → 왕관 부여 (daily·unit 양쪽 경로)
2. 만회 실패 → 왕관 없음
3. 최초 정답 문항 재제출 불가 (409 ALREADY_ANSWERED — 멱등 의미론 보존)
4. `is_correct` 불변 (θ·뱅크 통계·약점 태그의 근거를 만회로 덮지 않는다)
5. 구름 무소모 · XP 무가산 (만회는 벌도 파밍도 아니다)

+ 마이그레이션 0011 체인·downgrade, 응답 스키마 additive 필드.

DB 없이 검증: FakeDB가 select 대상 테이블별로 준비된 객체를 돌려주고 실행된
statement를 수집한다(test_review_fix_regressions 관례). 라우터는 limiter를
inspect.unwrap으로 벗겨 직접 호출한다(test_crown_award 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_retry_round.py -q`.
"""
import asyncio
import importlib.util
import inspect
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import Select, Update

from app.models.quiz_log import QuizLog
from app.routers import session as session_router
from app.schemas.session import SessionAnswerRequest
from app.services import answer_service
from app.services import curriculum_service as cs
from app.services.answer_service import AlreadyAnsweredError

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_0011 = VERSIONS_DIR / "20260806_0011_retry_round.py"

CORRECT = "수증기 응결열"
WRONG = "지열"


# ═══════════════════════════════════════════════════════════════
# 대역
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, value=None, rows=None):
        self._value = value
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class FakeDB:
    """quiz_logs select는 준비된 로그를, 나머지는 빈 응답을 돌려주는 대역."""

    def __init__(self, quiz_log=None, logs=None):
        self.quiz_log = quiz_log
        self.logs = logs if logs is not None else ([quiz_log] if quiz_log else [])
        self.executed = []
        self.added = []
        self.get_calls = 0

    async def execute(self, stmt):
        self.executed.append(stmt)
        if isinstance(stmt, Select):
            table = stmt.get_final_froms()[0].name
            if table == "quiz_logs":
                return FakeResult(self.quiz_log, rows=self.logs)
        return FakeResult()

    async def get(self, model, pk):
        self.get_calls += 1
        return None

    async def flush(self):
        pass

    def add(self, obj):
        self.added.append(obj)

    def updates_on(self, table_name: str) -> list:
        return [
            stmt
            for stmt in self.executed
            if isinstance(stmt, Update) and stmt.table.name == table_name
        ]


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    """날씨 조회·RAG 피드백을 정적 응답으로 대체 (네트워크 차단)."""

    async def fake_weather(*args, **kwargs):
        return {}

    async def fake_feedback(**kwargs):
        return "피드백"

    monkeypatch.setattr(answer_service, "get_today_weather", fake_weather)
    monkeypatch.setattr(answer_service.ai_client, "rag_feedback", fake_feedback)


def make_log(*, is_correct=False, retry_correct=None, session_id=None,
             content_item_id=None, concept_tag="typhoon") -> QuizLog:
    """최초 채점이 끝난 세션 문항 로그 (기본: 오답 = 만회 대상)."""
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id="20260806-001",
        concept_tag=concept_tag,
        question_type="multiple_choice",
        question_json={
            "question_type": "multiple_choice",
            "question_text": "태풍의 에너지원은?",
            "options": [CORRECT, WRONG, "조력", "풍력"],
            "correct_answer": CORRECT,
        },
        session_id=session_id,
        content_item_id=content_item_id,
        user_answer=None if is_correct is None else (CORRECT if is_correct else WRONG),
        is_correct=is_correct,
        retry_correct=retry_correct,
        elapsed_sec=12 if is_correct is not None else None,
    )


def run_retry(db, log, answer=CORRECT):
    user = SimpleNamespace(id=log.user_id, level_group="middle_high", region=None)
    return asyncio.run(answer_service.submit_retry_for_log(db, user, log, answer))


# ═══════════════════════════════════════════════════════════════
# 계약 4 · is_retry_eligible — 멱등 예외의 경계 (순수)
# ═══════════════════════════════════════════════════════════════


class TestRetryEligibility:
    def test_최초_오답만_만회_대상(self):
        assert answer_service.is_retry_eligible(make_log(is_correct=False)) is True

    def test_최초_정답은_만회_대상_아님(self):
        """[계약 3] 맞힌 문항을 다시 제출해 결과를 바꿀 통로가 없어야 한다."""
        assert answer_service.is_retry_eligible(make_log(is_correct=True)) is False

    def test_미응답은_만회_대상_아님(self):
        """만회는 최초 제출을 대체하지 않는다 — 미응답은 일반 경로로 간다."""
        assert answer_service.is_retry_eligible(make_log(is_correct=None)) is False

    def test_이미_만회_성공한_문항은_대상_아님(self):
        """해결된 문항의 재제출로 retry_correct가 True→False로 뒤집히면 안 된다."""
        log = make_log(is_correct=False, retry_correct=True)
        assert answer_service.is_retry_eligible(log) is False

    def test_만회_실패는_다시_시도_가능(self):
        log = make_log(is_correct=False, retry_correct=False)
        assert answer_service.is_retry_eligible(log) is True


# ═══════════════════════════════════════════════════════════════
# 계약 4·5 · 서비스층 — is_correct 불변 · XP 0 · 부수효과 0
# ═══════════════════════════════════════════════════════════════


class TestRetryImmutability:
    def test_계약4_만회_성공해도_is_correct는_False_그대로(self):
        log = make_log(is_correct=False)
        before = (log.user_answer, log.elapsed_sec, log.answered_at)
        result = run_retry(FakeDB(), log, CORRECT)

        assert result.is_correct is True      # 만회 채점 결과
        assert log.retry_correct is True      # 만회 컬럼에만 기록
        assert log.is_correct is False, (
            "만회가 최초 정오 기록을 덮었다 — θ 추정·뱅크 통계·약점 태그가 "
            "전부 부풀려진다(§2.1 '불변 보존')"
        )
        assert (log.user_answer, log.elapsed_sec, log.answered_at) == before

    def test_계약4_만회_실패도_is_correct_불변(self):
        log = make_log(is_correct=False)
        result = run_retry(FakeDB(), log, WRONG)
        assert result.is_correct is False
        assert log.retry_correct is False
        assert log.is_correct is False

    def test_계약3_만회_대상_아니면_AlreadyAnswered(self):
        """[계약 3] 최초 정답 문항의 재제출은 기존 멱등 경로(409)로 간다."""
        log = make_log(is_correct=True)
        db = FakeDB()
        with pytest.raises(AlreadyAnsweredError):
            run_retry(db, log)
        assert db.executed == [] and db.added == []
        assert log.retry_correct is None


class TestRetryNoXpNoStats:
    def test_계약5_XP_무가산(self):
        log = make_log(is_correct=False, session_id=uuid.uuid4())
        db = FakeDB()
        result = run_retry(db, log, CORRECT)
        assert (result.xp_earned, result.xp_base, result.xp_weak_bonus) == (0, 0, 0)
        assert db.updates_on("sessions") == [], (
            "만회가 sessions.xp_total을 올렸다 — 오답 후 재도전이 XP 최적 전략이 "
            "되어 파밍이 된다"
        )
        assert db.added == [] and db.get_calls == 0  # 유저 XP 가산 경로 미진입

    def test_뱅크_통계_미갱신(self):
        """같은 문항의 두 번째 풀이는 새 표본이 아니다 — 정답률이 왜곡된다."""
        log = make_log(is_correct=False, content_item_id=uuid.uuid4())
        db = FakeDB()
        run_retry(db, log, CORRECT)
        assert db.updates_on("content_items") == []

    def test_weak_tags_미갱신(self):
        log = make_log(is_correct=False)
        db = FakeDB()
        run_retry(db, log, CORRECT)
        assert db.updates_on("weak_tags") == []
        assert not [
            stmt for stmt in db.executed
            if isinstance(stmt, Select)
            and stmt.get_final_froms()[0].name == "weak_tags"
        ]


# ═══════════════════════════════════════════════════════════════
# 계약 5 · 라우터 answer 경로 — 구름 무소모 · 응답 스키마
# ═══════════════════════════════════════════════════════════════


def make_session(mode="daily", unit_id=None, completed=False, route_target=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        mode=mode,
        unit_id=unit_id,
        session_date=date(2026, 8, 6),
        completed_at=datetime.now(timezone.utc) if completed else None,
        xp_total=50,
        route_decision=(
            {"target_concept_tag": route_target} if route_target else None
        ),
    )


def run_answer(monkeypatch, session, log, answer=CORRECT):
    """submit_session_answer를 배선 검증용으로 실행 — 에너지 호출을 수집한다."""
    calls = {"consume": 0}

    async def fake_load(db, user, session_id):
        return session

    async def fake_state(db, user, now=None):
        return {"clouds": 3, "max": 5, "next_regen_sec": 0, "updated_at": None}

    async def fake_consume(db, user, now=None):
        calls["consume"] += 1
        return 2

    monkeypatch.setattr(session_router, "_load_session_or_404", fake_load)
    monkeypatch.setattr(session_router.energy_service, "get_state", fake_state)
    monkeypatch.setattr(
        session_router.energy_service, "consume_if_available", fake_consume
    )

    endpoint = inspect.unwrap(session_router.submit_session_answer)
    user = SimpleNamespace(
        id=session.user_id, level_group="middle_high", region=None
    )
    result = asyncio.run(
        endpoint(
            None,  # request — limiter 우회로 미사용
            session.id,
            SessionAnswerRequest(quiz_id=log.quiz_id, answer=answer),
            user,
            FakeDB(quiz_log=log),
        )
    )
    return result, calls


class TestRetryAnswerRoute:
    def test_계약5_만회는_구름을_소모하지_않는다(self, monkeypatch):
        """만회 실패에도 소모 0 — 만회는 벌이 아니다(§2.1)."""
        session = make_session()
        log = make_log(is_correct=False, session_id=session.id)
        result, calls = run_answer(monkeypatch, session, log, WRONG)
        assert calls["consume"] == 0
        assert result.clouds_spent == 0
        assert result.clouds == 3
        assert result.is_retry is True and result.retry_correct is False

    def test_만회_성공_응답_스키마(self, monkeypatch):
        session = make_session()
        log = make_log(is_correct=False, session_id=session.id)
        result, calls = run_answer(monkeypatch, session, log, CORRECT)
        assert result.is_retry is True
        assert result.retry_correct is True
        assert result.is_correct is True
        assert result.xp_earned == 0
        assert (result.clouds_spent, calls["consume"]) == (0, 0)
        assert log.retry_correct is True and log.is_correct is False

    def test_계약3_최초_정답_재제출은_409(self, monkeypatch):
        """만회 경로로 새지 않고 기존 멱등 가드(AlreadyAnswered→409)에 걸린다."""
        session = make_session()
        log = make_log(is_correct=True, session_id=session.id)
        with pytest.raises(AlreadyAnsweredError):
            run_answer(monkeypatch, session, log, WRONG)

    def test_배치고사는_만회_경로_미적용(self, monkeypatch):
        """placement는 진단이라 재제출이 멱등 그대로다(만회는 학습 루프 장치)."""
        session = make_session(mode="placement")
        log = make_log(is_correct=False, session_id=session.id)
        with pytest.raises(AlreadyAnsweredError):
            run_answer(monkeypatch, session, log, CORRECT)
        assert log.retry_correct is None


# ═══════════════════════════════════════════════════════════════
# 계약 1·2 · 왕관 정책 개정 — all_correct → all_resolved
# ═══════════════════════════════════════════════════════════════


def make_clog(concept_tag="air_mass", correct=True, retry_correct=None):
    return SimpleNamespace(
        concept_tag=concept_tag,
        is_correct=correct,
        retry_correct=retry_correct,
        user_answer="답",
    )


AWARD = {"unit_slug": "sky-1", "unit_title": "구름 읽기", "crowns": 1, "cleared": True}
UNIT_PAYLOAD = {
    "all_correct": False, "crowns": 1, "crown_target": 1,
    "cleared": True, "unit_xp": 20,
}


async def _no_closing_step(db, user, today=None):
    """예보 마감 단계 대역 — "단계 없음"(R13 A-1)."""
    return None


def run_complete(monkeypatch, session, logs, *, award=AWARD, unit_payload=None):
    calls = {}

    async def fake_load(db, user, session_id):
        return session

    async def fake_logs(db, s):
        return logs

    async def fake_award(db, user, *, concept_tag, kind):
        calls["award"] = (concept_tag, kind)
        return award

    async def fake_unit_result(db, user, unit_id, *, all_correct, grant_crown):
        calls["unit_result"] = (unit_id, all_correct, grant_crown)
        return unit_payload

    async def fake_badge(db, user_id, badge):
        calls["badge"] = badge
        return False  # 신규 지급 아님 — 라우터가 bool로 분기한다 (CO-T-4)

    async def fake_quests(db, user, day):
        return []  # 전환 목록(라우터가 소비) — CO-T-4

    # 예보 마감 단계(R13 A-1)는 이 하네스의 관심사가 아니다 — 단계 없음으로 고정
    # (판정은 tests/test_forecast_closing_step.py 소유).
    monkeypatch.setattr(
        session_router.session_service, "forecast_closing_step", _no_closing_step
    )
    monkeypatch.setattr(session_router, "_load_session_or_404", fake_load)
    monkeypatch.setattr(session_router, "_session_logs", fake_logs)
    monkeypatch.setattr(cs, "award_crown_for_activity", fake_award)
    monkeypatch.setattr(cs, "unit_result_for_session", fake_unit_result)
    monkeypatch.setattr(session_router.badge_service, "award_badge", fake_badge)
    monkeypatch.setattr(session_router.quest_service, "recalculate_quests", fake_quests)

    user = SimpleNamespace(
        id=session.user_id, level_group="elementary", streak_count=3
    )
    result = asyncio.run(
        session_router.complete_session(session.id, user, FakeDB())
    )
    return result, calls


class TestCrownPolicyAllResolved:
    def test_계약1_만회_성공하면_왕관_부여(self, monkeypatch):
        """오답 1건을 만회로 해결한 데일리 세션은 왕관 대상이다(개정 핵심)."""
        session = make_session()
        logs = [
            make_clog("air_mass"),
            make_clog("air_mass", correct=False, retry_correct=True),
        ]
        result, calls = run_complete(monkeypatch, session, logs)
        assert calls["award"] == ("air_mass", "quiz")
        assert result.crown_award is not None
        assert result.all_resolved is True
        assert result.retry_resolved_count == 1
        # correct_count는 **최초 정답 수** 그대로 — 통계 근거 불변
        assert result.correct_count == 1 and result.total == 2

    def test_계약2_만회_실패하면_왕관_없음(self, monkeypatch):
        session = make_session()
        logs = [
            make_clog("air_mass"),
            make_clog("air_mass", correct=False, retry_correct=False),
        ]
        result, calls = run_complete(monkeypatch, session, logs)
        assert "award" not in calls
        assert result.crown_award is None
        assert result.all_resolved is False
        assert result.retry_resolved_count == 0

    def test_만회_미시도_오답은_왕관_없음(self, monkeypatch):
        """retry_correct=None(만회 안 함)은 개정 전과 동일하게 미해결이다."""
        session = make_session()
        logs = [make_clog("air_mass"), make_clog("air_mass", correct=False)]
        result, calls = run_complete(monkeypatch, session, logs)
        assert "award" not in calls and result.all_resolved is False

    def test_만회_없는_만점은_기존_동작과_동일(self, monkeypatch):
        session = make_session()
        logs = [make_clog("air_mass") for _ in range(5)]
        result, calls = run_complete(monkeypatch, session, logs)
        assert calls["award"] == ("air_mass", "quiz")
        assert result.all_resolved is True and result.retry_resolved_count == 0

    def test_재완료_멱등은_만회_성공에도_왕관_없음(self, monkeypatch):
        """세션 최초 완료 조건은 유지된다(§2.1) — 만회가 상한을 풀지 않는다."""
        session = make_session(completed=True)
        logs = [make_clog("air_mass", correct=False, retry_correct=True)]
        result, calls = run_complete(monkeypatch, session, logs)
        assert "award" not in calls and result.crown_award is None
        assert result.all_resolved is True  # 표기는 해결로 나가되 왕관은 없다

    def test_유닛_세션은_만회로도_왕관_없음(self, monkeypatch):
        """§2.1 all_resolved 표기는 유지, 왕관은 §2.10에서 회수됐다.

        개정 전(§2.1 단독)에는 만회 해결이 grant_crown=True를 열었다. §2.10이
        왕관 유입로를 일일 세션 진도 블록으로 옮기면서 유닛 직접 진입은 연습
        전용이 됐다 — grant는 항상 False이고 all_resolved만 응답에 실린다.
        """
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)
        logs = [
            make_clog("air_mass"),
            make_clog("air_mass", correct=False, retry_correct=True),
        ]
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=UNIT_PAYLOAD
        )
        unit, all_correct_arg, grant = calls["unit_result"]
        assert (unit, grant) == (unit_id, False)
        # all_correct는 "최초 만점" 뜻을 유지하고, 만회 포함 판정은 all_resolved
        assert all_correct_arg is False
        assert result.unit_result.all_correct is False
        assert result.unit_result.all_resolved is True

    def test_유닛_세션_만회_실패는_grant_crown_False(self, monkeypatch):
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)
        logs = [make_clog("air_mass", correct=False, retry_correct=False)]
        payload = dict(UNIT_PAYLOAD, crowns=0, cleared=False, unit_xp=0)
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=payload
        )
        assert calls["unit_result"] == (unit_id, False, False)
        assert result.unit_result.all_resolved is False

    def test_perfect_session_배지는_최초_만점만(self, monkeypatch):
        """무오답 배지는 '틀리지 않았다'는 뜻이라 만회로 열리지 않는다."""
        session = make_session()
        logs = [make_clog("air_mass", correct=False, retry_correct=True)]
        _, calls = run_complete(monkeypatch, session, logs)
        assert "badge" not in calls


# ═══════════════════════════════════════════════════════════════
# 마이그레이션 0011 (0010 관례 — downgrade 필수·단일 head)
# ═══════════════════════════════════════════════════════════════


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestMigration0011:
    def test_revision_체인(self):
        module = _load_migration(MIGRATION_0011)
        assert module.revision == "0011_retry_round"
        assert module.down_revision == "0010_user_region"

    def test_downgrade_왕복_정의(self):
        module = _load_migration(MIGRATION_0011)
        assert callable(module.upgrade) and callable(module.downgrade)
        source = MIGRATION_0011.read_text(encoding="utf-8")
        assert 'op.add_column(\n        "quiz_logs", sa.Column("retry_correct"' in source
        assert 'op.drop_column("quiz_logs", "retry_correct")' in source

    def test_단일_head(self):
        """alembic heads가 **하나** — 병렬 번호 충돌 감시.

        체인 끝은 최신 리비전이다(R13-0에서 0012_two_axis_levels가 0011 위로 올라갔다).
        감시 대상은 "head가 갈라지지 않는다"이지 특정 번호가 아니다(0010 관례 주석).
        """
        revisions: dict[str, str | None] = {}
        pattern = re.compile(
            r'^(revision|down_revision)(?::\s*[^=]+)?\s*=\s*(?:"([^"]+)"|None)',
            re.MULTILINE,
        )
        for path in VERSIONS_DIR.glob("*.py"):
            found = dict(
                (kind, value or None)
                for kind, value in pattern.findall(path.read_text(encoding="utf-8"))
            )
            revisions[found["revision"]] = found.get("down_revision")
        referenced = {down for down in revisions.values() if down}
        heads = set(revisions) - referenced
        # ⚠️ **개수만 본다.** 이 독스트링이 "특정 번호가 아니다"라고 적어 놓고
        # 정작 번호를 단정하고 있어서, 리비전을 하나 추가할 때마다 세 파일이 함께
        # 깨졌다(2026-08-12 `0014_clouds_default_ten`). 감시하려는 것은 head가
        # 갈라지지 않는다는 것 하나이므로 그것만 문다.
        assert len(heads) == 1, f"alembic head가 갈라졌다: {sorted(heads)}"

    def test_모델_컬럼_계약(self):
        """quiz_logs.retry_correct — nullable Boolean, 서버 기본값 없음(NULL=미시도)."""
        column = QuizLog.__table__.columns["retry_correct"]
        assert column.nullable is True
        assert column.server_default is None
        assert column.type.python_type is bool

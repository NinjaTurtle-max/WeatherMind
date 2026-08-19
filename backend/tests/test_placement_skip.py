"""배치고사 「모르겠어요」(스킵) 계약 — 2026-08-19 클라이언트 지시. DB 불필요.

지시 원문: *"배치고사에 문제마다 모르겠어요 버튼을 만들어 문제 건너 뛰도록하자
그러고 모르겠다 한것은 틀린 것으로 모델에 할"*.

와이어 형식은 기존 `answer` 필드에 담는 센티널이다(새 필드 금지 —
`schemas/onboarding.py`가 extra='forbid'라 신 프론트 + 구 백엔드가 전건 422가 되고
백엔드 선배포가 강제된다). 센티널 상수의 단일 소유자는
`answer_service.PLACEMENT_SKIP_SENTINEL`이고, 프론트·목이 같은 리터럴을 쓴다.

■ **「오답으로 모델에 반영됐다」의 정의** — 이 파일의 단정이 딛는 정의다.
아래 넷이 **모두** 참일 때만 반영된 것으로 본다:
  ⑴ 그 문항이 θ 조립 payload에 `correct: False`로 **존재**한다(표본에서 빠지지 않았다),
  ⑵ 표본 수 `n`이 제출 문항 수와 같다,
  ⑶ 전건 정답 θ **>** 전건 스킵 θ (방향),
  ⑷ 스킵을 **실제 오답 답안**으로 바꿔도 θ가 **완전히 같다**(오답과 동일 취급).
⚠️ ⑶만 물으면 조용히 통과한다 — 스킵이 표본에서 **빠져도** EAP는 사전분포로
수축해 θ가 내려간 것처럼 보인다. 그래서 ⑴·⑵로 "빠진 것"과 "오답으로 들어간 것"을
구별하고, 그 대조군으로 **응답 0개(=누락) θ**를 함께 추정해 스킵 θ가 그것과 다름을
단정한다(TestThetaConsumesSkipAsWrong).

경로가 **둘**이라는 것이 이 기능의 함정이다: bulk(`/onboarding/placement/submit-all`
→ `submit_answers_bulk`)와 문항별(`/session/{id}/answer` → `submit_answer_for_log`,
`is_placement` 분기로 여전히 placement를 받는다). 프론트가 오늘 bulk만 쓰는 것은
**상태이지 계약이 아니라서** 두 경로를 같이 문다(TestPathParity).

θ 추정은 HTTP 없이 ai-worker 수학 모듈을 직접 임포트한다
(test_weatherbrain_theta_pipeline._import_ai_worker 관례 답습).
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import Update
from sqlalchemy.dialects import postgresql

from app.models.quiz_log import QuizLog
from app.routers.session import _progress_of
from app.services import answer_service
from app.services import placement_service as ps
from app.services import weatherbrain_service as wb

AI_WORKER_DIR = Path(__file__).resolve().parents[2] / "ai-worker"

SENTINEL = answer_service.PLACEMENT_SKIP_SENTINEL


def _import_ai_worker(module_name: str):
    """ai-worker 모듈을 backend `app` 패키지와 충돌 없이 임포트
    (test_weatherbrain_theta_pipeline._import_ai_worker 관례 답습)."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module(module_name)
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


placement_math = _import_ai_worker("app.weatherbrain.placement")


# ═══════════════════════════════════════════════════════════════
# 대역 — test_placement_bulk.FakeDB 관례
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def scalar_one_or_none(self):
        return None

    def all(self):
        return []


class FakeDB:
    """실행 statement 수집 대역 (test_placement_bulk.FakeDB 관례)."""

    def __init__(self):
        self.executed = []

    async def execute(self, stmt):
        self.executed.append(stmt)
        return FakeResult()

    async def get(self, model, pk):
        return None

    async def flush(self):
        pass

    def add(self, obj):
        pass

    def updates_on(self, table_name: str) -> list:
        return [
            stmt
            for stmt in self.executed
            if isinstance(stmt, Update) and stmt.table.name == table_name
        ]

    def inserts_on(self, table_name: str) -> list:
        return [
            stmt
            for stmt in self.executed
            if not isinstance(stmt, Update)
            and getattr(getattr(stmt, "table", None), "name", None) == table_name
        ]


@pytest.fixture(autouse=True)
def forbid_external(monkeypatch):
    """스킵 채점은 외부 호출을 하지 않는다 — 날씨·RAG가 불리면 즉시 실패.

    문항별 경로는 `build_feedback`을 타는데, 시드 전건에 해설이 저작돼 있어
    (`explanation_hint`) authored 갈래로 떨어진다 — 이 파일의 문항 대역도 해설을
    갖고, 그래서 RAG 호출이 0이어야 한다.
    """

    async def must_not_call(*args, **kwargs):  # pragma: no cover
        raise AssertionError("스킵 채점 경로가 외부 호출을 했다")

    monkeypatch.setattr(answer_service, "get_today_weather", must_not_call)
    monkeypatch.setattr(answer_service.ai_client, "rag_feedback", must_not_call)


def question(
    question_type: str = "multiple_choice",
    concept_tag: str = "typhoon",
    **extra,
) -> dict:
    base = {
        "question_type": question_type,
        "question_text": "태풍의 에너지원은?",
        "concept_tag": concept_tag,
        "correct_answer": "수증기 응결열",
        "options": ["수증기 응결열", "지열", "조력", "풍력"],
        # 해설 저작분 — build_feedback이 authored 갈래로 떨어져 RAG를 안 부른다
        "explanation_hint": "태풍은 수증기가 응결할 때 나오는 잠열로 자란다.",
    }
    base.update(extra)
    return base


def make_log(quiz_id: str, q: dict, *, content_item_id=None) -> QuizLog:
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id=quiz_id,
        session_id=uuid.uuid4(),
        content_item_id=content_item_id,
        concept_tag=q["concept_tag"],
        question_type=q["question_type"],
        question_json=q,
    )


def submit_bulk(db, logs, answers):
    user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
    return asyncio.run(answer_service.submit_answers_bulk(db, user, logs, answers))


def submit_one(db, log, answer):
    """문항별 경로 — placement는 grant_xp=False (routers/session.py:427)."""
    user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
    return asyncio.run(
        answer_service.submit_answer_for_log(
            db, user, log, answer, None, grant_xp=False
        )
    )


def weak_tag_params(db) -> list[dict]:
    """weak_tags upsert의 바인드 파라미터 — pg_insert라 postgresql 방언으로 컴파일."""
    return [
        stmt.compile(dialect=postgresql.dialect()).params
        for stmt in db.inserts_on("weak_tags")
    ]


# ═══════════════════════════════════════════════════════════════
# 센티널 자체 — 프론트·목이 이 값을 그대로 복제한다
# ═══════════════════════════════════════════════════════════════


class TestSentinelContract:
    def test_센티널_값은_계약값(self):
        """이 리터럴이 프론트·목과 공유되는 와이어 값이다(변경 = 3자 동시 변경)."""
        assert SENTINEL == "__skip__"

    def test_센티널은_비어_있지_않다(self):
        """빈 문자열이면 목의 slider(`Number("")=0`)가 정답 판정을 내 서버와 갈린다."""
        assert SENTINEL and SENTINEL.strip() == SENTINEL

    def test_스키마_변경_없이_실린다(self):
        """센티널은 기존 `answer`에 담긴다 — 새 필드는 extra='forbid'에 막힌다."""
        from app.schemas.onboarding import PlacementAnswerItem

        item = PlacementAnswerItem(quiz_id="20260819-001", answer=SENTINEL)
        assert item.answer == SENTINEL

    @pytest.mark.parametrize(
        "value", [" __skip__ ", "__SKIP__", "__skip", "skip", "", "모르겠어요"]
    )
    def test_is_skip은_완전_일치만(self, value):
        """관대하게 받으면 센티널이 매직 문자열 한 벌로 번식한다."""
        assert answer_service.is_skip(value) is False

    def test_is_skip은_센티널에_참(self):
        assert answer_service.is_skip(SENTINEL) is True


# ═══════════════════════════════════════════════════════════════
# 채점 — 유형·문항과 무관하게 오답
# ═══════════════════════════════════════════════════════════════


class TestGradeAlwaysWrong:
    """placement 6유형(board 제외 — 풀이 구조적으로 뺀다) 전건 오답."""

    QUESTIONS = {
        "multiple_choice": {"correct_answer": "수증기 응결열"},
        "short_answer": {"correct_answer": "장마"},
        "cloze": {"correct_answer": "저기압"},
        "slider": {"correct_answer": "60"},
        "match": {"pairs": [{"left": "한랭전선", "right": "소나기"}]},
        "ordering": {"items": ["증발", "응결", "강수"]},
    }

    @pytest.mark.parametrize("question_type", sorted(QUESTIONS))
    def test_6유형_스킵은_오답(self, question_type):
        q = question(question_type, **self.QUESTIONS[question_type])
        assert answer_service.grade(q, SENTINEL) is False

    def test_정답이_센티널인_문항도_스킵은_오답(self):
        """**명시 가드의 유일한 증인.**

        6유형은 센티널에서 구조적으로도 오답이라(파싱 실패·':' 없음·문자열 불일치)
        `grade`의 `if is_skip` 한 줄을 지워도 다른 단정은 전부 초록이다. 정답이
        우연히 센티널과 같은 문항만 그 가드를 실제로 시험한다 — 스킵은 문항이
        무엇이든 오답이라는 것이 계약이고, 그것을 문항 데이터 상태에 의존시키지 않는다.
        """
        assert answer_service.grade(question(correct_answer=SENTINEL), SENTINEL) is False

    def test_정답이_빈_문항에서도_스킵은_오답(self):
        """`_grade_text`(answer_service.py:97-100)는 correct_answer가 비면 **빈 답을
        정답**으로 판정한다. 센티널은 비어 있지 않으므로 그 함정과 무관하다는 확인
        (빈 답이 정답이 되는 기존 성질 자체는 이 변경이 건드리지 않는다)."""
        q = question(correct_answer="")
        assert answer_service.grade(q, SENTINEL) is False
        assert answer_service.grade(q, "") is True  # 기존 성질 — 변경 대상 아님


# ═══════════════════════════════════════════════════════════════
# 두 제출 경로 — 로그·진척·weak_tags·뱅크 통계
# ═══════════════════════════════════════════════════════════════


class TestBulkPath:
    """bulk 경로(`/onboarding/placement/submit-all`)."""

    def test_스킵은_is_correct_False_로그를_남긴다(self):
        db = FakeDB()
        log = make_log("20260819-001", question())
        results = submit_bulk(db, [log], [("20260819-001", SENTINEL, 3)])
        assert results == [("20260819-001", False)]
        assert log.is_correct is False
        assert log.user_answer == SENTINEL  # 센티널이 원문 그대로 보존된다
        assert log.answered_at is not None

    def test_스킵은_진척을_올린다(self):
        """`_progress_of`(routers/session.py:161-163)는 `is_correct is not None`을
        센다. 스킵은 False를 넣으므로 세어지고, 그것이 `complete`의 409 게이트
        (routers/session.py:468 `answered < total`) 통과 조건이다."""
        db = FakeDB()
        logs = [make_log(f"20260819-00{i}", question()) for i in range(1, 4)]
        submit_bulk(db, logs, [(log.quiz_id, SENTINEL, None) for log in logs])
        progress = _progress_of(logs)
        assert progress.answered == progress.total == 3

    def test_스킵은_weak_tags에_오답으로_반영된다(self):
        db = FakeDB()
        log = make_log("20260819-001", question())
        submit_bulk(db, [log], [("20260819-001", SENTINEL, None)])
        params = weak_tag_params(db)
        assert len(params) == 1
        assert params[0]["wrong_count"] == 1
        assert params[0]["total_count"] == 1

    def test_스킵은_stat_total을_올리지_않는다(self):
        """스킵은 문항 난이도에 대한 증거가 아니다 — `calibrate_items`로 흘러가면
        학습자가 안 푼 문항이 실제보다 어려워진다(A조 판단)."""
        db = FakeDB()
        log = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        submit_bulk(db, [log], [("20260819-001", SENTINEL, None)])
        assert db.updates_on("content_items") == []

    def test_같은_세션의_실제_답안은_여전히_통계에_센다(self):
        """스킵 제외가 통계 갱신 자체를 끄지 않는다 — 스킵분만 빠진다."""
        db = FakeDB()
        skipped = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        answered = make_log("20260819-002", question(), content_item_id=uuid.uuid4())
        submit_bulk(
            db,
            [skipped, answered],
            [
                ("20260819-001", SENTINEL, None),
                ("20260819-002", "수증기 응결열", None),
            ],
        )
        updates = db.updates_on("content_items")
        assert len(updates) == 1
        assert answered.content_item_id in updates[0].compile().params.values()


class TestPerItemPath:
    """문항별 경로(`/session/{id}/answer` — routers/session.py:393-441이
    `is_placement` 분기로 placement 제출을 여전히 받는다)."""

    def test_스킵은_is_correct_False_로그를_남긴다(self):
        db = FakeDB()
        log = make_log("20260819-001", question())
        result = submit_one(db, log, SENTINEL)
        assert result.is_correct is False
        assert log.is_correct is False
        assert log.user_answer == SENTINEL
        assert _progress_of([log]).answered == 1

    def test_스킵은_weak_tags에_오답으로_반영된다(self):
        db = FakeDB()
        submit_one(db, make_log("20260819-001", question()), SENTINEL)
        params = weak_tag_params(db)
        assert len(params) == 1
        assert params[0]["wrong_count"] == 1

    def test_스킵은_stat_total을_올리지_않는다(self):
        db = FakeDB()
        log = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        submit_one(db, log, SENTINEL)
        assert db.updates_on("content_items") == []

    def test_실제_답안은_여전히_통계에_센다(self):
        db = FakeDB()
        log = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        submit_one(db, log, "수증기 응결열")
        assert len(db.updates_on("content_items")) == 1

    def test_스킵_피드백은_저작_해설이고_RAG를_안_부른다(self):
        """`forbid_external`이 RAG를 부르면 실패시킨다 — 스킵도 해설을 본다."""
        db = FakeDB()
        log = make_log("20260819-001", question())
        result = submit_one(db, log, SENTINEL)
        assert result.feedback_source == "authored"
        assert result.feedback == question()["explanation_hint"]


class TestPathParity:
    """🔴 두 경로가 스킵을 **같게** 다룬다 — 프론트가 bulk만 쓴다는 것은 상태다."""

    def test_로그_종료_상태가_같다(self):
        bulk_log = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        item_log = make_log("20260819-001", question(), content_item_id=uuid.uuid4())
        submit_bulk(FakeDB(), [bulk_log], [("20260819-001", SENTINEL, 7)])
        submit_one(FakeDB(), item_log, SENTINEL)
        assert bulk_log.is_correct is item_log.is_correct is False
        assert bulk_log.user_answer == item_log.user_answer == SENTINEL
        assert bulk_log.answered_at is not None and item_log.answered_at is not None

    def test_뱅크_통계_제외가_같다(self):
        bulk_db, item_db = FakeDB(), FakeDB()
        submit_bulk(
            bulk_db,
            [make_log("20260819-001", question(), content_item_id=uuid.uuid4())],
            [("20260819-001", SENTINEL, None)],
        )
        submit_one(
            item_db,
            make_log("20260819-001", question(), content_item_id=uuid.uuid4()),
            SENTINEL,
        )
        assert bulk_db.updates_on("content_items") == []
        assert item_db.updates_on("content_items") == []

    def test_weak_tags_반영이_같다(self):
        bulk_db, item_db = FakeDB(), FakeDB()
        submit_bulk(
            bulk_db,
            [make_log("20260819-001", question())],
            [("20260819-001", SENTINEL, None)],
        )
        submit_one(item_db, make_log("20260819-001", question()), SENTINEL)
        assert weak_tag_params(bulk_db)[0]["wrong_count"] == 1
        assert weak_tag_params(item_db)[0]["wrong_count"] == 1

    def test_채점_판정이_같다(self):
        """두 경로가 같은 `grade`를 타는 것이 정합의 구조적 근거다."""
        for question_type, extra in TestGradeAlwaysWrong.QUESTIONS.items():
            q = question(question_type, **extra)
            bulk_log = make_log("20260819-001", q)
            item_log = make_log("20260819-001", q)
            submit_bulk(FakeDB(), [bulk_log], [("20260819-001", SENTINEL, None)])
            submit_one(FakeDB(), item_log, SENTINEL)
            assert bulk_log.is_correct is item_log.is_correct is False


# ═══════════════════════════════════════════════════════════════
# 🔴 θ — 스킵이 **오답으로 소비되는지**(누락이 아닌지)
# ═══════════════════════════════════════════════════════════════


def _session_logs(item_ids: list[uuid.UUID]) -> list[QuizLog]:
    """개념 6종에 걸친 배치 세션 대역 — 문항마다 뱅크 id가 있다."""
    tags = list(wb.PLACEMENT_QUIZ_TAGS)
    return [
        make_log(
            f"20260819-00{i + 1}",
            question(concept_tag=tags[i % len(tags)]),
            content_item_id=item_id,
        )
        for i, item_id in enumerate(item_ids)
    ]


# 문항 밴드를 퍼뜨린다 — b가 문항마다 다른 실제 조립 경로를 타게 하려는 것
# (b의 소유자는 weatherbrain_service.LEVEL_GROUP_ITEM_B이고 여기서 값을 복제하지 않는다)
_BANDS = ("elementary", "middle_high", "adult", "expert", "middle_high", "adult")

LEVEL_GROUP = "middle_high"


def _graded_theta(answers_for: str) -> dict[str, dict[str, float]]:
    """제출 → 채점(bulk) → θ 조립 → EAP까지 실제 경로로 통과시킨다.

    answers_for: 'skip'(센티널) | 'wrong'(틀린 실답안) | 'right'(정답).
    EAP는 ai-worker main.weatherbrain_placement와 **같은 조립**을 쓴다
    (main.py:405-413 — b는 조립기가 채워 넣으므로 prior_b 폴백을 타지 않는다).
    """
    item_ids = [uuid.uuid4() for _ in _BANDS]
    logs = _session_logs(item_ids)
    answer = {"skip": SENTINEL, "wrong": "지열", "right": "수증기 응결열"}[answers_for]
    submit_bulk(FakeDB(), logs, [(log.quiz_id, answer, None) for log in logs])

    responses = ps.assemble_placement_responses(
        logs,
        {},  # 보정 b 없음 → 문항 밴드의 사전 b
        dict(zip(item_ids, _BANDS)),
        LEVEL_GROUP,
    )
    return _estimate(responses)


def _estimate(responses: dict[str, list[dict]]) -> dict[str, dict[str, float]]:
    payload = {
        tag: [(r["b"], r["a"], r["correct"]) for r in items]
        for tag, items in responses.items()
    }
    return placement_math.initial_abilities(
        level_group=LEVEL_GROUP,
        concept_tags=list(wb.PLACEMENT_QUIZ_TAGS),
        placement_responses=payload,
    )


class TestThetaConsumesSkipAsWrong:
    """정의 ⑴~⑷(모듈 독스트링)을 그대로 단정한다."""

    def test_정의1_조립_payload에_correct_False로_존재한다(self):
        """최종 θ만 보면 표본에서 **빠져도** 값이 비슷해 보일 수 있다 — 그래서
        조립 결과를 직접 본다(placement_service.py:281-313)."""
        item_ids = [uuid.uuid4() for _ in _BANDS]
        logs = _session_logs(item_ids)
        submit_bulk(FakeDB(), logs, [(log.quiz_id, SENTINEL, None) for log in logs])

        responses = ps.assemble_placement_responses(
            logs, {}, dict(zip(item_ids, _BANDS)), LEVEL_GROUP
        )
        flat = [r for items in responses.values() for r in items]
        assert len(flat) == len(logs)  # 한 건도 누락되지 않았다
        assert all(r["correct"] is False for r in flat)

    def test_정의2_표본_수_n이_제출_문항_수와_같다(self):
        """`n`은 「빠진 것」과 「오답으로 들어간 것」을 가르는 가장 값싼 구별이다 —
        누락이면 n=0으로 떨어지고 θ는 사전값이 된다."""
        skip = _graded_theta("skip")
        tags = list(wb.PLACEMENT_QUIZ_TAGS)
        assert sum(int(skip[tag]["n"]) for tag in tags) == len(_BANDS)
        assert all(int(skip[tag]["n"]) > 0 for tag in tags)

    def test_정의2b_누락과_구별된다_스킵θ는_사전값이_아니다(self):
        """대조군: 응답 0개(=스킵이 표본에서 빠진 세계)의 θ. 스킵 θ가 이것과
        같으면 「반영됐다」가 거짓인데도 「θ가 내려갔다」류 단정은 통과한다."""
        skip = _graded_theta("skip")
        omitted = _estimate({})  # 응답 0개 → 사전분포 그대로
        for tag in wb.PLACEMENT_QUIZ_TAGS:
            assert int(omitted[tag]["n"]) == 0
            assert skip[tag]["theta"] != pytest.approx(omitted[tag]["theta"])
            assert skip[tag]["theta"] < omitted[tag]["theta"]

    def test_정의3_전건_정답θ가_전건_스킵θ보다_크다(self):
        right, skip = _graded_theta("right"), _graded_theta("skip")
        for tag in wb.PLACEMENT_QUIZ_TAGS:
            assert right[tag]["theta"] > skip[tag]["theta"], tag

    def test_정의4_스킵θ는_오답θ와_완전히_같다(self):
        """**이 기능의 핵심 계약** — 「모르겠다 한것은 틀린 것으로 모델에」."""
        skip, wrong = _graded_theta("skip"), _graded_theta("wrong")
        for tag in wb.PLACEMENT_QUIZ_TAGS:
            assert skip[tag]["theta"] == pytest.approx(wrong[tag]["theta"])
            assert skip[tag]["se"] == pytest.approx(wrong[tag]["se"])
            assert int(skip[tag]["n"]) == int(wrong[tag]["n"])

    def test_조립기는_손댈_것이_없다는_근거(self):
        """`assemble_placement_responses`는 `bool(log.is_correct)`를 쓴다
        (placement_service.py:311) — 스킵은 is_correct=False로 들어오므로
        그 함수에 변경이 **없다**. 없는데 고치면 위험만 늘어난다."""
        skip_log = make_log("20260819-001", question())
        submit_bulk(FakeDB(), [skip_log], [("20260819-001", SENTINEL, None)])
        wrong_log = make_log("20260819-001", question())
        submit_bulk(FakeDB(), [wrong_log], [("20260819-001", "지열", None)])
        assert ps.assemble_placement_responses(
            [skip_log], {}, {}, LEVEL_GROUP
        ) == ps.assemble_placement_responses([wrong_log], {}, {}, LEVEL_GROUP)


class TestAllSkipSessionTerminates:
    """전건 스킵 세션이 정상 종료한다 — θ가 하한으로 내려가되 예외 없음."""

    def test_전건_스킵도_complete_게이트를_통과한다(self):
        logs = _session_logs([uuid.uuid4() for _ in _BANDS])
        submit_bulk(FakeDB(), logs, [(log.quiz_id, SENTINEL, None) for log in logs])
        progress = _progress_of(logs)
        assert progress.answered == progress.total == len(_BANDS)
        # complete의 409 조건(routers/session.py:468)이 거짓임을 그대로 확인
        assert not (progress.answered < progress.total or progress.total == 0)

    def test_전건_스킵_θ는_유한하고_격자_안이다(self):
        skip = _graded_theta("skip")
        for tag in wb.PLACEMENT_QUIZ_TAGS:
            theta = skip[tag]["theta"]
            assert -4.0 <= theta <= 4.0  # EAP 격자 범위(irt.THETA_GRID)
            assert skip[tag]["se"] > 0

    def test_전건_스킵_선해제는_전건_오답과_같은_판정을_받는다(self):
        """`placement_unlock_floor`는 θ만 본다. 스킵 θ == 오답 θ(정의 ⑷)이므로
        「전건 오답 → 선해제 0」(test_placement_unlock_level.py::
        test_전건_오답은_선해제_0)이 전건 스킵에도 그대로 성립한다 — 그 값의
        소유자는 그 파일이라 여기 θ 표를 복제하지 않고 **동치**만 단정한다."""
        from app.services import curriculum_service as cs

        skip, wrong = _graded_theta("skip"), _graded_theta("wrong")
        to_abilities = lambda est: [  # noqa: E731 — 표현식 하나짜리 지역 변환
            {
                "concept_tag": tag,
                "theta": est[tag]["theta"],
                "se": est[tag]["se"],
                "n": int(est[tag]["n"]),
            }
            for tag in wb.PLACEMENT_QUIZ_TAGS
        ]
        units = [
            SimpleNamespace(
                slug=f"u{i}", section=list(cs.SECTION_ORDER)[0], unit_order=i
            )
            for i in range(1, 5)
        ]
        skip_floor = cs.placement_unlock_floor(to_abilities(skip), units, LEVEL_GROUP)
        assert skip_floor == cs.placement_unlock_floor(
            to_abilities(wrong), units, LEVEL_GROUP
        )
        # 비퇴화 근거: 같은 트리가 전건 정답에서는 **열린다** — 위 동치가 "이 대역
        # 트리는 무엇을 줘도 0"이라는 사정으로 통과한 것이 아님을 보인다.
        assert (
            cs.placement_unlock_floor(
                to_abilities(_graded_theta("right")), units, LEVEL_GROUP
            )
            > skip_floor
        )

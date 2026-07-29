"""배치고사 일괄 채점 단위·계약 테스트 — 스프린트 R7-02 §3.1·§3.7.

FakeDB(실행 statement 수집 대역)·순수 함수 관례로 DB 없이 검증한다
(test_answer_service·test_placement 스타일). 대상:

- answer_service.submit_answers_bulk: 전건 채점·멱등 스킵·RAG/XP 미수행·
  weak_tags/뱅크 통계 갱신·GRADERS 정합
- submit-all 스키마: 채점 결과 필드 주입 거부(extra='forbid' → FastAPI 422)
- 라우터 계약: 에러 코드 실재(소스 텍스트 가드)·레이트리밋 LIMIT_TODAY급
- ai_client.rag_feedback 타임아웃 10s 계약 (§3.7 — 채점 지연 원인 제거,
  드리프트 감시)
"""
import asyncio
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import Update

from app.core.rate_limit import LIMIT_SUBMIT_ALL, LIMIT_TODAY
from app.models.quiz_log import QuizLog
from app.schemas.onboarding import PlacementAnswerItem, PlacementSubmitAllRequest
from app.services import ai_client, answer_service
from app.services.answer_service import QuizNotInSessionError


class FakeResult:
    def scalar_one_or_none(self):
        return None


class FakeDB:
    """실행 statement 수집 대역 (test_answer_service.FakeDB 관례)."""

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


def make_log(
    quiz_id: str,
    question: dict,
    *,
    content_item_id=None,
    answered: bool = False,
) -> QuizLog:
    return QuizLog(
        user_id=uuid.uuid4(),
        quiz_id=quiz_id,
        session_id=uuid.uuid4(),
        content_item_id=content_item_id,
        concept_tag=question.get("concept_tag", "typhoon"),
        question_type=question["question_type"],
        question_json=question,
        user_answer="기존답" if answered else None,
        is_correct=False if answered else None,
    )


def mc_question(correct: str = "수증기 응결열") -> dict:
    return {
        "question_type": "multiple_choice",
        "question_text": "태풍의 에너지원은?",
        "options": [correct, "지열", "조력", "풍력"],
        "correct_answer": correct,
        "concept_tag": "typhoon",
    }


def submit_bulk(db, logs, answers):
    user = SimpleNamespace(id=uuid.uuid4())
    return asyncio.run(
        answer_service.submit_answers_bulk(db, user, logs, answers)
    )


def weak_tag_stmts(db) -> list:
    return [
        stmt
        for stmt in db.executed
        if getattr(getattr(stmt, "table", None), "name", None) == "weak_tags"
        and not isinstance(stmt, Update)
    ]


@pytest.fixture
def forbid_external(monkeypatch):
    """일괄 채점은 순수 루프 — 날씨 조회·RAG 호출이 있으면 즉시 실패."""

    async def must_not_call(*args, **kwargs):  # pragma: no cover - 호출 시 실패
        raise AssertionError("submit_answers_bulk는 외부 호출을 하면 안 된다")

    monkeypatch.setattr(answer_service, "get_today_weather", must_not_call)
    monkeypatch.setattr(answer_service.ai_client, "rag_feedback", must_not_call)


@pytest.mark.usefixtures("forbid_external")
class TestSubmitAnswersBulk:
    def test_전건_미채점이면_전건_채점(self):
        db = FakeDB()
        logs = [make_log(f"20260729-00{i}", mc_question()) for i in range(1, 4)]
        results = submit_bulk(
            db,
            logs,
            [
                ("20260729-001", "수증기 응결열", 10),
                ("20260729-002", "지열", None),
                ("20260729-003", "수증기 응결열", 5),
            ],
        )
        assert results == [
            ("20260729-001", True),
            ("20260729-002", False),
            ("20260729-003", True),
        ]
        assert all(log.is_correct is not None for log in logs)
        assert all(log.answered_at is not None for log in logs)
        assert logs[0].elapsed_sec == 10 and logs[1].elapsed_sec is None
        assert len(weak_tag_stmts(db)) == 3  # 진단 응답도 학습 데이터 (§3.3)

    def test_XP_세션_xp_total_미갱신(self):
        """placement 계약: XP·스트릭·퀘스트·에너지 없음 — sessions UPDATE 0건."""
        db = FakeDB()
        logs = [make_log("20260729-001", mc_question())]
        submit_bulk(db, logs, [("20260729-001", "수증기 응결열", None)])
        assert db.updates_on("sessions") == []

    def test_뱅크_통계는_기존_answer_경로와_동일_원자_UPDATE(self):
        db = FakeDB()
        item_id = uuid.uuid4()
        logs = [
            make_log("20260729-001", mc_question(), content_item_id=item_id),
            make_log("20260729-002", mc_question()),  # 뱅크 아님 → UPDATE 없음
        ]
        submit_bulk(
            db,
            logs,
            [("20260729-001", "수증기 응결열", None), ("20260729-002", "지열", None)],
        )
        updates = db.updates_on("content_items")
        assert len(updates) == 1
        assert item_id in updates[0].compile().params.values()

    def test_기채점_로그는_멱등_스킵(self):
        """재진입 UX: 전체 409로 죽이지 않고 기존 결과를 그대로 싣는다."""
        db = FakeDB()
        answered = make_log("20260729-001", mc_question(), answered=True)
        fresh = make_log("20260729-002", mc_question())
        results = submit_bulk(
            db,
            [answered, fresh],
            [
                ("20260729-001", "수증기 응결열", None),
                ("20260729-002", "수증기 응결열", None),
            ],
        )
        assert results == [("20260729-001", False), ("20260729-002", True)]
        assert answered.user_answer == "기존답"  # 덮어쓰기 없음
        assert answered.is_correct is False
        assert len(weak_tag_stmts(db)) == 1  # 스킵 로그는 부수효과 없음

    def test_같은_요청_내_중복_quiz_id도_한_번만_채점(self):
        db = FakeDB()
        logs = [make_log("20260729-001", mc_question())]
        results = submit_bulk(
            db,
            logs,
            [
                ("20260729-001", "수증기 응결열", None),
                ("20260729-001", "지열", None),  # 두 번째는 멱등 가드
            ],
        )
        assert results == [("20260729-001", True), ("20260729-001", True)]
        assert logs[0].user_answer == "수증기 응결열"
        assert len(weak_tag_stmts(db)) == 1

    def test_세션에_없는_quiz_id는_QuizNotInSessionError(self):
        db = FakeDB()
        logs = [make_log("20260729-001", mc_question())]
        with pytest.raises(QuizNotInSessionError):
            submit_bulk(db, logs, [("20260729-999", "답", None)])


@pytest.mark.usefixtures("forbid_external")
class TestBulkGraderRegistry:
    """§3.1: 일괄 채점도 GRADERS 레지스트리 정합 — placement 6유형 전부.

    7유형 중 board는 placement 풀이 구조적으로 제외한다
    (plan_placement_picks·_placement_pool — test_placement가 가드).
    """

    CASES = {
        "multiple_choice": (
            {"correct_answer": "수증기 응결열"}, "수증기 응결열", "지열",
        ),
        "short_answer": ({"correct_answer": "장마"}, " 장마 ", "폭염"),
        "cloze": ({"correct_answer": "저기압"}, "저기압", "고기압"),
        "slider": ({"correct_answer": "60"}, "65", "80"),  # ±10 허용
        "match": (
            {"pairs": [
                {"left": "한랭전선", "right": "소나기"},
                {"left": "온난전선", "right": "이슬비"},
            ]},
            "온난전선:이슬비|한랭전선:소나기",  # 순서 무관
            "한랭전선:이슬비|온난전선:소나기",
        ),
        "ordering": ({"items": ["증발", "응결", "강수"]}, "0,1,2", "2,1,0"),
    }

    @pytest.mark.parametrize("question_type", sorted(CASES))
    def test_placement_6유형_정답_오답_채점(self, question_type):
        extra, correct_answer, wrong_answer = self.CASES[question_type]
        question = {
            "question_type": question_type,
            "question_text": "q",
            "concept_tag": "typhoon",
            **extra,
        }
        db = FakeDB()
        logs = [
            make_log("20260729-001", question),
            make_log("20260729-002", question),
        ]
        results = submit_bulk(
            db,
            logs,
            [
                ("20260729-001", correct_answer, None),
                ("20260729-002", wrong_answer, None),
            ],
        )
        assert results == [("20260729-001", True), ("20260729-002", False)]

    def test_GRADERS는_7유형_전부_등록(self):
        assert set(answer_service.GRADERS) == {
            "multiple_choice", "short_answer", "slider",
            "board", "match", "ordering", "cloze",
        }


class TestSubmitAllSchema:
    """§3.1: 채점 결과 필드 수신 금지 — 채점 권위 서버 소유 (CLAUDE.md).

    스키마에 결과 필드를 정의하지 않고 extra='forbid'로 주입 자체를 거부한다.
    pydantic ValidationError는 FastAPI가 422로 변환한다.
    """

    def test_채점_결과_필드_주입은_검증_실패(self):
        with pytest.raises(ValidationError):
            PlacementAnswerItem(quiz_id="20260729-001", answer="a", is_correct=True)

    @pytest.mark.parametrize("field", ["is_correct", "correct", "xp_earned", "score"])
    def test_결과성_미정의_필드는_전부_거부(self, field):
        with pytest.raises(ValidationError):
            PlacementSubmitAllRequest(
                answers=[{"quiz_id": "20260729-001", "answer": "a", field: 1}]
            )

    def test_요청_최상위_미정의_필드도_거부(self):
        with pytest.raises(ValidationError):
            PlacementSubmitAllRequest(answers=[], results=[])

    def test_정상_body는_수용_elapsed_sec은_선택(self):
        req = PlacementSubmitAllRequest(
            answers=[
                {"quiz_id": "20260729-001", "answer": "a", "elapsed_sec": 3},
                {"quiz_id": "20260729-002", "answer": "b"},
            ]
        )
        assert req.answers[1].elapsed_sec is None

    def test_스키마에_결과_필드_미정의(self):
        assert not (
            {"is_correct", "xp_earned"} & set(PlacementAnswerItem.model_fields)
        )


class TestSubmitAllRouterContract:
    """라우터 계약 — 에러 코드 실재(소스 텍스트 가드)·레이트리밋 LIMIT_TODAY급."""

    def test_에러_코드_실재(self):
        """404 2종이 담당 라우터 소스에 실재 (test_error_code_contract 방식)."""
        source = (
            Path(__file__).resolve().parents[1] / "app" / "routers" / "onboarding.py"
        ).read_text(encoding="utf-8")
        codes = set(re.findall(r'"code":\s*"([A-Z_]+)"', source))
        assert {"PLACEMENT_SESSION_NOT_FOUND", "QUIZ_NOT_FOUND"} <= codes

    def test_레이트리밋은_LIMIT_TODAY급(self):
        """§3.1: 요청 1건이 세션 전체 채점 — 발급 계열과 동급 한도."""
        assert LIMIT_SUBMIT_ALL == LIMIT_TODAY == "10/minute"


class TestRagFeedbackTimeoutContract:
    """§3.7: rag-feedback 타임아웃 60s→10s — 다른 내부 호출(15s)과 정합.

    문항별 answer 경로가 문항마다 rag_feedback을 동기 대기하는 것이 채점 지연의
    원인이었다. 상수 기본값 = 계약값(10s) 유지가 계약 (SESSION_RECIPE·CLOUD_* 전례).
    """

    def test_타임아웃_상수는_계약값_10s(self):
        assert ai_client.RAG_FEEDBACK_TIMEOUT == 10.0

    def test_rag_feedback은_전용_타임아웃으로_호출(self, monkeypatch):
        """_post 기본값(60s)이 아니라 RAG_FEEDBACK_TIMEOUT을 명시 전달한다."""
        captured = {}

        async def fake_post(path, payload, timeout=60.0):
            captured["path"] = path
            captured["timeout"] = timeout
            return {"feedback": "ok"}

        monkeypatch.setattr(ai_client, "_post", fake_post)
        asyncio.run(
            ai_client.rag_feedback(
                question_text="q",
                user_answer="a",
                is_correct=True,
                concept_tag="typhoon",
                today_weather={},
            )
        )
        assert captured["path"] == "/internal/rag-feedback"
        assert captured["timeout"] == 10.0

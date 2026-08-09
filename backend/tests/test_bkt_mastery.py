"""BKT 숙련도 배선 계약 (backend 쪽) — R13-01 §5-1. DB·네트워크 불필요.

지키는 것:
  1. 조립 — quiz_logs를 개념별 **시간 오름차순** 정오답 시퀀스로 모으고,
     채점 안 된 행(is_correct NULL)은 제외한다.
  2. 만회 결과 미반영 — retry_correct는 BKT 관측이 아니다(is_correct만 읽는다).
  3. 콜드스타트 — 응답 0건이면 ai-worker를 호출조차 하지 않고 빈 목록.
  4. 라벨 — cold_start가 값보다 우선하고, 경계는 여기서 고정된다.
  5. 복원력 — ai-worker 장애면 빈 목록(예외 전파 금지). 패널만 비고 화면은 산다.
  6. θ 독립 — 숙련 경로는 user_concept_ability를 읽지도 쓰지도 않고,
     load/refresh_abilities도 호출하지 않는다.
  7. 라우터 왕복 — GET /progress/mastery의 응답 형식과 정렬.

FakeDB 관례는 test_unit_pool_theta와 같다(execute된 stmt 캡처 + 미리 준비한 행).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.routers import progress as progress_router
from app.schemas.progress import ConceptMasteryOut
from app.services import weatherbrain_service as wb
from app.services.ai_client import AIWorkerError


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeDB:
    """준비한 행을 돌려주고 실행된 stmt를 캡처한다 — 실DB 불필요."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.stmts = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        return _FakeResult(self.rows)


class _FakeUser:
    id = uuid.uuid4()
    level_group = "middle_high"


BASE = datetime(2026, 8, 7, 9, 0, tzinfo=timezone.utc)


def log_rows(*specs):
    """(concept_tag, is_correct, 분_오프셋) → _assemble_mastery_sequences 행 형식."""
    return [(tag, correct) for tag, correct, _m in specs]


class TestAssembleSequences:
    def test_개념별_시퀀스로_모으고_시간순_정렬을_요구한다(self):
        db = FakeDB(
            rows=[("typhoon", True), ("air_mass", False), ("typhoon", False)]
        )
        seqs = asyncio.run(wb._assemble_mastery_sequences(db, _FakeUser()))
        assert seqs == {"typhoon": [True, False], "air_mass": [False]}

        sql = str(db.stmts[0]).lower()
        # 순서가 곧 모델 입력이다 — ORDER BY가 빠지면 BKT 궤적이 무의미해진다.
        assert "order by quiz_logs.answered_at asc" in sql
        # 채점 안 된 행 제외 · 본인 행만.
        assert "is_correct is not null" in sql
        assert "quiz_logs.user_id" in sql

    def test_만회결과는_관측이_아니다(self):
        """retry_correct를 읽으면 오답 직후 재시도가 숙련을 위로 편향시킨다."""
        db = FakeDB()
        asyncio.run(wb._assemble_mastery_sequences(db, _FakeUser()))
        assert "retry_correct" not in str(db.stmts[0]).lower()

    def test_θ_저장소를_건드리지_않는다(self):
        db = FakeDB()
        asyncio.run(wb._assemble_mastery_sequences(db, _FakeUser()))
        assert "user_concept_ability" not in str(db.stmts[0]).lower()


class TestLoadMastery:
    def test_응답이_없으면_ai_worker를_호출하지_않는다(self, monkeypatch):
        called = {"n": 0}

        async def boom(**_kw):
            called["n"] += 1
            raise AssertionError("응답 0건인데 ai-worker를 호출했다")

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", boom)
        assert asyncio.run(wb.load_mastery(FakeDB(rows=[]), _FakeUser())) == []
        assert called["n"] == 0

    def test_숙련_낮은_순_정렬(self, monkeypatch):
        async def fake(**_kw):
            return {
                "masteries": [
                    {"concept_tag": "high", "p_mastery": 0.9, "p_next_correct": 0.8,
                     "n": 5, "cold_start": False, "params_source": "prior"},
                    {"concept_tag": "low", "p_mastery": 0.2, "p_next_correct": 0.3,
                     "n": 5, "cold_start": False, "params_source": "prior"},
                ]
            }

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", fake)
        rows = asyncio.run(
            wb.load_mastery(FakeDB(rows=[("low", False)]), _FakeUser())
        )
        assert [r["concept_tag"] for r in rows] == ["low", "high"]

    def test_ai_worker_장애면_빈_목록_폴백(self, monkeypatch):
        async def fail(**_kw):
            raise AIWorkerError("down")

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", fail)
        assert asyncio.run(
            wb.load_mastery(FakeDB(rows=[("typhoon", True)]), _FakeUser())
        ) == []

    def test_전송_페이로드는_시간순_bool_시퀀스(self, monkeypatch):
        seen = {}

        async def fake(**kw):
            seen.update(kw)
            return {"masteries": []}

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", fake)
        asyncio.run(
            wb.load_mastery(
                FakeDB(rows=[("typhoon", True), ("typhoon", False)]), _FakeUser()
            )
        )
        assert seen["concepts"] == [{"concept_tag": "typhoon", "corrects": [True, False]}]

    def test_θ_경로를_호출하지_않는다(self, monkeypatch):
        """축 독립 — 숙련 조회가 θ를 재추정하면 두 축이 얽힌다."""

        async def fail(*_a, **_k):
            raise AssertionError("숙련 조회가 θ 경로를 호출했다")

        monkeypatch.setattr(wb, "refresh_abilities", fail)
        monkeypatch.setattr(wb, "load_abilities", fail)

        async def fake(**_kw):
            return {"masteries": []}

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", fake)
        assert asyncio.run(
            wb.load_mastery(FakeDB(rows=[("typhoon", True)]), _FakeUser())
        ) == []

    def test_θ_추정은_숙련_엔드포인트를_호출하지_않는다(self, monkeypatch):
        async def boom(**_kw):
            raise AssertionError("refresh_abilities가 BKT를 호출했다")

        monkeypatch.setattr(wb.ai_client, "weatherbrain_mastery", boom)

        async def fake_estimate(**_kw):
            return {"abilities": []}

        monkeypatch.setattr(wb.ai_client, "weatherbrain_estimate", fake_estimate)
        db = FakeDB(rows=[])  # 응답 0건 → load_abilities 경로
        assert asyncio.run(wb.refresh_abilities(db, _FakeUser())) == []


class TestMasteryLabel:
    def test_콜드스타트가_값보다_우선(self):
        assert wb.mastery_label(0.99, True) == "insufficient"

    def test_밴드_경계(self):
        assert wb.mastery_label(wb.MASTERY_MASTERED_MIN, False) == "mastered"
        assert wb.mastery_label(wb.MASTERY_MASTERED_MIN - 1e-9, False) == "learning"
        assert wb.mastery_label(wb.MASTERY_LEARNING_MIN, False) == "learning"
        assert wb.mastery_label(wb.MASTERY_LEARNING_MIN - 1e-9, False) == "beginning"

    def test_경계값_계약(self):
        """드리프트 감시 — 프론트 칩 색·문구가 이 4종 라벨에 대응한다."""
        assert (wb.MASTERY_LEARNING_MIN, wb.MASTERY_MASTERED_MIN) == (0.5, 0.8)
        labels = {
            wb.mastery_label(p, False) for p in (0.1, 0.6, 0.95)
        } | {wb.mastery_label(0.5, True)}
        assert labels == {"beginning", "learning", "mastered", "insufficient"}


class TestMasteryRouter:
    def _call(self, monkeypatch, rows):
        async def fake_load(_db, _user):
            return rows

        monkeypatch.setattr(
            progress_router.weatherbrain_service, "load_mastery", fake_load
        )
        return asyncio.run(progress_router.get_mastery(user=_FakeUser(), db=FakeDB()))

    def test_왕복_형식(self, monkeypatch):
        out = self._call(
            monkeypatch,
            [
                {"concept_tag": "typhoon", "p_mastery": 0.91, "p_next_correct": 0.82,
                 "n": 7, "cold_start": False, "params_source": "prior"},
                {"concept_tag": "anomaly", "p_mastery": 0.34, "p_next_correct": 0.31,
                 "n": 1, "cold_start": True, "params_source": "prior"},
            ],
        )
        assert all(isinstance(o, ConceptMasteryOut) for o in out)
        assert out[0].concept_tag == "typhoon"
        assert out[0].level_label == "mastered"
        assert out[0].num_responses == 7
        assert out[1].level_label == "insufficient"  # n=1 콜드스타트
        assert out[1].cold_start is True

    def test_빈_목록도_200_형식(self, monkeypatch):
        assert self._call(monkeypatch, []) == []

    def test_params_source_기본값은_prior(self, monkeypatch):
        out = self._call(
            monkeypatch,
            [{"concept_tag": "typhoon", "p_mastery": 0.5, "p_next_correct": 0.5,
              "n": 5, "cold_start": False}],
        )
        assert out[0].params_source == "prior"


class TestAlgorithmSingleOwner:
    """알고리즘 사본 금지 — BKT 수학은 ai-worker knowledge_tracing.py 단독 소유."""

    def test_backend에_BKT_구현_사본이_없다(self):
        import inspect

        src = inspect.getsource(wb)
        for token in ("p_learn", "p_slip", "p_guess", "trace_mastery", "forward_backward"):
            assert token not in src, f"backend가 BKT 내부({token})를 복제했다"


@pytest.mark.parametrize("n", [0, 1, 2])
def test_콜드스타트_경계는_ai_worker_소유(n, monkeypatch):
    """backend는 cold_start를 스스로 계산하지 않고 응답을 그대로 신뢰한다.

    (경계 상수를 backend에 복제하면 두 곳이 갈라진다 — LEVEL_GROUP_ITEM_B처럼
    계약 테스트로 감시하는 대신, 여기서는 아예 복제하지 않는 쪽을 골랐다.)
    """
    import inspect

    assert "MASTERY_MIN_RESPONSES" not in inspect.getsource(wb)

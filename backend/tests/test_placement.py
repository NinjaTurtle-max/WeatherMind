"""배치고사(진단 퀴즈) 단위·계약 테스트 — 스프린트 R7-01 §3.1·§3.3·§3.5.

plan_placement_picks·assemble_placement_responses는 DB 의존이 없는 순수 함수라
교차 배치·구멍(개념 결손) 폴백·board/live 제외·결정성·b 폴백 규칙을 DB 없이
검증한다 (test_session_mix 관례). 계약 상수(PLACEMENT_SIZE=6, ai-worker 사전 b
미러값)는 드리프트 감시 (test_r3_r5_contract·test_weatherbrain_contract 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_placement.py -q`.
"""
import asyncio
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import Update

from app.core.config import Settings
from app.models.quiz_log import QuizLog
from app.services import ai_client, answer_service
from app.services import placement_service as ps
from app.services.weatherbrain_service import CONCEPT_TAGS


def make_item(concept: str, group: str, item_id: str, *,
              question_type: str = "multiple_choice", live: bool = False):
    return {
        "id": item_id,
        "concept_tag": concept,
        "level_group": group,
        "question_type": question_type,
        "uses_live_slots": live,
    }


def full_bank(groups=("elementary", "middle_high", "adult"), per_group: int = 2):
    """전 개념 × 전 그룹 × per_group개 후보."""
    return [
        make_item(concept, group, f"{concept}-{group}-{i}")
        for concept in CONCEPT_TAGS
        for group in groups
        for i in range(per_group)
    ]


def groups_of(picks):
    return [p["item"]["level_group"] for p in picks]


def concepts_of(picks):
    return [p["concept_tag"] for p in picks]


class TestTargetGroupSequence:
    def test_middle_high는_3그룹_2_2_2(self):
        seq = ps.target_group_sequence("middle_high", 6)
        assert seq == ["elementary"] * 2 + ["middle_high"] * 2 + ["adult"] * 2

    def test_elementary는_인접_2그룹_3_3(self):
        seq = ps.target_group_sequence("elementary", 6)
        assert seq == ["elementary"] * 3 + ["middle_high"] * 3

    def test_adult는_인접_2그룹_3_3(self):
        seq = ps.target_group_sequence("adult", 6)
        assert seq == ["middle_high"] * 3 + ["adult"] * 3

    def test_나머지는_신고_그룹_우선(self):
        # 7문항이면 균등 2·2·2 + 나머지 1은 신고 그룹(middle_high)에
        seq = ps.target_group_sequence("middle_high", 7)
        assert seq.count("middle_high") == 3
        assert seq.count("elementary") == seq.count("adult") == 2


class TestPlanPlacementPicks:
    def test_6문항_개념당_1_교차_배치(self):
        picks = ps.plan_placement_picks(full_bank(), "middle_high")
        assert len(picks) == 6
        assert sorted(concepts_of(picks)) == sorted(CONCEPT_TAGS)  # 개념당 1
        assert groups_of(picks) == (
            ["elementary"] * 2 + ["middle_high"] * 2 + ["adult"] * 2
        )

    def test_board와_live_슬롯_문항_제외(self):
        bank = [
            make_item(c, g, f"bad-board-{c}-{g}", question_type="board")
            for c in CONCEPT_TAGS
            for g in ps.LEVEL_GROUPS
        ] + [
            make_item(c, g, f"bad-live-{c}-{g}", live=True)
            for c in CONCEPT_TAGS
            for g in ps.LEVEL_GROUPS
        ]
        assert ps.plan_placement_picks(bank, "middle_high") == []
        # 정상 문항이 섞여 있으면 정상 문항만 선발된다
        picks = ps.plan_placement_picks(bank + full_bank(), "middle_high")
        assert len(picks) == 6
        assert all(p["item"]["question_type"] != "board" for p in picks)
        assert all(not p["item"]["uses_live_slots"] for p in picks)

    def test_목표_그룹에_없으면_신고_그룹_폴백(self):
        # adult 문항이 없는 뱅크 — middle_high 신고면 adult 슬롯 2개가 신고 그룹으로
        bank = full_bank(groups=("elementary", "middle_high"))
        picks = ps.plan_placement_picks(bank, "middle_high")
        assert len(picks) == 6
        assert groups_of(picks) == (
            ["elementary"] * 2 + ["middle_high"] * 2 + ["middle_high"] * 2
        )

    def test_개념에_문항이_전혀_없으면_슬롯_생략(self):
        # air_mass 개념 결손 — 나머지 5개념만 선발 (구멍은 생략, 다른 개념 중복 금지)
        bank = [i for i in full_bank() if i["concept_tag"] != "air_mass"]
        picks = ps.plan_placement_picks(bank, "middle_high")
        assert len(picks) == 5
        assert "air_mass" not in concepts_of(picks)
        assert len(set(concepts_of(picks))) == 5

    def test_결정성_입력_순서와_무관(self):
        bank = full_bank(per_group=3)
        picks_a = ps.plan_placement_picks(bank, "middle_high")
        picks_b = ps.plan_placement_picks(list(reversed(bank)), "middle_high")
        ids = lambda picks: [p["item"]["id"] for p in picks]  # noqa: E731
        assert ids(picks_a) == ids(picks_b)
        # 재실행도 동일 (풀 소비의 부수효과 없음)
        assert ids(ps.plan_placement_picks(bank, "middle_high")) == ids(picks_a)

    def test_같은_문항_중복_선발_금지(self):
        picks = ps.plan_placement_picks(full_bank(per_group=1), "elementary")
        ids = [p["item"]["id"] for p in picks]
        assert len(ids) == len(set(ids))


class TestAssemblePlacementResponses:
    def _log(self, concept, item_id, correct):
        return SimpleNamespace(
            concept_tag=concept, content_item_id=item_id, is_correct=correct
        )

    def test_보정값_우선(self):
        logs = [self._log("typhoon", "item-1", True)]
        result = ps.assemble_placement_responses(
            logs, {"item-1": 0.7}, {"item-1": "adult"}, "middle_high"
        )
        assert result == {"typhoon": [{"b": 0.7, "a": 1.0, "correct": True}]}

    def test_보정_없으면_문항_level_group_사전_b(self):
        logs = [self._log("typhoon", "item-1", False)]
        result = ps.assemble_placement_responses(
            logs, {}, {"item-1": "adult"}, "middle_high"
        )
        assert result["typhoon"] == [{"b": 1.0, "a": 1.0, "correct": False}]

    def test_문항_그룹_미상이면_신고_그룹_사전_b(self):
        logs = [self._log("anomaly", None, True)]
        result = ps.assemble_placement_responses(logs, {}, {}, "elementary")
        assert result["anomaly"] == [{"b": -1.0, "a": 1.0, "correct": True}]

    def test_미채점_로그는_제외(self):
        logs = [
            self._log("anomaly", "item-1", None),
            self._log("anomaly", "item-2", True),
        ]
        result = ps.assemble_placement_responses(
            logs, {}, {"item-1": "adult", "item-2": "adult"}, "adult"
        )
        assert len(result["anomaly"]) == 1

    def test_개념별_그룹핑(self):
        logs = [
            self._log("typhoon", "t1", True),
            self._log("air_mass", "a1", False),
            self._log("typhoon", "t2", False),
        ]
        result = ps.assemble_placement_responses(
            logs, {}, {"t1": "adult", "a1": "elementary", "t2": "middle_high"}, "adult"
        )
        assert len(result["typhoon"]) == 2
        assert len(result["air_mass"]) == 1


class TestPlacementContract:
    def test_PLACEMENT_SIZE_기본값은_계약값_6(self):
        """env 미설정 기본값 = 계약 수치 6 (SESSION_RECIPE·CLOUD_* 전례 —
        기본값을 바꾸면 스펙 드리프트이므로 여기서 잡는다)."""
        assert Settings.model_fields["PLACEMENT_SIZE"].default == 6
        assert ps.PLACEMENT_SIZE == 6

    def test_사전_b는_weatherbrain_service_단일_소유(self):
        """R7 통합 DRY: placement_service는 사전 b를 재정의하지 않고
        weatherbrain_service 것을 임포트한다(동일 객체). ai-worker priors와의
        값 드리프트 감시는 test_weatherbrain_contract가 단독 소유."""
        from app.services import weatherbrain_service as wb

        assert ps.LEVEL_GROUP_ITEM_B is wb.LEVEL_GROUP_ITEM_B
        assert ps.prior_item_b("unknown_group") == wb.DEFAULT_ITEM_B

    def test_교차_배치_그룹은_저작_순서와_정합(self):
        assert ps.LEVEL_GROUPS == ("elementary", "middle_high", "adult")
        for group, allowed in ps.ADJACENT_GROUPS.items():
            assert group in allowed

    def test_에러_코드_PLACEMENT_ALREADY_DONE_존재(self):
        """§3.1: 완료자 재응시 409 — 담당 라우터 소스에 실재
        (test_error_code_contract의 소스 텍스트 가드 방식)."""
        source = (
            Path(__file__).resolve().parents[1] / "app" / "routers" / "onboarding.py"
        ).read_text(encoding="utf-8")
        codes = set(re.findall(r'"code":\s*"([A-Z_]+)"', source))
        assert "PLACEMENT_ALREADY_DONE" in codes


class TestToProgressAbilities:
    """§3.1 보강: complete 응답 abilities는 /progress/abilities와 동일 형식."""

    def test_내부_형식을_progress_형식으로_변환(self):
        out = ps.to_progress_abilities(
            [{"concept_tag": "typhoon", "theta": -0.8, "se": 0.9, "n": 3}]
        )
        assert out == [
            {
                "concept_tag": "typhoon",
                "theta": -0.8,
                "theta_se": 0.9,
                "num_responses": 3,
                "level_label": "beginner",
            }
        ]

    def test_level_label은_weatherbrain_경계_재사용(self):
        labels = [
            ab["level_label"]
            for ab in ps.to_progress_abilities(
                [
                    {"concept_tag": "a", "theta": -0.5, "se": 1.0, "n": 0},
                    {"concept_tag": "b", "theta": 0.5, "se": 1.0, "n": 0},
                ]
            )
        ]
        assert labels == ["intermediate", "advanced"]  # 경계는 상위 구간

    def test_스키마_필드와_정합(self):
        """PlacementAbility(응답 스키마)가 변환 결과를 그대로 수용한다."""
        from app.schemas.session import PlacementAbility

        out = ps.to_progress_abilities(
            [{"concept_tag": "typhoon", "theta": 1.2, "se": 0.7, "n": 6}]
        )
        ability = PlacementAbility(**out[0])
        assert ability.num_responses == 6
        assert ability.level_label == "advanced"


class _FakeResult:
    def scalar_one_or_none(self):
        return None


class _FakeDB:
    """실행 statement 수집 대역 (test_answer_service.FakeDB 관례)."""

    def __init__(self):
        self.executed = []
        self.get_calls = []

    async def execute(self, stmt):
        self.executed.append(stmt)
        return _FakeResult()

    async def get(self, model, pk):
        self.get_calls.append((model, pk))
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


class TestAnswerGrantXpSkip:
    """§3.3 보강: 배치고사 answer 경로는 XP 미부여(grant_xp=False) —
    채점·weak_tags·뱅크 통계는 유지(진단 응답도 실제 학습 데이터)."""

    @pytest.fixture(autouse=True)
    def stub_external(self, monkeypatch):
        async def fake_weather(*args, **kwargs):
            return {}

        async def fake_feedback(**kwargs):
            return "피드백"

        monkeypatch.setattr(answer_service, "get_today_weather", fake_weather)
        monkeypatch.setattr(answer_service.ai_client, "rag_feedback", fake_feedback)

    def _log(self, session_id):
        return QuizLog(
            user_id=uuid.uuid4(),
            quiz_id="20260723-001",
            concept_tag="typhoon",
            question_type="multiple_choice",
            question_json={
                "question_type": "multiple_choice",
                "question_text": "태풍의 에너지원은?",
                "correct_answer": "수증기 응결열",
            },
            session_id=session_id,
        )

    def _submit(self, db, log, grant_xp):
        user = SimpleNamespace(id=uuid.uuid4())
        return asyncio.run(
            answer_service.submit_answer_for_log(
                db, user, log, "수증기 응결열", None, grant_xp=grant_xp
            )
        )

    def test_grant_xp_False면_XP_0_세션_xp_미갱신(self):
        db = _FakeDB()
        result = self._submit(db, self._log(uuid.uuid4()), grant_xp=False)
        assert result.is_correct is True
        assert result.xp_earned == 0
        assert db.updates_on("sessions") == []  # xp_total 불변
        assert db.get_calls == []  # add_xp 경로 미진입

    def test_grant_xp_False여도_weak_tags는_갱신(self):
        db = _FakeDB()
        self._submit(db, self._log(uuid.uuid4()), grant_xp=False)
        weak_upserts = [
            stmt
            for stmt in db.executed
            if getattr(getattr(stmt, "table", None), "name", None) == "weak_tags"
        ]
        assert len(weak_upserts) == 1

    def test_기본값_True는_기존_동작(self):
        db = _FakeDB()
        result = self._submit(db, self._log(uuid.uuid4()), grant_xp=True)
        assert result.xp_earned == 15  # 정답 10 + 첫 시도 5 (07번)
        assert len(db.updates_on("sessions")) == 1


class TestAIClientPlacementPayload:
    """ai_client.weatherbrain_placement — placement_responses 전달 계약 (§3.3)."""

    def _capture(self, monkeypatch):
        captured = {}

        async def fake_post(path, payload, timeout=60.0):
            captured["path"] = path
            captured["payload"] = payload
            return {"abilities": []}

        monkeypatch.setattr(ai_client, "_post", fake_post)
        return captured

    def test_None이면_payload_미포함(self, monkeypatch):
        captured = self._capture(monkeypatch)
        asyncio.run(
            ai_client.weatherbrain_placement("adult", list(CONCEPT_TAGS))
        )
        assert "placement_responses" not in captured["payload"]

    def test_응답이_있으면_payload_포함(self, monkeypatch):
        captured = self._capture(monkeypatch)
        responses = {"typhoon": [{"b": 0.5, "a": 1.0, "correct": True}]}
        asyncio.run(
            ai_client.weatherbrain_placement(
                "adult", list(CONCEPT_TAGS), placement_responses=responses
            )
        )
        assert captured["payload"]["placement_responses"] == responses
        assert captured["path"] == "/internal/weatherbrain/placement"

    def test_빈_dict도_포함(self, monkeypatch):
        """응답 0건(전부 미채점 등)도 명시적 전달 — None(사전만)과 구분."""
        captured = self._capture(monkeypatch)
        asyncio.run(
            ai_client.weatherbrain_placement(
                "adult", list(CONCEPT_TAGS), placement_responses={}
            )
        )
        assert captured["payload"]["placement_responses"] == {}

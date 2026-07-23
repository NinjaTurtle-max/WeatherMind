"""배치고사(진단 퀴즈) 단위·계약 테스트 — 스프린트 R7-01 §3.1·§3.3·§3.5.

plan_placement_picks·assemble_placement_responses는 DB 의존이 없는 순수 함수라
교차 배치·구멍(개념 결손) 폴백·board/live 제외·결정성·b 폴백 규칙을 DB 없이
검증한다 (test_session_mix 관례). 계약 상수(PLACEMENT_SIZE=6, ai-worker 사전 b
미러값)는 드리프트 감시 (test_r3_r5_contract·test_weatherbrain_contract 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_placement.py -q`.
"""
import asyncio
from types import SimpleNamespace

from app.core.config import Settings
from app.services import ai_client
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

    def test_사전_b가_ai_worker_priors와_정합(self):
        """LEVEL_GROUP_ITEM_B는 ai-worker priors.LEVEL_GROUP_ITEM_B의 미러값
        (backend는 ai-worker 미임포트 — theta_level_label 경계 계약과 동일 방식)."""
        assert ps.LEVEL_GROUP_ITEM_B == {
            "elementary": -1.0,
            "middle_high": 0.0,
            "adult": 1.0,
        }
        assert ps.prior_item_b("unknown_group") == 0.0

    def test_교차_배치_그룹은_저작_순서와_정합(self):
        assert ps.LEVEL_GROUPS == ("elementary", "middle_high", "adult")
        for group, allowed in ps.ADJACENT_GROUPS.items():
            assert group in allowed


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

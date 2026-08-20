"""배치고사(진단 퀴즈) 단위·계약 테스트 — 스프린트 R7-01 §3.1·§3.3·§3.5 + R7-02 §3.2.

plan_placement_picks·assemble_placement_responses는 DB 의존이 없는 순수 함수라
목표 단계 배분·근접 폴백·구멍(개념 결손) 생략·board/live 제외·결정성·b 폴백 규칙을
DB 없이 검증한다 (test_session_mix 관례). 계약 상수(PLACEMENT_SIZE=10, ai-worker
사전 b 미러값)는 드리프트 감시 (test_r3_r5_contract·test_weatherbrain_contract 관례).

⚠️ **2026-08-12 축 전환.** 선발 축이 신고 밴드에서 **지식 단계(kl)**로 바뀌었다
(`placement_service.target_level_sequence`). 그 결과 이 파일이 지키던 계약 둘이
폐기됐다 — ⑴ **서로소 배치**(R7-02 §3.2: 신고 그룹마다 다른 문항)와
⑵ **밴드 배합비**(2·2·2 등). 배치고사는 위치를 재는 자이므로 눈금이 신고값에 따라
달라지면 안 되고, 밴드는 이제 선발의 입력이 아니라 결과다. 두 자리는 삭제하지 않고
**반전한 계약**으로 남겨 두었다(`test_신고_그룹이_달라도_같은_문항을_집는다`,
`TestIdenticalPicksRealSeed`) — 회전이 되살아나면 즉시 잡기 위해서다.
실 시드 AC는 database/seed/content_items.json을 직접 로드한다 (test_seed_contract 관례).

실행: backend 디렉토리에서 `python -m pytest tests/test_placement.py -q`.
"""
import asyncio
import json
import re
import uuid
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import Update

from app.core.config import Settings
from app.models.quiz_log import QuizLog
from app.services import ai_client, answer_service
from app.services import placement_service as ps
from app.services import weatherbrain_service as wb
from app.services.weatherbrain_service import PLACEMENT_QUIZ_TAGS as CONCEPT_TAGS  # 진단 도메인(기상 6종) — 12종 전체와 분리(R12 §9)


def make_item(concept: str, group: str, item_id: str, *,
              question_type: str = "multiple_choice", live: bool = False,
              knowledge_level: int | None = None):
    """후보 문항 1건. `knowledge_level`을 안 주면 **밴드에서 파생**된다.

    (파생값은 밴드당 하나뿐이라 elementary/middle_high/adult/expert → kl 1/3/5/7.
     그래서 밴드만 있는 뱅크는 kl 4종만 가지며, 목표 단계 10종을 정확히 맞출 수
     없다 — 근접 폴백이 돈다. 전 단계를 맞추는 계약은 `full_bank_all_levels`를 쓴다.)
    """
    item = {
        "id": item_id,
        "concept_tag": concept,
        "level_group": group,
        "question_type": question_type,
        "uses_live_slots": live,
    }
    if knowledge_level is not None:
        item["knowledge_level"] = knowledge_level
    return item


def full_bank(groups=("elementary", "middle_high", "adult"), per_group: int = 2):
    """전 개념 × 전 그룹 × per_group개 후보 (kl은 밴드 파생 — 4종뿐)."""
    return [
        make_item(concept, group, f"{concept}-{group}-{i}")
        for concept in CONCEPT_TAGS
        for group in groups
        for i in range(per_group)
    ]


#: 전 개념 × **전 지식 단계** 후보. 목표 시퀀스를 정확히 맞출 수 있는 유일한 뱅크다 —
#: `full_bank`는 밴드 파생 kl이 4종뿐이라 근접 폴백이 섞인다.
def full_bank_all_levels(per_level: int = 1):
    # 밴드는 아무 값이나 좋다 — **선발에 쓰이지 않는다**(신고 축과 분리된 뒤로
    # level_group은 선택된 문항의 사전 b 산출에만 쓰인다). kl이 축이다.
    levels = range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1)
    return [
        make_item(concept, "adult", f"{concept}-kl{level}-{i}", knowledge_level=level)
        for concept in CONCEPT_TAGS
        for level in levels
        for i in range(per_level)
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

    def test_adult는_인접_3그룹_2_2_2(self):
        """⚠️ 2026-08-12: adult의 인접에 **expert가 들어왔다**(2그룹 → 3그룹).

        배치고사가 kl 7~10을 재려면 expert 문항에 닿아야 하는데, 종전 인접 목록이
        adult에서 끊겨 상위 4단계가 구조적으로 도달 불가였다(`test_expert_band`의
        반전과 같은 사유). 이 함수 자체는 이제 선발에 쓰이지 않고
        **밴드 인접 배분 규칙의 기술**로만 남는다 — 선발 축은 target_level_sequence다.
        """
        seq = ps.target_group_sequence("adult", 6)
        assert seq == ["middle_high"] * 2 + ["adult"] * 2 + ["expert"] * 2

    def test_나머지는_신고_그룹_우선(self):
        # 7문항이면 균등 2·2·2 + 나머지 1은 신고 그룹(middle_high)에
        seq = ps.target_group_sequence("middle_high", 7)
        assert seq.count("middle_high") == 3
        assert seq.count("elementary") == seq.count("adult") == 2


class TestPlanPlacementPicks:
    def test_슬롯은_목표_단계를_따르고_개념을_순환한다(self):
        """⚠️ **2026-08-12 축 전환** — 종전 이름은 `test_6문항_개념당_1_교차_배치`,
        단정은 «개념당 1 + 밴드 배합비 2·2·2»였다.

        둘 다 폐기됐다. ⑴ 선발 축이 밴드에서 **지식 단계**로 바뀌어 밴드 배합비는
        더 이상 계약이 아니다(선택된 문항의 밴드는 kl의 결과일 뿐이다).
        ⑵ `PLACEMENT_SIZE`가 개념 수(6)보다 커져(10) «개념당 1»이 성립할 수 없다 —
        슬롯이 개념을 **순환 배정**하므로 앞 4개념이 2번, 뒤 2개념이 1번 나온다.
        살아 있는 계약은 «전 개념이 최소 1번은 나온다»(변별이 한 개념에 쏠리지 않음)다.
        """
        picks = ps.plan_placement_picks(full_bank_all_levels(2), "middle_high")
        assert len(picks) == ps.PLACEMENT_SIZE
        # 목표 단계를 정확히 맞춘다 (전 단계를 갖춘 뱅크이므로 폴백이 돌지 않는다)
        assert [p["knowledge_level"] for p in picks] == ps.target_level_sequence(
            ps.PLACEMENT_SIZE
        )
        # 개념 커버리지 — 전 개념이 최소 1회
        assert set(concepts_of(picks)) == set(CONCEPT_TAGS)
        # 순환 배정: 개념별 등장 횟수 차이는 1 이하(쏠림 없음)
        counts = Counter(concepts_of(picks))
        assert max(counts.values()) - min(counts.values()) <= 1

    def test_신고_그룹이_달라도_같은_문항을_집는다(self):
        """⚠️ **R7-02 §3.2 「서로소 배치」 폐기의 자리** (2026-08-12).

        여기 있던 두 테스트(`test_신고_그룹별_회전_시퀀스`,
        `test_같은_셀을_겨냥해도_그룹마다_다른_문항`)는 **신고 그룹마다 다른 문항을
        집는 것**을 계약으로 지켰다. 그 계약이 뒤집혔다: 배치고사는 위치를 **재는
        자**이므로 눈금이 신고값에 따라 달라지면 안 된다. 그래서 회전(k = 그룹
        순위×2 % size)과 셀 내 오프셋이 통째로 사라졌고, 세 신고 그룹은 이제
        **완전히 같은 문항**을 받는다.

        같은 성질을 실 시드로 넓게 보는 것은
        `test_selection_by_knowledge_level::test_신고_학령이_배치고사를_바꾸지_않는다`가
        소유한다. 여기서는 폐기 지점에 표식을 남겨, 회전이 되살아나면 즉시 잡는다.
        """
        bank = full_bank(per_group=3)
        ids = {
            g: [p["item"]["id"] for p in ps.plan_placement_picks(bank, g)]
            for g in ps.LEVEL_GROUPS
        }
        first = ids[ps.LEVEL_GROUPS[0]]
        for group, got in ids.items():
            assert got == first, f"{group}이 다른 문항을 집었다 — 회전이 되살아났다"

    def test_셀_정렬은_question_type_우선_콘텐츠_기반(self):
        """셀 내 순서 1차 키는 question_type — id(UUID)가 재적재로 바뀌어도
        선발이 유지되는 콘텐츠 기반 키 (§3.2)."""
        bank = [
            make_item("air_mass", "elementary", "z-먼저", question_type="cloze"),
            make_item("air_mass", "elementary", "a-나중", question_type="slider"),
        ]
        picks = ps.plan_placement_picks(
            bank, "elementary", size=1, concept_tags=["air_mass"]
        )
        assert picks[0]["item"]["id"] == "z-먼저"  # cloze < slider (id 역순이어도)

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
        assert len(picks) == ps.PLACEMENT_SIZE
        assert all(p["item"]["question_type"] != "board" for p in picks)
        assert all(not p["item"]["uses_live_slots"] for p in picks)

    def test_목표_단계에_없으면_가장_가까운_단계로_내려앉는다(self):
        """⚠️ 폴백의 축도 밴드 → **지식 단계**로 바뀌었다 (2026-08-12).

        종전 이름은 `test_목표_그룹에_없으면_신고_그룹_폴백`이었고 «없으면 **신고
        그룹**으로» 떨어졌다. 지금은 신고값을 아예 안 보고 **|kl − 목표| 오름차순,
        동률이면 쉬운 쪽**으로 내려앉는다(`rank_by_knowledge_level`과 같은 키).
        규칙 자체의 단위 검증은 `TestPlacementLevelFallback`이 소유하므로, 여기서는
        «상위 단계가 통째로 빈 뱅크에서도 슬롯이 죽지 않는다»만 본다.
        """
        # kl 1~3만 있는 뱅크(깊이 2 — 한 개념이 최대 2슬롯을 받으므로 소진 방지)
        bank = [
            make_item(c, "elementary", f"{c}-kl{lv}-{i}", knowledge_level=lv)
            for c in CONCEPT_TAGS
            for lv in (1, 2, 3)
            for i in range(2)
        ]
        picks = ps.plan_placement_picks(bank, "middle_high")
        assert len(picks) == ps.PLACEMENT_SIZE, "상위 단계가 없다고 슬롯이 죽으면 안 된다"
        got = [p["knowledge_level"] for p in picks]
        assert set(got) <= {1, 2, 3}, "없는 단계를 지어내면 안 된다"
        # 목표 4 이상은 전부 상한 3으로 내려앉는다 — 근접 폴백의 정의
        targets = ps.target_level_sequence(ps.PLACEMENT_SIZE)
        for target, level in zip(targets, got):
            assert level == min(target, 3), f"목표 {target} → {level}"

    def test_개념에_문항이_전혀_없으면_슬롯_생략(self):
        """구멍은 **생략**한다 — 다른 개념으로 메우지 않는다(변별 쏠림 방지).

        생략 건수는 그 개념에 배정된 **슬롯 수**만큼이라 `PLACEMENT_SIZE`에서
        파생한다(개념 수 6, size 10이면 air_mass는 2슬롯 → 8건 남는다).
        """
        bank = [i for i in full_bank() if i["concept_tag"] != "air_mass"]
        picks = ps.plan_placement_picks(bank, "middle_high")
        slots = [
            CONCEPT_TAGS[i % len(CONCEPT_TAGS)] for i in range(ps.PLACEMENT_SIZE)
        ]
        expected = ps.PLACEMENT_SIZE - slots.count("air_mass")
        assert len(picks) == expected
        assert "air_mass" not in concepts_of(picks)
        assert set(concepts_of(picks)) == set(CONCEPT_TAGS) - {"air_mass"}

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


SEED_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
)


def load_seed_candidates() -> list[dict]:
    """실 시드를 plan_placement_picks 후보 형식으로 로드 (id는 시드 순번 —
    셀 정렬 1차 키가 question_type(콘텐츠 기반)이라 실 UUID와 무관하게 대표적)."""
    entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return [
        make_item(
            e["concept_tag"],
            e["level_group"],
            f"seed-{i:02d}",
            question_type=e["question_type"],
            live=bool(e.get("uses_live_slots")),
        )
        for i, e in enumerate(entries)
    ]


class TestIdenticalPicksRealSeed:
    """실 시드 기준 — 세 신고 그룹이 **같은** 문항을 받는다 (2026-08-12 반전).

    ⚠️ 이 클래스의 종전 이름은 `TestDisjointPicksRealSeed`였고, AC(R7-02 §3.2)는
    «세 신고 그룹의 픽이 쌍별 교집합 **0**»이었다. 그 계약이 폐기됐다 — 배치고사는
    위치를 재는 자이므로 신고값에 따라 눈금이 달라지면 안 된다(모듈 독스트링).
    서로소를 만들던 회전·오프셋이 사라졌으므로 이제 **정반대**를 고정한다.

    database/seed/content_items.json을 직접 로드해 검증한다(test_seed_contract의
    실 시드 로드 관례). 시드 증보로 선발이 신고값에 반응하기 시작하면 여기서 잡힌다.
    """

    @pytest.fixture
    def picks_by_group(self):
        candidates = load_seed_candidates()
        return {g: ps.plan_placement_picks(candidates, g) for g in ps.LEVEL_GROUPS}

    def test_세_그룹이_같은_문항을_받는다(self, picks_by_group):
        ids = {
            g: [p["item"]["id"] for p in picks]
            for g, picks in picks_by_group.items()
        }
        first = ids[ps.LEVEL_GROUPS[0]]
        assert first, "픽이 비면 이 테스트가 무의미하다"
        for group, got in ids.items():
            assert got == first, (
                f"{group}이 다른 문항을 받았다 — 신고 학령이 배치 눈금을 바꾸고 있다"
            )

    def test_그룹별_개념_커버리지(self, picks_by_group):
        """size가 개념 수보다 크므로 «개념당 1»이 아니라 «전 개념 최소 1»이다."""
        for group, picks in picks_by_group.items():
            assert len(picks) == ps.PLACEMENT_SIZE, group
            assert set(concepts_of(picks)) == set(CONCEPT_TAGS), group

    def test_선발은_목표_단계를_따른다(self, picks_by_group):
        """종전 `test_그룹별_난이도_배합비_불변`(밴드 3E/3M 등)의 후신.

        밴드 배합비는 계약이 아니게 됐다 — 선발 축이 kl이므로 밴드는 결과일 뿐이다.
        대신 각 슬롯이 목표 단계에 **가장 가깝게** 앉았는지를 본다(실 시드는 개념별
        단계 분포가 고르지 않아 정확히 일치하지는 않는다).
        """
        targets = ps.target_level_sequence(ps.PLACEMENT_SIZE)
        for group, picks in picks_by_group.items():
            got = [p["knowledge_level"] for p in picks]
            assert [p["target_level"] for p in picks] == targets, group
            # 목표와의 거리가 단계 폭의 절반을 넘지 않는다(눈금이 무너지지 않음)
            span = wb.KNOWLEDGE_LEVEL_MAX - wb.KNOWLEDGE_LEVEL_MIN
            for target, level in zip(targets, got):
                assert abs(level - target) <= span // 2, f"{group}: {target}→{level}"

    def test_board_live_미선발(self, picks_by_group):
        for picks in picks_by_group.values():
            assert all(p["item"]["question_type"] != "board" for p in picks)
            assert all(not p["item"]["uses_live_slots"] for p in picks)

    def test_결정성_입력_순서와_무관(self, picks_by_group):
        candidates = load_seed_candidates()
        for group in ps.LEVEL_GROUPS:
            rerun = ps.plan_placement_picks(list(reversed(candidates)), group)
            assert [p["item"]["id"] for p in rerun] == [
                p["item"]["id"] for p in picks_by_group[group]
            ], group


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
    def test_PLACEMENT_SIZE_기본값은_계약값_10(self):
        """env 미설정 기본값 = 계약 수치 **10** (SESSION_RECIPE·CLOUD_* 전례).

        ⚠️ 2026-08-12: 6 → 10. 종전 6의 근거는 「CONCEPT_TAGS 6개념당 1문항」이라
        **개념 축**에서 나온 값이었는데, 배치고사의 축이 지식 단계로 바뀌면서
        재는 대상과 어긋났다. 10이어야 `target_level_sequence`가 kl 1~10을 정확히
        한 번씩 낸다 — 그 성질은 아래 줄이 리터럴 없이 못 박는다.
        """
        assert Settings.model_fields["PLACEMENT_SIZE"].default == 10
        assert ps.PLACEMENT_SIZE == 10
        # 값의 **근거**를 함께 고정한다: size = 단계 수 → 전 단계 1회씩
        levels = list(range(wb.KNOWLEDGE_LEVEL_MIN, wb.KNOWLEDGE_LEVEL_MAX + 1))
        assert ps.PLACEMENT_SIZE == len(levels)
        assert ps.target_level_sequence(ps.PLACEMENT_SIZE) == levels

    def test_사전_b는_weatherbrain_service_단일_소유(self):
        """R7 통합 DRY: placement_service는 사전 b를 재정의하지 않는다 —
        weatherbrain_service를 직접 참조(소스 텍스트 가드). ai-worker priors와의
        값 드리프트 감시는 test_weatherbrain_contract가 단독 소유."""
        import inspect

        src = inspect.getsource(ps.assemble_placement_responses)
        assert "weatherbrain_service.LEVEL_GROUP_ITEM_B" in src

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
                # 🔴 2026-08-20: `knowledge_level`·`_max`가 늘었다. 배치고사 결과
                # 화면이 **교과 단계로 말하려면** 이 두 필드가 응답에 있어야 한다
                # (클라이언트 판정 「10단계 교과 표기 유지」). 종전에는 스키마에
                # 아예 없어서 화면이 4밴드(「초급」)로 내려앉았다 — 그 자리가
                # `to_progress_abilities`이고, 이 단정이 **필드 집합 전체를**
                # 문고 있었으므로 함께 갱신한다.
                # ⚠️ 값의 소유자는 `weatherbrain_service.theta_to_knowledge_level`
                # 이다. 여기 숫자를 손으로 고치지 말고 그 함수를 볼 것.
                "knowledge_level": 2,
                "knowledge_level_max": 10,
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

    def all(self):
        return []  # load_abilities(θ 조회, R8-01 §3.5) — 능력 행 없음(약점 아님)


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
        user = SimpleNamespace(id=uuid.uuid4(), level_group="middle_high")
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

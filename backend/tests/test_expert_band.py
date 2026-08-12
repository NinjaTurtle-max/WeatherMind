"""전문가 밴드(expert) 계약 테스트 — 스프린트 R13-01 §2.2 (BE-2).

expert를 4번째 학령 밴드로 추가하면서 확정한 것:
  - 사전평균·사전 b = 2.0 (adult 1.0에서 밴드 간격 1.0 유지 — 로짓 정합)
  - 경계 1.5 = 인접 밴드 사전평균의 중점 (기존 −0.5·0.5와 같은 규칙)
  - 기존 3밴드 판정은 한 건도 바뀌지 않는다(순수 확장)

backend↔ai-worker 동일성 자체는 test_weatherbrain_contract가 감시한다. 여기서는
"밴드가 4종이고 경계가 중점 규칙을 따른다"는 backend 측 계약만 못 박는다.

실행: backend 디렉토리에서 `python -m pytest tests/test_expert_band.py -q`.
"""

from __future__ import annotations

import math

import pytest

from app.scripts.seed_content import ALLOWED_CONCEPT_TAGS, ALLOWED_LEVEL_GROUPS
from app.services import placement_service as ps
from app.services import weatherbrain_service as wb


class TestExpertBandConstants:
    def test_밴드는_난이도_오름차순_4종(self):
        assert wb.LEVEL_GROUP_BANDS == (
            "elementary",
            "middle_high",
            "adult",
            "expert",
        )

    def test_경계는_인접_밴드_사전평균의_중점(self):
        """경계 규칙을 값이 아니라 **파생식**으로 고정한다 — 사전 b를 바꾸면
        경계도 따라 움직여야 한다(단일 공급원 검증, weak_theta_threshold 전례)."""
        means = [wb.LEVEL_GROUP_ITEM_B[band] for band in wb.LEVEL_GROUP_BANDS]
        expected = tuple(
            (low + high) / 2 for low, high in zip(means, means[1:])
        )
        assert wb.THETA_BAND_BOUNDS == expected == (-0.5, 0.5, 1.5)

    def test_밴드_수는_경계_수_플러스_1(self):
        assert len(wb.LEVEL_GROUP_BANDS) == len(wb.THETA_BAND_BOUNDS) + 1
        assert len(wb.THETA_BAND_LABELS) == len(wb.LEVEL_GROUP_BANDS)

    def test_expert_사전_b는_2점0(self):
        assert wb.LEVEL_GROUP_ITEM_B["expert"] == 2.0

    def test_expert_약점_임계도_사전_b에서_파생(self):
        assert wb.weak_theta_threshold("expert") == pytest.approx(
            2.0 + math.log(1.5)
        )


class TestExpertThetaMapping:
    @pytest.mark.parametrize(
        ("theta", "band"),
        [
            (-3.0, "elementary"),
            (-0.51, "elementary"),
            (-0.5, "middle_high"),   # 경계는 상위 밴드 포함
            (0.49, "middle_high"),
            (0.5, "adult"),
            (1.49, "adult"),
            (1.5, "expert"),         # expert 진입 경계
            (3.0, "expert"),
        ],
    )
    def test_theta_to_level_group(self, theta, band):
        assert wb.theta_to_level_group(theta) == band

    @pytest.mark.parametrize(
        ("theta", "label"),
        [
            (-3.0, "beginner"),
            (-0.5, "intermediate"),
            (0.5, "advanced"),
            (1.49, "advanced"),
            (1.5, "expert"),
            (3.0, "expert"),
        ],
    )
    def test_theta_level_label(self, theta, label):
        assert wb.theta_level_label(theta) == label

    @pytest.mark.parametrize("theta", [-3.0, -0.5, 0.0, 0.5, 1.0, 1.49])
    def test_기존_3밴드_판정_불변(self, theta):
        """expert 추가 전 계약(θ<1.5는 elementary/middle_high/adult)을 못 박는다."""
        assert wb.theta_to_level_group(theta) in (
            "elementary",
            "middle_high",
            "adult",
        )


class TestExpertSeedAllowlist:
    def test_시드_로더가_expert를_허용(self):
        assert "expert" in ALLOWED_LEVEL_GROUPS
        assert ALLOWED_LEVEL_GROUPS == set(wb.LEVEL_GROUP_BANDS)

    def test_expert_문항이_스키마_검증을_통과(self):
        from app.scripts.seed_content import validate_entry

        entry = {
            "concept_tag": "typhoon",
            "level_group": "expert",
            "question_type": "short_answer",
            "template_json": {
                "question_text": "태풍의 최대풍속 반경이 커질 때 축대칭화가 진행되는 이유는?",
                "correct_answer": "각운동량 재분배",
            },
        }
        assert validate_entry(entry, 0) == []


class TestPlacementDomainUnchanged:
    """배치고사와 expert 밴드의 관계 — **2026-08-12 반전**.

    ⚠️ 종전 독스트링은 「배치 도메인은 3밴드 고정」이었고, 근거는 *"6문항 서로소
    배치 계약이 밴드 수에 묶여 있어 4밴드로 넓히면 깨진다"*였다. **그 계약이
    폐기됐다** — 배치고사의 선발 축이 밴드에서 **지식 단계(kl)**로 바뀌면서
    (`placement_service.target_level_sequence`) 서로소 배치 자체가 사라졌다.

    그래서 판정이 뒤집힌다: kl 7~10을 표적으로 삼는 슬롯은 **expert 문항을
    선발해야 한다**. 밴드×kl가 1:1(expert=kl 7~10)이라, expert를 계속 막으면
    배치고사가 상위 4단계를 영영 못 재고 「10단계를 변별한다」가 성립하지 않는다.

    `LEVEL_GROUPS` 3종 유지는 **별개 계약**이라 그대로 남는다 — 그것은 가입
    **신고** 축의 값 목록이고(사용자가 고를 수 있는 것), 선발 축이 아니다.
    """

    def test_placement_LEVEL_GROUPS는_3종_유지(self):
        """신고 축은 여전히 3종 — 선발 축이 넓어진 것과 무관하다."""
        assert ps.LEVEL_GROUPS == ("elementary", "middle_high", "adult")

    def test_상위_단계_슬롯은_expert_문항을_선발한다(self):
        """kl 7~10 표적 슬롯이 expert를 뽑아야 상위 구간이 측정된다."""
        candidates = [
            {
                "id": f"item-{tag}-{group}",
                "concept_tag": tag,
                "level_group": group,
                "question_type": "multiple_choice",
                "uses_live_slots": False,
            }
            for tag in wb.PLACEMENT_QUIZ_TAGS
            for group in ("elementary", "middle_high", "adult", "expert")
        ]
        for reported in ps.LEVEL_GROUPS:
            picks = ps.plan_placement_picks(candidates, reported)
            assert picks, "배치 픽이 비면 이 테스트가 무의미하다"
            assert any(p["level_group"] == "expert" for p in picks), (
                f"신고 {reported}: expert 문항이 한 건도 안 뽑혔다 — 배치고사가 "
                "kl 7~10을 못 재면 10단계 변별이 반쪽이 된다"
            )


class TestBoardDifficultyBand:
    """보드 난이도 라벨의 '어려운 밴드' 판정 — R13 §2.2 파급 지점.

    'adult' 문자열 동등비교였다면 expert 퍼즐이 elementary와 같은 취급을 받는다.
    """

    def test_expert_퍼즐은_adult와_같은_가산(self):
        from app.routers.board import board_difficulty

        template = {"mode": "goal_only"}
        assert board_difficulty(template, "expert") == board_difficulty(
            template, "adult"
        ) == 3

    def test_하위_밴드는_가산_없음(self):
        from app.routers.board import board_difficulty

        template = {"mode": "goal_only"}
        assert board_difficulty(template, "elementary") == 2
        assert board_difficulty(template, "middle_high") == 2

    def test_미지_밴드는_중립(self):
        from app.routers.board import board_difficulty

        assert board_difficulty({"mode": "goal_only"}, "ghost") == 2


class TestDisasterConceptTags:
    """재난 축 1차 개통 — R13-01 §2.4."""

    DISASTER_TAGS = ("wildfire_weather", "flood_response")

    @pytest.mark.parametrize("tag", DISASTER_TAGS)
    def test_시드_로더가_재난_태그를_허용(self, tag):
        assert tag in ALLOWED_CONCEPT_TAGS

    @pytest.mark.parametrize("tag", DISASTER_TAGS)
    def test_θ_초기화_대상에_포함(self, tag):
        """CONCEPT_TAGS = 가입 시 θ 행을 만드는 전체 개념 — 빠지면 그 축은
        약점 태그·복습 큐에서 영원히 비어 있다."""
        assert tag in wb.CONCEPT_TAGS

    @pytest.mark.parametrize("tag", DISASTER_TAGS)
    def test_배치고사_도메인에는_넣지_않는다(self, tag):
        """PLACEMENT_SIZE=6이 '개념당 1'을 만족해야 하므로 진단 도메인은 기상 6종
        고정(R12 §9). 여기 들어가면 개념당 1이 깨진다."""
        assert tag not in wb.PLACEMENT_QUIZ_TAGS

    def test_배치_도메인은_기상_6종_그대로(self):
        assert len(wb.PLACEMENT_QUIZ_TAGS) == 6
        assert set(wb.PLACEMENT_QUIZ_TAGS) <= set(wb.CONCEPT_TAGS)

    def test_지진_계열은_열지_않는다(self):
        """§2.4: 지진은 범위 밖 확정(지질학). 무심코 추가되면 여기서 잡는다."""
        seismic = {"earthquake", "seismic", "tsunami", "quake_response"}
        assert seismic & set(ALLOWED_CONCEPT_TAGS) == set()
        assert seismic & set(wb.CONCEPT_TAGS) == set()

    def test_재난_태그_시드_로더_통과(self):
        from app.scripts.seed_content import validate_entry

        entry = {
            "concept_tag": "wildfire_weather",
            "level_group": "middle_high",
            "question_type": "short_answer",
            "template_json": {
                "question_text": "산불 확산 위험이 커지는 습도 조건을 무엇이라 하나요?",
                "correct_answer": "실효습도",
            },
        }
        assert validate_entry(entry, 0) == []

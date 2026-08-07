"""WeatherBrain 백엔드 계약 테스트 — R6 §5.

교차 서비스·시드 드리프트 감시(board_engine·리그 티어의 이원화 관례와 동일 취지).
DB·네트워크 불필요(순수 상수/함수 검사).

실행: backend 디렉토리에서 `python -m pytest tests/test_weatherbrain_contract.py -q`.
"""

from __future__ import annotations

import importlib
import json
import math
import sys
from pathlib import Path

import pytest

from app.services import weatherbrain_service as wb

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED = REPO_ROOT / "database" / "seed" / "content_items.json"
AI_WORKER_DIR = REPO_ROOT / "ai-worker"


def _import_ai_worker_priors():
    """ai-worker priors를 backend `app` 패키지와 충돌 없이 임포트
    (test_seed_contract._import_ai_worker_validate_chain 관례 답습)."""
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module("app.weatherbrain.priors")
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


priors = _import_ai_worker_priors()


class TestConceptTagContract:
    def test_CONCEPT_TAGS가_시드와_일치(self):
        """weatherbrain_service.CONCEPT_TAGS ⊇ 시드 문항의 개념 집합.

        placement가 시드에 실재하는 개념을 빠짐없이 초기화해야 한다(누락 시 그 개념은
        가입 시 θ 배정이 안 됨). 시드가 상수의 부분집합이면 통과.
        """
        with SEED.open(encoding="utf-8") as f:
            items = json.load(f)
        seed_concepts = {i["concept_tag"] for i in items}
        assert seed_concepts <= set(wb.CONCEPT_TAGS), (
            f"시드에 상수 밖 개념 존재: {seed_concepts - set(wb.CONCEPT_TAGS)}"
        )


class TestThetaLabelContract:
    def test_라벨_경계가_ai_worker_역매핑과_정합(self):
        """theta_level_label 경계(-0.5, 0.5)는 ai-worker theta_to_target_level_group·
        router_chain.THETA_FOCUS_THRESHOLD와 같은 값이어야 한다(교차 서비스 의미론).

        backend는 ai-worker를 임포트하지 않으므로 값 자체를 여기 고정한다 — 한쪽을
        바꾸면 이 테스트(또는 ai-worker 측 테스트)가 깨져 드리프트를 잡는다.
        """
        assert wb._THETA_BEGINNER_MAX == -0.5
        assert wb._THETA_INTERMEDIATE_MAX == 0.5
        # R13 §2.2 expert 밴드 경계 — 두 서비스가 같은 값이어야 한다.
        assert wb._THETA_ADVANCED_MAX == 1.5
        assert wb.THETA_BAND_BOUNDS == priors.THETA_BAND_BOUNDS

    def test_라벨_구간(self):
        assert wb.theta_level_label(-2.0) == "beginner"
        assert wb.theta_level_label(-0.5) == "intermediate"  # 경계는 상위 구간
        assert wb.theta_level_label(0.0) == "intermediate"
        assert wb.theta_level_label(0.5) == "advanced"
        assert wb.theta_level_label(1.49) == "advanced"
        assert wb.theta_level_label(1.5) == "expert"  # R13 §2.2 — 경계는 상위 구간
        assert wb.theta_level_label(3.0) == "expert"


class TestThetaToLevelGroupContract:
    """R7 §3.2: backend theta_to_level_group ↔ ai-worker
    priors.theta_to_target_level_group — 같은 θ에 같은 그룹(경계 포함/제외까지).

    R13 §2.2에서 밴드가 4종(expert 추가)이 되면서 경계 1.5 전후를 표본에 넣었다.
    한쪽 서비스만 밴드를 바꾸면 여기서 깨진다(변이 검증으로 확인).
    """

    @pytest.mark.parametrize(
        "theta",
        [
            -3.0, -1.0, -0.51, -0.5, -0.49, 0.0, 0.49, 0.5, 0.51, 1.0,
            1.49, 1.5, 1.51, 2.0, 3.0,
        ],
    )
    def test_대표값_경계값에서_ai_worker와_동일(self, theta):
        assert wb.theta_to_level_group(theta) == (
            priors.theta_to_target_level_group(theta)
        ), f"θ={theta}에서 backend↔ai-worker 매핑 드리프트"

    def test_밴드_목록_자체가_동일(self):
        """값 매핑뿐 아니라 밴드 목록·순서도 이원 유지 대상이다."""
        assert wb.LEVEL_GROUP_BANDS == priors.LEVEL_GROUP_BANDS

    def test_사전분포_평균이_사전_b와_같다(self):
        """로짓 정합(priors 모듈 docstring): 밴드의 θ 사전평균 = 그 밴드 문항의
        사전 b. expert(2.0)도 이 규칙을 따라야 밴드 내 기대 정답확률이 0.5다."""
        for band in priors.LEVEL_GROUP_BANDS:
            assert priors.LEVEL_GROUP_PRIORS[band][0] == (
                priors.LEVEL_GROUP_ITEM_B[band]
            ), f"{band}: 사전평균≠사전 b"


class TestPriorItemBContract:
    """R7 §3.2: 뱅크 풀 정렬의 사전 b CASE 값은 ai-worker LEVEL_GROUP_ITEM_B와
    동일해야 한다 (backend는 ai-worker를 임포트하지 않으므로 상수를 이원 유지)."""

    def test_사전_b_상수_동일(self):
        assert wb.LEVEL_GROUP_ITEM_B == priors.LEVEL_GROUP_ITEM_B

    def test_방어_기본값_동일(self):
        assert wb.DEFAULT_ITEM_B == priors._DEFAULT_ITEM_B


class TestWeakThetaContract:
    """R8-01 §3.5: weak 판정 θ 파생 단일 공급원 — 계약 수치 고정.

    WEAK_EXPECTED_P와 학령별 임계 3종을 수치로 못 박는다(드리프트 감시).
    ai-worker와 무관한 백엔드 전용 계약이다.
    """

    def test_WEAK_EXPECTED_P_계약값(self):
        assert wb.WEAK_EXPECTED_P == 0.6

    def test_학령별_임계_3종_수치_고정(self):
        """임계 = 사전 b + ln(0.6/0.4) ≈ b + 0.4054651081081644."""
        assert wb.weak_theta_threshold("elementary") == pytest.approx(
            -0.5945348918918356
        )
        assert wb.weak_theta_threshold("middle_high") == pytest.approx(
            0.4054651081081644
        )
        assert wb.weak_theta_threshold("adult") == pytest.approx(
            1.4054651081081644
        )

    def test_임계는_사전_b에서_파생(self):
        """단일 공급원 검증 — LEVEL_GROUP_ITEM_B를 바꾸면 임계도 따라 움직인다."""
        logit = math.log(wb.WEAK_EXPECTED_P / (1 - wb.WEAK_EXPECTED_P))
        for lg, b in wb.LEVEL_GROUP_ITEM_B.items():
            assert wb.weak_theta_threshold(lg) == pytest.approx(b + logit)

    def test_미지_학령은_DEFAULT_ITEM_B_기준(self):
        assert wb.weak_theta_threshold("ghost") == pytest.approx(
            wb.DEFAULT_ITEM_B + math.log(1.5)
        )

    def test_weak_concepts_판정_규칙(self):
        """num_responses>0 AND θ<임계 — n=0(사전값뿐)은 약점 아님."""
        abilities = [
            {"concept_tag": "typhoon", "theta": -1.0, "se": 0.3, "n": 4},   # 약점
            {"concept_tag": "air_mass", "theta": -1.0, "se": 0.3, "n": 0},  # n=0 제외
            {"concept_tag": "anomaly", "theta": 1.0, "se": 0.3, "n": 4},    # θ 충분
        ]
        assert wb.weak_concepts(abilities, "middle_high") == ["typhoon"]

    def test_weak_concepts_임계_경계는_약점_아님(self):
        theta = wb.weak_theta_threshold("middle_high")
        abilities = [{"concept_tag": "typhoon", "theta": theta, "se": 0.3, "n": 4}]
        assert wb.weak_concepts(abilities, "middle_high") == []

    def test_weak_concepts_학령_상대적(self):
        """같은 θ=0.0·n>0 — 초등(임계 −0.594)에선 정상, 성인(임계 1.405)에선 약점."""
        abilities = [{"concept_tag": "typhoon", "theta": 0.0, "se": 0.3, "n": 4}]
        assert wb.weak_concepts(abilities, "elementary") == []
        assert wb.weak_concepts(abilities, "adult") == ["typhoon"]

"""WeatherBrain 백엔드 계약 테스트 — R6 §5.

교차 서비스·시드 드리프트 감시(board_engine·리그 티어의 이원화 관례와 동일 취지).
DB·네트워크 불필요(순수 상수/함수 검사).

실행: backend 디렉토리에서 `python -m pytest tests/test_weatherbrain_contract.py -q`.
"""

from __future__ import annotations

import importlib
import json
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

    def test_라벨_구간(self):
        assert wb.theta_level_label(-2.0) == "beginner"
        assert wb.theta_level_label(-0.5) == "intermediate"  # 경계는 상위 구간
        assert wb.theta_level_label(0.0) == "intermediate"
        assert wb.theta_level_label(0.5) == "advanced"
        assert wb.theta_level_label(2.0) == "advanced"


class TestThetaToLevelGroupContract:
    """R7 §3.2: backend theta_to_level_group ↔ ai-worker
    priors.theta_to_target_level_group — 같은 θ에 같은 그룹(경계 포함/제외까지)."""

    @pytest.mark.parametrize(
        "theta",
        [-3.0, -1.0, -0.51, -0.5, -0.49, 0.0, 0.49, 0.5, 0.51, 1.0, 3.0],
    )
    def test_대표값_경계값에서_ai_worker와_동일(self, theta):
        assert wb.theta_to_level_group(theta) == (
            priors.theta_to_target_level_group(theta)
        ), f"θ={theta}에서 backend↔ai-worker 매핑 드리프트"


class TestPriorItemBContract:
    """R7 §3.2: 뱅크 풀 정렬의 사전 b CASE 값은 ai-worker LEVEL_GROUP_ITEM_B와
    동일해야 한다 (backend는 ai-worker를 임포트하지 않으므로 상수를 이원 유지)."""

    def test_사전_b_상수_동일(self):
        assert wb.LEVEL_GROUP_ITEM_B == priors.LEVEL_GROUP_ITEM_B

    def test_방어_기본값_동일(self):
        assert wb.DEFAULT_ITEM_B == priors._DEFAULT_ITEM_B

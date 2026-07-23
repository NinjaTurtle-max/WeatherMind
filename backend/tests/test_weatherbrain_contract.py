"""WeatherBrain 백엔드 계약 테스트 — R6 §5.

교차 서비스·시드 드리프트 감시(board_engine·리그 티어의 이원화 관례와 동일 취지).
DB·네트워크 불필요(순수 상수/함수 검사).

실행: backend 디렉토리에서 `python -m pytest tests/test_weatherbrain_contract.py -q`.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services import weatherbrain_service as wb

SEED = Path(__file__).resolve().parents[1].parent / "database" / "seed" / "content_items.json"


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

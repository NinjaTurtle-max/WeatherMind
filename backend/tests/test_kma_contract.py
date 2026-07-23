"""KMA 카테고리 해석 계약 회귀 테스트 (R5.5) — backend ↔ celery 교차 컨텍스트.

RETROSPECTIVE §5의 "KMA 카테고리 해석 3원화"를 어드바이저 지침대로 분해해 해소한다:

- weather_api ↔ session_service(같은 빌드 컨텍스트): SKY_TEXT를 weather_api로
  단일화하고 session_service가 import — 물리적 DRY(계약 테스트 불필요, import로 보증).
- weather_api(backend) ↔ kma_client(celery): **서로 다른 빌드 컨텍스트**라 공유
  import이 불가능하다. 두 벌의 복제본(KMA_CATEGORY·NO_RAIN_STRINGS·parse_kma_value)이
  조용히 드리프트하는 것을 이 계약 테스트가 CI 실패로 전환한다 — board_rules.json /
  test_r3_r5_contract(ai-worker validate_chain 실임포트)와 동일한 저장소 관례.

두 디렉토리가 최상위 패키지명 `app`을 공유하므로, celery 모듈은 sys.modules를 스왑해
backend `app`과 충돌 없이 임포트한다(test_r3_r5_contract._import_ai_worker_* 패턴).

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import importlib
import sys
from pathlib import Path

import pytest

from app.services import weather_api

REPO_ROOT = Path(__file__).resolve().parents[2]
CELERY_DIR = REPO_ROOT / "celery"


def _import_celery_kma_client():
    """celery kma_client를 backend `app` 패키지와 충돌 없이 임포트한다.

    (test_r3_r5_contract._import_ai_worker_validate_chain과 동일 패턴 — 두 디렉토리가
    최상위 패키지명 `app`을 공유.)
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(CELERY_DIR))
    try:
        module = importlib.import_module("app.kma_client")
    finally:
        sys.path.remove(str(CELERY_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


# parse_kma_value 동등성을 넓게 커버하는 입력 배터리(무강수 문자열·숫자·비숫자·경계).
PARSE_INPUTS = [
    "강수없음", "적설없음", "없음", "", None,   # NO_RAIN → 0.0
    "1.5", "0", "30", 3, 3.0,                    # 숫자 → float
    "비", "abc", "10mm",                          # 비숫자 유의미 문자열 → 원본 유지
]


class TestKmaCategoryContract:
    """backend weather_api ↔ celery kma_client의 KMA 해석이 동일해야 한다."""

    def test_KMA_CATEGORY_동일(self):
        kma = _import_celery_kma_client()
        assert kma.KMA_CATEGORY == weather_api.KMA_CATEGORY

    def test_NO_RAIN_STRINGS_동일(self):
        kma = _import_celery_kma_client()
        assert kma.NO_RAIN_STRINGS == weather_api.NO_RAIN_STRINGS

    @pytest.mark.parametrize("raw", PARSE_INPUTS)
    def test_parse_kma_value_동일(self, raw):
        kma = _import_celery_kma_client()
        assert kma.parse_kma_value(raw) == weather_api.parse_kma_value(raw)


class TestSkyTextSingleOwner:
    """SKY_TEXT는 weather_api가 소유하고 session_service가 재사용한다(중복 제거)."""

    def test_session_service가_weather_api_SKY_TEXT_재사용(self):
        from app.services import session_service

        assert session_service.SKY_TEXT is weather_api.SKY_TEXT

    def test_SKY_TEXT_코드_매핑(self):
        assert weather_api.SKY_TEXT == {1: "맑음", 3: "구름많음", 4: "흐림"}

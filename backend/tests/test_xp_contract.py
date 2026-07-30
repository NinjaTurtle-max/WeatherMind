"""듀얼 승리 XP 계약 회귀 테스트 (R8-01 §3.6) — backend ↔ celery 교차 컨텍스트.

DUEL_WIN_XP는 두 곳에 존재한다:

- backend `duel_service.DUEL_WIN_XP` — **단일 소유자**. 값 변경은 여기서만 한다.
- celery `app/tasks/league.py` — 일일 정산 태스크(settle_daily_duel)가 생 SQL
  (`UPDATE users SET xp = xp + :bonus`)로 지급하므로 자체 복제본을 갖는다.

celery는 별도 빌드 컨텍스트라 backend를 import할 수 없다(물리적 병합 금지 —
CLAUDE.md "교차 빌드 컨텍스트 중복은 단일 소유자+계약 테스트"). 두 복제본이
조용히 드리프트하면 프론트가 안내하는 보상과 실지급이 어긋나므로, 이 테스트가
celery 상수를 실임포트해 대조하고 드리프트를 CI 실패로 전환한다
(test_kma_contract의 KMA_CATEGORY 계약과 동일한 저장소 관례).

두 디렉토리가 최상위 패키지명 `app`을 공유하므로, celery 모듈은 sys.modules를
스왑해 backend `app`과 충돌 없이 임포트한다(test_kma_contract 패턴).

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import importlib
import sys
from pathlib import Path

import pytest

from app.services import duel_service

REPO_ROOT = Path(__file__).resolve().parents[2]
CELERY_DIR = REPO_ROOT / "celery"


def _import_celery_league():
    """celery app.tasks.league를 backend `app` 패키지와 충돌 없이 임포트한다.

    (test_kma_contract._import_celery_kma_client와 동일 패턴.)
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(CELERY_DIR))
    try:
        module = importlib.import_module("app.tasks.league")
    finally:
        sys.path.remove(str(CELERY_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


@pytest.fixture(scope="module")
def celery_league():
    return _import_celery_league()


class TestDuelXpContract:
    """backend duel_service ↔ celery league의 듀얼 정산 계약이 동일해야 한다."""

    def test_DUEL_WIN_XP_동일(self, celery_league):
        """단일 소유자(duel_service) 값과 celery 복제본이 일치 — 드리프트 감시."""
        assert celery_league.DUEL_WIN_XP == duel_service.DUEL_WIN_XP

    def test_DUEL_WIN_XP_계약값(self, celery_league):
        """계약값 +15 (R4-01 §3.4) — 양측 동시 변경도 계약 개정 없이 통과 금지."""
        assert duel_service.DUEL_WIN_XP == 15
        assert celery_league.DUEL_WIN_XP == 15

    @pytest.mark.parametrize(
        "user_score,ai_score",
        [(80.0, 70.0), (70.0, 80.0), (75.0, 75.0), (0.0, 0.0), (100.0, 99.99)],
    )
    def test_duel_result_판정_동일(self, celery_league, user_score, ai_score):
        """승패 판정 함수 복제본(win/lose/draw)도 동일 결과여야 한다."""
        assert celery_league.duel_result(user_score, ai_score) == (
            duel_service.duel_result(user_score, ai_score)
        )

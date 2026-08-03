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

    def test_프론트에_XP_상수_사본이_없다(self):
        """세 번째 복제본 금지 (R10 ponytail).

        프론트는 `lib/xpConstants.js`에 `DUEL_WIN_XP = 15` 미러를 두고 승리 배지·
        토스트에 하드코딩했다 — backend↔celery 복제본은 이 파일이 감시했지만 프론트
        사본은 **아무도 감시하지 않았다**. 서버가 `xp_earned`를 응답에 실어 보내도록
        바꾸고 미러를 지웠으므로, 되살아나는 것을 여기서 막는다.
        (같은 부류를 R10-07이 두 번 고쳤다: slider min/max, 약점 보너스 XP.)
        """
        root = Path(__file__).resolve().parents[2] / "frontend" / "src"
        assert not (root / "lib" / "xpConstants.js").exists(), (
            "xpConstants.js가 되살아났다 — XP 액수는 서버 응답(xp_earned)에서 읽는다"
        )
        hits = [
            f"{p.relative_to(root)}"
            for p in root.rglob("*.js*")
            if "DUEL_WIN_XP" in p.read_text(encoding="utf-8", errors="replace")
        ]
        assert hits == [], f"프론트에 XP 상수 사본 부활: {hits}"

    def test_듀얼_응답이_XP_액수를_보낸다(self):
        """`xp_earned`가 두 응답 모델에 있고 result에서 파생된다 — 프론트 하드코딩 대체."""
        from app.routers.duel import _duel_xp_earned
        from app.schemas.duel import DuelHistoryItem, DuelToday

        assert "xp_earned" in DuelToday.model_fields
        assert "xp_earned" in DuelHistoryItem.model_fields
        assert _duel_xp_earned(None) is None, "정산 전이면 null(추정 금지)"
        assert _duel_xp_earned("win") == duel_service.DUEL_WIN_XP
        assert _duel_xp_earned("lose") == 0
        assert _duel_xp_earned("draw") == 0

    @pytest.mark.parametrize(
        "user_score,ai_score",
        [(80.0, 70.0), (70.0, 80.0), (75.0, 75.0), (0.0, 0.0), (100.0, 99.99)],
    )
    def test_duel_result_판정_동일(self, celery_league, user_score, ai_score):
        """승패 판정 함수 복제본(win/lose/draw)도 동일 결과여야 한다."""
        assert celery_league.duel_result(user_score, ai_score) == (
            duel_service.duel_result(user_score, ai_score)
        )

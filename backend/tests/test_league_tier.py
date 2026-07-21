"""리그 티어 산정 계약 테스트 — 스프린트 R4-01 §3.2 (R4-S2).

구름 5단계 임계(순수 함수 tier_from_elo)의 경계와 승급 판정을 고정한다.
임계: <1100 stratus / ≥1100 cumulus / ≥1250 nimbostratus / ≥1400 cumulonimbus /
≥1550 typhoon_eye (하한 포함).

backend와 celery(celery/app/tasks/league.py)에 같은 정의를 이원 복제하므로,
두 구현이 계약 임계값에서 일치하는지도 확인한다.
"""
import pytest

from app.services.league_service import (
    DEFAULT_TIER,
    TIER_ORDER,
    is_tier_promoted,
    tier_from_elo,
)


class TestTierThresholds:
    @pytest.mark.parametrize(
        ("elo", "tier"),
        [
            (0, "stratus"),
            (1099, "stratus"),      # 경계 하단
            (1100, "cumulus"),      # cumulus 진입
            (1249, "cumulus"),
            (1250, "nimbostratus"),
            (1399, "nimbostratus"),
            (1400, "cumulonimbus"),
            (1549, "cumulonimbus"),  # 경계 하단
            (1550, "typhoon_eye"),   # typhoon_eye 진입
            (9999, "typhoon_eye"),
        ],
    )
    def test_경계값(self, elo, tier):
        assert tier_from_elo(elo) == tier

    def test_기본_티어는_stratus(self):
        assert DEFAULT_TIER == "stratus"
        assert TIER_ORDER[0] == "stratus"

    def test_티어_서열_5단계(self):
        assert TIER_ORDER == (
            "stratus", "cumulus", "nimbostratus", "cumulonimbus", "typhoon_eye",
        )


class TestTierPromoted:
    def test_상승이면_True(self):
        assert is_tier_promoted("stratus", "cumulus") is True
        assert is_tier_promoted("cumulus", "typhoon_eye") is True

    def test_동일_티어는_False(self):
        assert is_tier_promoted("cumulus", "cumulus") is False

    def test_강등은_False(self):
        assert is_tier_promoted("typhoon_eye", "cumulus") is False

    def test_직전_없으면_기본대비_판정(self):
        # 첫 정산: prev 없음(None) → stratus 대비. cumulus면 승급, stratus면 아님.
        assert is_tier_promoted(None, "cumulus") is True
        assert is_tier_promoted(None, "stratus") is False


class TestBackendCeleryParity:
    """backend league_service와 celery league.py 티어 정의 일치 (계약 §3.2 이원 복제)."""

    def test_임계값에서_동일_산정(self):
        import importlib
        import sys
        from pathlib import Path

        # celery 미설치 환경(백엔드 전용 테스트 실행)에서는 이원 파리티만 스킵
        pytest.importorskip("celery")

        celery_dir = Path(__file__).resolve().parents[2] / "celery"
        saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
        for key in list(saved):
            del sys.modules[key]
        sys.path.insert(0, str(celery_dir))
        try:
            celery_league = importlib.import_module("app.tasks.league")
            for elo in (0, 1099, 1100, 1250, 1400, 1549, 1550):
                assert celery_league.tier_from_elo(elo) == tier_from_elo(elo)
        finally:
            sys.path.remove(str(celery_dir))
            for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
                del sys.modules[key]
            sys.modules.update(saved)

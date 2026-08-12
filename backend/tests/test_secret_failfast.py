"""시크릿 fail-fast — R11-01 웨이브 3 §7.0 시크릿 (교차 계약 ③).

3분기 계약:
- dev(DEV_MODE=true) + 플레이스홀더 → **경고 1회 후 기동** (로컬·CI·스모크 보호)
- 비-dev + 플레이스홀더 → **기동 거부** (RuntimeError — uvicorn lifespan 실패)
- 비-dev + 실값 → 정상 기동 (경고 없음)

검사는 import 시점이 아니라 lifespan startup에서 한다 — pytest는 lifespan을
돌리지 않는 TestClient(컨텍스트 밖) 사용이 관례라 기존 테스트가 깨지지 않고,
"기동 거부"의 의미(uvicorn 프로세스가 뜨지 않음)와 정확히 일치한다.
플레이스홀더 판정은 ai-worker `llm_configured()` 선례(마커 부분 문자열)를 준용.
"""
import logging

import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import (
    GUARDED_SECRET_NAMES,
    SECRET_PLACEHOLDER_MARKERS,
    insecure_secret_defaults,
    settings,
)
from app.main import app

PLACEHOLDER = {
    "DATABASE_URL": "postgresql+asyncpg://weathermind:changeme@postgres:5432/weathermind",
    "JWT_SECRET_KEY": "changeme-use-openssl-rand-hex-32",
    "AI_WORKER_INTERNAL_API_KEY": "changeme-internal-secret",
}
REAL = {
    "DATABASE_URL": "postgresql+asyncpg://weathermind:x7f2k9q1JmZ@postgres:5432/weathermind",
    "JWT_SECRET_KEY": "9" * 24 + "a" * 40,  # openssl rand -hex 32 형태(64 hex)
    "AI_WORKER_INTERNAL_API_KEY": "b" * 64,
}


def _apply(monkeypatch, values: dict, dev: bool) -> None:
    for name, value in values.items():
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(settings, "DEV_MODE", dev)
    # ⚠️ 이 파일은 저장소에서 **유일하게 lifespan을 실제로 구동**하는 테스트다
    # (`with TestClient(app)`). lifespan에는 KMA 키 게이트 프로브가 달려 있고,
    # `Settings`는 `env_file=".env"`를 읽는다 — 즉 운영자 체크아웃(실키가 든 .env)
    # 에서 돌리면 **유닛테스트가 API허브로 실호출을 날린다**. 키를 비워 프로브가
    # 네트워크 이전에 반환하게 한다(weather_api.probe_key: auth_keys() 비면 즉시).
    # 검증 대상은 시크릿 3분기이지 KMA가 아니다.
    monkeypatch.setattr(settings, "KMA_API_KEY", "")
    monkeypatch.setattr(settings, "KMA_API_KEY_SPARE", "")


class _FakeEngine:
    async def dispose(self):
        return None


async def _noop_close_redis():
    return None


@pytest.fixture()
def isolated_shutdown(monkeypatch):
    """lifespan shutdown의 실자원 접근(engine.dispose·close_redis) 격리 —
    검증 대상은 startup의 3분기이지 종료 정리가 아니다."""
    monkeypatch.setattr(main, "engine", _FakeEngine())
    monkeypatch.setattr(main, "close_redis", _noop_close_redis)


# ═══════════════════════════════════════════════════════════════
# 감지기 단위 계약 — insecure_secret_defaults
# ═══════════════════════════════════════════════════════════════


class TestDetector:
    def test_감시_대상은_changeme_기본값_3개(self):
        assert set(GUARDED_SECRET_NAMES) == {
            "DATABASE_URL",
            "JWT_SECRET_KEY",
            "AI_WORKER_INTERNAL_API_KEY",
        }

    def test_전부_플레이스홀더면_3개_전부_감지(self, monkeypatch):
        _apply(monkeypatch, PLACEHOLDER, dev=True)
        assert insecure_secret_defaults() == list(GUARDED_SECRET_NAMES)

    def test_일부만_플레이스홀더면_그것만_감지(self, monkeypatch):
        _apply(monkeypatch, {**REAL, "JWT_SECRET_KEY": PLACEHOLDER["JWT_SECRET_KEY"]}, dev=True)
        assert insecure_secret_defaults() == ["JWT_SECRET_KEY"]

    def test_빈_값도_미설정으로_감지(self, monkeypatch):
        _apply(monkeypatch, {**REAL, "JWT_SECRET_KEY": "  "}, dev=True)
        assert insecure_secret_defaults() == ["JWT_SECRET_KEY"]

    def test_실값이면_빈_리스트(self, monkeypatch):
        _apply(monkeypatch, REAL, dev=False)
        assert insecure_secret_defaults() == []

    def test_마커는_ai_worker_선례를_포함(self):
        """llm_configured()의 플레이스홀더 마커 계열과 어긋나지 않는다."""
        assert {"changeme", "발급받은", "your-", "placeholder"} <= set(
            SECRET_PLACEHOLDER_MARKERS
        )


# ═══════════════════════════════════════════════════════════════
# 3분기 — 기동(lifespan) 행동
# ═══════════════════════════════════════════════════════════════


class TestThreeBranches:
    def test_dev_플레이스홀더는_경고_후_기동(self, monkeypatch, caplog, isolated_shutdown):
        _apply(monkeypatch, PLACEHOLDER, dev=True)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            with TestClient(app):  # 컨텍스트 진입 = lifespan startup = 기동
                pass  # 예외 없이 진입했다 = 기동 성공
        warnings = [r for r in caplog.records if "시크릿 경고" in r.getMessage()]
        assert len(warnings) == 1, "dev에서는 경고가 정확히 1회여야 한다"
        msg = warnings[0].getMessage()
        for name in GUARDED_SECRET_NAMES:
            assert name in msg
        assert "openssl rand -hex 32" in msg  # 생성 안내 포함

    def test_비dev_플레이스홀더는_기동_거부(self, monkeypatch):
        _apply(monkeypatch, PLACEHOLDER, dev=False)
        with pytest.raises(RuntimeError) as exc_info:
            with TestClient(app):
                pass
        msg = str(exc_info.value)
        assert "기동 거부" in msg
        for name in GUARDED_SECRET_NAMES:
            assert name in msg, f"거부 사유에 {name}이 명시되지 않았다"
        # 한국어 생성 안내 — 무엇을 어떻게 만들어야 하는지
        assert "openssl rand -hex 32" in msg
        assert "DEV_MODE" in msg

    def test_비dev_실값은_정상_기동(self, monkeypatch, caplog, isolated_shutdown):
        _apply(monkeypatch, REAL, dev=False)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            with TestClient(app):
                pass  # 예외 없음 = 기동
        assert not [r for r in caplog.records if "시크릿" in r.getMessage()]

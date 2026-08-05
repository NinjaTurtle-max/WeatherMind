"""구조적 로깅 + /health 의존 상태 — R11-01 웨이브 3 §7.0 로깅·헬스체크.

- JSON 라인 로깅: 로그 1건 = JSON 1줄 (ts·level·logger·msg + 요청 필드).
- 요청 로그: RequestLogMiddleware(app.request)가 method·path·status·duration_ms.
- /health: DB(SELECT 1)·Redis(ping) 반영. **어느 하나라도 실패면 503** —
  둘 다 전 엔드포인트의 하드 의존이라, 200을 주면 오케스트레이터가 죽은
  인스턴스로 트래픽을 보낸다(판정 근거는 main.py 주석). 정상일 때는 기존과
  같은 200 + status=ok·service 키 유지 — 스모크(/health 200 폴링) 하위 호환.
"""
import asyncio
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core.logging import (
    REQUEST_LOG_FIELDS,
    JsonFormatter,
    RequestLogMiddleware,  # noqa: F401 — 장착 여부는 아래 미들웨어 테스트가 행동으로 검증
    setup_logging,
)
from app import main
from app.main import app


# ═══════════════════════════════════════════════════════════════
# 대역 — DB(engine.connect)·Redis(ping) 성공/실패/행(hang)
# ═══════════════════════════════════════════════════════════════


class _FakeConn:
    async def execute(self, stmt):
        return None


class FakeEngine:
    """ok · fail(즉시 예외) · hang(타임아웃 유도) 3태."""

    def __init__(self, mode="ok"):
        self.mode = mode

    def connect(self):
        return self

    async def __aenter__(self):
        if self.mode == "fail":
            raise ConnectionError("DB 연결 거부 (대역)")
        if self.mode == "hang":
            await asyncio.sleep(60)
        return _FakeConn()

    async def __aexit__(self, *args):
        return False


class FakeRedis:
    def __init__(self, mode="ok"):
        self.mode = mode

    async def ping(self):
        if self.mode == "fail":
            raise ConnectionError("Redis 연결 거부 (대역)")
        return True


@pytest.fixture()
def deps(monkeypatch):
    """main의 /health가 참조하는 engine·get_redis를 대역으로 — 모드 전환 가능."""
    engine = FakeEngine()
    redis = FakeRedis()
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "get_redis", lambda: redis)
    return engine, redis


@pytest.fixture()
def client():
    return TestClient(app)


# ═══════════════════════════════════════════════════════════════
# JsonFormatter — 로그 1건 = JSON 1줄
# ═══════════════════════════════════════════════════════════════


def _make_record(msg="테스트 메시지", **extra):
    record = logging.LogRecord(
        name="app.test", level=logging.INFO, pathname=__file__,
        lineno=1, msg=msg, args=(), exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


class TestJsonFormatter:
    def test_기본_필드_ts_level_logger_msg(self):
        line = JsonFormatter().format(_make_record())
        assert "\n" not in line  # 1줄
        entry = json.loads(line)
        assert entry["level"] == "INFO"
        assert entry["logger"] == "app.test"
        assert entry["msg"] == "테스트 메시지"
        assert entry["ts"].endswith("Z")  # UTC ISO8601

    def test_한국어_원문_유지(self):
        """ensure_ascii=False — \\uXXXX 이스케이프가 아니라 원문."""
        line = JsonFormatter().format(_make_record(msg="구름이 부족합니다"))
        assert "구름이 부족합니다" in line

    def test_요청_필드가_실리고_무관_extra는_실리지_않는다(self):
        record = _make_record(
            method="GET", path="/health", status=200, duration_ms=1.2, secret="X"
        )
        entry = json.loads(JsonFormatter().format(record))
        assert entry["method"] == "GET"
        assert entry["path"] == "/health"
        assert entry["status"] == 200
        assert entry["duration_ms"] == 1.2
        assert "secret" not in entry  # 선언된 필드만 — 우발적 페이로드 유출 방지

    def test_setup_logging은_멱등(self):
        setup_logging()
        setup_logging()
        flagged = [
            h for h in logging.getLogger().handlers
            if getattr(h, "_weathermind_json_handler", False)
        ]
        assert len(flagged) == 1


# ═══════════════════════════════════════════════════════════════
# 요청 로그 미들웨어 — method·path·status·duration_ms
# ═══════════════════════════════════════════════════════════════


class TestRequestLog:
    def test_요청_1건이_구조화_로그_1건(self, deps, client, caplog):
        with caplog.at_level(logging.INFO, logger="app.request"):
            client.get("/health")
        records = [r for r in caplog.records if r.name == "app.request"]
        assert len(records) == 1
        r = records[0]
        assert r.method == "GET"
        assert r.path == "/health"
        assert r.status == 200
        assert isinstance(r.duration_ms, float) and r.duration_ms >= 0

    def test_요청_로그의_JSON_직렬화_표본(self, deps, client, caplog):
        """실제 파이프라인(미들웨어 레코드 → JsonFormatter) 왕복 표본."""
        with caplog.at_level(logging.INFO, logger="app.request"):
            client.get("/health")
        record = next(r for r in caplog.records if r.name == "app.request")
        entry = json.loads(JsonFormatter().format(record))
        assert set(REQUEST_LOG_FIELDS) <= set(entry)
        assert {"ts", "level", "logger", "msg"} <= set(entry)

    def test_에러_응답도_상태코드_그대로_기록(self, deps, client, caplog):
        with caplog.at_level(logging.INFO, logger="app.request"):
            client.get("/api/v1/없는경로")
        record = next(r for r in caplog.records if r.name == "app.request")
        assert record.status == 404


# ═══════════════════════════════════════════════════════════════
# /health — 의존 상태 반영 + 하위 호환
# ═══════════════════════════════════════════════════════════════


class TestHealth:
    def test_정상이면_200_기존_키_유지(self, deps, client):
        """스모크 하위 호환 — status=ok·service 키가 그대로 있어야 한다."""
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["service"] == "weathermind-backend"
        assert body["checks"] == {"db": "ok", "redis": "ok"}

    def test_DB_실패면_503(self, deps, client):
        engine, _ = deps
        engine.mode = "fail"
        res = client.get("/health")
        assert res.status_code == 503
        assert res.json()["checks"] == {"db": "fail", "redis": "ok"}
        assert res.json()["status"] == "unavailable"

    def test_Redis_실패면_503(self, deps, client):
        _, redis = deps
        redis.mode = "fail"
        res = client.get("/health")
        assert res.status_code == 503
        assert res.json()["checks"] == {"db": "ok", "redis": "fail"}

    def test_의존이_행이어도_health는_타임아웃으로_즉응(self, deps, client, monkeypatch):
        """의존이 응답을 물고 있어도 /health가 같이 물리면 안 된다 — 2초(테스트는
        0.05초로 단축) 타임아웃 후 fail 처리."""
        engine, _ = deps
        engine.mode = "hang"
        monkeypatch.setattr(main, "_HEALTH_CHECK_TIMEOUT_SEC", 0.05)
        res = client.get("/health")
        assert res.status_code == 503
        assert res.json()["checks"]["db"] == "fail"

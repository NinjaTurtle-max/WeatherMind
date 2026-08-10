"""KMA 키 게이트 계약 (R13).

무엇을 지키나
-------------
이 서비스의 실제 사고 형태는 "키가 틀렸다"가 아니라 **"틀린 걸 아무도 모른다"**였다.
틀린 키·미승인 API·만료 어느 쪽이든 `KMAApiError`로 떨어지고 상위가 degraded 200
으로 흡수해 **화면에도 로그에도 티가 안 났다**. `KMA_API_KEY`는 기동 거부 대상이
아니고(무키 기동은 스모크의 전제다) `/health`도 보지 않았으므로, "키를 넣었다"와
"키가 동작한다" 사이를 알려 주는 것이 시스템에 하나도 없었다.

그래서 **거부하는 대신 관측 가능하게** 만들었다. 이 파일이 그 관측의 계약이다:

  ① 상태가 실제 호출 결과를 따라간다(unknown → ok / degraded / unconfigured)
  ② 어느 키가 살아 있는지 구분된다 — `active_key == "spare"`는 **주키 사망** 신호다
  ③ 그 보고가 503을 유발하지 않는다 — KMA는 하드 의존이 아니다
  ④ 보고가 **새 유출 지점이 되지 않는다** — detail은 마스킹된다(/health는 외부로 나간다)

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app
from app.services import weather_api


@pytest.fixture(autouse=True)
def reset_key_status():
    """모듈 레벨 상태는 테스트 간에 샌다 — 매번 초기화해 순서 의존을 없앤다."""
    before = dict(weather_api._key_status)
    weather_api._key_status.update({"state": "unknown", "active_key": None, "detail": None})
    yield
    weather_api._key_status.clear()
    weather_api._key_status.update(before)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _keys(monkeypatch, primary, spare):
    monkeypatch.setattr(weather_api.settings, "KMA_API_KEY", primary)
    monkeypatch.setattr(weather_api.settings, "KMA_API_KEY_SPARE", spare)


def _stub(monkeypatch, behaviour):
    async def fake(base_url, params, auth_key):
        return behaviour(auth_key)

    monkeypatch.setattr(weather_api, "_request_items_with_key", fake)


class TestStateFollowsReality:
    """상태가 말이 아니라 **실제 호출 결과**를 따라간다."""

    def test_초기값은_unknown(self):
        assert weather_api.key_status()["state"] == "unknown"

    @pytest.mark.anyio
    async def test_성공하면_ok(self, monkeypatch):
        _keys(monkeypatch, "P", "")
        _stub(monkeypatch, lambda k: [])
        await weather_api._request_items("u", {})
        assert weather_api.key_status()["state"] == "ok"

    @pytest.mark.anyio
    async def test_전부_실패하면_degraded(self, monkeypatch):
        _keys(monkeypatch, "P", "S")

        def boom(k):
            raise weather_api.KMAApiError("resultCode=30")

        _stub(monkeypatch, boom)
        with pytest.raises(weather_api.KMAApiError):
            await weather_api._request_items("u", {})
        assert weather_api.key_status()["state"] == "degraded"

    @pytest.mark.anyio
    async def test_NODATA는_ok다(self, monkeypatch):
        """03은 빈 결과일 뿐 인증은 통과한 것 — degraded로 보고하면 오진이다."""
        _keys(monkeypatch, "P", "")
        _stub(monkeypatch, lambda k: [])
        await weather_api._request_items("u", {})
        assert weather_api.key_status()["state"] == "ok"

    @pytest.mark.anyio
    async def test_키가_없으면_unconfigured(self, monkeypatch):
        """무키 환경을 degraded(=고장)로 보고하면 스모크가 오진을 읽는다."""
        _keys(monkeypatch, "", "")

        def boom(k):
            raise weather_api.KMAApiError("no key")

        _stub(monkeypatch, boom)
        with pytest.raises(weather_api.KMAApiError):
            await weather_api._request_items("u", {})
        assert weather_api.key_status()["state"] == "unconfigured"


class TestActiveKeyLabel:
    """`active_key == "spare"` = 주키 사망. 이 게이트의 핵심 출력이다."""

    @pytest.mark.anyio
    async def test_주키가_응답하면_primary(self, monkeypatch):
        _keys(monkeypatch, "P", "S")
        _stub(monkeypatch, lambda k: [])
        await weather_api._request_items("u", {})
        assert weather_api.key_status()["active_key"] == "primary"

    @pytest.mark.anyio
    async def test_스페어가_응답하면_spare(self, monkeypatch):
        _keys(monkeypatch, "P", "S")

        def only_spare(k):
            if k == "P":
                raise weather_api.KMAApiError("primary dead")
            return []

        _stub(monkeypatch, only_spare)
        await weather_api._request_items("u", {})
        st = weather_api.key_status()
        assert st["state"] == "ok" and st["active_key"] == "spare"

    @pytest.mark.anyio
    async def test_스페어만_설정된_환경도_spare로_본다(self, monkeypatch):
        """인덱스로 라벨하면 auth_keys()[0]이라 primary로 **거짓 보고**한다."""
        _keys(monkeypatch, "", "S")
        _stub(monkeypatch, lambda k: [])
        await weather_api._request_items("u", {})
        assert weather_api.key_status()["active_key"] == "spare"

    def test_스페어_설정_여부가_드러난다(self, monkeypatch):
        """스페어를 넣었다고 믿었는데 안 들어간 경우를 보이게 한다."""
        _keys(monkeypatch, "P", "")
        assert weather_api.key_status()["spare_configured"] is False
        _keys(monkeypatch, "P", "S")
        assert weather_api.key_status()["spare_configured"] is True
        assert weather_api.key_status()["keys_configured"] == 2


class TestProbe:
    @pytest.mark.anyio
    async def test_키가_없으면_네트워크를_치지_않는다(self, monkeypatch):
        _keys(monkeypatch, "", "")
        called = []
        _stub(monkeypatch, lambda k: called.append(k) or [])
        out = await weather_api.probe_key()
        assert called == [] and out["state"] == "unconfigured"

    @pytest.mark.anyio
    async def test_프로브_실패가_예외로_새지_않는다(self, monkeypatch):
        """기동을 막으면 안 된다 — KMA는 하드 의존이 아니다."""
        _keys(monkeypatch, "P", "")

        def boom(k):
            raise weather_api.KMAApiError("resultCode=30")

        _stub(monkeypatch, boom)
        out = await weather_api.probe_key()  # raise 하지 않는다
        assert out["state"] == "degraded"

    @pytest.mark.anyio
    async def test_타임아웃도_degraded로_기록된다(self, monkeypatch):
        """취소된 요청은 _request_items가 기록하지 못한다 — 프로브가 직접 남긴다."""
        _keys(monkeypatch, "P", "")
        monkeypatch.setattr(weather_api, "_KEY_PROBE_TIMEOUT_SEC", 0.02)

        async def hang(base_url, params, auth_key):
            await asyncio.sleep(5)

        monkeypatch.setattr(weather_api, "_request_items_with_key", hang)
        out = await weather_api.probe_key()
        assert out["state"] == "degraded" and "타임아웃" in out["detail"]


class TestDetailIsMasked:
    """보고가 새 유출 지점이 되면 안 된다 — /health는 외부로 나간다."""

    @pytest.mark.anyio
    async def test_실패_detail에_키가_남지_않는다(self, monkeypatch):
        _keys(monkeypatch, "P", "")

        def boom(k):
            raise weather_api.KMAApiError(
                "for url 'https://apihub.kma.go.kr/a?authKey=REAL_SECRET&x=1'"
            )

        _stub(monkeypatch, boom)
        with pytest.raises(weather_api.KMAApiError):
            await weather_api._request_items("u", {})
        assert "REAL_SECRET" not in weather_api.key_status()["detail"]


# ═══════════════════════════════════════════════════════════════
# /health 노출 — 보고는 하되 503 판정에는 끼지 않는다
# ═══════════════════════════════════════════════════════════════


class _FakeConn:
    async def execute(self, stmt):
        return None


class FakeEngine:
    def connect(self):
        return self

    async def __aenter__(self):
        return _FakeConn()

    async def __aexit__(self, *a):
        return False


class FakeRedis:
    async def ping(self):
        return True


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "engine", FakeEngine())
    monkeypatch.setattr(main, "get_redis", lambda: FakeRedis())
    return TestClient(app)  # 컨텍스트 매니저가 아니므로 lifespan(프로브)은 안 돈다


class TestHealthExposure:
    def test_kma_필드가_나온다(self, client):
        body = client.get("/health").json()
        assert set(body["kma"]) >= {"state", "active_key", "keys_configured", "spare_configured"}

    def test_checks는_종전_그대로다(self, client):
        """`checks`에 kma가 끼면 503 판정이 오염되고 계약 테스트가 깨진다."""
        assert client.get("/health").json()["checks"] == {"db": "ok", "redis": "ok"}

    def test_kma가_degraded여도_200이다(self, client):
        """이 게이트의 존재 이유 — KMA는 하드 의존이 아니다. 죽은 키로 인스턴스를
        내리면 학습·퀴즈·보드까지 같이 죽는다."""
        weather_api._record_key_result("degraded", None, "resultCode=30")
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert res.json()["kma"]["state"] == "degraded"

    def test_스페어로_도는_중이면_health로_보인다(self, client):
        """주키 사망을 운영자가 알 수 있는 유일한 통로다."""
        weather_api._record_key_result("ok", "spare")
        assert client.get("/health").json()["kma"]["active_key"] == "spare"

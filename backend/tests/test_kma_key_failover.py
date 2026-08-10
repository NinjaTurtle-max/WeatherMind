"""스페어(2번) 호출키 폴백 계약 (R13).

왜 있나
-------
**주키가 죽는 날짜가 이미 정해져 있다.** 대회 제공 계정 키는 8/22 만료인데,
규정상 서비스 URL은 9월 셋째 주까지 살아 있어야 한다(`HACKATHON_RULES.md` §3).
그날 사람이 개입하지 않으면 날씨가 통째로 degraded로 떨어지는데, 그 실패는 200으로
흡수돼 화면에 티가 안 난다(`KMA_API_KEY`는 기동 거부 대상이 아니다 — 무키 기동은
스모크의 전제다). 그래서 개인 계정 키를 스페어로 두고 코드가 자동으로 집게 했다.

폴백이 **조용히 안 도는 것**이 최악의 형태다 — 만료 당일 아무 로그도 없이 날씨만
비는 것. 그래서 순서·발동 조건·미설정 시 동작을 여기서 못 박는다.

관측은 **키 게이트**가 맡는다(`test_kma_key_gate.py`): `/health`의 `kma.active_key`가
`"spare"`면 주키가 죽었다는 뜻이다. 폴백과 관측은 짝이다 — 폴백만 있으면 주키가 죽은
줄 모른 채 스페어를 태우고, 관측만 있으면 알면서 못 막는다.

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


celery_kma = _import_celery_kma_client()


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _set_backend_keys(monkeypatch, primary, spare):
    monkeypatch.setattr(weather_api.settings, "KMA_API_KEY", primary)
    monkeypatch.setattr(weather_api.settings, "KMA_API_KEY_SPARE", spare)


def _set_celery_keys(monkeypatch, primary, spare):
    monkeypatch.setattr(celery_kma.config, "KMA_API_KEY", primary)
    monkeypatch.setattr(celery_kma.config, "KMA_API_KEY_SPARE", spare)


SETTERS = {"backend": _set_backend_keys, "celery": _set_celery_keys}
MODULES = {"backend": weather_api, "celery": celery_kma}
BOTH = pytest.mark.parametrize("ctx", ["backend", "celery"])


class TestAuthKeyOrder:
    """주키 → 스페어. 순서가 뒤집히면 멀쩡한 주키를 두고 스페어를 태운다."""

    @BOTH
    def test_주키만_있으면_하나(self, ctx, monkeypatch):
        SETTERS[ctx](monkeypatch, "PRIMARY", "")
        assert MODULES[ctx].auth_keys() == ["PRIMARY"]

    @BOTH
    def test_둘_다_있으면_주키가_먼저다(self, ctx, monkeypatch):
        SETTERS[ctx](monkeypatch, "PRIMARY", "SPARE")
        assert MODULES[ctx].auth_keys() == ["PRIMARY", "SPARE"]

    @BOTH
    def test_스페어만_있어도_쓴다(self, ctx, monkeypatch):
        """주키 칸을 비우고 스페어만 채운 운영자를 막지 않는다."""
        SETTERS[ctx](monkeypatch, "", "SPARE")
        assert MODULES[ctx].auth_keys() == ["SPARE"]

    @BOTH
    def test_공백만_있는_값은_키가_아니다(self, ctx, monkeypatch):
        """`.env`에서 값을 지우다 공백이 남는 실수가 폴백을 헛돌게 하면 안 된다."""
        SETTERS[ctx](monkeypatch, "PRIMARY", "   ")
        assert MODULES[ctx].auth_keys() == ["PRIMARY"]

    @BOTH
    def test_둘_다_비면_빈_목록(self, ctx, monkeypatch):
        SETTERS[ctx](monkeypatch, "", "")
        assert MODULES[ctx].auth_keys() == []


class TestBackendFailover:
    @pytest.mark.anyio
    async def test_주키가_실패하면_스페어로_넘어간다(self, monkeypatch):
        _set_backend_keys(monkeypatch, "PRIMARY", "SPARE")
        tried = []

        async def fake(base_url, params, auth_key):
            tried.append(auth_key)
            if auth_key == "PRIMARY":
                raise weather_api.KMAApiError("resultCode=30")
            return [{"ok": 1}]

        monkeypatch.setattr(weather_api, "_request_items_with_key", fake)
        assert await weather_api._request_items("u", {}) == [{"ok": 1}]
        assert tried == ["PRIMARY", "SPARE"]

    @pytest.mark.anyio
    async def test_주키가_되면_스페어를_안_쓴다(self, monkeypatch):
        """멀쩡한 주키를 두고 스페어 한도를 태우면 안 된다."""
        _set_backend_keys(monkeypatch, "PRIMARY", "SPARE")
        tried = []

        async def fake(base_url, params, auth_key):
            tried.append(auth_key)
            return []

        monkeypatch.setattr(weather_api, "_request_items_with_key", fake)
        await weather_api._request_items("u", {})
        assert tried == ["PRIMARY"]

    @pytest.mark.anyio
    async def test_둘_다_실패하면_마지막_예외가_오른다(self, monkeypatch):
        _set_backend_keys(monkeypatch, "PRIMARY", "SPARE")

        async def fake(base_url, params, auth_key):
            raise weather_api.KMAApiError(f"fail:{auth_key}")

        monkeypatch.setattr(weather_api, "_request_items_with_key", fake)
        with pytest.raises(weather_api.KMAApiError, match="fail:SPARE"):
            await weather_api._request_items("u", {})

    @pytest.mark.anyio
    async def test_키가_없어도_종전처럼_한_번은_시도한다(self, monkeypatch):
        """미설정 환경의 동작이 바뀌면 안 된다 — 스모크가 키 부재를 전제한다."""
        _set_backend_keys(monkeypatch, "", "")
        tried = []

        async def fake(base_url, params, auth_key):
            tried.append(auth_key)
            return []

        monkeypatch.setattr(weather_api, "_request_items_with_key", fake)
        await weather_api._request_items("u", {})
        assert tried == [""]


class TestCeleryFailover:
    def test_주키가_실패하면_스페어로_넘어간다(self, monkeypatch):
        _set_celery_keys(monkeypatch, "PRIMARY", "SPARE")
        tried = []

        def fake(base_url, params, auth_key):
            tried.append(auth_key)
            if auth_key == "PRIMARY":
                raise celery_kma.KMAApiError("resultCode=30")
            return [{"ok": 1}]

        monkeypatch.setattr(celery_kma, "_request_items_with_key", fake)
        assert celery_kma._request_items("u", {}) == [{"ok": 1}]
        assert tried == ["PRIMARY", "SPARE"]

    def test_주키가_되면_스페어를_안_쓴다(self, monkeypatch):
        _set_celery_keys(monkeypatch, "PRIMARY", "SPARE")
        tried = []

        def fake(base_url, params, auth_key):
            tried.append(auth_key)
            return []

        monkeypatch.setattr(celery_kma, "_request_items_with_key", fake)
        celery_kma._request_items("u", {})
        assert tried == ["PRIMARY"]

    def test_둘_다_실패하면_마지막_예외가_오른다(self, monkeypatch):
        _set_celery_keys(monkeypatch, "PRIMARY", "SPARE")

        def fake(base_url, params, auth_key):
            raise celery_kma.KMAApiError(f"fail:{auth_key}")

        monkeypatch.setattr(celery_kma, "_request_items_with_key", fake)
        with pytest.raises(celery_kma.KMAApiError, match="fail:SPARE"):
            celery_kma._request_items("u", {})


class TestKeyNeverLogged:
    """폴백 로그가 새 유출 지점이 되면 안 된다 — 실패 메시지에 URL이 실린다."""

    def test_폴백_경고에도_마스킹이_걸린다(self):
        leaky = "for url 'https://apihub.kma.go.kr/a?authKey=REAL_SECRET&x=1'"
        assert "REAL_SECRET" not in weather_api.mask_service_key(leaky)


class TestCrossBuildParity:
    """backend ↔ celery 폴백 순서가 갈리면 한쪽만 만료를 넘긴다."""

    @pytest.mark.parametrize(
        "primary,spare,expected",
        [("P", "S", ["P", "S"]), ("P", "", ["P"]), ("", "S", ["S"]), ("", "", [])],
    )
    def test_같은_순서를_낸다(self, primary, spare, expected, monkeypatch):
        _set_backend_keys(monkeypatch, primary, spare)
        _set_celery_keys(monkeypatch, primary, spare)
        assert weather_api.auth_keys() == expected
        assert celery_kma.auth_keys() == expected

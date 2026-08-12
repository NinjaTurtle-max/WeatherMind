"""LLM 지출 상한·서빙 모드 계약 (2026-08-12 클라이언트 결정).

목적은 **아껴 쓰기가 아니라 최대 손실을 확정하기**다. 실측 예상 런타임 비용은
대회 전 기간 $0.23뿐이라 절감할 것이 없다. 막으려는 것은 꼬리 위험이다 —
재시도 루프, 무인 기간(URL을 9월 셋째 주까지 유지), 키 유출 시 피해 상한.

여기서 무는 것 넷:
⑴ **기본이 dummy다** — 안전한 상태가 기본값이어야 한다
⑵ 저작·검증 배치는 서빙 모드에 **안 막힌다** — 막으면 G1을 못 돌린다
⑶ 카운터가 없으면 **켜지 않는다**(fail-closed)
⑷ 모르는 모델은 **최고가로** 센다 — 싸게 세면 상한이 뚫린다
"""
import pytest

from app import config
from app import llm_budget as budget
from app import llm_provider as lp

ENV = (
    "LLM_SERVING_MODE",
    "LLM_BUDGET_TOTAL_USD",
    "LLM_BUDGET_DAY_USD",
    "LLM_FALLBACK_MODEL",
    "LLM_FALLBACK_BASE_URL",
    "LLM_FALLBACK_API_KEY",
    "LLM_RUNTIME_FALLBACK_MODEL",
    "LLM_RUNTIME_FALLBACK_BASE_URL",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    for purpose in lp.PURPOSES:
        for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL"):
            monkeypatch.delenv(f"LLM_{purpose.upper()}_{suffix}", raising=False)
            monkeypatch.delenv(f"LLM_{suffix}", raising=False)
    lp._cached_model.cache_clear()


def _with_key(monkeypatch, key="AIza-looks-real-enough"):
    """GEMINI 키가 설정된 환경 — **`setenv`만으로는 안 닿는다.**

    `Settings`가 frozen dataclass라 **임포트 시점에 env를 한 번 읽고 굳는다.**
    게다가 `llm_provider`가 `from app.config import settings`로 **바인딩을 고정**해서
    `config.settings`만 갈아도 소비 모듈은 옛 객체를 계속 본다.
    그래서 새 인스턴스를 만들어 **양쪽 바인딩에** 꽂는다
    (`llm_configured()`는 `config.settings`를, `resolve_spec`은 `lp.settings`를 본다).
    """
    monkeypatch.setenv("GEMINI_API_KEY", key)
    fresh = config.Settings()  # 여기서 env를 다시 읽는다
    monkeypatch.setattr(config, "settings", fresh)
    monkeypatch.setattr(lp, "settings", fresh)
    return fresh


def _no_redis(monkeypatch):
    monkeypatch.setattr(budget, "_redis", lambda: None)


def _budget(monkeypatch, *, available, reason="여유", total=0.0, cap=5.0):
    monkeypatch.setattr(
        budget, "state",
        lambda: budget.BudgetState(total, 0.0, cap, 1.0, available, reason),
    )


class TestServingModeDefault:
    def test_기본은_dummy다(self, monkeypatch):
        """**이 파일의 첫 계약.**

        지금 서비스가 LLM을 안 부르는 이유는 "키가 없어서"이고 그건 우연이다.
        실측으로 확인했다: 저작 배치용으로 GEMINI_API_KEY를 넣으면 런타임도
        그 순간 같이 켜진다. 켜는 것이 **명시적 행위**여야 한다.
        """
        assert budget.serving_mode() == budget.MODE_DUMMY

    def test_dummy면_런타임이_LLM을_안_부른다(self, monkeypatch):
        _with_key(monkeypatch)
        spec, why = lp.effective_spec(lp.PURPOSE_RUNTIME)
        assert not lp.spec_is_usable(spec)
        assert "dummy" in why

    def test_배치는_서빙모드에_안_막힌다(self, monkeypatch):
        """저작·검증은 사람이 직접 돌리는 오프라인 작업이다.

        여기까지 dummy로 막으면 G1 배치를 못 돌린다 — 막아야 하는 것은
        **배포된 서비스가 조용히 과금하는 것**이지 배치가 아니다.
        """
        _with_key(monkeypatch)
        for purpose in (lp.PURPOSE_AUTHOR, lp.PURPOSE_VALIDATE):
            spec, why = lp.effective_spec(purpose)
            assert why == "batch"
            assert lp.spec_is_usable(spec)

    def test_live로_켜야_비로소_호출된다(self, monkeypatch):
        _with_key(monkeypatch)
        monkeypatch.setenv("LLM_SERVING_MODE", "live")
        _budget(monkeypatch, available=True)
        spec, why = lp.effective_spec(lp.PURPOSE_RUNTIME)
        assert why == "live" and lp.spec_is_usable(spec)


class TestLadder:
    def test_한도_소진시_폴백으로_강등(self, monkeypatch):
        _with_key(monkeypatch)
        monkeypatch.setenv("LLM_SERVING_MODE", "live")
        monkeypatch.setenv("LLM_FALLBACK_MODEL", "openai/gpt-oss-120b")
        monkeypatch.setenv("LLM_FALLBACK_BASE_URL", "https://openrouter.ai/api/v1")
        _budget(monkeypatch, available=False, reason="총 한도 소진", total=5.0)
        spec, why = lp.effective_spec(lp.PURPOSE_RUNTIME)
        assert spec.model == "openai/gpt-oss-120b"
        assert "fallback" in why

    def test_폴백도_없으면_정적_문구로(self, monkeypatch):
        _with_key(monkeypatch)
        monkeypatch.setenv("LLM_SERVING_MODE", "live")
        _budget(monkeypatch, available=False, reason="일일 한도 소진")
        spec, why = lp.effective_spec(lp.PURPOSE_RUNTIME)
        assert not lp.spec_is_usable(spec)
        assert "dummy" in why


class TestFailClosed:
    def test_카운터가_없으면_안_쓴다(self, monkeypatch):
        """셀 수 없는데 돈을 쓰는 것보다 안 쓰는 쪽이 낫다.

        컨테이너 재시작 직후가 카운터를 못 읽는 대표 상황이고, **그때가 정확히
        가장 위험한 순간**이다(누적이 0으로 보이면 상한이 통째로 풀린다).
        """
        _no_redis(monkeypatch)
        st = budget.state()
        assert st.available is False
        assert "카운터" in st.reason


class TestPricing:
    def test_모르는_모델은_최고가로_센다(self):
        """싸게 세면 상한이 뚫린다 — 모를 때는 보수적으로."""
        unknown = budget.price_of("some-model-we-never-heard-of")
        assert unknown == max(budget.PRICES.values(), key=lambda p: p[1])

    def test_접두가_붙어도_찾는다(self):
        """공급자마다 `openai/gpt-oss-120b`처럼 접두를 붙인다."""
        assert budget.price_of("openai/gpt-oss-120b") == budget.PRICES["gpt-oss-120b"]

    def test_더_긴_이름이_이긴다(self):
        """`gpt-oss-20b`와 `gpt-oss-120b`가 둘 다 부분 일치할 수 있다."""
        assert budget.price_of("gpt-oss-120b") == budget.PRICES["gpt-oss-120b"]

    def test_비용_환산이_단가표와_맞는다(self):
        cost = budget.cost_usd("gpt-oss-120b", 1_000_000, 1_000_000)
        pin, pout = budget.PRICES["gpt-oss-120b"]
        assert cost == pytest.approx(pin + pout)

    def test_실측_워크로드가_상한_안에_든다(self):
        """런타임 450콜(세션 150 × 3) 실측 추정이 기본 상한 $5의 몇 %인가.

        상한이 실사용을 막으면 안 된다 — 그건 상한이 아니라 고장이다.
        """
        per_call = budget.cost_usd("gemini-3.1-flash-lite", 780, 115)
        assert per_call * 450 < 1.0  # 일일 상한에도 여유가 크다


class TestHealthExposure:
    """조용한 강등을 사람이 볼 수 있어야 한다 — 무인 심사 기간의 유일한 창구."""

    def test_서빙모드와_한도를_알린다(self, monkeypatch):
        _no_redis(monkeypatch)
        snap = budget.health_snapshot()
        assert snap["serving_mode"] == budget.MODE_DUMMY
        assert snap["budget_available"] is False
        assert snap["cap_total_usd"] == 5.0 and snap["cap_day_usd"] == 1.0

    def test_키를_싣지_않는다(self, monkeypatch):
        """규정: **API 키 노출 = 실격**. `/health`는 인증 없이 열리는 창구다."""
        secret = "AIza-super-secret-9876"
        _with_key(monkeypatch, secret)
        monkeypatch.setenv("LLM_SERVING_MODE", "live")
        _no_redis(monkeypatch)
        assert secret not in repr(budget.health_snapshot())

    def test_엔드포인트가_스냅샷을_실어_보낸다(self, monkeypatch):
        _no_redis(monkeypatch)
        from fastapi.testclient import TestClient

        from app.main import app

        body = TestClient(app).get("/health").json()
        assert body["status"] == "ok"
        assert body["llm"]["serving_mode"] == budget.MODE_DUMMY


class TestUsageParsing:
    def test_토큰을_못_읽어도_예외가_안_난다(self):
        """토큰 파싱 실패가 서비스를 멈출 이유는 아니다 — 상한이 느슨해질 뿐이다."""
        assert budget.usage_from_response(object()) == (0, 0)

    def test_usage_metadata를_읽는다(self):
        class R:
            usage_metadata = {"input_tokens": 12, "output_tokens": 34}

        assert budget.usage_from_response(R()) == (12, 34)

    def test_response_metadata_폴백(self):
        class R:
            usage_metadata = None
            response_metadata = {"token_usage": {"prompt_tokens": 7, "completion_tokens": 9}}

        assert budget.usage_from_response(R()) == (7, 9)

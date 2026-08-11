"""LLM 프로바이더 통로 계약 — CO-B7 3파전 시험 배치의 선행.

**왜 이 파일이 있나**: 세 체인이 각자 `ChatGoogleGenerativeAI`를 직접 만들고 있어서
**Gemini 말고는 부를 통로가 없었다.** 대장 CO-B7이 요구하는 "gpt-oss-20b · Qwen ·
Gemini 3파전 각 50건"은 그 통로 없이는 시작조차 못 한다.

여기서 무는 것은 통로의 **네 가지 성질**이다:
⑴ 아무것도 설정하지 않으면 **종전과 똑같이** 동작한다(하위호환 — 이게 깨지면 배포가 깨진다)
⑵ 용도별로 **따로** 라우팅된다(CO-B7: 저작=OSS · 런타임=Gemini)
⑶ **로컬 Ollama는 키가 없어도** 사용 가능이다(키 유무만 보면 로컬 경로가 영영 안 열린다)
⑷ 캐시가 스펙 변경을 **따라간다**(안 그러면 모델을 갈아끼워도 옛 클라이언트가 재사용된다)
"""
import pytest

from app import llm_provider as lp

PURPOSE_ENV = ("PROVIDER", "MODEL", "API_KEY", "BASE_URL")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """용도별·전역 오버라이드를 전부 지운 상태에서 시작한다.

    ⚠️ 환경 전역 상태를 단정하지 않는다(CLAUDE.md 규율) — 지우고 시작할 뿐,
    "원래 없었다"고 가정하지 않는다. 다른 개발자의 .env가 있어도 테스트가 흔들리지 않는다.
    """
    for purpose in lp.PURPOSES:
        for suffix in PURPOSE_ENV:
            monkeypatch.delenv(f"LLM_{purpose.upper()}_{suffix}", raising=False)
    for suffix in PURPOSE_ENV:
        monkeypatch.delenv(f"LLM_{suffix}", raising=False)
    lp._cached_model.cache_clear()


class TestBackwardCompat:
    def test_설정이_없으면_종전_Gemini_그대로(self):
        """이게 이 통로의 **첫 계약**이다.

        프로바이더 층을 넣으면서 기존 환경의 동작이 바뀌면, 배포된 서비스가
        조용히 다른 모델을 부르게 된다. 설정 0 = 변화 0이어야 한다.
        """
        for purpose in lp.PURPOSES:
            spec = lp.resolve_spec(purpose)
            assert spec.provider == lp.PROVIDER_GEMINI
            assert spec.base_url is None

    def test_기본_모델은_settings가_소유한다(self):
        """모델명 사본을 이 파일에 적지 않는다 — 적으면 그 순간 드리프트 후보가 된다."""
        from app.config import settings

        assert lp.resolve_spec(lp.PURPOSE_RUNTIME).model == settings.GEMINI_MODEL


class TestPurposeRouting:
    def test_용도별로_따로_간다(self, monkeypatch):
        """CO-B7의 핵심 결정 — *"라우팅은 단계가 아니라 용도로 가른다"*."""
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "openai/gpt-oss-120b")
        monkeypatch.setenv("LLM_AUTHOR_BASE_URL", "https://openrouter.ai/api/v1")
        monkeypatch.setenv("LLM_AUTHOR_API_KEY", "sk-test")

        author = lp.resolve_spec(lp.PURPOSE_AUTHOR)
        runtime = lp.resolve_spec(lp.PURPOSE_RUNTIME)

        assert author.provider == lp.PROVIDER_OPENAI
        assert author.model == "openai/gpt-oss-120b"
        # 런타임은 **건드려지지 않아야** 한다 — 저작만 OSS로 돌리는 것이 하이브리드의 전부다
        assert runtime.provider == lp.PROVIDER_GEMINI

    def test_전역_설정은_용도_설정이_없을_때만_쓰인다(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("LLM_MODEL", "global-model")
        monkeypatch.setenv("LLM_API_KEY", "sk-global")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "author-model")

        assert lp.resolve_spec(lp.PURPOSE_AUTHOR).model == "author-model"
        assert lp.resolve_spec(lp.PURPOSE_RUNTIME).model == "global-model"


class TestUsability:
    def test_로컬_Ollama는_키_없이도_사용가능(self, monkeypatch):
        """키 유무만 보면 **로컬 경로가 영영 안 열린다** — Ollama는 인증을 안 쓴다.

        이 통로를 만든 이유 중 하나가 "저작 배치를 로컬에서 $0으로"인데,
        그 경로가 막히면 통로의 절반이 죽는다.
        """
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "gpt-oss:20b")
        monkeypatch.setenv("LLM_AUTHOR_BASE_URL", "http://localhost:11434/v1")
        assert lp.spec_is_usable(lp.resolve_spec(lp.PURPOSE_AUTHOR)) is True

    def test_플레이스홀더_키는_없는_것과_같다(self, monkeypatch):
        """`.env.example`을 그대로 복사한 환경이 "키 있음"으로 판정되면 매 호출 401이다.

        Gemini 경로는 이미 그렇게 판정하는데(config._LLM_KEY_PLACEHOLDERS) OpenAI
        경로만 진리값을 보면 두 경로의 판정이 갈린다.
        """
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "openai/gpt-oss-120b")
        monkeypatch.setenv("LLM_AUTHOR_API_KEY", "your-key-here")
        assert lp.spec_is_usable(lp.resolve_spec(lp.PURPOSE_AUTHOR)) is False

    def test_모델명이_없으면_사용_불가(self, monkeypatch):
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_API_KEY", "sk-real-looking")
        assert lp.spec_is_usable(lp.resolve_spec(lp.PURPOSE_AUTHOR)) is False


class TestSecrecy:
    def test_로그_표기에_키가_없다(self, monkeypatch):
        """규정: **API 키 노출 = 실격**(HACKATHON_RULES). 진단 문자열에도 실리면 안 된다."""
        secret = "sk-super-secret-value-9876"
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "m")
        monkeypatch.setenv("LLM_AUTHOR_API_KEY", secret)
        redacted = lp.resolve_spec(lp.PURPOSE_AUTHOR).redacted()
        assert secret not in redacted
        assert "sk-" not in redacted


class TestCacheFollowsSpec:
    def test_모델을_바꾸면_다른_클라이언트가_온다(self, monkeypatch):
        """캐시가 스펙을 안 따라가면 **모델 교체가 조용히 무시된다.**

        종전 체인들이 캐시 키에 `GEMINI_*`만 실었기 때문에, 저작 용도를 OSS로
        돌려도 Gemini로 만든 체인이 그대로 재사용될 수 있었다. 3파전 시험 배치가
        "전부 같은 모델"로 돌아가면 판정 자체가 무의미해진다.
        """
        pytest.importorskip("langchain_openai")
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_BASE_URL", "http://localhost:11434/v1")

        monkeypatch.setenv("LLM_AUTHOR_MODEL", "gpt-oss:20b")
        first = lp.build_chat_model(0.7, lp.PURPOSE_AUTHOR)
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "gpt-oss:120b")
        second = lp.build_chat_model(0.7, lp.PURPOSE_AUTHOR)

        assert first is not second
        assert first.model_name != second.model_name

    def test_같은_스펙은_재사용된다(self, monkeypatch):
        """캐시가 아예 안 먹으면 호출마다 클라이언트를 새로 만든다(R7-02 S7 지연 회귀)."""
        pytest.importorskip("langchain_openai")
        monkeypatch.setenv("LLM_AUTHOR_PROVIDER", "openai")
        monkeypatch.setenv("LLM_AUTHOR_MODEL", "gpt-oss:20b")
        monkeypatch.setenv("LLM_AUTHOR_BASE_URL", "http://localhost:11434/v1")
        assert lp.build_chat_model(0.7, lp.PURPOSE_AUTHOR) is lp.build_chat_model(
            0.7, lp.PURPOSE_AUTHOR
        )


class TestChainsUseTheProvider:
    """체인이 프로바이더를 **직접** 만들면 이 통로가 우회된다 — 소스 계약으로 막는다."""

    def test_체인에_직접_Gemini_생성이_없다(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[1] / "app"
        offenders = []
        for path in (root / "chains").glob("*.py"):
            src = path.read_text(encoding="utf-8")
            # 주석·독스트링 밖에서 클래스를 실제로 호출하는가
            for line in src.splitlines():
                stripped = line.strip()
                if stripped.startswith("#") or stripped.startswith("*"):
                    continue
                if "ChatGoogleGenerativeAI(" in stripped or "ChatOpenAI(" in stripped:
                    offenders.append(f"{path.name}: {stripped[:70]}")
        assert not offenders, (
            "체인이 LLM 클라이언트를 직접 만든다 — llm_provider.build_chat_model을 쓸 것: "
            + " · ".join(offenders)
        )

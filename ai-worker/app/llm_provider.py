"""LLM 프로바이더 단일 통로 — Gemini · OpenAI 호환(gpt-oss·Ollama·OpenRouter…) (CO-B7).

**왜 만들었나**: 세 체인(`quiz_gen`·`validate`·`rag`)이 각자 `ChatGoogleGenerativeAI`를
직접 생성하고 있어서 **Gemini 말고는 부를 통로가 없었다.** 대장 `CO-B7`이 요구하는
"3파전 각 50건 시험 배치"는 그 통로가 없으면 시작조차 못 한다.

**설계 원칙 — 체인은 프로바이더를 몰라야 한다.**
체인은 `build_chat_model(temperature)` 하나만 부르고, 무엇이 오는지는 env가 정한다.
그래서 모델 교체가 **코드 변경이 아니라 설정 변경**이 된다(CO-B7: *"컨테이너 분리는
불필요 — 모델은 이미 설정값"*이라 적은 판단의 실현).

**용도별 라우팅**(CO-B7의 핵심 결정)도 여기서 지원한다:
> *"라우팅은 단계가 아니라 용도로 가른다 — G1 저작 1~5단계=OSS · 6단계=Gemini ·
>  런타임 전건=Gemini"*
`purpose`를 받아 그 용도의 오버라이드를 먼저 본다. 오버라이드가 없으면 기본 설정을
쓰므로, **아무것도 설정하지 않으면 종전과 완전히 같이 동작한다**(Gemini 단독).

⚠️ **키를 로그·예외에 싣지 않는다.** 대회 규정상 API 키 노출은 실격이다
(`HACKATHON_RULES`). 진단이 필요하면 길이·앞 4자만 남긴다.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

# ⚠️ **전부 최상위 import여야 한다.** author_items.py가 sys.modules 스왑으로
# ai-worker를 격리 임포트하는데(backend와 `app` 패키지명 공유), 함수 안에서 지연
# import하면 **스왑이 끝난 뒤** 실행돼 backend의 `app`을 뒤진다 —
# backend에는 `app/config.py`가 없고 `app/core/config.py`라 ModuleNotFoundError가 난다.
# 실제로 이 함정에 걸렸다(test_author_batch 5건).
from app.config import _LLM_KEY_PLACEHOLDERS, _env, llm_configured, settings

logger = logging.getLogger(__name__)

# 용도 — CO-B7의 라우팅 축. 단계가 아니라 **무엇에 쓰는가**로 가른다.
PURPOSE_AUTHOR = "author"      # G1 저작 배치(오프라인) — OSS 후보 구간
PURPOSE_VALIDATE = "validate"  # 2단 게이트
PURPOSE_RUNTIME = "runtime"    # 런타임 피드백 — 안정성이 걸려 유료 권장
PURPOSES = (PURPOSE_AUTHOR, PURPOSE_VALIDATE, PURPOSE_RUNTIME)

PROVIDER_GEMINI = "gemini"
PROVIDER_OPENAI = "openai"  # OpenAI 호환 전반: OpenRouter·Groq·Together·Ollama…


@dataclass(frozen=True)
class LlmSpec:
    """한 호출에 쓸 모델의 완전한 서술 — 이 값만으로 클라이언트를 만들 수 있다."""

    provider: str
    model: str
    api_key: str
    base_url: str | None = None

    def redacted(self) -> str:
        """로그용 — **키를 절대 넣지 않는다**(규정: 키 노출 = 실격)."""
        where = f" @{self.base_url}" if self.base_url else ""
        return f"{self.provider}:{self.model}{where}"


def _env_for(purpose: str, suffix: str) -> str:
    """용도별 오버라이드 → 전역 순으로 읽는다. 예: LLM_AUTHOR_MODEL → LLM_MODEL."""
    specific = _env(f"LLM_{purpose.upper()}_{suffix}", "")
    return specific or _env(f"LLM_{suffix}", "")


def resolve_spec(purpose: str = PURPOSE_RUNTIME) -> LlmSpec:
    """용도 → 실제로 쓸 모델. **설정이 없으면 종전 Gemini 그대로**(하위호환)."""
    provider = (_env_for(purpose, "PROVIDER") or PROVIDER_GEMINI).lower()
    model = _env_for(purpose, "MODEL")
    key = _env_for(purpose, "API_KEY")
    base = _env_for(purpose, "BASE_URL") or None

    if provider == PROVIDER_GEMINI:
        # 종전 경로 — GEMINI_* 를 그대로 쓴다. 아무 설정도 없던 환경이 안 깨진다.
        return LlmSpec(
            provider=PROVIDER_GEMINI,
            model=model or settings.GEMINI_MODEL,
            api_key=key or settings.GEMINI_API_KEY,
        )
    return LlmSpec(provider=PROVIDER_OPENAI, model=model, api_key=key, base_url=base)


def spec_is_usable(spec: LlmSpec) -> bool:
    """호출 가능한 설정인가 — 무키 폴백 분기가 이 값을 본다.

    ⚠️ 로컬 Ollama는 **키가 필요 없다**. 키 유무만 보면 로컬 경로가 영영 안 열린다.
    그래서 base_url이 있으면 키 없이도 사용 가능으로 본다(그쪽이 인증을 안 쓴다).
    """
    if spec.provider == PROVIDER_GEMINI:
        return llm_configured()
    if not spec.model:
        return False
    # 플레이스홀더 키는 **없는 것과 같다.** Gemini 쪽이 이미 그렇게 판정하는데
    # (config._LLM_KEY_PLACEHOLDERS) OpenAI 경로만 진리값을 보면, `.env.example`을
    # 그대로 복사한 환경이 "키 있음"으로 판정돼 매 호출 401을 맞는다.
    key = (spec.api_key or "").strip()
    if key and any(p in key for p in _LLM_KEY_PLACEHOLDERS):
        key = ""
    return bool(key) or bool(spec.base_url)


@lru_cache(maxsize=16)
def _cached_model(provider: str, model: str, api_key: str, base_url: str | None, temperature: float):
    """(스펙, 온도)별 클라이언트 캐시 — 호출마다 재생성하지 않는다(R7-02 S7 지연 완화)."""
    if provider == PROVIDER_GEMINI:
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=model, google_api_key=api_key, temperature=temperature
        )

    # OpenAI 호환 — OpenRouter·Groq·Together·vLLM·Ollama가 모두 이 규약을 따른다.
    # 그래서 프로바이더마다 클래스를 두지 않는다(base_url 하나로 갈린다).
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=model,
        api_key=api_key or "not-needed",  # 로컬 Ollama는 인증이 없다
        base_url=base_url,
        temperature=temperature,
    )


def build_chat_model(temperature: float, purpose: str = PURPOSE_RUNTIME):
    """체인이 부르는 유일한 진입점 — 무엇이 오는지는 env가 정한다."""
    spec = resolve_spec(purpose)
    return _cached_model(spec.provider, spec.model, spec.api_key, spec.base_url, temperature)

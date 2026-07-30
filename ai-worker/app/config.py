"""ai-worker 환경변수 설정.

05_env_deploy_spec.md 의 .env.example 항목 중 ai-worker가 사용하는 값만 노출한다.
pydantic-settings 의존성을 추가하지 않기 위해 os.environ 기반의 단순 설정 객체로 구현.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


@dataclass(frozen=True)
class Settings:
    # ── AI 모델 ──
    GEMINI_API_KEY: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    GEMINI_MODEL: str = field(
        default_factory=lambda: _env("GEMINI_MODEL", "gemini-3.1-flash-lite")
    )
    EMBEDDING_MODEL: str = field(
        default_factory=lambda: _env("EMBEDDING_MODEL", "text-embedding-3-small")
    )
    EMBEDDING_API_KEY: str = field(default_factory=lambda: _env("EMBEDDING_API_KEY"))

    # ── Chroma ──
    CHROMA_HOST: str = field(default_factory=lambda: _env("CHROMA_HOST", "chroma"))
    CHROMA_PORT: int = field(default_factory=lambda: int(_env("CHROMA_PORT", "8000")))

    # ── 내부 서비스 간 통신 ──
    AI_WORKER_INTERNAL_API_KEY: str = field(
        default_factory=lambda: _env("AI_WORKER_INTERNAL_API_KEY")
    )


settings = Settings()

# GEMINI 키가 이 부분 문자열을 포함하면 미발급 플레이스홀더로 간주한다
# (.env.example 의 "발급받은_키" 등). 키 없이 LLM 호출을 시도하면 실패 대기
# (호출당 수 초~수십 초)만 남기므로, 각 체인은 이 판정으로 시도 자체를 생략한다.
_LLM_KEY_PLACEHOLDERS = ("발급받은", "changeme", "your-", "placeholder")


def llm_configured() -> bool:
    """GEMINI_API_KEY가 실사용 가능한 형태면 True — 빈 값·플레이스홀더면 False."""
    value = (settings.GEMINI_API_KEY or "").strip()
    return bool(value) and not any(p in value for p in _LLM_KEY_PLACEHOLDERS)

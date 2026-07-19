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

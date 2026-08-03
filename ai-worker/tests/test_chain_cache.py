"""체인/클라이언트 캐시 회귀 테스트 (R7-02 S7 — RAG 피드백 지연 완화).

계약:
- 같은 settings로 재호출하면 LLM 체인/클라이언트/컬렉션 핸들이 재생성되지 않고
  동일 인스턴스가 반환된다 (호출당 생성 비용 제거).
- 캐시 키에 모델명·키가 포함되어 settings 변경 시에는 새 인스턴스가 생성된다.

의존성 정책(기존 suite 관례):
- validate_chain은 지연 임포트 설계이므로 langchain 부재 환경에서도 sys.modules
  스텁으로 캐시 계약을 항상 검증한다 (키 없는 CI에서도 실행).
- rag/quiz_gen/chroma 테스트는 해당 의존성이 설치된 환경에서만 실행
  (test_weatherbrain_endpoints.py와 동일하게 importorskip).
"""

from __future__ import annotations

import dataclasses
import sys
import types

import pytest

from app.chains import validate_chain  # 지연 임포트 설계 — 의존성 없이 임포트 가능


@pytest.fixture(autouse=True)
def _clear_caches():
    """모듈 전역 캐시를 테스트 전후로 비워 테스트 간 오염을 막는다."""

    def clear():
        validate_chain._llm_cache.clear()
        for module_name, attr in (
            ("app.chains.rag_chain", "_cached_chain"),
            ("app.chains.quiz_gen_chain", "_cached_chain"),
        ):
            module = sys.modules.get(module_name)
            if module is not None:
                getattr(module, attr).cache_clear()
        chroma = sys.modules.get("app.embeddings.chroma_client")
        if chroma is not None:
            chroma._collections.clear()

    clear()
    yield
    clear()


def _fake_llm_factory(created: list):
    """ChatGoogleGenerativeAI 대역 — 생성 횟수·인자를 기록한다."""

    def factory(**kwargs):
        created.append(kwargs)
        return object()

    return factory


def _stub_genai_module(monkeypatch, created: list) -> None:
    """langchain_google_genai를 sys.modules 스텁으로 대체 (부재 환경에서도 실행)."""
    stub = types.ModuleType("langchain_google_genai")
    stub.ChatGoogleGenerativeAI = _fake_llm_factory(created)
    monkeypatch.setitem(sys.modules, "langchain_google_genai", stub)


# ── validate_chain (지연 임포트 — 의존성 부재 환경에서도 항상 실행) ─────────
def test_validate_llm_reuses_instance_for_same_settings(monkeypatch):
    created: list = []
    _stub_genai_module(monkeypatch, created)

    first = validate_chain._cached_validate_llm(0.2)
    second = validate_chain._cached_validate_llm(0.2)

    assert first is second, "같은 설정·온도 재호출 시 동일 LLM 인스턴스여야 한다"
    assert len(created) == 1, "LLM 클라이언트는 1회만 생성되어야 한다"


def test_validate_llm_rebuilds_when_settings_change(monkeypatch):
    created: list = []
    _stub_genai_module(monkeypatch, created)

    first = validate_chain._cached_validate_llm(0.2)
    # Settings는 frozen dataclass — 모듈이 참조하는 settings 객체 자체를 교체
    monkeypatch.setattr(
        validate_chain,
        "settings",
        dataclasses.replace(validate_chain.settings, GEMINI_MODEL="gemini-other-model"),
    )
    second = validate_chain._cached_validate_llm(0.2)
    retry_temp = validate_chain._cached_validate_llm(0.0)

    assert first is not second, "모델명이 바뀌면 새 인스턴스여야 한다 (캐시 키에 모델명)"
    assert second is not retry_temp, "온도가 다르면 별도 인스턴스여야 한다 (temperature 계약)"
    assert created[1]["model"] == "gemini-other-model"


# ── rag_chain (langchain 설치 환경에서만) ──────────────────────────────────
def _import_rag_chain():
    pytest.importorskip("langchain_google_genai")
    pytest.importorskip("chromadb")  # rag_chain → chroma_client 경유 의존
    pytest.importorskip("langchain_openai")
    from app.chains import rag_chain

    return rag_chain


def test_rag_chain_reuses_instance_for_same_settings(monkeypatch):
    rag_chain = _import_rag_chain()
    rag_chain._cached_chain.cache_clear()
    created: list = []
    monkeypatch.setattr(rag_chain, "ChatGoogleGenerativeAI", _fake_runnable_factory(created))

    first = rag_chain._build_chain()
    second = rag_chain._build_chain()

    assert first is second, "같은 설정 재호출 시 동일 체인 인스턴스여야 한다"
    assert len(created) == 1


def test_rag_chain_rebuilds_when_model_changes(monkeypatch):
    rag_chain = _import_rag_chain()
    rag_chain._cached_chain.cache_clear()
    created: list = []
    monkeypatch.setattr(rag_chain, "ChatGoogleGenerativeAI", _fake_runnable_factory(created))

    first = rag_chain._build_chain()
    monkeypatch.setattr(
        rag_chain,
        "settings",
        dataclasses.replace(rag_chain.settings, GEMINI_MODEL="gemini-other-model"),
    )
    second = rag_chain._build_chain()

    assert first is not second, "모델명이 바뀌면 체인이 재생성되어야 한다"
    assert created[1]["model"] == "gemini-other-model"


def _fake_runnable_factory(created: list):
    """LCEL 파이프(|) 조립이 가능한 Runnable 대역."""
    from langchain_core.runnables import RunnableLambda

    def factory(**kwargs):
        created.append(kwargs)
        return RunnableLambda(lambda _: "ok")

    return factory


# ── quiz_gen_chain (langchain 설치 환경에서만) ─────────────────────────────
def test_quiz_gen_chain_caches_per_temperature(monkeypatch):
    pytest.importorskip("langchain_google_genai")
    from app.chains import quiz_gen_chain

    quiz_gen_chain._cached_chain.cache_clear()
    created: list = []
    # `quiz_gen_chain`은 langchain을 **함수 내부에서 지연 임포트**한다(2026-08-03,
    # validate_chain과 같은 규약 — 폴백 뱅크가 키·langchain 없이 도달해야 하므로).
    # 따라서 모듈 재노출 이름은 없다. 지연 임포트는 호출 시점에 원본 모듈의 속성을
    # 읽으므로 **의존 모듈 자체**를 patch해야 한다.
    import langchain_google_genai

    monkeypatch.setattr(
        langchain_google_genai,
        "ChatGoogleGenerativeAI",
        _fake_runnable_factory(created),
    )

    warm_1 = quiz_gen_chain._build_chain(0.7)
    warm_2 = quiz_gen_chain._build_chain(0.7)
    retry = quiz_gen_chain._build_chain(0.1)

    assert warm_1 is warm_2, "같은 온도 재호출 시 동일 체인 인스턴스여야 한다"
    assert warm_1 is not retry, "온도가 다르면 별도 체인이어야 한다"
    assert [c["temperature"] for c in created] == [0.7, 0.1]


# ── chroma_client 컬렉션 핸들 (chromadb 설치 환경에서만) ───────────────────
def test_chroma_collection_handle_cached(monkeypatch):
    pytest.importorskip("chromadb")
    pytest.importorskip("langchain_openai")
    from app.embeddings import chroma_client

    chroma_client._collections.clear()
    calls: list = []

    class FakeClient:
        def get_or_create_collection(self, name, metadata):
            calls.append((name, metadata))
            return object()

    monkeypatch.setattr(chroma_client, "get_chroma_client", lambda: FakeClient())

    first = chroma_client.get_collection(chroma_client.COLLECTION_CLIMATE_CONCEPTS)
    second = chroma_client.get_collection(chroma_client.COLLECTION_CLIMATE_CONCEPTS)
    other = chroma_client.get_collection(chroma_client.COLLECTION_WEATHER_DAILY)

    assert first is second, "같은 컬렉션 재조회 시 캐시된 핸들이어야 한다"
    assert first is not other
    assert len(calls) == 2, "get_or_create_collection HTTP 왕복은 컬렉션당 1회여야 한다"

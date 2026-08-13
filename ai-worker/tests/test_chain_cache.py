"""체인/클라이언트 캐시 회귀 테스트 (R7-02 S7 — RAG 피드백 지연 완화).

계약:
- 같은 settings로 재호출하면 LLM 체인/클라이언트/컬렉션 핸들이 재생성되지 않고
  동일 인스턴스가 반환된다 (호출당 생성 비용 제거).
- 캐시 키에 모델명·키가 포함되어 settings 변경 시에는 새 인스턴스가 생성된다.

⚠️ **이음매가 옮겨졌다**(2026-08-11, CO-B7 프로바이더 통로):
체인이 `ChatGoogleGenerativeAI`를 직접 만들지 않고 `llm_provider.build_chat_model`을
쓴다. 그래서 이 파일의 대역도 **모듈 속성 패치 → env·config 패치**로 옮겼다.
무는 성질은 그대로다 — "같은 설정은 재사용 · 설정이 바뀌면 새 인스턴스".
대역을 옛 자리에 두면 테스트가 **아무것도 안 무는 채로 초록**이 된다.

의존성 정책(기존 suite 관례):
- validate_chain은 지연 임포트 설계이므로 langchain 부재 환경에서도 sys.modules
  스텁으로 캐시 계약을 항상 검증한다 (키 없는 CI에서도 실행).
- rag/quiz_gen 테스트는 langchain이 설치된 환경에서만 실행
  (test_weatherbrain_endpoints.py와 동일하게 importorskip).
"""

from __future__ import annotations

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
    # 캐시 키는 이제 **해석된 스펙**이다(llm_provider.resolve_spec) — 모델 변경은
    # env 오버라이드로 준다. 이것이 실서비스에서 모델을 갈아끼우는 실제 경로다.
    monkeypatch.setenv("LLM_VALIDATE_MODEL", "gemini-other-model")
    second = validate_chain._cached_validate_llm(0.2)
    retry_temp = validate_chain._cached_validate_llm(0.0)

    assert first is not second, "모델명이 바뀌면 새 인스턴스여야 한다 (캐시 키에 모델명)"
    assert second is not retry_temp, "온도가 다르면 별도 인스턴스여야 한다 (temperature 계약)"
    assert created[1]["model"] == "gemini-other-model"


# ── rag_chain (langchain 설치 환경에서만) ──────────────────────────────────
def _import_rag_chain():
    pytest.importorskip("langchain_google_genai")
    from app.chains import rag_chain

    return rag_chain


def _stub_provider(monkeypatch, created: list, module=None):
    """LLM 생성부를 Runnable 대역으로 — 새 이음매.

    ⚠️ **체인 모듈의 바인딩**을 패치해야 한다(`llm_provider` 쪽이 아니라).
    체인이 `from app.llm_provider import build_chat_model`로 가져오므로 이름이
    임포트 시점에 **고정**된다 — 원본 모듈을 패치하면 체인은 옛 함수를 계속 쓴다
    (실측: 실제 Gemini 클라이언트가 만들어져 자격증명 오류가 났다).
    """
    from app import llm_provider
    from app.chains import rag_chain as _rag

    target = module or _rag
    factory = _fake_runnable_factory(created)
    monkeypatch.setattr(
        target,
        "build_chat_model",
        lambda temperature, purpose=llm_provider.PURPOSE_RUNTIME: factory(
            model=llm_provider.resolve_spec(purpose).model, temperature=temperature
        ),
    )


def test_rag_chain_reuses_instance_for_same_settings(monkeypatch):
    rag_chain = _import_rag_chain()
    rag_chain._cached_chain.cache_clear()
    created: list = []
    _stub_provider(monkeypatch, created)

    first = rag_chain._build_chain()
    second = rag_chain._build_chain()

    assert first is second, "같은 설정 재호출 시 동일 체인 인스턴스여야 한다"
    assert len(created) == 1


def _serving_live(monkeypatch):
    """런타임 체인을 **실제로 쓰는** 상태로 둔다 (2026-08-12).

    ⚠️ 이게 없으면 아래 캐시 계약이 항상 초록으로 통과한다 — 서빙 모드 기본이
    `dummy`라 런타임 실효 스펙이 **빈 스펙 하나로 수렴**하고, 모델을 무엇으로
    바꿔도 키가 같아지기 때문이다(그 상태에서는 체인을 애초에 안 부르므로 무해하지만,
    "모델 교체가 반영되는가"라는 이 테스트의 질문은 그때 검사되지 않는다).
    """
    from app import llm_budget

    monkeypatch.setenv("LLM_SERVING_MODE", llm_budget.MODE_LIVE)
    monkeypatch.setattr(
        llm_budget, "state",
        lambda: llm_budget.BudgetState(0.0, 0.0, 5.0, 1.0, True, "여유"),
    )


def test_rag_chain_rebuilds_when_model_changes(monkeypatch):
    rag_chain = _import_rag_chain()
    rag_chain._cached_chain.cache_clear()
    created: list = []
    _stub_provider(monkeypatch, created)
    _serving_live(monkeypatch)

    first = rag_chain._build_chain()
    monkeypatch.setenv("LLM_RUNTIME_MODEL", "gemini-other-model")
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


# ── 프롬프트 변형별 체인 캐시 (R13 3일차) ─────────────────────────────────
def test_rag_chain_caches_per_prompt_variant(monkeypatch):
    """개념 문서 유무로 프롬프트가 갈리므로 캐시 키에 그 축이 들어가야 한다.

    들어가지 않으면 먼저 호출된 변형의 체인이 재사용돼, 개념 문서가 없는 문항에
    `{concept_documents}` 자리를 가진 프롬프트가 그대로 나가 KeyError로 폴백한다.
    """
    rag_chain = _import_rag_chain()
    rag_chain._cached_chain.cache_clear()
    created: list = []
    _stub_provider(monkeypatch, created)

    with_ctx = rag_chain._build_chain(True)
    without_ctx = rag_chain._build_chain(False)

    assert with_ctx is not without_ctx, "프롬프트 변형이 다르면 별도 체인이어야 한다"
    assert with_ctx is rag_chain._build_chain(True), "같은 변형은 캐시 재사용"

"""개념 직접 조회 계약 — R13 3일차(벡터 검색 철거) 이후의 피드백 컨텍스트.

## 무엇을 지키는가

1. **조회는 색인이지 검색이 아니다.** `concept_tag`가 주면 그 태그의 문서 전부가
   나와야 한다 — 유사도·임계·top_k가 개입할 자리가 없다.
2. **없는 것은 없다고 프롬프트에서 사라진다.** 본시드에는 개념 문서가 없는 태그가
   실제로 있다(`flood_response`·`wildfire_weather` — 237문항 중 15건). 이때
   `"(검색된 참고 지식 없음)"` 같은 빈 블록을 넣으면 프롬프트가
   "제공된 참고 지식에 있는 사실만 사용, 지어내지 말 것"이라고 말하면서 그 지식을
   주지 않는 자기모순이 된다. 철거 전 무키 환경이 정확히 그 상태였다.
3. **관련도 점수는 포맷에서 사라졌다.** 유사도가 없으므로 가리킬 수치가 없다.

## 왜 langchain 없이도 도는가

조회·포맷은 stdlib(+`chains.seed_paths`)만 쓴다. 그런데 `rag_chain` 모듈 자체는
최상단에서 langchain을 import하므로 여기서는 `importorskip`을 건다 — 대신 조회
로직만 검증하는 부분은 `seed_paths`·시드 파일로 langchain 없이 확인 가능하고,
그 경계를 `test_시드_파일은_langchain_없이_읽힌다`가 지킨다.

실행: `cd ai-worker && python -m pytest tests -q`.
"""

from __future__ import annotations

import json

import pytest

from app.chains.seed_paths import resolve_seed_path

CONCEPTS_FILENAME = "climate_concepts.json"
CONCEPTS_PATH_ENV = "CLIMATE_CONCEPTS_PATH"


@pytest.fixture(scope="module")
def seed_chunks() -> list[dict]:
    path = resolve_seed_path(CONCEPTS_FILENAME, CONCEPTS_PATH_ENV)
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture()
def rag_chain():
    pytest.importorskip("langchain_google_genai")
    from app.chains import rag_chain as module

    module._concepts_by_tag.cache_clear()
    yield module
    module._concepts_by_tag.cache_clear()


class TestSeedPathResolution:
    def test_시드_파일은_langchain_없이_읽힌다(self, seed_chunks):
        """무키·무의존 경로에서도 개념 문서에 도달할 수 있어야 한다."""
        assert seed_chunks and isinstance(seed_chunks, list)
        for chunk in seed_chunks:
            assert chunk["concept_tag"] and chunk["text"]

    def test_env_탈출구가_존재하고_없는_경로는_예외다(self, monkeypatch, tmp_path):
        """조용히 폴백하면 컨테이너 마운트 누락이 런타임까지 숨는다."""
        monkeypatch.setenv(CONCEPTS_PATH_ENV, str(tmp_path / "nope.json"))
        with pytest.raises(FileNotFoundError):
            resolve_seed_path(CONCEPTS_FILENAME, CONCEPTS_PATH_ENV)

        real = tmp_path / "real.json"
        real.write_text("[]", encoding="utf-8")
        monkeypatch.setenv(CONCEPTS_PATH_ENV, str(real))
        assert resolve_seed_path(CONCEPTS_FILENAME, CONCEPTS_PATH_ENV) == real


class TestLookup:
    def test_태그의_문서를_전부_돌려준다(self, rag_chain, seed_chunks):
        expected = [c["text"] for c in seed_chunks if c["concept_tag"] == "typhoon"]
        got = [d["text"] for d in rag_chain.lookup_concept_documents("typhoon")]
        assert got == expected, "top_k 절단 없이 그 개념의 정본 전체가 들어가야 한다"

    def test_모든_시드_태그가_조회된다(self, rag_chain, seed_chunks):
        for tag in {c["concept_tag"] for c in seed_chunks}:
            assert rag_chain.lookup_concept_documents(tag), f"{tag} 조회 실패"

    def test_없는_태그는_빈_리스트(self, rag_chain):
        assert rag_chain.lookup_concept_documents("no_such_concept") == []

    def test_반환값을_바꿔도_색인이_오염되지_않는다(self, rag_chain):
        first = rag_chain.lookup_concept_documents("typhoon")
        first.clear()
        assert rag_chain.lookup_concept_documents("typhoon"), "캐시된 색인이 훼손됐다"

    def test_파일을_못_읽어도_예외가_새지_않는다(self, rag_chain, monkeypatch, tmp_path):
        monkeypatch.setenv(CONCEPTS_PATH_ENV, str(tmp_path / "missing.json"))
        rag_chain._concepts_by_tag.cache_clear()
        assert rag_chain.lookup_concept_documents("typhoon") == []


class TestContextFormat:
    def test_관련도_점수가_남아_있지_않다(self, rag_chain):
        block = rag_chain._format_context(
            rag_chain.lookup_concept_documents("pressure_front")
        )
        assert "관련도" not in block, "유사도가 없는데 점수를 적으면 없는 수치를 지어낸다"
        assert "[참고 지식 1]" in block
        assert "개념: pressure_front" in block

    def test_문서가_없으면_빈_블록이_아니라_프롬프트_변형이다(self, rag_chain):
        """자기모순 재발 방지 — 이 두 줄이 함께 사라져야 한다."""
        no_ctx = rag_chain.SYSTEM_PROMPT_NO_CONTEXT
        assert "{concept_documents}" not in no_ctx
        assert "참고 지식(context)에 있는 사실만 사용" not in no_ctx
        assert "{concept_documents}" in rag_chain.SYSTEM_PROMPT

    def test_검색_시절_문구가_되살아나지_않았다(self, rag_chain):
        source = rag_chain.SYSTEM_PROMPT + rag_chain.SYSTEM_PROMPT_NO_CONTEXT
        assert "검색된 참고 지식 없음" not in source

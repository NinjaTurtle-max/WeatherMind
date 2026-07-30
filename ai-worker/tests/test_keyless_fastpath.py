"""키 미설정 시 LLM 시도 생략(즉시 폴백) 계약 — R8 핫픽스.

배경: GEMINI 키가 비어 있거나 플레이스홀더인데도 체인이 LLM 호출을 시도해
호출당 수 초~수십 초 실패 대기 후에야 폴백으로 떨어졌다(세션 발급 14s·채점
21s 실측). llm_configured()가 False면 시도 자체를 생략해야 한다.

langchain 미설치 환경에서도 config 계약은 항상 검증한다
(체인 경로 테스트만 importorskip).
"""

import dataclasses

import pytest

from app import config as config_module
from app.config import Settings, llm_configured


def _with_key(monkeypatch, value: str) -> None:
    monkeypatch.setattr(
        config_module, "settings",
        dataclasses.replace(config_module.settings, GEMINI_API_KEY=value),
    )


class TestLlmConfigured:
    def test_빈_키는_False(self, monkeypatch):
        _with_key(monkeypatch, "")
        assert llm_configured() is False

    def test_공백만_있는_키는_False(self, monkeypatch):
        _with_key(monkeypatch, "   ")
        assert llm_configured() is False

    @pytest.mark.parametrize(
        "placeholder",
        ["발급받은_키", "changeme-secret", "your-api-key", "placeholder"],
    )
    def test_플레이스홀더는_False(self, monkeypatch, placeholder):
        _with_key(monkeypatch, placeholder)
        assert llm_configured() is False

    def test_실키_형태는_True(self, monkeypatch):
        _with_key(monkeypatch, "AIzaSyDUMMY-real-looking-key")
        assert llm_configured() is True

    def test_기본_Settings는_env_미설정이면_False(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setattr(config_module, "settings", Settings())
        assert llm_configured() is False


class TestKeylessChainSkip:
    """키 미설정 시 체인이 LLM 빌더를 아예 호출하지 않는다."""

    def test_generate_quiz는_LLM_시도_없이_폴백(self, monkeypatch):
        pytest.importorskip("langchain_google_genai")
        from app.chains import quiz_gen_chain

        _with_key(monkeypatch, "")
        monkeypatch.setattr(
            quiz_gen_chain, "_build_chain",
            lambda *_: pytest.fail("키 미설정인데 LLM 체인을 호출했다"),
        )
        result = quiz_gen_chain.generate_quiz({}, "middle_high", "general", "typhoon")
        assert result["concept_tag"] == "typhoon"
        assert result["question_text"]

    def test_generate_feedback은_검색과_LLM을_생략(self, monkeypatch):
        pytest.importorskip("langchain_google_genai")
        from app.chains import rag_chain

        _with_key(monkeypatch, "")
        monkeypatch.setattr(
            rag_chain, "_retrieve_chunks",
            lambda *_: pytest.fail("키 미설정인데 Chroma 검색을 호출했다"),
        )
        fb_ok = rag_chain.generate_feedback("q", "a", True, "typhoon")
        fb_no = rag_chain.generate_feedback("q", "a", False, "typhoon")
        assert fb_ok == rag_chain.DEFAULT_FEEDBACK_CORRECT
        assert fb_no == rag_chain.DEFAULT_FEEDBACK_INCORRECT

    def test_run_llm_checks는_즉시_예외로_llm_skipped_유도(self, monkeypatch):
        from app.chains import validate_chain

        _with_key(monkeypatch, "")
        with pytest.raises(RuntimeError):
            validate_chain.run_llm_checks(
                {"question_type": "multiple_choice"}, "typhoon", "middle_high"
            )

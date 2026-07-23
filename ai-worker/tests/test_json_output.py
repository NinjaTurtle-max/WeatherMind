"""LLM JSON 출력 공용 파서 테스트 (R5.5 — json_output.extract_json_object).

quiz_gen_chain._parse_output과 validate_chain._parse_llm_output이 공유하는
전처리 계약(코드펜스 제거 + 첫 '{'~마지막 '}' 슬라이스)을 고정한다. LLM 키 불필요.

실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""
from __future__ import annotations

import json

import pytest

from app.chains.json_output import extract_json_object


class TestExtractJsonObject:
    def test_평문_JSON(self):
        assert extract_json_object('{"a": 1}') == {"a": 1}

    def test_json_코드펜스_제거(self):
        raw = '```json\n{"a": 1, "b": [2, 3]}\n```'
        assert extract_json_object(raw) == {"a": 1, "b": [2, 3]}

    def test_무언어_코드펜스_제거(self):
        assert extract_json_object('```\n{"a": 1}\n```') == {"a": 1}

    def test_앞뒤_설명텍스트_슬라이스(self):
        raw = '다음은 결과입니다: {"a": 1} — 이상입니다.'
        assert extract_json_object(raw) == {"a": 1}

    def test_공백_트림(self):
        assert extract_json_object('   \n {"a": 1}  \n ') == {"a": 1}

    def test_유효_JSON_없으면_예외(self):
        with pytest.raises(json.JSONDecodeError):
            extract_json_object("no json here")

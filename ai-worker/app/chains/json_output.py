"""LLM JSON 출력 파싱 공용 헬퍼 (R5.5 — quiz_gen/validate 중복 제거).

Gemini 등 모델은 JSON을 마크다운 코드펜스로 감싸거나 앞뒤에 설명 텍스트를 붙여
반환하곤 한다. quiz_gen_chain._parse_output과 validate_chain._parse_llm_output이
동일한 전처리(펜스 제거 + 첫 '{'~마지막 '}' 구간 슬라이스)를 각자 재기술하고 있었다
(validate 주석도 "quiz_gen_chain 관례"라 인정). 여기로 단일화한다.

Pydantic 모델 바인딩은 호출측이 다르므로(QuizQuestion vs LLMValidationResult)
공용부는 dict 반환까지만 담당한다.
"""
from __future__ import annotations

import json
import re

# 줄 시작의 ```/```json 여는 펜스와 줄 끝의 닫는 펜스를 제거.
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def extract_json_object(raw: str) -> dict:
    """모델 출력 문자열에서 JSON 객체를 추출해 dict로 반환한다.

    - 마크다운 코드펜스(```json ... ```)를 제거한다.
    - 앞뒤 설명 텍스트가 섞이면 첫 '{' ~ 마지막 '}' 구간만 사용한다.

    Raises:
        json.JSONDecodeError: 유효한 JSON 객체를 찾지 못한 경우.
    """
    text = _FENCE_RE.sub("", raw.strip()).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)

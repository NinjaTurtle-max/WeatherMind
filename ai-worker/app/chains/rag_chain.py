"""RAG Chain — 03_ai_chains_spec.md 섹션 3.

단계:
1. 쿼리 문자열 구성: f"{concept_tag} {question_text}"
2. Chroma climate_concepts + weather_daily 컬렉션에서 top_k=3, threshold=0.7 검색
3. 검색 결과 없으면 (threshold 미달) → climate_concepts만 재검색 (fallback)
4. System Prompt(스펙 원문)로 Gemini 호출 → 순수 텍스트(피드백 문자열) 반환

Context Injection 포맷은 03번 스펙 섹션 4를 따른다.
Chroma / Gemini 장애 시 기본 격려 피드백으로 폴백한다.
"""

from __future__ import annotations

import json
import logging

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI

from app.config import settings
from app.embeddings.chroma_client import (
    COLLECTION_CLIMATE_CONCEPTS,
    COLLECTION_WEATHER_DAILY,
    query_collection,
)

logger = logging.getLogger(__name__)

TOP_K = 3
RELEVANCE_THRESHOLD = 0.7

# ── System Prompt (03번 스펙 원문 그대로) ──────────────────────────────────
SYSTEM_PROMPT = """당신은 기상교육 전문 AI입니다. 학습자가 방금 푼 문제에 대해 피드백을 작성하세요.

원칙:
- 정답 여부와 무관하게 격려하는 톤 유지
- 아래 제공된 참고 지식(context)에 있는 사실만 사용, 지어내지 말 것
- 3~4문장, 초등학생도 이해할 수 있는 문장 길이
- 마지막 문장은 오늘 실제 날씨와 연결지어 설명

입력:
- 문제: {question_text}
- 학습자 답: {user_answer}
- 정답 여부: {is_correct}
- 참고 지식(context): {retrieved_chunks}
- 오늘 실제 기상 데이터: {today_weather_json}"""

# Chroma·Gemini 장애 시 기본 격려 피드백
DEFAULT_FEEDBACK_CORRECT = (
    "정답이에요, 정말 잘했어요! 문제를 차근차근 읽고 답을 찾아낸 점이 훌륭해요. "
    "오늘 배운 개념을 실제 하늘을 보면서 한 번 더 떠올려 보세요. "
    "내일도 오늘의 날씨 퀴즈로 만나요!"
)
DEFAULT_FEEDBACK_INCORRECT = (
    "아쉽지만 괜찮아요, 틀리면서 배우는 게 진짜 공부예요! "
    "정답 해설을 다시 읽어 보면 금방 이해할 수 있을 거예요. "
    "오늘 바깥 날씨를 관찰하면서 배운 개념을 한 번 더 떠올려 보세요. "
    "내일 퀴즈에서는 분명 더 잘할 수 있을 거예요!"
)


def _retrieve_chunks(concept_tag: str, question_text: str) -> list[dict]:
    """Chroma 2개 컬렉션 검색 → threshold 미달 시 climate_concepts만 재검색."""
    query = f"{concept_tag} {question_text}"

    hits: list[dict] = []
    for collection in (COLLECTION_CLIMATE_CONCEPTS, COLLECTION_WEATHER_DAILY):
        try:
            hits.extend(query_collection(collection, query, top_k=TOP_K))
        except Exception as exc:
            logger.warning("chroma query failed on %s: %s", collection, exc)

    passed = [h for h in hits if h["relevance"] >= RELEVANCE_THRESHOLD]
    passed.sort(key=lambda h: h["relevance"], reverse=True)
    if passed:
        return passed[:TOP_K]

    # threshold 미달 → climate_concepts만 재검색 (fallback)
    try:
        fallback_hits = query_collection(COLLECTION_CLIMATE_CONCEPTS, query, top_k=TOP_K)
    except Exception as exc:
        logger.warning("chroma fallback query failed: %s", exc)
        return []
    fallback_hits.sort(key=lambda h: h["relevance"], reverse=True)
    return fallback_hits[:TOP_K]


def _format_context(chunks: list[dict]) -> str:
    """Context Injection 포맷 (03번 스펙 섹션 4)."""
    if not chunks:
        return "(검색된 참고 지식 없음)"
    blocks = []
    for i, chunk in enumerate(chunks, start=1):
        blocks.append(
            f"[참고 지식 {i}] (출처: {chunk['source']}, 관련도 {chunk['relevance']:.2f})\n"
            f"{chunk['text']}"
        )
    return "\n\n".join(blocks)


def _build_chain():
    """LCEL: 프롬프트 → Gemini → 순수 텍스트."""
    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM_PROMPT)])
    llm = ChatGoogleGenerativeAI(
        model=settings.GEMINI_MODEL,
        google_api_key=settings.GEMINI_API_KEY,
        temperature=0.5,
    )
    return prompt | llm | StrOutputParser()


def generate_feedback(
    question_text: str,
    user_answer: str | None,
    is_correct: bool,
    concept_tag: str,
    today_weather: dict | None = None,
) -> str:
    """문제 풀이 직후 학습자에게 줄 피드백(순수 텍스트)을 생성한다."""
    chunks = _retrieve_chunks(concept_tag, question_text)

    try:
        feedback = _build_chain().invoke(
            {
                "question_text": question_text,
                "user_answer": user_answer if user_answer is not None else "(무응답)",
                "is_correct": "정답" if is_correct else "오답",
                "retrieved_chunks": _format_context(chunks),
                "today_weather_json": json.dumps(
                    today_weather or {}, ensure_ascii=False
                ),
            }
        )
        feedback = feedback.strip()
        if feedback:
            return feedback
        raise ValueError("empty feedback from LLM")
    except Exception as exc:
        logger.warning("rag feedback generation failed, using default: %s", exc)
        return DEFAULT_FEEDBACK_CORRECT if is_correct else DEFAULT_FEEDBACK_INCORRECT

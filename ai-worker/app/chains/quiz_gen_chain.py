"""Quiz Gen Chain — 03_ai_chains_spec.md 섹션 2.

System Prompt / Few-shot 3개는 스펙 원문 그대로 사용한다 (한 글자도 수정 금지).
LCEL 스타일: build_messages | ChatGoogleGenerativeAI | StrOutputParser
Output Parser: json.loads() + Pydantic 검증 실패 시 temperature 낮춰 1회 재시도,
2회 연속 실패 시 사전 정의된 fallback 문제 세트에서 랜덤 선택.
"""

from __future__ import annotations

import json
import logging
import random
import threading
from datetime import date
from functools import lru_cache
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser

from app.chains.json_output import extract_json_object
from langchain_core.runnables import RunnableLambda
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field, model_validator

from app.config import llm_configured, settings

logger = logging.getLogger(__name__)

# ── System Prompt (03번 스펙 원문 그대로) ──────────────────────────────────
SYSTEM_PROMPT = """당신은 대한민국 초·중·고등학생과 일반 성인을 위한 기상·기후 교육 전문 AI입니다.
아래 실시간 기상 데이터를 바탕으로 학습자 수준에 맞는 퀴즈 1문항을 생성하세요.

규칙:
1. 반드시 제공된 실제 기상 데이터의 수치를 문제에 반영할 것 (허구 데이터 금지)
2. level_group이 "elementary"면 초등학생 눈높이 쉬운 용어, "middle_high"면 중학교 2학년
   과학 교과과정 용어, "adult"면 기상청 전문 용어 일부 허용
3. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.

출력 스키마:
{
  "concept_tag": "<기압|전선|태풍|기단|대기순환|열섬효과|CO2|이상기후 중 하나의 영문 슬러그>",
  "question_type": "multiple_choice" | "short_answer" | "slider",
  "question_text": "<질문>",
  "options": ["<선택지1>", ...] (multiple_choice일 때만),
  "correct_answer": "<정답>"
}"""

# ── Few-shot 예시 3개 (03번 스펙 원문 그대로, 프롬프트에 삽입) ─────────────
FEW_SHOT_EXAMPLES = """[예시 1 - elementary, multiple_choice]
입력 데이터: {"region":"서울","temp_max":32,"humidity":75}
출력: {"concept_tag":"heat_island","question_type":"multiple_choice",
"question_text":"오늘처럼 도시가 더 더운 이유는 무엇일까요?",
"options":["아스팔트가 열을 저장해서","바다가 가까워서","나무가 많아서","비가 와서"],
"correct_answer":"아스팔트가 열을 저장해서"}

[예시 2 - middle_high, short_answer]
입력 데이터: {"region":"강릉","pressure":1008,"wind_speed":12}
출력: {"concept_tag":"pressure_front","question_type":"short_answer",
"question_text":"기압이 1008hPa로 낮고 풍속이 강한 오늘, 강릉에 통과 중인 기상 현상은?",
"correct_answer":"저기압(전선)"}

[예시 3 - adult, slider]
입력 데이터: {"region":"전국","co2_context":true}
출력: {"concept_tag":"co2_climate","question_type":"slider",
"question_text":"산업화 이전 대비 현재 대기 중 CO2 농도 증가율을 추정해 슬라이더로 표시하세요 (0~100%)",
"correct_answer":"50"}"""


# ── 출력 스키마 (Pydantic 검증) ────────────────────────────────────────────
class QuizQuestion(BaseModel):
    concept_tag: str = Field(min_length=1)
    question_type: Literal["multiple_choice", "short_answer", "slider"]
    question_text: str = Field(min_length=1)
    options: Optional[list[str]] = None
    correct_answer: str = Field(min_length=1)

    @model_validator(mode="after")
    def _check_options(self) -> "QuizQuestion":
        if self.question_type == "multiple_choice" and not self.options:
            raise ValueError("multiple_choice 문제는 options가 필수입니다")
        return self


# ── quiz_id: 날짜 + 시퀀스 (예: 20260705-001) ─────────────────────────────
_seq_lock = threading.Lock()
_seq_date: str | None = None
_seq_counter: int = 0


def next_quiz_id(today: date | None = None) -> str:
    global _seq_date, _seq_counter
    date_str = (today or date.today()).strftime("%Y%m%d")
    with _seq_lock:
        if _seq_date != date_str:
            _seq_date = date_str
            _seq_counter = 0
        _seq_counter += 1
        return f"{date_str}-{_seq_counter:03d}"


# ── Fallback 문제 세트 (concept_tag 6종 각 1문제 이상) ─────────────────────
FALLBACK_QUESTIONS: list[dict] = [
    {
        "concept_tag": "pressure_front",
        "question_type": "multiple_choice",
        "question_text": "저기압이 다가올 때 일반적으로 나타나는 날씨는 무엇일까요?",
        "options": ["맑고 건조하다", "흐리고 비가 오기 쉽다", "기온이 급격히 떨어진다", "바람이 전혀 불지 않는다"],
        "correct_answer": "흐리고 비가 오기 쉽다",
    },
    {
        "concept_tag": "pressure_front",
        "question_type": "short_answer",
        "question_text": "찬 공기가 따뜻한 공기를 파고들며 좁은 지역에 강한 비를 내리는 전선의 이름은?",
        "correct_answer": "한랭전선",
    },
    {
        "concept_tag": "typhoon",
        "question_type": "multiple_choice",
        "question_text": "태풍이 에너지를 얻는 주된 원천은 무엇일까요?",
        "options": ["따뜻한 바닷물의 수증기", "차가운 육지의 바람", "높은 산의 눈", "사막의 모래바람"],
        "correct_answer": "따뜻한 바닷물의 수증기",
    },
    {
        "concept_tag": "air_mass",
        "question_type": "multiple_choice",
        "question_text": "우리나라 여름철에 덥고 습한 날씨를 가져오는 기단은 무엇일까요?",
        "options": ["시베리아 기단", "북태평양 기단", "오호츠크해 기단", "양쯔강 기단"],
        "correct_answer": "북태평양 기단",
    },
    {
        "concept_tag": "heat_island",
        "question_type": "multiple_choice",
        "question_text": "도시가 주변 시골보다 더 더운 열섬 현상의 주요 원인은 무엇일까요?",
        "options": ["아스팔트와 콘크리트가 열을 저장해서", "도시에 비가 더 많이 와서", "도시가 바다와 가까워서", "도시의 나무가 더 많아서"],
        "correct_answer": "아스팔트와 콘크리트가 열을 저장해서",
    },
    {
        "concept_tag": "co2_climate",
        "question_type": "short_answer",
        "question_text": "화석연료를 태울 때 나와서 지구의 기온을 높이는 대표적인 온실가스는 무엇일까요?",
        "correct_answer": "이산화탄소(CO2)",
    },
    {
        "concept_tag": "anomaly",
        "question_type": "multiple_choice",
        "question_text": "지구 온난화로 인해 더 자주 나타날 것으로 예상되는 현상은 무엇일까요?",
        "options": ["폭염과 집중호우 같은 극한 날씨", "사계절이 없어지는 것", "달의 크기 변화", "지진의 감소"],
        "correct_answer": "폭염과 집중호우 같은 극한 날씨",
    },
]


# ── LLM 호출 ───────────────────────────────────────────────────────────────
def _build_messages(inputs: dict) -> list:
    """system prompt + few-shot + 이번 입력 데이터를 메시지로 구성한다."""
    input_data = {
        "weather_data": inputs["weather_data"],
        "level_group": inputs["level_group"],
        "route": inputs.get("route", "general"),
        "target_concept_tag": inputs.get("target_concept_tag"),
    }
    human_text = (
        f"{FEW_SHOT_EXAMPLES}\n\n"
        f"입력 데이터: {json.dumps(input_data, ensure_ascii=False)}\n"
        f"출력:"
    )
    return [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=human_text)]


@lru_cache(maxsize=8)
def _cached_chain(model: str, api_key: str, temperature: float):
    """(model, api_key, temperature) 조합별 LCEL 체인 캐시.

    시도 온도는 (0.7, 0.1) 2종뿐이므로 문항 생성마다 ChatGoogleGenerativeAI를
    재생성하지 않는다(R7-02 S7 지연 완화). 생성 실패 예외는 캐시되지 않아
    폴백 문제 세트 동작은 기존과 동일하다.
    """
    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=temperature,
    )
    return RunnableLambda(_build_messages) | llm | StrOutputParser()


def _build_chain(temperature: float):
    """LCEL: 메시지 구성 → Gemini → 문자열 (settings 기준 캐시 조회)."""
    return _cached_chain(settings.GEMINI_MODEL, settings.GEMINI_API_KEY, temperature)


def _parse_output(raw: str) -> QuizQuestion:
    """모델 출력에서 JSON을 추출해 Pydantic으로 검증한다."""
    return QuizQuestion(**extract_json_object(raw))


def _fallback_question(target_concept_tag: str | None = None) -> QuizQuestion:
    pool = FALLBACK_QUESTIONS
    if target_concept_tag:
        matched = [q for q in pool if q["concept_tag"] == target_concept_tag]
        if matched:
            pool = matched
    return QuizQuestion(**random.choice(pool))


def generate_quiz(
    weather_data: dict,
    level_group: str,
    route: str = "general",
    target_concept_tag: str | None = None,
) -> dict:
    """퀴즈 1문항을 생성해 quiz_id가 포함된 dict를 반환한다.

    1차 시도(temperature 0.7) → 파싱/검증 실패 시 temperature 0.1로 1회 재시도
    → 2회 연속 실패 시 fallback 문제 세트에서 랜덤 선택.
    """
    inputs = {
        "weather_data": weather_data,
        "level_group": level_group,
        "route": route,
        "target_concept_tag": target_concept_tag,
    }

    question: QuizQuestion | None = None
    if not llm_configured():
        # 키 미설정 시 LLM 시도 자체를 생략 — 실패 대기 없이 즉시 폴백 뱅크.
        logger.info("GEMINI 키 미설정 — LLM 생성 생략, 폴백 뱅크 사용")
    else:
        for attempt, temperature in enumerate((0.7, 0.1), start=1):
            try:
                raw = _build_chain(temperature).invoke(inputs)
                question = _parse_output(raw)
                break
            except Exception as exc:  # LLM 장애, JSON 파싱, Pydantic 검증 실패 모두 포함
                logger.warning("quiz generation attempt %d failed: %s", attempt, exc)

    if question is None:
        logger.warning("falling back to predefined quiz set")
        question = _fallback_question(target_concept_tag)

    payload = question.model_dump()
    if payload.get("options") is None:
        payload.pop("options", None)
    payload["quiz_id"] = next_quiz_id()
    return payload

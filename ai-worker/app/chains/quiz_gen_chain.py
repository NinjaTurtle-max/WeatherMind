"""Quiz Gen Chain — 03_ai_chains_spec.md 섹션 2.

System Prompt / Few-shot 3개는 스펙 원문 그대로 사용한다 (한 글자도 수정 금지).
LCEL 스타일: build_messages | ChatGoogleGenerativeAI | StrOutputParser
주의: LLM 관련 임포트(langchain*)는 실제로 LLM을 쓰는 함수 내부에서 지연 임포트한다
(validate_chain과 같은 규약). 키가 없으면 generate_quiz는 LLM 경로에 들어가지도
않으므로, 폴백 뱅크는 langchain 없이 도달해야 한다 — CLAUDE.md가 "키 없어도 폴백
문항 뱅크로 전 기능 동작"을 계약으로 두기 때문이다.
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


from app.chains.json_output import extract_json_object

# 생성 문항 payload 계약(계약 G)은 langchain 없이도 읽혀야 하므로 별도 모듈이 소유한다
# (payload_contract 모듈 독스트링 참조). 여기서는 재노출만 한다 — 계약을 이 파일에
# 다시 적으면 두 곳이 드리프트한다.
from app.chains.payload_contract import GENERATED_PAYLOAD_FIELDS, QuizQuestion

from app.config import llm_configured, settings

logger = logging.getLogger(__name__)

# ── System Prompt (03번 스펙 원문 그대로) ──────────────────────────────────
SYSTEM_PROMPT = """당신은 대한민국 학습자를 위한 기상·기후 교육 전문 AI입니다.
아래 실시간 기상 데이터를 바탕으로 지정된 지식 수준에 맞는 퀴즈 1문항을 생성하세요.

규칙:
1. 반드시 제공된 실제 기상 데이터의 수치를 문제에 반영할 것 (허구 데이터 금지)
2. 난이도 축은 **지식 수준(knowledge_level) 6단계 하나뿐**이다. 입력의 level_group
   (elementary·middle_high·adult)은 난이도가 아니라 **표현 톤**이며 어휘 단계를 한 칸도
   움직이지 못한다 — level_group을 난이도로 해석하지 말 것.
   1 = 초등 3~4학년군. 현상에 이름을 붙이고 사례를 안다 — 까닭은 묻지 않는다
   2 = 초등 5~6학년군. 기상 요소를 측정·관찰하고 규칙성을 찾는다
   3 = 중학교 물질·에너지 영역. 현상을 물리량(열·비열·압력)으로 설명한다
   4 = 중학교 유체 지구 영역. 대기·해양을 한 계로 보고 기상 현상을 설명한다
   5 = 고교 정성 구간. 지구 규모의 순환·기후를 정성적으로 종합한다(역학은 배제)
   6 = 힘·정량 구간. 대기에 작용하는 힘과 정량 진단량을 쓴다
3. knowledge_level을 1~6 정수로 **반드시 신고**할 것. 입력에 knowledge_level이 주어지면
   그 단계로 저작하고 같은 값을 신고하며, 주어지지 않으면 스스로 판정해 신고한다.
4. 신고한 단계보다 늦게 도입되는 용어를 질문·선지·정답·해설 어디에도 쓰지 말 것.
   기단·전선·이슬점·상대습도·단열 팽창·복사 평형·대기 대순환은 4단계부터,
   태풍의 발생 원리·엘니뇨·심층 순환·악기상은 5단계부터,
   전향력·지균풍·정역학·단열 감률·알베도·십운형 명칭(권운·권층운·난층운)은 6단계부터다.
   정답이 교육과정에 없는 실무 기준 수치(특보 발표 기준·등압선 간격 등)이면 6단계다.
5. 표현 톤은 teen(한다체) **한 벌만** 쓴다 — 평서는 "~한다", 질문은 "~인가/~하는가"로
   끝낸다. 해요체·합니다체·감탄부호·2인칭 호칭을 쓰지 말 것. 같은 문항을 톤별로 여러 벌
   만들지 말 것(어린이·성인 말투는 런타임의 결정적 어미 치환이 담당한다).
6. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.
7. question_type이 "slider"면 min·max·step·unit을 **반드시 함께** 반환할 것.
   정답은 min 이상 max 이하이고 min에서 step 간격 격자에 올라 있어야 한다
   (예: min=0, step=5면 정답은 0·5·10… 중 하나). 범위는 문항 내용에 맞게 좁게 잡을 것.
   채점 관용오차가 절대값 ±10이므로 범위가 20 미만이면 아무 값이나 정답이 된다.

출력 스키마:
{
  "concept_tag": "<기압|전선|태풍|기단|대기순환|열섬효과|CO2|이상기후 중 하나의 영문 슬러그>",
  "knowledge_level": <1~6 정수>,
  "question_type": "multiple_choice" | "short_answer" | "slider",
  "question_text": "<질문>",
  "options": ["<선택지1>", ...] (multiple_choice일 때만),
  "correct_answer": "<정답>",
  "min": <최솟값>, "max": <최댓값>, "step": <간격>, "unit": "<단위>" (slider일 때만)
}"""

# ── Few-shot 예시 3개 (03번 스펙 원문 그대로, 프롬프트에 삽입) ─────────────
FEW_SHOT_EXAMPLES = """[예시 1 - knowledge_level 2, multiple_choice]
입력 데이터: {"region":"서울","temp_max":32,"humidity":75}
출력: {"concept_tag":"heat_island","knowledge_level":2,"question_type":"multiple_choice",
"question_text":"오늘처럼 도시 한가운데가 둘레 시골보다 더 더운 까닭은 무엇인가?",
"options":["아스팔트와 건물이 낮 동안 열을 저장한다","바다가 가까워 습기가 많다","나무와 풀이 더 많다","비가 자주 내린다"],
"correct_answer":"아스팔트와 건물이 낮 동안 열을 저장한다"}

[예시 2 - knowledge_level 4, short_answer]
입력 데이터: {"region":"강릉","pressure":1008,"wind_speed":12}
출력: {"concept_tag":"pressure_front","knowledge_level":4,"question_type":"short_answer",
"question_text":"기압이 1008hPa로 낮고 바람이 강한 오늘, 강릉을 지나는 저기압에서 찬 공기가 따뜻한 공기를 파고들며 만드는 전선은 무엇인가?",
"correct_answer":"한랭전선"}

[예시 3 - knowledge_level 5, slider]
입력 데이터: {"region":"전국","co2_context":true}
출력: {"concept_tag":"co2_climate","knowledge_level":5,"question_type":"slider",
"question_text":"산업화 이전과 비교해 현재 대기 중 이산화탄소 농도가 몇 % 늘었는지 슬라이더로 표시하라",
"correct_answer":"50","min":0,"max":100,"step":5,"unit":"%"}"""


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
# knowledge_level은 R13 3일차에 붙었다 — `QuizQuestion`이 신고를 필수로 요구하므로
# 폴백 뱅크도 신고해야 한다(안 그러면 무키 환경의 전 세션이 pydantic에서 깨진다).
# 값은 docs/specs/12 §4 R0~R7을 손으로 적용한 것이고, 1차 게이트의
# `knowledge_level_vocabulary`가 어휘표와 대조해 통과함을 확인했다
# (`test_knowledge_level_gate.py::test_폴백_뱅크가_어휘_게이트를_통과한다`).
#
# ⚠️ 본문 어미가 아직 `child`/`adult` 톤과 섞여 있다("~무엇일까요?"). 스펙 03 §2 규칙 5는
# **생성 문항**에 거는 것이고, 이 폴백 뱅크는 R2부터 있던 저작 문자열이라 이번 범위 밖으로
# 두었다 — 되톤은 데모에 보이는 문자열을 바꾸는 작업이라 별도 판단이 필요하다(이월).
FALLBACK_QUESTIONS: list[dict] = [
    {
        "concept_tag": "pressure_front",
        "knowledge_level": 2,  # 고기압·저기압 날씨 특징 [6과06-03]
        "question_type": "multiple_choice",
        "question_text": "저기압이 다가올 때 일반적으로 나타나는 날씨는 무엇일까요?",
        "options": ["맑고 건조하다", "흐리고 비가 오기 쉽다", "기온이 급격히 떨어진다", "바람이 전혀 불지 않는다"],
        "correct_answer": "흐리고 비가 오기 쉽다",
    },
    {
        "concept_tag": "pressure_front",
        "knowledge_level": 4,  # 정답이 '한랭전선' — introduced_at 4 [9과17-04]
        "question_type": "short_answer",
        "question_text": "찬 공기가 따뜻한 공기를 파고들며 좁은 지역에 강한 비를 내리는 전선의 이름은?",
        "correct_answer": "한랭전선",
    },
    {
        "concept_tag": "typhoon",
        "knowledge_level": 5,  # 태풍의 발생 메커니즘 [12지구01-04] (이름만이면 1)
        "question_type": "multiple_choice",
        "question_text": "태풍이 에너지를 얻는 주된 원천은 무엇일까요?",
        "options": ["따뜻한 바닷물의 수증기", "차가운 육지의 바람", "높은 산의 눈", "사막의 모래바람"],
        "correct_answer": "따뜻한 바닷물의 수증기",
    },
    {
        "concept_tag": "air_mass",
        "knowledge_level": 4,  # 기단 introduced_at 4 [9과17-04] (2022에서 초등 삭제)
        "question_type": "multiple_choice",
        "question_text": "우리나라 여름철에 덥고 습한 날씨를 가져오는 기단은 무엇일까요?",
        "options": ["시베리아 기단", "북태평양 기단", "오호츠크해 기단", "양쯔강 기단"],
        "correct_answer": "북태평양 기단",
    },
    {
        "concept_tag": "heat_island",
        "knowledge_level": 2,  # 열섬의 원인 — 본시드 열섬 11건과 같은 칸
        "question_type": "multiple_choice",
        "question_text": "도시가 주변 시골보다 더 더운 열섬 현상의 주요 원인은 무엇일까요?",
        "options": ["아스팔트와 콘크리트가 열을 저장해서", "도시에 비가 더 많이 와서", "도시가 바다와 가까워서", "도시의 나무가 더 많아서"],
        "correct_answer": "아스팔트와 콘크리트가 열을 저장해서",
    },
    {
        "concept_tag": "co2_climate",
        "knowledge_level": 4,  # 온실가스·온실효과 [9과17-01]
        "question_type": "short_answer",
        "question_text": "화석연료를 태울 때 나와서 지구의 기온을 높이는 대표적인 온실가스는 무엇일까요?",
        "correct_answer": "이산화탄소(CO2)",
    },
    {
        "concept_tag": "anomaly",
        "knowledge_level": 5,  # 극한 기상의 빈도 변화 [12기환02-03]·[10통과2-02-03]
        "question_type": "multiple_choice",
        "question_text": "지구 온난화로 인해 더 자주 나타날 것으로 예상되는 현상은 무엇일까요?",
        "options": ["폭염과 집중호우 같은 극한 날씨", "사계절이 없어지는 것", "달의 크기 변화", "지진의 감소"],
        "correct_answer": "폭염과 집중호우 같은 극한 날씨",
    },
]


# ── LLM 호출 ───────────────────────────────────────────────────────────────
def _build_messages(inputs: dict) -> list:
    """system prompt + few-shot + 이번 입력 데이터를 메시지로 구성한다."""
    from langchain_core.messages import HumanMessage, SystemMessage

    input_data = {
        "weather_data": inputs["weather_data"],
        "level_group": inputs["level_group"],
        "route": inputs.get("route", "general"),
        "target_concept_tag": inputs.get("target_concept_tag"),
    }
    # 목표 단계는 **주어졌을 때만** 싣는다. None을 실으면 모델이 "knowledge_level:
    # null"을 그대로 흉내 내고, 스펙 03 §2 규칙 3의 "없으면 스스로 판정한다" 분기가
    # 죽는다(= 신고가 사라진다).
    if inputs.get("knowledge_level") is not None:
        input_data["knowledge_level"] = inputs["knowledge_level"]
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
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.runnables import RunnableLambda
    from langchain_google_genai import ChatGoogleGenerativeAI
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


def _fallback_question(
    target_concept_tag: str | None = None, knowledge_level: int | None = None
) -> QuizQuestion:
    """폴백 뱅크에서 1건 추첨한다 — 개념·단계 순으로 좁히되 **비면 넓힌다**.

    좁힌 결과가 비었는데도 그대로 두면 폴백이 실패하고, 폴백 실패는 무키 환경에서
    세션 자체가 끊긴다는 뜻이다. 필터는 선호이지 조건이 아니다.
    """
    pool = FALLBACK_QUESTIONS
    if target_concept_tag:
        matched = [q for q in pool if q["concept_tag"] == target_concept_tag]
        if matched:
            pool = matched
    if knowledge_level is not None:
        leveled = [q for q in pool if q["knowledge_level"] == knowledge_level]
        if leveled:
            pool = leveled
    return QuizQuestion(**random.choice(pool))


def generate_quiz(
    weather_data: dict,
    level_group: str,
    route: str = "general",
    target_concept_tag: str | None = None,
    knowledge_level: int | None = None,
) -> dict:
    """퀴즈 1문항을 생성해 quiz_id가 포함된 dict를 반환한다.

    1차 시도(temperature 0.7) → 파싱/검증 실패 시 temperature 0.1로 1회 재시도
    → 2회 연속 실패 시 fallback 문제 세트에서 랜덤 선택.

    `knowledge_level`은 **목표 단계**(1~N)다. 주어지면 프롬프트가 그 단계로 저작하도록
    지시하고, 없으면 모델이 스스로 판정해 신고한다(스펙 03 §2 규칙 3). 어느 쪽이든
    산출물은 `knowledge_level`을 갖는다 — `QuizQuestion`이 필수로 요구하기 때문이다.
    신고값의 검증은 1차 게이트(`validate_chain`의 `knowledge_level_vocabulary`)가 한다.
    """
    inputs = {
        "weather_data": weather_data,
        "level_group": level_group,
        "route": route,
        "target_concept_tag": target_concept_tag,
        "knowledge_level": knowledge_level,
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
        question = _fallback_question(target_concept_tag, knowledge_level)

    # 유형에 해당 없는 선택 필드(None)는 실어 보내지 않는다 — backend
    # `_question_payload`가 "존재하는 키만" 담는 계약이므로 null을 보내면 유형에
    # 없는 필드가 payload에 섞이고 quiz_logs에도 빈 값이 쌓인다.
    # (기존 options-only 처리를 계약 G의 slider 필드까지 일반화한 것)
    payload = {k: v for k, v in question.model_dump().items() if v is not None}
    payload["quiz_id"] = next_quiz_id()
    return payload


# payload_contract에서 온 이름을 이 모듈 경로로도 계속 쓸 수 있게 재노출한다
# (계약 본체는 payload_contract가 단독 소유 — 여기 다시 적지 않는다).
__all__ = [
    "GENERATED_PAYLOAD_FIELDS",
    "QuizQuestion",
    "FALLBACK_QUESTIONS",
    "generate_quiz",
    "next_quiz_id",
]

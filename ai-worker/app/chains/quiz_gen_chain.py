"""Quiz Gen Chain — 03_ai_chains_spec.md 섹션 2.

System Prompt / Few-shot 6개는 스펙 원문 그대로 사용한다 (한 글자도 수정 금지).
생성 유형은 6종(multiple_choice·short_answer·slider·cloze·match·ordering)이고
board는 제외다 — 판정 규칙을 함께 저작해야 성립하므로 사람이 만든다(CO-O-13).
LCEL 스타일: build_messages | LLM(프로바이더는 env — llm_provider) | StrOutputParser
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
from app.chains.knowledge_level import load_vocabulary, vocabulary_violations
from app.chains.payload_contract import GENERATED_PAYLOAD_FIELDS, QuizQuestion

# ⚠️ **최상위 import여야 한다.** author_items.py가 sys.modules 스왑으로 ai-worker를
# 격리 임포트하는데(backend와 `app` 패키지명 공유), 함수 안에서 지연 import하면
# **스왑이 끝난 뒤** 실행돼 backend의 `app`을 뒤져 ModuleNotFoundError가 난다.
# llm_provider 자체는 langchain을 최상단에서 안 끌므로 여기 둬도 안전하다.
from app.llm_provider import PURPOSE_AUTHOR, build_chat_model, effective_spec, resolve_spec, spec_is_usable


def _llm_available() -> bool:
    """이 용도의 LLM을 부를 수 있는가 (CO-B7).

    ⚠️ **`llm_configured()`만 보면 안 된다.** 그건 `GEMINI_API_KEY`만 확인하므로,
    이 용도를 gpt-oss(OpenAI 호환)로 라우팅해도 "키 없음"으로 판정돼 **LLM 경로가
    영영 안 열린다** — 프로바이더 통로를 뚫어 놓고 문을 잠가 두는 셈이다.
    Gemini로 해석되면 종전과 똑같이 `llm_configured()`가 답한다(하위호환).
    """
    # **effective_spec**을 본다 — 서빙 모드·예산 강등이 반영된 실제 스펙이다.
    # resolve_spec(설정값)만 보면 예산이 소진돼도 "호출 가능"이라 답해서,
    # 체인이 LLM을 부르러 갔다가 빈 스펙으로 실패하고 예외 경로로 떨어진다.
    return spec_is_usable(effective_spec(PURPOSE_AUTHOR)[0])

logger = logging.getLogger(__name__)

# ── System Prompt (03번 스펙 원문 그대로) ──────────────────────────────────
SYSTEM_PROMPT = """당신은 대한민국 학습자를 위한 기상·기후 교육 전문 AI입니다.
아래 실시간 기상 데이터를 바탕으로 지정된 지식 수준에 맞는 퀴즈 1문항을 생성하세요.

규칙:
1. 반드시 제공된 실제 기상 데이터의 수치를 문제에 반영할 것 (허구 데이터 금지)
2. 난이도 축은 **지식 수준(knowledge_level) 10단계 하나뿐**이다. 입력의 level_group
   (elementary·middle_high·adult)은 난이도가 아니라 **표현 톤**이며 어휘 단계를 한 칸도
   움직이지 못한다 — level_group을 난이도로 해석하지 말 것.
   1 = 초등 3~4학년군. 현상에 이름을 붙이고 사례를 안다 — 까닭은 묻지 않는다
   2 = 초등 5~6학년군. 기상 요소를 측정·관찰하고 규칙성을 찾는다
   3 = 중학교 물질·에너지 영역. 현상을 물리량(열·비열·압력)으로 설명한다
   4 = 중학교 유체 지구 영역. 대기·해양을 한 계로 보고 기상 현상을 설명한다
   5 = 고1 통합과학. 지구 규모의 순환·기후를 정성적으로 종합한다(역학은 배제)
   6 = 고2~3 일반선택(지구과학·기후변화와 환경생태). 같은 정성 구간의 심화 — 여전히 역학은 배제
   7 = 고 진로선택(지구시스템과학·고급 지구과학). 힘과 감률이 교육과정 안에서 처음 나온다
   8 = 학부 대기과학. 전공 명명 체계(십운형)와 역학 기초(균형풍·와도·안정도 지수)
   9 = 학부 고학년. 일기도·수치예보 산출물을 정량으로 겹쳐 읽는다
   10 = 기상청 현업 실무. 교육과정이 아니라 업무 규정에서 나온 값을 쓴다
3. knowledge_level을 1~10 정수로 **반드시 신고**할 것. 입력에 knowledge_level이 주어지면
   그 단계로 저작하고 같은 값을 신고하며, 주어지지 않으면 스스로 판정해 신고한다.
4. 신고한 단계보다 늦게 도입되는 용어를 질문·선지·정답·해설 어디에도 쓰지 말 것.
   기단·전선·이슬점·상대습도·단열 팽창·복사 평형·대기 대순환은 4단계부터,
   태풍의 발생 원리·엘니뇨·심층 순환·악기상은 5단계부터,
   전향력·지균풍·경도풍·정역학·단열 감률은 7단계부터,
   알베도·십운형 명칭(권운·권층운·난층운)·온위·제트류·와도는 8단계부터다.
   정답이 교육과정에 없는 실무 기준 수치(특보 발표 기준·등압선 간격 등)이면 10단계다.
5. 표현 톤은 teen(한다체) **한 벌만** 쓴다 — 평서는 "~한다", 질문은 "~인가/~하는가"로
   끝낸다. 해요체·합니다체·감탄부호·2인칭 호칭을 쓰지 말 것. 같은 문항을 톤별로 여러 벌
   만들지 말 것(어린이·성인 말투는 런타임의 결정적 어미 치환이 담당한다).
6. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.
7. question_type이 "slider"면 min·max·step·unit을 **반드시 함께** 반환할 것.
   정답은 min 이상 max 이하이고 min에서 step 간격 격자에 올라 있어야 한다
   (예: min=0, step=5면 정답은 0·5·10… 중 하나). 범위는 문항 내용에 맞게 좁게 잡을 것.
   채점 관용오차가 절대값 ±10이므로 범위가 20 미만이면 아무 값이나 정답이 된다.
8. question_type이 "cloze"면 question_text에 빈칸을 밑줄 3개 `___`로 **한 곳만** 두고,
   correct_answer에는 그 빈칸에 들어갈 말만 적을 것(문장 전체를 다시 적지 말 것).
   options·pairs·items 같은 다른 유형의 필드를 함께 붙이지 말 것.
9. question_type이 "match"면 pairs를 {"left": …, "right": …} 객체 배열로 3~4쌍 반환하고,
   correct_answer는 pairs와 **같은 순서로** "left:right"를 "|"로 이은 한 줄이어야 한다
   (pairs가 겨울-시베리아 기단, 여름-북태평양 기단이면 correct_answer는
   "겨울:시베리아 기단|여름:북태평양 기단"). 표기가 한 글자라도 어긋나면 채점이
   전건 오답이 되므로, pairs의 문자열을 그대로 복사해 이을 것.
10. question_type이 "ordering"이면 items를 **정답 순서 그대로** 4~5개 저작하고,
    shuffled를 true로, correct_answer를 items 길이만큼의 항등 순열
    ("0,1,2,3")로 반환할 것. items를 미리 섞지 말고 correct_answer에 섞인 순서를
    적지도 말 것 — 화면에 섞어 보여주는 일은 런타임이 한다.
11. board는 생성하지 말 것. 보드 퍼즐은 판정 규칙(board_rules.json)을 함께 저작해야
    성립하므로 사람이 만든다.
12. 입력의 target_concept_tag가 주어지면 **반드시 그 개념으로** 저작하고 같은 값을
    concept_tag로 신고할 것 — 다른 개념으로 바꾸지 말 것. null이면 기상 데이터에
    맞는 개념을 스스로 고른다.
13. 입력의 route는 학습자의 현재 상태다 — focused는 target_concept_tag가 약점이라는
    뜻이므로 그 개념의 기본을 다시 묻고, advanced는 최근 연속 정답이라는 뜻이므로
    같은 단계 안에서 적용·해석을 묻고, general은 제약이 없다. **route는 난이도 축이
    아니다** — 어느 route에서도 knowledge_level을 임의로 올리거나 내리지 말 것.
14. 입력에 question_type이 주어지면 **반드시 그 유형으로** 저작하고 그 유형의 규칙
    (7~10)을 함께 지킬 것. 주어지지 않으면 개념에 맞는 유형을 스스로 고른다.

출력 스키마:
{
  "concept_tag": "<air_mass|anomaly|co2_climate|density_buoyancy|energy_transfer|flood_response|heat_island|phase_change|pressure_basics|pressure_front|radiation_budget|temperature_heat|typhoon|wildfire_weather 중 하나>",
  "knowledge_level": <1~10 정수>,
  "question_type": "multiple_choice" | "short_answer" | "slider" | "cloze" | "match" | "ordering",
  "question_text": "<질문>",
  "options": ["<선택지1>", ...] (multiple_choice일 때만),
  "pairs": [{"left": "<왼쪽 항목>", "right": "<오른쪽 항목>"}, ...] (match일 때만),
  "items": ["<첫 번째>", "<두 번째>", ...] (ordering일 때만 — 정답 순서로),
  "shuffled": true (ordering일 때만),
  "correct_answer": "<정답>",
  "min": <최솟값>, "max": <최댓값>, "step": <간격>, "unit": "<단위>" (slider일 때만)
}"""

# ── Few-shot 예시 6개 (03번 스펙 원문 그대로, 프롬프트에 삽입) ─────────────
# 예시의 concept_tag는 6개가 전부 다르다 — 같은 태그를 반복하면 모델이 그 태그로
# 쏠리고, 대량 저작에서 태그 편중은 그대로 유닛×밴드 격자의 구멍이 된다.
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
"correct_answer":"50","min":0,"max":100,"step":5,"unit":"%"}

[예시 4 - knowledge_level 2, cloze]
입력 데이터: {"region":"대구","temp_min":26,"temp_max":34}
출력: {"concept_tag":"temperature_heat","knowledge_level":2,"question_type":"cloze",
"question_text":"오늘 대구는 밤 최저기온이 26℃까지만 떨어진다. 밤 최저기온이 ___℃ 아래로 내려가지 않는 밤을 열대야라고 한다.",
"correct_answer":"25"}

[예시 5 - knowledge_level 4, match]
입력 데이터: {"region":"전국","season":"여름","humidity":82}
출력: {"concept_tag":"air_mass","knowledge_level":4,"question_type":"match",
"question_text":"덥고 습한 오늘 날씨를 포함해, 계절과 그 계절 우리나라에 영향을 주는 기단을 짝지어라",
"pairs":[{"left":"겨울","right":"시베리아 기단"},{"left":"초여름","right":"오호츠크해 기단"},{"left":"여름","right":"북태평양 기단"}],
"correct_answer":"겨울:시베리아 기단|초여름:오호츠크해 기단|여름:북태평양 기단"}

[예시 6 - knowledge_level 5, ordering]
입력 데이터: {"region":"제주","sea_temp":29,"wind_speed":18}
출력: {"concept_tag":"typhoon","knowledge_level":5,"question_type":"ordering",
"question_text":"수온이 29℃까지 오른 남쪽 바다에서 태풍이 북상하는 오늘, 태풍의 일생을 일어나는 순서대로 배열하라",
"items":["따뜻한 열대 바다에서 수증기가 증발해 열대 저기압이 생긴다","수증기가 응결하며 내놓는 열을 에너지로 삼아 태풍으로 발달한다","태풍이 육지에 상륙한다","수증기 공급이 줄어 세력이 급격히 약해진다"],
"shuffled":true,"correct_answer":"0,1,2,3"}"""


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


# ── Fallback 문제 세트 (concept_tag 14종 각 1문제 이상) ────────────────────
# knowledge_level은 R13 3일차에 붙었다 — `QuizQuestion`이 신고를 필수로 요구하므로
# 폴백 뱅크도 신고해야 한다(안 그러면 무키 환경의 전 세션이 pydantic에서 깨진다).
# 값은 docs/specs/12 §4 R0~R7을 손으로 적용한 것이고, 1차 게이트의
# `knowledge_level_vocabulary`가 어휘표와 대조해 통과함을 확인했다
# (`test_knowledge_level_gate.py::test_폴백_뱅크가_어휘_게이트를_통과한다`).
#
# ⚠️ **아래 앞 7건(기상 6태그)의 어미가 `child`/`adult` 톤과 섞여 있다**("~무엇일까요?").
# 스펙 03 §2 규칙 5는 **생성 문항**에 거는 것이고, 그 7건은 R2부터 있던 저작 문자열이라
# 이번 범위 밖으로 두었다 — 되톤은 데모에 보이는 문자열을 바꾸는 작업이라 별도 판단이
# 필요하다(이월). **2026-08-10에 붙인 뒤 8건(기초과학 6·재난 2)은 teen(한다체)로 저작했다** —
# 규칙 5가 저작 기준선으로 못박은 톤이고, child/adult는 런타임 어미 치환의 몫이다.
# 즉 지금 이 뱅크는 톤이 섞여 있고, 그 경계가 여기다.
#
# ── 왜 8건을 붙였나 (CO-E-5 나머지 절반, 2026-08-10) ──────────────────────
# 화이트리스트는 이미 14종으로 넓혔는데(위 출력 스키마 · 스펙 03) **뱅크는 기상 6태그
# 7건뿐**이었다. `_fallback_question`은 "좁힌 결과가 비면 넓힌다"라서, 기초과학·재난
# 유닛에서 폴백이 걸리면 태그 필터가 통째로 무시되고 **무관한 기상 문항이 그대로
# 학습자에게 나갔다**. 무키가 이 저장소의 기본 상태이므로 그 경로가 예외가 아니라
# 상시 경로다. 태그 목록의 소유자는 `backend/app/scripts/seed_content.ALLOWED_CONCEPT_TAGS`다
# — 여기 개수를 적지 않는다(위 헤더의 14는 그 상수를 2026-08-10에 실측한 값이다).
# 단계 값은 어휘표(`database/seed/level_vocabulary.json`)와 대조해 붙였고,
# `test_knowledge_level_gate.py::test_폴백_뱅크가_어휘_게이트를_통과한다`가 감시한다.
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
    # ── 기초과학 6태그 (2026-08-10 신규 · teen 톤) ─────────────────────────
    {
        "concept_tag": "temperature_heat",
        "knowledge_level": 2,  # 측정·관찰로 규칙성을 찾는 구간. '비열'(3)은 쓰지 않는다
        "question_type": "multiple_choice",
        "question_text": "한낮 바닷가에서 모래는 뜨거운데 바닷물은 미지근하다. 같은 햇빛을 받은 두 곳의 온도 변화를 바르게 말한 것은 무엇인가?",
        "options": [
            "모래가 물보다 빨리 뜨거워진다",
            "물이 모래보다 빨리 뜨거워진다",
            "모래와 물이 똑같이 뜨거워진다",
            "물만 뜨거워지고 모래는 식는다",
        ],
        "correct_answer": "모래가 물보다 빨리 뜨거워진다",
    },
    {
        "concept_tag": "radiation_budget",
        "knowledge_level": 4,  # 복사 평형 — 스펙 03 §2 규칙 4가 4단계로 못박는다
        "question_type": "short_answer",
        "question_text": "지구가 태양에서 흡수하는 에너지의 양과 우주로 내보내는 에너지의 양이 같아 평균 기온이 일정하게 유지되는 상태를 무엇이라고 하는가?",
        "correct_answer": "복사 평형",
    },
    {
        "concept_tag": "pressure_basics",
        "knowledge_level": 3,  # 중학교 물질·에너지 영역의 압력 [9과03]
        "question_type": "multiple_choice",
        "question_text": "높은 산에 오를수록 과자 봉지가 점점 부풀어 오른다. 이때 봉지 바깥의 기압은 어떻게 변하는가?",
        "options": [
            "낮아진다",
            "높아진다",
            "변하지 않는다",
            "봉지 안쪽 기압보다 높아진다",
        ],
        "correct_answer": "낮아진다",
    },
    {
        "concept_tag": "phase_change",
        "knowledge_level": 2,  # 증발·응결은 초등 5~6학년군. '이슬점'(4)은 쓰지 않는다
        "question_type": "cloze",
        "question_text": "이른 아침 풀잎에 물방울이 맺힌다. 공기 중의 수증기가 차가운 물체에 닿아 액체로 바뀌는 이 현상을 ___이라고 한다.",
        "correct_answer": "응결",
    },
    {
        "concept_tag": "density_buoyancy",
        "knowledge_level": 3,  # 밀도·부력 — 물리량으로 설명하는 구간
        "question_type": "multiple_choice",
        "question_text": "뜨거운 공기를 채운 열기구가 위로 떠오른다. 같은 부피로 견줄 때 열기구 속 공기의 무게는 바깥 공기와 견주어 어떠한가?",
        "options": [
            "더 가볍다",
            "더 무겁다",
            "완전히 같다",
            "부피와 관계없이 정해진다",
        ],
        "correct_answer": "더 가볍다",
    },
    {
        "concept_tag": "energy_transfer",
        "knowledge_level": 3,  # 열의 이동 — 물리량 구간. '단열'(6) 계열은 쓰지 않는다
        "question_type": "ordering",
        "question_text": "난로를 켠 방에서 공기가 돌며 방 전체가 데워지는 과정을 일어나는 순서대로 배열하라",
        "items": [
            "난로 곁의 공기가 열을 받아 데워진다",
            "데워진 공기가 가벼워져 위로 올라간다",
            "천장 쪽으로 퍼진 공기가 식어 무거워진다",
            "식은 공기가 아래로 내려와 다시 데워진다",
        ],
        "shuffled": True,
        "correct_answer": "0,1,2,3",
    },
    # ── 재난 2태그 (2026-08-10 신규 · teen 톤) ────────────────────────────
    {
        "concept_tag": "wildfire_weather",
        "knowledge_level": 4,  # 정답에 '상대습도'(introduced_at 4)가 들어간다
        "question_type": "multiple_choice",
        "question_text": "산불이 크게 번지기 쉬운 날의 기상 조건으로 알맞은 것은 무엇인가?",
        "options": [
            "상대습도가 낮고 바람이 강하다",
            "상대습도가 높고 바람이 약하다",
            "기온이 낮고 눈이 쌓여 있다",
            "안개가 짙고 비가 내린다",
        ],
        "correct_answer": "상대습도가 낮고 바람이 강하다",
    },
    {
        "concept_tag": "flood_response",
        "knowledge_level": 2,  # 재난 시 행동 요령 — 사례·규칙성 구간
        "question_type": "multiple_choice",
        "question_text": "많은 비로 지하 주차장에 물이 차오를 때 가장 먼저 해야 하는 행동은 무엇인가?",
        "options": [
            "차를 두고 즉시 밖으로 대피한다",
            "차를 옮기러 지하로 내려간다",
            "물이 빠질 때까지 차 안에서 기다린다",
            "주차장 배수구를 손으로 막는다",
        ],
        "correct_answer": "차를 두고 즉시 밖으로 대피한다",
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
    # 목표 단계·목표 유형은 **주어졌을 때만** 싣는다. None을 실으면 모델이
    # "knowledge_level: null"을 그대로 흉내 내고, 스펙 03 §2 규칙 3·14의 "없으면
    # 스스로 판정/선택한다" 분기가 죽는다(= 신고가 사라지거나 유형이 null로 나온다).
    if inputs.get("knowledge_level") is not None:
        input_data["knowledge_level"] = inputs["knowledge_level"]
    if inputs.get("question_type") is not None:
        input_data["question_type"] = inputs["question_type"]
    human_text = (
        f"{FEW_SHOT_EXAMPLES}\n\n"
        f"입력 데이터: {json.dumps(input_data, ensure_ascii=False)}\n"
        f"출력:"
    )
    return [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=human_text)]


@lru_cache(maxsize=8)
def _cached_chain(model: str, api_key: str, temperature: float):
    """(model, api_key, temperature) 조합별 LCEL 체인 캐시.

    시도 온도는 (0.7, 0.1) 2종뿐이므로 문항 생성마다 LLM 클라이언트를
    재생성하지 않는다(R7-02 S7 지연 완화). 생성 실패 예외는 캐시되지 않아
    폴백 문제 세트 동작은 기존과 동일하다.
    """
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.runnables import RunnableLambda

    # 프로바이더는 여기서 고르지 않는다 — env가 정한다(CO-B7 용도별 라우팅).
    # 인자 model·api_key는 **캐시 키로만** 남긴다: 설정이 바뀌면 캐시가 갈라져야 한다.
    llm = build_chat_model(temperature, purpose=PURPOSE_AUTHOR)
    return RunnableLambda(_build_messages) | llm | StrOutputParser()


def _build_chain(temperature: float):
    """LCEL: 메시지 구성 → LLM → 문자열.

    캐시 키에 **해석된 스펙**을 싣는다. 종전에는 GEMINI_* 만 실어서, 저작 용도를
    OSS로 돌려도 Gemini로 만든 체인이 그대로 재사용됐다(모델 교체가 무시됐다).
    """
    spec = resolve_spec(PURPOSE_AUTHOR)
    return _cached_chain(spec.model, spec.api_key, temperature)


def _parse_output(raw: str) -> QuizQuestion:
    """모델 출력에서 JSON을 추출해 Pydantic으로 검증한다."""
    return QuizQuestion(**extract_json_object(raw))


def _fallback_question(
    target_concept_tag: str | None = None,
    knowledge_level: int | None = None,
    question_type: str | None = None,
) -> QuizQuestion:
    """폴백 뱅크에서 1건 추첨한다 — 개념·단계·유형 순으로 좁히되 **비면 넓힌다**.

    좁힌 결과가 비었는데도 그대로 두면 폴백이 실패하고, 폴백 실패는 무키 환경에서
    세션 자체가 끊긴다는 뜻이다. 필터는 선호이지 조건이 아니다.

    `question_type`도 여기서 받는 이유: **이 저장소의 기본 상태가 무키**다(비용
    게이트 — CLAUDE.md). 목표 유형을 프롬프트에만 실으면 실제로 가장 많이 도는
    경로(= 폴백)에서 그 노브가 아무 일도 하지 않는다.
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
    if question_type:
        typed = [q for q in pool if q["question_type"] == question_type]
        if typed:
            pool = typed
    return QuizQuestion(**random.choice(pool))


def _reject_if_level_overstated(question: QuizQuestion) -> None:
    """신고 단계보다 늦게 도입되는 용어가 있으면 예외 — 재시도·폴백으로 보낸다.

    **왜 생성 시점에 보는가.** 검증 로직(§7.4 판정식)은 1차 게이트가 이미 갖고
    있지만, 게이트는 `/internal/quiz-validate`를 부르는 경로에만 걸린다. 저작 배치
    (`author_items.run_batch`)는 그것을 부르지만 **런타임 세션 생성은 부르지 않는다**
    — backend가 `/internal/quiz-generate` 응답을 그대로 쓴다.

    R13 D 선행으로 생성 문항이 `content_items`에 **status=active로 영속화**되면서
    그 공백이 실제 결함이 됐다: 신고를 안 믿겠다고 게이트를 만들어 놓고, 정작
    영구 적재되는 경로가 게이트를 지나지 않는다. 그러면 "6단계 용어를 쓴 2단계
    문항"이 뱅크에 남아 초등 학습자에게 서빙된다 — docs/specs/12 §8.2가 실측한
    사고([58] 건조 단열 감률이 `adult` 면제로 통과한 것)의 생성판 재현이다.
    적재 시점 검사가 아니라 **생성 시점 검사**로 둔 이유는 어휘표와 판정식이 여기
    있기 때문이다(backend가 보려면 판정식 사본이 세 번째로 생긴다).

    어휘표를 못 읽어도 통과시키지 않는다 — 검증할 수 없는 문항은 반려하고 폴백
    뱅크(사람이 단계를 붙인 문항)로 내려간다. 게이트가 조용히 꺼지는 것보다 낫다.
    """
    violations = vocabulary_violations(
        question.model_dump(), int(question.knowledge_level), load_vocabulary()
    )
    if violations:
        raise ValueError(
            f"신고 단계 {question.knowledge_level}보다 늦게 도입되는 용어: "
            + " / ".join(violations)
        )


def generate_quiz(
    weather_data: dict,
    level_group: str,
    route: str = "general",
    target_concept_tag: str | None = None,
    knowledge_level: int | None = None,
    question_type: str | None = None,
) -> dict:
    """퀴즈 1문항을 생성해 quiz_id가 포함된 dict를 반환한다.

    1차 시도(temperature 0.7) → 파싱/검증 실패 시 temperature 0.1로 1회 재시도
    → 2회 연속 실패 시 fallback 문제 세트에서 랜덤 선택.

    `knowledge_level`은 **목표 단계**(1~N)다. 주어지면 프롬프트가 그 단계로 저작하도록
    지시하고, 없으면 모델이 스스로 판정해 신고한다(스펙 03 §2 규칙 3). 어느 쪽이든
    산출물은 `knowledge_level`을 갖는다 — `QuizQuestion`이 필수로 요구하기 때문이다.
    신고값의 검증은 1차 게이트(`validate_chain`의 `knowledge_level_vocabulary`)가 한다.

    `question_type`은 **목표 유형**이다(생성 6종 중 하나. 스펙 03 §2 규칙 14). 없으면
    모델이 개념에 맞는 유형을 고른다 — 종전 동작과 같다. 새 인자는 **시그니처 끝에**
    붙였다: 기존 호출부가 `generate_quiz({}, "middle_high", "general", "typhoon")`처럼
    위치 인자로 부른다.

    `route`·`target_concept_tag`는 Router Chain 출력이다(`focused|general|advanced`).
    2026-08-10까지 이 dict에 실리기만 하고 프롬프트에 규칙이 없어 모델 쪽에서 홉이
    끊겨 있었다 — 규칙 12~13이 그것을 잇는다(CO-O-8).
    """
    inputs = {
        "weather_data": weather_data,
        "level_group": level_group,
        "route": route,
        "target_concept_tag": target_concept_tag,
        "knowledge_level": knowledge_level,
        "question_type": question_type,
    }

    question: QuizQuestion | None = None
    if not _llm_available():
        # 키 미설정 시 LLM 시도 자체를 생략 — 실패 대기 없이 즉시 폴백 뱅크.
        logger.info("GEMINI 키 미설정 — LLM 생성 생략, 폴백 뱅크 사용")
    else:
        for attempt, temperature in enumerate((0.7, 0.1), start=1):
            try:
                raw = _build_chain(temperature).invoke(inputs)
                question = _parse_output(raw)
                _reject_if_level_overstated(question)
                break
            except Exception as exc:  # LLM 장애, JSON 파싱, Pydantic 검증 실패 모두 포함
                logger.warning("quiz generation attempt %d failed: %s", attempt, exc)
                question = None

    if question is None:
        logger.warning("falling back to predefined quiz set")
        question = _fallback_question(target_concept_tag, knowledge_level, question_type)

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

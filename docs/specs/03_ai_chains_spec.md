# AI 체인 상세 스펙 (WeatherBrain + LangChain + Gemini 3.1 Flash-Lite)

> 실제 프롬프트 문구, 입출력 스키마, 분기 조건까지 명시. 이 문서만 보고 체인을 그대로 구현할 수 있어야 한다.

## 0. 이중 레이어 원칙

```
WeatherBrain (자체, ai-worker/app/weatherbrain/) — R6 구현 완료
  → IRT(2PL) 순수 파이썬 엔진: EAP로 개념별 능력 θ 추정, JML로 문항난이도 b 보정
  → 가입 시 level_group 사전분포로 초기 능력(θ) 배정, 응답 누적 시 재추정
  → Router Chain에 "이 사용자의 개념별 실력 추정치(θ)"를 1순위 신호로 제공
  → 무상태: 수학은 ai-worker 소유, 영속화(user_concept_ability·item_params)는 backend

경계(R6 현재): θ는 Router 분기(focused/general/advanced) 타게팅과 진단 노출을 구동한다.
  그러나 **출제 난이도**(뱅크 풀 필터·quiz-generate 프롬프트)는 아직 유저 신고 level_group을
  쓴다 — θ→출제난이도(theta_to_target_level_group을 서빙 경로에 연결 + 풀을 θ 인접
  레벨로 확장)는 다음 증분이다(세션 배합 계약 테스트 갱신 동반). 즉 "능력 측정·배정"은
  실동작하나 "측정 θ로 출제 난이도를 바꾼다"는 아직 미연결.

Gemini 3.1 Flash-Lite (외부 API, ai-worker/app/gemini_client.py)
  → Quiz Gen Chain, RAG Chain 두 곳에서 실제 텍스트 생성 담당

Fallback: θ가 없거나(콜드스타트·추정 실패) 응답 반영 전(n=0)이면 Router Chain은
  weak_tags 정답률로 폴백 → 분기는 항상 동작 가능(ai-worker 장애에도 세션 발급 진행)
```

---

## 1. Router Chain (`ai-worker/app/chains/router_chain.py`)

**입력**: `user_id`, 해당 유저의 `weak_tags` 전체 row

**로직 (LLM 호출 없이 순수 로직으로 구현 — 비용 절감)**
```python
def route(weak_tags: list[dict]) -> str:
    if not weak_tags:
        return "general"  # 콜드스타트: 데이터 없으면 일반 문제
    worst = min(weak_tags, key=lambda t: t["accuracy_rate"])
    if worst["accuracy_rate"] < 60:
        return "focused"      # 집중 문제 (해당 concept_tag)
    recent_correct_streak = ...  # quiz_logs 최근 3개 연속 정답 체크
    if recent_correct_streak >= 3:
        return "advanced"     # 심화 탐구 (탐정/시뮬레이터 추천)
    return "general"
```

**출력**: `{"route": "focused"|"general"|"advanced", "target_concept_tag": str|null}`

---

## 2. Quiz Gen Chain (`ai-worker/app/chains/quiz_gen_chain.py`)

**입력**: 오늘의 기상청 데이터(JSON) + `level_group` + Router Chain 출력(`route`, `target_concept_tag`)

**System Prompt (그대로 사용)**
```
당신은 대한민국 초·중·고등학생과 일반 성인을 위한 기상·기후 교육 전문 AI입니다.
아래 실시간 기상 데이터를 바탕으로 학습자 수준에 맞는 퀴즈 1문항을 생성하세요.

규칙:
1. 반드시 제공된 실제 기상 데이터의 수치를 문제에 반영할 것 (허구 데이터 금지)
2. level_group이 "elementary"면 초등학생 눈높이 쉬운 용어, "middle_high"면 중학교 2학년
   과학 교과과정 용어, "adult"면 기상청 전문 용어 일부 허용
3. 출력은 반드시 아래 JSON 스키마만 반환. 다른 설명 텍스트 절대 포함하지 말 것.
4. question_type이 "slider"면 min·max·step·unit을 **반드시 함께** 반환할 것.
   정답은 min 이상 max 이하이고 min에서 step 간격 격자에 올라 있어야 한다
   (예: min=0, step=5면 정답은 0·5·10… 중 하나). 범위는 문항 내용에 맞게 좁게 잡을 것.

출력 스키마:
{
  "concept_tag": "<기압|전선|태풍|기단|대기순환|열섬효과|CO2|이상기후 중 하나의 영문 슬러그>",
  "question_type": "multiple_choice" | "short_answer" | "slider",
  "question_text": "<질문>",
  "options": ["<선택지1>", ...] (multiple_choice일 때만),
  "correct_answer": "<정답>",
  "min": <최솟값>, "max": <최댓값>, "step": <간격>, "unit": "<단위>" (slider일 때만)
}
```

**Few-shot 예시 3개 (프롬프트에 삽입)**
```
[예시 1 - elementary, multiple_choice]
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
"question_text":"산업화 이전 대비 현재 대기 중 CO2 농도 증가율을 추정해 슬라이더로 표시하세요",
"correct_answer":"50","min":0,"max":100,"step":5,"unit":"%"}
```

> **개정 (2026-08-03) — slider에 min·max·step·unit 추가.**
>
> 최초 설계는 슬라이더 척도를 **암묵적 0~100**으로 두고 범위를 질문 텍스트에
> 적게 했다(예시 3의 "(0~100%)"). `validate_chain`의 `SLIDER_MIN, SLIDER_MAX = 0, 100`
> 하드코딩이 그 설계의 흔적이다.
>
> 그런데 **제품이 유형별 범위로 이동했다.** 시드 slider 4건은 이미 항목별
> `min`/`max`/`step`/`unit`을 갖고(0~40 m/s · 0~20 % 등), 서버는
> `QUESTION_PAYLOAD_FIELDS["slider"]`로 그 4필드를 노출하며 프론트
> (`QuestionCard.jsx`)가 그 값으로 슬라이더를 렌더한다. 즉 **저작 경로는 옮겨갔고
> 생성 경로만 남아 있었다.**
>
> 개정하지 않으면 생성 slider는 범위 없이 만들어져 프론트에서 `?? 0`/`?? 100`으로
> 폴백한다 — "초속 몇 m 이상"(정답 17, 적정 범위 0~40) 문항이 0~100 슬라이더로
> 나오고, `SLIDER_TOLERANCE`가 절대값 10이라 사실상 공짜 정답이 된다. 계약
> `GENERATED_PAYLOAD_FIELDS`(docs/team/CONTRACT_GEN_ITEM.md 계약 G)를 세운 뒤에는
> 이 문항이 **탈락 → 재시도 → 폴백**이 되어 생성 slider가 사실상 사라지므로,
> 스키마·예시가 4필드를 요구해야 계약이 실효를 갖는다.
>
> 이 문서의 System Prompt·Few-shot은 `quiz_gen_chain.py`가 **원문 그대로** 쓰므로
> 둘을 동시에 개정했고, 동일성은 `test_prompt_spec_parity.py`가 감시한다(이전에는
> 감시자가 없었다).

**Output Parser**: `json.loads()` 실패 시 1회 재시도(temperature 낮춰서), 2회 연속 실패 시 사전 정의된 fallback 문제 세트에서 랜덤 선택.

---

## 3. RAG Chain (`ai-worker/app/chains/rag_chain.py`)

**트리거**: Quiz API `/answer` 제출 직후

**단계**
1. `concept_tag` + `user_answer`(오답 시)로 Chroma 쿼리 문자열 구성: `f"{concept_tag} {question_text}"`
2. Chroma `climate_concepts` + `weather_daily` 컬렉션에서 `top_k=3, threshold=0.7`로 검색
3. 검색 결과 없으면 (threshold 미달) → `climate_concepts`만 재검색 (fallback)
4. 아래 프롬프트로 Gemini 호출

**System Prompt**
```
당신은 기상교육 전문 AI입니다. 학습자가 방금 푼 문제에 대해 피드백을 작성하세요.

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
- 오늘 실제 기상 데이터: {today_weather_json}
```

**출력**: 순수 텍스트(피드백 문자열). JSON 아님.

---

## 4. Context Injection 상세 (모든 체인 공통)

Chroma 검색 결과를 프롬프트에 삽입할 때 포맷:
```
[참고 지식 1] (출처: climate_concepts, 관련도 0.84)
저기압은 주변보다 기압이 낮은 곳으로, 상승기류가 발달해...

[참고 지식 2] (출처: weather_daily, 관련도 0.79)
2026-07-05 서울 지역 기압은 1005hPa로...
```

---

## 5. WeatherBrain — 구현 (R6)

### 5.1 코어 (`ai-worker/app/weatherbrain/`, 순수 파이썬·무의존)
- `irt.py`: 2PL 문항반응함수 `irf`, EAP 능력추정 `estimate_ability`(정규 사전분포,
  격자 81점, 로그공간 정규화), JML 문항난이도 보정 `calibrate_items`(θ↔b 교대추정 후
  b 평균 0 센터링). 합성 θ·b 복원 테스트가 정확성을 고정(tests/test_weatherbrain_irt).
- `priors.py`: `level_group_prior`(초등 -1.0/중고 0.0/성인 1.0, σ=1.0),
  `prior_item_b`(보정 전 문항 난이도), `theta_to_target_level_group`(경계 ±0.5).
- `placement.py`: `initial_abilities` — 사전만 또는 배치고사 응답 결합으로 초기 θ 배정.

### 5.2 내부 엔드포인트 (X-Internal-API-Key)
- `POST /internal/weatherbrain/estimate` {level_group, concepts:[{concept_tag,
  responses:[{b|null,a,correct}]}]} → {abilities:[{concept_tag,theta,se,n}]}.
  b=null이면 level_group 사전난이도로 대체(사전값 ai-worker 단일 소유).
- `POST /internal/weatherbrain/placement` {level_group, concept_tags} → {abilities}.
- `POST /internal/weatherbrain/calibrate` {responses:[{user_id,item_id,correct}]}
  → {item_b:{item_id:b}}. 재학습(celery)이 호출.
- `POST /internal/router-decide` 는 `abilities`를 받아 θ를 1순위 분기 신호로 사용.

### 5.3 backend 영속화·연결
- 테이블(마이그레이션 0006): `user_concept_ability`(RLS, θ·se·응답수),
  `item_params`(전역, 보정 b). 소비: `weatherbrain_service`(θ 조립·upsert),
  `session_service.decide_route`(세션 발급 시 θ 재추정→Router), 가입 시 `seed_placement`.
- 노출: `GET /api/v1/progress/abilities` — 개념별 θ·난이도 라벨(약한 개념 순).

### 5.4 재학습 (celery `tasks/retrain.py`, 매일 03시)
- 뱅크 문항 채점 응답을 모아 /calibrate 위임 → `item_params` upsert.
- 휴면-정확 가드: 전체 응답 ≥200 & 문항당 ≥20 미만이면 스킵(사전값 유지).
  콜드스타트 동안에도 θ 추정은 level_group 사전으로 정상 동작.

---

## 바이브 코딩 지시사항

```
ai-worker/app/chains/ 아래 router_chain.py, quiz_gen_chain.py, rag_chain.py를
위 스펙의 프롬프트 문구를 그대로 사용해서 LangChain LCEL 스타일로 구현해줘.
Gemini 3.1 Flash-Lite는 langchain-google-genai 패키지의 ChatGoogleGenerativeAI로 연결해줘.
Chroma 클라이언트는 ai-worker/app/embeddings/chroma_client.py에 싱글턴으로 만들어줘.
Quiz Gen Chain의 출력은 반드시 Pydantic 모델로 검증 후 실패하면 재시도하는
OutputFixingParser 패턴을 적용해줘.
```

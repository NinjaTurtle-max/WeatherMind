# AI 체인 상세 스펙 (WeatherBrain + LangChain + Gemini 3.1 Flash-Lite)

> 실제 프롬프트 문구, 입출력 스키마, 분기 조건까지 명시. 이 문서만 보고 체인을 그대로 구현할 수 있어야 한다.

## 0. 이중 레이어 원칙

```
WeatherBrain (자체, ai-worker/app/weatherbrain/)
  → quiz_logs 누적 데이터로 IRT 파라미터 재학습
  → Router Chain에 "이 사용자의 개념별 실력 추정치"를 제공

Gemini 3.1 Flash-Lite (외부 API, ai-worker/app/gemini_client.py)
  → Quiz Gen Chain, RAG Chain 두 곳에서 실제 텍스트 생성 담당

Fallback: WeatherBrain 추정치가 없는 신규 유저(콜드스타트)는
  weak_tags 테이블의 단순 정답률로 대체 → Router Chain 분기는 항상 동작 가능
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

출력 스키마:
{
  "concept_tag": "<기압|전선|태풍|기단|대기순환|열섬효과|CO2|이상기후 중 하나의 영문 슬러그>",
  "question_type": "multiple_choice" | "short_answer" | "slider",
  "question_text": "<질문>",
  "options": ["<선택지1>", ...] (multiple_choice일 때만),
  "correct_answer": "<정답>"
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
"question_text":"산업화 이전 대비 현재 대기 중 CO2 농도 증가율을 추정해 슬라이더로 표시하세요 (0~100%)",
"correct_answer":"50"}
```

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

## 5. WeatherBrain 재학습 트리거 (celery/app/tasks/)

```
조건: quiz_logs 신규 row가 100개 누적될 때마다 (또는 매일 새벽 3시, Quiz Gen 다음)
동작: ai-worker/app/weatherbrain/train.py 실행
      → IRT 파라미터(문제 난이도 b, 학습자 능력 θ) 재추정
      → 결과를 weak_tags.accuracy_rate 보정치로 반영 (선택적, MVP 이후 단계)

MVP 범위: 콜드스타트 대응으로 초기엔 weak_tags의 단순 정답률만으로 Router Chain 운영,
         WeatherBrain 학습은 데이터 누적 후 2단계로 통합 (로드맵 항목)
```

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

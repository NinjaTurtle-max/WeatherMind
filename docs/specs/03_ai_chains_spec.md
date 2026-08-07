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

**입력**: 오늘의 기상청 데이터(JSON) + `level_group`(표현 톤) + `knowledge_level`
(목표 지식 수준, 선택) + Router Chain 출력(`route`, `target_concept_tag`)

**System Prompt (그대로 사용)**
```
당신은 대한민국 학습자를 위한 기상·기후 교육 전문 AI입니다.
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
}
```

**Few-shot 예시 3개 (프롬프트에 삽입)**
```
[예시 1 - knowledge_level 2, multiple_choice]
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
```

> **개정 (2026-08-07, R13 3일차) — 학령 3종 열거를 2축(지식 수준 6단계 × 표현 톤)으로 교체.**
>
> **바뀐 것(개정 전 → 후)**
>
> | | 개정 전 | 개정 후 |
> |---|---|---|
> | 난이도 지시 | 규칙 2 한 줄. `elementary`=쉬운 용어 / `middle_high`=중2 교과 용어 / **`adult`=기상청 전문 용어 일부 허용** | 규칙 2가 6단계 정의표. `level_group`은 **난이도가 아니라 톤**이라고 명시하고 난이도 해석을 금지 |
> | 단계 신고 | 없음 (생성 문항은 단계 없이 나왔다) | 규칙 3 — `knowledge_level` 1~6 정수 **필수 신고**. 출력 스키마에 필드 추가 |
> | 어휘 통제 | 없음 | 규칙 4 — 신고 단계보다 늦게 도입되는 용어 금지 + 4·5·6단계 경계 용어 예시 + R3(실무 수치 → 6단계) |
> | 톤 | 학령 3종에 섞여 있었다 | 규칙 5 — **`teen` 한다체 1벌 고정**. 톤 3벌 저작을 명시적으로 금지 |
> | few-shot 라벨 | `elementary` / `middle_high` / `adult` | `knowledge_level 2` / `4` / `5` |
>
> **왜 지금인가.** R13 2일차에 본시드 141건 전수 재분류가 착지하면서
> `lint_seed_items` 검사 ⑤의 전환기 폴백이 만료됐다 — `knowledge_level`이 없는 문항은
> 이제 그 자체로 탈락한다("미부여 — 단계를 판정할 수 없다"). 개정 전 프롬프트로 G1
> 배치(~1,360건)를 태우면 **전건이 이 사유로 탈락한다.** 기계 복원도 불가다:
> `level_group`→`knowledge_level` 복원은 `docs/specs/12` §5.3이 금지하고(파생은
> 단방향, 4→2로 좁아진다), R2~R6은 원리적으로 사람 몫이다(§5.2). 남은 길은
> **모델이 직접 신고하고 결정적 게이트가 그 신고를 검증하는 것** 하나뿐이다.
>
> **`adult = 기상청 전문 용어 일부 허용`이 특히 위험했다.** `docs/specs/12` §8.2가
> 실측한 사고가 정확히 그 문장의 결과다 — 본시드 6단계 9건은 **저작된 것이 아니라
> `adult` 밴드가 무검사여서 실무 수치가 흘러든 것**이고([58] 건조 단열 감률 ·
> [98] 위험반원 · [54] 등압선 4hPa), 의도적으로 설계된 전문가 문항은 0건이었다.
> 같은 문장을 1,360건에 각인시키면 같은 사고가 1,360배가 된다.
>
> **톤이 1벌인 근거**는 `docs/specs/12` §6.4의 클라이언트 결정(2026-08-06)이다.
> 3벌 저작은 G1 비용이 3배가 되어 기각됐고, 아낀 몫은 지식 축(실질 0건인 6단계,
> 얇은 1·3단계)에 투입한다. 프롬프트가 톤 3벌을 요구하지 않아야 그 결정이 실효를 갖는다.
>
> **개정 전 (2026-08-03) — slider에 min·max·step·unit 추가.**
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

### 2.1 신고된 `knowledge_level`은 결정적 게이트가 검증한다

**신고를 그대로 믿지 않는다.** 규칙 3의 신고는 LLM의 자기 판단이고, 검증 없이 받으면
"6단계 용어를 쓴 2단계 문항"이 뱅크에 그대로 들어간다 — `docs/specs/12` §8.2가 실측한
사고의 생성판 재현이다. 검증은 **1차 휴리스틱 게이트**(LLM 무관·결정적)가 맡는다.

| 층 | 소유자 | 무엇을 막는가 |
|---|---|---|
| 스키마 | `payload_contract.QuizQuestion.knowledge_level`(필수, `ge=1`) | **미신고**. 위반은 pydantic ValueError → temperature 0.1 재시도 → 폴백 뱅크 |
| 1차 게이트 | `validate_chain` 체크 16 `knowledge_level_vocabulary` | **거짓 신고**. 정수 여부 · 1~N 범위 · 어휘 대조 |
| 판정식 소유자 | `chains/knowledge_level.vocabulary_violations` | `docs/specs/12` §7.4 판정식 1줄 |
| 어휘 데이터 | `database/seed/level_vocabulary.json`(v3) | 용어별 `introduced_at`·`name_ok_from`·`standard`·`basis` |

판정식(`docs/specs/12` §7.4 원문):

```
탈락 = knowledge_level < (그 용어가 정답·메커니즘 질문에 쓰이면 introduced_at,
                          아니면 name_ok_from)
```

- **대조 범위**는 `question_text`·`options`·`correct_answer`·`items`·`pairs`·`hints`…
  즉 문항 문자열 **전부**다(`concept_tag`·`question_type`·`level_group`·`quiz_id`는 제외).
  `docs/specs/12` §4 R0이 요구하는 범위이고 `lint_seed_items._all_strings`와 같다.
- **"정답·메커니즘에 쓰였는가"** 의 기계 판별: ⓐ 정답 필드(`correct_answer`·`items`·
  `pairs`·`goal_conditions`)에 등장하거나 ⓑ 질문에 메커니즘 표지(왜·까닭·이유·원리·
  때문·메커니즘·어떻게)가 있고 그 질문에 용어가 있으면 참. 참이면 `introduced_at`,
  거짓이면 `name_ok_from`을 임계로 쓴다. 이 예외 하나가 "태풍이 올 때 안전한 행동은?"
  (1단계 대처 행동)을 5단계로 튀지 않게 한다.
- **단계 수 N을 코드에 박지 않는다.** N은 어휘표 `anchor` 블록의 키에서 나온다
  (`weatherbrain_service.KNOWLEDGE_LEVEL_BANDS` 길이가 N을 정하는 것과 같은 관례).
  6→7 분할(`docs/specs/12` §3.1)이 와도 프롬프트 규칙 2·3의 숫자만 고치면 된다.
- **어휘표를 읽지 못하면 통과시키지 않는다.** 게이트가 조용히 꺼지는 것은 게이트가
  없는 것과 같다 — 그 상태로 G1을 태우면 1,360건이 무검사로 들어간다. 컨테이너는
  `database/seed` 마운트(또는 `LEVEL_VOCABULARY_PATH`)가 필요하다.
- **미신고는 "해당 없음" 통과**다(선택 필드 관례). 생성 경로는 스키마가 신고를 필수로
  막고, 저작 시드는 `expand_like_server`가 이 키를 flat에 싣지 않으므로
  (`session_service` 런타임 전개와 동형) `lint_seed_items` 검사 ⑤가 중첩 형태로 본다.
  **두 경로 중 어느 쪽도 무검사로 새지 않는다.**

> **왜 2차 LLM 게이트가 아닌가**: 키 미투입이 이 저장소의 기본 상태다(비용 게이트 —
> CLAUDE.md). 어휘 대조를 2차에 얹으면 무키에서 **조용히 안 도는 게이트**가 되고,
> 정작 G1 배치를 준비하는 지금 아무것도 검증하지 못한다. 대조는 문자열 포함 판정이라
> LLM이 필요 없고, 오히려 LLM보다 결정적이다.

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

## 6. 생성 대상 = 템플릿 (R13 3일차 설계 — 실증 단계)

> **클라이언트 결정(2026-08-07)**: G1(8/10) 키 투입을 완성품 1,360건이 아니라
> **파라미터화 템플릿**에 쓴다. 같은 비용으로 완성품이 아니라 **생성기**를 산다.
>
> 이 절은 **설계와 소규모 실증**이다(전면 구현 아님). 실증 산출물:
> 정의 `database/seed/staging/r13_item_templates.json`(템플릿 5) ·
> 인스턴스 `database/seed/staging/r13_template_proof.json`(21건, lint 전건 통과) ·
> 확장기 `scripts/author_items.py`의 `expand_template`(LLM 미호출·결정적).

### 6.1 기존 자산과의 관계 — 새 축을 만들기 전에 확인한 것

| 자산 | 하는 일 | 템플릿과 겹치는가 |
|---|---|---|
| 실황 슬롯 `{today.*}` (`session_service.fill_live_slots`) | 런타임에 KMA 값을 문자열 치환. 허용 5종 | **겹치지 않는다.** 슬롯은 *런타임·서버* 소유이고 파라미터는 *저작 시점·오프라인* 소유다. 치환 문법도 갈린다(`{today.x}`는 점을 포함해 파라미터 패턴 `\{[a-z_]+\}`에 걸리지 않는다) |
| 〃 | **정답을 바꾸지 못한다** — 실측: 본시드 live 8건 전부 정답이 주입값과 무관한 고정 문자열이다(치환 자체는 `correct_answer`에도 걸리지만 *계산*이 없다) | 템플릿이 메우는 자리가 정확히 이것이다. 파라미터는 **정답을 도출**한다 |
| `board_rules.json` + `board_engine` | 서버가 배치를 규칙으로 재판정. 클라이언트가 결과를 주입할 통로 없음 | **재사용한다.** board 템플릿은 정답을 아예 만들지 않는다(§6.2 `board_rule`) |
| `author_items.py` 저작 파이프라인 | 생성 → 게이트 → payload → 중복배제 → 시드 append | **재사용한다.** 확장기를 같은 파일에 두고, 산출물이 시드와 같은 형태라 `lint_seed_items`가 그대로 검사한다 — **새 게이트를 만들지 않았다** |

### 6.2 스키마 — 파라미터 · 인스턴스화 · 정답 도출

템플릿 = **텍스트 골격 + 파라미터 표 + 정답 도출 규칙**. 필드 정의는 정의 파일
`r13_item_templates.json`의 `schema` 블록이 소유한다(여기 다시 적지 않는다).

**인스턴스화**는 결정적이다 — 파라미터 표의 **행 순서가 곧 인스턴스 순서**이고
무작위가 없다. 같은 정의 파일에서 항상 같은 산출 파일이 나온다(재현 가능한 저작).
`knowledge_level`은 **템플릿 단위로 고정**한다: 파라미터가 단계를 바꾸면 그것은
파라미터가 아니라 다른 문항이다(`docs/specs/12` §4는 문항 단위 판정 규칙이다).

**정답 도출이 이 설계의 급소다.** 규모 때문에 사람이 정답을 검수하지 못하므로,
도출은 결정적이어야 하고 도출 규칙 자체가 검수 대상이 된다. 허용 3종:

| kind | 정답 | 오답 | 성립 조건 |
|---|---|---|---|
| `field` | 그 행의 지정 열 | **같은 표의 다른 행**(siblings) | 그 열이 행 사이에 전부 서로 달라야 한다(= 표가 "키 하나 → 정답 하나"의 함수). 위반 시 확장기가 예외 — 1차 게이트의 `options_unique`·`answer_in_options`는 "보기가 서로 다른가"만 보지 **오답이 실제로 틀렸는가**를 못 본다 |
| `formula` | 파라미터 산술식 | (slider — 없음) | 허용 문법은 이름 참조·사칙연산·숫자뿐(함수 호출·속성 접근 거부 — 저작 JSON에 임의 파이썬 통로를 만들지 않는다). slider 범위는 관용오차 ±10의 4배(40) 이상 |
| `board_rule` | **만들지 않는다** | — | `board_rules.json`의 규칙 id만 주면 `when`→palette, `then`→goal_conditions, `hint_needs`→hints가 나온다. 채점은 서버가 같은 파일로 재계산 |

`field`의 정답 위치는 `행 index % 행 수`로 **결정적으로 회전**한다. 무작위 셔플이
아닌 이유는 재현성이고, 회전이 필요한 이유는 정답이 항상 첫 칸이면 학습자가 내용을
안 보고 찍기 때문이다.

### 6.3 실증 결과 (2026-08-07)

템플릿 5 → 인스턴스 21. `lint_seed_items` **21/21 전건 통과**(게이트·payload·스키마·
중복·어휘 5종 전부, 본시드 154건 대조 포함).

| 템플릿 | 유형 | 단계 | 인스턴스 | 도출 |
|---|---|---|---|---|
| `front_passage_weather` | multiple_choice | 4 | 4 | `field` + siblings |
| `air_mass_character` | multiple_choice | 4 | 4 | `field` + siblings |
| `water_heat_quantity` | slider | 3 | 5 | `formula` (`mass * delta`) |
| `front_board_puzzle` | board | 4 | 3 | `board_rule` |
| `phase_change_naming` | cloze | 3 | 5 | `field` |

board 3건은 **실제 판정 엔진으로 풀리는지 확인했다** — palette 요소를 목표 존에
놓고 `board_engine.evaluate`를 돌려 `check_goals`가 전건 True다. 정답을 저작하지
않았는데 채점이 성립한다는 것이 `board_rule`의 근거다.

**실증이 드러낸 것 2건**
1. **slider 정답은 0~100이어야 한다.** 계약 G의 `SLIDER_MAX_SPAN`(200)과 별개로
   backend `seed_content.validate_entry`가 slider `correct_answer`를 0~100으로 좁게
   본다. `mass*delta = 150`이 여기서 탈락해 발견했다(게이트·payload는 통과했다).
2. **`board_rules.json`의 `explain`을 힌트로 복사하면 안 된다.** 규칙 해설문에
   6단계 어휘가 있다(`warm_front_steady_rain`의 "난층운" — `introduced_at` 6).
   `explain`은 **푼 뒤에** 서버가 보여주는 문자열이라 문항 텍스트가 아닌데, 힌트로
   복사하는 순간 문항 텍스트가 되어 4단계 퍼즐이 어휘 게이트에 걸린다.
   확장기는 `hint_needs`만 쓴다.

### 6.4 템플릿으로 되는 유형 / 안 되는 유형

**된다 (파라미터가 정답을 바꾸는 유형)**

| 유형 | 근거 | 규모 한계 |
|---|---|---|
| `multiple_choice` | `field`+siblings가 정답과 오답을 **한 표에서** 낸다 | 표 1개당 인스턴스 = 행 수. 오답 집합이 회전만 다르므로 같은 세션에 여러 인스턴스가 나오면 서로를 힌트로 만든다 — 세션 배합에서 같은 템플릿 1건 상한이 필요하다 |
| `slider` | 정답이 수치라 `formula`로 계산된다. **파라미터 변주의 가치가 가장 큰 유형** | 정답 0~100(§6.3-1) · 관용오차 ±10 → 실질 눈금 11칸. 정답이 10 간격이면 한 태그당 최대 11종 |
| `cloze` | `field` 한 줄. "정의 → 용어" 축이 표로 잘 떨어진다 | 정답 문자열이 곧 dedupe 키라 용어 수가 곧 상한 |
| `short_answer` | `cloze`와 같다(빈칸 유무만 다르다) | 〃 |
| `board` | 정답이 배치이고 **서버가 재판정**한다 — 저작이 만들 것은 문제뿐 | `board_rules.json`의 규칙 9개 × 존 4 = 이론상 36. 실질은 규칙별로 자연스러운 존이 정해져 더 적다 |

**안 된다 (또는 이득이 없다)**

| 유형·자리 | 왜 |
|---|---|
| `ordering` | 정답이 `"0,1,2,3"`이라 dedupe 정답 키가 **항목 수만으로** 결정된다 → **태그당 3종**(3·4·5개)이 상한이고 `pressure_front`·`air_mass`는 이미 포화. 템플릿으로 20건을 뽑아도 3건 빼고 전부 중복 탈락한다. **정답 키가 내용을 안 보는 것이 근본 원인**이라 템플릿 쪽에서 고칠 수 없다 |
| `match` | 확장은 되지만(`zip`) **이득이 없다.** pairs 3~4쌍 = 문항의 내용 전부라, 파라미터 표를 쓰는 것이 문항을 그냥 적는 것과 같은 노동이다. 골격이 재사용되지 않는다 |
| **개념 도입 문항** (1~2단계 첫 만남) | 파라미터화의 전제는 "같은 골격에 값만 다르다"인데, 도입 문항의 가치는 **그 개념 하나를 처음 만나게 하는 산문**에 있다. 값이 바뀌지 않으므로 행이 1개인 표가 되고, 그것은 템플릿이 아니라 문항이다. `docs/specs/12` §8.2가 저작 우선순위 2위로 꼽은 1단계(12건)는 **여전히 사람·LLM 저작 몫**이다 |
| **6단계 힘·정량** | 정량이라 `formula`가 맞을 것 같지만, 6단계의 어려움은 수치가 아니라 **힘의 관계를 설명하는 문장**이다(`docs/specs/12` §2.7: "어렵다가 아니라 힘과 수식이 등장한다"). 값을 바꿔도 같은 설명이 반복된다. 우선순위 1위인 6단계도 템플릿 대상이 아니다 |
| `uses_live_slots` 문항 | 지금은 슬롯이 정답을 바꾸지 못한다(§6.1). 실황 값으로 **정답이 갈리는** 문항을 만들려면 `fill_live_slots`에 조건 분기가 필요한데 그것은 서버(런타임) 변경이라 이 설계 범위 밖이다 |

**한 줄 판정**: 템플릿은 **중간 단계(3~5)의 관계·수치 문항을 늘리는 데** 강하고,
**최하단(1단계 도입)과 최상단(6단계 서술)에는 쓸 수 없다**. 그런데
`docs/specs/12` §8.2의 저작 우선순위 1·2위가 정확히 그 둘이다 — **템플릿은 G1
저작을 대체하지 않고, 4단계 과밀을 늘리지 않으면서 3·5단계를 채우는 데 쓴다.**

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

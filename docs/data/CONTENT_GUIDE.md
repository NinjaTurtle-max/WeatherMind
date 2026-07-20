# 문항 저작 가이드 (CONTENT_GUIDE)

> 대상 파일: `database/seed/content_items.json`
> 스키마 계약: docs/team/SPRINT_R2_01.md §3.3 (**고정** — 변경은 PM 보고 후 문서 선수정)
> 과학적 근거 SSOT: `database/seed/climate_concepts.json` (docs/specs/09_seed_data_spec.md의 concept_tag 6종)
> 소비자: 백엔드 적재(§3.7 content_items 테이블) · 세션 배합(§3.2) · AI 품질 게이트(§3.4)

---

## 1. 스키마 설명

시드 파일은 아래 객체의 JSON 배열이다. 필드 추가·생략·개명 금지.

| 필드 | 타입 | 규칙 |
|---|---|---|
| `concept_tag` | string | 표준 6태그 중 하나: `pressure_front` `typhoon` `air_mass` `heat_island` `co2_climate` `anomaly` |
| `level_group` | string | `elementary` \| `middle_high` \| `adult` |
| `question_type` | string | `multiple_choice` \| `short_answer` \| `slider` |
| `template_json.question_text` | string | 문항 본문. **10~300자**. 한국어 |
| `template_json.options` | string[4] | **객관식 전용**. 정확히 4개, 중복 금지. 다른 유형에서는 필드 자체를 넣지 않는다 |
| `template_json.correct_answer` | string | 객관식: options 중 하나와 **완전 일치**. 주관식: 채점 가능한 짧은 정답. 슬라이더: **0~100 숫자 문자열** (예: `"25"`) |
| `template_json.explanation_hint` | string | 선택. RAG 피드백 보조용 해설 한두 문장 |
| `uses_live_slots` | bool | 본문에 실황 슬롯을 쓰면 `true`. 슬롯 없는 문항에 `true` 금지, 슬롯 있는 문항에 `false` 금지 |
| `source` | object | `{"kind": "seed", "refs": ["climate_concepts: <tag>-<index>"]}` — 근거 청크 참조 필수 |
| `status` | string | 사람 저작 시드는 항상 `"active"` |

### source.refs 표기 규칙

근거 청크 id는 09번 스펙의 임베딩 id 규칙(`concept_tag`+태그 내 등장 순번, 0부터)을 따른다.
예: `climate_concepts.json`에서 `pressure_front`의 세 번째 청크(고기압·맑은 날씨) → `"climate_concepts: pressure_front-2"`.
근거 청크가 여러 개면 refs 배열에 모두 나열한다.

## 2. 실황 슬롯 문법과 사용 규칙

- 허용 슬롯 **5종만** 사용: `{today.temp_max}` `{today.temp_min}` `{today.sky}` `{today.rain_prob}` `{today.region}`
- 슬롯은 서빙 시점에 백엔드가 Redis weather 캐시 값으로 치환한다(§3.2 live 문항, S3).
- 표기는 위 문자열과 **완전 일치**해야 한다. 공백·오탈자(`{today.tempmax}`, `{ today.sky }`) 금지.
- 슬롯은 `question_text`에만 넣는다. options·correct_answer·explanation_hint에는 넣지 않는다.
- **정답이 슬롯 값에 의존하면 안 된다.** 슬롯은 "오늘의 맥락"을 줄 뿐, 어떤 날씨 값이 치환되어도 정답이 유일하게 유지되는 개념 문항이어야 한다.
  - 좋은 예: "오늘 {today.region}의 비 올 확률은 {today.rain_prob}%예요. 저기압이 다가오면 비 올 확률은 보통 어떻게 될까요?" → 정답 "높아진다" (치환 값과 무관)
  - 나쁜 예: "오늘 최고기온 {today.temp_max}도는 열대야 기준보다 높은가?" (그날 날씨에 따라 정답이 바뀜 → 저작 금지)

## 3. 학령별 어휘 기준

| level_group | 어휘·문장 | 예시 표현 |
|---|---|---|
| `elementary` | 쉬운 일상 어휘, 짧은 문장, "-어요/-까요?" 톤. 비유 적극 사용(담요, 공기 덩어리). 전문용어는 괄호 보충 후 사용 | "덥고 습한 공기 덩어리(북태평양 기단)" |
| `middle_high` | 교과 용어 허용(기단, 전선, 상승기류, 응결, ppm, 평년). "-는가?/-것은?" 문어체 | "한랭전선이 지나갈 때 나타나는 비의 특징은?" |
| `adult` | 교양 수준 개념(편서풍대, 대기 대순환, 적외선 흡수). 생활 응용 맥락 권장 | "내일 날씨를 예상하려면 어느 쪽 기압계를 보는가" |

숫자 정보(17m/s, 25℃, 280→420ppm, 7%/℃)는 반드시 climate_concepts.json의 수치와 일치시킨다.
**기상학적으로 틀린 서술은 P0 결함**이다(TEAM_PROCESS §2.1, 스프린트 DoD).

## 4. 품질 체크리스트 (저작 후 자가 점검)

- [ ] **유일 정답**: 정답이 하나뿐이고, 조건(계절·지역·날씨)에 따라 달라지지 않는다
- [ ] **보기 배타성**: 객관식 4보기가 서로 겹치지 않고, 오답 3개가 명백히 틀리되 그럴듯하다(같은 방향의 오답 2개 금지)
- [ ] **근거 문서 연결**: 문항의 모든 사실 서술이 refs로 지목한 climate_concepts 청크 내용과 일치한다
- [ ] **길이**: question_text 10~300자 (품질 게이트 1단 휴리스틱과 동일 기준)
- [ ] 객관식 correct_answer가 options 문자열과 완전 일치한다 (조사 하나까지)
- [ ] 슬라이더 정답이 0~100 범위 숫자 문자열이고, 단위를 question_text에 명시했다
- [ ] 주관식 정답이 한 단어~한 구(전선, 태풍의 눈)로 채점 가능하다
- [ ] 슬롯 표기가 허용 5종과 완전 일치하고 uses_live_slots 플래그가 실제 사용과 일치한다
- [ ] 학령별 어휘 기준(§3)을 지켰다
- [ ] JSON 배열 전체가 파싱된다 (`python3 -m json.tool` 통과)

## 5. 커버리지 현황 (2026-07-19 시드 v1, 총 26문항 — 자체 검증 스크립트 집계)

### 태그 × 학령

| concept_tag | elementary | middle_high | adult | 계 |
|---|---|---|---|---|
| pressure_front | 2 | 2 | 0 | 4 |
| typhoon | 3 | 2 | 0 | 5 |
| air_mass | 1 | 2 | 1 | 4 |
| heat_island | 2 | 2 | 0 | 4 |
| co2_climate | 1 | 2 | 1 | 4 |
| anomaly | 2 | 2 | 1 | 5 |
| **계** | **11** | **12** | **3** | **26** |

### 태그 × 유형

| concept_tag | multiple_choice | short_answer | slider | 계 |
|---|---|---|---|---|
| pressure_front | 3 | 1 | 0 | 4 |
| typhoon | 3 | 1 | 1 | 5 |
| air_mass | 3 | 1 | 0 | 4 |
| heat_island | 3 | 0 | 1 | 4 |
| co2_climate | 2 | 1 | 1 | 4 |
| anomaly | 4 | 0 | 1 | 5 |
| **계** | **18 (69%)** | **4** | **4** | **26** |

### 실황 슬롯 문항 (`uses_live_slots: true`) — 6건

| 태그 | 학령 | 사용 슬롯 |
|---|---|---|
| pressure_front | elementary | region, sky, rain_prob |
| typhoon | elementary | region, rain_prob |
| air_mass | adult | region |
| heat_island | elementary | region, temp_max |
| anomaly | middle_high | region, temp_max |
| anomaly | elementary | region, temp_max, temp_min |

허용 슬롯 5종 전부가 최소 1회 사용됨. 슬라이더 정답 4건: 17(태풍 풍속), 25(열대야 기준), 50(CO₂ 증가율 %), 7(수증기 증가율 %/℃) — 모두 0~100 범위.

## 6. 증보 시 절차

1. 이 가이드 §1~§4 기준으로 저작 → refs로 근거 청크 연결 (근거 없는 사실은 climate_concepts.json 증보가 선행)
2. 자체 검증 실행(아래 검사 항목을 스크립트로: JSON 파싱, 필수 필드·enum, options 4개·중복 없음, correct_answer 포함, 슬라이더 0~100, 길이 10~300, 슬롯 허용 5종·플래그 일치, 태그·학령·유형 커버리지)
3. §5 커버리지 표 갱신 → PM 리뷰 요청 (데이터 직군은 직접 커밋하지 않음)

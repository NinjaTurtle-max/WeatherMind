# 문항 저작 가이드 (CONTENT_GUIDE)

> 대상 파일: `database/seed/content_items.json`, `database/seed/board_rules.json`, `database/seed/board_test_vectors.json`
> 스키마 계약: docs/team/SPRINT_R2_01.md §3.3 + docs/team/SPRINT_R3_01.md §3.1~§3.3·§3.6 (**고정** — 변경은 PM 보고 후 문서 선수정)
> 과학적 근거 SSOT: `database/seed/climate_concepts.json` (docs/specs/09_seed_data_spec.md의 concept_tag 6종)
> 소비자: 백엔드 적재(§3.7 content_items 테이블) · 세션 배합(§3.2) · AI 품질 게이트(§3.4·R3 §3.7) · 규칙 엔진(양측 인터프리터, R3 §3.2)

---

## 1. 스키마 설명

시드 파일은 아래 객체의 JSON 배열이다. 필드 추가·생략·개명 금지.

| 필드 | 타입 | 규칙 |
|---|---|---|
| `concept_tag` | string | 표준 6태그 중 하나: `pressure_front` `typhoon` `air_mass` `heat_island` `co2_climate` `anomaly` |
| `level_group` | string | `elementary` \| `middle_high` \| `adult` |
| `question_type` | string | `multiple_choice` \| `short_answer` \| `slider` \| `board` \| `match` \| `ordering` \| `cloze` (R3 확장 7종) |
| `template_json.question_text` | string | 문항 본문. **10~300자**. 한국어 |
| `template_json.options` | string[4] | **객관식 전용**. 정확히 4개, 중복 금지. 다른 유형에서는 필드 자체를 넣지 않는다 |
| `template_json.correct_answer` | string | 객관식: options 중 하나와 **완전 일치**. 주관식·cloze: 채점 가능한 짧은 정답. 슬라이더: **0~100 숫자 문자열** (예: `"25"`). **board: 빈 문자열 `""`**(권위 채점은 board_rules 재판정). match: `"left1:right1\|left2:right2\|..."`. ordering: 원본 인덱스 정답순열(예: `"0,1,2,3"`) |
| `template_json`(신규 유형 필드) | — | §7·§8 참조. board는 `mode`·`initial_state`·`palette`·`goal_conditions`·`hints`(+guided면 `guide_steps`), match는 `pairs`, ordering은 `items`·`shuffled`, cloze는 `question_text`에 `___` 1곳 |
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

## 5. 커버리지 현황 (2026-07-21 시드 v3, 총 47문항 — 자체 검증 스크립트 집계)

> v3(R4-S5): 미니 미션 2·재현 퍼즐 2 = board 4건 추가(43→47). 상세 저작 규칙은 §10.

### 태그 × 학령

| concept_tag | elementary | middle_high | adult | 계 |
|---|---|---|---|---|
| pressure_front | 2 | 9 | 1 | 12 |
| typhoon | 3 | 3 | 1 | 7 |
| air_mass | 1 | 7 | 1 | 9 |
| heat_island | 2 | 3 | 1 | 6 |
| co2_climate | 1 | 3 | 1 | 5 |
| anomaly | 2 | 3 | 3 | 8 |
| **계** | **11** | **28** | **8** | **47** |

> R2 QA 지적(adult 시드 부족, 3건) 반영: adult를 6태그 전부 **각 1건 이상**으로 보강(총 3→6).
> v3에서 재현 퍼즐 2건이 anomaly·adult여서 adult 6→8, anomaly adult 1→3으로 늘었다.
> board 12건은 규칙 8종을 모두 커버하며 pressure_front(6)·air_mass(4)·anomaly(2)에 집중되어 middle_high·adult가 늘었다.

### 태그 × 유형

| concept_tag | mc | short | slider | board | match | ordering | cloze | 계 |
|---|---|---|---|---|---|---|---|---|
| pressure_front | 3 | 2 | 0 | 6 | 1 | 0 | 0 | 12 |
| typhoon | 4 | 1 | 1 | 0 | 0 | 1 | 0 | 7 |
| air_mass | 3 | 1 | 0 | 4 | 1 | 0 | 0 | 9 |
| heat_island | 4 | 0 | 1 | 0 | 0 | 0 | 1 | 6 |
| co2_climate | 2 | 1 | 1 | 0 | 0 | 1 | 0 | 5 |
| anomaly | 4 | 0 | 1 | 2 | 0 | 0 | 1 | 8 |
| **계** | **20** | **5** | **4** | **12** | **2** | **2** | **2** | **47** |

### 규칙 × 보드 퍼즐 (규칙마다 최소 1건 — R3-S7 AC)

| 규칙 id | 목표 현상 | 퍼즐 mode | 존 |
|---|---|---|---|
| cold_front_shower | shower | guided | 수도권 |
| warm_front_steady_rain | rain | guided | 수도권 |
| stationary_front_monsoon | persistent_rain | guided | 서해 |
| convective_shower | shower | goal_only | 태백산맥 |
| radiation_fog | fog | goal_only | 동해안 |
| north_pacific_heatwave | heatwave | goal_only | 서해 |
| siberian_snow | snow | goal_only | 서해 |
| siberian_clear | clear | goal_only | 동해안 |

### R4-S5 board 확장 4건 (미니 미션·재현 퍼즐 — §10)

| 종류 | 태그 | 학령 | 재사용 규칙 | 목표 현상 | 존 | 특수 필드 |
|---|---|---|---|---|---|---|
| 미니 미션 | pressure_front | middle_high | convective_shower | shower | 수도권 | `time_limit_sec: 60` |
| 미니 미션 | air_mass | middle_high | siberian_snow | snow | 서해 | `time_limit_sec: 90` |
| 재현 퍼즐 | anomaly | adult | north_pacific_heatwave | heatwave | 수도권 | `based_on` (2018 폭염) |
| 재현 퍼즐 | anomaly | adult | stationary_front_monsoon | persistent_rain | 수도권 | `based_on` (2020 장마) |

> 4건 모두 §7.3 전수 탐색으로 palette 내 목표 달성 배치 실존 확인(해 15·5·4·4개). 재사용 규칙은 기존 board_rules 8종이므로 규칙 파일·테스트 벡터 무변경.

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
2. 자체 검증 실행(아래 검사 항목을 스크립트로: JSON 파싱, 필수 필드·enum, options 4개·중복 없음, correct_answer 포함, 슬라이더 0~100, 길이 10~300, 슬롯 허용 5종·플래그 일치, 신규 유형 필드(§7·§8), 보드 퍼즐 해 존재(§7.3), 규칙 문법·테스트 벡터 재계산(§9), 태그·학령·유형 커버리지)
3. §5 커버리지 표 갱신 → PM 리뷰 요청 (데이터 직군은 직접 커밋하지 않음)

---

## 7. 대기 보드 퍼즐 저작 (question_type `board`)

계약: SPRINT_R3_01.md §3.1(보드 모델)·§3.2(규칙)·§3.3(퍼즐 스키마). 보드는 **비밀 정답이 없다** — 서버가 board_rules로 board_state를 재판정하는 권위 채점이므로 `correct_answer`는 항상 `""`.

### 7.1 보드 모델 요약 (§3.1)
- 존 4개 고정: index 0 서해 / 1 수도권 / 2 태백산맥 / 3 동해안.
- 배치 가능 요소 **4종만**: `air_mass`(subtype: siberian·north_pacific·yangtze·okhotsk), `front`(subtype: cold·warm·stationary), `moisture`(level 0~100), `sun`(level 0~100). **구름·현상은 출력**이지 배치 요소가 아니다.
- 존당 기단 최대 1·전선 최대 1. moisture/sun 미배치 존 기본값 = **40 / 50**.

### 7.2 template_json 필드
| 필드 | 규칙 |
|---|---|
| `question_text` | 목표를 한 문장으로. 10~300자 |
| `mode` | `guided`(지시 문구 노출) 또는 `goal_only`(목표만) |
| `guide_steps` | **guided 전용**, 배치 단계 문장 배열. goal_only에는 넣지 않는다 |
| `initial_state` | §3.1 보드. 고정 배치는 `"locked": true`. 요소 없으면 `{"zones":[...], "elements":[]}` |
| `palette` | 배치 허용 요소 목록. 표기: 기단·전선은 `"type:subtype"`(예: `front:cold`), 레벨 요소는 `"moisture"`·`"sun"`. **제약이 재미** — goal 달성에 꼭 필요한 최소 요소만 넣는다(예: 대류성 소나기 퍼즐은 전선을 빼 `["sun","moisture"]`만) |
| `goal_conditions` | `[{"zone":n,"phenomenon":"..."}]` AND. phenomenon은 §3.2 enum |
| `hints` | 2단계 힌트. 1단계는 개념 유도, 2단계는 배치 힌트 |

### 7.3 목표 달성 가능성 자가 검증법 (필수)
**모든 퍼즐은 palette만으로 goal을 만족시키는 배치가 실존해야 한다.** 아래 절차로 손·스크립트 양쪽에서 확인한다.

1. **해 후보 도출**: goal의 phenomenon을 만드는 규칙을 board_rules에서 찾고, 그 규칙의 `when` 조건을 모두 참으로 만드는 배치를 palette 요소로 구성한다. (예: goal=shower, 전선 없는 palette → `convective_shower`의 `sun>=80 & moisture>=60`을 목표 존에 세팅)
2. **간섭 규칙 배제**: 같은 존에서 그 배치에 더 높은 priority 규칙이 성립하지 않는지 확인한다. palette에 해당 요소가 없으면 성립 불가이므로, **최소 palette가 곧 간섭 차단**이다(예: heatwave 퍼즐에 moisture를 넣지 않으면 기본값 40으로 convective(≥60) 성립 불가).
3. **벡터식 도출**: 목표 존을 §3.2 판정 의미론(존별 성립 규칙 중 priority 최고 1개, 없으면 cloudy/cumulus)으로 손으로 계산해 goal과 일치함을 확인한다.
4. **스크립트 확인**: palette 요소를 각 존·레벨 격자(0,20,30,40,50,60,70,80,85,100)에 배치하는 조합을 전수 탐색해 goal을 만족하는 배치가 하나라도 있으면 통과. (제약: 존당 기단/전선/습기/일사 각 ≤1) — R3-S7 검증 스크립트가 이 방식이다.

## 8. 신규 유형 3종 (match / ordering / cloze) — §3.6

| 유형 | 필수 필드 | 저작 규칙 |
|---|---|---|
| `match` | `pairs: [{"left","right"}]` (**3~4쌍**), `correct_answer` | left·right 각각 중복 금지. left는 짧은 항목, right는 그 짝. `correct_answer`는 `"left:right\|..."`를 **pairs 순서대로** 이어 붙인 문자열과 정확히 일치. options 필드 금지 |
| `ordering` | `items: [...]` (**3~5개, 정답 순서로 저작**), `shuffled: true`, `correct_answer` | items에 시간·인과 순서가 명확한 단계를 정답 순서로 나열. 중복 금지. 프론트가 표시 시 섞으므로 `correct_answer`는 원본 인덱스 항등순열 `"0,1,2,...,n-1"` |
| `cloze` | `question_text`에 `___` **정확히 1곳**, `correct_answer` | 빈칸에 들어갈 한 단어~한 구. short_answer와 동일 채점(공백·대소문자 무시). options 금지. 숫자 답도 문자열(예: `"25"`) |

세 유형 모두 `correct_answer`가 **슬롯 값·조건에 무관하게 유일**해야 한다(§4 유일 정답). match/ordering은 uses_live_slots 항상 false 권장.

## 9. 규칙 파일 저작 (`board_rules.json` / `board_test_vectors.json`) — §3.2

- **조건 문법 2형만**: `"<type>:<subtype>"`(존재 검사, type∈front·air_mass), `"<field><op><숫자>"`(field∈moisture·sun, op∈`>=`·`<=`). 그 외 금지.
- **priority 전역 유일 권장**: 같은 존에서 두 규칙이 같은 priority로 동시 성립하면 판정이 모호해진다. v1은 8종에 priority 30~100을 10 간격으로 부여해 **전 조건공간에서 tie가 없음**을 스크립트로 확인했다(설계표는 팀 보고 참조). 새 규칙 추가 시 전 조건공간 tie-free를 재확인한다.
- 경계값·priority는 기상학적 타당성으로 정하되 climate_concepts와 정합해야 하고, `explain`은 중고등 눈높이 교육 문장으로 쓴다.
- `board_test_vectors.json`은 **백엔드(Py)·프론트(JS) 테스트가 공동 의존**하는 동일 판정 보증 자산이다. 기대값(`expected`, 존 4개 전부)은 §3.2 의미론으로 **손으로 도출**하고, 검증 스크립트가 규칙 인터프리터로 재계산해 일치를 확인한다. 규칙을 바꾸면 벡터 기대값을 반드시 재도출한다.

---

## 10. 미니 미션·재현 퍼즐 저작 (board 확장) — SPRINT_R4_01.md §3.5

미니 미션과 재현 퍼즐은 **일반 board 퍼즐(§7)에 template_json 선택 필드 하나를 더한 것**이다. 보드 모델·palette·goal·해 존재 검증(§7.1~§7.3)은 그대로 적용되며, 서버 채점기도 기존 board 채점기를 그대로 쓴다(시간은 v1에서 클라이언트 신고 — 부채). 새 규칙을 만들지 말고 **기존 board_rules 8종으로 달성 가능한 palette·goal**만 저작한다.

### 10.1 미니 미션 (`time_limit_sec`)

| 필드 | 규칙 |
|---|---|
| `time_limit_sec` | **60~120 정수**. 프론트가 카운트다운, 초과 시 실패(재도전 무제한). 품질 게이트 §3.6이 범위·정수 검사 |

- **palette 최소·시간압박 성립**: 목표 달성에 꼭 필요한 요소만 넣어(§7.2), 정해진 배치 수가 제한 시간 안에 끝낼 만큼 적어야 한다. 배치 1~2개 + 레벨 1~2개로 끝나는 goal이 적절하다. palette가 크면 탐색이 길어져 시간압박이 성립하지 않는다.
- `based_on`은 넣지 않는다. mode는 `goal_only` 권장(시간 승부에 guide_steps 노출은 부적합).
- 예: `palette: ["sun","moisture"]`, `goal: [{"zone":1,"phenomenon":"shower"}]`, `time_limit_sec: 60` → 대류성 소나기(convective_shower). 60초 안에 일사·습기 두 값만 올리면 된다.

### 10.2 재현 퍼즐 (`based_on`)

| 필드 | 규칙 |
|---|---|
| `based_on` | `{"event_name","event_date","region"}` **3필드 모두 필수**. `concept_tag`는 반드시 `anomaly`. 품질 게이트 §3.6이 3필드 존재 + anomaly 태그를 검사 |

- **실제 한국 이상기상 사건 기반**: event_name·event_date·region은 실측 근거가 있는 사건이어야 하고, 저작 시 KMA 관측 사실을 확인한다(허구·미확인 사건 금지). 프론트가 "실화 배지"로 사건명·날짜를 노출하므로 사실 오류는 대외 신뢰 문제다.
- **기상 메커니즘 = 재사용 규칙**: 사건의 성인(成因)에 맞는 기존 규칙을 골라 palette·goal을 구성한다. 예) 폭염 사건 → north_pacific_heatwave(북태평양 기단+일사), 장마 사건 → stationary_front_monsoon(정체전선+습기).
- `source.refs`는 anomaly 청크(이상기후 정의·온난화)로 이상기상 프레이밍을 잡고, 메커니즘 청크(air_mass·pressure_front)를 함께 나열해 성인 서술을 근거화한다.
- goal의 `zone`은 사건 지역과 최대한 정합하는 존을 고른다(수도권 사건 → 존 1 등). `based_on.region`은 사건의 실제 지역 표기(자유 서술)이고 존 이름과 일치할 필요는 없다.

### 10.3 v3 채택 사건 사실 근거

| event_name | event_date | 사실 근거 (KMA 관측) | 재사용 규칙 |
|---|---|---|---|
| 2018년 기록적 폭염 | 2018-08-01 | 2018-08-01 홍천 41.0℃로 한국 기상관측 사상 최고기온 경신, 같은 날 서울 39.6℃(1907년 관측 이래 최고). 강한 북태평양 고기압 지배가 성인 | north_pacific_heatwave |
| 2020년 중부지방 역대 최장 장마 | 2020-08-16 | 2020년 중부지방 장마가 6/24~8/16 **54일** 지속, 종전 최장(2013년 49일)을 경신한 역대 최장. 정체전선(장마전선)이 성인 | stationary_front_monsoon |

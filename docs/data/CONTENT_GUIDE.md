# 문항 저작 가이드 (CONTENT_GUIDE)

> 대상 파일: `database/seed/content_items.json`, `database/seed/board_rules.json`, `database/seed/board_test_vectors.json`, `database/seed/units.json`(§11), `database/seed/board_regions.json`(§12)
> 스키마 계약: docs/team/SPRINT_R2_01.md §3.3 + docs/team/SPRINT_R3_01.md §3.1~§3.3·§3.6 + docs/team/SPRINT_R5_01.md §3.1~§3.2 (**고정** — 변경은 PM 보고 후 문서 선수정)
> 과학적 근거 SSOT: `database/seed/climate_concepts.json` (docs/specs/09_seed_data_spec.md의 concept_tag 6종)
> 소비자: 백엔드 적재(§3.7 content_items 테이블) · 세션 배합(§3.2) · 커리큘럼 API(R5 §3.2) · AI 품질 게이트(§3.4·R3 §3.7·R5 §3.6) · 규칙 엔진(양측 인터프리터, R3 §3.2)

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

## 5. 커버리지 현황 (2026-07-29 시드 v5, 총 53문항 — 자체 검증 스크립트 집계)

> v3(R4-S5): 미니 미션 2·재현 퍼즐 2 = board 4건 추가(43→47). 상세 저작 규칙은 §10.
> v4(R7-01 S4): 배치고사 커버리지 보강 — air_mass·adult 비-live 문항 2건 추가(47→49).
> v5(R7-02 S8): 배치 취약 셀 보강 — air_mass·elem / anomaly·elem / pressure_front·adult /
> typhoon·adult 비-live 문항 4건 추가(49→53).
> 감사 근거·매트릭스는 docs/data/PLACEMENT_COVERAGE_R7.md(§6이 v5분).

### 태그 × 학령

| concept_tag | elementary | middle_high | adult | 계 |
|---|---|---|---|---|
| pressure_front | 2 | 9 | 2 | 13 |
| typhoon | 3 | 3 | 2 | 8 |
| air_mass | 2 | 7 | 3 | 12 |
| heat_island | 2 | 3 | 1 | 6 |
| co2_climate | 1 | 3 | 1 | 5 |
| anomaly | 3 | 3 | 3 | 9 |
| **계** | **13** | **28** | **12** | **53** |

> R2 QA 지적(adult 시드 부족, 3건) 반영: adult를 6태그 전부 **각 1건 이상**으로 보강(총 3→6).
> v3에서 재현 퍼즐 2건이 anomaly·adult여서 adult 6→8, anomaly adult 1→3으로 늘었다.
> board 12건은 규칙 8종을 모두 커버하며 pressure_front(6)·air_mass(4)·anomaly(2)에 집중되어 middle_high·adult가 늘었다.

### 태그 × 유형

| concept_tag | mc | short | slider | board | match | ordering | cloze | 계 |
|---|---|---|---|---|---|---|---|---|
| pressure_front | 3 | 2 | 0 | 6 | 1 | 1 | 0 | 13 |
| typhoon | 4 | 1 | 1 | 0 | 1 | 1 | 0 | 8 |
| air_mass | 4 | 3 | 0 | 4 | 1 | 0 | 0 | 12 |
| heat_island | 4 | 0 | 1 | 0 | 0 | 0 | 1 | 6 |
| co2_climate | 2 | 1 | 1 | 0 | 0 | 1 | 0 | 5 |
| anomaly | 4 | 0 | 1 | 2 | 0 | 0 | 2 | 9 |
| **계** | **21** | **7** | **4** | **12** | **3** | **3** | **3** | **53** |

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

---

## 11. 커리큘럼 저작 (`units.json`) — SPRINT_R5_01.md §3.2

단계형 유닛 학습의 유닛 트리. 유닛은 **문항을 담지 않고** `kind`+`concept_tag`로 기존 `content_items` 문항 풀을 가리킨다(content_items에 unit_id를 넣지 않음 → R2~R4 시드 하위 호환). 진도는 왕관(crowns), 잠금은 선행 유닛으로 표현한다.

### 11.1 스키마 (필드 추가·개명 금지)

| 필드 | 타입 | 규칙 |
|---|---|---|
| `id` | string | **위치 무관 안정 slug**(예: `read-sky-fronts`). `s1u2` 같은 위치 인코딩 금지 — 재정렬 시 깨진다. FK로 참조되므로 한번 발행하면 불변 |
| `section` | string | 계약 4섹션 중 하나: `하늘 읽기` `공기의 힘` `큰 바람` `도시와 기후` (관측보고서 №2 §4.2, **고정**) |
| `unit_order` | int | 섹션 내 표시 순서, **1부터**. 같은 섹션 안에서 유일 |
| `title` | string | 유닛 제목(한국어) |
| `concept_tag` | string | 표준 6태그 중 하나(§1). 문항 풀 결정 키 |
| `prereq_unit_id` | string\|null | 직전 유닛 `id` 또는 `null`. 이 유닛이 열리려면 선행 유닛 crowns≥1(R5 §3.2 잠금 규칙) |
| `kind` | string | `quiz`(문항 세션) \| `board`(대기 보드 퍼즐) |
| `crown_target` | int | 완전 클리어에 필요한 왕관 수(≥1). 기본 1. board 유닛은 반복 퍼즐이 여러 개면 2 이상 가능 |

### 11.2 트리·잠금 규칙 (linear chain)

- **선형 사슬**: 전체에서 `prereq_unit_id=null`은 **딱 1개**(맨 첫 유닛). 각 섹션의 첫 유닛은 이전 섹션의 마지막 유닛을 선행으로 가리켜, 섹션이 순서대로 열린다(순서대로 클리어·유닛 트리 지시 반영). 판정은 백엔드가 crowns로 하고, 시드는 사슬 구조만 정의한다.
- **unit_order 유일**: 같은 섹션 내에서 중복 금지(정렬·표시용).
- **순환 금지**: prereq를 따라가면 반드시 null에서 끝나야 한다(사이클 없음).
- 유닛 수 **8~12개**(현재 12개).

### 11.3 유닛 ↔ 문항 풀 연결 규칙 (핵심 무결성)

유닛은 세션 발급 시 `kind`+`concept_tag`로 `content_items`에서 문항을 뽑는다. 따라서 **문항 풀이 실재해야** 유닛이 성립한다.

- **quiz 유닛**: 해당 `concept_tag`의 **비-board 문항**(quiz 세션이 서빙하는 유형: mc·short·slider·match·ordering·cloze)이 **최소 2건** 있어야 한다.
- **board 유닛**: 해당 `concept_tag`의 **board 퍼즐(`question_type=="board"`)이 최소 1건** 있어야 한다. → board 유닛은 board 퍼즐이 실재하는 태그에만 배정한다.
- 현재 `content_items.json`(53건)의 태그별 풀: board 퍼즐은 **pressure_front(6)·air_mass(4)·anomaly(2)** 에만 존재(typhoon·heat_island·co2_climate은 0). 따라서 board 유닛은 이 3태그로 한정된다. anomaly board 2건은 실화 재현 퍼즐(2018 폭염·2020 장마, §10.3)로 `도시와 기후` 섹션 주제와 정합한다.
- 같은 `concept_tag`를 여러 quiz 유닛이 공유하면 문항 풀이 동일하다(pool = kind+concept_tag). 유닛 수 10~12는 태그 6종·board 3태그 제약상 일부 태그 재사용이 불가피하다 — v1 허용, 유닛은 개념 진행(기초→심화)으로 구분한다.

### 11.4 현재 유닛 구조 (2026-07-21, units.json v1 — 12유닛 4섹션)

| 섹션 | # | id | kind | concept_tag | 선행 | 문항 풀 |
|---|---|---|---|---|---|---|
| 하늘 읽기 | 1 | read-sky-pressure | quiz | pressure_front | ∅(첫 유닛) | quiz 7 |
| 하늘 읽기 | 2 | read-sky-fronts | quiz | pressure_front | read-sky-pressure | quiz 7 |
| 하늘 읽기 | 3 | read-sky-board | board | pressure_front | read-sky-fronts | board 6 |
| 공기의 힘 | 1 | air-power-masses | quiz | air_mass | read-sky-board | quiz 8 |
| 공기의 힘 | 2 | air-power-transform | quiz | air_mass | air-power-masses | quiz 8 |
| 공기의 힘 | 3 | air-power-board | board | air_mass | air-power-transform | board 4 |
| 큰 바람 | 1 | big-wind-birth | quiz | typhoon | air-power-board | quiz 8 |
| 큰 바람 | 2 | big-wind-lifecycle | quiz | typhoon | big-wind-birth | quiz 8 |
| 도시와 기후 | 1 | city-heat-island | quiz | heat_island | big-wind-lifecycle | quiz 6 |
| 도시와 기후 | 2 | city-greenhouse | quiz | co2_climate | city-heat-island | quiz 5 |
| 도시와 기후 | 3 | city-anomaly | quiz | anomaly | city-greenhouse | quiz 7 |
| 도시와 기후 | 4 | city-anomaly-board | board | anomaly | city-anomaly | board 2 |

### 11.5 증보·검증 절차

1. §11.1~§11.3 기준으로 저작 → 안정 slug 발행(위치 무관).
2. 자체 검증(스크립트): JSON 파싱, 필수 필드·enum(section 4·concept_tag 6·kind 2), unit_order 섹션 내 유일, prereq 존재·순환 없음·null 정확히 1개, quiz 풀≥2·board 퍼즐≥1을 `content_items.json` 대조로 확인. (R5 §3.6 품질 게이트 `POST /internal/curriculum-validate`와 동일 규칙.)
3. §11.4 표 갱신 → PM 리뷰 요청(데이터 직군 직접 커밋 없음).

---

## 12. 지도 지역 좌표 (`board_regions.json`) — SPRINT_R5_01.md §3.1

R3 추상 4존 단면 보드를 한반도 지도 위 지역 노드로 렌더하기 위한 **좌표 전용** 파일. board_engine 판정 로직·zone 필드 의미는 **불변**이며 이 파일은 **판정에 미사용**(렌더 전용). 존 index 0~3 ↔ 지도 지역 고정 매핑만 추가한다.

### 12.1 스키마

| 필드 | 규칙 |
|---|---|
| `zone` | 존 index **0~3**(board_state zone과 동일 의미). 배열은 0,1,2,3 순서 |
| `name` | **계약 고정** 4지역: `서해상`·`수도권`·`영서·태백`·`영동·동해`(R5 §3.1). 변경 금지 |
| `svg_point` | 지도 SVG 위 노드 좌표 `[x,y]`, **정규화 0~100**. 요소 드롭 지점 |
| `label_anchor` | 지역 라벨 텍스트 앵커 `[x,y]`, 정규화 0~100 |

### 12.2 좌표 배치 원칙

한반도 단순 배치의 정규화 좌표(0=좌/상, 100=우/하): **서해상 왼쪽 → 수도권 중앙 → 영서·태백 오른쪽 위 → 영동·동해 오른쪽**. 좌표는 렌더 심미성 값이며 판정과 무관하므로 프론트 지도 SVG에 맞춰 조정 가능(단 name·zone 매핑은 고정).

| zone | name | svg_point | label_anchor |
|---|---|---|---|
| 0 | 서해상 | [20, 45] | [18, 56] |
| 1 | 수도권 | [42, 38] | [42, 49] |
| 2 | 영서·태백 | [62, 30] | [62, 21] |
| 3 | 영동·동해 | [78, 42] | [82, 52] |

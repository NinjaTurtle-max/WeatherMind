# RESEARCH — MT-8 · MT-10 · MT-11 (난이도 3건) 실측 근거

**작성 2026-08-18 · 읽기 전용 조사 · 판단 없음(층 선택은 어드바이저·클라이언트 몫)**
측정 대상 워킹트리: `feat/board-progression-mt24` (조사 중 코드·시드 수정 0건)

> ⚠️ **이 문서의 모든 숫자에는 날짜가 붙어 있다.** 이 저장소의 기록된 실패 모드가
> "낡은 대장 행을 인용했다"이므로, 대장(`docs/team/CARRYOVER_R13.md`)의 08-10~08-14
> 판정은 **승계하지 않고 08-18에 다시 쟀다**. 재측 결과 **대장 행 3개가 낡았다**(§0).

---

## §0 먼저 — 대장이 낡은 곳 3건 (08-18 재측)

| 대장 행 | 대장이 적은 것 | 08-18 실측 | 귀결 |
|---|---|---|---|
| `CARRYOVER_R13.md:2027` **MT-10** | 「`placement_service.py:54` `LEVEL_GROUPS` **3종** — 배치 **6문항**이 expert를 원리적으로 못 뽑음」 | **둘 다 낡았다.** ⑴ `PLACEMENT_SIZE`는 **10**이다(`backend/app/core/config.py:190`) ⑵ `plan_placement_picks`는 **신고 학령을 아예 보지 않고 지식 단계(kl)로 뽑는다**(`backend/app/services/placement_service.py:196-214`, 독스트링이 *"신고 학령을 보지 않는다"*고 자인) ⑶ `ADJACENT_GROUPS`에 **expert가 들어와 있다**(`placement_service.py:79-83`) | **MT-10의 종전 근거는 소멸했다.** 같은 대장의 `:2592`(「닫힘 08-13」)가 현재 상태이고 `:2027`이 낡은 행이다. MT-10의 잔여 공백을 다시 정의해야 한다 |
| `CARRYOVER_R13.md:2028` **MT-11** | 「`users.tone` 기입 코드 0 → **초등이 한다체 문항을 그대로 받음**」 | **앞뒤 모두 재확인했고, §5.2의 정정이 옳다** — writer 0은 08-18에도 참이지만(§1.3) 「그래서 초등이 한다체를 받는다」의 인과는 틀렸다. 톤은 파생되고 있고(`effective_tone`), 진짜 공백은 **소비처 0 + 콘텐츠 톤 축 0**이다 | MT-11의 대상은 「writer 추가」가 아니다(§1·§4) |
| `CARRYOVER_R13.md:2303` **CO-Y-7** | 「시드 톤이 갈려 있다 — **해요체 94건(24%)** · 나머지 304건」(08-10) | 분모 94+304=398이 시드 총량과 다르다(부분 집합 측정). **08-18 전건 재측: 1,015건 전수**로 다시 냈다(§1.4·§2.2) | CO-Y-7의 방향(톤 혼재)은 참, **수치는 대체**한다 |

시드 총량도 어긋난다: `CLAUDE.md`는 **1,012건**(08-12), 08-18 실측은 **1,015건**
(`database/seed/content_items.json`, `status` 전건 `active`, 미승격/은퇴 행 0).
유형 `multiple_choice 310 · cloze 158 · short_answer 155 · match 125 · ordering 111 · slider 107 · board 49`.

---

## §1 조사 1 — 「톤 축이 정말 0건인가」

### 1.1 시드에 톤 필드는 **없다** (0건)

`database/seed/content_items.json` **1,015건의 최상위 키 전수**(08-18):

```
concept_tag · knowledge_level · level_group · question_type · source · status
· template_json · uses_live_slots
```

`template_json` 내부 키 **전수**(1,015건 합집합):

```
based_on · board_order · correct_answer · explanation_hint · goal_conditions
· guide_steps · hints · initial_state · items · max · min · mode · options
· pairs · palette · question_text · shuffled · step · summary · time_limit_sec
· title · unit
```

**`tone`·`voice`·`register`·`style` — 어느 층에도 0건.** 문자열 검색으로도
`"tone"` / `"voice"` / `"register"` 리터럴 **0회**.

### 1.2 서버 모델·스키마에는 톤 축이 **있다**(사용자 축만)

| 무엇 | 위치 | 값 |
|---|---|---|
| DB 컬럼 | `backend/app/models/user.py:91` | `tone: Mapped[str \| None]`, `String(16)`, nullable |
| CHECK 제약 | `backend/app/models/user.py:26` | `tone IS NULL OR tone IN ('child','teen','adult')` |
| 마이그레이션 | `backend/alembic/versions/20260806_0012_two_axis_levels.py:74·86` | 컬럼 추가 + 제약 |
| 값 집합 | `backend/app/services/weatherbrain_service.py:188` | `TONES = ("child","teen","adult")` |
| 폴백 파생표 | `backend/app/services/weatherbrain_service.py:191-196` | `elementary→child · middle_high→teen · adult→adult · expert→adult` |
| 파생 함수 | `backend/app/services/weatherbrain_service.py:313` | `effective_tone(user)` — 저장값이 `TONES` 밖이면 파생 경로로 방어 |
| API 노출 | `backend/app/routers/progress.py:133` → `backend/app/schemas/progress.py:65` | `GET /progress/me` 응답에 `tone: str = "teen"` |
| 목 | `frontend/mock/apiMockPlugin.js:891` | 목도 파생 경로로 같은 값을 낸다 |

**⚠️ 콘텐츠 축(`content_items`)에는 톤이 없고, 사용자 축(`users`)에만 있다.**

### 1.3 `users.tone` **writer는 08-18에도 0건**

전 저장소 검색(`backend/app` · `ai-worker/app` · `frontend/src` · `frontend/mock`)에서
`tone` 에 값을 **대입하는 코드 0건**. 히트는 전부 ⑴ 마이그레이션 DDL ⑵ 읽기(`effective_tone`)
⑶ Tailwind 색상 변수(`FeedbackPanel.jsx`·`DevPanel.jsx`의 `tone` = 색 톤, 무관)다.
`PATCH /auth/me`(`routers/auth.py` `update_me` — 학령 변경 통로)에도 `tone` **0회**.

즉 **`users.tone`은 전 유저 NULL이고, 실질 톤은 항상 `LEVEL_GROUP_TONE` 파생값**이다.

### 1.4 🔴 **핵심 — 파생된 톤을 읽는 소비처가 0건이다**

| 소비 후보 | 08-18 실측 |
|---|---|
| 백엔드 — 문항/해설 텍스트를 톤으로 다시 쓰는 코드 | **0건**. `effective_tone`의 호출처는 `routers/progress.py:133` **하나뿐**이고 용도는 응답에 실어 보내는 것이다 |
| 프론트 — `GET /progress/me`의 `tone` 필드를 읽는 코드 | **0건**. `/progress/me`를 부르는 파일 10개(`api/progress.js`·`ProgressPage.jsx`·`KnowledgeLevelCard.jsx`·`Layout.jsx`·`SpineBadge.jsx`·`onboardingGate.js` 등) 어디에서도 `.tone`을 참조하지 않는다 |
| ai-worker — 톤별 생성 | **하지 않는다.** 프롬프트가 명시적으로 금지한다(아래) |

`ai-worker/app/chains/quiz_gen_chain.py:82-84` (프롬프트 규칙 5, 원문):

> 5. 표현 톤은 teen(한다체) **한 벌만** 쓴다 — 평서는 "~한다", 질문은 "~인가/~하는가"로
>    끝낸다. 해요체·합니다체·감탄부호·2인칭 호칭을 쓰지 말 것. 같은 문항을 톤별로 여러 벌
>    만들지 말 것(**어린이·성인 말투는 런타임의 결정적 어미 치환이 담당한다**).

**그 「런타임의 결정적 어미 치환」은 저장소에 존재하지 않는다**(08-18 재확인 — 대장
CO-Y-6이 08-10에 처음 적었고 그 뒤 54커밋에도 안 생겼다). 같은 파일 `:195-200`은
폴백 뱅크가 이미 톤 혼재 상태임을 자인하며 *"되톤은 데모에 보이는 문자열을 바꾸는
작업이라 별도 판단이 필요하다(이월)"*라고 적었다.

### ✅ §1 답 — **지적은 참이다. 단, 「0건」의 대상을 정확히 해야 한다.**

- **콘텐츠 톤 축**: 0건 (시드 1,015건 전수)
- **사용자 톤 축**: **있다** — 컬럼·제약·파생표·파생함수·API 노출까지 전부 서 있다
- **writer**: 0건 (파생만 됨)
- **소비처**: **0건** ← 대장 §5.2가 「파생된 톤이 소비할 대상이 없다」로 지목한 그 자리
- **그러므로**: 「writer 0」을 고쳐도(= 가입 화면에 톤 선택을 붙여도) **화면의 문장은
  한 글자도 안 바뀐다.** 파이프의 양 끝(파생·노출)은 이미 있고 **가운데(적용)가 없다.**

---

## §2 조사 2 — 「초등이 실제로 받는 문장이 지금 무엇으로 갈리는가」

### 2.1 `level_group`은 **선택**에만 쓰이고 **표현**은 안 바꾼다

| 경로 | 위치 | 하는 일 |
|---|---|---|
| 뱅크 풀 필터 | `backend/app/services/session_service.py:561` | `ContentItem.level_group.in_(level_groups)` — **어느 문항을 뽑을지** |
| 난이도 정렬 | `session_service.py:582` | `abs(coalesce(ItemParam.b, prior_b) − θ)` 오름차순 — **순서** |
| 사전 b | `weatherbrain_service.py:134-140` | `elementary −1.0 · middle_high 0.0 · adult 1.0 · expert 2.0` |
| 페이로드 조립 | `backend/app/routers/session.py:106-140` `_to_session_item` | `question_text=question.get("question_text","")` (`:129`) — **원문 그대로**, 가공 0 |

**`level_group`이 문장 표현을 바꾸는 코드는 0건.** 초등 학습자가 보는 문장은
**시드에 저작된 바이트 그대로**다.

**단 하나의 런타임 텍스트 변환 선례**는 실황 슬롯이다 —
`session_service.fill_live_slots`(`:235-264`)가 `template_json`의 **모든 문자열 필드를
재귀 치환**한다(`question_text`·`options`·`correct_answer` 포함). 즉 "발급 시점에
문항 텍스트를 다시 쓰는 자리"는 **이미 있고 계약도 서 있다**(§4 후보 (i)의 근거).

### 2.2 그래서 초등이 실제로 받는 문말 — 08-18 전수 측정

**분류기**(문서에 박아 재현 가능하게 둔다). 마지막 문장(`(?<=[.!?])\s+`로 분리한
꼬리)의 끝 구두점·따옴표를 떼고:

```
polite(존댓)          = /(요|니다|니까|시오|세요)$/      # 해요체·합니다체·하십시오체
plain-imperative(해라체) = /(하라|어라|아라|여라|보라|하자|보자|해라)$/
plain(한다체)          = 끝이 '다' | '까' | '가'
other                 = 수치·단위·명사·빈칸(___)으로 끝남
empty                 = 필드 없음/빈 문자열
```

#### `explanation_hint` (= 채점 후 학습자가 읽는 해설) — kl별

| kl | polite | plain(한다체) | other | empty | polite 비율 |
|---:|---:|---:|---:|---:|---:|
| 1 | 13 | **86** | 0 | 0 | 13% |
| 2 | 31 | **68** | 0 | 2 | 31% |
| 3 | 13 | 81 | 0 | 5 | 13% |
| 4 | 28 | 59 | 0 | 22 | 26% |
| 5 | 44 | 53 | 0 | 5 | 43% |
| 6 | 0 | 101 | 0 | 0 | **0%** |
| 7 | 5 | 91 | 1 | 1 | 5% |
| 8 | 2 | 98 | 0 | 1 | 2% |
| 9 | 0 | 101 | 0 | 0 | **0%** |
| 10 | 4 | 99 | 0 | 1 | 4% |
| **계** | **140** | **837** | 1 | **37** | 14% |

#### `question_text` — kl별

| kl | polite | plain(한다체) | 해라체 명령 | other | polite 비율 |
|---:|---:|---:|---:|---:|---:|
| 1 | 17 | 56 | 21 | 5 | 17% |
| 2 | 27 | 36 | 27 | 11 | 27% |
| 3 | 7 | 36 | 24 | 32 | 7% |
| 4 | 31 | 36 | 22 | 20 | 28% |
| 5 | 24 | 31 | 34 | 13 | 24% |
| 6 | **0** | 72 | 28 | 1 | 0% |
| 7 | 4 | 47 | 25 | 22 | 4% |
| 8 | **0** | 40 | 33 | 28 | 0% |
| 9 | 1 | 51 | 29 | 20 | 1% |
| 10 | **0** | 74 | 25 | 5 | 0% |
| **계** | **111** | **479** | **268** | **157** | 11% |

#### 🔴 초등 밴드(`level_group = elementary`, **kl 1~2, 200건**) 요약

| 필드 | polite(존댓) | plain(한다체) | 해라체 명령 | other | empty |
|---|---:|---:|---:|---:|---:|
| `question_text` | **44 (22%)** | 92 | 48 | 16 | 0 |
| `explanation_hint` | **44 (22%)** | **154 (77%)** | 0 | 0 | 2 |

**초등 학습자가 받는 해설의 77%가 한다체다.** 질문도 70%(92+48)가 비존댓이다.

초등 밴드 한다체 실물(`level_group=elementary`, kl2):

```
Q: '밤 최저기온이 ___℃ 아래로 내려가지 않는 밤을 열대야라고 한다.'
E: '열대야는 낮이 얼마나 더웠는지가 아니라 밤에 얼마나 못 식었는지를 보는 기준이다. …'

Q: '바람이 부는 방향에 대한 설명으로 옳은 것은?'
E: '공기는 눌리는 힘이 센 쪽에서 약한 쪽으로 밀려 간다. 그래서 바람은 기압이 높은 …'
```

같은 밴드의 해요체 실물(kl1):

```
Q: '태풍이 우리 동네를 지나갈 때 가장 안전한 행동은 무엇일까요?'
E: '태풍이 지나는 동안에는 밖에 나가지 않는 것이 가장 안전해요. …'
```

**혼재의 경계는 저작 배치다** — 초등 200건을 `source.refs`의 스프린트 태그로 갈라 보면:

| 저작 출처 | polite | plain |
|---|---:|---:|
| `sprint: R12 AU-2` | **20** | 1 |
| 스프린트 태그 없음(R2~R11 구 저작) | 20 | **117** |
| `R13 잔여 웨이브 CO-A2/CO-K4` | 0 | 6 |
| `R13 2일차 CT-2 판정` 계열 | 0 | 9 |
| `R13_01 §2.4 wildfire_` | 0 | 4 |

**R13 이후 저작분은 전부 한다체**다(프롬프트 규칙 5가 저작 기준선이라 사람 저작도
그 톤을 따랐다). 즉 **저작이 진행될수록 초등의 한다체 비율은 올라간다.**

### 2.3 `knowledge_level`(kl) ↔ `level_group` 관계 — 08-18 실측 **1:1 격자**

`weatherbrain_service.level_group_of_knowledge_level`(`:199`)의 파생표대로 시드가
정확히 갈려 있다(교차 위반 0건):

| level_group | kl | 건수 |
|---|---|---:|
| elementary | 1, 2 | 200 (99+101) |
| middle_high | 3, 4 | 208 (99+109) |
| adult | 5, 6 | 203 (102+101) |
| expert | 7, 8, 9, 10 | 404 (98+101+101+104) |

`effective_level_group(item)`(`weatherbrain_service.py` 파생 뷰)은 kl이 있으면 kl에서
파생하고, 없으면 저장된 `level_group`을 그대로 쓴다 — 08-18 시드에 kl 미분류 **0건**이라
두 축은 현재 완전히 중복이다. **표현(`tone`)·난이도(kl)의 2축 분리**는 설계 문서
(`docs/specs/12 §5.3`, `schemas/progress.py:66-67`)에 적혀 있으나 **데이터에서는 아직
한 축**이다.

---

## §3 조사 3 — 「난이도 하향(MT-8)의 대상이 무엇인가」

### 3.1 전역 난이도 다이얼은 **없다** (대장 `:2025` 재확인 — 여전히 참)

`backend/app/core/config.py`에 `DIFFICULTY*` 설정 **0건**. 난이도를 정하는 것은 둘뿐:

1. **풀 필터** — `level_group.in_(...)` (`session_service.py:561`)
2. **정렬** — `abs(coalesce(ItemParam.b, prior_b) − θ)` (`session_service.py:582`)

즉 출제는 **"θ에 가장 가까운 b"**를 고르는 적응 정렬이고, **"한 칸 쉽게"라는 오프셋을
넣을 자리가 없다.** (`prior_b`는 `LEVEL_GROUP_ITEM_B` = `elementary −1.0 / middle_high 0.0 /
adult 1.0 / expert 2.0`.)

> ⚠️ **읽기 전용으로 확인 불가**: `weatherbrain_service.py:~250` 주석이 *"item_params가
> 비어 있어 밴드 내 b가 상수다"*라고 적는다. `item_params`는 **런타임 보정 테이블**이라
> 시드 파일이 없고(`database/seed/`에 없음), 실DB를 봐야 참·거짓이 갈린다. **코드
> 주석에만 있는 주장**으로 표기한다. 참이라면 밴드 내 정렬은 사실상 `func.random()`과
> 같아 「하향」이 밴드 이동으로만 가능하다.

### 3.2 초등(kl 1~2) 문항의 규모와 성질

- **kl1 99건 · kl2 101건 = 초등 밴드 200건**(전체의 19.7%)
- 유형 분포는 밴드 전용 제약이 없다 — board 49건 중 초등 배정분 포함
- `explanation_hint` 저작률: **비board 966건 전건 저작**(누락 0). board 49건 중 12건만
  해설이 있다 → 08-18 기준 `CLAUDE.md`의 "909건 저작 · 45건 누락"은 **낡았다**(누락 0)

### 3.3 🔴 어휘 게이트는 **초등에서 최대 강도, expert에서 완전 무력**

`scripts/lint_seed_items.py` 게이트 ⑤(`:45-61` 주석 · `:320-350` `vocabulary_errors`)의
판정식(원문):

```
탈락 = knowledge_level < (그 용어가 정답·메커니즘 질문에 쓰이면 introduced_at,
                          아니면 name_ok_from)
```

어휘표 `database/seed/level_vocabulary.json` — **87개 용어**의 `introduced_at` 분포:

```
kl1: 1개 · kl3: 3 · kl4: 19 · kl5: 4 · kl7: 33 · kl8: 22 · kl10: 5
```

판정식이 **2단**이므로 표도 2열이어야 한다 — 같은 용어라도 **정답·메커니즘에 쓰이면**
`introduced_at`, **배경으로 언급만 되면** `name_ok_from`(≤ `introduced_at`)이 임계다.
87개 용어에 두 임계를 각각 돌린 결과:

| kl | ⓐ 정답·메커니즘 사용 시 탈락 (`introduced_at` 기준) | ⓑ 배경 언급만 해도 탈락 (`name_ok_from` 기준) | 게이트 강도 |
|---:|---:|---:|---|
| **1** | **86 / 87 (99%)** | **81 / 87 (93%)** | 최대 |
| **2** | **86 / 87 (99%)** | **81 / 87 (93%)** | 최대 |
| 3 | 83 / 87 (95%) | 78 / 87 (90%) | |
| 4 | 64 / 87 (74%) | 62 / 87 (71%) | |
| 5 | 60 / 87 (69%) | 60 / 87 (69%) | |
| 6 | 60 / 87 (69%) | 60 / 87 (69%) | |
| 7 | 27 / 87 (31%) | 27 / 87 (31%) | |
| 8 | 5 / 87 (6%) | 5 / 87 (6%) | |
| 9 | 5 / 87 (6%) | 5 / 87 (6%) | |
| **10** | **0 / 87 (0%)** | **0 / 87 (0%)** | **완전 무력** |

ⓐ가 상한, ⓑ가 하한이다(실제 문항은 용어마다 둘 중 하나로 판정된다). **어느 열로 읽든
결론은 같다** — 초등에서 최대, kl10에서 정확히 0.

**대장의 「상위 4칸은 어휘 게이트가 사실상 무력」은 참이고, 초등은 정확히 그 반대다.**
게이트는 단조 함수이므로 이것은 구조적이다 — kl이 낮을수록 통과 가능한 어휘가 좁다.

#### 이 비대칭이 MT-8에 뜻하는 것 (사실만)

- **초등 문항이 "어려운" 원인은 전문 용어가 아니다.** 87개 용어 중 86개가 kl1~2에서
  이미 차단되므로, 초등 200건은 그 어휘를 **쓸 수 없었다**(lint 전건 통과 상태).
- 게이트는 **용어 목록**만 본다. 문장 길이·문장 수·수치 계산·문말 어투·2인칭 호칭 —
  **어느 것도 안 본다.** 초등 해설이 3~4문장짜리 한다체 논설인 것(§2.2 실물)은
  게이트가 볼 수 없는 축이다.
- **⚠️ 「초등 문항이 실제로 쉬운가」는 이 조사로 판정할 수 없다.** 그것은 판단이다
  (§5). 기계로 잰 대리 지표만 위에 둔다.

### 3.4 MT-10의 남은 공백 재정의 (§0 재측 결과)

종전 근거 3개가 전부 소멸했으므로(`PLACEMENT_SIZE=10` · kl 축 선발 · expert 인접 추가),
**MT-10「초등~성인 세심한 조절」에 남은 것은 배치고사가 아니다.** 08-18에 남아 있는
"세심함"의 한계는 §3.1의 **오프셋 부재**(전역 다이얼 없음)와 §2.3의 **2축이 실은
1축**(kl↔level_group 1:1)이다.

---

## §4 조사 4 — 「가장 얕은 층으로 체감을 만들 수 있는 지점」 — **후보와 근거만**

### 4.1 🔴 먼저, 어떤 후보에도 걸리는 안전 제약 — **변환해도 되는 필드는 2개뿐**

`template_json`의 문자열 중 **채점기(`answer_service.GRADERS`)가 읽는 것**:

| 필드 | 보유 건수 | 채점 역할 |
|---|---:|---|
| `correct_answer` | 966 (비board 전건) | 정답 원문 |
| `options` | 310 (multiple_choice) | 선지 — 정답 문자열과 대조 |
| `pairs` | 125 (match) | **문자열 자체가 정답**(`left:right`) |
| `items` | 111 (ordering) | **문자열 자체가 정답**(순서 비교) |

→ **`question_text`와 `explanation_hint` 외에는 한 글자도 건드리면 안 된다.**
match·ordering은 문자열이 곧 정답이고, multiple_choice는 선지와 `correct_answer`가
문자열로 대조된다.

**변환 자체가 위험한 표본 2종**(사전 확인 필요):

- **문말 빈칸 cloze 9건** — `cloze` 158건 중 9건이 `___`로 문장이 끝난다:
  `'해가 지고 나면 땅이 식으면서 기온이 ___.'` · `'…밀도가 ___.'`
  → 문말 어미 변환기는 이 문장에서 **바꿀 어미가 없거나** 빈칸을 침범한다.
- **이미 존댓말인 140건**(해설) / **111건**(질문) — 한다체 입력을 가정한 치환기는
  이들을 **깨뜨린다**. (대장 CO-Y-7이 08-10에 경고한 순서 의존성이 08-18에도 유효.)

**문자열 고정 계약**: `backend/tests/test_r10_question_payload_contract.py`가 시드
전건·7유형을 훑는다. `:63` `SECRET_FIELDS = ("correct_answer","explanation_hint")` —
발급 페이로드에 해설이 **없어야 함**을 강제하고(`:263`은 `question_text` **존재**만
단정), 특정 문구를 박지는 않는다. **문말 변환이 이 계약을 깨지는 않지만**, 픽스처
(`:290`·`:309`·`:322`)가 리터럴 문자열을 쓰므로 변환기가 그 경로를 타면 조정이 필요하다.

### 4.2 실제로 존재하는 「자리」 — 이음매 4곳 (파일:줄)

| # | 이음매 | 위치 | user(→`effective_tone`)가 스코프에 있는가 |
|---|---|---|---|
| ⓐ | **해설 반환 지점** | `backend/app/services/answer_service.py:238-240` — `hint = str(question.get("explanation_hint")…)` / `return hint` | ✅ **있다** — `build_feedback(db, user: User, …)` (`:194-196`). 함수 서명 변경 없이 `user`를 쓸 수 있는 유일한 지점. ⚠️ **커버리지 구멍 1건**: `build_feedback` 호출처는 `:303`(만회 재제출)·`:418`(최초 제출) **둘뿐**이고, **`submit_answers_bulk`(`:435-499`)는 피드백을 아예 만들지 않는다**(그 범위에 `build_feedback` 0회) — 벌크 경로로 답한 문항은 (i)의 변환을 안 탄다 |
| ⓑ | **문항 발급 조립** | `backend/app/routers/session.py:129` `question_text=question.get("question_text","")` (`_to_session_item`, `:106`) | ✅ **있다** — 호출자 `session_today_response(db, session, user)`(`:249`)가 `:266`에서 부르고 `:269`에서 이미 `user.level_group`을 쓴다 |
| ⓒ | **발급 시점 재귀 치환 선례** | `backend/app/services/session_service.py:235-264` `fill_live_slots` — `template_json` **전 문자열 재귀 치환** | 선례로만 유효(현재 서명에 user 없음). "문항 텍스트를 발급 시점에 다시 쓴다"는 **계약이 이미 승인된 패턴**임을 보인다 |
| ⓓ | **프론트 표시 계층** | `GET /progress/me`의 `tone`이 이미 **도착해 있다**(`schemas/progress.py:65` · 목 `apiMockPlugin.js:891`) — 소비처 0건(§1.4) | ✅ 데이터는 이미 브라우저에 있다 |

### 4.3 후보 층 — **범위 · 위험 · 예상 작업량** (선택하지 않음)

| # | 후보 | 어디를 바꾸나 | 범위 | 위험 | 크기 |
|---|---|---|---|---|---|
| **(i)** | **서버 런타임 어미 치환 — 해설만** | ⓐ `answer_service.py:240` 한 줄을 `tone_transform(hint, effective_tone(user))`로 | **전 문항 저작 0.** 초등이 받는 **해설 200건**(그중 한다체 154건)이 즉시 바뀐다. 채점 필드 무접촉 | 🟠 이미 존댓말인 **140건**을 깨지 않으려면 치환기가 **입력 톤을 판별**해야 한다(CO-Y-7 순서 의존성). 한국어 어미 변환은 불규칙(`~한다→~해요` vs `~된다→~돼요` vs `~이다→~예요`)이라 오변환이 학습자에게 직접 노출된다. RAG 폴백 경로(`:242-249`)는 별개 문자열이라 안 바뀜 | **S~M** (치환기 + 표본 검수) |
| **(ii)** | **서버 런타임 어미 치환 — 해설 + 질문** | ⓐ + ⓑ(`routers/session.py:129`) | (i) + 초등 **질문 200건**(비존댓 140건) | 🔴 (i)의 위험 전부 + **문말 빈칸 cloze 9건** + `question_text`는 `correct_answer`와 의미상 짝이라(cloze·short_answer) 변환이 정답 판정 문맥을 흔들 수 있다. `test_r10_question_payload_contract` 픽스처 조정 필요 | **M** |
| **(iii)** | **프론트 표시 계층 변환** | ⓓ — 이미 도착한 `tone`을 읽어 렌더 직전 변환 | 서버·시드 무접촉. 되돌리기가 가장 싸다 | 🟠 (i)/(ii)와 **같은 어미 오변환 위험**을 그대로 지고, 추가로 **판정 권위와 표시가 갈라진다**(서버 로그·`quiz_logs`에는 원문이 남음). ⚠️ 프론트 4개 디렉터리가 현재 다른 담당 3인의 배타 소유(`modules/explore`·`modules/board`·`i18n/resources`·`mock`)라 **동시 작업 충돌 위험**이 08-18 시점에 실재한다 | **S** (구현) / 충돌 조율 별도 |
| **(iv)** | **시드 톤 정규화 1회** (전건을 한다체로 통일 or 초등만 해요체로) | `database/seed/content_items.json` | 런타임 코드 0. CO-Y-7이 요구한 "치환기 전에 입력을 정규화" | 🔴 **1,015건 중 251건**(해설 140 + 질문 111)이 변경 대상. `seed_content.py` 멱등키가 **`concept_tag + question_text`**라 질문을 고치면 **새 행이 들어가고 옛 행이 `active`로 남는다**(대장 CO-Y-10 — 08-10에 실서버에서 실측된 결함). 해설만 고치면 이 함정은 피한다 | **M~L** |
| **(v)** | **문항별 톤 변형 저작** (`template_json.tone_child` 등 축 신설) | 시드 스키마 + 저작 | 오변환 0 — 사람이 쓴 문장 | 🔴 **초등만 해도 200건 × 2필드 저작.** 전 밴드면 1,015건. 스키마 변경 → `lint_seed_items`·`test_seed_contract`·`test_r10_question_payload_contract` 전부 개정 | **L** |
| **(vi)** | **LLM 재작성** | ai-worker | 자연스러움 최상 | 🔴 **비용 게이트 정책과 정면 충돌**(`CLAUDE.md` — 키는 G0/G1/G2 3게이트로만 투입). 게이트가 사실성을 검증하지 않으므로(대장 O-10) 검수된 해설이 다시 미검증 텍스트가 된다. 08-21 동결 전 재검수 불가능 | **L** |

### 4.4 후보들이 공유하는 **미해결 사전 질문 2개** (사실로 남긴다)

1. **치환기의 입력 가정** — 시드가 한다체 837 / 존댓 140 / 명령 268로 **3종 혼재**다.
   치환기를 "한다체 → 해요체"로 좁게 만들면 140건이 깨지고, "무엇이든 → 해요체"로
   넓히면 **해라체 명령 268건**(`구하라`·`배열하라`·`알아보자` — `~하세요`류는 이미
   polite로 분류돼 이 268건에 없다)까지 대상이 된다.
   이 셋을 어떻게 다룰지는 **설계 결정**이지 조사로 안 나온다.
2. **초등이 아닌 밴드는 어떻게 되나** — `LEVEL_GROUP_TONE`은 `middle_high→teen`(한다체)
   `adult→adult`다. 지금 성인 밴드 해설도 한다체 154 / 존댓 44로 혼재다. 초등만
   바꾸면 밴드 간 톤 경계가 생기고, 전 밴드를 바꾸면 범위가 3배가 된다.

---

## §5 이 조사가 **판정하지 못한 것** (판단 영역 — 넘기지 않는다)

| 무엇 | 왜 못 했나 |
|---|---|
| **「초등 문항이 실제로 쉬운가」** | 판단이다. 기계 대리 지표(어휘 게이트 강도 §3.3 · 문장 톤 §2.2 · 유형 분포)만 제공했다. 실제 난이도는 §3.1의 `item_params` 보정값(실사용 데이터)이 있어야 재는데, 8/11~18 실운영 로그를 **읽기 전용 저장소 조사로는 볼 수 없다** |
| **`item_params`가 비어 있는가** | 실DB 조회가 필요. 코드 주석의 주장으로만 표기(§3.1). **참이면 밴드 내 b가 상수라 `\|b−θ\|` 정렬이 무의미해지고, MT-8의 성격이 "오프셋 추가"에서 "보정 데이터 부재"로 바뀐다** — 이 갈림이 큰데 확인을 못 했다 |
| **어느 층으로 갈 것인가** | 과업이 명시적으로 금지. §4.3의 6후보와 근거만 제출한다 |
| **오변환률** | 치환기가 없으므로 잴 대상이 없다. (i)~(iii) 중 무엇을 고르든 **초등 200건 전수 눈검사**가 사실상 필수라는 것만 사실로 남긴다 |
| **실서버 실제 문장** | `https://34-47-71-146.sslip.io` 실기동 확인은 조사 범위 밖(읽기 전용·저장소 한정). 대장 CO-Y-13의 교훈대로 **실행 중 코드가 이 워킹트리와 같은지**는 `/health`의 `code_fingerprint`로 따로 대조해야 한다 |
| **프론트 4개 디렉터리 내부** | 다른 담당 3인이 동시 작업 중이라 열지 않았다(`modules/explore`·`modules/board`·`i18n/resources`·`frontend/mock`). §4.3 (iii)의 구현 난이도는 그만큼 덜 조사됐다 |

---

## 부록 — 재현 명령

```bash
# 시드 전수·톤 분류 (§0 §2.2)
python3 -c "
import json,re,collections
items=json.load(open('database/seed/content_items.json'))
POLITE=re.compile(r'(요|니다|니까|시오|세요)\$'); IMP=re.compile(r'(하라|어라|아라|여라|보라|하자|보자|해라)\$')
def b(t):
    t=(t or '').strip()
    if not t: return 'empty'
    p=[x for x in re.split(r'(?<=[.!?])\s+',t) if x.strip()]; c=(p[-1] if p else t).strip().rstrip(' .!?~\'\"”’)')
    return 'polite' if POLITE.search(c) else 'imper' if IMP.search(c) else 'plain' if c.endswith(('다','까','가')) else 'other'
for f in ('question_text','explanation_hint'):
    print(f, collections.Counter(b((i['template_json']).get(f)) for i in items))
"

# 어휘 게이트 단계별 강도 — 2단 판정식 양쪽 (§3.3)
python3 -c "
import json
t=json.load(open('database/seed/level_vocabulary.json'))['terms']; n=len(t)
for kl in range(1,11):
    a=sum(1 for x in t if (x.get('introduced_at') or 0)>kl)
    b=sum(1 for x in t if (x.get('name_ok_from') or x.get('introduced_at') or 0)>kl)
    print(f'kl{kl:2d}  정답·메커니즘 {a:3d}/{n}   배경언급 {b:3d}/{n}')
"
```

**측정 기준**: 2026-08-18 **워킹트리 파일** 기준이다. **커밋 대조는 하지 않았다** —
이 조사에 git 명령이 금지돼 있어 HEAD를 오늘 확인할 방법이 없다. 참고로 세션 시작
시점 스냅샷은 HEAD `b0d22db`, 변경 **7경로**(수정 5 + 미추적 2)였고 전부 프론트
(`modules/explore`·`modules/board`·`i18n/resources`·`tests/exploreSims.render.test.mjs`)라
이 조사의 측정 대상 파일(시드·backend·ai-worker·scripts)과 겹치지 않는다.

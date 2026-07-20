# 스프린트 R3-01 백로그 — 대기 보드 퍼즐 (시뮬레이터 대체)

> 운영 규칙: docs/team/TEAM_PROCESS.md. §3 계약은 고정 — 변경 필요 시 PM 보고 후 문서 먼저 수정.

## 0. 배경 — 제품 결정 (2026-07-20, 클라이언트)

**기존 기후 시뮬레이터(파라미터 조작 → 클라이언트 수치 계산)는 폐지한다.**
클라이언트가 요구한 시뮬레이션은 수치 실험이 아니라 **대기 보드 퍼즐** — 구름·기단·전선·
습기 등 기상요소를 보드 위에서 움직여 실제 대기현상(비·눈·안개·폭염 등)을 만들어내는
플레이다. 관측 보고서 №2 §6.3의 "대기 보드 퍼즐" 설계를 전면 채택하고, 로드맵 R3의
"guided·goal-only 2단계"를 이번 스프린트에 구현한다.

## 1. 스프린트 목표

시뮬레이터를 제거하고 대기 보드 퍼즐(선언적 규칙 기반)을 세션·단독 연습 양쪽에 올린다.
플레이 유형을 3→7종으로 확장(board, match, ordering, cloze 추가)한다.

## 2. 스토리와 담당

| # | 스토리 | 담당 | 수용 기준(AC) |
|---|---|---|---|
| R3-S1 | 규칙 엔진: 보드 상태 → 대기현상 판정이 프론트(JS)·백엔드(Py)에서 동일 결과 | 백엔드+프론트 | §3.2 규칙 JSON을 양쪽 인터프리터가 실행, 동일 입력→동일 판정 (공유 테스트 벡터로 검증) |
| R3-S2 | 사용자는 보드 문항을 세션 안에서 풀 수 있다 (question_type "board") | 백엔드 | §3.4 answer 확장, 서버가 board_state를 재판정(권위 채점) |
| R3-S3 | 사용자는 "대기 보드" 탭에서 퍼즐 목록을 골라 연습할 수 있다 | 백엔드+프론트 | §3.5 API 2종, 최초 클리어 +5 XP |
| R3-S4 | 기존 시뮬레이터 모듈·탭 폐지, 대기 보드로 대체 | 프론트 | simulator 라우트·탭 제거(코드 삭제), 대기 보드 탭 신설 |
| R3-S5 | 보드 UI: 팔레트에서 요소를 존에 드래그 배치 → 즉시 현상 미리보기 → 제출 | 프론트 | guided(지시 문구)·goal-only(목표만) 2모드, 힌트 2단계 |
| R3-S6 | 신규 유형 3종(match/ordering/cloze) 채점기+UI | 백엔드+프론트 | §3.6 채점 규칙, 채점기 레지스트리 분리 |
| R3-S7 | 규칙 v1 8종 + 보드 퍼즐 시드 8건 + 신규 유형 시드 6건 | 데이터 | §3.2·§3.3 준수, 규칙마다 퍼즐 최소 1건 |
| R3-S8 | 품질 게이트가 신규 4유형을 검증한다 | AI | validate_chain 휴리스틱 확장(§3.7), 골든셋 추가 |

## 3. 계약 (고정)

### 3.1 보드 모델 — 한반도 단면 4존

```json
{
  "zones": ["서해", "수도권", "태백산맥", "동해안"],   // index 0~3 고정
  "elements": [
    {"type": "air_mass", "subtype": "siberian|north_pacific|yangtze|okhotsk", "zone": 0},
    {"type": "front",    "subtype": "cold|warm|stationary",                    "zone": 1},
    {"type": "moisture", "level": 0,   "zone": 1},    // 0~100, 존당 1개
    {"type": "sun",      "level": 70,  "zone": 2}     // 0~100, 존당 1개
  ]
}
```
- 배치 가능 요소 = 기단·전선·습기·일사 4종. **구름과 현상은 출력**(판정 결과)이다.
- 제약: 존당 기단 최대 1, 전선 최대 1. moisture/sun 미배치 존은 각각 기본값 40/50.

### 3.2 규칙 JSON (`database/seed/board_rules.json`) — 데이터 저작, 양측 인터프리터 실행

```json
[{
  "id": "cold_front_shower",
  "priority": 10,                            // 높을수록 우선, 존당 최고 1규칙 적용
  "when": ["front:cold", "moisture>=60"],    // 조건 전부 동일 존에서 성립(AND)
  "then": {"phenomenon": "shower", "cloud": "cumulonimbus"},
  "explain": "한랭전선이 습한 공기를 파고들면 강한 상승기류로 적란운이 발달해 소나기가 내린다"
}]
```
- 조건 문법 2형: `"<type>:<subtype>"`(존재 검사), `"<field><op><숫자>"`(op는 >= 또는 <=,
  field는 moisture|sun). 이 문법 외 금지(인터프리터 단순성 유지).
- phenomenon enum: `shower, rain, persistent_rain, snow, fog, heatwave, clear, cloudy`
- cloud enum: `cumulonimbus, nimbostratus, stratus, cumulus, none`
- 판정: 존별로 성립 규칙 중 priority 최고 1개 적용. 성립 규칙 없으면
  `{"phenomenon": "cloudy", "cloud": "cumulus"}` (기본값).
- v1 필수 규칙 8종: 한랭전선 소나기 / 온난전선 지속성 비 / 정체전선 장마 /
  대류성 소나기(강한 일사+습기, 전선 없음) / 복사안개(약한 일사+고습, 전선 없음) /
  북태평양기단 폭염 / 시베리아기단 눈(습기 동반) / 시베리아기단 맑고 건조.
  경계값·priority는 데이터가 결정하되 규칙 간 모순(같은 조건에 같은 priority) 금지.

### 3.3 보드 퍼즐 문항 (content_items, question_type: "board")

template_json:
```json
{
  "question_text": "수도권에 소나기를 내려 보세요",
  "mode": "guided|goal_only",
  "guide_steps": ["한랭전선을 수도권에 놓아 보세요", "..."],   // guided만
  "initial_state": { §3.1 board (고정 배치, 잠금 요소 표시 "locked": true) },
  "palette": ["front:cold", "moisture", "sun"],               // 배치 허용 요소(제약이 재미)
  "goal_conditions": [{"zone": 1, "phenomenon": "shower"}],   // AND
  "hints": ["비가 오려면 공기 중에 무엇이 충분해야 할까요?", "차가운 공기가 파고들면..."]
}
```
correct_answer는 보드 유형에서 미사용(빈 문자열). §3.3(R2)의 나머지 필드 규칙 동일.

### 3.4 세션 answer 확장 (§3.1-R2 하위 호환)

- `AnswerRequest`에 `board_state`(§3.1 JSON, optional) 추가. question_type=="board"면 필수
  (누락 시 422 `BOARD_STATE_REQUIRED`).
- 채점: 서버가 board_rules로 board_state를 재판정 → goal_conditions 전부 충족 시 정답.
  **클라이언트 판정을 신뢰하지 않는다(권위 채점).**
- `AnswerResult`에 `phenomena`(존별 판정 결과 배열, board만) 추가. feedback은 성립/미성립
  규칙의 explain을 우선 사용(RAG 호출 절약), 미성립 시 힌트 1단계 반환.

### 3.5 보드 연습 API (`/api/v1/board`) — 세션 밖 단독 플레이

| Method | Path | 응답 |
|---|---|---|
| GET | /rules | board_rules.json 원문 반환(서버가 파일 캐시) — 프론트 로컬 미리보기용 단일 진실원 |
| GET | /puzzles | active board 문항 목록 `[{content_item_id, template_json, cleared: bool}]` — 보드 유형은 비밀 정답이 없으므로 template_json 전체 노출(힌트 공개는 클라이언트가 단계 제어) |
| POST | /puzzles/{content_item_id}/attempt | 요청 `{board_state}` → `{passed, phenomena, feedback, xp_earned}` |

- 최초 클리어만 +5 XP(재도전 0 XP), 클리어 기록은 quiz_logs(session_id NULL,
  quiz_id `board-{content_item_id 앞 8자}-{seq}`)로 남긴다. 레이트리밋 30회/분/유저.

### 3.6 신규 유형 채점 (채점기 레지스트리)

| question_type | template_json 추가 필드 | 채점 |
|---|---|---|
| match | `pairs: [{"left": "...", "right": "..."}]` (3~4쌍) | 제출 `answer` = `"left1:right1|left2:right2|..."` 전 쌍 일치 |
| ordering | `items: ["...", ...]` (3~5개, 정답 순서로 저작), `shuffled: true` | 제출 = `"0,2,1,3"`(원본 인덱스 순열) 완전 일치 |
| cloze | question_text에 `___` 1곳, correct_answer 문자열 | short_answer와 동일 규칙(공백·대소문자 무시) |

- backend 채점을 `answer_service`의 유형별 레지스트리(dict[question_type, grader])로 분리.
  기존 3유형도 레지스트리로 이관(동작 불변).

### 3.7 품질 게이트 확장 (ai-worker)

휴리스틱 추가 — board: initial_state·goal_conditions 스키마 유효, palette 비어있지 않음,
goal의 phenomenon이 enum 내, guided면 guide_steps 존재 / match: 쌍 3~4개·left/right 중복
없음 / ordering: 3~5개·중복 없음 / cloze: `___` 정확히 1곳. LLM 2단은 신규 유형에
concept_match만 적용(문항 형식 판정은 휴리스틱 소관).

### 3.8 DB (Alembic 0003) — 백엔드

- quiz_logs·content_items의 question_type CHECK를 7종
  ('multiple_choice','short_answer','slider','board','match','ordering','cloze')으로 확장.
- 그 외 스키마 변경 없음(보드 퍼즐은 content_items 재사용).

## 4. 웨이브·소유권

- **웨이브 1 (병렬)**: 백엔드(S1py·S2·S3api·S6·0003) / 프론트(S1js·S3ui·S4·S5·S6ui) /
  데이터(S7) / AI(S8)
- 소유권은 R2와 동일 + `database/seed/board_rules.json`은 데이터,
  공유 테스트 벡터 `database/seed/board_test_vectors.json`(입력 보드→기대 판정 10케이스)은
  데이터가 저작하고 **백엔드·프론트 양쪽 테스트가 같은 파일을 읽는다**(동일 판정 보증).
- QA·DevOps는 R4 종료 후 통합 웨이브에서 R3+R4를 한 번에 검증한다.

## 5. 리뷰 노트 · 회고

(웨이브 종료 시 PM 기록)

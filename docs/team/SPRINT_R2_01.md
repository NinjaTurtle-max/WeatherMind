# 스프린트 R2-01 백로그 — "하루 1문항 → 하루 1세션"

> 근거: 관측 보고서 №2 (Duolingo 격차 분석·벤치마킹 설계) 로드맵 R2.
> 운영 규칙은 docs/team/TEAM_PROCESS.md를 따른다. 이 문서의 §3 계약은 **고정**이며
> 변경이 필요하면 PM에게 보고 후 문서를 먼저 수정한다.

## 1. 스프린트 목표

문항 뱅크 + 세션 모델이라는 기반 자산을 깔고, 1라운드 진단의 4대 부채
(route 미로깅 · 품질 게이트 부재 · 레이트리밋 부재 · 스트릭 방어 부재)를 상환한다.
기존 `/quiz/*` 경로는 하위 호환을 유지한다.

## 2. 스토리와 담당

| # | 스토리 | 담당 | 수용 기준(AC) |
|---|---|---|---|
| S1 | 사용자는 하루 1세션(5문항)을 받아 순서대로 풀 수 있다 | 백엔드 | §3.1 API 3종 동작, 세션 행에 recipe·route 저장 |
| S2 | 문항 뱅크에서 세션이 배합되고, 뱅크 부족 시 기존 생성 경로로 폴백한다 | 백엔드 | §3.2 배합 규칙 구현, 뱅크 0건이어도 세션 발급 성공 |
| S3 | 실황 슬롯 `{today.*}`가 서빙 시점에 오늘 날씨로 치환된다 | 백엔드 | 슬롯 문항이 Redis weather 캐시 값으로 렌더링 |
| S4 | 생성 문항은 품질 게이트를 통과해야 뱅크에 들어간다 | AI | §3.4 검증 엔드포인트, 휴리스틱+LLM 2단, 키 없이도 1단 동작 |
| S5 | 스트릭 프리즈("구름 방패")가 하루 결손을 방어한다 | 백엔드 | 7일 마일스톤 시 +1 지급, 결손 시 자동 소모, 테스트 포함 |
| S6 | auth·answer·세션 발급 경로에 레이트리밋이 걸린다 | 백엔드 | 초과 시 429 + 표준 에러 포맷 |
| S7 | 세션 UI: 진행 바 → 문항 반복 → 세션 요약(XP 합산) | 프론트 | mock으로 전체 플로우 동작, 기존 퀴즈 화면 유지 |
| S8 | 시드 문항 24건 이상이 계약 스키마로 저작된다 | 데이터 | §3.3 준수, 6태그×2학령 커버, 슬롯 문항 ≥6건, 저작 가이드 문서 |
| S9 | 계약 기반 테스트 스위트와 통합 체크리스트 | QA (웨이브 2) | 07번 공식·프리즈·배합·채점 테스트 통과 |
| S10 | git 저장소·로컬 CI·런북 정비 | DevOps (웨이브 2) | scripts/ci.sh (lint+test+compose config) 통과 |

## 3. 서비스 계약 (고정)

### 3.1 세션 API (`/api/v1/session`) — 백엔드 구현, 프론트 소비

| Method | Path | 응답 |
|---|---|---|
| GET | /today | `{session_id, session_date, mode:"daily", items: SessionItem[], progress:{answered,total}}` — 멱등: 당일 재호출 시 동일 세션 |
| POST | /{session_id}/answer | 요청 `{quiz_id, answer, elapsed_sec?}` → 기존 AnswerResult + `{"session_progress":{answered,total}}` |
| POST | /{session_id}/complete | `{xp_total, correct_count, total, streak_count}` — 전 문항 응답 시에만 성공, 미완료 시 409 |

`SessionItem` = 기존 QuizQuestion + `{"source": "bank"|"generated", "slot_filled": bool}`.
에러 포맷·인증은 02번 스펙 공통 규칙과 동일.

에러 코드 표준 (리뷰에서 mock↔서버 불일치 발견 후 고정):
- 미완료 complete 409 → `SESSION_NOT_COMPLETED`
- 재제출 409 → `ALREADY_ANSWERED` / 세션 미존재·소유자 불일치 404 → `SESSION_NOT_FOUND`

### 3.2 세션 배합 규칙 (recipe)

`{"new": 2, "review": 2, "live": 1}` 합계 5문항.
- new: 뱅크의 active 문항 중 해당 유저가 미출제된 것 (level_group 일치)
- review: weak_tags accuracy_rate<60 태그의 뱅크 문항 우선, 없으면 new로 대체
- live: `uses_live_slots=true` 문항 + 슬롯 치환, 없으면 기존 quiz-generate 폴백.
  치환은 **세션 최초 발급 시점에 확정 저장**한다(채점 일관성 — 사용자가 본 값과 정답이
  하루 중 실황 변동과 무관하게 일치해야 함. 리뷰 후 PM 결정).
- 뱅크 부족분은 ai-worker quiz-generate로 폴백(현행 경로). 같은 question_type 3연속 금지.
- recipe와 router-decide 결과는 sessions 행에 JSONB로 저장한다.

### 3.3 문항 시드 스키마 (`database/seed/content_items.json`) — 데이터 저작, 백엔드 적재

```json
[{
  "concept_tag": "pressure_front",          // 표준 6태그 중 하나
  "level_group": "elementary|middle_high|adult",
  "question_type": "multiple_choice|short_answer|slider",
  "template_json": {
    "question_text": "오늘 서울 최고기온은 {today.temp_max}도였다. ...",
    "options": ["...", "..."],               // multiple_choice만, 4개, 중복 금지
    "correct_answer": "...",                  // options 중 하나(객관식) / 문자열 / 숫자(슬라이더)
    "explanation_hint": "..."                 // RAG 피드백 보조 (선택)
  },
  "uses_live_slots": false,
  "source": {"kind": "seed", "refs": ["climate_concepts: 문서명"]},
  "status": "active"
}]
```
허용 슬롯: `{today.temp_max}` `{today.temp_min}` `{today.sky}` `{today.rain_prob}` `{today.region}`.
슬라이더 정답은 0~100 숫자 문자열. 시드는 사람 저작이므로 status=active로 적재.

### 3.4 품질 게이트 (`ai-worker /internal/quiz-validate`) — AI 구현

요청: `{"question": <template_json 형식>, "concept_tag": "...", "level_group": "..."}`
응답: `{"passed": bool, "checks": [{"name": "...", "passed": bool, "reason": "..."}]}`
- 1단 휴리스틱(LLM 불필요): 필수 필드 존재, options 4개·중복 없음, correct_answer가
  options에 포함(객관식), 슬라이더 정답 0~100, 질문 길이 10~300자.
- 2단 LLM(Gemini, 키 있을 때만): 정답 유일성, 보기 모호성, concept_tag 부합.
  키 부재/호출 실패 시 1단 결과만으로 응답하고 checks에 `"llm_skipped"` 표기.
- 기존 내부 API 인증(X-Internal-API-Key)·포트 8001 규칙 동일.

### 3.5 스트릭 프리즈

- `users.streak_freeze_count INT NOT NULL DEFAULT 0` (최대 2 보유).
- 출석 시 last_login_date가 **그제**(이틀 전)이고 freeze ≥ 1이면: freeze 1 소모,
  스트릭 유지(+1). 사흘 이상 결손은 프리즈와 무관하게 리셋.
- 스트릭 7일 마일스톤 달성 시 +1 지급(최대치 초과 시 미지급).
- `/progress/me` 응답에 `streak_freeze_count` 추가.

### 3.6 레이트리밋 (slowapi)

| 경로 | 한도 |
|---|---|
| POST /auth/login, /auth/register | 5회/분/IP |
| GET /session/today, /quiz/today | 10회/분/유저 |
| POST answer 계열 | 30회/분/유저 |
초과 시 429 + `{"detail": "...", "code": "RATE_LIMITED"}`.

### 3.7 DB 변경 (Alembic 0002) — 백엔드 소유

- `content_items`(id UUID PK, concept_tag, level_group, question_type, template_json JSONB,
  uses_live_slots BOOL, source JSONB, status VARCHAR(10) CHECK IN ('draft','active','retired'),
  stat_total INT DEFAULT 0, stat_correct INT DEFAULT 0, created_at) — 전역 콘텐츠, RLS 없음.
- `sessions`(id UUID PK, user_id FK, session_date DATE, mode VARCHAR(10),
  recipe_json JSONB, route_decision JSONB, completed_at TIMESTAMPTZ NULL, xp_total INT DEFAULT 0,
  UNIQUE(user_id, session_date, mode)) — RLS user_isolation 패턴 복제.
- `quiz_logs` 컬럼 추가: `session_id UUID FK NULL`, `content_item_id UUID FK NULL`.
- `users` 컬럼 추가: `streak_freeze_count INT NOT NULL DEFAULT 0`.

## 4. 웨이브 구성

- **웨이브 1 (병렬)**: 백엔드(S1~S3, S5~S6) · AI(S4) · 프론트(S7) · 데이터(S8)
- **웨이브 2 (웨이브 1 리뷰 후)**: QA(S9) · DevOps(S10)
- 디렉토리 소유권: backend/=백엔드, ai-worker/=AI, frontend/=프론트,
  database/seed/+docs/data/=데이터, backend/tests/+docs/qa/=QA, 루트 인프라+scripts/=DevOps.

## 5. 리뷰 노트 · 회고

### 웨이브 1 코드 리뷰 (2026-07-20, PM)

8관점 파인더(정확성 3 + 재사용·단순화·효율 + 설계 고도 + 컨벤션) → 후보 33건 → 검증 후
확정 10건. 컨벤션 위반 0건. 수정 배정:

**백엔드 수정 배정 (7건)**
1. [고도·심각] answer_service에 멱등 가드·세션 XP 누적 부재 — 세션 문항을 /quiz 경로로
   제출하면 session.xp_total 불일치. 가드·세션 누적을 서비스 층으로 내릴 것
2. [고도·심각] 레이트리밋 IP 키가 nginx 프록시 IP로 수렴(전역 버킷화). nginx는 XFF를
   이미 전달함 — XFF 1홉 신뢰 키로 교체
3. [효율·심각] 뱅크 공백 시 quiz_generate 최대 5회 직렬 + 1건 실패 시 전체 503.
   asyncio.gather 병렬화
4. [정확성] content_items 통계 read-modify-write lost update → 원자 UPDATE
5. [정확성] users.streak_freeze_count 파이썬측 default 부재 → None 비교 TypeError 위험
6. [중복] WEAK_ACCURACY_THRESHOLD 재정의 + WeakTag 중복 조회 → xp_service 상수 공유,
   decide_route 결과 재사용
7. [정리] quiz.py 죽은 별칭(SLIDER_TOLERANCE/_grade) 삭제 + quiz_id 채번 로직 공용 헬퍼화

**프론트 수정 배정 (2건)**
8. [계약] mock↔실서버 불일치 5종: 409 코드(SESSION_NOT_COMPLETED로 통일)·재제출/완료 후
   가드·XP 중복 가산·/progress/me streak_freeze_count 누락·session_id 무시
9. [UX] TabBar 라벨 "오늘의 퀴즈" → "오늘의 세션" (PM 결정)

**기술 부채 기록 (이번 라운드 수정 보류)**
- ai-worker: validate_chain의 LLM 파싱·클라이언트 스캐폴딩이 quiz_gen_chain과 중복
  (_parse_output/_make_llm 공용화), 휴리스틱 체크 테이블화
- session_service의 KMA 카테고리 해석(SKY_TEXT 등)이 weather_api·celery와 3원화
- answer당 weather 재조회(Redis GET이라 저비용)·progress 전행 재집계(집계 쿼리로 대체 가능)
- sessionStore의 _submitFailed 이중 진실원 단순화
- mock 채점 규칙의 서버 중복(모킹 본질상 허용, 계약 테스트가 가드)
- 뱅크 공백+생성 실패 시 부분 세션(5문항 미만) 허용 여부 — R3 검토

**PM 결정**: 슬롯 치환은 발급 시점 확정이 옳다(채점 일관성) — §3.2에 명문화.
409/404 코드 표준을 §3.1에 추가. 컨벤션 0건은 계약 선고정 방식의 효과로 평가.

### 웨이브 2 결과 · 스프린트 회고 (R2-01 종료, 2026-07-20)

**웨이브 2 산출**: QA — 계약 테스트 105건 신규(공식 회귀·리뷰 수정 회귀·에러 코드 계약·
시드 계약, 최종 backend 145 + ai-worker 11 전건 통과), 통합 체크리스트 8시나리오,
테스트 계획. P0~P2 결함 0건. DevOps — scripts/ci.sh(lint→test→config→frontend),
RUNBOOK, backend 시드 볼륨 마운트 결함 발견·해결, slowapi 버전 고정 정합 확인.

**P3 처리**: ① XP 반올림 모호 → 07번 스펙에 은행가 반올림 명문화(현행 유지)
② mock RATE_LIMITED 시뮬레이션 부재 → 부채 ③ adult 시드 부족 → R3 데이터 작업에 반영.

**회고**
- 잘된 것: 계약 선고정으로 4직군 병렬에서 충돌 0·컨벤션 위반 0. 8관점 리뷰가
  확정 결함 10건을 커밋 전에 잡음(특히 세션 XP 이원화·프록시 레이트리밋은 실기동
  전 발견이 어려운 유형). 시드 계약 테스트가 ai-worker 검증기를 실제 임포트해
  단일 진실원 유지.
- 아쉬운 것: 세션 사용량 한도로 에이전트 3회 중단(재개 체계로 손실 없음).
  실기동(docker) 검증은 API 키 부재로 체크리스트 이월.
- 배운 것: mock↔서버 불일치의 근본 원인은 계약에 에러 코드 문자열을 안 박은 것 —
  R3 계약부터 코드 문자열까지 고정(§3.4 BOARD_STATE_REQUIRED 등).

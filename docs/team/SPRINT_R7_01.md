# 스프린트 R7-01 — 마일스톤 1: 적응 루프 완성

> 확장 로드맵(2026-07-23 클라이언트 확정) 마일스톤 1. 목표 — **"실력을 재고 → 내 수준으로
> 출제"가 실제로 돌게.** 현재 "정해진 것 준다"는 감각의 진단된 근본원인 = 적응 루프 미연결.
> 팀 형식(클라이언트 지정): **직군 리드 7 + 태스크량 비례 팀원 파생.**

---

## 0. 배경 — 제품 결정 (2026-07-23, 클라이언트)

- 전체 목표를 "상업 배포 수준 도달"로 확정, 기준선 = 확장 로드맵 6단계(의존 순서).
  이번 주 초점 = 마일스톤 1. 상세: 메모리 `weathermind-commercial-launch-goal`.
- R6까지의 상태: IRT 엔진·엔드포인트 계층은 완성(합성 복원 검증). 부족한 것은
  **배선 2가닥**(θ→출제 서빙 연결, 배치응답→placement 전달)과 **검증 1가닥**(DB 왕복).
  - `priors.theta_to_target_level_group`: 구현·테스트 완료, 프로덕션 호출 0건.
  - ai-worker `placement_responses` 결합 경로: 배선 완료, backend `ai_client.
    weatherbrain_placement`가 안 보냄(미싱 링크).
  - backend 테스트는 전부 FakeDB/순수 — RLS·upsert·폴백 커밋의 실DB 검증 부재.
- 설계 중 검증된 결정적 사실:
  1. 초기 구름 5 < 배치 6문항 → **배치고사 에너지 면제는 산술적 필수**.
  2. 시드 47건(elementary 11 / middle_high 28 / adult 8) → θ 필터를 level_group
     하드 교체로 하면 풀 고갈. **IN-확장 + b-인접 정렬** 채택.
  3. `sessions` daily 멱등 유니크는 `(user_id, session_date, mode)` 부분 인덱스 →
     `mode='placement'` 세션은 기존 스키마와 무충돌.

### 제품 결정 (권고안 채택 — 클라이언트 조정 가능)

| 항목 | 결정 | 근거 |
|---|---|---|
| 배치 문항 수 | 6 (개념당 1) | CONCEPT_TAGS 6종 전 커버 최소치, 온보딩 이탈 최소화 |
| 에너지 | 면제 | 구름 5 < 6문항 — 미면제 시 신규 유저 완주 불가 |
| XP·스트릭·퀘스트 | 미부여 (순수 진단) | 진단이 보상 루프 선점 시 첫 daily 세션 임팩트 희석 |
| 스킵 | 허용 (재응시는 R8 부채) | 사전 θ(seed_placement)가 있어 스킵해도 루프 동작 |

## 1. 스프린트 목표

가입 → 배치고사 → 개인 초기 θ → θ 인접 문항 출제의 전체 루프가 실DB에서 돌고,
그 전 구간이 `scripts/smoke.sh` 한 명령으로 검증된다.

## 2. 스토리와 담당

팀: PM(오케스트레이터 겸) · 백엔드(리드 + SA-1·SA-2 파생) · 프론트 · AI(계약 정합
리뷰 전담 — ai-worker 코드 무변경) · 데이터 · QA(웨이브 2) · DevOps(웨이브 0·2).

| # | 스토리 | 담당 | AC |
|---|---|---|---|
| S0 | DB 왕복이 한 명령으로 검증된다 | DevOps | `scripts/smoke.sh` §3.4 전 단계 OK, 실패 단계 식별 가능한 출력 |
| S1 | 가입 직후 배치고사로 개인 초기 θ가 배정된다 | 백엔드 SA-1 | §3.1 계약 일치, 완료 시 응답 결합 θ upsert + `placement_completed_at`, 에너지·XP 면제, 재호출 멱등 |
| S2 | 세션 출제 난이도가 θ를 따라간다 | 백엔드 SA-2 | §3.2 — θ 인접 우선 출제, refresh 1회, 배합 계약(5문항) 불변, 콜드스타트 동작 불변 |
| S3 | 온보딩 배치고사 UI | 프론트 | `/onboarding/placement`(Layout 밖), SessionRunner 재사용, θ 결과 화면, 스킵, mock 동기화, build 통과 |
| S4 | 배치고사 문항 커버리지 | 데이터 | 6개념×3그룹 각 non-board·non-live active ≥1건, seed_contract 통과 |
| S5 | 회귀 + 계약 드리프트 확장 | QA | 신규 계약 테스트(§6), 전체 스위트 통과 |
| S6 | 스모크 0007 재실행·ci 편입·런북 | DevOps | `ci.sh smoke`(opt-in), README·RUNBOOK·CHECKLIST 갱신 |

## 3. 계약 (고정)

### 3.1 배치고사 API

- **`POST /api/v1/onboarding/placement/start`** (신규 라우터 `routers/onboarding.py`)
  - 응답: 기존 `SessionToday` 스키마 그대로 (`{session_id, items[], progress}`).
  - 내부: `Session(mode='placement', unit_id=NULL)` 발급, `plan_placement_picks`로
    6문항(개념당 1, 신고 level_group 인접 교차 배치, `question_type != 'board'`,
    `uses_live_slots = false`, 그룹 구멍은 신고 그룹 폴백).
  - 이미 완료(`users.placement_completed_at` NOT NULL) → **409 `PLACEMENT_ALREADY_DONE`**.
  - 당일 미완료 배치 세션 재호출 → 멱등 재조회(기존 daily 패턴).
- **문항 응답**: 기존 `POST /api/v1/session/{id}/answer` 재사용 (quiz_logs 기록 →
  이후 refresh_abilities에 자동 편입). **mode='placement'면 구름 에너지 소모 스킵.**
- **`POST /api/v1/session/{id}/complete`의 placement 분기**:
  - 세션 quiz_logs → `{concept_tag: [{b, a: 1.0, correct}]}` 조립
    (b = `_load_calibrated_b` 보정값 → 없으면 문항 level_group의 사전 b).
  - `ai_client.weatherbrain_placement(level_group, CONCEPT_TAGS, placement_responses=…)`
    → `_upsert_abilities` → `placement_completed_at = now()`.
  - XP·스트릭·퀘스트 미부여.
  - ai-worker 장애 시: 사전 θ 유지 + 완료는 기록(가입 훅과 동일한 복원력 원칙 —
    재시도 강요로 온보딩을 막지 않는다).
  - 응답: `{abilities: [{concept_tag, theta, se, n}], placement_done: true}`.
- **ai_client 변경**: `weatherbrain_placement(level_group, concept_tags,
  placement_responses: dict | None = None)` — payload에 조건부 포함.
  **ai-worker는 무변경** (`PlacementRequest.placement_responses` 기수신).
- **`GET /progress/me`** 응답에 `placement_done: bool` 추가 (additive).

### 3.2 θ → 출제 난이도 (quiz-generate 계약 무변경 — 최소안)

- backend 순수함수 2종 신설:
  - `theta_to_level_group(theta)` — 경계 **±0.5** (ai-worker `priors.
    theta_to_target_level_group`과 동일값, 계약 테스트로 드리프트 감시).
  - `overall_theta(abilities, target_concept_tag=None)` — 개념 지정 시 해당 θ,
    아니면 num_responses 가중 평균, 빈 리스트면 None.
- `create_daily_session`이 `refresh_abilities`를 **정확히 1회** 호출 →
  `decide_route(…, abilities=)`·`_fetch_pools(…, abilities=)` 양쪽 공급.
  `decide_route(abilities=None)`이면 현행 내부 refresh(레거시 quiz.py 하위 호환).
- `_fetch_pools`: `level_group IN {신고그룹, theta_to_level_group(θ)}` **확장(교체
  아님)** + `ORDER BY abs(coalesce(item_params.b, 사전b CASE) − θ), random()`
  (item_params outerjoin). θ None(콜드스타트) → 현행 동작 그대로.
- 사전 b backend 상수는 ai-worker `LEVEL_GROUP_ITEM_B`와 동일값 — 계약 테스트 감시.
- `quiz_generate` 호출: `level_group = theta_to_level_group(θ) or user.level_group`.
- **범위 외(R8 부채)**: 유닛 세션 풀 θ 확장(커리큘럼 고정 의미론 유지),
  QuizGenerateRequest `target_theta` 확장, 배치 재응시.

### 3.3 스키마·마이그레이션

- **0007**: `users.placement_completed_at TIMESTAMPTZ NULL` (additive, 롤백 자명).
  `num_responses>0` 우회 기각 — "daily 한 번 풂"과 "배치 완료"를 구별 못 해
  스킵·재유도 정책 표현 불가.

### 3.4 DB 스모크 (scripts/smoke.sh) 검증 포인트

| # | 단계 | 검증 |
|---|---|---|
| 1 | compose up postgres·redis·backend·ai-worker | /health 200 (8000·8001) |
| 2 | alembic upgrade head | current == head |
| 3 | 시드 3종 (content→units→badges) | exit 0, 멱등 |
| 4 | register (고유 이메일, middle_high) | 201 + access_token |
| 5 | psql user_concept_ability | 6행, num_responses=0, θ≈사전값 |
| 6 | RLS 3종 | 타 유저 컨텍스트 0행 / 무컨텍스트 INSERT 거부 / item_params 전역 통과 |
| 7 | session/today → answer×3 → 재발급 | num_responses>0 전이 (실왕복) |
| 8 | ai-worker stop → register | 201 + 0행 (폴백이 커밋 지속) → start |
| 9 | (0007 후) placement start→answer×6→complete | placement_completed_at NOT NULL, θ 이동 |

볼륨 파괴 명령(`down -v` 등) 불포함. 스모크 유저만 생성(멱등).

### 3.5 에러 코드·계약 수치

- `PLACEMENT_ALREADY_DONE` (409) 신설.
- `PLACEMENT_SIZE=6` — Settings env 기본값=계약값, 드리프트 테스트(SESSION_RECIPE 전례).

## 4. 웨이브

- **선행**: 이 문서 PR 병합 (계약 고정).
- **웨이브 0 (직렬)**: S0 — `chore/r7-01-db-smoke`. 발견 결함은 백엔드 리드가 같은
  브랜치에서 수정. 종료 조건: 0006 기준 1~8단계 그린.
- **웨이브 1 (병렬 4)**: S1 `feat/r7-02-placement-api` · S2 `feat/r7-03-theta-difficulty`
  · S3 `feat/r7-04-placement-ui` · S4 `feat/r7-05-placement-seed`.
  병합 순서: S2 먼저(충돌면 작은 쪽 후병합 — weatherbrain_service 교집합은 S1이
  리베이스 흡수). 종료 조건: 4 PR 병합 + 프론트 mock↔실백엔드 전환 확인.
- **웨이브 2 (통합)**: S5+S6 — `chore/r7-06-integration`. 종료 조건: 전체 스위트 +
  스모크 9단계(0007 포함) 그린, 리뷰노트·회고 기록.

각 브랜치: 항목 단위 원자 커밋 → `/code-review`(P0~P2 반영, 불가 시 §2.3 기준 자체
검토) → PR → merge commit(squash 금지) → 브랜치 삭제.

## 5. 리뷰 노트·회고

(웨이브 종료 시 기록)

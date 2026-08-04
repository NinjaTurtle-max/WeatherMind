# SPRINT R11-01 — 무키 구간 웨이브 1 (마일스톤 4·6 선행 + R10-J)

**개시: 2026-08-04 (PM). 근거: ROADMAP §5.3.1** — 키는 발급됐고 비용 때문에 G1(W2 초입)
까지 미투입. 무키로 가능한 것이 잔여 작업의 대부분이므로 그 구간을 먼저 소진한다.

## 0. 무키 잔여 백로그 (2026-08-04 실측 기준)

| # | 항목 | 마일스톤 | 이번 웨이브 | 실측 근거 |
|---|---|---|---|---|
| C1 | DKT류 지식 추적 파이프라인 + 합성 복원 검증 | 4 | **포함** | `weatherbrain/`에 irt·placement·priors뿐, DKT 없음 |
| C2 | 간격반복 복습 스케줄러 실동작 | 4 | **포함** | 리포 전체에 간격반복 코드 0건 |
| F | 다과정 구조 (코스 모델·0009·코스 API·시드) | 6 | **포함** (백엔드까지) | `models/`에 course 없음, units 단일 코스 |
| J | R10-J 게스트 인증 실체화 (P1) | — | **포함** (서버+LoginPage) | backend `auth.py`에 guest 라우트 없음 — 프론트가 가짜 토큰 조작(`LoginPage.jsx:38`), 실서버에서 깨짐 |
| D | i18n 골격 (ko/en 리소스·로케일 스위처·파일럿 1건) | 6 | **포함** (골격만) | `frontend/src/i18n/` 부재, i18n 라이브러리 사용 0건 |
| S | 기초과학 코스 개념 트리 설계 | 6 | **포함** (PM 직접) | 설계 문서 부재 |
| D′ | 문자열 외부화 전면 + 코스 선택 화면 + 온보딩 재배치 | 6 | 웨이브 2 | D′는 프론트 전 파일을 스침 — F 프론트·J 프론트와 충돌 확정이라 골격 뒤로 |
| — | 하드닝 6종 (마일스톤 5) | 5 | 웨이브 3 | 되돌리기 어려운 작업 포함 — 단독 웨이브로 |
| — | R10-I·K·L·M·P·Q (P2) | — | 판정 대기 | I·M은 클라이언트 판정 필요, K·L·P·Q는 D′와 같은 파일을 스침 |

## 1. 편성 (§2.6 — 직군별 개발량 기준)

| 직군 | 인원 | 담당 | 격리 |
|---|---|---|---|
| **AI/지능** | 2 (리드 AI-L + 워커 AI-W) | AI-L: C1 / AI-W: C2 | T1 |
| **백엔드** | 2 (리드 BE-L + 워커 BE-W) | BE-L: F / BE-W: J | T1 |
| **프론트** | 1 (FE-1) | D 골격 | T1 |
| 콘텐츠·기획 | PM 겸임 | S 트리 설계 + 게이트·커밋 | — |
| QA·DevOps·디자인 | **0** | 개발량 0 — 미투입 | — |

동시 5 = 상한. 격리 T1(공유 트리 + 파일 소유 분리) — 계약이 이 문서로 갓 고정됐고
소유 파일이 전부 서로소라 T2 워크트리 비용이 정당화되지 않는다(§2.6.1).

## 2. 배타적 파일 소유 (목록 밖 수정 금지 — 전원)

| 담당 | 소유 |
|---|---|
| **AI-L** | `ai-worker/app/weatherbrain/knowledge_tracing.py`(신규) · `ai-worker/app/weatherbrain/synth.py`(신규) · `ai-worker/tests/test_knowledge_tracing.py`(신규) |
| **AI-W** | `backend/app/services/review_schedule_service.py`(신규) · `backend/app/routers/progress.py`(복습 큐 노출부만) · `backend/tests/test_review_schedule.py`(신규) |
| **BE-L** | `backend/app/models/course.py`(신규) · `backend/app/models/unit.py` · `backend/alembic/versions/0009_*`(신규) · `backend/app/services/curriculum_service.py` · `backend/app/routers/curriculum.py` · `backend/app/schemas/curriculum*.py` · `database/seed/courses.json`(신규) · `database/seed/units.json` · `backend/tests/test_course*.py`(신규) |
| **BE-W** | `backend/app/routers/auth.py` · `backend/app/schemas/auth.py` · `backend/tests/test_auth_guest.py`(신규) · `frontend/src/modules/auth/LoginPage.jsx` · `frontend/mock/apiMockPlugin.js`(guest 경로 추가부만) |
| **FE-1** | `frontend/src/i18n/**`(신규) · `frontend/src/components/LocaleSwitcher.jsx`(신규) · `frontend/src/components/StreakBadge.jsx`(파일럿) · `frontend/package.json`·`package-lock.json` · `frontend/tests/i18n.smoke.test.mjs`(신규) · `scripts/ci.sh`(FRONT_TESTS 배열 1줄만) |
| **PM** | `docs/specs/11_basic_science_course.md`(신규) · 이 문서 · 커밋 전권 |

공유 파일 단일 소유: `progress.py`=AI-W · `apiMockPlugin.js`=BE-W · `ci.sh`=FE-1.
마이그레이션 번호: **0009는 BE-L 전용.** 다른 담당이 테이블이 필요하면 만들지 말고
보고한다(이번 웨이브 계약상 필요 없어야 정상).

## 3. 계약 (완료 판정 기준)

### C1 — 지식 추적 (AI-L)
- 합성 학생(개념별 진짜 숙련도) → 응답 시퀀스 생성 → 모델 적합 → **원 숙련도 복원**이
  파이프라인이고, 복원 품질(상관/AUC)이 사전 선언한 임계를 넘는 것이 완료 판정이다.
- **순수 파이썬** — `irt.py`가 세운 관례("의존성 없는 순수 파이썬"). torch류 신규 의존 금지.
- 랜덤은 시드 고정(재현성). `irt.py`·`placement.py`·`priors.py` **불가침**(IRT 콜드스타트
  유지가 마일스톤 4의 명시 조건).
- BKT/logistic-DKT 등 모델 선택은 AI-L 재량 — 선택 근거와 한계를 모듈 독스트링에 남긴다.

### C2 — 간격반복 (AI-W)
- quiz_logs에서 개념별 다음 복습 시점을 계산하는 **read-model 순수 함수**를 권장한다
  (테이블·마이그레이션·celery 불요 — 응답 이력이 이미 다 있다). 배치가 필요하다고
  판단하면 구현하지 말고 근거를 보고.
- `GET /progress/review-queue`(또는 기존 응답 additive)로 노출. 채점·에너지 로직 불가침.
- 간격 함수는 결정적·단위 테스트 가능해야 하고, 파라미터는 계약 테스트로 고정.

### F — 다과정 구조 (BE-L)
- 코스 2개 시드: `weather`(기존 4섹션 전부 귀속) · `basic-science`(빈 트리 — 유닛은
  PM의 트리 설계(S) 이후 웨이브에서 저작).
- **완전 하위 호환이 최우선.** 기존 유닛 API·세션 발급·진척이 코스 도입 후에도 동일
  동작(기존 테스트 989 회귀 0). 기존 유저는 weather 코스가 기본.
- θ는 코스를 가로질러 **개념 태그 단위 유지** — `user_concept_ability` 불변(ROADMAP
  §5.1.1: 코스별 θ 분리는 마일스톤 2 성과를 깬다).
- 마이그레이션 0009는 **downgrade 포함**(0008 관례).
- 코스 간 선행은 구조(컬럼·검증)만 — 잠금 UX는 프론트 웨이브 2.

### J — 게스트 인증 (BE-W)
- `POST /auth/guest` → **실 유저 생성 + 실 JWT**. 이메일 규약(`guest-{uuid}@...`)으로
  기존 스키마 재사용 — `users` 컬럼 추가 금지(0009와 충돌·이번 범위 밖).
- 레이트리밋 필수(가입 5/분 관례 준용). refresh 동작 확인.
- `LoginPage.jsx`의 가짜 토큰 조작(`:38-39`) 제거 → 실호출. mock에 같은 경로 추가
  (**mock↔서버 형태 동일** — R10-07 계약 관례).
- 온보딩 순서 재배치(R10-J 본체)는 웨이브 2 — 이번엔 "게스트 버튼이 실서버에서
  동작한다"까지.

### D — i18n 골격 (FE-1)
- 라이브러리 선정은 FE-1 재량(react-i18next vs 경량 자체) — 번들 영향 실측과 근거 필수.
- ko/en 리소스 구조 + `LocaleSwitcher` + **파일럿 1건**(`StreakBadge`)이 양 언어로 렌더.
- 스모크 `test:i18n` 신설 + `FRONT_TESTS` 등록(등록해야 CI가 지킨다 — ci.sh 헤더 주석).
- **기존 컴포넌트를 StreakBadge 외에 건드리지 않는다** — 전면 외부화는 웨이브 2.
- 하드코딩 한국어의 전면 스캔·목록화(수정 말고 **목록만**)를 산출물에 포함 — 웨이브 2 견적.

## 4. 전원 공통 금지 (브리핑 필수 포함)

- **파괴적 git 일절 금지**: checkout·switch·merge·pull·rebase·reset·stash·clean·
  restore·push·commit. 5인이 같은 트리에서 병렬 작업 중 — 과거 `stash` 1회로 5인
  작업분이 전부 되돌아간 사고(CLAUDE.md). 커밋은 PM만. 읽기 전용(status·diff·show·log) 허용.
- `docker` 금지. 실DB 검증은 PM이 웨이브 종료 시 일괄.
- 자기 파일 밖 결함은 고치지 말고 **보고**(같은 패턴 발견 포함 — TEAM_PROCESS §2.6.1).
- 테스트 기준선: backend **989** · ai-worker **169**(의존 전체 설치 상태) · 프론트
  스모크 10종. 회귀 0이 전제.

## 5. 리드 파생 규칙 (§2.7)

AI-L·BE-L은 자기 세션에서 워커 1인을 파생한다(깊이 상한 2 준수 — 워커는 재파생 금지).
파생 브리핑에 §2 소유 목록·§3 해당 계약·§4 금지를 **원문대로** 전달한다.

---

## 6. 웨이브 2 — 프론트 수렴 (2026-08-04 착수)

**PM 판정(착수 시 확정)**: ① 코스 강제 잠금 **안 함** — "선행 학습(권장)" 표기까지
(specs/11 §0-4의 보수 기본값. 강제는 기존 유저 하위 호환을 깬다). ② R10-K·L·P·Q
미편입 유지, I·M 판정 대기 유지.

**2페이즈 순차** — 페이즈 B(문자열 외부화)가 프론트 전 파일을 스치므로 기능(A)이
먼저 착지해야 한다. A 안에서는 "컴포넌트 제작자 ≠ 마운트 지점 소유자" 패턴으로
CurriculumHome 충돌을 피한다: 제작자는 독립 컴포넌트를 만들고, CurriculumHome
소유자(FE-A)가 1줄 import로 마운트한다.

### 6.1 페이즈 A — 기능 4건 (병렬 4인)

| 담당 | 항목 | 배타적 소유 |
|---|---|---|
| **BE-1** | 게스트→정식 계정 전환 API | `backend/app/routers/auth.py` · `backend/app/schemas/auth.py` · `backend/tests/test_auth_convert.py`(신규) |
| **FE-A** | 코스 선택 UI + 마운트 통합 | `frontend/src/modules/curriculum/CurriculumHome.jsx` · `PcCurriculumPath.jsx` · `CourseSwitcher.jsx`(신규) · `frontend/tests/course-select.smoke.test.mjs`(신규) |
| **FE-B** | 온보딩 재배치(R10-J 본체) | `frontend/src/App.jsx` · `frontend/src/modules/auth/**` (`LoginPage`·`ConvertAccountPage`(신규)) · `GuestSaveBanner.jsx`(신규) · `frontend/src/lib/onboardingGate.js` · `frontend/tests/guest-convert.smoke.test.mjs`(신규) |
| **FE-C** | 복습 큐 카드 + mock | `frontend/src/components/ReviewQueueCard.jsx`(신규) · `frontend/mock/apiMockPlugin.js`(**단일 소유 — 이번 페이즈 mock 추가는 전부 FE-C**: review-queue + guest/convert) · `frontend/tests/review-queue.smoke.test.mjs`(신규) |
| PM | `scripts/smoke_r10.sh` seed_courses 편입 · 게이트·커밋 | |

### 6.2 계약

**전환 API (BE-1 ↔ FE-B·FE-C의 접점 — 이 형태가 유일한 협상 결과)**
- `POST /auth/guest/convert` (Bearer 필수): `{email, password, nickname?}` →
  200 `LoginResponse`(토큰 재발급). 게스트가 아닌 계정 → 409 `NOT_GUEST`.
  이메일 중복 → register와 동일 의미론. **같은 user_id 유지** — XP·θ·스트릭·진도
  전부 보존이 이 API의 존재 이유다. 게스트 판별은 이메일 도메인
  `@guest.weathermind.invalid`(J의 규약).
- 레이트리밋 가입 관례 준용. users 컬럼 추가 금지.

**코스 선택 (FE-A)**
- CurriculumHome 상단 코스 탭(`GET /courses` 소비, is_default 우선 선택).
  weather 트리는 현행 그대로(기존 스모크 무회귀가 판정 기준), basic-science는
  빈 트리 안내("개념 트리 설계 완료 — 유닛 준비 중", specs/11 §2 3섹션 예고).
- prereq 표기는 "선행 학습(권장)" — **잠금 아님**(PM 판정 ①).
- FE-C의 `ReviewQueueCard`·FE-B의 `GuestSaveBanner`를 마운트(각 1줄 — props 없는
  자급 컴포넌트 계약).

**온보딩 재배치 (FE-B)**
- 게스트 CTA를 주 동선으로 승격(가입은 보조 동선) — "계정 없이 즉시 체험"이
  R10-J의 축. 배치고사·첫 세션까지 게스트로 완주 가능해야 한다.
- `GuestSaveBanner`: 게스트 && 진도 있음(xp>0 등)일 때만 렌더, `ConvertAccountPage`로
  유도. 전환 성공 시 토큰 교체 + 게스트 표식 해제.
- props 없는 자급 컴포넌트로 제작(마운트는 FE-A).

**복습 큐 카드 (FE-C)**
- `GET /progress/review-queue` 소비, due 항목 상위 3개 + "복습하러 가기"(/daily).
  due 0건이면 렌더 생략(빈 카드 금지). props 없는 자급 컴포넌트.
- mock: review-queue + guest/convert 두 경로를 서버 형태와 동일하게(parity 관례).
  전환 mock은 BE-1 계약(위)을 그대로 구현.

### 6.3 페이즈 B — 문자열 외부화 전면 (A 착지 후, 병렬 2인)

| 담당 | 소유 (디렉토리 서로소) |
|---|---|
| **FE-D1** | `frontend/src/modules/board/**` · `modules/explore/**` (문자열성 최다 밀집) |
| **FE-D2** | 그 외 전부(`components/**`·`modules/{curriculum,session,quiz,duel,league,auth,dev}/**`) + **LocaleSwitcher Layout 배선** + i18n 리소스 파일(`ko.js`·`en.js` — D1은 자기 키를 별파일 `resources/board.ko.js`류로 분리해 충돌 회피) |

- 대상은 **화면 노출 문자열만**(FE-1 실측 887라인 기준). 주석·로그·테스트 문자열 제외.
- en 번역은 담당이 직접 작성(UI 문구 — G1 불요).
- 판정 기준: 스모크 11종 무회귀 + i18n 키 패리티 가드 통과 + en 전환 실마운트 확인.

### 6.4 공통 (§4 승계)

파괴적 git 금지 · docker 금지 · 소유 밖 보고만 · 테스트 기준선 backend 1063 ·
ai-worker 193 · 프론트 스모크 10종(+신규). 커밋은 PM.

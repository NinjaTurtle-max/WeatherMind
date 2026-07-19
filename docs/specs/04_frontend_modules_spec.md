# 프론트엔드 모듈 상세 스펙

> 각 모듈의 화면 상태(state), API 호출 시점, UI 컴포넌트 구성을 정의. React + Vite 기준.

## 공통 구조

```
frontend/src/store/  → Zustand 스토어 3개
  - authStore.js      (user, token)
  - progressStore.js  (xp, streak, level)
  - quizStore.js       (currentQuiz, answerState)
```

공통 컴포넌트 (`frontend/src/components/`):
- `XPBar.jsx` — 상단 고정, xp/next_level_xp 프로그레스바
- `StreakBadge.jsx` — 스트릭 숫자 + 불꽃 아이콘
- `FeedbackPanel.jsx` — RAG 피드백 표시용 슬라이드업 패널 (4개 모듈 공용)
- `LoadingSpinner.jsx`

---

## 1. 오늘의 기상 퀴즈 (`modules/quiz/`)

**화면 상태 머신**
```
IDLE → LOADING(GET /quiz/today) → SHOWING_QUESTION
  → (사용자 답 선택) → SUBMITTING(POST /quiz/{id}/answer)
  → RESULT_SHOWN(FeedbackPanel 표시, is_correct에 따라 색상 분기)
  → (다음 문제 있으면) SHOWING_QUESTION 복귀, 없으면 → COMPLETED
```

**컴포넌트**
- `QuizPage.jsx` — 상태머신 컨트롤러
- `QuestionCard.jsx` — question_type에 따라 3가지 렌더 분기 (객관식 버튼 / 텍스트 입력 / 슬라이더)
- `ResultBanner.jsx` — 정답/오답 색상(초록/주황) + XP 획득 애니메이션

**진입 조건**: 로그인 후 메인 페이지 최초 진입 시 자동 (출석 체크 겸용, `POST /progress/attendance` 동시 호출)

---

## 2. 기후 탐정 (`modules/detective/`)

**화면 상태 머신**
```
CASE_INTRO(사건 배경 텍스트 + 대표 이미지)
  → DATA_EXPLORATION(과거관측 데이터 그래프, 클릭 가능한 데이터 포인트)
  → CLUE_COLLECTED (사용자가 데이터 포인트 3개 이상 클릭)
  → HYPOTHESIS_INPUT(원인 추론 선택지 또는 자유 서술)
  → AI_FEEDBACK(FeedbackPanel, 논리 타당성 코멘트)
  → CASE_SOLVED
```

**컴포넌트**
- `DetectivePage.jsx`
- `DataExplorer.jsx` — Recharts 라인차트, 데이터 포인트 hover/click 이벤트
- `ClueList.jsx` — 수집한 단서 사이드바
- `HypothesisForm.jsx`

**데이터 소스**: 백엔드 `/quiz/history` 대신 별도 엔드포인트 필요 — **추가 필요 API**: `GET /api/v1/cases/{case_id}` (과거관측 API 기반 사전 큐레이션 사건 목록, ai-worker에서 월별 배치 생성)

---

## 3. 기후 시뮬레이터 (`modules/simulator/`)

**화면 상태**
```
단일 화면, 상태머신 없음 — 순수 반응형 UI
슬라이더 3개(CO2, 기온, 강수) 값 변경 → 그래프 즉시 재계산(클라이언트 사이드, API 호출 없음)
"시나리오 저장" 버튼 클릭 시에만 결과 스냅샷을 backend로 전송(선택 기능, MVP 제외 가능)
```

**컴포넌트**
- `SimulatorPage.jsx`
- `VariableSlider.jsx` × 3
- `ClimateChart.jsx` — Recharts, 슬라이더 값에 따라 실시간 리렌더

**중요**: 이 모듈은 기상청 API 실시간 호출이 필요 없음 — 사전 정의된 기후 모델 계수(단순 선형/비선형 함수)로 클라이언트에서 계산. **AI 체인 관여 없음.** (실현 가능성 확보를 위한 의도적 단순화 — MVP에서 가장 구현 부담 적은 모듈)

---

## 4. 기상 리그 (`modules/league/`)

**화면 상태 머신**
```
CHECK_STATUS (GET /league/current)
  → 이미 제출함 → SHOWING_WAITING(리더보드만 표시)
  → 미제출 → PREDICTION_FORM
  → SUBMITTING(POST /league/predict)
  → SUBMITTED_WAITING
(주간 배치로 실제 결과 반영 후) → RESULT_REVEALED(ELO 변동 애니메이션)
```

**컴포넌트**
- `LeaguePage.jsx`
- `PredictionForm.jsx` — temp_max/min, rain_prob 입력
- `Leaderboard.jsx` — 테이블, 내 순위 하이라이트

---

## 라우팅 (`App.jsx`)

```jsx
<Routes>
  <Route path="/" element={<QuizPage />} />
  <Route path="/detective" element={<DetectivePage />} />
  <Route path="/simulator" element={<SimulatorPage />} />
  <Route path="/league" element={<LeaguePage />} />
  <Route path="/login" element={<LoginPage />} />
</Routes>
```

react-router-dom v6 사용, 하단 탭바 네비게이션(모바일 대응).

---

## 바이브 코딩 지시사항

```
frontend/src/modules/quiz/ 부터 시작해서 위 상태머신 스펙대로 QuizPage.jsx를 구현해줘.
Zustand로 quizStore를 만들고, react-query(TanStack Query)로 API 호출을 감싸줘.
question_type이 multiple_choice/short_answer/slider 3가지에 따라 QuestionCard 내부에서
분기 렌더링하는 구조로 만들어줘. 스타일은 Tailwind CSS 사용.
FeedbackPanel은 4개 모듈에서 재사용할 거니까 props로 message, isCorrect를 받는
공용 컴포넌트로 components/ 아래 만들어줘.
```

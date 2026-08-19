# 8/18 롤링분 결함 9건 — 원인 확정본 (2026-08-19, PM 세션 실측)

수신자: `de1461`(A조) · `693496`(B조) · PM(C조). **8/20 롤링 필수.**

전건 **실서버 `https://34-47-71-146.sslip.io`에서 PM이 직접 확인**했다. 추정이 아니다.
계정 실측값: `level_group=adult` · 지식단계 **Lv.6(고등학교 일반선택)** · `placement_done=true` ·
`daily_goal_items=9` · `nickname` 미설정 · 배치가 **섹션 1~6의 75유닛을 열었다**.

---

## 0. 가장 중요한 발견 — ⑦⑧⑨는 한 뿌리다

**수준·진단이 「열 수 있는 최대치」만 정하고, 실제 시작 위치는 언제나 1번이다.**

고등학교 수준으로 진단받은 학습자가 화면에서 보는 것:

| 화면 | 표시 |
|---|---|
| `/learn` 섹션 헤더 | **「섹션 1 · 초등 3~4학년」** · `0/13 완료` |
| `/learn` 하단 게이지 | **`0 / 138 유닛`** |
| `/learn` 커서(⭐ 시작) | 트리 **맨 위 첫 유닛** |
| 유닛 세션 태그 | **「초등 3~4학년」** |
| `/board` | 49판 중 **01~04만 열림**, 05부터 전건 🔒 「앞 퍼즐부터」 · 진행도 `1/49` |

즉 **배치고사를 본 흔적이 화면 어디에도 없다.** 75유닛을 인정받고도 초등 3~4학년
빈칸 채우기부터 시작한다. 이것이 사용자가 *"수준에 따라 열리면 열린 것 중 최상위부터
진행돼야지 왜 아래부터 진행되냐"*고 지적한 내용이다.

---

## 1. 결함 표 (9건)

| # | 증상 | 확정 원인 | 소유 |
|---|---|---|---|
| ① | 진도 불러오기 **진입점 없음** | `/me`의 「💾 진도 저장」 카드가 **안내 문구 한 줄뿐** — 버튼·입력 0개 | B |
| ② | 저장이 **이메일+비밀번호**를 요구 | 유일한 통로가 `ConvertAccountPage`(계정 전환). 닉네임 기반 통로 부재 | B |
| ③ | **닉네임 설정이 안 뜨고 「기상 학습자」 고정** | 닉네임 입력이 `EntryInfoPage`(최초 진입)에**만** 존재. `App.jsx:354 needsEntryInfo = atEntry && entryChoice===undefined` — 이미 들어온 사용자는 다시 못 봄. 표시값은 `ko.js:393 defaultNickname` | B |
| ④ | 학습 수준 노드가 선택 후에도 **계속 뜸** | `ProgressPage.jsx:502` 카드. 선택 표시가 **1px 테두리뿐**이라 골랐는지 안 보임(하루 목표는 진한 파랑 채움 — 같은 화면에서 강조가 어긋난다) | B |
| ⑤ | 하루 목표 노드가 선택 후에도 **계속 뜸** | 제목이 「하루 목표를 **정해요**」(`dailyGoal.pickerTitle`) — 정한 뒤에도 정하라고 말한다 | B |
| ⑥ | 문항 수 불일치 | 목표 선택지 `{3,5,9}`(`lib/onboardingGate.js:59`, 서버가 그 외 값 422) ↔ 데일리 세션 **10**(`config.py:103 SESSION_RECIPE` 합) ↔ 유닛 세션 **4**. **10을 고를 방법이 없다** | C |
| ⑦ | 완료 게이지 `0/138` | 게이지가 `cleared` 개수만 셈(`PcCurriculumPath.jsx:522,546` · `CurriculumHome.jsx:340`). 배치는 `unlock_floor`만 올리고 `cleared_at`을 안 채움 | A |
| ⑧ | 열린 것 중 **맨 아래부터** 진행 | `curriculum_service.py:653-659` — `current` 승격이 *"잠기지 않은 **첫** 미클리어 유닛"*. 배치가 앞 75개를 열어도 전부 미클리어라 커서가 **맨 앞으로 떨어진다** | A |
| ⑨ | 수준에 따라 **보드가 안 열림** | `routers/board.py:140 locked_difficulties`는 `level_group`으로 **난이도 천장**만 올린다(초등=쉬움 / 중고등=쉬움+보통 / 성인=전부). 그런데 순차 잠금(「앞 퍼즐부터」)이 그대로라 성인도 1번부터 하나씩. `ko.js:401`이 *"보드에서 열리는 난이도가 이 설정을 따라가요"*라고 약속하는데 지켜지지 않는다 | A |

---

## 2. 조별 소유 (배타 — 겹치면 즉시 PM에 보고)

### A조 — `de1461` · ⑦⑧⑨ 「수준을 진행 위치로 전파한다」
```
backend/app/services/curriculum_service.py
backend/app/routers/board.py
frontend/src/modules/curriculum/PcCurriculumPath.jsx
frontend/src/modules/curriculum/CurriculumHome.jsx
frontend/src/modules/board/**
backend/tests/test_curriculum_*.py · test_board_*.py
```

### B조 — `693496` · ①②③④⑤ 「진입·저장·노드 표현」
```
frontend/src/App.jsx
frontend/src/modules/progress/ProgressPage.jsx
frontend/src/modules/onboarding/EntryInfoPage.jsx
frontend/src/modules/auth/ConvertAccountPage.jsx
frontend/src/components/SaveProgressForm.jsx
backend/app/routers/auth.py
frontend/src/i18n/resources/{ko,en}.js  ← `dailyGoal.*` 키만 제외(C조 소유)
```

### C조 — PM · ⑥ 「수치 정합」
```
backend/app/core/config.py
frontend/src/lib/onboardingGate.js
frontend/src/modules/progress/DailyGoal.jsx
i18n의 `dailyGoal.*` 키
```

---

## 3. 판정 기준 (AC) — 「고쳤다」의 정의

전건 **실서버 화면**으로 판정한다. jsdom 초록은 착지 증거가 아니다(8/18에 번들
문자열 마커만 보고 6건을 놓친 전례).

- ⑦ 배치 직후 `/learn` 하단이 `0 / 138`이 **아니어야** 한다
- ⑧ 배치 직후 ⭐(시작)가 **열린 구간의 최상위**에 있어야 한다. 섹션 헤더가
  진단 수준(고등)과 **같은 단계**를 가리켜야 한다
- ⑨ `adult`로 `/board` 진입 시 열린 판이 **4판보다 많아야** 한다
- ③ 최초 진입을 지난 사용자가 **닉네임을 바꿀 수 있어야** 한다
- ①② 진도 저장이 **닉네임으로** 되어야 한다(이메일·비밀번호 요구 금지 —
  대회 규정상 로그인 없이 열려야 하고, 규정 안에 있음이 확인된 방식이다)
- ④⑤ 고른 뒤에는 **고른 값이 보여야** 하고 다시 고르라고 말하지 않아야 한다
- ⑥ 목표 최대값과 데일리 세션 길이가 **같아야** 한다

## 4. 드리프트 감시

⑥·⑦·⑧·⑨는 값이 다시 어긋날 수 있는 자리다. **계약 테스트로 못박는다**
(`test_ci_workflow_contract`·`test_seed_contract` 선례). 특히 ⑥은 `SESSION_RECIPE`
합과 `DAILY_GOAL_CHOICES` 최대값을 **한 테스트가 함께** 읽어야 한다 — 한쪽만
바꾸면 우는 형태여야 한다.

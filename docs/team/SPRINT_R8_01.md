# 스프린트 R8-01 — 마일스톤 2: 통합 진척 축

> 로드맵 마일스톤 2 "사일로 → 하나의 적응형 여정". 출제 경로 θ 연동은 R7-01/02가
> 선행 완료 — 이번 본체는 **진척 축 통합**(XP·왕관·θ·ELO·구름 5축이 상호참조 거의 0).

## 0. 탐색 확정 사실 (2026-07-29, 2기 병렬)

- XP는 소비·게이팅 0인 순수 표시값. 유닛 왕관 쓰기 경로는 유닛 세션 만점 단 1개 —
  데일리·보드탭·듀얼·리그·출석의 유닛 기여 0.
- **결함 2건**: ① `unit_result` 계약 결손 — 유닛 클리어 화면 왕관이 항상 0으로 렌더
  (프론트가 읽는 필드를 백엔드가 반환 안 함) ② θ가 데일리 경로에서만 재추정 —
  커리큘럼만 하는 유저의 θ는 배치 시점 동결(선해제·난이도 정렬이 낡은 값).
- XP 이원화: 듀얼 XP가 celery 생 SQL로 xp_service 우회 + DUEL_WIN_XP 이중 정의.
  死상수 2개(탐정 +30·리그 +40). 스펙 07 드리프트 9건.
- weak_tags = quiz_logs의 캐시 집계(원본 정보 아님). 사용자 UI는 이미 100% θ.
  60% 임계 ↔ θ<-0.5는 **학령별 비등가**(elementary만 근사 일치 — b 차이).
  θ가 못 덮는 것: 같은 세션 내 최신 증거(θ는 세션 경계에서만 재추정),
  ai-worker 장애 중 유일 신호. → 라우터 폴백·테이블·writer는 유지.

## 1. 제품 결정 (2026-07-29 클라이언트 확정)

| 항목 | 결정 |
|---|---|
| 홈 최상위 진척 표시 | **유닛 진척 + XP 병기** — 스파인(유닛 진도) 1순위, XP/레벨은 보상감으로 병기 |
| 유닛 밖 활동의 왕관 기여 | **보드 탭 + 데일리 모두 인정** (규칙 §3.4 — 결정적·중복 보상 방지) |
| weak 임계 | **학령 상대 임계** — "내 학령 표준 문항 예상 정답률 60% 미만"(현행 의미 보존) |

## 2. 스토리

| # | 스토리 | 담당 |
|---|---|---|
| S1 | unit_result 계약 복구 + 유닛 밖 활동→왕관 유입로(보드탭·데일리) | 백엔드 SA-1 |
| S2 | 유닛 세션 발급 θ 재추정(동결 해소) + 스파인 서버 집계·/progress/me 확장 | 백엔드 SA-4 |
| S3 | weak 판정 θ 파생 단일 공급원(학령 상대 임계) + 소비자 5곳 교체 | 백엔드 SA-2 |
| S4 | XP 단일 창구화 — 듀얼 상수 단일 소유(교차 컨텍스트 계약 테스트)·死상수·07 개정 | 백엔드 SA-3 |
| S5 | 프론트 — 클리어 왕관 렌더·홈 헤더 병기·스파인 카드·mock | 프론트 |
| S6 | 통합·회귀·스모크 확장·회고 | QA+DevOps |

## 3. 계약 (고정)

### 3.1 unit_result (S1)
`SessionCompleteResult`에 additive 필드
`unit_result: {all_correct, crowns, crown_target, cleared, unit_xp} | null`
(유닛 세션일 때만; grant_unit_crown 반환 dict를 그대로 노출 — session.py:378에서
현재 버려지는 값). 프론트 UnitSessionPage가 기대하는 형태와 정합.

### 3.2 θ 재추정 확장 (S2)
`POST /units/{slug}/session` 발급 경로에 refresh_abilities 1회(데일리
session_service.py:436 전례와 동일 — 실패 시 load_abilities 폴백). 잠금
판정(placement_unlock_floor)·풀 정렬이 신선한 θ 사용.

### 3.3 스파인 집계 (S2)
- `GET /progress/me`에 additive `spine: {units_total, units_cleared,
  crowns_earned, crowns_total, current_unit: {slug, title} | null}` — 서버 계산
  (CurriculumHome의 클라 계산과 동일 정의: cleared=cleared_at 존재,
  crowns_total=Σcrown_target, current=잠기지 않은 첫 미클리어).
- 02번 스펙 /progress/me 갱신은 S6에서 일괄.

### 3.4 왕관 유입로 (S1) — 결정적·중복 보상 방지
- **보드 탭**: `POST /board/puzzles/{id}/attempt` 성공이 **그 퍼즐 최초 클리어**일 때
  (기존 XP+5 판정과 동일 조건), 같은 concept_tag의 kind='board' 유닛이 열려
  있으면(is_unit_locked 통과) grant_unit_crown +1. 같은 퍼즐 재클리어는 불인정
  (crown_target=2는 서로 다른 퍼즐 2개로 달성).
- **데일리**: daily 세션 complete가 전 문항 정답(correct==total>0)일 때, 세션 문항
  최다 개념(동률이면 route target_concept_tag 우선, 그래도 동률이면 태그 사전순)의
  "열려 있는 첫 미클리어(crowns<crown_target) quiz 유닛"에 grant_unit_crown +1.
  daily는 하루 1세션(멱등 인덱스)이라 파밍 자연 상한. 대상 유닛이 없으면 무동작.
- 두 경로 모두 unit_result와 동일 형태의 `crown_award` 필드를 응답에 additive 노출
  (보드 attempt 응답·daily complete 응답) — 프론트 토스트용.
- placement 세션은 제외.

### 3.5 weak θ 파생 (S3)
- `weatherbrain_service.weak_theta_threshold(level_group) = LEVEL_GROUP_ITEM_B[lg]
  + logit(WEAK_EXPECTED_P)` — `WEAK_EXPECTED_P = 0.6`(신규 계약 상수, ln(0.6/0.4)≈0.405).
- `weak_concepts(abilities, level_group) -> list[str]`: `num_responses>0 AND
  theta < weak_theta_threshold(level_group)`.
- 소비자 교체 5곳: review 풀(session_service.py:438-445), XP 약점 배율
  (answer_service.py:227-231 — θ 세션 스냅샷 기준, 문항별 뒤집힘 없어지는 행동 변화
  수용), 퀘스트 weak_correct_1(quest_service.py:137-144), GET /progress/weak-tags
  (θ 파생 응답으로 재정의 — 임계 적용), /dev/state.weak_tags(동일 — 기존 "임계
  미적용" 표시 불일치 해소).
- **유지**: weak_tags 테이블·writer(update_weak_tag)·라우터 폴백(R2·R3, ai-worker
  장애 복원력)·xp_service.is_weak_concept(deprecated shim, docstring 명시).
- 계약 테스트: WEAK_EXPECTED_P·학령별 임계값 3종 고정, ai-worker와 무관(백엔드 전용).

### 3.6 XP 단일 창구 (S4)
- `DUEL_WIN_XP` 단일 소유 = backend duel_service. celery league.py의 이중 정의는
  **교차 컨텍스트 계약 테스트**(test_kma_contract 전례 — sys.path로 celery 상수
  실임포트 대조)로 드리프트 감시. 물리적 병합 금지(빌드 컨텍스트 분리 원칙).
- 死상수 제거: XP_DETECTIVE_SOLVE·XP_LEAGUE_TOP10 — 스펙 07에서 "로드맵(미구현)"
  표기로 이동.
- `XP_STREAK_7_BONUS` → `XP_STREAK_MILESTONE_BONUS` 개명(7/30/100 동일 지급 실동작
  반영, 07도 동일 문구로).
- xp_service 모듈 docstring = XP 원천 전수 카탈로그(11종)로 재작성.
- 스펙 07 개정: §1 표를 전수 카탈로그로, **§0 "진척 모델" 신설** — 스파인=유닛
  트리(왕관·cleared), XP=보상 표시축, θ=능력(WeatherBrain), ELO=경쟁, 구름=게이트.
  스트릭 프리즈 실동작(§3)·퀘스트 XP 재집계 의미(daily_xp_30) 명문화.

### 3.7 프론트 (S5)
- UnitSessionPage: unit_result 렌더(이미 코드 존재 — 계약 복구로 자동 소생, 확인만).
- Layout 헤더: 스파인 진척(유닛 n/m·왕관) 1순위 + XPBar 병기(교체 아님).
- ProgressPage: 스파인 카드(진도율·current unit·"이어서 학습" 링크) 추가.
- 보드/데일리 crown_award 토스트("👑 왕관 획득 — {유닛명}").
- DuelPage "+15 XP" 하드코딩 정리(상수 파일로).
- mock: spine·crown_award·weak θ 파생 응답 동기화.

## 4. 웨이브

- 웨이브 1 (병렬 5): SA-1 `feat/r8-02-unit-result-crowns`(S1) · SA-2
  `feat/r8-03-weak-theta`(S3) · SA-3 `feat/r8-04-xp-ledger`(S4) · SA-4
  `feat/r8-05-spine-aggregate`(S2) · 프론트 `feat/r8-06-spine-ui`(S5).
  파일 소유: SA-1=routers/session.py·routers/board.py·curriculum_service(왕관
  헬퍼)·schemas/session / SA-2=weatherbrain_service(weak)·session_service(R1)·
  answer_service·quest_service·progress.py(weak-tags)·dev.py / SA-3=xp_service·
  celery·docs/specs/07 / SA-4=routers/curriculum.py·curriculum_service(집계)·
  routers/progress.py(/me)·schemas/progress·schemas/curriculum / 프론트=frontend만.
  공유 파일 주의: curriculum_service(SA-1 왕관 vs SA-4 집계 — 함수 분리),
  progress.py(SA-2 weak-tags vs SA-4 /me — 엔드포인트 분리).
- 웨이브 2: `chore/r8-07-integration` — 병합(SA-2→SA-3→SA-4→SA-1→프론트→docs),
  회귀, 스모크 확장(유닛 세션 θ 재추정·spine 필드·왕관 유입 1건), 02 스펙 /me
  갱신, 회고.

## 5. 리뷰 노트·회고

(웨이브 2 종료 시 기록)

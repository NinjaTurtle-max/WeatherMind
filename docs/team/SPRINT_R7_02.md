# 스프린트 R7-02 — 배치고사 사용자 피드백 반영 + θ 통합 선행

> 클라이언트 실사용 피드백(2026-07-29) 4건 반영. 마일스톤 1 보정 + 마일스톤 2(통합
> 진척 축) 일부 선행 당김. 팀 형식: 직군 리드 7 + 태스크량 비례 팀원 파생.

## 0. 배경 — 피드백과 탐색으로 확정된 사실

클라이언트 피드백: ① 채점 대기가 문항마다 길다 → 일괄 채점 + "난이도 찾는 중" UX
② 신고 레벨별로 배치 문제가 겹친다 ③ 배치 점수가 달라도 시작 학습 단계·보드
난이도가 동일 ④ (PM 발견) 배치 미응시자 재진입 입구 부재.

탐색 실측(2026-07-29, 3기 병렬):
- ①의 원인은 채점(순수 함수, μs)이 아니라 **문항마다 Gemini RAG 피드백을 동기
  대기**(타임아웃 60s, ai_client.py `_post` 기본값). placement 로그는 발급 시점에
  미채점으로 선생성되므로 일괄 채점은 additive로 가능. 채점 권위는 서버 유지
  (요청은 answer만, 채점은 GRADERS).
- ②의 원인은 재고가 아니라 구조: 세 그룹 플랜이 같은 셀에서 항상 첫 문항을 소비
  → elementary~middle_high **50% 중복**, middle_high~adult 50%. 개념→그룹 배정
  회전(k=rank×2) + 셀 내 그룹 오프셋으로 **저작 0건에 완전 서로소**(시드 시뮬 검증).
- ③ 관련 발견 2건: (a) **프론트 잠금 표시 버그** — CurriculumHome이 백엔드가 안
  보내는 `status` 필드 참조 → 🔒·현재 유닛 강조 미렌더. (b) **하드 블록** — board
  퍼즐이 elementary 0건이라 초등 유저는 3번째 유닛에서 영구 잠금(성인도 유사).
  θ 풀 확장(daily에 이미 한 패턴)을 유닛 세션에 적용하면 자동 해소.

## 1. 제품 결정 (2026-07-29 클라이언트 확정)

| 항목 | 결정 |
|---|---|
| 선해제된(건너뛴) 유닛 | **잠금만 해제** — 왕관·XP 0 유지, 돌아가 클리어 가능 |
| 선해제 자격 | **배치 실응답만** — num_responses>0 개념 θ만 반영(자기신고 사전 θ 불인정) |
| 보드 탭 | **난이도 라벨 + θ 인접 정렬** — 잠금 없음, 전 퍼즐 개방 유지 |
| 범위 | 전부 (S1~S8) |

## 2. 스토리

| # | 스토리 | 담당 | AC 요지 |
|---|---|---|---|
| S1 | 배치 일괄 채점 + "난이도 찾는 중" UX | 백엔드 SA-1 + 프론트 | submit-all 1회로 채점, 문항 간 대기 0, 전환 화면 후 θ 요약 |
| S2 | 신고 그룹별 서로소 배치 구성 | 백엔드 SA-3 | 세 그룹 6문항 완전 서로소(시드 기준), 배합비·결정성 유지 |
| S3 | θ→유닛 세션 풀 (하드 블록 해소) | 백엔드 SA-2 | 유닛 세션이 daily와 같은 θ 풀 확장·b 정렬, 콜드스타트 불변, elementary도 커리큘럼 완주 가능 |
| S4 | θ→커리큘럼 시작점 + 잠금 표시 버그 수정 | 백엔드 SA-2 + 프론트 | 배치 실응답 개념 θ≥상위 경계인 선두 연속 유닛 선해제(잠금만), UnitOut에 status 파생 필드 → 🔒·현재 강조 실렌더 |
| S5 | 보드 난이도 라벨 + θ 정렬 | 백엔드 SA-3 + 프론트 | 퍼즐별 難이도 1~3 파생 라벨, 목록이 θ 인접 정렬, 잠금 없음 |
| S6 | 진단 입구 배너 | 프론트 | placement_done=false면 진단 배너(→/onboarding/placement), 완료 시 소멸 |
| S7 | RAG 지연 완화 | AI | ai-worker LLM 클라이언트 캐시 / backend rag 타임아웃 60→10s — daily 체감 개선 |
| S8 | 배치 취약 셀 보강 | 데이터 | air_mass×E·anomaly×E·pressure_front×A·typhoon×A 각 +1 (49→53) |
| S9 | 통합·회귀·스모크 확장·회고 | QA+DevOps | 전체 그린 + 스모크 9단계에 submit-all 경로 반영 |

## 3. 계약 (고정)

### 3.1 일괄 채점 (S1)
- **`POST /api/v1/onboarding/placement/submit-all`** — body `{answers: [{quiz_id, answer, elapsed_sec?}]}`.
  채점 필드(is_correct 등) 수신 금지 — 서버 GRADERS가 채점(권위 불변). 이미 채점된
  로그는 멱등 스킵. 피드백(RAG) 생성 없음. 응답 `{results: [{quiz_id, is_correct}],
  progress: {answered, total}}`. 레이트리밋 LIMIT_TODAY급. placement 세션 전용
  (daily 확장은 에너지 회계 미해결로 범위 외).
- 기존 문항별 `/session/{id}/answer`는 불변(하위 호환) — placement UI만 신경로 사용.
- 프론트: 답안 로컬 수집(제출 즉시 다음 문항, 스피너·피드백 패널 없음) → 마지막
  문항 후 **"내 난이도를 찾는 중…" 전환 화면**(애니메이션) → submit-all → complete
  → 기존 θ 요약(정답 수 표기 추가 가능).

### 3.2 서로소 구성 (S2)
- `plan_placement_picks`: 개념→목표그룹 배정을 신고 그룹 rank×2 회전 + 셀 내
  `rank % len(bucket)` 오프셋. 셀 정렬 키를 콘텐츠 기반(`(question_type, str(id))`)
  으로. 그룹별 난이도 배합비(3E/3M · 2/2/2 · 3M/3A) 불변, 결정성 유지.
- AC: 실 시드에서 세 그룹 픽 쌍별 교집합 0. 기존 test_placement 갱신.

### 3.3 θ→유닛 풀 (S3)
- `curriculum_service._unit_content_pool` → `session_service.pool_level_groups` +
  `build_pool_query` 재사용(import — 이동 금지, DRY는 통합에서 판단).
  θ = `overall_theta(load_abilities(db,user), unit.concept_tag)`. 콜드스타트(None)
  현행 불변. refresh_abilities 호출 금지(트리 GET·발급 모두 read-only `load_abilities`).

### 3.4 θ→시작점 + status (S4)
- 순수 함수 `placement_unlock_floor(abilities, units) -> int`: unit_order 선두부터
  연속으로 "해당 unit.concept_tag의 θ가 상위 경계(≥0.5, 기존 `_THETA_INTERMEDIATE_MAX`
  재사용) AND num_responses>0"인 유닛 수. `is_locked(unit, progress, unlock_floor=0)`
  파라미터 추가(기본값 0 = 현행). 게이트(403)와 트리 노출 동일 적용.
- `UnitOut`에 **`status` 파생 필드** 추가: `cleared`(cleared_at)| `current`(첫 미클리어
  열린 유닛)| `unlocked`(열렸으나 current 아님)| `locked`. 프론트 CurriculumHome은
  이 값을 그대로 사용(버그 해소), 선해제 유닛 안내 문구 분기.
- 소급 적용(파생 계산이므로 기본) — 기존 유저도 배치 응시 시 트리가 열림.

### 3.5 보드 라벨·정렬 (S5)
- 순수 함수 `board_difficulty(template_json, level_group) -> 1|2|3`
  (축: guided=쉬움, time_limit=+1, palette 크기, level_group). `BoardPuzzle` 스키마에
  `difficulty: int` 추가(additive). 목록 정렬: θ 인접(`|사전b(level_group)−θ|`) 후
  created_at — daily의 정렬식 재사용, θ None이면 현행. 프론트 배지(쉬움/보통/도전).

### 3.6 진단 배너 (S6)
- ProgressPage WeatherBrain 패널 상단: placement_done=false → "실력 진단 받고 내
  수준 문제 받기" 배너(→/onboarding/placement). 409 방어 기존 유지.

### 3.7 RAG 완화 (S7)
- backend `ai_client.rag_feedback`의 `_post` timeout 60→**10s** (다른 호출 15s와 정합).
- ai-worker `rag_chain._build_chain` 모듈 레벨 캐시(호출당 클라이언트 생성 제거).
  폴백 문구 경로 불변.

### 3.8 시드 (S8)
- 배치 적격(non-board·non-live·active) 4건 저작: air_mass×elementary,
  anomaly×elementary, pressure_front×adult, typhoon×adult. 49→53. CONTENT_GUIDE
  §5 표·PLACEMENT_COVERAGE 갱신. 시드 총량 계약 갱신은 통합(S9)에서.

## 4. 웨이브

- 선행: 이 문서 브랜치 `docs/r7-02-backlog` (병합은 통합 PR에 포함).
- 웨이브 1 (병렬 6): SA-1 `feat/r7-08-placement-bulk`(S1 백엔드) · SA-2
  `feat/r7-09-theta-curriculum`(S3+S4 백엔드) · SA-3 `feat/r7-10-placement-disjoint-board`
  (S2+S5 백엔드) · 프론트 `feat/r7-11-feedback-ui`(S1 UX+S4 status+S5 배지+S6 배너)
  · AI `feat/r7-12-rag-latency`(S7) · 데이터 `feat/r7-13-placement-seed2`(S8).
  전 브랜치 main 기반. 파일 소유: SA-1=onboarding·answer_service·ai_client /
  SA-2=curriculum_service·routers/curriculum·schemas/curriculum / SA-3=
  placement_service·routers/board·schemas/board / 프론트=frontend만 / AI=ai-worker만.
- 웨이브 2 (통합): `chore/r7-14-integration` — merge 순서 SA-2→SA-3→SA-1→AI→프론트
  →데이터→docs, 시드 총량 53 갱신, 전체 회귀+스모크(submit-all 반영), 문서·회고.

## 5. 리뷰 노트·회고 (웨이브 2 — 2026-07-29, `chore/r7-14-integration`)

### 5.1 통합 결과

- 병합 7건 전부 `--no-ff`, **충돌 0** — §4의 파일 소유 분할(SA별 라우터·서비스·
  스키마, 프론트=frontend만, AI=ai-worker만)이 그대로 들어맞았다.
  순서: docs → SA-2(S3+S4) → SA-3(S2+S5) → SA-1(S1) → AI(S7) → 프론트 → 데이터(S8).
- 통합 지점 교차 커밋: 시드 계약 49→**53**(§3.8 예고분 이관), mock 'current'
  전역 1개 정렬, mock 세션 외 quiz_id 404 정렬, 스모크 submit-all 전환(아래).
- 중복·드리프트 감사: SA-1(rate_limit `LIMIT_SUBMIT_ALL`·`RAG_FEEDBACK_TIMEOUT`)·
  SA-2(`unlock_floor`)·SA-3(`board_difficulty`) 상수는 각 1곳 정의·테스트도
  비중복 — 단일화 조치 불필요(계약 테스트 `test_placement_bulk`가 SA-1 상수를,
  `test_curriculum_tree`·`test_board_difficulty`가 각자 소유 함수만 검증).

### 5.2 회귀·스모크 실측

- backend pytest **568 passed** · ai-worker **88 passed + 5 skipped** ·
  pyflakes 3앱 무결 · frontend build OK · `scripts/ci.sh` 전 단계 OK.
- 이미지 재빌드(backend·ai-worker·frontend) + 시드 재적재(삽입 4/갱신 49 → 53건)
  후 `scripts/smoke.sh` **10단계 전부 그린, 재실행 멱등**:
  - 9 placement(submit-all 전환): is_correct 주입 → **422 거부**(extra='forbid'
    실검증) · submit-all 6건 일괄 채점(results 6·progress 6/6) · 구름 불변(5→5) ·
    complete 후 **max|θ|=0.586**(사전값 0.0에서 이동, 재실행도 동일값 — 결정적) ·
    409 PLACEMENT_ALREADY_DONE · /progress/me placement_done=true.
  - 10 unit(신설): 유닛 12개 전부 status 보유·current 정확히 1개, 첫 유닛
    (read-sky-pressure) 세션 발급 200·문항 3~4건(θ 풀 확장 실기동).

### 5.3 계약 판정 (통합 확정 4건)

| 판정 대상 | 결론 |
|---|---|
| submit-all의 세션 식별 — body에 session_id 없이 당일 placement 세션 암묵 식별 | **일치**(백엔드·mock·프론트 동일) |
| complete 경로 — submit-all 도입 후에도 /session/{id}/complete 불변 | **일치**(θ 배정·409·구름 면제 기존 그대로) |
| 커리큘럼 'current' — 트리 전체에서 잠기지 않은 첫 미클리어 **정확히 1개** | 백엔드 기준 확정. mock이 섹션별 1개였음 → **전역 1개로 정렬함** |
| submit-all에 세션 외 quiz_id 제출 | **404 QUIZ_NOT_FOUND**(QuizNotInSessionError). mock '관대 무시'였음 → 404로 정렬함 |

### 5.4 발견·수정 결함

| # | 결함 | 원인 | 조치 |
|---|---|---|---|
| 1 | 스모크 10단계 `unbound variable` 중단 | macOS bash 3.2가 `"$n_units개"`의 한글 첫 바이트를 변수명에 포함해 파싱(set -u) | `${n_units}` 중괄호 경계 명시. 전 스크립트 동일 패턴 부재 확인 |
| 2 | mock 'current' 섹션별 다중 부여 | mock이 섹션 루프 안에서 승격 — 백엔드는 트리 전역 1개 | status 산정 후 전역 첫 unlocked 1개만 승격으로 재작성, mock 스모크로 확인 |
| 3 | mock submit-all 세션 외 quiz_id 무시 | '관대 처리' 주석의 의도적 완화가 백엔드 404 계약과 드리프트 | 404 QUIZ_NOT_FOUND로 정렬 |

### 5.5 잘된 것 / 아쉬운 것 / 범위 밖

- **잘된 것**: 파일 소유 분할로 7-way 병합 충돌 0. S8 문서(§6.3)가 시드 계약
  드리프트를 미리 예고해 통합 지점 갱신이 기계적이었다. 스모크 θ 이동값이
  재실행에서 동일(0.586) — 채점·EAP 경로의 결정성을 실기동으로 재확인.
- **아쉬운 것**: mock의 계약 드리프트 2건(current·404)이 통합에서야 발견 —
  mock은 "응답 스키마 1:1" 선언에도 상태 전이 의미론까지 계약 테스트가 없다.
  스모크 셸이 bash 3.2 호환 함정(한글 연접 변수명)을 리뷰에서 못 걸렀다.
- **범위 밖(다음 증분)**: daily 세션 일괄 채점(에너지 회계 미해결 — §3.1),
  mock↔백엔드 의미론 자동 대조(계약 스냅샷), θ→quiz-generate 실기동 검증은
  KMA/Gemini 키 발급 후 실통합 테스트에서.

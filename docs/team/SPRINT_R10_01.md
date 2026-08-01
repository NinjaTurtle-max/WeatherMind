# 스프린트 R10-01 — 에너지 정책 전환 · WebGL 실사화 · 온보딩/풀이 마찰 제거

> 근거: `docs/Observation_Report_03_R10_UX_Field_Test.md`(2026-07-31 실사용 필드 테스트).
> 원칙 정합: 판정 권위는 서버 소유 불변(§3.4-R3), 표현 라이브러리 무도입 관례 유지
> (three.js 불채택 — 아래 §0), 계약 수치 변경은 env 기본값=계약값 + 계약 테스트로 고정.

## 0. 클라이언트 확정 (2026-08-01)

| 항목 | 결정 |
|---|---|
| 구름 소모 조건 | **오답에만 1 소모** (정답·재제출·배치고사 무소모) |
| 소진 처리 | **문항 진입 전 잔량 부족이면 차단** (제출 시점 거부 폐지) |
| WebGL 구현 | **raw WebGL 자체 구현** (three.js 불채택 — 번들 +0, 외부 라이브러리 금지 관례 유지) |
| WebGL 범위 | **단면 모식도 패널 + 지도 오버레이 둘 다** |
| R10-B(뱅크 확장) | **결정 대기** — 규모·저작 주체 미정, 이번 스프린트 범위 밖(§5) |

## 1. 탐색 확정 사실 (2026-08-01)

- **에너지**: `energy_service`는 순수 함수(regen_amount·apply_regen·next_regen_sec·
  plan_consume) + DB 결합부(get_state·consume) 2층. 계약 수치는 `Settings.CLOUD_*`
  (MAX 5·REGEN 20분·COST 1)에 있고 모듈 상수로 기동 시 바인딩. `consume()` 호출은
  **정확히 2곳** — `routers/session.py:273`(최초 제출·비배치), `routers/board.py:254`
  (매 시도). 둘 다 **채점 전** 호출이라 "정답에도 과금"이 발생한다. 소모는 요청
  트랜잭션을 공유해 이후 예외 시 롤백된다(이 보장은 유지해야 함).
  기능 플래그 `ENERGY_ENABLED`(기본 true) 존재. 에러 코드 `OUT_OF_CLOUDS`(429,
  `next_regen_sec` 동봉) 변환은 R10 직전 정리로 **main.py 전역 핸들러 단일화** 완료.
- **에너지 계약 테스트 소유**: `test_cloud_energy.py`(경계·소진), `test_r3_r5_contract.py`
  (수치 고정), `test_error_code_contract.py`(코드 실재), `test_dev_mode.py`(dev 조작).
- **보드 렌더**: `CrossSectionPanel.jsx`(809줄, SVG 3D 블록 스토리보드 8종),
  `mapInfographic.jsx`(332) + `realisticEffects.jsx`(367) + `precipEngine.js`(97,
  Canvas2D 강수 파티클). 규칙 8종 → rule_id 하드 매핑, **서버 계약 불변**으로
  로컬 엔진이 존별 {현상·구름·rule_id·explain} 산출. reduced-motion 대응은 보드
  비주얼 한정으로 이미 존재(SSR 스모크 `boardVisual.render.test.mjs`가 상주).
- **보드 조작**: `useBoardDrag.js`(119줄) Pointer Events 자체 구현, 탭-탭 병행.
  **되돌리기(언두) 없음**, 힌트 UI는 "힌트 보기 (0/2)" 카운터만 있고 내용 미설계.
- **첫 화면 노출**: 탭바 5종(학습·보드·예보 대결·리그·내 정보)이 가입 직후 전부
  활성. 프로필 화면도 퀘스트 3종·배지 5종·능력 분석을 동시 노출.

## 2. 스토리와 담당

| # | 스토리 | 담당 |
|---|---|---|
| S1 | 에너지 정책 전환 — 오답 소모 + 진입 전 차단 + 계약 테스트 재고정 | 백엔드 SA-1 |
| S2 | WebGL 단면 모식도 (raw WebGL, 8종 스토리보드 이식 + 폴백) | 프론트 FE-1 (메인 트리) |
| S3 | WebGL 지도 오버레이 (기단 번짐·유동·강수 레이어 격상 + 폴백) | 프론트 FE-2 (워크트리) |
| S4 | 온보딩 커밋 장치 + 첫 화면 점진적 잠금 해제 | 프론트 FE-3 (워크트리) |
| S5 | 보드 풀이 보조(언두·점진적 힌트) + 이탈 인텐트 + 콤보·마감 | 프론트 FE-4 (워크트리) |
| S6 | 통합·회귀·스모크·회고 | QA+DevOps |

## 3. 계약 (고정)

### 3.1 에너지 정책 전환 (S1 — R10-A)

**소모 규칙(신규 계약)**

- 소모는 **채점 결과가 오답(`is_correct=false`)일 때만** 1. 정답·재제출(멱등 히트)·
  배치고사(mode=placement)는 0. 보드 퍼즐은 **미통과(`passed=false`)일 때만** 1
  (통과 시 0 — 재도전 자체는 무료가 아니라 "틀린 시도"에만 과금).
- 수치는 불변: `CLOUD_MAX=5` · `CLOUD_REGEN_MINUTES=20` · `CLOUD_COST=1`.
  변경되는 것은 **소모 트리거**이지 수치가 아니다.
- `consume()` 호출 위치를 **채점 이후로 이동**한다. 트랜잭션 공유는 유지 —
  소모 후 예외 시 롤백되어 구름이 새지 않는다(기존 보장 승계).
- `plan_consume`·`apply_regen` 등 순수 함수는 시그니처 불변(회복 모델 무변경).

**진입 차단(신규 계약)**

- 잔량 부족(`clouds < CLOUD_COST`)이면 **문항을 열기 전에** 429 `OUT_OF_CLOUDS`
  (`next_regen_sec` 동봉)로 차단한다. 차단 지점 2곳:
  - `GET /api/v1/session/today` · `POST /api/v1/units/{slug}/session` — 세션 발급
  - `GET /api/v1/board/puzzles/{id}` — 보드 퍼즐 상세 진입
- **이미 발급된 세션의 진행 중 문항은 차단하지 않는다.** 세션 중간에 소진되면
  (마지막 구름으로 진입 → 오답) 그 세션은 끝까지 풀 수 있고, **다음 발급**부터
  차단된다. "풀던 것을 뺏기지 않는다"가 이번 전환의 핵심 불변식.
- 배치고사(mode=placement)는 발급·제출 모두 차단·소모 면제(기존 유지).
- `ENERGY_ENABLED=false`면 차단·소모 모두 no-op(기존 유지).

**프론트**

- 세션·보드 진입 CTA는 잔량 0이면 비활성 + "구름 회복까지 N분" 인라인 표기
  (429를 받고 나서 알리는 게 아니라 **누르기 전에** 알린다).
- 오답 피드백에 "구름 −1"을 명시해 소모 사유를 보이게 한다(정답 시 미표기).
- 소진 화면 문구를 "노력이 아니라 실수에 소모된다"는 새 규칙에 맞게 교체.

**테스트(신규 계약 테스트 — 수정 전 실패해야 함)**

1. 정답 제출 시 `clouds` 불변 2. 오답 제출 시 정확히 1 감소 3. 재제출(409) 시 0
4. 배치고사 제출 시 0 5. 보드 통과 시 0 / 미통과 시 1 6. 잔량 0에서 세션 발급·
보드 진입 429(`next_regen_sec`>0) 7. 잔량 0이어도 **발급된 세션의 남은 문항 제출은
200**(정답이면 소모 0, 오답이면 0으로 유지 — 음수 불가) 8. 기존 회복 경계
(0·19분·20분·100분·MAX clamp) 회귀 그대로.

> 7번의 "오답인데 잔량 0" 경계: 소모는 `max(0, clouds-1)`가 아니라 **가드된 원자
> UPDATE(`clouds >= COST`)가 0행을 반환하면 소모 생략하고 정상 응답**한다. 진행 중
> 세션을 429로 끊지 않기 위한 예외이며, 이 분기에 계약 테스트를 건다.

### 3.2 WebGL 단면 모식도 (S2 — R10-C 전반)

- **raw WebGL2 자체 구현**. 외부 라이브러리·에셋 0(셰이더·지오메트리 절차 생성).
  기준 이미지 = `img/중.png`(3D 블록)의 자연스러운 움직임.
- 서버 계약·rule_id 매핑 **불변**. 입력은 기존과 동일한 로컬 엔진 산출
  {현상·구름·rule_id·explain} + 4단계 스토리보드 시퀀스. 8종 전부 이식한다.
- 렌더 요소: 기단 볼륨(반투명 색), 전선면(경사 슬랩), 상승/하강 기류(벡터 필드),
  구름 볼륨(노이즈), 강수(인스턴싱 파티클), 지표 격자. 카메라는 고정 아이소메트릭
  (사용자 조작 없음 — 학습 초점 유지).
- **폴백 필수**: WebGL2 컨텍스트 생성 실패·`prefers-reduced-motion`·SSR에서는
  **기존 SVG 스토리보드 경로를 그대로 사용**한다(삭제 금지, 회귀 0).
  reduced-motion은 정적 최종 프레임 + 단계 텍스트 전체 목록(기존 계약 승계).
- 성능 예산: 60fps 목표, 컨텍스트 1개, 드로우콜 ≤ 32, 유휴 시 rAF 정지
  (visibilitychange·IntersectionObserver — 기존 precipEngine 관례 답습).

### 3.3 WebGL 지도 오버레이 (S3 — R10-C 후반)

- 지도 **베이스(반도 지형·존 노드·표준 전선 기호·라벨)는 SVG 유지**. WebGL은
  그 위에 겹치는 **오버레이 레이어 1장**만 담당한다: 기단 색 번짐(확산),
  유동 화살표 흐름장, 강수(현행 Canvas2D `precipEngine` 대체), 터뷸런스 구름.
  → 상호작용(존 탭·드래그)은 SVG 계층이 계속 소유하므로 `useBoardDrag` 무수정.
- 좌표계는 지도 SVG의 `viewBox` userSpace를 단일 진실원으로 삼아 WebGL 캔버스를
  절대배치 정합(리사이즈 시 재계산). 존↔지역 매핑은 `board_regions.json` 유지.
- **폴백**: WebGL 실패 시 현행 Canvas2D+SVG 경로 그대로(현행 코드 보존).
  reduced-motion 시 오버레이 정적 렌더.
- `precipEngine.js`(Canvas2D)는 폴백 경로로 남긴다 — 이번 스프린트에서 삭제 금지.

### 3.4 온보딩 커밋 + 점진적 잠금 해제 (S4 — R10-D·R10-F)

- **일일 목표 선택 1스텝**: 배치고사 직후 결과 화면에 "하루 3문항(가볍게) /
  5문항(보통) / 9문항(열심히)" 선택. 저장은 `users` 신규 컬럼 대신 **기존
  진척 저장소 재사용 여부를 웨이브 1에서 SA-1과 확정**(마이그레이션 추가 시
  0008). 세션 완료 화면에 "오늘 목표 N/M" 표기.
- **점진적 잠금 해제**(프론트 게이트, 서버 권한 아님 — 표시 계층):
  | 기능 | 해제 조건 |
  |---|---|
  | 학습(커리큘럼)·내 정보 | 처음부터 |
  | 보드 탭 | 세션 1회 완료 |
  | 예보 대결 탭 | 세션 2회 완료 |
  | 리그 탭 | 세션 3회 완료 |
  잠금 탭은 자물쇠 + "세션 N회 완료하면 열려요" 안내. 해제 시 1회성 축하 토스트.
- 프로필 화면의 퀘스트·배지도 첫 세션 전에는 접힘(1개만 노출) — 인지 부하 감소.
- 기존 사용자(진척 있음)는 전부 해제 상태로 계산되어 **회귀 없음**을 테스트로 고정.

### 3.5 보드 풀이 보조 · 이탈 인텐트 · 마감 (S5 — R10-E·G·H)

- **언두**: 보드 배치 히스토리 스택(≤ 20) + "되돌리기" 버튼. 순수 클라이언트,
  서버 계약 불변, 구름 무소모. 제출 후에는 비활성.
- **점진적 힌트(2단, 기존 0/2 카운터 재사용)**: 1단 = "어느 존을 먼저 볼지"만
  하이라이트(정답 요소 미공개), 2단 = "필요한 요소 종류"(예: 전선 계열)까지.
  **정답 배치를 직접 보여주지 않는다.** 힌트 문구는 `board_rules.json`의 explain을
  가공하지 않고 별도 힌트 필드로 저작(데이터 저작 항목 — 8종).
- **이탈 인텐트**: 세션 진행 중 이탈(탭 이동·뒤로가기) 시 확인 1단 —
  "지금 나가면 오늘 진도가 사라져요", 주 CTA "계속 풀기"(큼), 종료는 작은 링크.
  `prefers-reduced-motion` 무관, 접근성(포커스 트랩·Esc) 준수.
- **콤보·칭찬 에스컬레이션**: 연속 정답 카운터를 진행바 위에 표시,
  칭찬 문구 4단(정답이에요 → 좋아요 → 훌륭해요 → 완벽해요). 자체 카피.
- **마감 4건**: match 짝 성립 시 목록 재배열 금지(자리 고정+연결 표시) ·
  보드 제출 성공 후 "판정 중…" 상태 해제 · 약점 보너스 XP 분리 표기
  ("+15 XP, 약점 극복 +7") · 세션 완료 화면 문항 수 카피를 실제 배합과 동기화.

## 4. 웨이브

- **웨이브 0 (선행, 반나절)**: SA-1이 §3.1 계약 테스트를 **먼저** 작성(전부 실패
  상태 커밋) → 프론트 3인은 그 계약을 읽고 착수. 목표 저장 방식(마이그레이션 유무)
  확정도 여기서.
- **웨이브 1 (병렬 5)**:
  - SA-1 `feat/r10-01-energy-policy` (백엔드 + mock 동기화)
  - FE-1 `feat/r10-02-webgl-cross-section` (메인 트리 — 가장 큼)
  - FE-2 `feat/r10-03-webgl-map-overlay` (워크트리)
  - FE-3 `feat/r10-04-onboarding-gating` (워크트리)
  - FE-4 `feat/r10-05-board-assist-retention` (워크트리)
  - **파일 소유**: FE-1=`CrossSectionPanel`+신규 `webgl/` · FE-2=`mapInfographic`·
    `realisticEffects`·`precipEngine`(폴백 보존) · FE-3=`App`·탭바·온보딩·프로필 ·
    FE-4=`AtmosphereBoard`·`useBoardDrag`·`SessionRunner`·`QuestionCard`(match 분기).
    `AtmosphereBoard`는 FE-1/2(렌더 마운트)와 FE-4(조작)가 겹치므로 **마운트 지점
    인터페이스를 웨이브 0에서 확정**하고 그 경계로만 수정한다.
- **웨이브 2**: `chore/r10-06-integration` — 병합·회귀·스모크·회고.
  도커 정지 상태이므로 통합 시 `docker compose up -d --build` 후 재정지.
- CI: `scripts/ci.sh`에 WebGL 폴백 SSR 스모크와 에너지 계약을 편입(상주화).

## 4.1 웨이브 0 결정 기록 (2026-08-01, PM)

> 계약(§3)이 실제 코드와 어긋난 지점을 웨이브 0 탐색에서 발견해 확정한 내역.
> **아래가 §3보다 우선한다**(§3은 발견 전 작성).

### D1. 보드 진입 차단 지점 — 상세 엔드포인트 신설
§3.1이 지목한 `GET /api/v1/board/puzzles/{id}`는 **실재하지 않는다**. 현행은 목록
`GET /board/puzzles`(`routers/board.py:162`) 하나뿐이고 프론트가 목록 payload로
바로 플레이한다(`BoardPage.jsx:71`). 목록을 차단하면 보드 화면 자체가 막히고
`cleared` 표시도 못 하므로 —
- **웨이브 1에서 `GET /api/v1/board/puzzles/{content_item_id}` 신설**(응답은
  `BoardPuzzle` 단건, 목록 원소와 동일 스키마)하고 **거기에만** 진입 게이트를 건다.
- 목록 엔드포인트는 **무차단**. 프론트는 "퍼즐 시작" 시 상세를 호출한다.

### D2. 첫날 중복(P0)의 진짜 원인 — 뱅크 규모가 아니라 쿼리 누락
`new` 풀은 기존 응답 문항을 제외하지만(`served_subq` — `session_service.py:339`가
구성, `:351`이 전달), **`review`(`:362-376`)·`live`(`:378-388`) 풀에는 그 제외가
전달되지 않는다**. 그래서 배치고사 직후 첫 세션의 복습·실황 슬롯이 방금 푼 문항을
재출제한다 — 관찰 보고서의 "9문항 중 4개 동일"은 **뱅크 부족이 아니라 이 누락**이다.
- **단기 완화책을 S1에 포함**한다(§5의 "웨이브 0에서 판단" 항목 → 포함으로 확정).
- 범위는 "배치고사 출제분 제외"보다 넓게 **"오늘 이미 응답한 문항은 review·live
  풀에서 제외"** — 같은 날 재출제는 복습이 아니다(간격 반복 원칙). 배치고사 케이스가
  자동 포함되고, 다음날부터의 복습 가치는 보존된다.
- 신규 API: `kst_day_start_utc(day) -> datetime`(순수) ·
  `answered_today_subq(user_id, day_start_utc)`(쿼리 구성). `_fetch_pools`가
  review·live 쿼리에 전달. **new 풀의 전기간 제외는 불변**(회귀).
- 슬롯이 비면 기존 `plan_bank_picks` → quiz-generate 폴백이 받으므로 뱅크가 얇아도
  발급은 실패하지 않는다. **R10-B(뱅크 확장) 없이 P0 증상이 해소된다.**

### D3. 보드 마운트 경계 — `PeninsulaMap` 물리적 추출 (웨이브 0 선행)
§4의 파일 소유 계획이 성립하지 않는다: **지도 렌더러 `PeninsulaMap`이
`AtmosphereBoard.jsx`(788줄) 안에 정의**돼 있어(538줄~) FE-2(지도 오버레이)·
FE-1(단면 마운트 299줄)·FE-4(조작 127·134·140·229-237·421·458·470줄)가 **같은
파일을 동시에 수정**하게 된다. `mapInfographic`·`realisticEffects`·`precipEngine`은
leaf 프리미티브일 뿐 합성 루트가 아니다.
- 웨이브 0에서 **순수 기계적 추출**(동작 변경 0)을 선행한다:
  `PeninsulaMap.jsx`(신규, FE-2 소유) + `boardLayout.js`(신규, 양쪽 공용 상수·순수
  헬퍼) + `AtmosphereBoard.jsx`(정의 삭제·import 교체만).
- 추출 후 웨이브 1 소유: **FE-1**=`CrossSectionPanel.jsx` + 신규 `webgl/` ·
  **FE-2**=`PeninsulaMap.jsx` · **FE-4**=`AtmosphereBoard.jsx`(조작·상태) ·
  마운트 호출 지점(299줄 `<CrossSectionPanel>`)은 **FE-1이 건드리지 않는다**.
- **동결 계약**: `mapInfographic.jsx`·`realisticEffects.jsx`·`precipEngine.js`·
  `boardSymbols.jsx`·`useBoardDrag.js`·`boardLayout.js`의 기존 export 시그니처는
  웨이브 1 동안 변경 금지(추가만 허용). FE-1이 `anim`·`usePrefersReducedMotion`
  (`CrossSectionPanel.jsx:20`)과 `frontCurveGeometry`·`taperedArrowPath`·`FrontTick`
  (`:21`)을 import하므로, FE-2가 이를 바꾸면 FE-1이 깨진다.
- 가드: `frontend/tests/boardVisual.render.test.mjs`가 AtmosphereBoard 통합 SSR
  렌더를 assert하므로 추출이 렌더 결과를 바꾸면 즉시 깨진다(`npm run test:visual`).

### D4. 일일 목표 저장 — 마이그레이션 `0008` (`users` 컬럼 1개)
§3.4의 "기존 진척 저장소 재사용" 후보를 조사한 결과 **재사용할 유저 스코프 자유키
JSON 컬럼이 없다**(`models/user.py:12-53` — JSONB 0개). 기존 JSONB는 전부 세션·
콘텐츠·퀘스트 정의용이고, `user_quest_progress`는 일자별 진행 행이라 "유저 설정값"에
부적합하다.
- **`0008_daily_goal`: `users.daily_goal_items` INTEGER NULL** + 앱 폴백 기본값.
  `users`는 0001에서 이미 RLS 대상이라 **정책 선언 불필요**. 같은 형태의 선례 2건
  (0005 `clouds`, 0007 `placement_completed_at`). `down_revision="0007_placement"`.
- 허용값 `{3, 5, 9}`. `SESSION_RECIPE`(합 5)와는 **독립** — 목표는 표시용 카운터
  타깃이지 세션 배합이 아니다(계약 수치 드리프트 없음).
- API: `GET /api/v1/progress` 응답에 `daily_goal_items`(null=미설정)·
  `today_answered_count` 추가 · `PUT /api/v1/progress/daily-goal` `{items}` →
  범위 밖 422. "오늘 응답 수"는 `quest_service._today_facts()`(`:146-216`)가 이미
  집계하므로 **새 테이블·새 집계 불필요**.
- 담당: SA-1(백엔드·마이그레이션) → FE-3은 이 계약으로 mock 선작업. SA-1의 웨이브 1
  부하가 커지면 S1(에너지)/S4-백엔드를 원자 커밋 2개로 분리하고, 그래도 넘치면
  SA-2를 증원한다(TEAM_PROCESS §2.6 조절 시점 ③).

### D5. `apiMockPlugin.js` 단일 소유 (충돌 방지)
1653줄 단일 파일에 에너지 상태·소모 로직(`:66·136-186`)과 보드·세션 mock이 전부
들어 있어 SA-1(에너지)·FE-3(목표·게이팅)이 동시 수정 대상이 된다.
- **웨이브 0에서 SA-1이 확정 계약대로 선반영**하고, 웨이브 1 동안 프론트 3인은
  **읽기 전용**. 추가 변경이 필요하면 SA-1을 경유한다(직접 수정 금지).

### D6. 진입 차단·소모 면제 지점 (확정 목록)
- 차단 **적용**: `GET /session/today`의 **신규 발급 분기에서만**(기존 세션 재조회는
  무차단 — "풀던 것을 뺏기지 않는다" 불변식) · `POST /curriculum/units/{slug}/session`
  (잠금 403 판정 **이후**, `create_unit_session` 직전) · 신규 `GET /board/puzzles/{id}`.
- 차단·소모 **면제**: `POST /onboarding/placement/start`,
  `POST /onboarding/placement/submit-all`(배치고사) · `ENERGY_ENABLED=false`.
- 소모 시점: `session.py`는 `submit_answer_for_log`(채점) **이후**,
  `board.py`는 `evaluate_board_answer`(판정) **이후**. 트랜잭션 공유 유지(예외 시 롤백).
- 진행 중 세션 보호: 소모는 가드 UPDATE(`clouds >= COST`)가 **0행이면 예외 없이
  통과**(`consume_if_available`) — 잔량 0에서 오답이어도 세션은 끊기지 않는다.

### D7. 테스트 베이스라인 정정
웨이브 0 시점 backend 스위트 실측 **761 passed**(CLAUDE.md·현황의 "425"는 stale).
웨이브 2에서 CLAUDE.md 현황 수치를 갱신한다.

## 5. 범위 밖 · 대기

- **R10-B 콘텐츠 뱅크 확장(P0)** — 규모·저작 주체 **결정 대기**. 결정 시 별도
  스프린트(R10-02)로 분리한다. 단기 완화책(배치고사 출제분을 당일 세션 풀에서
  제외)만 S1에 함께 넣을지는 웨이브 0에서 판단.
- **예보 대결 PvP** — 로드맵 6(확장·사업화)로 이월(관찰 보고서 §3).
- **KMA 키 발급**(사용자) — 브리핑 실데이터·리그 정산 전제. 미도착 시 degraded
  모드 유지.
- **Gemini 키** — R10-B와 함께 판단.
- R9 잔여 부채(강수 Brier·지역 선택·history 페이지네이션·기압 API·타 모듈
  reduced-motion 수기 확인)는 이번에도 이월.

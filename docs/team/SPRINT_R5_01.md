# 스프린트 R5-01 백로그 — 지도 기반 보드 · 단계별 학습 · 구름 에너지 (리텐션)

> 운영 규칙: docs/team/TEAM_PROCESS.md. §3 계약 고정. R4 종료 후 착수.

## 0. 배경 — 제품 결정 (2026-07-21, 클라이언트)

세 가지 방향 지시:
1. **대기 보드를 지도 위에서** — 추상 4존 단면 보드(R3)를 **한반도 지도** 위 지역 노드로
   재설계. 요소를 지역에 배치해 대기현상을 만든다.
2. **듀오링고식 단계별 학습** — 평면 태그를 유닛 트리로. 유닛을 순서대로 클리어하며
   진도(왕관)를 쌓는다. 관측 보고서 №2 §4.2 커리큘럼 설계 채택.
3. **구름 컨텍스트 소모 방식** — 듀오링고 하트/에너지의 날씨판. **"구름"을 소모성
   자원**으로 두고, 플레이(문항 시도)가 구름을 소모하고 시간 경과로 회복 → **재방문·
   체류시간 유도**. 관측 보고서 §2.4(가상경제) 벤치마킹.

**목표 지표**: 세션당 체류시간·주간 재방문 증가(리텐션). 메커니즘은 벤치마킹하되 명칭·
상징은 날씨 세계관 독자화(§3 벤치마킹 원칙: 하트→구름).

## 1. 스프린트 목표

지도 UI·커리큘럼 트리·구름 에너지 3축을 올려, "단계를 밟아 오래 머무는" 학습 루프를
완성한다. 기존 세션·보드·게이미피케이션(R2~R4)과 하위 호환.

## 2. 스토리와 담당

| # | 스토리 | 담당 | AC |
|---|---|---|---|
| R5-S1 | 대기 보드가 한반도 지도 위 지역 노드에서 동작 | 프론트(+백엔드 좌표) | §3.1, 기존 board_engine 판정 불변(존→지역 매핑만) |
| R5-S2 | 커리큘럼: 섹션→유닛 트리, 유닛별 진도(왕관)와 선행 잠금 | 백엔드+데이터+프론트 | §3.2 API·모델·시드, 선행 미완료 유닛 잠금 |
| R5-S3 | 구름 에너지: 문항 시도가 구름 1 소모, 시간 회복, 0이면 대기 | 백엔드+프론트 | §3.3, 소모·회복 원자성, 프리즈와 독립 |
| R5-S4 | 학습 홈: 유닛 경로(길) + 구름 잔량 헤더 + 다음 유닛 유도 | 프론트 | §3.2·3.3 UI, 체류 유도(완료 시 다음 유닛 즉시 노출) |
| R5-S5 | 지도 지역·유닛·구름 시드/설정 | 데이터 | §3.1·3.2 |
| R5-S6 | 품질 게이트가 유닛 메타(unit_id 참조 무결성) 검증 | AI | §3.6 |

## 3. 계약 (고정)

### 3.1 지도 기반 보드 — 존↔지역 매핑

- board_engine 판정 로직은 **불변**(R3 규칙·벡터 그대로). 바뀌는 것은 표현뿐:
  존 index 0~3 ↔ 지도 지역 고정 매핑 `["서해상","수도권","영서·태백","영동·동해"]`
  (기존 zones 라벨과 동일 개념, 지도 좌표만 추가).
- `database/seed/board_regions.json`: `[{zone: 0, name: "서해상", svg_point: [x,y],
  label_anchor: [x,y]}]` — 프론트 지도 SVG 좌표(정규화 0~100). 판정에 미사용, 렌더 전용.
- board_state의 zone 필드 의미 불변 → 백엔드 채점·계약(§3.4-R3) 변경 없음. **백엔드는
  board_regions.json 제공 라우터만 추가**: GET /api/v1/board/regions(파일 캐시).
- 프론트: 기존 AtmosphereBoard를 지도 배경(한반도 단순화 SVG) + 지역 노드 배치로 교체,
  요소를 노드에 드롭. 즉시 미리보기·guided/goal·힌트는 유지.

### 3.2 커리큘럼 (단계별 학습)

- 모델(Alembic 0005): `units`(id, section VARCHAR, unit_order INT, title,
  concept_tag, prereq_unit_id UUID FK NULL, kind VARCHAR CHECK IN ('quiz','board'),
  crown_target INT DEFAULT 1) — 전역, RLS 없음.
  `user_unit_progress`(user_id FK, unit_id FK, crowns INT DEFAULT 0, cleared_at NULL,
  UNIQUE(user_id, unit_id), RLS user_isolation).
- 시드 `database/seed/units.json`: 관측보고서 §4.2 4섹션(하늘 읽기/공기의 힘/큰 바람/
  도시와 기후) 아래 유닛 8~12개. 각 유닛은 concept_tag로 기존 content_items와 연결
  (unit_id를 content_items에 추가하지 않고, 유닛 kind+concept_tag로 문항 풀 결정 —
  기존 시드 하위 호환). board 유닛은 해당 concept_tag의 board 퍼즐 사용.
- **잠금 규칙**: prereq_unit_id가 있으면 그 유닛 crowns>=1 이어야 열림. 첫 유닛은 무잠금.
- 진도: 유닛 세션 complete(전 문항 정답) 또는 board 퍼즐 클리어 시 crowns +1
  (crown_target까지). cleared 전환 시 +20 XP(1회).
- API: GET /api/v1/curriculum(섹션·유닛·유저 진도·잠금 상태 트리),
  POST /api/v1/curriculum/units/{id}/session(해당 유닛 문항으로 세션 발급 — 기존 세션
  엔진 재사용, unit_id를 sessions에 기록).
- **시드 스키마 (리뷰 후 명시, slug 방식 — 데이터·AI 게이트 기준)**: units.json 각 항목은
  `{id: slug, section, unit_order, title, concept_tag, prereq_unit_id: slug|null, kind, crown_target}`.
  id는 안정 slug(재정렬에 견딤). units 테이블에 `slug VARCHAR UNIQUE` 컬럼을 두고 로더가
  slug upsert + prereq_unit_id(slug)를 2-pass로 UUID FK 해석. API의 units.id는 slug를 노출
  (프론트·URL 안정 참조). **백엔드 로더/모델을 이 스키마에 맞춘다**(자연키 prereq 방식 폐기).

### 3.3 구름 에너지 ("구름" 소모 자원)

- `users`에 `clouds INT NOT NULL DEFAULT 5`, `clouds_updated_at TIMESTAMPTZ` 추가(0005).
- 상수: CLOUD_MAX=5, CLOUD_REGEN_MINUTES=20(1개 회복), 시도당 소모 1.
- **지연 회복 모델**(크론 불필요): 읽기·소모 시점에 `elapsed=now-clouds_updated_at`으로
  회복량 계산해 clamp(현재+elapsed//20, MAX), clouds_updated_at 갱신. 원자 UPDATE.
- 소모 시점: 세션 answer·board attempt·curriculum 세션의 **문항 제출 성공 시 1 소모**.
  0이면 제출 전 429 `OUT_OF_CLOUDS`(다음 회복 ETA 포함). 재제출(멱등 가드 히트)은 미소모.
- 스트릭 프리즈(구름 방패)와 **독립 자원**(방패=스트릭 방어, clouds=플레이 에너지).
  네이밍 혼동 방지: UI에서 clouds="구름", freeze="구름 방패"로 구분 표기.
- API: GET /api/v1/progress/energy → `{clouds, max, next_regen_sec, updated_at}`.
  /progress/me 응답에도 clouds·next_regen_sec 포함.
- **리텐션 훅**: clouds 소진 시 회복 ETA 노출(재방문 유도), 회복 완료는 R6 푸시 부채.

### 3.4 하위 호환

- 구름 에너지는 **기능 플래그** `ENERGY_ENABLED`(기본 true, .env)로 감쌈 — false면 무제한
  (기존 동작, 데모·테스트 유연성). 레이트리밋과 별개 층.
- 커리큘럼은 기존 /session/today(자유 일일 세션)와 병존 — 유저는 유닛 경로 또는 일일
  세션 어느 쪽이든 가능. 유닛 세션도 구름 소모 대상.

### 3.5 에러 코드

`OUT_OF_CLOUDS`(429), `UNIT_LOCKED`(403, 선행 미완료), `UNIT_NOT_FOUND`(404).

### 3.6 품질 게이트 확장 (AI)

units.json 무결성 체커(휴리스틱, 별도 엔드포인트 POST /internal/curriculum-validate):
unit_order 섹션 내 유일, prereq_unit_id가 존재하는 unit 참조(순환 없음), concept_tag 6종,
kind enum, board 유닛은 해당 concept_tag board 퍼즐 최소 1건 존재(content_items 대조).

## 4. 웨이브

- 웨이브 1(병렬): 백엔드(0005·커리큘럼·에너지·regions 라우터) / 프론트(지도 보드·
  커리큘럼 트리 UI·에너지 헤더·학습 홈) / 데이터(units·board_regions·시드 연결) / AI(S6)
- 웨이브 2(통합): QA(R2~R5 회귀 + 에너지 경계·잠금·회복 계산 테스트) / DevOps(ci·compose·런북)

## 5. 리뷰 노트 · 회고

### 웨이브 1 코드 리뷰 (2026-07-22, PM 타겟 리뷰)

각 직군 자체 테스트(백엔드 370·AI 53·프론트 build+벡터 10/10·데이터 무결성 검증)로
방어. PM 타겟 리뷰로 진행.

**확정 결함 1건 (심각·배정 수정)**
- units.json(slug 방식: id·prereq_unit_id 문자열)과 백엔드 seed_units 로더(자연키 prereq
  객체 기대)의 스키마 불일치 → 실제 파일 적재 시 prereq 전부 None → **선행 잠금 체인
  전면 소실**(단계별 학습 핵심 기능 무력화). 데이터·AI 게이트가 모두 slug라 백엔드를
  slug로 정합: units.slug UNIQUE 컬럼·2-pass prereq 해석·API slug 노출. **잠금 체인 생존을
  회귀 테스트로 고정**(루트만 열리고 11개 잠금, 순차 클리어로 전체 해제), 전체 370 통과.
  → 리뷰가 없었으면 "모든 유닛이 잠금 없이 열리는" 형태로 조용히 배포될 결함.

**점검·정합 확인(결함 아님)**: board_engine 판정 불변(프론트 벡터 10/10 유지),
board_regions.json 스키마가 프론트 소비와 일치, 에너지 소모 순서(멱등가드→유효성422→
소모429→채점) backend/mock 정합.

**회고**
- 잘된 것: 지도화를 판정 엔진 불변 + 리라벨/오버레이로 최소 변경 설계(advisor 조언) —
  검증된 R3 엔진·벡터를 건드리지 않음. 구름 에너지를 크론 없는 지연 회복(읽기 시점 계산)
  으로 만들어 인프라 추가 없이 리텐션 훅 구현. 커리큘럼을 선형 사슬로 확정(advisor)해
  듀오링고식 단계 진행에 정합.
- 아쉬운 것: 시드 스키마(slug vs 자연키)를 계약에 처음부터 명시하지 않아 3직군이 다른
  해석 → 통합 결함. R2 회고의 "공유 계약 문자열까지 고정" 교훈을 시드 스키마에도
  적용했어야. 이후 계약은 시드 파일 필드까지 명시(§3.2 갱신 완료).
- 밸런스 관찰: 일일 자유 세션(실 배합 5문항)과 구름 5개는 정합하나, mock 데모(9문항)는
  중간 소진 발생 — 의도된 리텐션 루프. 유닛 세션 문항 수와 구름 비율은 R6에서 실사용
  데이터로 튜닝(원격 구성화 후보).
- 범위 밖(로드맵): 구름 회복 완료 푸시 알림(웹푸시 인프라), 탐정·롤플레이(LLM), IRT.

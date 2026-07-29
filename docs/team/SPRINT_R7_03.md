# 스프린트 R7-03 — 개발자 모드 (소형)

> 클라이언트 요청(2026-07-29): 개발 단계용 개발자 모드. 기능 7종 전부 채택
> (필수 4종 + 커리큘럼 조작 + 상태 인스펙터 + 스트릭 시간여행).

## 1. 계약 요지

- **`DEV_MODE=false`가 env 기본값** — 계약 테스트로 기본값 고정(운영 배포에 켜진
  채 나가는 실수를 테스트가 차단). 꺼져 있으면 `/api/v1/dev/*` 경로 자체가 404.
- 프론트 DevPanel은 `GET /dev/state`의 200/404로 노출 자결 — 프론트 env 불필요.
- 전 엔드포인트 JWT + RLS, **자기 계정만 조작 가능**.
- 라우터 7종: `GET /state`(θ 원값·overall·target_level_group·unlock_floor·clouds·
  max_clouds·streak·placement_done·weak_tags) · `POST /reset-me`(종속 10종 삭제 +
  users 리셋 + seed_placement 재실행) · `/theta`(_upsert_abilities 재사용) ·
  `/placement`(reset|complete) · `/clouds`(0..CLOUD_MAX) · `/curriculum`
  (unlock_all|crown|reset) · `/streak`.
- 요청 스키마 전부 `extra="forbid"`.

## 2. 산출

- 백엔드 `feat/r7-15-dev-mode-api`: config·main 조건 include·routers/dev.py·
  schemas/dev.py·테스트 38건. backend 606 passed.
- 프론트 `feat/r7-16-dev-mode-panel`: api/dev.js·mock dev 라우트 7종(+기존에
  누락됐던 `GET /progress/abilities` mock 보완)·DevPanel(인스펙터+조작 6종,
  reset은 인라인 2단계 확인). mock 스모크 40/40 + 404모드 9/9.
- 통합 `chore/r7-17-dev-mode`: 프론트 구름 상한을 서버 `max_clouds` 1차 소스로
  정렬(하드코딩 상수는 폴백으로 강등).

## 3. 회고

- 잘된 것: 노출 게이트를 "서버 404"로 일원화 — 프론트 빌드 분기·env 불필요,
  운영 안전이 백엔드 계약 테스트 한 곳에 수렴.
- 유의: dev 조작은 자기 계정 한정이지만 로컬 공유 DB에서는 팀원 계정 조작이
  가능하므로 스테이징 공유 시 DEV_MODE 끄는 것을 RUNBOOK 수칙으로.
- 범위 밖(부채 아님): 시간여행은 스트릭 필드 직접 설정 방식 — 출석 이력
  시뮬레이션은 필요 시 후속.

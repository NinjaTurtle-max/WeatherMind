# WeatherMind — Claude 작업 지침

날씨 데이터 기반 기후 학습 서비스. "듀오링고식" 게이미피케이션 + 실제 기상 개념을
시뮬레이션 없이 **보드 퍼즐**로 체득시킨다. 서비스: `backend`(FastAPI)·`frontend`
(Vite)·`ai-worker`(LangChain/Gemini, 문항 생성·품질 게이트)·`celery`(KMA 수집 배치).

## 핵심 기능 (실제 코드 기준 — API·도메인 모델)
- **세션 엔진**(`session.py`): `GET /session/today`가 배합(신규2·복습2·실황1=5문항,
  `Settings.SESSION_RECIPE`로 env 조정 가능)으로 하루 세션 발급. `today.*` 슬롯은
  KMA 실황값으로 문항에 실시간 주입.
- **커리큘럼**(`curriculum.py`): 4섹션(하늘 읽기·공기의 힘·큰 바람·도시와 기후) 유닛
  트리, `unit_order`·`prereq` 선행 잠금, 유닛 완료 시 세션 발급(`POST /units/{slug}/session`).
- **대기 보드 퍼즐**(`board.py`): 기단·전선·습기·일사 배치로 실제 대기현상을 만드는
  퍼즐. 서버가 `board_rules.json`(프론트와 공유하는 단일 규칙 파일)로 판정을 재계산
  — 클라이언트가 결과를 주입할 통로 없음(채점 권위 서버 소유).
- **문항 유형 7종**(`content_items.question_type`): multiple_choice·short_answer·
  slider·board·match·ordering·cloze. 채점기는 `answer_service.GRADERS` 레지스트리.
- **구름 에너지**(`progress.py /energy`, `energy_service.py`): 만렙 5·20분당 1 회복·
  시도당 1 소모(전부 `Settings.CLOUD_*`로 env 조정). 소진 시 429 `OUT_OF_CLOUDS`.
  스트릭 프리즈("구름 방패")와는 별개 자원.
- **리그**(`league.py`): ELO 기반, 구름 분류 티어명(stratus<1100→cumulus→
  nimbostratus→cumulonimbus→typhoon_eye≥1550), `POST /predict`로 오늘 기온·강수확률
  예측 후 결정적 AI 캐스터와 대결.
- **보상 루프**(`progress.py`): 퀘스트·배지·출석(streak+freeze), 약점 태그
  (`weak_tags`, 정답률 임계 이하 자동 분류) 기반 복습 추천.
- **예보 대결**(`duel.py`): 오늘/과거 대결 이력.
- **인증**(`auth.py`): JWT access/refresh, 게스트 로그인 지원.
- **AI 게이트**(ai-worker): Gemini로 문항 생성 → 결정적 휴리스틱(LLM 무관) 1차 게이트
  → LLM 2차 게이트. LLM 키 없어도 폴백 문항 뱅크로 전 기능 동작.

## 프로젝트 현황
- R2~R6 완료(테스트 backend 425·ai-worker 86+1skip, P0~P2 결함 0). R6: WeatherBrain
  자체 적응형 엔진 실구현 — IRT(2PL) 순수 파이썬 코어(EAP θ 추정·JML b 보정, 합성
  복원 테스트로 검증), 가입 시 초기 능력(θ) 배정, θ가 Router 1순위 신호, celery
  재학습 실동작(휴면-정확). 상세 docs/specs/03 §5.
  **경계**: θ는 라우팅·진단 노출까지 연결됐고, θ→출제난이도(뱅크 풀·quiz-generate)는
  미연결(다음 증분, §0). DB 경로(마이그레이션 0006·RLS insert·round-trip)는 아직
  실행 검증 전 — 단위/임포트 테스트만 통과, `docker compose up`+`alembic upgrade`+
  register→session 스모크가 남았다.
- R2~R5.5 완료. 제품 방향 전환 2건 —
  시뮬레이터 폐지→퍼즐화(R3), 지도+커리큘럼+구름에너지(R5) — Duolingo 벤치마킹
  ([[duolingo-benchmark-report]]) 근거. 메커니즘만 차용, 표현(캐릭터·문항 텍스트)은
  자체 제작, 대외 문서에 Duolingo 언급 금지.
- GitHub `NinjaTurtle-max/WeatherMind`(private). 브랜치+PR 워크플로우 도입(PR #1~).
- **다음 = R10** (2026-07-31 실사용 필드 테스트로 우선순위 재구성 —
  `docs/Observation_Report_03_R10_UX_Field_Test.md`):
  **P0** 에너지 정책 개편(시도당 소모가 정답 제출까지 차단 — 오답·재도전만 소모로) ·
  **P0** 콘텐츠 뱅크 확장+중복 방지(첫날 세션 9문항 중 4개가 배치고사와 동일) ·
  P1 WebGL 3D 단면 모식도(기존 확정안) · P1 온보딩 커밋 장치(일일 목표) ·
  P1 보드 언두+점진적 힌트 · P1 첫 화면 점진적 잠금 해제(세션 1회→보드, 3회→리그) ·
  P2 이탈 인텐트+콤보·칭찬 에스컬레이션 · P2 상호작용 마감 · P2 시스템 보이스.
  보류(로드맵 6 이월): 예보 대결 PvP.
  → 병목은 엔진이 아니라 **뱅크**: 저작·생성 파이프라인으로 리소스 이동.
- 남은 것: 실기동 통합 테스트(KMA/Gemini 키 발급 후), 로드맵(탐정 스토리·AI 캐스터
  롤플레이·웹푸시·IRT 재학습).

## SSOT — 기능 상세는 여기서 확인(위 요약은 진입점이지 전체가 아님)
`docs/specs/`(제품 스펙, 00~10번) · `docs/DEVELOPMENT_PLAN.md`(표준 결정) ·
`docs/team/TEAM_PROCESS.md`(팀 운영·§2.4 Git 워크플로우) · `docs/team/RETROSPECTIVE.md`.
충돌 시 위 문서 우선.

## 명령
- 테스트: `cd backend && python -m pytest tests -q` / `cd ai-worker && python -m pytest tests -q`
- 전체 CI: `scripts/ci.sh` (lint→test→board→config→frontend)
- lint: `python -m pyflakes backend/app ai-worker/app celery/app`

## Git 워크플로우
`main` 직접 커밋 금지. `<type>/<scope>-<slug>` 브랜치 → 원자적 커밋 → `/code-review`
게이트 → PR → **merge commit**(squash 금지) → 병합 후 브랜치 삭제. 상세: §2.4.

## 되돌리기 어려운 작업 — 반드시 지킬 것
**사고(2026-07-23)**: "html/PDF 파일 push에서 제외"를 `git-filter-repo` 히스토리
재작성으로 확대 해석 → 사전 백업 없이 실행 → **로컬 디스크 파일까지 영구 소실**.
1. "제외/빼줘" ≠ "삭제". (a)git 추적만 해제 (b)이후 커밋만 미노출 (c)히스토리+로컬
   완전 제거 중 반드시 되묻고, 기본값은 가장 약한 해석. (c)는 명시적 요청 시만.
2. `filter-repo`·`filter-branch`·`reset --hard`·순수 `push --force`·추적 안 된 변경을
   버리는 `checkout/restore/clean` 전 **예외 없이 저장소 전체 백업**
   (`cp -r . ../backup-$(date +%s)`).
3. 결과는 git 용어가 아니라 평서문으로 ("컴퓨터에서도 파일이 사라지고 복구 불가").
4. 애매하면 실행 전에 되묻는다 — 실행 후 사과하는 순서 금지.

## 기타 학습된 선호
- 커밋은 항목 단위 원자적 분리(웨이브 끝 몰아치기 금지).
- 계약 수치(배합·에너지 등) 변경 시 env 기본값=계약값 유지, 계약 테스트로 드리프트 감시.
- 교차 빌드 컨텍스트(backend↔celery) 중복은 물리적 병합이 아니라 단일 소유자+계약
  테스트로 해소. 같은 컨텍스트 내 중복만 물리적 DRY 대상.

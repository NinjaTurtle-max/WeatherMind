# WeatherMind — Claude 작업 지침

날씨 데이터 기반 기후 학습 서비스. "듀오링고식" 게이미피케이션 + 실제 기상 개념을
시뮬레이션 없이 **보드 퍼즐**로 체득시킨다. 서비스: `backend`(FastAPI)·`frontend`
(Vite)·`ai-worker`(LangChain/Gemini, 문항 생성·품질 게이트)·`celery`(KMA 수집 배치).

## 핵심 기능 (실제 코드 기준 — API·도메인 모델)
- **세션 엔진**(`session.py`): `GET /session/today`가 배합(신규5·복습4·실황1=**10문항** — R12,
  `Settings.SESSION_RECIPE`로 env 조정 가능)으로 하루 세션 발급. `today.*` 슬롯은
  KMA 실황값으로 문항에 실시간 주입.
- **커리큘럼**(`curriculum.py`): 4섹션(하늘 읽기·공기의 힘·큰 바람·도시와 기후) 유닛
  트리, `unit_order`·`prereq` 선행 잠금, 유닛 완료 시 세션 발급(`POST /units/{slug}/session`).
  **다과정**(R11): `courses` 테이블 + `GET /courses`·`?course=` — `units.course_id`
  NULL은 기본 코스(weather) 취급이라 완전 하위 호환. basic-science는 빈 트리
  (`docs/specs/11` 트리 기준 G1 이후 저작). θ는 코스를 가로질러 개념 태그 단위.
- **대기 보드 퍼즐**(`board.py`): 기단·전선·습기·일사 배치로 실제 대기현상을 만드는
  퍼즐. 서버가 `board_rules.json`(프론트와 공유하는 단일 규칙 파일)로 판정을 재계산
  — 클라이언트가 결과를 주입할 통로 없음(채점 권위 서버 소유).
- **문항 유형 7종**(`content_items.question_type`): multiple_choice·short_answer·
  slider·board·match·ordering·cloze. 채점기는 `answer_service.GRADERS` 레지스트리.
- **구름 에너지**(`progress.py /energy`, `energy_service.py`): 만렙 5·20분당 1 회복·
  **오답에만 1 소모**(정답·재제출·배치고사 0, 보드는 미통과만 — R10 전환. 수치는
  `Settings.CLOUD_*`로 env 조정). 차단은 **문항 진입 전**(세션 발급·유닛 발급·
  `GET /board/puzzles/{id}`)에서 429 `OUT_OF_CLOUDS`이고, **이미 발급된 세션·진입한
  퍼즐은 잔량 0이어도 끝까지 보장**(소모만 생략, 200). 스트릭 프리즈와 별개 자원.
- **리그**(`league.py`): ELO 기반, 구름 분류 티어명(stratus<1100→cumulus→
  nimbostratus→cumulonimbus→typhoon_eye≥1550), `POST /predict`로 오늘 기온·강수확률
  예측 후 결정적 AI 캐스터와 대결.
- **보상 루프**(`progress.py`): 퀘스트·배지·출석(streak+freeze), 약점 태그
  (`weak_tags`, 정답률 임계 이하 자동 분류) 기반 복습 추천. **간격반복**(R11):
  `GET /progress/review-queue` — quiz_logs read-model, 간격 사다리 1·3·7·14·30일,
  weak_tags(능력 축)와 축 분리. **BKT 지식 추적**(`weatherbrain/knowledge_tracing.py`,
  순수 파이썬)은 합성 복원 검증까지 완료 — 실학습자 검증은 데이터 축적 후.
- **예보 대결**(`duel.py`): 오늘/과거 대결 이력.
- **인증**(`auth.py`): JWT access/refresh. **게스트는 `POST /auth/guest`가 실 유저 +
  실 JWT를 발급**(R11에서 실체화 — 그 전에는 프론트가 가짜 토큰을 조작했고 실서버에서
  깨졌다). 계정 전환 유도(R10-J 본체)는 미구현.
- **AI 게이트**(ai-worker): Gemini로 문항 생성 → 결정적 휴리스틱(LLM 무관) 1차 게이트
  → LLM 2차 게이트. LLM 키 없어도 폴백 문항 뱅크로 전 기능 동작.

## 프로젝트 현황
- **로드맵 마일스톤 1·2 완료**(6개 중 2개) — 다음은 마일스톤 3(콘텐츠·난이도 다양화).
  상태·의존 규칙·주차 일정은 `docs/ROADMAP.md`가 SSOT.
- **R2~R11 완료**(R11 = 무키 웨이브 1·2 — **마일스톤 4 완료 판정** + 6의 무키분:
  다과정 UI·온보딩 재배치(R10-J 본체)·외부화 572키·스위처). 계약·결정은
  `docs/team/SPRINT_R11_01.md`(§6 웨이브 2), 이전 이월은 `SPRINT_R10_01.md` §4.1 ·
  `RETROSPECTIVE.md` §R10.7~8. 판정 대기 R10-I·K·L·M·P·Q 잔존(J·O 해소).
- **다국어(R11)**: `frontend/src/i18n/` 경량 자체 구현(의존 0), 572키 ko/en 전면
  외부화 + 헤더 스위처. **ko 리소스 값은 원문 바이트 동일** 원칙 — 스모크가 한국어
  문구를 단정하며 하네스는 로케일 ko 고정(jsdom 7 + SSR 3, en-US 러너 대비).
  lib에서 i18n import는 `'../i18n/index.js'` 명시 경로(node ESM 디렉토리 import 불가).
- 테스트 실측 **backend 1321** · **ai-worker 193**(의존 전체 설치 시) · 프론트 `test:*` **15종 전부 CI 편입**
  — `ci.sh`의 `FRONT_TESTS` 9종(`explore`·`session`·`placement`·`visual`·`gating`·
  `board-entry`·`assist`·`webgl`·`overlay`) + `board`(board_engine 공유 벡터)는 **별도
  단계**다. 실DB 왕복 스모크는 `scripts/smoke_r10.sh`(7단계, 전원 OK).
- **CI 상주화 완료(2026-08-03)**: `.github/workflows/ci.yml`이 PR·push에서 `ci.sh`
  5단계를 잡으로 돌린다. 워크플로는 검사 명령을 **재구현하지 않고 ci.sh를 호출**한다
  — 종목 목록은 `FRONT_TESTS` 단일 소유(여기 나열하면 드리프트한다).
- **실DB 검증 완료(2026-08-03)**: `0008` 마이그레이션(downgrade 포함) ·
  `consume_if_available` 0행 분기가 재조회 SELECT로 감 · `_count_answered_today`의
  배치고사 제외가 SQL 레벨 성립 · 에너지 진입 경계 ⓐ~ⓕ 전건. 미검증 잔여는
  **동시성·`CLOUD_COST≥2`**(KST 자정 경계는 목 정렬로 해소 — 아래).
- 목(`frontend/mock/apiMockPlugin.js`)의 하루 경계는 **KST**다(`KST_OFFSET_MS`).
  UTC로 되돌리면 `test_목의_하루_경계가_KST다` 계약이 실패한다 — R2~R10 내내 목의
  하루가 09:00 KST에 넘어갔던 결함이라 되살리지 말 것.
- **RLS 런타임 실격리 작동 중**(2026-08-05 해소) — 런타임은 비특권 `weathermind_app`
  롤(NOBYPASSRLS·비소유), 마이그레이션만 소유자 롤(`MIGRATION_DATABASE_URL`).
  유저 격리 = 앱 필터 + DB 정책 2층. 예외 2건(users 인증 조회·리더보드 SELECT)은
  `docs/specs/08`에 근거 문서화, 확장은 테스트가 차단. 신규 볼륨은 init.sql,
  기존 볼륨은 `backend/app/scripts/rls_app_role.sql`(멱등).
- **최종 일정 확정(2026-08-06)**: 8/10 배포 → **8/11~18 일주일 실운영**(로그 축적·
  파라미터 조정) → 8/18 b 보정 → 8/19~20 QA·발표 준비 → 8/21~22 본선·심사.
  실운영 기간이 ROADMAP §5.3이 "노력으로 해결되지 않는다"고 적은 마일스톤 4의
  실데이터 부재를 여는 유일한 길이다. ⚠️ **서버·도메인 확보 기한 8/10**(클라이언트
  몫 — 놓치면 이 계획 전체가 무의미). 상세 ROADMAP §5.5.
- **API 키는 발급됨 · 비용 때문에 의도적 미입력**(2026-08-03 클라이언트 결정).
  "미발급"이 아니다 — **큰 시퀀스마다 3게이트로만 투입**한다(ROADMAP §5.3):
  G0 도달 스모크(~5콜) / **G1 저작 배치(W2 초입, 1회)** / G2 데모 가동.
  KMA 키는 별개(브리핑·리그 정산 전제, 없으면 degraded).
- ⚠️ **G1 전에 생성 문항 영속화가 선행되어야 한다.** `session_service.py`가 생성
  문항을 `content_item_id=None`으로 버려서 **세션마다·유저마다 재생성**한다 —
  지금 키를 넣으면 비용이 영구 자산이 아니라 트래픽으로 증발한다. `rag-feedback`도
  board 외 전 유형에서 **매 답안 1콜**(정오 무관)이라 상시 과금 지점이다.
- **무키로 가능한 범위**: 마일스톤 4(합성 데이터) · 5(인프라) · 6 다국어 골격·UI en ·
  6 다과정 구조. **무키로 불가**: 문항 텍스트 대량 생산 3건(마일스톤 3 뱅크 · 문항 en
  번역 · 기초과학 파일럿 문항).
- GitHub `NinjaTurtle-max/WeatherMind`(private).
- **대외 문서에 Duolingo 언급 금지.** 메커니즘만 차용하고 표현(캐릭터·문항 텍스트)은
  자체 제작한다. 벤치마킹 관찰은 `docs/Observation_Report_02·03`에만 둔다.

## SSOT — 기능 상세는 여기서 확인(위 요약은 진입점이지 전체가 아님)
**`docs/ROADMAP.md`(전략 — 마일스톤 1~6·의존 규칙·현재 위치·용어 규약)** ·
`docs/specs/`(제품 스펙, 00~10번) · `docs/DEVELOPMENT_PLAN.md`(표준 결정) ·
`docs/team/TEAM_PROCESS.md`(팀 운영·§2.4 Git·§2.6~2.7 동적 편성) ·
`docs/team/RETROSPECTIVE.md`. 충돌 시 위 문서 우선.
- **"마일스톤"은 로드맵 1~6만 지칭한다.** 스프린트 우선순위는 "항목"(R10-A~I),
  실행 단위는 "스토리"(S1~S6) — 혼용 금지(ROADMAP §0).
- **진행 가능 여부는 ROADMAP §1~2로 판단한다.** 아래 「프로젝트 현황」은 진입점 요약이라
  뒤처질 수 있다.

## 명령
- ⚠️ **`ai-worker` 의존을 설치하지 않으면 로컬 초록이 LLM 경로를 검증하지 않는다.**
  langchain·chromadb 미설치 시 관련 테스트가 `pytest.importorskip`으로 **조용히
  skip**된다(미설치 158 passed/7 skipped ↔ 설치 169 passed/0 skipped). CI는
  `ai-worker/requirements.txt`를 설치하므로 **로컬에서 안 도는 테스트가 CI에서만 돈다**
  — 실제로 이 함정에 걸렸다(2026-08-03, PR #21·#22 CI 실패 2건: 지연 임포트 전환으로
  사라진 재노출 이름을 monkeypatch하던 테스트, `sys.modules`에 langchain이 **전역
  부재**임을 단정하던 테스트). ai-worker를 건드리면 `pip install -r
  ai-worker/requirements.txt` 후 재실행할 것.
- **환경 전역 상태를 단정하는 테스트를 쓰지 말 것.** "sys.modules에 X가 없다"는 설치
  여부·테스트 실행 순서에 따라 갈린다. 확인할 것이 "이 import가 무엇을 추가로 적재하나"
  라면 **전후 차집합**을 봐야 한다.
- 테스트: `cd backend && python -m pytest tests -q` / `cd ai-worker && python -m pytest tests -q`
- 전체 CI: `scripts/ci.sh` (lint→test→board→config→frontend)
- lint: `python -m pyflakes backend/app ai-worker/app celery/app`

## 팀 편성 — 오케스트레이트 개발 (상시 적용, 2026-08-01 사용자 지시)
개발 작업은 단독 순차가 아니라 **오케스트레이트 형태**로 진행한다(서브에이전트 사용
상시 승인). 상세 규칙: `docs/team/TEAM_PROCESS.md` §2.6~2.7.
- 직군 7개는 고정, **인원은 직군별 개발량에 따라 가변 배정** — 백로그 확정 시 초기
  배정 → 웨이브 0 종료 시 재산정 → 블로킹 시 증감. 개발량 0인 직군은 미투입.
- 인원 2 이상인 직군은 **리드**를 세우고, 리드가 **자기 세션 내에서 워커를 파생**한다
  (깊이 상한 2: 오케스트레이터 → 리드 → 워커. 워커는 더 파생 금지).
- 파생 시 필수 전달: 배타적 파일 소유 목록 · 계약 문서 경로 · AC·테스트 명령 ·
  금지 범위 · 반환 형식. 파일 소유를 쪼갤 수 없으면 증원하지 않는다. 동시 상한 5.
- **격리 등급은 인원 수가 아니라 계약 성숙도로 판정**한다(§2.6.1): T1 공유+소유분리
  (계약 발견 중) / **T2 완전 격리**(계약 고정 후 — 담당별 워크트리+브랜치, 통합
  브랜치 경유). 프론트 T2는 `node_modules` 심링크와 포트 배정이 **필수**다.
  격리해도 파괴적 git 금지·발견 공유·공유 파일 단일 소유는 유지한다.
- `/code-review` 게이트는 **위임 불가** — 메인(PM)이 브랜치 단위로 직접 실행.
  에이전트의 "완료" 보고는 실제 테스트 출력·diff로 확인한 뒤 인정한다.

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

**사고 2건차(2026-08-01)**: 병렬 5인이 **워킹트리를 공유**하는 상태에서 한 담당이
베이스라인 측정용으로 `git stash -u --keep-index`를 실행 → **5인 작업분이 전부
되돌아갔다**(백업으로 복구, 손실 0). 교훈이 1건차와 다르다:
5. **`stash`는 "안전한 명령"이 아니다.** 파일 소유를 갈라도 `stash`·`reset`·`checkout`은
   워킹트리+인덱스 **전체**에 작용한다 — 자기 파일만 영향받지 않는다.
6. 병렬 작업 중 담당에게는 **파괴적 git 일절 금지**를 브리핑에 명시하고, 검증용
   읽기 전용 대안을 함께 준다(`git show HEAD:<path>`·`git diff`·`/tmp` 하네스).
   커밋은 PM만 한다. 근본 대책은 격리 등급 T2(TEAM_PROCESS §2.6.1).

## 기타 학습된 선호
- 커밋은 항목 단위 원자적 분리(웨이브 끝 몰아치기 금지).
- 계약 수치(배합·에너지 등) 변경 시 env 기본값=계약값 유지, 계약 테스트로 드리프트 감시.
- 교차 빌드 컨텍스트(backend↔celery) 중복은 물리적 병합이 아니라 단일 소유자+계약
  테스트로 해소. 같은 컨텍스트 내 중복만 물리적 DRY 대상.

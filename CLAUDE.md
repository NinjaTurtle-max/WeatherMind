# WeatherMind — Claude 작업 지침

날씨 데이터 기반 기후 학습 서비스. **단계형 학습 게이미피케이션** + 실제 기상 개념을
시뮬레이션 없이 **보드 퍼즐**로 체득시킨다. 서비스: `backend`(FastAPI)·`frontend`
(Vite)·`ai-worker`(LangChain/Gemini, 문항 생성·품질 게이트)·`celery`(KMA 수집 배치).

## ⚠️ 0. 이 문서를 어떻게 쓰는가 — **컨텍스트는 가볍게, 내용은 밖에**

**이 문서는 지도이지 창고가 아니다.** 매 세션 전부 읽히는 자리이므로, 여기 있는
한 줄은 앞으로의 모든 작업이 지불하는 비용이다. 그래서 **무엇이 어디 있는지**만
적고 **값과 내용은 소유자 문서·코드에 둔다.**

**적을 것 / 적지 않을 것**

| 여기 적는다 | 밖에 둔다 (여기엔 경로만) |
|---|---|
| 소유자가 누구인지 (`X의 소유자는 Y다`) | 목록·표·열거 — 섹션명, 유닛명, 테스트 종목명, 태그 이름 |
| 판단의 근거와 금지 사항 | 수치 — 문항 수, 테스트 수, 키 개수, 커버리지 |
| 되돌리기 어려운 작업의 규칙 | 스펙 본문·API 상세·스키마 |
| **틀렸던 기술과 그 경위**(재발 방지) | 이월 항목 — `docs/team/CARRYOVER_*.md`가 단독 소유 |

**왜 이 규칙이 있나 — 이 문서가 스스로 증거다.** 값을 품은 줄은 예외 없이 낡았고,
낡은 채로 **감사 판단의 근거로 인용됐다**:

- 「콘텐츠 실측」이 **두 판 연속** 낡았다(08-07 판은 전 행이 틀렸고, 08-09 판은
  하루 만에 272 → 1,000이 되며 무효). 그 값이 코드 독스트링 여러 곳에 복제돼 있었다
- 「테스트 실측」 2275 → 4115. 종목 수를 나열한 줄은 *"여기 나열하면 드리프트한다"*고
  적어 놓고 **스스로 드리프트했다**(22/21/25 → 실측 23/22/26)
- 섹션·유닛 수, i18n 키 수(572 ↔ 751 ↔ 761), ci.sh 단계 수(5 → 7)가 모두 같은 경로

**그래서 지킬 것**

1. **숫자를 쓰면 날짜를 붙이고 소유자를 함께 적는다.** `문항 1,000건(2026-08-10 ·
   소유자 `database/seed/content_items.json`)`처럼. 날짜 없는 수치는 인용 금지.
2. **개수는 세는 방법을 적고 값은 적지 않는다.** 「종목 수의 소유자는 `ci.sh`의
   `FRONT_TESTS` 배열 하나이고, 궁금하면 그 배열을 센다」가 옳은 형태다.
3. **드리프트 감시는 사람이 아니라 계약 테스트가 한다.** 값을 못박아야 한다면
   여기가 아니라 테스트에 못박는다(`test_ci_workflow_contract`·`test_seed_contract`가
   선례 — 그래야 틀렸을 때 CI가 운다).
4. **새 내용은 여기 붙이기 전에 갈 곳을 먼저 찾는다.** 전략은 `docs/ROADMAP.md`,
   스펙은 `docs/specs/`, 운영·스프린트는 `docs/team/`, 이월은 이월 대장, 판단의
   경위는 **그 코드의 주석**이다. 여기 남는 것은 그 문서로 가는 한 줄뿐이다.
5. **틀린 기술은 지우지 말고 정정하며 경위를 남긴다.** 그 값이 이미 다른 판단에
   인용됐을 수 있기 때문이다 — 조용히 고치면 잘못된 결론이 살아남는다.

## 핵심 기능 (실제 코드 기준 — API·도메인 모델)
- **세션 엔진**(`session.py`): `GET /session/today`가 배합(신규5·복습4·실황1·진도5=**15문항** —
  `Settings.SESSION_RECIPE`로 env 조정. **진도 블록은 항상 마지막**)으로 하루 세션 발급. `today.*` 슬롯은
  KMA 실황값으로 문항에 실시간 주입.
- **커리큘럼**(`curriculum.py`): 유닛 트리(섹션→유닛), `unit_order`·`prereq` 선행 잠금,
  유닛 완료 시 세션 발급(`POST /units/{slug}/session`).
  **다과정**(R11): `courses` 테이블 + `GET /courses`·`?course=` — `units.course_id`
  NULL은 기본 코스(weather) 취급이라 완전 하위 호환. **basic-science는 3섹션 8유닛 시드 완료**(R13 — "빈 트리"는
  낡은 기술이다). θ는 코스를 가로질러 개념 태그 단위.
  ✅ **`section_meta.json` 공백은 해소됐다**(2026-08-09 실측 8섹션 전건 — CO-I-4 닫힘).
  이 줄에는 "4섹션(하늘 읽기·공기의 힘·큰 바람·도시와 기후)"과 "section_meta는 아직
  4/7섹션"이 적혀 있었으나 둘 다 거짓이 됐다: 「위험한 하늘」 4유닛이 붙어 기상 코스는
  **5섹션 16유닛**이고 전체는 **8섹션 24유닛**이다. **섹션·유닛 목록을 여기 나열하지
  않는다** — 소유자는 `database/seed/units.json`과 `curriculum_service.SECTION_ORDER`다.
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
  순수 파이썬)은 **배선 완료 — 화면까지 닿는다**: `ai-worker/main.py` → `ai_client` →
  `weatherbrain_service` → `GET /progress/mastery` → `WeatherBrainPanel.jsx`. 합성 200명
  복원 검증(숙련 AUC 0.929) 완료, 실학습자 검증은 데이터 축적 후. ⚠️ **"BKT는 임포트하는
  곳이 없다"는 과거 기술은 거짓이었고, 그 오류가 감사 판단을 오염시켰다**(2026-08-07 정정).
- **예보 대결**(`duel.py`): 오늘/과거 대결 이력.
- **인증**(`auth.py`): JWT access/refresh. **게스트는 `POST /auth/guest`가 실 유저 +
  실 JWT를 발급**(R11에서 실체화 — 그 전에는 프론트가 가짜 토큰을 조작했고 실서버에서
  깨졌다). **계정 전환 유도(R10-J 본체)는 구현 완료** — 서버·프론트·라우트·목·스모크(`test:guest-convert`)
  전 홉. "미구현"은 낡은 기술이었다(2026-08-07 정정).
  ✅ **"게스트는 평생 `middle_high`"(CO-P-5)도 해소됐다**(2026-08-09 실측):
  `PATCH /auth/me`(`routers/auth.py:371` `update_me`)가 학령 변경 통로다 — 독스트링이
  "게스트가 평생 middle_high에 갇히지 않게 하는 유일한 통로(R13 P-5)"라고 스스로
  밝힌다. 종전 기술의 근거였던 **"학령 신고 writer가 `POST /auth/register` 하나뿐"이
  더 이상 참이 아니다**(writer 2개). 경위를 남기는 이유는 이 항목이 게스트 전환
  설계 판단의 전제로 여러 번 인용됐기 때문이다.
- **AI 게이트**(ai-worker): Gemini로 문항 생성 → 결정적 휴리스틱(LLM 무관) 1차 게이트
  → LLM 2차 게이트. LLM 키 없어도 폴백 문항 뱅크로 전 기능 동작.

## 프로젝트 현황
- **로드맵 마일스톤 1·2 완료**(6개 중 2개) — 다음은 마일스톤 3(콘텐츠·난이도 다양화).
  상태·의존 규칙·주차 일정은 `docs/ROADMAP.md`가 SSOT.
- **R2~R12 완료 · R13 진행 중**(R11 = 무키 웨이브 1·2 — ⚠️ **마일스톤 4 "완료 판정"은
  재검토 필요**: `ROADMAP:55`가 4의 정의에 "AI 캐스터 롤플레이"를 넣었는데 `:161`
  달성범위 표가 완료 기준에서 그것을 뺐고 코드는 0건이다 — CO-H2. **대외 발표에서
  "마일스톤 4 완료"를 단정하지 말 것.** ⚠️ `SPRINT_R6_01.md`·R12 자체 문서가 **존재하지
  않는다** — R6·R12가 무엇을 남겼는지 추적 불가) + 6의 무키분:
  다과정 UI·온보딩 재배치(R10-J 본체)·i18n 전면 외부화·스위처. **R11이 무엇을
  착지시켰는지의 서술이라 키 수를 적지 않는다** — 종전 "외부화 572키"가 그대로
  남아 아래 「다국어」 줄과 어긋났다(2026-08-09 정정). 계약·결정은
  `docs/team/SPRINT_R11_01.md`(§6 웨이브 2), 이전 이월은 `SPRINT_R10_01.md` §4.1 ·
  `RETROSPECTIVE.md` §R10.7~8. 판정 대기 R10-I·K·L·M·P·Q 잔존(J·O 해소).
- **다국어(R11)**: `frontend/src/i18n/` 경량 자체 구현(의존 0), ko/en 전면
  외부화 + 헤더 스위처(2026-08-09 실측 **761키**, 패리티 완전). 키 수는 저작으로
  계속 자라므로 인용할 때 날짜를 붙일 것 — 이 줄에 572, 아래 구조 표에 751이
  동시에 적혀 있었고 **둘 다 틀렸다**(2026-08-09 정정). 패리티 감시는
  `frontend/tests/i18n.smoke.test.mjs`가 소유한다.
  **ko 리소스 값은 원문 바이트 동일** 원칙 — 스모크가 한국어
  문구를 단정하며 하네스는 로케일 ko 고정(jsdom 7 + SSR 3, en-US 러너 대비).
  lib에서 i18n import는 `'../i18n/index.js'` 명시 경로(node ESM 디렉토리 import 불가).
- **테스트 개수를 여기 적지 않는다**(§0-2). 세는 방법만 남긴다:
  backend·ai-worker·celery는 `python -m pytest tests -q`의 **끝 줄**, 프론트 종목은
  `scripts/ci.sh`의 **`FRONT_TESTS` 배열**(단일 소유자 — 종목 이름도 파일 목록도
  여기 쓰지 않는다). 전 종목 CI 편입 상태다.
  ⚠️ **이 줄은 세 번 드리프트했다.** *"여기 나열하면 드리프트한다"*고 적어 놓고
  스스로 22/21/25 → 23/22/26으로 틀렸고(08-09), backend 수는 2275 → 4115 →
  다시 그보다 커지며 두 번 더 낡았다. §0을 만든 직접 계기가 이 줄이다.
  ⚠️ **backend 수가 뛰는 것을 "커버리지가 늘었다"로 읽지 말 것.** 시드가 늘면
  문항별 `parametrize`가 함께 늘어 **테스트를 한 줄도 안 써도** 수가 뛴다.
  실제로 시드 272 → 1,000건 때 그렇게 두 배가 됐다.
  실DB 왕복 스모크는 `scripts/smoke_r10.sh`(7단계, 전원 OK).
- **CI 상주화 완료(2026-08-03)**: `.github/workflows/ci.yml`이 PR·push에서 `ci.sh`
  단계를 잡으로 돌린다 — **`ci.sh all`의 단계 수와 워크플로 잡 수가 같아야 하고
  2026-08-09 실측 양쪽 7이다**(lint·test·board·config·frontend·seed·authoring.
  종전 표기 "5단계"는 seed·authoring 편입 전 값이었다). 이 패리티는 사람이 아니라
  `backend/tests/test_ci_workflow_contract.py`가 감시하므로, 숫자가 의심되면 그
  테스트를 돌린다. 워크플로는 검사 명령을 **재구현하지 않고 ci.sh를 호출**한다.
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
- ✅ **G1 앞의 선행 2건은 착지했다**(2026-08-09 확인 — 종전 "⚠️ 선행되어야 한다"는
  낡은 기술). 경위를 남긴다: 이 항목은 **"지금 키를 넣으면 비용이 트래픽으로
  증발한다"는 판단의 근거**였으므로 상태가 바뀐 것 자체가 결정 사항이다.
  · **생성 문항 영속화** — `session_service.persist_generated_items`
    (`session_service.py:691`, 발급 경로 `:969`에서 호출)가 품질 게이트 통과분을
    `content_items`에 적재하고 그 id로 세션에 편성한다. 재사용 여부는
    `Settings.GENERATED_ITEM_STATUS`(기본 `active` = 뱅크 재사용) 노브가 소유한다.
  · **`rag-feedback` 상시 과금** — CO-I-1 배선으로 **사람 저작 해설 193건이 LLM보다
    앞**에 온다(위 콘텐츠 실측). "board 외 전 유형에서 매 답안 1콜"은 더 이상 참이
    아니고, 남는 호출은 해설 없는 45건 + 생성 문항이다.
- **무키로 가능한 범위**: 마일스톤 4(합성 데이터) · 5(인프라) · 6 다국어 골격·UI en ·
  6 다과정 구조. **무키로 불가**: 문항 텍스트 대량 생산 3건(마일스톤 3 뱅크 · 문항 en
  번역 · 기초과학 파일럿 문항).
- GitHub `NinjaTurtle-max/WeatherMind`(private).
- **대외 문서에 Duolingo 언급 금지.** 메커니즘만 차용하고 표현(캐릭터·문항 텍스트)은
  자체 제작한다. 벤치마킹 관찰은 `docs/Observation_Report_02·03`에만 둔다.
  ⚠️ **이 줄과 `docs/team/HACKATHON_RULES.md` §L의 인용 1줄은 규정 본문이라 존치한다** —
  금칙어를 지운 규정은 검색으로 감시할 수 없다. 그 둘과 허용처 2곳(Obs02·03) ·
  이월 대장을 제외한 전 파일은 **0건이어야 하고 2026-08-08 실측 0건**이다(CO-V-3 해소).
  대체 원칙: **고유명사만** 바꾸고 메커니즘 서술과 벤치마킹 근거 참조(`Observation_Report_02 §4.3`
  같은 것)는 **남긴다** — 근거가 끊기면 왜 그렇게 설계했는지 추적이 끊긴다.
  채택 대체어: "단계형 유닛 트리" · "소모성 자원(하트형 에너지)" · "선행 학습 앱".

## 저장소 구조 — 어디에 무엇이 있나

```
backend/            FastAPI. 채점 권위·세션 발급·에너지·리그·진도 전부 여기가 소유
  app/routers/      45 데코레이터 + curriculum 서브라우터 4 = 실질 49 라우트(08-09)
  app/services/     도메인 로직. session_service·answer_service·energy_service·
                    league_service·placement_service·curriculum_service·weatherbrain_service
  app/models/       SQLAlchemy 131 컬럼(relationship 제외)
  app/scripts/      seed_content.py(멱등 키 = concept_tag + question_text) · rls_app_role.sql
  alembic/versions/ 마이그레이션 12개. 소유자 롤(MIGRATION_DATABASE_URL)로만 실행
  tests/            개수는 여기 적지 않는다(§0-2) — 세려면 `pytest tests -q`의 끝 줄.
                    test_ci_workflow_contract·test_prompt_spec_parity 처럼
                    **파이썬 밖 파일을 파싱해 대조하는 계약 테스트**가 선례로 있다
frontend/           Vite + React
  src/modules/      화면 단위. session·board·curriculum·league·home·profile·explore
  src/lib/          boardEngine.js(서버 board_rules.json과 공유 규칙) · abilityDisplay.js
  src/i18n/         의존 0 자체 구현. ko/en 패리티 완전(08-09 실측 761키). ko 값은 원문 바이트 동일
  mock/             apiMockPlugin.js — 하루 경계 **KST**(KST_OFFSET_MS). UTC 복귀 금지
  tests/            종목 수의 소유자는 ci.sh FRONT_TESTS 하나 — 여기 적지 않는다
ai-worker/          LangChain·Gemini. 문항 생성 → 결정적 게이트 → LLM 2차 게이트
  app/chains/       quiz_gen_chain(휴리스틱 16종·어휘 대조) · rag_chain(개념 직접 조회
                    — **벡터 DB는 R13에서 철거**) · validate_chain
  app/weatherbrain/ irt.py · knowledge_tracing.py(BKT) · synth.py(합성 검증 자산)
celery/             KMA 수집 배치. 태스크 4개 전부 beat 등록됨
database/seed/      본시드 json 10개 + staging/. **content_items.json의 문항 본문은
                    최상위가 아니라 `template_json` 안에 있다**(question_text·
                    correct_answer·explanation_hint·options·pairs·items…)
scripts/            ci.sh(all = 7단계) · smoke.sh · smoke_r10.sh · lint_seed_items.py ·
                    author_items.py — 뒤 둘은 ai-worker validate_chain을 in-process import
docs/               ROADMAP(전략 SSOT) · specs/(00~12) · team/(프로세스·스프린트·회고·
                    **CARRYOVER_R13.md = 이월 대장**) · Observation_Report_01~03(벤치마킹)
```

## 콘텐츠 실측 (**2026-08-10 재실측** — 추정치를 쓰지 말고 이 숫자를 쓸 것)

⚠️ 이 절은 **두 판 연속으로 낡은 채 방치됐다**(08-07 판은 전 행이 틀렸고, 08-09 판은
하루 만에 272 → 1000이 되며 무효가 됐다). 그 값이 코드 독스트링 여러 곳에 복제된 채
감사 판단의 근거로 쓰인 전례가 있으므로, 인용할 때 **날짜를 함께** 적을 것.
숫자의 소유자는 `database/seed/content_items.json`이고, 규모는
`test_seed_contract`·`test_r10_question_payload_contract`가 못박는다.

- **문항 1,000건**(2026-08-10 · 하루에 +716) · 유형 7종
  `mc 310 · cloze 156 · short_answer 147 · match 124 · ordering 110 · slider 107 · board 46`
  · 개념 태그 **14종**(개념 문서 태그 집합과 완전 일치)
- **지식 단계 10칸**(6→10 확장, 같은 날) — `1:98 2:100 3:98 4:104 5:100 6:100 7:100
  8:100 9:100 10:100`. **10칸 전건 98건 이상**이라 어느 단계로 배정돼도 세션이 굶지
  않는다 — 확장 직후에는 **6·9단계가 0건**이었다. 2축 정합 위반 0건.
- **학령 밴드** `elementary 198 · middle_high 202 · adult 200 · expert 400`
  (expert가 4칸(7~10)을 담당하므로 두 배다 — 편중이 아니라 파생표 그대로다)
- **`explanation_hint` 909건 저작**(비board 954건 중 **95%** · 해설 없는 45건만 LLM 몫)
- ⚠️ **"1,000건 통과"가 "1,000건 검증"은 아니다.** 전건이 `lint_seed_items`를 통과했지만
  그것이 보는 것은 스키마·게이트·payload·중복·금칙 어휘뿐이다. **상위 4칸(7~10, 400건)은
  어휘 게이트가 사실상 무력**하고(그 단계 문항은 그 이하 전 용어가 통과), 실제로
  **채점 결함 2건**(오독이 정답 처리 · 맞는 답이 오답 처리)이 lint 초록 상태에서
  발견됐다. 게이트가 못 보는 결함 유형 5가지와 표본 검수 체크리스트는
  `docs/team/CARRYOVER_R13.md` §1.1e가 소유한다.
  ✅ **화면에 닿는다 — CO-I-1 해소**(2026-08-09 확인). 종전에 "화면에 안 뜬다 ·
  상시 과금 지점"이라 적혀 있었으나, `answer_service`가 board → **사람 저작 해설** →
  RAG 3단 우선순위로 배선을 마쳤고 `AnswerResult.feedback_source`가 출처까지
  내려보낸다. 남는 LLM 호출은 **해설 없는 45건 + 생성 문항**뿐.
- **커리큘럼 2코스 · 8섹션 · 24유닛**(기상 5섹션 16유닛 + basic-science 3섹션 8유닛)
  ✅ `section_meta.json` **8섹션 전건** — CO-I-4 해소(종전 "4섹션뿐"은 낡은 기술).
- **유닛 × 밴드 커버리지**: 96칸 중 **0문항 16칸**(신고 가능한 3밴드로만 세면 9칸),
  그중 **10칸이 board 유닛**. 칸 인구의 소유자는
  `backend/tests/test_curriculum_band_fallback.py` — 저작이 진행되면 그쪽이 먼저 운다.
- **staging 30파일 922항목 중 898건이 본시드와 중복 — 미승격 잔여는 24건뿐**
  (2026-08-10 실측). 중복은 결함이 아니라 **승격의 자국**이다: 검수를 통과한 문항이
  본시드로 올라가도 staging 원본은 지우지 않는다. 그래서 `--staging` lint는 본시드
  대조를 탈락 사유로 쓰지 않는다.
  ⚠️ **au1(47건)·au2(40건)은 `knowledge_level`이 0건이라 게이트 예외**로 두고 나머지만
  검사한다. 해제 조건(단계 부여)은 `scripts/lint_seed_items.py`가 코드에 적어 놓았다.
  ⚠️ `--staging`은 staging 파일 **사이의** 중복을 보지 않는다 — 두 저작자가 독립으로
  같은 정답을 내면 각자 통과하고 **본시드 병합에서야** 걸린다(2026-08-10에 실제로 2건
  발생, 둘 다 병합 게이트가 잡음). CO-Y-8.

## ⚠️ 이월은 대장에만 존재한다 — `docs/team/CARRYOVER_R13.md`

2026-08-07 전수 감사에서 **미이행·미배선 87건**이 나왔다(A~I절). 성격이 갈수록 나빴다.

| 절 | 성격 |
|---|---|
| A~E 37 | 최근에 정하고 못 한 것 |
| F 8 | **설계했는데 잊힌 것** — Obs02 §4.3 플레이 유형 10종 중 Tier 2 3종이 이월 기록조차 없이 증발 |
| G 6 | 결정이 대화 → 메모리에서 멈추고 저장소에 안 내려온 것 |
| H 16 | **이월했다고 믿었는데 수신자가 없던 것** |
| I 20 | **만들어 두고 안 쓰는 것** |

**가장 중요한 교훈**: 라운드별 「범위 밖」 회수율이 47건 중 21건(45%)인데 갈리는 지점이
명확하다 — **다음 라운드가 자기 §계약에 행으로 받은 이월만 회수됐고, "로드맵 유지"·
"마일스톤 3으로"처럼 수신자 이름이 없는 이월은 회수율 0%**다(R4·R5·R9). **이월할 때는
받는 문서에 행을 만들고 그 사실을 확인할 것.** 이월 문장을 쓰는 것과 이월이 되는 것은
다르다. 코드 주석에만 있는 이월(`routers/duel.py:172`)도 대장이 못 본다.

## SSOT — 기능 상세는 여기서 확인(위 요약은 진입점이지 전체가 아님)
**`docs/ROADMAP.md`(전략 — 마일스톤 1~6·의존 규칙·현재 위치·용어 규약)** ·
`docs/specs/`(제품 스펙, **00~12번** — 종전 "00~10번"은 11·12 추가 전 값이라 같은
파일 안의 구조 표와 어긋나 있었다. 2026-08-09 정정) · `docs/DEVELOPMENT_PLAN.md`(표준 결정) ·
`docs/team/TEAM_PROCESS.md`(팀 운영·§2.4 Git·§2.6~2.7 동적 편성) ·
`docs/team/RETROSPECTIVE.md`. 충돌 시 위 문서 우선.
- **`docs/team/HACKATHON_RULES.md`(대회 규정·제출 요건)는 ROADMAP보다도 우선한다** —
  규정은 협상 대상이 아니다. 핵심: **API 키 노출=실격** · 제출은 GitHub 링크가 아니라
  **구글 폼 zip 4종**(구동 URL·소스·**프롬프트 세션**·README) · **로그인 없이 열려야**
  함 · **8/21 18:00 전면 동결** · **URL은 9월 셋째 주까지 유지**.
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
- 전체 CI: `scripts/ci.sh` (인자 없이 = `all`. 단계 목록은 ci.sh 자신이 소유하고,
  여기 나열하면 드리프트한다 — 실제로 이 줄이 5단계만 적어 seed·authoring이 빠져
  있었다. 2026-08-09 실측 7단계)
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

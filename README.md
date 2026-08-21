# WeatherMind

날씨 데이터 기반 기후 학습 서비스 — 오늘의 AI 퀴즈 · 기후 시뮬레이터 · 날씨 예측 리그.
지도 기반 대기 보드 · 단계별 커리큘럼(유닛 트리·왕관 진도) · 구름 에너지(소모/회복 리텐션 루프).

이 README는 **단독으로 실행·배포·기여가 가능하도록** 필요한 내용을 전부 담습니다
(내부 스프린트·회고 문서는 제출 소스에서 제외했습니다 — 실행에 필요하지 않기 때문입니다).

> ⚠️ **제출 이후 운영 관련 중요 고지 — Gemini API 크레딧**
>
> 이 프로젝트는 문항 자동 생성·2단 품질 검증·학습 피드백 생성에 Google Gemini API를
> 씁니다. 제출 시점(2026-08-21) 기준 **잔여 크레딧은 약 ₩9,996원**이며, 결제
> 자동 충전을 설정해 두지 않았습니다. 심사·시연 기간 중 이 크레딧이 소진되면(대략
> 8/22 이후) Gemini 호출이 실패하기 시작할 수 있습니다 — 단, 이 경우에도 서비스가
> 죽지 않고 **자동으로 저작된 정적 피드백·폴백 문제 뱅크로 강등**되어 핵심 기능
> (문제 풀이·채점·진도·보드·시뮬레이터)은 계속 정상 동작합니다(`ai-worker/app/llm_budget.py`
> 의 live→fallback→dummy 강등 사다리). 실시간 AI 생성 문항·개인화 피드백만 일시적으로
> 사전 저작 콘텐츠로 대체됩니다.

## 아키텍처

| 서비스 | 포트 | 설명 |
|---|---|---|
| frontend | 80 | React 18 + Vite + Tailwind, nginx가 `/api/v1` → backend 프록시 |
| backend | 8000 | FastAPI + SQLAlchemy 2.0(async) + Alembic, JWT 인증, RLS |
| ai-worker | 8001 | LangChain 3체인(Router/QuizGen/피드백), Gemini, 내부 API(`X-Internal-API-Key`) |
| celery-worker / celery-beat | - | 날씨 수집, 주간 리그 정산, 일일 예보 대결 정산, WeatherBrain 재학습 |
| postgres | 5432(내부) | 스키마·RLS는 Alembic 마이그레이션이 소유 (init.sql은 EXTENSION만) |
| redis | 6379(내부) | 캐시 `weather:{date}:{region}`(1h) / `quiz:{date}:{level_group}`(24h) / `session:{user_id}`(7d) |

## 실행에 필요한 모델·데이터셋

| 구분 | 무엇 | 어디서 얻나 | 없으면 |
|---|---|---|---|
| **LLM** | Google Gemini (`gemini-3.1-flash-lite` 기본값, `.env`의 `GEMINI_MODEL`로 교체 가능) | [Google AI Studio](https://ai.studio/)에서 API 키 발급 → `.env`의 `GEMINI_API_KEY` | 키가 없으면(빈 값·플레이스홀더) **자동으로 무키 모드로 동작** — 문항은 사전 저작된 폴백 뱅크에서, 피드백은 정적 격려 문구에서 나간다. 앱이 죽지 않는다(`ai-worker/app/llm_provider.py`) |
| **기상 실황·예보 데이터** | 기상청 API허브(공공 API) | [apihub.kma.go.kr](https://apihub.kma.go.kr/)에서 무료 발급 → `.env`의 `KMA_API_KEY`(예비 키 `KMA_API_KEY_SPARE` 선택) | 없으면 실황 연동 화면(오늘의 날씨 기반 문항 등)이 캐시·기본값으로 대체된다 |
| **문항 뱅크** (`database/seed/content_items.json`) | 팀이 직접 저작한 문항 1,034건(LLM 생성 아님, 비용 0) | 저장소에 포함 — 별도 다운로드 불필요 | — |
| **보드 규칙** (`database/seed/board_rules.json`) | 대기 보드 판정 규칙 21종 | 저장소에 포함 | — |
| **개념 문서** (`database/seed/climate_concepts.json`) | 피드백 생성 시 참조하는 근거 문서(RAG 아님 — 직접 조회) | 저장소에 포함 | — |
| **DB/캐시** | PostgreSQL 16 · Redis 7.2 | `docker-compose.yml`이 자동으로 띄움 | — |

## 로컬 실행 순서

```bash
# 1. 환경변수 준비
cp .env.example .env
# .env 열어서 KMA_API_KEY, GEMINI_API_KEY, JWT_SECRET_KEY,
# AI_WORKER_INTERNAL_API_KEY 채우기
openssl rand -hex 32   # JWT_SECRET_KEY / AI_WORKER_INTERNAL_API_KEY 생성용

# 2. 전체 기동
docker compose up -d --build

# 3. DB 마이그레이션 (backend 컨테이너 안에서)
docker compose exec backend alembic upgrade head

# (별도 벡터 임베딩·검색 단계는 없다 — ai-worker의 개념 문서는
#  ./database/seed 마운트로 직접 읽힌다)

# 4. 시드 적재 (전부 멱등 upsert — 권장 순서: content → units → badges)
docker compose exec backend python -m app.scripts.seed_content   # 문항 뱅크(세션 배합 1차 소스)
docker compose exec backend python -m app.scripts.seed_units     # 커리큘럼 유닛 트리
docker compose exec backend python -m app.scripts.seed_badges    # 뱃지 정의

# 5. 상태 확인
curl http://localhost:8000/health
curl http://localhost:8001/health

# 6. 프론트 접속
# http://localhost (nginx가 80포트 서빙)

# 7. (선택) DB 왕복 스모크 — 기동~배치고사 왕복까지 9단계 자동 검증 (멱등)
bash scripts/smoke.sh          # 또는: scripts/ci.sh smoke
```

배포 절차(서버 준비·최초 기동·운영 중 갱신)는 `docs/DEPLOY.md`에 상세히 있습니다(제출
소스에는 포함하지 않았으나, 필요 시 팀 저장소에서 확인 가능). 커밋 전 로컬 CI:
`scripts/ci.sh` (lint → test → compose config → frontend build).
통합·릴리스 전에는 opt-in 스모크(`scripts/ci.sh smoke` — 기본 실행엔 미포함)로
DB 실경로(마이그레이션·RLS·θ 왕복·배치고사)까지 확인한다.

## 개발 중 개별 실행 (hot reload)

**Windows에서는 `dev.cmd` 한 번이면 된다** — Docker로 백엔드(postgres·redis·backend)를
띄우고 마이그레이션·시드(둘 다 멱등)를 돌린 뒤 vite dev server를 연다. 끄는 것은
`dev-stop.cmd`(볼륨은 남긴다).

```
dev.cmd          rem 브라우저에서 http://localhost:5173
dev-stop.cmd     rem 백엔드까지 정지
```

```bash
# 백엔드만
cd backend && uvicorn app.main:app --reload --port 8000

# 프론트만 (vite dev server가 /api/v1을 localhost:8000으로 프록시)
cd frontend && npm install && npm run dev   # 보통 5173포트
```

⚠️ **`VITE_MOCK=1`은 「화면만」 보는 모드다.** 백엔드 없이 뜨는 대신 목 픽스처가
작아서 **코스 탭이 안 뜨고**(목에 `GET /courses`가 없어 CourseSwitcher가 스스로
숨는다) **학습 경로가 3칸**으로 보인다(목 유닛 총 10개). 실제 시드로 보려면 위
`dev.cmd`(또는 백엔드 기동 + `VITE_MOCK` 없이 `npm run dev`)를 쓸 것 — 이 차이를
화면 결함으로 오인한 전례가 있다(2026-08-18).

## API 개요 (`/api/v1`)

- `POST /auth/register` · `/login` · `/refresh` · `/logout`
- `GET /quiz/today` · `POST /quiz/{quiz_id}/answer` · `GET /quiz/history`
- `GET /session/today` · `POST /session/{session_id}/answer` · `/{session_id}/complete`
- `GET /progress/me` · `/weak-tags` · `/abilities`(WeatherBrain θ) · `POST /progress/attendance`
- `GET /league/current` · `/leaderboard` · `/me/results` · `POST /league/predict`
- `GET /board/regions` · `/rules` · `/puzzles` · `POST /board/puzzles/{id}/attempt` (지도 대기 보드)
- `GET /curriculum` · `POST /curriculum/units/{slug}/session` · `GET /progress/energy` (커리큘럼·구름 에너지)

에러 포맷은 전부 `{"detail": ..., "code": ...}`, 인증은 Bearer JWT.

## 자주 겪는 문제 (트러블슈팅)

| 증상 | 원인 | 해결 |
|---|---|---|
| CORS 에러 | 프론트 origin 미허용 | backend main.py CORSMiddleware에 origin 추가 |
| KMA "SERVICE_KEY_IS_NOT_REGISTERED" | 키 인코딩 이중 처리 | serviceKey 재인코딩 하지 말 것 |
| RLS로 데이터 안 보임 | SET app.current_user_id 누락 | get_db_with_rls 의존성 사용 확인 |
| Gemini 응답 JSON 파싱 실패 | 모델이 설명 텍스트 추가 | OutputFixingParser + 프롬프트에 "JSON만" 강조 |
| ai-worker 시드 파일 없음 | 볼륨 마운트 누락 | compose의 `./database/seed:/app/database/seed:ro` 확인 또는 `CLIMATE_CONCEPTS_PATH` 지정 |

## 적응 학습 엔진(WeatherBrain) — 검증된 범위

숫자를 인용할 때 **그 숫자가 무엇의 지표인지**까지 함께 적는다. 아래는 검증 범위 요약이다.

| 구성 | 무엇인가 | 검증된 것 |
|---|---|---|
| **능력 추정 θ** (`ai-worker/app/weatherbrain/irt.py`) | **변별도를 고정한 2PL** 문항반응이론(a=1.0 고정이므로 실질 라쉬 모형 — 희소 데이터에서 a 동시추정이 불안정해 v1에서 분리). 격자 EAP, 순수 파이썬 | 알려진 θ·b로 응답을 합성해 표준오차 이내 복원(`tests/test_weatherbrain_irt.py`) |
| **지식추적 BKT** (`knowledge_tracing.py`) | 개념별 P(숙련) 추정. `/progress/mastery` → WeatherBrain 패널까지 배선됨 | 합성 학습자 200명으로 4모수를 절대오차 **0.017**로 복원, **잠재 숙련 상태 판별** AUC **0.93**. 적합 시드와 평가 시드 분리 |

**이 검증이 말하지 않는 것** — 먼저 적는다:

- 실학습자가 BKT를 따르는지는 증명하지 않았다(합성 데이터는 BKT 생성과정으로 만들었다).
  실학습자 교차검증은 **8/11~18 실운영 로그**로 예정돼 있다.
- **다음 응답 예측** AUC는 별도 지표로 **0.697~0.816**이다. 위 0.93은 예측 정확도가
  아니다.
- 프로덕션은 아직 적합 모수가 아니라 중립 사전값으로 돈다
  (`/progress/mastery`의 `params_source == "prior"`). 재적합은 8/18.

## 이번 라운드 범위 밖 (로드맵)

- AI 캐스터 롤플레이 — `ROADMAP` §2 마일스톤 4의 장기 정의에 있으나 **미구현**
  (완료 판정 범위 밖)
- 실기동 통합 테스트 — 실제 KMA/Gemini API 키 발급 후 진행

## 라이선스와 출처

이 저장소의 **소스 코드**는 [MIT License](./LICENSE)를 따릅니다.

### 데이터·자산 출처

| 무엇 | 출처 | 라이선스 |
|---|---|---|
| 동아시아 해안선 좌표 (`frontend/src/modules/explore/coastline.js`) | Natural Earth 1:50m `ne_50m_land` — [naturalearthdata.com](https://www.naturalearthdata.com/) | **퍼블릭 도메인** — *"No permission is needed to use Natural Earth."* |
| 기상 실황·예보 데이터 | **기상청 API허브**(apihub.kma.go.kr) — 공공데이터포털(data.go.kr)과 별개 시스템 | 공공누리(KOGL) 마크 적용, **출처표시 의무 확인됨**(apihub.kma.go.kr/policy.do). 정확한 유형 번호(제1~4유형)는 같은 페이지 하단 마크로 직접 확인 요망 — 일반적으로 기상청 공공데이터는 제1유형(출처표시만 조건, 상업적 이용·변경 허용)이 통용되나 API허브 자체 페이지에서 최종 확인 필요 |
| 마스코트·아이콘 PNG 14종 + `guidebot.png`·`guidebot.mesh` (`frontend/public/`) | **팀이 생성형 AI 도구로 직접 제작**(1080² 캔버스 생성 → 내용 경계 크롭). 최초 12종은 2026-08-14 확인, `grass.png`·`wind.png` 2종은 8/18 같은 파이프라인으로 추가(개념 14종 : 그림 14종 1:1 매칭 완결) | AI 생성 자산 — 제3자 저작물 아님 |
| 3D 마스코트 (`design/mascot/weathermind-bot.glb`) | **팀이 생성형 AI 도구로 직접 제작** (2026-08-14 확인). `guidebot.png`는 `scripts/render_mascot_glb.py`, `guidebot.mesh`는 `scripts/bake_mascot_glb.py`가 이 파일에서 결정적으로 생성한 파생물 | AI 생성 자산 — 원본과 동일 |
| 문항 본문·해설 (`database/seed/`) | 프로젝트 팀 직접 저작 | 이 저장소의 MIT를 따름 |

`favicon.svg`는 저장소에서 직접 작성했습니다. 마스코트 PNG의 저장소 투입 기록은
`ae5ddd8`·`b3e0233`·`6579f8a`·`eaec357`(업로드 후 ASCII 개명·크롭)입니다.

저작권을 의식해 내린 설계 결정도 코드에 남아 있습니다: 위성 화면은 KMA 실사 영상
대신 **자체 도식**이며 「실사 아님」 표기를 계약으로 유지하고(`SatelliteView.jsx`),
일기도는 기상청 인포그래픽의 **문법을 절차적 SVG로 독립 재구현**한 것으로 원본
이미지를 복제·트레이싱하지 않았습니다(`mapInfographic.jsx`).

### 폰트

이 저장소는 **폰트 파일을 배포하지 않습니다.** `frontend/src/styles/index.css`가
`Pretendard Variable → Pretendard → 시스템 UI 폰트(-apple-system · Apple SD Gothic
Neo · Segoe UI · Noto Sans KR) → sans-serif` 순의 폴백 스택을 **이름으로만** 선언할
뿐이며, `@font-face`·웹폰트 CDN 링크·번들 폰트 파일(woff/woff2/ttf/otf)은 0개입니다.
폰트를 재배포하지 않으므로 폰트 라이선스 의무가 발생하지 않고, 미설치 환경에서는
OS 시스템 폰트로 폴백합니다.

### 주요 오픈소스 의존성

FastAPI · SQLAlchemy · Alembic · Pydantic (백엔드) · React · Vite · TailwindCSS ·
TanStack Query · Recharts (프론트) · LangChain (ai-worker) · Celery · PostgreSQL ·
Redis. 전체 목록과 각 버전은 `backend/requirements.txt` · `ai-worker/requirements.txt` ·
`celery/requirements.txt` · `frontend/package.json`이 소유합니다.

**라이선스 구성** (2026-08-14 실측): 프론트엔드 전이 의존성 285종은
MIT 247 · ISC 22 · Apache-2.0 4 · BSD-3-Clause 4 · MIT-0 2 · BSD-2-Clause 2 ·
CC-BY-4.0 1(`caniuse-lite` — 브라우저 지원 데이터셋, 코드 아님) · CC0-1.0 1 ·
BlueOak-1.0.0 1로 **GPL/AGPL/LGPL 계열 0건**입니다(권위 소스는
`frontend/package-lock.json`). 파이썬 의존성도 MIT · BSD-3-Clause · Apache-2.0
계열입니다 — 단 하나의 예외는 아래에 고지합니다.

> ⚠️ **LGPL 고지** — `celery/requirements.txt`의 `psycopg2-binary`(2.9.x)는
> **LGPL-3.0 with exceptions**입니다. 수정 없이 별도 컨테이너에서 동적 링크로
> 사용하므로 본 저장소 소스의 공개 의무는 발생하지 않습니다. 적용 범위는 celery
> 워커의 동기 DB 드라이버 1곳이며, backend는 `asyncpg`(Apache-2.0)를 사용합니다.
>
> Redis 이미지는 SSPL 전환 이전 버전인 `redis:7.2-alpine`(BSD-3-Clause)에
> 고정했습니다(`docker-compose.yml`).

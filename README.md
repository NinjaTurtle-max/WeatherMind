# WeatherMind

날씨 데이터 기반 기후 학습 서비스 — 오늘의 AI 퀴즈 · 기후 시뮬레이터 · 날씨 예측 리그.
R3~R5: 지도 기반 대기 보드 · 단계별 커리큘럼(유닛 트리·왕관 진도) · 구름 에너지(소모/회복 리텐션 루프).

상세 스펙은 `docs/specs/`(SSOT), 실행 계획·표준 결정사항은 `docs/DEVELOPMENT_PLAN.md` 참조.

## 아키텍처

| 서비스 | 포트 | 설명 |
|---|---|---|
| frontend | 80 | React 18 + Vite + Tailwind, nginx가 `/api/v1` → backend 프록시 |
| backend | 8000 | FastAPI + SQLAlchemy 2.0(async) + Alembic, JWT 인증, RLS |
| ai-worker | 8001 | LangChain 3체인(Router/QuizGen/피드백), Gemini, 내부 API(`X-Internal-API-Key`) |
| celery-worker / celery-beat | - | 날씨 수집, 주간 리그 정산, 일일 예보 대결 정산, WeatherBrain 재학습 |
| postgres | 5432(내부) | 스키마·RLS는 Alembic 마이그레이션이 소유 (init.sql은 EXTENSION만) |
| redis | 6379(내부) | 캐시 `weather:{date}:{region}`(1h) / `quiz:{date}:{level_group}`(24h) / `session:{user_id}`(7d) |

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

# (벡터 시드 적재 단계는 R13 3일차에 사라졌다 — ai-worker의 개념 문서는
#  ./database/seed 마운트로 직접 읽힌다. 근거: docs/specs/03 §3.1)

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

운영 절차(상태 확인·장애 대응·롤백·스모크 운영)는 `docs/team/RUNBOOK.md` 참조.
커밋 전 로컬 CI: `scripts/ci.sh` (lint → test → compose config → frontend build).
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

## API 개요 (`/api/v1`, 상세는 docs/specs/02_api_spec.md)

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

숫자를 인용할 때 **그 숫자가 무엇의 지표인지**까지 함께 적는다. 발표·대외 문안의
정본은 `docs/MENTORING_ALIGNMENT.md`이고, 아래는 그 요약이다.

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
  (완료 판정 범위 밖 — `docs/ROADMAP.md` §1)
- 실기동 통합 테스트 — 실제 KMA/Gemini API 키 발급 후 진행

## 라이선스와 출처

이 저장소의 **소스 코드**는 [MIT License](./LICENSE)를 따릅니다.

### 데이터·자산 출처

| 무엇 | 출처 | 라이선스 |
|---|---|---|
| 동아시아 해안선 좌표 (`frontend/src/modules/explore/coastline.js`) | Natural Earth 1:50m `ne_50m_land` — [naturalearthdata.com](https://www.naturalearthdata.com/) | **퍼블릭 도메인** — *"No permission is needed to use Natural Earth."* |
| 기상 실황·예보 데이터 | **기상청 API허브**(apihub.kma.go.kr) — 공공데이터포털(data.go.kr)과 별개 시스템 | 출처 표시: 「기상청 API허브」. 공공누리(KOGL) 적용 유형은 제출 전 확인 후 이 칸에 기재 |
| 마스코트·아이콘 PNG 12종 + `guidebot.png`·`guidebot.mesh` (`frontend/public/`) | **팀이 생성형 AI 도구로 직접 제작** (2026-08-14 확인) | AI 생성 자산 — 제3자 저작물 아님 |
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

# WeatherMind

날씨 데이터 기반 기후 학습 서비스 — 오늘의 AI 퀴즈 · 기후 시뮬레이터 · 날씨 예측 리그.
R3~R5: 지도 기반 대기 보드 · 단계별 커리큘럼(유닛 트리·왕관 진도) · 구름 에너지(소모/회복 리텐션 루프).

상세 스펙은 `docs/specs/`(SSOT), 실행 계획·표준 결정사항은 `docs/DEVELOPMENT_PLAN.md` 참조.

## 아키텍처

| 서비스 | 포트 | 설명 |
|---|---|---|
| frontend | 80 | React 18 + Vite + Tailwind, nginx가 `/api/v1` → backend 프록시 |
| backend | 8000 | FastAPI + SQLAlchemy 2.0(async) + Alembic, JWT 인증, RLS |
| ai-worker | 8001 | LangChain 3체인(Router/QuizGen/RAG), Gemini + Chroma, 내부 API(`X-Internal-API-Key`) |
| celery-worker / celery-beat | - | 일일 퀴즈 생성, 주간 리그 정산, 날씨 수집 |
| postgres | 5432(내부) | 스키마·RLS는 Alembic 마이그레이션이 소유 (init.sql은 EXTENSION만) |
| redis | 6379(내부) | 캐시 `weather:{date}:{region}`(1h) / `quiz:{date}:{level_group}`(24h) / `session:{user_id}`(7d) |
| chroma | 8002→8000 | 기후 개념 시드 18청크 벡터 저장소 |

## 로컬 실행 순서

```bash
# 1. 환경변수 준비
cp .env.example .env
# .env 열어서 KMA_API_KEY, GEMINI_API_KEY, EMBEDDING_API_KEY, JWT_SECRET_KEY,
# AI_WORKER_INTERNAL_API_KEY 채우기
openssl rand -hex 32   # JWT_SECRET_KEY / AI_WORKER_INTERNAL_API_KEY 생성용

# 2. 전체 기동
docker compose up -d --build

# 3. DB 마이그레이션 (backend 컨테이너 안에서)
docker compose exec backend alembic upgrade head

# 4. Chroma 시드 적재 (멱등 — 재실행해도 중복 없음)
docker compose exec ai-worker python -m app.embeddings.seed_concepts

# 5. 시드 적재 (전부 멱등 upsert — 권장 순서: content → units → badges)
docker compose exec backend python -m app.scripts.seed_content   # 문항 뱅크(세션 배합 1차 소스)
docker compose exec backend python -m app.scripts.seed_units     # 커리큘럼 유닛 트리
docker compose exec backend python -m app.scripts.seed_badges    # 뱃지 정의

# 6. 상태 확인
curl http://localhost:8000/health
curl http://localhost:8001/health

# 7. 프론트 접속
# http://localhost (nginx가 80포트 서빙)
```

운영 절차(상태 확인·장애 대응·롤백)는 `docs/team/RUNBOOK.md` 참조.
커밋 전 로컬 CI: `scripts/ci.sh` (lint → test → compose config → frontend build).

## 개발 중 개별 실행 (hot reload)

```bash
# 백엔드만
cd backend && uvicorn app.main:app --reload --port 8000

# 프론트만 (vite dev server가 /api/v1을 localhost:8000으로 프록시)
cd frontend && npm install && npm run dev   # 보통 5173포트
```

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
| Chroma 연결 실패 | 컨테이너 기동 순서 | depends_on + healthcheck 대기 |
| RLS로 데이터 안 보임 | SET app.current_user_id 누락 | get_db_with_rls 의존성 사용 확인 |
| Gemini 응답 JSON 파싱 실패 | 모델이 설명 텍스트 추가 | OutputFixingParser + 프롬프트에 "JSON만" 강조 |
| ai-worker 시드 파일 없음 | 볼륨 마운트 누락 | compose의 `./database/seed:/app/database/seed:ro` 확인 또는 `CLIMATE_CONCEPTS_PATH` 지정 |

## 이번 라운드 범위 밖 (로드맵)

- detective 모듈 (Phase 3) — 프론트 디렉토리만 유지, 라우트 미등록
- WeatherBrain IRT (로드맵 2단계) — 콜드스타트는 weak_tags 정답률 기반 Router로 동작
- 실기동 통합 테스트 — 실제 KMA/Gemini API 키 발급 후 진행

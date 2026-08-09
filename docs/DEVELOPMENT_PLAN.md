# WeatherMind 상세 개발 계획 (2026-07-05 수립)

> docs/specs/00~10 스펙 문서를 기반으로 수립한 실행 계획.
> 스펙 문서 간 / 기존 파일 간 불일치를 아래 "표준 결정사항"으로 통일한다.
> **docs/specs/ 가 단일 진실 공급원(SSOT)이며, 충돌 시 이 문서의 결정을 따른다.**

---

## 1. 표준 결정사항 (스펙 불일치 해소)

기존 루트 파일(docker-compose.yml, .env.example, database/init.sql)이 스펙과 어긋나는 부분은
**스펙(docs/specs) 기준으로 수정**한다.

| 항목 | 기존 파일 | 결정 (스펙 기준) |
|---|---|---|
| ai-worker 포트 | 8100 | **8001** (02, 05번 문서) |
| JWT env 변수 | JWT_SECRET | **JWT_SECRET_KEY / JWT_ALGORITHM / JWT_ACCESS_EXPIRE_MINUTES=30 / JWT_REFRESH_EXPIRE_DAYS=7** (05번) |
| DATABASE_URL | postgresql:// | **postgresql+asyncpg://** (05번) |
| ai-worker URL env | AI_WORKER_URL | **AI_WORKER_INTERNAL_URL + AI_WORKER_INTERNAL_API_KEY** (05번) |
| users.level_group | 'secondary' 포함 | **'elementary' / 'middle_high' / 'adult'** (01번) |
| users 마지막 로그인 | last_login_at TIMESTAMPTZ | **last_login_date DATE** (01번, 스트릭 계산용) |
| quiz_logs 문제 저장 | question TEXT + correct_answer | **question_json JSONB + question_type + user_answer/is_correct NULL 허용** (01번) |
| league_results | predicted_temp 단일값 | **predicted_value / actual_value JSONB + accuracy_score + elo_rating_after + week_start** (01번) |
| attendance 스냅샷 | streak_at_time | **streak_count_snapshot** (01번) |
| Celery 컨테이너 | worker+beat 한 컨테이너 | **celery-worker / celery-beat 분리** (05번) |
| 스키마 소유권 | init.sql이 전체 DDL | **Alembic 마이그레이션이 스키마+RLS 소유** (01번). init.sql은 EXTENSION 생성만 |

기타 표준:
- 임계값: Router Chain 분기 `accuracy_rate < 60` → focused
- concept_tag 표준 6종: `pressure_front, typhoon, air_mass, heat_island, co2_climate, anomaly` (09번)
- 패키지 버전: 10번 문서 고정 버전 그대로
- 내부 API 인증: `X-Internal-API-Key` 헤더로 AI_WORKER_INTERNAL_API_KEY 검증

---

## 2. 서비스 간 계약 (모든 파트 공통 준수)

### 2.1 backend → ai-worker 내부 API (포트 8001)
| Method | Path | 요청 | 응답 |
|---|---|---|---|
| POST | /internal/router-decide | `{user_id, weak_tags: [...], recent_results: [bool,...]}` | `{route, target_concept_tag}` |
| POST | /internal/rag-feedback | `{question_text, user_answer, is_correct, concept_tag, today_weather}` | `{feedback: str}` |
| POST | /internal/quiz-generate | `{weather_data, level_group, route, target_concept_tag}` | QuizQuestion JSON (03번 스키마) |
| GET | /health | - | `{status, service}` |

### 2.2 프론트 → backend
02번 문서의 4개 라우터 (`/api/v1/auth`, `/quiz`, `/progress`, `/league`) 전부.
에러 포맷 `{"detail": ..., "code": ...}`, Bearer JWT.

### 2.3 Redis 키
`weather:{date}:{region}`(1h) / `session:{user_id}`(7d) / `quiz:{date}:{level_group}`(24h)

---

## 3. 작업 분할 (서브에이전트 4개, 디렉토리 소유권 분리)

| 에이전트 | 소유 디렉토리/파일 | 산출물 |
|---|---|---|
| **A. Infra + Celery** | 루트(docker-compose.yml, .env.example, README.md), database/init.sql, celery/ | 표준 결정 반영한 compose·env, celery worker/beat 분리, 일일 퀴즈 생성·주간 리그 정산 태스크, celery Dockerfile |
| **B. Backend** | backend/ 전체 | SQLAlchemy 2.0 모델 5종, Alembic 초기 마이그레이션(RLS 포함), core(security/dependencies/config), 라우터 4종, services(weather_api, xp_service, league_service, ai_client), main.py, Dockerfile, requirements.txt |
| **C. AI Worker** | ai-worker/ 전체, database/seed/climate_concepts.json | FastAPI 내부 API 앱, 3체인(router/quiz_gen/rag), gemini_client, 개념 시드 데이터(직접 조회 — R13 3일차에 chroma_client·seed_concepts.py 철거), Dockerfile, requirements.txt |
| **D. Frontend** | frontend/ 전체 | Vite+React+Tailwind 셋업, Zustand 스토어 3종, 공통 컴포넌트 4종, quiz 모듈(완성도 최우선), simulator·league(축소판), 로그인, 라우팅+탭바, Dockerfile(nginx) |

**우선순위 (00번 문서)**: MVP는 "오늘의 퀴즈" 완성도 최우선. detective 모듈은 이번 라운드 제외(Phase 3 후순위).

## 4. 이번 라운드 범위 (Phase 1 + Phase 2 상당)

- [x] 스펙 분석·계획 수립
- [ ] A~D 병렬 구현
- [ ] 통합 검증: docker compose config, 계약 일치 점검(포트·env·스키마), 실행 가이드 README
- [ ] 남는 항목: 실제 API 키 발급(사용자), docker compose up 실기동 테스트, Phase 3 모듈(detective), WeatherBrain IRT(로드맵 2단계 — 콜드스타트 대응은 weak_tags 정답률로 동작)

## 5. 검증 체크리스트 (통합 후)

1. `docker compose config` 통과
2. backend: 모델↔마이그레이션↔init.sql 충돌 없음, 라우터가 02번 스펙 경로/스키마와 일치
3. ai-worker 내부 API가 2.1 계약과 일치, 프롬프트가 03번 문서 원문 그대로
4. frontend api 모듈의 경로가 02번과 일치, VITE_API_BASE_URL=/api/v1 (nginx 프록시)
5. XP/레벨/스트릭/ELO 공식이 07번 문서 숫자와 일치
6. KMA 파싱: "강수없음" 문자열 처리, (fcstDate,fcstTime) grouping 포함 (06번)

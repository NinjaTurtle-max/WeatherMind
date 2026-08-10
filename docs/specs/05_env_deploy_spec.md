# 환경변수 · 배포 설정 스펙

## .env.example (프로젝트 루트)

```bash
# ── PostgreSQL ──
POSTGRES_USER=weathermind
POSTGRES_PASSWORD=changeme
POSTGRES_DB=weathermind
DATABASE_URL=postgresql+asyncpg://weathermind:changeme@postgres:5432/weathermind

# ── Redis ──
REDIS_URL=redis://redis:6379/0

# ── JWT ──
JWT_SECRET_KEY=changeme-use-openssl-rand-hex-32
JWT_ALGORITHM=HS256
JWT_ACCESS_EXPIRE_MINUTES=30
JWT_REFRESH_EXPIRE_DAYS=7

# ── 기상청 API — 출처는 기상청 API허브(apihub.kma.go.kr). 상세는 docs/specs/06 ──
# ⚠️ 공공데이터포털(data.go.kr)의 serviceKey가 **아니다**. 잘못 넣으면 인증이 깨지는데
#    degraded 200으로 흡수돼 화면에 티가 안 난다 — 확인은 /health의 kma 필드로.
# 값의 단일 소유자는 `.env.example`이다. 여기 표는 형태만 보여준다.
KMA_API_KEY=발급받은_API허브_인증키
KMA_API_KEY_SPARE=발급받은_개인계정_인증키
KMA_VILAGE_FCST_URL=https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst
KMA_MID_LAND_FCST_URL=https://apihub.kma.go.kr/api/typ02/openApi/MidFcstInfoService/getMidLandFcst
# 일자료만 typ01(텍스트)이다 — openApi 쪽은 월보라 당월을 안 준다.
KMA_ASOS_DALY_URL=https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php

# ── AI 모델 ──
GEMINI_API_KEY=발급받은_키
GEMINI_MODEL=gemini-3.1-flash-lite
# (임베딩 키 없음 — R13 3일차에 벡터 검색 철거. docs/specs/03 §3.1)

# ── 내부 서비스 간 통신 ──
AI_WORKER_INTERNAL_URL=http://ai-worker:8001
AI_WORKER_INTERNAL_API_KEY=changeme-internal-secret

# ── 프론트엔드 (빌드 타임) ──
VITE_API_BASE_URL=/api/v1
```

---

## docker-compose.yml 서비스 정의 (뼈대)

```yaml
services:
  frontend:
    build: ./frontend
    ports: ["80:80"]
    depends_on: [backend]

  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: .env
    depends_on: [postgres, redis]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s

  ai-worker:
    build: ./ai-worker
    ports: ["8001:8001"]
    env_file: .env
    depends_on: [redis]

  celery-worker:
    build: ./celery
    command: celery -A celery_app worker --loglevel=info
    env_file: .env
    depends_on: [redis, postgres]

  celery-beat:
    build: ./celery
    command: celery -A celery_app beat --loglevel=info
    env_file: .env
    depends_on: [redis]

  postgres:
    image: postgres:16-alpine
    env_file: .env
    volumes: ["pgdata:/var/lib/postgresql/data", "./database/init.sql:/docker-entrypoint-initdb.d/init.sql"]

  redis:
    image: redis:7-alpine
    volumes: ["redisdata:/data"]

    ports: ["8002:8000"]

volumes:
  pgdata:
  redisdata:
```

---

## 헬스체크 엔드포인트 (실현가능성 심사 대응 — 필수 구현)

`backend/app/main.py`에 반드시 포함:
```python
@app.get("/health")
async def health():
    return {"status": "ok", "service": "weathermind-backend"}
```
발표 당일 URL 시연 전 이 엔드포인트로 전체 서비스 기동 상태 먼저 확인.

---

## 배포 체크리스트 (8.21 본선 당일)

```
[ ] docker compose up -d 전체 기동 확인
[ ] /health 엔드포인트 200 확인 (backend, ai-worker)
[ ] 클라우드 서버 공개 IP/도메인에 80포트 접근 확인
[ ] 기상청 API 키 유효기간 확인 (만료 시 즉시 갱신)
[ ] Gemini API 키 quota 확인
[ ] PostgreSQL 시드 데이터(climate_concepts 초기 임베딩) 적재 확인
[ ] 테스트 계정으로 퀴즈 1회 전체 플로우 리허설
```

---

## 바이브 코딩 지시사항

```
위 .env.example과 docker-compose.yml 뼈대를 기반으로 실제 파일을 생성해줘.
backend/app/main.py에 /health 엔드포인트와 CORS 미들웨어(프론트엔드 origin 허용)를 추가해줘.
각 서비스의 Dockerfile은 multi-stage build로 작성해줘
(frontend는 node:20-alpine builder + nginx:alpine, backend/ai-worker/celery는 python:3.12-slim).
```

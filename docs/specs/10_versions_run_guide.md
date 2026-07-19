# 패키지 버전 · 로컬 실행 가이드

> 버전을 안 박으면 최신 버전 충돌로 디버깅 지옥에 빠진다. MVP 기준 검증된 조합을 고정한다.
> (2026년 1월 기준 안정 버전 — 실제 설치 시 호환성 재확인 권장)

## backend/requirements.txt

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
sqlalchemy==2.0.*
asyncpg==0.30.*
alembic==1.14.*
pydantic==2.10.*
pydantic-settings==2.7.*
python-jose[cryptography]==3.3.*
passlib[bcrypt]==1.7.*
httpx==0.28.*
redis==5.2.*
python-multipart==0.0.*
```

## ai-worker/requirements.txt

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
langchain==0.3.*
langchain-google-genai==2.*
langchain-openai==0.2.*
chromadb==0.5.*
httpx==0.28.*
pydantic==2.10.*
```

> 주의: Gemini 3.1 Flash-Lite 지원 버전 확인 필요. langchain-google-genai 최신 버전 사용.
> 임베딩(text-embedding-3-small)은 langchain-openai 경유.

## celery/requirements.txt

```
celery[redis]==5.4.*
sqlalchemy==2.0.*
asyncpg==0.30.*
httpx==0.28.*
redis==5.2.*
```

## frontend/package.json 핵심 의존성

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",
    "zustand": "^5.0.0",
    "@tanstack/react-query": "^5.62.0",
    "axios": "^1.7.0",
    "recharts": "^2.15.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

---

## 로컬 실행 순서

```bash
# 1. 환경변수 준비
cp .env.example .env
# .env 열어서 KMA_API_KEY, GEMINI_API_KEY, JWT_SECRET_KEY 채우기
openssl rand -hex 32   # JWT_SECRET_KEY 생성용

# 2. 전체 기동
docker compose up -d --build

# 3. DB 마이그레이션 (backend 컨테이너 안에서)
docker compose exec backend alembic upgrade head

# 4. Chroma 시드 적재
docker compose exec ai-worker python -m app.embeddings.seed_concepts

# 5. 상태 확인
curl http://localhost:8000/health
curl http://localhost:8001/health

# 6. 프론트 접속
# http://localhost (nginx가 80포트 서빙)
```

## 개발 중 개별 실행 (hot reload)

```bash
# 백엔드만
cd backend && uvicorn app.main:app --reload --port 8000

# 프론트만
cd frontend && npm run dev   # vite dev server, 보통 5173포트
```

## 자주 겪는 문제 (트러블슈팅)

| 증상 | 원인 | 해결 |
|---|---|---|
| CORS 에러 | 프론트 origin 미허용 | backend main.py CORSMiddleware에 origin 추가 |
| KMA "SERVICE_KEY_IS_NOT_REGISTERED" | 키 인코딩 이중 처리 | serviceKey 재인코딩 하지 말 것 |
| Chroma 연결 실패 | 컨테이너 기동 순서 | depends_on + healthcheck 대기 |
| RLS로 데이터 안 보임 | SET app.current_user_id 누락 | get_db_with_rls 의존성 사용 확인 |
| Gemini 응답 JSON 파싱 실패 | 모델이 설명 텍스트 추가 | OutputFixingParser + 프롬프트에 "JSON만" 강조 |

---

## 바이브 코딩 지시사항

```
위 버전으로 backend/requirements.txt, ai-worker/requirements.txt,
celery/requirements.txt, frontend/package.json을 생성해줘.
frontend는 vite + react + tailwind 초기 설정(vite.config.js, tailwind.config.js,
postcss.config.js, index.html, src/main.jsx)도 함께 만들어줘.
README.md에 위 "로컬 실행 순서"를 정리해서 넣어줘.
```

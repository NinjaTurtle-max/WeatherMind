# WeatherMind 운영 런북 (RUNBOOK)

> 운영 절차의 SSOT. 로컬 실행 요약·아키텍처 표는 README.md, 배포 체크리스트는
> docs/specs/05_env_deploy_spec.md 참조 — 이 문서는 기동 순서·상태 확인·장애
> 대응·롤백만 다룬다. (스프린트 R2-01 S10 산출물, DevOps 소유)

## 1. 최초 기동 순서

```bash
# 0. 환경변수 — README "로컬 실행 순서" 1번과 동일 (.env 준비)
# 1. 전체 기동
docker compose up -d --build

# 2. DB 마이그레이션 (0001 초기 스키마 + 0002 세션·문항 뱅크)
docker compose exec backend alembic upgrade head

# 3. Chroma 기후 개념 시드 (멱등)
docker compose exec ai-worker python -m app.embeddings.seed_concepts

# 4. 문항 뱅크 시드 적재 (멱등 upsert — 재실행 안전)
docker compose exec backend python -m app.scripts.seed_content
#    compose가 ./database/seed 를 backend 컨테이너의 /database/seed(ro)로
#    마운트한다 — 스크립트의 컨테이너 내 기본 경로. 뱅크가 비면 세션이
#    전부 quiz-generate 폴백으로 발급되므로(ai-worker 의존↑) 반드시 적재.

# 5. 상태 확인 — §2
```

## 2. 상태 확인 (R2 신규 구성 요소 포함)

### 2.1 기본

```bash
curl -s http://localhost:8000/health        # backend
curl -s http://localhost:8001/health        # ai-worker
docker compose exec backend alembic current # → 0002_session_bank (head)
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT status, count(*) FROM content_items GROUP BY 1;"  # 뱅크 적재 확인
```

### 2.2 세션 API (§3.1)

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"..."}' | jq -r .access_token)
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN"
# 기대: session_id + items 5건(source: bank|generated). 재호출 시 동일
# session_id(당일 멱등). 뱅크 0건이어도 발급은 성공해야 한다(S2 AC).
```

### 2.3 품질 게이트 (ai-worker /internal/quiz-validate, §3.4)

```bash
curl -s -X POST http://localhost:8001/internal/quiz-validate \
  -H "X-Internal-API-Key: $AI_WORKER_INTERNAL_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"question":{"question_text":"태풍의 눈에서는 날씨가 어떠한가?","options":["맑고 고요하다","폭우가 내린다","강풍이 분다","우박이 내린다"],"correct_answer":"맑고 고요하다"},"concept_tag":"typhoon","level_group":"adult"}'
# 기대: {"passed": true, "checks": [...]}.
# GEMINI_API_KEY 부재 시 checks에 "llm_skipped" 포함 — 1단 휴리스틱만으로 정상.
```

### 2.4 레이트리밋 (§3.6)

```bash
for i in $(seq 6); do curl -s -o /dev/null -w '%{http_code} ' \
  -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"x"}'; done
# 기대: 5회 이후 429 + {"detail": ..., "code": "RATE_LIMITED"}.
# 카운터는 backend 프로세스 메모리 — 컨테이너 재시작으로 리셋된다.
```

### 2.5 Redis weather 캐시

```bash
docker compose exec redis redis-cli --scan --pattern 'weather:*'
# celery-beat의 날씨 수집이 weather:{date}:{region}(TTL 1h)을 채운다.
```

## 3. 장애 대응

### 3.1 ai-worker 다운

- **증상**: `/api/v1/quiz/today` 503 `AI_WORKER_UNAVAILABLE`. 세션 발급은 아래 폴백.
- **설계된 폴백(§3.2)**: 세션은 뱅크(content_items active)가 5문항을 채우면
  ai-worker 없이도 발급된다. 뱅크 부족분만 quiz-generate 병렬 폴백 —
  일부 실패는 성공분으로 세션을 구성하고(부분 세션 가능, R3 검토 항목),
  **전부** 실패할 때만 503. 즉 시드 적재(§1-4)가 1차 방어선이다.
- **조치**: `docker compose logs --tail 100 ai-worker` → 원인 확인 →
  `docker compose restart ai-worker`. 뱅크 커버리지가 얇으면 시드 재적재.

### 3.2 Redis weather 캐시 공백 (live 문항)

- **설계된 폴백**: backend는 캐시 miss 시 KMA를 직접 호출해 재캐시한다.
  live 문항의 슬롯 치환은 **세션 최초 발급 시점에 확정 저장**되므로(§3.2
  PM 결정 — 채점 일관성) 하루 중 실황 변동·캐시 만료의 영향을 받지 않는다.
  슬롯 값을 끝내 못 구하면 해당 문항은 quiz-generate 폴백으로 대체되어
  미치환 원문(`{today.*}`)이 사용자에게 노출되지 않는다.
- **조치**: `docker compose logs celery-worker | grep weather`로 수집 태스크
  확인, §2.5로 키 존재 확인, KMA 키 유효기간 점검(만료 시 갱신).

### 3.3 레이트리밋 오동작 (전 유저 일괄 429)

- IP 키는 nginx가 전달하는 X-Forwarded-For 1홉을 신뢰한다(웨이브 1 리뷰 2번).
  프록시 계층을 바꾸면 XFF 전달을 유지해야 전역 버킷화가 재발하지 않는다.
- 임시 해제: 카운터가 프로세스 메모리이므로 `docker compose restart backend`.

## 4. 롤백 절차

코드가 0002 스키마(sessions·content_items)를 참조하므로 **코드 롤백을 먼저**,
DB 다운그레이드는 그 후에 한다.

```bash
# 1. 코드 롤백 — 커밋은 웨이브 단위 (예: R2-01 웨이브1 = 675765e)
git revert <커밋 SHA>
docker compose up -d --build

# 2. DB 롤백 (0002 → 0001)
docker compose exec backend alembic downgrade -1
# 주의: content_items·sessions 테이블 드롭, quiz_logs.session_id/content_item_id·
# users.streak_freeze_count 컬럼 제거 — 세션·뱅크 데이터가 소실된다.
```

## 5. 로컬 CI

커밋 전 `scripts/ci.sh` 실행 — lint(pyflakes) → test(backend·ai-worker pytest)
→ config(docker compose config -q) → frontend build(선택). 단계별 요약을
출력하고 하나라도 실패하면 비0 종료한다. 단계 단위 실행: `scripts/ci.sh test`.

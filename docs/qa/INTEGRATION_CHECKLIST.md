# 통합 체크리스트 — 스프린트 R2-01 실기동 검증 (S9)

> 대상: docker compose 실기동 환경. 단위 테스트(backend 145 / ai-worker 11, DB 불필요)가
> 커버하지 못하는 **실제 배선**(마이그레이션·시드 적재·라우터+DB+Redis 전 구간·RLS·
> 레이트리밋 실동작)을 사람이/스크립트가 확인한다.
> 각 항목: 실행 명령 → 기대 결과. 실패 시 P 분류해 TEST_PLAN.md 결함 목록에 기록.

## 0. 사전 조건

```bash
cd <repo-root>
cp .env.example .env   # 이미 있으면 생략. KMA/GEMINI 키 없어도 폴백 경로로 검증 가능
docker compose up -d --build
docker compose ps
curl -s http://localhost:8000/health
curl -s http://localhost:8001/health
```
- [ ] 기대: 8개 서비스(frontend·backend·ai-worker·celery-worker·celery-beat·postgres·redis·chroma) Up, 두 /health 모두 200.
- 포트: frontend :80 / backend :8000 / ai-worker :8001 / chroma :8002.

## 1. 마이그레이션 0002 적용

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
docker compose exec postgres psql -U weathermind -d weathermind -c "\d sessions" -c "\d content_items"
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='streak_freeze_count';" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='quiz_logs' AND column_name IN ('session_id','content_item_id');"
```
- [ ] 기대: `alembic current`가 0002(20260719_0002_session_bank), head 표시.
- [ ] 기대: `sessions`(UNIQUE(user_id, session_date, mode) + RLS policy `user_isolation`), `content_items` 존재.
- [ ] 기대: `users.streak_freeze_count`, `quiz_logs.session_id`, `quiz_logs.content_item_id` 존재.

## 2. 시드 적재 (26건 + 멱등)

```bash
docker compose exec backend python -m app.scripts.seed_content
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT status, count(*) FROM content_items GROUP BY status;" \
  -c "SELECT count(*) FROM content_items WHERE uses_live_slots;"
# 멱등 재실행
docker compose exec backend python -m app.scripts.seed_content
```
- [ ] 기대(1차): `삽입 26 / 갱신 0 / 스킵 0 (총 26건)`.
- [ ] 기대(DB): active 26건, uses_live_slots 6건.
- [ ] 기대(재실행): `삽입 0 / 갱신 26 / 스킵 0` — 중복 행 없음.

## 3. 세션 전 구간: 발급 → 5문항 제출 → complete

토큰 준비 (유저 A):

```bash
TOKEN_A=$(curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-a-'$(date +%s)'@test.io","password":"password123","nickname":"qa-a","level_group":"middle_high"}' \
  | jq -r .access_token)
```

### 3.1 발급 + 멱등

```bash
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_A" | tee /tmp/sess.json | jq '{session_id, mode, n: (.items|length), progress}'
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_A" | jq .session_id
```
- [ ] 기대: mode=daily, items 5건(각 항목에 `source`("bank"|"generated")·`slot_filled` 포함), progress {answered:0,total:5}.
- [ ] 기대: 재호출 시 **동일 session_id** (멱등).
- [ ] 기대(§3.2): 같은 question_type 3연속 없음, slot_filled=true 문항의 question_text에 `{today.` 원문 잔존 없음.
- [ ] 기대(DB): `SELECT recipe_json IS NOT NULL, route_decision IS NOT NULL FROM sessions;` 모두 t (recipe·route 저장 — 1라운드 부채 상환).

### 3.2 미완료 complete 가드

```bash
SID=$(jq -r .session_id /tmp/sess.json)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/v1/session/$SID/complete -H "Authorization: Bearer $TOKEN_A"
curl -s -X POST http://localhost:8000/api/v1/session/$SID/complete -H "Authorization: Bearer $TOKEN_A" | jq .code
```
- [ ] 기대: 409 + `"SESSION_NOT_COMPLETED"`.

### 3.3 5문항 제출 + 재제출 가드

```bash
for QID in $(jq -r '.items[].quiz_id' /tmp/sess.json); do
  curl -s -X POST http://localhost:8000/api/v1/session/$SID/answer \
    -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
    -d '{"quiz_id":"'$QID'","answer":"확인용 오답","elapsed_sec":10}' \
    | jq '{is_correct, xp_earned, session_progress}'
done
# 마지막 문항 재제출
curl -s -X POST http://localhost:8000/api/v1/session/$SID/answer \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"quiz_id":"'$QID'","answer":"확인용 오답"}' | jq .code
```
- [ ] 기대: 각 응답에 AnswerResult(is_correct·correct_answer·feedback·xp_earned) + session_progress가 1/5→5/5 단조 증가.
- [ ] 기대: 재제출 409 + `"ALREADY_ANSWERED"`, 재제출 후 progress·xp 변동 없음.

### 3.4 complete + XP 정합

```bash
curl -s -X POST http://localhost:8000/api/v1/session/$SID/complete -H "Authorization: Bearer $TOKEN_A" | jq .
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT s.xp_total, (SELECT count(*) FROM quiz_logs q WHERE q.session_id=s.id AND q.is_correct IS NOT NULL) answered FROM sessions s WHERE s.id='$SID';"
```
- [ ] 기대: 200 + {xp_total, correct_count, total:5, streak_count}. **xp_total = 5문항 xp_earned 합계** (전부 오답이면 10).
- [ ] 기대: complete 재호출도 200에 동일 값 (completed_at 유지).
- [ ] 기대(하위 호환): `GET /api/v1/quiz/today`·`POST /api/v1/quiz/{quiz_id}/answer` 기존 경로 여전히 동작.

## 4. 스트릭 프리즈 소모 시나리오 (§3.5)

전제: 유저 A의 상태를 SQL로 조작해 시간 경과를 시뮬레이션한다.

```bash
# (a) 하루 결손 + 프리즈 보유 → 소모·유지
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET last_login_date=CURRENT_DATE-2, streak_count=5, streak_freeze_count=1 WHERE nickname='qa-a';"
curl -s -X POST http://localhost:8000/api/v1/progress/attendance -H "Authorization: Bearer $TOKEN_A" | jq .
curl -s http://localhost:8000/api/v1/progress/me -H "Authorization: Bearer $TOKEN_A" | jq '{streak_count, streak_freeze_count}'
```
- [ ] 기대: streak_count=6 (리셋 아님), streak_freeze_count=0 (1 소모). `/progress/me`에 streak_freeze_count 필드 존재.

```bash
# (b) 7일 마일스톤 → 프리즈 +1 지급
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET last_login_date=CURRENT_DATE-1, streak_count=6, streak_freeze_count=0 WHERE nickname='qa-a';"
curl -s -X POST http://localhost:8000/api/v1/progress/attendance -H "Authorization: Bearer $TOKEN_A" | jq .streak_count
curl -s http://localhost:8000/api/v1/progress/me -H "Authorization: Bearer $TOKEN_A" | jq .streak_freeze_count
```
- [ ] 기대: streak_count=7, streak_freeze_count=1 (지급). XP에 +50(스트릭 7일 보너스)+5(출석) 반영.

```bash
# (c) 사흘 결손 → 프리즈 있어도 리셋
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET last_login_date=CURRENT_DATE-3, streak_count=9, streak_freeze_count=2 WHERE nickname='qa-a';"
curl -s -X POST http://localhost:8000/api/v1/progress/attendance -H "Authorization: Bearer $TOKEN_A" | jq .streak_count
```
- [ ] 기대: streak_count=1 (리셋), streak_freeze_count=2 (미소모 — 사흘 이상은 방어 불가).

## 5. 레이트리밋 429 (§3.6)

```bash
# auth 5회/분/IP → 6번째 429
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"nobody@test.io","password":"wrongpass1"}'; done; echo
# session/today 10회/분/유저 → 11번째 429
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_A"; done; echo
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_A" | jq .code
```
- [ ] 기대: login 6번째부터 429, session/today 11번째부터 429.
- [ ] 기대: 429 본문 = `{"detail": "...", "code": "RATE_LIMITED"}`.
- [ ] 기대(리뷰 2번 회귀): `X-Forwarded-For`를 바꿔 보내면 IP 버킷이 분리된다
      (`curl -H 'X-Forwarded-For: 10.0.0.9' ...` 로 auth 한도 초기화 확인 — 전역 버킷화 재발 방지).
- 1분 대기 후 다음 섹션 진행 (한도 리셋).

## 6. 품질 게이트 API (§3.4)

```bash
KEY=$(grep AI_WORKER_INTERNAL_API_KEY .env | cut -d= -f2)
# 정상 문항
curl -s -X POST http://localhost:8001/internal/quiz-validate \
  -H "X-Internal-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"question":{"question_type":"multiple_choice","question_text":"태풍의 주요 에너지원은 무엇일까요?","options":["수증기 응결열","지열","조력","풍력"],"correct_answer":"수증기 응결열"},"concept_tag":"typhoon","level_group":"middle_high"}' | jq '{passed, names:[.checks[].name]}'
# 결함 문항 (정답이 보기에 없음)
curl -s -X POST http://localhost:8001/internal/quiz-validate \
  -H "X-Internal-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"question":{"question_type":"multiple_choice","question_text":"태풍의 주요 에너지원은 무엇일까요?","options":["지열","조력","풍력","마찰열"],"correct_answer":"수증기 응결열"},"concept_tag":"typhoon","level_group":"middle_high"}' | jq '{passed, failed:[.checks[]|select(.passed|not).name]}'
# 인증 가드
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8001/internal/quiz-validate -d '{}'
```
- [ ] 기대: 정상 문항 passed=true, checks에 휴리스틱 6종 + (GEMINI 키 부재 시) `llm_skipped`.
- [ ] 기대: 결함 문항 passed=false, failed에 `answer_in_options`.
- [ ] 기대: 키 없는 호출 401.

## 7. RLS 격리 — 다른 유저의 세션 접근 404

```bash
TOKEN_B=$(curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-b-'$(date +%s)'@test.io","password":"password123","nickname":"qa-b","level_group":"adult"}' \
  | jq -r .access_token)
# 유저 B가 유저 A의 세션에 접근
curl -s -X POST http://localhost:8000/api/v1/session/$SID/answer \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"quiz_id":"whatever","answer":"x"}' | jq '{code}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/v1/session/$SID/complete -H "Authorization: Bearer $TOKEN_B"
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_B" | jq .session_id
```
- [ ] 기대: answer·complete 모두 404 + `"SESSION_NOT_FOUND"` (403이 아님 — 존재 자체 미노출).
- [ ] 기대: B의 /today는 **A와 다른 session_id**로 신규 발급.
- [ ] 기대(DB 레벨): `SET ROLE`+`app.current_user_id` 기반 조회 시 타 유저 행 0건
      (0001 user_isolation 패턴 — 필요 시 psql로 `SET app.current_user_id='<B_id>'; SELECT count(*) FROM sessions;`).

## 8. 정리

```bash
docker compose down          # 데이터 유지
# docker compose down -v     # 볼륨까지 초기화 (재검증 시)
```

---

### 기록 규칙
- 각 체크박스는 확인자·일시·결과(P/F)를 남긴다. 실패 항목은 TEST_PLAN.md §3 결함 목록에
  P0~P3로 등재하고 재현 명령을 첨부한다.
- 이 문서는 스프린트 산출물로 누적한다 (TEAM_PROCESS.md §2.4).

# 통합 체크리스트 — 스프린트 R2-01 실기동 검증 (S9)

> 대상: docker compose 실기동 환경. 단위 테스트(backend 145 / ai-worker 11, DB 불필요)가
> 커버하지 못하는 **실제 배선**(마이그레이션·시드 적재·라우터+DB+Redis 전 구간·RLS·
> 레이트리밋 실동작)을 사람이/스크립트가 확인한다.
> 각 항목: 실행 명령 → 기대 결과. 실패 시 P 분류해 TEST_PLAN.md 결함 목록에 기록.
>
> **R7부터 이 문서의 curl/psql 항목 대부분은 자동 스모크(`scripts/smoke.sh`,
> 1~9단계 — 기동·마이그레이션·시드·RLS·θ 왕복·배치고사)가 대체한다.**
> 수기로 남는 것은 **UI 확인**(브라우저 실사용 흐름)뿐이다 — PART C 참조.
> 스모크 운영 절차는 docs/team/RUNBOOK.md §6.

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

---

# PART B — R3~R5 실기동 시나리오 (통합 웨이브 2)

> R2(§1~§7)에 이어 대기 보드 퍼즐(R3)·보상 루프(R4)·커리큘럼·구름 에너지(R5)를
> 실기동으로 검증한다. 자동화(backend 404 / ai-worker 53)가 못 잡는 **배선**만 다룬다:
> 마이그레이션 0003~0005 순차 적용·신규 시드 적재·구름 소모/회복 원자성·대결 정산 크론·
> 잠금 해제 흐름. §3의 TOKEN_A/SID 준비를 재사용한다.

## 9. 마이그레이션 0003~0005 순차 적용

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current   # 0005_curriculum_energy = head
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT conname FROM pg_constraint WHERE conname LIKE '%question_type%';" \
  -c "\d quests" -c "\d user_quest_progress" -c "\d badges" -c "\d user_badges" \
  -c "\d duels" -c "\d league_results" \
  -c "\d units" -c "\d user_unit_progress" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('clouds','clouds_updated_at');"
```
- [ ] 기대(0003): question_type CHECK가 7종('multiple_choice','short_answer','slider','board','match','ordering','cloze').
- [ ] 기대(0004): `quests`(3행 정적 시드), `user_quest_progress`·`badges`·`user_badges`·`duels` 존재, `league_results.tier` 컬럼 존재. RLS policy `user_isolation`이 user_quest_progress·user_badges·duels에 존재.
- [ ] 기대(0005): `units`(slug UNIQUE)·`user_unit_progress` 존재, `users.clouds`(DEFAULT 5)·`users.clouds_updated_at` 존재.
- [ ] 기대(롤백 가능): `alembic downgrade 0002 && alembic upgrade head` 무오류(마이그레이션 가역성).

## 10. 신규 시드 적재 (content 47 · units 12 · badges 5 + 멱등)

```bash
docker compose exec backend python -m app.scripts.seed_content   # content_items 47
docker compose exec backend python -m app.scripts.seed_units     # units 12 (slug 2-pass)
docker compose exec backend python -m app.scripts.seed_badges    # badges 5
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT count(*) FROM content_items;" \
  -c "SELECT question_type, count(*) FROM content_items GROUP BY question_type;" \
  -c "SELECT count(*) FROM units;" \
  -c "SELECT count(*) FROM units WHERE prereq_unit_id IS NOT NULL;" \
  -c "SELECT count(*) FROM badges;"
# 멱등 재실행
docker compose exec backend python -m app.scripts.seed_units
```
- [ ] 기대: content_items 47건(board/match/ordering/cloze 신규 유형 포함), units 12건, badges 5건.
- [ ] 기대(핵심 — 잠금 체인 생존): `units WHERE prereq_unit_id IS NOT NULL` = **11건**. 0건이면 R5 slug↔자연키 결함 재발(모든 유닛 무잠금) — **P0**.
- [ ] 기대(멱등): units 재적재 시 행 수 불변·slug 중복 없음.
- [ ] board_rules.json은 파일 캐시(적재 아님) — `GET /api/v1/board/rules`가 8종 반환(§13).

## 11. 대기 보드 — 세션 내 board 문항 + 단독 연습

```bash
# 세션에 board 문항이 있으면 template_json이 노출되는지 (R3 리뷰 결함 회귀)
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN_A" \
  | jq '.items[] | select(.question_type=="board") | {question_type, has_tmpl: (.template_json!=null), has_goal: (.template_json.goal_conditions!=null)}'
# 단독 연습: 퍼즐 목록 → 시도(권위 채점) → 최초 클리어 +5 XP
curl -s http://localhost:8000/api/v1/board/puzzles -H "Authorization: Bearer $TOKEN_A" | jq '.[0] | {content_item_id, cleared}'
PID=$(curl -s http://localhost:8000/api/v1/board/puzzles -H "Authorization: Bearer $TOKEN_A" | jq -r '.[0].content_item_id')
# 오답 board_state (목표 미달) → passed=false, 0 XP
curl -s -X POST http://localhost:8000/api/v1/board/puzzles/$PID/attempt \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"board_state":{"elements":[]}}' | jq '{passed, xp_earned, code}'
```
- [ ] 기대(R3 리뷰 회귀): 세션 board 문항에 `template_json`(mode·initial_state·palette·goal_conditions·hints) 노출, 정답 필드는 부재.
- [ ] 기대(권위 채점 §3.4): 서버가 board_state를 board_rules로 재판정 → `passed`·`phenomena`(존 4개) 반환. 클라이언트 신고 무시.
- [ ] 기대(최초 클리어): 정답 board_state 제출 시 passed=true·xp_earned=5, **재시도는 xp_earned=0**. quiz_logs에 `board-{...}` quiz_id 기록(session_id NULL).
- [ ] 기대(누락 가드): board 문항에 board_state 없이 answer 제출 → 422 `BOARD_STATE_REQUIRED`.

## 12. 커리큘럼 — 유닛 트리·선행 잠금 해제

```bash
curl -s http://localhost:8000/api/v1/curriculum -H "Authorization: Bearer $TOKEN_A" \
  | jq '[.[].units[] | {id, locked}] | {total: length, unlocked: (map(select(.locked==false))|length)}'
ROOT=read-sky-pressure
# 잠긴 유닛 세션 발급 시도 → 403
LOCKED=$(curl -s http://localhost:8000/api/v1/curriculum -H "Authorization: Bearer $TOKEN_A" | jq -r '[.[].units[] | select(.locked)][0].id')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/v1/curriculum/units/$LOCKED/session -H "Authorization: Bearer $TOKEN_A"
# 루트 유닛 세션 발급 → 200, 클리어(전 문항 정답) → crowns+1·+20 XP·다음 유닛 해제
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/v1/curriculum/units/$ROOT/session -H "Authorization: Bearer $TOKEN_A"
```
- [ ] 기대(초기): 12유닛 중 **루트 1개만 unlocked**(read-sky-pressure), 11개 locked.
- [ ] 기대(잠금 가드): 잠긴 유닛 세션 발급 403 `UNIT_LOCKED`, 없는 유닛 404 `UNIT_NOT_FOUND`.
- [ ] 기대(진도): 루트 유닛 완주(전 문항 정답) → crowns 1·cleared_at 기록·+20 XP(1회), 직후 유닛(read-sky-fronts) 잠금 해제. 재완주 시 XP 0.
- [ ] 기대(체류 유도): 완료 응답이 다음 유닛을 즉시 노출.

## 13. 구름 에너지 — 소모·회복·플래그

```bash
curl -s http://localhost:8000/api/v1/progress/energy -H "Authorization: Bearer $TOKEN_A" | jq .
# 구름 5개 → 문항 제출로 소모, 0에서 429
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET clouds=1, clouds_updated_at=now() WHERE nickname='qa-a';"
# 1개 소모하는 제출 성공 후, 다음 제출은 429
curl -s http://localhost:8000/api/v1/progress/energy -H "Authorization: Bearer $TOKEN_A" | jq '{clouds, next_regen_sec}'
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET clouds=0, clouds_updated_at=now() WHERE nickname='qa-a';"
# board attempt/세션 answer가 429 OUT_OF_CLOUDS 반환(회복 ETA 포함)
curl -s -X POST http://localhost:8000/api/v1/board/puzzles/$PID/attempt \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"board_state":{"elements":[]}}' | jq '{code, next_regen_sec}'
# 20분 경과 시뮬레이션 → 1개 회복
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "UPDATE users SET clouds=0, clouds_updated_at=now()-interval '21 minutes' WHERE nickname='qa-a';"
curl -s http://localhost:8000/api/v1/progress/energy -H "Authorization: Bearer $TOKEN_A" | jq .clouds
```
- [ ] 기대(상수): max=5, 소진 시 `OUT_OF_CLOUDS`(429) + `next_regen_sec`. `/progress/me`에 clouds·next_regen_sec 포함.
- [ ] 기대(지연 회복): clouds_updated_at을 21분 전으로 조작 후 조회 시 clouds=1(elapsed//20). 읽기 시점 계산(크론 불필요).
- [ ] 기대(원자성): 동시 2회 소모 시 이중 차감 없음(원자 UPDATE). 재제출(멱등 가드 히트)은 미소모.
- [ ] 기대(독립성): clouds와 streak_freeze_count(구름 방패)는 별개 자원 — 프리즈 소모가 clouds에 영향 없음.
- [ ] 기대(플래그): `.env`에 `ENERGY_ENABLED=false` 후 재기동 시 소진 상태에서도 429 없이 무제한 제출(기존 동작).

## 14. 예보 대결 — 제출·AI 예측·정산

```bash
# 오늘 대결 상태(제출 전 AI 예측 비공개)
curl -s http://localhost:8000/api/v1/duel/today -H "Authorization: Bearer $TOKEN_A" | jq .
# 제출(1일 1회) → AI 예측 공개, 재제출 409
curl -s -X POST http://localhost:8000/api/v1/duel/today \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"temp_max":29.0,"rain_prob":40}' | jq '{user_pred, ai_pred}'
curl -s -X POST http://localhost:8000/api/v1/duel/today \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"temp_max":29.0,"rain_prob":40}' | jq .code
# 잘못된 예측값 → 422 INVALID_PREDICTION
curl -s -X POST http://localhost:8000/api/v1/duel/today \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"temp_max":999,"rain_prob":40}' | jq .code
# 정산: 어제 대결에 실측 기록 후 크론(또는 수동 실행) → result·+15 XP
docker compose exec celery-worker celery -A app.celery_app call app.tasks.league.settle_daily_duel
```
- [ ] 기대(결정성): 같은 유저·같은 날 AI 예측이 재현 가능(해시 시드 노이즈, 온도 ±2.0·강수 ±15 범위). LLM 키 불필요.
- [ ] 기대(1일 1회): 재제출 409 `ALREADY_SUBMITTED`, 범위 밖 값 422 `INVALID_PREDICTION`.
- [ ] 기대(정산): 어제 duels에 실측 기록·점수 비교로 result('win'|'lose'|'draw'), 승리 시 +15 XP. 무실측 시 재시도(리그 패턴). beat에 04:00 크론 등록(리그 03:30 이후).

## 15. 퀘스트·배지·리그 티어

```bash
curl -s http://localhost:8000/api/v1/progress/quests -H "Authorization: Bearer $TOKEN_A" | jq .
curl -s http://localhost:8000/api/v1/progress/badges -H "Authorization: Bearer $TOKEN_A" | jq .
# 퀘스트 멱등: 세션 complete/board 성공 후 재계산이 이벤트 카운터가 아니라 당일 집계
curl -s http://localhost:8000/api/v1/progress/quests -H "Authorization: Bearer $TOKEN_A" | jq '.[] | {code, progress, target, done}'
# 무오답 세션 → perfect_session 배지
# 티어: 주간 리그 정산이 elo로 tier 산정
docker compose exec celery-worker celery -A app.celery_app call app.tasks.league.settle_weekly_league
curl -s http://localhost:8000/api/v1/progress/me -H "Authorization: Bearer $TOKEN_A" | jq '{tier, clouds}'
curl -s http://localhost:8000/api/v1/league/leaderboard -H "Authorization: Bearer $TOKEN_A" | jq '.[0] | {tier}'
```
- [ ] 기대(퀘스트 3종): daily_xp_30·weak_correct_1·live_answered가 당일 quiz_logs·XP 집계로 재계산(멱등). 완료 전환 시 xp_reward 1회 지급.
- [ ] 기대(배지 5종): streak_7/30/100(출석 마일스톤)·perfect_session(5/5 정답)·tier_promoted(정산 승급). 중복 지급 없음(UNIQUE).
- [ ] 기대(티어): 정산이 elo_rating_after로 tier 산정(stratus<1100≤cumulus<1250≤nimbostratus<1400≤cumulonimbus<1550≤typhoon_eye). `/progress/me`·리더보드에 tier 포함(무정산 시 stratus).

## 16. 정리

```bash
docker compose down          # 데이터 유지
# docker compose down -v     # 볼륨까지 초기화 (재검증 시)
```

---

# PART C — R7 배치고사 온보딩 (UI 수기 확인)

> API·DB 경로(start 200/6문항·구름 미소모·초기 θ 배정·409·placement_done)는
> 자동 스모크 9단계가 검증한다. 아래는 **브라우저에서만 확인 가능한 흐름**만 남긴다.
> 전제: `docker compose up -d --build` 후 http://localhost 접속.

## 17. 가입 → 배치고사 → θ 결과 화면

- [ ] 이메일 가입 직후 배치고사 화면(PlacementPage)으로 자동 진입한다
      (게스트 로그인은 진입하지 않음).
- [ ] 6문항이 순차 표시되고, 전부 풀면 결과 화면(PlacementSummary)에
      개념별 θ 막대와 레벨 라벨(초급/중급/고급)이 렌더된다 —
      진단 패널(WeatherBrainPanel)과 같은 표기.
- [ ] 결과 확인 후 홈으로 이동하며, 이후 재로그인해도 배치고사로 재진입하지 않는다.

## 18. 스킵 경로

- [ ] 시작 전·진행 중 어느 시점에서든 "건너뛰기 →"로 홈 이탈이 가능하다
      (진단은 강제가 아님).
- [ ] 스킵한 유저는 사전 θ(가입 시 level_group 기반)로 정상 학습 진행 —
      /session/today 발급·답안 제출에 이상 없음.

## 19. 429 미발생 (배치 중 구름 소모 없음 — UI 관점)

- [ ] 배치고사 6문항을 연속으로 풀어도 구름 에너지 경고/429 화면이 뜨지 않는다
      (placement는 구름 미소모 — 스모크 9단계의 잔량 불변 검증과 동일 계약의 UI 면).
- [ ] 배치 완료 직후 홈의 구름 잔량 표시가 만렙(5) 그대로다.

---

### 기록 규칙
- 각 체크박스는 확인자·일시·결과(P/F)를 남긴다. 실패 항목은 TEST_PLAN.md §3 결함 목록에
  P0~P3로 등재하고 재현 명령을 첨부한다.
- 이 문서는 스프린트 산출물로 누적한다 (TEAM_PROCESS.md §2.5).

#!/usr/bin/env bash
# =============================================================================
# WeatherMind DB 왕복 스모크 — R7-01 S0 (docs/team/SPRINT_R7_01.md §3.4)
#
# 사용법:
#   scripts/smoke.sh             # 전체 단계 순차 실행 (1~9)
#   scripts/smoke.sh <단계>      # 특정 단계만: up | migrate | seed | register |
#                                #   theta | rls | roundtrip | fallback | placement
#                                # (register 이후 단계는 필요 시 스스로 가입한다)
#
# 단계 (§3.4 계약 — 9단계 placement는 R7 웨이브 2에서 추가):
#   1 up        docker compose up -d --build postgres redis backend ai-worker
#               → /health 폴링 (8000·8001, 첫 빌드는 오래 걸리므로 타임아웃 넉넉히)
#   2 migrate   alembic upgrade head → current == 0007_placement (head)
#   3 seed      seed_content → seed_units → seed_badges (전부 멱등 upsert)
#   4 register  POST /auth/register (고유 이메일, middle_high) → 201 + access_token
#   5 theta     psql: user_concept_ability 6행 · num_responses=0 · θ≈사전값(0.0)
#               (postgres 슈퍼유저 접속은 RLS를 우회하므로 여기서는 행 검증만)
#   6 rls       비특권 롤(smoke 전용, 멱등 생성) + SET ROLE 로 3종 검증:
#               (a) 타 유저 컨텍스트 SELECT 0행 (자기 컨텍스트 6행)
#               (b) app.current_user_id 미설정 INSERT → WITH CHECK 위반(42501)
#               (c) item_params 는 컨텍스트 무관 SELECT 통과 (전역 자산, RLS 없음)
#   7 roundtrip GET /session/today (5문항) → 비board 3문항 answer → 재차 /today
#               (refresh_abilities 트리거) → psql: num_responses>0 전이
#   8 fallback  compose stop ai-worker → register 201 + θ 0행(placement 폴백이
#               조용히 통과, 가입 커밋 유지) → compose start ai-worker
#   9 placement 새 유저 register → POST /onboarding/placement/start (200, 6문항)
#               → 6문항 answer(구름 미소모 — /progress/me clouds 불변)
#               → POST /session/{id}/complete (abilities에 level_label,
#                 placement_done=true) → psql: placement_completed_at NOT NULL
#               + θ가 사전값(0.0)에서 이동 → start 재호출 409
#               PLACEMENT_ALREADY_DONE → GET /progress/me placement_done=true
#
# 멱등성: 스모크 유저는 매 실행 고유 이메일(smoke+epoch@example.com), 시드는
# upsert, RLS 롤 생성은 IF NOT EXISTS. 볼륨 파괴 명령(down -v 등)은 없다.
# 주의: .env 값(자격증명·키)은 절대 출력하지 않는다.
#
# 종료 코드: 모든 단계 OK/SKIP → 0, 하나라도 FAIL → 1. (scripts/ci.sh 관용구)
# =============================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
API="http://localhost:8000"
AI="http://localhost:8001"
HEALTH_TIMEOUT="${SMOKE_HEALTH_TIMEOUT:-420}"   # 초 — 첫 빌드 대비 넉넉히

# 단계별 결과 누적 (요약 출력용): "이름|상태|비고"
RESULTS=()
FAILED=0

record() { # record <단계> <OK|SKIP|FAIL> <비고>
  RESULTS+=("$1|$2|$3")
  [ "$2" = "FAIL" ] && FAILED=1
  return 0
}

banner() {
  echo ""
  echo "── [$1] ─────────────────────────────────────────────"
}

# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────
compose() { (cd "$ROOT" && docker compose "$@"); }

# .env 값 조회 — 값은 변수로만 다루고 절대 echo 하지 않는다.
env_val() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2-; }

PGUSER="$(env_val POSTGRES_USER 2>/dev/null || true)"
PGDB="$(env_val POSTGRES_DB 2>/dev/null || true)"

# psql 단문 실행 (-tAq: 값만, 명령 태그 억제). SQL 자체는 비밀이 아니므로
# 실패 시 stderr는 보인다.
psql_c() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAq -c "$1"
}

# psql 스크립트 실행 (stdin) — 여러 문장(SET ROLE 등)이 한 세션을 공유해야 할 때.
psql_stdin() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAq
}

# curl JSON POST: http 코드는 마지막 줄에 붙여 반환.
http_post() { # http_post <url> <json> [Authorization]
  local url="$1" json="$2" auth="${3:-}"
  if [ -n "$auth" ]; then
    curl -sS -w '\n%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $auth" \
      -d "$json"
  else
    curl -sS -w '\n%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' -d "$json"
  fi
}

http_get() { # http_get <url> <token>
  curl -sS -w '\n%{http_code}' "$1" -H "Authorization: Bearer $2"
}

json_field() { # json_field <json> <key>  (최상위 문자열/숫자 필드)
  "$PYTHON" -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$2" <<<"$1"
}

wait_health() { # wait_health <url> <이름>
  local url="$1" name="$2" waited=0
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      echo "  $name /health 응답 없음 (${HEALTH_TIMEOUT}s 초과)"
      return 1
    fi
    sleep 3; waited=$((waited + 3))
  done
  echo "  $name /health OK (${waited}s)"
  return 0
}

# ── 스모크 유저 (매 실행 고유 이메일 — 멱등) ────────────────────────────────
SMOKE_TOKEN=""
SMOKE_USER_ID=""

register_user() { # register_user <email-prefix> → 전역 REG_TOKEN/REG_USER_ID/REG_HTTP
  local email="$1+$(date +%s)-$RANDOM@example.com"
  local out http body
  out="$(http_post "$API/api/v1/auth/register" \
    "{\"email\":\"$email\",\"password\":\"smoke-pass-1234\",\"nickname\":\"smoke\",\"level_group\":\"middle_high\"}")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  REG_HTTP="$http"
  REG_TOKEN=""
  REG_USER_ID=""
  if [ "$http" = "201" ]; then
    REG_TOKEN="$(json_field "$body" access_token)"
    REG_USER_ID="$(json_field "$body" user_id)"
  else
    echo "  register 실패 (http=$http): $body"
  fi
}

ensure_user() { # 단계 단독 실행 대비 — 스모크 유저가 없으면 가입해 둔다.
  if [ -z "$SMOKE_TOKEN" ]; then
    echo "· 스모크 유저 가입 (고유 이메일)"
    register_user "smoke"
    if [ "$REG_HTTP" != "201" ]; then
      return 1
    fi
    SMOKE_TOKEN="$REG_TOKEN"
    SMOKE_USER_ID="$REG_USER_ID"
    echo "  user_id=$SMOKE_USER_ID"
  fi
  return 0
}

# ── 1. up: compose 기동 + /health 폴링 ───────────────────────────────────────
step_up() {
  banner "1 up: compose up -d --build (postgres·redis·backend·ai-worker)"
  if ! docker compose version >/dev/null 2>&1; then
    record "1 up" "FAIL" "docker compose v2 미설치"
    return 0
  fi
  if [ -z "$PGUSER" ] || [ -z "$PGDB" ]; then
    record "1 up" "FAIL" ".env에 POSTGRES_USER/POSTGRES_DB 없음"
    return 0
  fi
  # frontend·celery 제외 — §3.4-1. ai-worker의 depends_on(chroma)은 함께 뜬다.
  if ! compose up -d --build postgres redis backend ai-worker; then
    record "1 up" "FAIL" "docker compose up 실패 (위 출력 참조)"
    return 0
  fi
  local ok=1
  wait_health "$API/health" "backend(8000)" || ok=0
  wait_health "$AI/health" "ai-worker(8001)" || ok=0
  if [ "$ok" -eq 1 ]; then
    record "1 up" "OK" "backend·ai-worker /health 200"
  else
    record "1 up" "FAIL" "/health 폴링 타임아웃 (docker compose logs 확인)"
  fi
}

# ── 2. migrate: alembic upgrade head → current 확인 ─────────────────────────
step_migrate() {
  banner "2 migrate: alembic upgrade head"
  if ! compose exec -T backend alembic upgrade head; then
    record "2 migrate" "FAIL" "alembic upgrade head 실패"
    return 0
  fi
  local current
  current="$(compose exec -T backend alembic current 2>/dev/null)"
  echo "  alembic current: $current"
  if grep -q "0007_placement" <<<"$current" && grep -q "(head)" <<<"$current"; then
    record "2 migrate" "OK" "current == 0007_placement (head)"
  else
    record "2 migrate" "FAIL" "current가 0007 head가 아님: $current"
  fi
}

# ── 3. seed: 시드 3종 (멱등 upsert) ──────────────────────────────────────────
step_seed() {
  banner "3 seed: seed_content → seed_units → seed_badges"
  local mod ok=1
  for mod in seed_content seed_units seed_badges; do
    echo "· python -m app.scripts.$mod"
    if ! compose exec -T backend python -m "app.scripts.$mod"; then
      echo "  $mod 실패"
      ok=0
    fi
  done
  if [ "$ok" -eq 1 ]; then
    record "3 seed" "OK" "content·units·badges 멱등 적재"
  else
    record "3 seed" "FAIL" "시드 스크립트 실패 (위 출력 참조)"
  fi
}

# ── 4. register: 가입 → 201 + access_token ──────────────────────────────────
step_register() {
  banner "4 register: POST /auth/register (middle_high)"
  register_user "smoke"
  if [ "$REG_HTTP" = "201" ] && [ -n "$REG_TOKEN" ]; then
    SMOKE_TOKEN="$REG_TOKEN"
    SMOKE_USER_ID="$REG_USER_ID"
    echo "  201 Created, user_id=$SMOKE_USER_ID"
    record "4 register" "OK" "201 + access_token (user=$SMOKE_USER_ID)"
  else
    record "4 register" "FAIL" "http=$REG_HTTP (5회/분 레이트리밋이면 잠시 후 재실행)"
  fi
}

# ── 5. theta: θ 시드 검증 (행 수·num_responses·사전값) ──────────────────────
step_theta() {
  banner "5 theta: user_concept_ability 시드 검증 (psql)"
  ensure_user || { record "5 theta" "FAIL" "스모크 유저 가입 실패"; return 0; }
  local row
  row="$(psql_c "SELECT count(*) || '|' || coalesce(sum(num_responses),0) || '|' || coalesce(max(abs(theta)),-1) FROM user_concept_ability WHERE user_id='$SMOKE_USER_ID'")" || {
    record "5 theta" "FAIL" "psql 조회 실패"
    return 0
  }
  echo "  rows|sum(n)|max|θ| = $row"
  local cnt nsum tmax
  IFS='|' read -r cnt nsum tmax <<<"$row"
  # middle_high 사전 θ = 0.0 (ai-worker priors.LEVEL_GROUP_PRIORS) — 부동소수 여유 1e-6
  if [ "$cnt" = "6" ] && [ "$nsum" = "0" ] && \
     "$PYTHON" -c 'import sys; sys.exit(0 if abs(float(sys.argv[1])) < 1e-6 else 1)' "$tmax"; then
    record "5 theta" "OK" "6행 · num_responses=0 · θ=사전값(0.0)"
  else
    record "5 theta" "FAIL" "기대 6|0|0.0, 실제 $row"
  fi
}

# ── 6. rls: RLS 3종 (비특권 롤 — 슈퍼유저는 RLS 우회) ───────────────────────
step_rls() {
  banner "6 rls: user_isolation 정책 검증 (비특권 롤 SET ROLE)"
  ensure_user || { record "6 rls" "FAIL" "스모크 유저 가입 실패"; return 0; }

  # 검증용 비특권 롤 — 멱등 생성 (NOLOGIN: SET ROLE 전용, smoke 밖 영향 없음)
  psql_stdin <<'SQL' >/dev/null || { record "6 rls" "FAIL" "검증 롤 생성 실패"; return 0; }
DO $do$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weathermind_smoke_rls') THEN
    CREATE ROLE weathermind_smoke_rls NOLOGIN;
  END IF;
END $do$;
GRANT USAGE ON SCHEMA public TO weathermind_smoke_rls;
GRANT SELECT, INSERT ON user_concept_ability TO weathermind_smoke_rls;
GRANT SELECT ON item_params TO weathermind_smoke_rls;
SQL

  # (a) 타 유저 컨텍스트 SELECT 0행 / 자기 컨텍스트 6행
  local out_a
  out_a="$(psql_stdin <<SQL
SET ROLE weathermind_smoke_rls;
SELECT set_config('app.current_user_id', gen_random_uuid()::text, false) \\g /dev/null
SELECT 'other=' || count(*) FROM user_concept_ability;
SELECT set_config('app.current_user_id', '$SMOKE_USER_ID', false) \\g /dev/null
SELECT 'own=' || count(*) FROM user_concept_ability;
SQL
)" || { record "6 rls" "FAIL" "(a) 컨텍스트 SELECT 검증 psql 실패"; return 0; }
  echo "  (a) $out_a" | tr '\n' ' '; echo ""
  if ! grep -q '^other=0$' <<<"$out_a" || ! grep -q '^own=6$' <<<"$out_a"; then
    record "6 rls" "FAIL" "(a) 기대 other=0·own=6, 실제: $(tr '\n' ' ' <<<"$out_a")"
    return 0
  fi

  # (b) app.current_user_id 미설정 INSERT → WITH CHECK 위반이어야 한다
  local err_b
  err_b="$(psql_stdin <<SQL 2>&1
SET ROLE weathermind_smoke_rls;
INSERT INTO user_concept_ability (user_id, concept_tag) VALUES ('$SMOKE_USER_ID', 'smoke_rls_probe');
SQL
)"
  if [ $? -eq 0 ]; then
    # INSERT가 통과해 버렸다 — 정책 구멍. 흘러 들어간 probe 행은 정리한다.
    psql_c "DELETE FROM user_concept_ability WHERE user_id='$SMOKE_USER_ID' AND concept_tag='smoke_rls_probe'" >/dev/null 2>&1
    record "6 rls" "FAIL" "(b) 무컨텍스트 INSERT가 거부되지 않음 (WITH CHECK 구멍)"
    return 0
  fi
  if ! grep -qi "row-level security" <<<"$err_b"; then
    record "6 rls" "FAIL" "(b) INSERT가 RLS가 아닌 다른 이유로 실패: $(tail -n1 <<<"$err_b")"
    return 0
  fi
  echo "  (b) 무컨텍스트 INSERT 거부 확인 (row-level security)"

  # (c) item_params — 전역 자산, 컨텍스트 무관 SELECT 통과
  local out_c
  out_c="$(psql_stdin <<'SQL'
SET ROLE weathermind_smoke_rls;
SELECT 'item_params=' || count(*) FROM item_params;
SQL
)" || { record "6 rls" "FAIL" "(c) item_params SELECT 실패 (전역 자산이어야 함)"; return 0; }
  echo "  (c) $out_c (컨텍스트 없이 통과)"

  record "6 rls" "OK" "타유저 0행 · 무컨텍스트 INSERT 거부 · item_params 전역 통과"
}

# ── 7. roundtrip: 세션 왕복 → num_responses 전이 ────────────────────────────
step_roundtrip() {
  banner "7 roundtrip: session/today → answer x3 → 재발급 → θ 전이"
  ensure_user || { record "7 roundtrip" "FAIL" "스모크 유저 가입 실패"; return 0; }

  # 1차 발급 — 5문항
  local out http body
  out="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "7 roundtrip" "FAIL" "GET /session/today http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  local session_id n_items
  session_id="$(json_field "$body" session_id)"
  n_items="$("$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))' <<<"$body")"
  echo "  session_id=$session_id items=$n_items"
  if [ "$n_items" != "5" ]; then
    record "7 roundtrip" "FAIL" "5문항 기대, 실제 $n_items"
    return 0
  fi

  # 비board 3문항 선택 (board는 board_state 필수 — 스모크 범위 밖)
  local quiz_ids
  quiz_ids="$("$PYTHON" -c '
import json, sys
items = json.load(sys.stdin)["items"]
picks = [i["quiz_id"] for i in items if i.get("question_type") != "board"][:3]
print("\n".join(picks))
' <<<"$body")"
  if [ "$(wc -l <<<"$quiz_ids" | tr -d ' ')" -lt 3 ]; then
    record "7 roundtrip" "FAIL" "비board 문항이 3개 미만 (재실행하면 다른 배합)"
    return 0
  fi

  local qid answered=0
  while IFS= read -r qid; do
    out="$(http_post "$API/api/v1/session/$session_id/answer" \
      "{\"quiz_id\":\"$qid\",\"answer\":\"smoke\"}" "$SMOKE_TOKEN")"
    http="$(tail -n1 <<<"$out")"
    if [ "$http" != "200" ]; then
      record "7 roundtrip" "FAIL" "answer($qid) http=$http: $(sed '$d' <<<"$out" | head -c200)"
      return 0
    fi
    answered=$((answered + 1))
  done <<<"$quiz_ids"
  echo "  answer x$answered 제출 (채점 기록 → quiz_logs.is_correct)"

  # 재차 /today — refresh_abilities 트리거 (θ 재추정·upsert)
  out="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  if [ "$http" != "200" ]; then
    record "7 roundtrip" "FAIL" "재차 GET /session/today http=$http"
    return 0
  fi

  local row cnt nsum
  row="$(psql_c "SELECT count(*) || '|' || coalesce(sum(num_responses),0) FROM user_concept_ability WHERE user_id='$SMOKE_USER_ID'")" || {
    record "7 roundtrip" "FAIL" "psql 조회 실패"
    return 0
  }
  IFS='|' read -r cnt nsum <<<"$row"
  echo "  user_concept_ability: rows=$cnt sum(num_responses)=$nsum"
  if [ "$cnt" = "6" ] && [ "$nsum" -gt 0 ] 2>/dev/null; then
    record "7 roundtrip" "OK" "num_responses 0→$nsum 전이 (행 수 6 유지)"
  else
    record "7 roundtrip" "FAIL" "num_responses>0 전이 실패 (rows=$cnt, sum=$nsum) — refresh_abilities 미트리거?"
  fi
}

# ── 8. fallback: ai-worker 정지 중 가입 → 폴백 커밋 유지 ────────────────────
step_fallback() {
  banner "8 fallback: ai-worker stop → register → θ 0행 → start"
  if ! compose stop ai-worker; then
    record "8 fallback" "FAIL" "docker compose stop ai-worker 실패"
    return 0
  fi

  register_user "smoke-fb"
  local http="$REG_HTTP" uid="$REG_USER_ID" verdict=""
  if [ "$http" != "201" ]; then
    verdict="가입이 폴백으로 살아남지 못함 (http=$http)"
  else
    echo "  201 Created (ai-worker 정지 중), user_id=$uid"
    local rows
    rows="$(psql_c "SELECT count(*) FROM user_concept_ability WHERE user_id='$uid'")" || rows="?"
    echo "  user_concept_ability rows=$rows (기대 0 — placement 조용한 폴백)"
    if [ "$rows" != "0" ]; then
      verdict="폴백인데 θ 행이 생김 (rows=$rows)"
    fi
  fi

  # 정지시킨 것은 반드시 되살린다 — 검증 실패와 무관하게.
  if ! compose start ai-worker; then
    record "8 fallback" "FAIL" "ai-worker 재기동 실패 (수동 확인 필요)"
    return 0
  fi
  wait_health "$AI/health" "ai-worker(8001)" || {
    record "8 fallback" "FAIL" "재기동 후 /health 미응답"
    return 0
  }

  if [ -n "$verdict" ]; then
    record "8 fallback" "FAIL" "$verdict"
  else
    record "8 fallback" "OK" "정지 중 가입 201 + θ 0행 (커밋 유지) · 재기동 OK"
  fi
}

# ── 9. placement: 배치고사 전체 왕복 → 초기 θ 배정 (R7-01 §3.1·§3.3) ────────
step_placement() {
  banner "9 placement: register → start → answer x6 → complete → θ 이동 → 409"

  # 새 유저 — 배치 미완료·구름 만렙 상태에서 시작해야 하므로 공용 스모크
  # 유저를 쓰지 않는다 (7단계가 이미 구름을 소모했을 수 있다).
  register_user "smoke-pl"
  if [ "$REG_HTTP" != "201" ]; then
    record "9 placement" "FAIL" "가입 실패 http=$REG_HTTP (레이트리밋이면 잠시 후 재실행)"
    return 0
  fi
  local token="$REG_TOKEN" uid="$REG_USER_ID"
  echo "  user_id=$uid"

  # 구름 잔량 (before) — placement answer는 소모하지 않아야 한다 (§3.3)
  local out http body clouds_before clouds_after
  out="$(http_get "$API/api/v1/progress/me" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "9 placement" "FAIL" "GET /progress/me http=$http"
    return 0
  fi
  clouds_before="$(json_field "$body" clouds)"

  # start → 200 + 6문항 (response_model SessionToday)
  out="$(http_post "$API/api/v1/onboarding/placement/start" "{}" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "9 placement" "FAIL" "placement/start http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  local session_id n_items
  session_id="$(json_field "$body" session_id)"
  n_items="$("$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))' <<<"$body")"
  echo "  session_id=$session_id items=$n_items clouds=$clouds_before"
  if [ "$n_items" != "6" ]; then
    record "9 placement" "FAIL" "6문항 기대, 실제 $n_items"
    return 0
  fi

  # 6문항 전부 answer — placement 풀은 board·live 슬롯 제외라 문자열 답 제출 가능
  local quiz_ids qid answered=0
  quiz_ids="$("$PYTHON" -c '
import json, sys
print("\n".join(i["quiz_id"] for i in json.load(sys.stdin)["items"]))
' <<<"$body")"
  while IFS= read -r qid; do
    out="$(http_post "$API/api/v1/session/$session_id/answer" \
      "{\"quiz_id\":\"$qid\",\"answer\":\"smoke\"}" "$token")"
    http="$(tail -n1 <<<"$out")"
    if [ "$http" != "200" ]; then
      record "9 placement" "FAIL" "answer($qid) http=$http: $(sed '$d' <<<"$out" | head -c200)"
      return 0
    fi
    answered=$((answered + 1))
  done <<<"$quiz_ids"
  echo "  answer x$answered 제출 (placement — 구름 미소모여야 함)"

  # 구름 잔량 (after) — 불변 확인
  out="$(http_get "$API/api/v1/progress/me" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  clouds_after="$(json_field "$body" clouds 2>/dev/null || echo '?')"
  if [ "$clouds_after" != "$clouds_before" ]; then
    record "9 placement" "FAIL" "구름 소모됨: $clouds_before → $clouds_after (placement는 미소모 계약)"
    return 0
  fi
  echo "  clouds 불변 확인: $clouds_before → $clouds_after"

  # complete → abilities(level_label 포함)·placement_done=true
  out="$(http_post "$API/api/v1/session/$session_id/complete" "{}" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "9 placement" "FAIL" "complete http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  local complete_check
  complete_check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
ab = d.get("abilities") or []
ok = (
    d.get("placement_done") is True
    and len(ab) > 0
    and all(a.get("level_label") for a in ab)
)
done = d.get("placement_done")
print("ok" if ok else "bad: placement_done=%s abilities=%d" % (done, len(ab)))
' <<<"$body")"
  if [ "$complete_check" != "ok" ]; then
    record "9 placement" "FAIL" "complete 응답 계약 위반 — $complete_check"
    return 0
  fi
  echo "  complete OK: placement_done=true, abilities에 level_label 존재"

  # psql: placement_completed_at NOT NULL + θ가 사전값(0.0)에서 이동
  local row done_flag theta_max
  row="$(psql_c "SELECT (placement_completed_at IS NOT NULL)::text FROM users WHERE id='$uid'")" || {
    record "9 placement" "FAIL" "psql users 조회 실패"
    return 0
  }
  done_flag="$row"
  theta_max="$(psql_c "SELECT coalesce(max(abs(theta)),-1) FROM user_concept_ability WHERE user_id='$uid'")" || {
    record "9 placement" "FAIL" "psql θ 조회 실패"
    return 0
  }
  echo "  placement_completed_at NOT NULL=$done_flag · max|θ|=$theta_max (사전값 0.0)"
  if [ "$done_flag" != "true" ]; then
    record "9 placement" "FAIL" "users.placement_completed_at이 NULL"
    return 0
  fi
  # middle_high 사전 θ = 정확히 0.0 — 이동했다면 |θ| > 0 (부동소수 여유 1e-9)
  if ! "$PYTHON" -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 1e-9 else 1)' "$theta_max"; then
    record "9 placement" "FAIL" "θ가 사전값 0.0에서 이동하지 않음 (max|θ|=$theta_max — ai-worker 폴백?)"
    return 0
  fi

  # 완료 후 start 재호출 → 409 PLACEMENT_ALREADY_DONE
  out="$(http_post "$API/api/v1/onboarding/placement/start" "{}" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "409" ] || ! grep -q "PLACEMENT_ALREADY_DONE" <<<"$body"; then
    record "9 placement" "FAIL" "재호출 기대 409 PLACEMENT_ALREADY_DONE, 실제 http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  echo "  start 재호출 409 PLACEMENT_ALREADY_DONE 확인"

  # GET /progress/me → placement_done=true
  out="$(http_get "$API/api/v1/progress/me" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  local me_done
  me_done="$(json_field "$body" placement_done 2>/dev/null || echo '?')"
  if [ "$http" != "200" ] || [ "$me_done" != "True" ]; then
    record "9 placement" "FAIL" "/progress/me placement_done 기대 true, 실제 $me_done (http=$http)"
    return 0
  fi
  echo "  /progress/me placement_done=true 확인"

  record "9 placement" "OK" "6문항 왕복·구름 불변($clouds_before)·max|θ|=$theta_max 이동·409·me=true"
}

# ── 실행 ─────────────────────────────────────────────────────────────────────
STEP="${1:-all}"
case "$STEP" in
  up)        step_up ;;
  migrate)   step_migrate ;;
  seed)      step_seed ;;
  register)  step_register ;;
  theta)     step_theta ;;
  rls)       step_rls ;;
  roundtrip) step_roundtrip ;;
  fallback)  step_fallback ;;
  placement) step_placement ;;
  all)
    step_up
    if [ "$FAILED" -ne 0 ]; then
      echo ""
      echo "기동 실패 — 이후 단계는 실행하지 않습니다."
    else
      step_migrate
      step_seed
      step_register
      step_theta
      step_rls
      step_roundtrip
      step_fallback
      step_placement
    fi
    ;;
  *)
    echo "사용법: scripts/smoke.sh [up|migrate|seed|register|theta|rls|roundtrip|fallback|placement]" >&2
    exit 2
    ;;
esac

# ── 요약 ─────────────────────────────────────────────────────────────────────
echo ""
echo "══ 스모크 요약 ══════════════════════════════════════"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r name status note <<< "$row"
  printf "  %-12s %-5s %s\n" "$name" "$status" "$note"
done
if [ "$FAILED" -ne 0 ]; then
  echo "결과: FAIL (하나 이상 단계 실패)"
  exit 1
fi
echo "결과: OK"
exit 0

#!/usr/bin/env bash
# =============================================================================
# WeatherMind R10-01 실DB 왕복 스모크 — 웨이브 2 (S6) QA-1
#
# 존재 이유: 웨이브 0~1의 backend 897 passed는 전부 순수 함수·FakeDB 대역·소스
# 텍스트 계약이다. 아래 3건은 **실 PostgreSQL·RLS 세션**에서만 확인할 수 있어
# pytest가 구조적으로 검증하지 못한다:
#
#   ① 마이그레이션 0008_daily_goal — upgrade head 적용 + users.daily_goal_items
#      컬럼 실존 + downgrade 왕복(되돌릴 수 없는 마이그레이션은 결함)
#   ② consume_if_available의 RLS 하 동작 — 가드 UPDATE ... RETURNING과
#      **0행 분기의 재조회 SELECT**가 app.current_user_id 세션에서 의도대로 도는지.
#      (RLS가 재조회를 막으면 세션 캐시 폴백으로 떨어진다 — 어느 쪽인지 실측)
#   ③ _count_answered_today — 배치고사 제외가 **SQL 레벨**에서 성립하는지
#
# 사용법:
#   bash scripts/smoke_r10.sh              # 전 단계 1~7
#   bash scripts/smoke_r10.sh <단계>       # up | migrate | roundtrip | energy |
#                                          #   count | rls | downgrade
#
# 단계:
#   1 up         /health 폴링(8000·8001). 이미 떠 있으면 즉시 통과 —
#                compose up은 하지 않는다(도커는 공유 자원, 호출자가 관리).
#                SMOKE_R10_UP=1 이면 스스로 `up -d --build`도 한다.
#   2 migrate    alembic upgrade head → current == 0008_daily_goal (head)
#                + information_schema로 users.daily_goal_items(integer, nullable) 실존
#   3 roundtrip  register → GET /session/today → 정답 answer 1 → 오답 answer 1
#                → GET /progress/me → PUT /progress/daily-goal → GET /board/puzzles
#                → GET /board/puzzles/{id}. 각 단계 실측값 출력
#                (clouds·clouds_spent·xp_base·xp_weak_bonus·daily_goal_items·
#                 today_answered_count)
#   4 energy     dev/clouds로 잔량 0 → ⓐ 진행 중 세션 오답 제출 200 +
#                clouds_spent=0 (0행 분기가 실DB에서 예외 없이 통과) ·
#                ⓑ 신규 유저 세션 발급 429 OUT_OF_CLOUDS + next_regen_sec>0 ·
#                ⓒ GET /board/puzzles/{id} 429 · ⓓ GET /board/puzzles 200(무차단) ·
#                ⓔ 기존 세션 재조회 200(진행 중 세션 무차단) ·
#                ⓕ 보드 attempt 실패 200 + clouds_spent=0 (보드측 0행 분기)
#   5 count      배치고사 6문항 채점 후 today_answered_count == 0 (제외 성립) →
#                daily 세션 1문항 응답 후 == 1. psql 대조 쿼리로 SQL 레벨 교차 확인
#   6 rls        ② 의 근거를 DB 메타데이터·실쿼리로 확정:
#                relrowsecurity/relforcerowsecurity·앱 롤의 rolsuper/rolbypassrls,
#                그리고 비특권 롤로 app.current_user_id를 세팅한 상태에서
#                가드 UPDATE 0행 → 재조회 SELECT가 행을 읽는지 직접 실행
#   7 downgrade  alembic downgrade -1 → current == 0007_placement + 컬럼 소멸 확인
#                → alembic upgrade head로 복원(실행 후 항상 head로 되돌린다)
#
# 멱등: 스모크 유저는 매 실행 고유 이메일, RLS 검증 롤은 IF NOT EXISTS.
#       볼륨 파괴 명령(down -v 등)은 없다. 7단계는 실패해도 head 복원을 시도한다.
# 주의: .env 값(자격증명·API 키)은 절대 출력하지 않는다.
# 전제: DEV_MODE=true (4단계의 POST /api/v1/dev/clouds). 아니면 4단계 SKIP.
#
# 종료 코드: 모든 단계 OK/SKIP → 0, 하나라도 FAIL → 1.
# =============================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
API="http://localhost:8000"
AI="http://localhost:8001"
HEALTH_TIMEOUT="${SMOKE_HEALTH_TIMEOUT:-420}"

RESULTS=()
FAILED=0

record() { RESULTS+=("$1|$2|$3"); [ "$2" = "FAIL" ] && FAILED=1; return 0; }
banner() { echo ""; echo "── [$1] ─────────────────────────────────────────────"; }

compose() { (cd "$ROOT" && docker compose "$@"); }
env_val() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2-; }

PGUSER="$(env_val POSTGRES_USER 2>/dev/null || true)"
PGDB="$(env_val POSTGRES_DB 2>/dev/null || true)"

psql_c() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAq -c "$1"
}
psql_stdin() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -tAq
}

http_post() { # <url> <json> [token]
  local url="$1" json="$2" auth="${3:-}"
  if [ -n "$auth" ]; then
    curl -sS -w '\n%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $auth" -d "$json"
  else
    curl -sS -w '\n%{http_code}' -X POST "$url" \
      -H 'Content-Type: application/json' -d "$json"
  fi
}
http_put() { # <url> <json> <token>
  curl -sS -w '\n%{http_code}' -X PUT "$1" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $3" -d "$2"
}
http_get() { curl -sS -w '\n%{http_code}' "$1" -H "Authorization: Bearer $2"; }

# 응답 본문/코드 분리 — out 변수를 HTTP/BODY 전역으로 쪼갠다.
split_resp() { HTTP="$(tail -n1 <<<"$1")"; BODY="$(sed '$d' <<<"$1")"; }

jq_py() { # jq_py <json> <python-expr on `d`>  — 최상위 dict를 d로 노출
  "$PYTHON" -c 'import json,sys
d=json.load(sys.stdin)
print(eval(sys.argv[1]))' "$2" <<<"$1" 2>/dev/null
}

wait_health() {
  local url="$1" name="$2" waited=0
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      echo "  $name /health 응답 없음 (${HEALTH_TIMEOUT}s 초과)"; return 1
    fi
    sleep 3; waited=$((waited + 3))
  done
  echo "  $name /health OK (${waited}s)"; return 0
}

# ── 가입 헬퍼 — 레이트리밋(5/분)에 걸리면 1회 대기 후 재시도 ────────────────
register_user() { # <prefix> → REG_HTTP/REG_TOKEN/REG_USER_ID
  local prefix="$1" attempt=0 out email
  while :; do
    email="$prefix+$(date +%s)-$RANDOM@example.com"
    out="$(http_post "$API/api/v1/auth/register" \
      "{\"email\":\"$email\",\"password\":\"smoke-pass-1234\",\"nickname\":\"smoke\",\"level_group\":\"middle_high\"}")"
    split_resp "$out"
    REG_HTTP="$HTTP"; REG_TOKEN=""; REG_USER_ID=""
    if [ "$HTTP" = "201" ]; then
      REG_TOKEN="$(jq_py "$BODY" 'd["access_token"]')"
      REG_USER_ID="$(jq_py "$BODY" 'd["user_id"]')"
      return 0
    fi
    if [ "$HTTP" = "429" ] && [ "$attempt" -eq 0 ]; then
      echo "  register 429(레이트리밋 5/분) — 62초 대기 후 1회 재시도"
      attempt=1; sleep 62; continue
    fi
    echo "  register 실패 (http=$HTTP): $(head -c 200 <<<"$BODY")"
    return 1
  done
}

SMOKE_TOKEN=""; SMOKE_USER_ID=""
ensure_user() {
  [ -n "$SMOKE_TOKEN" ] && return 0
  echo "· 스모크 유저 가입"
  register_user "smoke-r10" || return 1
  SMOKE_TOKEN="$REG_TOKEN"; SMOKE_USER_ID="$REG_USER_ID"
  echo "  user_id=$SMOKE_USER_ID"
  return 0
}

# ── 1. up ────────────────────────────────────────────────────────────────────
step_up() {
  banner "1 up: /health 폴링 (8000·8001)"
  if [ -z "$PGUSER" ] || [ -z "$PGDB" ]; then
    record "1 up" "FAIL" ".env에 POSTGRES_USER/POSTGRES_DB 없음"; return 0
  fi
  if [ "${SMOKE_R10_UP:-0}" = "1" ]; then
    echo "· SMOKE_R10_UP=1 → docker compose up -d --build"
    compose up -d --build || { record "1 up" "FAIL" "compose up 실패"; return 0; }
  fi
  local ok=1
  wait_health "$API/health" "backend(8000)" || ok=0
  wait_health "$AI/health" "ai-worker(8001)" || ok=0
  [ "$ok" -eq 1 ] && record "1 up" "OK" "backend·ai-worker /health 200" \
                  || record "1 up" "FAIL" "/health 폴링 타임아웃"
}

# ── 2. migrate — 검증 ① 전반부 ───────────────────────────────────────────────
step_migrate() {
  banner "2 migrate: alembic upgrade head → 0008_daily_goal + 컬럼 실존"
  if ! compose exec -T backend alembic upgrade head; then
    record "2 migrate" "FAIL" "alembic upgrade head 실패"; return 0
  fi
  local current col
  current="$(compose exec -T backend alembic current 2>/dev/null | tr -d '\r')"
  echo "  alembic current: $(grep -o '0008_daily_goal (head)' <<<"$current" || echo "$current" | tail -1)"
  col="$(psql_c "SELECT column_name||'|'||data_type||'|nullable='||is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='daily_goal_items'")"
  echo "  users.daily_goal_items = ${col:-<없음>}"
  if grep -q "0008_daily_goal" <<<"$current" && grep -q "(head)" <<<"$current" \
     && [ "$col" = "daily_goal_items|integer|nullable=YES" ]; then
    record "2 migrate" "OK" "0008_daily_goal (head) + 컬럼 integer/nullable"
  else
    record "2 migrate" "FAIL" "current=$current col=${col:-없음}"
  fi
}

# ── 3. roundtrip — 실 HTTP 왕복 (실측값 출력) ────────────────────────────────
# 정답 문항은 quiz_logs.question_json->>'correct_answer'를 psql로 읽어 만든다
# (_grade_text: 공백·대소문자 무시 완전 일치).
ROUND_SESSION_ID=""
ROUND_WRONG_QID=""
step_roundtrip() {
  banner "3 roundtrip: session/today → 정답·오답 answer → progress/me → daily-goal → board"
  ensure_user || { record "3 roundtrip" "FAIL" "가입 실패"; return 0; }

  local out sid items_json qids qtypes
  out="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"; split_resp "$out"
  if [ "$HTTP" != "200" ]; then
    record "3 roundtrip" "FAIL" "GET /session/today http=$HTTP"; return 0
  fi
  sid="$(jq_py "$BODY" 'd["session_id"]')"
  ROUND_SESSION_ID="$sid"
  echo "  GET /session/today → 200 session_id=$sid items=$(jq_py "$BODY" 'len(d["items"])')"
  echo "    유형 배합: $(jq_py "$BODY" '",".join(i.get("question_type","?") for i in d["items"])')"
  echo "    source  : $(jq_py "$BODY" '",".join(str(i.get("source")) for i in d["items"])')"

  # 비board 문항 2개 확보 (정답용·오답용)
  qids="$(jq_py "$BODY" '" ".join(i["quiz_id"] for i in d["items"] if i.get("question_type")!="board")')"
  # shellcheck disable=SC2206
  local arr=($qids)
  if [ "${#arr[@]}" -lt 2 ]; then
    record "3 roundtrip" "FAIL" "비board 문항이 2개 미만 (${#arr[@]}개)"; return 0
  fi
  local qid_ok="${arr[0]}" qid_bad="${arr[1]}"
  ROUND_WRONG_QID="$qid_bad"

  # ⓐ 정답 제출 — 정답 문자열은 DB에서 읽는다
  local correct
  correct="$(psql_c "SELECT question_json->>'correct_answer' FROM quiz_logs WHERE session_id='$sid' AND quiz_id='$qid_ok'")"
  if [ -z "$correct" ]; then
    record "3 roundtrip" "FAIL" "정답 문자열 조회 실패 (quiz_id=$qid_ok)"; return 0
  fi
  out="$(http_post "$API/api/v1/session/$sid/answer" \
    "$("$PYTHON" -c 'import json,sys; print(json.dumps({"quiz_id":sys.argv[1],"answer":sys.argv[2],"elapsed_sec":5}))' "$qid_ok" "$correct")" \
    "$SMOKE_TOKEN")"
  split_resp "$out"
  local ok_http="$HTTP" ok_body="$BODY"
  echo "  POST answer(정답) → $ok_http  $(jq_py "$ok_body" '"is_correct=%s xp_earned=%s xp_base=%s xp_weak_bonus=%s clouds_spent=%s clouds=%s"%(d["is_correct"],d["xp_earned"],d["xp_base"],d["xp_weak_bonus"],d["clouds_spent"],d["clouds"])')"

  # ⓑ 오답 제출
  out="$(http_post "$API/api/v1/session/$sid/answer" \
    "{\"quiz_id\":\"$qid_bad\",\"answer\":\"__wm_smoke_definitely_wrong__\",\"elapsed_sec\":5}" "$SMOKE_TOKEN")"
  split_resp "$out"
  local bad_http="$HTTP" bad_body="$BODY"
  echo "  POST answer(오답) → $bad_http  $(jq_py "$bad_body" '"is_correct=%s xp_earned=%s xp_base=%s xp_weak_bonus=%s clouds_spent=%s clouds=%s"%(d["is_correct"],d["xp_earned"],d["xp_base"],d["xp_weak_bonus"],d["clouds_spent"],d["clouds"])')"

  # ⓒ GET /progress/me
  out="$(http_get "$API/api/v1/progress/me" "$SMOKE_TOKEN")"; split_resp "$out"
  local me_http="$HTTP" me_body="$BODY"
  echo "  GET /progress/me → $me_http  $(jq_py "$me_body" '"xp=%s level=%s clouds=%s next_regen_sec=%s daily_goal_items=%s today_answered_count=%s"%(d["xp"],d["level"],d["clouds"],d["next_regen_sec"],d["daily_goal_items"],d["today_answered_count"])')"

  # ⓓ PUT /progress/daily-goal (허용값 5) + 비허용값 422
  out="$(http_put "$API/api/v1/progress/daily-goal" '{"items":5}' "$SMOKE_TOKEN")"; split_resp "$out"
  local goal_http="$HTTP" goal_body="$BODY"
  echo "  PUT /progress/daily-goal {items:5} → $goal_http  $goal_body"
  out="$(http_put "$API/api/v1/progress/daily-goal" '{"items":7}' "$SMOKE_TOKEN")"; split_resp "$out"
  local goal422="$HTTP"
  echo "  PUT /progress/daily-goal {items:7} → $goal422 (기대 422)  $(head -c 120 <<<"$BODY")"

  # 목표 영속 확인 — /progress/me 재조회 + DB 실값
  out="$(http_get "$API/api/v1/progress/me" "$SMOKE_TOKEN")"; split_resp "$out"
  local me2_goal me2_cnt db_goal
  me2_goal="$(jq_py "$BODY" 'd["daily_goal_items"]')"
  me2_cnt="$(jq_py "$BODY" 'd["today_answered_count"]')"
  db_goal="$(psql_c "SELECT coalesce(daily_goal_items::text,'NULL') FROM users WHERE id='$SMOKE_USER_ID'")"
  echo "  재조회 /progress/me daily_goal_items=$me2_goal today_answered_count=$me2_cnt (DB=$db_goal)"

  # ⓔ 보드 목록·단건
  out="$(http_get "$API/api/v1/board/puzzles" "$SMOKE_TOKEN")"; split_resp "$out"
  local list_http="$HTTP" pid
  pid="$(jq_py "$BODY" 'd[0]["content_item_id"] if d else ""' 2>/dev/null)"
  [ -z "$pid" ] && pid="$("$PYTHON" -c 'import json,sys
d=json.load(sys.stdin)
print(d[0]["content_item_id"] if d else "")' <<<"$BODY" 2>/dev/null)"
  echo "  GET /board/puzzles → $list_http  count=$("$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"$BODY" 2>/dev/null) first_id=$pid"
  local detail_http="-"
  if [ -n "$pid" ]; then
    out="$(http_get "$API/api/v1/board/puzzles/$pid" "$SMOKE_TOKEN")"; split_resp "$out"
    detail_http="$HTTP"
    echo "  GET /board/puzzles/$pid → $detail_http  $(jq_py "$BODY" '"cleared=%s difficulty=%s"%(d["cleared"],d["difficulty"])')"
  fi

  # 판정
  local verdict=""
  [ "$ok_http" = "200" ] || verdict="$verdict 정답제출 http=$ok_http;"
  [ "$(jq_py "$ok_body" 'd["is_correct"]')" = "True" ] || verdict="$verdict 정답인데 is_correct!=true;"
  [ "$(jq_py "$ok_body" 'd["clouds_spent"]')" = "0" ] || verdict="$verdict 정답에 구름 소모(clouds_spent!=0);"
  [ "$bad_http" = "200" ] || verdict="$verdict 오답제출 http=$bad_http;"
  [ "$(jq_py "$bad_body" 'd["is_correct"]')" = "False" ] || verdict="$verdict 오답인데 is_correct!=false;"
  [ "$(jq_py "$bad_body" 'd["clouds_spent"]')" = "1" ] || verdict="$verdict 오답에 clouds_spent!=1;"
  [ "$me_http" = "200" ] || verdict="$verdict progress/me http=$me_http;"
  [ "$goal_http" = "200" ] || verdict="$verdict daily-goal http=$goal_http;"
  [ "$goal422" = "422" ] || verdict="$verdict 비허용값 http=$goal422(기대 422);"
  [ "$me2_goal" = "5" ] && [ "$db_goal" = "5" ] || verdict="$verdict 목표 영속 실패(api=$me2_goal db=$db_goal);"
  [ "$me2_cnt" = "2" ] || verdict="$verdict today_answered_count=$me2_cnt(기대 2);"
  [ "$list_http" = "200" ] || verdict="$verdict board 목록 http=$list_http;"
  [ "$detail_http" = "200" ] || verdict="$verdict board 단건 http=$detail_http;"

  if [ -z "$verdict" ]; then
    record "3 roundtrip" "OK" "7 엔드포인트 왕복 + 정답 0소모·오답 1소모·목표 영속·카운트 2"
  else
    record "3 roundtrip" "FAIL" "$verdict"
  fi
}

# ── 4. energy — 검증 ② (0행 분기) + 진입 차단 경계 ──────────────────────────
step_energy() {
  banner "4 energy: 잔량 0 → 진행 중 세션 오답 200/clouds_spent=0 · 신규 진입 429"
  if [ "$(env_val DEV_MODE 2>/dev/null)" != "true" ]; then
    record "4 energy" "SKIP" "DEV_MODE!=true — POST /dev/clouds 경로 없음"; return 0
  fi
  ensure_user || { record "4 energy" "FAIL" "가입 실패"; return 0; }
  # 0행 분기를 치려면 **미응답 비board 문항이 있는 세션**이 필요하다. 이미 푼 문항은
  # 멱등 가드가 409 ALREADY_ANSWERED로 먼저 답해 분기에 도달하지 못하고, board는
  # 미통과만 소모해서 소모 경로 자체가 다르다(R10 에너지 정책).
  #
  # 3단계 유저를 재사용하면 이 조건이 **세션 배합 운에 걸린다** — 2026-08-03 실측에서
  # 배합이 mc,board,board,mc,board로 나와 3단계의 정답·오답 2건이 비board를 전부
  # 소진했고 4단계가 재료를 잃어 FAIL했다. 제품 결함이 아니라 하네스 취약점이므로
  # 조건을 만족하는 세션을 직접 확보한다(부족하면 전용 유저로 재시도).
  local pick_sql attempt=0
  pick_sql="AND is_correct IS NULL AND coalesce(question_json->>'question_type','') <> 'board'"
  ROUND_WRONG_QID=""
  # 판정을 **획득 뒤**에 두어야 마지막으로 받은 세션도 검사된다. 상한을 while
  # 조건에 두면(`while [ $attempt -lt 3 ]`) 3번째 가입 직후 조건이 거짓이 되어
  # 그 세션을 써보지 못하고 끝난다 — 가입 1회와 레이트리밋 예산만 버린다.
  while :; do
    if [ -n "$ROUND_SESSION_ID" ]; then
      ROUND_WRONG_QID="$(psql_c "SELECT quiz_id FROM quiz_logs WHERE session_id='$ROUND_SESSION_ID' $pick_sql ORDER BY quiz_id LIMIT 1")"
      [ -n "$ROUND_WRONG_QID" ] && break
    fi
    [ "$attempt" -ge 3 ] && break
    attempt=$((attempt + 1))
    echo "  미응답 비board 문항 없음 — 전용 유저로 새 세션 확보 (시도 $attempt/3)"
    register_user "smoke-r10-energy" || { record "4 energy" "FAIL" "전용 유저 가입 실패"; return 0; }
    SMOKE_TOKEN="$REG_TOKEN"; SMOKE_USER_ID="$REG_USER_ID"
    local o; o="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"; split_resp "$o"
    [ "$HTTP" = "200" ] || { record "4 energy" "FAIL" "세션 확보 실패 http=$HTTP"; return 0; }
    ROUND_SESSION_ID="$(jq_py "$BODY" 'd["session_id"]')"
    echo "    새 세션=$ROUND_SESSION_ID 배합=$(psql_c "SELECT string_agg(coalesce(question_json->>'question_type','?'), ',' ORDER BY quiz_id) FROM quiz_logs WHERE session_id='$ROUND_SESSION_ID'")"
  done
  if [ -z "$ROUND_WRONG_QID" ]; then
    record "4 energy" "FAIL" "3회 시도에도 미응답 비board 문항 확보 실패 — 배합이 board 전량인지 확인"
    return 0
  fi
  echo "  대상 세션=$ROUND_SESSION_ID 미응답 문항=$ROUND_WRONG_QID"

  local out
  out="$(http_post "$API/api/v1/dev/clouds" '{"clouds":0}' "$SMOKE_TOKEN")"; split_resp "$out"
  echo "  POST /dev/clouds {clouds:0} → $HTTP  $BODY"
  [ "$HTTP" = "200" ] || { record "4 energy" "FAIL" "dev/clouds http=$HTTP"; return 0; }
  echo "    DB 실값 clouds=$(psql_c "SELECT clouds FROM users WHERE id='$SMOKE_USER_ID'")"

  # ⓐ 진행 중 세션의 오답 제출 — 0행 분기. 200 + clouds_spent=0 이어야 한다.
  out="$(http_post "$API/api/v1/session/$ROUND_SESSION_ID/answer" \
    "{\"quiz_id\":\"$ROUND_WRONG_QID\",\"answer\":\"__wm_smoke_wrong_at_zero__\",\"elapsed_sec\":5}" \
    "$SMOKE_TOKEN")"
  split_resp "$out"
  local a_http="$HTTP" a_body="$BODY"
  echo "  ⓐ 잔량0 오답 제출 → $a_http  $(jq_py "$a_body" '"is_correct=%s clouds_spent=%s clouds=%s"%(d["is_correct"],d["clouds_spent"],d["clouds"])' || head -c 200 <<<"$a_body")"

  # ⓑ 신규 유저: 잔량 0에서 세션 발급 → 429 OUT_OF_CLOUDS
  register_user "smoke-r10-zero" || { record "4 energy" "FAIL" "ⓑ 가입 실패"; return 0; }
  local ztok="$REG_TOKEN"
  out="$(http_post "$API/api/v1/dev/clouds" '{"clouds":0}' "$ztok")"; split_resp "$out"
  [ "$HTTP" = "200" ] || { record "4 energy" "FAIL" "ⓑ dev/clouds http=$HTTP"; return 0; }
  out="$(http_get "$API/api/v1/session/today" "$ztok")"; split_resp "$out"
  local b_http="$HTTP" b_body="$BODY"
  echo "  ⓑ 잔량0 신규 세션 발급 → $b_http  $(head -c 200 <<<"$b_body")"
  local b_code b_next
  b_code="$(jq_py "$b_body" 'd["detail"]["code"] if isinstance(d.get("detail"),dict) else d.get("code")')"
  b_next="$(jq_py "$b_body" 'd["detail"].get("next_regen_sec") if isinstance(d.get("detail"),dict) else d.get("next_regen_sec")')"

  # ⓒ 보드 단건 429 · ⓓ 목록 200 (같은 잔량0 유저)
  out="$(http_get "$API/api/v1/board/puzzles" "$ztok")"; split_resp "$out"
  local d_http="$HTTP" pid
  pid="$("$PYTHON" -c 'import json,sys
d=json.load(sys.stdin)
print(d[0]["content_item_id"] if d else "")' <<<"$BODY" 2>/dev/null)"
  echo "  ⓓ 잔량0 보드 목록 → $d_http (기대 200 무차단), first_id=$pid"
  local c_http="-" c_code="" c_next=""
  if [ -n "$pid" ]; then
    out="$(http_get "$API/api/v1/board/puzzles/$pid" "$ztok")"; split_resp "$out"
    c_http="$HTTP"
    c_code="$(jq_py "$BODY" 'd["detail"]["code"] if isinstance(d.get("detail"),dict) else d.get("code")')"
    c_next="$(jq_py "$BODY" 'd["detail"].get("next_regen_sec") if isinstance(d.get("detail"),dict) else d.get("next_regen_sec")')"
    echo "  ⓒ 잔량0 보드 단건 → $c_http code=$c_code next_regen_sec=$c_next"
  fi

  # ⓔ 진행 중 세션 **재조회**는 잔량 0에서도 무차단이어야 한다 (§3.1 각주 7 —
  #   require_entry는 신규 발급 분기 안에서만 검사한다는 계약의 관측 가능한 형태)
  out="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"; split_resp "$out"
  local e_http="$HTTP"
  echo "  ⓔ 잔량0 기존 세션 재조회 → $e_http (기대 200 — 풀던 것을 뺏기지 않는다)"

  # ⓕ 보드측 0행 분기 — 잔량 0에서 실패 attempt는 200 + clouds_spent=0
  #   (board.py도 같은 consume_if_available을 쓴다. 빈 배치라 반드시 미성립)
  local f_http="-" f_body=""
  if [ -n "$pid" ]; then
    out="$(http_post "$API/api/v1/board/puzzles/$pid/attempt" \
      '{"board_state":{"placements":[]}}' "$SMOKE_TOKEN")"
    split_resp "$out"; f_http="$HTTP"; f_body="$BODY"
    echo "  ⓕ 잔량0 보드 attempt(실패) → $f_http  $(jq_py "$f_body" '"passed=%s xp_earned=%s clouds_spent=%s clouds=%s"%(d["passed"],d["xp_earned"],d["clouds_spent"],d["clouds"])' || head -c 200 <<<"$f_body")"
  fi

  local verdict=""
  [ "$a_http" = "200" ] || verdict="$verdict ⓐ http=$a_http(기대 200 — 0행 분기 예외?);"
  [ "$(jq_py "$a_body" 'd["clouds_spent"]')" = "0" ] || verdict="$verdict ⓐ clouds_spent!=0;"
  [ "$(jq_py "$a_body" 'd["clouds"]')" = "0" ] || verdict="$verdict ⓐ clouds!=0(재조회 실측 아님?);"
  [ "$b_http" = "429" ] || verdict="$verdict ⓑ http=$b_http(기대 429);"
  [ "$b_code" = "OUT_OF_CLOUDS" ] || verdict="$verdict ⓑ code=$b_code;"
  "$PYTHON" -c 'import sys; sys.exit(0 if int(sys.argv[1])>0 else 1)' "${b_next:-0}" 2>/dev/null \
    || verdict="$verdict ⓑ next_regen_sec=$b_next(기대 >0);"
  [ "$c_http" = "429" ] || verdict="$verdict ⓒ http=$c_http(기대 429);"
  [ "$c_code" = "OUT_OF_CLOUDS" ] || verdict="$verdict ⓒ code=$c_code;"
  [ "$d_http" = "200" ] || verdict="$verdict ⓓ 목록 http=$d_http(기대 200);"
  [ "$e_http" = "200" ] || verdict="$verdict ⓔ 기존 세션 재조회 http=$e_http(기대 200 — 진행 중 세션 차단됨);"
  [ "$f_http" = "200" ] || verdict="$verdict ⓕ 보드 attempt http=$f_http(기대 200);"
  [ "$(jq_py "$f_body" 'd["clouds_spent"]')" = "0" ] || verdict="$verdict ⓕ 보드 clouds_spent!=0;"

  if [ -z "$verdict" ]; then
    record "4 energy" "OK" "0행 분기 200/spent=0(세션·보드) · 발급·보드단건 429 · 목록·재조회 200"
  else
    record "4 energy" "FAIL" "$verdict"
  fi
}

# ── 5. count — 검증 ③ (_count_answered_today 배치고사 제외) ─────────────────
step_count() {
  banner "5 count: 배치고사 6문항 채점 → today_answered_count 제외 성립"
  register_user "smoke-r10-cnt" || { record "5 count" "FAIL" "가입 실패"; return 0; }
  local tok="$REG_TOKEN" uid="$REG_USER_ID" out

  out="$(http_post "$API/api/v1/onboarding/placement/start" '{}' "$tok")"; split_resp "$out"
  if [ "$HTTP" != "200" ]; then
    record "5 count" "FAIL" "placement/start http=$HTTP: $(head -c 200 <<<"$BODY")"; return 0
  fi
  local psid answers n
  psid="$(jq_py "$BODY" 'd["session_id"]')"
  n="$(jq_py "$BODY" 'len(d["items"])')"
  answers="$("$PYTHON" -c 'import json,sys
d=json.load(sys.stdin)
print(json.dumps({"answers":[{"quiz_id":i["quiz_id"],"answer":"__wm_smoke__","elapsed_sec":3} for i in d["items"]]}))' <<<"$BODY")"
  echo "  placement/start → 200 session=$psid items=$n (mode=$(psql_c "SELECT mode FROM sessions WHERE id='$psid'"))"

  out="$(http_post "$API/api/v1/onboarding/placement/submit-all" "$answers" "$tok")"; split_resp "$out"
  echo "  placement/submit-all → $HTTP  $(jq_py "$BODY" '"graded=%s progress=%s"%(len(d["results"]),d["progress"])' || head -c 200 <<<"$BODY")"
  local sub_http="$HTTP"

  # 배치고사만 푼 상태 — 기대 0
  out="$(http_get "$API/api/v1/progress/me" "$tok")"; split_resp "$out"
  local cnt_after_placement graded_logs
  cnt_after_placement="$(jq_py "$BODY" 'd["today_answered_count"]')"
  graded_logs="$(psql_c "SELECT count(*) FROM quiz_logs WHERE user_id='$uid' AND is_correct IS NOT NULL")"
  echo "  배치고사만 푼 뒤 today_answered_count=$cnt_after_placement (채점된 quiz_logs 총 ${graded_logs}건 — 제외되어야 정상)"
  echo "    psql 대조(placement 제외 SQL 재현) = $(psql_c "
    SELECT count(*) FROM quiz_logs q
    WHERE q.user_id='$uid' AND q.is_correct IS NOT NULL
      AND (q.session_id IN (SELECT id FROM sessions
                            WHERE user_id='$uid' AND session_date=(now() AT TIME ZONE 'Asia/Seoul')::date
                              AND mode <> 'placement')
           OR q.session_id IS NULL)")"

  # daily 세션 1문항 응답 → 기대 1
  out="$(http_get "$API/api/v1/session/today" "$tok")"; split_resp "$out"
  if [ "$HTTP" != "200" ]; then
    record "5 count" "FAIL" "daily 세션 발급 http=$HTTP"; return 0
  fi
  local dsid dqid
  dsid="$(jq_py "$BODY" 'd["session_id"]')"
  dqid="$(jq_py "$BODY" '[i["quiz_id"] for i in d["items"] if i.get("question_type")!="board"][0]')"
  out="$(http_post "$API/api/v1/session/$dsid/answer" \
    "{\"quiz_id\":\"$dqid\",\"answer\":\"__wm_smoke__\",\"elapsed_sec\":4}" "$tok")"; split_resp "$out"
  echo "  daily 세션 1문항 제출 → $HTTP"
  out="$(http_get "$API/api/v1/progress/me" "$tok")"; split_resp "$out"
  local cnt_after_daily
  cnt_after_daily="$(jq_py "$BODY" 'd["today_answered_count"]')"
  echo "  daily 1문항 후 today_answered_count=$cnt_after_daily (기대 1)"

  local verdict=""
  [ "$sub_http" = "200" ] || verdict="$verdict submit-all http=$sub_http;"
  [ "$cnt_after_placement" = "0" ] || verdict="$verdict 배치고사가 카운트에 포함됨($cnt_after_placement);"
  [ "$cnt_after_daily" = "1" ] || verdict="$verdict daily 1문항 후 카운트=$cnt_after_daily(기대 1);"
  if [ -z "$verdict" ]; then
    record "5 count" "OK" "placement ${n}문항 채점 후 0 · daily 1문항 후 1 (SQL 레벨 제외 성립)"
  else
    record "5 count" "FAIL" "$verdict"
  fi
}

# ── 6. rls — 검증 ②의 근거(메타데이터 + 0행 분기 재조회 직접 실행) ──────────
step_rls() {
  banner "6 rls: consume_if_available 0행 분기 재조회가 RLS 세션에서 읽히는지"
  ensure_user || { record "6 rls" "FAIL" "가입 실패"; return 0; }

  echo "· 테이블·롤 메타데이터 (RLS 실제 적용 여부의 근거)"
  psql_c "SELECT relname||' rls='||relrowsecurity||' force='||relforcerowsecurity FROM pg_class WHERE relname IN ('users','quiz_logs','sessions') ORDER BY relname" \
    | sed 's/^/    /'
  # 앱이 접속하는 롤 = POSTGRES_USER(.env). 롤 이름은 출력하지 않고 속성만 출력한다.
  # super/bypassrls가 true면 앱 경로에서 RLS는 **적용되지 않는다**(정책은 살아 있으나
  # 이 롤에는 무효) — 0행 분기 재조회가 막힐 수 없는 구조적 이유다.
  psql_c "SELECT 'app_role: super='||rolsuper||' bypassrls='||rolbypassrls||' owner_of_users='||(pg_get_userbyid((SELECT relowner FROM pg_class WHERE relname='users'))=rolname)::text FROM pg_roles WHERE rolname=current_user" \
    | sed 's/^/    /'

  echo "· 비특권 롤 + app.current_user_id 설정 상태에서 consume 시퀀스 직접 실행"
  # 잔량을 0으로 만들어 가드 UPDATE가 0행이 되게 한다(consume_if_available과 동형).
  psql_c "UPDATE users SET clouds=0 WHERE id='$SMOKE_USER_ID'" >/dev/null
  local res
  res="$(psql_stdin <<SQL
DO \$do\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weathermind_smoke_rls') THEN
    CREATE ROLE weathermind_smoke_rls NOLOGIN;
  END IF;
END \$do\$;
GRANT USAGE ON SCHEMA public TO weathermind_smoke_rls;
GRANT SELECT, UPDATE ON users TO weathermind_smoke_rls;
BEGIN;
SET LOCAL ROLE weathermind_smoke_rls;
SELECT set_config('app.current_user_id', '$SMOKE_USER_ID', true);
-- (1) 가드 UPDATE ... RETURNING — 잔량 0이므로 0행이어야 한다
WITH g AS (UPDATE users SET clouds = clouds - 1
           WHERE id='$SMOKE_USER_ID' AND clouds >= 1 RETURNING clouds)
SELECT 'guard_rows=' || count(*) FROM g;
-- (2) 0행 분기의 재조회 SELECT — RLS 하에서 행이 읽히는가?
SELECT 'reselect_rows=' || count(*) || ' clouds=' || coalesce(max(clouds)::text,'NULL')
  FROM users WHERE id='$SMOKE_USER_ID';
-- (3) 대조: 컨텍스트를 남의 것으로 바꾸면 안 읽혀야 한다 (정책 살아있음 증명)
SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000000', true);
SELECT 'foreign_ctx_rows=' || count(*) FROM users WHERE id='$SMOKE_USER_ID';
COMMIT;
SQL
)"
  echo "$res" | grep -E 'guard_rows|reselect_rows|foreign_ctx_rows|ERROR' | sed 's/^/    /'

  local guard reselect foreign_rows
  guard="$(grep -o 'guard_rows=[0-9]*' <<<"$res" | head -1 | cut -d= -f2)"
  reselect="$(grep -o 'reselect_rows=[0-9]*' <<<"$res" | head -1 | cut -d= -f2)"
  foreign_rows="$(grep -o 'foreign_ctx_rows=[0-9]*' <<<"$res" | head -1 | cut -d= -f2)"

  local verdict=""
  [ "${guard:-x}" = "0" ] || verdict="$verdict 잔량0인데 가드 UPDATE가 ${guard}행;"
  [ "${reselect:-x}" = "1" ] || verdict="$verdict 0행 분기 재조회가 ${reselect}행(RLS가 막음 → 세션캐시 폴백 경로);"
  [ "${foreign_rows:-x}" = "0" ] || verdict="$verdict 타 컨텍스트에서 ${foreign_rows}행 노출(정책 무효);"
  if [ -z "$verdict" ]; then
    record "6 rls" "OK" "RLS 세션에서 가드 0행 + 재조회 1행(실측 잔량 반환 경로 성립)"
  else
    record "6 rls" "FAIL" "$verdict"
  fi
}

# ── 7. downgrade — 검증 ① 후반부 (되돌릴 수 있는 마이그레이션인가) ──────────
step_downgrade() {
  banner "7 downgrade: alembic downgrade -1 → 0007 → upgrade head 복원"
  local down_ok=1 cur col verdict=""
  if ! compose exec -T backend alembic downgrade -1; then
    down_ok=0
  fi
  cur="$(compose exec -T backend alembic current 2>/dev/null | tr -d '\r' | tail -1)"
  col="$(psql_c "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='daily_goal_items'")"
  echo "  downgrade 후 current=$cur · daily_goal_items 컬럼 수=$col (기대 0)"
  [ "$down_ok" = "1" ] || verdict="$verdict downgrade -1 실패;"
  grep -q "0007_placement" <<<"$cur" || verdict="$verdict current=$cur(기대 0007_placement);"
  [ "$col" = "0" ] || verdict="$verdict 컬럼이 남음($col);"

  # 실패해도 반드시 head로 복원한다.
  if ! compose exec -T backend alembic upgrade head; then
    verdict="$verdict head 복원 실패(수동 조치 필요);"
  fi
  cur="$(compose exec -T backend alembic current 2>/dev/null | tr -d '\r' | tail -1)"
  col="$(psql_c "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='daily_goal_items'")"
  echo "  재upgrade 후 current=$cur · daily_goal_items 컬럼 수=$col (기대 1)"
  grep -q "0008_daily_goal" <<<"$cur" || verdict="$verdict 복원 후 current=$cur;"
  [ "$col" = "1" ] || verdict="$verdict 복원 후 컬럼 수=$col;"

  if [ -z "$verdict" ]; then
    record "7 downgrade" "OK" "0008→0007 컬럼 드롭 · 재upgrade 복원 (왕복 가능)"
  else
    record "7 downgrade" "FAIL" "$verdict"
  fi
}

# ── 실행 ─────────────────────────────────────────────────────────────────────
STEP="${1:-all}"
case "$STEP" in
  all)
    step_up; step_migrate; step_roundtrip; step_energy; step_count
    step_rls; step_downgrade ;;
  up) step_up ;;
  migrate) step_up; step_migrate ;;
  roundtrip) step_up; step_roundtrip ;;
  energy) step_up; step_energy ;;
  count) step_up; step_count ;;
  rls) step_up; step_rls ;;
  downgrade) step_up; step_downgrade ;;
  *) echo "알 수 없는 단계: $STEP"; echo "사용: $0 [all|up|migrate|roundtrip|energy|count|rls|downgrade]"; exit 2 ;;
esac

echo ""
echo "══ R10 스모크 요약 ═══════════════════════════════════════"
printf '%-14s %-5s %s\n' "단계" "결과" "비고"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r name status note <<<"$r"
  printf '%-14s %-5s %s\n' "$name" "$status" "$note"
done
echo "═════════════════════════════════════════════════════════"
[ "$FAILED" -eq 0 ] && echo "R10 스모크 통과" || echo "R10 스모크 실패 — 위 FAIL 확인"
exit "$FAILED"

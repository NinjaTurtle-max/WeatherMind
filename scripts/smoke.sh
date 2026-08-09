#!/usr/bin/env bash
# =============================================================================
# WeatherMind DB 왕복 스모크 — R7-01 S0 (docs/team/SPRINT_R7_01.md §3.4)
#                              + R7-02 (submit-all 경로·유닛 세션, SPRINT_R7_02.md)
#                              + R8-01 (스파인·왕관 유입·θ 파생 약점, SPRINT_R8_01.md)
#                              + R9-01 (예보 브리핑·evidence·적응형 캐스터, SPRINT_R9_01.md)
#
# 사용법:
#   scripts/smoke.sh             # 전체 단계 순차 실행 (1~12)
#   scripts/smoke.sh <단계>      # 특정 단계만: up | migrate | seed | register |
#                                #   theta | rls | roundtrip | fallback |
#                                #   placement | unit | r8 | r9
#                                # (register 이후 단계는 필요 시 스스로 가입한다)
#
# 단계 (§3.4 계약 — 9 placement는 R7-01, 10 unit과 9의 submit-all 전환은 R7-02):
#   1 up        docker compose up -d --build postgres redis backend ai-worker
#               → /health 폴링 (8000·8001, 첫 빌드는 오래 걸리므로 타임아웃 넉넉히)
#   2 migrate   alembic upgrade head → current == head (alembic heads와 일치)
#   3 seed      seed_content → seed_courses → seed_units → seed_badges (전부 멱등 upsert)
#              순서 계약(R11-01 F): seed_units가 units.json의 course slug를 DB courses
#              행으로 해석하므로 seed_courses가 먼저다.
#   4 register  POST /auth/register (고유 이메일, middle_high) → 201 + access_token
#   4b guest    POST /auth/guest → 201 + 그 토큰으로 /session/today 200 (CO-J-3)
#               — 제출 요건 ①「로그인 없이 열려야 함」의 유일한 기계 검증이다.
#   5 theta     psql: user_concept_ability 6행 · num_responses=0 · θ≈사전값(0.0)
#               (postgres 슈퍼유저 접속은 RLS를 우회하므로 여기서는 행 검증만)
#   6 rls       비특권 롤(smoke 전용, 멱등 생성) + SET ROLE 로 3종 검증:
#               (a) 타 유저 컨텍스트 SELECT 0행 (자기 컨텍스트 6행)
#               (b) app.current_user_id 미설정 INSERT → WITH CHECK 위반(42501)
#               (c) item_params 는 컨텍스트 무관 SELECT 통과 (전역 자산, RLS 없음)
#   7 roundtrip GET /session/today (배합 합계만큼) → 비board 3문항 answer → 재차 /today
#               (refresh_abilities 트리거) → psql: num_responses>0 전이
#   8 fallback  compose stop ai-worker → register 201 + θ 0행(placement 폴백이
#               조용히 통과, 가입 커밋 유지) → compose start ai-worker
#   9 placement 새 유저 register → POST /onboarding/placement/start (200, 6문항)
#               → 채점 필드(is_correct) 주입 submit-all 1건 → 422 거부
#                 (extra='forbid' — 채점 권위 서버 소유 실검증, R7-02 §3.1)
#               → POST /onboarding/placement/submit-all (answers 6건 일괄 채점,
#                 구름 미소모 — /progress/me clouds 불변)
#               → POST /session/{id}/complete (abilities에 level_label,
#                 placement_done=true) → psql: placement_completed_at NOT NULL
#               + θ가 사전값(0.0)에서 이동 → start 재호출 409
#               PLACEMENT_ALREADY_DONE → GET /progress/me placement_done=true
#  10 unit      GET /curriculum → 전 유닛 status 존재·'current' 정확히 1개
#               → 첫 유닛 POST /curriculum/units/{slug}/session 200 + 문항 ≥1
#               (θ 풀 확장 경로 실기동 — R7-02 S3·S4)
#  11 r8        R8-01 검증 5종 (SPRINT_R8_01.md — 판정: 트리 id==slug 계약):
#   11a spine     GET /progress/me → spine {units_total=12, units_cleared,
#                 crowns_earned, crowns_total, current_unit} 서버 집계 (§3.3)
#   11b unit-id   트리 노출 id와 spine.current_unit.slug가 동일 값(계약)임을
#                 확인하고, 두 진입점 값 각각으로 유닛 세션 발급 200 (§1 판정:
#                 UnitOut.id == unit.slug — 실서버는 slug 하나로 양쪽 커버)
#   11c crown     새 유저 + psql로 quiz 유닛 전부 클리어(픽스처) → 보드 퍼즐
#                 정답 배치(시드 goal_conditions: zone1 shower ← 한랭전선+습기75,
#                 board_test_vectors 공유 벡터) attempt → passed·xp_earned=5·
#                 crown_award{unit_slug, crowns=1} 왕관 유입 실검증 (§3.4)
#   11d weak      GET /progress/weak-tags → θ 파생 WeakConceptOut[] 신 형태
#                 ({concept_tag, theta, threshold, num_responses}, θ<threshold,
#                 middle_high threshold≈0.405) (§3.5)
#   11e board-tls 보드 유닛 세션 발급 → board 문항에 time_limit_sec 노출(SA-5
#                 화이트리스트). 세션 풀이 time_limit_sec 있는 시드를 못 잡으면
#                 SKIP(psql로 포착 여부를 판별 — 확률적 미포착과 실결함 구분)
#  12 r9        R9-01 duel 검증 4종 (KMA 키 부재 환경 전제 — degraded 허용):
#   12a briefing  GET /duel/briefing 200 + 형태(hourly 빈 배열·today_observed
#                 null 허용, region·target_date·recent_days 존재) (§3.1 ②)
#   12b evidence  미지 evidence 코드 → 422 INVALID_EVIDENCE (§3.1 ③,
#                 제출 이전에 검증되므로 순서 무관하지만 제출 전에 확인)
#   12c submit    POST /duel/today evidence 2종 동봉 → 200 + 응답에
#                 caster_grade·evidence 노출 (§3.1 ③·§3.2)
#   12d base      GET /duel/today에 base_forecast 필드 존재 (null 허용, §3.1 ①)
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

json_len() { # json_len <json>  (최상위 배열 길이)
  "$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"$1"
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
  # frontend·celery 제외 — §3.4-1.
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
  # 리비전 번호를 하드코딩하지 않는다 — 라운드마다 상수를 갱신하는 방식은 갱신을
  # 잊는 순간 "마이그레이션이 정상인데 FAIL"이 되어 게이트 신뢰를 잃는다
  # (R10에서 0008 추가로 실제 발생 — QA-1 발견, S6에서 수정).
  # 판정 기준: current가 (head)이고 alembic heads와 같은 리비전을 가리키는가.
  local heads head_rev cur_rev
  heads="$(compose exec -T backend alembic heads 2>/dev/null)"
  head_rev="$(sed -n 's/^\([0-9a-zA-Z_]\{1,\}\).*/\1/p' <<<"$heads" | head -1)"
  cur_rev="$(sed -n 's/^\([0-9a-zA-Z_]\{1,\}\).*/\1/p' <<<"$current" | head -1)"
  if [ -n "$head_rev" ] && [ "$cur_rev" = "$head_rev" ] && grep -q "(head)" <<<"$current"; then
    record "2 migrate" "OK" "current == $cur_rev (head)"
  else
    record "2 migrate" "FAIL" "current가 head가 아님 (current=$cur_rev, heads=$head_rev): $current"
  fi
}

# ── 3. seed: 시드 3종 (멱등 upsert) ──────────────────────────────────────────
step_seed() {
  banner "3 seed: seed_content → seed_courses → seed_units → seed_badges"
  local mod ok=1
  # seed_courses가 seed_units보다 먼저 — units.json의 course slug 해석(R11-01 F)
  for mod in seed_content seed_courses seed_units seed_badges; do
    echo "· python -m app.scripts.$mod"
    if ! compose exec -T backend python -m "app.scripts.$mod"; then
      echo "  $mod 실패"
      ok=0
    fi
  done
  if [ "$ok" -eq 1 ]; then
    record "3 seed" "OK" "content·courses·units·badges 멱등 적재"
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

# ── 4b. guest: 가입 없이 학습까지 (대회 규정 직결 — CO-J-3) ─────────────────
# **왜 이 단계가 필요한가**: 제출 요건 ①이 *"로그인·결제 없이 열려야 함"*이고, 심사는
# 8/22 현장에서 **주최측 PC의 크롬**으로 URL만 열어 진행한다. 그런데 두 스모크가
# `/auth/register`만 써서 **게스트 경로를 한 번도 안 밟았다**(`grep guest scripts/*.sh`
# → 0). 규정 위반이 사람 지시문(`DEPLOY.md`)에만 걸려 있었다는 뜻이다.
#
# 가입 성공만으로는 부족하다 — 게스트가 **실제로 학습에 도달**해야 "열린다"가 참이다.
# 그래서 토큰 발급에서 멈추지 않고 그 토큰으로 세션까지 받아 본다.
step_guest() {
  banner "4b guest: POST /auth/guest → 세션 도달 (가입 없이)"
  local out http body token items
  out="$(http_post "$API/api/v1/auth/guest" '{}')"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "201" ]; then
    record "4b guest" "FAIL" "게스트 발급 http=$http — 로그인 없이 열리지 않는다(규정 ①)"
    return
  fi
  token="$(json_field "$body" access_token)"
  if [ -z "$token" ]; then
    record "4b guest" "FAIL" "201인데 access_token이 없다"
    return
  fi
  echo "  201 Created (게스트 토큰 발급)"

  out="$(http_get "$API/api/v1/session/today" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "4b guest" "FAIL" "게스트 세션 http=$http — 토큰은 나오는데 학습에 못 닿는다"
    return
  fi
  items="$("$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin).get("items") or []))' <<<"$body")"
  if [ "$items" -lt 1 ]; then
    record "4b guest" "FAIL" "게스트 세션 0문항 — 화면에 탈출구가 없다(대장 S-3)"
    return
  fi
  echo "  세션 ${items}문항"
  record "4b guest" "OK" "201 + 세션 ${items}문항 (가입·로그인 0회)"
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

  # 1차 발급 — 배합 합계(SESSION_RECIPE)만큼
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
  # 기대 문항 수는 **배합에서 파생**한다 — 숫자를 박으면 배합이 바뀔 때마다 배포
  # 게이트가 조용히 막힌다. 실제로 R13 §2.10이 10→15로 넓혔을 때 이 자리가
  # "5문항 기대"로 남아 5일차 게이트를 확정 실패시키고 있었다(감사 2026-08-07).
  local expected
  expected="$(compose exec -T backend python -c \
    'from app.core.config import settings; print(sum(settings.SESSION_RECIPE.values()))' \
    2>/dev/null | tr -d '\r\n')"
  if [ -z "$expected" ]; then
    record "7 roundtrip" "FAIL" "SESSION_RECIPE 조회 실패 — backend 컨테이너 확인"
    return 0
  fi
  if [ "$n_items" != "$expected" ]; then
    record "7 roundtrip" "FAIL" "배합 합계 ${expected}문항 기대, 실제 $n_items"
    return 0
  fi

  # 비board 최대 3문항 선택 (board는 board_state 필수 — 스모크 범위 밖).
  # θ 전이(num_responses>0) 검증엔 1건이면 충분 — 배합이 board 위주로 뽑힌
  # 날에도 그린을 유지한다(과거: 3건 미만이면 확률적 FAIL).
  local quiz_ids
  quiz_ids="$("$PYTHON" -c '
import json, sys
items = json.load(sys.stdin)["items"]
picks = [i["quiz_id"] for i in items if i.get("question_type") != "board"][:3]
print("\n".join(picks))
' <<<"$body")"
  if [ -z "$quiz_ids" ]; then
    record "7 roundtrip" "FAIL" "비board 문항 0건 (전부 board — 배합 확인 필요)"
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
#      R7-02: 문항별 answer 루프 → submit-all 일괄 채점 경로로 전환 + 채점
#      필드 주입 422 가드 실검증. 기존 검증(구름 불변·θ 이동·409 등)은 유지.
step_placement() {
  banner "9 placement: register → start → 주입 422 → submit-all → complete → θ 이동 → 409"

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

  # 채점 필드 주입 시도 → 422 (R7-02 §3.1: extra='forbid' — 채점 권위 서버 소유)
  local first_qid inj_out inj_http
  first_qid="$("$PYTHON" -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["quiz_id"])' <<<"$body")"
  inj_out="$(http_post "$API/api/v1/onboarding/placement/submit-all" \
    "{\"answers\":[{\"quiz_id\":\"$first_qid\",\"answer\":\"smoke\",\"is_correct\":true}]}" "$token")"
  inj_http="$(tail -n1 <<<"$inj_out")"
  if [ "$inj_http" != "422" ]; then
    record "9 placement" "FAIL" "is_correct 주입 기대 422, 실제 http=$inj_http: $(sed '$d' <<<"$inj_out" | head -c200)"
    return 0
  fi
  echo "  is_correct 주입 시도 422 거부 확인 (채점 권위 가드)"

  # submit-all — answers 6건 일괄 채점 (R7-02 §3.1, placement — 구름 미소모여야 함)
  local submit_json sub_body sub_check
  submit_json="$("$PYTHON" -c '
import json, sys
items = json.load(sys.stdin)["items"]
print(json.dumps({"answers": [{"quiz_id": i["quiz_id"], "answer": "smoke"} for i in items]}))
' <<<"$body")"
  out="$(http_post "$API/api/v1/onboarding/placement/submit-all" "$submit_json" "$token")"
  http="$(tail -n1 <<<"$out")"
  sub_body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "9 placement" "FAIL" "submit-all http=$http: $(head -c200 <<<"$sub_body")"
    return 0
  fi
  sub_check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
n = len(d.get("results") or [])
p = d.get("progress") or {}
ok = n == 6 and p.get("answered") == 6 and p.get("total") == 6
print("ok" if ok else "bad: results=%d progress=%s" % (n, p))
' <<<"$sub_body")"
  if [ "$sub_check" != "ok" ]; then
    record "9 placement" "FAIL" "submit-all 응답 계약 위반 — $sub_check"
    return 0
  fi
  echo "  submit-all 일괄 채점 OK (results 6건, progress 6/6)"

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

  record "9 placement" "OK" "주입 422·submit-all 6건·구름 불변($clouds_before)·max|θ|=$theta_max 이동·409·me=true"
}

# ── 10. unit: 커리큘럼 status → 첫 유닛 세션 발급 (R7-02 S3·S4) ─────────────
step_unit() {
  banner "10 unit: GET /curriculum(status·current 1개) → 첫 유닛 세션 발급"
  ensure_user || { record "10 unit" "FAIL" "스모크 유저 가입 실패"; return 0; }

  # GET /curriculum — 전 유닛 status 존재(4종) + 'current' 정확히 1개
  local out http body tree_check first_slug
  out="$(http_get "$API/api/v1/curriculum" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "10 unit" "FAIL" "GET /curriculum http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  tree_check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
units = [u for s in d["sections"] for u in s["units"]]
allowed = {"cleared", "current", "unlocked", "locked"}
bad = [u["id"] for u in units if u.get("status") not in allowed]
cur = [u["id"] for u in units if u.get("status") == "current"]
if not units or bad or len(cur) != 1:
    print("bad: units=%d status위반=%s current=%s" % (len(units), bad, cur))
else:
    print("ok|%s|%d" % (units[0]["id"], len(units)))
' <<<"$body")"
  if [[ "$tree_check" != ok\|* ]]; then
    record "10 unit" "FAIL" "커리큘럼 status 계약 위반 — $tree_check"
    return 0
  fi
  local n_units
  IFS='|' read -r _ first_slug n_units <<<"$tree_check"
  echo "  유닛 ${n_units}개 전부 status 보유 · current 정확히 1개 · 첫 유닛=$first_slug"

  # 첫 유닛(무 prereq — 항상 열림) 세션 발급 → 200 + 문항 ≥1 (θ 풀 확장 실기동)
  out="$(http_post "$API/api/v1/curriculum/units/$first_slug/session" "{}" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "10 unit" "FAIL" "유닛 세션 발급 http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  local n_items
  n_items="$("$PYTHON" -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))' <<<"$body")"
  echo "  유닛 세션 발급 OK (items=$n_items)"
  if [ "$n_items" -lt 1 ] 2>/dev/null; then
    record "10 unit" "FAIL" "유닛 세션 문항 0건 (θ 풀 확장 경로 확인 필요)"
    return 0
  fi
  record "10 unit" "OK" "status 4종·current 1개·유닛($first_slug) 세션 items=$n_items"
}

# ── 11. r8: R8-01 검증 5종 (스파인·유닛 id/slug·왕관 유입·θ 약점·board 필드) ─

# R8 크라운 검증용 유저 — quiz 유닛 전부 클리어된 픽스처(psql, RLS는 슈퍼유저
# 우회)를 깔아 board 유닛의 잠금을 연다. 왕관 유입 경로 자체(attempt →
# award_crown_for_activity → crown_award)는 실 API로 검증한다.
R8_TOKEN=""
R8_USER_ID=""

ensure_r8_user() {
  if [ -n "$R8_TOKEN" ]; then return 0; fi
  echo "· R8 크라운 유저 가입 + quiz 유닛 클리어 픽스처(psql)"
  register_user "smoke-r8"
  if [ "$REG_HTTP" != "201" ]; then return 1; fi
  R8_TOKEN="$REG_TOKEN"
  R8_USER_ID="$REG_USER_ID"
  psql_c "INSERT INTO user_unit_progress (user_id, unit_id, crowns, cleared_at)
          SELECT '$R8_USER_ID', id, crown_target, now() FROM units WHERE kind='quiz'
          ON CONFLICT (user_id, unit_id) DO NOTHING" >/dev/null || return 1
  echo "  user_id=$R8_USER_ID (quiz 유닛 클리어 픽스처 적재)"
  return 0
}

step_r8_spine() { # ① /progress/me spine 서버 집계 (R8-01 §3.3)
  banner "11a r8-spine: GET /progress/me → spine 집계 (units_total=12)"
  ensure_user || { record "11a spine" "FAIL" "스모크 유저 가입 실패"; return 0; }
  local out http body check
  out="$(http_get "$API/api/v1/progress/me" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "11a spine" "FAIL" "GET /progress/me http=$http"
    return 0
  fi
  check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
sp = d.get("spine")
keys = {"units_total", "units_cleared", "crowns_earned", "crowns_total", "current_unit"}
if not isinstance(sp, dict) or not keys <= set(sp):
    print("bad: spine 필드 누락 — %s" % sp); sys.exit()
if sp["units_total"] != 12:
    print("bad: units_total=%s (기대 12 — 시드 units.json)" % sp["units_total"]); sys.exit()
cu = sp["current_unit"]
if cu is not None and not ({"slug", "title"} <= set(cu)):
    print("bad: current_unit 형태 위반 — %s" % cu); sys.exit()
print("ok|cleared=%s crowns=%s/%s current=%s"
      % (sp["units_cleared"], sp["crowns_earned"], sp["crowns_total"],
         (cu or {}).get("slug")))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "11a spine" "FAIL" "$check"
    return 0
  fi
  echo "  spine OK: ${check#ok|}"
  record "11a spine" "OK" "units_total=12 · ${check#ok|}"
}

step_r8_unitid() { # ② 트리 id == spine slug 계약 + 양쪽 값으로 발급 200 (§1 판정)
  banner "11b r8-unit-id: 트리 id·spine slug 동일 계약 + 각각 발급 200"
  ensure_user || { record "11b unit-id" "FAIL" "스모크 유저 가입 실패"; return 0; }

  local out http tree_body me_body pair tree_id spine_slug
  out="$(http_get "$API/api/v1/curriculum" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  tree_body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11b unit-id" "FAIL" "GET /curriculum http=$http"; return 0; }
  out="$(http_get "$API/api/v1/progress/me" "$SMOKE_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  me_body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11b unit-id" "FAIL" "GET /progress/me http=$http"; return 0; }

  # 트리의 'current' 유닛 id ↔ spine.current_unit.slug — 동일 값 계약(UnitOut.id==slug)
  pair="$("$PYTHON" -c '
import json, sys
tree, me = json.loads(sys.argv[1]), json.loads(sys.argv[2])
cur = next((u for s in tree["sections"] for u in s["units"] if u["status"] == "current"), None)
sp = (me.get("spine") or {}).get("current_unit")
if cur is None or sp is None:
    print("skip: current 유닛 없음 (전부 클리어/잠금)"); sys.exit()
if cur["id"] != sp["slug"]:
    print("bad: 트리 id=%s != spine slug=%s" % (cur["id"], sp["slug"])); sys.exit()
print("ok|%s|%s" % (cur["id"], sp["slug"]))
' "$tree_body" "$me_body")"
  if [[ "$pair" == skip:* ]]; then
    record "11b unit-id" "SKIP" "${pair#skip: }"
    return 0
  fi
  if [[ "$pair" != ok\|* ]]; then
    record "11b unit-id" "FAIL" "$pair"
    return 0
  fi
  IFS='|' read -r _ tree_id spine_slug <<<"$pair"
  echo "  트리 id == spine slug 확인: $tree_id"

  # 두 진입점 값 각각으로 발급 — 실서버는 slug 단일 조회지만 값이 같아 양쪽 200
  local val
  for val in "$tree_id" "$spine_slug"; do
    out="$(http_post "$API/api/v1/curriculum/units/$val/session" "{}" "$SMOKE_TOKEN")"
    http="$(tail -n1 <<<"$out")"
    if [ "$http" != "200" ]; then
      record "11b unit-id" "FAIL" "units/$val/session http=$http: $(sed '$d' <<<"$out" | head -c200)"
      return 0
    fi
    echo "  POST /units/$val/session → 200"
  done
  record "11b unit-id" "OK" "트리 id==spine slug($tree_id) · 양쪽 값 발급 200"
}

step_r8_crown() { # ③ 보드 attempt 성공 → crown_award 왕관 유입 (§3.4)
  banner "11c r8-crown: 보드 정답 배치 attempt → crown_award"
  ensure_r8_user || { record "11c crown" "FAIL" "R8 유저 준비 실패"; return 0; }

  local out http body target
  out="$(http_get "$API/api/v1/board/puzzles" "$R8_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11c crown" "FAIL" "GET /board/puzzles http=$http"; return 0; }

  # 시드 goal_conditions가 [{zone:1, phenomenon:shower}]인 퍼즐 — 정답 배치는
  # board_test_vectors.json 공유 벡터(한랭전선 zone1 + 습기 75)로 안다.
  target="$("$PYTHON" -c '
import json, sys
for p in json.load(sys.stdin):
    goals = (p.get("template_json") or {}).get("goal_conditions")
    if goals == [{"zone": 1, "phenomenon": "shower"}]:
        print(p["content_item_id"]); break
' <<<"$body")"
  if [ -z "$target" ]; then
    record "11c crown" "SKIP" "zone1 shower 퍼즐이 시드에 없음 (정답 배치 유도 불가)"
    return 0
  fi
  echo "  대상 퍼즐: $target (goal: zone1 shower)"

  local state='{"board_state":{"zones":["서해","수도권","태백산맥","동해안"],"elements":[{"type":"front","subtype":"cold","zone":1},{"type":"moisture","level":75,"zone":1}]}}'
  out="$(http_post "$API/api/v1/board/puzzles/$target/attempt" "$state" "$R8_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11c crown" "FAIL" "attempt http=$http: $(head -c200 <<<"$body")"; return 0; }

  local check
  check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
if d.get("passed") is not True:
    print("bad: passed=%s (정답 배치인데 미통과 — 판정 회귀?)" % d.get("passed")); sys.exit()
if d.get("xp_earned") != 5:
    print("bad: xp_earned=%s (최초 클리어 기대 5)" % d.get("xp_earned")); sys.exit()
ca = d.get("crown_award")
if not isinstance(ca, dict) or not ca.get("unit_slug") or ca.get("crowns") != 1:
    print("bad: crown_award=%s (열린 board 유닛 왕관 +1 기대)" % ca); sys.exit()
print("ok|%s|crowns=%s cleared=%s" % (ca["unit_slug"], ca["crowns"], ca["cleared"]))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "11c crown" "FAIL" "$check"
    return 0
  fi
  echo "  attempt passed · +5 XP · crown_award: ${check#ok|}"
  record "11c crown" "OK" "정답 배치 통과 · crown_award ${check#ok|}"
}

step_r8_weak() { # ④ /progress/weak-tags 신 형태 (θ 파생, threshold 포함 — §3.5)
  banner "11d r8-weak: GET /progress/weak-tags → WeakConceptOut[] (threshold 포함)"
  ensure_user || { record "11d weak" "FAIL" "스모크 유저 가입 실패"; return 0; }

  fetch_weak() { http_get "$API/api/v1/progress/weak-tags" "$SMOKE_TOKEN"; }
  local out http body
  out="$(fetch_weak)"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11d weak" "FAIL" "GET /weak-tags http=$http"; return 0; }

  # 단독 실행 대비: 응답 이력이 없어 빈 목록이면 오답 1건 + 재발급(θ 재추정)으로 유도
  if [ "$(json_len "$body")" = "0" ]; then
    echo "· 약점 없음(응답 이력 없음) — 오답 1건 주입 후 θ 재추정 유도"
    local s_out s_body sid qid
    s_out="$(http_get "$API/api/v1/session/today" "$SMOKE_TOKEN")"
    [ "$(tail -n1 <<<"$s_out")" = "200" ] || { record "11d weak" "FAIL" "GET /session/today 실패"; return 0; }
    s_body="$(sed '$d' <<<"$s_out")"
    sid="$(json_field "$s_body" session_id)"
    qid="$("$PYTHON" -c '
import json, sys
items = json.load(sys.stdin)["items"]
picks = [i["quiz_id"] for i in items if i.get("question_type") != "board"]
print(picks[0] if picks else "")
' <<<"$s_body")"
    [ -n "$qid" ] || { record "11d weak" "SKIP" "비board 문항 없음 (재실행 시 다른 배합)"; return 0; }
    http_post "$API/api/v1/session/$sid/answer" "{\"quiz_id\":\"$qid\",\"answer\":\"smoke-wrong\"}" "$SMOKE_TOKEN" >/dev/null
    http_get "$API/api/v1/session/today" "$SMOKE_TOKEN" >/dev/null  # refresh_abilities 트리거
    out="$(fetch_weak)"
    http="$(tail -n1 <<<"$out")"
    body="$(sed '$d' <<<"$out")"
    [ "$http" = "200" ] || { record "11d weak" "FAIL" "재조회 http=$http"; return 0; }
  fi

  local check
  check="$("$PYTHON" -c '
import json, sys
rows = json.load(sys.stdin)
if not rows:
    print("bad: 오답 이후에도 약점 0건 (θ 파생 경로 확인 필요)"); sys.exit()
keys = {"concept_tag", "theta", "threshold", "num_responses"}
for r in rows:
    if not keys <= set(r):
        print("bad: 필드 누락 — %s" % sorted(r)); sys.exit()
    if not (r["theta"] < r["threshold"] and r["num_responses"] > 0):
        print("bad: 판정 위반 — %s" % r); sys.exit()
th = rows[0]["threshold"]
if not (0.3 < th < 0.5):  # middle_high: b(0.0)+logit(0.6)≈0.405
    print("bad: threshold=%s (middle_high 기대 ≈0.405)" % th); sys.exit()
thetas = [r["theta"] for r in rows]
if thetas != sorted(thetas):
    print("bad: θ 오름차순 위반 — %s" % thetas); sys.exit()
print("ok|%d건 threshold=%.3f" % (len(rows), th))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "11d weak" "FAIL" "$check"
    return 0
  fi
  echo "  weak-tags 신 형태 OK: ${check#ok|}"
  record "11d weak" "OK" "θ 파생 4필드·θ<threshold·오름차순 (${check#ok|})"
}

step_r8_tls() { # ⑤ 세션 board 문항 time_limit_sec 노출 (SA-5 화이트리스트)
  banner "11e r8-board-tls: 보드 유닛 세션 → board 문항 time_limit_sec 노출"
  ensure_r8_user || { record "11e board-tls" "FAIL" "R8 유저 준비 실패"; return 0; }

  # 열린 board 유닛(quiz 전부 클리어 픽스처로 잠금 해제됨) 첫 번째로 세션 발급
  local out http body board_slug
  out="$(http_get "$API/api/v1/curriculum" "$R8_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11e board-tls" "FAIL" "GET /curriculum http=$http"; return 0; }
  board_slug="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
for s in d["sections"]:
    for u in s["units"]:
        if u["kind"] == "board" and not u["locked"]:
            print(u["id"]); sys.exit()
' <<<"$body")"
  [ -n "$board_slug" ] || { record "11e board-tls" "SKIP" "열린 board 유닛 없음"; return 0; }

  out="$(http_post "$API/api/v1/curriculum/units/$board_slug/session" "{}" "$R8_TOKEN")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  [ "$http" = "200" ] || { record "11e board-tls" "FAIL" "유닛($board_slug) 세션 발급 http=$http"; return 0; }
  local sid exposed
  sid="$(json_field "$body" session_id)"
  # 계약: board 문항의 time_limit_sec는 item.template_json 안에 실린다
  # (BOARD_TEMPLATE_FIELDS 화이트리스트 — 프론트 AtmosphereBoard 소비 지점 동일)
  exposed="$("$PYTHON" -c '
import json, sys
items = json.load(sys.stdin)["items"]
boards = [i for i in items if i.get("question_type") == "board"]
with_tls = [
    i for i in boards
    if isinstance((i.get("template_json") or {}).get("time_limit_sec"), int)
    and i["template_json"]["time_limit_sec"] > 0
]
print("%d|%d" % (len(boards), len(with_tls)))
' <<<"$body")"
  local n_boards n_tls
  IFS='|' read -r n_boards n_tls <<<"$exposed"
  echo "  유닛($board_slug) 세션: board ${n_boards}건 중 time_limit_sec 노출 ${n_tls}건"
  if [ "$n_boards" = "0" ]; then
    record "11e board-tls" "SKIP" "세션에 board 문항 없음 (풀 확인 필요)"
    return 0
  fi
  if [ "$n_tls" != "0" ]; then
    record "11e board-tls" "OK" "board 문항 time_limit_sec 노출 (${n_tls}/${n_boards}건)"
    return 0
  fi
  # 노출 0건 — 원본 템플릿에 time_limit_sec가 있는 문항이 이 세션에 잡혔는지
  # psql로 판별해, 확률적 미포착(SKIP)과 화이트리스트 누락(FAIL)을 구분한다.
  local caught
  caught="$(psql_c "SELECT count(*) FROM quiz_logs ql JOIN content_items ci ON ci.id = ql.content_item_id
                    WHERE ql.session_id='$sid' AND ci.template_json ? 'time_limit_sec'")" || caught="?"
  if [ "$caught" = "0" ]; then
    record "11e board-tls" "SKIP" "time_limit_sec 있는 시드가 세션 풀에 안 잡힘 (확률적 — 재실행 시 변동)"
  else
    record "11e board-tls" "FAIL" "템플릿엔 time_limit_sec 있는데(${caught}건) 응답에 미노출 — 화이트리스트 회귀(SA-5)"
  fi
}

step_r8() {
  step_r8_spine
  step_r8_unitid
  step_r8_crown
  step_r8_weak
  step_r8_tls
}

# ── 12. r9: R9-01 duel 검증 4종 (브리핑·evidence·캐스터 등급·base_forecast) ──
# KMA 키 부재 환경 전제: 브리핑은 degraded(빈 배열·null)로 200을 유지해야 하고,
# 캐스터는 내부 폴백 base로 동작해야 한다. duel은 1일 1회(UNIQUE)라 새 유저로
# 제출한다(멱등 — 재실행 시 매번 고유 이메일).
step_r9() {
  banner "12 r9: duel briefing → 422 INVALID_EVIDENCE → submit(evidence) → base_forecast"

  register_user "smoke-r9"
  if [ "$REG_HTTP" != "201" ]; then
    record "12 r9" "FAIL" "가입 실패 http=$REG_HTTP (레이트리밋이면 잠시 후 재실행)"
    return 0
  fi
  local token="$REG_TOKEN"
  echo "  user_id=$REG_USER_ID"

  # ① GET /duel/briefing — 200 + 형태 (키 부재: hourly 빈 배열·today_observed null 허용)
  local out http body check
  out="$(http_get "$API/api/v1/duel/briefing" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "12 r9" "FAIL" "① GET /duel/briefing http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
keys = {"region", "target_date", "hourly", "today_observed", "recent_days"}
if not keys <= set(d):
    print("bad: 필드 누락 — %s" % sorted(d)); sys.exit()
if not isinstance(d["hourly"], list) or not isinstance(d["recent_days"], list):
    print("bad: hourly/recent_days가 배열이 아님"); sys.exit()
if d["today_observed"] is not None and not isinstance(d["today_observed"], dict):
    print("bad: today_observed 형태 위반 — %s" % d["today_observed"]); sys.exit()
print("ok|hourly=%d observed=%s recent=%d"
      % (len(d["hourly"]), "null" if d["today_observed"] is None else "obj", len(d["recent_days"])))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "12 r9" "FAIL" "① 브리핑 형태 위반 — $check"
    return 0
  fi
  echo "  ① briefing 200 + 형태 OK (${check#ok|} — 키 부재 degraded 허용)"

  # ② 미지 evidence 코드 → 422 INVALID_EVIDENCE (검증이 제출 가드보다 앞)
  out="$(http_post "$API/api/v1/duel/today" \
    '{"temp_max":27.5,"rain_prob":40,"evidence":["bogus_code"]}' "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "422" ] || ! grep -q "INVALID_EVIDENCE" <<<"$body"; then
    record "12 r9" "FAIL" "② 기대 422 INVALID_EVIDENCE, 실제 http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  echo "  ② 미지 evidence 코드 422 INVALID_EVIDENCE 확인"

  # ③ evidence 2종 동봉 제출 → 200 + caster_grade·evidence 노출
  out="$(http_post "$API/api/v1/duel/today" \
    '{"temp_max":27.5,"rain_prob":40,"evidence":["pop_trend","recent_rain"]}' "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ] && [ "$http" != "201" ]; then
    record "12 r9" "FAIL" "③ POST /duel/today http=$http: $(head -c200 <<<"$body")"
    return 0
  fi
  check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
if d.get("submitted") is not True:
    print("bad: submitted=%s" % d.get("submitted")); sys.exit()
if d.get("evidence") != ["pop_trend", "recent_rain"]:
    print("bad: evidence=%s" % d.get("evidence")); sys.exit()
grade = d.get("caster_grade")
if grade not in {"stratus", "cumulus", "nimbostratus", "cumulonimbus", "typhoon_eye"}:
    print("bad: caster_grade=%s (티어명 기대)" % grade); sys.exit()
ai = d.get("ai_pred") or {}
if not isinstance(ai.get("noise_scale"), (int, float)):
    print("bad: ai_pred.noise_scale=%s" % ai.get("noise_scale")); sys.exit()
print("ok|grade=%s scale=%s" % (grade, ai["noise_scale"]))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "12 r9" "FAIL" "③ 제출 응답 계약 위반 — $check"
    return 0
  fi
  echo "  ③ submit 200 + evidence 2종·caster_grade 노출 (${check#ok|})"

  # ④ GET /duel/today — base_forecast 필드 존재 (KMA 키 부재면 null 허용)
  out="$(http_get "$API/api/v1/duel/today" "$token")"
  http="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [ "$http" != "200" ]; then
    record "12 r9" "FAIL" "④ GET /duel/today http=$http"
    return 0
  fi
  check="$("$PYTHON" -c '
import json, sys
d = json.load(sys.stdin)
if "base_forecast" not in d:
    print("bad: base_forecast 필드 자체가 없음 (additive 계약 위반)"); sys.exit()
bf = d["base_forecast"]
if bf is not None and not ("temp_max" in bf and "rain_prob" in bf):
    print("bad: base_forecast 형태 위반 — %s" % bf); sys.exit()
print("ok|base_forecast=%s" % ("null" if bf is None else "obj"))
' <<<"$body")"
  if [[ "$check" != ok\|* ]]; then
    record "12 r9" "FAIL" "④ $check"
    return 0
  fi
  echo "  ④ GET /duel/today base_forecast 필드 존재 (${check#ok|})"

  record "12 r9" "OK" "브리핑 200·422 INVALID_EVIDENCE·evidence+caster_grade 노출·base_forecast 존재"
}

# ── 실행 ─────────────────────────────────────────────────────────────────────
STEP="${1:-all}"
case "$STEP" in
  up)        step_up ;;
  migrate)   step_migrate ;;
  seed)      step_seed ;;
  register)  step_register ;;
  guest)     step_guest ;;
  theta)     step_theta ;;
  rls)       step_rls ;;
  roundtrip) step_roundtrip ;;
  fallback)  step_fallback ;;
  placement) step_placement ;;
  unit)      step_unit ;;
  r8)        step_r8 ;;
  r9)        step_r9 ;;
  all)
    step_up
    if [ "$FAILED" -ne 0 ]; then
      echo ""
      echo "기동 실패 — 이후 단계는 실행하지 않습니다."
    else
      step_migrate
      step_seed
      step_register
      step_guest
      step_theta
      step_rls
      step_roundtrip
      step_fallback
      step_placement
      step_unit
      step_r8
      step_r9
    fi
    ;;
  *)
    echo "사용법: scripts/smoke.sh [up|migrate|seed|register|guest|theta|rls|roundtrip|fallback|placement|unit|r8|r9]" >&2
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

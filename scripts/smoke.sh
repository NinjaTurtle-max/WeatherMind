#!/usr/bin/env bash
# =============================================================================
# WeatherMind DB 왕복 스모크 — R7-01 S0 (docs/team/SPRINT_R7_01.md §3.4)
#
# 사용법:
#   scripts/smoke.sh             # 전체 단계 순차 실행 (1~8)
#   scripts/smoke.sh <단계>      # 특정 단계만: up | migrate | seed | register |
#                                #   theta | rls | roundtrip | fallback
#                                # (register 이후 단계는 필요 시 스스로 가입한다)
#
# 단계 (§3.4 계약 — 9단계 placement는 R7 웨이브 2에서 추가):
#   1 up        docker compose up -d --build postgres redis backend ai-worker
#               → /health 폴링 (8000·8001, 첫 빌드는 오래 걸리므로 타임아웃 넉넉히)
#   2 migrate   alembic upgrade head → current == 0006_weatherbrain (head)
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
  if grep -q "0006_weatherbrain" <<<"$current" && grep -q "(head)" <<<"$current"; then
    record "2 migrate" "OK" "current == 0006_weatherbrain (head)"
  else
    record "2 migrate" "FAIL" "current가 0006 head가 아님: $current"
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

# ── 실행 ─────────────────────────────────────────────────────────────────────
STEP="${1:-all}"
case "$STEP" in
  up)        step_up ;;
  migrate)   step_migrate ;;
  seed)      step_seed ;;
  all)
    step_up
    if [ "$FAILED" -ne 0 ]; then
      echo ""
      echo "기동 실패 — 이후 단계는 실행하지 않습니다."
    else
      step_migrate
      step_seed
    fi
    ;;
  *)
    echo "사용법: scripts/smoke.sh [up|migrate|seed]" >&2
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

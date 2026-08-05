#!/usr/bin/env bash
# =============================================================================
# WeatherMind DB 복원 — R11-01 웨이브 3 (docs/team/SPRINT_R11_01.md §7.0·§7.2 특칙)
#
# 사용법:
#   scripts/db_restore.sh <백업.dump>                 # 기본값 = 복원 리허설:
#       임시 DB(weathermind_rehearsal_<epoch>) 생성 → pg_restore → 실DB와
#       테이블 수·행 수 대조 출력 → 임시 DB DROP(항상, trap). 실DB는 SELECT만.
#   scripts/db_restore.sh <백업.dump> --target <db명>  # 신규 DB로 실복원:
#       <db명>이 이미 존재하면 거부 — 이 스크립트에 기존 DB를 덮는 경로는 없다.
#       운영 DB 전환(접속 문자열 교체 등)은 운영자/PM 몫(§7.2 되돌리기 어려운 작업).
#
# 백업 파일: 호스트 경로를 받는다. db-backup 서비스의 자동백업(db_backups 볼륨)은
#   먼저 꺼내서 쓴다:  docker compose cp db-backup:/backups/<파일> ./backups/
#   복원은 stdin 스트림으로 postgres 컨테이너에 전달한다(custom format 단일 스레드
#   복원은 stdin 허용 — 볼륨 공유 불필요).
#
# 대조 기준: 테이블 수(public BASE TABLE)는 일치해야 OK. 행 수는 백업 시점 이후
#   실DB가 변했을 수 있어 차이를 표기하되 경고로만 취급한다(직후 리허설이면 0 기대).
# 주의: .env 값(자격증명)은 변수로만 다루고 절대 출력하지 않는다. (smoke.sh 관례)
#
# 종료 코드: 복원 성공 + 테이블 수 일치 → 0, 그 외 1.
# =============================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "[db_restore] $*"; }

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
FILE="${1:-}"
MODE="rehearsal"
TARGET=""
if [ -z "$FILE" ]; then
  log "사용법: db_restore.sh <백업.dump> [--target <db명>]  (기본 = 임시 DB 리허설)"
  exit 1
fi
if [ "${2:-}" = "--target" ]; then
  MODE="target"
  TARGET="${3:-}"
  [ -n "$TARGET" ] || { log "FAIL: --target 뒤에 db명이 필요"; exit 1; }
fi
[ -f "$FILE" ] || { log "FAIL: 백업 파일 없음 — $FILE"; exit 1; }
[ -s "$FILE" ] || { log "FAIL: 백업 파일이 비어 있음 — $FILE"; exit 1; }

# ── .env 자격증명 (값 echo 금지 — smoke.sh env_val 관례) ────────────────────
env_val() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2-; }
PGUSER="$(env_val POSTGRES_USER 2>/dev/null || true)"
PGDB="$(env_val POSTGRES_DB 2>/dev/null || true)"
if [ -z "$PGUSER" ] || [ -z "$PGDB" ]; then
  log "FAIL: .env에 POSTGRES_USER/POSTGRES_DB 없음"
  exit 1
fi
docker compose version >/dev/null 2>&1 || { log "FAIL: docker compose v2 미설치"; exit 1; }

compose() { (cd "$ROOT" && docker compose "$@"); }
# psql 단문 (-tAq: 값만) — <db>를 지정해 실행. 로컬 소켓이라 비밀번호 불필요.
psql_db() { compose exec -T postgres psql -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 -tAq -c "$2"; }

# ── 복원 대상 DB 결정 + 안전 가드 ────────────────────────────────────────────
if [ "$MODE" = "target" ]; then
  DEST="$TARGET"
  if [ "$DEST" = "$PGDB" ]; then
    log "FAIL: --target이 실DB($PGDB)와 같다 — 이 스크립트는 실DB를 덮지 않는다"
    exit 1
  fi
else
  DEST="weathermind_rehearsal_$(date +%s)"
fi

exists="$(psql_db postgres "SELECT count(*) FROM pg_database WHERE datname='$DEST'")" || {
  log "FAIL: postgres 접속 실패 (compose postgres 기동 여부 확인)"
  exit 1
}
if [ "$exists" != "0" ]; then
  log "FAIL: DB '$DEST' 가 이미 존재 — 기존 DB를 덮는 경로는 없다"
  exit 1
fi

# 리허설 DB는 스크립트가 끝날 때 반드시 지운다 — 지우는 대상은 자기가 만든
# weathermind_rehearsal_* 이름뿐(가드). --target 모드는 지우지 않는다.
CLEANUP_DB=""
cleanup() {
  if [ -n "$CLEANUP_DB" ]; then
    case "$CLEANUP_DB" in
      weathermind_rehearsal_*)
        psql_db postgres "DROP DATABASE IF EXISTS \"$CLEANUP_DB\"" >/dev/null 2>&1 \
          && log "임시 DB DROP 완료: $CLEANUP_DB" \
          || log "경고: 임시 DB DROP 실패 — 수동 정리 필요: $CLEANUP_DB"
        ;;
    esac
  fi
}
trap cleanup EXIT

# ── 생성 + 복원 (stdin 스트림 — 볼륨 공유 불필요) ────────────────────────────
log "복원 대상 DB 생성: $DEST (모드: $MODE)"
psql_db postgres "CREATE DATABASE \"$DEST\"" >/dev/null || { log "FAIL: CREATE DATABASE 실패"; exit 1; }
[ "$MODE" = "rehearsal" ] && CLEANUP_DB="$DEST"

log "pg_restore 시작: $(basename "$FILE") → $DEST"
if ! compose exec -T postgres pg_restore -U "$PGUSER" -d "$DEST" \
    --no-owner --no-privileges --exit-on-error <"$FILE"; then
  log "FAIL: pg_restore 실패"
  exit 1
fi
log "pg_restore 완료"

# ── 검증: 테이블 수 + 테이블별 행 수를 실DB와 대조 ───────────────────────────
TBL_SQL="SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
live_tbl="$(psql_db "$PGDB" "$TBL_SQL")" || exit 1
rest_tbl="$(psql_db "$DEST" "$TBL_SQL")" || exit 1
log "테이블 수: 실DB($PGDB)=$live_tbl · 복원($DEST)=$rest_tbl"

tables="$(psql_db "$DEST" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")" || exit 1
drift=0
printf '%-36s %12s %12s %8s\n' "table" "live" "restored" "diff"
for t in $tables; do
  lc="$(psql_db "$PGDB" "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo '-')"
  rc="$(psql_db "$DEST" "SELECT count(*) FROM \"$t\"")"
  d="0"
  if [ "$lc" = "-" ]; then
    d="?"          # 실DB에 없는 테이블 (테이블 수 차이에서 이미 잡힘)
  elif [ "$lc" != "$rc" ]; then
    d=$((rc - lc))
    drift=$((drift + 1))
  fi
  printf '%-36s %12s %12s %8s\n' "$t" "$lc" "$rc" "$d"
done

if [ "$live_tbl" != "$rest_tbl" ]; then
  log "FAIL: 테이블 수 불일치 (실DB=$live_tbl, 복원=$rest_tbl)"
  exit 1
fi
if [ "$drift" -gt 0 ]; then
  log "경고: 행 수 차이 ${drift}개 테이블 — 백업 시점 이후 실DB 변경이면 정상"
else
  log "행 수: 전 테이블 일치"
fi

if [ "$MODE" = "target" ]; then
  log "OK: '$DEST' 복원 완료 (테이블 $rest_tbl개) — DB는 남겨 둠, 전환은 운영자 몫"
else
  log "OK: 복원 리허설 통과 (테이블 ${rest_tbl}개 일치) — 임시 DB는 곧 DROP"
fi
exit 0

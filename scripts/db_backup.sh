#!/usr/bin/env bash
# =============================================================================
# WeatherMind DB 백업 — R11-01 웨이브 3 (docs/team/SPRINT_R11_01.md §7.0 DB 자동백업)
#
# 사용법:
#   scripts/db_backup.sh            # 수동 1회 (호스트) — compose postgres에서
#                                   #   pg_dump(custom format) → ./backups/ 저장 + 회전
#   scripts/db_backup.sh once       # 위와 동일 (명시)
#   scripts/db_backup.sh loop       # db-backup 컨테이너 전용 (compose entrypoint) —
#                                   #   BACKUP_INTERVAL_SEC(기본 86400=일 1회)마다
#                                   #   pg_dump + 최신 BACKUP_KEEP(기본 7)개 회전
#
# 모드 판별: BACKUP_DIR 지정 + pg_dump 실행 파일이 있으면 컨테이너 직결(pg_dump -h),
#   아니면 호스트로 보고 docker compose exec -T postgres 경유. 산출물 이름은
#   weathermind_<YYYYmmdd_HHMMSS>.dump — 이름 정렬이 곧 시간 정렬이라 회전이 단순하다.
#
# 회전: weathermind_*.dump 만 대상 — 최신 BACKUP_KEEP개 초과분 삭제. 다른 파일은
#   건드리지 않는다. 볼륨·실DB 파괴 명령 없음(§7.2).
# 복원: scripts/db_restore.sh (기본값 = 임시 DB 리허설 — 실DB를 덮는 경로 없음).
# 주의: .env 값(자격증명)은 변수로만 다루고 절대 출력하지 않는다. (smoke.sh 관례)
#
# 종료 코드: once = 백업+회전 성공 0, 실패 1. loop = 실패해도 로그 후 다음 주기 계속.
# =============================================================================
set -u

MODE="${1:-once}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_INTERVAL_SEC="${BACKUP_INTERVAL_SEC:-86400}"
PREFIX="weathermind_"

log() { echo "[db_backup] $*"; }

# ── 컨테이너 직결 모드 여부 (compose db-backup 서비스가 BACKUP_DIR=/backups 지정) ──
in_container() { [ -n "${BACKUP_DIR:-}" ] && command -v pg_dump >/dev/null 2>&1; }

# ── 호스트 모드 준비: 리포 루트·.env 자격증명 (값 echo 금지 — smoke.sh env_val 관례) ──
host_init() {
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
  env_val() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2-; }
  PGUSER="$(env_val POSTGRES_USER 2>/dev/null || true)"
  PGDB="$(env_val POSTGRES_DB 2>/dev/null || true)"
  if [ -z "$PGUSER" ] || [ -z "$PGDB" ]; then
    log "FAIL: .env에 POSTGRES_USER/POSTGRES_DB 없음"
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log "FAIL: docker compose v2 미설치"
    return 1
  fi
  compose() { (cd "$ROOT" && docker compose "$@"); }
  return 0
}

# ── 백업 1회: pg_dump custom format → .part 임시 파일 → 성공 시에만 확정(mv) ──
do_backup() {
  local ts file tmp
  ts="$(date +%Y%m%d_%H%M%S)"
  file="$BACKUP_DIR/${PREFIX}${ts}.dump"
  tmp="${file}.part"
  mkdir -p "$BACKUP_DIR" || { log "FAIL: BACKUP_DIR 생성 불가 ($BACKUP_DIR)"; return 1; }

  if in_container; then
    # 컨테이너: postgres 서비스로 TCP 접속 (자격증명은 env_file .env 로 주입됨)
    if ! PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump -h "${PGHOST:-postgres}" \
        -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp"; then
      rm -f "$tmp"
      log "FAIL: pg_dump 실패 ($file)"
      return 1
    fi
  else
    # 호스트: postgres 컨테이너 안에서 pg_dump (로컬 소켓 — 비밀번호 불필요) 후 스트림
    if ! compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc >"$tmp"; then
      rm -f "$tmp"
      log "FAIL: docker compose exec pg_dump 실패 ($file)"
      return 1
    fi
  fi

  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    log "FAIL: 산출물이 비어 있음 ($file)"
    return 1
  fi
  mv "$tmp" "$file"
  log "OK: $file ($(du -h "$file" | cut -f1))"
  return 0
}

# ── 회전: weathermind_*.dump 이름 역순(=최신순) 정렬 → BACKUP_KEEP개 초과분 삭제 ──
rotate() {
  local old n=0
  # tail -n +K 는 POSIX — busybox(alpine)에서도 동작 (head -n -K 는 GNU 전용이라 회피)
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old"
    log "회전 삭제: $old"
    n=$((n + 1))
  done <<EOF
$(ls -1 "$BACKUP_DIR"/${PREFIX}*.dump 2>/dev/null | sort -r | tail -n +$((BACKUP_KEEP + 1)))
EOF
  log "회전 완료: 보존 ${BACKUP_KEEP}개 기준, ${n}개 삭제"
  return 0
}

# ── 모드 분기 ────────────────────────────────────────────────────────────────
case "$MODE" in
  once)
    in_container || host_init || exit 1
    do_backup || exit 1
    rotate
    ;;
  loop)
    in_container || { log "FAIL: loop 모드는 db-backup 컨테이너 전용 (BACKUP_DIR+pg_dump 필요)"; exit 1; }
    log "loop 시작: interval=${BACKUP_INTERVAL_SEC}s keep=${BACKUP_KEEP} dir=$BACKUP_DIR"
    while :; do
      do_backup || log "이번 주기 실패 — ${BACKUP_INTERVAL_SEC}s 후 재시도"
      rotate
      sleep "$BACKUP_INTERVAL_SEC"
    done
    ;;
  *)
    log "사용법: db_backup.sh [once|loop] (기본 once)"
    exit 1
    ;;
esac

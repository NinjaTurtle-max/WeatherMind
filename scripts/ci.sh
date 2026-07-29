#!/usr/bin/env bash
# =============================================================================
# WeatherMind 로컬 CI 파이프라인 — lint → test → config → (선택) frontend build
#
# 사용법:
#   scripts/ci.sh              # 전체 단계 순차 실행
#   scripts/ci.sh lint         # 특정 단계만 실행: lint | test | board | config | frontend
#   scripts/ci.sh smoke        # (opt-in) DB 왕복 스모크 — 기본 실행엔 미포함.
#                              # docker compose 기동·빌드가 필요해 오래 걸리므로
#                              # 통합·릴리스 전 단독 실행한다. docker 없으면 SKIP.
#
# 단계:
#   lint     pyflakes로 backend/app, ai-worker/app, celery/app 정적 검사.
#            pyflakes 미설치 시 설치 안내 후 SKIP (실패 아님).
#            설치: pip install pyflakes
#            주의: pyflakes는 noqa 주석을 인식하지 못하므로, 소스 줄에
#            "noqa"가 명시된 undefined-name 지적(SQLAlchemy 문자열
#            전방참조 등)은 여기서 걸러낸다.
#   test     backend/, ai-worker/ 각 디렉토리에서 python -m pytest tests -q.
#            pytest·서비스 의존성 미설치 시 안내 메시지와 함께 FAIL.
#            설치: pip install pytest -r backend/requirements.txt
#                  (ai-worker 테스트는 pydantic만 있으면 LLM 키 없이 동작)
#   board    프론트 board_engine 공유 벡터 검증 (R3-01 §4 / R5-01 §3.1).
#            node로 frontend/tests/boardEngine.vectors.test.mjs 직접 실행 —
#            node_modules 불필요(순수 stdlib + 로컬 src). node 미설치 시 SKIP.
#            시드 파일(board_rules·board_test_vectors) 부재 시 테스트가 스스로
#            SKIP(exit 0)하므로, node 존재 + 비0 = 실제 판정 불일치(FAIL).
#   config   docker compose config -q 로 compose 정합 검증.
#   frontend frontend/node_modules 있으면 npm run build, 없으면 SKIP.
#   smoke    (opt-in — `all`에 미포함) scripts/smoke.sh 전 단계(1~9) 위임 실행.
#            compose 기동 상태를 전제로 하지 않는다(스스로 up -d --build).
#
# 종료 코드: 모든 단계 OK/SKIP → 0, 하나라도 FAIL → 1.
# 근거: docs/team/TEAM_PROCESS.md §1.7 (CI는 lint → test → build 파이프라인)
# =============================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"

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

# ── 1. lint: pyflakes ────────────────────────────────────────────────────────
# pyflakes 출력에서 소스 줄에 noqa가 붙은 undefined-name 지적을 걸러낸다.
# 반환: 걸러낸 뒤에도 지적이 남으면 1, 없으면 0.
filter_noqa() {
  "$PYTHON" -c '
import re, sys
remaining = 0
for line in sys.stdin:
    m = re.match(r"^(.*?):(\d+):", line)
    if m and "undefined name" in line:
        try:
            src = open(m.group(1), encoding="utf-8").read().splitlines()[int(m.group(2)) - 1]
        except (OSError, IndexError):
            src = ""
        if "noqa" in src:
            continue
    sys.stdout.write(line)
    remaining = 1
sys.exit(remaining)
'
}

step_lint() {
  banner "lint: pyflakes"
  if ! "$PYTHON" -m pyflakes --version >/dev/null 2>&1; then
    echo "pyflakes 미설치 — 건너뜁니다. 설치: pip install pyflakes"
    record "lint" "SKIP" "pyflakes 미설치 (pip install pyflakes)"
    return 0
  fi
  local targets=("$ROOT/backend/app" "$ROOT/ai-worker/app" "$ROOT/celery/app")
  local errors=0
  for t in "${targets[@]}"; do
    echo "· pyflakes ${t#"$ROOT"/}"
    if ! "$PYTHON" -m pyflakes "$t" 2>&1 | filter_noqa; then
      errors=1
    fi
  done
  if [ "$errors" -ne 0 ]; then
    record "lint" "FAIL" "pyflakes 지적 사항 있음 (위 출력 참조)"
  else
    record "lint" "OK" "backend/app · ai-worker/app · celery/app 무결"
  fi
}

# ── 2. test: pytest (backend, ai-worker) ─────────────────────────────────────
run_pytest_in() { # run_pytest_in <서비스명> <디렉토리>
  local name="$1" dir="$2"
  echo "· $name: (cd $name && $PYTHON -m pytest tests -q)"
  if ! "$PYTHON" -m pytest --version >/dev/null 2>&1; then
    echo "  pytest 미설치 — 테스트를 실행할 수 없습니다."
    echo "  설치: pip install pytest -r $name/requirements.txt"
    record "test:$name" "FAIL" "pytest 미설치"
    return 0
  fi
  if (cd "$dir" && "$PYTHON" -m pytest tests -q); then
    record "test:$name" "OK" "pytest 통과"
  else
    echo "  실패 원인이 ModuleNotFoundError라면 서비스 의존성 미설치입니다."
    echo "  설치: pip install -r $name/requirements.txt"
    record "test:$name" "FAIL" "pytest 실패 (의존성 미설치면 requirements 설치)"
  fi
}

step_test() {
  banner "test: pytest"
  run_pytest_in "backend" "$ROOT/backend"
  run_pytest_in "ai-worker" "$ROOT/ai-worker"
}

# ── 3. board: 프론트 board_engine 공유 벡터 검증 ─────────────────────────────
# node 한 줄로 실행되는 순수 스크립트(node_modules 불필요). 프론트/백엔드가 같은
# database/seed/board_test_vectors.json을 읽으므로 판정 의미론 일치를 보증한다.
step_board() {
  banner "board: board_engine 공유 벡터 (node)"
  if ! command -v node >/dev/null 2>&1; then
    echo "node 미설치 — 건너뜁니다. (Node.js 설치 후 재실행)"
    record "board" "SKIP" "node 미설치"
    return 0
  fi
  if (cd "$ROOT/frontend" && node tests/boardEngine.vectors.test.mjs); then
    record "board" "OK" "board_engine 벡터 일치 (또는 시드 부재 시 자체 SKIP)"
  else
    record "board" "FAIL" "board_engine 벡터 불일치 (위 출력 참조)"
  fi
}

# ── 4. config: docker compose config -q ─────────────────────────────────────
step_config() {
  banner "config: docker compose config -q"
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose(v2) 미설치 — compose 정합을 검증할 수 없습니다."
    record "config" "FAIL" "docker compose v2 미설치"
    return 0
  fi
  if (cd "$ROOT" && docker compose config -q); then
    echo "docker-compose.yml 정합 OK"
    record "config" "OK" "compose 스키마·env 참조 정합"
  else
    record "config" "FAIL" "docker compose config 오류 (위 출력 참조)"
  fi
}

# ── 5. frontend (선택): node_modules 있으면 빌드 ─────────────────────────────
step_frontend() {
  banner "frontend: npm run build (선택)"
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "frontend/node_modules 없음 — 건너뜁니다. (cd frontend && npm install)"
    record "frontend" "SKIP" "node_modules 없음"
    return 0
  fi
  if (cd "$ROOT/frontend" && npm run build); then
    record "frontend" "OK" "vite build 성공"
  else
    record "frontend" "FAIL" "npm run build 실패 (위 출력 참조)"
  fi
}

# ── 6. smoke (opt-in): DB 왕복 스모크 — 기본 `all`에는 포함하지 않는다 ───────
# docker compose 기동·이미지 빌드까지 수행해 수 분이 걸리므로, 통합 브랜치나
# 릴리스 전 `scripts/ci.sh smoke`로 단독 실행한다 (docs/team/RUNBOOK.md).
step_smoke() {
  banner "smoke: scripts/smoke.sh (DB 왕복 1~9)"
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose(v2) 미설치 — 스모크를 건너뜁니다."
    record "smoke" "SKIP" "docker compose v2 미설치"
    return 0
  fi
  if bash "$ROOT/scripts/smoke.sh"; then
    record "smoke" "OK" "스모크 1~9 전 단계 통과"
  else
    record "smoke" "FAIL" "스모크 실패 (위 요약 참조)"
  fi
}

# ── 실행 ─────────────────────────────────────────────────────────────────────
STEP="${1:-all}"
case "$STEP" in
  lint)     step_lint ;;
  test)     step_test ;;
  board)    step_board ;;
  config)   step_config ;;
  frontend) step_frontend ;;
  smoke)    step_smoke ;;
  all)      step_lint; step_test; step_board; step_config; step_frontend ;;
  *)
    echo "사용법: scripts/ci.sh [lint|test|board|config|frontend|smoke]" >&2
    exit 2
    ;;
esac

# ── 요약 ─────────────────────────────────────────────────────────────────────
echo ""
echo "══ CI 요약 ══════════════════════════════════════════"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r name status note <<< "$row"
  printf "  %-14s %-5s %s\n" "$name" "$status" "$note"
done
if [ "$FAILED" -ne 0 ]; then
  echo "결과: FAIL (하나 이상 단계 실패)"
  exit 1
fi
echo "결과: OK"
exit 0

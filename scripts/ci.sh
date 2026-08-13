#!/usr/bin/env bash
# =============================================================================
# WeatherMind 로컬 CI 파이프라인 — lint → test → config → (선택) frontend build
#
# 사용법:
#   scripts/ci.sh              # 전체 단계 순차 실행
#   scripts/ci.sh lint         # 특정 단계만 실행: lint | test | board | config | frontend | seed | authoring
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
#   test     backend/, ai-worker/, celery/ 각 디렉토리에서 python -m pytest tests -q.
#            (세 서비스가 최상위 패키지명 `app`을 공유하므로 반드시 서브셸 분리 —
#             run_pytest_in의 (cd && pytest) 구조를 바꾸지 말 것.)
#            pytest·서비스 의존성 미설치 시 안내 메시지와 함께 FAIL.
#            설치: pip install pytest -r backend/requirements.txt
#                  (ai-worker 테스트는 pydantic만 있으면 LLM 키 없이 동작)
#   board    프론트 board_engine 공유 벡터 검증 (R3-01 §4 / R5-01 §3.1).
#            node로 frontend/tests/boardEngine.vectors.test.mjs 직접 실행 —
#            node_modules 불필요(순수 stdlib + 로컬 src). node 미설치 시 SKIP.
#            시드 파일(board_rules·board_test_vectors) 부재 시 테스트가 스스로
#            SKIP(exit 0)하므로, node 존재 + 비0 = 실제 판정 불일치(FAIL).
#   config   docker compose config -q 로 compose 정합 검증 — dev 단독 + prod 오버레이
#            (docker-compose.prod.yml) 양쪽. 파스만 하므로 컨테이너를 띄우지 않는다.
#   frontend frontend/node_modules 있으면 npm run build + 프론트 스모크 전 종목
#            (explore·session·placement·visual·gating·board-entry·assist·
#             webgl·overlay — FRONT_TESTS 배열이 목록), 없으면 SKIP.
#            새 test:* 스크립트를 만들면 FRONT_TESTS에 등록해야 CI가 지킨다.
#   seed     scripts/lint_seed_items.py를 **두 번** 호출한다 — 인자 없이(본시드
#            content_items.json 전건) + `--staging`(database/seed/staging 전건).
#            staging 쪽 제외 목록·해제 조건의 소유자는 그 스크립트의 STAGING_* 상수
#            하나이고, 목록이 실제 디렉터리와 어긋나면 backend
#            tests/test_level_vocabulary.py §5가 붉어진다(CO-SN2).
#   authoring scripts/author_items.py --dry-run 무키 완주. DB·키·네트워크 불필요.
#            G1(ROADMAP §5.3.1)에서 실키로 돌릴 스크립트라 무키 완주가 회귀 대상이다.
#   smoke    (opt-in — `all`에 미포함) scripts/smoke.sh 전 단계(1~12) 위임 실행.
#            compose 기동 상태를 전제로 하지 않는다(스스로 up -d --build).
#
# 종료 코드: 모든 단계 OK/SKIP → 0, 하나라도 FAIL → 1.
# 근거: docs/team/TEAM_PROCESS.md §1.7 (CI는 lint → test → build 파이프라인)
#
# ⚠️ **여기 단계를 추가하면 .github/workflows/ci.yml에 잡도 추가해야 한다.** 빠뜨리면
# 로컬에서만 도는 게이트가 된다(seed가 실제로 그랬다 — CO-J-1). 단계↔잡 패리티와
# 위 사용법 문안의 정합은 backend `tests/test_ci_workflow_contract.py`가 감시한다.
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
  # celery(CO-J-11): 테스트 디렉토리가 없어 pyflakes 외 게이트가 0이었다. 실DB·브로커
  # 없이 도는 단위 테스트만 두는 것이 전제(다른 두 서비스와 같은 관례).
  run_pytest_in "celery" "$ROOT/celery"
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

# ── 4. config: docker compose config -q (dev + prod 오버레이) ────────────────
# prod 오버레이(docker-compose.prod.yml)는 실배포에서 쓰는 형상인데 어떤 게이트도
# 파스조차 하지 않았다(CO-J-6). `!reset` 문법은 compose ≥2.24가 필요하므로 버전이
# 낮으면 여기서 잡힌다 — 배포 당일 서버에서 처음 발견하는 것보다 낫다.
# `config -q`는 **파스만** 한다(컨테이너 기동 없음). 실행 시간 1초 미만.
step_config() {
  banner "config: docker compose config -q (dev + prod 오버레이)"
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose(v2) 미설치 — compose 정합을 검증할 수 없습니다."
    record "config" "FAIL" "docker compose v2 미설치"
    return 0
  fi
  local bad=()
  if (cd "$ROOT" && docker compose config -q); then
    echo "docker-compose.yml 정합 OK"
  else
    bad+=("dev")
  fi
  # prod는 dev 위에 얹는 오버레이라 두 파일을 함께 준다(단독으로는 서비스 정의 불완전).
  if (cd "$ROOT" && docker compose -f docker-compose.yml -f docker-compose.prod.yml config -q); then
    echo "docker-compose.prod.yml 오버레이 정합 OK"
  else
    bad+=("prod")
  fi
  if [ "${#bad[@]}" -ne 0 ]; then
    record "config" "FAIL" "docker compose config 오류: ${bad[*]} (위 출력 참조)"
  else
    record "config" "OK" "dev + prod 오버레이 스키마·env 참조 정합"
  fi
}

# ── 5. frontend (선택): node_modules 있으면 빌드 + 프론트 스모크 전 종목 ──────
# test:explore(R9-01 §3.5) 등 렌더 스모크가 react/vite에 의존하므로 board 단계
# (node_modules 불필요)가 아니라 여기서 빌드와 함께 실행한다.
#
# 종목 목록(FRONT_TESTS)은 frontend/package.json의 test:* 스크립트와 짝이다 —
# 새 스모크를 추가하면 **여기에도 등록**해야 CI가 그 계약을 지킨다.
# (R10-01 웨이브 2에서 gating·board-entry·assist·webgl·overlay 5종 편입:
#  웨이브 1~S5에서 추가됐지만 CI에 없어 회귀를 잡지 못하던 공백이었다.)
#   explore     탐구 시뮬 + 렌더 스모크            session     세션 러너 렌더
#   placement   배치고사 진입                      visual      보드 레이아웃 계약·강수 엔진·보드 비주얼 SSR
#   gating      온보딩 점진적 잠금 해제            board-entry 보드 진입 게이트(구름 잔량 차단)
#   assist      보드 언두·점진적 힌트 유지         webgl       단면 3D 드로우콜 예산·SCENES↔STORYBOARDS 정합
#   overlay     지도 오버레이 정점·좌표 경계·파티클 상한·FLOW_META 사본 대조
#   learn-path  학습 경로: 완료 구간이 섹션 경계를 넘음·노드 aria 라벨·구름 0 차단
#   home        홈 대시보드: / ↔ /learn 분리·내비 단일 소유·출석 소유자·요일 채움
#   mascot      마스코트 정렬: PNG 투명 여백 0 · object-contain · 호출부 가로세로
#   duel        예보 대결 배치: 2열·격자 항목 최소폭·오른쪽 열 sticky·태풍이 튜터
#   home-entry  홈 진입 통합(R13 §2.5): 진입 카드 1개·우선순위 3분기·보조 강등
#   hint-character 보드 힌트 교사 캐릭터(R13 §2.6): 단계별 표정 전환·문구 불변
#   session-retry 만회 라운드(R13 §2.1)·만회 상한 5(§2.11)·완료 화면 블록 구분
#                 표기(§2.10)·예보 마감 단계(A-1 노출/미노출)
#   detective   기후 탐정(R13 CO-N-2): /explore 진입 카드·단서 하한 미만 제출 잠금·
#               상세 응답에 해설/피드백 미노출·판정의 aria-live announce·0건 빈 상태
# board_engine 공유 벡터(test:board)는 node_modules 없이 도는 전용 `board` 단계가
# 소유하므로 여기서 중복 실행하지 않는다.
FRONT_TESTS=(explore explore-goals session session-blocks placement visual gating board-entry assist webgl overlay i18n ui-copy course-select guest-convert review-queue region learn-path home home-entry mascot duel hint-character session-retry detective knowledge-level onboarding-save guide-bot)

step_frontend() {
  banner "frontend: build + 스모크 ${#FRONT_TESTS[@]}종 (선택)"
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "frontend/node_modules 없음 — 건너뜁니다. (cd frontend && npm install)"
    record "frontend" "SKIP" "node_modules 없음"
    return 0
  fi
  if ! (cd "$ROOT/frontend" && npm run build); then
    record "frontend" "FAIL" "vite build 실패 (위 출력 참조)"
    return 0
  fi
  local bad=()
  for t in "${FRONT_TESTS[@]}"; do
    echo "· npm run test:$t"
    if ! (cd "$ROOT/frontend" && npm run "test:$t"); then
      bad+=("$t")
    fi
  done
  if [ "${#bad[@]}" -ne 0 ]; then
    record "frontend" "FAIL" "build OK · 테스트 실패: ${bad[*]} (위 출력 참조)"
  else
    record "frontend" "OK" "vite build + 스모크 ${#FRONT_TESTS[@]}종 통과 (${FRONT_TESTS[*]})"
  fi
}

# ── 6. seed: 시드 문항 lint (스키마·게이트·payload·중복·학령 금칙 어휘) ────
# 저작 산출물이 CI에서 상시 검증되게 한다 — R13 §2.3에서 학령 금칙 어휘 규칙이
# 추가되며, 이 검사가 없으면 전공 용어가 저학령 문항에 다시 새어든다.
#
# **본시드 + staging 두 번 돈다**(CO-SN2, 2026-08-10). 종전에는 인자 없이 한 번만
# 불러 `database/seed/staging/`을 **아무도 보지 않았다** — 저작이 staging에서 시작해
# 본시드로 승격되는 구조라, 게이트가 승격 뒤에만 걸리면 잘못된 문항이 이미 본시드에
# 들어온 다음에야 걸린다. 제외 목록(문항 파일이 아닌 2건 + knowledge_level 미부여로
# 한시 제외 2건)과 그 해제 조건은 `scripts/lint_seed_items.py`의 STAGING_* 상수가
# 단독 소유하고, 그 목록이 실제 디렉터리와 어긋나면
# `backend/tests/test_level_vocabulary.py` §5가 붉어진다.
#
# ⚠️ **단계를 새로 만들지 않았다.** 단계 하나 = ci.yml 잡 하나이고 그 패리티를
# `backend/tests/test_ci_workflow_contract.py`가 감시한다(CO-J-1: seed 단계가 잡 없이
# 로컬에서만 돌던 사고). staging 검사는 seed 단계 **안**에서 두 번째 명령으로 돈다.
step_seed() {
  banner "seed: lint_seed_items (본시드 전건 + staging 전건)"
  local bad=()
  "$PYTHON" "$ROOT/scripts/lint_seed_items.py" || bad+=("본시드")
  "$PYTHON" "$ROOT/scripts/lint_seed_items.py" --staging || bad+=("staging")
  if [ "${#bad[@]}" -ne 0 ]; then
    record "seed" "FAIL" "시드 lint 위반: ${bad[*]} (위 출력 참조)"
  else
    record "seed" "OK" "본시드·staging 전건 통과 (스키마·게이트·payload·중복·금칙 어휘)"
  fi
}

# ── 6. authoring: 저작 배치 무키 완주 (dry-run) ─────────────────────────────
# `scripts/author_items.py`는 G1(ROADMAP §5.3.1)에서 **실키로 돌릴 유일한 스크립트**다.
# 그날 처음 실행되는 상황을 피하려면 무키 완주 자체가 회귀 대상이어야 한다 —
# DB·키·네트워크 없이 2초 안에 끝나므로 기본 `all`에 넣는다.
# --dry-run이 기본값이라 시드를 건드리지 않는다(계약 P-3).
step_authoring() {
  banner "authoring: author_items.py --dry-run (무키 완주)"
  if [ ! -f "$ROOT/scripts/author_items.py" ]; then
    record "authoring" "FAIL" "scripts/author_items.py 없음"
    return 0
  fi
  if "$PYTHON" "$ROOT/scripts/author_items.py" --dry-run --count 3; then
    record "authoring" "OK" "무키 dry-run 완주 (생성→게이트→payload 계약→중복→리포트)"
  else
    record "authoring" "FAIL" "저작 배치 dry-run 실패 (위 출력 참조)"
  fi
}

# ── 7. smoke (opt-in): DB 왕복 스모크 — 기본 `all`에는 포함하지 않는다 ───────
# docker compose 기동·이미지 빌드까지 수행해 수 분이 걸리므로, 통합 브랜치나
# 릴리스 전 `scripts/ci.sh smoke`로 단독 실행한다 (docs/team/RUNBOOK.md).
step_smoke() {
  banner "smoke: scripts/smoke.sh (DB 왕복 1~12)"
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose(v2) 미설치 — 스모크를 건너뜁니다."
    record "smoke" "SKIP" "docker compose v2 미설치"
    return 0
  fi
  if bash "$ROOT/scripts/smoke.sh"; then
    record "smoke" "OK" "스모크 1~12 전 단계 통과"
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
  seed)     step_seed ;;
  authoring) step_authoring ;;
  smoke)    step_smoke ;;
  all)      step_lint; step_test; step_board; step_config; step_frontend; step_seed; step_authoring ;;
  *)
    echo "사용법: scripts/ci.sh [lint|test|board|config|frontend|seed|authoring|smoke]" >&2
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

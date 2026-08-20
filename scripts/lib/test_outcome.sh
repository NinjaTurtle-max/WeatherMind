#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 종목 하나가 어떻게 끝났는지 **갈래로** 판정한다.
#
# 🔴 왜 생겼나(2026-08-20, FU-18 · 클라이언트 지시 *"점검 도구가 「틀렸다」와
#    「안 돌았다」를 갈라 보고하게 고쳐"*).
#
#    종전 `ci.sh`의 frontend 단계는 종목 **이름만** 모아
#    「테스트 실패: home guest-convert」라고 적었다. 그래서 성격이 다른 셋이
#    한 문장으로 뭉개졌다:
#      · 단정이 틀렸다        (파일은 돌았다 — 고칠 곳이 분명하다)
#      · **파일이 안 돌았다** (SyntaxError·모듈 로드 실패 — 그 파일의 계약이 통째로 없다)
#      · 돌다가 죽었다        (일부만 검사됐다)
#
#    실제 사고: 병합 중 닫는 중괄호 하나가 빠져 `learnPath`가 **로드조차 안 됐는데**
#    `FAIL` 줄이 없어서 「알려진 흔들림」으로 오진할 뻔했다. 「초록」이 아니라
#    **「아무것도 안 돌았다」**였고, 흔들림으로 읽었으면 그 파일의 계약을 통째로
#    잃은 채 배포했을 것이다.
#
# 🔴 **판별 근거를 종료코드로 두지 않는다** — 위 셋이 전부 비0이다.
#    결정적인 것은 **출력에 판정 줄(PASS/FAIL)이 몇 개 있었나**다:
#      PASS 0 · FAIL 0 · 비0 종료 ⇒ **안 돌았다**
#
# ⚠️ 호출부는 반드시 `NO_COLOR=1`로 종목을 돌릴 것. ANSI 색상코드가 줄 앞에 끼면
#    아래 정규식이 판정 줄을 못 읽는다(A조가 실제로 그것 때문에 이름을 놓쳤다).
# ─────────────────────────────────────────────────────────────────────────────

# 판정 줄 세기 — 색이 남아 있어도 견디도록 ESC 시퀀스를 먼저 벗긴다(2차 방어).
_outcome_strip_ansi() {
  sed -e 's/'$'\033''\[[0-9;]*[A-Za-z]//g' "$1"
}

_outcome_count() { # _outcome_count <logfile> <PASS|FAIL>
  _outcome_strip_ansi "$1" | grep -cE "^[[:space:]]*$2([[:space:]]|:)" || true
}

# TAP·node --test 등 다른 하네스도 「돌았다」로 인정한다 — 우리 스모크는 PASS/FAIL을
# 쓰지만, 종목이 러너를 갈아타도 「안 돌았다」로 오진하지 않게 한다.
_outcome_ran_other() { # <logfile>
  _outcome_strip_ansi "$1" | grep -cE "^[[:space:]]*(ok |not ok |# (pass|fail)|[✔✖✓✗])" || true
}

# 안 돌았다는 **증거**가 출력에 있으면 그 낱말을 돌려준다(원인을 요약에 싣기 위해).
outcome_nostart_reason() { # <logfile>
  local t
  t="$(_outcome_strip_ansi "$1")"
  case "$t" in
    *SyntaxError*)                 echo "SyntaxError" ;;
    *ERR_MODULE_NOT_FOUND*)        echo "모듈 없음" ;;
    *"Cannot find module"*)        echo "모듈 없음" ;;
    *ERR_AMBIGUOUS_MODULE_SYNTAX*) echo "모듈 형식 충돌" ;;
    *"Missing script"*)            echo "npm 스크립트 없음" ;;
    *)                             echo "" ;;
  esac
}

# ── 본체 ─────────────────────────────────────────────────────────────────────
# classify_test_outcome <종료코드> <로그파일>
#   ok        정상 종료
#   fail:<n>  단정 n건 실패 (파일은 돌았다)
#   dead:<n>  PASS n건 뒤 예외로 중단 (일부만 검사됐다)
#   nostart   판정 줄이 하나도 없다 — **아무것도 안 돌았다**
classify_test_outcome() {
  local code="$1" log="$2" p f other
  p="$(_outcome_count "$log" PASS)"
  f="$(_outcome_count "$log" FAIL)"
  other="$(_outcome_ran_other "$log")"
  if [ "$code" -eq 0 ]; then echo "ok"; return 0; fi
  if [ "$f" -gt 0 ]; then echo "fail:$f"; return 0; fi
  if [ "$p" -gt 0 ] || [ "$other" -gt 0 ]; then echo "dead:$p"; return 0; fi
  echo "nostart"
}

# describe_test_outcome <종목명> <갈래> <로그파일> → 요약 한 조각
describe_test_outcome() {
  local name="$1" kind="$2" log="$3" reason
  case "$kind" in
    fail:*)  echo "$name(단정 ${kind#fail:}건 실패)" ;;
    dead:*)  echo "$name(🔴 ${kind#dead:}건 뒤 죽었다 — 나머지는 검사 안 됐다)" ;;
    nostart)
      reason="$(outcome_nostart_reason "$log")"
      if [ -n "$reason" ]; then
        echo "$name(🔴 안 돌았다 — $reason · 이 파일의 계약이 통째로 비었다)"
      else
        echo "$name(🔴 안 돌았다 — 판정 줄 0 · 이 파일의 계약이 통째로 비었다)"
      fi
      ;;
    *)       echo "$name" ;;
  esac
}

# ── 한 종목을 **돌리고 판정까지** ────────────────────────────────────────────
# run_suite_outcome <종목명> <로그디렉터리> <명령...>
#   · 출력은 콘솔로 그대로 흘리면서 로그 사본을 남긴다 — 사람이 보는 것과 도구가
#     세는 것이 **같은 출력**이어야 한다.
#   · `OUTCOME_KIND`(갈래)와 `OUTCOME_LINE`(요약 조각)을 전역에 남긴다.
#   · 반환: 정상 0, 그 밖 1.
#
# ⚠️ 호출부의 `for` 루프가 아니라 **여기**가 시험 대상이다. 파이프라인 종료코드를
#    `PIPESTATUS[0]`로 집는 자리가 조용히 틀리기 쉬워서(그러면 전부 「ok」가 된다)
#    루프에 두지 않고 함수로 꺼냈다.
run_suite_outcome() {
  local name="$1" logdir="$2"; shift 2
  local log="$logdir/$name.log"
  NO_COLOR=1 "$@" 2>&1 | tee "$log"
  local code="${PIPESTATUS[0]}"
  OUTCOME_KIND="$(classify_test_outcome "$code" "$log")"
  OUTCOME_LINE="$(describe_test_outcome "$name" "$OUTCOME_KIND" "$log")"
  [ "$OUTCOME_KIND" = "ok" ] && return 0
  return 1
}

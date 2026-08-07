#!/usr/bin/env bash
# 사용자 프롬프트와 서브에이전트 입력 프롬프트를 날짜별 md 파일에 기록한다.
# 호출: log-prompt.sh user   (UserPromptSubmit hook)
#       log-prompt.sh agent  (PreToolUse / Agent|Task hook)
# 어떤 경우에도 툴 실행을 막지 않도록 항상 exit 0 으로 끝낸다.

SRC="${1:-unknown}"
BASE="${CLAUDE_PROJECT_DIR:-$PWD}"
LOG_DIR="$BASE/.claude/prompt-logs"
mkdir -p "$LOG_DIR" 2>/dev/null

DAY="$(date '+%Y-%m-%d')"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
LOG_FILE="$LOG_DIR/$DAY.md"

# 새 날짜 파일이면 제목 헤더를 넣는다.
if [ ! -f "$LOG_FILE" ]; then
  printf '# 프롬프트 기록 — %s\n' "$DAY" > "$LOG_FILE"
fi

input="$(cat)"

if [ "$SRC" = "user" ]; then
  prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)"
  [ -z "$prompt" ] && exit 0
  {
    printf '\n\n---\n\n## 👤 사용자 프롬프트 — %s\n\n' "$TS"
    printf '%s\n' "$prompt"
  } >> "$LOG_FILE"
elif [ "$SRC" = "agent" ]; then
  prompt="$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty' 2>/dev/null)"
  [ -z "$prompt" ] && exit 0
  atype="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // "?"' 2>/dev/null)"
  desc="$(printf '%s' "$input" | jq -r '.tool_input.description // ""' 2>/dev/null)"
  {
    printf '\n\n---\n\n## 🤖 서브에이전트 프롬프트 (%s) — %s\n' "$atype" "$TS"
    [ -n "$desc" ] && printf '**작업:** %s\n' "$desc"
    printf '\n%s\n' "$prompt"
  } >> "$LOG_FILE"
fi

exit 0

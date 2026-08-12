#!/usr/bin/env bash
#
# 주최측 사전교육 PDF 3종을 **git 히스토리에서** 제거한다 (이월 CO-E-0 / 스프린트 S-3).
#
# ⚠️⚠️ 이 스크립트는 되돌릴 수 없다. 읽지 않고 실행하지 말 것. ⚠️⚠️
#
# ────────────────────────────────────────────────────────────────────────────
# 무슨 일이 일어나는가 — git 용어가 아니라 평서문으로
# ────────────────────────────────────────────────────────────────────────────
# · 저장소의 **모든 커밋이 새로 쓰인다**. 커밋 번호(SHA)가 전부 바뀐다.
# · 그래서 **열려 있는 PR이 전부 무효가 된다.** 병합 전이라면 먼저 병합할 것.
# · 원격에 반영하려면 **force push**가 필요하고, 다른 사람이 받아 간 사본은
#   전부 어긋난다. 이 저장소는 1인 작업이라 그 위험은 낮지만 0은 아니다.
# · 워킹트리의 `ai_OT자료/` **파일 자체는 건드리지 않는다**(이미 추적 해제 +
#   .gitignore 등재 상태다). 지우는 것은 **과거 커밋 안의 사본**이다.
#
# ────────────────────────────────────────────────────────────────────────────
# 왜 하는가
# ────────────────────────────────────────────────────────────────────────────
# 주최측이 배포한 사전교육 자료 3종이 과거 커밋에 들어간 채 남아 있다.
# `02b7dfe`가 추적을 해제했지만 **블롭은 히스토리에 그대로**다:
#   git rev-list --objects --all | grep -i pdf   → 3건
# 제출물 ② 소스 zip에 `.git`이 들어가면 그 3종이 함께 나간다.
#
# ⚠️ **급하지 않다**: zip을 `git archive`나 워킹트리에서 만들면 `.git`이 안
#    들어가므로 블롭도 안 나간다. 이 스크립트는 **근본 제거**용이지, 제출을
#    막고 있는 것이 아니다. 그 사실을 알고 실행 시점을 고를 것.
#
# ────────────────────────────────────────────────────────────────────────────
# 리허설 기록 (2026-08-13, 복제본에서 실측)
# ────────────────────────────────────────────────────────────────────────────
#   PDF 블롭      3 → 0        ✅
#   커밋 수       660 → 660    ✅ (하나도 안 잃는다)
#   추적 파일     559 → 559    ✅ (목록 diff 0줄)
#   HEAD SHA      0d697fe → 7a11fa6   ← **바뀐다**. 이것이 PR을 무효화한다
#
# ────────────────────────────────────────────────────────────────────────────
# 실행 방법
# ────────────────────────────────────────────────────────────────────────────
#   bash scripts/remove_pdf_history.sh --yes-i-understand-this-rewrites-history
#
# 인자 없이 실행하면 아무것도 하지 않고 안내만 출력한다.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${1:-}" != "--yes-i-understand-this-rewrites-history" ]]; then
  cat <<'MSG'
아무것도 하지 않았습니다.

이 스크립트는 git 히스토리를 다시 씁니다 — 모든 커밋 번호가 바뀌고,
열려 있는 PR이 무효가 되며, 되돌릴 수 없습니다.

실행하려면:
  bash scripts/remove_pdf_history.sh --yes-i-understand-this-rewrites-history

먼저 확인할 것:
  1. 열린 PR이 전부 병합됐는가
  2. 저장소 전체 백업을 떴는가  →  cp -r . ../backup-$(date +%s)
  3. 이 파일 위쪽 주석을 읽었는가
MSG
  exit 0
fi

echo "==> 1/4 백업"
BACKUP="../backup-pdf-history-$(date +%s)"
cp -r . "$BACKUP"
echo "    백업 완료: $BACKUP"

echo "==> 2/4 제거 전 상태"
BEFORE_BLOBS=$(git rev-list --objects --all | grep -ciE '\.pdf|OT자료' || true)
BEFORE_COMMITS=$(git log --oneline --all | wc -l | tr -d ' ')
BEFORE_FILES=$(git ls-files | wc -l | tr -d ' ')
echo "    PDF 블롭 $BEFORE_BLOBS · 커밋 $BEFORE_COMMITS · 추적 파일 $BEFORE_FILES"

echo "==> 3/4 히스토리 재작성"
git filter-repo --force --invert-paths --path "ai_OT자료/"

echo "==> 4/4 검증"
AFTER_BLOBS=$(git rev-list --objects --all | grep -ciE '\.pdf|OT자료' || true)
AFTER_COMMITS=$(git log --oneline --all | wc -l | tr -d ' ')
AFTER_FILES=$(git ls-files | wc -l | tr -d ' ')
echo "    PDF 블롭 $BEFORE_BLOBS → $AFTER_BLOBS"
echo "    커밋     $BEFORE_COMMITS → $AFTER_COMMITS"
echo "    추적파일 $BEFORE_FILES → $AFTER_FILES"

if [[ "$AFTER_BLOBS" != "0" ]]; then
  echo "❌ 블롭이 남았습니다. 백업($BACKUP)에서 복구하십시오." >&2
  exit 1
fi
if [[ "$AFTER_COMMITS" != "$BEFORE_COMMITS" || "$AFTER_FILES" != "$BEFORE_FILES" ]]; then
  echo "❌ 커밋·파일 수가 달라졌습니다. 백업($BACKUP)에서 복구하십시오." >&2
  exit 1
fi

cat <<MSG

✅ 히스토리에서 PDF 3종이 제거됐습니다.

⚠️ 아직 원격에는 반영되지 않았습니다. filter-repo가 origin 리모트를 떼어
   냈으므로 다시 붙여야 합니다:

     git remote add origin git@github.com:NinjaTurtle-max/WeatherMind.git
     git push --force --all
     git push --force --tags

   force push 전에 **열린 PR이 없는지** 다시 확인하십시오.
   백업: $BACKUP
MSG

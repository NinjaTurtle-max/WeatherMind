#!/usr/bin/env python3
"""객관식 보기 순서를 섞는다 — MT-15 (2026-08-11 멘토링 피드백).

**왜 도구가 필요한가.** 처음에는 일회성 스크립트로 시드를 고치고 결과만 커밋했다.
그러면 결과를 재현할 수도, 다음 저작 배치에 다시 돌릴 수도 없다 —
그 배치는 다시 전건 1번으로 들어오고, 45% 게이트가 우연히 걸릴 때까지 아무도
모른다. 이 결함이 3.7배로 자란 경로가 정확히 그것이었다(코드 리뷰 2026-08-12).

**왜 결정적인가.** 문항 본문 해시를 시드로 쓴다. 랜덤이면 돌릴 때마다 diff가
생겨 무엇이 바뀐 건지 추적이 끊기고, 골든 회귀 파일이 매번 깨진다.

**건드리지 않는 것 셋** — 순서를 섞으면 안 되는 문항이 있다:

⑴ **해설이 선지를 서수로 가리키는 문항.** `explanation_hint`는 학습자에게 그대로
   서빙되는데(`answer_service` 우선순위 ②) 「세 번째 선지는 오독이다」 같은 문장은
   순서를 섞는 순간 다른 선지를 가리킨다. 실제로 이 도구의 전신이 9건을 깨뜨렸고
   **3건은 정답을 오독이라고 말했다** — 맞힌 학습자에게 틀렸다고 가르친다.
   `--remap-hints`를 주면 서수를 새 자리로 옮기고, 아니면 그 문항을 건너뛴다.
⑵ **「둘 다 아니다」류 선지가 있는 문항.** 앞의 선지들을 가리키는 말이라 첫 자리로
   가면 가리킬 대상이 없다. 관례대로 마지막에 고정한다.
⑶ **골든 회귀 파일**(`r13_template_proof.json`). 확장 산출물이라 소스에서
   재생성해야 한다 — 직접 고치면 `test_expand_template` 3건이 깨진다(실제로 겪었다).

사용:
    python scripts/shuffle_answer_positions.py --check          # 진단만
    python scripts/shuffle_answer_positions.py --write          # 본시드+staging
    python scripts/shuffle_answer_positions.py --write --remap-hints
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SEED = REPO / "database" / "seed" / "content_items.json"
STAGING = REPO / "database" / "seed" / "staging"

# 확장 산출물이라 직접 고치지 않는다 — 소스(r13_item_templates.json)에서 재생성한다.
GOLDEN = {"r13_template_proof.json"}

# 앞 선지들을 가리키는 말 — 자리를 옮기면 뜻이 깨진다. 마지막에 고정한다.
ANCHOR_LAST = ("둘 다", "모두 아니", "모두 옳", "위의 어느", "해당 없")

ORDINAL_VARIANTS = {
    1: ("첫 번째", "첫번째", "1번", "①"),
    2: ("두 번째", "두번째", "2번", "②"),
    3: ("세 번째", "세번째", "3번", "③"),
    4: ("네 번째", "네번째", "4번", "④", "마지막 선지", "마지막 보기"),
}
_SLOT_OF = {v: k for k, vs in ORDINAL_VARIANTS.items() for v in vs}
_ORDINAL_RE = re.compile(
    "|".join(
        re.escape(v) for vs in ORDINAL_VARIANTS.values() for v in sorted(vs, key=len, reverse=True)
    )
)
_ORD_NAME = {1: "첫 번째", 2: "두 번째", 3: "세 번째", 4: "네 번째"}


def _rank(option, question_text: str) -> str:
    """정렬 키 — **보기 내용**에서 파생한다(자리 번호가 아니라).

    ⚠️ 이것이 멱등성의 전부다. 처음에는 인덱스로 순서를 뽑았는데(`{seed}:{i}`),
    그러면 결과가 **현재 순서에 의존**해서 두 번 돌리면 또 섞인다 — 실제로
    561건이 재차 바뀌었다. 매 배치마다 시드 전체에 diff가 생기고, 무엇이 새로
    저작된 것이고 무엇이 재정렬된 것인지 구분이 사라진다.
    내용으로 키를 만들면 **입력이 어떤 순서든 같은 출력**이 나온다.
    """
    seed = int(hashlib.sha256(str(question_text).encode()).hexdigest()[:8], 16)
    return hashlib.sha256(f"{seed}:{option}".encode()).hexdigest()


def place_answer(options: list, answer, question_text: str, target_slot: int) -> list:
    """정답이 `target_slot`(1-based)에 오도록 배치한다 — 나머지는 내용 해시 순서.

    ⚠️ **왜 순수 해시 셔플로는 부족한가.** 문항마다 독립적으로 섞으면 큰 파일에서는
    고르지만 **작은 파일에서 우연히 쏠린다** — 실측으로 26건짜리 파일이 한 자리에
    14건(53.8%)까지 몰렸다. 그 파일만 승격되면 결함이 그대로 남는다. 자리를 파일
    단위로 **배정**하면 표본이 작아도 균등이 보장되고, 배정 순서 자체를 문항
    해시로 정하므로 결과는 여전히 결정적·멱등이다.

    앵커 선지(「둘 다 아니다」류)는 앞의 선지들을 가리키는 말이라 끝에 고정한다 —
    첫 자리로 가면 가리킬 대상이 없다.
    """
    anchored = [o for o in options if any(a in str(o) for a in ANCHOR_LAST)]
    movable = [o for o in options if o not in anchored and o != answer]
    ordered = sorted(movable, key=lambda o: _rank(o, question_text))
    slot = max(1, min(target_slot, len(options) - len(anchored)))
    return ordered[: slot - 1] + [answer] + ordered[slot - 1 :] + anchored


def remap_hint(hint: str, old_options: list, new_options: list) -> str:
    """해설 속 서수를 새 자리로 옮긴다.

    ⚠️ 치환은 **한 번에** 한다. 순차로 바꾸면 이미 바꾼 것을 다시 바꿔서
    (2→3, 3→2일 때 「두 번째」가 「세 번째」를 거쳐 「두 번째」로 되돌아온다) 조용히 원위치한다.
    """
    move = {
        oi: new_options.index(opt) + 1
        for oi, opt in enumerate(old_options, 1)
        if opt in new_options
    }
    return _ORDINAL_RE.sub(
        lambda m: _ORD_NAME.get(move.get(_SLOT_OF[m.group(0)], 0), m.group(0)), hint
    )


def hint_uses_ordinals(hint: str) -> bool:
    return bool(hint) and bool(_ORDINAL_RE.search(hint))


def process(path: Path, *, write: bool, remap_hints: bool) -> tuple[int, int]:
    """(순서를 바꾼 건수, 해설 때문에 건너뛴 건수)."""
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return (0, 0)
    if not isinstance(items, list):
        return (0, 0)

    # 대상을 먼저 모아 **자리를 균등 배정**한다. 배정 순서는 문항 해시라, 파일 안
    # 순서가 바뀌어도(저작 추가·재정렬) 같은 문항은 같은 자리를 받는다.
    targets, skipped = [], 0
    for item in items:
        if not isinstance(item, dict) or item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options, answer = template.get("options"), template.get("correct_answer")
        if not options or answer not in options:
            continue
        if hint_uses_ordinals(str(template.get("explanation_hint") or "")) and not remap_hints:
            skipped += 1
            continue
        targets.append(template)
    targets.sort(key=lambda t: _rank("", t.get("question_text", "")))

    moved = 0
    for i, template in enumerate(targets):
        options, answer = template["options"], template["correct_answer"]
        anchors = sum(1 for o in options if any(a in str(o) for a in ANCHOR_LAST))
        slots = max(1, len(options) - anchors)
        hint = str(template.get("explanation_hint") or "")
        new_options = place_answer(
            options, answer, template.get("question_text", ""), (i % slots) + 1
        )
        if new_options == options:
            continue
        if hint_uses_ordinals(hint):
            template["explanation_hint"] = remap_hint(hint, options, new_options)
        template["options"] = new_options
        moved += 1

    if moved and write:
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return (moved, skipped)


def report(path: Path) -> str:
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return ""
    if not isinstance(items, list):
        return ""
    pos = collections.Counter()
    for item in items:
        if not isinstance(item, dict) or item.get("question_type") != "multiple_choice":
            continue
        t = item.get("template_json") or {}
        o, a = t.get("options"), t.get("correct_answer")
        if o and a in o:
            pos[o.index(a) + 1] += 1
    total = sum(pos.values())
    if not total:
        return ""
    worst = max(pos.values()) / total
    dist = " ".join(f"{k}:{pos[k]}" for k in sorted(pos))
    return f"{path.name:38s} mc {total:4d}  [{dist}]  최대 {worst:.1%}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="객관식 보기 순서 셔플 (MT-15)")
    ap.add_argument("--write", action="store_true", help="파일에 반영(미지정 시 진단만)")
    ap.add_argument("--remap-hints", action="store_true",
                    help="해설의 서수를 새 자리로 옮긴다(미지정 시 그 문항을 건너뛴다)")
    ap.add_argument("--check", action="store_true", help="현재 분포만 출력")
    args = ap.parse_args(argv)

    targets = [SEED] + sorted(p for p in STAGING.glob("*.json") if p.name not in GOLDEN)

    if args.check or not args.write:
        for p in targets:
            line = report(p)
            if line:
                print(line)
        if not args.write:
            print("\n(반영하려면 --write. 해설 서수까지 옮기려면 --remap-hints)")
        return 0

    total_moved = total_skipped = 0
    for p in targets:
        moved, skipped = process(p, write=True, remap_hints=args.remap_hints)
        if moved or skipped:
            note = f" · 해설 서수로 건너뜀 {skipped}" if skipped else ""
            print(f"{p.name}: {moved}건{note}")
        total_moved += moved
        total_skipped += skipped

    print(f"\n순서 변경 {total_moved}건 · 건너뜀 {total_skipped}건")
    if total_skipped:
        print("⚠️ 건너뛴 문항은 해설이 선지를 서수로 가리킨다 — --remap-hints로 함께 옮기거나 "
              "해설을 내용 참조로 고쳐 저작할 것.")
    print("⚠️ 골든(r13_template_proof.json)은 제외했다. 템플릿 소스를 고쳤다면 "
          "author_items.py --expand-templates 로 재생성할 것.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""쌍둥이 문항(CO-Y-9) **후보를 좁힌다** — 판정은 사람이 한다.

## 왜 있나

중복 게이트의 dedupe 키는 `(유형 · 개념태그 · 정답)`이다. 그래서 **같은 사실을
태그만 달리 붙여 두 벌 넣으면 영원히 통과한다.** 대장 §1.1e-2가 이 유형을 실물로
1건 잡았고, 그때 *"1,000건 규모에서 몇 건인지는 아무도 모른다 — 전수 조사는 정답
문자열이 아니라 질문의 사실 내용을 봐야 해서 기계로 닫히지 않는다"*고 적혔다.

**닫는 것은 기계로 안 되지만 후보를 좁히는 것은 된다.** 이 스크립트가 그 몫이다:
1,018건을 사람이 읽을 수 없으니 **읽어야 할 조를 몇 조로** 만든다(2026-08-18 실측:
4조 → 그중 확정 결함 2건).

## 왜 이 키인가 — 1차 시도가 틀린 자리

처음에는 `(유형 · 정답)`으로 묶었다. 46조가 나왔고 **거짓 양성이었다**: slider 정답
`25`, ordering 정답 `0,1,2,3`처럼 **정답 공간이 좁은 유형은 무관한 문항끼리 부딪힌다**
(열대야 25℃와 단열 감률 계산이 같은 조에 들어왔다).

⇒ **수치 정답의 일치는 같은 문항의 증거가 아니다.** 그래서 정답이 **낱말·구절**인
것만 본다. 그 일치는 우연이 아니다. 대신 본문 유사도를 함께 재어 순위를 만든다.

## 무엇을 세지 않나 (일부러)

- **유형이 다른 쌍**은 결함으로 보지 않는다 — 같은 정의를 multiple_choice와 cloze로
  각각 보는 것은 중복이 아니라 형식을 바꾼 반복이다. 표시는 하되 판정은 사람 몫이다.
- **실황 슬롯 정답**(`{today.*}`)은 따로 묶는다. 정답이 같은 것이 당연하므로 같은
  자에 올리면 안 된다 — 대신 **몇 벌이 같은 슬롯을 정답으로 쓰는지**를 보고한다.

사용: `python scripts/find_twin_items.py [--min-sim 0.4] [--file <path>]`
"""
from __future__ import annotations

import argparse
import collections
import difflib
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SEED = ROOT / "database/seed/content_items.json"

NUMERIC_ONLY = re.compile(r"^[-\d.,\s]+$")
LIVE_SLOT = re.compile(r"\{today\.(\w+)\}")


def _norm(value: object) -> str:
    """공백을 지우고 NFKC로 정규화 — 서식 차이를 같은 문항으로 보게 한다."""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def _answer(item: dict) -> str | None:
    answer = item.get("template_json", {}).get("correct_answer")
    if not isinstance(answer, str) or not answer.strip():
        return None
    return _norm(answer)


def _question(item: dict) -> str:
    return _norm(item.get("template_json", {}).get("question_text", ""))


def _label(index: int, item: dict) -> str:
    return "[%d] kl%-2s %-16s %-14s %s" % (
        index,
        item.get("knowledge_level"),
        item.get("concept_tag"),
        item.get("question_type", "")[:14],
        item.get("template_json", {}).get("question_text", "")[:72],
    )


def find_pairs(items: list[dict], min_sim: float) -> tuple[list, list]:
    """(사람이 읽을 조, 실황 슬롯 묶음)을 돌려준다."""
    by_answer: dict[str, list[int]] = collections.defaultdict(list)
    live: dict[tuple[str, str], list[int]] = collections.defaultdict(list)

    for index, item in enumerate(items):
        answer = _answer(item)
        if answer is None:
            continue                        # board 등 정답 없는 유형
        if LIVE_SLOT.search(answer):
            live[(item.get("question_type", ""), answer)].append(index)
            continue                        # 실황은 따로 본다
        if NUMERIC_ONLY.match(answer):
            continue                        # 수치 일치는 증거가 아니다
        by_answer[answer].append(index)

    pairs = []
    for answer, idxs in by_answer.items():
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                i, j = idxs[a], idxs[b]
                sim = difflib.SequenceMatcher(
                    None, _question(items[i]), _question(items[j])
                ).ratio()
                if sim < min_sim:
                    continue
                same_type = items[i].get("question_type") == items[j].get("question_type")
                same_tag = items[i].get("concept_tag") == items[j].get("concept_tag")
                pairs.append((sim, answer, i, j, same_type, same_tag))

    pairs.sort(reverse=True)
    return pairs, {k: v for k, v in live.items() if len(v) > 1}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=str(DEFAULT_SEED))
    parser.add_argument("--min-sim", type=float, default=0.4,
                        help="본문 유사도 하한. 0.4 미만은 사실이 달라 읽을 값이 없었다(실측)")
    args = parser.parse_args()

    items = json.loads(pathlib.Path(args.file).read_text(encoding="utf-8"))
    pairs, live = find_pairs(items, args.min_sim)

    print("── find_twin_items ─────────────────────────────────────────")
    print("대상        : %s (%d문항)" % (args.file, len(items)))
    print("유사도 하한 : %.2f" % args.min_sim)
    print()

    strong = [p for p in pairs if p[4]]         # 유형까지 같은 쌍 = 진짜 후보
    weak = [p for p in pairs if not p[4]]

    print("🔴 유형·정답이 같고 본문이 닮은 쌍: %d조 — **읽어야 한다**" % len(strong))
    for sim, answer, i, j, _, same_tag in strong:
        note = "" if same_tag else "  ← 태그만 다르다(게이트 사각)"
        print("  ── 유사도 %.2f · 정답 %r%s" % (sim, answer[:26], note))
        print("     %s" % _label(i, items[i]))
        print("     %s" % _label(j, items[j]))

    print()
    print("· 정답은 같지만 **유형이 다른** 쌍: %d조 — 형식을 바꾼 반복이라 기본 무해"
          % len(weak))
    for sim, answer, i, j, _, _ in weak:
        print("  ── 유사도 %.2f · 정답 %r" % (sim, answer[:26]))
        print("     %s" % _label(i, items[i]))
        print("     %s" % _label(j, items[j]))

    print()
    print("· 실황 슬롯을 정답으로 쓰는 묶음(정답 일치는 당연 — 슬롯 편중을 본다)")
    for (qtype, answer), idxs in sorted(live.items(), key=lambda kv: -len(kv[1])):
        tags = [items[i].get("concept_tag") for i in idxs]
        bands = [items[i].get("level_group") for i in idxs]
        print("  %s %s → %d벌" % (qtype[:12], answer[:20], len(idxs)))
        print("     태그 %s" % tags)
        print("     밴드 %s" % bands)

    print("────────────────────────────────────────────────────────────")
    print("판정은 사람이 한다 — 이 스크립트는 **탈락시키지 않는다**(종료코드 0 고정).")
    print("같은 사실이면 하나를 재저작하고, 형식만 다르면 그대로 둔다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

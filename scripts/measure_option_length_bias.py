#!/usr/bin/env python3
"""「가장 긴 선지를 찍는다」 전략의 적중률을 잰다 — **진척을 잴 수 있게** 한다.

## 왜 있나

객관식 정답이 오답보다 뚜렷하게 길면 학습자가 **내용을 몰라도** 고를 수 있다. 이 결함
유형은 어휘 게이트·사실성 게이트가 **구조적으로 못 본다**(낱말도 사실도 문제가 없다).
그런데 **기계로는 잴 수 있다** — 그래서 이 스크립트가 있다.

2026-08-19 실측: 전체 **63.5%** · 상위 4칸(kl7~10) **72.0%** · 무작위 **25%**.
⇒ 아무것도 모르는 학습자가 객관식의 절반 넘게 맞힌다. 판단은 대장 §5.24.

## 세는 법 — 동률을 적중에서 뺀다

정답이 최장이지만 **다른 선지와 길이가 같으면** 「가장 긴 것」이 유일하지 않으므로
그 전략이 정답을 집어내지 못한다. 그래서 **엄격 적중**(유일 최장 = 정답)만 센다 —
값을 부풀리지 않기 위해서다. 동률은 따로 보고한다.

## 처방은 정답을 줄이는 것이 아니다

전문가 문항의 정답은 **기제를 서술해야 하므로 길어지는 것이 자연스럽다.** 결함은
**오답이 짧다**는 것이고, 오답도 기제 모양이어야 학습자가 **내용으로** 갈라야 한다.
정답을 줄이면 설명이 사라진다.

⚠️ **탈락시키지 않는다**(종료코드 0 고정). 게이트로 쓰면 정답이 길 수밖에 없는 정당한
문항까지 막는다. 판정은 사람이 한다.

사용: `python scripts/measure_option_length_bias.py [--file <path>]`
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SEED = ROOT / "database/seed/content_items.json"


def band(kl: int | None) -> str:
    return "kl7~10 (상위)" if (kl or 0) >= 7 else "kl1~6 (하위)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=str(DEFAULT_SEED))
    args = parser.parse_args()

    items = json.loads(pathlib.Path(args.file).read_text(encoding="utf-8"))

    # [엄격 적중, 동률(정답이 최장이나 유일하지 않음), 전체, 무작위 기대합]
    stat: dict[str, list[float]] = collections.defaultdict(lambda: [0, 0, 0, 0.0])
    for item in items:
        if item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options = template.get("options") or []
        answer = template.get("correct_answer")
        if len(options) < 2 or answer not in options:
            continue
        lengths = [len(str(o)) for o in options]
        longest = max(lengths)
        is_longest = len(str(answer)) == longest
        unique = lengths.count(longest) == 1

        key = band(item.get("knowledge_level"))
        stat[key][0] += 1 if (is_longest and unique) else 0
        stat[key][1] += 1 if (is_longest and not unique) else 0
        stat[key][2] += 1
        stat[key][3] += 1.0 / len(options)

    print("── measure_option_length_bias ─────────────────────────────")
    print("대상: %s" % args.file)
    print()
    print("%-16s %-14s %-8s %-8s %s"
          % ("구간", "엄격 적중", "동률", "전체", "적중률 vs 무작위"))
    total = [0, 0, 0, 0.0]
    for key in sorted(stat):
        hit, tie, n, exp = stat[key]
        for i, v in enumerate((hit, tie, n, exp)):
            total[i] += v
        print("%-16s %-14d %-8d %-8d **%.1f%%** vs %.1f%%"
              % (key, hit, tie, n, 100 * hit / n, 100 * exp / n))
    hit, tie, n, exp = total
    print("%-16s %-14d %-8d %-8d **%.1f%%** vs %.1f%%"
          % ("전체", hit, tie, n, 100 * hit / n, 100 * exp / n))
    print()
    print("목표는 무작위(보기 수의 역수)에 가까워지는 것이다 — **오답을 기제 모양으로**")
    print("늘려서. 정답을 줄이면 설명이 사라진다(대장 §5.24 · 이월 P-13).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

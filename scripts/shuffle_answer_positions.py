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

# ⚠️ 변형에는 **명사를 넣지 않는다.** 「마지막 선지」처럼 명사를 품은 변형을 두면
# 아래 `_OPTION_NOUNS` 접미와 겹쳐 「마지막 선지 선지」를 요구하게 되어 **영원히
# 매칭되지 않는다**(코드 리뷰 2026-08-12). 「①번 선지」류도 변형에 「①」만 두면
# 치환 결과가 「두 번째번 선지」로 깨지므로 번호형은 「1번」 형태까지 변형에 담는다.
ORDINAL_VARIANTS = {
    1: ("첫 번째", "첫번째", "①번", "1번", "①"),
    2: ("두 번째", "두번째", "②번", "2번", "②"),
    3: ("세 번째", "세번째", "③번", "3번", "③"),
    4: ("네 번째", "네번째", "④번", "4번", "④", "마지막"),
}
_SLOT_OF = {v: k for k, vs in ORDINAL_VARIANTS.items() for v in vs}

# ⚠️ **문맥 가드가 이 정규식의 핵심이다.** 서수만 보고 선지 참조로 단정하면
# 본문의 서수까지 바꿔 버린다 — 실제로 「빠져나갈 곳이 없어 **두 번째 몫**을 크게
# 키운다」를 「네 번째 몫」으로 망가뜨렸다. 여기서 '몫'은 선지가 아니라 앞 문장이
# 든 **물리적 기여분**(기압 상승분·바람 밀어쌓기) 둘 중 두 번째다. 넷이 없는데
# 네 번째를 가리키니 문장이 뜻을 잃는다. `explanation_hint`는 학습자에게 그대로
# 나가므로(answer_service 우선순위 ②) 이건 곧 오답 해설이다.
# 그래서 **바로 뒤에 선지를 뜻하는 말이 오는 경우만** 옮긴다.
_OPTION_NOUNS = r"(?:\s*(?:선지|보기|답지|번\s*선지))"
_ORDINAL_RE = re.compile(
    "(?:"
    + "|".join(
        re.escape(v) for vs in ORDINAL_VARIANTS.values() for v in sorted(vs, key=len, reverse=True)
    )
    + ")"
    + _OPTION_NOUNS
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

    ⚠️ **자리는 문항 해시가 정한다**(`process`가 계산해 넘긴다). 파일 안 순번으로
    배정하면 균등은 보장되지만 **항목 하나 추가에 뒤가 전부 밀려** 1,000건 중
    207건이 재배치된다 — 매 배치마다 시드 전체에 diff가 나고 그 잡음 속에서 손으로
    고친 해설이 조용히 되돌아간다. 그래서 diff 안정성을 택했다.

    **대가를 정직하게 적는다**: 해시 배정은 통계적 균등이라 **작은 파일에서 쏠릴 수
    있다**(실측 `au1_weather_items.json` 7건 중 57%, `w1_kl4_pm.json` 10건 중 60%).
    분포 계약이 표본 20건 미만을 건너뛰므로 그 구간은 감시 밖이다. 본시드는 311건
    이라 25.4%로 고르고, 작은 staging 파일은 승격되면 본시드 안에서 다시 섞인다 —
    그래서 이 대가를 받아들였다. 균등이 꼭 필요해지면 파일 단위 배정으로 돌아가되
    diff 폭증을 함께 감수해야 한다.

    앵커 선지(「둘 다 아니다」류)는 앞의 선지들을 가리키는 말이라 끝에 고정한다 —
    첫 자리로 가면 가리킬 대상이 없다.
    """
    # 정답 자체가 앵커면 **건드리지 않는다.** 옮기면 앵커가 앞으로 나와 가리킬
    # 대상이 사라지고, 앵커 목록에서 빼지 않으면 정답이 두 번 실려 보기가 하나
    # 늘어난다(실측: 3지선다가 4지선다가 됐다 — 코드 리뷰 2026-08-12).
    if any(a in str(answer) for a in ANCHOR_LAST):
        return list(options)
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
    def _swap(m: "re.Match") -> str:
        token = m.group(0)
        # 매치는 「세 번째 선지」처럼 서수+명사다. 서수 부분만 갈고 명사는 보존한다.
        for variant, slot in _SLOT_OF.items():
            if token.startswith(variant):
                new_slot = move.get(slot)
                if new_slot is None or new_slot not in _ORD_NAME:
                    return token  # 매핑을 모르면 **건드리지 않는다**
                return _ORD_NAME[new_slot] + token[len(variant) :]
        return token

    return _ORDINAL_RE.sub(_swap, hint)


# 서수가 **명사 없이** 쓰인 경우까지 잡는다 — 「두 번째와 세 번째는 각각 …」처럼
# 「선지」를 안 붙이는 해설이 실제로 있다. 이건 옮길 수 없으므로(본문의 서수와
# 구분이 안 된다) 그런 문항은 **순서를 아예 안 바꾼다** — 해설이 계속 맞는다.
_BARE_ORDINAL_RE = re.compile(
    "|".join(
        re.escape(v) for vs in ORDINAL_VARIANTS.values() for v in sorted(vs, key=len, reverse=True)
    )
)
WRONG_CONTEXT = ("오독", "잘못", "아니", "혼동", "설명이다", "기준이다", "것이고", "것이다", "헷갈")


def hint_contradicts(hint: str, options: list, answer) -> bool:
    """해설이 **정답 자리**를 오답이라 말하는가.

    셔플 뒤 이 검사를 통과 못 하면 그 문항은 되돌린다 — 위치가 고르게 퍼지는
    이득보다 **맞힌 학습자에게 틀렸다고 가르치는 손해**가 훨씬 크다.
    """
    if not hint or not options or answer not in options:
        return False
    correct = options.index(answer) + 1
    for match in _BARE_ORDINAL_RE.finditer(hint):
        variant = match.group(0)
        if _SLOT_OF.get(variant) != correct:
            continue
        around = hint[max(0, match.start() - 10) : match.start() + 45]
        if any(w in around for w in WRONG_CONTEXT):
            return True
    return False


def hint_uses_ordinals(hint: str) -> bool:
    """해설이 선지를 자리로 가리키는가 — **옮길 수 있는** 형태만 본다."""
    return bool(hint) and bool(_ORDINAL_RE.search(hint))


def hint_has_bare_ordinal(hint: str) -> bool:
    """**옮길 수 없는** 서수가 있는가 — 「두 번째와 세 번째는 각각 …」처럼 명사가 없는 것.

    ⚠️ 이 함수가 없으면 그런 해설이 **조용히 망가진다.** 명사 가드가 붙은
    `_ORDINAL_RE`는 이런 문장을 못 잡으므로 `hint_uses_ordinals`가 False를 내고,
    그러면 순서만 바뀌고 해설은 「두 번째」인 채로 남아 다른 선지를 가리킨다.
    주석에는 "그런 문항은 안 바꾼다"고 적어 놓고 실제로 그렇게 하는 코드가
    없었다(코드 리뷰 2026-08-12).

    본문의 서수(「두 번째 몫」)와 구분할 방법이 없으므로 **순서를 아예 안 바꾼다** —
    그러면 해설이 계속 맞는다. 위치가 고르게 퍼지는 이득보다 틀린 해설의 손해가 크다.
    """
    if not hint:
        return False
    stripped = _ORDINAL_RE.sub("", hint)  # 옮길 수 있는 것은 걷어내고
    return bool(_BARE_ORDINAL_RE.search(stripped))  # 남은 서수가 있으면 못 옮긴다


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
    targets, skipped, skipped_bare = [], 0, 0
    for item in items:
        if not isinstance(item, dict) or item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options, answer = template.get("options"), template.get("correct_answer")
        if not options or answer not in options:
            continue
        hint = str(template.get("explanation_hint") or "")
        # 옮길 수 없는 서수가 있으면 `--remap-hints`가 켜져 있어도 **건너뛴다**.
        if hint_has_bare_ordinal(hint):
            skipped_bare += 1
            continue
        if hint_uses_ordinals(hint) and not remap_hints:
            skipped += 1
            continue
        targets.append(template)
    moved = 0
    for template in targets:
        options, answer = template["options"], template["correct_answer"]
        anchors = sum(1 for o in options if any(a in str(o) for a in ANCHOR_LAST))
        slots = max(1, len(options) - anchors)
        hint = str(template.get("explanation_hint") or "")
        # ⚠️ 자리를 **문항 해시**에서 정한다. 파일 안 순번(i % slots)으로 정하면
        # 항목 하나만 추가해도 뒤의 모든 문항이 밀려 **1,000건 중 207건의 순서가
        # 바뀐다**(실측). 그러면 다음 저작 배치마다 시드 전체에 diff가 나고, 그
        # 잡음 속에서 손으로 고친 해설이 조용히 되돌아간다.
        # 파일을 가로질러도 같은 문항은 같은 자리를 받으므로, 본시드와 staging에
        # 중복된 문항이 **서로 다른 순서**를 갖는 문제도 함께 사라진다 —
        # 승격이 손으로 고친 해설을 덮어쓰던 경로가 그것이었다.
        slot = int(_rank(answer, template.get("question_text", ""))[:8], 16) % slots + 1
        new_options = place_answer(options, answer, template.get("question_text", ""), slot)
        if new_options == options:
            continue
        new_hint = remap_hint(hint, options, new_options) if hint else hint
        # ⚠️ **바꾸기 전에 결과를 확인한다.** 서수를 옮길 수 없는 해설이 있어서
        # (「두 번째와 세 번째는 각각 …」처럼 「선지」를 안 붙인 문장) 순서만
        # 바뀌면 해설이 정답을 오답이라 가리키게 된다. 그런 문항은 되돌린다 —
        # 위치가 고르게 퍼지는 이득보다 맞힌 학습자에게 틀렸다고 가르치는 손해가
        # 훨씬 크다. 실제로 그 상태로 커밋됐다가 리뷰가 잡았다(2026-08-12).
        if hint_contradicts(new_hint, new_options, answer):
            skipped_bare += 1  # 사유가 다르다 — 아래 안내 문구가 갈린다
            continue
        if new_hint != hint:
            template["explanation_hint"] = new_hint
        template["options"] = new_options
        moved += 1

    if moved and write:
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return (moved, skipped + skipped_bare)


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
        # 사유가 둘이고 처방이 다르다 — 하나로 뭉뚱그리면 틀린 안내가 된다.
        # `--remap-hints`를 이미 켠 사람에게 "그 옵션을 쓰라"고 말하던 문구였다.
        print("⚠️ 건너뛴 문항은 해설이 선지를 자리로 가리킨다:")
        print("   · 「세 번째 **선지**」처럼 명사가 붙은 것 → --remap-hints로 함께 옮긴다")
        print("   · 「두 번째와 세 번째는 각각 …」처럼 명사가 없는 것 → **옮길 수 없다**. "
              "본문의 서수와 구분이 안 되므로 순서를 바꾸지 않는다. "
              "해설을 내용 참조로 고쳐 저작하면 다음 실행에서 풀린다.")
    print("⚠️ 골든(r13_template_proof.json)은 제외했다. 템플릿 소스를 고쳤다면 "
          "author_items.py --expand-templates 로 재생성할 것.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

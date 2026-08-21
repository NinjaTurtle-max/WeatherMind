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
# ⚠️ **「선택지」가 빠져 있었다**(2026-08-18 발견 · KEEP). 그 한 낱말 때문에
# 「… 두 번째 **선택지**는 방향이 반대다」가 **명사 없는 서수**로 오분류돼, 자리 참조를
# 보는 층 전부에서 조용히 빠졌다 — 그 문항은 **정답이 2번인데 해설이 2번을 틀렸다고
# 말했다**(`concept_tag=typhoon` · `knowledge_level=7` · 1-기준 [575]).
# 후보를 추측으로 늘리지 않는다: mc 해설 310건을 훑어 실제로 쓰이는 것만 넣었다
# (2026-08-18 실측 — 선지 10건 · 보기 1건 · **선택지 1건** · 그 밖의 후보
# 「항목」·「진술」·「답지」는 서수 뒤에 **0건**).
# ⚠️ **여기가 「어휘」이고 판정이 아니다.** 2026-08-19에 극성 판정(⑥ⓐ)은 절제됐지만
# 이 낱말은 남는다 — 실사례 2건의 재현율은 **어휘에서 왔고** 실패는 판정에서 왔다.
# ⚠️ **그 1건은 PR #109에서 수리됐다**(서수 대신 선지 내용을 인용 — ⑥ⓑ가 지시하는
# 처방 그대로다). 그래서 이 낱말을 넣어도 **부수 피해가 0**이고(시드 1,018건 실측:
# 명사 있는 서수 7건 → 7건), 시드에 그 형태는 **0건** 남았다. 그렇다고 지우면
# **같은 오분류가 그대로 돌아온다** — 계약은 `test_선택지도_선지를_뜻하는_말이다`와
# `test_seed_contract.py::TestFixSurvival`이 함께 들고 있다.
# ⚠️ 「선택지」를 「선지」보다 **앞에** 둔다 — 교대는 왼쪽부터 시도하므로 긴 것이 먼저다.
_OPTION_NOUNS = r"(?:\s*(?:선택지|선지|보기|답지|번\s*선지))"
_ORDINAL_RE = re.compile(
    "(?:"
    + "|".join(
        re.escape(v) for vs in ORDINAL_VARIANTS.values() for v in sorted(vs, key=len, reverse=True)
    )
    + ")"
    + _OPTION_NOUNS
)
_ORD_NAME = {1: "첫 번째", 2: "두 번째", 3: "세 번째", 4: "네 번째"}

# 공개 별칭 — 다른 모듈이 **사설 이름에 침투하지 않도록** 내보낸다(2026-08-18 리뷰 7번).
# 사본이 아니라 **같은 객체**다: 두 벌이 되면 한쪽만 자란다(이 파일이 「판정 함수는
# 여기가 단독 소유」라고 적어 놓고 lint가 `_ORDINAL_RE`를 직접 읽던 자리다).
ORDINAL_WITH_NOUN_RE = _ORDINAL_RE


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
# ⚠️ **「오답」·「틀리」가 없었다**(2026-08-18 리뷰 실행 재현) — 「두 번째 선지는
# **오답이다**」가 셔플·게이트 **두 층 모두를 통과**했다. 가장 흔한 표현이 빠져 있었고,
# 「틀린 설명이다」가 잡히던 것은 「설명이다」라는 **중립 어미에 우연히** 걸린 것이라
# 방어가 아니었다.
# ⚠️ **2026-08-21 정정: 이제 이 목록이 유일하다.** 종전 주석은 「셔플용(광역)이고
# 게이트는 자기 목록을 따로 쓴다」였는데, 그 「따로」가 곧
# `test_answer_position_balance`의 사설 사본이었고 **예고대로 한쪽만 자랐다** —
# 위의 「오답」·「틀리」·「틀린」이 그쪽에 안 가서 「세 번째 선지는 오답이다」가 CI를
# 통과했다. 사본은 지웠고 그 계약이 이 목록을 부른다.
# ⛔ **여기에 「않」·「없」·「반대」·「어긋」을 넣지 말 것** (2026-08-19 되돌림).
# 2026-08-18에 「게이트 쪽 공백이 여기도 있다」며 넷을 넣었는데, 3차 리뷰가 그것이
# **MT-15를 조용히 해친다**는 것을 실행으로 보였다: 「나머지는 **오답이다**」·
# 「…가 아니다」류는 **맞는 해설의 표준 마무리 관용구**인데, 그것이 `hint_contradicts`를
# True로 만들면 그 문항이 **재배치에서 영구 제외**되고 `skipped_bare`에 잘못 집계된다
# (정답 위치 쏠림에서 그 문항들만 남는다 — MT-15가 고치려던 바로 그 상태).
# 오탐 비용이 「안 옮김」이라지만, 그 「안 옮김」이 누적되는 것이 MT-15의 결함
# 자체다. 넓히려면 **어느 문항이 재배치에서 빠지는지**를 먼저 세고 그 수를 계약으로 걸 것.
# ⚠️ **2026-08-21 · 낱말을 빼서 오탐을 고치지 않았다.** 여기 든 「나머지는 오답이다」
# 오탐(이월 P-12)은 **낱말이 아니라 창**의 문제였다 — 그 관용구는 정답을 지목하는
# 말과 **다른 절**에 있는데 글자 수 창이 건너가 붙였다. 창을 절로 바꿔 닫았고
# 목록은 **한 낱말도 줄이지 않았다**(줄이면 진짜 모순을 놓치는 쪽으로 무너진다).
#
# 🔴 **다만 P-12의 절반은 알고 남겼다 — 여기가 그 자리다.**
#   · 닫힌 것: 「첫 번째 선지가 정답이다**.** 나머지는 오답이다」 — **문장이 갈린** 형태.
#   · 남은 것: 「첫 번째 선지가 정답이**고** 나머지는 오답이다」 — **한 절**인 형태.
#     여전히 1번을 모순으로 신고한다(오탐).
# 남긴 이유: 이것을 닫는 길은 둘뿐인데 **둘 다 조용한 미탐을 만든다.**
#   ⑴ 낱말표에서 「오답」을 뺀다 → 「세 번째 선지는 오답이다」라는 **가장 흔한 진짜
#      모순**이 통째로 빠진다. 그 미탐은 2026-08-18까지 실제로 있었다(사설 사본에
#      「오답」이 없어 CI를 그냥 통과했다 — 아래 `_hint_contradictions` 머리 참조).
#   ⑵ 연결어미(「-고」·「-며」)에서도 절을 끊는다 → 한국어의 **연결동사 문장**을
#      잘라 먹는다: 「두 번째 선지는 값을 뒤집어 읽**고** 방향까지 잘못 짚었다」에서
#      「잘못」이 창 밖으로 나간다. 주어는 그대로인데 절만 끊긴 것이고, 이 문형은
#      시드 해설에 흔하다(「찬 공기가 가라앉**고** 따뜻한 공기가 올라가며」).
# ⇒ **오탐 하나를 남기는 값**(그 문항이 재배치에서 빠진다)이 **미탐을 만드는 값**
#    (맞힌 학습자에게 틀렸다고 가르치는 해설이 초록으로 나간다)보다 작다.
#    닫으려면 절 경계가 아니라 **극성 판정**이 필요하고, 그 축은 낱말표가 아니라
#    LLM 게이트다(`lint_seed_items.py` ⑥ⓐ 절 머리의 재개봉 조건과 같은 판단).
WRONG_CONTEXT = (
    "오답", "틀리", "틀린", "오독", "잘못", "아니", "혼동", "헷갈",
    "설명이다", "기준이다", "것이고", "것이다",
)

# 위 두 정규식의 **캡처 판**(2026-08-14) — `ordinal_slots_with_context`가 자리 번호를
# 뽑으려면 서수 부분만 따로 받아야 한다. 알파벳(패턴 문자열)은 같은 것을 쓴다.
_ORDINAL_ALT = "|".join(
    re.escape(v) for vs in ORDINAL_VARIANTS.values() for v in sorted(vs, key=len, reverse=True)
)
_ORDINAL_CAP_RE = re.compile("(" + _ORDINAL_ALT + ")" + _OPTION_NOUNS)
_BARE_ORDINAL_CAP_RE = re.compile("(" + _ORDINAL_ALT + ")")

# ── 절 경계 — 창을 **글자 수가 아니라 절**로 잡는다 (2026-08-21 · 오탐 기제 ②) ──
# ⚠️ 종전 창은 `[서수-10, 서수+45]`라는 **글자 수**였다. 한국어는 주어가 앞, 서술어가
# 뒤라 그 창은 **이웃 절의 서술어를 그대로 빨아들인다** — 실측:
#   · 「두 번째는 … 혼동한 **것이고**, 세 번째는 여름 내륙의 열저기압이며」
#     (본시드 온대저기압) — 3번의 근거가 **전부 2번 절에서 새어 온 것**이다.
#     3번 절 자체에는 오답을 뜻하는 낱말이 하나도 없다.
#   · 「두 번째와 세 번째는 각각 A와 B, 네 번째는 C의 **기준이다**」(폭염중대경보) —
#     같은 한 절인데 45자 안에 든 3·4번만 걸리고 2번은 빠진다. **뜻이 아니라 산술이다.**
# 이 새는 창은 「…오독이고, **세 번째 선지가 정답이다**」처럼 **바로 옆에 정답을
# 지목하는 절**이 오면 그 정답 자리를 모순으로 신고한다 — 그것이 오탐의 본체다.
#
# **축을 바꾼다**: 창 = 그 서수가 속한 **절**. 경계는 둘뿐이다.
#   ⑴ 문장 끝(`.!?…` 뒤에 공백이나 끝) — 「3.7배」·「0.5mm」를 쪼개지 않으려고
#      **뒤에 공백/끝을 요구**한다.
#   ⑵ **주격·주제로 표시된 다른 서수**(「세 번째 선지는」·「네 번째는」·「… 선지의」)
#      의 시작 위치. 그 자리에서 새 절이 열린다.
# ⚠️ **⑵의 「주격 표시」가 2026-08-14 절 경계가 실패한 이유를 닫는 조각이다.** 그때는
# 이웃 서수를 **표시와 무관하게** 경계로 삼아 「첫 번째 선지는, **두 번째 선지와**
# 마찬가지로, 오독이다」를 끊었고 진짜 모순을 놓쳤다. 「선지**와**」는 공동격이라
# 절을 열지 않는다 — 그래서 여기서는 경계가 아니고, 그 진짜 모순은 계속 걸린다
# (`test_절을_건너_걸린_모순은_셔플이_잡는다`가 그것을 문다).
_SENTENCE_BREAK_RE = re.compile(r"[.!?…]+(?=\s|$)")
_SUBJECT_MARKED_ORDINAL_RE = re.compile(
    "(?:" + _ORDINAL_ALT + ")" + _OPTION_NOUNS + "?" + r"(?:은|는|이|가|의|도)"
)


def clause_bounds(hint: str) -> list[int]:
    """절이 열리는 위치들 — 오름차순, 항상 0을 포함한다."""
    points = {0, len(hint)}
    for m in _SENTENCE_BREAK_RE.finditer(hint):
        points.add(m.end())
    for m in _SUBJECT_MARKED_ORDINAL_RE.finditer(hint):
        points.add(m.start())
    return sorted(points)


def _clause_window(hint: str, points: list[int], at: int) -> str:
    """`at`에 있는 서수가 속한 절의 원문."""
    left = max((p for p in points if p <= at), default=0)
    right = min((p for p in points if p > at), default=len(hint))
    return hint[left:right]


def hint_contradicts(hint: str, options: list, answer) -> bool:
    """해설이 **정답 자리**를 오답이라 말하는가.

    셔플 뒤 이 검사를 통과 못 하면 그 문항은 되돌린다 — 위치가 고르게 퍼지는
    이득보다 **맞힌 학습자에게 틀렸다고 가르치는 손해**가 훨씬 크다.
    """
    if not hint or not options or answer not in options:
        return False
    correct = options.index(answer) + 1
    # 스캔 자체는 `ordinal_hits`가 소유한다 — 셔플은 **명사 가드 없이** 넓게 본다.
    # 오탐 비용이 「안 옮김」뿐이기 때문이다.
    # ⚠️ **창은 절이다**(2026-08-21). 종전에는 「끊지 않는다」였고, 그래서
    # 「…오독이고, 세 번째 선지가 정답이다」의 **정답 절**이 옆 절의 「오독」으로
    # 규탄됐다. 절 경계는 **주격으로 표시된 서수**에서만 열리므로
    # 「첫 번째 선지는, 두 번째 선지**와** 마찬가지로, 오독이다」는 여전히 한 절이고
    # 그 진짜 모순은 계속 걸린다 — 2026-08-14 절 경계가 놓쳤던 바로 그 부류다.
    return correct in ordinal_slots_with_context(
        hint, WRONG_CONTEXT, noun_guarded=False
    )


def ordinal_hits(
    hint: str,
    *,
    noun_guarded: bool,
    last_slot: int | None = None,
) -> list[tuple[int, str]]:
    """서수 표기마다 `(자리 번호, 그 주변 텍스트)`를 낸다 — **스캔만** 한다.

    ⚠️ **판정(어떤 낱말이 무엇을 뜻하는가)은 부르는 쪽 몫이다.** 2026-08-18 코드
    리뷰가 그 경계를 요구했다: 셔플과 게이트가 같은 낱말 목록을 쓰다가 서로의
    요구를 망가뜨렸다(게이트가 「설명이다」 같은 중립 어미로 **맞는 해설을 탈락**
    시켰고, 셔플은 「오답」 어휘를 **아예 못 잡았다**). 스캔은 한 곳이 소유하고
    낱말·부정 판정은 각자 갖는 것이 옳은 분할이다.

    **창은 절이다** — `clause_bounds`가 정한다(2026-08-21 · 종전 `clause_bounded`·
    `before`·`after` 손잡이를 대신한다). 글자 수 창이 이웃 절의 서술어를 빨아들여
    **옆 절이 지목한 오답 낱말로 이 자리를 규탄**하던 것이 오탐의 기제였다 —
    근거는 위 `_SENTENCE_BREAK_RE` 머리에 실측과 함께 적어 두었다.
    ⚠️ 손잡이를 되살리지 말 것: 「끊는다/안 끊는다」의 이지선다가 세 라운드 동안
    오탐과 미탐을 번갈아 낸 이유는 **끊는 자리가 서수가 아니라 절이었기** 때문이다.

    `last_slot`: 「마지막」이 가리키는 자리. ⚠️ `ORDINAL_VARIANTS`는 「마지막」을
    **4로 하드코딩**한다 — 4지선다가 전제였고 현 시드는 실제로 전건 4지라 지금은
    맞는다. 그러나 3지선다가 하나라도 저작되면 **「마지막 선지」가 존재하지 않는
    4번을 가리켜 조용히 판정 밖으로 빠진다.** 보기 개수를 아는 쪽(게이트)이 그 수를
    넘겨 주면 「마지막」을 그 자리로 푼다(2026-08-18 리뷰 6번).
    """
    if not hint:
        return []
    pattern = _ORDINAL_CAP_RE if noun_guarded else _BARE_ORDINAL_CAP_RE
    points = clause_bounds(hint)
    hits: list[tuple[int, str]] = []
    for match in pattern.finditer(hint):
        token = match.group(1)
        slot = _SLOT_OF.get(token)
        if slot is None:
            continue
        if token == "마지막" and last_slot is not None:
            slot = last_slot
        hits.append((slot, _clause_window(hint, points, match.start())))
    return hits


def ordinal_slots_with_context(
    hint: str,
    context_words,
    *,
    noun_guarded: bool,
    last_slot: int | None = None,
) -> set[int]:
    """서수 표기가 **속한 절 안에** `context_words` 중 하나가 있는 자리 번호 집합.

    `hint_contradicts`가 하던 스캔을 꺼내 **양쪽 방향이 함께 쓰는 한 곳**으로 만든
    것이다(2026-08-14 코드 리뷰). 그 전에는 lint 쪽이 같은 루프를 손으로 다시
    쓰면서 `_BARE_ORDINAL_RE`·`_SLOT_OF` 같은 **사설 이름에 침투**했다 — 「판정
    함수는 여기가 단독 소유(사본 금지)」라고 적어 놓고 구조 사본을 만든 셈이었다.

    ⚠️ **`noun_guarded`가 이 함수의 핵심 손잡이다.** 같은 스캔이라도 부르는 쪽의
    **오탐 비용이 다르기 때문**이다:
      · **셔플(False)** — 오탐하면 그 문항을 **안 옮길 뿐**이다. 넓게 잡는 편이 낫다.
      · **게이트(True)** — 오탐하면 **CI가 빨개지고 사람이 맞는 해설을 고쳐 쓴다.**
        「태풍은 가을에 평균 **3번** 상륙」(빈도) · 「**① 단계**에서 증발」(단계 번호)
        처럼 선지와 무관한 서수가 실제로 걸렸다. 명사 가드(「~ 선지/보기/답지」)를
        요구하면 그 부류가 통째로 빠진다.
    좁힌 대가는 **「두 번째는 오독」처럼 명사 없는 진짜 결함을 게이트가 놓치는 것**인데,
    그쪽은 셔플이 계속 넓게 보므로 위치 재배치 시점에 다시 걸린다.

    ⚠️ **「주변」이 아니라 「그 절 안」이다**(2026-08-21). 글자 수 창은 옆 절의
    서술어를 빨아들여 **정답을 지목하는 절을 모순으로 신고**했다 — `ordinal_hits`
    머리의 실측을 볼 것.
    """
    return {
        slot
        for slot, window in ordinal_hits(
            hint,
            noun_guarded=noun_guarded,
            last_slot=last_slot,
        )
        if any(w in window for w in context_words)
    }


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

"""정답 위치 분포 계약 — MT-15 (2026-08-11 중간점검 멘토링 피드백).

**왜 집합 검사인가.** 이 결함은 문항 하나만 보면 보이지 않는다. 어느 문항이든
정답이 1번인 것은 정상이고, 1,000건 전부 1번인 것이 결함이다. 그래서
`lint_seed_items`의 per-item 검사 5종·게이트 16종 **어디에도 걸리지 않았다.**

**시간이 지날수록 나빠지던 유일한 항목이었다.** 8/11 판정 당시 84/84(100%)였고,
저작 배치로 문항이 1,000건이 되면서 **311/311(100%)**이 됐다. 아무도 모르는 채
3.7배로 늘었다 — 저작은 이 결함을 고치는 게 아니라 증폭시킨다.

**왜 학습이 망가지나.** 4지선다에서 정답이 항상 1번이면 학습자는 개념이 아니라
위치를 학습한다. 찍어도 맞고, 맞아도 이해했다는 증거가 아니다. θ 추정이 그
정답률을 능력으로 읽으므로 **BKT·IRT가 통째로 오염된다** — 배치고사·적응 출제·
숙련도 표시가 전부 그 위에 얹혀 있다.

임계는 **넉넉하게** 잡는다. 이 테스트가 막으려는 것은 "고르지 않음"이 아니라
**쏠림**이다. 저작이 진행되면 분포는 자연히 흔들리므로, 실제 결함(한 자리에
몰림)만 잡고 정상 변동은 통과시킨다.
"""
import collections
import re
import json
from pathlib import Path

import pytest

SEED = Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"

# 균등이면 25%다. 45%는 "우연히 치우친 것"과 "한 자리에 몰아 저작한 것"을 가르는
# 선이다 — 311건에서 균등 대비 45%가 우연히 나올 확률은 사실상 0이고, 반대로
# 저작 편차로 30%대가 나오는 것은 흔하다. 그 사이를 잡는다.
MAX_SHARE = 0.45


def _tally(items=None):
    """(정답 위치 분포, 자리 수, 정답이 보기에 없는 건수).

    ⚠️ 셋을 함께 돌려주는 이유: 앞의 둘만 보면 **집계에서 조용히 빠지는 문항**을
    못 본다. 정답이 보기 목록에 없으면 위치를 셀 수 없어 건너뛰는데, 그런 문항이
    늘어나도 분포는 멀쩡해 보인다(셔플이 정답을 보기에서 떼어내는 버그가 정확히
    그 모양이다). 그래서 이탈 건수를 세어 밖에서 단정한다.
    """
    if items is None:
        items = json.loads(SEED.read_text(encoding="utf-8"))
    pos = collections.Counter()
    slots = 0
    orphaned = 0
    for item in items:
        if item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options, answer = template.get("options"), template.get("correct_answer")
        if not options:
            continue
        slots = max(slots, len(options))  # 관찰값이 아니라 **보기 개수**에서 센다
        if answer in options:
            pos[options.index(answer) + 1] += 1
        else:
            orphaned += 1
    return pos, slots, orphaned


def _positions() -> collections.Counter:
    return _tally()[0]


def test_정답이_보기에서_떨어져_나간_문항이_없다():
    """셔플이 정답을 보기에서 떼어내면 **집계에서 사라져** 분포가 멀쩡해 보인다.

    지금 0건이라 잠재적 결함이지만, 이 검사가 없으면 그 버그는 조용히 통과한다.
    """
    _, _, orphaned = _tally()
    assert orphaned == 0, f"correct_answer가 options에 없는 mc 문항 {orphaned}건"


def test_정답이_한_자리에_몰리지_않는다():
    """**MT-15의 본체.** 이 한 줄이 8/11에 있었다면 1,000건이 100%로 자라지 않았다."""
    pos = _positions()
    total = sum(pos.values())
    assert total > 0, "mc 문항을 한 건도 못 읽었다 — 시드 경로나 스키마가 바뀌었다"

    worst_slot, worst_count = pos.most_common(1)[0]
    share = worst_count / total
    assert share <= MAX_SHARE, (
        f"정답이 {worst_slot}번에 {share:.1%}({worst_count}/{total}) 몰려 있다. "
        f"학습자가 개념이 아니라 위치를 학습하고, 그 정답률이 θ로 들어가 "
        f"BKT·IRT 추정을 오염시킨다. 보기 순서를 섞을 것 — 채점은 값 비교라 "
        f"(answer_service._grade_exact) 순서를 바꿔도 안 깨진다."
    )


def test_모든_자리가_정답으로_쓰인다():
    """한 자리가 **0건**이면 그 자리는 학습자에게 '절대 정답이 아닌 곳'이 된다.

    쏠림의 뒷면이다 — 위 검사를 통과해도(예: 44/44/12/0) 여기서 걸린다.

    ⚠️ 자리 수를 **보기 개수에서** 센다. 종전에는 관찰된 정답 위치의 최댓값
    (`max(pos)`)으로 셌는데, 그러면 **비어 있는 뒷자리를 원리적으로 못 본다** —
    44/44/12/0이면 `max(pos)`가 3이라 4번을 아예 안 찾고, 이 커밋이 고치려던
    311/311조차 `max(pos)`가 1이라 초록으로 통과했다. 검사가 자기 근거를
    관찰값에서 끌어오면 결함이 그 근거까지 같이 지운다(코드 리뷰 2026-08-12).
    """
    pos, slots, _ = _tally()
    empty = [i for i in range(1, slots + 1) if pos[i] == 0]
    assert not empty, f"정답으로 한 번도 안 쓰인 자리: {empty} — 소거법으로 풀린다"


def test_채점은_위치가_아니라_값을_본다():
    """순서를 섞어도 안전하다는 **근거**를 코드로 고정한다.

    이 전제가 깨지면(채점이 인덱스를 보게 되면) 셔플이 전 문항을 오답으로 만든다.
    """
    from app.services.answer_service import GRADERS

    question = {"correct_answer": "북태평양 기단", "options": ["시베리아 기단", "북태평양 기단"]}
    grade = GRADERS["multiple_choice"]
    assert grade(question, "북태평양 기단") is True
    assert grade(question, "시베리아 기단") is False
    # 순서를 뒤집어도 판정이 같다 — 위치를 안 본다는 뜻이다
    question["options"] = list(reversed(question["options"]))
    assert grade(question, "북태평양 기단") is True


@pytest.mark.parametrize("path", sorted((SEED.parent / "staging").glob("*.json")))
def test_staging도_같은_기준을_받는다(path):
    """승격 전에 걸러야 한다 — 본시드에 들어간 뒤 고치면 이미 늦다."""
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pytest.skip(f"읽을 수 없는 staging 파일: {path.name}")
    if not isinstance(items, list):
        pytest.skip(f"항목 목록이 아니다: {path.name}")

    pos = collections.Counter()
    for item in items:
        if item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options, answer = template.get("options"), template.get("correct_answer")
        if options and answer in options:
            pos[options.index(answer) + 1] += 1

    total = sum(pos.values())
    # 표본이 작으면 분포를 말할 수 없다 — 20건 미만은 통계가 아니라 잡음이다.
    if total < 20:
        pytest.skip(f"mc {total}건 — 분포를 판정하기에 표본이 작다")
    slot, count = pos.most_common(1)[0]
    assert count / total <= MAX_SHARE, (
        f"{path.name}: 정답이 {slot}번에 {count}/{total} 몰려 있다"
    )


# ── 해설이 선지를 **서수로** 가리키는 문제 ─────────────────────────────────
# ⚠️ 이 절은 위 셔플이 실제로 깨뜨린 것을 잡는다(코드 리뷰 2026-08-12).
# `explanation_hint`는 학습자에게 **그대로** 서빙된다(answer_service 우선순위 ②).
# 그런데 해설 9건이 오답을 「세 번째 선지는 오독이다」처럼 자리로 가리키고 있었고,
# 순서를 섞자 그 서수가 다른 선지를 가리키게 됐다. **3건은 정답을 오독이라고
# 말했다** — 맞힌 학습자에게 틀렸다고 가르치는 것이라, 이 커밋이 고치려던 결함의
# 정반대 방향으로 같은 피해를 낸다.
ORDINAL_VARIANTS = {
    1: ("첫 번째", "첫번째", "1번", "①"),
    2: ("두 번째", "두번째", "2번", "②"),
    3: ("세 번째", "세번째", "3번", "③"),
    4: ("네 번째", "네번째", "4번", "④", "마지막 선지", "마지막 보기"),
}
_SLOT_OF = {v: k for k, vs in ORDINAL_VARIANTS.items() for v in vs}
_ORDINAL_RE = re.compile(
    "|".join(
        re.escape(v)
        for vs in ORDINAL_VARIANTS.values()
        for v in sorted(vs, key=len, reverse=True)
    )
)
# 이 말과 함께 자리를 가리키면 그 자리는 **오답**이라는 뜻이다.
WRONG_CONTEXT = ("오독", "잘못", "아니", "혼동", "설명이다", "기준이다", "것이고", "것이다", "헷갈")


def _hint_contradictions(items):
    """해설이 **정답 자리**를 오답이라 말하는 문항 목록."""
    bad = []
    for item in items:
        if item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        hint = str(template.get("explanation_hint") or "")
        options, answer = template.get("options"), template.get("correct_answer")
        if not hint or not options or answer not in options:
            continue
        correct = options.index(answer) + 1
        for match in _ORDINAL_RE.finditer(hint):
            if _SLOT_OF[match.group(0)] != correct:
                continue
            around = hint[max(0, match.start() - 10) : match.start() + 45]
            if any(w in around for w in WRONG_CONTEXT):
                bad.append((str(template.get("question_text"))[:40], match.group(0), around))
    return bad


def test_해설이_정답을_오답이라_말하지_않는다():
    """**보기 순서를 건드릴 때마다 반드시 함께 봐야 하는 검사.**

    위치 분포만 보면 이 결함이 안 보인다 — 분포는 완벽한데 해설이 거짓말한다.
    """
    bad = _hint_contradictions(json.loads(SEED.read_text(encoding="utf-8")))
    assert not bad, "해설이 정답 자리를 오답이라 말한다:\n" + "\n".join(
        f"  {q}… '{ordinal}' → …{ctx.strip()}…" for q, ordinal, ctx in bad[:5]
    )


@pytest.mark.parametrize("path", sorted((SEED.parent / "staging").glob("*.json")))
def test_staging_해설도_정답과_어긋나지_않는다(path):
    """승격이 이 결함을 본시드로 되돌리지 못하게 한다.

    실제로 같은 문항이 staging 3파일에 복제돼 있었고, 위치 검사만으로는
    그 복제본의 깨진 해설을 못 봤다.
    """
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pytest.skip(f"읽을 수 없다: {path.name}")
    if not isinstance(items, list):
        pytest.skip(f"항목 목록이 아니다: {path.name}")
    bad = _hint_contradictions(items)
    assert not bad, f"{path.name}: 해설이 정답을 오답이라 말한다 — {bad[:3]}"

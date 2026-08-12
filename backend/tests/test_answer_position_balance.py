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
import json
from pathlib import Path

import pytest

SEED = Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"

# 균등이면 25%다. 45%는 "우연히 치우친 것"과 "한 자리에 몰아 저작한 것"을 가르는
# 선이다 — 311건에서 균등 대비 45%가 우연히 나올 확률은 사실상 0이고, 반대로
# 저작 편차로 30%대가 나오는 것은 흔하다. 그 사이를 잡는다.
MAX_SHARE = 0.45


def _positions() -> collections.Counter:
    items = json.loads(SEED.read_text(encoding="utf-8"))
    pos = collections.Counter()
    for item in items:
        if item.get("question_type") != "multiple_choice":
            continue
        template = item.get("template_json") or {}
        options, answer = template.get("options"), template.get("correct_answer")
        if options and answer in options:
            pos[options.index(answer) + 1] += 1
    return pos


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
    """
    pos = _positions()
    slots = max(pos) if pos else 0
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

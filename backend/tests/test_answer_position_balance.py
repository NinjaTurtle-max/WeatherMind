"""정답 위치 분포 계약 — MT-15 (2026-08-11 중간점검 멘토링 피드백).

**왜 집합 검사인가.** 이 결함은 문항 하나만 보면 보이지 않는다. 어느 문항이든
정답이 1번인 것은 정상이고, 1,000건 전부 1번인 것이 결함이다. 그래서
`lint_seed_items`의 per-item 검사·게이트 16종 **어디에도 걸리지 않았다.**
⚠️ 이 문장은 **2026-08-18에 절반이 낡았다**: per-item 검사는 5종이 아니라 **6종**이고
(⑥ 사실성·채점 정합 신설), 그중 ⑥ⓐ·⑥ⓑ가 **위치 참조 해설을 이제 잡는다**. 다만
**이 파일이 보는 「분포」는 여전히 아무도 안 본다** — ⑥은 문항 하나 안의 모순을 보고,
쏠림은 집합 성질이라 per-item으로는 원리적으로 안 보인다. 그래서 이 계약은 남는다.

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


class TestShuffleToolInvariants:
    """도구가 지켜야 하는 것 — 전부 코드 리뷰가 실물로 잡아낸 결함이다(2026-08-12).

    이 절이 없으면 도구가 다음 저작 배치에서 같은 피해를 되풀이한다.
    """

    @pytest.fixture(scope="class")
    def tool(self):
        import importlib.util
        import sys

        path = SEED.parents[2] / "scripts" / "shuffle_answer_positions.py"
        spec = importlib.util.spec_from_file_location("wm_shuffle", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["wm_shuffle"] = module
        spec.loader.exec_module(module)
        return module

    def test_정답이_앵커면_건드리지_않는다(self, tool):
        """「둘 다 아니다」가 정답일 때 보기가 하나 늘고 정답이 두 번 실렸다."""
        options = ["A", "B", "둘 다 아니다"]
        out = tool.place_answer(options, "둘 다 아니다", "q", 1)
        assert len(out) == len(options), f"보기 개수가 변했다: {out}"
        assert out.count("둘 다 아니다") == 1, f"정답이 중복됐다: {out}"

    def test_앵커는_끝에_남는다(self, tool):
        out = tool.place_answer(["A", "B", "둘 다 아니다"], "A", "q", 2)
        assert out[-1] == "둘 다 아니다", f"앵커가 앞으로 나왔다: {out}"

    def test_서수는_선지를_가리킬_때만_옮긴다(self, tool):
        """**학습자에게 나간 실제 오류.** 「두 번째 몫」은 선지가 아니라 물리적
        기여분이었는데 「네 번째 몫」이 됐다 — 넷이 없는 곳에서 넷째를 가리킨다.
        """
        hint = "기압이 밀어 올리는 몫과 바람이 쌓는 몫으로 나뉜다. 두 번째 몫을 크게 키운다."
        out = tool.remap_hint(hint, ["A", "B", "C", "D"], ["D", "C", "B", "A"])
        assert "두 번째 몫" in out, f"본문의 서수를 건드렸다: {out}"

    def test_선지_참조는_제대로_옮긴다(self, tool):
        hint = "세 번째 선지는 오독이다."
        out = tool.remap_hint(hint, ["A", "B", "C", "D"], ["C", "A", "B", "D"])
        assert "첫 번째 선지는 오독이다." == out, out

    def test_자리를_모르면_안_건드린다(self, tool):
        """3지선다에서 「마지막 선지」(4번 매핑)처럼 매핑이 없는 경우."""
        hint = "네 번째 선지는 오독이다."
        out = tool.remap_hint(hint, ["A", "B", "C"], ["C", "A", "B"])
        assert out == hint, f"모르는 자리를 임의로 바꿨다: {out}"

    def _fixture(self, tmp_path, texts):
        import json

        items = [
            {
                "concept_tag": "air_mass",
                "question_type": "multiple_choice",
                "template_json": {
                    "question_text": t,
                    "options": [f"{t}-가", f"{t}-나", f"{t}-다", f"{t}-라"],
                    "correct_answer": f"{t}-가",
                },
            }
            for t in texts
        ]
        path = tmp_path / "items.json"
        path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        return path

    def _orders(self, path):
        import json

        return {
            it["template_json"]["question_text"]: it["template_json"]["options"]
            for it in json.loads(path.read_text(encoding="utf-8"))
        }

    def test_항목을_추가해도_다른_문항이_안_밀린다(self, tool, tmp_path):
        """⚠️ **`process`를 실제로 돌려서** 본다.

        종전 판은 `place_answer`에 `target_slot=1`을 직접 넘겨 두 번 부르고 같은
        결과가 나오는지만 봤다 — 그건 순수 함수의 결정성이라 애초에 의심할 것이
        없었고, **정작 회귀가 사는 곳(`process`의 자리 배정)은 검사되지 않았다**
        (코드 리뷰 2026-08-12). 파일 순번으로 배정하면 항목 하나 추가에 1,000건 중
        207건이 재배치되고, 그 diff 잡음 속에서 손으로 고친 해설이 조용히 되돌아간다.
        """
        texts = [f"문항 {i}" for i in range(12)]
        path = self._fixture(tmp_path, texts)
        tool.process(path, write=True, remap_hints=True)
        before = self._orders(path)

        # **앞쪽에** 새 문항을 끼워 넣는다 — 순번 배정이었다면 뒤가 전부 밀린다
        import json

        items = json.loads(path.read_text(encoding="utf-8"))
        items.insert(0, {
            "concept_tag": "air_mass",
            "question_type": "multiple_choice",
            "template_json": {
                "question_text": "새 문항",
                "options": ["새-가", "새-나", "새-다", "새-라"],
                "correct_answer": "새-가",
            },
        })
        path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        tool.process(path, write=True, remap_hints=True)
        after = self._orders(path)

        moved = [t for t in texts if before[t] != after[t]]
        assert not moved, (
            f"항목 하나를 추가했는데 기존 {len(moved)}건의 순서가 바뀌었다: {moved[:5]}"
        )

    def test_같은_문항은_파일이_달라도_같은_순서를_받는다(self, tool, tmp_path):
        """본시드와 staging에 중복된 문항이 갈리면 승격이 본시드의 손질을 덮는다."""
        a = self._fixture(tmp_path, ["공통 문항", "A 전용"])
        (tmp_path / "sub").mkdir()
        # 파일 크기·구성이 **다르다** — 순번 배정이었다면 공통 문항이 서로 다른
        # 자리를 받는다(실측 282건 중 214건이 그랬다).
        b = self._fixture(tmp_path / "sub", ["공통 문항", "B 전용", "B 전용 2"])
        tool.process(a, write=True, remap_hints=True)
        tool.process(b, write=True, remap_hints=True)
        assert self._orders(a)["공통 문항"] == self._orders(b)["공통 문항"]

"""사실성 계열 게이트 — MT-14(과학적 정합성)·MT-16(난이도↑ 자료 검증) 2026-08-14.

**왜 필요했나.** 판정 근거는 한 줄로 요약된다: *게이트 16종에 사실성 항목이 0개*.
`answer_service.py:224`가 스스로 자인한다 — *"2단 LLM 게이트는 「이 진술이 참인가」를
묻지 않는다"*. 그래서 lint 초록 상태에서 **채점 결함 2건**(오독이 정답 처리 · 맞는
답이 오답 처리)이 사람 표본 검수로 발견됐다(CARRYOVER_R13 §1.1e-2).

**왜 결정적 검사만 넣었나.** 이 프로젝트는 **무키 상태에서 전 기능이 돌아야 한다**
(CLAUDE.md 「AI 게이트」). LLM에 사실성을 물으면 키 없는 CI에서 검사가 조용히 꺼지고,
그러면 규칙이 없는 것과 같다(`load_vocabulary` 주석과 같은 판단).

**여기서 다루지 않는 것** — §1.1e가 *"코드로 못 잡는다"*고 적은 두 유형(용어 없이
어려운 문항 · 수치의 출처가 상위인 문항)은 문항이 요구하는 지식이 텍스트에 없어서
못 잡는 것이다. 그 둘은 저작 지침과 표본 검수의 몫이고, 이 파일이 그 자리를 대신
차지하면 **검수가 끝났다는 착각**을 만든다.
"""
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from app.services import answer_service  # 채점 상수의 단일 소유자

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED = REPO_ROOT / "database" / "seed" / "content_items.json"


def _load_lint():
    """scripts/lint_seed_items.py를 모듈로 로드한다 (scripts는 패키지가 아니다).

    test_level_vocabulary._load_lint과 같은 관례 — 사본이 아니라 같은 규약이다
    (모듈 로딩 기계는 pytest 수집 순서에 따라 한쪽이 먼저 sys.modules를 채운다).
    """
    scripts_dir = REPO_ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    spec = importlib.util.spec_from_file_location(
        "lint_seed_items", scripts_dir / "lint_seed_items.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["lint_seed_items"] = module
    spec.loader.exec_module(module)
    return module


lint = _load_lint()


def _mc(hint: str, *, options: list[str], answer: str) -> dict:
    return {
        "question_type": "multiple_choice",
        "concept_tag": "pressure_front",
        "level_group": "middle_high",
        "knowledge_level": 5,
        "template_json": {
            "question_text": "고기압이 오면 하늘은 어떻게 되는가?",
            "options": options,
            "correct_answer": answer,
            "explanation_hint": hint,
        },
    }


OPTIONS = ["맑아진다", "비가 온다", "눈이 온다", "안개가 낀다"]

# ⑥ 계열만 보는 최소 파이프라인 — ①②③⑤는 빈 판정으로 뗀다.
#
# ⚠️ **여기서 진짜 파이프라인을 로드하지 않는 것이 의도다.** load_backend_contract·
# load_ai_worker·load_render_required는 `app.*`를 sys.modules에서 갈아 끼웠다
# 되돌리는데(author_items._import_isolated), 이 파일은 **이미 app을 임포트한**
# backend 테스트 세션 안에서 돈다. 전 파이프라인 검증은 `ci.sh seed`가 실제
# 시드로 하고, 여기서 봐야 하는 것은 ⑥ 판정과 래칫 의미 하나다.
_NULL_BACKEND = SimpleNamespace(validate_entry=lambda item, index: [])
_NULL_AI = SimpleNamespace(
    gate1=lambda flat, tag: [],
    generated_fields={},
    check_payload=lambda flat: None,
)
_NULL_VOCAB = {"terms": [], "mechanism_markers": ["왜"], "anchor": {"1": []}}
# 관용오차는 **실제 채점 상수**를 그대로 쓴다 — 여기 숫자를 손으로 적으면
# answer_service가 바뀌는 날 테스트만 초록인 채로 남는다. 이 파일은 backend
# 테스트라 소유자를 곧바로 임포트할 수 있다(lint 쪽 로더의 정합은 아래 계약 테스트).
_GRADING = lint.GradingContract(slider_tolerance=answer_service.SLIDER_TOLERANCE)


def _lint_one(item: dict):
    return lint.lint_items(
        [item],
        backend=_NULL_BACKEND,
        ai=_NULL_AI,
        render_required={},
        vocabulary=_NULL_VOCAB,
        grading=_GRADING,
    )


def _slider(*, low, high, answer, step=1) -> dict:
    return {
        "question_type": "slider",
        "concept_tag": "temperature_heat",
        "level_group": "middle_high",
        "knowledge_level": 5,
        "template_json": {
            "question_text": "몇 ℃인가?",
            "min": low,
            "max": high,
            "step": step,
            "unit": "℃",
            "correct_answer": str(answer),
        },
    }


# ── ⑥ⓐ 해설–정답 위치 모순 ───────────────────────────────────────────────────
def test_정답_자리를_오답이라_말하는_해설이_걸린다():
    """MT-15 셔플의 전신이 실제로 만든 결함 3건이 이 모양이었다.

    맞힌 학습자가 「첫 번째 선지는 오독이다」를 읽는다 — 채점은 정답인데 해설이
    틀렸다고 가르친다. 게이트 16종·per-item 5종·분포 계약 어디에도 안 걸렸다.
    """
    item = _mc("첫 번째 선지는 흔한 오독이다.", options=OPTIONS, answer="맑아진다")
    errors = lint.hint_position_errors(item)
    assert errors, "정답 자리를 오답이라 가리키는 해설을 놓쳤다"
    assert "정답 자리" in errors[0]


def test_오답_자리를_정답이라_말하는_해설이_걸린다():
    """거울상 — 셔플과 무관하게 처음부터 틀렸고 되돌릴 원본조차 없다."""
    item = _mc("두 번째 선지가 정답이다.", options=OPTIONS, answer="맑아진다")
    errors = lint.hint_position_errors(item)
    assert errors, "오답 자리를 정답이라 가리키는 해설을 놓쳤다"
    assert "오답 자리" in errors[0]


def test_내용으로_가리키는_해설은_통과한다():
    """처방이 곧 통과 조건이다 — 자리가 아니라 **내용**으로 가리키면 셔플에도 안전하다."""
    item = _mc(
        "고기압에서는 공기가 내려와 구름이 잘 생기지 않는다. '비가 온다'는 저기압의 설명이다.",
        options=OPTIONS,
        answer="맑아진다",
    )
    assert lint.hint_position_errors(item) == []


def test_오답_자리를_오답이라_말하는_해설은_통과한다():
    """본시드 6건이 이 형태다 — 서수를 쓰되 **가리키는 정오가 맞다**.

    여기서 걸면 오탐이다. 자리 참조 자체의 취약성은 ⑥ⓑ가 따로 본다(사유가 다르다:
    이쪽은 '지금 틀렸다', 저쪽은 '셔플하면 틀려진다').
    """
    item = _mc("두 번째 선지는 저기압의 설명이라 오독이다.", options=OPTIONS, answer="맑아진다")
    assert lint.hint_position_errors(item) == []


def test_본문의_서수는_선지_참조로_읽지_않는다():
    """「두 번째 몫」은 선지가 아니라 앞 문장이 든 물리적 기여분이다.

    셔플 도구가 실제로 이것을 「네 번째 몫」으로 망가뜨린 적이 있다
    (shuffle_answer_positions 정규식 주석). 긍정 문맥이 없으면 건드리지 않는다.
    """
    item = _mc(
        "해일은 기압 몫과 바람 몫이 더해져 만들어진다. 얕은 만은 두 번째 몫을 크게 키운다.",
        options=OPTIONS,
        answer="맑아진다",
    )
    assert lint.hint_position_errors(item) == []


# ── ⑥ⓑ 해설의 선지 위치 참조 (래칫) ─────────────────────────────────────────
def test_정오가_맞아도_자리_참조는_걸린다():
    """⑥ⓐ와 사유가 다르다 — 지금 틀린 게 아니라 **셔플하면 틀려진다**.

    그리고 그때까지 이 문항은 `shuffle_answer_positions`의 대상에서 빠진다:
    MT-15가 고치려던 정답 위치 쏠림에서 이 문항들만 영구히 남는다.
    """
    item = _mc("두 번째 선지는 저기압의 설명이라 오독이다.", options=OPTIONS, answer="맑아진다")
    coded = lint.hint_ordinal_errors(item)
    assert coded and coded[0][0] == "ordinal_ref"


def test_명사_없는_서수는_자리_참조로_읽지_않는다():
    """「두 번째 몫」을 걸면 오탐이다 — 본시드 실측 4건이 그런 문장이다."""
    item = _mc(
        "해일은 기압 몫과 바람 몫이 더해진다. 얕은 만은 두 번째 몫을 크게 키운다.",
        options=OPTIONS,
        answer="맑아진다",
    )
    assert lint.hint_ordinal_errors(item) == []


def test_래칫은_같음이_아니라_부분집합이다():
    """저작 담당이 문항을 고치면 항목이 낡을 뿐이어야 한다 — CI가 붉어지면 안 된다.

    소유가 갈린 파일을 서로 고치게 만드는 게이트는 결국 꺼진다.
    """
    stale = "이 문항은 시드에 없다 — 낡은 래칫 항목"
    lint.FACTUAL_BASELINE["ordinal_ref"][stale] = "테스트용"
    try:
        clean = _mc("고기압에서는 공기가 내려온다.", options=OPTIONS, answer="맑아진다")
        assert not _lint_one(clean).findings
    finally:
        del lint.FACTUAL_BASELINE["ordinal_ref"][stale]


def test_래칫_밖의_새_자리_참조는_탈락한다():
    """**이 한 줄이 래칫의 존재 이유다.** 저작이 결함을 고치는 게 아니라 증폭시킨다
    (MT-15 실측 84 → 311건). 기지 잔여는 통과시키되 새것은 막는다."""
    fresh = _mc("세 번째 선지는 반대의 설명이다.", options=OPTIONS, answer="맑아진다")
    stages = {f.stage for f in _lint_one(fresh).findings}
    assert "fact_ordinal" in stages, "래칫 밖의 새 자리 참조를 통과시켰다"


def test_래칫에_위치_모순_검사가_없다():
    """정답을 오답이라 가르치는 해설에 유예를 두지 않는다 — 이 규약이 코드로 선다.

    문서에만 적힌 금지는 다음 사람이 「한 건만」 넣으며 무너진다.
    """
    assert "fact_hint" not in lint.FACTUAL_BASELINE
    for code in lint.FACTUAL_BASELINE:
        assert code != "hint_contradiction"


# ── ⑥ⓒ 채점 정합 ────────────────────────────────────────────────────────────
def test_눈금_전체가_관용오차_안이면_걸린다():
    """「오독이 정답 처리」 — 무엇을 짚어도 정답이면 채점이 성립하지 않는다.

    정답률이 1.0으로 고정되므로 θ·BKT가 그것을 능력으로 읽는다. 그 위에
    배치고사·적응 출제·숙련도 표시가 전부 얹혀 있다.
    """
    tol = answer_service.SLIDER_TOLERANCE
    item = _slider(low=0, high=tol, answer=tol / 2)
    coded = lint.grading_errors(item, grading=_GRADING)
    assert coded and coded[0][0] == "slider_indiscriminate"


def test_충분히_넓은_범위는_통과한다():
    """오탐이 한 건이라도 나면 게이트가 꺼진다 — 정상 슬라이더 107건 중 101건이 여기다."""
    tol = answer_service.SLIDER_TOLERANCE
    item = _slider(low=0, high=tol * 10, answer=tol * 5)
    assert lint.grading_errors(item, grading=_GRADING) == []


def test_경계는_한쪽만_넘어도_통과한다():
    """판정은 **양끝 모두** 오차 안일 때다 — 한쪽이라도 밖이면 변별이 남는다."""
    tol = answer_service.SLIDER_TOLERANCE
    item = _slider(low=0, high=tol * 2 + 1, answer=tol)
    assert lint.grading_errors(item, grading=_GRADING) == []


def test_관용오차를_손으로_적지_않는다():
    """lint의 로더가 채점기 상수를 **실임포트**하는가 (사본 금지).

    author_items.SLIDER_MIN_SPAN(=40)은 저작 권고를 손으로 적어 둔 값이라
    여기 쓰면 관용오차가 바뀌는 날 두 숫자가 갈린다.
    """
    assert lint.load_grading_contract().slider_tolerance == answer_service.SLIDER_TOLERANCE


def test_숫자와_단위가_붙은_정답이_걸린다():
    """「맞는 답이 오답 처리」 — 완전 일치 채점에서 「30」이 틀린 것이 된다.

    그 학습자는 자기가 왜 틀렸는지 알 수 없다. 본시드 관례는 맨 숫자다.
    """
    item = {
        "question_type": "short_answer",
        "template_json": {"question_text": "몇 년인가?", "correct_answer": "30년"},
    }
    coded = lint.grading_errors(item, grading=_GRADING)
    assert coded and coded[0][0] == "answer_unit_suffix"


def test_맨_숫자_정답과_서술형_정답은_통과한다():
    for answer in ("30", "-20", "0.25", "1,000", "시베리아 기단", "차가운 공기"):
        item = {
            "question_type": "short_answer",
            "template_json": {"question_text": "무엇인가?", "correct_answer": answer},
        }
        assert lint.grading_errors(item, grading=_GRADING) == [], answer


def test_객관식_선지_정답은_표기_판정에서_뺀다():
    """학습자가 고르는 것이라 표기 문제가 없다 — 여기서 걸면 순수 오탐이다."""
    item = _mc("설명", options=["25℃", "30℃", "35℃", "40℃"], answer="25℃")
    assert lint.grading_errors(item, grading=_GRADING) == []


def test_래칫_밖의_새_채점_결함은_탈락한다():
    tol = answer_service.SLIDER_TOLERANCE
    fresh = _slider(low=0, high=tol, answer=tol / 2)
    fresh["template_json"]["question_text"] = "래칫에 없는 새 문항인가?"
    assert "fact_grading" in {f.stage for f in _lint_one(fresh).findings}


# ── 본시드 대조 (래칫의 실집행) ──────────────────────────────────────────────
def test_본시드의_사실성_적발이_전부_래칫_안에_있다():
    """**저작이 늘어나면 여기가 먼저 붉어진다.**

    `ci.sh seed`가 같은 판정을 lint로 하지만 그쪽은 ai-worker·backend 파이프라인을
    통째로 로드한다 — 여기는 ⑥만 보므로 저작자가 빠르게 되돌려 받는다. 그리고
    무엇보다 **의존 설치 여부와 무관하게 돈다**: 로컬 초록이 CI에서만 붉어지는
    함정(CLAUDE.md 「명령」)을 이 검사에 대해서는 만들지 않는다.
    """
    items = json.loads(SEED.read_text(encoding="utf-8"))
    baseline = lint.baseline_index()
    live: list[str] = []
    for index, item in enumerate(items):
        text_key = lint.author_items.normalize_text(
            (item.get("template_json") or {}).get("question_text")
        )
        coded = lint.hint_ordinal_errors(item) + lint.grading_errors(
            item, grading=_GRADING
        )
        live += [
            f"[{index}] {code}: {reason}"
            for code, reason in coded
            if text_key not in baseline.get(code, set())
        ]
        live += [f"[{index}] 위치 모순: {r}" for r in lint.hint_position_errors(item)]
    assert not live, "래칫에 없는 사실성 적발:\n" + "\n".join(live)


def test_객관식이_아니면_판정하지_않는다():
    """ordering·match의 「세 번째 경우」는 정상 서술이다 — 선지 자리가 없다."""
    item = {
        "question_type": "match",
        "template_json": {
            "question_text": "짝지어라",
            "correct_answer": "",
            "explanation_hint": "겨울에 빨래가 언 채로 마르는 것이 세 번째 경우다.",
        },
    }
    assert lint.hint_position_errors(item) == []

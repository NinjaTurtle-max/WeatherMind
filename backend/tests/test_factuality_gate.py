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
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


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

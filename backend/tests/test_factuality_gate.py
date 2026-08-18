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

import pytest

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
@pytest.mark.xfail(
    strict=True,
    reason=(
        "🔴 **래칫이 아니라 사실이다** (2026-08-18). 「선택지」를 선지 명사로 읽게 되면서"
        " 실결함 1건이 드러났다: `concept_tag=typhoon` · `knowledge_level=7` ·"
        " 배포 시드에서 **해설에 「선택지」를 쓰는 유일한 문항**(PM 전수 스윕 1건 ·"
        " 이 브랜치 시드 1,012건에서도 1건 · 1-기준 [575]) — 정답이 2번인데 해설이"
        " 「두 번째 선택지는 방향이 반대다」라고 말한다. ⑥ⓐ는 설계상 래칫이 없으므로"
        " (`test_래칫에_위치_모순_검사가_없다`) 통과시킬 길이 없고, 실제로 틀린 해설을"
        " 래칫에 적는 것은 그 래칫을 거짓으로 만든다."
        " `database/seed/**`는 이 브랜치의 소유 밖이라 여기서 고칠 수 없다 —"
        " **보드 워커의 시드 수리가 들어오면 이 마커를 지운다.**"
        " `strict=True`이므로 수리가 병합되는 순간 XPASS로 **실패**해서 지우게 된다."
    ),
)
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


# ── 오탐 회귀 가드 (2026-08-14 코드 리뷰 실행 재현) ──────────────────────────
# ⚠️ **이 게이트에는 래칫이 없다**(위 테스트가 그 없음을 지킨다). 그래서 오탐 하나가
# 「맞는 해설을 고쳐 쓰는 것」 말고 탈출구가 없는 상태를 만든다 — 게이트가 사람을
# 틀렸다고 규탄하는 자리가 된다. 아래 넷은 리뷰가 **실제로 실행해 재현한** 오탐이고,
# 셋은 명사 가드 부재, 하나는 창이 절 경계를 넘은 것이 원인이었다.
FALSE_POSITIVES = [
    ("빈도", "태풍은 가을에 평균 3번 상륙한다. 이것이 정답이다."),
    ("단계 번호", "\u2460 단계에서 증발이 일어난다. 그래서 정답이다."),
    ("횟수", "밀물과 썰물은 하루에 각각 2번씩 나타나는 것이다."),
    ("절 경계", "첫 번째 선지는 오독이고, 두 번째가 정답이다."),
]


def test_선지와_무관한_서수는_걸리지_않는다():
    """정답은 2번 자리 — 위 넷 어디에도 「2번 선지」를 가리키는 말이 없다."""
    for name, hint in FALSE_POSITIVES:
        item = _mc(hint, options=OPTIONS, answer="비가 온다")
        assert lint.hint_position_errors(item) == [], f"{name}: 오탐"


def test_자릿수_콤마가_붙은_단위_결합_정답도_잡는다():
    """`'1,000mm'`가 초판 정규식에서 None이었다 — ⑥ⓒ가 잡으라는 그 결함이
    **네 자리부터 통째로 빠져나갔다.** 기상 수치는 네 자리가 흔하다(강수량·고도·기압).
    """
    item = {
        "question_type": "short_answer",
        "concept_tag": "anomaly",
        "level_group": "middle_high",
        "knowledge_level": 5,
        "template_json": {
            "question_text": "기록적 호우의 일 강수량은?",
            "correct_answer": "1,000mm",
            "explanation_hint": "기록적 호우였다.",
        },
    }
    codes = [code for code, _ in lint.grading_errors(item, grading=_GRADING)]
    assert "answer_unit_suffix" in codes, codes


def test_명사_없는_자리_참조는_파이프라인이_그냥_지나친다(tmp_path):
    """🔴 **의도된 미탐이고, 백스톱은 없다** (PM 판정 2026-08-18 · ⓑ 정직한 미탐 기록).

    「두 번째는 오독이다」는 **진짜 결함**인데 **두 층 다** 통과한다. 게이트는 명사 가드
    (「~ 선지/보기/답지/선택지」)를 요구하기로 했고 — 그 대가로 오탐 4종
    (빈도 「평균 3번 상륙」·단계 번호 「\u2460 단계에서」·횟수 「하루 각각 2번씩」·
    절 경계)이 사라졌다 — **셔플도 실경로에서는 안 본다.**

    ⚠️ **이 픽스처는 2026-08-18에 층위가 틀려서 다시 쓰였다.** 종전 판은
    `hint_contradicts()`를 **직접** 불러 「셔플이 나중에 잡는다」를 단정했다. 그런데
    실경로 `process()`는 `hint_has_bare_ordinal`에서 **`continue`로 건너뛰어** 그
    함수에 **닿지 않는다**(아래에서 둘을 나란히 단정한다). 곧 종전 픽스처는 **없는
    백스톱을 계약으로 주장**하고 있었다.

    🔴 **코드화하는 규칙**: **파이프라인 동작을 주장하는 픽스처는 파이프라인
    진입점(`process()`·`lint_items`)을 통과해야 한다 — 함수 단독 호출은 증명이 아니다.**
    (이번 주에 같은 형태의 오증명이 세 번 나왔다.)

    **미탐 클래스의 인구** — 수치는 잰 날과 시드 크기를 **함께** 적는다(그러지 않아서
    「본시드 실측 4건」이 **시드 272건 시절 값**인 채로 남았다):
      · **이 브랜치 시드 1,012건**(2026-08-18 실측): 명사 없는 서수만 있는 mc 해설
        **4건** → 「선택지」를 명사에 넣은 뒤 **3건**(그중 실제 선지 참조 2건 ·
        본문 서수 「두 번째 몫」 1건). 명사 있는 서수 **7건** → **8건**.
      · **배포 시드 1,018건**(2026-08-18 PM 전수 스윕): 명사 없는 서수 **5건** ·
        명사 있는 서수 **6건**. ⚠️ 두 실측이 어긋나는 것을 **그대로 남긴다** —
        시드 판이 다르고 이 트리에서 배포 시드 쪽 수를 확인할 방법이 없다.

    **왜 미탐 쪽을 고르나** — ⑥ⓐ에는 설계상 래칫이 없다
    (`test_래칫에_위치_모순_검사가_없다`가 그 없음을 지킨다). 그래서 오탐은 **탈출구가
    없다**: 맞는 문항이 CI를 붉게 만들고, 사람은 「맞는 해설을 고쳐 쓰는 것」 말고 할 수
    있는 게 없다. 미탐은 저작이 해설을 내용 참조로 고치면 함께 사라진다.

    ⚠️ **뒤집으려면 의식적으로 뒤집게 되어 있다**: 창을 다시 넓히려면 이 픽스처를
    먼저 지워야 하고, 그때 위 오탐 4종이 대신 운다.
    """
    item = {
        "concept_tag": "air_mass",
        "question_type": "multiple_choice",
        "template_json": {
            "question_text": "명사 없는 서수 미탐 픽스처",
            "options": list(OPTIONS),
            "correct_answer": "비가 온다",             # 2번 자리
            "explanation_hint": "두 번째는 오독이다.",   # 그 2번을 오답이라 가리킨다 = 진짜 모순
        },
    }
    path = tmp_path / "items.json"
    path.write_text(json.dumps([item], ensure_ascii=False), encoding="utf-8")
    before = path.read_text(encoding="utf-8")

    # **실경로**를 통과시킨다 — `--remap-hints`를 켜도 결과가 같아야 한다.
    moved, skipped = _shuffle.process(path, write=True, remap_hints=True)

    # ⚠️ `process`의 반환은 `skipped + skipped_bare`를 **합쳐** 낸다. 명사 없는 서수
    # 하나뿐인 이 문항이 갈 수 있는 건너뛰기 경로는 `skipped_bare`밖에 없으므로
    # (`hint_uses_ordinals`가 False다) 이 `(0, 1)`이 곧 그 분기의 단정이다.
    assert (moved, skipped) == (0, 1), "실경로가 이 문항을 미탐으로 지나치지 않았다"
    assert path.read_text(encoding="utf-8") == before, "되돌림·재작성이 일어났다"
    assert lint.hint_position_errors(item) == [], "게이트 쪽 미탐이 아니라 판정이 바뀌었다"

    # 🔴 **없는 백스톱의 정체**: 함수 단독으로는 True인데 `process()`가 부르지 않는다.
    assert _shuffle.hint_contradicts("두 번째는 오독이다.", OPTIONS, "비가 온다"), (
        "함수 자체의 판정이 바뀌었다 — 그렇다면 이 픽스처의 서술을 다시 써야 한다"
    )


# ── 2026-08-18 리뷰 8건 회귀 가드 ────────────────────────────────────────────
# ⚠️ **이 블록은 「고치기 전에 실패를 먼저 만든」 것들이다.** PM 요구:
# *"「고쳤다」를 증명하려면 고치기 전에 그 어휘로 실패를 만들어 두 층이 다 놓치는
# 것을 보이고, 고친 뒤 잡히는 것까지 보여야 한다."* 기준선은 실측으로 남겼다 —
# 아래 각 단정 옆에 「고치기 전」 상태를 적어 둔다.
import shuffle_answer_positions as _shuffle  # noqa: E402


def test_오답_어휘를_두_층이_모두_잡는다():
    """🔴 **고치기 전: 게이트 놓침 · 셔플 놓침** — 가장 흔한 표현이 빠져 있었다.

    「두 번째 선지는 **오답이다**」가 `WRONG_CONTEXT`에 「오답」·「틀리」가 없어서
    **두 층 모두를 통과**했다. 「틀린 설명이다」가 잡히던 것은 「설명이다」라는
    **중립 어미에 우연히** 걸린 것이라 방어가 아니었다 — 그래서 「셔플이 잡는다」던
    이중 방어가 이 어휘에서 거짓이었고, 의도된-미탐 픽스처의 주석도 함께 거짓이었다.
    """
    item = _mc("두 번째 선지는 오답이다.", options=OPTIONS, answer="비가 온다")
    assert lint.hint_position_errors(item), "게이트가 「오답」 어휘를 놓쳤다"
    assert _shuffle.hint_contradicts("두 번째 선지는 오답이다.", OPTIONS, "비가 온다"), (
        "셔플도 놓쳤다 — 이중 방어가 성립하지 않는다"
    )


def test_정답이_아니다는_맞는_해설이다():
    """🔴 **고치기 전: 게이트가 탈락시켰다**(오탐) — 부정을 안 봤다.

    「두 번째 선지는 **정답이 아니다**」는 정답이 1번일 때 **맞는 서술**이다.
    긍정어(`정답`)만 보고 「오답 자리를 정답이라 가리킨다」로 판정했다.
    ⚠️ 래칫이 없는 게이트라 오탐의 탈출구가 **맞는 해설을 고쳐 쓰는 것**뿐이었다.
    """
    item = _mc("두 번째 선지는 정답이 아니다.", options=OPTIONS, answer="맑아진다")
    assert lint.hint_position_errors(item) == [], "부정 가드가 없다"


def test_정답_자리를_부정하면_잡는다():
    """부정 가드의 **반대 방향** — 뜻이 뒤집히므로 이쪽은 잡아야 한다.

    정답이 2번인데 「두 번째 선지는 정답이 아니다」라고 하면 맞힌 학습자에게
    틀렸다고 가르친다. 부정을 「무시」가 아니라 「극성 반전」으로 다루는 이유다.
    """
    item = _mc("두 번째 선지는 정답이 아니다.", options=OPTIONS, answer="비가 온다")
    errors = lint.hint_position_errors(item)
    assert errors and "정답 자리" in errors[0]


def test_중립_어미는_맞는_서술로_본다():
    """🔴 **고치기 전: 게이트가 탈락시켰다**(오탐) — 셔플의 광역 목록을 그대로 썼다.

    「두 번째 선지는 저기압의 **설명이다**」는 정답이 2번이어도 **틀렸다는 주장이
    아니다**. 게이트가 자기 낱말 목록을 갖고 중립 어미를 빼야 하는 이유다
    (셔플은 계속 넓게 본다 — 오탐 비용이 「안 옮김」뿐이라서).
    """
    for hint in ("두 번째 선지는 저기압의 설명이다.", "두 번째 선지는 고기압의 기준이다."):
        item = _mc(hint, options=OPTIONS, answer="비가 온다")
        assert lint.hint_position_errors(item) == [], hint


def test_절을_건너_걸린_모순은_셔플이_잡는다():
    """🔴 **고치기 전: 셔플이 놓쳤다** — 2026-08-14 절 경계 도입이 셔플까지 좁혔다.

    「첫 번째 선지는, **두 번째 선지와 마찬가지로**, 오독이다」는 정답이 1번일 때
    진짜 모순인데, 창을 이웃 서수에서 끊으면 「오독」이 창 밖으로 나간다.
    게이트는 좁은 창이 맞고(오탐 비용이 크다) **셔플은 넓어야 한다** — 그 비대칭이
    `clause_bounded` 손잡이의 존재 이유다. 주석은 「종전대로 넓게 본다」였는데
    코드가 아니었다.
    """
    hint = "첫 번째 선지는, 두 번째 선지와 마찬가지로, 오독이다."
    assert _shuffle.hint_contradicts(hint, OPTIONS, "맑아진다"), (
        "셔플이 절을 건너 걸린 모순을 놓쳤다"
    )


def test_숫자를_품은_단위와_공백_자릿수도_잡는다():
    """🔴 **고치기 전: 세 형태가 전부 None**이었다 — 잡으라는 결함이 빠져나갔다.

    `30m3`·`5km2`는 **단위 안에 숫자**가 있어 종전 문자 클래스가 못 받았고
    (면적·부피는 기상 문항에 흔하다), `1 000mm`는 **공백 자릿수 구분**이다.
    """
    for answer in ("30m3", "5km2", "1 000mm", "1,000mm", "30년"):
        item = {
            "question_type": "short_answer",
            "concept_tag": "anomaly",
            "level_group": "middle_high",
            "knowledge_level": 5,
            "template_json": {
                "question_text": "값은?",
                "correct_answer": answer,
                "explanation_hint": "해설.",
            },
        }
        codes = [code for code, _ in lint.grading_errors(item, grading=_GRADING)]
        assert "answer_unit_suffix" in codes, answer


def test_마지막은_보기_개수로_푼다():
    """🔴 **고치기 전: 3지선다에서 조용히 빠졌다** — 「마지막」이 4로 하드코딩됐다.

    현 시드는 MC 전건 4지라 잠재 결함이지만, 3지선다가 하나라도 저작되면
    「마지막 선지」가 **존재하지 않는 4번**을 가리켜 판정 밖으로 나간다.
    """
    three = ["가", "나", "다"]
    caught = _mc("마지막 선지가 정답이다.", options=three, answer="가")
    assert lint.hint_position_errors(caught), "3지선다의 「마지막」을 놓쳤다"
    # 정답이 실제로 마지막이면 맞는 서술이므로 잡으면 오탐이다
    fine = _mc("마지막 선지가 정답이다.", options=three, answer="다")
    assert lint.hint_position_errors(fine) == []


# ── 2026-08-18 **2차 리뷰** 5건 회귀 가드 ────────────────────────────────────
# ⚠️ 여기 문자열은 리뷰가 **재현으로 준 것 그대로**다(관례). 손대면 무엇을 잡는
# 계약인지가 흐려진다.
#
# **판정 기제**: 「창 안의 극성어를 전부 모아 **마지막 것이 이긴다**」 — 한국어는
# 서술어가 절 끝에 오므로 서수(주제)에 대한 주장은 창 안 **마지막** 극성어다.
# ⚠️ 브리핑이 권고한 「연결 어미 + 앵커 최근접」은 **실행해 보고 버렸다**: PM 함정
# (「두 번째 선지는 정답이고 세 번째 선지는 오답이다」)은 통과하지만 결함 1의 재현
# 두 개(「정답처럼 보이지만」·「정답과 혼동하기 쉬운」)에서 오탐이 살아남는다.
# 아래 26종 픽스처는 그 판정을 함께 문다 — 최근접으로 되돌리면 R1a·R1b가 운다.

# (이름, 해설) — **정답이 1번**일 때 「세 번째는 오답」은 **맞는 서술**이다.
CORRECT_HINTS_WITH_MIXED_POLARITY = [
    ("정답처럼 보이지만", "세 번째 선지는 정답처럼 보이지만 실제로는 오답이다."),
    # 재현 원문은 「정답과 혼동하기 쉬운 오답이다」 — 서수가 없으면 게이트에
    # 닿지 않으므로 앞머리(「세 번째 선지는」)만 붙여 그대로 쓴다.
    ("혼동하기 쉬운 오답", "세 번째 선지는 정답과 혼동하기 쉬운 오답이다."),
    ("정답이 아님", "세 번째 선지는 정답이 아님."),
    ("정답이 될 수 없다", "세 번째 선지는 정답이 될 수 없다."),
]


def test_맞는_해설이_긍정어_때문에_규탄되지_않는다():
    """🔴 **고치기 전: 넷 다 탈락**(오탐) — 창 안 **첫 긍정어만** 보고 끝냈다.

    「정답처럼 보이지만 … 오답이다」는 3번을 **오답이라 말하는** 문장인데,
    `claim_polarity`가 「정답」을 먼저 만나고 `GATE_WRONG_CONTEXT`를 **아예 안
    봤다**. 래칫이 없는 게이트라 탈출구가 「맞는 해설을 고쳐 쓰는 것」뿐이었다.
    「정답이 아님」·「정답이 될 수 없다」는 부정 꼬리 자체를 놓친 것이다
    (`아님`은 `아니`의 부분문자열이 아니고, 「될 수 없다」는 종전 창 6자 밖이다).
    """
    for name, hint in CORRECT_HINTS_WITH_MIXED_POLARITY:
        item = _mc(hint, options=OPTIONS, answer="맑아진다")  # 정답 1번
        assert lint.hint_position_errors(item) == [], f"{name}: 맞는 해설을 규탄했다"


def test_같은_문장이_정답_자리를_가리키면_잡는다():
    """미탐으로 도망가지 않았다는 증거 — 극성 판정이 **뒤집힌 방향**도 본다.

    정답이 3번인데 「세 번째 선지는 … 오답이다」라고 하면 맞힌 학습자에게
    틀렸다고 가르친다. 위 넷을 통과시키는 것이 「서수를 보면 포기한다」가 아니다.
    """
    for name, hint in CORRECT_HINTS_WITH_MIXED_POLARITY:
        item = _mc(hint, options=OPTIONS, answer="눈이 온다")  # 정답 3번
        errors = lint.hint_position_errors(item)
        assert errors and "정답 자리" in errors[0], f"{name}: 모순을 놓쳤다"


def test_앞_절의_긍정어가_뒤_서수로_새지_않는다():
    """🔴 **고치기 전: 탈락**(오탐) — 창의 **좌측 경계**가 이전 서수 *토큰* 끝까지만
    잘라 앞 절이 새어들었다.

    「두 번째 선지는 정답이고 세 번째 선지는 오답이다」(정답 **2번**)에서 3번의
    창이 「…는 정답이고 세 번째…」를 물어 「오답 자리를 정답이라 가리킨다」가 됐다.
    1차 회귀 픽스처(`FALSE_POSITIVES`의 「절 경계」)는 **우측만** 쟀다.
    """
    item = _mc(
        "두 번째 선지는 정답이고 세 번째 선지는 오답이다.", options=OPTIONS, answer="비가 온다"
    )
    assert lint.hint_position_errors(item) == [], "좌측 경계로 앞 절이 새어들었다"


def test_앞_문장의_부정된_긍정어가_오판정을_만들지_않는다():
    """🔴 **고치기 전: 오판정** — `while index != -1`이 **한 번도 반복하지 못하는
    죽은 루프**였다(모든 경로가 return이고 `index`가 재계산되지 않았다).

    「두 번째 선지는 정답이 아니다. 세 번째 선지가 정답이다」(정답 **3번**)에서
    3번의 창이 앞 문장의 「정답이 아니다」를 먼저 만나 `wrong`으로 확정되고,
    그것이 정답 자리와 겹쳐 「정답 자리를 오답이라 가리킨다」가 됐다.
    """
    item = _mc(
        "두 번째 선지는 정답이 아니다. 세 번째 선지가 정답이다.",
        options=OPTIONS,
        answer="눈이 온다",
    )
    assert lint.hint_position_errors(item) == [], "앞 문장이 창으로 새어들었다"


def test_옳지_않다도_부정으로_읽는다():
    """🔴 **고치기 전: 두 층 모두 놓쳤다** — 리뷰가 부수로 지적한 공백.

    `GATE_RIGHT_CONTEXT`에 「옳다」·「옳은」은 있는데 **어간 「옳지」가 없었고**,
    부정어에 「않」이 없었다. 그래서 「세 번째 선지는 옳지 않다」가 극성 없음(None)이
    되어 정답 자리를 가리켜도 조용히 빠졌다.
    """
    caught = _mc("세 번째 선지는 옳지 않다.", options=OPTIONS, answer="눈이 온다")
    errors = lint.hint_position_errors(caught)
    assert errors and "정답 자리" in errors[0], "「옳지 않다」를 놓쳤다"
    # 오답 자리를 가리키면 맞는 서술이므로 잡으면 오탐이다
    fine = _mc("세 번째 선지는 옳지 않다.", options=OPTIONS, answer="맑아진다")
    assert lint.hint_position_errors(fine) == []


def test_셔플_목록에도_같은_공백이_있었다():
    """두 층은 목록을 **공유하지 않는 것이 설계**다 — 그래서 따로 확인한다.

    셔플의 `WRONG_CONTEXT`에도 「않」·「없」·「반대」·「어긋」이 없어서 같은 문장들이
    통과했다(실측: 이 넷을 넣어도 본시드에서 새로 걸리는 것은 **1건**뿐이고 그
    1건이 아래 「선택지」 문항 = 진짜 결함이다. 2026-08-18, 시드 1,012건).
    """
    for hint in (
        "세 번째 선지는 옳지 않다.",
        "세 번째 선지는 정답이 될 수 없다.",
        "세 번째 선지는 방향이 반대다.",
    ):
        assert _shuffle.hint_contradicts(hint, OPTIONS, "눈이 온다"), hint


def test_숫자로_시작하는_낱말은_단위_결합이_아니다():
    """🔴 **고치기 전: 넷 다 탈락**(오탐) — **틀린 조치를 지시했다.**

    `_ANSWER_WITH_UNIT_RE`가 「숫자+아무 글자」를 수치+단위로 읽어서 「2차전지」에
    「단위는 지문에 두고 정답은 맨 숫자로」라고 시켰다 — 정답을 「2」로 만들라는 뜻이다.
    방향은 **단위 화이트리스트**다(지문 파싱보다 낫다).
    """
    for answer in ("2차전지", "1등성", "3중수소", "4계절"):
        item = {
            "question_type": "short_answer",
            "template_json": {"question_text": "무엇인가?", "correct_answer": answer},
        }
        codes = [code for code, _ in lint.grading_errors(item, grading=_GRADING)]
        assert "answer_unit_suffix" not in codes, f"{answer}: 일반 낱말을 단위로 읽었다"


def test_선택지도_선지를_뜻하는_말이다():
    """🔴 **고치기 전: 두 층 모두 조용히 빠졌다** — `_OPTION_NOUNS`에 「선택지」가 없었다.

    그 결과 배포 시드에서 **해설에 「선택지」를 쓰는 유일한 문항**(PM 전수 스윕 1건 ·
    `concept_tag=typhoon` · `knowledge_level=7` · 1-기준 [575])이 「명사 없는 서수」로
    오분류돼 게이트·셔플 양쪽에서 빠졌다. 그런데 그 문항은 **정답이 2번인데 해설이
    2번을 틀렸다고 말한다** — ⑥ⓐ가 잡으려고 있는 바로 그 결함이다.
    """
    hint = "전향력은 위도가 높을수록 커지므로 두 번째 선택지는 방향이 반대다."
    item = _mc(hint, options=OPTIONS, answer="비가 온다")  # 정답 2번
    errors = lint.hint_position_errors(item)
    assert errors and "정답 자리" in errors[0], "「선택지」를 선지 명사로 못 읽었다"
    # ⑥ⓑ(자리 참조 래칫)와 셔플의 분류도 함께 바뀐다 — 「옮길 수 있는」 형태가 된다
    assert lint.hint_ordinal_errors(item), "⑥ⓑ가 자리 참조로 못 읽었다"
    assert _shuffle.hint_uses_ordinals(hint)
    assert not _shuffle.hint_has_bare_ordinal(hint), "여전히 명사 없는 서수로 읽는다"

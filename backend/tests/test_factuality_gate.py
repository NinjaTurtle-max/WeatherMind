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


# ── ⑥ⓐ 해설–정답 위치 모순 — **절제됨 (2026-08-19)** ────────────────────────
# 이 절에 「정답 자리를 오답이라 말한다/오답 자리를 정답이라 말한다」 픽스처가 있었다.
# **되살리지 말 것.** 판정 층(`claim_polarity`)이 세 라운드 내내 매번 다른 언어적
# 이음매에서 새 오탐을 냈고, 3차 리뷰가 **같은 문형이 한 방향에서 오탐·반대 방향에서
# 미탐**임을 실행으로 보였다. 실현된 결과는 **실제 적발 0건 · 실제 오탐 3라운드**이고
# 실사례 2건은 둘 다 사람이 잡았다. 남은 경계: **스캔 층은 남고 판정 층은 사람이다.**
# 세 라운드 재현 문자열은 죽은 픽스처가 아니라 **판정 기록**으로 옮겼다 —
# `scripts/lint_seed_items.py` 모듈 머리 ⛔ · docs/team/CARRYOVER_R13.md 이월 행.


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
    """「두 번째 몫」을 걸면 오탐이다.

    ⚠️ 종전 「본시드 실측 4건」은 **시드 272건 시절 값**이었다(2026-08-19 정정).
    재실측 3건 — 인구와 세는 규칙은
    `test_명사_없는_자리_참조는_파이프라인이_그냥_지나친다`가 날짜와 함께 소유한다.
    """
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
        # ⑥ⓐ(위치 모순)는 2026-08-19에 절제됐다 — 여기서 부를 판정이 없다.
    assert not live, "래칫에 없는 사실성 적발:\n" + "\n".join(live)


# ── 오탐 회귀 가드 (2026-08-14 코드 리뷰 실행 재현) ──────────────────────────
# ⚠️ **이 게이트에는 래칫이 없다**(위 테스트가 그 없음을 지킨다). 그래서 오탐 하나가
# 「맞는 해설을 고쳐 쓰는 것」 말고 탈출구가 없는 상태를 만든다 — 게이트가 사람을
# 틀렸다고 규탄하는 자리가 된다. 아래 넷은 리뷰가 **실제로 실행해 재현한** 오탐이고,
# 셋은 명사 가드 부재, 하나는 창이 절 경계를 넘은 것이 원인이었다.


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
    「본시드 실측 4건」이 **시드 272건 시절 값**인 채로 남았다). 세는 규칙까지 적는다:
    *mc 해설 중 「명사 없는 서수만」 = `hint_has_bare_ordinal`이 참이고
    `hint_uses_ordinals`가 거짓인 **문항 수**(서수 출현 수가 아니다)*.
      · **시드 1,018건 · mc 310건**(2026-08-18 실측, `origin/main` `56be6f6` 병합 후 —
        [575] 수리 반영): 명사 없는 서수만 **3건**(실제 선지 참조 2건 · 본문 서수
        「두 번째 몫」 1건) · 명사 있는 서수 **7건**(⑥ⓑ 래칫 7항과 일치).
        「선택지」 추가는 이 값을 **바꾸지 않는다**(수리로 그 형태가 사라졌다).
      · 같은 날 **PM 전수 스윕**은 명사 없는 서수 **5건** · 명사 있는 서수 **6건**으로
        보고했다. ⚠️ 어긋나는 것을 **그대로 남긴다** — 세는 규칙이나 스윕 시점이 다를
        수 있고, 이 트리에서 그쪽 수를 재현할 방법이 없다. 합치지 말 것.

    ⚠️ **2026-08-19 재도출**: 이 픽스처는 원래 「게이트(⑥ⓐ)는 놓치지만 셔플이 잡는다」의
    맞바꿈을 단정했다. 그 ⑥ⓐ가 **절제됐으므로 게이트 쪽 단정을 걷었다** — 남는 사실은
    **셔플 쪽 진실**이고 그것은 절제와 무관하게 그대로다: `process()`가 명사 없는 서수를
    건너뛰고 revert가 발화하지 않는다. 통째로 지우지 않는 이유는 그러면 **파이프라인이
    이 부류를 지나친다는 사실 자체가 기록에서 사라지기** 때문이다.
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
    # ⑥ⓑ도 이 부류를 안 본다(명사 가드) — 두 층 모두 지나친다는 것이 이 픽스처의 사실이다.
    assert lint.hint_ordinal_errors(item) == [], "명사 가드가 아니라 판정이 바뀌었다"

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


def test_절을_건너_걸린_모순은_셔플이_잡는다():
    """🔴 **고치기 전: 셔플이 놓쳤다** — 2026-08-14 절 경계 도입이 셔플까지 좁혔다.

    「첫 번째 선지는, **두 번째 선지와 마찬가지로**, 오독이다」는 정답이 1번일 때
    진짜 모순인데, 창을 이웃 서수에서 끊으면 「오독」이 창 밖으로 나간다.
    게이트는 좁은 창이 맞고(오탐 비용이 크다) **셔플은 넓어야 한다** — 그 비대칭이
    `clause_bounded` 손잡이의 존재 이유였다. 주석은 「종전대로 넓게 본다」였는데
    코드가 아니었다.

    ⚠️ **2026-08-21에 손잡이가 없어졌고 이 단정은 그대로 통과한다.** 「끊는다/안
    끊는다」의 이지선다가 매번 한쪽으로 무너진 이유는 **끊는 자리를 「이웃 서수」로
    잡았기** 때문이다. 지금은 **주격으로 표시된** 이웃 서수에서만 절이 열린다 —
    「두 번째 선지**와**」는 공동격이라 절을 열지 않으므로 이 문장은 한 절이고
    「오독」이 창 안에 남는다. 곧 이 픽스처가 **새 경계의 하한선**이다.
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


# ── 2026-08-18 2차 리뷰 잔여 — **판정 층 몫은 전부 절제됐다 (2026-08-19)** ────
# 2차 리뷰의 결함 1·2·3(극성 판정 · 창 좌측 경계 · 죽은 루프)은 **고쳐졌다가 함께
# 절제됐다.** 세 라운드가 같은 판정을 세 번 고쳤고 매번 새 오탐이 났기 때문이다.
# 아래에 남은 것은 **판정 층이 아닌 것**뿐이다: ⑥ⓒ 단위 화이트리스트(결함 5)와
# 「선택지」 어휘. 재현 문자열은 판정 기록으로 옮겼다(⑥ⓐ 절 머리 · 이월 행).


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

    그 결과 배포 시드에서 **해설에 「선택지」를 쓰던 유일한 문항**(`concept_tag=typhoon` ·
    `knowledge_level=7` · 1-기준 [575])이 「명사 없는 서수」로 오분류돼 자리 참조를 보는
    층 전부에서 빠졌다. 그 문항은 **정답이 2번인데 해설이 2번을 틀렸다고 말했다.**

    🔴 **이 낱말이 절제에서 살아남는 이유**: 2026-08-19에 극성 판정(⑥ⓐ)은 절제됐지만
    **어휘는 판정이 아니다.** 같은 부류 실사례 2건의 **재현율은 어휘에서 왔고 실패는
    판정에서 왔다** — 어휘를 함께 걷어내면 절제가 경계를 잘못 그은 것이 된다.
    그래서 이 픽스처는 이제 **⑥ⓑ(자리 참조 자체 금지)와 셔플의 분류**만 단정한다.

    ⚠️ **문장이 합성인 이유**: 그 문항은 **PR #109에서 이미 수리됐다**(서수 참조를
    없애고 선지 **내용**을 인용하는 형태 — ⑥ⓑ가 지시하는 처방 그대로다). 그래서
    시드에는 이 형태가 **한 건도 남아 있지 않고**(2026-08-18 실측: 해설에 「선택지」
    0건 · 시드 1,018건), 합성이 유일한 고정 방법이다. 아래 문자열은 **수리 전 [575]의
    해설 꼬리**를 그대로 옮긴 것이다.

    ⚠️ **부수 피해는 0이다**(실측: 명사 있는 서수 7건 → 7건). 그러나 계약이 없으면
    다음 사람이 「쓰이지도 않는 낱말」이라며 지운다 — **지워지면 같은 오분류가 그대로
    돌아온다.** 이 픽스처가 그 낱말의 소유자다(리드 브랜치의
    `test_seed_contract.py::TestFixSurvival` 태풍 핀이 병합되면 그쪽과 둘이 된다 —
    2026-08-19 현재 이 트리에는 아직 없어서 여기서 단독으로 문다).
    """
    hint = "전향력은 위도가 높을수록 커지므로 두 번째 선택지는 방향이 반대다."
    item = _mc(hint, options=OPTIONS, answer="비가 온다")  # 정답 2번
    # ⑥ⓑ — **자리 참조 자체**를 건다(극성을 묻지 않는다). 절제 후 남은 판정이 이것이다.
    assert lint.hint_ordinal_errors(item), "⑥ⓑ가 「선택지」를 자리 참조로 못 읽었다"
    # 셔플의 분류도 함께 바뀐다 — 「옮길 수 없는 것」에서 「옮길 수 있는 것」이 된다.
    assert _shuffle.hint_uses_ordinals(hint)
    assert not _shuffle.hint_has_bare_ordinal(hint), "여전히 명사 없는 서수로 읽는다"


# ── 2026-08-21 · `hint_contradicts` 오탐 수리 (창을 글자 수 → 절로) ──────────
# 🔴 **기제**: 종전 창은 `[서수-10, 서수+45]`라는 **글자 수**였다. 한국어는 주어가
# 앞·서술어가 뒤라 그 창이 **이웃 절의 서술어를 그대로 빨아들인다** — 그래서
# 「…오독이고, **세 번째 선지가 정답이다**」의 그 **정답 절**이 옆 절의 「오독」으로
# 규탄됐다. 낱말을 못 읽은 것이 아니라 **낱말을 엉뚱한 자리에 붙인 것**이다.
# 실측(2026-08-21 · 시드 1,943건 · mc 600건 · 서수를 품은 해설 10종):
#   · 「두 번째는 … 혼동한 **것이고**, 세 번째는 여름 내륙의 열저기압이며」 —
#     3번의 근거가 **전부 2번 절에서 새어 온 것**이고 3번 절엔 오답 낱말이 없다.
#   · 「두 번째와 세 번째는 각각 A와 B, 네 번째는 C의 **기준이다**」 — 같은 한 절인데
#     45자 안에 든 3·4번만 걸리고 2번은 빠진다. **뜻이 아니라 산술이었다.**
# 🔴 **수리 방향은 「지우기」가 아니라 「붙이는 자리 고치기」다.** 낱말표
# (`WRONG_CONTEXT`)는 **한 낱말도 빼지 않았다** — 빼면 진짜 모순을 놓치는 쪽으로
# 무너진다. 창만 절로 바꿨다.
# 🔴 **아래 표는 두 방향을 함께 잰다.** 오탐만 보고 고치면 미탐으로 무너지므로
# 진짜 모순 11종을 같은 표에서 함께 문다(고치기 전 옛 규칙: 진짜 11/11 · 오탐 6/6).
_FP_FIXTURES = (
    ("뒤 절이 정답을 지목", "두 번째 선지는 오독이고, 세 번째 선지가 정답이다.", 3),
    ("앞 절이 정답을 지목", "네 번째 선지가 정답이고, 첫 번째 선지는 오독이다.", 4),
    ("다음 문장이 오답을 지목", "세 번째 선지가 정답이다. 두 번째 선지는 엘니뇨의 설명이다.", 3),
    # P-12(CARRYOVER 이월 행) — 「나머지는 오답이다」는 **맞는 해설의 마무리 관용구**다.
    ("나머지는 오답이다", "첫 번째 선지가 정답이다. 나머지는 오답이다.", 1),
    ("실시드꼴 · 온대저기압", "두 번째는 태풍의 에너지원과 혼동한 것이고, 세 번째가 정답이다.", 3),
    ("앞 문장 규탄 · 뒤 문장 정답", "첫 번째 선지는 오독이다. 네 번째 선지가 답이다.", 4),
)
_TP_FIXTURES = (
    ("명사 없는 자리 지목", "두 번째는 오독이다.", 2),
    ("절을 건너 걸린 모순", "첫 번째 선지는, 두 번째 선지와 마찬가지로, 오독이다.", 1),
    ("실시드 · 라니냐", "라니냐는 엘니뇨의 반대쪽 상태다. 두 번째 선지는 엘니뇨의 설명이다.", 2),
    (
        "실시드 앞절 · 지균풍",
        "네 번째 선지는 전향력을 바람을 미는 힘으로 잘못 읽은 것이고,"
        " 세 번째는 균형의 한쪽만 본 것이다.",
        4,
    ),
    (
        "실시드 뒷절 · 지균풍",
        "네 번째 선지는 전향력을 바람을 미는 힘으로 잘못 읽은 것이고,"
        " 세 번째는 균형의 한쪽만 본 것이다.",
        3,
    ),
    (
        "실시드 소유격 · 온난화",
        "전향력은 위도로만 정해지고 기온 차와 무관하다는 점이 네 번째 선지의 오독이다.",
        4,
    ),
    (
        "실시드 문미 · 남서풍",
        "상승이 빠를수록 강수 강도가 세진다. 첫 번째 선지는 곱의 한쪽 인자만 본 오독이다.",
        1,
    ),
    ("오답 어휘", "세 번째 선지는 오답이다.", 3),
    ("틀린 어휘", "두 번째 선지는 틀린 설명이다.", 2),
    ("낱말이 서수보다 앞", "오답은 두 번째 선지다.", 2),
    ("마지막 선지 지목", "마지막 선지는 파장대를 뒤섞은 오독이다.", 4),
)


@pytest.mark.parametrize("name,hint,slot", _FP_FIXTURES, ids=[f[0] for f in _FP_FIXTURES])
def test_옆_절이_지목한_오답으로_정답_자리를_규탄하지_않는다(name, hint, slot):
    """🔴 **고치기 전: 여섯 종 전부 걸렸다**(오탐 6/6).

    걸리면 그 문항이 **MT-15 재배치에서 영구 제외**되고 `skipped_bare`에 잘못
    집계된다 — 정답 위치 쏠림에서 그 문항들만 남는다. 곧 이 오탐의 값은
    「안 옮김」이 아니라 **MT-15가 고치려던 상태 그 자체**다.
    """
    assert not _shuffle.hint_contradicts(hint, OPTIONS, OPTIONS[slot - 1]), (
        f"{name}: 해설이 {slot}번을 오답이라 말하지 않는데 모순으로 읽었다 — {hint}"
    )


@pytest.mark.parametrize("name,hint,slot", _TP_FIXTURES, ids=[f[0] for f in _TP_FIXTURES])
def test_진짜_모순은_창을_절로_좁힌_뒤에도_걸린다(name, hint, slot):
    """🔴 **오탐 수리가 미탐으로 무너지지 않았다는 증거** — 11종 전건.

    ⚠️ 「절을 건너 걸린 모순」이 여기 함께 있는 것이 핵심이다: 2026-08-14 절 경계가
    **바로 이 부류를 놓쳐** 되돌려졌다. 이번 경계는 「이웃 서수」가 아니라 **주격으로
    표시된 이웃 서수**에서만 열리므로 「두 번째 선지**와** 마찬가지로」(공동격)는
    절을 열지 않고, 그 진짜 모순이 계속 걸린다.
    """
    assert _shuffle.hint_contradicts(hint, OPTIONS, OPTIONS[slot - 1]), (
        f"{name}: {slot}번을 오답이라 말하는 해설을 놓쳤다 — {hint}"
    )


def test_시드_전건에서_판정이_바뀐_것은_두_건이고_둘_다_새던_창이다():
    """🔴 **개정 폭을 수치로 못 박는다** — 시드 전건 대조(2026-08-21).

    서수를 품은 mc 해설 **314종 중 312종은 판정이 같고**, 달라진 **2종**은 둘 다
    「이웃 절 서술어가 새어 와 걸리던 자리」다(폭염중대경보 3번 · 온대저기압 3번).
    그 2종은 **명사 없는 서수**라 실경로에서는 `hint_has_bare_ordinal`이 먼저
    건너뛰므로 셔플 결과가 바뀌지 않는다 — 곧 **실경로 진짜 모순 손실 0**이다.
    """
    changed = (
        (
            "주의보·경보는 '이틀 넘게 이어질 것'을 조건으로 두지만, 중대경보는 하루만"
            " 예상되어도 발표한다는 점이 다르다. 두 번째와 세 번째는 각각 폭염경보와"
            " 폭염주의보, 네 번째는 열대야주의보의 기준이다."
        ),
        (
            "온대저기압은 찬 공기가 가라앉고 따뜻한 공기가 올라가며 무게중심을 낮추는"
            " 과정에서 에너지를 얻는다. 두 번째는 태풍의 에너지원과 혼동한 것이고,"
            " 세 번째는 여름 내륙의 열저기압이며, 전향력은 방향만 바꾸고 일을 하지 않는다."
        ),
    )
    for hint in changed:
        assert _shuffle.hint_has_bare_ordinal(hint), (
            "명사 없는 서수가 아니게 됐다 — 그렇다면 이 2건이 실경로에 노출되므로"
            " 판정 변화를 다시 재야 한다"
        )

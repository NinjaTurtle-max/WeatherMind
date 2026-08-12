"""생성 문항 payload 계약 — backend `QUESTION_PAYLOAD_FIELDS` ↔ ai-worker 생성 선언.

`docs/team/CONTRACT_GEN_ITEM.md` 계약 G-3의 감시자다.

## 왜 이 테스트가 있는가

서버가 문항을 프론트에 노출할 때 유형별로 어떤 payload 필드를 실어 보내는지는 backend
`session.py`의 `QUESTION_PAYLOAD_FIELDS`가 **단일 소유자**다. 그런데 문항을 **생성**하는
쪽은 ai-worker이고, ai-worker는 별도 빌드 컨텍스트라 backend를 import할 수 없다
(CLAUDE.md "교차 빌드 컨텍스트 중복은 물리적 병합이 아니라 단일 소유자+계약 테스트로
해소" — `test_xp_contract`·`test_kma_contract`와 같은 관례).

그래서 ai-worker는 `GENERATED_PAYLOAD_FIELDS`로 자기 선언을 갖고, 이 테스트가 양쪽을
실임포트해 대조한다. 드리프트하면 **생성 문항이 서버가 노출하지 못하는 형태로 만들어
진다** — 그게 정확히 R10-07이 시드에서 고친 결함이고(53문항 중 6문항 API 미노출),
생성 경로는 저작으로 막을 수 없어서 여기서 막는다.

## 실측 근거 (2026-08-03)

`QuizQuestion`은 `question_type`에 `slider`를 허용하면서 `min`·`max`·`step`·`unit`
필드가 없었다. 생성 slider는 `session_service`가 flat dict를 그대로 담기 때문에
(`:544-552`) `_question_payload`가 `None`을 돌려주고, 프론트는 `?? 0`/`?? 100`으로
폴백한다 — "초속 몇 m 이상"(정답 17, 시드 범위 0~40) 문항이 0~100 슬라이더로 나오고
`SLIDER_TOLERANCE=10`이 절대값이라 사실상 공짜 정답이 된다.

## 왜 계약 상수를 `payload_contract`가 소유하는가

이 환경에는 langchain이 설치돼 있지 않다(ai-worker 스위트의 skip 7건이 그것 — 관례는
`pytest.importorskip`). langchain을 최상단에서 끌어오는 모듈을 실임포트하면 이 파일이
통째로 ERROR가 되고, `importorskip`으로 우회하면 계약이 **조용히 skip**된다 — R10
웨이브 2가 CI SKIP 방어로 막은 바로 그 패턴이다. 그래서 계약 상수는 stdlib+pydantic만
쓰는 `payload_contract`가 단독 소유한다(계약 G-3 보정).

같은 이유로 **생성 경로 세 모듈 전부**가 지연 임포트로 맞춰졌다 —
`test_생성_경로가_langchain을_최상단에서_끌어오지_않는다`가 그것을 감시한다.

`Literal` 대조는 `QuizQuestion`이 어느 파일에 있어도 성립해야 하므로 **소스 AST**로
읽는다(`test_r10_mock_parity_contract`가 목 소스를 읽는 것과 같은 관례).

## 생성 대상이 3종 → 6종으로 넓어졌다 (2026-08-10, CO-O-13)

**이 파일의 직전 판은 "board·match·ordering·cloze는 생성하지 않는다"를 계약으로
못박고 있었다. 그 절반이 뒤집혔다.** CARRYOVER `O-13`이 근거다 — G1으로는 유형
3종만 나오므로 **뱅크 유형 다양성이 키 투입으로 늘지 않는다**. `cloze`·`match`·
`ordering`을 생성 대상에 넣어 6종으로 넓힌다. `board`는 계속 제외다(판정 구조
`board_rules.json`이 필요하고 게이트가 그것을 읽지 않는다 — CARRYOVER O-11).

그래서 **`GENERATABLE_TYPES`가 6종이 됐고 대조가 `<=`에서 `==`로 바뀌었다.**
부분집합 비교는 "아직 3종뿐인 구현"을 조용히 통과시킨다 — 넓히는 작업이 절반만
착지한 상태를 계약이 못 잡으면 계약이 없는 것과 같다.

## 명세의 근거 — 본시드 실측 (2026-08-10, 284건 전건)

아래 `CONTRACT_REQUIRED_PAYLOAD`·`SERVER_EXPOSED_PAYLOAD` 두 표는 구현을 읽고 적은
것이 아니라 **`database/seed/content_items.json` 284건을 기계로 검증한 결과**다
(cloze 35 전건 `___` 보유 · match 28 전건 `pairs`↔`correct_answer` 정확 일치 ·
ordering 27 전건 항등 순열 + `shuffled: true` · slider 32 전건 4필드 + 계약 G-2 —
**위반 0건**). 사람 저작 코퍼스가 이미 이 규칙을 100% 지키고 있으므로, 생성분에
같은 규칙을 요구하는 것은 새 제약이 아니라 **기존 규약의 명문화**다.

**범위 밖**: 폴백 문항(`_fallback_question`)이 계약을 통과하는지는 ai-worker 스위트
(`test_quiz_gen_payload.py`)가 본다. multiple_choice의 `correct_answer ∈ options`는
1차 게이트(`_check_options`, 계약 G-1)의 몫이라 여기서 보지 않는다.

DB·네트워크·LLM 키 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import ast
import importlib
import json
import sys
from pathlib import Path

import pytest

from app.routers.session import QUESTION_PAYLOAD_FIELDS
from app.services.session_service import GENERATED_ITEM_TYPES

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_WORKER_DIR = REPO_ROOT / "ai-worker"
CHAINS_DIR = AI_WORKER_DIR / "app" / "chains"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"

# 생성 대상 유형 — 계약 G-1 + CO-O-13(2026-08-10 확장). **7종 중 board만 뺀 6종**이다.
# board는 board_rules.json 판정 구조가 필요하고 게이트가 그것을 읽지 않아 제외한다.
GENERATABLE_TYPES = frozenset(
    {"multiple_choice", "short_answer", "slider", "cloze", "match", "ordering"}
)

# 유형별 필수 payload — **이 표가 명세다**(모듈 독스트링 「명세의 근거」 참조).
# 구현이 이 표에 맞춰야 하며, 구현을 보고 이 표를 고치지 않는다.
CONTRACT_REQUIRED_PAYLOAD: dict[str, frozenset[str]] = {
    "multiple_choice": frozenset({"options"}),
    "short_answer": frozenset(),
    "slider": frozenset({"min", "max", "step", "unit"}),
    "cloze": frozenset(),
    "match": frozenset({"pairs"}),
    "ordering": frozenset({"items", "shuffled"}),
}

# 서버가 template_json으로 실어 내보내는 필드(backend `QUESTION_PAYLOAD_FIELDS` 명세값).
# **multiple_choice의 `options`가 여기 없는 것이 정상**이다 — 객관식 보기는 payload가
# 아니라 `SessionItem.options` 전용 컬럼으로 나간다(session.py:74 주석). 그래서 생성
# 필수 필드와 서버 노출 필드는 mc에서만 갈라지고, 나머지 5종은 같아야 한다.
SERVER_EXPOSED_PAYLOAD: dict[str, frozenset[str]] = {
    "multiple_choice": frozenset(),
    "short_answer": frozenset(),
    "slider": frozenset({"min", "max", "step", "unit"}),
    "cloze": frozenset(),
    "match": frozenset({"pairs"}),
    "ordering": frozenset({"items", "shuffled"}),
}


def _import_payload_contract():
    """ai-worker app.chains.payload_contract를 backend `app`과 충돌 없이 임포트한다.

    (test_xp_contract._import_celery_league와 동일 패턴 — 두 디렉토리가 최상위
    패키지명 `app`을 공유하므로 sys.modules를 스왑한다.)
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(AI_WORKER_DIR))
    try:
        module = importlib.import_module("app.chains.payload_contract")
    finally:
        sys.path.remove(str(AI_WORKER_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


def _literal_question_types() -> set[str]:
    """`QuizQuestion.question_type`의 Literal 인자를 소스에서 읽는다.

    실임포트하지 않는 이유는 모듈 독스트링 참조. `QuizQuestion`이 어느 파일로 옮겨져도
    찾도록 chains 디렉토리를 훑는다 — 못 찾으면 실패다(조용히 통과하면 계약이 없다).
    """
    for path in sorted(CHAINS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.ClassDef) and node.name == "QuizQuestion"):
                continue
            for stmt in node.body:
                if not (
                    isinstance(stmt, ast.AnnAssign)
                    and isinstance(stmt.target, ast.Name)
                    and stmt.target.id == "question_type"
                ):
                    continue
                ann = stmt.annotation
                if isinstance(ann, ast.Subscript):
                    args = ann.slice
                    elts = args.elts if isinstance(args, ast.Tuple) else [args]
                    return {
                        e.value
                        for e in elts
                        if isinstance(e, ast.Constant) and isinstance(e.value, str)
                    }
    pytest.fail(
        f"{CHAINS_DIR} 어디에도 QuizQuestion.question_type의 Literal이 없다 — "
        "생성 허용 유형 선언이 사라졌거나 형태가 바뀌었다"
    )


@pytest.fixture(scope="module")
def contract():
    return _import_payload_contract()


@pytest.fixture(scope="module")
def check_payload(contract):
    """계약 G-3의 「검사 함수」 — `payload_contract`만 import해서 도달해야 한다.

    `scripts/author_items.py:216`이 이 이름으로 바인딩하므로(저작 배치 4단계 ⓒ)
    이름이 바뀌면 배치가 깨진다. 없으면 skip이 아니라 **실패**다 — 조용히 건너뛰면
    아래 값 규칙 테스트 전부가 있는 척만 하게 된다.
    """
    fn = getattr(contract, "check_payload", None)
    if not callable(fn):
        pytest.fail(
            "payload_contract.check_payload가 없거나 호출 가능하지 않다 — 계약 G-3은 "
            "「상수와 검사 함수」 둘 다 이 모듈로 도달할 것을 요구한다"
            "(scripts/author_items.py:216이 이 이름을 쓴다)"
        )
    return fn


# ── 서버 전개형 문항 대역 ─────────────────────────────────────────────────────
# `check_payload`는 `author_items.expand_like_server`의 산출물, 즉
# `{**template_json, concept_tag, question_type}` flat dict를 받는다(author_items:383).
# 아래 대역은 전부 **본시드 실항목에서 그대로 가져온 값**이라, "통과해야 한다"는 단정의
# 근거가 사람 저작 코퍼스다.
def _pairs_answer(pairs: list[dict]) -> str:
    """match 정답 표기 — `"left:right|left:right"` (본시드 28건 전건 이 형태)."""
    return "|".join(f"{p['left']}:{p['right']}" for p in pairs)


def _cloze(**overrides) -> dict:
    """본시드 heat_island cloze. 추가 payload 없음 — 빈칸은 question_text가 갖는다."""
    question = {
        "concept_tag": "heat_island",
        "question_type": "cloze",
        "question_text": "밤 최저기온이 ___℃ 아래로 내려가지 않는 밤을 열대야라고 한다.",
        "correct_answer": "25",
    }
    question.update(overrides)
    return question


def _match(pairs: list[dict] | None = None, **overrides) -> dict:
    """본시드 pressure_front match. 정답은 pairs에서 파생 — 어긋남을 만들려면 명시 override."""
    pairs = pairs if pairs is not None else [
        {"left": "한랭전선", "right": "좁은 지역에 강한 소나기"},
        {"left": "온난전선", "right": "넓은 지역에 오래 내리는 약한 비"},
        {"left": "정체전선", "right": "여러 날 이어지는 장마"},
    ]
    question = {
        "concept_tag": "pressure_front",
        "question_type": "match",
        "question_text": "전선의 종류와, 그 전선이 만드는 비의 특징을 연결하세요.",
        "pairs": pairs,
        "correct_answer": _pairs_answer(pairs),
    }
    question.update(overrides)
    return question


def _ordering(**overrides) -> dict:
    """본시드 typhoon ordering. items가 정답 순서이므로 정답은 항등 순열이다."""
    question = {
        "concept_tag": "typhoon",
        "question_type": "ordering",
        "question_text": "태풍의 일생을 일어나는 순서대로 배열하세요.",
        "items": [
            "따뜻한 열대 바다에서 수증기가 증발해 열대 저기압이 생긴다",
            "수증기가 응결하며 내놓는 열을 에너지로 삼아 태풍으로 발달한다",
            "태풍이 육지에 상륙한다",
            "수증기 공급이 줄어 세력이 급격히 약해진다",
        ],
        "shuffled": True,
        "correct_answer": "0,1,2,3",
    }
    question.update(overrides)
    return question


def _seed_questions(question_type: str) -> list[dict]:
    """본시드 항목을 서버 전개형으로 편다(session_service.py:502-506과 같은 방식)."""
    return [
        {
            **(item.get("template_json") or {}),
            "concept_tag": item.get("concept_tag"),
            "question_type": item.get("question_type"),
        }
        for item in json.loads(SEED_PATH.read_text(encoding="utf-8"))
        if item.get("question_type") == question_type
    ]


class TestGeneratedPayloadContract:
    """생성 선언이 서버 노출 계약과 어긋나지 않아야 한다."""

    def test_상수가_노출된다(self, contract):
        """계약 G-3: 위치·이름·형태가 고정이다 — PM이 이 이름으로 감시한다."""
        fields = getattr(contract, "GENERATED_PAYLOAD_FIELDS", None)
        assert isinstance(fields, dict), (
            "payload_contract.GENERATED_PAYLOAD_FIELDS가 없거나 dict가 아니다 "
            "(계약 G-3 — 이름·형태 고정)"
        )
        for qtype, required in fields.items():
            assert isinstance(required, tuple), f"{qtype} 값이 tuple이 아니다"

    @pytest.mark.parametrize(
        "module",
        [
            "app.chains.payload_contract",
            "app.chains.quiz_gen_chain",
            "app.chains.validate_chain",
        ],
    )
    def test_생성_경로가_langchain을_최상단에서_끌어오지_않는다(self, module):
        """**키 없이 도달해야 하는 것을 langchain 뒤에 두지 않는다.**

        세 모듈 모두 무키 경로에 필요하다 — 계약(`payload_contract`) · 폴백 뱅크
        (`quiz_gen_chain`) · 결정적 1차 게이트(`validate_chain`). CLAUDE.md가
        "LLM 키 없어도 폴백 문항 뱅크로 전 기능 동작"을 계약으로 두므로, 이 셋 중
        하나라도 최상단에서 langchain을 끌어오면 **키가 없어도 langchain이 없으면
        멈춘다.**

        실제로 그 상태였다: `quiz_gen_chain`이 최상단 import 4개를 갖고 있어
        저작 배치(`scripts/author_items.py`)가 무키로 돌려면 **langchain 모듈을
        위조**해야 했다. G1(ROADMAP §5.3.1)에서 실키로 처음 돌릴 스크립트가 모듈을
        위조하는 상태를 없애기 위해, `validate_chain`이 처음부터 쓰던 지연 임포트
        규약으로 맞췄다. 이 테스트는 그 스텁 해킹이 되살아나는 것을 막는다.
        """
        saved = {
            k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")
        }
        before = {m for m in sys.modules if "langchain" in m or "chromadb" in m}
        for key in saved:
            del sys.modules[key]
        sys.path.insert(0, str(AI_WORKER_DIR))
        try:
            importlib.import_module(module)
            leaked = {
                m for m in sys.modules if "langchain" in m or "chromadb" in m
            } - before
        finally:
            sys.path.remove(str(AI_WORKER_DIR))
            for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
                del sys.modules[key]
            sys.modules.update(saved)
        assert not leaked, (
            f"{module}이 최상단에서 무거운 의존을 끌어온다: {sorted(leaked)} — "
            "LLM을 실제로 쓰는 함수 내부에서 지연 임포트할 것(validate_chain 규약)"
        )

    def test_생성_대상은_board를_뺀_6종이다(self, contract):
        """계약 G-1(2026-08-10 개정 · CO-O-13): 7종 − board = 6종 **정확히**.

        **`<=`가 아니라 `==`인 이유**가 이 테스트의 전부다. 부분집합 비교는 넓히기가
        절반만 착지한 상태 — 예컨대 cloze만 들어오고 match·ordering은 빠진 상태 —
        를 통과시킨다. O-13이 지적한 결함이 정확히 "3종만 나온다"였으므로, 몇 종이
        나오는지를 계약이 세지 않으면 같은 결함을 다시 못 잡는다.

        반대 방향(넘치는 쪽)도 같은 단정이 막는다: board가 슬쩍 들어오면 판정 규칙
        없는 퍼즐이 생성돼 **도달 불가능한 문항**이 뱅크에 쌓인다.
        """
        declared = set(contract.GENERATED_PAYLOAD_FIELDS)
        assert declared == set(GENERATABLE_TYPES), (
            f"생성 대상 선언={sorted(declared)} ≠ 계약={sorted(GENERATABLE_TYPES)}. "
            f"빠진 유형={sorted(GENERATABLE_TYPES - declared)} · "
            f"넘치는 유형={sorted(declared - GENERATABLE_TYPES)}"
        )

    def test_board는_생성_대상이_아니고_서버_전용이다(self, contract):
        """**backend에만 있는 유형이 board 하나뿐**임을 못박는다.

        board는 `board_rules.json`으로 서버가 판정을 재계산하는 유형이라 생성기가
        낼 수 없다(게이트가 판정 규칙을 읽지 않아 **도달 불가능한 퍼즐이 전건
        통과**한다 — CARRYOVER O-11). 즉 이 비대칭은 결함이 아니라 설계다.

        그러나 "backend에 있는데 생성에 없다"를 통째로 눈감으면, 앞으로 backend가
        새 유형을 노출할 때 생성 쪽 누락이 board와 함께 조용히 묻힌다. 그래서
        **차집합이 정확히 {board}**임을 단정한다 — 예외를 한 건으로 고정한다.
        """
        declared = set(contract.GENERATED_PAYLOAD_FIELDS)
        assert "board" not in declared, (
            "board가 생성 대상에 들어왔다 — 판정 규칙 없는 퍼즐은 풀 수 없다"
        )
        backend_only = set(QUESTION_PAYLOAD_FIELDS) - declared
        assert backend_only == {"board"}, (
            f"backend 전용 유형이 board 하나가 아니다: {sorted(backend_only)} — "
            "board 외에 서버가 노출하는데 생성이 못 만드는 유형이 생겼다"
        )

    @pytest.mark.parametrize("question_type", sorted(GENERATABLE_TYPES))
    def test_ai_worker_선언이_명세표와_같다(self, contract, question_type):
        """생성 필수 필드 == `CONTRACT_REQUIRED_PAYLOAD`.

        위 `test_서버가_노출하는_필드를_전부_요구한다`는 **⊇만** 본다. 그래서 서버가
        노출하지 않는 필드(mc의 `options`)를 생성이 빼먹어도, 또 양쪽이 동시에
        줄어들어도 잡히지 않는다 — slider 4필드 회귀 고정이 따로 필요했던 이유다.
        유형이 6종으로 늘면 그런 개별 고정이 6벌 필요해지므로, **명세를 표로 두고
        전 유형을 같은 방식으로 못박는다.**

        표의 근거는 구현이 아니라 본시드 284건 실측이다(모듈 독스트링).
        """
        declared = contract.GENERATED_PAYLOAD_FIELDS.get(question_type)
        assert declared is not None, (
            f"{question_type}이 GENERATED_PAYLOAD_FIELDS에 없다 — 필수 필드 선언이 "
            "없는 유형은 payload 없이 API에 도달한다(필요 없으면 빈 튜플로 선언할 것)"
        )
        assert set(declared) == CONTRACT_REQUIRED_PAYLOAD[question_type], (
            f"{question_type}: 생성 선언={sorted(declared)} ≠ "
            f"명세={sorted(CONTRACT_REQUIRED_PAYLOAD[question_type])}"
        )

    def test_적재_허용_유형이_생성_대상과_같다(self):
        """**세 번째 드리프트 면.** 생성 → 노출만 맞춰도 뱅크에는 안 쌓인다.

        `session_service.GENERATED_ITEM_TYPES`는 생성 문항을 `content_items`에
        영속화할 때의 화이트리스트다(`session_service.py:839`). 생성이 6종을 내고
        서버가 6종을 노출해도 이 목록이 좁으면, 새 유형은 **적재 단계에서 조용히
        탈락**한다 — 세션에는 한 번 나오고 뱅크에는 안 남으므로 G1 비용이 자산이
        아니라 트래픽으로 증발한다(계약 문서 §0 결함 ②가 지적한 바로 그 손실).

        이 상수 역시 교차 빌드 컨텍스트라 값을 손으로 적어 두는 자리이고, 실제로
        2026-08-10까지 3종이었다. 세 소유자(생성·노출·적재)를 한 테스트에 묶는다.
        """
        assert set(GENERATED_ITEM_TYPES) == set(GENERATABLE_TYPES), (
            f"적재 허용={sorted(GENERATED_ITEM_TYPES)} ≠ 생성 대상="
            f"{sorted(GENERATABLE_TYPES)} — 생성된 유형이 뱅크에 안 쌓인다"
        )
        assert "board" not in GENERATED_ITEM_TYPES

    @pytest.mark.parametrize("question_type", sorted(GENERATABLE_TYPES))
    def test_backend_노출이_명세표와_같다(self, question_type):
        """서버 노출 필드 == `SERVER_EXPOSED_PAYLOAD`. **양쪽을 같은 표에 건다.**

        ai-worker만 표에 걸면 backend가 움직였을 때 드리프트가 생성 쪽 실패로
        위장된다(엉뚱한 담당이 고치러 간다). match→`pairs`,
        ordering→`items`·`shuffled`는 프론트 `QuestionCard.jsx`가 소비하는 이름과
        1:1이라 서버 쪽에서 이름만 바뀌어도 문항이 빈 화면으로 렌더된다.
        """
        exposed = set(QUESTION_PAYLOAD_FIELDS.get(question_type, ()))
        assert exposed == SERVER_EXPOSED_PAYLOAD[question_type], (
            f"{question_type}: 서버 노출={sorted(exposed)} ≠ "
            f"명세={sorted(SERVER_EXPOSED_PAYLOAD[question_type])} "
            "(mc의 options는 payload가 아니라 SessionItem.options 컬럼이므로 빈 집합이 정상)"
        )

    def test_Literal과_상수가_일치한다(self, contract):
        """스키마가 허용하는 유형 == 필수 필드를 선언한 유형.

        어긋나면 **필드 요구 없이 생성되는 유형**이 생긴다 — slider가 바로 그 상태였다.
        """
        allowed = _literal_question_types()
        declared = set(contract.GENERATED_PAYLOAD_FIELDS)
        assert allowed == declared, (
            f"Literal={sorted(allowed)} ≠ GENERATED_PAYLOAD_FIELDS={sorted(declared)} — "
            "필수 필드 선언이 없는 유형은 payload 없이 API에 도달한다"
        )

    def test_서버가_노출하는_필드를_전부_요구한다(self, contract):
        """**계약의 본체.** 생성 필수 필드 ⊇ 서버 노출 필드.

        서버가 노출하려는 필드를 생성이 만들지 않으면, 그 문항은 payload 없이 프론트에
        도달해 기본값으로 렌더된다 — 예외가 나지 않으므로 **조용한 오작동**이다.
        """
        gen = contract.GENERATED_PAYLOAD_FIELDS
        for qtype in sorted(gen):
            server = set(QUESTION_PAYLOAD_FIELDS.get(qtype, ()))
            missing = server - set(gen[qtype])
            assert not missing, (
                f"{qtype}: 서버는 {sorted(server)}를 노출하는데 생성은 "
                f"{sorted(missing)}를 요구하지 않는다 — 그 필드 없이 생성된 문항이 "
                "기본값으로 렌더된다"
            )

    def test_slider가_범위_4필드를_요구한다(self, contract):
        """회귀 고정 — 이 계약이 생긴 이유 그 자체.

        위 테스트는 양쪽이 **동시에** 줄어드는 것을 잡지 못하므로 계약값을 직접 못박는다.
        """
        assert set(contract.GENERATED_PAYLOAD_FIELDS["slider"]) >= {
            "min",
            "max",
            "step",
            "unit",
        }, "slider 범위 4필드가 필수에서 빠졌다 — 0~100 폴백 결함이 되살아난다"
        assert set(QUESTION_PAYLOAD_FIELDS["slider"]) == {"min", "max", "step", "unit"}

    def test_multiple_choice가_options를_요구한다(self, contract):
        assert "options" in contract.GENERATED_PAYLOAD_FIELDS["multiple_choice"], (
            "multiple_choice가 options를 필수로 요구하지 않는다 — 선택지 없는 "
            "객관식이 생성될 수 있다"
        )


class TestNewTypeValueRules:
    """**필드가 있다 ≠ 풀 수 있다.** 신규 3종의 값 정합을 계약이 직접 본다.

    slider가 이 계약을 만든 이유는 "필드가 없어서"였지만, 계약 G-2는 거기서 멈추지
    않고 값까지 봤다(정답이 범위 안인가·격자 위인가). cloze·match·ordering도 같다 —
    필드만 채운 문항은 **예외 없이 API에 도달해 조용히 오작동**한다:

    - ordering: 정답이 항등 순열이 아니면 `_grade_ordering`이 정답을 오답으로 친다
      (items가 정답 순서라는 저작 규약과 어긋나므로 유저가 옳게 풀어도 틀린다)
    - match: pairs와 정답이 어긋나면 **아무도 못 맞히는 문항**이 된다
    - cloze: 빈칸 마커가 없으면 무엇을 묻는지 화면에 표시되지 않는다

    `check_payload`(계약 G-3의 검사 함수)가 이것을 막아야 하고, 막지 못하면
    `scripts/author_items.py`의 배치 4단계 ⓒ도 못 막는다 — 같은 함수를 쓴다.

    거부만 단정하면 "전건 거부하는 구현"이 통과하므로 **정상 문항이 통과하는지를
    먼저** 본다(본시드 실항목 기준).
    """

    @pytest.mark.parametrize("question_type", sorted(GENERATABLE_TYPES))
    def test_본시드_전건이_계약을_통과한다(self, check_payload, question_type):
        """사람 저작 코퍼스가 곧 명세다 — 시드가 떨어지면 계약이 과하게 좁은 것이다.

        생성분에 거는 규칙이 이미 저작된 문항을 탈락시킨다면, 그 규칙은 "생성 품질
        기준"이 아니라 **저작 규약과 어긋난 별개의 규약**이다. 그 상태로 G1을 돌리면
        멀쩡한 문항이 전건 재시도·폴백으로 새어 비용만 나간다. 그래서 계약의 상한을
        코퍼스로 고정한다(2026-08-10 실측 board 제외 238건, 위반 0건).
        """
        questions = _seed_questions(question_type)
        assert questions, f"본시드에 {question_type} 항목이 없다 — 근거가 사라졌다"
        rejected = []
        for question in questions:
            try:
                check_payload(question)
            except Exception as exc:  # 계약 위반이든 크래시든 모두 탈락으로 센다
                rejected.append(f"{question.get('question_text', '')[:40]}… → {exc}")
        assert not rejected, (
            f"{question_type} 본시드 {len(rejected)}/{len(questions)}건이 계약에 걸린다 — "
            "계약이 저작 규약보다 좁다:\n" + "\n".join(rejected[:5])
        )

    @pytest.mark.parametrize(
        "build", [_cloze, _match, _ordering], ids=["cloze", "match", "ordering"]
    )
    def test_정상_문항은_통과한다(self, check_payload, build):
        """거부 테스트의 짝 — 전건 거부하는 구현을 초록으로 만들지 않는다."""
        check_payload(build())

    # ── cloze ────────────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "question_text",
        [
            "열대야는 밤 최저기온이 25℃ 아래로 내려가지 않는 밤이다.",
            "밤 최저기온이 __℃ 아래로 내려가지 않는 밤을 열대야라고 한다.",
            "밤 최저기온이 (   )℃ 아래로 내려가지 않는 밤을 열대야라고 한다.",
        ],
        ids=["마커없음", "밑줄2개", "괄호표기"],
    )
    def test_cloze는_빈칸_마커가_없으면_탈락한다(self, check_payload, question_text):
        """cloze는 payload가 없는 유형이라 **문장 자체가 유일한 구조**다.

        빈칸이 없으면 화면에는 완성된 평서문만 뜨고 답 입력창이 무엇을 묻는지
        알 수 없다. 채점기는 `_grade_text`(cloze = short_answer 규칙 재사용,
        `answer_service:176`)라 예외도 나지 않는다 — 유저만 못 푼다.

        마커는 본시드 35건 전건이 쓰는 밑줄 3개(`___`)다. 표기를 흔들면 프론트가
        빈칸을 못 찾으므로 변종(`__`·괄호)도 탈락이어야 한다.
        """
        with pytest.raises(ValueError):
            check_payload(_cloze(question_text=question_text))

    # ── match ────────────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "correct_answer",
        [
            "한랭전선:여러 날 이어지는 장마|온난전선:넓은 지역에 오래 내리는 약한 비"
            "|정체전선:좁은 지역에 강한 소나기",
            "한랭전선:좁은 지역에 강한 소나기|온난전선:넓은 지역에 오래 내리는 약한 비",
            "한랭전선:좁은 지역에 강한 소나기|온난전선:넓은 지역에 오래 내리는 약한 비"
            "|정체전선:여러 날 이어지는 장마|폐색전선:두 전선이 겹친다",
            "한랭전선:좁은 지역에 강한 소나기,온난전선:넓은 지역에 오래 내리는 약한 비"
            ",정체전선:여러 날 이어지는 장마",
            "좁은 지역에 강한 소나기|넓은 지역에 오래 내리는 약한 비|여러 날 이어지는 장마",
        ],
        ids=["right뒤바뀜", "쌍누락", "없는쌍추가", "구분자쉼표", "left누락"],
    )
    def test_match는_pairs와_정답이_어긋나면_탈락한다(self, check_payload, correct_answer):
        """정답의 소유자는 `pairs`다 — 둘이 갈라지면 **아무도 못 맞히는 문항**이다.

        `_grade_match`(`answer_service:112`)는 제출을 `"left:right|…"`로 파싱해
        `correct_answer`와 대조한다. 프론트는 `pairs`로 보기를 그리므로, 정답 문자열이
        pairs와 다르면 유저가 화면에서 만들 수 있는 어떤 조합도 정답과 일치하지
        않는다. 200이 나가고 오답만 쌓인다 — 에너지까지 깎인다.

        본시드 28건은 전건 `"|".join(f"{left}:{right}")`로 정확히 일치한다.
        """
        with pytest.raises(ValueError):
            check_payload(_match(correct_answer=correct_answer))

    @pytest.mark.parametrize(
        "pairs",
        [
            None,
            [],
            [{"left": "한랭전선"}],
            [{"left": "한랭전선", "right": ""}],
            ["한랭전선:좁은 지역에 강한 소나기"],
        ],
        ids=["없음", "빈목록", "right키없음", "right빈문자열", "문자열목록"],
    )
    def test_match는_pairs_구조가_명세와_다르면_탈락한다(self, check_payload, pairs):
        """`pairs`는 `[{"left": str, "right": str}, …]` — 서버가 그대로 노출한다.

        `QUESTION_PAYLOAD_FIELDS["match"] = ("pairs",)`가 값을 **검사 없이** 프론트로
        내보내므로, 형태가 다르면 렌더 단계에서 깨진다. 여기서 막지 않으면
        런타임까지 간다.
        """
        question = _match()
        question["pairs"] = pairs
        if pairs is None:
            del question["pairs"]
        with pytest.raises(ValueError):
            check_payload(question)

    # ── ordering ─────────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "correct_answer",
        ["0,2,1,3", "3,2,1,0", "0,1,2", "0,1,1,3", "1,2,3,4", "0,1,2,3,4", ""],
        ids=["뒤섞임", "역순", "개수부족", "인덱스중복", "1부터시작", "개수초과", "빈문자열"],
    )
    def test_ordering은_항등_순열이_아니면_탈락한다(self, check_payload, correct_answer):
        """**items는 정답 순서로 저작한다** — 그러므로 정답은 `"0,1,…,n-1"`뿐이다.

        `shuffled: true`는 화면에서 섞으라는 지시일 뿐 저장 순서를 바꾸지 않고,
        `_grade_ordering`(`answer_service:134`)은 제출을 **원본 인덱스 순열**로 받는다.
        정답에 다른 순열이 들어오면 저작 규약과 채점이 어긋나 **옳게 푼 유저가
        틀린다** — 예외가 없으므로 로그에도 안 남고 문항 난이도 통계만 이상해진다.

        본시드 27건 전건이 항등 순열이다. 이것은 CARRYOVER O-11이 지적한
        "ordering: 정답이 items 순서인데 **순서가 옳은지 아무도 검증 안 함**"의
        생성 경로 몫이다.
        """
        with pytest.raises(ValueError):
            check_payload(_ordering(correct_answer=correct_answer))

    def test_ordering은_items가_없으면_탈락한다(self, check_payload):
        """items 없는 ordering은 배열할 대상이 없다 — 서버가 payload를 못 만든다."""
        question = _ordering()
        del question["items"]
        with pytest.raises(ValueError):
            check_payload(question)

    @pytest.mark.parametrize("shuffled", [None, False], ids=["없음", "False"])
    def test_ordering은_shuffled가_참이_아니면_탈락한다(self, check_payload, shuffled):
        """`shuffled`는 `QUESTION_PAYLOAD_FIELDS["ordering"]`의 절반이고 **True여야** 한다.

        빠지면 `_question_payload`가 있는 키만 담아 `{"items": [...]}`를 내보내고,
        `false`면 그 값을 그대로 내보낸다. 어느 쪽이든 **예외 없이** 프론트가 정답
        순서대로 보기를 그린다 — 즉 **정답이 화면에 적힌 문항**이 된다.
        누락이 오작동이 아니라 정답 유출이 되는 유일한 사례라 값까지 못박는다
        (본시드 27건 전건 `true`).
        """
        question = _ordering()
        if shuffled is None:
            del question["shuffled"]
        else:
            question["shuffled"] = shuffled
        with pytest.raises(ValueError):
            check_payload(question)

    @pytest.mark.parametrize(
        "items",
        [
            ["따뜻한 열대 바다에서 수증기가 증발해 열대 저기압이 생긴다"],
            [
                "따뜻한 열대 바다에서 수증기가 증발해 열대 저기압이 생긴다",
                "따뜻한 열대 바다에서 수증기가 증발해 열대 저기압이 생긴다",
            ],
        ],
        ids=["1개", "중복항목"],
    )
    def test_ordering은_items가_2개_미만이거나_중복이면_탈락한다(self, check_payload, items):
        """배열 문제가 성립하려면 **서로 다른 항목이 둘 이상** 있어야 한다.

        1개짜리는 섞을 것이 없어 문제가 아니고, 같은 문장이 두 번 있으면 두 배열이
        똑같이 옳은데 채점기는 항등 순열 하나만 정답으로 본다 — 유저 눈에는
        구분 불가능한 두 칸이 있고 절반의 확률로 틀린다.
        """
        with pytest.raises(ValueError):
            check_payload(
                _ordering(
                    items=items,
                    correct_answer=",".join(str(i) for i in range(len(items))),
                )
            )

    @pytest.mark.parametrize(
        "pairs",
        [
            [{"left": "한랭전선", "right": "좁은 지역에 강한 소나기"}],
            [
                {"left": "한랭전선", "right": "좁은 지역에 강한 소나기"},
                {"left": "한랭전선", "right": "여러 날 이어지는 장마"},
            ],
        ],
        ids=["1쌍", "left중복"],
    )
    def test_match는_1쌍이거나_left가_중복이면_탈락한다(self, check_payload, pairs):
        """짝짓기는 **서로 다른 left 둘 이상**이어야 성립한다.

        1쌍이면 고를 것이 없어 무조건 정답이고, left가 중복이면 화면에 같은 항목이
        두 번 떠서 어느 쪽에 무엇을 붙이든 유저는 구분할 수 없다. `_grade_match`는
        쌍 집합을 대조하므로 예외 없이 오답만 난다.
        """
        with pytest.raises(ValueError):
            check_payload(_match(pairs))

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

**범위 밖**: 폴백 문항(`_fallback_question`)이 계약을 통과하는지는 ai-worker 스위트
(`test_quiz_gen_payload.py`)가 본다.

DB·네트워크·LLM 키 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import ast
import importlib
import sys
from pathlib import Path

import pytest

from app.routers.session import QUESTION_PAYLOAD_FIELDS

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_WORKER_DIR = REPO_ROOT / "ai-worker"
CHAINS_DIR = AI_WORKER_DIR / "app" / "chains"

# 생성 대상 유형 — 계약 G-1. board/match/ordering/cloze는 생성하지 않는다
# (board는 board_rules.json 판정 구조가 필요하고, 나머지는 저작 영역).
GENERATABLE_TYPES = frozenset({"multiple_choice", "short_answer", "slider"})


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

    def test_생성_가능_유형만_선언한다(self, contract):
        """계약 G-1: board/match/ordering/cloze를 생성 대상에 넣지 않는다."""
        declared = set(contract.GENERATED_PAYLOAD_FIELDS)
        assert declared <= GENERATABLE_TYPES, (
            f"생성 대상이 아닌 유형이 선언됐다: {sorted(declared - GENERATABLE_TYPES)} — "
            "board는 board_rules 판정 구조가 필요하고 나머지는 저작 영역이다"
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

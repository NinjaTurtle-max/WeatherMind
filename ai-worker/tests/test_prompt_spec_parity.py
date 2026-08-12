"""프롬프트 ↔ 스펙 03 동일성 계약.

`quiz_gen_chain.py`의 모듈 독스트링은 "System Prompt / Few-shot 3개는 스펙 원문 그대로
사용한다 (한 글자도 수정 금지)"를 선언한다. **그런데 그 선언에 감시자가 없었다** —
2026-08-03까지 이 불변식을 확인하는 테스트가 리포에 하나도 없었고, 어느 한쪽만 고쳐도
조용히 통과했다.

## 왜 지금 만드는가

계약 G(생성 문항 payload 완전성)를 세우면서 스펙 03의 slider 예시에 `min`·`max`·`step`·
`unit`을 추가해야 했다(개정 근거는 `docs/specs/03_ai_chains_spec.md`의 개정 노트).
그 작업을 **사람이 두 파일에 손으로 같은 문자열을 넣어** 처리했다 — 즉 다음 개정도
손으로 맞춰야 하고, 한쪽을 빠뜨리면 프롬프트가 스펙과 갈라진다. 이 리포가 XP 상수·
board 벡터·목 배합에 쓰는 것과 같은 처방을 여기에도 둔다.

## 왜 import하지 않고 소스를 읽는가

`quiz_gen_chain`은 최상단에서 `langchain_core`를 import하고, 이 환경에는 langchain이
설치돼 있지 않다(이 스위트의 skip 7건이 그것). `importorskip`으로 우회하면 계약이
조용히 skip되므로 — R10 웨이브 2가 CI SKIP 방어로 막은 패턴 — `ast`로 모듈 수준
문자열 상수만 꺼낸다. 실행에 아무 의존이 없다.

실행: `cd ai-worker && python -m pytest tests -q`.
"""
import ast
import re
from pathlib import Path

import pytest

from app.chains.payload_contract import GENERATED_PAYLOAD_FIELDS

AI_WORKER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_WORKER_DIR.parent
GEN_CHAIN = AI_WORKER_DIR / "app" / "chains" / "quiz_gen_chain.py"
RAG_CHAIN = AI_WORKER_DIR / "app" / "chains" / "rag_chain.py"
SPEC = REPO_ROOT / "docs" / "specs" / "03_ai_chains_spec.md"

# 스펙에서 원문 그대로 가져다 쓰는 상수 — 독스트링이 선언한 대상 그 자체.
SPEC_SOURCED = ("SYSTEM_PROMPT", "FEW_SHOT_EXAMPLES")

# ── few-shot 개수의 소유자는 「생성 대상 유형 목록」이다 (2026-08-10, CO-O-13) ──
# 종전에는 `count(...) == 3`으로 **숫자를 손으로 적어** 뒀고, 생성 대상이 3종 → 6종으로
# 넓어지자 그 줄이 곧바로 거짓이 됐다. 숫자를 6으로 고치면 다음 확장에서 같은 일이
# 반복되므로, 계약 상수에서 파생시킨다 — 유형이 늘면 예시도 함께 늘어야 한다는 것이
# 지켜야 할 규칙이고, 개수는 그 규칙의 결과일 뿐이다.
#
# `payload_contract`를 import해도 안전한 근거: 계약 G-3이 이 모듈의 의존을 stdlib+
# pydantic으로 묶고 있고 `test_quiz_gen_payload.py`가 그것을 감시한다. `quiz_gen_chain`
# 쪽은 여전히 import하지 않는다(모듈 독스트링 「왜 import하지 않고 소스를 읽는가」).
GENERATABLE_TYPES = frozenset(GENERATED_PAYLOAD_FIELDS)

# `[예시 4 - knowledge_level 2, cloze]` 형태의 라벨. 유형을 캡처해 **유형별 1건**을 센다.
EXAMPLE_LABEL_RE = re.compile(
    r"\[예시\s*(\d+)\s*-\s*knowledge_level\s*(\d+)\s*,\s*([a-z_]+)\s*\]"
)


def _example_block(examples: str, question_type: str) -> str:
    """해당 유형 예시 **하나의 블록만** 잘라낸다 (다음 예시 라벨 앞까지).

    종전 `examples.split("[예시 3")[-1]`은 예시가 3개뿐일 때만 "예시 3의 본문"과
    같았다. 6개가 되면 그 뒤 3개까지 함께 잡혀 **다른 예시의 필드로 통과**할 수
    있다 — 검사가 조용히 헐거워지는 자리라 라벨 사이로 정확히 자른다.
    """
    labels = list(EXAMPLE_LABEL_RE.finditer(examples))
    for index, match in enumerate(labels):
        if match.group(3) == question_type:
            end = labels[index + 1].start() if index + 1 < len(labels) else len(examples)
            return examples[match.end() : end]
    return ""


def _module_str_constants(path: Path) -> dict[str, str]:
    """모듈 최상위 `NAME = "..."` 문자열 상수를 소스에서 꺼낸다 (import 없음)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and isinstance(node.value, ast.Constant):
            if isinstance(node.value.value, str):
                out[target.id] = node.value.value
    return out


def _normalize(text: str) -> str:
    """공백만 정규화한다 — 마크다운 코드블록 들여쓰기 차이를 흡수하되 **내용은 보존**.

    문장부호·숫자를 지우면 "0~100"과 "0~40"이 같아져 계약이 무의미해진다.
    """
    return re.sub(r"[ \t]+", " ", text).strip()


@pytest.fixture(scope="module")
def constants() -> dict[str, str]:
    return _module_str_constants(GEN_CHAIN)


@pytest.fixture(scope="module")
def spec_text() -> str:
    return _normalize(SPEC.read_text(encoding="utf-8"))


class TestPromptSpecParity:
    """프롬프트 문자열이 스펙 03 원문과 한 글자도 다르지 않아야 한다."""

    def test_대상_상수가_존재한다(self, constants):
        """상수 이름이 바뀌면 이 계약이 조용히 아무것도 검사하지 않게 된다."""
        missing = [name for name in SPEC_SOURCED if name not in constants]
        assert not missing, (
            f"{GEN_CHAIN.name}에 {missing}가 없다 — 이름이 바뀌었으면 이 테스트의 "
            "SPEC_SOURCED도 함께 고쳐야 한다(그러지 않으면 감시 대상이 사라진다)"
        )

    @pytest.mark.parametrize("name", SPEC_SOURCED)
    def test_스펙_원문에_그대로_들어_있다(self, name, constants, spec_text):
        """줄 단위로 대조해 **어느 줄이** 갈라졌는지 보이게 한다."""
        lines = [ln for ln in _normalize(constants[name]).splitlines() if ln.strip()]
        absent = [ln for ln in lines if ln not in spec_text]
        assert not absent, (
            f"{name}의 다음 줄이 스펙 03에 없다 — 한쪽만 고쳤다:\n"
            + "\n".join(f"  · {ln}" for ln in absent[:5])
            + (f"\n  ... 외 {len(absent) - 5}줄" if len(absent) > 5 else "")
        )

    def test_slider_4필드가_프롬프트에_요구된다(self, constants):
        """계약 G가 실효를 갖기 위한 전제 (스펙 03 2026-08-03 개정).

        프롬프트가 `min`·`max`·`step`·`unit`을 요구하지 않으면, 생성된 slider는
        계약 G에 걸려 **탈락 → 재시도 → 폴백**이 되고 폴백 뱅크에는 slider가 없다.
        결과적으로 생성 경로에서 slider가 사라진다 — 결함은 아니지만 유형이 조용히
        빠지는 것이라, 계약과 프롬프트가 함께 움직여야 한다.
        """
        prompt = constants["SYSTEM_PROMPT"]
        for field in ("min", "max", "step", "unit"):
            assert f'"{field}"' in prompt, (
                f"출력 스키마가 slider의 {field}를 요구하지 않는다 — "
                "생성 slider가 계약 G에 전건 탈락한다"
            )

    @pytest.mark.parametrize("question_type", sorted(GENERATABLE_TYPES))
    def test_출력_스키마가_생성_대상_6종을_전부_허용한다(self, constants, question_type):
        """스키마가 유형을 열거하지 않으면 모델은 그 유형을 **낼 수 없다**.

        `payload_contract`의 Literal을 넓혀도 프롬프트가 3종만 열거하면 산출은
        3종 그대로다 — 계약만 넓히고 프롬프트를 안 넓히는 절반 착지가 정확히
        여기서 조용히 성립한다. 두 소유자를 같은 목록에 건다.
        """
        assert f'"{question_type}"' in constants["SYSTEM_PROMPT"], (
            f"출력 스키마가 {question_type}을 열거하지 않는다 — 계약이 허용해도 "
            "모델이 그 유형을 낼 수 없다"
        )

    @pytest.mark.parametrize(
        "question_type,field",
        [
            ("cloze", "___"),
            ("match", '"pairs"'),
            ("ordering", '"items"'),
            ("ordering", '"shuffled"'),
        ],
    )
    def test_출력_스키마가_신규_3종의_payload를_요구한다(self, constants, question_type, field):
        """slider 4필드에 건 것과 같은 계약(위 `test_slider_4필드…`와 같은 처방).

        요구하지 않으면 생성분이 계약 G-1에 전건 탈락하고, 폴백 뱅크에 이 3종이
        없어 유형이 조용히 사라진다.
        """
        assert field in constants["SYSTEM_PROMPT"], (
            f"출력 스키마가 {question_type}의 {field}를 요구하지 않는다"
        )

    def test_출력_스키마가_knowledge_level을_요구한다(self, constants):
        """R13 3일차 개정의 본체 — 신고가 없으면 G1 배치가 lint에서 전건 탈락한다.

        전환기 폴백이 만료된 뒤(R13 2일차) `knowledge_level` 없는 문항은 그 자체로
        탈락이고, `level_group`에서의 기계 복원은 `docs/specs/12` §5.3이 금지한다.
        프롬프트가 이 필드를 요구하지 않으면 남는 길이 없다.
        """
        prompt = constants["SYSTEM_PROMPT"]
        assert '"knowledge_level"' in prompt, "출력 스키마가 knowledge_level을 요구하지 않는다"
        assert "반드시 신고" in prompt, "신고가 선택처럼 읽히면 모델이 빠뜨린다"

    def test_학령_3종_열거가_난이도로_남아_있지_않다(self, constants):
        """개정 전 규칙 2(`adult = 기상청 전문 용어 일부 허용`)가 되살아나는 것을 막는다.

        `docs/specs/12` §8.2가 실측한 사고가 그 문장의 결과다 — 본시드 6단계 9건은
        저작된 것이 아니라 `adult` 밴드가 무검사여서 실무 수치가 흘러든 것이고,
        의도적으로 설계된 전문가 문항은 0건이었다. 같은 문장을 1,360건에 각인시키면
        같은 사고가 1,360배가 된다.
        """
        prompt = constants["SYSTEM_PROMPT"]
        assert "기상청 전문 용어 일부 허용" not in prompt
        assert "표현 톤" in prompt, "level_group이 톤이라는 것이 명시돼야 한다"

    def test_톤은_한_벌만_요구한다(self, constants):
        """`docs/specs/12` §6.4 클라이언트 결정(2026-08-06) — 3벌 저작은 G1 비용 3배."""
        prompt = constants["SYSTEM_PROMPT"]
        assert "teen" in prompt and "한 벌만" in prompt, (
            "프롬프트가 톤 1벌을 못박지 않는다 — 3벌 저작 기각 결정이 실효를 잃는다"
        )

    def test_few_shot이_단계로_라벨링된다(self, constants):
        """예시 라벨이 학령이면 모델이 그 축을 난이도로 모방한다."""
        examples = constants["FEW_SHOT_EXAMPLES"]
        labels = EXAMPLE_LABEL_RE.findall(examples)
        reported = examples.count('"knowledge_level"')
        assert reported == len(labels), (
            f"예시 {len(labels)}건 전부가 단계를 신고해야 한다 — 신고 {reported}건"
        )
        for label in ("elementary,", "middle_high,", "adult,"):
            assert f"[예시 1 - {label}" not in examples

    def test_생성_대상_유형마다_few_shot이_하나씩_있다(self, constants):
        """**개수만 세면 같은 유형 6개도 통과한다** — 그게 이번에 막는 실패다.

        few-shot은 모델이 형태를 통째로 모방하는 자리다. 유형이 6종인데 예시가
        multiple_choice에 쏠려 있으면 모델은 계속 객관식을 낸다 — 출력 스키마가
        6종을 허용해도 실제 산출은 편중되고, "3종만 나온다"(CARRYOVER O-13)가
        **스키마는 6종인데 결과는 3종**이라는 더 알아채기 어려운 형태로 재발한다.

        그래서 라벨에서 유형을 뽑아 **집합으로** 대조한다. 개수 하드코딩(종전
        `== 3`)이 아니라 계약 상수 `GENERATED_PAYLOAD_FIELDS`에서 파생하므로,
        다음에 유형이 늘어도 이 테스트는 스스로 맞는다.
        """
        labeled = [match[2] for match in EXAMPLE_LABEL_RE.findall(constants["FEW_SHOT_EXAMPLES"])]
        assert set(labeled) == set(GENERATABLE_TYPES), (
            f"few-shot 유형={sorted(set(labeled))} ≠ 생성 대상={sorted(GENERATABLE_TYPES)}. "
            f"예시 없는 유형={sorted(GENERATABLE_TYPES - set(labeled))} · "
            f"생성 대상 아닌 예시={sorted(set(labeled) - GENERATABLE_TYPES)}"
        )
        duplicated = sorted({t for t in labeled if labeled.count(t) > 1})
        assert not duplicated, (
            f"같은 유형의 예시가 둘 이상이다: {duplicated} — 유형당 1건이라야 "
            "모델이 특정 유형으로 쏠리지 않는다"
        )

    def test_slider_예시가_범위를_필드로_준다(self, constants):
        """예시가 범위를 질문 텍스트에만 적으면 모델이 그 형태를 모방한다.

        개정 전 예시 3은 `question_text`에 "(0~100%)"를 적고 필드는 주지 않았다 —
        암묵적 0~100 척도 설계의 흔적이다(`validate_chain.SLIDER_MIN/MAX` 하드코딩).
        """
        slider_block = _example_block(constants["FEW_SHOT_EXAMPLES"], "slider")
        assert slider_block, "slider 예시가 없다"
        for field in ("min", "max", "step", "unit"):
            assert f'"{field}"' in slider_block, (
                f"slider 예시가 {field}를 필드로 주지 않는다 — 모델이 범위를 "
                "질문 텍스트에만 적는 형태를 모방한다"
            )

    def test_신규_3종_예시가_payload를_형태로_보여준다(self, constants):
        """slider 예시에 걸었던 것과 같은 처방을 cloze·match·ordering에도 건다.

        모델은 규칙 문장보다 **예시의 형태**를 강하게 모방한다. 예시가 payload를
        빠뜨리면 생성분이 계약 G-1에 전건 탈락 → 재시도 → 폴백으로 떨어지고,
        폴백 뱅크에는 이 3종이 없다 — 유형이 조용히 사라진다(slider가 겪은 경로).

        특히 **ordering의 `"shuffled"`**를 못박는 이유: 스펙 03이 "모델이 가장 자주
        틀리는 자리는 ordering"이라 적었고, `shuffled`가 빠지거나 false면 화면이
        정답 순서를 그대로 그린다 — 오작동이 아니라 **정답 유출**이다.
        """
        examples = constants["FEW_SHOT_EXAMPLES"]
        required = {
            "cloze": ("___",),
            "match": ('"pairs"', '"left"', '"right"'),
            "ordering": ('"items"', '"shuffled"'),
        }
        for question_type, tokens in required.items():
            block = _example_block(examples, question_type)
            assert block, f"{question_type} 예시가 없다"
            for token in tokens:
                assert token in block, (
                    f"{question_type} 예시에 {token}이 없다 — 모델이 payload 없는 "
                    "형태를 모방해 계약 G-1에 전건 탈락한다"
                )


# ── 피드백 체인 (스펙 03 §3) — R13 3일차에 감시 대상에 추가 ─────────────────
@pytest.fixture(scope="module")
def rag_constants() -> dict[str, str]:
    return _module_str_constants(RAG_CHAIN)


class TestRagPromptSpecParity:
    """피드백 프롬프트 2종이 스펙 03 §3 원문과 갈라지지 않아야 한다.

    quiz_gen만 감시하던 것을 넓힌 이유: R13 3일차가 이 체인의 프롬프트를 **두 벌로**
    쪼갰다(개념 문서 유무). 변형이 생긴 순간 "한쪽만 고친다"의 경우의 수가 늘어난다.
    """

    @pytest.mark.parametrize("name", ["SYSTEM_PROMPT", "SYSTEM_PROMPT_NO_CONTEXT"])
    def test_스펙_원문에_그대로_들어_있다(self, name, rag_constants, spec_text):
        assert name in rag_constants, (
            f"{RAG_CHAIN.name}에 {name}이 없다 — 이름이 바뀌었으면 이 테스트도 함께 고쳐야 한다"
        )
        lines = [ln for ln in _normalize(rag_constants[name]).splitlines() if ln.strip()]
        absent = [ln for ln in lines if ln not in spec_text]
        assert not absent, (
            f"{name}의 다음 줄이 스펙 03에 없다 — 한쪽만 고쳤다:\n"
            + "\n".join(f"  · {ln}" for ln in absent[:5])
        )

    def test_무컨텍스트_변형이_참고지식을_요구하지_않는다(self, rag_constants):
        """자기모순 재발 방지 — 원칙 줄과 입력 줄이 **함께** 빠져야 한다.

        한쪽만 빼면 "제공된 사실만 써라"가 남은 채 사실이 안 들어가거나(원칙만 남음),
        `{concept_documents}` 자리가 남아 KeyError로 폴백한다(입력만 남음).
        """
        no_ctx = rag_constants["SYSTEM_PROMPT_NO_CONTEXT"]
        assert "{concept_documents}" not in no_ctx
        assert "참고 지식(context)에 있는 사실만 사용" not in no_ctx
        assert "{concept_documents}" in rag_constants["SYSTEM_PROMPT"]

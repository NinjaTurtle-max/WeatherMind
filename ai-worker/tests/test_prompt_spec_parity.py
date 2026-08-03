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

AI_WORKER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_WORKER_DIR.parent
GEN_CHAIN = AI_WORKER_DIR / "app" / "chains" / "quiz_gen_chain.py"
SPEC = REPO_ROOT / "docs" / "specs" / "03_ai_chains_spec.md"

# 스펙에서 원문 그대로 가져다 쓰는 상수 — 독스트링이 선언한 대상 그 자체.
SPEC_SOURCED = ("SYSTEM_PROMPT", "FEW_SHOT_EXAMPLES")


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

    def test_slider_예시가_범위를_필드로_준다(self, constants):
        """예시가 범위를 질문 텍스트에만 적으면 모델이 그 형태를 모방한다.

        개정 전 예시 3은 `question_text`에 "(0~100%)"를 적고 필드는 주지 않았다 —
        암묵적 0~100 척도 설계의 흔적이다(`validate_chain.SLIDER_MIN/MAX` 하드코딩).
        """
        examples = constants["FEW_SHOT_EXAMPLES"]
        slider_block = examples.split("[예시 3")[-1]
        for field in ("min", "max", "step", "unit"):
            assert f'"{field}"' in slider_block, (
                f"slider 예시가 {field}를 필드로 주지 않는다 — 모델이 범위를 "
                "질문 텍스트에만 적는 형태를 모방한다"
            )

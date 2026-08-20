"""일일 목표 상한 ↔ 하루 세션 문항 수 정합 계약 (2026-08-19, 롤링 0818 결함 ⑥).

**무엇을 막는가.** 학습자가 고를 수 있는 목표의 **최대값**이 하루 세션 문항 수보다
작으면, 세션을 한 번 끝내는 것만으로 목표가 초과된다 — 실서버에서 목표 9를 고른
학습자가 10문항 세션을 받아 **「오늘 목표 10/9」**를 봤다. 클라이언트 반려 원문:
*"문제 개수도 하루 세션 개수와 맞지도 않아"*.

**왜 계약으로 무는가.** 종전에는 두 값이 각자 다른 파일에서 **독립**이라고 선언돼
있었고(`routers/progress.py`·`mock/apiMockPlugin.js`가 나란히 *"SESSION_RECIPE와
독립된 표시용 타깃"*), 그래서 한쪽이 바뀌어도 아무도 울지 않았다. 실제로 배합이
15 → 10으로 바뀌는 동안 목표는 9에 남았다. **사람이 지키는 정합은 드리프트한다**
(CLAUDE.md §0-3) — 그래서 여기서 못박는다.

**무엇을 안 무는가.** 3·5 같은 **부분 목표**는 계약이 아니다. "한 세션을 다 못 해도
괜찮다"는 선택지가 있어야 한다는 것이 원래 설계이고 그 취지는 살아 있다. 묶는 것은
**상한 하나**뿐이다.

정합 대상 4곳(값 소유자):
  · `backend/app/routers/progress.py`  DAILY_GOAL_CHOICES   ← 서버 권위(422 판정)
  · `backend/app/core/config.py`       SESSION_RECIPE       ← 세션 길이 권위
  · `frontend/src/lib/onboardingGate.js` DAILY_GOAL_CHOICES ← 화면 선택지
  · `frontend/mock/apiMockPlugin.js`   DAILY_GOAL_CHOICES   ← 목 422 판정

파이썬 밖 파일 2개는 **파싱해서 대조**한다 — `test_ci_workflow_contract`·
`test_prompt_spec_parity`가 같은 방식의 선례다.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.config import settings
from app.routers.progress import DAILY_GOAL_CHOICES

REPO_ROOT = Path(__file__).resolve().parents[2]
GATE_JS = REPO_ROOT / "frontend" / "src" / "lib" / "onboardingGate.js"
MOCK_JS = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
KO_JS = REPO_ROOT / "frontend" / "src" / "i18n" / "resources" / "ko.js"
EN_JS = REPO_ROOT / "frontend" / "src" / "i18n" / "resources" / "en.js"


def _session_items() -> int:
    return sum(settings.SESSION_RECIPE.values())


def _js_number(path: Path, pattern: str) -> int:
    """JS 파일에서 정규식 그룹 1의 숫자를 뽑는다. 못 찾으면 실패(조용히 넘기지 않는다)."""
    text = path.read_text(encoding="utf-8")
    match = re.search(pattern, text)
    assert match is not None, (
        f"{path.name}에서 패턴을 찾지 못했다: {pattern}\n"
        "값의 자리가 바뀌었다면 이 테스트의 패턴도 함께 고쳐야 한다 — "
        "패턴이 안 맞는데 통과시키면 이 계약이 장식이 된다."
    )
    return int(match.group(1))


def test_서버_목표_상한이_세션_문항_수와_같다() -> None:
    """서버가 허용하는 최대 목표 == SESSION_RECIPE 총합.

    이 둘이 갈리면 학습자는 **자기가 받을 세션 길이를 목표로 고를 수 없다.**
    """
    assert max(DAILY_GOAL_CHOICES) == _session_items(), (
        f"목표 상한 {max(DAILY_GOAL_CHOICES)} ≠ 세션 문항 수 {_session_items()}. "
        "한쪽만 바꾸면 「오늘 목표 10/9」가 돌아온다."
    )


def test_부분_목표_선택지가_남아_있다() -> None:
    """상한을 묶었다고 부분 목표까지 지우지 않는다(원래 설계 취지 보존).

    선택지가 상한 하나로 줄면 "작게 시작해도 괜찮다"가 사라진다 — 그것은 이번
    수정이 고치려던 결함이 아니다.
    """
    assert len(DAILY_GOAL_CHOICES) >= 3
    assert min(DAILY_GOAL_CHOICES) < _session_items()


def test_프론트_선택지가_서버와_같다() -> None:
    """`lib/onboardingGate.js`의 SESSION_ITEMS가 서버 총합과 같다.

    프론트가 서버보다 큰 값을 내면 학습자가 고른 순간 **422로 튕긴다** —
    화면에 있는 버튼이 눌리지 않는 형태라 가장 나쁜 어긋남이다.
    """
    front = _js_number(GATE_JS, r"export const SESSION_ITEMS\s*=\s*(\d+)")
    assert front == _session_items()


def test_목_허용값이_서버와_같다() -> None:
    """목의 422 판정이 서버와 같아야 한다.

    목만 9를 남기면 **dev에서만 되는(또는 안 되는) 결함**이 되어, 실서버에
    나가서야 드러난다. 8/18 롤링이 정확히 그 형태로 실패했다.
    """
    text = MOCK_JS.read_text(encoding="utf-8")
    match = re.search(r"const DAILY_GOAL_CHOICES\s*=\s*\[([^\]]*)\]", text)
    assert match is not None, "mock의 DAILY_GOAL_CHOICES를 찾지 못했다"
    mock_choices = tuple(int(v) for v in re.findall(r"\d+", match.group(1)))
    assert mock_choices == tuple(DAILY_GOAL_CHOICES), (
        f"목 {mock_choices} ≠ 서버 {tuple(DAILY_GOAL_CHOICES)}"
    )


@pytest.mark.parametrize("path", [KO_JS, EN_JS], ids=["ko", "en"])
def test_라벨_키가_선택지_전건을_덮는다(path: Path) -> None:
    """`dailyGoal.choiceLabel`의 키가 선택지와 정확히 일치한다(ko·en 양쪽).

    선택지만 바꾸고 라벨을 안 바꾸면 화면에 **키 문자열이 그대로 노출**되거나
    빈 라벨이 뜬다 — i18n 스모크는 ko/en **사이의** 패리티만 보므로, 둘 다
    똑같이 낡으면 조용히 통과한다. 그 구멍을 여기서 막는다.
    """
    text = path.read_text(encoding="utf-8")
    block = re.search(r"choiceLabel:\s*\{(.*?)\}", text, re.DOTALL)
    assert block is not None, f"{path.name}에서 dailyGoal.choiceLabel을 찾지 못했다"
    keys = tuple(sorted(int(k) for k in re.findall(r"^\s*(\d+):", block.group(1), re.M)))
    assert keys == tuple(sorted(DAILY_GOAL_CHOICES)), (
        f"{path.name} 라벨 키 {keys} ≠ 선택지 {tuple(sorted(DAILY_GOAL_CHOICES))}"
    )

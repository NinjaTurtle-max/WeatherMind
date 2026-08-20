"""목 ↔ 서버 **보드 잠금 규칙** 정합 — 주석이 아니라 테스트가 문다.

## 왜 있나 (2026-08-19)

서버의 보드 해제 규칙을 고쳤는데(결함 ⑨) **목(`frontend/mock/apiMockPlugin.js`)이
같은 로직을 자체 재구현**해 갖고 있어 **안 따라왔다.** PM이 로컬 dev(`VITE_MOCK=1`)에서
**성인인데 01~03만 열리는 것**을 화면으로 확인했다 — 서버는 고쳐졌는데 화면은 그대로였다.

세 겹으로 나쁘다:
1. **dev·목 화면으로는 판정할 수 없다** — 실서버 전까지 아무도 못 본다
2. 🔴 **프론트 스모크가 목 위에서 돈다** ⇒ 목이 낡으면 스모크가 **결함을 계약으로
   굳힌다**(초록인데 틀린 상태다)
3. 🔴 이것이 **8/18을 물었던 형태**다 — 목과 서버가 갈리면 「dev에서만 되는(또는 안
   되는) 결함」이 되어 **실서버에 나가서야** 드러난다

목 파일에 *"서버와 같다"*는 **주석은 이미 있었다.** 그리고 갈렸다. ⇒ **주석은 계약이
아니다.** 파이썬에서 목을 파싱해 대조하는 선례를 따른다(`test_ci_workflow_contract` ·
`test_prompt_spec_parity` · `test_daily_goal_session_parity`).

## 무엇을 묶고 무엇을 안 묶나

**값**(천장 표 · LOOKAHEAD)은 정규식으로 정확히 대조한다.
**알고리즘**은 언어가 달라 그럴 수 없다 — 대신 목이 **서버와 같은 이름의 개념을
쓰는지**(천장 아래 인정 · 천장층 순차)를 구조로 확인한다. 알고리즘 동치를 주장하지
않는다. 그것을 주장하면 **못 지키는 계약**이 되고, 이 저장소는 그 실패를 여러 번 겪었다.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.routers.board import (
    BAND_MAX_DIFFICULTY,
    BOARD_UNLOCK_LOOKAHEAD,
    DEFAULT_MAX_DIFFICULTY,
)

MOCK_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
)


@pytest.fixture(scope="module")
def mock_src() -> str:
    assert MOCK_PATH.exists(), f"목 파일이 없다: {MOCK_PATH}"
    return MOCK_PATH.read_text(encoding="utf-8")


class TestBoardLockParity:
    def test_밴드_천장표가_같다(self, mock_src: str):
        """`BAND_MAX_DIFFICULTY` ↔ 목 `BOARD_BAND_MAX_DIFFICULTY`.

        이 표가 갈리면 **같은 계정이 서버와 dev에서 다른 판을 본다.** 밴드가 늘 때
        한쪽만 고치는 것이 가장 흔한 드리프트다.
        """
        block = re.search(
            r"const BOARD_BAND_MAX_DIFFICULTY\s*=\s*\{(.*?)\}", mock_src, re.S
        )
        assert block, "목에서 BOARD_BAND_MAX_DIFFICULTY를 못 찾았다 — 이름이 바뀌었나"
        parsed = {
            m.group(1): int(m.group(2))
            for m in re.finditer(r"(\w+)\s*:\s*(\d+)", block.group(1))
        }
        assert parsed == BAND_MAX_DIFFICULTY, (
            f"목과 서버의 밴드 천장이 다르다 — 목 {parsed} vs 서버 {BAND_MAX_DIFFICULTY}"
        )

    def test_미상_밴드_기본값이_같다(self, mock_src: str):
        m = re.search(r"const BOARD_DEFAULT_MAX_DIFFICULTY\s*=\s*(\d+)", mock_src)
        assert m, "목에서 BOARD_DEFAULT_MAX_DIFFICULTY를 못 찾았다"
        assert int(m.group(1)) == DEFAULT_MAX_DIFFICULTY

    def test_LOOKAHEAD가_같다(self, mock_src: str):
        """목 주석이 *"서버와 같아야 한다"*고 이미 적고 있었다 — 이제 테스트가 문다."""
        m = re.search(r"const MOCK_BOARD_UNLOCK_LOOKAHEAD\s*=\s*(\d+)", mock_src)
        assert m, "목에서 MOCK_BOARD_UNLOCK_LOOKAHEAD를 못 찾았다"
        assert int(m.group(1)) == BOARD_UNLOCK_LOOKAHEAD, (
            f"LOOKAHEAD가 다르다 — 목 {m.group(1)} vs 서버 {BOARD_UNLOCK_LOOKAHEAD}"
        )

    def test_목이_천장_아래를_인정한다(self, mock_src: str):
        """🔴 결함 ⑨의 본체 — **「아래는 인정」이 목에도 있는가.**

        알고리즘 동치는 언어가 달라 주장할 수 없다. 대신 **그 개념이 목에 존재하는지**를
        본다: 천장보다 **낮은** 난이도를 순차와 무관하게 여는 구문이 있어야 한다.
        종전 목에는 그것이 **아예 없었고**(천장 이하 전부를 순차 대상으로 삼았다) 그래서
        성인이 3판만 봤다.
        """
        fn = re.search(r"function unlockedBoardIds\(\)\s*\{(.*?)\n\}", mock_src, re.S)
        assert fn, "목에서 unlockedBoardIds를 못 찾았다"
        body = fn.group(1)
        assert re.search(r"<\s*ceiling", body), (
            "목이 「천장보다 낮은 난이도는 인정」을 안 한다 — 성인이 1번부터 걷게 된다"
        )
        assert re.search(r"===?\s*ceiling", body), (
            "목이 순차를 **천장층 안에서** 세지 않는다 — 창이 아래층에 떨어져 "
            "천장층이 하나도 안 열린다"
        )

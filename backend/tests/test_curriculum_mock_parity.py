"""목 ↔ 서버 **커서 승격 규칙** 정합 — 주석이 아니라 테스트가 문다.

## 왜 있나 (2026-08-19)

서버의 `current` 승격을 고쳤는데(결함 ⑧ — 배치가 연 구간의 **최상위**에서 시작) 목
(`frontend/mock/apiMockPlugin.js`)이 **같은 로직을 자체 재구현**해 갖고 있어 안 따라왔다.
목 주석은 *"백엔드 `build_curriculum`과 동일"*이라고 **이미 적고 있었고, 그래도 갈렸다.**

⇒ **주석은 계약이 아니다.** 그리고 이 갈림은 특히 나쁘다:
· **dev·목 화면으로는 ⑧을 판정할 수 없다**(실서버 전까지 아무도 못 본다)
· **프론트 스모크가 목 위에서 돈다** ⇒ 목이 낡으면 스모크가 **결함을 계약으로 굳힌다**

## 무엇을 묶고 무엇을 안 묶나

**알고리즘 동치는 주장하지 않는다** — 언어가 다르다. 대신 **규칙의 뼈대**가 목에
있는지를 구조로 본다:
· 배치 선해제 구간을 **아는가**(`preUnlockedUnits` 참조)
· 그 구간의 **끝**을 고르는가(첫 원소가 아니라)
· 배치가 없을 때 **맨 앞**으로 떨어지는 분기가 있는가

지킬 수 있는 것만 문다. 못 지킬 것을 주장하면 계약이 장식이 된다.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

MOCK_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
)


@pytest.fixture(scope="module")
def promotion_block() -> str:
    src = MOCK_PATH.read_text(encoding="utf-8")
    start = src.find("// 'current' 승격")
    assert start != -1, "목에서 'current' 승격 구역을 못 찾았다 — 주석이 바뀌었나"
    end = src.find("return { sections };", start)
    assert end != -1, "승격 구역의 끝을 못 찾았다"
    return src[start:end]


class TestCursorPromotionParity:
    def test_목이_배치_선해제_구간을_안다(self, promotion_block: str):
        """🔴 결함 ⑧의 본체 — 종전 목은 선해제를 **아예 안 봤다**.

        `find(v => v.status === 'unlocked')` 한 줄이었고, 그래서 배치로 여러 유닛을
        인정받아도 커서가 맨 앞이었다.
        """
        assert "preUnlockedUnits" in promotion_block, (
            "목의 커서 승격이 배치 선해제를 안 본다 — 인정받아도 맨 앞에서 시작한다"
        )

    def test_목이_구간의_끝을_고른다(self, promotion_block: str):
        """「첫」이 아니라 「끝」이어야 한다.

        서버는 `max(inside, key=order_index)`로 고른다. 목은 배열 순서가 곧 전체
        순서이므로 **마지막 원소**를 고르는 형태여야 같은 뜻이다.
        """
        assert re.search(r"\[\s*\w+\.length\s*-\s*1\s*\]", promotion_block), (
            "목이 인정 구간의 **끝**을 고르지 않는다 — 서버는 구간 끝을 current로 삼는다"
        )

    def test_배치가_없으면_맨_앞_분기가_있다(self, promotion_block: str):
        """🔴 **신규 학습자를 깨뜨리지 않는다**는 반대 축.

        배치를 안 본 학습자는 종전 그대로 맨 앞에서 시작해야 한다. 이 분기가 없으면
        신규 학습자가 갑자기 뒤쪽 유닛으로 떨어진다 — 서버도 같은 분기를 갖는다.
        """
        assert re.search(r"preUnlockedUnits\.size\s*>\s*0", promotion_block), (
            "목에 「배치가 없으면 맨 앞」 분기가 없다 — 신규 학습자가 뒤로 떨어진다"
        )
        assert re.search(r"\[\s*0\s*\]", promotion_block), (
            "목에 맨 앞을 고르는 갈래가 없다"
        )

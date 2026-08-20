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

**값**(천장 표 · 층수 · LOOKAHEAD)은 정규식으로 정확히 대조한다.
**알고리즘**은 언어가 달라 그럴 수 없다 — 대신 목이 **서버와 같은 이름의 개념을
쓰는지**(미상 천장 가드 · 천장 아래 인정 · 천장층 순차)를 구조로 확인한다. 알고리즘
동치를 주장하지 않는다. 그것을 주장하면 **못 지키는 계약**이 되고, 이 저장소는 그
실패를 여러 번 겪었다.

## 🔴 2026-08-20 축 교체 — **조준만 옮겼다. 단정을 지우지 않았다**

보드 잠금·표기 축이 **학령 파생 난이도(1~3)에서 지식 단계(1~10)**로 갈아탔다
(`routers/board.py`의 「철거된 파생 축」 블록 · 클라이언트 판정). 그래서 이 파일이
겨냥하던 이름 넷이 **양쪽에서 함께 사라졌다.** 죽은 이름을 향한 정규식은 영영 못
찾으므로, **살아 있는 이름으로 조준을 옮긴다** — 그것은 계약을 느슨하게 하는 것이
아니라 *「축이 바뀌어 계약의 뜻을 다시 쓰는 것」*이다(2026-08-20 클라이언트 규정).

| 종전 단정 | 지키던 성질 | 지금 |
|---|---|---|
| `test_밴드_천장표가_같다` | 이 표가 갈리면 **같은 계정이 서버와 dev에서 다른 판을 본다** | 같은 이름으로 **살아 있다** — 조준을 `BOARD_LEVEL_GROUP_TIER`로 옮기고, 기대값은 서버에서 **파생**시킨다 |
| `test_미상_밴드_기본값이_같다` | **미상 밴드는 잠그지 않는다** | 같은 성질을 `test_미상_천장은_목에서도_잠그지_않는다`가 문다. 서버가 상수(`DEFAULT_MAX_DIFFICULTY`)를 **분기**(`locked_tiers(None) == set()`)로 바꿨으므로 대조 대상도 값에서 **가드**로 옮겼다 |
| `test_LOOKAHEAD가_같다` | 목에서 3칸 열리는데 실서버는 1칸 | **그대로**(양쪽 상수가 다 산다) |
| `test_목이_천장_아래를_인정한다` | 결함 ⑨ — 성인이 1번부터 걷는다 | **그대로**(비교 대상이 난이도에서 `knowledge_level`로 바뀌었을 뿐) |

⚠️ **어느 것도 「중복이니 지운다」로 처리하지 않았다.** `test_r13_mock_policy_parity.py`가
천장 표·층수·LOOKAHEAD **같은 세 값**을 `__mockPolicy()` 실값으로 이미 물고 있다(그쪽
`test_보드_밴드_천장이_서버_파생값과_같다` · `test_보드_층수가_같다` ·
`test_보드_잠금_앞보기가_같다`). 소유자가 둘인 것은 이 저장소가 반복해 치른 드리프트
형태이므로 **판정 대기로 올렸다**(2026-08-20 규정: 담당이 스스로 계약을 지울 수 없다).
두 경로의 성질이 다르다는 근거도 함께 올렸다 — 그쪽은 **「노출된 값이 맞나」**,
여기는 **「소스에 그 상수가 있나」**이고, 목이 상수를 지우고 정책에 리터럴을 박으면
그쪽만 초록이 된다.

## ⚠️ 이 파일의 고유 함정 — **소스를 파싱하므로 주석에 속을 수 있다**

목의 `lockedBoardTiers`·`unlockedBoardIds` 주석은 지키려는 성질을 **문장으로 그대로
적고 있다**(*"미상 밴드는 잠그지 않는다"* · *"천장보다 낮은 난이도 → 전부 열림"*).
주석을 세면 **설명을 잘 써 두면 통과**가 된다. 그래서 구조 단정은 `_js_code`로 **주석을
걷어낸 코드부**만 본다(같은 함정을 `test_r13_mock_policy_parity`가 왕관 쪽에서 이미
한 번 밟았다 — `grant_crown=False`가 주석에 남아 계약이 헛돌았다).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.routers.board import BOARD_TIERS, BOARD_UNLOCK_LOOKAHEAD

MOCK_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
)


@pytest.fixture(scope="module")
def mock_src() -> str:
    assert MOCK_PATH.exists(), f"목 파일이 없다: {MOCK_PATH}"
    return MOCK_PATH.read_text(encoding="utf-8")


def _js_code(block: str) -> str:
    """JS 블록에서 **주석을 걷어낸다** — 위 「고유 함정」 절 참조.

    줄 주석과 블록 주석 둘 다 걷는다(목은 `/** … */` JSDoc을 쓴다).
    """
    no_block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    return "\n".join(
        line for line in no_block.splitlines() if not line.lstrip().startswith("//")
    )


def _fn_body(src: str, decl: str) -> str:
    """`function <name>() {` 부터 열 0의 `}` 까지 — **코드부만** 돌려준다."""
    m = re.search(rf"function {re.escape(decl)}\(\)\s*\{{(.*?)\n\}}", src, re.S)
    assert m, f"목에서 {decl}를 못 찾았다 — 이름이 바뀌었나(이 계약을 갱신할 것)"
    return _js_code(m.group(1))


class TestBoardLockParity:
    def test_밴드_천장표가_같다(self, mock_src: str):
        """학습 수준 → 열리는 **최고 층** ↔ 목 `BOARD_LEVEL_GROUP_TIER`.

        이 표가 갈리면 **같은 계정이 서버와 dev에서 다른 판을 본다.** 밴드가 늘 때
        한쪽만 고치는 것이 가장 흔한 드리프트다.

        🔴 **기대값을 여기 사본으로 적지 않는다.** 서버 `theta_to_knowledge_level(
        LEVEL_GROUP_ITEM_B[밴드])`를 그 자리에서 돌려 파생시킨다 — 값을 옮겨 적으면
        이 계약이 자기 사본을 대조하게 되고, 그것이 애초에 CO-J-9가 생긴 방식이다.
        서버 dict를 돌며 만들기 때문에 **밴드가 목에서 사라지는 것(키 집합
        드리프트)까지** 이 한 줄이 문다.

        ⚠️ 서버 천장 파생의 **1순위 경로**(진단 전 기본 θ = 사전 b)만 대조한다.
        두 번째 폴백 `knowledge_level_of_level_group`(1·3·5·7)은 값이 다르고 그것은
        **선재 어긋남**이라 대장에 기록돼 있다 — 이 테스트를 그쪽으로 "고치지" 말 것.
        목은 1순위 경로만 흉내 낸다.

        ⚠️ **소유자 중복 판정 대기**: 같은 값을 `test_r13_mock_policy_parity::
        test_보드_밴드_천장이_서버_파생값과_같다`가 `__mockPolicy()` **실값**으로도
        문다. 그쪽은 「노출된 값이 맞나」, 여기는 「소스에 상수가 있나」로 성질이
        갈리지만 값이 겹치는 것은 사실이다. 지우지 않고 올렸다(2026-08-20 규정).
        """
        from app.services import weatherbrain_service as wb

        block = re.search(
            r"const BOARD_LEVEL_GROUP_TIER\s*=\s*\{(.*?)\}", mock_src, re.S
        )
        assert block, "목에서 BOARD_LEVEL_GROUP_TIER를 못 찾았다 — 이름이 바뀌었나"
        parsed = {
            m.group(1): int(m.group(2))
            for m in re.finditer(r"(\w+)\s*:\s*(\d+)", _js_code(block.group(1)))
        }
        expected = {
            band: wb.theta_to_knowledge_level(item_b)
            for band, item_b in wb.LEVEL_GROUP_ITEM_B.items()
        }
        assert parsed == expected, (
            f"목과 서버의 밴드 천장이 다르다 — 목 {parsed} vs 서버 {expected}"
        )

    def test_층수가_같다(self, mock_src: str):
        """잠금 집합의 **정의역** ↔ 목 `BOARD_TIER_MAX`.

        천장 표가 같아도 층수가 갈리면 잠긴 집합이 갈린다: 목이 10층까지 세고
        서버가 6층까지 세면 7~10층 퍼즐이 **목에서만 존재하는 화면**이 된다.
        서버 쪽 소유자는 `schemas/progress.KNOWLEDGE_LEVEL_MAX` 하나이고
        `routers/board.BOARD_TIERS`가 거기서 나오므로, 여기서는 그 튜플의 **끝값**을
        읽어 사본을 만들지 않는다.

        ⚠️ 종전 이 자리에 `BOARD_DIFFICULTIES`(1,2,3)의 짝인
        `BOARD_DEFAULT_MAX_DIFFICULTY` 대조가 있었다 — 축 교체로 조준을 옮긴 것이고
        지운 단정이 아니다(머리말 표 참조).
        """
        m = re.search(r"const BOARD_TIER_MAX\s*=\s*(\d+)", mock_src)
        assert m, "목에서 BOARD_TIER_MAX를 못 찾았다 — 이름이 바뀌었나"
        assert int(m.group(1)) == BOARD_TIERS[-1], (
            f"층수가 다르다 — 목 {m.group(1)} vs 서버 {BOARD_TIERS[-1]} "
            f"(서버 소유자는 schemas/progress.KNOWLEDGE_LEVEL_MAX)"
        )

    def test_미상_천장은_목에서도_잠그지_않는다(self, mock_src: str):
        """서버 `locked_tiers(None) == set()`의 **목 쪽 짝**.

        종전 `test_미상_밴드_기본값이_같다`가 지키던 성질 그대로다 — *"밴드가 늘었는데
        이 표를 안 고치면 그 밴드 유저가 보드를 통째로 잃는데, **못 여는 것이 열리는
        것보다 나쁘다**"*. 서버는 상수(`DEFAULT_MAX_DIFFICULTY = 3`)를 **분기**로 바꿔
        성질을 승계했고(그 함수 독스트링이 승계를 밝힌다), 목도
        `BOARD_LEVEL_GROUP_TIER`에 없는 학령에서 **빈 집합**을 내야 한다.

        가드가 없으면 `BOARD_TIERS.filter((t) => t > undefined)`가 전건 비교 실패로
        **빈 집합**을 내 우연히 같은 답이 나오지만, 그 우연은 표의 모양 하나에
        기댄다 — 표의 값이 문자열이 되거나 기본값이 붙는 순간 갈린다.

        🔴 **값이 아니라 분기를 문다** — 이 성질은 `__mockPolicy()`가 표현할 수 없다.
        정책은 `board_level_group_tier` 표를 내보낼 뿐이고, 「표에 없는 키가 오면
        어떻게 하나」는 표에 안 적혀 있다. 서버 쪽 짝은
        `test_board_progression.py::test_미상_밴드는_잠그지_않는다`이고 그쪽은
        **서버 함수만** 본다 ⇒ **목 쪽은 이 단정이 생길 때까지 아무 그물에도 없었다**
        (`test_r13_mock_policy_parity.py` 꼬리 주석이 그 공백을 적어 뒀다).
        """
        body = _fn_body(mock_src, "lockedBoardTiers")
        assert re.search(
            r"typeof\s+ceiling\s*!==\s*'number'\s*\)\s*return\s+new Set\(\)", body
        ), (
            "목의 lockedBoardTiers에 「미상 천장은 잠그지 않는다」 가드가 없다 — "
            "서버 `locked_tiers(None) == set()`와 갈린다"
        )

    def test_LOOKAHEAD가_같다(self, mock_src: str):
        """목 주석이 *"서버와 같아야 한다"*고 이미 적고 있었다 — 이제 테스트가 문다.

        ⚠️ **소유자 중복 판정 대기**: 같은 값을 `test_r13_mock_policy_parity::
        test_보드_잠금_앞보기가_같다`가 `__mockPolicy()` 실값으로도 문다. 그쪽 경로는
        node 없는 환경에서 skip되고(그 파일 머리말이 설계로 밝힌다) 이 경로는
        python만으로 돈다 — 그것이 두 경로를 다 두는 논거이기도 하다. 지우지 않고
        올렸다(2026-08-20 규정).
        """
        m = re.search(r"const MOCK_BOARD_UNLOCK_LOOKAHEAD\s*=\s*(\d+)", mock_src)
        assert m, "목에서 MOCK_BOARD_UNLOCK_LOOKAHEAD를 못 찾았다"
        assert int(m.group(1)) == BOARD_UNLOCK_LOOKAHEAD, (
            f"LOOKAHEAD가 다르다 — 목 {m.group(1)} vs 서버 {BOARD_UNLOCK_LOOKAHEAD}"
        )

    def test_층_추출_규칙이_같다(self, mock_src: str):
        """**같은 값이 아니라 같은 규칙** — 목이 「무엇을 층으로 인정하나」(2026-08-20 신설).

        🔴 **B조가 변이로 확인한 함정을 이 파일에도 적용한 것이다**: *행동(값) 대조로는
        안 잡혔다 — 시드가 정수만 써서 값이 같았기 때문이다.* 이 파일도 천장 표·층수·
        LOOKAHEAD **값**을 대조하지만, 값이 같아도 **판정 규칙**이 갈리면 저작이
        경계값을 밟는 날 갈라진다.

        🔴 **이 계약은 두 곳이 틀린 채로 빨강이었다**(2026-08-20 수리 · 어드바이저 판정).
        경위를 남기는 이유는 이것이 **§5.25ⓓ 일곱 번째 형태(「판정 기준 자체가 거짓」)의
        실례**이고, 그 이름으로 인용될 값이 있어서다.

          ⓐ **기준이 거짓이었다.** 종전에는 목이
             `typeof seed.knowledge_level === 'number'`를 쓸 것을 **요구**했다.
             그런데 **같은 병합에서 그 가드가 서버와 갈린다고 증명**됐다 — 서버 판정은
             파이썬 `isinstance(value, int)`이고, JS `typeof v === 'number'`는
             **비정수 실수 `2.5`를 층으로 인정**한다(파이썬은 int가 아니라 거른다).
             거꾸로 **파이썬에서 bool은 int**라 `True`가 통과하는데 JS `typeof`는
             boolean을 거른다. ⇒ **양방향으로 갈렸다.**
          ⓑ **계측기가 망가져 있었다.** 정규식이 `const boardTierOf\\s*=(.*?);`라
             **첫 세미콜론까지만** 잡았다. 목이 블록 본문으로 바뀐 뒤로는
             `'(seed) => {\n  const v = seed?.knowledge_level'`**조각만** 캡처했고,
             그 뒤 단정 2건은 **볼 대상이 없어 공허**했다. 즉 **아무것도 안 잡는
             계약**이었다.

        ⇒ 판정: **둘 다 「완화」가 아니라 「수리」다.** 규정(「계약을 느슨하게 하는 것은
        세션이 스스로 못 한다」)의 판정 기준은 **변이 보존** — 고친 뒤 **잡는 변이가
        줄어드는가**를 본다. ⓐ는 옛 형태를 **금지**하므로 조이기이고, ⓑ는
        **아무것도 안 잡던 것을 잡게** 만들므로 조이기다(대장 §5.27-k, 규정 해석 선례 ②).

        무는 것 셋:
          ⑴ 목의 층 추출이 서버 `board_tier`의 `isinstance(level, int)`와 **같은
             판정**을 한다 — bool을 **먼저** 가르고(파이썬에서 bool은 int라 `true`가
             통과한다), 정수 여부는 `Number.isInteger`로 본다(`typeof === 'number'`는
             `2.5`를 통과시켜 서버와 갈린다), 미상은 `null`.
             ⚠️ `??`나 `||`로 바꾸면 **문자열·false가 층이 된다**(`'3' ?? null`은
             `'3'`이고, 그 값은 `> ceiling` 비교에서 조용히 강제 변환된다).
          ⓒ **계측기 자신을 문다** — 캡처가 함수 **본문까지** 닿았는지 확인한다.
             ⓑ가 재발하면(정규식을 다시 좁히면) 여기가 **먼저** 운다.
          ⑵ 그 가드가 **실제 경로에 있다** — `BOARD_PUZZLES`가
             `knowledge_level: boardTierOf(seed)`로 짓는다. 헬퍼만 있고 짓는 자리가
             원시 필드를 그대로 읽으면 ⑴이 장식이 된다(B조가 「프로덕션과 표본이 같은
             비교 함수를 쓰는가」를 함수 **이름**으로 대조한 것과 같은 이유다).

        ⚠️ **이 단정은 고치는 방향을 정하지 않는다** — 양쪽이 **이미 같고**, 서버·목
        어느 쪽도 이 모양을 다투지 않는다. 방향이 다투어지는 자리(null 층 퍼즐의
        「아래는 인정」 판정)는 여기서 단정하지 않고 판정 대기로 올렸다.
        """
        # 🔴 **선언 전체를 잡는다.** 종전 `(.*?);`는 첫 세미콜론에서 끊겨 블록 본문의
        #    조각만 캡처했고 뒤 단정들이 공허했다(위 ⓑ). 화살표 본문이 블록이든 한 줄
        #    식이든 **다음 최상위 선언 직전까지** 가져온다.
        decl = re.search(
            r"const boardTierOf\s*=(.*?)(?=\n(?:const |function |export |/\*\*))",
            mock_src,
            re.S,
        )
        assert decl, "목에서 boardTierOf를 못 찾았다 — 이 계약을 갱신할 것"
        code = _js_code(decl.group(1))

        # ── ⓒ 계측기 자신을 먼저 문다 ──────────────────────────────────────────
        # 캡처가 **본문까지** 닿지 않으면 아래 단정들은 볼 대상이 없어 **공허하게
        # 초록**이 된다. 그 상태가 종전 이 계약의 모습이었다. 정규식을 다시 좁히면
        # 여기가 **먼저** 운다 — 「치환 0회 단정」과 같은 형태로, 계측기를 역검증한다.
        assert "return" in code, (
            "`boardTierOf` 캡처가 함수 본문에 못 닿았다 — 아래 단정들이 볼 대상이 "
            f"없어 공허해진다(정규식을 좁히면 이 형태가 된다). 캡처: {code.strip()!r}"
        )

        assert re.search(r"Number\.isInteger\(", code), (
            "목의 층 추출이 `Number.isInteger`로 정수를 판정하지 않는다 — 서버는 "
            "파이썬 `isinstance(level, int)`라 **비정수 실수를 거른다**. JS "
            "`typeof v === 'number'`로 두면 `2.5`가 층이 되어 서버와 갈리고, "
            "시드가 정수만 쓰는 동안은 **값이 같아 아무도 모른다**(B조 변이 실측). "
            f"지금 모양: {code.strip()!r}"
        )
        assert re.search(r"===\s*'boolean'", code), (
            "목이 boolean을 **먼저 가르지 않는다** — 파이썬에서 `bool`은 `int`라 "
            "서버 `isinstance(level, int)`는 `True`를 **통과시킨다**(값 1처럼 쓰인다). "
            "JS `Number.isInteger(true)`는 `false`라 목만 미상으로 떨어뜨린다. "
            f"서버가 권위이므로 그 기벽까지 베낀다. 지금 모양: {code.strip()!r}"
        )
        assert re.search(r":\s*null", code), (
            "층이 미상일 때 목이 `null`을 내지 않는다 — 서버 `board_tier`는 `None`을 "
            f"내고 그때 잠그지 않는 것이 규칙이다. 지금 모양: {code.strip()!r}"
        )
        assert re.search(r"knowledge_level:\s*boardTierOf\(", _js_code(mock_src)), (
            "BOARD_PUZZLES가 `boardTierOf`를 거치지 않고 층을 짓는다 — 가드가 "
            "경로에 없으면 위 두 단정이 장식이 된다"
        )

    def test_목이_천장_아래를_인정한다(self, mock_src: str):
        """🔴 결함 ⑨의 본체 — **「아래는 인정」이 목에도 있는가.**

        알고리즘 동치는 언어가 달라 주장할 수 없다. 대신 **그 개념이 목에 존재하는지**를
        본다: 천장보다 **낮은** 층을 순차와 무관하게 여는 구문이 있어야 하고, 순차는
        **천장층 안에서만** 세야 한다. 종전 목에는 앞의 것이 **아예 없었고**(천장 이하
        전부를 순차 대상으로 삼았다) 그래서 성인이 3판만 봤다.

        ⚠️ 축 교체 뒤에도 형태는 그대로다 — 서버 판정이 *"규칙의 형태는 그대로다:
        「자기 단계 아래는 인정 · 순서는 자기 층 안에서 · 위층은 잠금」. 바뀐 것은
        층의 개수와 천장의 출처뿐이다"*라고 못박았다. 비교 대상만 파생 난이도에서
        `knowledge_level`로 옮겼다 — **그래서 정규식도 그 필드를 요구한다**(맨
        `< ceiling`으로 두면 다른 필드를 비교해도 통과한다).
        """
        body = _fn_body(mock_src, "unlockedBoardIds")
        assert re.search(r"knowledge_level\s*<\s*ceiling", body), (
            "목이 「천장보다 낮은 층은 인정」을 안 한다 — 성인이 1번부터 걷게 된다"
        )
        assert re.search(r"knowledge_level\s*===?\s*ceiling", body), (
            "목이 순차를 **천장층 안에서** 세지 않는다 — 창이 아래층에 떨어져 "
            "천장층이 하나도 안 열린다"
        )

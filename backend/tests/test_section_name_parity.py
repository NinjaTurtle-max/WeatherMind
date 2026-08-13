"""섹션명 3자 패리티 계약 — `units.json` ↔ `SECTION_ORDER` ↔ `ko.js` (CO-G1).

**왜 이 파일이 있나.** 지식 단계 섹션명 10종이 저장소에 **세 벌** 존재한다.

| 사본 | 파일 | 역할 |
|---|---|---|
| 원본 | `database/seed/units.json` `section` | 유닛이 실제로 앉은 섹션 |
| 정렬 | `app/services/curriculum_service.SECTION_ORDER` | 트리 노출 순서의 소유자 |
| 표시 | `frontend/src/i18n/resources/ko.js` `ability.knowledgeLevel.name` | /me 화면 |

이 저장소에서 가장 잦은 실패가 **"사본이 갈리는 것"**이고, 이 셋은 특히 조용히
갈린다. 갈렸을 때 나는 증상이 예외가 아니기 때문이다:

- `units.json`의 섹션명이 `SECTION_ORDER`에 없으면 `_section_key`의 폴백을 타고
  **알파벳순으로 꼬리에 붙는다**. 트리는 그대로 200으로 뜨고, 루트·`current`·
  배치 선해제만 조용히 뒤집힌다. 실제로 CO-G1 재구조화 중 이 형태로 겪었다
  (`placement_unlock_floor`가 3에서 0이 됐다 — 데이터가 아니라 정렬 때문에).
- `ko.js`와 갈리면 학습 경로의 섹션 헤더와 /me의 단계 이름이 다른 말을 한다.
  어느 쪽도 틀린 값이 아니라 **서로 다른 값**이라 화면만 보고는 못 잡는다.

그래서 CO-G1 설계안(`docs/design/cyclic_sections.md` §6-①)이 이 계약을 권고했고,
생성기도 섹션명을 손으로 옮기지 않고 `ko.js`를 파싱해 들어 올렸다.

**선례**: `test_ci_workflow_contract`·`test_prompt_spec_parity`가 이미 파이썬 밖
파일을 파싱해 대조한다. 여기도 같은 방식이다 — 프론트를 임포트하지 않고 텍스트로 읽는다.

**리터럴을 한 줄도 적지 않는다.** 섹션명을 여기 적으면 그것이 **네 번째 사본**이
되어 이 파일이 막으려는 실패를 이 파일이 만든다. 그래서 저작이 진행돼 단계 수가
10에서 바뀌어도 이 파일은 고칠 데가 없다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
UNITS_JSON = REPO_ROOT / "database" / "seed" / "units.json"
KO_JS = REPO_ROOT / "frontend" / "src" / "i18n" / "resources" / "ko.js"


# ═══════════════════════════════════════════════════════════════
# 파서 — 전부 인자를 받는 순수 함수라 self-test가 위조 입력을 먹일 수 있다
# ═══════════════════════════════════════════════════════════════


def _extract_block(source: str, outer: str, inner: str) -> str:
    """`outer: { … inner: { …여기… } … }`의 안쪽 중괄호 본문을 잘라낸다.

    중괄호 깊이를 세는 이유는 `ko.js`에 같은 이름의 **문자열 키**가 따로 있기
    때문이다(`knowledgeLevel: '🪜 {name}'` — 객체가 아니라 문자열). 정규식 하나로
    잡으면 그쪽을 먼저 물 수 있어 `이름: {` 형태만 인정한다.
    """
    outer_m = re.search(rf"\b{re.escape(outer)}\s*:\s*\{{", source)
    if outer_m is None:
        raise AssertionError(f"{outer} 블록을 못 찾았다 — i18n 구조가 바뀌었다")
    inner_m = re.search(rf"\b{re.escape(inner)}\s*:\s*\{{", source[outer_m.end():])
    if inner_m is None:
        raise AssertionError(f"{outer}.{inner} 블록을 못 찾았다 — i18n 구조가 바뀌었다")
    start = outer_m.end() + inner_m.end()
    depth = 1
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[start:i]
    raise AssertionError(f"{outer}.{inner} 블록이 닫히지 않았다")


def knowledge_level_names(ko_source: str) -> list[str]:
    """`ability.knowledgeLevel.name`을 **단계 번호 오름차순** 리스트로 돌려준다.

    번호가 1부터 빈칸 없이 이어지는지까지 여기서 본다 — 10단계 중 하나가 빠진
    사전은 화면에서 `undefined`가 되는데, 그것은 패리티 이전의 결함이다.
    """
    block = _extract_block(ko_source, "knowledgeLevel", "name")
    pairs = re.findall(r"(\d+)\s*:\s*'([^']*)'", block)
    if not pairs:
        raise AssertionError("knowledgeLevel.name 항목을 하나도 못 읽었다")
    by_level = {int(k): v for k, v in pairs}
    expected_keys = list(range(1, len(by_level) + 1))
    assert sorted(by_level) == expected_keys, (
        f"knowledgeLevel.name 단계 번호가 1..N 연속이 아니다: {sorted(by_level)}"
    )
    return [by_level[i] for i in expected_keys]


def seed_sections_in_order(units: list[dict]) -> list[str]:
    """시드 유닛의 섹션을 **등장 순서·중복 제거**로 돌려준다."""
    return list(dict.fromkeys(u["section"] for u in units))


def check_parity(
    units: list[dict], ko_source: str, section_order: tuple[str, ...] | list[str]
) -> None:
    """세 사본이 어긋나면 AssertionError. 통과하면 아무것도 반환하지 않는다.

    단정 3종:
      ① `ko.js` 단계명은 `SECTION_ORDER`의 **선두 prefix**다 — 단계 섹션이 앞에
         오지 않으면 트리 선두(=루트·current·배치 선해제)가 단계 1이 아니게 된다.
      ② 시드의 섹션은 전건 `SECTION_ORDER`에 **등재**돼 있다 — 미등재는 정렬
         폴백으로 꼬리에 붙어 조용히 순서를 뒤집는다.
      ③ 시드의 섹션 등장 순서는 `SECTION_ORDER`의 **부분수열**이다 — 순서가 갈리면
         화면 순서와 선행 사슬이 어긋난다.
    """
    ko_names = knowledge_level_names(ko_source)
    order = list(section_order)
    seen = seed_sections_in_order(units)

    # ① ko.js ↔ SECTION_ORDER
    assert order[: len(ko_names)] == ko_names, (
        "ko.js ability.knowledgeLevel.name != SECTION_ORDER 선두 "
        f"{len(ko_names)}칸\n  ko.js: {ko_names}\n  order: {order[:len(ko_names)]}"
    )

    # ② units.json ↔ SECTION_ORDER (등재)
    unregistered = [s for s in seen if s not in set(order)]
    assert unregistered == [], (
        f"units.json에 SECTION_ORDER 미등재 섹션: {unregistered} — 정렬 폴백으로 "
        "꼬리에 붙어 루트·current·배치 선해제가 조용히 뒤집힌다"
    )

    # ③ units.json ↔ SECTION_ORDER (순서)
    expected = [s for s in order if s in set(seen)]
    assert seen == expected, (
        f"시드 섹션 등장 순서가 SECTION_ORDER와 다르다\n"
        f"  seed : {seen}\n  order: {expected}"
    )


# ═══════════════════════════════════════════════════════════════
# 실파일 계약
# ═══════════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def real_units() -> list[dict]:
    data = json.loads(UNITS_JSON.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data["units"]


@pytest.fixture(scope="module")
def ko_source() -> str:
    assert KO_JS.exists(), f"ko.js가 없다: {KO_JS}"
    return KO_JS.read_text(encoding="utf-8")


class TestRealFilesParity:
    """실파일 3자 대조 — 값 리터럴 0개."""

    def test_세_사본이_어긋나지_않는다(self, real_units, ko_source):
        from app.services import curriculum_service as cs

        check_parity(real_units, ko_source, cs.SECTION_ORDER)

    def test_단계명이_비어있지_않다(self, ko_source):
        """공허 통과 방지 — 파서가 0건을 읽고 조용히 통과하는 형태를 막는다."""
        names = knowledge_level_names(ko_source)
        assert len(names) >= 3, f"단계명이 {len(names)}종뿐 — 파서가 헛읽었다"
        assert all(n.strip() for n in names), "빈 단계명이 있다"
        assert len(set(names)) == len(names), f"단계명 중복: {names}"

    def test_시드가_섹션을_실제로_들고_있다(self, real_units):
        """공허 통과 방지 — 유닛 0건·섹션 0종이면 ②③이 전부 참이 된다."""
        assert len(real_units) >= 10
        assert len(seed_sections_in_order(real_units)) >= 3
        assert all(u.get("section") for u in real_units), "section이 빈 유닛이 있다"


# ═══════════════════════════════════════════════════════════════
# self-test — **되돌리면 우는가**
# ═══════════════════════════════════════════════════════════════


class TestContractActuallyBites:
    """위 계약이 정말 무는지 위조 입력으로 확인한다.

    실파일을 건드리지 않는다(`units.json`·`ko.js`는 다른 담당 소유다) — 파서·판정을
    순수 함수로 갈라 둔 이유가 이것이다. 계약 테스트가 **통과만 하고 아무것도 안
    보는** 상태(대장 CO-I절 「만들어 두고 안 쓰는 것」)를 이 클래스가 막는다.
    """

    @staticmethod
    def _ko(names: list[str]) -> str:
        body = "".join(f"        {i}: '{n}',\n" for i, n in enumerate(names, 1))
        return (
            "export default { ability: {\n"
            "    knowledgeLevel: {\n"
            "      cardTitle: '현재 지식 단계',\n"
            f"      name: {{\n{body}      }},\n"
            "    },\n"
            "}};\n"
            "// 문자열 형태의 동명 키 — 파서가 이쪽을 물면 안 된다\n"
            "const x = { knowledgeLevel: '🪜 {name}' };\n"
        )

    @staticmethod
    def _units(sections: list[str]) -> list[dict]:
        return [{"id": f"u{i}", "section": s} for i, s in enumerate(sections)]

    def test_기준선은_통과한다(self):
        """위조 입력이라도 정합하면 통과 — 아래 실패들이 '무조건 실패'가 아님을 보인다."""
        order = ["단계1", "단계2", "단계3"]
        check_parity(self._units(order), self._ko(order), order)

    def test_ko_js가_갈리면_운다(self):
        order = ["단계1", "단계2", "단계3"]
        drifted = ["단계1", "단계2 (수정)", "단계3"]
        with pytest.raises(AssertionError, match="knowledgeLevel.name"):
            check_parity(self._units(order), self._ko(drifted), order)

    def test_시드에_미등재_섹션이_생기면_운다(self):
        order = ["단계1", "단계2", "단계3"]
        with pytest.raises(AssertionError, match="미등재"):
            check_parity(
                self._units(["단계1", "낡은 섹션명"]), self._ko(order), order
            )

    def test_시드_섹션_순서가_뒤집히면_운다(self):
        order = ["단계1", "단계2", "단계3"]
        with pytest.raises(AssertionError, match="등장 순서"):
            check_parity(
                self._units(["단계2", "단계1"]), self._ko(order), order
            )

    def test_SECTION_ORDER가_단계명을_앞에_두지_않으면_운다(self):
        """단계 섹션이 선두가 아니면 트리 루트가 단계 1이 아니게 된다."""
        names = ["단계1", "단계2"]
        order = ["다른 섹션", "단계1", "단계2"]
        with pytest.raises(AssertionError, match="SECTION_ORDER 선두"):
            check_parity(self._units(names), self._ko(names), order)

    def test_단계_번호가_비면_운다(self):
        source = (
            "export default { ability: {\n"
            "    knowledgeLevel: {\n"
            "      name: {\n        1: '단계1',\n        3: '단계3',\n      },\n"
            "    },\n}};\n"
        )
        with pytest.raises(AssertionError, match="1..N 연속"):
            knowledge_level_names(source)

    def test_파서가_문자열_동명키를_물지_않는다(self):
        """`knowledgeLevel: '🪜 {name}'`(문자열)이 먼저 나와도 객체를 찾아야 한다."""
        names = ["단계1", "단계2"]
        source = (
            "const a = { knowledgeLevel: '🪜 {name}' };\n" + self._ko(names)
        )
        assert knowledge_level_names(source) == names

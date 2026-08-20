"""대기화학 축 계약 — 배치 요소 `aerosol`과 그 규칙이 지켜야 하는 것 (2026-08-20).

## 이 파일이 무는 것은 「무엇이 있는가」가 아니라 「무엇이 참이어야 하는가」다

같은 저장소에서 **정체를 세던 계약이 헛울고 조용히 실패한** 전례가 여럿이라
(`PRECIP_META`가 *"강수 4종을 갖고 있는가"*를 세어 표가 안 자라도 초록이었고,
`test_seed_contract`가 `len(BOARD_RULES) == 8`을 세어 확장을 막을 뿐 판정을 못 지켰다)
아래 단정은 전부 **요구 형태**로 쓴다. 그래서 `aerosol` 규칙이 하나 더 늘어도
이 파일을 고칠 필요가 없고, **늘어난 규칙이 요구를 어기면 그때 운다.**

## 왜 필요한가 — 조절값 요소는 **네 곳**에 흩어져 있다

`aerosol`은 판정에 참여하는 요소라 다음이 전부 같은 집합을 알아야 한다:

| 자리 | 소유 | 빠지면 |
|---|---|---|
| `board_engine.LEVEL_TYPES`(파이썬) | **소유자** | — |
| `frontend/src/lib/boardEngine.js` | 사본 | 서버·프론트 판정이 갈린다(미리보기 ↔ 채점) |
| `validate_chain.BOARD_LEVEL_TYPES`(ai-worker) | 사본 | 그 요소를 둔 board 문항이 품질 게이트에서 **전건 탈락** |
| `AtmosphereBoard` 팔레트·기본값 | 사본 | 슬라이더가 안 그려지거나 기본값이 달라 미리보기가 틀린다 |

⚠️ **이 드리프트는 가상이 아니다.** `BOARD_LEVEL_TYPES`는 ㉣이 `wind`를 들인 뒤에도
`("moisture", "sun")`에 멈춰 있었고(2026-08-20 발견), 그래서 wind 요소를 둔 board
문항은 `lint_seed_items`에서 *"type이 허용값이 아님"*으로 떨어졌다 — 같은 파일의
`PHENOMENON_ENUM` 주석이 **바로 그 함정을 경고해 두었는데** level 축은 놓쳤다.

⚠️ **파이썬 밖 파일을 파싱해 대조하는 것은 이 저장소의 선례다**
(`test_ci_workflow_contract`가 워크플로 YAML을, `test_prompt_spec_parity`가 스펙
문서를 파싱한다). node를 부르지 않는 이유는 **backend 잡에 node가 있다고 보증할 수
없기 때문**이고, 없을 때 조용히 skip되면 아무것도 안 지킨다(CLAUDE.md의 그 함정).
그래서 소스 텍스트를 읽는다 — 그 대신 **파서가 죽으면 운다**(아래 파싱 온전성).
"""
import json
import re
from pathlib import Path

import pytest

from app.services import board_engine as be

REPO_ROOT = Path(__file__).resolve().parents[2]
JS_ENGINE = REPO_ROOT / "frontend" / "src" / "lib" / "boardEngine.js"
JS_BOARD_UI = REPO_ROOT / "frontend" / "src" / "modules" / "board" / "AtmosphereBoard.jsx"
AI_VALIDATE = REPO_ROOT / "ai-worker" / "app" / "chains" / "validate_chain.py"
RULES_PATH = REPO_ROOT / "database" / "seed" / "board_rules.json"

AEROSOL = "aerosol"


# ═══════════════════════════════════════════════════════════════
# 소스 파싱 헬퍼 — 주석을 먼저 벗긴다
# ═══════════════════════════════════════════════════════════════
def _strip_js_comments(src: str) -> str:
    """블록·행 주석 제거.

    🔴 **주석을 안 벗기면 계약이 자기 주석에 걸린다.** 이 저장소의 주석은 종전
    코드를 인용하는 관례가 있어(「종전에는 `(moisture|sun|wind)`가 리터럴로 박혀
    있었다」) 소스를 그대로 훑으면 **주석 한 줄이 단정을 통과시키거나 실패시킨다** —
    코드를 다 지워도 주석만 남으면 초록이 되는 형태의 거짓 계약이다.
    """
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"//[^\n]*", "", src)


def _strip_py_comments(src: str) -> str:
    return re.sub(r"(?m)^\s*#[^\n]*$", "", src)


def _js_string_array(src: str, name: str) -> list[str]:
    """`export const NAME = Object.freeze([...])`의 문자열 리터럴 (순서 보존)."""
    m = re.search(rf"const\s+{name}\s*=\s*Object\.freeze\(\s*\[(.*?)\]", src, re.S)
    if not m:
        return []
    return re.findall(r"'([a-z_]+)'", m.group(1))


def _js_number_consts(src: str) -> dict[str, float]:
    """`export const DEFAULT_X = 40;` 전건."""
    return {
        m.group(1): float(m.group(2))
        for m in re.finditer(r"const\s+(DEFAULT_[A-Z_]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;", src)
    }


def _py_string_tuple(src: str, name: str) -> list[str]:
    m = re.search(rf"^{name}\s*=\s*\((.*?)\)", src, re.S | re.M)
    if not m:
        return []
    return re.findall(r'"([a-z_]+)"', m.group(1))


@pytest.fixture(scope="module")
def js_engine() -> str:
    return _strip_js_comments(JS_ENGINE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def js_board_ui() -> str:
    return _strip_js_comments(JS_BOARD_UI.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def ai_validate() -> str:
    return _strip_py_comments(AI_VALIDATE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rules() -> list[dict]:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


class TestParserSanity:
    """🔴 **파서가 조용히 죽으면 아래 전부가 「빈 집합끼리 같다」로 초록이 된다.**

    `displayLayerParity`가 같은 방어를 갖는다(그 파일의 「파싱 온전성」). 소스 형태가
    바뀌어 정규식이 안 물면 **여기가 먼저** 울어야 한다 — 그러지 않으면 대조 계약이
    아무것도 안 지키면서 통과한다.
    """

    def test_js_엔진에서_level_types를_읽어냈다(self, js_engine):
        got = _js_string_array(js_engine, "LEVEL_TYPES")
        assert got, "JS LEVEL_TYPES 파싱 실패 — 아래 대조 계약이 무력해진다"
        assert "moisture" in got, f"표식 'moisture'가 없다: {got}"

    def test_js_엔진에서_기본값_상수를_읽어냈다(self, js_engine):
        got = _js_number_consts(js_engine)
        assert got, "JS DEFAULT_* 파싱 실패"
        assert "DEFAULT_MOISTURE" in got, f"표식이 없다: {sorted(got)}"

    def test_ai_worker에서_level_types를_읽어냈다(self, ai_validate):
        got = _py_string_tuple(ai_validate, "BOARD_LEVEL_TYPES")
        assert got, "ai-worker BOARD_LEVEL_TYPES 파싱 실패"
        assert "moisture" in got, f"표식이 없다: {got}"

    def test_주석_제거가_실제로_동작한다(self):
        """위 세 파서는 주석을 벗긴 소스를 본다는 전제 위에 선다 — 그 전제를 문다."""
        assert _strip_js_comments("a /* x */ b // y\nc") .split() == ["a", "b", "c"]
        assert "x" not in _strip_py_comments("y = 1\n# x\n")


class TestEngineParity:
    """조절값 요소 집합·기본값이 **네 자리에서 같다**. 소유자는 파이썬 LEVEL_TYPES."""

    def test_aerosol이_조절값이자_배치_가능_요소다(self):
        assert AEROSOL in be.LEVEL_TYPES, "조건으로 쓸 수 없다"
        assert AEROSOL in be.PLACEABLE_TYPES, "보드에 놓을 수 없다"
        assert AEROSOL in be.LEVEL_DEFAULTS, "미배치 존 기본값이 없다 — KeyError로 판정이 죽는다"

    def test_모든_조절값이_배치_가능하고_기본값을_갖는다(self):
        """요소 하나만 반쪽으로 들어오는 것을 막는다(놓을 수는 있는데 조건으로는 못 쓰거나 반대)."""
        for field in be.LEVEL_TYPES:
            assert field in be.PLACEABLE_TYPES, f"{field}: 조건은 되는데 배치가 안 된다"
            assert field in be.LEVEL_DEFAULTS, f"{field}: 기본값 누락"
        assert set(be.LEVEL_DEFAULTS) == set(be.LEVEL_TYPES), "기본값 표에 사문 항목이 있다"

    def test_조건_문법이_조절값_전건을_받고_그_밖은_거부한다(self):
        """`_NUMERIC_RE`가 `LEVEL_TYPES`에서 파생된다는 것을 **동작으로** 확인한다 —
        리터럴로 박혀 있으면 새 요소에서 이 단정이 깨진다."""
        for field in be.LEVEL_TYPES:
            kind, got_field, op, value = be.parse_condition(f"{field}>=50")
            assert (kind, got_field, op, value) == ("numeric", field, ">=", 50.0)
            assert be.parse_condition(f"{field}<=0")[2] == "<="
        for bogus in ("pressure>=50", "temperature<=10", "aerosols>=50"):
            with pytest.raises(be.BoardRulesError):
                be.parse_condition(bogus)

    def test_js_엔진의_조절값_집합이_파이썬과_같다(self, js_engine):
        js = _js_string_array(js_engine, "LEVEL_TYPES")
        assert js == list(be.LEVEL_TYPES), (
            f"조절값 집합이 갈렸다 — JS {js} ↔ 파이썬 {list(be.LEVEL_TYPES)}. "
            "프론트 미리보기와 서버 채점이 다른 판정을 낸다."
        )

    def test_js_엔진의_배치_요소가_기단_전선_더하기_조절값이다(self, js_engine):
        """요구: JS가 아는 배치 요소 집합이 파이썬 `PLACEABLE_TYPES`와 같다.

        스프레드(`...LEVEL_TYPES`)로 파생하는 것이 **옳은 형태**이므로 그 경우를
        먼저 인정한다 — 그러면 조절값을 늘릴 때 이 줄을 고칠 일이 없다. 손으로
        나열했다면 집합이 실제로 같은지 직접 대조한다.
        """
        m = re.search(
            r"const\s+ELEMENT_TYPES\s*=\s*Object\.freeze\(\s*\[(.*?)\]", js_engine, re.S
        )
        assert m, "ELEMENT_TYPES를 못 찾았다 — 파서가 죽었거나 형태가 바뀌었다"
        body = m.group(1)
        literals = set(re.findall(r"'([a-z_]+)'", body))
        if "...LEVEL_TYPES" in body:
            # 조절값은 파생되므로 리터럴에는 **조절값이 아닌 것만** 남아야 한다.
            assert literals == set(be.PLACEABLE_TYPES) - set(be.LEVEL_TYPES), (
                f"스프레드와 리터럴이 겹치거나 빠졌다: 리터럴 {sorted(literals)} ↔ "
                f"조절값 아닌 배치 요소 {sorted(set(be.PLACEABLE_TYPES) - set(be.LEVEL_TYPES))}"
            )
        else:
            assert literals == set(be.PLACEABLE_TYPES), (
                f"배치 요소 집합이 갈렸다 — JS {sorted(literals)} ↔ "
                f"파이썬 {sorted(be.PLACEABLE_TYPES)}"
            )

    def test_js_엔진의_미배치_기본값이_파이썬과_같다(self, js_engine):
        js = _js_number_consts(js_engine)
        for field, expected in be.LEVEL_DEFAULTS.items():
            key = f"DEFAULT_{field.upper()}"
            assert key in js, f"JS에 {key}가 없다 — 미배치 존 판정이 갈린다"
            assert js[key] == float(expected), (
                f"{field} 기본값이 갈렸다 — JS {js[key]} ↔ 파이썬 {expected}"
            )

    def test_js_조건_정규식이_조절값_목록에서_파생된다(self, js_engine):
        """리터럴 하드코딩 **재발 방지**. 이 자리가 두 번 드리프트한 형태다."""
        m = re.search(r"const\s+COND_NUMBER\s*=\s*([^;]+);", js_engine)
        assert m, "COND_NUMBER를 못 찾았다"
        body = m.group(1)
        assert "LEVEL_TYPES" in body, (
            f"COND_NUMBER가 필드 목록을 손으로 들고 있다: {body.strip()} — "
            "조절값을 늘릴 때 여기만 빠지면 「놓을 수는 있는데 조건으로는 못 쓰는」 요소가 된다"
        )

    def test_ai_worker_게이트가_조절값_전건을_받는다(self, ai_validate):
        """빠지면 그 요소를 둔 board 문항이 `lint_seed_items`에서 전건 탈락한다."""
        got = _py_string_tuple(ai_validate, "BOARD_LEVEL_TYPES")
        assert set(got) == set(be.LEVEL_TYPES), (
            f"품질 게이트가 아는 조절값이 다르다 — ai-worker {sorted(got)} ↔ "
            f"엔진 {sorted(be.LEVEL_TYPES)}. 규칙과 문항을 같은 PR에 넣어도 "
            "게이트가 먼저 막는다(2026-08-20에 wind가 실제로 이 상태였다)."
        )

    def test_프론트_팔레트_UI가_조절값_전건을_그린다(self, js_board_ui):
        """슬라이더 종류·힌트 라벨 키·기본값 표 셋 다 조절값을 알아야 한다."""
        for field in be.LEVEL_TYPES:
            assert re.search(rf"type:\s*'{field}'", js_board_ui), (
                f"{field}: levelKnobs에 없다 — 팔레트가 허용해도 슬라이더가 안 그려진다"
            )
            assert re.search(rf"^\s*{field}:", js_board_ui, re.M), (
                f"{field}: HINT_KIND_LABEL·LEVEL_DEFAULTS 중 한 표에 없다"
            )

    def test_보드_검증이_aerosol_요소를_받고_범위를_문다(self):
        ok = {"zones": list(be.ZONES), "elements": [{"type": AEROSOL, "level": 80, "zone": 1}]}
        be.validate_board(ok)  # 위반 시 BoardValidationError
        for bad_level in (-1, 101):
            with pytest.raises(be.BoardValidationError):
                be.validate_board(
                    {"zones": list(be.ZONES),
                     "elements": [{"type": AEROSOL, "level": bad_level, "zone": 1}]}
                )
        with pytest.raises(be.BoardValidationError):
            be.validate_board(
                {"zones": list(be.ZONES),
                 "elements": [{"type": AEROSOL, "level": 10, "zone": 0},
                              {"type": AEROSOL, "level": 20, "zone": 0}]}
            )


class TestAerosolDefaultIsZero:
    """🔴 **기본값 0은 편의가 아니라 계약이다.**

    `wind`의 기본값 20 때문에 `wind<=20` 형태는 **미배치 존이 저절로 충족**해 요소가
    장식이 된다 — 그래서 태풍·열대야가 `wind<=15`를 쓴다. `aerosol>=N`(N>0)은 기본값이
    0이면 그 함정이 **원천적으로** 없다. 값 자체를 못박는 단정과, 그 값이 지키려던
    **성질**을 못박는 단정을 함께 둔다(값만 박으면 왜 그런지가 사라진다).
    """

    def test_기본값이_0이다(self):
        assert be.DEFAULT_AEROSOL == 0
        assert be.LEVEL_DEFAULTS[AEROSOL] == 0

    def test_미배치_존에서는_aerosol_상한_조건이_성립하지_않는다(self, rules):
        """요구: 「에어로졸이 있다」를 뜻하는 조건은 놓지 않은 존에서 참이 될 수 없다."""
        empty = {"zones": list(be.ZONES), "elements": []}
        state = be.zone_states(empty)[0]
        for rule in rules:
            for cond in rule["when"]:
                parsed = be.parse_condition(cond)
                if parsed[0] == "numeric" and parsed[1] == AEROSOL and parsed[2] == ">=":
                    assert not be._condition_holds(parsed, state), (
                        f"{rule['id']}의 {cond!r}가 **미배치 존 기본값으로 충족된다** — "
                        "에어로졸을 놓지 않아도 조건이 참이라 요소가 장식이 된다"
                    )


class TestChemistryAxisExists:
    """화학 축이 **사문이 아니다**. 요소만 늘리고 규칙이 없으면 놓아도 판정이 안 바뀐다
    (기단 yangtze·okhotsk가 정확히 그 상태였다 — R13 발견)."""

    def _aerosol_rules(self, rules):
        return [r for r in rules if any(AEROSOL in c for c in r["when"])]

    def test_aerosol을_참조하는_규칙이_있다(self, rules):
        assert self._aerosol_rules(rules), (
            "aerosol을 조건으로 쓰는 규칙이 없다 — 보드에 놓아도 판정이 바뀌지 않는 사문 요소다"
        )

    def test_aerosol_규칙의_결과는_aerosol_없이_도달할_수_없다(self, rules):
        """🔴 **이 단정이 「요소가 장식이 되는 것」을 직접 막는다.**

        `check_goals`는 rule_id를 보지 않고 `(phenomenon, cloud)`만 본다. 그래서 같은
        결과 쌍을 **에어로졸을 요구하지 않는** 규칙이 낼 수 있으면, 학습자는 그 요소를
        건드리지 않고도 목표를 채운다 — 가르치려는 것을 무시해도 통과하는 역전이다
        (`board_rules.json`의 severe_storm 계열 주석이 적어 둔 그 실패 형태).
        """
        for rule in self._aerosol_rules(rules):
            mine = (rule["then"]["phenomenon"], rule["then"].get("cloud"))
            for other in rules:
                if other["id"] == rule["id"]:
                    continue
                pair = (other["then"]["phenomenon"], other["then"].get("cloud"))
                if pair != mine:
                    continue
                assert any(AEROSOL in c for c in other["when"]), (
                    f"{other['id']}가 {rule['id']}와 같은 결과 {mine}를 내면서 "
                    "에어로졸을 요구하지 않는다 — 그 규칙이 지름길이 되어 "
                    "에어로졸을 놓지 않고도 목표를 채울 수 있다"
                )

    def test_aerosol_규칙은_자기_조건으로_실제로_발화하고_요소를_빼면_결과가_바뀐다(self, rules):
        """조건에서 보드를 **기계적으로 합성**해 두 가지를 함께 문다:
        ⓐ 그 배치에서 **그 규칙이** 적용된다(낮은 조건 수 규칙이 가로채지 않는다)
        ⓑ 에어로졸 요소만 빼면 결과 쌍이 **달라진다**(요소가 판정에 기여한다)

        규칙마다 손으로 벡터를 쓰지 않으므로 **새 aerosol 규칙이 자동으로 검사된다.**
        """
        for rule in self._aerosol_rules(rules):
            elements: list[dict] = []
            for cond in rule["when"]:
                parsed = be.parse_condition(cond)
                if parsed[0] == "presence":
                    _, etype, subtype = parsed
                    elements.append({"type": etype, "subtype": subtype, "zone": 0})
                else:
                    _, field, _op, value = parsed
                    # 임계 그 자체를 놓는다 — >=·<= 가 포함 관계이므로 경계도 성립해야 한다
                    elements.append({"type": field, "level": value, "zone": 0})

            board = {"zones": list(be.ZONES), "elements": elements}
            applied = be.evaluate(board, rules)[0]
            assert applied["rule_id"] == rule["id"], (
                f"{rule['id']}의 조건을 그대로 놓았는데 적용된 규칙이 "
                f"{applied['rule_id']}다 — 다른 규칙이 이 판정을 가로챈다"
            )

            without = {
                "zones": list(be.ZONES),
                "elements": [e for e in elements if e["type"] != AEROSOL],
            }
            bare = be.evaluate(without, rules)[0]
            assert (bare["phenomenon"], bare["cloud"]) != (
                applied["phenomenon"],
                applied["cloud"],
            ), (
                f"{rule['id']}: 에어로졸 요소를 빼도 결과가 "
                f"{(bare['phenomenon'], bare['cloud'])}로 같다 — "
                "그 요소를 놓지 않고도 목표를 채울 수 있으므로 장식이다"
            )

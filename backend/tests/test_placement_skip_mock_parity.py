"""배치고사 「모르겠어요」 — 목↔프론트↔서버 **센티널 정합** 계약 (2026-08-19).

`test_placement_skip.py`가 **서버 쪽 행위**(스킵은 오답 · 통계 미집계 · 두 경로
패리티)를 소유한다면, 이 파일은 **와이어 값이 세 자리에서 같은가**와 **목이 그
규칙의 뼈대를 갖고 있는가**를 소유한다. 겹치는 단정은 두지 않는다.

## 왜 이 축이 따로 필요한가

「수리가 도착하지 않는다」의 네 형태 중 가장 나쁜 것이 **목이 서버를 안 따라와
화면에 안 닿는다**다. 프론트 스모크가 목 위에서 도는 탓에, 목이 낡으면 스모크가
**결함 상태를 계약으로 굳힌다** — 다른 셋은 「안 닿았다」에서 멈추지만 이것은
**틀린 상태를 옳다고 증명한다.**

그리고 목에는 *"서버와 같다"*는 **주석이 이미 있었고 그래도 갈렸다**(CO-J-9:
에너지 상수 3종이 리터럴 사본으로 남아 대조가 0이었다). **주석은 계약이 아니다.**

실제로 이 기능에서 갈림이 **선재했다**: 목 `gradeSessionItem`의 slider가
`Number('')` → **0**이라 `|0 - 정답| <= 허용오차`가 성립해, 배치고사 2번 문항
(정답 `7` · 허용오차 10)에서 **빈 답이 「정답」**이었다. 서버 `_grade_slider`는
`float('')` → ValueError → 오답이다. 센티널이 빈 문자열이 **아닌** 이유가 이것이고,
그래서 이 파일은 그 갈림이 되살아나는 것도 함께 문다.

## 무엇을 물고 무엇을 안 무는가 (의도적으로 가른다)

무는 것
  · **값**: 센티널 리터럴이 정의된 **모든 자리에서 동일**한가(서버·프론트·목)
  · **노출**: 목이 `__mockPolicy()`로 그 값을 내보내는가, 그리고 리터럴 사본이
    아니라 **상수 식별자**를 내보내는가(사본을 두면 계약이 자기 자신을 대조한다)
  · **뼈대**: 목의 스킵 판정이 **유형 분기보다 앞**에 있는가(서버가 `grade()`
    한 줄로 못박은 것과 같은 위치) · 목 slider가 **파싱 성공을 먼저 보는가**
  · **뼈대**: 목의 배치 θ 근사가 스킵을 **분모(n)에는 세고 분자(correct)에는
    안 세는가** — 「스킵은 안 푼 것이 아니라 틀린 것」의 목 쪽 표현

무는 것이 **아닌** 것 (사유를 함께 남긴다 — 못 지킬 단정을 넣으면 다음 사람이
계약을 지운다)
  · **θ 값의 동치**: 서버는 IRT EAP 추정이고 목은 `(정답률 - 0.5) * 2.4` 선형
    근사다. **의도된 근사**라 같아질 수 없다 — 「목 θ가 서버와 같아야 한다」로
    검증하면 이 계약은 첫날부터 거짓이 된다
  · **선해제 유닛 수의 동치**: 목은 `평균θ > 0 → 1개 · >= 0.6 → 2개`라는 결정적
    근사이고 서버는 θ 파생 규칙이다. 방향(스킵이 늘면 열리는 유닛이 줄어든다)만
    프론트 스모크가 HTTP로 본다
  · **채점기 알고리즘의 동치**: 언어가 다르다(`float()` ↔ `Number()`,
    set 비교 ↔ Map 비교). 유형별 구현은 각자 소유하고, 여기서는 **스킵·빈 답이
    양쪽에서 오답인가**라는 갈림 지점만 본다
  · **목 라우트의 런타임 행위**: 목은 라우트 핸들러를 export하지 않는다. 「스킵
    제출이 오답으로 채점되고 진척이 오른다」는 HTTP 왕복이라
    `frontend/tests/placementEntry.smoke.test.mjs`가 소유한다(중복 단정 금지)
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import answer_service

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"

# 센티널 리터럴을 **정의하는** 자리를 찾을 범위. 테스트 디렉터리는 넣지 않는다 —
# 테스트는 상수를 import해 쓰므로 정의 자리가 아니고, 넣으면 기대값 사본을
# 정의로 오인해 계약이 자기 자신을 대조한다.
SENTINEL_DEF_ROOTS = (
    REPO_ROOT / "backend" / "app",
    REPO_ROOT / "frontend" / "src",
    REPO_ROOT / "frontend" / "mock",
)

# `PLACEMENT_SKIP_SENTINEL = "__skip__"` · `MOCK_PLACEMENT_SKIP_SENTINEL = '__skip__'` ·
# (Settings 필드가 될 경우) `PLACEMENT_SKIP_SENTINEL: str = "__skip__"` 전부 잡는다.
#
# ⚠️ 타입 주석 형태를 함께 잡는 것이 중요하다 — 이 값이 나중에 `Settings` 필드로
# 옮겨가면 `^NAME\s*=` 만 보는 정규식은 **아무것도 못 찾아** 계약이 「배선이
# 사라졌다」고 엉뚱한 이유로 죽는다.
SENTINEL_DEF_RE = re.compile(
    r"""(?:^|\s)(?:export\s+)?(?:const\s+|let\s+|var\s+)?"""
    r"""((?:MOCK_)?PLACEMENT_SKIP_SENTINEL)(?:\s*:\s*\w+)?\s*=\s*(?!=)['"]([^'"]*)['"]""",
    re.M,
)

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(
    NODE is None, reason="node 미설치 — 목 실값 대조 불가 (소스 계약은 계속 돈다)"
)


def strip_js_comments(src: str) -> str:
    """줄 전체가 주석인 줄을 지운다 — **뼈대 단정은 코드만 봐야 한다.**

    ⚠️ 이 함수는 역검증에서 나왔다. `test_목_slider가_파싱_성공을_먼저_본다`의
    `Number.isFinite` 단정이, 그 코드를 지운 변이에서도 **초록**이었다 — 같은 줄을
    설명하는 **주석**에 그 문자열이 들어 있었기 때문이다(같은 파일의 경위 주석은
    이 저장소의 관례라 앞으로도 계속 늘어난다). 주석으로 만족되는 단정은 계약이
    아니라 장식이고, 이 파일의 첫 문장이 바로 *"주석은 계약이 아니다"*였다.

    문자열 안의 `//`(URL 등)를 깨지 않도록 **줄 머리가 주석인 줄만** 지운다 —
    코드 뒤에 붙은 꼬리 주석은 남는다(단정 대상이 그 앞 코드라 무해하다).
    """
    return "\n".join(
        line for line in src.splitlines() if not re.match(r"\s*(//|/\*|\*)", line)
    )


def _iter_source_files():
    for root in SENTINEL_DEF_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix in {".py", ".js", ".jsx", ".mjs"} and path.is_file():
                yield path


@pytest.fixture(scope="module")
def sentinel_definitions() -> dict[str, str]:
    """센티널을 **리터럴로 정의하는** 모든 자리 → {상대경로:줄: 값}."""
    found: dict[str, str] = {}
    for path in _iter_source_files():
        text = path.read_text(encoding="utf-8")
        for match in SENTINEL_DEF_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found[f"{path.relative_to(REPO_ROOT)}:{line}"] = match.group(2)
    return found


@pytest.fixture(scope="module")
def policy() -> dict:
    """목 모듈을 node로 import해 정책 실값을 읽는다 (읽기 전용).

    `test_r13_mock_policy_parity.py`의 하네스를 그대로 답습한다 — 서브프로세스
    배선을 다시 짜지 않는다.
    """
    if NODE is None:  # pragma: no cover - skip 마커가 먼저 걸린다
        pytest.skip("node 미설치")
    code = (
        f"const m = await import({str(MOCK_PATH.as_uri())!r});"
        "process.stdout.write(JSON.stringify(m.__mockPolicy()));"
    )
    proc = subprocess.run(
        [NODE, "--input-type=module", "-e", code],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=MOCK_PATH.parent,
    )
    assert proc.returncode == 0, (
        "목 모듈 import 실패 — __mockPolicy export가 사라졌거나 목이 깨졌다:\n"
        f"{proc.stderr[-2000:]}"
    )
    return json.loads(proc.stdout)


@pytest.fixture(scope="module")
def mock_src() -> str:
    return MOCK_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def mock_code(mock_src: str) -> str:
    """주석을 뺀 목 소스 — 뼈대 단정은 코드만 본다(`strip_js_comments` 참조)."""
    return strip_js_comments(mock_src)


@pytest.fixture(scope="module")
def grade_fn(mock_src: str) -> str:
    """목 `gradeSessionItem` 본문 — 뼈대 단정의 대상. **주석은 제거한다.**"""
    fn = re.search(r"function gradeSessionItem\(.*?\n\}\n", mock_src, re.S)
    assert fn, (
        "목의 gradeSessionItem을 못 찾았다 — 함수 이름이 바뀌었으면 이 계약을 "
        "갱신할 것(지우지 말 것: 스킵이 목에서 오답인지를 여기서만 본다)"
    )
    return strip_js_comments(fn.group(0))


class TestSentinelValueParity:
    """🔴 **값**은 정확히 대조한다 — 세 자리가 같은 리터럴인가.

    와이어 값이 갈리면 증상이 조용하다: 프론트가 보낸 스킵을 서버가 **평범한
    오답 문자열**로 채점하므로 여전히 `is_correct=false`가 나온다. 즉
    **행위 테스트로는 안 잡히고**(우연히 같은 결과) 통계 제외·피드백 분기 같은
    스킵 전용 처리만 조용히 죽는다. 그래서 값 대조가 따로 필요하다.
    """

    def test_센티널을_정의하는_자리가_셋_다_있다(self, sentinel_definitions):
        by_area = {"backend/app": [], "frontend/src": [], "frontend/mock": []}
        for where in sentinel_definitions:
            for area in by_area:
                if where.startswith(area):
                    by_area[area].append(where)
        missing = [area for area, hits in by_area.items() if not hits]
        assert not missing, (
            f"센티널 정의가 없는 영역: {missing} — 와이어 형식은 세 자리(서버 상수·"
            f"프론트·목)가 같은 리터럴을 쓰는 것이 전부다. 찾은 자리: "
            f"{sorted(sentinel_definitions)}"
        )

    def test_정의된_모든_자리의_값이_같다(self, sentinel_definitions):
        values = set(sentinel_definitions.values())
        assert len(values) == 1, (
            "센티널 값이 자리마다 다르다 — 프론트가 보낸 스킵을 서버가 평범한 "
            "오답으로 처리하고 스킵 전용 분기(통계 제외 등)가 조용히 죽는다: "
            f"{sentinel_definitions}"
        )

    def test_그_값의_소유자는_서버_상수다(self, sentinel_definitions):
        """값의 **단일 소유자**는 `answer_service.PLACEMENT_SKIP_SENTINEL`이다.

        여기에 기대 리터럴(`"__skip__"`)을 적지 않는다 — 적으면 이 계약이 서버가
        아니라 자기 사본을 대조한다. 서버 값 자체를 못박는 것은
        `test_placement_skip.py::TestSentinelContract`의 몫이다.
        """
        owner = answer_service.PLACEMENT_SKIP_SENTINEL
        wrong = {k: v for k, v in sentinel_definitions.items() if v != owner}
        assert not wrong, (
            f"서버 상수({owner!r})와 다른 사본이 있다: {wrong}"
        )

    @needs_node
    def test_목이_내보내는_실값이_서버_상수와_같다(self, policy):
        """소스에 적힌 것과 목이 **실제로 쓰는 값**은 다를 수 있다.

        위 소스 대조는 「정의가 같은가」를 보고, 이것은 「그 정의가 실제로 정책으로
        나가는가」를 본다 — 상수를 선언해 두고 채점에서는 다른 리터럴을 쓰면 소스
        대조만으로는 초록이다(결함 ④가 정확히 그 모양이었다: 배열 크기를 상수로
        신고하면서 배열은 옛 크기에 멈춰 있었다).
        """
        assert "placement_skip_sentinel" in policy, (
            "__mockPolicy()가 placement_skip_sentinel을 안 내보낸다 — 목이 무슨 "
            "값을 쓰는지 계약이 볼 수 없다"
        )
        assert policy["placement_skip_sentinel"] == answer_service.PLACEMENT_SKIP_SENTINEL

    def test_목_정책이_리터럴_사본이_아니라_상수_식별자를_내보낸다(self, mock_code):
        """`test_r13_mock_policy_parity`의 같은 단정을 답습한다 (CO-J-9).

        값을 `__mockPolicy()` 안에 다시 적으면 채점이 쓰는 상수와 신고값이 갈릴
        수 있고, 그때 위 실값 대조가 **신고값만 보고 초록**을 낸다.
        """
        block = re.search(
            r"export const __mockPolicy = \(\) => \(\{(.*?)\n\}\);", mock_code, re.S
        )
        assert block, "__mockPolicy 본문을 못 찾았다 — 이 계약을 갱신할 것"
        assert "placement_skip_sentinel: MOCK_PLACEMENT_SKIP_SENTINEL" in block.group(1), (
            "센티널을 리터럴 사본으로 신고하고 있다 — 상수 식별자를 내보낼 것"
        )

    def test_센티널은_비어_있지_않다(self, sentinel_definitions):
        """빈 문자열은 **금지**다 — 이 기능의 와이어 형식을 정한 이유 자체다.

        목 slider가 `Number('')` → 0으로 접어 정답값이 허용오차 안인 문항을
        **정답**으로 판정한다(배치고사 2번: 정답 7 · 허용오차 10). 서버는
        ValueError로 오답이다 — 목과 서버가 **정반대** 판정을 내는 자리다.
        """
        blank = {k: v for k, v in sentinel_definitions.items() if not v or v.strip() != v}
        assert not blank, (
            f"빈 문자열·공백 패딩 센티널: {blank} — 빈 답은 목과 서버가 정반대로 "
            "채점한다(목 slider Number('')=0 ↔ 서버 float('') ValueError)"
        )


class TestMockRuleSkeleton:
    """🔴 **알고리즘 동치는 주장하지 않고**, 규칙의 뼈대가 목에 있는지만 구조로 본다.

    목의 채점은 JS이고 서버는 파이썬이라 구현 동치는 계약이 될 수 없다. 대신
    「스킵은 유형과 무관하게 오답」이라는 **규칙의 위치**를 본다 — 서버는
    `answer_service.grade()` 한 줄에서 유형 위임 **앞**에 못박았다.
    """

    def test_목도_스킵을_유형_분기보다_먼저_떨군다(self, grade_fn):
        """위치가 계약이다 — 유형별 분기의 **부수효과**로만 성립하면 안 된다.

        센티널은 6유형 채점기에서 우연히도 전부 오답이다(파싱 실패 · 문자열
        불일치). 그 우연에 기대면 두 가지로 깨진다:
          ① 채점기를 손대면 조용히 뒤집힌다 — 붉어지는 테스트가 없다
          ② `correct_answer`가 센티널과 같은 문항이 생기면 문자열 일치 분기가
             스킵을 **정답**으로 판정한다(그런 문항이 없다는 것은 계약이 아니라
             오늘의 상태다). 서버 `grade()` 독스트링이 같은 근거를 적었다.

        `__mockPolicy()`로는 잴 수 없는 **순서**라 소스로 문다
        (`test_r13_mock_policy_parity`의 재사용↔구름게이트 순서 단정과 같은 방법).
        """
        assert "MOCK_PLACEMENT_SKIP_SENTINEL" in grade_fn, (
            "목 채점이 스킵 센티널을 아예 모른다 — 스킵 판정이 유형별 채점의 "
            "부수효과로만 성립하면 채점기 변경에 조용히 뒤집힌다"
        )
        guard_at = grade_fn.index("MOCK_PLACEMENT_SKIP_SENTINEL")
        dispatch_at = grade_fn.index("item.question_type")
        assert guard_at < dispatch_at, (
            "목이 유형 분기 **뒤**에서 스킵을 본다 — 서버는 grade()가 유형 위임 "
            "앞에서 못박는다(정답이 센티널과 같은 문항에서 판정이 갈린다)"
        )

    def test_목_slider가_파싱_성공을_먼저_본다(self, grade_fn):
        """선재 갈림의 회귀 가드 — 이것이 센티널 형식을 정한 실측 근거다.

        서버 `_grade_slider`는 `float()` 실패를 오답으로 떨구는데, JS
        `Number('')`는 **0**이라 목만 「정답」이 됐다. `Number.isFinite`만으로는
        빈 문자열을 못 잡으므로(`Number.isFinite(Number('')) === true`) 빈 문자열
        검사가 **함께** 있어야 한다 — 한쪽만 두면 결함이 절반 남는다.
        """
        slider = re.search(
            r"if \(item\.question_type === 'slider'\) \{(.*?)\n  \}", grade_fn, re.S
        )
        assert slider, "목의 slider 분기를 못 찾았다 — 이 계약을 갱신할 것"
        body = slider.group(1)
        assert "Number.isFinite" in body, (
            "목 slider가 숫자 파싱 성공 여부를 안 본다 — 서버 _grade_slider는 "
            "float() ValueError를 오답으로 떨군다"
        )
        assert "answer === ''" in body, (
            "빈 문자열 검사가 없다 — Number.isFinite(Number(''))는 true라서 "
            "isFinite만으로는 빈 답이 그대로 통과한다(정답값 <= 허용오차인 문항이 "
            "「정답」이 된다)"
        )

    def test_목_배치_θ가_스킵을_분모에는_세고_분자에는_안_센다(self, mock_code):
        """「스킵은 안 푼 것이 아니라 **틀린 것**」의 목 쪽 표현.

        ⚠️ **θ 값의 동치는 주장하지 않는다** — 서버는 IRT EAP이고 목은
        `(정답률 - 0.5) * 2.4` 선형 근사다(의도된 근사). 무는 것은 뼈대 하나:
        응답이 있으면 `n`은 무조건 오르고 `correct`는 `is_correct`일 때만 오른다.
        이 뼈대가 깨지면(예: 스킵을 `continue`로 건너뛰면) 스킵한 문항이
        **안 본 문항**이 되어 θ가 안 떨어지고, 배치고사가 스킵을 보상한다.
        """
        block = re.search(
            r"const byConcept = new Map\(\);(.*?)\n      \}", mock_code, re.S
        )
        assert block, "목의 배치 θ 집계 루프를 못 찾았다 — 이 계약을 갱신할 것"
        body = block.group(1)
        assert "agg.n += 1" in body, "개념별 분모(n) 증가를 못 찾았다"
        assert "agg.correct += 1" in body, "개념별 분자(correct) 증가를 못 찾았다"
        # 분모 증가가 is_correct 게이트보다 **앞**이라야 무조건이다.
        #
        # ⚠️ 여기는 처음에 `^\s*agg\.n \+= 1;`(줄 머리 정규식)이었고 **역검증에서
        # 뚫렸다**: `agg.n += 1;`을 `if (r.is_correct)` 블록 **안**으로 옮겨도
        # `\s*`가 늘어난 들여쓰기를 그대로 먹어 초록이었다. 들여쓰기는 조건부인지를
        # 말해 주지 않는다 — **위치**로 봐야 한다(구름 게이트 순서 단정과 같은 방법).
        n_at = body.index("agg.n += 1")
        gate_at = body.index("if (r.is_correct)")
        assert n_at < gate_at, (
            "분모(n) 증가가 is_correct 게이트 **안**으로 들어갔다 — 스킵·오답이 "
            "표본에서 빠져 「안 본 문항」이 되고, θ가 안 떨어져 배치고사가 스킵을 "
            "보상한다(전건 스킵이면 0/0 = NaN까지 간다)"
        )
        # 스킵을 건너뛰는 분기가 없다 — 있으면 위 두 단정이 초록인 채 뼈대가 깨진다
        assert "continue" in body and body.count("continue") == 1, (
            "집계 루프에 continue가 하나(응답 없는 문항 제외)를 넘는다 — 스킵을 "
            "건너뛰는 분기가 들어왔는지 확인할 것"
        )

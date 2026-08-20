"""목↔서버 **정책** 실값 대조 (R13 CO-J-9 / CO-A6 — 2026-08-08).

`test_r10_mock_parity_contract.py`가 "목이 내보내는 **페이로드**"를 대조한다면,
이 파일은 "목이 그 페이로드를 만들 때 쓰는 **정책·상수**"를 대조한다.

감사 실측(CO-J-9): 목 패리티가 4도메인 중 **배합 하나만** 보고 있었고
- **에너지 상수 3종**은 목이 하드코딩 리터럴로 복사한 채 대조가 **0**이었다.
  서버 `Settings.CLOUD_*`를 env로 조정하면 목은 조용히 옛 값으로 남는다.
- **왕관은 이미 행위가 갈라져 있었다**: 서버는 유닛 세션에 `grant_crown=False`
  (§2.10 소유권 이전)인데 목은 왕관을 줬고, 판정 범위도 서버는 진도 블록
  5문항인데 목은 15문항 전건이었다(CO-A6). 목 위 스모크는 전부 초록이었다.

방법은 R10 계약과 같다 — 목이 `__mockPolicy()`로 노출하는 **실값**을 node로 읽어
서버 실값과 비교한다. **여기에 기대값 사본을 쓰지 않는다**: 사본을 두면 계약이
자기 자신을 대조하게 되고, 그것이 애초에 J-9가 생긴 방식이다.

node가 없는 환경에서는 실값 대조가 skip되므로, python만으로 도는 **소스 계약**을
함께 둔다(목이 정책을 노출하는가 · 서버 코드가 그 정책대로 쓰여 있는가).
"""
import json
import re
import shutil
import subprocess
from itertools import permutations
from pathlib import Path

import pytest

from app.core.config import settings
from app.schemas.auth import LevelGroup
from app.services import session_service

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
SESSION_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "session.py"
AUTH_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
WEATHERBRAIN_SERVICE = (
    REPO_ROOT / "backend" / "app" / "services" / "weatherbrain_service.py"
)

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(
    NODE is None, reason="node 미설치 — 목 실값 대조 불가 (소스 계약은 계속 돈다)"
)


@pytest.fixture(scope="module")
def policy() -> dict:
    """목 모듈을 node로 import해 정책 실값을 읽는다 (읽기 전용)."""
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
def session_src() -> str:
    return SESSION_ROUTER.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def mock_src() -> str:
    return MOCK_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def auth_src() -> str:
    return AUTH_ROUTER.read_text(encoding="utf-8")


def _fn_body_of(src: str, name: str) -> str:
    """`function <name>() {` 부터 열 0의 `}` 까지 — **코드부만** 돌려준다.

    🔴 **주석을 반드시 걷는다.** 이 저장소는 문자열 존재로 정책을 재는 검사가
    **주석 하나에 속은** 전례를 갖고 있다(`grant_crown=False`가 경위 설명 주석에
    남아 있어 계약이 초록이었다). 이 파일이 무는 목 주석에는 판정 문언이 그대로
    인용돼 있어서, 걷지 않으면 **설명이 곧 구현**으로 읽힌다.
    """
    m = re.search(rf"function {re.escape(name)}\(\)\s*\{{(.*?)\n\}}", src, re.S)
    assert m, f"목에서 {name}를 못 찾았다 — 이름이 바뀌었나(이 계약을 갱신할 것)"
    no_block = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
    return "\n".join(
        line for line in no_block.splitlines() if not line.lstrip().startswith("//")
    )


def _strip_js_comments(body: str) -> str:
    """`_fn_body_of`와 **같은 이유**로 주석을 걷는다(그 독스트링이 경위를 소유한다)."""
    no_block = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    return "\n".join(
        line for line in no_block.splitlines() if not line.lstrip().startswith("//")
    )


def _route_body_of(src: str, route: str) -> str:
    """목 `routes` 표의 한 핸들러 몸통 — **코드부만** 돌려준다.

    `_fn_body_of`가 `function name()` 선언만 찾으므로 화살표 핸들러
    (`'PATCH /auth/me': (body) => { … }`)는 그 정규식으로 잡히지 않는다.
    중괄호를 세어 끝을 찾는다 — 문자열 안 중괄호에 속을 수 있으나, 이 핸들러들은
    한글 문구를 큰따옴표 없이 담고 중괄호를 문자열에 넣지 않는다(넣게 되면 이
    헬퍼가 먼저 터지므로 조용히 틀리지는 않는다).

    🔴 **주석을 반드시 걷는다.** 이 계약이 무는 핸들러 주석에는 재파종 규칙과
    함수 이름이 그대로 인용돼 있어서, 걷지 않으면 **설명이 곧 구현**으로 읽힌다
    (이 저장소가 `grant_crown=False`에서 실제로 속은 형태).
    """
    head = re.search(rf"['\"]{re.escape(route)}['\"]\s*:\s*\([^)]*\)\s*=>\s*\{{", src)
    assert head, f"목 routes에서 `{route}` 핸들러를 못 찾았다 — 모양이 바뀌었나"
    depth, i = 0, head.end() - 1
    for i in range(head.end() - 1, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
    return _strip_js_comments(src[head.end() : i])


def _py_fn_body(src: str, name: str) -> str:
    """파이썬 함수 몸통 — **독스트링과 `#` 주석을 걷은** 코드부만.

    JS 쪽과 같은 이유다: 서버 `update_me`의 독스트링에는 판정 문언이 인용될
    것이므로, 걷지 않으면 「설명이 곧 구현」이 된다.
    """
    m = re.search(
        rf"^(?:async )?def {re.escape(name)}\(.*?(?=\n@|\n(?:async )?def |\Z)",
        src,
        re.S | re.M,
    )
    assert m, f"서버에서 {name}를 못 찾았다 — 이름이 바뀌었나(이 계약을 갱신할 것)"
    no_doc = re.sub(r'"""(?:.|\n)*?"""', "", m.group(0))
    return "\n".join(
        line.split("#")[0] for line in no_doc.splitlines()
    )


# ═══════════════════════════════════════════════════════════════
# 학령 재신고 θ 재파종 표본의 **갈래 밟기** — 모듈 수준 헬퍼 (2026-08-20)
# ═══════════════════════════════════════════════════════════════
#
# 🔴 위 `_assert_samples_tread_branches`와 **같은 이유로 밖에 있다**: 역검증이
# 「표본에서 갈림 표본을 빼면 이 단정이 우는가」를 **목 파일을 임시 편집하지 않고**
# 확인할 수 있어야 한다(공유 워크트리 — 남의 측정을 거짓으로 만들지 않는다).
#
# 왜 필요한가: 재파종은 **답이 같아 보이기 쉬운** 규칙이다. 목이 「전건 갈아타기」로
# 잘못 구현돼 있어도, 표본의 측정된 행 θ가 마침 목표 사전값 근처면 답이 안 갈린다 —
# 2026-08-20에 `palette` 갈래가 정확히 그렇게 공허하게 초록이었다.
def _assert_reseed_samples_tread_branches(
    samples: list, priors: dict, default_b: float
) -> None:
    assert samples, "목이 재파종 표본(`reseed_samples`)을 안 내보낸다"

    def target(case):
        return priors.get(case["to"], default_b)

    # ⑴ **측정된 행이 목표 사전값과 멀리 있어야** 「전건 덮기」 결함이 답을 바꾼다.
    guarded = [
        r
        for s in samples
        for r in s["rows"]
        if r["num_responses"] > 0 and abs(float(r["theta"]) - target(s)) > 0.5
    ]
    assert guarded, (
        "표본에 **측정된 행(n>0)이 목표 사전값과 뚜렷이 다른** 경우가 없다 — "
        "그러면 재파종이 측정분까지 덮어도 답이 안 갈려 이 계약이 공허하게 초록이다"
    )
    # ⑵ **미측정 행이 목표 사전값과 달라야** 「재파종을 아예 안 한다」가 답을 바꾼다.
    moved = [
        r
        for s in samples
        for r in s["rows"]
        if r["num_responses"] == 0 and abs(float(r["theta"]) - target(s)) > 0.5
    ]
    assert moved, (
        "표본에 **미측정 행(n=0)이 목표 사전값과 뚜렷이 다른** 경우가 없다 — "
        "그러면 재파종을 안 해도 답이 같아 「천장이 움직인다」가 검사되지 않는다"
    )
    # ⑶ **n=1 경계** — 가드를 `n > 1`로 잘못 쓰면 여기서만 갈린다.
    assert any(r["num_responses"] == 1 for s in samples for r in s["rows"]), (
        "표본에 `num_responses == 1`인 행이 없다 — 「측정됐다」의 경계라, 이 갈래를 "
        "안 밟으면 가드가 한 칸 밀려도(n>1) 조용히 통과한다"
    )
    # ⑷ **사전표에 없는 밴드** — 기본값 폴백 갈래.
    assert any(s["to"] not in priors for s in samples), (
        "표본이 **알 수 없는 밴드** 갈래를 안 밟는다 — `?? DEFAULT_ITEM_B` 폴백이 "
        "갈려도 아무도 안 운다"
    )
    # ⑸ 목표 사전값이 **서로 다른 밴드 둘 이상** — 한 밴드만 밟으면 목이 표를
    #    안 읽고 상수를 돌려줘도 통과한다.
    assert len({target(s) for s in samples}) >= 2, (
        "표본의 목표 사전값이 한 종류뿐이다 — 목이 밴드 표를 읽지 않고 상수를 "
        "심어도 답이 같다"
    )


# ═══════════════════════════════════════════════════════════════
# 보드 진행 순서 표본의 **갈래 밟기** — 모듈 수준 헬퍼 (2026-08-20 판정 4)
# ═══════════════════════════════════════════════════════════════
#
# 🔴 **테스트 안에 있던 것을 밖으로 뺐다**(단정은 한 줄도 지우지 않았고 늘렸다).
# 이유는 역검증이다: 「표본에서 갈림 표본을 빼면 이 단정이 우는가」를 확인하려면
# **목 파일을 임시로 편집하지 않고** 표본만 걸러 이 함수에 넘길 수 있어야 한다
# (같은 날 신설된 역검증 규칙 — 공유 워크트리에서 남의 측정을 거짓으로 만들지 않는다).
#
# 왜 이 단정들이 있나: **갈래를 밟는 것만으로는 부족하다.** 갈리면 답이 실제로
# 달라지는 표본이어야 한다 — 2026-08-20에 `palette` 갈래가 2개짜리만 남아
# `len(palette) >= 3` 가지를 지워도 초록이었고, 같은 함정을 하루에 세 번 밟았다.


def _is_bool(v) -> bool:
    """⚠️ 파이썬에서 `isinstance(True, int)`는 참이므로 bool을 **먼저** 가른다."""
    return isinstance(v, bool)


def _is_int(v) -> bool:
    return not _is_bool(v) and isinstance(v, int)


def _is_real_float(v) -> bool:
    """비정수 실수만 본다 — `3.0`은 JSON을 건너며 int 3이 되어 구분이 없다
    (JS에 int/float 구분 자체가 없다). 그 한계는 목 주석이 소유한다."""
    return isinstance(v, float) and not v.is_integer()


def _orders_of(case) -> list:
    """2차 키 축(`template_json.board_order`)의 값들."""
    return [(t or {}).get("board_order") for t in case["templates"]]


def _tiers_of(case) -> list:
    """1차 키 축(**컬럼** `knowledge_level`)의 값들.

    ⚠️ 층은 `template_json` 안이 아니라 속성이다 — 서버 `board_tier`가
    `getattr(item, "knowledge_level")`을 읽는다. 목이 `tiers`를 안 실어 보내는
    표본(축이 늘기 전부터 있던 ⓐ~ⓘ)은 전건 미상으로 읽는다.
    """
    tiers = case.get("tiers")
    if not tiers:
        return [None] * len(case["templates"])
    return list(tiers)


def _assert_samples_tread_branches(samples: list) -> None:
    """표본이 **갈리면 순서가 실제로 달라지는** 모양인지 문다.

    두 축을 같은 방식으로 문다 — 2차 키(`board_order`) 네 갈래는 2026-08-20
    B조가 세운 것이고, 1차 키(층) 다섯 갈래가 같은 날 판정 4로 붙었다.
    """
    # ── 2차 키(board_order) 축 ────────────────────────────────────────────
    assert any(
        any(_is_real_float(v) for v in _orders_of(c))
        and any(
            _is_int(v) and v > f
            for v in _orders_of(c)
            for f in _orders_of(c)
            if _is_real_float(f)
        )
        for c in samples
    ), (
        "표본에 **비정수 실수 + 그보다 큰 정수** 조합이 없다 — 실수를 뒤로 "
        "보내든 앞에 두든 순서가 같아 규칙이 갈려도 초록이 된다"
    )
    assert any(
        any(_is_bool(v) for v in _orders_of(c))
        and any(_is_int(v) and v > 1 for v in _orders_of(c))
        for c in samples
    ), (
        "표본에 **불리언 + 1보다 큰 정수** 조합이 없다 — bool을 맨 앞에 세우든 "
        "뒤로 보내든 순서가 같아 규칙이 갈려도 초록이 된다"
    )
    assert any(
        len([v for v in _orders_of(c) if _is_int(v)])
        != len({v for v in _orders_of(c) if _is_int(v)})
        for c in samples
    ), "표본에 **동률**이 없다 — 안정 정렬이 깨져도 아무 소리가 안 난다"
    assert any(
        any(v is None for v in _orders_of(c))
        and any(isinstance(v, int) for v in _orders_of(c))
        for c in samples
    ), "표본에 **없는 것과 있는 것이 섞인** 경우가 없다 — 뒤로 보내는 규칙을 못 본다"

    # ── 1차 키(층 = 지식 단계) 축 — 판정 4 ────────────────────────────────
    # ⚠️ 층이 답을 정해야 하는 갈래에서는 `board_order`가 **전건 같은 값**이어야
    #    한다. 2차 키가 갈래마다 다르면 그것이 답을 정해 버려서, 층 규칙이 갈려도
    #    순서가 같아진다(= 갈래는 밟는데 조용하다).
    def tier_decides(c) -> bool:
        return len(set(_orders_of(c))) == 1

    assert any(
        any(v is None for v in _tiers_of(c))
        and any(_is_int(v) for v in _tiers_of(c))
        and tier_decides(c)
        for c in samples
    ), (
        "표본에 **층이 없는 것과 있는 것이 섞이고 board_order가 전건 같은** 경우가 "
        "없다 — 층 부재를 뒤로 보내든 앞으로 보내든 순서가 같아 조용히 통과한다"
    )
    assert any(
        len([v for v in _tiers_of(c) if _is_int(v)])
        != len({v for v in _tiers_of(c) if _is_int(v)})
        and len(set(_orders_of(c))) > 1
        for c in samples
    ), (
        "표본에 **층 동률 + board_order 상이**가 없다 — 2차 키를 통째로 잃어도 "
        "(안정 정렬이 입력 순서를 내므로) 아무 소리가 안 난다"
    )
    assert any(
        any(_is_real_float(v) for v in _tiers_of(c))
        and any(
            _is_int(v) and v > f
            for v in _tiers_of(c)
            for f in _tiers_of(c)
            if _is_real_float(f)
        )
        and tier_decides(c)
        for c in samples
    ), (
        "표본에 **층이 비정수 실수 + 그보다 큰 정수 층**인 경우가 없다 — 목의 층 "
        "추출 가드가 `typeof v === 'number'`로 되돌아가도 순서가 같아 조용하다"
    )
    assert any(
        any(_is_bool(v) for v in _tiers_of(c))
        and any(_is_int(v) and v > 1 for v in _tiers_of(c))
        and tier_decides(c)
        for c in samples
    ), (
        "표본에 **층이 불리언 + 1보다 큰 정수 층**인 경우가 없다 — 파이썬에서 "
        "bool은 int라 `true`가 키 1로 맨 앞에 서는데, 그 기벽이 갈려도 조용하다"
    )
    # 🔴 **가장 중요한 갈래** — 두 축이 같은 방향이면 어느 키로 정렬해도 답이 같아
    #    「1차 키가 층이다」를 잃어도 조용하다. 그래서 **서로 반대인** 쌍을 요구한다.
    #    ⚠️ 여기서 정렬 규칙을 다시 구현하지 않는다(사본이 된다) — 「층은 오름,
    #    board_order는 내림인 쌍이 존재하는가」라는 **표본 모양**만 본다.
    assert any(
        any(
            ti < tj and oi > oj
            for (ti, oi), (tj, oj) in permutations(
                [
                    (t, o)
                    for t, o in zip(_tiers_of(c), _orders_of(c))
                    if _is_int(t) and _is_int(o)
                ],
                2,
            )
        )
        for c in samples
    ), (
        "표본에 **층 순서와 board_order 순서가 서로 반대인** 쌍이 없다 — 두 축이 "
        "같은 방향이면 어느 키로 정렬해도 답이 같아, 1차 키가 층에서 board_order로 "
        "되돌아가도 조용히 통과한다"
    )


@needs_node
class TestEnergyConstants:
    """구름 에너지 3종 — 목이 리터럴로 복사하던 자리(CO-J-9)."""

    def test_최대치가_같다(self, policy):
        assert policy["cloud_max"] == settings.CLOUD_MAX

    def test_회복_주기가_같다(self, policy):
        assert policy["cloud_regen_minutes"] == settings.CLOUD_REGEN_MINUTES

    def test_소모량이_같다(self, policy):
        assert policy["cloud_cost"] == settings.CLOUD_COST


def server_block_order() -> list[str]:
    """서버의 **출제 순서를 실행으로 캐낸다** — 소스에 적힌 문장이 아니라 실동작.

    `plan_bank_picks`는 배합 dict의 키 순서가 아니라 **블록 호출 순서**로 픽을
    쌓는다(그 함수의 독스트링이 소유자를 그렇게 못박는다). 그래서 기대값을 여기
    사본으로 적지 않고, 블록마다 자기 풀만으로 배합을 채울 수 있게 넉넉히 준 뒤
    나온 kind 나열에서 순서를 읽는다 — 사본을 두면 이 계약이 자기 자신을 대조하게
    되고, 그것이 애초에 CO-J-9가 생긴 방식이다.
    """
    recipe = settings.SESSION_RECIPE

    def pool(kind: str, question_type: str = "multiple_choice") -> list[dict]:
        return [
            {"id": f"{kind}-{i}", "question_type": question_type}
            for i in range(recipe.get(kind, 0))
        ]

    picks, missing = session_service.plan_bank_picks(
        pool("new"),
        pool("review"),
        pool("live"),
        unit_pool=pool("unit"),
        board_pool=pool("board", "board"),
    )
    assert missing == 0, f"블록마다 풀을 다 줬는데 배합이 {missing}건 비었다"
    order: list[str] = []
    for pick in picks:
        if not order or order[-1] != pick["kind"]:
            order.append(pick["kind"])
    assert len(order) == len(set(order)), (
        f"한 블록이 두 번 끊겨 나왔다({order}) — 풀 구성이 부족분 대체를 탔다"
    )
    return order


@needs_node
class TestSessionRecipe:
    def test_배합이_같다(self, policy):
        assert policy["session_recipe"] == settings.SESSION_RECIPE

    def test_출제_순서가_같다(self, policy):
        """**목이 서버와 같은 순서로 문항을 내보내는가** (2026-08-13 신설).

        목은 `new → review → live → board`, 서버는 `live → new → review → board`로
        조용히 갈려 있었다. 하루 첫 유닛 세션이 데일리 화면을 공유하게 되면서
        이 갭은 단순한 목 결함이 아니라 **눈으로 하는 검증을 무효화하는 자리**가
        됐다 — 화면에서 본 순서가 진짜 결함인지 목 인공물인지 구분되지 않는다.

        서버 쪽 기대값은 `plan_bank_picks`를 **실행해서** 얻는다(위 헬퍼).
        """
        assert policy["block_order"] == server_block_order()

    def test_순서에_배합의_전_블록이_들어_있다(self, policy):
        """배합에 자리가 있는데 순서 목록에 없으면 그 블록은 **영영 안 나간다**."""
        wanted = {k for k, v in settings.SESSION_RECIPE.items() if v}
        assert set(policy["block_order"]) >= wanted, (
            f"목 출제 순서에 {sorted(wanted - set(policy['block_order']))} 블록이 없다"
        )

    def test_board_상한이_같다(self, policy):
        """CO-H5 — 목 뱅크에 board가 늘어도 서버와 같은 상한을 쓴다.

        지금 목 뱅크는 board가 소수라 상한에 닿지 않는다. 그래서 더 중요하다 —
        **발현하지 않는 정책은 갈려도 아무도 모른다.** 에너지 상수를 목이 리터럴로
        복사한 채 대조가 0이던 CO-J-9가 정확히 그렇게 생겼다.
        """
        assert policy["daily_board_cap"] == settings.DAILY_BOARD_CAP

    def test_두_번째_이후_유닛_세션_크기가_같다(self, policy):
        """**첫 세션은 배합 총합(10), 두 번째 이후가 이 값**(2026-08-13 확정).

        종전 목은 이 자리에 하드코딩 `3`을 갖고 서버(4)와 조용히 갈려 있었다 —
        대조가 0인 정책이 리터럴로 복사돼 있는 CO-J-9와 똑같은 모양이다.
        """
        assert policy["unit_session_size"] == settings.UNIT_SESSION_SIZE

    def test_배치고사_문항_수가_같다(self, policy):
        """온보딩 배치고사 크기 — 서버 `Settings.PLACEMENT_SIZE`(2026-08-13 신설).

        이 브랜치가 `PLACEMENT_SIZE`를 **6 → 10**으로 올렸다
        (`target_level_sequence`가 지식 단계 1~10을 한 번씩 겨냥하려면 슬롯이
        10칸이어야 한다). 목의 `PLACEMENT_ITEMS`는 `CONCEPT_TAGS`(6종)에서
        만들어져 **6문항에 멈춰 있었고**, `__mockPolicy()`가 이 크기를 노출하지
        않아 **패리티가 원리적으로 못 봤다** — 에너지 상수 3종이 리터럴 사본인
        채 대조가 0이던 CO-J-9와 정확히 같은 모양이다.

        ⚠️ 목이 내보내는 값은 선언 상수가 아니라 **실제로 만들어진 배열의
        길이**여야 한다(`placement_size: PLACEMENT_ITEMS.length`). 상수를
        내보내면 배열이 6건이어도 이 계약이 초록이 된다.
        """
        assert policy["placement_size"] == settings.PLACEMENT_SIZE

    def test_보드_잠금_앞보기가_같다(self, policy):
        """MT-24 — 목이 잠금 규칙을 흉내 내되 **앞보기 칸 수까지** 같아야 한다.

        이 값이 갈리면 목 위 스모크에서는 3칸이 열리는데 실서버에서는 1칸만
        열리는(또는 그 반대) 화면이 된다. 잠금은 학습자가 **무엇을 할 수 있는지**를
        정하므로, 갈린 채로 초록이면 스모크가 검증하는 동선 자체가 실서버에 없다.
        """
        from app.routers.board import BOARD_UNLOCK_LOOKAHEAD

        assert policy["board_unlock_lookahead"] == BOARD_UNLOCK_LOOKAHEAD


@needs_node
class TestLevelGroups:
    """학령 3값 — R13 CO-P-5로 목에도 학령이 생겼다(GET/PATCH /auth/me)."""

    def test_허용값_집합이_같다(self, policy):
        from typing import get_args

        assert set(policy["level_groups"]) == set(get_args(LevelGroup))

    def test_게스트_기본_학령이_같다(self, policy):
        from app.routers.auth import GUEST_LEVEL_GROUP

        assert policy["guest_level_group"] == GUEST_LEVEL_GROUP

    def test_게스트_이메일_도메인이_같다(self, policy):
        """프론트 isGuestUser의 두 번째 판별 신호 — 어긋나면 게스트가 정식으로 읽힌다."""
        from app.routers.auth import GUEST_EMAIL_DOMAIN

        assert policy["guest_email_domain"] == GUEST_EMAIL_DOMAIN

    def test_보드_밴드_천장이_서버_파생값과_같다(self, policy):
        """학습 수준 → 열리는 **최고 층**(2026-08-20 축 교체).

        종전 이 자리는 `board_band_max_difficulty`(학령→파생 난이도 1~3 표)를
        대조했다. 퍼즐 잠금 축이 **지식 단계(1~10)**로 갈아탔으므로 그 표는 목에서
        사라졌고, 같은 성질을 새 축에서 잰다 — 지키는 것은 그때와 같다:
        목이 서버보다 **느슨하면** 목 위 스모크·디자인 확인에서 열리는 퍼즐이
        실서버에서 403이 되고, **빡빡하면** 그 반대다. 어느 쪽이든 목으로 본
        화면이 거짓말이 된다(CO-J-9가 정확히 그 모양이었다).

        🔴 **기대값을 여기 다시 적지 않는다.** 서버 함수를 그 자리에서 불러
        파생시킨다 — 값을 옮겨 적으면 이 계약이 자기 사본을 대조하게 되고,
        그것이 애초에 J-9가 생긴 방식이다. 서버 dict를 돌며 만들기 때문에
        **밴드가 목에서 사라지는 것(키 집합 드리프트)까지** 이 한 줄이 문다.

        ⚠️ 이것은 서버 천장 파생의 **1순위 경로**(진단 전 기본 θ = 사전 b)만
        대조한다. 서버의 두 번째 폴백 `knowledge_level_of_level_group`(1·3·5·7)은
        값이 다르고 그것은 **선재 어긋남**이라 대장에 기록돼 있다 — 이 테스트를
        그쪽 폴백으로 "고치지" 말 것. 목은 1순위 경로만 흉내 낸다.
        """
        from app.services import weatherbrain_service as wb

        assert policy["board_level_group_tier"] == {
            band: wb.theta_to_knowledge_level(item_b)
            for band, item_b in wb.LEVEL_GROUP_ITEM_B.items()
        }

    def test_보드_층수가_같다(self, policy):
        """층의 **개수**(잠금 집합의 정의역) — 서버 `KNOWLEDGE_LEVEL_MAX`.

        천장 표가 같아도 층수가 갈리면 잠긴 집합이 갈린다: 목이 10층까지 세고
        서버가 6층까지 세면 7~10층 퍼즐이 목에서만 존재하는 화면이 된다.
        (`routers/board.BOARD_TIERS`도 이 상수에서 나온다 — 층수의 소유자는
        `schemas/progress.KNOWLEDGE_LEVEL_MAX` 하나다.)
        """
        from app.schemas.progress import KNOWLEDGE_LEVEL_MAX

        assert policy["board_tier_max"] == KNOWLEDGE_LEVEL_MAX


@needs_node
class TestKnowledgeLevelAxis:
    """지식 단계 축 — **목에 아예 없던** 도메인(2026-08-12).

    목의 `GET /progress/me`가 `knowledge_level`·`knowledge_level_max`를 안 보내서
    `KnowledgeLevelCard`가 목에서 **항상 null**을 반환했다. 카드가 통째로 안 뜨니
    프론트 스모크 24종 중 어느 것도 그 카드를 렌더해 본 적이 없었고, 그 상태로
    카드를 /me 오른쪽 열로 옮기는 배치 변경이 들어갔다. J-9가 "값이 갈렸다"였다면
    이것은 "필드가 없었다"다 — 갈림보다 조용하다.

    분모(MAX)와 경계(BOUNDS)가 어긋나면 목 화면의 「10단계 중 3단계」가 실서버에서
    다른 숫자가 된다. 두 값 모두 서버가 소유하고 목은 사본이라 실값으로 문다.
    """

    def test_지식_단계_분모가_같다(self, policy):
        from app.services.weatherbrain_service import KNOWLEDGE_LEVEL_MAX

        assert policy["knowledge_level_max"] == KNOWLEDGE_LEVEL_MAX

    def test_θ_단계_경계가_같다(self, policy):
        from app.services.weatherbrain_service import THETA_KNOWLEDGE_LEVEL_BOUNDS

        assert policy["theta_knowledge_level_bounds"] == list(
            THETA_KNOWLEDGE_LEVEL_BOUNDS
        )

    def test_목이_같은_θ에서_같은_밴드를_낸다(self, policy):
        """4밴드 축도 같은 θ에서 같아야 한다.

        지식 단계를 붙이다 발견했다(2026-08-12): 목 `thetaToLevelGroup`에
        **expert 가지가 없어** θ≥1.5에서 목은 adult, 서버는 expert였다. 두 축은
        접으면 같아야 하는데(`level_group_of_knowledge_level ∘
        theta_to_knowledge_level == theta_to_level_group`) 목만 그 불변식을
        깨고 있었고, 밴드로 잠기는 보드 난이도까지 이 값을 탄다.
        """
        import json
        import subprocess

        from app.services.weatherbrain_service import theta_to_level_group

        samples = [-9.0, -0.51, -0.5, 0.0, 0.49, 0.5, 1.0, 1.49, 1.5, 2.0, 9.0]
        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map(m.__thetaToLevelGroup)));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        mock_bands = json.loads(proc.stdout)
        server_bands = [theta_to_level_group(x) for x in samples]
        mismatched = [
            (x, m, s) for x, m, s in zip(samples, mock_bands, server_bands) if m != s
        ]
        assert not mismatched, f"θ→밴드가 갈린다 (θ, 목, 서버): {mismatched}"

    def test_두_축이_목_안에서도_접힌다(self, policy):
        """목 스스로도 2축 정합을 지키는가 — 단계를 밴드로 접으면 밴드와 같아야."""
        import json
        import subprocess

        from app.services.weatherbrain_service import level_group_of_knowledge_level

        samples = [-9.0, -0.5, 0.0, 0.5, 1.0, 1.5, 1.75, 2.0, 2.25, 9.0]
        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map((x) => "
            "[m.__thetaToKnowledgeLevel(x), m.__thetaToLevelGroup(x)])));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        broken = [
            (x, lvl, band, level_group_of_knowledge_level(lvl))
            for x, (lvl, band) in zip(samples, json.loads(proc.stdout))
            if level_group_of_knowledge_level(lvl) != band
        ]
        assert not broken, f"목의 2축이 안 접힌다 (θ, 단계, 밴드, 접은값): {broken}"

    def test_목이_같은_θ에서_같은_단계를_낸다(self, policy):
        """경계값 전건 대조 — 표만 같고 **비교 방향**(< vs <=)이 다르면 경계에서
        갈린다. 목은 `findIndex(theta < bound)`, 서버는 `if theta < bound`다.
        """
        import json
        import subprocess

        from app.services.weatherbrain_service import theta_to_knowledge_level

        bounds = policy["theta_knowledge_level_bounds"]
        # 경계 위·정확히·아래를 모두 던진다(경계는 하위 제외·상위 포함 관례)
        samples = [-9.0, 9.0]
        for b in bounds:
            samples += [b - 0.01, b, b + 0.01]

        code = (
            f"const m = await import({str(MOCK_PATH.as_uri())!r});"
            f"const xs = {json.dumps(samples)};"
            "process.stdout.write(JSON.stringify(xs.map(m.__thetaToKnowledgeLevel)));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=MOCK_PATH.parent,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        mock_levels = json.loads(proc.stdout)
        server_levels = [theta_to_knowledge_level(x) for x in samples]
        mismatched = [
            (x, m, s)
            for x, m, s in zip(samples, mock_levels, server_levels)
            if m != s
        ]
        assert not mismatched, f"θ→단계가 갈린다 (θ, 목, 서버): {mismatched}"


@needs_node
class TestCrownPolicy:
    """왕관 — **행위가 이미 갈라져 있던** 도메인(CO-A6 / CO-J-9).

    목이 서버와 다른 왕관 정책을 갖고 있으면 "목에선 클리어되는데 실서버는 안 되는"
    갈림이 스모크 초록 뒤에 숨는다. 실제로 그랬다.
    """

    def test_일일_왕관_판정_범위가_진도_블록이다(self, policy, session_src):
        """서버 `_crown_scope_logs`가 kind=='unit'만 보는지 실소스로 확인한다."""
        assert policy["crown"]["daily_scope_kind"] == "unit"
        assert re.search(
            r"def _crown_scope_logs.*?kinds\.get\(log\.quiz_id\) == \"unit\"",
            session_src,
            re.S,
        ), "서버가 진도 블록(kind='unit')으로 왕관 범위를 좁히지 않는다"

    def test_진도_블록_0은_세션_전체로_폴백하지_않는다(self, policy, session_src):
        """CO-M7 — 폴백하면 왕관 기준이 5문항에서 15문항으로 조용히 올라간다."""
        assert policy["crown"]["daily_scope_fallback_to_session"] is False
        fn = re.search(r"def _crown_scope_logs.*?\n\ndef ", session_src, re.S)
        assert fn, "_crown_scope_logs를 못 찾았다 — 이 계약을 갱신할 것"
        # 독스트링은 이 결함의 **경위를 설명하느라** `... or logs`를 인용한다 —
        # 검사 대상은 코드부뿐이다(독스트링을 세면 설명이 곧 위반이 된다).
        code = fn.group(0).split('"""')[-1]
        assert "or logs" not in code, (
            "블록 0에서 세션 전체로 폴백하는 `... or logs`가 되살아났다 (CO-M7)"
        )

    def test_유닛_왕관은_하루_첫_세션에만_붙는다(self, policy, session_src):
        """2026-08-13 확정 — 「하루의 첫 유닛 세션이 곧 데일리 세션」.

        ⚠️ **이 계약은 뒤집혔고, 종전 판은 사실상 헛돌고 있었다.** 예전 본문은
        `grant_crown=False`가 소스에 **존재**하는지만 봤는데, 2026-08-12에 서버가
        `grant_crown=all_correct`로 바뀐 뒤에도 초록이었다 — 그 문자열이 **경위를
        설명하는 주석**에 남아 있었기 때문이다. 문자열 존재로 정책을 재는 검사는
        주석 하나에 속는다. 그래서 지금은 **실제 인자식**을 문다.

        무는 것 셋:
          ⑴ 목이 같은 정책을 신고한다(`daily_first_only`).
          ⑵ 서버가 `all_correct`와 `daily_first`의 **논리곱**을 넘긴다.
          ⑶ 왕관 분기가 「첫 세션인가」를 **재계산하지 않는다** — 발급 시점 도장을
             읽기만 한다. 재계산하면 두 유닛을 열어 역순으로 완료할 때 둘 다 첫
             세션이 되거나 둘 다 아니게 된다.
        """
        assert policy["crown"]["unit_session_grants_crown"] == "daily_first_only"
        assert re.search(r"grant_crown=all_correct and daily_first", session_src), (
            "서버 유닛 세션의 왕관이 「만점 ∧ 하루 첫 세션」이 아니다"
        )
        assert re.search(
            r'daily_first = bool\(\s*\(getattr\(session, "recipe_json", None\) or \{\}\)'
            r'\.get\("daily_first"\)',
            session_src,
        ), "왕관 분기가 recipe_json 도장을 읽지 않는다"

    def test_첫_세션_판정은_발급_시점에_찍힌_도장이다(self, policy, session_src):
        """완료 시점 재계산 금지 — 라우터가 세션 수를 **세지 않아야** 한다."""
        assert policy["crown"]["unit_first_stamped_at_issue"] is True
        # 주석은 걷어낸다 — 판정의 소유자가 어디인지 **설명하느라** 그 함수 이름을
        # 인용하므로, 주석까지 세면 근거를 남길수록 테스트가 우는 뒤집힌 유인이
        # 생긴다(같은 파일 `test_진도_블록_0은_...`이 쓰는 것과 같은 방법).
        code = "\n".join(
            line
            for line in session_src.splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "is_first_unit_session_today" not in code, (
            "라우터가 완료 시점에 「첫 세션인가」를 재계산한다 — 판정의 소유자는 "
            "발급 시점(curriculum_service.create_unit_session)이고 여기는 도장을 "
            "읽기만 해야 한다(역순 완료 경합)"
        )

    def test_왕관_대상_쌍이_진도_블록_유닛에서_나온다(self, policy, session_src):
        """CO-M6 — concept과 kind를 다른 출처에서 뽑으면 왕관이 증발한다."""
        assert policy["crown"]["target_source"] == "unit_block"
        assert re.search(
            r"def _crown_target.*?block\.get\(\"concept_tag\"\).*?block\.get\(\"kind\"\)",
            session_src,
            re.S,
        ), "서버가 unit_block의 (concept_tag, kind) 쌍을 왕관 대상으로 쓰지 않는다"


class TestMockExposesPolicy:
    """소스 계약(python 전용) — node 없이도 배선이 살아 있는지 본다."""

    def test_목이_정책을_노출한다(self):
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "export const __mockPolicy" in src, (
            "목이 __mockPolicy를 노출하지 않는다 — 이 계약 전체가 skip된다"
        )

    def test_목이_에너지_상수를_리터럴로_재복사하지_않는다(self):
        """정책 dict가 상수 **식별자**를 참조해야 한다(값을 다시 적으면 드리프트한다)."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        block = re.search(r"export const __mockPolicy = \(\) => \(\{(.*?)\n\}\);", src, re.S)
        assert block, "__mockPolicy 본문을 못 찾았다 — 이 계약을 갱신할 것"
        body = block.group(1)
        assert "cloud_max: CLOUD_MAX" in body
        assert "cloud_cost: CLOUD_COST" in body
        assert "CLOUD_REGEN_MS" in body
        assert "session_recipe: MOCK_SESSION_RECIPE" in body
        # 배치고사 크기만은 **상수가 아니라 실제 배열 길이**를 내보내야 한다 —
        # 상수를 내보내면 배열이 옛 크기(6)에 멈춰 있어도 패리티가 초록이다
        # (2026-08-13 결함 ④가 그렇게 숨어 있었다).
        assert "placement_size: PLACEMENT_ITEMS.length" in body

    def test_목도_재사용_판정을_구름_게이트보다_먼저_한다(self):
        """2026-08-13 결함 ① — **서버와 목이 같은 결함을 갖고 있었다.**

        서버가 오늘·같은 유닛의 미완료 세션을 재사용하게 되면서(D10-3 대체),
        구름 게이트는 **신규 발급 분기 안**으로 들어갔다. 목의
        `startUnitSession`은 재사용을 처음부터 하고 있었는데 게이트는 그 앞에
        있었다 — 구름 0인 학습자가 이미 발급된 세션에 재진입하면 목에서도 429가
        났다는 뜻이고, 「이미 발급된 세션은 잔량 0이어도 끝까지 보장」(R10)이
        목 위 스모크에서 원리적으로 확인 불가였다.

        `__mockPolicy()`로는 잴 수 없는 **순서**라 소스로 문다(같은 파일의
        `test_계약14_...`가 서버 쪽에 쓰는 것과 같은 방법).
        """
        src = MOCK_PATH.read_text(encoding="utf-8")
        fn = re.search(
            r"function startUnitSession\(.*?\n\}\n", src, re.S
        )
        assert fn, "목의 startUnitSession을 못 찾았다 — 이 계약을 갱신할 것"
        block = fn.group(0)
        reuse_at = block.index("sessions.get(sessionId)")
        gate_at = block.index("requireCloudEntry()")
        assert reuse_at < gate_at, (
            "목이 재사용 조회보다 먼저 구름 게이트를 건다 — 이미 발급된 세션에 "
            "재진입하는 학습자가 429로 쫓겨난다(서버는 신규 발급 분기 안에서만 건다)"
        )


class TestNoLoginInMainFlow:
    """로그인 화면이 **없다** — MT-29 → 2026-08-12 클라이언트 지시로 강화.

    ⚠️ **계약이 뒤집혔다.** 이 클래스는 원래 "라우트 자체는 의도적으로 존치한다"고
    적혀 있었다(로그인 화면이 정식 계정의 재진입 통로이자 게스트 발급 실패의
    도착지라는 근거였다). 2026-08-12 클라이언트 지시로 로그인·회원가입 구조를
    전면 제거하면서 그 전제가 둘 다 무너졌다:

      · 게스트 비밀번호는 무작위 시크릿이라 **애초에 재진입 경로가 없다.**
        로그인 화면은 게스트에게 돌아올 문이 아니라 막다른 길이었다.
      · 발급 실패의 도착지는 이미 `GuestIssueRetry`로 갈려 나갔다(MT-29 본체).
        로그인 화면이 받던 몫이 남아 있지 않다.

    진도를 지키는 통로는 로그인이 아니라 **계정 전환**(`/account/convert`)이고,
    그쪽은 그대로 산다.

    ⚠️⚠️ **계약이 두 번째로 뒤집혔다(2026-08-14 클라이언트 결정 ⓑ) — 절반만.**

    위 8/12 전제는 **게스트에게는 참이었지만 「전환을 마친 사용자」를 못 봤다.**
    저장(계정 전환)을 마치면 그 사람은 **자기가 정한 이메일·비밀번호**를 가진 정식
    계정이다 — 「무작위 시크릿이라 재진입 경로가 없다」가 그 사람에게는 거짓이다.
    그리고 저장 안내 문구는 *"다른 기기에서도 이어서 배울 수 있어요"*라고 계속
    말하고 있었다. **돌아올 문이 없는데 하는 약속**이 실서버까지 갔다(대장 §4.14).

    그래서 `/login`이 「**진도 불러오기**」라는 이름으로 돌아왔다(「진도 저장」의 짝).
    ⚠️ **되돌아온 것은 라우트뿐이고, 규정을 지키던 부분은 그대로다:**
      · `/register`는 **여전히 0건**이다. 가입은 저장(전환) 동선이 소유한다.
      · **주 동선(navItems·SideNav·TabBar·헤더)에 링크 0건** — 그것이 「로그인 없이
        열려야 한다」는 규정의 해석이다. 진입은 「진도 저장」 카드 한 줄뿐이다.
      · **발급 실패 폴백은 되돌아오지 않는다**(계약 3) — 그것이 MT-29가 고친 결함
        자체였다(연결 나쁜 심사위원에게 규정이 금지한 화면을 보여 주는 경로).

    그래서 무는 것은 셋이다:
      1. `/register` 참조 0건 · `/login` 참조는 **정확히 승인된 집합과 같다**
      2. `App.jsx` 라우트 표에 `/register`가 없고 **`/login`은 있어야 한다**
      3. 발급 실패를 `GuestIssueRetry`가 받고, **재시도가 effect 의존성에 있다**

    ⚠️ 3번의 뒷단이 핵심이다 — 재시도 버튼이 리렌더만 일으키고 발급을 다시 안 걸면
    화면이 영구 스피너가 되고 사용자가 갇힌다(실제로 그렇게 커밋된 적이 있다.
    2026-08-12 코드 리뷰). 그래서 문자열 존재가 아니라 **의존성 배열**을 문다.
    """

    FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src"

    # ⚠️ **부분 문자열로 세면 안 된다.** `/auth/login`·`/auth/register`는 계정 전환이
    # 쓰는 정당한 **API 엔드포인트**라 `api/auth.js`에 그대로 남고, 산문 주석에도
    # "종전에는 /login으로 튕겼다" 같은 경위 기술이 남는다. 무는 것은 화면으로
    # 가는 **라우트 참조**이므로 라우트 모양의 마커만 센다.
    ROUTE_MARKERS = tuple(
        tmpl.format(path=path)
        for path in ("/login", "/register")
        for tmpl in (
            'to="{path}"',
            "to='{path}'",
            'navigate("{path}")',
            "navigate('{path}')",
            'path="{path}"',
            "path='{path}'",
            'Navigate to="{path}"',
            # ⚠️ **`.js` 헬퍼가 목적지를 데이터로 들고 있는 선례가 있다** —
            # `modules/curriculum/learnEntry.js`의 `pickLearnEntry`가
            # `{ kind: 'daily', to: '/daily' }`를 돌려주고 화면이 그걸 `<Link to>`에
            # 그대로 꽂는다. JSX 속성만 보면 그런 경로는 감시를 빠져나간다.
            "to: '{path}'",
            'to: "{path}"',
        )
    )

    # 🔴 **승인된 `/login` 참조 — 이 집합 자체가 계약이다.**
    #
    # 「허용 목록」이 아니라 **정확한 집합**으로 문다. 목록이면 빠지는 것을 못 보지만
    # 집합이면 **양쪽으로** 운다:
    #   · 세 번째 참조가 생기면(navItems에 탭 추가·헤더 링크·엉뚱한 navigate) 붉다
    #   · 승인된 참조가 사라져도 붉다(진입점만 지우면 라우트가 고아가 된다)
    # ⚠️ **여기에 줄을 더하는 것은 테스트 수정이 아니라 계약 변경이다** — 주 동선
    #    링크 0건이 규정 해석의 근거이므로 클라이언트 결정 없이 늘리지 말 것.
    SANCTIONED_LOGIN_REFS = {
        # 라우트 정의 — 표의 단일 소유자
        'App.jsx: path="/login"',
        # 진입점 ⑴ — 「진도 저장」 카드. 이미 저장한 사람이 이 카드를 다시 보는
        # 경우가 곧 「돌아오려는 사람」이라 자리도 여기가 맞다.
        'modules/progress/ProgressPage.jsx: to="/login"',
        # 🔴 진입점 ⑵ — **첫 접속 정보 입력 화면**(2026-08-19 클라이언트 지시로 추가).
        #
        # ⚠️ 이 줄을 더한 것은 테스트 수정이 아니라 **계약 변경**이다(위 주석).
        #    근거를 남긴다 — 나중에 「누가 늘렸나」를 물을 때 답이 있어야 한다:
        #      · 클라이언트 지시(2026-08-19): *"진도 불러오기를 진입 시점에 노출"* —
        #        실서버 실측으로 **진입 화면에 진입점이 0건**이었고 `/login` URL을
        #        직접 아는 사람만 닿았다. 화면이 닉네임을 적게 해 놓고 그 이름으로
        #        돌아올 문이 안 보이는 상태였다.
        #      · 규정 판정(`docs/team/HACKATHON_RULES.md` §0, 2026-08-14 확정):
        #        금지되는 것은 **주 동선이 계정·결제를 요구하는 것**이지 인증 표면의
        #        존재가 아니다 — 「진도 불러오기」 진입도 규정 안이다.
        # ⚠️ **주 동선 0건은 그대로다.** 이 화면은 「건너뛰기」로 통과되는 진입
        #    화면이고 navItems·SideNav·TabBar에는 여전히 참조가 없다. 진입점이
        #    관문이 되지 않는다는 반대 방향 단정은 프론트
        #    `tests/loadProgress.contract.test.mjs` ④가 소유한다.
        "modules/onboarding/EntryInfoPage.jsx: navigate('/login')",
    }

    def test_프론트에_로그인_가입_라우트_참조가_없다(self):
        """계약 1 — `/register`는 0건, `/login`은 **승인된 집합과 정확히 일치**.

        `.jsx`뿐 아니라 `.js`도 훑는다(위 ROUTE_MARKERS 주석의 learnEntry 선례).
        `/auth/login`·`/auth/register`는 계정 전환·진도 불러오기가 쓰는 실
        엔드포인트라 남지만, 마커가 전부 `to:`/`path=`/`navigate(` 접두를 요구하므로
        걸리지 않는다.
        """
        found = []
        for path in sorted([*self.FRONT.rglob("*.jsx"), *self.FRONT.rglob("*.js")]):
            src = path.read_text(encoding="utf-8")
            for marker in self.ROUTE_MARKERS:
                if marker in src:
                    found.append(f"{path.relative_to(self.FRONT)}: {marker}")

        register_refs = [f for f in found if "/register" in f]
        assert not register_refs, (
            "회원가입 화면으로 가는 라우트 참조가 되살아났다 — 가입은 저장(계정 "
            "전환) 동선이 소유한다: " + " · ".join(register_refs)
        )

        login_refs = {f for f in found if "/login" in f}
        extra = login_refs - self.SANCTIONED_LOGIN_REFS
        missing = self.SANCTIONED_LOGIN_REFS - login_refs
        assert not extra, (
            "승인되지 않은 「진도 불러오기」 진입이 생겼다 — 주 동선 링크 0건이 "
            "「로그인 없이 열려야 한다」는 규정의 해석이고, 진입은 「진도 저장」 카드 "
            "하나뿐이다(대장 §4.14). 늘리려면 클라이언트 결정이 먼저다: "
            + " · ".join(sorted(extra))
        )
        assert not missing, (
            "승인된 「진도 불러오기」 참조가 사라졌다 — 라우트나 진입점 한쪽만 지우면 "
            "고아가 된다(라우트만 남으면 갈 길이 없고, 링크만 남으면 `*`가 삼킨다): "
            + " · ".join(sorted(missing))
        )

    def test_App_라우트_표에_로그인_가입_경로가_없다(self):
        """계약 2 — 라우트 정의 자체가 사라졌는가.

        위 1번은 `src` 전역을 훑으므로 App.jsx도 포함하지만, 이 계약은 **App.jsx가
        라우트 표의 단일 소유자**라는 사실에 기대어 따로 못 박는다. 라우트가
        되살아나는 회귀는 여기서 먼저 운다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        for marker in ('path="/register"', "path='/register'"):
            assert marker not in src, (
                "App.jsx 라우트 표에 /register가 되살아났다 — 가입 구조는 "
                "2026-08-12에 제거됐고 저장(계정 전환)이 그 몫을 갖는다"
            )
        # 🔴 **`/login`은 이제 「없어야」가 아니라 「있어야」다**(2026-08-14 ⓑ).
        # 방향을 뒤집어 못박는 이유: 라우트를 다시 지우면 **아무도 울지 않는다.**
        # 프론트 계약 ㉮는 문구가 겸손해서 초록이고(약속을 안 하므로), 「진도 저장」
        # 카드의 링크는 `*` catch-all에 삼켜져 조용히 `/`로 튕긴다 — 화면상으로는
        # 「눌러도 아무 일도 안 일어난다」로 보인다.
        assert 'path="/login"' in src or "path='/login'" in src, (
            "App.jsx에서 진도 불러오기 라우트가 사라졌다 — 「진도 저장」 카드의 "
            "진입 링크가 `*`에 삼켜져 조용히 학습 화면으로 튕긴다(대장 §4.14 ⓑ)"
        )
        # 삭제된 페이지 모듈을 다시 임포트하지도 않는다(파일 자체가 git rm 됐다).
        # ⚠️ **맨 이름으로 세지 않는다.** `LoginPage`는 "종전에 LoginPage가 …했다"
        # 같은 경위 기술로 주석에 정당하게 남는다(CLAUDE.md: 메커니즘 서술과
        # 근거 참조는 남기고 고유명사만 바꾼다). 무는 것은 **import 문**이다.
        for gone in ("LoginPage", "RegisterPage"):
            assert not re.search(rf"^import\s+.*\b{gone}\b.*$", src, re.M), (
                f"App.jsx가 삭제된 {gone}을 임포트한다 — 파일은 git rm 됐다"
            )

    def test_발급_실패는_재시도_화면으로_받고_재시도가_실제로_돈다(self):
        """계약 3 — 실패를 `GuestIssueRetry`가 받고 재시도가 effect를 다시 돌린다.

        ⚠️ 앞단(문자열 존재)만 물면 **아무 일도 안 하는 재시도 버튼**이 통과한다 —
        실제로 그렇게 커밋됐다. `bump`로 리렌더만 하면 발급 effect의 의존성
        `[accessToken]`이 그대로(null)라 재발급이 안 걸리고, 재시도 화면이 영구
        스피너로 바뀐다. MT-29가 막으려던 결과 그 자체다.

        그래서 **재시도 신호가 effect 의존성 배열에 있는지**를 문다.
        누르는 것까지 보는 실마운트 계약은
        `frontend/tests/onboardingGating.smoke.test.mjs`(시나리오 10-b)가 소유한다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        assert "guestFailed" in src, "발급 실패와 그 외(토큰 없음)를 구분하지 않는다"
        assert "GuestIssueRetry" in src, "발급 실패에 재시도 화면이 없다"

        # 재시도 신호(retryTick)가 발급 effect의 의존성 배열에 있어야 한다.
        deps = re.search(r"\}, \[accessToken([^\]]*)\]\);", src)
        assert deps, (
            "게스트 발급 effect의 의존성 배열(`[accessToken…]`)을 못 찾았다 — "
            "이 계약을 갱신할 것"
        )
        assert "retryTick" in deps.group(1), (
            "재시도가 effect 의존성에 없다 — 버튼이 리렌더만 일으키고 발급을 다시 "
            "걸지 않는다. 재시도 화면이 영구 스피너가 되고 사용자가 갇힌다"
        )
        # 실패 분기가 "그 외" 분기보다 **먼저** 와야 한다. 순서 표기가 두 번
        # 바뀌었다: 처음에는 뒤 분기가 `Navigate to="/login"`이라 그 문자열로 쟀고,
        # 로그인 화면 제거 뒤에는 두 분기 모두 `GuestIssueRetry`라 플래그 이름
        # (`guestSettled)`)으로 쟀다. 2026-08-14부터 뒤 분기는 조건이 늘어난
        # `guestSettled || hadAccount`라 **닫는 괄호가 붙지 않는다** — 그래서
        # 여기서는 `if (` 다음의 플래그 등장 위치로 잰다(조건이 또 늘어나도 산다).
        fail_at = src.index("if (guestFailed)")
        settled_at = src.index("if (guestSettled")
        assert fail_at < settled_at, (
            "발급 실패가 '그 외' 분기에 먼저 잡힌다 — 실패 전용 안내가 죽는다"
        )

    def test_만료는_재시도가_아니라_선택_화면이고_새로고침을_건넌다(self):
        """계약 3-b — **「다시 시도」가 계정 교체가 되면 안 된다**(2026-08-14).

        계약 3은 「발급 **실패**를 재시도로 받는다」를 지킨다. 그 옆에 다른 상황이
        있다: 토큰을 **가진 적이 있는데 지워진** 경우(401 인터셉터 →
        `authStore.logout()`). 종전에는 그 자리도 `GuestIssueRetry`를 재사용했고,
        버튼이 `resetGuestAutoIssue()`로 **새 게스트를 발급**했다 — 게스트
        비밀번호는 무작위 시크릿이라 옛 진도로 돌아갈 길이 없다. 버튼 이름은
        「다시 시도」인데 결과는 진도 영구 소실이었다.

        두 겹을 문다. 하나만 있으면 나머지 하나로 우회된다:
          ⓐ 만료 전용 화면(`SessionExpired`)이 있고 그 분기가 존재한다.
          ⓑ 판정이 **persist되는 값**(`authStore.hadAccount`)에 걸린다 —
             모듈 스코프 플래그만 보면 **새로고침 한 번**에 「첫 방문자」로
             둔갑해 안내 화면이 통째로 우회된다.

        누르는 것까지 보는 실마운트 계약은
        `frontend/tests/entryFlow.smoke.test.mjs` ⑩~⑫가 소유한다.
        """
        src = (self.FRONT / "App.jsx").read_text(encoding="utf-8")
        assert "SessionExpired" in src, (
            "만료를 발급 실패와 같은 화면으로 받는다 — 「다시 시도」가 곧 계정 "
            "교체가 되고 게스트 진도가 영구 소실된다"
        )
        assert "hadAccount" in src, (
            "만료 판정이 모듈 스코프 플래그에만 걸려 있다 — 새로고침 한 번이면 "
            "「첫 방문자」와 구분되지 않아 새 게스트가 조용히 발급된다"
        )
        deps = re.search(r"\}, \[accessToken([^\]]*)\]\);", src)
        assert deps and "hadAccount" in deps.group(1), (
            "`hadAccount`가 발급 effect 의존성에 없다 — 「새로 시작하기」가 "
            "플래그만 지우고 발급을 다시 걸지 않아 버튼이 죽은 것처럼 보인다"
        )

        store = (self.FRONT / "store" / "authStore.js").read_text(encoding="utf-8")
        logout_line = next(
            line for line in store.splitlines() if line.strip().startswith("logout:")
        )
        assert "hadAccount" not in logout_line, (
            "`logout()`이 `hadAccount`까지 지운다 — 토큰과 같은 수명이 되면 "
            "만료 안내가 새로고침 한 번으로 사라진다(이 값의 존재 이유가 그것이다)"
        )
        partialize = src_partialize = re.search(
            r"partialize:\s*\(state\)\s*=>\s*\(\{(.*?)\}\)", store, re.S
        )
        assert partialize and "hadAccount" in partialize.group(1), (
            "`hadAccount`가 persist에 실리지 않는다 — 새로고침을 못 건너므로 "
            "있으나 마나 하다"
        )


# ═══════════════════════════════════════════════════════════════
# 🔴 그물 밖이던 사본 넷 (2026-08-20 전수 대조에서 드러남)
# ═══════════════════════════════════════════════════════════════
class TestUnnettedCopies:
    """목이 서버 로직을 **자체 구현**한 자리 중 `__mockPolicy()`에 안 실려 있던 것들.

    값이 오늘 같아도 노출이 없으면 **서버가 바뀔 때 아무 소리가 안 난다.**
    같은 파일 안에서 어떤 사본은 대조되고 어떤 사본은 안 되던 것이 위험이었다 —
    있는 쪽만 보고 「목은 대조된다」고 읽기 쉽다.
    """

    def test_사전_b_표가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["level_group_item_b"] == {
            k: float(v) for k, v in wb.LEVEL_GROUP_ITEM_B.items()
        }

    def test_기본_b가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["default_item_b"] == float(wb.DEFAULT_ITEM_B)

    def test_표현_톤_표가_같다(self, policy):
        from app.services import weatherbrain_service as wb
        assert policy["level_group_tone"] == dict(wb.LEVEL_GROUP_TONE)

    # ═══════════════════════════════════════════════════════════════
    # 🔴 철거: test_보드_난이도_규칙이_같은_답을_낸다 (2026-08-20) — 경위만 남긴다
    # ═══════════════════════════════════════════════════════════════
    #
    # 무엇을 재던 테스트였나: **표가 아니라 규칙**. 목이 `board_difficulty_samples`로
    # 내려보낸 입력 표본을 서버 `routers/board.board_difficulty`에 그대로 넣어 답을
    # 대조했다. 표(`board_band_max_difficulty`)는 이미 대조되고 있었는데 규칙은
    # 아니었고, 실제로 갈려 있었다 — 서버는 `isinstance(palette, (list, dict))`로
    # 세고 목은 배열만 셌다. 시드가 전부 배열이라 **답만 같았다.** 그래서 표본에
    # **3개 이상인 객체 palette**가 들어 있는지까지 요구했다(2개짜리만 남으면
    # `len(palette) >= 3` 갈래를 지워도 초록이 된다 — 되돌림에서 잡힌 함정).
    #
    # 왜 지웠나: 서버 `board_difficulty`가 **함수째 철거됐다**(축 교체 커밋
    # `482a893`·`routers/board.py`의 「철거된 파생 축」 블록). 잴 대상이 없어져
    # 이 테스트는 ImportError로 죽었다 — 초록이 아니라 **부재**다.
    #
    # 성질이 어디로 갔나: **어디로도 안 갔다.** 새 축의 퍼즐 층은 파생이 아니라
    # 저작값이라(`board_tier`가 `content_items.knowledge_level`을 읽을 뿐) 대조할
    # 「규칙」이 애초에 없다. 남은 규칙은 **잠금 규칙**(천장 위 전 층이 잠긴다:
    # 서버 `locked_tiers` ↔ 목 `lockedBoardTiers`)이고 그것은 지금 **아무 그물에도
    # 없다** — `__mockPolicy()`가 목의 잠긴 집합 계산을 노출하지 않는다. 이 테스트가
    # 쓰던 방법(입력 표본을 내려보내 서버가 직접 재기)이 그 자리에 필요하고,
    # 목 파일은 이 세션 소유가 아니라 리드 판정 대기로 보고했다.
    #
    # ⚠️ 목은 아직 `boardDifficulty`·`BOARD_DIFFICULTY_SAMPLES` 사본을 들고 있고
    # `__mockPolicy()`가 `board_difficulty_samples`를 계속 내보낸다 — 서버 짝이
    # 없어졌으므로 **대조되지 않는 죽은 사본**이다(리드 소유, 보고함).
    # ── 병합 해소 경위 (2026-08-20 `integ` — A조 ↔ B조) ──────────────────────
    # B조 판에는 이 자리에 `test_보드_난이도_규칙이_같은_답을_낸다`가 **살아 있었다.**
    # 살릴 수 없었다 — 그 테스트가 임포트하는 `routers.board.board_difficulty`가
    # **함수째 철거됐기 때문**이다(A조 축 교체). 그대로 두면 초록이 아니라
    # **ImportError**다. 어드바이저 판정으로 그 삭제가 승인됐고, 조건은
    # 「승계 핀이 착지할 것」이었다 — 승계자는 `test_board_difficulty.py`의
    # `test_시드_board_지식_단계_분포_고정`이다(같은 날 착지).
    #
    # 🔴 **B조가 그 테스트에 넣은 「갈래를 밟는 표본」 요구는 죽지 않았다.**
    # *"표본에 3개 이상인 객체 palette가 있는지까지 확인한다 — 그 갈래가 빠지면
    # 이 검사가 다시 「입력이 그 갈래를 안 밟아서」 초록이 된다"*. 그 원칙은
    # 아래 `test_보드_진행_순서_규칙이_같은_순서를_낸다`가 **네 갈래**(비정수 실수 ·
    # 불리언 · 동률 · 부재)로 이어받았고, 축 교체분(지식 단계)은 A조가 표본을
    # 늘려 받는다. 원칙은 남고 그것을 태우던 함수만 없어졌다.

    def test_대결_승리_XP가_같다(self, policy):
        """액수를 프론트가 하드코딩하지 않도록 서버가 보내는 값이다(R10).
        목도 그 값을 흉내내므로 사본이고, 사본이면 대조해야 한다."""
        from app.services import duel_service
        assert policy["duel_win_xp"] == duel_service.DUEL_WIN_XP

    def test_보드_진행_순서_규칙이_같은_순서를_낸다(self, policy):
        """🔴 **표가 아니라 규칙 — 그리고 키가 아니라 순서를 잰다.**

        `order_puzzles_for_progress`(server routers/board)의 목 사본이 그물 밖에
        있었다. 2026-08-20 실측:
        - 시드 board 55건 전건은 **양쪽이 같은 순서**(1..55)를 냈다 — 값만 보면 조용하다.
        - 그런데 **규칙은 이미 갈려 있었다.** 서버 판정은 파이썬
          `isinstance(value, int)`인데 목은 `typeof v === 'number'`였다:
          ⑴ 비정수 실수 `2.5` — 서버 키 10000(뒤로) / 목 키 2.5(앞으로)
          ⑵ `true`/`false` — 파이썬에서 bool은 int라 서버 키 1·0(맨 앞) /
             목 키 10000(뒤로)
          시드가 정수만 써서 **오늘만** 답이 같았다(palette 갈래와 같은 형태).
        ⇒ 목을 서버에 맞췄고, 목이 내려보낸 표본을 **서버 함수가 다시 풀어** 대조한다.

        ⚠️ **정렬 키를 값으로 박지 않는다.** A조가 잠금 축을 3단계 → 10단계로
           갈아타며 정렬 키를 `(지식 단계, board_order)`로 바꾸는 중이다. 키를
           단정하면 그때 헛울고, 순열을 단정하면 「같은 입력에 같은 순서인가」가
           축이 바뀐 뒤에도 그대로 성립한다. **축 변경 후 이 표본으로 재대조할 것.**

        🔴 **그 재대조를 했다**(2026-08-20 판정 4). 정렬 키가 실제로
        `(층, board_order)`로 늘었고, 표본은 **board_order 축만 밟고 있었다** —
        1차 키가 갈려도 조용히 통과하는 상태였다. 그래서
        ⑴ 아이템 조립이 층을 **속성으로** 싣고(서버 `board_tier`가
           `getattr(item, "knowledge_level")`을 읽는다 — `template_json` 안에 넣으면
           양쪽이 모두 「층 없음」으로 읽어 1차 키를 안 밟는다),
        ⑵ 갈래 밟기 단정이 **층 축 다섯 갈래**를 더 문다
           (`_assert_samples_tread_branches` — 부재·동률·비정수 실수·불리언 ·
           🔴 **두 축이 서로 반대인 표본**).
        """
        from types import SimpleNamespace

        from app.routers.board import order_puzzles_for_progress

        samples = policy["board_order_samples"]
        assert samples, "목이 보드 진행 순서 표본을 안 내보낸다"

        _assert_samples_tread_branches(samples)

        # ── 본 대조 ── 목의 입력을 서버 함수에 그대로 넣어 **순열**을 맞춰 본다.
        bad = []
        for case in samples:
            tiers = _tiers_of(case)
            items = [
                SimpleNamespace(i=i, knowledge_level=tiers[i], template_json=t)
                for i, t in enumerate(case["templates"])
            ]
            srv = [x.i for x in order_puzzles_for_progress(items)]
            if srv != case["out"]:
                bad.append((case, srv))
        assert not bad, "목과 서버의 보드 진행 순서 규칙이 갈렸다: " + "; ".join(
            f"{c['templates']}: 목 {c['out']} vs 서버 {srv}" for c, srv in bad
        )

    def test_목의_천장이_학습자_단계에서_온다(self, mock_src):
        """🔴 **2026-08-20 판정 A — 목은 밴드, 서버는 θ로 갈려 있었다.**

        서버 담당 실측(소유 밖 발견으로 접수): 목 `lockedBoardTiers`·
        `unlockedBoardIds`가 `BOARD_LEVEL_GROUP_TIER[mockAuth.levelGroup]` — **밴드
        파생**을 천장으로 썼다. 서버는 판정 1로 밴드 폴백을 철거해 천장이 **θ 파생
        학습자 단계**뿐이다. **그 갈림을 무는 그물이 없었다**: 밴드 표 값 대조는
        「1순위 경로만 본다」로 초록이었고(두 경로가 같은 사전값을 쓰니 값이 같다),
        `__mockPolicy()`는 잠금 계산을 노출하지 않는다.

        ⇒ **이음매를 문다**: 두 잠금 함수가 천장을 `learnerTier()`에서 가져오고,
        밴드 표를 **직접 읽지 않는다.**

        ⚠️ **값을 박지 않는다**(2·4·6·9도, 판수도). 그 값은 사전 b 파생이라 사전값이
        바뀌면 함께 움직여야 한다 — 값 대조는 이미 두 계약이 서버에서 **파생시켜**
        하고 있다(`test_보드_밴드_천장이_서버_파생값과_같다` ·
        `test_board_mock_parity::test_밴드_천장표가_같다`).
        ⚠️ 밴드가 사라진 것이 아니라 **자리가 바뀌었다**: `seedAbilities`(= 서버
        `seed_placement` 사본)가 밴드 사전 b를 θ로 심는다. 그것까지 함께 문다 —
        안 심으면 갓 만든 초등 계정이 목에서 중·고등처럼 보인다(그 상태였다).
        """
        for fn in ("lockedBoardTiers", "unlockedBoardIds"):
            body = _fn_body_of(mock_src, fn)
            assert re.search(r"const ceiling = learnerTier\(\)", body), (
                f"목 `{fn}`이 천장을 `learnerTier()`에서 가져오지 않는다 — 천장의 "
                "소유자는 학습자 단계다(판정 A). 이음매가 둘로 갈리면 한쪽만 고쳐진다"
            )
            assert "BOARD_LEVEL_GROUP_TIER" not in body, (
                f"목 `{fn}`이 밴드 표를 **직접** 읽는다 — 서버는 밴드 폴백을 철거했다"
                "(`learner_tier`). 그 표는 이제 파리티가 무는 기대값 표일 뿐이다"
            )

        # `learnerTier`가 θ 경로인가 — 밴드를 다시 끌어오지 않는지까지 본다.
        seam = _fn_body_of(mock_src, "learnerTier")
        assert re.search(r"return knowledgeLevelNow\(\)", seam), (
            "목 `learnerTier`가 `knowledgeLevelNow()`(θ 파생)를 안 쓴다 — 서버 "
            "`learner_tier`는 `overall_knowledge_level` 하나뿐이다"
        )
        assert "level_group" not in seam.lower().replace("levelgroup", "level_group"), (
            "목 `learnerTier`가 학령을 읽는다 — 판정 1이 철거한 그 경로다"
        )

        # 밴드는 **θ의 초기값**이 오는 자리다(서버 `seed_placement` 사본).
        seed = re.search(
            r"const seedAbilities = \((\w+)\) =>(.*?)\n\s*\);", mock_src, re.S
        )
        assert seed, "목에서 seedAbilities를 못 찾았다 — 이름/모양이 바뀌었나"
        assert re.search(r"LEVEL_GROUP_ITEM_B\[\w+\]", seed.group(2)), (
            "목 `seedAbilities`가 밴드 사전 b를 θ로 심지 않는다 — 서버 "
            "`seed_placement`는 `level_group`을 ai-worker placement에 넘겨 사전값을 "
            "심는다. 안 심으면 갓 만든 초등·성인 계정을 dev에서 재현할 수 없다"
        )

    def test_층이_미상인_퍼즐은_열리되_줄에_서지_않는다(self, mock_src):
        """🔴 **2026-08-20 판정 2** — 목의 **열림 규칙**은 지금도 행동 그물이 없다.

        이 파일이 그 공백을 스스로 적어 뒀다: *"남은 규칙은 **잠금 규칙**이고 그것은
        지금 **아무 그물에도 없다** — `__mockPolicy()`가 목의 잠긴 집합 계산을
        노출하지 않는다"*. 표본으로 열려고 `unlockedBoardIds`에 인자를 붙였다가
        **되돌렸다**: 리드 소유 `test_board_mock_parity._fn_body`가
        `function unlockedBoardIds()` — 인자 없는 그 형태를 정규식으로 찾으므로
        인자를 붙이면 그쪽이 함수를 아예 못 찾는다. 그 파일을 손대지 않는 쪽을 골랐고
        (정규식을 넓히지 않고 코드를 맞추는 것이 같은 날 내려온 판정 방향이다),
        행동 대조는 그 정규식이 넓혀질 때 붙일 자리로 **보고**했다.

        그래서 여기서는 **소스 계약**으로 문다 — 무는 것은 판정 문언 둘이다:
          ⑴ **열린다** — 층이 미상인 퍼즐을 여는 **명시 분기**가 있다.
             ⚠️ 목은 이것을 **이미 우연히** 하고 있었다(`null < 6`이 참). 우연히
             맞는 코드는 다음 사람이 「버그」로 보고 고치고, 고치면 미상 퍼즐이
             `locked=false`인데 `unlocked=false`가 되어 **누구에게도, 영원히**
             안 열린다 — 저작 실수 하나가 콘텐츠를 소리 없이 증발시킨다.
             그래서 「우연히 맞는 상태」와 「명시 분기」를 구별해 문다: 분기가 없으면
             이 단정이 운다.
          ⑵ **줄에 서지 않는다** — 천장층 순차 목록에서 미상을 **명시적으로** 뺀다.
             `=== ceiling`이 이미 미상을 걸러내지만(null !== 숫자) 그것도 우연이다.

        ⚠️ 소스 계약의 한계를 적어 둔다: 이것은 **구문이 그 자리에 있는지**만 본다
        (리드 파일의 `test_목이_천장_아래를_인정한다`와 같은 방법·같은 한계).
        행동 동치는 표본이 열릴 때 문다.
        """
        body = _fn_body_of(mock_src, "unlockedBoardIds")

        # ⑴ 미상을 여는 명시 분기 — 「미상이면 true」가 한 줄로 보여야 한다.
        assert re.search(
            r"if\s*\(\s*tierless\(\w+\)\s*\)\s*return\s+true", body
        ), (
            "목에 「층이 미상이면 열림」 **명시 분기**가 없다 — `null < ceiling`이 "
            "참인 것에 기대는 우연한 열림으로 되돌아가면, 다음 사람이 그것을 버그로 "
            "고치는 순간 미상 퍼즐이 누구에게도 안 열린다(판정 2)"
        )
        # 미상 판정 자체가 서버 `board_tier`와 같은 방향인지 — `null`·`undefined`
        # 둘 다 미상으로 본다(목은 `boardTierOf`가 null을 내고, 심긴 목록은
        # 필드가 아예 없을 수도 있다).
        assert re.search(
            r"const\s+tierless\s*=\s*\(\w+\)\s*=>\s*[^\n]*knowledge_level\s*===\s*null",
            body,
        ), (
            "목의 미상 판정이 `knowledge_level === null`을 안 본다 — `!p.knowledge_level`"
            "로 두면 **0층·false가 미상이 되어** 함께 열린다"
        )
        # ⑵ 순차 목록에서 미상을 명시적으로 뺀다.
        assert re.search(
            r"filter\(\s*\(\w+\)\s*=>\s*!tierless\(\w+\)\s*&&[^\n]*knowledge_level\s*===?\s*ceiling",
            body,
        ), (
            "천장층 순차 목록이 미상을 **명시적으로** 빼지 않는다 — 미상 퍼즐이 "
            "커서를 붙잡으면 LOOKAHEAD 창의 한 칸을 먹어 천장층 마지막 칸이 안 열린다"
            "(판정 2의 「줄에 서지 않는다」)"
        )

    def test_목도_천장_미상_학습자를_전건_연다(self, mock_src):
        """🔴 **서버가 2026-08-20에 고친 결함이 목에도 그대로 있었다**(실측).

        서버 `unassessed_ids`가 그 수리다: `learner_tier`가 `None`을 낼 때
        `locked_tiers(None) == set()`이라 **아무 층도 안 잠기는데**, 열림 합성의
        갈래가 전부 정수 천장을 요구해 열린 집합이 **층 미상 퍼즐만** 남았다 —
        `locked=False`인데 `unlocked=False`인 **유령 칸이 보드 전체 규모**였고,
        진입·채점이 전건 403이었다.

        🔴 **목의 `unlockedBoardIds`가 같은 모양이었다**: 천장 아래 판정이
        `typeof ceiling === 'number' && …`이라 천장 미상에서 거짓이고, 천장층
        순차 목록도 `=== ceiling`이라 비며, 남는 것은 `tierless(p)` 갈래뿐이다.
        ⇒ 목이 그 상태를 재현하면 **화면이 통째로 잠긴 것처럼** 보인다. 재현조차
        못 하면 dev 화면으로는 이 결함을 **영영 못 본다** — 그것이 이 저장소가
        반복해 밟은 형태라, 목에도 같은 수리를 넣고 그 자리를 여기서 문다.

        ⚠️ 소스 계약인 이유: `unlockedBoardIds`는 인자를 못 받는다(리드 소유
        `test_board_mock_parity`가 `function unlockedBoardIds() {` 선언 모양을
        **변이 치환의 기준**으로 쓴다 — 인자를 붙이면 그 치환이 0회가 되어 리드
        계약이 운다). 그래서 규칙째 내보내지 못하고 구문으로 문다. 행동 대조는
        board-entry 스모크가 목을 실제로 태워서 한다.
        """
        body = _fn_body_of(mock_src, "unlockedBoardIds")
        # ⚠️ **「전건」까지 문다.** 분기가 있어도 `new Set()`을 돌려주면 결함 그대로다 —
        #    반환이 `items` 전건에서 만들어지는지 확인한다(빈 집합을 통과시키지 않는다).
        assert re.search(
            r"if\s*\(\s*typeof ceiling\s*!==\s*'number'\s*\)\s*\{?\s*"
            r"return new Set\(\s*items\.map\(",
            body,
        ), (
            "목에 「천장이 미상이면 전건 열림」 분기가 없다 — 서버 `unassessed_ids`가 "
            "그 자리다. 없으면 θ 행이 없는 계정에서 `locked=False`인데 "
            "`unlocked=False`인 유령 칸이 **보드 전체**가 된다(2026-08-20 서버 실측: "
            "층 있는 9건 중 열린 것 0건)"
        )

    def test_목이_천장_미상_상태에_도달할_수_있다(self, mock_src):
        """재현 못 하는 갈래는 **없는 갈래**다 — 위 수리를 화면으로 볼 통로가 있는가.

        서버에서 θ 행 0건은 `seed_placement`가 ai-worker 장애로 조용히 실패한
        상태다(`routers/auth.py`·`dev.reset_me` 양쪽이 그 관례를 적어 뒀다).
        목에는 그 장애가 없으므로 **그 조건을 dev 레버로 재현**한다.

        ⚠️ 이 레버는 **목에만 있다**(서버 `/dev/reset-me`에 대응 필드가 없다).
        서버 라우트 표면을 늘린 것이 아니라 **서버 장애 상황을 시뮬레이션**하는
        자리라 목에 두었고, 판정이 필요하면 되돌릴 수 있게 한 곳에 모아 두었다.
        """
        body = _route_body_of(mock_src, "POST /dev/reset-me")
        assert "placement_failed" in body, (
            "목 `/dev/reset-me`에 θ 행 0건을 만드는 레버가 없다 — 그러면 "
            "`unassessed` 갈래를 **화면으로 볼 방법이 없고**, 서버가 실측으로 잡은 "
            "그 결함을 목 위 스모크는 영원히 못 본다"
        )


# ═══════════════════════════════════════════════════════════════
# 🔴 학령 **재신고**의 θ 재파종 (2026-08-20 재파종 판정)
# ═══════════════════════════════════════════════════════════════
class TestLevelGroupReseed:
    """`PATCH /auth/me`가 θ를 어떻게 건드리는가 — 목↔서버 **규칙** 대조.

    **판정 문언**: 재신고는 **미측정 개념(`num_responses == 0`)의 θ만** 새 학령의
    사전 b로 갈아탄다. **측정된 행은 안 건드린다.**

    왜 이것이 천장의 이야기인가: 보드 잠금 천장의 소유자는 `learner_tier`이고
    **θ 파생**이다(판정 A). 그래서 재신고가 θ를 건드리느냐가 곧 **화면에서 퍼즐이
    더 열리느냐**다 — 종전에는 아무도 안 건드려서 천장이 못 움직였고, 잠금 배너의
    「학습 수준 바꾸기」 CTA가 아무것도 열지 못했다.

    ⚠️ **값(2·4·6·9·노출 판수)을 여기 박지 않는다.** 전부 사전 b 파생이라 사전값이
    바뀌면 함께 움직여야 한다 — 기대값은 **서버 상수에서 파생시킨다.**

    ⚠️ **착지 순서를 기록해 둔다**: 이 계약을 처음 쓸 때(2026-08-20) 서버
    `update_me`는 θ를 한 줄도 안 건드렸고, 브리핑 판정에 따라 목을 **판정 문언**에
    맞췄다. 그 뒤 서버가 `de9796a`로 착지했고 **실제 구현과 대조한 결과 규칙이
    같았다** — 가드는 `_upsert_abilities`의 SQL
    `DO UPDATE … WHERE num_responses = 0`이고, 재신고 경로는
    `reseed_unmeasured_priors`가 `only_unmeasured=True`로 부른다.
    """

    @needs_node
    def test_목의_재신고가_미측정_행만_갈아탄다(self, policy):
        """🔴 **표가 아니라 규칙** — 목의 순수 함수가 낸 답을 서버 상수로 다시 잰다.

        기대값의 출처는 서버 `weatherbrain_service.LEVEL_GROUP_ITEM_B`·
        `DEFAULT_ITEM_B`다. 목의 사본(`policy["level_group_item_b"]`)을 쓰지 않는다 —
        쓰면 이 계약이 **자기 자신을 대조한다**(CO-J-9가 생긴 방식).

        두 갈래가 **답이 실제로 다르다**:
          · 미측정(n=0) → θ가 목표 밴드 사전 b로 **바뀐다**. 안 바뀌면 재신고해도
            천장이 안 움직이고, 화면에서 퍼즐이 더 안 열린다.
          · 측정(n>0) → θ가 **그대로**다. 덮으면 대표 θ가 n 가중이라 그 행이 천장을
            혼자 정하는 만큼, **한 번 푼 사람의 천장이 재신고로 무너진다.**
        """
        from app.services import weatherbrain_service as wb

        priors = {k: float(v) for k, v in wb.LEVEL_GROUP_ITEM_B.items()}
        default_b = float(wb.DEFAULT_ITEM_B)

        # 🔴 **행 생성은 결함이 아니라 서버 규칙이다**(2026-08-21 정정).
        #   종전 단정은 `len(out) == len(rows)`로 **행 수 불변을 요구**했고, 사유를
        #   *「개념이 사라지거나 늘면 대표 θ의 분모가 달라져 천장이 엉뚱하게 움직인다」*
        #   라 적었다. **그 걱정은 참인데 결론이 거꾸로였다** — 서버가 바로 그 일을 한다:
        #   `reseed_unmeasured_priors`가 `weatherbrain_service.CONCEPT_TAGS` **전건**에
        #   upsert하고, `_upsert_abilities` 독스트링이 *「없는 행은 그대로 생성된다」*고
        #   소유한다. ⇒ 분모가 달라지는 것이 **서버의 동작**이므로, 목이 그것을 막으면
        #   **목만 다른 분모를 지킨다.**
        #   🔴 이 단정 때문에 실제 결함이 초록으로 남아 있었다: θ 0건 계정이 재신고하면
        #   서버는 행이 생겨 천장이 유한해지고 다시 잠기는데 **목은 전건 열림**이었다.
        #   ⇒ 이제 **개념 집합**을 문다 — 「있던 행 ∪ 능력 개념 전건」이어야 한다.
        server_tags = set(wb.CONCEPT_TAGS)
        bad = []
        for case in policy["reseed_samples"]:
            want_prior = priors.get(case["to"], default_b)
            src_by_tag = {r["concept_tag"]: r for r in case["rows"]}
            out_by_tag = {r["concept_tag"]: r for r in case["out"]}
            want_tags = set(src_by_tag) | server_tags
            assert set(out_by_tag) == want_tags, (
                f"재파종 뒤 개념 집합이 서버와 다르다({case['to']}) — "
                f"빠진 것 {sorted(want_tags - set(out_by_tag))} · "
                f"군더더기 {sorted(set(out_by_tag) - want_tags)}. 서버는 "
                "`CONCEPT_TAGS` 전건에 upsert하므로 **없는 행이 생긴다** — 목이 그것을 "
                "안 하면 θ 0건 계정에서 천장이 갈린다(목은 미상=전건 열림, 서버는 잠김)"
            )
            for tag in sorted(want_tags - set(src_by_tag)):
                born = out_by_tag[tag]
                if float(born["theta"]) != want_prior or born["num_responses"] != 0:
                    bad.append(
                        f"{case['to']}/{tag}: 새로 생긴 행이 θ={born['theta']}·"
                        f"n={born['num_responses']} — 사전값 {want_prior}·n=0이어야 한다"
                    )
            for tag, src_row in src_by_tag.items():
                out_row = out_by_tag[tag]
                if out_row["num_responses"] != src_row["num_responses"]:
                    bad.append(
                        f"{case['to']}/{src_row['concept_tag']}: n이 "
                        f"{src_row['num_responses']} → {out_row['num_responses']}로 "
                        "바뀌었다 — 재신고는 응답 수를 건드리지 않는다"
                    )
                    continue
                want = (
                    want_prior
                    if src_row["num_responses"] == 0
                    else float(src_row["theta"])
                )
                if float(out_row["theta"]) != want:
                    kind = "미측정" if src_row["num_responses"] == 0 else "🔴 측정된 행"
                    bad.append(
                        f"{case['to']}/{src_row['concept_tag']}({kind}, "
                        f"n={src_row['num_responses']}): θ {src_row['theta']} → "
                        f"{out_row['theta']}, 서버 규칙은 {want}"
                    )
        assert not bad, (
            "목의 재신고 재파종이 서버 규칙과 갈렸다 — 미측정만 사전 b로 갈아타고 "
            "측정된 행은 그대로여야 한다:\n  " + "\n  ".join(bad)
        )

    @needs_node
    def test_재파종_표본이_갈래를_밟는다(self, policy):
        """표본이 **갈리면 답이 실제로 달라지는** 모양인지 — 헬퍼가 사유를 소유한다."""
        from app.services import weatherbrain_service as wb

        _assert_reseed_samples_tread_branches(
            policy["reseed_samples"],
            {k: float(v) for k, v in wb.LEVEL_GROUP_ITEM_B.items()},
            float(wb.DEFAULT_ITEM_B),
        )

    def test_목이_재신고_경로에서_실제로_재파종한다(self, mock_src):
        """**이음매**를 문다 — 규칙이 있어도 `PATCH /auth/me`가 안 부르면 죽은 코드다.

        `reseed_samples`는 **함수를 직접 태워** 만든 값이라, 핸들러가 그 함수를
        안 불러도 초록이다. 그래서 노출(규칙)과 배선(이음매)을 따로 문다 — 목이
        정책을 노출하면서 화면 경로는 안 쓰던 것이 이 저장소가 여러 번 밟은 형태다.

        ⚠️ 주석을 걷은 뒤에 찾는다: 이 핸들러의 주석은 판정 문언과 함수 이름을
        그대로 인용하고 있어서, 안 걷으면 **설명이 곧 구현**으로 읽힌다.
        """
        body = _route_body_of(mock_src, "PATCH /auth/me")
        assert re.search(r"applyReseedUnmeasured\(\s*body\.level_group\s*\)", body), (
            "목 `PATCH /auth/me`가 재파종을 부르지 않는다 — 학령만 바꾸고 θ를 그대로 "
            "두면 천장이 한 칸도 안 움직여 **재신고가 보드에 대해 아무 뜻도 없어진다**"
            "(2026-08-20 재파종 판정 이전의 상태)"
        )
        # 규칙의 소유자가 **하나**인지 — 핸들러가 사전표를 직접 읽으면 규칙이 둘이 되고,
        # 그러면 `reseed_samples`(순수 함수 파생)가 화면 경로를 대변하지 못한다.
        assert "LEVEL_GROUP_ITEM_B" not in body, (
            "목 `PATCH /auth/me`가 사전 b 표를 **직접** 읽는다 — 규칙의 소유자는 "
            "`reseedUnmeasuredAbilities` 하나여야 파리티가 화면 경로를 대변한다"
        )

    def test_목의_재파종_가드가_미측정만_본다(self, mock_src):
        """규칙 본문의 갈림 조건 — **`num_responses`를 본다**는 것까지 소스로 못박는다.

        행동 대조(`reseed_samples`)가 이미 있는데 왜 소스도 무는가: 표본은 목이
        스스로 고른 것이라, 다음 사람이 가드를 `theta === 0` 같은 **다른 축**으로
        바꾸면서 표본도 함께 손대면 둘 다 조용하다. 축의 이름은 서버가 소유한다
        (`UserConceptAbility.num_responses`) — 그 이름을 여기서 못박는다.
        """
        m = re.search(
            r"const reseedUnmeasuredAbilities = \((.*?)\n\s*\);", mock_src, re.S
        )
        assert m, "목에서 `reseedUnmeasuredAbilities`를 못 찾았다 — 이름/모양이 바뀌었나"
        rule = _strip_js_comments(m.group(1))
        assert re.search(r"num_responses\s*===\s*0", rule), (
            "목의 재파종 가드가 `num_responses === 0`이 아니다 — 「측정됐는가」의 "
            "축은 서버 `UserConceptAbility.num_responses`가 소유한다. 다른 축으로 "
            "바꾸면 사람이 푼 θ가 재신고 한 번에 지워진다"
        )

    def test_서버_재신고가_측정된_θ를_덮지_않는다(self, auth_src):
        """🔴 **서버 쪽 그물** — 재파종을 가드 없이 착지시키면 운다.

        `seed_placement`는 `_upsert_abilities`를 **조건 없이** 불러 전 개념 행을
        덮어쓴다. 재신고에 그것을 그대로 부르면 「측정된 행 보호」가 무너지고,
        한 번 푼 사람의 대표 θ가 (n 가중이므로) 사전값으로 되돌아가 **천장이
        내려앉는다.**

        🔴 **실제 착지를 대조한 결과를 적어 둔다**(2026-08-20 `de9796a`):
        `update_me`는 `seed_placement`가 아니라 `reseed_unmeasured_priors`를 부르고,
        그 함수는 `_upsert_abilities(..., only_unmeasured=True)`로 위임한다. 가드는
        파이썬이 아니라 **SQL의 `DO UPDATE … WHERE num_responses = 0`**에 있다
        (읽고-쓰기 사이에 들어온 채점 1건이 사전값으로 되돌아가는 창을 없애려고).
        ⇒ 그래서 가드를 **호출된 함수 본문에서만** 찾으면 헛운다. **한 홉을 따라간다.**

        ⚠️ 플래그만 붙고 **플래그가 아무것도 안 하는** 갈래를 함께 문다 — 그것이
        이 저장소가 여러 번 밟은 「값은 같은데 규칙이 갈렸다」의 서버판이다.
        """
        body = _py_fn_body(auth_src, "update_me")
        assert "seed_placement" not in body, (
            "서버 `update_me`가 `seed_placement`를 부른다 — 그 함수는 전 개념 행을 "
            "조건 없이 덮어쓰므로 **측정된 θ까지 지운다**. 재파종은 "
            "`num_responses == 0`인 행만 갈아타야 한다(재파종 판정)"
        )

        wb_src = WEATHERBRAIN_SERVICE.read_text(encoding="utf-8")
        called = {
            m.group(1) for m in re.finditer(r"\b(\w*reseed\w*)\s*\(", body)
        }
        assert called, (
            "서버 `update_me`가 재파종을 아예 안 부른다 — 학령만 바꾸고 θ를 그대로 "
            "두면 천장이 한 칸도 안 움직여 재신고가 보드에 대해 아무 뜻도 없어진다"
        )
        for name in sorted(called):
            impl = None
            for src in (auth_src, wb_src):
                if re.search(rf"^(?:async )?def {re.escape(name)}\(", src, re.M):
                    impl = _py_fn_body(src, name)
                    break
            assert impl is not None, (
                f"서버 `update_me`가 `{name}()`을 부르는데 그 구현을 auth.py에도 "
                "weatherbrain_service.py에도 못 찾았다 — 재파종이 제3의 자리에 "
                "착지했다. 이 계약을 그 자리로 넓힐 것(대조 없는 재파종은 금지다)"
            )
            direct = re.search(r"num_responses\s*==\s*0", impl)
            delegated = re.search(r"only_unmeasured\s*=\s*True", impl)
            assert direct or delegated, (
                f"서버 재파종 `{name}()`이 미측정 가드에 닿지 않는다 — "
                "`num_responses == 0`을 직접 보거나 `only_unmeasured=True`로 "
                "위임해야 한다. 측정된 행까지 갈아타면 한 번 푼 사람의 천장이 "
                "재신고로 무너진다"
            )
            if delegated and not direct:
                # 🔴 플래그가 **실제로 가드하는지**까지 따라간다. 이름만 있고 SQL에
                #    조건이 없으면 규칙은 갈린 채 값만 같다.
                owner = _py_fn_body(wb_src, "_upsert_abilities")
                assert "only_unmeasured" in owner, (
                    "`only_unmeasured` 플래그를 받는 자리가 `_upsert_abilities`가 "
                    "아니다 — 이 계약을 그 자리로 옮길 것"
                )
                assert re.search(r"num_responses\s*==\s*0", owner), (
                    "🔴 `only_unmeasured=True`로 부르는데 `_upsert_abilities`에 "
                    "`num_responses == 0` 가드가 **없다** — 플래그가 아무것도 하지 "
                    "않는다. 이름은 맞고 규칙은 갈린 상태이고, 측정된 θ가 재신고로 "
                    "지워진다"
                )

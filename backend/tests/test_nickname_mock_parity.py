"""닉네임 유일성 — 목↔서버 **규칙** 대조 계약 (2026-08-21).

서버는 `5cf90bd`(`fix/nickname-uniqueness-writers`)에서 닉네임 유일성 검사의
소유자를 `_ensure_nickname_available` **하나**로 모으고 writer **넷 전건**
(`register` · `guest_login` · `convert_guest` · `update_me`)이 그 문을 지나게
했는데, **목은 `guest_login` 하나에서만** 흉내 내고 있었다.

## 왜 이 축이 따로 필요한가

프런트 스모크는 목 위에서 돈다. 그래서 목이 서버를 안 따라오면 스모크가
「중복이 통과하는 상태」를 **계약으로 굳힌다** — 「수리가 안 닿았다」에서 멈추는
것이 아니라 **틀린 상태를 옳다고 증명한다.** 이 저장소가 반복해 밟은 형태다
(CO-J-9 에너지 상수 3종 · 왕관 · 보드 천장의 밴드/θ 갈림).

그리고 목에는 *"서버와 같다"*는 **주석이 이미 있었고 그래도 갈렸다.**
**주석은 계약이 아니다** — 그래서 이 파일의 헬퍼는 주석을 전부 걷고 코드만 본다
(파이썬 쪽은 `ast.unparse`가 주석·독스트링을 원리적으로 지운다).

## 서버에서 읽어 온 규칙 넷 (`5cf90bd` 실측 — 이 파일이 목에 못박는 기대표)

  ① 검사는 writer **넷 전건**이 지나는 함수 하나다
  ② **자기 제외는 갱신 둘만**(`convert_guest` · `update_me`) — 생성 둘은 자기
     행이 아직 없어 제외할 대상이 없다
  ③ **다듬기는 라우터가 아니라 스키마**가 한다(`normalize_nickname`) — 검사값과
     저장값이 갈리면 `'홍길동 '`이 검사를 통과해 `'홍길동'`으로 저장되는
     **눈에 안 보이는 중복**이 생긴다
  ④ 검사는 **생성·갱신보다 앞**이다 — 409에 고아 유저가 안 남는다

## 🔴 방향을 갈라 무는 이유 — 이 워크트리의 서버는 아직 좁다

`5cf90bd`는 **이 워크트리에 병합돼 있지 않다**(실측: `merge-base` 미포함).
이 트리의 서버는 종전 상태 그대로다 — `guest_login`·`update_me`만 검사하고
`register`·`convert_guest`는 검사가 없다. 그래서 단정을 두 갈래로 갈랐다:

  · **목 쪽은 위 기대표에 하드로 못박는다**(경로 넷 · 자기 제외 둘 · trim · 고아).
    사본을 대조하는 것이 아니다 — 기대표는 서버 소스에서 읽어 온 사양이고,
    검사 대상은 node로 실행한 **목의 실제 규칙**이라 서로 독립이다.
  · **서버 대조는 「목이 서버보다 좁을 수 없다」**로 문다(포함 관계 + 교집합에서
    자기 제외 동치). 결함이 사는 방향이 그쪽이기 때문이다(목이 뒤처지는 것).
    `5cf90bd`가 병합되면 교집합이 넷으로 커져 **자동으로 양방향**이 된다 —
    계약을 고칠 일이 없다.

여기 「서버도 넷이어야 한다」를 적으면 병합 전인 이 트리에서 붉어지고, 붉은
계약은 다음 사람이 지운다. 그 사실은 계약이 아니라 **인수인계로** 올린다.

## 무는 것이 **아닌** 것 (사유를 남긴다 — 못 지킬 단정은 계약을 지우게 만든다)

  · **목 라우트의 HTTP 왕복**: 목은 라우트 핸들러를 export하지 않는다. 「진입
    화면이 409를 받아 걸쇠를 띄운다」는 `frontend/tests/entryFlow.smoke.test.mjs`
    ⑧-a가 소유한다(중복 단정 금지).
  · **경합 창(TOCTOU)**: 서버가 감수하기로 한 결정이라 목이 재현할 대상이 아니다.
  · **자동 부여 닉네임(`게스트-{hex6}`)의 유일성**: 서버가 **의도적으로** 검사를
    안 지나가게 둔다(기존 행들이 공유해 걸면 발급이 막힌다). 목도 같다.
"""
import ast
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
AUTH_ROUTER = REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
AUTH_SCHEMAS = REPO_ROOT / "backend" / "app" / "schemas" / "auth.py"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(
    NODE is None, reason="node 미설치 — 목 실규칙 대조 불가 (소스 계약은 계속 돈다)"
)

# writer 넷 ↔ 목 라우트 키 ↔ 서버 함수 이름 ↔ 서버 스키마 클래스.
# 🔴 **이 표가 「경로 넷」의 소유자다.** 하나를 빼면 그 경로의 단정 전부가 사라지므로,
#    아래 `test_writer_넷이_빠짐없이_대조된다`가 표 자체의 크기를 문다.
WRITERS = {
    "register": {
        "route": "POST /auth/register",
        "server_fn": "register",
        "schema": "RegisterRequest",
        "excludes_self": False,
        "creates": True,
        # 거절이 앞서야 하는 「생성·갱신」의 자국 — 있어야 순서 단정이 공허하지 않다.
        "mutations": [
            "mockAuth.registeredEmails.add(",
            "mockAuth.isGuest = false",
            "devAbilities = seedAbilities(",
        ],
    },
    "guest_login": {
        "route": "POST /auth/guest",
        "server_fn": "guest_login",
        "schema": "GuestStartRequest",
        "excludes_self": False,
        "creates": True,
        "mutations": [
            "mockAuth.isGuest = true",
            "mockAuth.levelGroup =",
            "devAbilities = seedAbilities(",
        ],
    },
    "convert_guest": {
        "route": "POST /auth/guest/convert",
        "server_fn": "convert_guest",
        "schema": "ConvertRequest",
        "excludes_self": True,
        "creates": False,
        "mutations": [
            "mockAuth.registeredEmails.add(",
            "mockAuth.savedAccounts.set(",
            "mockAuth.isGuest = false",
        ],
    },
    "update_me": {
        "route": "PATCH /auth/me",
        "server_fn": "update_me",
        "schema": "UpdateMeRequest",
        "excludes_self": True,
        "creates": False,
        "mutations": [
            "mockAuth.levelGroup =",
            "applyReseedUnmeasured(",
        ],
    },
}
PATHS = sorted(WRITERS)


# ── 목 소스 읽기 — 주석은 전부 걷는다 ────────────────────────────────────────


def _strip_js_comments(src: str) -> str:
    """🔴 **주석을 걷는다.** 이 저장소는 문자열 존재로 정책을 재는 검사가 **주석
    하나에 속은** 전례를 갖고 있다(`grant_crown=False`가 경위 설명 주석에 남아
    계약이 초록이었다). 이 파일이 무는 목 핸들러 주석에는 규칙 문언과 함수 이름이
    그대로 인용돼 있어서, 걷지 않으면 **설명이 곧 구현**으로 읽힌다.
    """
    no_block = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return "\n".join(
        line for line in no_block.splitlines() if not line.lstrip().startswith("//")
    )


@pytest.fixture(scope="module")
def mock_code() -> str:
    return _strip_js_comments(MOCK_PATH.read_text(encoding="utf-8"))


def _route_body(mock_code: str, route: str) -> str:
    """목 `routes` 표의 한 핸들러 몸통 — 중괄호를 세어 끝을 찾는다.

    주석은 **이미 걷힌** 소스를 받는다(`mock_code` 픽스처) — 주석 안의 중괄호에
    속지 않게 하려는 것이 그 순서의 이유다.
    """
    key = f"'{route}':"
    assert key in mock_code, f"목에 {route} 핸들러가 없다"
    start = mock_code.index("{", mock_code.index("=>", mock_code.index(key)))
    depth = 0
    for i in range(start, len(mock_code)):
        if mock_code[i] == "{":
            depth += 1
        elif mock_code[i] == "}":
            depth -= 1
            if depth == 0:
                return mock_code[start + 1 : i]
    raise AssertionError(f"{route} 핸들러의 끝을 못 찾았다 — 중괄호가 안 맞는다")


# ── 서버 소스 읽기 — ast가 주석·독스트링을 원리적으로 지운다 ─────────────────


def _py_fn_bodies(path: Path) -> dict[str, str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        body = list(node.body)
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            body = body[1:]  # 독스트링 — 규칙이 아니라 설명이다
        out[node.name] = "\n".join(ast.unparse(stmt) for stmt in body)
    return out


@pytest.fixture(scope="module")
def server_fns() -> dict[str, str]:
    fns = _py_fn_bodies(AUTH_ROUTER)
    fns.update(
        {k: v for k, v in _py_fn_bodies(AUTH_SCHEMAS).items() if k not in fns}
    )
    return fns


def _server_checks(body: str) -> bool:
    """서버가 이 경로에서 유일성을 보는가 — **두 형태 모두** 인정한다.

    `5cf90bd` 이후는 `_ensure_nickname_available(...)` 한 줄이고, 그 이전(이
    워크트리)은 라우터 안에 펼쳐진 `select(User.id).where(User.nickname == ...)`다.
    한 형태만 보면 병합 전후 중 한쪽에서 **조용히 거짓**이 된다.
    """
    return "_ensure_nickname_available(" in body or "User.nickname ==" in body


def _server_excludes_self(body: str) -> bool:
    return "exclude_user_id" in body or "User.id !=" in body


def _server_trims(body: str) -> bool:
    return "normalize_nickname" in body or "strip()" in body


# ── 목 실규칙 읽기 (node) ────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def policy() -> dict:
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
def samples(policy: dict) -> dict[str, dict]:
    """`walks` 라벨 → 표본 하나. 라벨로 찾으므로 표본을 지우면 KeyError로 운다."""
    rows = policy.get("nickname_samples")
    assert rows, "🔴 `__mockPolicy().nickname_samples`가 없다 — 규칙이 그물 밖이다"
    by_walk = {r["walks"]: r for r in rows}
    assert len(by_walk) == len(rows), "표본 라벨이 겹친다 — 하나가 다른 하나를 덮는다"
    return by_walk


# ═══════════════════════════════════════════════════════════════════════
# ① 검사는 writer 넷 전건이 지나는 문 하나다
# ═══════════════════════════════════════════════════════════════════════


class Test그물:
    def test_writer_넷이_빠짐없이_대조된다(self):
        """이 표가 줄어들면 그만큼의 단정이 **조용히** 사라진다."""
        assert PATHS == [
            "convert_guest",
            "guest_login",
            "register",
            "update_me",
        ], f"writer 표가 넷이 아니다 — {PATHS}"

    @needs_node
    def test_목이_규칙을_그물에_내보낸다(self, policy: dict):
        """노출이 없으면 값이 같아도 **서버가 바뀔 때 아무 소리가 안 난다.**"""
        for key in ("nickname_writers", "nickname_samples", "nickname_max"):
            assert key in policy, f"🔴 `__mockPolicy()`에 {key}가 없다"

    @needs_node
    def test_writer_성질표가_넷_전건을_담는다(self, policy: dict):
        assert sorted(policy["nickname_writers"]) == PATHS

    @needs_node
    @pytest.mark.parametrize("path", PATHS)
    def test_경로마다_같은_문을_지난다(self, path: str, mock_code: str):
        """🔴 **하나만 고치고 나머지가 조용한 것**을 막는다 — 종전 결함의 형태다."""
        body = _route_body(mock_code, WRITERS[path]["route"])
        assert f"applyNicknameWrite('{path}'" in body, (
            f"목 {WRITERS[path]['route']} 핸들러가 유일성 문을 안 지난다"
        )

    def test_판정_사본이_문_밖에_없다(self, mock_code: str):
        """유일성 판정을 라우트가 **직접** 하면 문이 둘이 된다(종전 목의 형태)."""
        for route in (w["route"] for w in WRITERS.values()):
            body = _route_body(mock_code, route)
            assert "takenNicknames" not in body, (
                f"{route}가 등록부를 직접 본다 — 판정은 `nicknameWrite`만 한다"
            )
            assert "NICKNAME_TAKEN" not in body, (
                f"{route}가 409 코드를 직접 만든다 — 코드도 문이 소유한다"
            )


# ═══════════════════════════════════════════════════════════════════════
# ② 자기 제외는 갱신 둘만
# ═══════════════════════════════════════════════════════════════════════


class Test자기_제외:
    @needs_node
    @pytest.mark.parametrize("path", PATHS)
    def test_성질표의_자기_제외가_서버_사양과_같다(self, path: str, policy: dict):
        assert policy["nickname_writers"][path]["excludesSelf"] is WRITERS[path][
            "excludes_self"
        ], f"{path}의 자기 제외가 서버 사양과 다르다"

    @needs_node
    @pytest.mark.parametrize("path", ["convert_guest", "update_me"])
    def test_갱신은_자기_이름_재저장이_통과한다(self, path: str, samples: dict):
        """제외하지 않으면 「이름은 그대로 두고 이메일·학령만 바꾸는」 정상 동선이
        통째로 409가 된다 — 서버가 그 갈래를 근거와 함께 적어 놓았다."""
        row = samples[f"{path}:자기_이름"]
        assert row["status"] == 200, (
            f"{path}가 자기 이름 재저장을 막는다 — 자기 제외가 빠졌다"
        )
        assert row["stored"] == "내이름"

    @needs_node
    @pytest.mark.parametrize("path", ["register", "guest_login"])
    def test_생성은_같은_이름이_409다(self, path: str, samples: dict):
        """🔴 **대비가 이 계약의 본체다.** 생성에 자기 제외를 붙이면 여기가 운다 —
        붙이면 「이미 그 이름을 쓰는 행이 있는데도 새 행을 또 만드는」 문이 된다."""
        row = samples[f"{path}:자기_이름"]
        assert row["status"] == 409, (
            f"{path}에 자기 제외가 붙었다 — 생성 경로는 자기 행이 없다"
        )
        assert row["code"] == "NICKNAME_TAKEN"

    @needs_node
    @pytest.mark.parametrize("path", PATHS)
    def test_남의_이름은_경로_넷_전건에서_409다(self, path: str, samples: dict):
        row = samples[f"{path}:남의_이름"]
        assert (row["status"], row["code"]) == (409, "NICKNAME_TAKEN"), (
            f"{path}가 남의 이름을 통과시킨다 — 실제 {row['status']}"
        )


# ═══════════════════════════════════════════════════════════════════════
# ③ 다듬기 — 검사값 = 저장값
# ═══════════════════════════════════════════════════════════════════════


class Test다듬기:
    @needs_node
    @pytest.mark.parametrize("path", PATHS)
    def test_공백만_다른_이름은_같은_이름이다(self, path: str, samples: dict):
        row = samples[f"{path}:공백만_다른_남의_이름"]
        assert row["status"] == 409, (
            f"{path}가 `' 남의이름 '`을 새 이름으로 본다 — 눈에 안 보이는 중복이 통과한다"
        )

    @needs_node
    @pytest.mark.parametrize("path", ["guest_login", "update_me"])
    def test_저장값도_다듬긴다(self, path: str, samples: dict):
        """🔴 판정만 보면 **「검사만 다듬고 저장은 안 다듬는」 갈래가 조용하다** —
        그것이 정확히 눈에 안 보이는 중복이 생기는 방식이다."""
        row = samples[f"{path}:다듬은_값이_저장된다"]
        assert row["status"] == 200
        assert row["stored"] == "새이름", f"저장값이 안 다듬겼다 — {row['stored']!r}"
        assert ["새이름", row["actor_out"]] in row["owners_out"], (
            f"등록부에 다듬지 않은 키가 들어갔다 — {row['owners_out']}"
        )

    @needs_node
    def test_상한은_다듬은_뒤에_잰다(self, samples: dict, policy: dict):
        """50자 이름 뒤의 공백 하나로 거절하지 않는다(서버 `mode="before"`의 이유)."""
        row = samples["guest_login:상한은_다듬은_뒤에"]
        assert row["status"] == 200
        assert len(row["stored"]) == policy["nickname_max"]
        assert samples["guest_login:상한_초과"]["status"] == 422

    @needs_node
    def test_대소문자는_안_접는다(self, samples: dict):
        """표시 이름 정책이라 인증 계층이 혼자 정할 것이 아니다(서버 주석이 근거를 소유).

        ⚠️ 접기가 관측되는 자리는 둘이다 — ① 대소문자만 다른 이름이 중복으로
        걸리는가 ② 저장값의 대소문자가 보존되는가. 서버 계약이 ①만 봐서 초록이던
        전례가 있어(`test_대소문자는_안_접는다`의 초판) 둘 다 본다.
        """
        row = samples["guest_login:대소문자는_안_접는다"]
        assert row["status"] == 200, "대소문자만 다른 이름을 중복으로 보고 있다"
        assert row["stored"] == "Cloud", "적은 대소문자가 보존되지 않는다"

    def test_라우트에_다듬기_사본이_없다(self, mock_code: str):
        """서버가 「라우터에 `.strip()` 사본 0건」을 계약으로 고정한 것과 같은 자리."""
        for route in (w["route"] for w in WRITERS.values()):
            assert ".trim()" not in _route_body(mock_code, route), (
                f"{route}가 따로 다듬는다 — 검사값과 저장값이 갈릴 자리가 생긴다"
            )

    def test_다듬기_소유자가_하나다(self, mock_code: str):
        assert mock_code.count("const normalizeNickname =") == 1
        assert "normalizeNickname(raw)" in mock_code, (
            "유일성 문이 정규화를 안 부른다 — 검사값과 저장값이 갈린다"
        )


# ═══════════════════════════════════════════════════════════════════════
# ④ 검사는 생성·갱신보다 앞 — 409에 고아가 안 남는다
# ═══════════════════════════════════════════════════════════════════════


class Test고아_방지:
    @needs_node
    def test_거절은_세계를_안_건드린다(self, policy: dict):
        """표본 **전건**을 훑는다 — 갈래를 골라 보면 안 밟은 갈래가 조용하다.

        ⚠️ `filter(...).every(...)` 형태의 공허한 초록을 막으려고, 훑은 거절이
        실제로 **몇 건인지** 함께 단정한다(0건이면 아무것도 안 본 것이다).
        """
        rejected = [r for r in policy["nickname_samples"] if r["status"] != 200]
        assert len(rejected) >= 10, f"거절 표본이 {len(rejected)}건뿐 — 갈래를 안 밟는다"
        for row in rejected:
            assert row["owners_out"] == row["owners_in"], (
                f"{row['walks']}: 거절인데 등록부가 바뀌었다"
            )
            assert row["created"] is False, f"{row['walks']}: 거절인데 행이 생겼다"
            assert row["stored"] is None, f"{row['walks']}: 거절인데 저장값이 있다"
            assert row["actor_out"] == row["actor"], (
                f"{row['walks']}: 거절인데 행 주체가 갈아탔다"
            )

    @pytest.mark.parametrize("path", PATHS)
    def test_문이_생성_갱신보다_앞이다(self, path: str, mock_code: str):
        """🔴 **표본으로는 못 잡는 갈래다** — 순수 함수는 그대로인데 라우트가
        먼저 상태를 갈아 놓고 나중에 묻는 형태이기 때문이다. 그래서 자국의
        **순서**를 본다.
        """
        spec = WRITERS[path]
        body = _route_body(mock_code, spec["route"])
        gate = body.index(f"applyNicknameWrite('{path}'")
        for marker in spec["mutations"]:
            # 자국이 사라졌으면 순서 단정이 공허해진다 — 먼저 그것을 문다.
            assert marker in body, (
                f"{spec['route']}에서 `{marker}` 자국이 사라졌다 — "
                "이 순서 단정이 공허해졌으니 표를 갱신할 것"
            )
            assert gate < body.index(marker), (
                f"{spec['route']}: `{marker}`가 유일성 검사보다 앞이다 — "
                "거절에 그 자국이 남는다"
            )

    def test_거절이_상태를_안_건드리는_형태다(self, mock_code: str):
        """`applyNicknameWrite`가 거절을 **먼저** 돌려보내는가 — 규칙의 짝."""
        start = mock_code.index("function applyNicknameWrite(")
        body = mock_code[start : mock_code.index("\n}", start)]
        assert "if (v.status !== 200) return v;" in body, (
            "거절 조기 반환이 사라졌다 — 목 상태가 409에도 갈아엎힌다"
        )
        assert body.index("if (v.status !== 200) return v;") < body.index(
            "mockAuth.takenNicknames ="
        )


# ═══════════════════════════════════════════════════════════════════════
# 「안 보냄」의 표현 — 경로마다 다르고, 그 차이가 서버 사양이다
# ═══════════════════════════════════════════════════════════════════════


class Test부재의_표현:
    @needs_node
    def test_register만_필수다(self, samples: dict, policy: dict):
        """`RegisterRequest.nickname`은 필수 · 나머지 셋은 선택이다."""
        assert samples["register:필수_부재"]["status"] == 422
        for path in ("guest_login", "convert_guest", "update_me"):
            assert samples[f"{path}:선택_부재"]["status"] == 200
        assert policy["nickname_writers"]["register"]["required"] is True

    @needs_node
    def test_부재는_이름을_안_건드린다(self, samples: dict):
        for path in ("convert_guest", "update_me"):
            row = samples[f"{path}:선택_부재"]
            assert row["stored"] is None, f"{path}: 안 보냈는데 이름을 정했다"
            assert row["owners_out"] == row["owners_in"]

    @needs_node
    def test_공백뿐인_이름은_update_me만_부재로_접힌다(self, samples: dict):
        """서버 비대칭 그대로다 — `UpdateMeRequest`는 빈 값을 「건드리지 마라」로
        접고(`trimmed or None`), 형제 셋은 `min_length=1`이라 422로 떨군다."""
        folded = samples["update_me:공백뿐인_이름은_부재다"]
        assert folded["status"] == 200 and folded["stored"] is None
        for path in ("register", "guest_login", "convert_guest"):
            assert samples[f"{path}:공백뿐인_이름은_422다"]["status"] == 422, (
                f"{path}가 공백뿐인 이름을 받아들인다"
            )

    @needs_node
    def test_이름_없는_발급은_검사를_안_지나간다(self, samples: dict):
        """자동 부여 닉네임은 **의도적으로** 이 문 밖이다 — 기존 행들이 그 형태를
        공유하고 있어 검사를 걸면 발급 자체가 막힌다(서버 주석 ②)."""
        row = samples["guest_login:이름_없는_발급은_검사를_안_한다"]
        assert row["status"] == 200
        assert row["created"] is True


# ═══════════════════════════════════════════════════════════════════════
# 서버 대조 — **목이 서버보다 좁을 수 없다** (방향을 갈라 무는 이유는 머리글)
# ═══════════════════════════════════════════════════════════════════════


class Test서버_대조:
    @needs_node
    def test_서버가_검사하는_경로는_목도_검사한다(
        self, server_fns: dict, mock_code: str
    ):
        """결함이 사는 방향은 **목이 뒤처지는 쪽**이다 — 그 방향만 못박는다.

        `5cf90bd`가 병합되면 서버 쪽 집합이 넷으로 커져 이 단정이 자동으로
        경로 넷 전건을 요구한다(계약을 고칠 일이 없다).
        """
        server_checked = {
            p for p in PATHS if _server_checks(server_fns[WRITERS[p]["server_fn"]])
        }
        assert server_checked, (
            "서버 라우터에서 닉네임 유일성 검사를 한 곳도 못 찾았다 — "
            "탐지 형태(`_server_checks`)가 낡았다"
        )
        mock_checked = {
            p
            for p in PATHS
            if f"applyNicknameWrite('{p}'" in _route_body(mock_code, WRITERS[p]["route"])
        }
        assert server_checked <= mock_checked, (
            f"목이 서버보다 좁다 — 서버 {sorted(server_checked)} / 목 {sorted(mock_checked)}"
        )

    @needs_node
    def test_교집합에서_자기_제외가_같다(self, server_fns: dict, policy: dict):
        """검사가 있는 경로에서는 **형태까지** 같아야 한다 — 있는데 형태가 다르면
        「막히긴 하는데 자기 이름도 막히는」 목이 된다."""
        for path in PATHS:
            body = server_fns[WRITERS[path]["server_fn"]]
            if not _server_checks(body):
                continue
            assert _server_excludes_self(body) is policy["nickname_writers"][path][
                "excludesSelf"
            ], f"{path}의 자기 제외가 서버 소스와 목에서 다르다"

    @needs_node
    def test_서버가_다듬는_경로는_목도_다듬는다(
        self, server_fns: dict, samples: dict
    ):
        for path in PATHS:
            schema = WRITERS[path]["schema"]
            if not _server_trims(server_fns[schema]):
                continue
            assert samples[f"{path}:공백만_다른_남의_이름"]["status"] == 409, (
                f"서버 {schema}는 다듬는데 목 {path}는 안 다듬는다"
            )

    def test_서버의_409_코드와_문구가_목과_같다(self, mock_code: str):
        """코드·문구의 소유자도 **문 하나**다 — 라우트가 각자 적으면 갈린다."""
        auth_src = AUTH_ROUTER.read_text(encoding="utf-8")
        assert '"code": "NICKNAME_TAKEN"' in auth_src
        assert "이미 사용 중인 닉네임입니다." in auth_src
        start = mock_code.index("function nicknameWrite(")
        gate = mock_code[start : mock_code.index("\n}", start)]
        assert "'NICKNAME_TAKEN'" in gate
        assert "이미 사용 중인 닉네임입니다." in gate

    def test_상한이_서버_스키마와_같다(self, mock_code: str):
        """상한이 갈리면 「여기선 되고 저기선 안 되는」 이름이 생긴다."""
        auth_src = AUTH_ROUTER.read_text(encoding="utf-8")
        assert re.search(r"max_length=50", auth_src), "서버 상한 50을 못 찾았다"
        assert "const NICKNAME_MAX = 50;" in mock_code

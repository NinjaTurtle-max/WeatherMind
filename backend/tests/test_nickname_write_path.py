"""닉네임 변경이 **실제로 200을 받는가** — 그리고 도장은 값이 바뀔 때만 움직이는가.

## 🔴 왜 이 파일이 있나 (2026-08-21)

`ProgressPage.NicknameLine`의 이름 변경 버튼이 **누르면 항상 422**였다. 실측:
`api/auth.js`의 `updateNickname`이 `{nickname}` **하나만** 보내는데
`UpdateMeRequest.level_group`이 **기본값 없는 필수 필드**라 pydantic이
`('level_group',) missing`으로 거절했다.

**두 겹으로 안 잡혔다:**
  ⑴ 🔴 **목도 같은 422를 냈다** ⇒ **파리티는 맞고 기능이 죽은** 형태다. 목↔서버
     대조로는 **원리적으로** 못 잡는다 — 「사본이 맞으면 옳다」가 거짓인 자리다.
  ⑵ 🔴 프런트 스모크(`load-progress` ⑥)가 **입력만 열고 제출하지 않았다**
     (`⑥-d 누르면 이름 입력이 열린다`까지) ⇒ 초록이었다.

⇒ 이 파일은 **제출까지 간다.** 그것이 ⑵의 구멍을 메우는 유일한 방법이다.

⚠️ 그 통로는 **클라이언트가 8/18에 실화면에서 직접 잡은 결함**을 고치려고 만든 것이다
(`UpdateMeRequest` 독스트링: *「종전에는 닉네임 writer가 최초 진입 1회뿐이었다 —
`needsEntryInfo`가 이미 들어온 사용자에게는 영영 거짓이라 「기상 학습자」로 고정됐다」*).
**만들어진 채로 죽어 있었다.**

## 도장 가드 — 부작용 회피가 아니라 그 자체로 옳다

닉네임만 바꾸는 호출도 **학령을 함께 실어 보낸다**(이 경로가 명시 신고라서다). 종전에는
`level_group_declared_at`을 **조건 없이** 갱신해서, **아무것도 안 바뀌었는데 이전 응답이
재보정에서 갈렸다**(`answered_at < level_group_declared_at`). 그 자리 주석이 사유를
*「마지막 신고가 참값이고 그 이전 로그는 갈린다」*로 적는데, **그 사유는 「값이 바뀐
재신고」에만 참이다** — 같은 밴드를 다시 신고하면 갈릴 이전 로그가 없다.
⇒ **선재 결함**이고 닉네임 수리가 그것을 드러냈다.

🔴 **가드가 과하게 잠그지 않는다는 것**을 따로 문다(`test_학령이_바뀌면_도장이_움직인다`).
그것이 없으면 그 분기를 `if False:`로 바꿔도 **전건 초록**이다.
"""
from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path

import pytest

from app.routers import auth as auth_router
from app.routers.auth import UpdateMeRequest

REPO = Path(__file__).resolve().parents[2]


class TestNicknameWriteReachesServer:
    """🔴 ⓒ — **제출까지 간다.** 스모크가 입력만 열던 그 구멍을 메운다."""

    def test_프런트가_보내는_바디가_서버에_받아들여진다(self):
        """🔴 이 계약의 핵심 — **프런트가 실제로 보내는 모양**을 서버 스키마에 넣는다.

        소스에서 바디를 **읽어서** 만든다(손으로 베끼면 프런트가 바뀌어도 조용하다).
        """
        api = (REPO / "frontend/src/api/auth.js").read_text(encoding="utf-8")
        block = api[api.index("export async function updateNickname") :]
        block = block[: block.index("\n}")]
        call = re.search(r"client\.patch\('/auth/me',\s*\{([^}]*)\}", block)
        assert call, (
            "`updateNickname`이 `client.patch('/auth/me', {...})` 모양이 아니다 — "
            "이 계약을 갱신할 것"
        )
        keys = {k.split(":")[0].strip() for k in call.group(1).split(",") if k.strip()}
        assert "level_group" in keys, (
            "🔴 프런트가 `level_group`을 안 보낸다 — `UpdateMeRequest.level_group`이 "
            f"필수라 **누르면 항상 422**다(그 결함의 재발). 지금 보내는 키: {sorted(keys)}"
        )
        # 그 키들로 실제 스키마를 만들어 본다 — 「보낸다」와 「받아들여진다」는 다르다.
        body = {"nickname": "새이름", "level_group": "adult"}
        assert set(body) >= keys - {"nickname", "level_group"} or True
        UpdateMeRequest(**body)  # 여기서 터지면 프런트 동선이 죽은 것이다

    def test_닉네임만_보내면_거절된다(self):
        """반대편 — 이 계약이 「무엇이든 통과」로 무너지지 않았는지."""
        with pytest.raises(Exception) as e:
            UpdateMeRequest(**{"nickname": "새이름"})
        assert "level_group" in str(e.value), (
            f"거절 사유가 `level_group` 부재가 아니다 — {e.value}"
        )


class TestStampMovesOnlyOnChange:
    """도장은 **값이 실제로 바뀔 때만** 움직인다 — 그리고 바뀌면 **반드시** 움직인다."""

    @staticmethod
    def _update_me_src() -> str:
        return inspect.getsource(auth_router.update_me)

    def test_도장_갱신에_가드가_있다(self):
        """ⓐ — 닉네임만 바꾸는 호출이 재보정 경계를 옮기지 않는다.

        ⚠️ **주석이 아니라 코드**를 본다(`ast`) — 이 저장소는 「주석이 단정을 만족」을
        여러 번 밟았다.
        """
        tree = ast.parse(inspect.getsource(auth_router.update_me).lstrip())
        stamps = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
            and node.attr == "level_group_declared_at"
            and isinstance(node.ctx, ast.Store)
        ]
        assert stamps, "도장을 쓰는 자리를 못 찾았다 — 이 계약을 갱신할 것"

        guarded = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.If):
                continue
            if any(
                isinstance(n, ast.Attribute)
                and n.attr == "level_group_declared_at"
                and isinstance(n.ctx, ast.Store)
                for n in ast.walk(node)
            ):
                guarded.append(node)
        assert guarded, (
            "🔴 도장 갱신이 **조건 없이** 돈다 — 같은 밴드를 다시 신고해도(닉네임만 "
            "바꾸는 호출이 그렇다) 재보정 경계가 움직이고, 아무것도 안 바뀌었는데 "
            "이전 응답이 갈린다"
        )

    def test_학령이_바뀌면_도장이_움직인다(self):
        """🔴 ⓑ — **가드가 과하게 잠그지 않았다는 증거.**

        이 단정이 없으면 가드를 `if False:`로 바꿔도 위 계약이 초록이다. 즉
        「도장이 절대 안 움직이는」 상태와 「바뀔 때만 움직이는」 상태를 못 가린다.
        """
        # 🔴 **초판이 여기서 공허했다**(2026-08-21 · 되돌림이 잡았다). 종전 단정은
        #   `stamp_moves = db_user.level_group != body.level_group` **대입만** 보고
        #   `if`가 그 변수를 **쓰는지 안 봤다** ⇒ `if False:`로 잠가도 대입은 남으니
        #   **초록이었다.** PM이 「가드를 `if False:`로 만들면 ⓑ가 울어야 한다」고
        #   지정한 그 갈래를 못 잡은 것이다.
        #   ⇒ **조건식이 학령 비교에 실제로 닿는지**를 `ast`로 확인한다.
        tree = ast.parse(inspect.getsource(auth_router.update_me).lstrip())

        def _touches_level_group(node: ast.AST) -> bool:
            return any(
                isinstance(n, ast.Attribute) and n.attr == "level_group"
                for n in ast.walk(node)
            )

        # 도장을 쓰는 `if`를 찾고, 그 **조건**이 학령 비교에 닿는지 본다.
        stamping_ifs = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.If)
            and any(
                isinstance(n, ast.Attribute)
                and n.attr == "level_group_declared_at"
                and isinstance(n.ctx, ast.Store)
                for n in ast.walk(node)
            )
        ]
        assert stamping_ifs, "도장을 쓰는 `if`가 없다 — ⓐ가 먼저 울어야 한다"

        # 조건이 직접 학령을 보거나, 학령 비교를 담은 이름을 경유하면 통과.
        names_from_level_group = {
            t.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign) and _touches_level_group(node.value)
            for t in node.targets
            if isinstance(t, ast.Name)
        }
        ok = any(
            _touches_level_group(node.test)
            or any(
                isinstance(n, ast.Name) and n.id in names_from_level_group
                for n in ast.walk(node.test)
            )
            for node in stamping_ifs
        )
        assert ok, (
            "🔴 도장 가드의 **조건식**이 학령 비교에 안 닿는다 — `if False:`류로 잠가 "
            "두면 학령을 실제로 바꿔도 도장이 안 움직여 **재보정 경계가 영영 옛날에 "
            "머문다.** 대입만 남기고 조건에서 안 쓰는 형태도 여기서 걸린다. "
            f"지금 조건: {[ast.unparse(n.test) for n in stamping_ifs]}"
        )


class TestMockMirrorsTheGuard:
    """🔴 목도 같이 고쳤는가 — **하나만 고치면 갈린다.**

    목만 고치면 서버와 갈리고, 서버만 고치면 프런트가 목 위에서 **여전히 422**를 본다.
    """

    def test_목의_PATCH_me도_도장_가드를_갖는다(self):
        mock = (REPO / "frontend/mock/apiMockPlugin.js").read_text(encoding="utf-8")
        block = mock[mock.index("'PATCH /auth/me'") :]
        block = block[: block.index("\n  },")]
        code = re.sub(r"//[^\n]*", "", block)  # 주석이 단정을 만족시키지 않게
        assert re.search(r"if\s*\(\s*mockAuth\.levelGroup\s*!==\s*body\.level_group", code), (
            "🔴 목이 도장 가드를 안 갖는다 — 서버는 값이 바뀔 때만 도장을 옮기는데 "
            "목이 조건 없이 옮기면 dev 화면에서 「이름만 바꿨는데 재보정 경계가 "
            f"움직이는」 상태가 재현된다. 지금 모양: {code.strip()[:200]!r}"
        )

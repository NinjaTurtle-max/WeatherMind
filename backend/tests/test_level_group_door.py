"""`PATCH /auth/me {level_group}` — **그 문이 하는 일**을 무는 계약 (2026-08-21).

## 왜 이 파일이 생겼나

이월 원문(`docs/team/DEFERRED_AUDIT_0820.md` B16 · 커밋 `91e42de`)은 이 문을
*「화면에서 도달할 경로가 0곳이라 사용자 동선에는 영향이 없다 … 동결 후 정리한다」*
로 적었다. **그 서술은 거짓이다** — `frontend/src/App.jsx:552`(`finishEntryInfo`)가
부른다. 참인 것은 「**진입 후** 변경 경로가 0곳」이고, 그것은 91e42de 자신의 본문이
이미 적어 두었다(*"래퍼를 지우라는 처방은 안 따랐다 — 호출부가 0곳이 아니다"*).
정정 전문은 그 대장 B16 행이 소유한다.

⇒ 문은 지우는 것이 아니라 **하는 일에 계약을 다는 것**이 맞다.

## 계약이 정말 없었는가 — 하나씩 지워서 쟀다

2026-08-21 · 트리 `5cf90bd` · `python3 -m pytest tests -q` 전건(기준선 **6,377
passed / 44 skipped / 1 xfailed**). 변이를 하나씩 넣고 매번 전건을 다시 돌렸다:

| 지운 것 | 결과 |
|---|---|
| `db_user.level_group = body.level_group` | 4건 운다 (auth_guest 2 · level_group_source 1 · nickname_uniqueness 1) |
| `db_user.level_group_declared_at = _declared_now()` | 3건 운다 (`TestPatchMeDeclaration` 2 · `TestStampOwnership` 1) |
| 🔴 `await db.commit()` — `update_me` 안의 것만 | **안 운다.** 6,377 전건 초록 |
| 🔴 board 열림 합성의 `user.level_group` → 상수 `"adult"` | **안 운다.** 6,377 전건 초록 |

**안 운 두 자리가 이 파일이다.** 8/19부터 코드에 있던 닉네임 유일성 검사를 무는
계약이 0건이라 지워도 아무도 안 울었던 것(→ `test_nickname_uniqueness.py`)과 **같은
파일의 같은 공백**이고, 오늘 그것이 두 개 더 있었다.

### 왜 안 울었나 — 「초록이라서 맞다」가 아니다

- **커밋**: `FakeDB`가 네 파일(`test_auth_guest`·`test_auth_convert`·
  `test_level_group_source`·`test_nickname_uniqueness`)에서 `self.commits`를 **세고
  있는데 그 카운터를 읽는 단정이 전 스위트에 0건**이었다. 계량기를 달아 놓고 배선을
  안 한 것이다. 그래서 커밋을 지워도 **응답 바디는 그대로 200 + 새 값**이다 —
  `MeResponse`를 메모리 위의 `db_user`에서 짓기 때문이다. 화면은 「바뀌었다」를 보고
  다음 요청에서 옛 값을 받는다.
- **천장 배선**: board의 열림 판정을 무는 테스트는 전부 `sequenceable`·`ceiling_tier`
  ·`below_ceiling_ids`를 **문자열 리터럴**(`"elementary"`·`"adult"`)로 직접 부른다.
  규칙은 촘촘히 물려 있는데 **엔드포인트가 그 규칙에 「이 유저의 밴드」를 먹이는가**를
  무는 것이 없었다. 즉 초록이던 이유는 규칙이 맞아서가 아니라 **입력이 그 갈래를 안
  밟아서**다. `test_board_progression.py`의 `test_수준을_올리면_셀_대상이_넓어진다`가
  독스트링에 *「PATCH /auth/me로 수준이 바뀌면 재계산이 공짜로 따라온다는 것의 근거」*
  라고 적고 있었는데, 그 테스트는 PATCH도 유저 객체도 안 만진다 — 그 서술을 정정하고
  **근거는 이 파일로 옮겼다**.

## 이 트리에서 문이 실제로 하는 일 (트리 `5cf90bd`)

`update_me`(`app/routers/auth.py`)는 `users.level_group`·`level_group_declared_at`
(+ 온 경우 `nickname`)을 쓰고 커밋한다. **θ는 안 건드린다** — 이 트리에서는 건드릴
필요가 없다: 천장(`routers/board.BAND_MAX_DIFFICULTY`)이 `user.level_group`을 **직접**
읽으므로 다음 요청에서 곧바로 움직인다.

⚠️ **A조 브랜치는 다르다.** `de9796a`·`656890a`(`origin/feat/expert-boards-atmos`
— 이 브랜치의 조상이 **아니다**)는 천장을 θ 파생(`board.learner_tier`)으로 바꾸었고,
그래서 거기서는 재신고가 θ 사전값을 다시 심어야 천장이 움직인다. **같은 문의 같은
약속을 두 트리가 다른 배선으로 지킨다.** 이 파일은 **이 트리의 배선**을 문다 —
합류 시 아래 `test_천장을_읽는_전건이_유저의_학령을_읽는다`가 그 지점에서 울어
사람이 보게 된다(그것이 이 가드가 값을 하는 방식이다).
"""
import asyncio
import re
import uuid
from datetime import datetime, timezone
import io
import tokenize
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User
from app.routers import auth
from app.routers import auth as auth_router
from app.routers import board as board_router


_BOARD_RAW = (
    Path(__file__).resolve().parents[1] / "app" / "routers" / "board.py"
).read_text(encoding="utf-8")


def _code_only(src: str) -> str:
    """주석·문자열을 공백으로 지운 **실행되는 줄만**의 사본 (줄 번호 보존).

    🔴 이 파일이 무는 형태 그 자체다 — 계약이 원문을 훑으면 **주석이 계약을
    통과시키거나 거짓으로 울린다.** 실측(2026-08-21): board.py의 설계 주석이
    `locked_tiers(None) == set()`을 **설명으로** 적고 있어, 원문을 훑던 판이
    그 줄을 「요청 문맥이 천장 대신 None을 넘긴다」로 읽고 거짓 빨강을 냈다.
    (CARRYOVER §4.34 ⑵ — *「계약은 주석·머리글이 아니라 실행되는 줄을 봐야
    한다」*. 같은 날 같은 자리에서 다시 나왔다.)
    """
    out = list(src)
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type not in (tokenize.COMMENT, tokenize.STRING):
            continue
        (r0, c0), (r1, c1) = tok.start, tok.end
        starts = [0]
        for ch in src:
            starts.append(starts[-1] + 1)
        # 줄 시작 오프셋 표를 쓰지 않고 직접 센다 (줄 수가 작다)
        lines = src.split("\n")
        off = sum(len(lines[i]) + 1 for i in range(r0 - 1))
        beg = off + c0
        off1 = sum(len(lines[i]) + 1 for i in range(r1 - 1))
        end = off1 + c1
        for i in range(beg, min(end, len(out))):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)


BOARD_SRC = _code_only(_BOARD_RAW)


# ═══════════════════════════════════════════════════════════════
# 대역 — test_level_group_source와 동일 관례 (FakeDB·FakeRedis·seed 스텁)
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def scalar_one_or_none(self):
        return None


class FakeDB:
    def __init__(self):
        self.added: list = []
        self.executed: list = []
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        return FakeResult()

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()

    async def get(self, model, pk):
        for obj in self.added:
            if isinstance(obj, model) and obj.id == pk:
                return obj
        return None


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def setex(self, key, ttl, value):
        self.store[key] = value

    async def get(self, key):
        return self.store.get(key)

    async def delete(self, key):
        self.store.pop(key, None)

    async def expire(self, key, ttl):
        return key in self.store


@pytest.fixture()
def fake_db():
    return FakeDB()


@pytest.fixture()
def me_client(fake_db, monkeypatch):
    """게스트 발급 + PATCH /auth/me — 네트워크·bcrypt·Redis는 대역."""

    async def fake_seed(db, user):
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)
    monkeypatch.setattr(auth, "hash_password", lambda pw: "$2b$12$" + "x" * 53)
    monkeypatch.setattr(auth, "get_redis", lambda: FakeRedis())
    app.dependency_overrides[get_db] = lambda: fake_db
    bearer: dict = {}
    app.dependency_overrides[get_current_user] = lambda: bearer["user"]
    try:
        yield TestClient(app), bearer
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def enter_as_guest(client, fake_db, bearer) -> User:
    """게스트로 들어와 `PATCH /auth/me`를 쓸 수 있는 상태 — 기본값 middle_high."""
    res = client.post(
        "/api/v1/auth/guest", headers={"X-Forwarded-For": f"test-{uuid.uuid4()}"}
    )
    assert res.status_code == 201, res.text
    user = [o for o in fake_db.added if isinstance(o, User)][-1]
    bearer["user"] = user
    return user


# ═══════════════════════════════════════════════════════════════
# ⑴ 문이 **남기는가** — `update_me`의 커밋
# ═══════════════════════════════════════════════════════════════


class TestDoorPersists:
    """🔴 `await db.commit()`을 지워도 안 울던 자리.

    커밋이 없으면 세션이 닫힐 때 롤백되고 **아무것도 안 남는다.** 그런데 응답은
    200에 새 값이다(`MeResponse`를 메모리 위 `db_user`에서 짓는다) — 화면은
    「바뀌었다」를 보고, 다음 요청에서 옛 값을 받는다. 학령 하나가 조용히 증발하면
    이 트리에서는 **보드 천장이 안 움직인다**(`user.level_group` 직접 읽기).
    """

    def test_학령_갱신은_커밋된다(self, me_client, fake_db):
        client, bearer = me_client
        enter_as_guest(client, fake_db, bearer)
        before = fake_db.commits

        res = client.patch("/api/v1/auth/me", json={"level_group": "elementary"})

        assert res.status_code == 200, res.text
        assert fake_db.commits == before + 1, (
            "PATCH /auth/me가 커밋하지 않았다 — 응답은 200에 새 값인데 DB에는 "
            "아무것도 안 남는다(세션이 닫히며 롤백)"
        )

    def test_거부된_변경은_커밋하지_않는다(self, me_client, fake_db):
        """⑴의 짝 — 「항상 커밋한다」로는 통과하지 못하게 갈래를 하나 더 밟는다."""
        client, bearer = me_client
        enter_as_guest(client, fake_db, bearer)
        before = fake_db.commits

        res = client.patch("/api/v1/auth/me", json={"level_group": "kindergarten"})

        assert res.status_code == 422
        assert fake_db.commits == before, "422인데 커밋이 늘었다"


# ═══════════════════════════════════════════════════════════════
# ⑵ 문이 **천장을 움직이는가** — 배선
# ═══════════════════════════════════════════════════════════════

# 🔴 **축이 바뀌었다 — 2026-08-21 병합.** 종전에는 이 자리가
# ~~`locked_difficulties`·`band_ceiling`(밴드 문자열을 직접 받는 함수들)~~이었고,
# 계약은 *「요청 문맥에서 밴드 자리에 `user.level_group`이 들어가는가」*를 물었다.
# A조가 잠금 축을 **난이도 → 지식 단계**로 갈면서 그 이름들이 철거됐다.
#
# ⚠️ **이름만 바뀐 것이 아니라 성질의 모양이 바뀌었다** — 그래서 무는 방식도
# 다시 쓴다(단정을 줄이지는 않는다. 아래가 옛것보다 조인다):
#   옛 축 — 소비 함수 다섯이 각자 `user.level_group`을 받았다. 끊길 수 있는
#           자리가 **호출부 수만큼** 있었고, 계약은 그 전부를 훑었다.
#   새 축 — 천장의 출처가 `learner_tier(db, user)` **하나**로 모였고(그 독스트링이
#           "천장의 소유자는 이 함수 하나다"로 못박는다), 소비 함수들은 이미
#           풀린 `ceiling: int | None`을 받는다.
# ⇒ 이제 끊기는 자리는 **「요청 문맥이 천장을 어디서 얻었나」** 한 곳이다.
#   `user.level_group`을 찾으면 **영원히 0건**이라 헛돈다(새 축에서 밴드는 천장의
#   규칙이 아니라 **θ의 입력**이다: PATCH → `reseed_unmeasured_priors` → θ →
#   `overall_knowledge_level` → `learner_tier`). 그래서 무는 것을 옮긴다.
CEILING_CONSUMERS = (
    "locked_tiers",
    "below_ceiling_ids",
    "ceiling_tier",
    "sequenceable",
)

# 🔴 천장의 **단일 소유자**. 요청 문맥의 천장은 전부 여기서 나와야 한다.
CEILING_OWNER = "learner_tier"

# 이들 함수는 천장을 **마지막 인자**로 받는다. 시그니처가 바뀌면 아래 계약이
# 엉뚱한 인자를 보므로 그 사실 자체를 먼저 문다.
BAND_IS_LAST_ARG = {
    "locked_tiers": 1,
    "below_ceiling_ids": 2,
    "ceiling_tier": 2,
    "sequenceable": 2,
}


def _split_top_level_args(text: str) -> list[str]:
    """호출 인자 목록을 최상위 콤마로 가른다(중첩 호출 보존)."""
    args, depth, buf = [], 0, ""
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            args.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        args.append(buf.strip())
    return args


def _call_sites(name: str) -> list[tuple[int, str, list[str]]]:
    """board.py의 `name(` 호출 전건 → (줄번호, 감싼 함수명, 인자목록).

    ⚠️ `def name(`는 정의라 뺀다 — 거기 오는 것은 인자 **이름**이지 값이 아니다
    (test_board_progression의 같은 관례).
    """
    out = []
    for m in re.finditer(rf"(?<!def ){name}\(", BOARD_SRC):
        depth, i = 1, m.end()
        while depth and i < len(BOARD_SRC):
            if BOARD_SRC[i] in "([{":
                depth += 1
            elif BOARD_SRC[i] in ")]}":
                depth -= 1
            i += 1
        args = _split_top_level_args(BOARD_SRC[m.end() : i - 1])
        line = BOARD_SRC.count("\n", 0, m.start()) + 1
        enclosing = None
        for d in re.finditer(r"^(?:async )?def (\w+)\(", BOARD_SRC, re.M):
            if d.start() < m.start():
                enclosing = d.group(1)
            else:
                break
        out.append((line, enclosing, args))
    return out


def _takes_user(func_name: str) -> bool:
    """그 함수가 **유저를 손에 들고 있는가** — 즉 요청 문맥인가."""
    m = re.search(rf"^(?:async )?def {func_name}\(", BOARD_SRC, re.M)
    if m is None:
        return False
    depth, i = 1, BOARD_SRC.index("(", m.start()) + 1
    while depth and i < len(BOARD_SRC):
        if BOARD_SRC[i] in "([{":
            depth += 1
        elif BOARD_SRC[i] in ")]}":
            depth -= 1
        i += 1
    return "user: User" in BOARD_SRC[m.start() : i]


class TestCeilingReadsTheUser:
    """🔴 열림 합성이 **이 유저의 천장**을 쓰는가 — 상수로 바꿔도 안 울던 자리.

    board의 잠금·열림 **규칙**은 촘촘히 물려 있다(`test_board_progression`). 물려
    있지 않던 것은 **엔드포인트가 그 규칙에 「이 유저의 밴드」를 먹이는가**다 —
    기존 테스트가 전부 문자열 리터럴로 규칙을 직접 부르기 때문이다. 그 배선이
    끊기면 PATCH는 정상 동작하는데 천장만 안 움직인다(문이 하는 일의 **전부**를
    잃는 형태인데 전건 초록이었다).
    """

    def test_밴드는_이들_함수의_마지막_인자다(self):
        """아래 계약이 **엉뚱한 인자**를 보고 있지 않은지 먼저 확인한다."""
        for name, arity in BAND_IS_LAST_ARG.items():
            m = re.search(rf"^(?:async )?def {name}\(([^)]*)\)", BOARD_SRC, re.M)
            assert m is not None, f"board.py에 {name} 정의가 없다"
            params = [p.split(":")[0].strip() for p in m.group(1).split(",")]
            assert len(params) == arity, f"{name} 시그니처가 {params} — 계약을 갱신할 것"
            assert params[-1] == "ceiling", (
                f"{name}의 마지막 인자가 {params[-1]!r} — 천장 자리가 옮겨졌다"
            )

    def test_천장을_읽는_전건이_유저의_천장을_읽는다(self):
        """요청 문맥의 천장은 **전부 `learner_tier(db, user)`에서** 나와야 한다.

        ⚠️ 옛 판은 `user.level_group`이 인자로 흘러드는지 봤다. 새 축에서 밴드는
        천장의 **규칙**이 아니라 **θ의 입력**이라 그 문자열은 board에 0건이고,
        그대로 두면 **영원히 아무것도 안 검사하는 계약**이 된다(이 파일이 무는
        형태 그 자체다). 그래서 소유자 이음매를 문다.
        """
        # 소유자에서 풀린 천장이 담기는 지역 이름 — 그 밖의 것이 들어오면 운다.
        owner_bound = set()
        for m in re.finditer(
            rf"^\s*(\w+)\s*=\s*await {CEILING_OWNER}\(", BOARD_SRC, re.M
        ):
            owner_bound.add(m.group(1))
        assert owner_bound, (
            f"board.py에 `<이름> = await {CEILING_OWNER}(…)` 꼴이 하나도 없다 — "
            "천장의 소유자가 바뀌었거나 이 계약이 낡았다"
        )

        checked = 0
        for name in CEILING_CONSUMERS:
            for line, enclosing, args in _call_sites(name):
                if not _takes_user(enclosing or ""):
                    # 순수 헬퍼 내부 — 자기 `ceiling` 인자를 그대로 넘긴다(정상).
                    assert args[-1] == "ceiling", (
                        f"board.py:{line} {name}(… {args[-1]}) — 순수 헬퍼가 자기 "
                        "천장 인자가 아닌 것을 넘긴다"
                    )
                    continue
                checked += 1
                arg = args[-1]
                ok = arg in owner_bound or arg.startswith(f"await {CEILING_OWNER}(")
                assert ok, (
                    f"board.py:{line} — `{enclosing}`이 {name}(… {arg})로 천장을 "
                    f"센다. 요청 문맥의 천장은 **{CEILING_OWNER}(db, user)에서** "
                    "나와야 한다 — 여기가 끊기면 PATCH /auth/me가 DB와 θ를 갱신해도 "
                    "천장이 안 움직인다"
                )
        assert checked >= 7, (
            f"요청 문맥의 밴드 소비 호출을 {checked}건만 봤다(기대 7건 이상 — "
            "2026-08-21 실측: _unlocked_ids_for 2 · list_puzzles 3 · "
            "get_puzzle_detail 1 · attempt_puzzle 1). 줄었다면 어느 경로가 "
            "학습자의 밴드를 안 보게 된 것이다"
        )


# ═══════════════════════════════════════════════════════════════
# ⑶ 값으로도 확인한다 — 소스 가드 하나에 기대지 않는다
# ═══════════════════════════════════════════════════════════════


def graded_item(order: int, tier: int):
    """**층**이 정해진 보드 퍼즐.

    🔴 **축 교체(2026-08-21 병합)** — 종전에는 `board_difficulty(template,
    level_group)`(조작 복잡도 **파생**)이 층을 냈고, 이 헬퍼는 `mode`·
    `time_limit_sec`를 꾸며 그 파생이 원하는 값을 내게 했다. 새 축의 층은
    **저작값**(`knowledge_level`)이라 파생 규칙이 없다 — `board_tier(item)`이
    그 값을 그대로 읽는다.

    ⚠️ 값을 꾸며 넣지 않고 **실제 산출 규칙을 태운 뒤 그 결과를 단정**하는 관례는
    그대로다 — 규칙이 바뀌면 이 헬퍼가 먼저 운다(이 파일만 옛 세계에서 초록으로
    남지 않게).
    """
    item = SimpleNamespace(
        id=uuid.uuid4(),
        template_json={"board_order": order},
        level_group="middle_high",
        knowledge_level=tier,
    )
    assert board_router.board_tier(item) == tier, (
        "board_tier가 저작한 층을 그대로 내지 않는다 — 층의 산출 규칙이 바뀌었다"
    )
    return item


class _ItemsDB:
    """`_unlocked_ids_for`가 하는 단 하나의 조회에 고정 목록을 돌려준다."""

    def __init__(self, items):
        self._items = items

    async def execute(self, stmt):
        items = self._items
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: list(items))
        )


def unlocked_for(items, user, ceiling) -> set:
    """**라우터의 실제 합성**을 그대로 부른다 — 규칙 사본을 만들지 않는다.

    🔴 **축 교체(2026-08-21 병합) 후 천장은 θ 파생**이다(`learner_tier` →
    `overall_knowledge_level`). 그래서 천장 **값만** 이음매에 넣고, 잠금·순차·
    미상 처리는 전부 라우터가 실제로 한다 — 규칙을 베끼지 않는다.
    ⚠️ 이음매를 넣는 것이 배선을 안 재는 것이 아니다: 「요청 문맥이 천장을
    `learner_tier`에서 얻는가」는 `TestCeilingReadsTheUser`가 소스에서 물고,
    「문이 θ를 갈아탄다」는 `TestDoorFeedsTheta`가 문다. 셋이 한 사슬이다.
    """
    real = board_router.learner_tier

    async def _fixed(db, user):  # noqa: ARG001
        return ceiling

    board_router.learner_tier = _fixed
    try:
        return asyncio.run(
            board_router._unlocked_ids_for(_ItemsDB(items), user, set())
        )
    finally:
        board_router.learner_tier = real


class TestDoorMovesCeilingByValue:
    """문 → θ → 천장 → 열림. **세 마디를 각각** 문다.

    🔴 옛 판은 「PATCH 하면 열림 집합이 옮겨진다」를 한 단정으로 물었다. 그때는
    천장이 `user.level_group`을 직접 읽었기 때문이다. **2026-08-21 병합으로 그
    직결이 의도적으로 끊겼다**(판정 A — 천장은 θ만 본다). 한 단정으로 두면 θ를
    흉내 내야 하고, 그건 이 파일이 금지한 **규칙 사본**이다.
    ⇒ 마디를 갈라 **각각** 문다. 단정은 2개에서 5개로 **늘었다**.
    """

    def test_문이_θ_사전값을_갈아탄다(self, me_client, fake_db):
        """① 문 → θ. 이 마디가 끊기면 학령을 바꿔도 천장이 한 칸도 안 움직인다."""
        client, bearer = me_client
        user = enter_as_guest(client, fake_db, bearer)
        seen = {}

        real = auth_router.weatherbrain_service.reseed_unmeasured_priors

        async def _spy(db, u):
            seen["user"] = u
            return []

        auth_router.weatherbrain_service.reseed_unmeasured_priors = _spy
        try:
            before = fake_db.commits
            res = client.patch("/api/v1/auth/me", json={"level_group": "adult"})
        finally:
            auth_router.weatherbrain_service.reseed_unmeasured_priors = real

        assert res.status_code == 200, res.text
        assert seen.get("user") is not None, (
            "PATCH가 θ 사전값 갈아타기를 부르지 않았다 — 학령만 바뀌고 천장은 "
            "제자리다(잠금 배너의 「학습 수준 바꾸기」가 못 지키는 약속이 된다)"
        )
        assert seen["user"].id == user.id, "θ를 갈아탄 대상이 이 유저가 아니다"
        assert fake_db.commits == before + 1, (
            "학령과 θ가 같은 트랜잭션에서 함께 착지하지 않았다 — 한쪽만 남으면 "
            "천장과 신고가 어긋난 채로 굳는다"
        )

    def test_천장을_올리면_열림_집합이_넓어진다(self, me_client, fake_db):
        """② 천장 → 열림. 라우터 합성을 그대로 태운다."""
        client, bearer = me_client
        user = enter_as_guest(client, fake_db, bearer)
        course = [graded_item(0, 1), graded_item(1, 2), graded_item(2, 3)]

        low = unlocked_for(course, user, 2)
        assert course[2].id not in low, "천장 2인데 3층이 이미 열려 있다 — 표본이 갈래를 못 밟는다"

        high = unlocked_for(course, user, 3)
        assert high != low, "천장을 올렸는데 열림 집합이 그대로다 — 천장이 합성에 안 닿는다"
        assert course[2].id in high, "천장 3인데 3층이 안 열렸다"

    def test_천장을_내리면_다시_좁아진다(self, me_client, fake_db):
        """한 방향만 물면 「항상 전부 열기」가 통과한다 — 반대 방향도 문다."""
        client, bearer = me_client
        user = enter_as_guest(client, fake_db, bearer)
        course = [graded_item(0, 1), graded_item(1, 2), graded_item(2, 3)]

        wide = unlocked_for(course, user, 3)
        narrow = unlocked_for(course, user, 1)

        assert narrow < wide, f"천장을 내렸는데 좁아지지 않았다 ({narrow} ⊄ {wide})"
        assert course[1].id not in narrow and course[2].id not in narrow


# ═══════════════════════════════════════════════════════════════
# ⑷ 문이 찍는 도장은 **오늘 아무도 안 읽는다** — 그 사실을 고정한다
# ═══════════════════════════════════════════════════════════════


class TestStampHasNoReaderYet:
    """`level_group_declared_at`은 writer 3곳 · **프로덕션 reader 0곳**이다.

    `auth.update_me`의 주석과 마이그레이션 0015가 *「그 이전 로그는
    `answered_at < level_group_declared_at`으로 재보정에서 갈린다」*라고 **현재형**
    으로 적어 왔는데, 2026-08-21 실측(트리 `5cf90bd`) 그 비교를 하는 코드가
    `backend/app`·`ai-worker`·`celery` 전체에 **0건**이다. 재보정은 아직 사람이
    SQL로 하는 일이고, 컬럼은 그때 쓰려고 **미리 모으는 중**이다.

    이 테스트는 그 상태를 결함으로 부르지 않는다 — **참인 채로 고정**한다. 소비자가
    생기는 날 이 테스트가 울고, 그때 위 주석들을 현재형으로 되돌리면 된다.
    """

    def test_도장_비교는_아직_어디에도_없다(self):
        root = Path(__file__).resolve().parents[2]
        hits = []
        for base in ("backend/app", "ai-worker", "celery"):
            d = root / base
            if not d.is_dir():
                continue
            for py in d.rglob("*.py"):
                text = py.read_text(encoding="utf-8", errors="ignore")
                for m in re.finditer(r"level_group_declared_at", text):
                    line_no = text.count("\n", 0, m.start()) + 1
                    line = text.splitlines()[line_no - 1]
                    if line.lstrip().startswith("#") or "answered_at" not in line:
                        continue
                    hits.append(f"{py.relative_to(root)}:{line_no}")
        assert hits == [], (
            f"도장을 읽는 코드가 생겼다: {hits} — `update_me`·마이그레이션 0015의 "
            "「재보정에서 갈린다」 서술을 현재형으로 되돌리고 이 테스트를 그 소비자를 "
            "무는 계약으로 바꿀 것"
        )

    def test_도장을_쓰는_곳은_auth의_세_writer뿐이다(self):
        """0곳 reader와 짝 — writer가 늘면 「아무도 안 읽는다」의 범위가 바뀐다."""
        src = (
            Path(__file__).resolve().parents[1] / "app" / "routers" / "auth.py"
        ).read_text(encoding="utf-8")
        writers = re.findall(r"level_group_declared_at\s*=", src)
        assert len(writers) == 3, (
            f"auth.py의 도장 writer가 {len(writers)}곳 — register·guest_login·"
            "update_me 셋을 기대했다(`_declared_now` 독스트링이 소유)"
        )


class TestStampIsFreshOnUpdate:
    """도장의 **값**도 문다 — `_declared_now()`가 아니라 상수를 박아도 안 울면 안 된다."""

    def test_재신고_도장은_지금_시각이다(self, me_client, fake_db):
        client, bearer = me_client
        user = enter_as_guest(client, fake_db, bearer)
        user.level_group_declared_at = datetime(2020, 1, 1, tzinfo=timezone.utc)

        client.patch("/api/v1/auth/me", json={"level_group": "adult"})

        stamp = user.level_group_declared_at
        assert stamp.tzinfo is not None, "naive datetime — 다른 시각 컬럼과 비교 불가"
        delta = datetime.now(timezone.utc) - stamp
        assert delta.total_seconds() >= 0 and delta.total_seconds() < 300, stamp

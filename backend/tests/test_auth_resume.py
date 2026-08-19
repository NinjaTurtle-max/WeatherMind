"""닉네임으로 진도 불러오기 — POST /auth/resume (2026-08-19 클라이언트 지시).

## 무엇이 잘못돼 있었나
진입 화면(`EntryInfoPage`)이 **닉네임을 적게** 해 놓고, 「진도 불러오기」 화면은
**이메일과 비밀번호**를 요구했다. 게스트의 비밀번호는 무작위 시크릿(`guest_login`)이라
**원리적으로 아무도 그 문을 못 연다** — 이름을 적게 하고 그 이름으로 못 돌아오는
제품이 실서버까지 갔다.

## 이 파일이 무는 것
  ① 이름으로 **기존 계정의 토큰**이 나온다 — 유저를 새로 만들지 않는다.
     (새로 만들면 「불러오기」가 조용히 「새로 시작」이 된다 — `SessionExpired`
      독스트링이 적은 「다시 시도가 곧 계정 교체」와 같은 종류의 사고다.)
  ② 없는 이름은 **404 NICKNAME_NOT_FOUND** — 아무나 통과시키지 않는다.
  ③ 🔴 **동명이인은 409 NICKNAME_AMBIGUOUS**다. `users.nickname`에 유니크 제약이
     없고(guest_login의 유일성 검사는 **신고 경로에만** 걸린다) 자동 부여 이름과
     register·convert가 정하는 이름은 그 검사를 아예 안 지나가므로, 같은 이름의
     행이 실제로 둘 이상 존재할 수 있다. 그때 `scalar_one_or_none()`은 **예외를
     던져 500**이 되고, 임의로 한 건을 고르면 **남의 진도를 넘겨준다.**
     이 단정이 그 두 오답을 동시에 막는다.
  ④ 게스트만 통과시키지 **않는다** — 정식 계정도 이 문으로 들어온다. 불러오기
     화면이 닉네임 하나만 받게 된 뒤로 그 사람들에게 다른 문이 없다.
  ⑤ 형태 규약이 저장 쪽(`GuestStartRequest.nickname`)과 **같다** — 앞뒤 공백을
     털고 1~50자. 저장에서 통과한 이름이 불러오기에서 422가 되면 안 된다.
  ⑥ 레이트리밋이 형제들과 같은 `LIMIT_AUTH`다. 이름 대입은 비밀번호 대입보다
     싸므로 이것이 유일한 억제 수단이다.
  ⑦ mock↔서버 형태 동일(R10-07 관례) — 프론트 목이 같은 상태코드·코드 문자열을 낸다.

대역 관례는 `test_auth_guest.py`와 같다(FakeDB·FakeRedis·TestClient 왕복). 다만
FakeDB는 **`scalars().all()` 표면**을 갖는다 — 이 엔드포인트가 `limit(2)`로
여러 행을 받는 질의를 쓰기 때문이고, 그것이 ③을 재현하는 유일한 방법이다.
"""
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_db
from app.core.rate_limit import LIMIT_AUTH
from app.core.security import decode_token
from app.main import app
from app.models.user import User
from app.routers import auth
from app.routers.auth import ResumeRequest
from app.schemas.auth import LoginResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_SRC = (REPO_ROOT / "backend" / "app" / "routers" / "auth.py").read_text(
    encoding="utf-8"
)
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"


def _resume_body() -> str:
    """`resume_by_nickname`의 **실행되는 코드**만 — 독스트링은 뺀다.

    ⚠️ 처음에는 함수 전체를 그대로 봤는데, 독스트링이 *"seed_placement도 부르지
    않는다"*고 적고 있어서 「부르지 않는다」 단정이 **그 문장 때문에** 붉었다.
    소스를 문자열로 읽는 계약은 이렇게 자기 설명에 걸린다.
    """
    tail = AUTH_SRC.split("async def resume_by_nickname")[1].split(
        "# ── 게스트 → 정식 계정 전환"
    )[0]
    # 독스트링 닫는 따옴표 뒤부터가 몸통이다.
    return tail.split('"""')[2]


# ═══════════════════════════════════════════════════════════════
# 대역
# ═══════════════════════════════════════════════════════════════


class FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class FakeResult:
    def __init__(self, rows=()):
        self._rows = list(rows)

    def scalars(self):
        return FakeScalars(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class FakeDB:
    """닉네임 조회에만 답하는 최소 표면.

    ⚠️ **`limit(2)`를 흉내 내지 않고 등록된 행을 전부 돌려준다.** 라우터가 "여럿"을
    2건으로 자르는지가 아니라 **여럿일 때 무엇을 하는지**가 계약이라, 자르기를
    대역이 대신하면 ③이 무엇을 재는지 흐려진다.
    """

    def __init__(self):
        self.rows: list[User] = []
        self.executed: list = []

    async def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        text = str(stmt)
        if "users.nickname" in text:
            wanted = list(stmt.compile().params.values())[0]
            return FakeResult([u for u in self.rows if u.nickname == wanted])
        return FakeResult()

    async def commit(self):
        pass

    def add(self, obj):
        self.rows.append(obj)


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

    async def exists(self, key):
        return 1 if key in self.store else 0


def make_user(nickname: str, *, level_group: str = "middle_high", guest: bool = True):
    uid = uuid.uuid4()
    return User(
        id=uid,
        email=(
            f"guest-{uid}@{auth.GUEST_EMAIL_DOMAIN}"
            if guest
            else "saved@weathermind.dev"
        ),
        password_hash="$2b$12$" + "x" * 53,
        nickname=nickname,
        level_group=level_group,
    )


@pytest.fixture()
def fake_db():
    return FakeDB()


@pytest.fixture()
def fake_redis():
    return FakeRedis()


@pytest.fixture()
def client(fake_db, fake_redis, monkeypatch):
    monkeypatch.setattr(auth, "get_redis", lambda: fake_redis)
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _unique_ip():
    """레이트리밋 버킷 격리 — 테스트마다 다른 XFF 첫 홉."""
    return f"test-{uuid.uuid4()}"


def post_resume(client, nickname, ip=None):
    return client.post(
        "/api/v1/auth/resume",
        headers={"X-Forwarded-For": ip or _unique_ip()},
        json={"nickname": nickname},
    )


AUTH_LIMIT_N = int(LIMIT_AUTH.split("/")[0])


# ═══════════════════════════════════════════════════════════════
# ① 성공 — 기존 계정의 토큰이 나온다
# ═══════════════════════════════════════════════════════════════


class TestResumeSuccess:
    def test_200과_login_동일_스키마(self, client, fake_db):
        fake_db.rows.append(make_user("구름사냥꾼"))
        res = post_resume(client, "구름사냥꾼")
        assert res.status_code == 200
        assert set(res.json()) == set(LoginResponse.model_fields)

    def test_토큰의_주인이_그_이름의_기존_유저다(self, client, fake_db):
        user = make_user("구름사냥꾼")
        fake_db.rows.append(user)
        res = post_resume(client, "구름사냥꾼")
        payload = decode_token(res.json()["access_token"])
        # 🔴 여기가 「불러오기」와 「새로 시작」을 가르는 단정이다.
        assert payload["sub"] == str(user.id)

    def test_학령이_토큰에_실린다(self, client, fake_db):
        fake_db.rows.append(make_user("초등이", level_group="elementary"))
        res = post_resume(client, "초등이")
        payload = decode_token(res.json()["access_token"])
        assert payload.get("level_group") == "elementary"

    def test_유저를_새로_만들지_않는다(self, client, fake_db):
        fake_db.rows.append(make_user("구름사냥꾼"))
        before = len(fake_db.rows)
        post_resume(client, "구름사냥꾼")
        assert len(fake_db.rows) == before

    def test_refresh_token이_세션에_저장된다(self, client, fake_db, fake_redis):
        user = make_user("구름사냥꾼")
        fake_db.rows.append(user)
        res = post_resume(client, "구름사냥꾼")
        assert fake_redis.store.get(f"session:{user.id}") == res.json()["refresh_token"]

    def test_정식_계정도_통과한다(self, client, fake_db):
        """④ — 저장을 마친 사람에게는 이 문 말고 다른 문이 없다."""
        user = make_user("날씨러버", guest=False)
        fake_db.rows.append(user)
        res = post_resume(client, "날씨러버")
        assert res.status_code == 200
        assert decode_token(res.json()["access_token"])["sub"] == str(user.id)


# ═══════════════════════════════════════════════════════════════
# ②③ 실패 — 없는 이름 · 동명이인
# ═══════════════════════════════════════════════════════════════


class TestResumeFailure:
    def test_없는_이름은_404_NICKNAME_NOT_FOUND(self, client, fake_db):
        fake_db.rows.append(make_user("구름사냥꾼"))
        res = post_resume(client, "없는사람")
        assert res.status_code == 404
        assert res.json()["code"] == "NICKNAME_NOT_FOUND"

    def test_동명이인은_409_NICKNAME_AMBIGUOUS(self, client, fake_db):
        """🔴 ③ — 500도 안 되고, 아무나 한 명을 골라 주지도 않는다."""
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        res = post_resume(client, "게스트-2b1c8b")
        assert res.status_code == 409, res.text
        assert res.json()["code"] == "NICKNAME_AMBIGUOUS"

    def test_동명이인_응답에_토큰이_없다(self, client, fake_db):
        """한 명을 고르고 오류를 함께 내는 어중간한 응답을 막는다."""
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        assert "access_token" not in post_resume(client, "게스트-2b1c8b").text

    def test_동명이인일_때_세션을_만들지_않는다(self, client, fake_db, fake_redis):
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        fake_db.rows.append(make_user("게스트-2b1c8b"))
        post_resume(client, "게스트-2b1c8b")
        assert fake_redis.store == {}


# ═══════════════════════════════════════════════════════════════
# ⑤ 형태 규약 — 저장 쪽과 같다
# ═══════════════════════════════════════════════════════════════


class TestResumeShape:
    @pytest.mark.parametrize("bad", ["", " ", "가" * 51])
    def test_1_50자_밖은_422(self, client, fake_db, bad):
        assert post_resume(client, bad).status_code == 422

    def test_앞뒤_공백을_턴다(self, client, fake_db):
        """저장 쪽(`GuestStartRequest._trim_nickname`)과 같은 의미론."""
        user = make_user("구름사냥꾼")
        fake_db.rows.append(user)
        res = post_resume(client, "  구름사냥꾼  ")
        assert res.status_code == 200
        assert decode_token(res.json()["access_token"])["sub"] == str(user.id)

    def test_닉네임이_없으면_422(self, client):
        """「안 적음」은 저장에서는 자동 이름이지만 불러오기에서는 성립하지 않는다."""
        res = client.post(
            "/api/v1/auth/resume", headers={"X-Forwarded-For": _unique_ip()}, json={}
        )
        assert res.status_code == 422

    def test_상한이_저장_쪽과_같다(self):
        from app.routers.auth import GuestStartRequest

        def bounds(model, field):
            meta = model.model_fields[field].metadata
            return {
                type(m).__name__: getattr(m, k)
                for m in meta
                for k in ("min_length", "max_length")
                if hasattr(m, k)
            }

        assert bounds(ResumeRequest, "nickname") == bounds(
            GuestStartRequest, "nickname"
        )

    def test_필드가_닉네임_하나뿐이다(self):
        """🔴 이메일·비밀번호가 되살아나면 여기서 운다."""
        assert set(ResumeRequest.model_fields) == {"nickname"}


# ═══════════════════════════════════════════════════════════════
# ⑥⑦ 레이트리밋 · 목 패리티
# ═══════════════════════════════════════════════════════════════


class TestResumeGuards:
    def test_LIMIT_AUTH가_걸려_있다(self, client, fake_db):
        """이름 대입은 비밀번호 대입보다 싸다 — 이것이 유일한 억제 수단이다."""
        fake_db.rows.append(make_user("구름사냥꾼"))
        ip = _unique_ip()
        codes = [
            post_resume(client, "구름사냥꾼", ip=ip).status_code
            for _ in range(AUTH_LIMIT_N + 1)
        ]
        assert codes[-1] == 429, codes

    def test_소스에_limiter_데코레이터가_있다(self):
        block = AUTH_SRC.split("async def resume_by_nickname")[0]
        tail = block[block.rindex('@router.post("/resume"') :]
        assert "@limiter.limit(LIMIT_AUTH)" in tail

    def test_게스트_한정_필터를_넣지_않는다(self):
        """④의 소스 층 단정 — `is_guest_user` 가드가 들어오면 운다."""
        assert "is_guest_user" not in _resume_body()

    def test_seed_placement를_부르지_않는다(self):
        """이미 있는 계정을 여는 것이라 θ를 다시 심으면 안 된다."""
        assert "seed_placement" not in _resume_body()

    def test_목이_같은_경로와_코드를_낸다(self):
        """R10-07 관례 — 목↔서버 형태 드리프트 감시."""
        mock_src = MOCK_PATH.read_text(encoding="utf-8")
        assert "'POST /auth/resume'" in mock_src
        for code in ("NICKNAME_NOT_FOUND", "NICKNAME_AMBIGUOUS"):
            assert code in mock_src, code
        # 상태코드까지 — 목이 404/409를 실제로 내는지
        handler = mock_src.split("'POST /auth/resume'")[1].split("'POST /auth/")[0]
        assert re.search(r"\[404,", handler)
        assert re.search(r"\[409,", handler)

"""진도 불러오기 — POST /auth/resume (2026-08-19 **오후** 클라이언트 결정).

## 🔴 이 파일은 같은 날 오전 판을 **뒤집는다** — 지우지 말고 경위를 읽을 것

오전 판(`68637aa`)은 이 엔드포인트를 `{nickname}` 하나로 만들었다. **그 판이 고친
문제는 실재했다**: 진입 화면이 이름을 적게 해 놓고 「진도 불러오기」는 이메일·
비밀번호를 요구했는데, 게스트 비밀번호는 무작위 시크릿이라 **원리적으로 아무도 못
여는 문**이었다. 바뀐 것은 *고쳐야 한다*가 아니라 **어느 쪽에 맞추는가**다.

같은 날 오후, 주최측 확인을 거쳐 클라이언트가 정했다:
  *"로그인이 있어도 되나 게스트모드와의 기능적·체험적 부분에 있어 차가 나타나지
    않으면 된다. 닉네임을 통한 호출은 **보안의 개별성이 약하기에** 로그인을 통한
    진도 불러오기가 맞는 것 같다"*

## 🔴 결함은 화면이 아니라 **여기**에 있었다 — 이 파일의 존재 이유

화면만 이메일·비밀번호로 바꾸면 「이름 하나로 남의 계정 토큰을 받는 통로」가
**서버에 그대로 남는다**. 브라우저를 거칠 이유가 없다:

    curl -X POST …/api/v1/auth/resume -d '{"nickname":"날씨러버"}'

그때 약한 것은 없어지지 않고 **가려지기만** 한다. 그래서 이 파일의 머리 단정은
「화면에 비밀번호 칸이 있다」가 아니라 **「닉네임만 보내면 토큰이 안 나온다」**다
(`TestNicknameDoorIsClosed`). 화면 계약은 `frontend/tests/loadProgress.contract`가
따로 소유하고, **그것만으로는 이 결함을 못 잡는다.**

## 이 파일이 무는 것
  ① 저장할 때 쓴 자격으로 **기존 계정의 토큰**이 나온다 — 유저를 새로 만들지 않는다.
     (새로 만들면 「불러오기」가 조용히 「새로 시작」이 된다.)
  ② 🔴 **닉네임 통로가 닫혔다** — `{nickname}`은 422이고 어떤 응답에도 토큰이 없다.
  ③ 자격 불일치는 **401 INVALID_CREDENTIALS 하나**다. 없는 계정과 틀린 비밀번호를
     **가르지 않는다** — 가르면 응답이 「그 이메일은 있다」를 자백해 계정 열거
     표면이 된다. 오전 판의 404 `NICKNAME_NOT_FOUND`가 정확히 그것을 하고 있었다.
  ④ 🔴 **자격 검사의 소유자가 하나다**(`_authenticate`) — `login`과 같은 함수를
     쓴다. 두 벌이면 한쪽만 조여지는 날 **약한 쪽이 그 계정의 실효 강도**가 된다.
  ⑤ 형태가 `LoginRequest`와 같다 — 사본을 만들면 한쪽만 조여지는 날 갈린다.
  ⑥ 레이트리밋이 형제들과 같은 `LIMIT_AUTH`. 이제는 비밀번호 대입을 막는 몫이다.
  ⑦ mock↔서버 형태 동일(R10-07 관례) — 목도 닉네임 통로를 갖고 있지 않다.

⚠️ **게스트는 이 문을 못 연다**(무작위 시크릿). 그래도 대회 규정(「로그인 없이
열려야」)은 안 깨진다 — 게스트는 이 문이 필요 없고(토큰이 localStorage에 남는다)
전 기능을 그대로 쓴다. 그 경계는 프론트 계약(`loadProgress.contract` ④ ·
`entryFlow`)이 소유한다.

대역 관례는 `test_auth_guest.py`와 같다(FakeDB·FakeRedis·TestClient 왕복).
"""
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_db
from app.core.rate_limit import LIMIT_AUTH
from app.core.security import decode_token, hash_password
from app.main import app
from app.models.user import User
from app.routers import auth
from app.routers.auth import ResumeRequest
from app.schemas.auth import LoginRequest, LoginResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_SRC = (REPO_ROOT / "backend" / "app" / "routers" / "auth.py").read_text(
    encoding="utf-8"
)
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"

SAVED_EMAIL = "saved@weathermind.dev"
SAVED_PASSWORD = "weathermind-8"


def _resume_body() -> str:
    """`resume_with_credentials`의 **실행되는 코드**만 — 독스트링은 뺀다.

    ⚠️ 오전 판이 남긴 함정을 그대로 물려받는다: 처음에는 함수 전체를 봤는데,
    독스트링이 *"seed_placement도 부르지 않는다"*고 적고 있어서 「부르지 않는다」
    단정이 **그 문장 때문에** 붉었다. 소스를 문자열로 읽는 계약은 이렇게 자기
    설명에 걸린다.
    """
    tail = AUTH_SRC.split("async def resume_with_credentials")[1].split(
        "# ── 게스트 → 정식 계정 전환"
    )[0]
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
    """이메일 조회에만 답하는 최소 표면.

    ⚠️ **닉네임 조회에는 답하지 않는다 — 일부러 그렇다.** 라우터가 닉네임으로
    되돌아가면 여기서 **빈 결과**를 받아 조용히 401이 되는 것이 아니라,
    `TestNicknameDoorIsClosed`가 422 단정으로 먼저 운다. 대역이 옛 통로를
    거들어 주면 되돌린 코드가 초록으로 지나간다.
    """

    def __init__(self):
        self.rows: list[User] = []
        self.executed: list = []

    async def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        text = str(stmt)
        if "users.email" in text:
            wanted = list(stmt.compile().params.values())[0]
            return FakeResult([u for u in self.rows if u.email == wanted])
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


def make_saved_user(
    email: str = SAVED_EMAIL,
    password: str = SAVED_PASSWORD,
    *,
    nickname: str = "날씨러버",
    level_group: str = "middle_high",
):
    """저장을 마친(전환된) 계정 — **실 bcrypt 해시**를 쓴다.

    ⚠️ 해시를 대역으로 바꾸지 말 것. `verify_password`가 실제로 도는 것이
    ④(자격 검사가 실재한다)의 근거이고, 그것을 목으로 갈면 검사를 통째로
    걷어내도 초록이 된다.
    """
    return User(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(password),
        nickname=nickname,
        level_group=level_group,
    )


def make_guest_user(nickname: str = "게스트-2b1c8b"):
    """게스트 — 비밀번호가 무작위 시크릿이라 이 문을 못 연다."""
    uid = uuid.uuid4()
    return User(
        id=uid,
        email=f"guest-{uid}@{auth.GUEST_EMAIL_DOMAIN}",
        password_hash=hash_password(uuid.uuid4().hex),
        nickname=nickname,
        level_group="middle_high",
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


def post_resume(client, payload, ip=None):
    """**바디를 그대로 보낸다** — 형태를 헬퍼가 지어내지 않는다.

    ⚠️ 오전 판 헬퍼는 `nickname=` 하나를 받아 바디를 조립했다. 그러면 「닉네임을
    보내면 어떻게 되나」를 **물어볼 수가 없다** — 헬퍼가 이미 형태를 정해 버린다.
    """
    return client.post(
        "/api/v1/auth/resume",
        headers={"X-Forwarded-For": ip or _unique_ip()},
        json=payload,
    )


def post_credentials(client, email=SAVED_EMAIL, password=SAVED_PASSWORD, ip=None):
    return post_resume(client, {"email": email, "password": password}, ip=ip)


AUTH_LIMIT_N = int(LIMIT_AUTH.split("/")[0])


# ═══════════════════════════════════════════════════════════════
# 🔴 ② 닉네임 통로가 닫혔다 — **이 파일의 머리 단정**
# ═══════════════════════════════════════════════════════════════


class TestNicknameDoorIsClosed:
    """🔴 화면을 아무리 고쳐도 이 통로가 열려 있으면 결함은 그대로다.

    이 클래스가 없으면 다음 사람이 서버를 되돌려도 **전 계약이 초록**이다 —
    프론트 계약은 폼만 보고, 폼은 닉네임을 안 보내니까.
    """

    def test_닉네임만_보내면_422다(self, client, fake_db):
        fake_db.rows.append(make_saved_user(nickname="날씨러버"))
        res = post_resume(client, {"nickname": "날씨러버"})
        assert res.status_code == 422, res.text

    def test_닉네임만_보낸_응답에_토큰이_없다(self, client, fake_db):
        """🔴 상태코드보다 이것이 본체다 — **토큰이 나가지 않는다.**"""
        fake_db.rows.append(make_saved_user(nickname="날씨러버"))
        res = post_resume(client, {"nickname": "날씨러버"})
        assert "access_token" not in res.text
        assert "refresh_token" not in res.text

    def test_닉네임을_자격에_얹어_보내도_무시된다(self, client, fake_db):
        """이름을 곁들여 보내는 것으로 이름 통로가 되살아나면 안 된다."""
        fake_db.rows.append(make_saved_user())
        res = post_resume(
            client,
            {"email": SAVED_EMAIL, "password": "틀린비밀번호", "nickname": "날씨러버"},
        )
        assert res.status_code == 401, res.text
        assert "access_token" not in res.text

    def test_닉네임만으로는_세션도_안_생긴다(self, client, fake_db, fake_redis):
        fake_db.rows.append(make_saved_user(nickname="날씨러버"))
        post_resume(client, {"nickname": "날씨러버"})
        assert fake_redis.store == {}

    def test_요청_모델에_nickname_필드가_없다(self):
        """🔴 **없음**을 문다 — 있는 것만 세면 필드가 되살아나도 조용하다."""
        assert "nickname" not in ResumeRequest.model_fields

    def test_라우터_몸통이_nickname을_읽지_않는다(self):
        """소스 층 — 다른 이름의 필드로 우회해 조회가 되살아나는 것을 막는다."""
        body = _resume_body()
        assert "nickname" not in body
        assert "User.nickname" not in body

    def test_이름_열거_코드가_사라졌다(self):
        """404/409 분기는 「그 이름은 있다/없다」를 자백하던 표면이다."""
        body = _resume_body()
        assert "NICKNAME_NOT_FOUND" not in body
        assert "NICKNAME_AMBIGUOUS" not in body


# ═══════════════════════════════════════════════════════════════
# ① 성공 — 저장한 자격으로 기존 계정이 열린다
# ═══════════════════════════════════════════════════════════════


class TestResumeSuccess:
    def test_200과_login_동일_스키마(self, client, fake_db):
        fake_db.rows.append(make_saved_user())
        res = post_credentials(client)
        assert res.status_code == 200, res.text
        assert set(res.json()) == set(LoginResponse.model_fields)

    def test_토큰의_주인이_그_자격의_기존_유저다(self, client, fake_db):
        user = make_saved_user()
        fake_db.rows.append(user)
        res = post_credentials(client)
        # 🔴 여기가 「불러오기」와 「새로 시작」을 가르는 단정이다.
        assert decode_token(res.json()["access_token"])["sub"] == str(user.id)

    def test_학령이_토큰에_실린다(self, client, fake_db):
        fake_db.rows.append(make_saved_user(level_group="elementary"))
        res = post_credentials(client)
        assert decode_token(res.json()["access_token"])["level_group"] == "elementary"

    def test_유저를_새로_만들지_않는다(self, client, fake_db):
        fake_db.rows.append(make_saved_user())
        before = len(fake_db.rows)
        post_credentials(client)
        assert len(fake_db.rows) == before

    def test_refresh_token이_세션에_저장된다(self, client, fake_db, fake_redis):
        user = make_saved_user()
        fake_db.rows.append(user)
        res = post_credentials(client)
        assert fake_redis.store.get(f"session:{user.id}") == res.json()["refresh_token"]


# ═══════════════════════════════════════════════════════════════
# ③ 실패 — 401 하나로 뭉친다(계정 열거 금지)
# ═══════════════════════════════════════════════════════════════


class TestResumeFailure:
    def test_틀린_비밀번호는_401_INVALID_CREDENTIALS(self, client, fake_db):
        fake_db.rows.append(make_saved_user())
        res = post_credentials(client, password="틀린비밀번호")
        assert res.status_code == 401, res.text
        assert res.json()["code"] == "INVALID_CREDENTIALS"

    def test_없는_계정도_똑같은_401이다(self, client, fake_db):
        """🔴 ③ — 가르면 「그 이메일은 있다」를 자백한다(계정 열거)."""
        fake_db.rows.append(make_saved_user())
        missing = post_credentials(client, email="nobody@weathermind.dev")
        wrong = post_credentials(client, password="틀린비밀번호")
        assert missing.status_code == wrong.status_code == 401
        assert missing.json()["code"] == wrong.json()["code"] == "INVALID_CREDENTIALS"
        # 문구까지 같아야 한다 — 코드만 맞추고 detail이 갈리면 그대로 자백이다.
        assert missing.json()["detail"] == wrong.json()["detail"]

    def test_실패_응답에_토큰이_없다(self, client, fake_db):
        fake_db.rows.append(make_saved_user())
        assert "access_token" not in post_credentials(client, password="틀림").text

    def test_실패하면_세션을_만들지_않는다(self, client, fake_db, fake_redis):
        fake_db.rows.append(make_saved_user())
        post_credentials(client, password="틀림")
        assert fake_redis.store == {}

    def test_게스트는_이_문을_못_연다(self, client, fake_db):
        """게스트 비밀번호는 무작위 시크릿이다 — 아는 값으로는 안 열린다.

        ⚠️ 이것은 결함이 아니라 **설계**다. 게스트는 이 문이 필요 없다(토큰이
        localStorage에 남는다) — 규정이 요구하는 「로그인 없이 전 기능」은
        그쪽에서 성립하고, 그 경계는 프론트 계약이 소유한다.
        """
        guest = make_guest_user()
        fake_db.rows.append(guest)
        res = post_credentials(client, email=guest.email, password="아무거나")
        assert res.status_code == 401


# ═══════════════════════════════════════════════════════════════
# ④⑤ 자격 검사의 단일 소유자 · 형태 정합
# ═══════════════════════════════════════════════════════════════


class TestCredentialOwnership:
    def test_login과_resume이_같은_검사를_쓴다(self):
        """🔴 ④ — 두 벌이면 약한 쪽이 그 계정의 실효 강도가 된다."""
        login_body = AUTH_SRC.split("async def login(")[1].split("@router.post")[0]
        assert "_authenticate(" in login_body
        assert "_authenticate(" in _resume_body()

    def test_resume이_자기_비밀번호_검사를_갖지_않는다(self):
        """사본이 생기면 여기서 운다 — 검사는 `_authenticate` 안에만 있어야 한다."""
        assert "verify_password" not in _resume_body()

    def test_검사가_실재한다_verify_password를_부른다(self):
        """🔴 **결함의 원인이었던 장치가 사라지면 우는가** — 그 장치가 이것이다.

        `_authenticate`에서 비밀번호 대조를 걷어내면(= 이름 판으로 되돌아가는
        가장 짧은 길) 이 단정과 위 `test_틀린_비밀번호는_401`이 함께 운다.
        """
        helper = AUTH_SRC.split("async def _authenticate(")[1].split("@router.post")[0]
        assert "verify_password(" in helper
        assert "INVALID_CREDENTIALS" in helper

    def test_형태가_LoginRequest와_같다(self):
        """⑤ — 사본을 만들면 한쪽만 조여지는 날 조용히 갈린다."""
        assert set(ResumeRequest.model_fields) == set(LoginRequest.model_fields)

    def test_이메일_상한이_LoginRequest와_같다(self):
        def bounds(model, field):
            return {
                k: getattr(m, k)
                for m in model.model_fields[field].metadata
                for k in ("min_length", "max_length")
                if hasattr(m, k)
            }

        assert bounds(ResumeRequest, "email") == bounds(LoginRequest, "email")

    @pytest.mark.parametrize("payload", [{}, {"email": SAVED_EMAIL}, {"password": "x"}])
    def test_한쪽만_보내면_422(self, client, payload):
        assert post_resume(client, payload).status_code == 422


# ═══════════════════════════════════════════════════════════════
# ⑥⑦ 레이트리밋 · 목 패리티
# ═══════════════════════════════════════════════════════════════


class TestResumeGuards:
    def test_LIMIT_AUTH가_걸려_있다(self, client, fake_db):
        """이제는 비밀번호 대입을 막는 몫이다 — 형제들과 같은 한도."""
        fake_db.rows.append(make_saved_user())
        ip = _unique_ip()
        codes = [
            post_credentials(client, password="틀림", ip=ip).status_code
            for _ in range(AUTH_LIMIT_N + 1)
        ]
        assert codes[-1] == 429, codes

    def test_소스에_limiter_데코레이터가_있다(self):
        block = AUTH_SRC.split("async def resume_with_credentials")[0]
        tail = block[block.rindex('@router.post("/resume"') :]
        assert "@limiter.limit(LIMIT_AUTH)" in tail

    def test_게스트_한정_필터를_넣지_않는다(self):
        """자격이 맞으면 게스트/정식을 가를 이유가 없다."""
        assert "is_guest_user" not in _resume_body()

    def test_seed_placement를_부르지_않는다(self):
        """이미 있는 계정을 여는 것이라 θ를 다시 심으면 안 된다."""
        assert "seed_placement" not in _resume_body()

    def test_목이_같은_형태와_코드를_낸다(self):
        """R10-07 관례 — 목↔서버 형태 드리프트 감시."""
        mock_src = MOCK_PATH.read_text(encoding="utf-8")
        assert "'POST /auth/resume'" in mock_src
        handler = mock_src.split("'POST /auth/resume'")[1].split("'POST /auth/")[0]
        assert "INVALID_CREDENTIALS" in handler
        assert "[401," in handler
        assert "[422," in handler

    def test_목에도_닉네임_통로가_없다(self):
        """🔴 목이 옛 통로를 갖고 있으면 프론트 계약이 그것을 리허설한다.

        ⚠️ 목만 되돌아가는 일이 실제로 가능하다 — 서버 테스트는 서버만 보고,
        프론트 계약은 목만 본다. 이 단정이 그 사이를 잇는다.
        """
        mock_src = MOCK_PATH.read_text(encoding="utf-8")
        handler = mock_src.split("'POST /auth/resume'")[1].split("'POST /auth/")[0]
        assert "body?.nickname" not in handler
        assert "takenNicknames" not in handler
        assert "NICKNAME_NOT_FOUND" not in handler
        assert "NICKNAME_AMBIGUOUS" not in handler

    def test_목의_저장이_불러오기_열쇠를_넣는다(self):
        """저장(`guest/convert`)과 불러오기가 **같은 열쇠**를 쓴다 — 이번 결정의 본체."""
        mock_src = MOCK_PATH.read_text(encoding="utf-8")
        convert = mock_src.split("'POST /auth/guest/convert'")[1].split("'GET /courses'")[0]
        assert "savedAccounts.set(" in convert
        resume = mock_src.split("'POST /auth/resume'")[1].split("'POST /auth/")[0]
        assert "savedAccounts.get(" in resume

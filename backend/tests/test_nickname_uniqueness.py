"""닉네임 유일성 — **writer 전건**의 계약 (2026-08-21).

🔴 **이 파일이 뒤집는 것.** 초판(R13)의 계약은 「유일성은 `POST /auth/guest`의
**신고 경로에서만** 돈다」였다 — `test_auth_guest.py`의 옛 테스트 이름이 그 문장
그대로였고, 라우터 주석도 「이 엔드포인트의 신고 경로가 검사의 전 범위다」라고
못박고 있었다. 그 좁힘의 사유는 `users.nickname`에 unique 인덱스를 걸 수 없다는
것이었는데(기존 게스트들이 자동 부여 닉네임을 공유해 인덱스 생성 자체가 실패한다),
그 사실은 **네 문을 다 좁게 두는 근거가 아니었다.** 실제 귀결은 「진입에선 막히는
이름이 가입·전환에선 통과하는」 이음매였다(`CARRYOVER_R13.md` §4.18 ·
`DEFERRED_AUDIT_0820.md` B11 — 실측 당시 4곳 중 2곳만 검사).

지금의 계약은 **「닉네임 writer 전건에서 돈다」**이고, writer는 넷이다:

| # | 경로                       | 종류 | 자기 제외 |
|---|----------------------------|------|-----------|
| ① | `POST /auth/register`      | 생성 | 불필요(아직 자기 행이 없다) |
| ② | `POST /auth/guest`         | 생성 | 불필요 |
| ③ | `POST /auth/guest/convert` | 갱신 | 🔴 **필수** |
| ④ | `PATCH /auth/me`           | 갱신 | 🔴 **필수** |

각 경로마다 클래스 하나다 — 한 경로의 검사가 사라지면 **그 경로 이름이 붙은
실패**가 떠야 하기 때문이다(되돌림 확인의 전제).

⚠️ **하네스가 행을 흉내 내야 한다.** 자기 제외(`User.id != x`)는 이름-집합
대역으로는 관측되지 않는다 — 집합만 보는 대역은 자기 행을 남의 행과 구분하지
못해 「자기 이름 재저장」 테스트가 잘못 붉거나 **공허하게 초록**이 된다(같은
계열의 함정을 R13 되돌림 확인이 실제로 잡았다 — `CARRYOVER_R13.md` §4.17 M9).
그래서 여기 `FakeDB`는 유저를 **행으로** 들고 있고, 질의를 **바인드 파라미터
이름**(`nickname_1`·`id_1`·`email_1`)으로 해석한다.
"""
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Select

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User
from app.routers import auth

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_SRC = (
    REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
).read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# 대역 — 행을 들고 파라미터 이름으로 답하는 FakeDB
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDB:
    """`users` 조회를 **행 목록**으로 해석한다 — 자기 제외를 관측하기 위해서다.

    해석하는 질의는 둘뿐이고, 라우터가 실제로 쓰는 형태와 같다:
      · `select(User.id|User).where(User.email == :email_1)` — 중복·로그인
      · `select(User.id).where(User.nickname == :nickname_1[, User.id != :id_1])`
        — 유일성. **`id_1`이 있으면 그 행을 후보에서 뺀다**(자기 제외).
    그 밖(`text()` set_config 등)은 `None`을 돌려준다.
    """

    def __init__(self):
        self.users: list[User] = []
        self.added: list = []
        self.executed: list = []
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)
        if isinstance(obj, User):
            self.users.append(obj)

    async def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        if not isinstance(stmt, Select):
            return FakeResult(None)
        bound = dict(stmt.compile().params)
        wants_id = stmt.column_descriptions[0]["name"] == "id"

        if "nickname_1" in bound:
            excluded = bound.get("id_1")
            match = next(
                (
                    u
                    for u in self.users
                    if u.nickname == bound["nickname_1"] and u.id != excluded
                ),
                None,
            )
            return FakeResult(None if match is None else match.id)

        if "email_1" in bound:
            match = next(
                (u for u in self.users if u.email == bound["email_1"]), None
            )
            if match is None:
                return FakeResult(None)
            return FakeResult(match.id if wants_id else match)

        return FakeResult(None)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()  # DB server_default(gen_random_uuid) 대역

    async def get(self, model, pk):
        return next(
            (u for u in self.users if isinstance(u, model) and u.id == pk), None
        )


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
def seeded(monkeypatch):
    """seed_placement 네트워크 차단 + 호출 기록(검사 순서 계약이 이걸 본다)."""
    calls: list = []

    async def fake_seed(db, user):
        calls.append(user)
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)
    return calls


@pytest.fixture()
def hashed(monkeypatch):
    """bcrypt 대역 — 로컬 env 비호환(test_auth_guest와 같은 사유). 호출을 센다."""
    calls: list[str] = []

    def fake_hash(password: str) -> str:
        calls.append(password)
        return f"$2b$fake${password}"

    monkeypatch.setattr(auth, "hash_password", fake_hash)
    return calls


@pytest.fixture()
def bearer():
    return {}


@pytest.fixture()
def client(fake_db, seeded, hashed, bearer, monkeypatch):
    monkeypatch.setattr(auth, "get_redis", lambda: FakeRedis())
    app.dependency_overrides[get_db] = lambda: fake_db
    app.dependency_overrides[get_current_user] = lambda: bearer["user"]
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def _ip():
    """레이트리밋 버킷 격리 — 요청마다 다른 XFF 첫 홉."""
    return f"test-{uuid.uuid4()}"


def _headers():
    return {"X-Forwarded-For": _ip()}


def existing(fake_db, nickname, email=None) -> User:
    """이미 그 이름을 쓰고 있는 **남의 행**."""
    user = User(
        id=uuid.uuid4(),
        email=email or f"taken-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="$2b$fake$whatever1",
        nickname=nickname,
        level_group="adult",
    )
    fake_db.add(user)
    return user


def post_register(client, nickname, **overrides):
    body = {
        "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
        "password": "pw12345678",
        "nickname": nickname,
        "level_group": "adult",
    }
    body.update(overrides)
    return client.post("/api/v1/auth/register", json=body, headers=_headers())


def post_guest(client, json=None):
    kwargs = {} if json is None else {"json": json}
    return client.post("/api/v1/auth/guest", headers=_headers(), **kwargs)


def make_guest(client, fake_db, bearer, nickname=None):
    """실왕복으로 게스트를 만들고 Bearer 슬롯에 장착한다."""
    payload = None if nickname is None else {"nickname": nickname}
    assert post_guest(client, json=payload).status_code == 201
    guest = fake_db.users[-1]
    bearer["user"] = guest
    return guest


def post_convert(client, **overrides):
    body = {"email": f"new-{uuid.uuid4().hex[:8]}@example.com", "password": "pw12345678"}
    body.update(overrides)
    return client.post("/api/v1/auth/guest/convert", json=body, headers=_headers())


def patch_me(client, **body):
    payload = {"level_group": "adult"}
    payload.update(body)
    return client.patch("/api/v1/auth/me", json=payload, headers=_headers())


def nickname_selects(fake_db):
    return [s for s, _ in fake_db.executed if "users.nickname" in str(s)]


def assert_taken(res):
    """409 형태는 저장소 관례 `{detail, code}` — `code`는 프론트 분기 키다."""
    assert res.status_code == 409, res.text
    body = res.json()
    assert body["code"] == "NICKNAME_TAKEN"
    assert set(body) == {"detail", "code"}
    assert isinstance(body["detail"], str) and body["detail"]


# ═══════════════════════════════════════════════════════════════
# ① POST /auth/register — 생성 (종전: 무검사·무다듬)
# ═══════════════════════════════════════════════════════════════


class TestRegisterUniqueness:
    def test_남이_쓰는_이름이면_409(self, client, fake_db):
        existing(fake_db, "구름사냥꾼")
        assert_taken(post_register(client, "구름사냥꾼"))

    def test_안_겹치면_201(self, client, fake_db):
        existing(fake_db, "남의이름")
        res = post_register(client, "내이름")
        assert res.status_code == 201
        assert fake_db.users[-1].nickname == "내이름"

    def test_중복이면_유저가_아예_안_만들어진다(self, client, fake_db, hashed, seeded):
        """검사가 **생성보다 앞**이라는 순서 계약 — 뒤로 밀리면 고아 유저가 남는다."""
        existing(fake_db, "구름사냥꾼")
        before = len(fake_db.users)
        assert post_register(client, "구름사냥꾼").status_code == 409
        assert len(fake_db.users) == before
        assert hashed == [] and seeded == []  # 해싱·θ 배정도 안 돈다

    def test_다듬어서_저장한다(self, client, fake_db):
        assert post_register(client, "  구름사냥꾼  ").status_code == 201
        assert fake_db.users[-1].nickname == "구름사냥꾼"

    def test_공백만_다른_이름은_중복으로_걸린다(self, client, fake_db):
        """trim 파리티의 본체 — 검사값과 저장값이 갈리면 여기가 201로 새고
        `"구름사냥꾼 "`이 `"구름사냥꾼"`으로 저장돼 **눈에 안 보이는 중복**이 된다."""
        existing(fake_db, "구름사냥꾼")
        assert_taken(post_register(client, " 구름사냥꾼 "))

    def test_대소문자는_안_접는다(self, client, fake_db):
        """`Cloud`와 `cloud`는 다른 이름이고, 적은 대소문자가 그대로 저장된다."""
        existing(fake_db, "cloud")
        res = post_register(client, "Cloud")
        assert res.status_code == 201, "대소문자만 다른 이름을 중복으로 보고 있다"
        assert fake_db.users[-1].nickname == "Cloud", "적은 대소문자가 안 보존된다"


# ═══════════════════════════════════════════════════════════════
# ② POST /auth/guest — 생성 (R13부터 유일하게 검사가 있던 경로)
# ═══════════════════════════════════════════════════════════════


class TestGuestUniqueness:
    def test_남이_쓰는_이름이면_409(self, client, fake_db):
        existing(fake_db, "구름사냥꾼")
        assert_taken(post_guest(client, json={"nickname": "구름사냥꾼"}))

    def test_안_겹치면_201(self, client, fake_db):
        existing(fake_db, "남의이름")
        assert post_guest(client, json={"nickname": "내이름"}).status_code == 201
        assert fake_db.users[-1].nickname == "내이름"

    def test_자동_부여_닉네임은_검사를_안_지나간다(self, client, fake_db):
        """「writer 전건」은 **사람이 고른 이름 전건**이라는 뜻이다.

        `게스트-{hex6}`는 기존 행들이 이미 공유하고 있어, 검사를 걸면 발급 자체가
        막힌다. 이 예외는 넓힘 뒤에도 그대로다(검사 함수 주석 ②).
        """
        post_guest(client)
        assert nickname_selects(fake_db) == []
        assert fake_db.users[-1].nickname.startswith("게스트-")

    def test_공백만_다른_이름은_중복으로_걸린다(self, client, fake_db):
        existing(fake_db, "구름사냥꾼")
        assert_taken(post_guest(client, json={"nickname": " 구름사냥꾼 "}))


# ═══════════════════════════════════════════════════════════════
# ③ POST /auth/guest/convert — 갱신 · 🔴 자기 제외형 (종전: 무검사·무다듬)
# ═══════════════════════════════════════════════════════════════


class TestConvertUniqueness:
    def test_남이_쓰는_이름이면_409(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        existing(fake_db, "선점자")
        assert_taken(post_convert(client, nickname="선점자"))

    def test_자기_이름을_그대로_저장하면_200이다(self, client, fake_db, bearer):
        """🔴 **자기 제외형의 본체.** 전환 화면은 게스트 닉네임을 채워서 띄우므로
        「이름은 그대로 두고 이메일만 바꾸는」 것이 정상 동선이다. `User.id !=`
        조건이 빠지면 자기 행에 걸려 전환이 통째로 409가 된다."""
        guest = make_guest(client, fake_db, bearer, nickname="구름사냥꾼")
        res = post_convert(client, email="me@example.com", nickname="구름사냥꾼")
        assert res.status_code == 200, res.text
        assert guest.nickname == "구름사냥꾼"
        assert guest.email == "me@example.com"

    def test_자기_이름_재저장에도_검사는_돈다(self, client, fake_db, bearer):
        """자기 제외는 **검사를 건너뛰는 것이 아니라 자기 행을 후보에서 빼는 것**이다.
        건너뛰기로 구현하면 남의 이름이 그 분기로 새어 들어온다."""
        make_guest(client, fake_db, bearer, nickname="구름사냥꾼")
        fake_db.executed.clear()
        assert post_convert(client, nickname="구름사냥꾼").status_code == 200
        assert len(nickname_selects(fake_db)) == 1

    def test_닉네임을_안_보내면_검사도_안_돈다(self, client, fake_db, bearer):
        """생략은 「기존 닉네임 유지」다 — 바꾸지 않는 값에 유일성을 물으면
        이미 겹쳐 있는 자동 부여 게스트가 전환을 못 하게 된다."""
        make_guest(client, fake_db, bearer)
        fake_db.executed.clear()
        assert post_convert(client).status_code == 200
        assert nickname_selects(fake_db) == []

    def test_409면_이메일_비밀번호도_안_바뀐다(self, client, fake_db, bearer):
        """검사가 **갱신보다 앞**이라는 순서 계약."""
        guest = make_guest(client, fake_db, bearer)
        before = (guest.email, guest.password_hash, guest.nickname)
        existing(fake_db, "선점자")
        assert post_convert(client, nickname="선점자").status_code == 409
        assert (guest.email, guest.password_hash, guest.nickname) == before

    def test_다듬어서_저장한다(self, client, fake_db, bearer):
        guest = make_guest(client, fake_db, bearer)
        assert post_convert(client, nickname="  구름사냥꾼  ").status_code == 200
        assert guest.nickname == "구름사냥꾼"

    def test_공백만_다른_이름은_중복으로_걸린다(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        existing(fake_db, "선점자")
        assert_taken(post_convert(client, nickname=" 선점자 "))


# ═══════════════════════════════════════════════════════════════
# ④ PATCH /auth/me — 갱신 · 🔴 자기 제외형
# ═══════════════════════════════════════════════════════════════
#
# 이 경로에는 검사 코드가 2026-08-19부터 있었지만 **계약이 하나도 없었다**
# (`NICKNAME_TAKEN`을 무는 테스트가 0건 — 되돌림 확인에서 드러났다). 코드가 있는
# 것과 계약이 있는 것은 다르다: 계약이 없으면 다음 사람이 지워도 아무도 안 운다.


class TestPatchMeUniqueness:
    def test_남이_쓰는_이름이면_409(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        existing(fake_db, "선점자")
        assert_taken(patch_me(client, nickname="선점자"))

    def test_자기_이름을_그대로_저장하면_200이다(self, client, fake_db, bearer):
        """🔴 **자기 제외형의 본체.** 학령만 바꾸는 호출이 화면에 떠 있던 자기
        닉네임을 함께 실어 보낸다 — 제외가 없으면 그 정상 동선이 409가 된다."""
        guest = make_guest(client, fake_db, bearer, nickname="구름사냥꾼")
        res = patch_me(client, nickname="구름사냥꾼", level_group="elementary")
        assert res.status_code == 200, res.text
        assert res.json()["nickname"] == "구름사냥꾼"
        assert guest.level_group == "elementary"

    def test_자기_이름_재저장에도_검사는_돈다(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer, nickname="구름사냥꾼")
        fake_db.executed.clear()
        assert patch_me(client, nickname="구름사냥꾼").status_code == 200
        assert len(nickname_selects(fake_db)) == 1

    def test_닉네임을_안_보내면_검사도_안_돈다(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        fake_db.executed.clear()
        assert patch_me(client, level_group="elementary").status_code == 200
        assert nickname_selects(fake_db) == []

    def test_409면_학령도_안_바뀐다(self, client, fake_db, bearer):
        """검사가 **갱신보다 앞**이라는 순서 계약."""
        guest = make_guest(client, fake_db, bearer)
        existing(fake_db, "선점자")
        assert patch_me(client, nickname="선점자", level_group="elementary").status_code == 409
        assert guest.level_group == "middle_high"

    def test_다듬어서_저장한다(self, client, fake_db, bearer):
        guest = make_guest(client, fake_db, bearer)
        assert patch_me(client, nickname="  구름사냥꾼  ").status_code == 200
        assert guest.nickname == "구름사냥꾼"

    def test_공백만_다른_이름은_중복으로_걸린다(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        existing(fake_db, "선점자")
        assert_taken(patch_me(client, nickname=" 선점자 "))


# ═══════════════════════════════════════════════════════════════
# 범위 — 검사도 정규화도 **소유자가 하나**여야 넓힘이 유지된다
# ═══════════════════════════════════════════════════════════════


WRITER_FUNCS = ("register", "guest_login", "convert_guest", "update_me")


def _body_of(func: str) -> str:
    """`async def <func>(` 부터 다음 최상위 데코레이터/함수 전까지."""
    m = re.search(
        rf"\nasync def {func}\((?:.|\n)*?(?=\n@router\.|\nasync def |\ndef |\Z)",
        AUTH_SRC,
    )
    assert m, f"{func} 본문을 찾지 못했다"
    return m.group(0)


class TestWriterScope:
    @pytest.mark.parametrize("func", WRITER_FUNCS)
    def test_writer_전건이_같은_문을_지난다(self, func):
        """🔴 **뒤집힌 계약.** 옛 판은 「이 엔드포인트의 신고 경로가 검사의 전
        범위다」였다 — 그래서 `register`·`convert_guest`가 무검사로 남았다."""
        assert "_ensure_nickname_available(" in _body_of(func), (
            f"{func}가 닉네임 유일성 검사를 안 지나간다"
        )

    @pytest.mark.parametrize("func", ("convert_guest", "update_me"))
    def test_갱신_경로는_자기_제외형이다(self, func):
        """🔴 생성 경로와 **다른 호출**이어야 한다 — `guest_login`의 형태를 그대로
        베끼면 사용자가 자기 이름을 그대로 저장할 때 409가 난다."""
        assert "exclude_user_id=db_user.id" in _body_of(func), (
            f"{func}가 자기 제외 없이 유일성을 묻는다"
        )

    @pytest.mark.parametrize("func", ("register", "guest_login"))
    def test_생성_경로는_제외할_행이_없다(self, func):
        assert "exclude_user_id" not in _body_of(func)

    def test_409를_내는_자리가_하나다(self):
        """경로마다 사본을 두면 문구·코드가 갈라지고 한쪽만 고쳐진다."""
        assert AUTH_SRC.count('"code": "NICKNAME_TAKEN"') == 1
        assert AUTH_SRC.count("async def _ensure_nickname_available(") == 1

    def test_정규화도_소유자가_하나다(self):
        """trim 파리티 — 검사값과 저장값이 같으려면 다듬는 자리가 하나여야 한다.

        `.strip()` 사본이 라우터·스키마에 흩어지면 한쪽만 고쳐지는 날
        `"홍길동 "`이 검사를 통과해 `"홍길동"`으로 저장된다.
        """
        from app.schemas import auth as schemas_auth

        schemas_src = Path(schemas_auth.__file__).read_text(encoding="utf-8")
        assert schemas_src.count("def normalize_nickname(") == 1
        # 다듬기 실체는 그 함수 안에만 있다(라우터에는 사본이 없다)
        assert AUTH_SRC.count(".strip()") == 0
        assert schemas_src.count(".strip()") == 1

    @pytest.mark.parametrize(
        "model,field",
        [
            ("RegisterRequest", "nickname"),
            ("ConvertRequest", "nickname"),
            ("GuestStartRequest", "nickname"),
            ("UpdateMeRequest", "nickname"),
        ],
    )
    def test_writer_스키마_전건이_다듬는다(self, model, field):
        """실측 — 모델을 통과한 값에 앞뒤 공백이 남지 않는다."""
        cls = getattr(auth, model, None) or getattr(
            __import__("app.schemas.auth", fromlist=["x"]), model
        )
        payloads = {
            "RegisterRequest": {
                "email": "a@b.co", "password": "pw12345678", "level_group": "adult"
            },
            "ConvertRequest": {"email": "a@b.co", "password": "pw12345678"},
            "GuestStartRequest": {},
            "UpdateMeRequest": {"level_group": "adult"},
        }[model]
        parsed = cls(**payloads, **{field: "  구름사냥꾼  "})
        assert getattr(parsed, field) == "구름사냥꾼"

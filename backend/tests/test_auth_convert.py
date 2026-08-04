"""게스트→정식 계정 전환(R11-01 웨이브 2 §6.2) — POST /auth/guest/convert.

계약(BE-1 ↔ FE-B·FE-C의 유일한 협상 결과 — SPRINT_R11_01 §6.2):
- Bearer 필수. {email, password, nickname?} → 200 LoginResponse(토큰 재발급).
- **같은 user_id 유지**가 존재 이유 — XP·θ·스트릭·진도·quiz_logs 전부
  user_id FK로 걸려 있으므로 "기존 행 갱신"만으로 전부 보존된다
  (새 유저 생성 + 데이터 이관 금지).
- 게스트가 아닌 계정(이메일이 @guest.weathermind.invalid가 아님) → 409 NOT_GUEST.
- 이메일 중복 → register와 동일 의미론(409 EMAIL_ALREADY_EXISTS — 실측).
- 비밀번호·이메일 검증 규칙은 register와 동일(ConvertRequest가 같은 제약 재사용).
- 레이트리밋 가입 관례(LIMIT_AUTH 5/분/IP) 준용. users 컬럼 추가 없음.

**refresh 토큰 처리 결정 — 기존 게스트 refresh token은 전환 즉시 무효화(회전).**
근거: (1) Redis session:{user_id}가 단일 슬롯이라 _store_session 덮어쓰기만으로
성립 — 추가 코드 0. (2) login 재발급과 동일한 회전 의미론(기존 refresh 라우트가
"stored != presented → 401"로 이미 강제). (3) 자격(비밀번호) 변경 시 토큰 회전은
보안 관례 — 전환 전 발급된 토큰이 전환 후에도 살아 있으면 자격 변경의 의미가
약해진다. 이 결정을 아래 TestRefreshRotation이 고정한다.

테스트 하네스는 test_auth_guest.py 관례(TestClient 왕복 + FakeDB/FakeRedis +
seed_placement 스텁)를 따르되, 전환 검증에 필요한 표면을 추가한다:
- FakeDB가 select(...).where(User.email == x)를 실제로 해석(중복 검사·login 왕복).
- get_current_user는 dependency_overrides로 대체(Bearer 강제 자체는 소스 계약으로
  고정 — 오버라이드가 oauth2_scheme을 우회하므로 왕복으로는 검증 불가).
- bcrypt 대역: hash/verify 쌍을 함께 패치해 login 왕복이 성립하게 한다
  (로컬 env bcrypt 5.x ↔ passlib 1.7.4 비호환 — test_auth_guest와 같은 사유).
"""
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Select

from app.core.dependencies import get_current_user, get_db
from app.core.security import decode_token
from app.main import app
from app.models.user import User
from app.routers import auth
from app.schemas.auth import LoginResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_SRC = (
    REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
).read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# 대역 — FakeDB(email 조회 해석형)·FakeRedis·seed_placement 스텁·bcrypt 쌍
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDB:
    """auth 라우터가 쓰는 AsyncSession 표면 + email 조회 해석.

    select(User.id).where(User.email == x)(중복 검사)와
    select(User).where(User.email == x)(login)를 저장된 유저 목록으로 답한다.
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
        if isinstance(stmt, Select):
            bound = stmt.compile().params
            email = next(
                (v for k, v in bound.items() if k.startswith("email")), None
            )
            if email is not None:
                match = next((u for u in self.users if u.email == email), None)
                if match is None:
                    return FakeResult(None)
                wants_id = stmt.column_descriptions[0]["name"] == "id"
                return FakeResult(match.id if wants_id else match)
        return FakeResult(None)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()  # DB server_default(gen_random_uuid) 대역

    async def get(self, model, pk):
        for obj in self.users:
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


@pytest.fixture()
def fake_db():
    return FakeDB()


@pytest.fixture()
def fake_redis():
    return FakeRedis()


@pytest.fixture()
def seeded(monkeypatch):
    async def fake_seed(db, user):
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)


@pytest.fixture()
def crypto(monkeypatch):
    """hash/verify 대역 쌍 — login 왕복이 성립해야 전환→로그인 시나리오 검증 가능."""
    monkeypatch.setattr(auth, "hash_password", lambda pw: f"$2b$fake${pw}")
    monkeypatch.setattr(
        auth, "verify_password", lambda pw, hashed: hashed == f"$2b$fake${pw}"
    )


@pytest.fixture()
def bearer():
    """get_current_user 대체 슬롯 — bearer["user"]가 인증된 유저."""
    return {}


@pytest.fixture()
def client(fake_db, fake_redis, seeded, crypto, bearer, monkeypatch):
    monkeypatch.setattr(auth, "get_redis", lambda: fake_redis)
    app.dependency_overrides[get_db] = lambda: fake_db
    app.dependency_overrides[get_current_user] = lambda: bearer["user"]
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def _unique_ip():
    return f"test-{uuid.uuid4()}"


def make_guest(client, fake_db, bearer):
    """POST /auth/guest 실왕복으로 게스트 생성 + Bearer 슬롯에 장착."""
    res = client.post(
        "/api/v1/auth/guest", headers={"X-Forwarded-For": _unique_ip()}
    )
    assert res.status_code == 201
    user = fake_db.users[-1]
    bearer["user"] = user
    return res.json(), user


def post_convert(client, payload, ip=None):
    return client.post(
        "/api/v1/auth/guest/convert",
        json=payload,
        headers={"X-Forwarded-For": ip or _unique_ip()},
    )


VALID = {"email": "new@example.com", "password": "pw12345678", "nickname": "정식닉"}


# ═══════════════════════════════════════════════════════════════
# 전환 성공 — 같은 user_id·진도 보존 (이 API의 존재 이유)
# ═══════════════════════════════════════════════════════════════


class TestConvertSuccess:
    def test_같은_user_id_유지_진도_보존(self, client, fake_db, bearer):
        _, guest = make_guest(client, fake_db, bearer)
        original_id = guest.id
        guest.xp = 120  # 게스트로 쌓은 진도 대역
        guest.streak_count = 7

        res = post_convert(client, VALID)
        assert res.status_code == 200
        assert set(res.json()) == set(LoginResponse.model_fields)

        # 새 유저 생성 없음 — 기존 행 갱신(user_id FK 진도가 전부 따라온다)
        assert len(fake_db.users) == 1
        user = fake_db.users[0]
        assert user is guest
        assert user.id == original_id
        assert user.email == VALID["email"]
        assert user.nickname == VALID["nickname"]
        assert user.password_hash == f"$2b$fake${VALID['password']}"
        assert user.xp == 120
        assert user.streak_count == 7

        # 재발급 토큰의 sub도 같은 user_id
        access = decode_token(res.json()["access_token"])
        assert access["sub"] == str(original_id)
        assert access["type"] == "access"
        refresh = decode_token(res.json()["refresh_token"])
        assert refresh["sub"] == str(original_id)
        assert refresh["type"] == "refresh"

    def test_nickname_생략시_기존_닉네임_유지(self, client, fake_db, bearer):
        _, guest = make_guest(client, fake_db, bearer)
        guest_nickname = guest.nickname
        res = post_convert(
            client, {"email": "keep@example.com", "password": "pw12345678"}
        )
        assert res.status_code == 200
        assert guest.nickname == guest_nickname

    def test_level_group은_유지된다(self, client, fake_db, bearer):
        """전환은 email/password/nickname만 갱신 — θ 사전 밴드 불변."""
        _, guest = make_guest(client, fake_db, bearer)
        res = post_convert(client, VALID)
        assert guest.level_group == "middle_high"
        assert decode_token(res.json()["access_token"])["level_group"] == "middle_high"

    def test_전환_후_새_자격으로_login_가능(self, client, fake_db, bearer):
        _, guest = make_guest(client, fake_db, bearer)
        post_convert(client, VALID)
        res = client.post(
            "/api/v1/auth/login",
            json={"email": VALID["email"], "password": VALID["password"]},
            headers={"X-Forwarded-For": _unique_ip()},
        )
        assert res.status_code == 200
        assert decode_token(res.json()["access_token"])["sub"] == str(guest.id)


# ═══════════════════════════════════════════════════════════════
# 검증 규칙 — register와 동일 재사용 (ConvertRequest)
# ═══════════════════════════════════════════════════════════════


class TestValidation:
    def test_비밀번호_8자_미만은_422(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        res = post_convert(
            client, {"email": "a@example.com", "password": "short1"}
        )
        assert res.status_code == 422

    def test_이메일_형식_위반은_422(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        res = post_convert(client, {"email": "not-an-email", "password": "pw12345678"})
        assert res.status_code == 422


# ═══════════════════════════════════════════════════════════════
# 게스트가 아닌 계정 → 409 NOT_GUEST
# ═══════════════════════════════════════════════════════════════


class TestNotGuest:
    def test_정식_계정은_409_NOT_GUEST(self, client, fake_db, bearer):
        regular = User(
            id=uuid.uuid4(),
            email="real@example.com",
            password_hash="$2b$fake$pw12345678",
            nickname="정식",
            level_group="adult",
        )
        fake_db.add(regular)
        bearer["user"] = regular

        res = post_convert(client, VALID)
        assert res.status_code == 409
        assert res.json()["code"] == "NOT_GUEST"
        # 아무것도 갱신되지 않는다
        assert regular.email == "real@example.com"


# ═══════════════════════════════════════════════════════════════
# 이메일 중복 — register와 동일 의미론 (409 EMAIL_ALREADY_EXISTS, 실측)
# ═══════════════════════════════════════════════════════════════


class TestEmailDuplicate:
    def test_중복_이메일은_409_register와_동일_코드(self, client, fake_db, bearer):
        taken = User(
            id=uuid.uuid4(),
            email="taken@example.com",
            password_hash="$2b$fake$whatever1",
            nickname="선점자",
            level_group="adult",
        )
        fake_db.add(taken)
        _, guest = make_guest(client, fake_db, bearer)
        guest_email = guest.email

        res = post_convert(
            client, {"email": "taken@example.com", "password": "pw12345678"}
        )
        assert res.status_code == 409
        assert res.json()["code"] == "EMAIL_ALREADY_EXISTS"
        # register 실측과 동일 의미론 소스 계약 — 같은 코드 문자열이 register에도 있다
        assert AUTH_SRC.count('"code": "EMAIL_ALREADY_EXISTS"') == 2
        # 게스트 행은 그대로 (전환 실패 = 무변경)
        assert guest.email == guest_email


# ═══════════════════════════════════════════════════════════════
# refresh 토큰 회전 — 전환 시 기존 게스트 refresh 즉시 무효화 (결정 고정)
# ═══════════════════════════════════════════════════════════════


class TestRefreshRotation:
    """결정: **무효화(회전)**. session:{user_id} 단일 슬롯 덮어쓰기(코드 0) +
    login 재발급과 동일 의미론 + 자격 변경 시 토큰 회전 보안 관례.

    주의: refresh 토큰에 jti가 없어 payload가 (sub, type, exp) 뿐이다 — 같은
    초에 발급된 두 토큰은 **바이트 동일**해서 "이전 토큰" 문자열 비교가 성립하지
    않는다. 실사용의 게스트 토큰은 전환보다 먼저(다른 exp로) 발급되므로, 여기서는
    exp가 다른 토큰을 게스트 세션 슬롯에 심어 그 시점을 재현한다."""

    def test_전환_후_기존_게스트_refresh는_401(
        self, client, fake_db, fake_redis, bearer
    ):
        from datetime import timedelta

        from app.core import security

        _, guest = make_guest(client, fake_db, bearer)
        # 전환보다 먼저 발급된 게스트 refresh token 재현 (exp가 달라 문자열 구분)
        older_refresh = security._create_token(
            {"sub": str(guest.id), "type": "refresh"}, timedelta(days=6)
        )
        fake_redis.store[f"session:{guest.id}"] = older_refresh

        # 전환 전에는 유효하다 (전제 확인 — 이게 죽는 원인이 전환임을 보장)
        pre = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": older_refresh}
        )
        assert pre.status_code == 200

        post_convert(client, VALID)
        res = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": older_refresh}
        )
        assert res.status_code == 401
        assert res.json()["code"] == "INVALID_REFRESH_TOKEN"

    def test_전환으로_받은_새_refresh는_200(self, client, fake_db, bearer):
        _, guest = make_guest(client, fake_db, bearer)
        converted = post_convert(client, VALID).json()
        res = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": converted["refresh_token"]},
        )
        assert res.status_code == 200
        assert decode_token(res.json()["access_token"])["sub"] == str(guest.id)


# ═══════════════════════════════════════════════════════════════
# 레이트리밋 — 가입 관례(LIMIT_AUTH 5/분/IP) 준용
# ═══════════════════════════════════════════════════════════════


class TestRateLimit:
    def test_6번째_요청은_429(self, client, fake_db, bearer):
        make_guest(client, fake_db, bearer)
        ip = _unique_ip()
        statuses = [
            post_convert(client, VALID, ip=ip).status_code for _ in range(6)
        ]
        # 1회차 200(전환 성공), 2~5회차 409(이미 정식 — NOT_GUEST), 6회차 429
        assert statuses[0] == 200
        assert statuses[1:5] == [409] * 4
        assert statuses[5] == 429

    def test_소스에_LIMIT_AUTH가_걸려_있다(self):
        assert re.search(
            r'@router\.post\(\s*"/guest/convert"[\s\S]*?@limiter\.limit\(LIMIT_AUTH\)'
            r"\s*\nasync def convert_guest",
            AUTH_SRC,
        ), "convert 엔드포인트에 @limiter.limit(LIMIT_AUTH)가 없다"


# ═══════════════════════════════════════════════════════════════
# Bearer 필수 — 소스 계약 (오버라이드가 oauth2_scheme을 우회하므로 소스로 고정)
# ═══════════════════════════════════════════════════════════════


class TestBearerRequired:
    def test_convert는_get_current_user_의존(self):
        m = re.search(
            r"async def convert_guest\([\s\S]*?\) -> LoginResponse:", AUTH_SRC
        )
        assert m, "convert_guest 시그니처를 찾지 못했다"
        assert "Depends(get_current_user)" in m.group(0), (
            "convert_guest에 Bearer(get_current_user) 의존이 없다"
        )

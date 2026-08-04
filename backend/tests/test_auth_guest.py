"""게스트 인증(R11-01 J — R10-J 실체화) — POST /auth/guest.

- 계약: 실 유저 생성 + 실 JWT. users 스키마 재사용(컬럼 추가 없음) —
  이메일 규약 guest-{uuid}@... 로 게스트를 식별한다.
- 응답 형태는 login과 **동일 스키마**(LoginResponse: access/refresh) 재사용.
- 레이트리밋: 가입·로그인과 같은 LIMIT_AUTH(5/분/IP) 관례 준용.
- mock↔서버 형태 동일(R10-07 관례): frontend mock의 guest 경로가 서버와
  같은 상태코드·키 집합을 내는지 소스 계약으로 감시한다.

엔드포인트는 TestClient(app.main) 왕복으로 검증한다 — slowapi 데코레이터가
실제로 걸린 채 돌아야 레이트리밋·응답 스키마가 계약 그대로 검증된다.
DB는 FakeDB(test_answer_service 관례), Redis는 인메모리 대역, 초기 θ 배정
(seed_placement)은 호출 기록 스텁으로 대체한다(네트워크 차단).
"""
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_db
from app.core.security import decode_token
from app.main import app
from app.models.user import User
from app.routers import auth
from app.schemas.auth import EMAIL_PATTERN, LoginResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_SRC = (
    REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
).read_text(encoding="utf-8")
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
LOGIN_PAGE_PATH = (
    REPO_ROOT / "frontend" / "src" / "modules" / "auth" / "LoginPage.jsx"
)

GUEST_EMAIL_RE = re.compile(
    r"^guest-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"@guest\.weathermind\.invalid$"
)


# ═══════════════════════════════════════════════════════════════
# 대역 — FakeDB(수집형)·FakeRedis(인메모리)·seed_placement 스텁
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def scalar_one_or_none(self):
        return None


class FakeDB:
    """auth 라우터가 쓰는 AsyncSession 표면만 흉내 낸다."""

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
            obj.id = uuid.uuid4()  # DB server_default(gen_random_uuid) 대역

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


@pytest.fixture()
def fake_db():
    return FakeDB()


@pytest.fixture()
def fake_redis():
    return FakeRedis()


@pytest.fixture()
def seeded(monkeypatch):
    """seed_placement 네트워크 차단 + 호출 기록."""
    calls = []

    async def fake_seed(db, user):
        calls.append(user)
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)
    return calls


@pytest.fixture()
def hashed(monkeypatch):
    """bcrypt 대역 — 로컬 env는 bcrypt 5.x라 passlib 1.7.4와 비호환(요구사항은
    bcrypt==4.0.* 고정 — requirements.txt 주석). 해싱 자체는 security 모듈 책임이라
    여기서는 라우터가 hash_password를 **무작위 시크릿으로 호출**하는지만 기록한다."""
    secrets: list[str] = []

    def fake_hash(password: str) -> str:
        secrets.append(password)
        return "$2b$12$" + "x" * 53  # bcrypt 형태 대역

    monkeypatch.setattr(auth, "hash_password", fake_hash)
    return secrets


@pytest.fixture()
def client(fake_db, fake_redis, seeded, hashed, monkeypatch):
    monkeypatch.setattr(auth, "get_redis", lambda: fake_redis)
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _unique_ip():
    """레이트리밋 버킷 격리 — 테스트마다 다른 XFF 첫 홉(임의 문자열 키)."""
    return f"test-{uuid.uuid4()}"


def post_guest(client, ip=None):
    return client.post(
        "/api/v1/auth/guest", headers={"X-Forwarded-For": ip or _unique_ip()}
    )


# ═══════════════════════════════════════════════════════════════
# 게스트 생성 — 실 유저 + 실 JWT
# ═══════════════════════════════════════════════════════════════


class TestGuestCreate:
    def test_201과_login_동일_스키마(self, client):
        res = post_guest(client)
        assert res.status_code == 201
        # 응답 키 == LoginResponse 필드 (동일 스키마 재사용 계약)
        assert set(res.json()) == set(LoginResponse.model_fields)

    def test_실_유저가_생성된다(self, client, fake_db, hashed):
        post_guest(client)
        users = [o for o in fake_db.added if isinstance(o, User)]
        assert len(users) == 1
        user = users[0]
        assert user.id is not None
        assert user.nickname.startswith("게스트-")
        assert 1 <= len(user.nickname) <= 50
        assert user.level_group == "middle_high"
        # 무작위 시크릿의 bcrypt 해시 — /login 진입 불가·NOT NULL 충족
        assert user.password_hash.startswith("$2b$")
        assert len(hashed) == 1
        secret = hashed[0]
        assert re.fullmatch(r"[0-9a-f]{32}", secret), "무작위 uuid4 hex 시크릿이 아니다"
        assert secret not in user.email  # 이메일에서 유추 불가

    def test_JWT가_실제로_유효하다(self, client, fake_db):
        res = post_guest(client)
        body = res.json()
        user = next(o for o in fake_db.added if isinstance(o, User))
        access = decode_token(body["access_token"])
        assert access["sub"] == str(user.id)
        assert access["type"] == "access"
        assert access["level_group"] == "middle_high"
        refresh = decode_token(body["refresh_token"])
        assert refresh["sub"] == str(user.id)
        assert refresh["type"] == "refresh"

    def test_세션이_Redis에_저장된다(self, client, fake_db, fake_redis):
        res = post_guest(client)
        user = next(o for o in fake_db.added if isinstance(o, User))
        assert fake_redis.store[f"session:{user.id}"] == res.json()["refresh_token"]

    def test_초기_θ_배정이_호출된다(self, client, fake_db, seeded):
        """register와 동일 온보딩 경로 — RLS 컨텍스트 주입 후 seed_placement."""
        post_guest(client)
        user = next(o for o in fake_db.added if isinstance(o, User))
        assert seeded == [user]
        set_configs = [
            params
            for stmt, params in fake_db.executed
            if params and params.get("uid") == str(user.id)
        ]
        assert set_configs, "app.current_user_id 주입(set_config)이 없다"


# ═══════════════════════════════════════════════════════════════
# 이메일 규약 — guest-{uuid}@... (users 스키마 재사용의 식별 수단)
# ═══════════════════════════════════════════════════════════════


class TestGuestEmailConvention:
    def test_이메일_규약과_스키마_패턴(self, client, fake_db):
        post_guest(client)
        user = next(o for o in fake_db.added if isinstance(o, User))
        assert GUEST_EMAIL_RE.match(user.email), user.email
        assert re.match(EMAIL_PATTERN, user.email)  # users 스키마 검증과 호환
        assert len(user.email) <= 255

    def test_호출마다_다른_계정(self, client, fake_db):
        post_guest(client)
        post_guest(client)
        users = [o for o in fake_db.added if isinstance(o, User)]
        assert len(users) == 2
        assert users[0].email != users[1].email
        assert users[0].id != users[1].id

    def test_도메인은_예약_TLD(self):
        """실수신 주소와 충돌 금지 — RFC 2606 .invalid."""
        assert auth.GUEST_EMAIL_DOMAIN.endswith(".invalid")


# ═══════════════════════════════════════════════════════════════
# refresh 왕복 — 게스트 refresh token으로 access 재발급
# ═══════════════════════════════════════════════════════════════


class TestGuestRefresh:
    def test_refresh_왕복(self, client, fake_db):
        body = post_guest(client).json()
        res = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
        )
        assert res.status_code == 200
        user = next(o for o in fake_db.added if isinstance(o, User))
        payload = decode_token(res.json()["access_token"])
        assert payload["sub"] == str(user.id)
        assert payload["type"] == "access"
        assert payload["level_group"] == "middle_high"

    def test_로그아웃된_세션의_refresh는_401(self, client, fake_redis):
        body = post_guest(client).json()
        fake_redis.store.clear()  # 로그아웃/세션 만료 흉내
        res = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
        )
        assert res.status_code == 401
        assert res.json()["code"] == "INVALID_REFRESH_TOKEN"


# ═══════════════════════════════════════════════════════════════
# 레이트리밋 — 가입 5/분/IP 관례 준용 (LIMIT_AUTH)
# ═══════════════════════════════════════════════════════════════


class TestGuestRateLimit:
    def test_6번째_요청은_429(self, client):
        ip = _unique_ip()
        for _ in range(5):
            assert post_guest(client, ip=ip).status_code == 201
        res = post_guest(client, ip=ip)
        assert res.status_code == 429
        assert res.json()["code"] == "RATE_LIMITED"

    def test_다른_IP는_별도_버킷(self, client):
        ip = _unique_ip()
        for _ in range(5):
            post_guest(client, ip=ip)
        assert post_guest(client).status_code == 201  # 새 IP는 통과

    def test_소스에_LIMIT_AUTH가_걸려_있다(self):
        """데코레이터가 guest 엔드포인트 정의에 직접 붙어 있는가 (소스 계약)."""
        assert re.search(
            r'@router\.post\(\s*"/guest"[\s\S]*?@limiter\.limit\(LIMIT_AUTH\)'
            r"\s*\nasync def guest_login",
            AUTH_SRC,
        ), "guest 엔드포인트에 @limiter.limit(LIMIT_AUTH)가 없다"


# ═══════════════════════════════════════════════════════════════
# mock↔서버 형태 동일 (R10-07 계약 관례) + 가짜 토큰 제거
# ═══════════════════════════════════════════════════════════════


class TestMockParity:
    def test_mock_guest_경로가_서버와_형태_동일(self):
        """mock의 POST /auth/guest — 상태코드 201 + LoginResponse 키 집합.

        핸들러 **구현 형태에 과결합하지 않는다** — 초판 정규식은 화살표가 배열
        리터럴을 바로 돌려주는 형태(`() => [201, {...}]`)만 인식해서, R11 웨이브 2에서
        핸들러가 상태 전이(`mockAuth.isGuest`) 때문에 블록 본문으로 바뀌자 경로가
        멀쩡히 있는데도 "경로가 없다"로 죽었다. 계약의 관심사는 형태가 아니라
        (경로 존재 · 201 · 응답 키 집합) 세 가지이므로, 핸들러 블록을 다음 라우트
        키(또는 파일 끝)까지 잘라 그 안에서 관심사만 본다.
        """
        src = MOCK_PATH.read_text(encoding="utf-8")
        start = src.find("'POST /auth/guest':")
        assert start != -1, "mock에 POST /auth/guest 경로가 없다 (R11-01 J)"
        nxt = re.search(r"'(?:GET|POST|PUT|DELETE) /", src[start + 1 :])
        block = src[start : start + 1 + (nxt.start() if nxt else len(src))]
        m = re.search(r"\[\s*(\d+)\s*,\s*\{([^}]*)\}", block)
        assert m, "guest 핸들러에서 [상태코드, {본문}] 반환을 찾지 못했다"
        assert int(m.group(1)) == 201  # 서버 status_code=HTTP_201_CREATED와 동일
        mock_keys = set(re.findall(r"(\w+):", m.group(2)))
        assert mock_keys == set(LoginResponse.model_fields), (
            f"mock guest 응답 키 {mock_keys} != 서버 LoginResponse "
            f"{set(LoginResponse.model_fields)}"
        )

    def test_LoginPage_가짜_토큰_조작이_제거됐다(self):
        """R11-01 J: guest_access_token 하드코딩 제거 → /auth/guest 실호출."""
        src = LOGIN_PAGE_PATH.read_text(encoding="utf-8")
        assert "guest_access_token" not in src, "가짜 토큰 조작이 되살아났다"
        assert "guest_refresh_token" not in src
        assert "/auth/guest" in src, "LoginPage가 /auth/guest를 호출하지 않는다"

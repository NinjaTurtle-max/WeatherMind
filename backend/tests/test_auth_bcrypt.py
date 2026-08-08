"""실 bcrypt 해싱 — monkeypatch 없는 왕복 (R13 P-1).

**이 파일의 존재 이유**: 나머지 인증 테스트(test_auth_guest·test_auth_convert·
test_user_region)는 속도 때문에 `hash_password`/`verify_password`를 전부
monkeypatch한다. 그래서 **실 bcrypt를 호출하는 테스트가 리포에 0건**이었고,
`requirements.txt`의 `bcrypt==4.0.*` 핀이 깨진 로컬 환경(bcrypt 5.0.0)에서
`POST /auth/guest`가 500인데 **CI는 초록**이었다(CARRYOVER_R13 §P-1).

재현했던 원문:
    passlib/handlers/bcrypt.py: detect_wrap_bug(IDENT_2A) →
    ValueError: password cannot be longer than 72 bytes,
                truncate manually if necessary (e.g. my_password[:72])

근본 수정은 핀을 지키는 게 아니라 **깨지는 결합을 없애는 것**이다 —
security.py가 passlib을 걷어내고 bcrypt 모듈을 직접 부른다. 따라서 여기서
단정하는 것은 "핀이 맞는가"가 아니라 **"핀 유무·bcrypt 버전과 무관하게
동작하는가"**다. 그래서 monkeypatch를 쓰지 않는다(느린 것이 요점이다 —
cost 12 해시 1회 ≈ 0.2초, 이 파일이 부르는 횟수는 한 자릿수로 묶어 뒀다).
"""
import re
import uuid

import bcrypt
import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_db
from app.core.security import BCRYPT_MAX_BYTES, BCRYPT_ROUNDS, hash_password, verify_password
from app.main import app
from app.models.user import User
from app.routers import auth

BCRYPT_HASH_RE = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")


# ═══════════════════════════════════════════════════════════════
# 단위 — hash ↔ verify 실호출 왕복
# ═══════════════════════════════════════════════════════════════


class TestRoundTrip:
    def test_해시하고_검증한다(self):
        """monkeypatch 없음 — 이 한 줄이 P-1의 재발을 막는 최소 단위."""
        hashed = hash_password("pw12345678")
        assert verify_password("pw12345678", hashed) is True

    def test_틀린_비밀번호는_False(self):
        hashed = hash_password("pw12345678")
        assert verify_password("pw12345679", hashed) is False

    def test_같은_비밀번호도_매번_다른_해시(self):
        """솔트가 실제로 무작위인가 — 레인보우 테이블 방어의 전제."""
        a, b = hash_password("pw12345678"), hash_password("pw12345678")
        assert a != b
        assert verify_password("pw12345678", a) and verify_password("pw12345678", b)

    def test_한글_비밀번호(self):
        """UTF-8 멀티바이트 — 인코딩 왕복이 깨지면 여기서 잡힌다."""
        pw = "비밀번호12345"
        assert verify_password(pw, hash_password(pw)) is True

    def test_해시_형식은_2b_cost12(self):
        """실DB의 기존 7행이 전부 `$2b$12$` — ident·cost가 바뀌면 즉시 눈에 띄게 한다.

        (형식이 달라져도 checkpw는 계속 검증하므로 로그인이 죽지는 않지만,
        운영 중 조용한 파라미터 변경은 감시 대상이다.)
        """
        hashed = hash_password("pw12345678")
        assert BCRYPT_HASH_RE.match(hashed), hashed
        assert hashed.startswith(f"$2b${BCRYPT_ROUNDS:02d}$")


# ═══════════════════════════════════════════════════════════════
# 기존 해시 호환 — passlib이 만든 해시를 계속 열 수 있는가
# ═══════════════════════════════════════════════════════════════


class TestLegacyHashCompat:
    """passlib 제거 전에 만들어진 해시가 **전부** 그대로 검증돼야 한다.

    실DB에 이미 계정이 있고(2026-08-08 실측: users 7행, 전부 `$2b$12$`),
    못 열면 로그인이 통째로 죽는다. passlib bcrypt 출력은 표준 modular crypt
    format이라 bcrypt.checkpw와 바이트 호환이지만, 그 사실을 실행으로 고정한다.
    (passlib을 여기서 import하지 않는다 — 의존이 제거됐고, 되살리면 P-1 재발이다.
     대신 passlib이 냈던 것과 **같은 알고리즘·같은 형식**의 해시를 직접 만든다.)
    """

    # passlib CryptContext(schemes=["bcrypt"], bcrypt__rounds=12)가 실제로 낸 해시
    # (bcrypt 4.0 흉내 아래서 재생성해 채취 — 평문은 아래 상수).
    LEGACY = [
        ("pw12345678", "$2b$12$B1oAFbATt7VtMBPMXi7NKeV1mNKVfBIOCH59zY2BOcxRiB1.gmCje"),
        ("한글비밀번호123", "$2b$12$yBQoXOiPIHZ/WXOykoxy/OOYbulFsovgLWbo.0p..Re1dwSy/eLk2"),
    ]

    @pytest.mark.parametrize("plain,hashed", LEGACY)
    def test_passlib이_만든_해시를_검증한다(self, plain, hashed):
        assert verify_password(plain, hashed) is True
        assert verify_password(plain + "x", hashed) is False

    def test_2a_ident_해시도_받는다(self):
        """구세대 ident($2a$)로 저장된 행이 섞여 있어도 열려야 한다."""
        hashed = bcrypt.hashpw(b"pw12345678", bcrypt.gensalt(4, prefix=b"2a")).decode()
        assert hashed.startswith("$2a$")
        assert verify_password("pw12345678", hashed) is True

    def test_손상된_해시는_예외가_아니라_False(self):
        """passlib은 UnknownHashError를 던져 500이 됐다 — 인증 실패는 401이어야 한다."""
        for broken in ["", "not-a-hash", "$2b$12$too-short", "$9z$99$xxx"]:
            assert verify_password("pw12345678", broken) is False


# ═══════════════════════════════════════════════════════════════
# 72바이트 경계 — passlib↔bcrypt 비호환의 진원지
# ═══════════════════════════════════════════════════════════════


class TestSeventyTwoByteBoundary:
    """P-1을 만든 검사가 정확히 이것이다. 동작을 **명시적으로 고정**한다.

    결정: **조용히 절단**(에러 아님). passlib의 `truncate_error` 기본값이 False라
    기존 동작이 바로 이것이었고, 여기서 에러로 바꾸면 password 8~128자를 허용하는
    register가 한글 25자(75바이트) 비밀번호에서 갑자기 422가 된다.
    이것은 bcrypt 알고리즘 자체의 상한이지 우리 정책이 아니다.
    """

    def test_상한은_72바이트(self):
        assert BCRYPT_MAX_BYTES == 72

    def test_72바이트_초과도_에러_없이_해시된다(self):
        """P-1 재현 지점 — 여기서 ValueError가 나면 register/convert가 500이다."""
        long_pw = "a" * 128  # RegisterRequest max_length
        hashed = hash_password(long_pw)
        assert verify_password(long_pw, hashed) is True

    def test_한글_128자도_에러_없이_해시된다(self):
        """한글 1자 = 3바이트 → 25자부터 이미 72바이트를 넘는다 (실사용 경로)."""
        pw = "가" * 128
        assert verify_password(pw, hash_password(pw)) is True

    def test_73바이트째부터는_무시된다(self):
        """bcrypt의 알려진 성질 — passlib 시절과 동일함을 기록한다."""
        base = "a" * 72
        hashed = hash_password(base + "DIFFERENT_TAIL")
        assert verify_password(base, hashed) is True
        assert verify_password(base + "anything-else", hashed) is True
        assert verify_password("a" * 71, hashed) is False  # 경계 안쪽은 구분된다


# ═══════════════════════════════════════════════════════════════
# 엔드포인트 왕복 — 스텁 없이 POST /auth/guest 가 201인가
# ═══════════════════════════════════════════════════════════════
#
# 실 bcrypt가 라우터 경로에서 불린다. hashed 대역을 쓰지 않는 유일한 인증 왕복
# 테스트이고, "CI 초록 + 실서버 500"을 막는 것이 이 클래스의 전부다.


class FakeResult:
    def scalar_one_or_none(self):
        return None


class FakeDB:
    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, stmt, params=None):
        return FakeResult()

    async def commit(self):
        pass

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def setex(self, key, ttl, value):
        self.store[key] = value

    async def get(self, key):
        return self.store.get(key)


@pytest.fixture()
def real_bcrypt_client(monkeypatch):
    """hash_password를 **패치하지 않는다** — 그것이 이 fixture의 요점."""
    fake_db = FakeDB()

    async def fake_seed(db, user):
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)
    monkeypatch.setattr(auth, "get_redis", lambda: FakeRedis())
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        yield TestClient(app), fake_db
    finally:
        app.dependency_overrides.pop(get_db, None)


class TestGuestEndpointWithRealBcrypt:
    def test_실_bcrypt로_guest가_201(self, real_bcrypt_client):
        """P-1 실측 재현의 반대편: 스텁 없이 왕복하면 500이 아니라 201이어야 한다."""
        client, fake_db = real_bcrypt_client
        res = client.post(
            "/api/v1/auth/guest", headers={"X-Forwarded-For": f"real-{uuid.uuid4()}"}
        )
        assert res.status_code == 201, res.text
        assert set(res.json()) == {"access_token", "refresh_token"}

        user = next(o for o in fake_db.added if isinstance(o, User))
        assert BCRYPT_HASH_RE.match(user.password_hash), user.password_hash

    def test_security_모듈이_passlib을_import하지_않는다(self):
        """결합 제거의 소스 계약 — passlib을 되살리면 bcrypt<4.1 핀이 **다시 필수**다.

        (주석·독스트링의 'passlib' 언급은 사고 기록이라 남겨 둔다 — import만 본다.)
        """
        import ast
        from pathlib import Path

        src = (
            Path(__file__).resolve().parents[1] / "app" / "core" / "security.py"
        ).read_text(encoding="utf-8")
        modules = set()
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Import):
                modules.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.add(node.module.split(".")[0])
        assert "passlib" not in modules, f"security.py가 passlib을 import한다: {modules}"
        assert "bcrypt" in modules

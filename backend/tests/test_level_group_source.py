"""학령이 신고값인가 기본값인가 — users.level_group_declared_at (MT-26 · 0015).

**왜 이 계약이 있나**: 온보딩의 「건너뛰기」(대회 규정상 로그인 없이 열려야 하므로
필수)와 `/learn` 딥링크 진입은 학령을 묻지 않고 `middle_high`로 들어온다. 실운영
로그(8/11~18)에 **신고한 middle_high**와 **묻지 않은 middle_high**가 같은 값으로
섞이면 8/18 IRT b-재보정이 둘을 구분할 수 없고, **로그는 되감을 수 없다**.

계약:
- NULL = 미신고(=무정보 기본값). 기존 행·무바디 게스트가 여기 속한다.
- 도장은 **명시 신고 경로 셋**에서만 찍힌다 — register · 바디에 level_group이
  실려 온 guest · PATCH /auth/me. 소유자는 `auth._declared_now` 하나다.
- ⚠️ **핵심 경계**: `{"level_group": "middle_high"}`(명시 신고)와 `{}`·무바디는
  **저장된 값이 같다**. 파싱된 값(`body.level_group`)을 보는 구현으로 되돌아가면
  셋이 전부 declared가 되고 이 작업 전체가 무의미해진다 — 그 회귀를
  `TestDeclaredVsDefaultBoundary`가 문다.
- convert_guest는 level_group을 받지 않으므로 도장을 보존한다(같은 행 갱신).

하네스는 test_auth_guest 관례를 그대로 쓴다(FakeDB·FakeRedis·seed_placement 스텁 —
네트워크 차단). 마이그레이션 0015는 test_user_region의 `TestMigration0010` 관례를
따라 **소스 계약**으로 본다 — 실DB 왕복은 PM 게이트다(test_user_region 명시).
"""
import importlib.util
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User
from app.routers import auth
from app.schemas.auth import ConvertRequest

REPO_ROOT = Path(__file__).resolve().parents[2]
VERSIONS_DIR = REPO_ROOT / "backend" / "alembic" / "versions"
AUTH_SRC = (
    REPO_ROOT / "backend" / "app" / "routers" / "auth.py"
).read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# 대역 — test_auth_guest와 동일 관례 (FakeDB·FakeRedis·seed 스텁)
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
def client(fake_db, monkeypatch):
    """게스트·가입 왕복 — seed_placement·bcrypt·Redis는 대역(네트워크 차단)."""

    async def fake_seed(db, user):
        return []

    monkeypatch.setattr(auth.weatherbrain_service, "seed_placement", fake_seed)
    monkeypatch.setattr(auth, "hash_password", lambda pw: "$2b$12$" + "x" * 53)
    monkeypatch.setattr(auth, "get_redis", lambda: FakeRedis())
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def me_client(client, fake_db):
    """PATCH /auth/me용 — get_current_user를 슬롯으로 대체."""
    bearer: dict = {}
    app.dependency_overrides[get_current_user] = lambda: bearer["user"]
    try:
        yield client, bearer
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _unique_ip():
    """레이트리밋 버킷 격리 — 테스트마다 다른 XFF 첫 홉."""
    return f"test-{uuid.uuid4()}"


def post_guest(client, json=None):
    """바디는 선택 — json=None이면 **바디 없이** 보낸다(무바디 경로)."""
    kwargs = {} if json is None else {"json": json}
    return client.post(
        "/api/v1/auth/guest",
        headers={"X-Forwarded-For": _unique_ip()},
        **kwargs,
    )


def post_register(client, level_group="adult", **overrides):
    body = {
        "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
        "password": "pw12345678",
        "nickname": "테스터",
        "level_group": level_group,
    }
    body.update(overrides)
    return client.post(
        "/api/v1/auth/register",
        headers={"X-Forwarded-For": _unique_ip()},
        json=body,
    )


def last_user(fake_db) -> User:
    return [o for o in fake_db.added if isinstance(o, User)][-1]


def assert_stamped(user: User):
    """도장이 지금 찍혔다 — tz-aware UTC이고 시각이 그럴듯하다."""
    stamp = user.level_group_declared_at
    assert stamp is not None, "명시 신고인데 도장이 없다"
    assert stamp.tzinfo is not None, "naive datetime — 다른 시각 컬럼과 비교 불가"
    now = datetime.now(timezone.utc)
    assert timedelta(0) <= now - stamp < timedelta(minutes=5), stamp


# ═══════════════════════════════════════════════════════════════
# ⚠️ 핵심 경계 — 같은 값, 다른 출처
# ═══════════════════════════════════════════════════════════════


class TestDeclaredVsDefaultBoundary:
    """`middle_high` 하나로 신고/미신고가 갈리는가 — 이 파일의 존재 이유.

    셋 다 `level_group == "middle_high"`로 저장되므로, 파싱된 값을 보는 구현은
    다른 모든 테스트를 통과하면서 여기서만 죽는다.
    """

    def test_명시_신고한_middle_high는_declared(self, client, fake_db):
        assert post_guest(client, json={"level_group": "middle_high"}).status_code == 201
        user = last_user(fake_db)
        assert user.level_group == "middle_high"
        assert_stamped(user)

    def test_빈_바디의_middle_high는_default(self, client, fake_db):
        """온보딩 건너뛰기 — 프론트가 `{}`를 보내도 신고가 아니다."""
        assert post_guest(client, json={}).status_code == 201
        user = last_user(fake_db)
        assert user.level_group == "middle_high"
        assert user.level_group_declared_at is None

    def test_무바디의_middle_high는_default(self, client, fake_db):
        """`/learn` 딥링크 진입 — 학령을 묻는 화면을 거치지 않는다."""
        assert post_guest(client).status_code == 201
        user = last_user(fake_db)
        assert user.level_group == "middle_high"
        assert user.level_group_declared_at is None

    def test_세_경로의_저장값은_같고_출처만_다르다(self, client, fake_db):
        """구분의 유일한 근거가 이 컬럼임을 명시한다 — level_group으론 못 가른다."""
        post_guest(client, json={"level_group": "middle_high"})
        post_guest(client, json={})
        post_guest(client)
        users = [o for o in fake_db.added if isinstance(o, User)][-3:]
        assert {u.level_group for u in users} == {"middle_high"}  # 값은 구분 불가
        assert [u.level_group_declared_at is not None for u in users] == [
            True,
            False,
            False,
        ]


# ═══════════════════════════════════════════════════════════════
# 기입 지점 — 명시 신고 경로만 도장을 찍는다
# ═══════════════════════════════════════════════════════════════


class TestGuestDeclaration:
    @pytest.mark.parametrize("level", ["elementary", "middle_high", "adult"])
    def test_학령을_실어_발급하면_declared(self, client, fake_db, level):
        assert post_guest(client, json={"level_group": level}).status_code == 201
        user = last_user(fake_db)
        assert user.level_group == level
        assert_stamped(user)

    def test_학령_없이_발급되면_default(self, client, fake_db):
        post_guest(client)
        assert last_user(fake_db).level_group_declared_at is None

    def test_다른_필드만_실린_바디는_default(self, client, fake_db):
        """학령이 아닌 키가 왔다고 신고로 오인하지 않는다."""
        assert post_guest(client, json={"nickname": "해커"}).status_code == 201
        assert last_user(fake_db).level_group_declared_at is None

    def test_거부된_바디는_유저_자체가_없다(self, client, fake_db):
        """허용값 밖은 422 — 유저 생성 전에 막히므로 도장 논의가 없다."""
        before = sum(isinstance(o, User) for o in fake_db.added)
        assert post_guest(client, json={"level_group": "kindergarten"}).status_code == 422
        assert sum(isinstance(o, User) for o in fake_db.added) == before


class TestRegisterDeclaration:
    def test_가입은_언제나_declared(self, client, fake_db):
        assert post_register(client, level_group="elementary").status_code == 201
        user = last_user(fake_db)
        assert user.level_group == "elementary"
        assert_stamped(user)

    def test_level_group_없는_가입은_422(self, client):
        """필수 필드다 — "가입은 언제나 명시 신고"의 근거."""
        body = {
            "email": f"u-{uuid.uuid4().hex[:10]}@example.com",
            "password": "pw12345678",
            "nickname": "테스터",
        }
        res = client.post(
            "/api/v1/auth/register",
            headers={"X-Forwarded-For": _unique_ip()},
            json=body,
        )
        assert res.status_code == 422


class TestPatchMeDeclaration:
    def test_학령을_바꾸면_declared로_바뀐다(self, me_client, fake_db):
        client, bearer = me_client
        post_guest(client)  # 건너뛰고 들어온 사람
        guest = last_user(fake_db)
        bearer["user"] = guest
        assert guest.level_group_declared_at is None

        res = client.patch("/api/v1/auth/me", json={"level_group": "elementary"})
        assert res.status_code == 200
        assert guest.level_group == "elementary"
        assert_stamped(guest)

    def test_재신고는_도장을_덮어쓴다(self, me_client, fake_db):
        """마지막 신고가 참값 — 그 이전 로그는 answered_at 비교로 갈린다."""
        client, bearer = me_client
        post_guest(client, json={"level_group": "adult"})
        user = last_user(fake_db)
        bearer["user"] = user
        old = datetime(2020, 1, 1, tzinfo=timezone.utc)
        user.level_group_declared_at = old

        client.patch("/api/v1/auth/me", json={"level_group": "elementary"})
        assert user.level_group_declared_at != old
        assert_stamped(user)

    def test_거부된_변경은_도장을_남기지_않는다(self, me_client, fake_db):
        client, bearer = me_client
        post_guest(client)
        guest = last_user(fake_db)
        bearer["user"] = guest
        assert client.patch(
            "/api/v1/auth/me", json={"level_group": "kindergarten"}
        ).status_code == 422
        assert guest.level_group_declared_at is None
        assert guest.level_group == "middle_high"


class TestConvertPreservesDeclaration:
    """게스트→정식 전환은 level_group을 받지 않는다 — 도장도 그대로다."""

    def _convert(self, monkeypatch, guest: User):
        import asyncio
        import inspect

        class _AuthDB:
            async def execute(self, stmt):
                return SimpleNamespace(scalar_one_or_none=lambda: None)

            async def get(self, model, pk):
                return guest

            async def commit(self):
                pass

        async def fake_store(uid, token):
            pass

        monkeypatch.setattr(auth, "hash_password", lambda pw: f"$fake${pw}")
        monkeypatch.setattr(auth, "_store_session", fake_store)
        monkeypatch.setattr(auth, "create_access_token", lambda *a, **k: "at")
        monkeypatch.setattr(auth, "create_refresh_token", lambda *a, **k: "rt")
        endpoint = inspect.unwrap(auth.convert_guest)
        asyncio.run(
            endpoint(
                request=SimpleNamespace(),
                body=ConvertRequest(
                    email="real@example.com", password="pw12345678", nickname=None
                ),
                user=guest,
                db=_AuthDB(),
            )
        )

    def _guest(self, declared_at):
        user = User(
            id=uuid.uuid4(),
            email=f"guest-{uuid.uuid4()}@{auth.GUEST_EMAIL_DOMAIN}",
            password_hash="x",
            nickname="게스트-abc123",
            level_group="adult",
        )
        user.level_group_declared_at = declared_at
        return user

    def test_신고했던_게스트는_전환_후에도_declared(self, monkeypatch):
        stamp = datetime(2026, 8, 13, tzinfo=timezone.utc)
        guest = self._guest(stamp)
        self._convert(monkeypatch, guest)
        assert guest.email == "real@example.com"
        assert guest.level_group_declared_at == stamp  # 무접촉 — 보존

    def test_안_신고한_게스트는_전환해도_default(self, monkeypatch):
        """전환은 학령을 묻지 않는다 — 정식 계정이 됐다고 신고가 되지 않는다."""
        guest = self._guest(None)
        self._convert(monkeypatch, guest)
        assert guest.level_group_declared_at is None


# ═══════════════════════════════════════════════════════════════
# 소유자 — 도장을 찍는 자리가 셋뿐이다 (소스 계약)
# ═══════════════════════════════════════════════════════════════


class TestStampOwnership:
    def test_도장_헬퍼는_하나뿐이다(self):
        assert AUTH_SRC.count("def _declared_now(") == 1

    def test_호출처는_세_곳뿐이다(self):
        """네 번째 호출이 생기면 여기서 문다 — 기본값 경로 오염의 조기 경보.

        허용된 셋: register 생성자 · guest 생성자(조건부) · update_me 갱신.
        """
        calls = re.findall(r"(?<!def )_declared_now\(\)", AUTH_SRC)  # 정의는 제외
        assert len(calls) == 3, f"_declared_now 호출 {len(calls)}회 — 기입 지점 변경"

    def test_게스트는_값이_아니라_필드_수신_여부를_본다(self):
        """`body.level_group == ...` 비교로 되돌아가면 세 경로가 전부 declared가 된다."""
        assert "model_fields_set" in AUTH_SRC, (
            "게스트 신고 판정이 model_fields_set을 안 쓴다 — "
            "파싱된 기본값과 명시 신고를 구분할 수 없다"
        )

    def test_로그인_refresh_logout은_도장을_안_건드린다(self):
        """읽기·세션 경로에서 도장이 찍히면 미신고 인구가 declared로 물든다."""
        for name in ("async def login(", "async def refresh(", "async def logout("):
            start = AUTH_SRC.find(name)
            assert start != -1, name
            nxt = AUTH_SRC.find("\n@router.", start)
            block = AUTH_SRC[start : nxt if nxt != -1 else len(AUTH_SRC)]
            assert "level_group_declared_at" not in block, name


# ═══════════════════════════════════════════════════════════════
# 모델·마이그레이션 0015 (0010 관례 — 소스 계약, 실DB 왕복은 PM 게이트)
# ═══════════════════════════════════════════════════════════════


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestModelColumn:
    def test_nullable_timestamptz_서버기본값_없음(self):
        column = User.__table__.columns["level_group_declared_at"]
        assert column.nullable is True
        # ⚠️ server_default(now())를 달면 SQL 직접 INSERT가 조용히 declared를 찍는다
        assert column.server_default is None
        assert column.default is None  # 파이썬측 기본값도 없다 — 명시 경로만 찍는다
        assert column.type.timezone is True  # naive면 answered_at과 비교 불가

    def test_신규_User_행의_기본값은_None(self):
        """모델을 직접 만드는 대역·스크립트는 미신고다."""
        user = User(
            id=uuid.uuid4(),
            email="x@example.com",
            password_hash="x",
            nickname="n",
            level_group="middle_high",
        )
        assert user.level_group_declared_at is None


class TestMigration0015:
    MIGRATION = VERSIONS_DIR / "20260813_0015_level_group_declared_at.py"

    def test_revision_체인(self):
        module = _load_migration(self.MIGRATION)
        assert module.revision == "0015_level_group_declared_at"
        assert module.down_revision == "0014_clouds_default_ten"

    def test_upgrade_downgrade_왕복_정의(self):
        """downgrade 필수(0009 관례) — 실DB 왕복은 PM 게이트."""
        module = _load_migration(self.MIGRATION)
        assert callable(module.upgrade) and callable(module.downgrade)
        source = self.MIGRATION.read_text(encoding="utf-8")
        assert '"users",' in source
        assert '"level_group_declared_at"' in source
        assert 'op.drop_column("users", "level_group_declared_at")' in source

    def test_백필_기본값이_default다(self):
        """기존 행은 신고한 적이 없다 — nullable + server_default 없음이 그 구현.

        `sa.Column(...)` 인자에 server_default가 없어야 기존 행이 NULL(=미신고)로
        남는다. now() 기본값을 달면 **전 기존 유저가 신고자로 둔갑**한다.
        """
        source = self.MIGRATION.read_text(encoding="utf-8")
        add_block = source[source.find("def upgrade()") : source.find("def downgrade()")]
        assert "nullable=True" in add_block
        assert "server_default" not in add_block

    def test_단일_head(self):
        """alembic heads가 하나 — 병렬 번호 충돌 감시(test_user_region 관례)."""
        revisions: dict[str, str | None] = {}
        pattern = re.compile(
            r'^(revision|down_revision)(?::\s*[^=]+)?\s*=\s*(?:"([^"]+)"|None)',
            re.MULTILINE,
        )
        for path in VERSIONS_DIR.glob("*.py"):
            found = dict(
                (kind, value or None)
                for kind, value in pattern.findall(path.read_text(encoding="utf-8"))
            )
            revisions[found["revision"]] = found.get("down_revision")
        referenced = {down for down in revisions.values() if down}
        heads = set(revisions) - referenced
        assert len(heads) == 1, f"alembic head가 갈라졌다: {sorted(heads)}"

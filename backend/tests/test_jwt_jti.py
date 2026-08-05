"""jti — R11-01 웨이브 3 §7.0 (+jti, 웨이브 2 이월 문제의 해소).

문제: exp가 초 단위라 같은 초에 발급된 두 토큰의 payload(sub·type·exp)가 같아
**바이트 동일**했다. refresh 회전은 session:{user_id} 슬롯 덮어쓰기 후
"저장 토큰 != 제시 토큰 → 401" 문자열 비교인데, 바이트가 같으면 이전 토큰이
계속 통과했다. 해소: 발급마다 uuid4 jti → 토큰이 항상 유일 → 회전 항상 실효.

검증 방식: security.datetime을 고정(monkeypatch)해 "같은 초"를 결정적으로 재현
한다. **변이 검증**: _create_token에서 jti 주입 줄을 제거하면 같은 초 발급 두
토큰이 바이트 동일해져 이 파일의 유일성 테스트가 문다.
"""
import re
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import security
from app.core.dependencies import get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.main import app
from app.models.user import User
from app.routers import auth


@pytest.fixture()
def frozen_now(monkeypatch):
    """security 모듈의 시각을 현재 초로 고정 — 같은 초 발급을 결정적으로 재현.

    (실제 now 기준으로 고정해야 decode_token의 exp 검증이 미래로 성립한다.)
    """
    fixed = datetime.now(timezone.utc).replace(microsecond=0)

    class _Frozen:
        @staticmethod
        def now(tz=None):
            return fixed

    monkeypatch.setattr(security, "datetime", _Frozen)
    return fixed


# ═══════════════════════════════════════════════════════════════
# 같은 초 발급 유일성 — 이번 항목의 핵심 계약
# ═══════════════════════════════════════════════════════════════


class TestSameSecondUniqueness:
    def test_같은_초_refresh_2회_발급이_서로_다른_토큰(self, frozen_now):
        uid = str(uuid.uuid4())
        t1 = create_refresh_token(uid)
        t2 = create_refresh_token(uid)
        p1, p2 = decode_token(t1), decode_token(t2)
        # 전제 확인: 정말 같은 초(같은 exp)다 — 이게 성립해야 jti가 원인이다
        assert p1["exp"] == p2["exp"]
        assert t1 != t2, "같은 초 발급 refresh 토큰이 바이트 동일하다 (jti 부재?)"
        assert p1["jti"] != p2["jti"]

    def test_같은_초_access_2회_발급도_서로_다른_토큰(self, frozen_now):
        """access에도 jti — 같은 유일성 보장 + 감사·로그 상관관계용 식별자."""
        uid = str(uuid.uuid4())
        t1 = create_access_token(uid, "middle_high")
        t2 = create_access_token(uid, "middle_high")
        assert decode_token(t1)["exp"] == decode_token(t2)["exp"]
        assert t1 != t2
        assert decode_token(t1)["jti"] != decode_token(t2)["jti"]


# ═══════════════════════════════════════════════════════════════
# payload 구성 — jti 형식(uuid4 hex)과 클레임 집합 고정
# ═══════════════════════════════════════════════════════════════


class TestPayloadShape:
    def test_jti는_uuid4_hex(self):
        for token in (
            create_refresh_token(str(uuid.uuid4())),
            create_access_token(str(uuid.uuid4()), "adult"),
        ):
            jti = decode_token(token)["jti"]
            assert re.fullmatch(r"[0-9a-f]{32}", jti), jti
            assert uuid.UUID(jti).version == 4

    def test_refresh_payload_클레임_집합(self):
        payload = decode_token(create_refresh_token(str(uuid.uuid4())))
        assert set(payload) == {"sub", "type", "exp", "jti"}

    def test_access_payload_클레임_집합(self):
        payload = decode_token(create_access_token(str(uuid.uuid4()), "adult"))
        assert set(payload) == {"sub", "level_group", "type", "exp", "jti"}


# ═══════════════════════════════════════════════════════════════
# 기존 검증 로직과의 정합 — /refresh의 "stored != presented → 401"이
# 같은 초 재발급(회전) 후에도 실효하는가 (라우트 왕복)
# ═══════════════════════════════════════════════════════════════


class FakeDB:
    def __init__(self, user):
        self._user = user

    async def get(self, model, pk):
        return self._user if pk == self._user.id else None


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def get(self, key):
        return self.store.get(key)


class TestRotationEffective:
    @pytest.fixture()
    def user(self):
        return User(
            id=uuid.uuid4(),
            email="jti-test@example.com",
            password_hash="$2b$12$" + "x" * 53,
            nickname="jti검증",
            level_group="adult",
        )

    @pytest.fixture()
    def fake_redis(self):
        return FakeRedis()

    @pytest.fixture()
    def client(self, user, fake_redis, monkeypatch):
        monkeypatch.setattr(auth, "get_redis", lambda: fake_redis)
        app.dependency_overrides[get_db] = lambda: FakeDB(user)
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_같은_초_회전_후_이전_토큰은_401_새_토큰은_200(
        self, frozen_now, user, fake_redis, client
    ):
        """jti 이전엔 이 시나리오가 불가능했다 — old == new(바이트 동일)라
        슬롯 덮어쓰기가 이전 토큰을 무효화하지 못했다."""
        old = create_refresh_token(str(user.id))
        new = create_refresh_token(str(user.id))  # 같은 초 재발급(회전)
        fake_redis.store[f"session:{user.id}"] = new  # _store_session 덮어쓰기 재현

        res_old = client.post("/api/v1/auth/refresh", json={"refresh_token": old})
        assert res_old.status_code == 401
        assert res_old.json()["code"] == "INVALID_REFRESH_TOKEN"

        res_new = client.post("/api/v1/auth/refresh", json={"refresh_token": new})
        assert res_new.status_code == 200
        assert decode_token(res_new.json()["access_token"])["sub"] == str(user.id)

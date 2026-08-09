"""access/refresh 토큰 종류 검사 — CO-P-6 (2026-08-09).

`security.create_access_token`·`create_refresh_token`은 처음부터 payload에
`type`을 넣어 왔다. 그런데 **읽는 쪽이 없었다** — `get_current_user`가 `sub`만
보고 Redis `session:{user_id}` 존재만 확인했다. 그 Redis 키에 담기는 값이 하필
refresh 토큰이라 존재 검사도 통과한다.

결과: **refresh 토큰을 `Authorization: Bearer`에 넣으면 전 API가 열렸다.**
피해의 실체는 권한이 아니라 **수명**이다 — access는 분 단위인데 refresh는 7일이라,
짧게 살라고 만든 자격증명이 7일짜리 만능 키가 된다. 프론트가 localStorage에 오래
두는 값이라 유출면도 넓다.

이 파일은 그 검사가 **살아 있는지**를 문다. 발급 쪽만 보는 테스트는 이 결함을
영원히 못 잡는다 — 발급은 처음부터 옳았기 때문이다.
"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

from app.core import dependencies
from app.core.security import create_access_token, create_refresh_token


class _AlwaysLiveRedis:
    """세션이 **살아 있는** 상태를 만든다 — 그래야 거절 사유가 종류뿐임이 드러난다.

    세션이 없으면 어떤 토큰이든 "Session expired"로 떨어져서, 종류 검사가
    없어도 이 테스트가 통과해 버린다. 그것이 원래 결함이 숨어 있던 방식이다.
    """

    async def exists(self, _key: str) -> int:
        return 1


class _NoSuchUserSession:
    """유저를 못 찾는 DB 대역 — 종류 관문 **다음** 단계를 관측 가능하게 만든다.

    실 DB로 가면 드라이버 사정(greenlet 미설치 등)에 따라 다른 예외가 나서,
    "관문을 통과했다"는 사실이 환경에 좌우된다. 대역으로 그 의존을 끊는다.
    """

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def get(self, _model, _pk):
        return None


@pytest.fixture
def live_session(monkeypatch):
    monkeypatch.setattr(dependencies, "get_redis", lambda: _AlwaysLiveRedis())
    monkeypatch.setattr(dependencies, "async_session", lambda: _NoSuchUserSession())


def _call(token: str):
    return asyncio.run(dependencies.get_current_user(token))


class TestRefreshTokenIsRejected:
    def test_refresh_토큰으로는_보호_자원에_못_들어간다(self, live_session):
        token = create_refresh_token(str(uuid.uuid4()))
        with pytest.raises(HTTPException) as exc:
            _call(token)
        assert exc.value.status_code == 401
        assert exc.value.detail["code"] == "UNAUTHORIZED"

    def test_거절_사유가_세션_만료가_아니다(self, live_session):
        """세션은 살아 있다 — 거절은 **종류** 때문이어야 한다.

        이 단정이 없으면 "세션이 없어서 막혔다"와 구분이 안 되고, 종류 검사를
        지워도 테스트가 초록으로 남는다.
        """
        token = create_refresh_token(str(uuid.uuid4()))
        with pytest.raises(HTTPException) as exc:
            _call(token)
        assert "type" in exc.value.detail["detail"].lower()


class TestAccessTokenStillWorks:
    def test_access_토큰은_종류_검사를_통과한다(self, live_session):
        """종류 검사 **다음** 단계까지 갔는지로 확인한다.

        DB 대역이 유저를 못 찾아 401이 나는 것이 여기서의 정상 경로다. 확인할 것은
        그 401의 사유가 "종류"가 아니라는 것 — 즉 관문을 통과했다는 사실이다.
        """
        token = create_access_token(str(uuid.uuid4()), "middle_high")
        with pytest.raises(HTTPException) as exc:
            _call(token)
        assert exc.value.detail["detail"] == "User not found"


class TestIssuersStillStampType:
    """발급 쪽이 `type`을 빼면 위 검사가 전 유저를 잠근다 — 양방향으로 문다."""

    def test_access는_type_access를_단다(self):
        from app.core.security import decode_token

        assert decode_token(create_access_token("u", "adult"))["type"] == "access"

    def test_refresh는_type_refresh를_단다(self):
        from app.core.security import decode_token

        assert decode_token(create_refresh_token("u"))["type"] == "refresh"

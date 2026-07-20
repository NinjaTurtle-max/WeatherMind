"""레이트리밋 키 함수(R2-01 §3.6, 웨이브 1 리뷰 2번) 단위 테스트.

nginx 프록시 뒤에서 X-Forwarded-For 첫 홉을 신뢰하고, XFF 부재 시 소켓 IP,
Bearer 토큰이 있으면 유저 키로 산정하는지 검증한다.
"""
from types import SimpleNamespace

from app.core.rate_limit import client_ip_key, user_or_ip_key
from app.core.security import create_access_token


def make_request(headers: dict | None = None, host: str | None = "172.18.0.2"):
    client = SimpleNamespace(host=host) if host is not None else None
    return SimpleNamespace(headers=headers or {}, client=client)


class TestClientIpKey:
    def test_XFF_첫_홉_신뢰(self):
        request = make_request(
            {"X-Forwarded-For": "203.0.113.7, 172.18.0.2"}
        )
        assert client_ip_key(request) == "203.0.113.7"  # 프록시 IP로 수렴 방지

    def test_XFF_없으면_소켓_IP_폴백(self):
        assert client_ip_key(make_request(host="10.0.0.9")) == "10.0.0.9"

    def test_클라이언트_정보_없으면_루프백(self):
        assert client_ip_key(make_request(host=None)) == "127.0.0.1"


class TestUserOrIpKey:
    def test_Bearer_토큰의_sub로_유저_키(self):
        token = create_access_token("user-1234", "adult")
        request = make_request({"Authorization": f"Bearer {token}"})
        assert user_or_ip_key(request) == "user:user-1234"

    def test_잘못된_토큰은_IP_폴백(self):
        request = make_request(
            {"Authorization": "Bearer not-a-jwt", "X-Forwarded-For": "203.0.113.7"}
        )
        assert user_or_ip_key(request) == "203.0.113.7"

    def test_토큰_없으면_IP_폴백(self):
        assert user_or_ip_key(make_request(host="10.0.0.9")) == "10.0.0.9"

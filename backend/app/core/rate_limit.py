"""레이트리밋(slowapi) — 스프린트 R2-01 §3.6 (S6).

| 경로 | 한도 |
|---|---|
| POST /auth/login, /auth/register | 5회/분/IP |
| GET /session/today, /quiz/today | 10회/분/유저 |
| POST answer 계열 | 30회/분/유저 |

IP 키: nginx 프록시 뒤에서 원격 소켓 IP는 프록시 IP로 수렴하므로(전 유저가
한 버킷에 묶임 — 웨이브 1 리뷰 2번), nginx가 전달하는 X-Forwarded-For의
첫 홉(클라이언트 원 IP)을 신뢰한다. XFF 부재 시(직접 노출·개발 환경)
원격 소켓 IP로 폴백한다.
유저 키: Authorization Bearer 토큰의 sub(user_id). 토큰 부재·해석 실패 시
IP 키로 폴백한다 (미인증 요청은 어차피 401 — 키 산정만 IP 기준).
저장소는 프로세스 메모리(slowapi 기본) — backend 단일 컨테이너 구성(05번 compose)
전제이며, 수평 확장 시 storage_uri를 Redis로 전환한다.
초과 시 429 + {"detail", "code": "RATE_LIMITED"} 응답은 main.py 핸들러가 담당.
"""
from slowapi import Limiter
from starlette.requests import Request

from app.core.security import JWTError, decode_token

LIMIT_AUTH = "5/minute"      # 로그인·가입 (IP 기준)
LIMIT_TODAY = "10/minute"    # 오늘의 세션·퀴즈 발급 (유저 기준)
LIMIT_ANSWER = "30/minute"   # 답안 제출 계열 (유저 기준)


def client_ip_key(request: Request) -> str:
    """X-Forwarded-For 첫 홉(nginx가 전달한 클라이언트 원 IP) 우선, 없으면 소켓 IP."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def user_or_ip_key(request: Request) -> str:
    """Bearer 토큰의 sub(user_id) 우선, 없으면 클라이언트 IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            sub = decode_token(auth[7:]).get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    return client_ip_key(request)


limiter = Limiter(key_func=client_ip_key)

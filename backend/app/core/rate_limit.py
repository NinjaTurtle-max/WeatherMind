"""레이트리밋(slowapi) — 스프린트 R2-01 §3.6 (S6).

| 경로 | 한도 |
|---|---|
| POST /auth/login, /auth/register, /auth/guest, /auth/guest/convert | Settings.LIMIT_AUTH (기본 30회/분/IP — R13 P-2) |
| GET /session/today, /quiz/today | 10회/분/유저 |
| POST answer 계열 | 30회/분/유저 |

IP 키: **리버스 프록시(prod는 Caddy — nginx가 아니다. 05번 compose에 nginx가
없고 Caddy `handle /api/*`가 backend로 직결한다)** 뒤에서 원격 소켓 IP는 프록시
IP로 수렴하므로(전 유저가 한 버킷에 묶임 — 웨이브 1 리뷰 2번), 프록시가 전달하는
X-Forwarded-For의 첫 홉(클라이언트 원 IP)을 신뢰한다. XFF 부재 시(직접 노출·개발
환경) 원격 소켓 IP로 폴백한다.

⚠️ XFF는 **클라이언트가 위조할 수 있는 헤더**다(R13 P-7 실측: XFF를 요청마다
바꾸면 8/8 전부 통과 — 한도 무력화). 이것이 안전한 것은 오직 "앞단 프록시가
클라이언트 XFF를 덮어쓴다"는 전제 위에서다. 백엔드를 프록시 없이 노출하는
구성이라면 `TRUST_PROXY_HEADERS=false`로 소켓 IP만 쓰게 한다. 기본값을 true로
두는 이유는 prod 경로에 Caddy가 있고, 프록시 뒤에서 false는 전 유저를 한 버킷에
묶어 더 나쁘기 때문이다(근거는 config.TRUST_PROXY_HEADERS 주석).

유저 키: Authorization Bearer 토큰의 sub(user_id). 토큰 부재·해석 실패 시
IP 키로 폴백한다 (미인증 요청은 어차피 401 — 키 산정만 IP 기준).
저장소는 프로세스 메모리(slowapi 기본) — backend 단일 컨테이너 구성(05번 compose)
전제이며, 수평 확장 시 storage_uri를 Redis로 전환한다.
초과 시 429 + {"detail", "code": "RATE_LIMITED"} 응답은 main.py 핸들러가 담당.
"""
from slowapi import Limiter
from starlette.requests import Request

from app.core.config import settings
from app.core.security import JWTError, decode_token

# 로그인·가입·게스트 (IP 기준) — env 노브. 상수 이름은 auth.py가 import하므로 유지.
LIMIT_AUTH = settings.LIMIT_AUTH
LIMIT_TODAY = "10/minute"    # 오늘의 세션·퀴즈 발급 (유저 기준)
LIMIT_ANSWER = "30/minute"   # 답안 제출 계열 (유저 기준)
# 배치고사 일괄 제출 (유저 기준) — 요청 1건이 세션 전체를 채점하므로 문항별
# LIMIT_ANSWER가 아니라 발급 계열(LIMIT_TODAY)급으로 묶는다 (R7-02 §3.1).
LIMIT_SUBMIT_ALL = "10/minute"


def client_ip_key(request: Request) -> str:
    """X-Forwarded-For 첫 홉(프록시가 전달한 클라이언트 원 IP) 우선, 없으면 소켓 IP.

    TRUST_PROXY_HEADERS=false면 XFF를 아예 보지 않는다(위조 방지 — 모듈 독스트링).
    """
    if settings.TRUST_PROXY_HEADERS:
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

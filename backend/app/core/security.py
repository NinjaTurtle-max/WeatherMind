"""JWT 생성/검증(python-jose) + bcrypt 해싱(rounds=12) — 08번 스펙.

R11-01 웨이브 3(+jti): 모든 발급 토큰에 uuid4 jti를 넣는다. exp는 초 단위라
같은 초에 발급된 두 토큰이 **바이트 동일**해지는 문제가 있었다 — refresh는
session:{user_id} 슬롯 덮어쓰기(회전)가 "이전 토큰 != 저장 토큰" 문자열 비교로
성립하는데, 바이트가 같으면 이전 토큰이 계속 통과했다. jti로 발급마다 유일해져
회전이 항상 실효한다. access에도 넣는다: 같은 이유의 유일성 보장 + 감사·로그
상관관계용 토큰 식별자(비용 0, 검증 로직 무변경 — 미지 클레임은 무시된다).

R13 P-1 (passlib 제거): 해싱을 `bcrypt` 모듈 직접 호출로 바꿨다.
`passlib.CryptContext(schemes=["bcrypt"])`는 백엔드 적재 시 `detect_wrap_bug`가
**72바이트를 넘는 시크릿**을 bcrypt에 그대로 넘기는데, bcrypt>=4.1은 이 경우
`ValueError: password cannot be longer than 72 bytes`를 던진다. 그래서 bcrypt를
4.0.*에 핀하는 것으로 막아 왔지만(requirements.txt), **핀을 지키는 테스트가
없었다** — 인증 테스트가 hash/verify를 전부 monkeypatch해서 실 bcrypt를 부르는
테스트가 0건이었고, 로컬에 bcrypt 5.0.0이 깔린 지금 register·login·guest·convert
4경로가 전부 500인데 CI는 초록이었다(CARRYOVER_R13 §P-1). passlib 1.7.4는
2020년 이후 릴리스가 없어 이 비호환이 상류에서 고쳐질 전망도 없다.

동작은 passlib 시절과 동일하게 유지한다 — **핀 유무·bcrypt 4.x/5.x 무관 동작**이
이 변경의 유일한 AC다:
- ident `$2b$` · cost 12 (passlib 기본 ident + bcrypt__rounds=12와 동일).
- 72바이트 초과 시 **조용히 절단**. passlib의 `truncate_error` 기본값이 False라
  기존 동작이 바로 이것이었다(초과분을 bcrypt 백엔드가 잘라냄). 여기서 에러로
  바꾸면 8자~128자를 허용하는 register가 한글 25자 비밀번호에서 갑자기 422가 된다.
- 검증은 `$2a$`/`$2y$` 등 다른 ident의 기존 해시도 그대로 받는다(bcrypt가 처리).
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

BCRYPT_ROUNDS = 12
BCRYPT_MAX_BYTES = 72  # bcrypt 알고리즘 자체의 상한 (초과분은 원래도 무시됐다)


def _secret(password: str) -> bytes:
    """bcrypt에 넘길 바이트 — 72바이트 초과분은 절단(passlib 기본 동작과 동일).

    멀티바이트 문자 중간에서 잘릴 수 있으나 bcrypt는 raw bytes를 다루므로 무해하고,
    bcrypt 4.x 백엔드의 절단과 **바이트 단위로 같은 결과**라 기존 해시와 호환된다.
    """
    return password.encode("utf-8")[:BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_secret(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode(
        "ascii"
    )


def verify_password(plain_password: str, password_hash: str) -> bool:
    """비밀번호 일치 여부. 해시가 손상·미지 형식이면 예외 대신 False.

    (passlib은 UnknownHashError를 던져 500이 됐다 — 인증 실패는 401이어야 한다.)

    ⚠️ **`(ValueError, TypeError)`만으로는 부족하다** — 설치된 bcrypt 판에 따라
    갈린다. `bcrypt==4.0.x`의 Rust 확장은 짧은/깨진 해시에서 `ValueError`가 아니라
    **패닉**을 낸다(`pyo3_runtime.PanicException: range end index 22 out of range
    for slice of length 9`). 그 예외는 `Exception`이 아니라 `BaseException`을
    상속하므로 위 절이 못 잡고 **500**이 나간다 — 이 함수가 막으려던 바로 그
    결과다. requirements가 `bcrypt>=4.0`(핀 없음)이라 4.0이 해석되는 환경이
    실재하고, 실제로 이 컨테이너(4.0.1)에서 `test_손상된_해시는_예외가_아니라_False`가
    붉었다(2026-08-14). bcrypt 5.x에서는 같은 입력이 `ValueError`라 초록이다 —
    즉 **어느 판이 깔렸는지에 따라 500이 되는** 종류의 결함이다.

    그래서 `BaseException`까지 받되 **중단 신호는 돌려보낸다**: `KeyboardInterrupt`·
    `SystemExit`(+`GeneratorExit`)를 삼키면 프로세스가 안 죽는다. 손상된 해시를
    False로 접는 것과 종료 요청을 무시하는 것은 다른 일이다.
    """
    try:
        return bcrypt.checkpw(_secret(plain_password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False
    except (KeyboardInterrupt, SystemExit, GeneratorExit):
        raise
    except BaseException:  # bcrypt 4.0.x의 pyo3 PanicException
        return False


def _create_token(payload: dict[str, Any], expires_delta: timedelta) -> str:
    to_encode = payload.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + expires_delta
    to_encode["jti"] = uuid.uuid4().hex  # 발급 단위 유일성 (같은 초 발급도 서로 다른 토큰)
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, level_group: str) -> str:
    """JWT payload: {"sub": user_id, "level_group": ..., "exp": ..., "jti": ...} (02번 스펙 + R11 jti)."""
    return _create_token(
        {"sub": str(user_id), "level_group": level_group, "type": "access"},
        timedelta(minutes=settings.JWT_ACCESS_EXPIRE_MINUTES),
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(
        {"sub": str(user_id), "type": "refresh"},
        timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS),
    )


def decode_token(token: str) -> dict[str, Any]:
    """유효하지 않으면 JWTError를 그대로 전파한다 (호출부에서 401 처리)."""
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "JWTError",
]

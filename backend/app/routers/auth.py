"""Auth API (/api/v1/auth) — 02번 스펙.

| POST | /register | {email, password, nickname, level_group} → {user_id, access_token} |
| POST | /login    | {email, password} → {access_token, refresh_token} |
| POST | /guest    | - → {access_token, refresh_token} (R11-01 J — 실 유저 생성) |
| POST | /guest/convert | Bearer + {email, password, nickname?} → {access_token, refresh_token} (같은 user_id 유지) |
| POST | /refresh  | {refresh_token} → {access_token} |
| POST | /logout   | - → {"success": true} (Redis 세션 삭제) |

refresh token은 Redis session:{user_id}에 7일 TTL로 저장 (08번 스펙).
로그아웃 시 세션 삭제 → 이후 모든 access token 무효화.
레이트리밋 (R2-01 §3.6): login·register·guest·guest/convert 5회/분/IP.
"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.core.rate_limit import LIMIT_AUTH, limiter
from app.core.redis import get_redis
from app.core.security import (
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.services import weatherbrain_service
from app.schemas.auth import (
    ConvertRequest,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SESSION_TTL = timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)


async def _store_session(user_id: uuid.UUID, refresh_token: str) -> None:
    """Redis session:{user_id} — refresh token 저장, TTL 7일."""
    redis = get_redis()
    await redis.setex(f"session:{user_id}", SESSION_TTL, refresh_token)


@router.post(
    "/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit(LIMIT_AUTH)
async def register(
    request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)
) -> RegisterResponse:
    exists = await db.execute(select(User.id).where(User.email == body.email))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 등록된 이메일입니다.", "code": "EMAIL_ALREADY_EXISTS"},
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        nickname=body.nickname,
        level_group=body.level_group,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # R6 WeatherBrain: 가입 직후 초기 난이도 배정 — level_group 사전으로 개념별 θ 배정.
    # 실패해도 가입은 성공(이후 세션 발급의 refresh_abilities가 사전값을 다시 채운다).
    # user_concept_ability는 RLS(user_isolation) 대상이므로, get_db(무RLS 컨텍스트)에서
    # 쓰기 전에 get_db_with_rls와 동일하게 app.current_user_id를 주입한다(WITH CHECK 충족).
    await db.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user.id)},
    )
    await weatherbrain_service.seed_placement(db, user)
    await db.commit()

    # 가입 직후 발급되는 access token이 즉시 유효하도록 세션 생성
    refresh_token = create_refresh_token(str(user.id))
    await _store_session(user.id, refresh_token)

    return RegisterResponse(
        user_id=user.id,
        access_token=create_access_token(str(user.id), user.level_group),
    )


@router.post("/login", response_model=LoginResponse)
@limiter.limit(LIMIT_AUTH)
async def login(
    request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)
) -> LoginResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "이메일 또는 비밀번호가 올바르지 않습니다.", "code": "INVALID_CREDENTIALS"},
        )

    refresh_token = create_refresh_token(str(user.id))
    await _store_session(user.id, refresh_token)

    return LoginResponse(
        access_token=create_access_token(str(user.id), user.level_group),
        refresh_token=refresh_token,
    )


# ── 게스트 인증 (R11-01 J — R10-J 실체화) ──────────────────────────────────
# users 스키마를 그대로 재사용한다(컬럼 추가 금지 — 0009와 충돌·범위 밖):
# - 이메일 규약: guest-{uuid4}@GUEST_EMAIL_DOMAIN — 예약 TLD(.invalid, RFC 2606)라
#   실제 수신 주소와 충돌하지 않고, 프리픽스로 게스트 식별이 가능하다.
# - 비밀번호: 무작위 시크릿의 bcrypt 해시 — /login으로는 사실상 진입 불가
#   (password_hash NOT NULL 충족 + verify_password 경로 안전).
# - level_group: 'middle_high' — 서비스 전반의 무정보 기본값(θ 사전 중간 밴드,
#   theta_level_label·mock 기본과 동일). 이후 배치고사가 조정한다.
GUEST_EMAIL_DOMAIN = "guest.weathermind.invalid"
GUEST_LEVEL_GROUP = "middle_high"


@router.post(
    "/guest", response_model=LoginResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit(LIMIT_AUTH)
async def guest_login(
    request: Request, db: AsyncSession = Depends(get_db)
) -> LoginResponse:
    """게스트 시작 — 실 유저 생성 + 실 JWT (응답 형태는 login과 동일 스키마)."""
    guest_id = uuid.uuid4()
    user = User(
        email=f"guest-{guest_id}@{GUEST_EMAIL_DOMAIN}",
        password_hash=hash_password(uuid.uuid4().hex),  # 로그인 불가 무작위 시크릿
        nickname=f"게스트-{guest_id.hex[:6]}",
        level_group=GUEST_LEVEL_GROUP,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # register와 동일: RLS 컨텍스트 주입 후 초기 θ 배정(실패해도 진입은 성공 —
    # 이후 세션 발급의 refresh_abilities가 사전값을 다시 채운다).
    await db.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user.id)},
    )
    await weatherbrain_service.seed_placement(db, user)
    await db.commit()

    refresh_token = create_refresh_token(str(user.id))
    await _store_session(user.id, refresh_token)

    return LoginResponse(
        access_token=create_access_token(str(user.id), user.level_group),
        refresh_token=refresh_token,
    )


# ── 게스트 → 정식 계정 전환 (R11-01 웨이브 2 §6.2 계약) ─────────────────────
# 같은 user_id의 행을 갱신한다(새 유저 생성 + 이관 아님) — XP·θ·스트릭·진도·
# quiz_logs가 전부 user_id FK로 걸려 있으므로 행 갱신만으로 전부 보존된다.
# - 게스트 판별: 이메일 도메인(J의 규약). 정식 계정 → 409 NOT_GUEST.
# - 이메일 중복: register와 동일 의미론(409 EMAIL_ALREADY_EXISTS).
# - 토큰 재발급: _store_session이 session:{user_id} 단일 슬롯을 덮어쓰므로
#   기존 게스트 refresh token은 **즉시 무효화**된다(login 재발급과 동일한 회전
#   의미론 + 자격 변경 시 토큰 회전이라는 보안 관례 — 추가 코드 0).


@router.post("/guest/convert", response_model=LoginResponse)
@limiter.limit(LIMIT_AUTH)
async def convert_guest(
    request: Request,
    body: ConvertRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """게스트 계정을 정식 계정으로 전환 — 같은 user_id 유지(진도 보존)."""
    if not user.email.endswith(f"@{GUEST_EMAIL_DOMAIN}"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "게스트 계정이 아닙니다.", "code": "NOT_GUEST"},
        )

    # register와 동일 의미론의 이메일 중복 검사
    exists = await db.execute(select(User.id).where(User.email == body.email))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 등록된 이메일입니다.", "code": "EMAIL_ALREADY_EXISTS"},
        )

    # get_current_user는 별도 세션으로 로드하므로, 갱신은 이 요청의 db 세션에서
    # 같은 PK 행을 다시 얻어 수행한다(새 행 생성 없음 — user_id 보존의 핵심).
    db_user = await db.get(User, user.id)
    if db_user is None:  # 세션 검증~갱신 사이 행 소멸 — 사실상 도달 불가 방어선
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "유효하지 않은 사용자입니다.", "code": "INVALID_CREDENTIALS"},
        )

    db_user.email = body.email
    db_user.password_hash = hash_password(body.password)
    if body.nickname is not None:
        db_user.nickname = body.nickname
    await db.commit()

    # 토큰 재발급 — 세션 슬롯 덮어쓰기로 기존 게스트 refresh token 무효화(회전)
    refresh_token = create_refresh_token(str(db_user.id))
    await _store_session(db_user.id, refresh_token)

    return LoginResponse(
        access_token=create_access_token(str(db_user.id), db_user.level_group),
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    body: RefreshRequest, db: AsyncSession = Depends(get_db)
) -> RefreshResponse:
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"detail": "유효하지 않은 refresh token입니다.", "code": "INVALID_REFRESH_TOKEN"},
    )
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise invalid

    user_id = payload.get("sub")
    if user_id is None or payload.get("type") != "refresh":
        raise invalid

    # Redis 세션의 refresh token과 일치해야 함 (로그아웃/재발급 시 무효화)
    redis = get_redis()
    stored = await redis.get(f"session:{user_id}")
    if stored != body.refresh_token:
        raise invalid

    user = await db.get(User, uuid.UUID(user_id))
    if user is None:
        raise invalid

    return RefreshResponse(
        access_token=create_access_token(str(user.id), user.level_group)
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(user: User = Depends(get_current_user)) -> LogoutResponse:
    redis = get_redis()
    await redis.delete(f"session:{user.id}")
    return LogoutResponse(success=True)

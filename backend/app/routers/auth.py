"""Auth API (/api/v1/auth) — 02번 스펙.

| POST | /register | {email, password, nickname, level_group} → {user_id, access_token} |
| POST | /login    | {email, password} → {access_token, refresh_token} |
| POST | /guest    | {level_group?} (바디 선택) → {access_token, refresh_token} (R11-01 J — 실 유저 생성) |
| POST | /guest/convert | Bearer + {email, password, nickname?} → {access_token, refresh_token} (같은 user_id 유지) |
| POST | /refresh  | {refresh_token} → {access_token} |
| GET  | /me       | Bearer → {user_id, email, nickname, is_guest, level_group} (R13 P-4) |
| PATCH| /me       | Bearer + {level_group} → MeResponse (R13 P-5 — 학령 변경 통로) |
| POST | /logout   | - → {"success": true} (Redis 세션 삭제) |

refresh token은 Redis session:{user_id}에 7일 TTL로 저장 (08번 스펙).
**refresh 성공 시 TTL을 다시 민다(슬라이딩 만료 — R13 P-3).**
로그아웃 시 세션 삭제 → 이후 모든 access token 무효화.
레이트리밋 (R2-01 §3.6 → R13 P-2): login·register·guest·guest/convert는
Settings.LIMIT_AUTH(기본 30회/분/IP — NAT 뒤 다중 사용자 전제).
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
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
    LevelGroup,
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


def _declared_now() -> datetime:
    """학령 신고 도장 (`users.level_group_declared_at` — 0015).

    ⚠️ **이 함수를 부르는 자리가 곧 "사용자가 학령을 직접 골랐다"의 정의**다.
    기본값 경로(온보딩 건너뛰기·`/learn` 딥링크·무바디 게스트 시작)에서 실수로
    호출되면 실운영 로그의 신고/미신고 구분이 통째로 무의미해지고, **로그는
    되감을 수 없어** 8/18 IRT b-재보정이 그 구분을 영영 못 얻는다. 경계는
    `test_level_group_source.py`가 못박는다.

    부르는 곳은 셋뿐이다:
      · `register` — `RegisterRequest.level_group`이 필수라 항상 명시 신고
      · `guest_login` — 바디에 `level_group`이 **실제로 실려 온 경우만**
        (`model_fields_set` — 파싱된 값을 보면 기본값과 구분이 안 된다)
      · `update_me` — `UpdateMeRequest.level_group`이 필수라 항상 명시 신고
    `convert_guest`는 level_group을 받지 않으므로 도장을 건드리지 않는다
    (같은 행 갱신이라 게스트 때 찍힌 신고 시각이 그대로 보존된다).
    """
    return datetime.now(timezone.utc)


async def _store_session(user_id: uuid.UUID, refresh_token: str) -> None:
    """Redis session:{user_id} — refresh token 저장, TTL 7일."""
    redis = get_redis()
    await redis.setex(f"session:{user_id}", SESSION_TTL, refresh_token)


async def _touch_session(user_id: str) -> None:
    """세션 TTL을 다시 SESSION_TTL로 민다 — 슬라이딩 만료 (R13 P-3).

    TTL을 세팅하는 곳이 login·register·guest·convert뿐이라, refresh만 반복하는
    사용자는 **세션 생성 시각 +7일에 하드 컷**으로 401을 맞고 로그아웃됐다.
    게스트는 재진입 경로가 없으므로(P-4) 그 시점에 진도가 통째로 사라진다.
    8/11~18 실운영이 정확히 그 길이이고 URL은 9월 셋째 주까지 살아야 한다.

    refresh token 자체는 회전하지 않는다 — RefreshResponse가 access_token만
    돌려주는 계약이라 회전하려면 스키마를 바꿔야 하고, 슬라이딩 만료의 목적은
    TTL 연장 하나뿐이다.
    """
    redis = get_redis()
    await redis.expire(f"session:{user_id}", SESSION_TTL)


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
        # RegisterRequest.level_group은 필수 필드 — 가입은 언제나 명시 신고다.
        level_group_declared_at=_declared_now(),
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


def is_guest_user(user: User) -> bool:
    """게스트 계정인가 — 이메일 도메인 규약(J)이 유일한 판정 근거.

    convert_guest와 /me가 같은 판정을 써야 "전환 대상이 아닌데 전환 화면"·
    "게스트인데 로그아웃 경고 없음" 같은 어긋남이 안 생긴다(R13 P-4/P-10).
    """
    return user.email.endswith(f"@{GUEST_EMAIL_DOMAIN}")


class GuestStartRequest(BaseModel):
    """게스트 시작 옵션 — **바디 전체가 선택**이다 (R13 P-5).

    학령 신고 writer가 `POST /auth/register`의 필드 하나뿐이라, R10-J가 주 동선으로
    만든 게스트 진입을 탄 사람은 초등학생이든 성인이든 평생 middle_high였다.
    여기를 열면 온보딩에서 학령을 고른 뒤 게스트로 시작하는 경로가 성립한다.

    바디를 생략하면 기존과 완전히 동일하게 동작한다(기본값 middle_high) —
    무바디로 호출하는 기존 프론트·목·스모크가 그대로 통과해야 한다.
    허용값은 RegisterRequest와 같은 `LevelGroup` Literal을 **재사용**한다
    (문자열 사본을 만들면 두 경로가 조용히 갈라진다).
    """

    level_group: LevelGroup = Field(default=GUEST_LEVEL_GROUP)


class UpdateMeRequest(BaseModel):
    """학령 변경 (R13 P-5) — `PATCH /auth/me`.

    학령 신고 writer가 **`POST /auth/register`의 필드 하나뿐**이었다. R10-J가 주
    동선으로 만든 게스트 진입은 register를 아예 타지 않고, 전환(`ConvertRequest`)은
    level_group을 **명시적으로 받지 않으며**, 배치고사 완료도 θ만 건드린다
    (`user.level_group =` 프로덕션 grep 0건). 그래서 게스트로 들어온 사람은
    초등학생이든 성인이든 **평생 middle_high**였고 배치고사로도 못 바꿨다.

    같은 행을 갱신하므로 θ·XP·스트릭·진도는 전부 보존된다(convert와 같은 원리).
    이미 발급된 오늘 세션은 그대로다 — 배합은 발급 시점에 확정되므로 학령 변경은
    **다음 세션부터** 반영된다.

    access token의 `level_group` 클레임은 재발급하지 않는다: `get_current_user`가
    토큰의 클레임이 아니라 **DB 행을 다시 읽어** 유저를 만들기 때문에 다음 요청부터
    새 값이 곧바로 쓰인다(토큰 클레임을 읽는 프로덕션 코드는 0건).
    """

    level_group: LevelGroup


class MeResponse(BaseModel):
    """현재 사용자 정체 (R13 P-4/P-10).

    지금까지 서버는 "너는 게스트다"를 어디서도 알려주지 않아서, 프론트의 게스트
    판별이 100% 클라이언트 상태 의존이었다 — 그 상태가 유실되면 전환 배너가 안 뜨고
    `/account/convert` 직접 진입 시 "이미 정식 계정입니다"라는 거짓 화면이 나온다.
    게스트 로그아웃은 재진입 경로가 없어 진도 영구 소실이므로, 확인창을 띄울지
    판단할 근거를 서버가 제공해야 한다(확인창 자체는 프론트 몫).

    응답 모델을 라우터에 두는 이유: schemas/auth.py는 R13 4일차에 다른 담당이
    소유 중이라 이번 웨이브에서 건드리지 않는다. 안정화되면 그쪽으로 옮긴다.
    """

    user_id: uuid.UUID
    email: str
    nickname: str
    is_guest: bool
    level_group: str


@router.post(
    "/guest", response_model=LoginResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit(LIMIT_AUTH)
async def guest_login(
    request: Request,
    body: GuestStartRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """게스트 시작 — 실 유저 생성 + 실 JWT (응답 형태는 login과 동일 스키마).

    바디는 선택이다 — 없으면 level_group=middle_high (기존 동작·하위 호환).

    학령이 **실제로 실려 왔을 때만** 신고 도장을 찍는다(0015). 온보딩을 건너뛴
    사람과 `/learn` 딥링크로 처음 온 사람이 여기로 들어와 같은 middle_high가
    되는데, 그 구분이 8/18 재보정의 유일한 단서다.
    """
    guest_id = uuid.uuid4()
    # ⚠️ **파싱된 값이 아니라 "필드가 왔는가"를 본다.** `level_group`에는 pydantic
    # 기본값(middle_high)이 채워지므로, `body.level_group`을 보면 무바디·빈 바디·
    # 명시 신고 middle_high가 **전부 똑같이** 보인다 — 그 셋을 가르는 것이 이
    # 작업의 전부라, 여기서 값을 보면 컬럼이 무의미해진다.
    declared = body is not None and "level_group" in body.model_fields_set
    user = User(
        email=f"guest-{guest_id}@{GUEST_EMAIL_DOMAIN}",
        password_hash=hash_password(uuid.uuid4().hex),  # 로그인 불가 무작위 시크릿
        nickname=f"게스트-{guest_id.hex[:6]}",
        level_group=body.level_group if body else GUEST_LEVEL_GROUP,
        level_group_declared_at=_declared_now() if declared else None,
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
    if not is_guest_user(user):
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

    # 슬라이딩 만료 — 계속 쓰는 세션은 만료시키지 않는다 (R13 P-3)
    await _touch_session(user_id)

    return RefreshResponse(
        access_token=create_access_token(str(user.id), user.level_group)
    )


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    """현재 사용자 정체 — 게스트 여부 포함 (R13 P-4/P-10)."""
    return MeResponse(
        user_id=user.id,
        email=user.email,
        nickname=user.nickname,
        is_guest=is_guest_user(user),
        level_group=user.level_group,
    )


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    """학령 변경 — 게스트가 평생 middle_high에 갇히지 않게 하는 유일한 통로 (R13 P-5).

    convert_guest와 같은 패턴이다: `get_current_user`는 별도 세션으로 유저를 읽으므로
    갱신은 이 요청의 db 세션에서 같은 PK 행을 다시 얻어 수행한다(새 행 생성 없음).
    """
    db_user = await db.get(User, user.id)
    if db_user is None:  # 세션 검증~갱신 사이 행 소멸 — 사실상 도달 불가 방어선
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "유효하지 않은 사용자입니다.", "code": "INVALID_CREDENTIALS"},
        )
    db_user.level_group = body.level_group
    # UpdateMeRequest.level_group은 필수 필드 — 이 경로는 언제나 명시 신고다(0015).
    # 재신고는 도장을 **덮어쓴다**: 마지막 신고가 참값이고, 그 이전 로그는
    # `answered_at < level_group_declared_at`으로 재보정에서 갈린다.
    db_user.level_group_declared_at = _declared_now()
    await db.commit()
    return MeResponse(
        user_id=db_user.id,
        email=db_user.email,
        nickname=db_user.nickname,
        is_guest=is_guest_user(db_user),
        level_group=db_user.level_group,
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(user: User = Depends(get_current_user)) -> LogoutResponse:
    redis = get_redis()
    await redis.delete(f"session:{user.id}")
    return LogoutResponse(success=True)

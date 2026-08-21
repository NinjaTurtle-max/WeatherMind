"""Auth API (/api/v1/auth) — 02번 스펙.

| POST | /register | {email, password, nickname, level_group} → {user_id, access_token} (닉네임 중복은 409 NICKNAME_TAKEN) |
| POST | /login    | {email, password} → {access_token, refresh_token} |
| POST | /guest    | {level_group?, nickname?} (바디 선택) → {access_token, refresh_token} (R11-01 J — 실 유저 생성. 닉네임 중복은 409 NICKNAME_TAKEN) |
| POST | /guest/convert | Bearer + {email, password, nickname?} → {access_token, refresh_token} (같은 user_id 유지. 닉네임 중복은 409 NICKNAME_TAKEN — 자기 자신은 제외) |
| POST | /resume   | {email, password} → {access_token, refresh_token} (2026-08-19 오후 — 「진도 불러오기」. 자격 불일치는 401 INVALID_CREDENTIALS. **같은 날 오전의 `{nickname}` 판을 뒤집었다** — 아래 `/resume` 절 주석이 경위를 소유한다) |
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
from pydantic import BaseModel, Field, field_validator
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
    normalize_nickname,
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


async def _ensure_nickname_available(
    db: AsyncSession,
    nickname: str,
    *,
    exclude_user_id: uuid.UUID | None = None,
) -> None:
    """닉네임 유일성 — **닉네임 writer 전건이 지나는 단 하나의 문**(2026-08-21).

    ── 범위: writer 전건 ────────────────────────────────────────────────────
    닉네임을 쓰는 경로는 넷이다: `register` · `guest_login` · `convert_guest` ·
    `update_me`. **넷 다 여기를 지난다.**

    🔴 **종전에는 왜 좁았나 — 지우지 말 것(이력).** 초판(R13)은 이 검사를
    `guest_login`의 신고 경로 **하나에만** 두었고, 그 자리의 주석은 「이 엔드포인트의
    신고 경로가 검사의 전 범위다」라고 스스로 못박고 있었다. 사유는 두 가지였다:
    ① `users.nickname`에 unique 인덱스를 **걸 수 없다**(아래 참조) ② 그러니 넷 다
    물리면 「DB가 못 지키는 전역 규칙」이 된다. ②는 틀린 추론이었다 — DB 제약이
    없다는 사실은 **네 문을 다 좁게 두는 근거가 아니라 네 문 다 최선을 다해야 하는
    근거**다. 실제 귀결은 「진입에선 막히는 이름이 전환·가입에선 통과하는」 이음매였고
    (`CARRYOVER_R13.md` §4.18 · `DEFERRED_AUDIT_0820.md` B11), 그 이음매로 들어온
    동명이인이 리더보드·프로필에 그대로 뜬다. 2026-08-21에 뜻을 뒤집었다.

    ── 여전히 참인 것 — 지우지 말 것 ────────────────────────────────────────
    ① **엔드포인트 검사이고 DB 제약이 아니다.** `users.nickname`에 unique 인덱스를
       걸 수 없다: 기존 게스트들이 자동 부여 닉네임(`게스트-{hex6}`)을 공유하므로
       **인덱스 생성 자체가 실패**한다. 승격하려면 **자동 부여 닉네임부터 유일하게
       만드는 것이 선행**이고, 순서가 뒤바뀌면 마이그레이션이 실패한다(B12 — 범위 밖).
    ② **자동 부여 닉네임은 이 문을 안 지난다.** `guest_login`이 이름을 신고받지
       못했을 때 스스로 붙이는 `게스트-{hex6}`는 검사 없이 저장된다 — 이미 겹쳐 있는
       기존 행들 때문에 검사를 걸면 **발급 자체가 막힌다**. 「writer 전건」은 **사람이
       고른 이름 전건**이라는 뜻이다.
    ③ ⚠️ **경합 창이 실재한다** — 같은 이름을 두 요청이 동시에 보내면 둘 다
       SELECT에서 「없음」을 보고 둘 다 쓴다(TOCTOU). DB 제약이 없으니 막을 최후
       방어선도 없다. **해커톤 규모(동시 진입 수십 명)에서 감수하기로 한 결정**이고,
       실패 모드는 "이름이 겹친 사용자 두 명"뿐이라 데이터 손상도 인증 우회도 아니다.
       넓힌다고 이 창이 커지지도 작아지지도 않는다.

    ── 갱신 경로는 자기 제외형이어야 한다 ───────────────────────────────────
    🔴 `exclude_user_id`를 **반드시** 넘겨야 하는 경로가 둘이다(`convert_guest`·
    `update_me`). 넘기지 않으면 사용자가 **자기 이름을 그대로 다시 저장**할 때
    자기 행에 걸려 409가 난다 — 「닉네임은 그대로 두고 이메일만 바꾸는」 전환과
    「닉네임은 그대로 두고 학령만 바꾸는」 갱신이 통째로 막힌다. 생성 경로
    (`register`·`guest_login`)는 아직 행이 없으므로 넘길 것이 없다.

    ⚠️ **검사값 = 저장값.** 여기 들어오는 이름은 스키마의 `normalize_nickname`이
    이미 다듬은 값이어야 한다. 라우터가 따로 다듬으면 두 자리가 갈라지고, 갈라지는
    순간 `"홍길동 "`이 검사를 통과해 `"홍길동"`으로 저장되는 **눈에 보이지 않는
    중복**이 생긴다(그 계약은 `schemas/auth.py`의 함수 주석이 소유한다).
    """
    conditions = [User.nickname == nickname]
    if exclude_user_id is not None:
        conditions.append(User.id != exclude_user_id)
    taken = await db.execute(select(User.id).where(*conditions))
    if taken.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "이미 사용 중인 닉네임입니다.", "code": "NICKNAME_TAKEN"},
        )


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

    # 유일성 검사는 **유저 생성보다 앞**이다 — 뒤로 밀리면 409에도 고아 유저·해싱·
    # θ 배정이 남는다(`guest_login`이 세운 순서 계약과 같다). 생성 경로라 자기 제외는
    # 없다: 아직 자기 행이 없다.
    await _ensure_nickname_available(db, body.nickname)

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
    # ⚠️ 자격 검사는 **여기 있지 않다** — `_authenticate`(아래 `/resume` 옆)가
    #    단일 소유자다. 2026-08-19에 「진도 불러오기」가 같은 자격을 받게 되면서
    #    검사가 두 벌이 될 뻔했고, 두 벌이면 한쪽만 조여지는 날 **약한 쪽이 그
    #    계정의 실효 강도**가 된다. 응답 문구·코드(401 INVALID_CREDENTIALS)는
    #    바뀌지 않았다 — 옮겼을 뿐이다.
    user = await _authenticate(db, body.email, body.password)

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
    """게스트 시작 옵션 — **바디 전체가 선택**이고 **필드 각각도 선택**이다 (R13 P-5).

    학령 신고 writer가 `POST /auth/register`의 필드 하나뿐이라, R10-J가 주 동선으로
    만든 게스트 진입을 탄 사람은 초등학생이든 성인이든 평생 middle_high였다.
    여기를 열면 온보딩에서 학령을 고른 뒤 게스트로 시작하는 경로가 성립한다.

    바디를 생략하면 기존과 완전히 동일하게 동작한다(학령 middle_high · 닉네임
    자동 부여) — 무바디로 호출하는 기존 프론트·목·스모크가 그대로 통과해야 한다.
    허용값은 RegisterRequest와 같은 `LevelGroup` Literal을 **재사용**한다
    (문자열 사본을 만들면 두 경로가 조용히 갈라진다).

    `nickname`은 진입 화면이 실어 보내는 **선택** 필드다. 「안 적음」의 서버 표현은
    빈 문자열이 아니라 **필드 부재**이므로 `min_length=1`을 건다 — 프론트가 빈 값을
    싣기 시작하면 발급이 422로 죽는 것이 조용히 무시되는 것보다 낫다(그 규약은
    `EntryInfoPage.jsx`의 `pendingNickname`이 같은 문장으로 적어 놓았다).
    상한 50은 `RegisterRequest.nickname`·`users.nickname` 컬럼과 같은 값이다.
    """

    level_group: LevelGroup = Field(default=GUEST_LEVEL_GROUP)
    nickname: str | None = Field(default=None, min_length=1, max_length=50)

    # 앞뒤 공백은 다듬는다. 대소문자는 접지 않는다 — **의도적으로 고른 비대칭**.
    #
    # · **trim은 한다.** 「구름」과 「구름 」은 화면에서 구분되지 않으므로 유일성
    #   검사가 그 둘을 다른 이름으로 보면 **눈에 보이지 않는 중복**이 생긴다.
    #   프론트가 이미 `nickname.trim()`으로 실어 보내므로(`EntryInfoPage.jsx`의
    #   `leave()`) 서버가 같은 규칙이면 두 층이 어긋나지 않고, 다른 클라이언트가
    #   다듬지 않고 보내도 결과가 같아진다.
    # · **대소문자는 안 접는다.** 한글에는 무의미하고 영문 닉네임에만 작용해
    #   「Cloud」와 「cloud」를 같은 이름으로 만드는데, 그건 유일성 규칙이 아니라
    #   **표시 이름 정책**이라 인증 계층이 혼자 정할 것이 아니다. 접기를 도입하려면
    #   writer 전건이 같은 규칙이어야 하는데, 이제 정규화 소유자가 하나이므로
    #   (`normalize_nickname`) 그날 고칠 자리도 하나다. 종전에는 이 자리에
    #   「`register`·`guest/convert`는 유일성 자체를 안 본다」고 적혀 있었다 —
    #   2026-08-21에 검사가 writer 전건으로 넓어져 그 문장이 무효가 됐다.
    #
    # 다듬기 자체는 `schemas.auth.normalize_nickname`이 소유한다 — 검사값과 저장값이
    # 같아야 한다는 계약이 경로마다 다른 사본을 못 견딘다. `mode="before"`인 이유도
    # 그쪽 주석에 있다(다듬은 뒤에 길이 제약이 걸려야 공백뿐인 이름이 422가 된다).
    _trim_nickname = field_validator("nickname", mode="before")(normalize_nickname)


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
    # 🔴 **닉네임도 이 통로로 바꾼다**(2026-08-19 · 8/18 롤링분 ③).
    # 종전에는 닉네임 writer가 **최초 진입(`EntryInfoPage`) 1회뿐**이었다 —
    # `App.jsx`의 `needsEntryInfo = atEntry && entryChoice === undefined`가
    # **이미 들어온 사용자에게는 영영 거짓**이라, 한 번 지나가면 「기상 학습자」
    # (`ko.js` `defaultNickname`)로 고정됐다. 클라이언트가 실화면에서 잡았다.
    #
    # ⚠️ **`None`과 「안 보냄」을 가른다.** `model_fields_set`으로 본다 —
    # 학령만 바꾸는 기존 호출이 닉네임을 지우면 안 되기 때문이다.
    nickname: str | None = None

    @field_validator("nickname", mode="before")
    @classmethod
    def _trim_nickname_update(cls, value: object) -> object:
        """writer 전건과 **같은 정규화**를 쓴다 — 그 위에 이 경로만의 규칙 하나.

        `normalize_nickname`으로 다듬은 값이 빈 문자열이면 `None`으로 접는다:
        여기서 `None`은 「닉네임은 건드리지 마라」이고(위 `model_fields_set` 주석),
        공백뿐인 이름은 「바꾸겠다」로 읽을 수 없기 때문이다. 형제 경로들은 같은
        입력을 422로 떨군다 — 그쪽은 `min_length=1`이 걸린 **생성/전환**이라
        「안 적음」의 표현이 필드 부재이지 빈 문자열이 아니기 때문이다.
        """
        trimmed = normalize_nickname(value)
        if isinstance(trimmed, str):
            return trimmed or None
        return trimmed


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

    바디는 선택이다 — 없으면 level_group=middle_high · 닉네임 자동 부여
    (기존 동작·하위 호환).

    학령이 **실제로 실려 왔을 때만** 신고 도장을 찍는다(0015). 온보딩을 건너뛴
    사람과 `/learn` 딥링크로 처음 온 사람이 여기로 들어와 같은 middle_high가
    되는데, 그 구분이 8/18 재보정의 유일한 단서다.

    닉네임을 신고하면 중복은 409 `NICKNAME_TAKEN`이다 — 닉네임 writer 전건과 같은
    규칙이고, 근거는 `_ensure_nickname_available`이 소유한다.
    """
    guest_id = uuid.uuid4()
    # 신고된 닉네임(없으면 None). 무바디·닉네임 미기재가 같은 None으로 접힌다.
    wanted_nickname = body.nickname if body is not None else None

    # ── 닉네임 유일성 ────────────────────────────────────────────────────────
    # 근거·범위·한계는 전부 `_ensure_nickname_available`이 소유한다(옛 판에서는 이
    # 자리의 긴 주석이 소유했고, 그 주석이 「이 엔드포인트의 신고 경로가 검사의 전
    # 범위다」라고 못박고 있었다 — 2026-08-21에 writer 전건으로 뒤집으면서 소유권을
    # 검사 함수로 옮겼다. 옛 사유는 그쪽 주석에 이력으로 남아 있다).
    #
    # 여기서만 참인 것: 이름을 **신고했을 때만** 검사한다. 신고가 없으면 아래에서
    # `게스트-{hex6}`를 자동 부여하는데, 기존 행들이 그 형태를 이미 공유하고 있어
    # 검사를 걸면 **발급 자체가 막힌다**(검사 함수 주석 ②).
    if wanted_nickname is not None:
        await _ensure_nickname_available(db, wanted_nickname)

    # ⚠️ **파싱된 값이 아니라 "필드가 왔는가"를 본다.** `level_group`에는 pydantic
    # 기본값(middle_high)이 채워지므로, `body.level_group`을 보면 무바디·빈 바디·
    # 명시 신고 middle_high가 **전부 똑같이** 보인다 — 그 셋을 가르는 것이 이
    # 작업의 전부라, 여기서 값을 보면 컬럼이 무의미해진다.
    declared = body is not None and "level_group" in body.model_fields_set
    user = User(
        email=f"guest-{guest_id}@{GUEST_EMAIL_DOMAIN}",
        password_hash=hash_password(uuid.uuid4().hex),  # 로그인 불가 무작위 시크릿
        # 신고한 이름이 있으면 그것, 없으면 종전 그대로 자동 부여.
        nickname=wanted_nickname or f"게스트-{guest_id.hex[:6]}",
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


# ── 진도 불러오기 (2026-08-19 클라이언트 결정 — 주최측 확인 후) ──────────────
#
# 🔴 **같은 날 앞선 결정을 뒤집는다.** 8/19 오전 판은 이 엔드포인트를 `{nickname}`
#    하나로 만들었다. 그 판의 사유는 옳았다 — 진입 화면이 이름을 적게 해 놓고
#    「진도 불러오기」는 이메일·비밀번호를 요구해서 **원리적으로 아무도 못 여는
#    문**이었다(게스트 비밀번호는 무작위 시크릿). 고쳐야 할 것이 있었던 것은 맞다.
#    바꾼 것은 **어느 쪽에 맞추는가**다. 같은 날 오후, 주최측 확인을 거쳐
#    클라이언트가 정했다:
#      *"로그인이 있어도 되나 게스트모드와의 기능적·체험적 부분에 있어 차가
#        나타나지 않으면 된다. 닉네임을 통한 호출은 **보안의 개별성이 약하기에**
#        로그인을 통한 진도 불러오기가 맞는 것 같다"*
#
# 🔴 **왜 서버를 고치는가 — 결함이 여기 있었기 때문이다.**
#    화면만 이메일·비밀번호로 바꾸면 「닉네임 하나로 남의 계정 토큰을 받는 통로」가
#    **서버에 그대로 남는다.** 그때 약한 것은 없어지지 않고 **가려지기만** 한다 —
#    `curl -d '{"nickname":"날씨러버"}' …/auth/resume` 한 번이면 그 사람의 진도가
#    열린다. 브라우저를 거칠 이유가 없다. 그래서 고치는 자리가 화면이 아니라 여기다.
#
# 🔴 **짝이 맞는다는 것이 이 변경의 핵심이다.** 진도 **저장**은 이미
#    `POST /auth/guest/convert {email, password}`다 — 8/19 오전 판은 저장과
#    불러오기가 **서로 다른 열쇠**를 쓰게 두었다(저장은 이메일+비번, 불러오기는
#    닉네임). 이제 같은 열쇠다: 저장할 때 정한 것으로 불러온다.
#
# ⚠️ **닉네임 조회를 되살리지 말 것.** `users.nickname`에는 유니크 제약이 없어서
#    (위 `guest_login`의 「엔드포인트 검사이고 DB 제약이 아니다」 주석) 같은 이름의
#    행이 여럿 존재할 수 있고, 그래서 옛 판은 404 `NICKNAME_NOT_FOUND` ·
#    409 `NICKNAME_AMBIGUOUS`라는 분기를 갖고 있었다. 그 분기는 **자기가 무엇을
#    자백하는지** 말해 준다 — 「그 이름은 있다/없다」를 응답으로 알려 주는 것은
#    이름 열거(enumeration) 표면이고, 그 위에 확인 절차가 하나도 없었다.
#    지금은 존재 여부를 가르지 않고 **401 하나로 뭉친다**(`login`과 같은 의미론).
#
# ⚠️ **게스트로 제한하지 않는 것은 그대로다.** 다만 뜻이 달라졌다 — 옛 판에서는
#    「정식 계정 사용자에게 다른 문이 없어서」였고, 지금은 애초에 자격을 가진 사람만
#    통과하므로 게스트/정식을 가를 이유 자체가 없다. 게스트는 이 문을 **못 연다**
#    (무작위 시크릿). 그래도 규정은 안 깨진다 — 게스트는 이 문이 필요 없고
#    (토큰이 localStorage에 남아 있다) 전 기능을 로그인 없이 쓴다.
#
# ⚠️ 레이트리밋은 형제들과 같은 `LIMIT_AUTH`. 이제는 비밀번호 대입을 막는 몫이다.


class ResumeRequest(BaseModel):
    """진도 불러오기 요청 — **저장할 때 쓴 이메일과 비밀번호**다.

    `LoginRequest`와 형태가 같아야 한다(같은 자격을 같은 방식으로 받는다). 그
    정합은 `test_auth_resume.py`가 두 모델의 필드 집합을 대조해 감시한다 —
    사본을 만들어 두면 한쪽만 조여지는 날 조용히 갈린다.

    ⚠️ **`nickname` 필드를 되살리지 말 것.** 여기에 이름이 들어오는 순간
    「이름만으로 여는 문」이 되살아난다 — 그것이 이 변경이 닫은 결함이다.
    """

    email: str = Field(max_length=255)
    password: str


async def _authenticate(db: AsyncSession, email: str, password: str) -> User:
    """이메일+비밀번호로 계정을 연다 — `login`과 `resume`의 **단일 소유자**.

    🔴 **두 벌로 쓰지 않는 이유가 계약이다.** 불러오기는 로그인과 「같은 자격
    검사」여야 한다는 것이 8/19 결정의 내용인데, 검사를 복사하면 한쪽만 조여지는
    날(예: 잠금·2단계·해시 마이그레이션) 두 문의 강도가 갈린다 — 그리고 약한
    쪽이 그 계정의 실효 강도가 된다.

    ⚠️ **없는 계정과 틀린 비밀번호를 가르지 않는다.** 가르면 응답이
    「그 이메일은 있다」를 자백해 계정 열거 표면이 된다. 옛 닉네임 판이
    404 `NICKNAME_NOT_FOUND`로 정확히 그것을 하고 있었다.
    """
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "이메일 또는 비밀번호가 올바르지 않습니다.",
                "code": "INVALID_CREDENTIALS",
            },
        )
    return user


@router.post("/resume", response_model=LoginResponse)
@limiter.limit(LIMIT_AUTH)
async def resume_with_credentials(
    request: Request, body: ResumeRequest, db: AsyncSession = Depends(get_db)
) -> LoginResponse:
    """저장할 때 쓴 자격으로 그 사람의 진도(=계정)로 돌아간다.

    유저를 **만들지 않는다.** `seed_placement`도 부르지 않는다 — 이미 있는 계정을
    여는 것이라 θ·XP·스트릭은 그 행에 그대로 붙어 있다. 하는 일은 `login`과 같다.

    ⚠️ **그러면 `/login`과 무엇이 다른가 — 이름뿐이고, 그 이름이 제품 계약이다.**
    화면에 「로그인」이라는 낱말을 쓸 수 없고(대회 규정 — i18n 금칙어 계약이 ko·en
    리소스 값 전체를 훑는다) 프론트가 부르는 통로의 이름이 화면의 이름과 같아야
    추적이 끊기지 않는다. 자격 검사는 `_authenticate` **한 곳**이 소유하므로
    두 문의 강도가 갈릴 여지는 없다.

    ⚠️ RLS: `users` SELECT는 `app_auth_users` 정책(인증 카탈로그 예외,
    `docs/specs/08`)이 이미 허용한다 — `login`과 **같은 조회**라 정책을 늘리지
    않는다. 옛 닉네임 판은 `users.nickname` 조회라 같은 예외를 다른 열로 쓰고
    있었는데, 그것도 함께 걷혔다.
    """
    user = await _authenticate(db, body.email, body.password)

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

    # 🔴 **자기 제외형**이어야 한다 — 전환은 **같은 행 갱신**이라 자기 이름을 그대로
    # 다시 실어 보내는 것이 정상 동선이다(전환 화면은 게스트 닉네임을 채워서 띄운다).
    # 제외하지 않으면 자기 행에 걸려 409가 나고 전환이 통째로 막힌다.
    # 종전에는 이 경로에 검사가 **아예 없었다**(검사 함수 주석의 이력 참조).
    #
    # 검사는 **갱신보다 앞**이다 — 뒤에 두면 409로 끝나는 요청도 이메일·비밀번호를
    # 이미 갈아 놓은 상태로 세션에 남긴다(`register`의 순서 계약과 같은 이유).
    if body.nickname is not None:
        await _ensure_nickname_available(
            db, body.nickname, exclude_user_id=db_user.id
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

    🔴 **이 문은 「정리 대상」이 아니다** (2026-08-21 실측 · `5cf90bd` 기준 트리).
    이월 대장 B16이 ~~「화면에서 도달할 경로가 0곳이니 동결 후 정리한다」~~고 적고
    있었는데 **거짓이다** — `frontend/src/App.jsx:552`가 `finishEntryInfo`에서
    `authApi.updateLevelGroup(level)`(→ `api/auth.js:69` → 이 경로)을 부른다. 토큰이
    **이미 발급된 뒤에** 진입 정보를 마치는 가지의 학령 writer가 여기이고, 지우면
    그 가지에서 학령이 조용히 버려진다.
    ⚠️ 그 거짓은 `91e42de` **자신의 본문**에서 왔다 — 같은 커밋 메시지가 한쪽에서는
    *"호출부가 0곳이 아니다"*, 다른 쪽에서는 *"화면에서 도달할 경로가 0곳"*이라고
    적는다. 감사가 그중 **검증되지 않은 쪽**을 인용해 표로 옮겼다.

    ⇒ 그래서 처방은 삭제가 아니라 **계약**이다. `tests/test_level_group_door.py`가
    이 문이 실제로 하는 일을 문다 — 갱신이 커밋되는지 · 거부가 커밋 안 되는지 ·
    **통과한 값이 열림 집합을 실제로 옮기는지**(그리고 내리면 다시 좁아지는지) ·
    재신고 도장이 갱신 시각인지.
    ⚠️ **θ 사전값까지 가는 배선(`de9796a`)은 이 트리에 없다** — 통합에만 있다.
    여기서 잰 「천장이 움직인다」는 **열림 집합** 기준이다. 병합 후 θ 경로가 들어오면
    그 자리도 같은 방식으로 물어야 한다.
    """
    db_user = await db.get(User, user.id)
    if db_user is None:  # 세션 검증~갱신 사이 행 소멸 — 사실상 도달 불가 방어선
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "유효하지 않은 사용자입니다.", "code": "INVALID_CREDENTIALS"},
        )
    # 닉네임은 **온 경우에만** 건드린다(위 스키마 주석 참조).
    if "nickname" in body.model_fields_set and body.nickname is not None:
        # 유일성은 닉네임 writer **전건과 같은 규칙**이다 —
        # `_ensure_nickname_available`이 근거를 소유한다(옛 주석은 「`POST /guest`의
        # 신고 경로와 같은 규칙」이라고 적었는데, 그때는 규칙이 그 한 경로에만
        # 있었기 때문이다).
        # 🔴 자기 자신은 제외해야 「같은 이름으로 다시 저장」이 409가 되지 않는다 —
        # 학령만 바꾸는 호출이 닉네임을 함께 실어 보내는 것이 정상 동선이다.
        await _ensure_nickname_available(
            db, body.nickname, exclude_user_id=db_user.id
        )
        db_user.nickname = body.nickname
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

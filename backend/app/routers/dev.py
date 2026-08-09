"""개발자 모드 API (/api/v1/dev) — R7-03.

| GET  | /state      | 진단용 읽기(θ 원값·overall/target·unlock_floor·구름·스트릭·약점) |
| POST | /reset-me   | 내 종속 데이터 전삭제 + users 가변 필드 리셋 + placement θ 재시드 |
| POST | /theta      | 개념별 θ 직접 설정(_upsert_abilities 재사용, se=0.3)             |
| POST | /placement  | 배치고사 reset(재응시 가능) / complete(now 확정)                 |
| POST | /clouds     | 구름 에너지 직접 설정(0..CLOUD_MAX 런타임 검증)                  |
| POST | /curriculum | unlock_all(전 유닛 crowns≥1) / crown(유닛 지정) / reset          |
| POST | /streak     | 스트릭 카운트·last_login_date 직접 설정                          |

등록은 main.py가 `if settings.DEV_MODE:`로 조건 include — 꺼져 있으면(기본 false,
계약 테스트 감시) 경로 자체가 404다. 전 엔드포인트 JWT 인증(get_current_user) +
RLS 세션(get_db_with_rls) 필수이고, 모든 조작은 user.id 필터로 **자기 계정 한정**
(cross-user 통로 없음 — RLS가 2차 방어). 에러는 기존 {detail, code} 관례에 기존
코드(VALIDATION_ERROR·UNIT_NOT_FOUND)만 재사용한다(신규 코드 없음).

순수/결합 분리 관례(TEAM_PROCESS §1.2): 상태 조립·검증 계산(build_state,
unknown_concept_tags, last_login_from, crown_values)은 DB 의존 없는 순수 함수로
분리해 pytest가 DB 없이 검증한다.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db_with_rls
from app.models.attendance import Attendance
from app.models.badge import UserBadge
from app.models.duel import Duel
from app.models.league_result import LeagueResult
from app.models.quest import UserQuestProgress
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.unit import Unit, UserUnitProgress
from app.models.user import User
from app.models.user_concept_ability import UserConceptAbility
from app.models.weak_tag import WeakTag
from app.schemas.dev import (
    DevAbilityOut,
    DevCloudsRequest,
    DevCloudsResult,
    DevCurriculumRequest,
    DevCurriculumResult,
    DevPlacementRequest,
    DevPlacementResult,
    DevResetResult,
    DevState,
    DevStreakRequest,
    DevStreakResult,
    DevThetaRequest,
    DevThetaResult,
)
from app.services import curriculum_service, energy_service, weatherbrain_service
from app.services.placement_service import MODE_PLACEMENT
from app.services.weather_api import KST

router = APIRouter(prefix="/api/v1/dev", tags=["dev"])

# POST /theta의 theta_se 기본값 — placement 사전 배정과 무관한 dev 주입 표식이자
# 라우팅 계산에 쓰이는 유효한 표준오차(작을수록 확신) 관례값.
DEV_THETA_SE = 0.3

# reset-me 삭제 대상(계약의 10종). quiz_logs → sessions 순서는 FK
# (quiz_logs.session_id → sessions.id) 때문에 고정 — 나머지는 순서 무관.
RESET_MODELS: tuple[type, ...] = (
    QuizLog,
    Session,
    UserConceptAbility,
    WeakTag,
    Attendance,
    LeagueResult,
    UserBadge,
    UserQuestProgress,
    UserUnitProgress,
    Duel,
)


def _validation_error(detail: str) -> HTTPException:
    """기존 422 관례 재사용 — main.py 핸들러와 동일한 {detail, code} 포맷."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"detail": detail, "code": "VALIDATION_ERROR"},
    )


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def unknown_concept_tags(tags: Iterable[str]) -> list[str]:
    """정본 CONCEPT_TAGS에 없는 태그(중복 제거·정렬) — 있으면 422 대상."""
    return sorted(set(tags) - set(weatherbrain_service.CONCEPT_TAGS))


def last_login_from(days_ago: int, today: date) -> date:
    """last_login_days_ago → users.last_login_date 값 (0=오늘)."""
    return today - timedelta(days=days_ago)


def crown_values(crowns: int, crown_target: int, now: datetime) -> dict[str, Any]:
    """crown 조작의 진도 upsert 값 — cleared_at은 crowns≥target 파생(뷰 정합)."""
    return {"crowns": crowns, "cleared_at": now if crowns >= crown_target else None}


def build_state(
    user: Any,
    abilities: Sequence[dict],
    units: Sequence[Any],
    clouds: int,
    max_clouds: int,
) -> DevState:
    """진단 상태 조립 (순수) — abilities는 load_abilities 반환 형식
    ({"concept_tag","theta","se","n"}), 원값 그대로 노출한다.

    target_level_group은 overall θ의 theta_to_level_group, 콜드스타트(θ 없음)는
    소비자 폴백 관례대로 가입 level_group. unlock_floor는 placement_unlock_floor
    재사용(커리큘럼 트리와 동일 산출). weak_tags는 θ 파생 단일 공급원
    (weatherbrain_service.weak_concepts — 학령 상대 임계 적용, R8-01 §3.5)으로
    abilities에서 산출한다 — 구 '임계 미적용 weak_tags 행 나열' 불일치 해소.
    """
    overall = weatherbrain_service.overall_theta(list(abilities))
    return DevState(
        abilities=[
            DevAbilityOut(
                concept_tag=ab["concept_tag"],
                theta=float(ab["theta"]),
                theta_se=float(ab["se"]),
                num_responses=int(ab["n"]),
            )
            for ab in abilities
        ],
        overall_theta=overall,
        target_level_group=(
            weatherbrain_service.theta_to_level_group(overall)
            if overall is not None
            else user.level_group
        ),
        unlock_floor=curriculum_service.placement_unlock_floor(
            list(abilities), units, user.level_group
        ),
        clouds=clouds,
        max_clouds=max_clouds,
        streak_count=user.streak_count,
        placement_done=user.placement_completed_at is not None,
        weak_tags=weatherbrain_service.weak_concepts(
            list(abilities), user.level_group
        ),
    )


# ═══════════════════════════════════════════════════════════════
# 엔드포인트 — 전부 JWT + RLS, 자기 계정 한정
# ═══════════════════════════════════════════════════════════════


@router.get("/state", response_model=DevState)
async def get_dev_state(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevState:
    """진단용 읽기 — 프론트는 이 엔드포인트 200 여부로 dev 패널 노출을 결정한다.

    weak_tags는 build_state가 abilities에서 θ 파생으로 산출한다(R8-01 §3.5)
    — weak_tags 테이블 조회 없음.
    """
    abilities = await weatherbrain_service.load_abilities(db, user)
    units = await curriculum_service.load_units(db)
    energy = await energy_service.get_state(db, user)
    return build_state(user, abilities, units, energy["clouds"], energy["max"])


@router.post("/reset-me", response_model=DevResetResult)
async def reset_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevResetResult:
    """내 종속 데이터 전삭제 + users 가변 필드 리셋 → placement θ 재시드.

    가입 직후 상태 재현: 구름 만렙(CLOUD_MAX)·XP/스트릭 0·placement 미완료.
    seed_placement은 ai-worker 장애 시 조용히 넘어간다(서비스 자체 계약 —
    이후 세션 발급의 refresh_abilities가 사전값을 다시 채운다).
    """
    for model in RESET_MODELS:
        await db.execute(delete(model).where(model.user_id == user.id))

    now = datetime.now(timezone.utc)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            xp=0,
            streak_count=0,
            streak_freeze_count=0,
            last_login_date=None,
            clouds=settings.CLOUD_MAX,
            clouds_updated_at=now,
            placement_completed_at=None,
        )
    )
    await weatherbrain_service.seed_placement(db, user)
    return DevResetResult(reset=True)


@router.post("/theta", response_model=DevThetaResult)
async def set_theta(
    body: DevThetaRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevThetaResult:
    """개념별 θ 직접 설정 — _upsert_abilities 재사용(theta_se 기본 0.3)."""
    unknown = unknown_concept_tags(ab.concept_tag for ab in body.abilities)
    if unknown:
        raise _validation_error(f"존재하지 않는 concept_tag: {unknown}")
    await weatherbrain_service._upsert_abilities(
        db,
        user,
        [
            {
                "concept_tag": ab.concept_tag,
                "theta": ab.theta,
                "se": DEV_THETA_SE,
                "n": ab.num_responses,
            }
            for ab in body.abilities
        ],
    )
    return DevThetaResult(updated=len(body.abilities))


@router.post("/placement", response_model=DevPlacementResult)
async def set_placement(
    body: DevPlacementRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevPlacementResult:
    """배치고사 상태 조작 — reset은 당일 placement 세션·로그까지 삭제(재응시 가능)."""
    if body.action == "complete":
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(placement_completed_at=datetime.now(timezone.utc))
        )
        return DevPlacementResult(placement_done=True)

    # action == "reset"
    await db.execute(
        update(User).where(User.id == user.id).values(placement_completed_at=None)
    )
    today = datetime.now(KST).date()
    session = (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.session_date == today,
                Session.mode == MODE_PLACEMENT,
            )
        )
    ).scalar_one_or_none()
    if session is not None:
        await db.execute(delete(QuizLog).where(QuizLog.session_id == session.id))
        await db.execute(delete(Session).where(Session.id == session.id))
    return DevPlacementResult(placement_done=False)


@router.post("/clouds", response_model=DevCloudsResult)
async def set_clouds(
    body: DevCloudsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevCloudsResult:
    """구름 에너지 직접 설정 — 상한은 env 튜닝값(CLOUD_MAX)이라 런타임 검증."""
    if body.clouds > energy_service.CLOUD_MAX:
        raise _validation_error(
            f"clouds는 0..{energy_service.CLOUD_MAX} 범위여야 합니다."
        )
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(clouds=body.clouds, clouds_updated_at=datetime.now(timezone.utc))
    )
    return DevCloudsResult(clouds=body.clouds, max=energy_service.CLOUD_MAX)


@router.post("/curriculum", response_model=DevCurriculumResult)
async def set_curriculum(
    body: DevCurriculumRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevCurriculumResult:
    """커리큘럼 진도 조작 — 잠금 판정(is_locked)의 crowns>=1 기준을 그대로 이용."""
    if body.action == "reset":
        result = await db.execute(
            delete(UserUnitProgress).where(UserUnitProgress.user_id == user.id)
        )
        return DevCurriculumResult(
            action="reset", affected=result.rowcount if result.rowcount else 0
        )

    if body.action == "unlock_all":
        units = await curriculum_service.load_units(db)
        for unit in units:
            stmt = pg_insert(UserUnitProgress).values(
                user_id=user.id, unit_id=unit.id, crowns=1
            ).on_conflict_do_update(
                constraint="uq_user_unit_progress_user_unit",
                # 기존 진도는 보존(내리지 않음) — 잠금 해제에는 crowns>=1이면 충분
                set_={"crowns": func.greatest(UserUnitProgress.crowns, 1)},
            )
            await db.execute(stmt)
        return DevCurriculumResult(action="unlock_all", affected=len(units))

    # action == "crown" — unit_slug·crowns 필수
    if body.unit_slug is None or body.crowns is None:
        raise _validation_error("action='crown'에는 unit_slug와 crowns가 필요합니다.")
    unit = (
        await db.execute(select(Unit).where(Unit.slug == body.unit_slug))
    ).scalar_one_or_none()
    if unit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 유닛을 찾을 수 없습니다.", "code": "UNIT_NOT_FOUND"},
        )
    values = crown_values(body.crowns, unit.crown_target, datetime.now(timezone.utc))
    stmt = pg_insert(UserUnitProgress).values(
        user_id=user.id, unit_id=unit.id, **values
    ).on_conflict_do_update(
        constraint="uq_user_unit_progress_user_unit", set_=values
    )
    await db.execute(stmt)
    return DevCurriculumResult(action="crown", affected=1)


@router.post("/streak", response_model=DevStreakResult)
async def set_streak(
    body: DevStreakRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DevStreakResult:
    """스트릭 직접 설정 — last_login_date는 KST 오늘 기준 days_ago 역산."""
    last_login = last_login_from(body.last_login_days_ago, datetime.now(KST).date())
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(streak_count=body.streak_count, last_login_date=last_login)
    )
    return DevStreakResult(
        streak_count=body.streak_count, last_login_date=last_login
    )

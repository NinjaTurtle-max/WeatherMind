"""Progress API (/api/v1/progress) — 02번 스펙 + R4-01 §3.1·§3.2·§3.3.

| GET  | /me         | XP·레벨·스트릭·티어·스파인 → {xp, level, streak_count, streak_freeze_count, next_level_xp, tier, ..., spine} |
| GET  | /weak-tags  | 내 약점 태그 목록 (accuracy_rate 오름차순) → WeakTag[] |
| POST | /attendance | 출석 체크 (하루 1회) → {streak_count, is_new_record} |
| GET  | /quests     | 오늘의 일일 퀘스트 진행/완료 (R4-01 §3.1) |
| GET  | /badges     | 배지 정의 + 획득 시각 (R4-01 §3.3) |
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.models.attendance import Attendance
from app.models.user import User
from app.models.user_concept_ability import UserConceptAbility
from app.models.weak_tag import WeakTag
from app.schemas.progress import (
    AttendanceResult,
    BadgeOut,
    ConceptAbilityOut,
    EnergyState,
    ProgressMe,
    QuestOut,
    SpineOut,
    WeakTagOut,
)
from app.services import weatherbrain_service
from app.services import (
    badge_service,
    curriculum_service,
    energy_service,
    league_service,
    quest_service,
    xp_service,
)
from app.services.weather_api import KST

router = APIRouter(prefix="/api/v1/progress", tags=["progress"])


@router.get("/me", response_model=ProgressMe)
async def get_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> ProgressMe:
    level = xp_service.level_from_xp(user.xp)
    tier = await league_service.get_current_tier(db, user.id)
    # 구름 에너지: 읽기 시점에 지연 회복 반영(§3.3)
    energy = await energy_service.get_state(db, user)
    # 스파인(유닛 진도 축) 서버 집계 — R8-01 §3.3 (트리와 동일 정의, read-only)
    spine = await curriculum_service.get_spine(db, user)
    return ProgressMe(
        xp=user.xp,
        level=level,
        streak_count=user.streak_count,
        streak_freeze_count=user.streak_freeze_count,
        next_level_xp=xp_service.next_level_xp(level),
        tier=tier,
        clouds=energy["clouds"],
        next_regen_sec=energy["next_regen_sec"],
        placement_done=user.placement_completed_at is not None,
        spine=SpineOut(**spine),
    )


@router.get("/energy", response_model=EnergyState)
async def get_energy(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> EnergyState:
    """구름 에너지 상태 (§3.3) — 읽기 시점 지연 회복 반영."""
    return EnergyState(**await energy_service.get_state(db, user))


@router.get("/quests", response_model=list[QuestOut])
async def get_quests(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[QuestOut]:
    today = datetime.now(KST).date()
    rows = await quest_service.list_quests(db, user, today)
    return [QuestOut(**row) for row in rows]


@router.get("/badges", response_model=list[BadgeOut])
async def get_badges(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[BadgeOut]:
    rows = await badge_service.list_badges(db, user.id)
    return [BadgeOut(**row) for row in rows]


@router.get("/weak-tags", response_model=list[WeakTagOut])
async def get_weak_tags(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[WeakTagOut]:
    tags = (
        (
            await db.execute(
                select(WeakTag)
                .where(WeakTag.user_id == user.id)
                .order_by(WeakTag.accuracy_rate.asc())
            )
        )
        .scalars()
        .all()
    )
    return [WeakTagOut.model_validate(t) for t in tags]


@router.get("/abilities", response_model=list[ConceptAbilityOut])
async def get_abilities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[ConceptAbilityOut]:
    """WeatherBrain IRT 개념별 능력 θ (약한 개념 순). R6 §5.

    가입 시 사전 배정된 초기 θ부터 시작해 응답이 쌓일수록 갱신된다.
    """
    rows = (
        (
            await db.execute(
                select(UserConceptAbility)
                .where(UserConceptAbility.user_id == user.id)
                .order_by(UserConceptAbility.theta.asc())
            )
        )
        .scalars()
        .all()
    )
    return [
        ConceptAbilityOut(
            concept_tag=r.concept_tag,
            theta=r.theta,
            theta_se=r.theta_se,
            num_responses=r.num_responses,
            level_label=weatherbrain_service.theta_level_label(r.theta),
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/attendance", response_model=AttendanceResult)
async def check_attendance(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> AttendanceResult:
    today = datetime.now(KST).date()

    # 하루 1회 — 이미 출석했으면 현재 스트릭 그대로 반환
    already = (
        await db.execute(
            select(Attendance.id).where(
                Attendance.user_id == user.id, Attendance.attend_date == today
            )
        )
    ).scalar_one_or_none()
    if already is not None:
        return AttendanceResult(streak_count=user.streak_count, is_new_record=False)

    # 기존 최고 스트릭 (신기록 판정용 — 오늘 출석 반영 이전 기준)
    prev_best = (
        await db.execute(
            select(func.coalesce(func.max(Attendance.streak_count_snapshot), 0)).where(
                Attendance.user_id == user.id
            )
        )
    ).scalar_one()

    db_user = await db.get(User, user.id)
    # 프리즈 소모 여부(freeze_used)는 응답 계약 밖 — 스트릭 유지 결과로만 반영
    streak, milestone_hit, _freeze_used = xp_service.update_streak(db_user, today)

    db.add(
        Attendance(
            user_id=user.id, attend_date=today, streak_count_snapshot=streak
        )
    )

    # 일일 출석 +5, 스트릭 마일스톤(7/30/100일) 달성 시 +50 보너스
    xp = xp_service.XP_DAILY_ATTENDANCE
    if milestone_hit:
        xp += xp_service.XP_STREAK_7_BONUS
    await xp_service.add_xp(db, db_user, xp)

    # 스트릭 마일스톤 배지(streak_7/30/100) 지급 — 중복은 UNIQUE로 방어 (R4-01 §3.3)
    if milestone_hit:
        badge_code = badge_service.streak_badge_code(streak)
        if badge_code is not None:
            await badge_service.award_badge(db, user.id, badge_code)

    await db.flush()

    return AttendanceResult(streak_count=streak, is_new_record=streak > prev_best)

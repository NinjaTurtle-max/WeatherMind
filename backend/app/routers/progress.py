"""Progress API (/api/v1/progress) — 02번 스펙.

| GET  | /me         | XP·레벨·스트릭 조회 → {xp, level, streak_count, next_level_xp} |
| GET  | /weak-tags  | 내 약점 태그 목록 (accuracy_rate 오름차순) → WeakTag[] |
| POST | /attendance | 출석 체크 (하루 1회) → {streak_count, is_new_record} |
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.models.attendance import Attendance
from app.models.user import User
from app.models.weak_tag import WeakTag
from app.schemas.progress import AttendanceResult, ProgressMe, WeakTagOut
from app.services import xp_service
from app.services.weather_api import KST

router = APIRouter(prefix="/api/v1/progress", tags=["progress"])


@router.get("/me", response_model=ProgressMe)
async def get_me(user: User = Depends(get_current_user)) -> ProgressMe:
    level = xp_service.level_from_xp(user.xp)
    return ProgressMe(
        xp=user.xp,
        level=level,
        streak_count=user.streak_count,
        next_level_xp=xp_service.next_level_xp(level),
    )


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
    streak, milestone_hit = xp_service.update_streak(db_user, today)

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
    await db.flush()

    return AttendanceResult(streak_count=streak, is_new_record=streak > prev_best)

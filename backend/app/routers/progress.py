"""Progress API (/api/v1/progress) — 02번 스펙 + R4-01 §3.1·§3.2·§3.3.

| GET  | /me         | XP·레벨·스트릭·티어·스파인 → {xp, level, streak_count, streak_freeze_count, next_level_xp, tier, ..., spine, tone} |
| GET  | /weak-tags  | θ 파생 약점 개념 (학령 상대 임계, θ 오름차순 — R8-01 §3.5) → WeakConceptOut[] |
| GET  | /review-queue | 간격반복 복습 큐 (시간 축 — R11-01 C2) → ReviewQueueItem[] |
| GET  | /mastery    | BKT 개념별 숙련 확률 (θ와 별개 축 — R13-01 §5-1) → ConceptMasteryOut[] |
| POST | /attendance | 출석 체크 (하루 1회) → {streak_count, is_new_record} |
| GET  | /quests     | 오늘의 일일 퀘스트 진행/완료 (R4-01 §3.1) |
| GET  | /badges     | 배지 정의 + 획득 시각 (R4-01 §3.3) |
| PUT  | /daily-goal | 일일 목표 문항 수 설정 (R10-01 §3.4) → {daily_goal_items} |
| PUT  | /region     | 사용자 지역 설정 (R11-01 §8.2, KMA_GRID 12도시) → {region} |
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.models.attendance import Attendance
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.models.user_concept_ability import UserConceptAbility
from app.schemas.progress import (
    AttendanceResult,
    BadgeOut,
    ConceptAbilityOut,
    ConceptMasteryOut,
    DailyGoalOut,
    DailyGoalUpdate,
    EnergyState,
    ProgressMe,
    QuestOut,
    RegionOut,
    RegionUpdate,
    ReviewQueueItem,
    SpineOut,
    WeakConceptOut,
)
from app.services import weatherbrain_service
from app.services import (
    badge_service,
    curriculum_service,
    energy_service,
    league_service,
    placement_service,
    quest_service,
    review_schedule_service,
    session_service,
    xp_service,
)
from app.services.weather_api import KMA_GRID, KST

router = APIRouter(prefix="/api/v1/progress", tags=["progress"])

# 일일 목표 허용값 (R10-01 §3.4·D4) — mock의 DAILY_GOAL_CHOICES와 동일.
# SESSION_RECIPE(합 10)와 **독립**이다: 표시용 카운터 타깃이지 세션 배합이 아니다.
DAILY_GOAL_CHOICES = (3, 5, 9)


async def _count_answered_today(
    db: AsyncSession, user: User, today: date
) -> int:
    """오늘(KST) 응답 완료한 문항 수 — 배치고사 제외 (R10-01 D10-2).

    `quest_service._today_facts()`를 재사용하지 않는 이유: 그쪽은 mode 필터가
    없어 placement 6문항이 그대로 잡히고 목표 설정 직후 "6/3 달성"이 뜬다.
    다만 그 함수를 고치면 퀘스트 3종(daily_xp·weak_correct·live_answered)의
    의미가 함께 바뀌므로, 목표 표시용 카운트만 별도로 센다.

    "오늘" 판정은 _today_facts 관례를 그대로 따른다 — 세션 로그는 소속 세션의
    session_date로, 세션 밖 로그(보드 등)는 answered_at이 KST 당일 구간에
    드는지로 판정한다(경계는 session_service.kst_day_start_utc).
    """
    day_start = session_service.kst_day_start_utc(today)
    day_end = session_service.kst_day_start_utc(today + timedelta(days=1))
    today_sessions = select(Session.id).where(
        Session.user_id == user.id,
        Session.session_date == today,
        Session.mode != placement_service.MODE_PLACEMENT,
    )
    count = (
        await db.execute(
            select(func.count())
            .select_from(QuizLog)
            .where(
                QuizLog.user_id == user.id,
                QuizLog.is_correct.is_not(None),  # 응답 완료분만
                or_(
                    QuizLog.session_id.in_(today_sessions),
                    and_(
                        QuizLog.session_id.is_(None),
                        QuizLog.answered_at >= day_start,
                        QuizLog.answered_at < day_end,
                    ),
                ),
            )
        )
    ).scalar_one()
    return int(count or 0)


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
    # 일일 목표 진행 — R10-01 §3.4·D4 (배치고사 제외 카운트, D10-2)
    answered_today = await _count_answered_today(db, user, datetime.now(KST).date())
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
        daily_goal_items=user.daily_goal_items,
        today_answered_count=answered_today,
        region=user.region,
        tone=weatherbrain_service.effective_tone(user),
    )


@router.put("/daily-goal", response_model=DailyGoalOut)
async def set_daily_goal(
    payload: DailyGoalUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DailyGoalOut:
    """일일 목표 문항 수 설정 (R10-01 §3.4·D4) — 허용값 3·5·9, 그 외 422.

    422는 pydantic Literal이 아니라 명시적 HTTPException으로 낸다(D10-4):
    기본 RequestValidationError 본문은 `detail`이 리스트라 mock 계약
    ({detail: str, code: "VALIDATION_ERROR"})과 형식이 갈라진다.
    """
    if payload.items not in DAILY_GOAL_CHOICES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "일일 목표는 "
                + "·".join(str(c) for c in DAILY_GOAL_CHOICES)
                + " 중 하나여야 합니다",
                "code": "VALIDATION_ERROR",
            },
        )
    db_user = await db.get(User, user.id)
    db_user.daily_goal_items = payload.items
    await db.flush()
    return DailyGoalOut(daily_goal_items=payload.items)


@router.put("/region", response_model=RegionOut)
async def set_region(
    payload: RegionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> RegionOut:
    """사용자 지역 설정 (R11-01 §8.2) — KMA_GRID 12도시 화이트리스트, 그 외 422.

    daily-goal 선례 준용(D10-4): 422는 명시적 HTTPException({detail: str,
    code: "VALIDATION_ERROR"})으로 낸다. NULL 해제(미설정 복귀)는 제공하지 않는다 —
    한 번 고르면 지역만 바꾸는 UX(§8.2 픽커)라 계약에 없다.
    """
    if payload.region not in KMA_GRID:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "지원하지 않는 지역입니다: "
                + "·".join(KMA_GRID) + " 중 하나여야 합니다",
                "code": "VALIDATION_ERROR",
            },
        )
    db_user = await db.get(User, user.id)
    db_user.region = payload.region
    await db.flush()
    return RegionOut(region=payload.region)


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


@router.get("/weak-tags", response_model=list[WeakConceptOut])
async def get_weak_tags(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[WeakConceptOut]:
    """θ 파생 약점 개념 목록 (R8-01 §3.5) — 학령 상대 임계 적용, θ 오름차순(약한 순).

    구 weak_tags 테이블 노출을 대체한다(임계 적용 — 목록에 있으면 곧 약점).
    저장 θ read-only(load_abilities), ai-worker 미호출.
    """
    abilities = await weatherbrain_service.load_abilities(db, user)
    weak = set(weatherbrain_service.weak_concepts(abilities, user.level_group))
    threshold = weatherbrain_service.weak_theta_threshold(user.level_group)
    return [
        WeakConceptOut(
            concept_tag=ab["concept_tag"],
            theta=ab["theta"],
            threshold=threshold,
            num_responses=ab["n"],
        )
        for ab in sorted(abilities, key=lambda ab: ab["theta"])
        if ab["concept_tag"] in weak
    ]


@router.get("/review-queue", response_model=list[ReviewQueueItem])
async def get_review_queue(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[ReviewQueueItem]:
    """간격반복 복습 큐 (R11-01 C2) — quiz_logs read-model, 저장·소모 없음.

    weak-tags(θ 파생 약점 — 능력 축)와 다른 축: 마지막 학습 후 시간이 지나
    복습할 때가 된 개념(시간 축). 다음 복습일 = 마지막 응답 KST 달력일 +
    간격 사다리(연속 정답 기반, 오답 리셋), 배치고사 응답 제외(D10-2 전례).
    전 개념이 next_review_at 오름차순으로 실리며 due=도래 여부.
    """
    rows = await review_schedule_service.get_review_queue(
        db, user, datetime.now(KST)
    )
    return [ReviewQueueItem(**row) for row in rows]


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


@router.get("/mastery", response_model=list[ConceptMasteryOut])
async def get_mastery(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[ConceptMasteryOut]:
    """WeatherBrain BKT 개념별 숙련 확률 (숙련 낮은 순). R13-01 §5-1.

    /abilities(θ = 지금 실력)와 **다른 축**이다: 여기 값은 "이 개념을 익혔을
    확률"이고 응답을 시간 순서로 본다. θ 저장소(user_concept_ability)를 읽지도
    쓰지도 않으며, quiz_logs에서 매 조회 시 파생한다(저장 테이블 없음 —
    마이그레이션 불필요). 아직 응답이 없는 개념은 목록에 나타나지 않는다.
    """
    rows = await weatherbrain_service.load_mastery(db, user)
    return [
        ConceptMasteryOut(
            concept_tag=row["concept_tag"],
            p_mastery=row["p_mastery"],
            p_next_correct=row["p_next_correct"],
            num_responses=row["n"],
            cold_start=bool(row["cold_start"]),
            level_label=weatherbrain_service.mastery_label(
                float(row["p_mastery"]), bool(row["cold_start"])
            ),
            params_source=row.get("params_source", "prior"),
        )
        for row in rows
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
        xp += xp_service.XP_STREAK_MILESTONE_BONUS
    await xp_service.add_xp(db, user.id, xp)

    # 스트릭 마일스톤 배지(streak_7/30/100) 지급 — 중복은 UNIQUE로 방어 (R4-01 §3.3)
    if milestone_hit:
        badge_code = badge_service.streak_badge_code(streak)
        if badge_code is not None:
            await badge_service.award_badge(db, user.id, badge_code)

    await db.flush()

    return AttendanceResult(streak_count=streak, is_new_record=streak > prev_best)

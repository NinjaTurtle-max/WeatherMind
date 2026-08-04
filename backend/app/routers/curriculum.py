"""커리큘럼 API (/api/v1/curriculum) + 코스 API (/api/v1/courses) — R5-01 §3.2 · R11-01 §3 F.

| GET  | /curriculum                    | 섹션→유닛 트리(유저 진도·잠금 상태, ?course= 스코프) |
| POST | /curriculum/units/{id}/session | 해당 유닛 문항으로 세션 발급(기존 엔진 재사용) |
| GET  | /courses                       | 코스 목록 (read-only, R11-01 §3 F) |
| GET  | /courses/{slug}                | 코스 상세 (read-only) — 미존재 404 COURSE_NOT_FOUND |

유닛 세션은 mode='unit'·sessions.unit_id로 발급되며, 이후 답안 제출/완료는 기존
/session/{id}/answer·/complete 경로를 재사용한다(구름 소모·유닛 clear 왕관 포함).
잠금 유닛 403 UNIT_LOCKED, 미존재 404 UNIT_NOT_FOUND (§3.5).

발급 경로는 refresh_abilities 1회로 θ를 재추정한다(R8-01 §3.2 — 데일리 전례).
트리 GET은 read-only(load_abilities) 유지 — ai-worker 미호출.

라우터 구성(R11-01 §3 F): main.py는 이 모듈의 `router` 하나만 include 하므로,
/api/v1/curriculum·/api/v1/courses 두 prefix를 서브라우터로 묶어 모듈 하단에서
합성한다 — main.py 무변경(소유 밖), 기존 경로 불변.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_TODAY, limiter, user_or_ip_key
from app.models.unit import Unit
from app.models.user import User
from app.routers.session import session_today_response
from app.schemas.curriculum import (
    CourseOut,
    CoursesOut,
    CurriculumOut,
    SectionOut,
    UnitOut,
)
from app.schemas.session import SessionToday
from app.services import curriculum_service, energy_service, weatherbrain_service
from app.services.weather_api import KST

# main.py가 include 하는 합성 라우터 — 실제 경로는 아래 두 서브라우터에 정의된다.
router = APIRouter()
curriculum_router = APIRouter(prefix="/api/v1/curriculum", tags=["curriculum"])
courses_router = APIRouter(prefix="/api/v1/courses", tags=["courses"])


@curriculum_router.get("", response_model=CurriculumOut)
async def get_curriculum(
    course: str | None = Query(
        None,
        description="코스 slug (R11-01 §3 F) — 생략 시 기본 코스(weather)",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> CurriculumOut:
    """섹션→유닛 트리 — 유저 진도(왕관)·잠금 상태 포함 (§3.2).

    ?course= 는 additive(R11-01 §3 F): 생략·'weather'는 현행과 동일 동작
    (코스 미시드 DB 포함 — 하위 호환). 미존재 코스는 404 COURSE_NOT_FOUND.
    """
    if (
        course is not None
        and course != curriculum_service.DEFAULT_COURSE_SLUG
        and await curriculum_service.get_course_by_slug(db, course) is None
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 코스를 찾을 수 없습니다.", "code": "COURSE_NOT_FOUND"},
        )
    sections = await curriculum_service.get_curriculum(db, user, course_slug=course)
    return CurriculumOut(
        sections=[
            SectionOut(
                section=section["section"],
                units=[UnitOut(**unit) for unit in section["units"]],
            )
            for section in sections
        ]
    )


@curriculum_router.post("/units/{slug}/session", response_model=SessionToday)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def create_unit_session(
    request: Request,
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionToday:
    """유닛 세션 발급 (§3.2) — slug로 조회, 잠금 403 / 미존재 404."""
    unit = (
        await db.execute(select(Unit).where(Unit.slug == slug))
    ).scalar_one_or_none()
    if unit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 유닛을 찾을 수 없습니다.", "code": "UNIT_NOT_FOUND"},
        )

    # θ 재추정 1회 (R8-01 §3.2) — 데일리 발급(session_service:436)과 동일 전례.
    # 커리큘럼만 하는 유저의 θ 동결 해소: 유닛 세션 응답도 다음 발급에 반영된다.
    # ai-worker 실패 시 refresh_abilities가 내부에서 load_abilities로 폴백하므로
    # 발급은 항상 진행. 잠금 판정·풀 정렬이 이 결과를 공유한다(이중 refresh 금지).
    abilities = await weatherbrain_service.refresh_abilities(db, user)

    # 잠금 판정: 선행 crowns>=1 또는 배치 선해제(§3.4) — 트리 노출과 동일 규칙
    if await curriculum_service.is_unit_locked(db, user, unit, abilities=abilities):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "선행 유닛을 먼저 완료해야 합니다.",
                "code": "UNIT_LOCKED",
            },
        )

    # 진입 게이트(R10-01 §3.1·D6): 잠금 403 판정 **이후**, 세션 생성 **직전**에
    # 잔량을 검사한다 — 부족하면 429 OUT_OF_CLOUDS(전역 핸들러 변환). 무소모 검사이며,
    # 유닛 세션은 호출마다 새로 발급되므로(재개 개념 없음 — D10-3) 차단이 진행 중
    # 풀이를 빼앗지 않는다.
    await energy_service.require_entry(db, user)

    today = datetime.now(KST).date()
    session, _ = await curriculum_service.create_unit_session(
        db, user, unit, today, abilities=abilities
    )

    return await session_today_response(db, session, user)


# ═══════════════════════════════════════════════════════════════
# 코스 API (R11-01 §3 F) — read-only 최소. 선택·잠금 UX는 웨이브 2.
# ═══════════════════════════════════════════════════════════════


@courses_router.get("", response_model=CoursesOut)
async def list_courses(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> CoursesOut:
    """코스 목록 — course_order 오름차순. 코스 미시드 DB는 빈 목록(하위 호환)."""
    views = await curriculum_service.course_views(db)
    return CoursesOut(courses=[CourseOut(**view) for view in views])


@courses_router.get("/{slug}", response_model=CourseOut)
async def get_course(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> CourseOut:
    """코스 상세 — 미존재 404 COURSE_NOT_FOUND."""
    for view in await curriculum_service.course_views(db):
        if view["id"] == slug:
            return CourseOut(**view)
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"detail": "해당 코스를 찾을 수 없습니다.", "code": "COURSE_NOT_FOUND"},
    )


# 합성 — main.py의 app.include_router(curriculum.router) 하나로 두 prefix 등록
router.include_router(curriculum_router)
router.include_router(courses_router)

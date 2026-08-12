"""커리큘럼 API (/api/v1/curriculum) + 코스 API (/api/v1/courses) — R5-01 §3.2 · R11-01 §3 F.

| GET  | /curriculum                    | 섹션→유닛 트리(유저 진도·잠금 상태, ?course= 스코프) |
| POST | /curriculum/units/{id}/session | 해당 유닛 문항으로 세션 발급(기존 엔진 재사용) |
| GET  | /courses                       | 코스 목록 (read-only, R11-01 §3 F) |
| GET  | /courses/{slug}                | 코스 상세 (read-only) — 미존재 404 COURSE_NOT_FOUND |

유닛 세션은 mode='unit'·sessions.unit_id로 발급되며, 이후 답안 제출/완료는 기존
/session/{id}/answer·/complete 경로를 재사용한다(구름 소모 포함).
잠금 유닛 403 UNIT_LOCKED, 미존재 404 UNIT_NOT_FOUND (§3.5).

⚠️ **이 경로는 왕관을 주지 않는다** (CO-L5 정정 — 여기 "유닛 clear 왕관 포함"이라
적혀 있었으나 거짓이다). R13-01 §2.10 왕관 소유권 이전 이후 유닛 직접 진입은
**연습 전용**이고 `routers/session.py`가 `grant_crown=False`로 고정한다. 실제
왕관 유입로는 **3개**다: ⑴ 일일 세션의 진도 블록 · ⑵ 보드 퍼즐 최초 클리어
(`routers/board.py`) · ⑶ `/dev` 개발 경로. 목록의 단일 소유자는
`curriculum_service` 모듈 독스트링이다.

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
                subtitle=section.get("subtitle"),
                est_minutes=section.get("est_minutes"),
                topics=section.get("topics", []),
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
    """유닛 세션 발급 (§3.2) — slug로 조회, 잠금 403 / 미존재 404.

    **오늘·같은 유닛의 미완료 세션은 재사용한다**(2026-08-13 — D10-3 대체).
    새로고침 한 번에 `daily_first` 도장이 False로 다시 찍혀 그날의 왕관이 영영
    막히던 결함을 닫는다. 자세한 것은 `curriculum_service.get_open_unit_session`.
    """
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

    today = datetime.now(KST).date()

    # ── 멱등 재사용 (2026-08-13 코드 리뷰 결함 ①) ────────────────────────────
    # 오늘·이 유닛의 **미완료** 세션이 있으면 재발급하지 않고 그것을 그대로
    # 돌려준다. `session_today_response`가 quiz_logs에서 `is_correct`·
    # `retry_correct`를 실어 주므로 진행 상태도 함께 복원된다(CO-A5).
    #
    # ⚠️ **D10-3(「유닛 세션은 호출마다 새로 발급 · 재개 개념 없음」)은 여기서
    # 대체됐다 — 드리프트가 아니다.** 그 판정은 유닛 세션이 데일리와 별개이던
    # 시절의 것이고, 그때 재발급 비용은 「4문항 다시 뽑기」였다. 2026-08-13에
    # 「하루의 첫 유닛 세션이 곧 데일리 세션」이 확정되면서 재발급 비용이
    # **그날의 왕관**이 됐다: 새로고침 한 번이면 2번째 발급이 `daily_first=False`
    # 도장을 받고, 도장은 되돌릴 수 없다. 대체의 전말은
    # `curriculum_service.get_open_unit_session` 독스트링이 소유한다.
    # (D10-3 원문은 `docs/team/SPRINT_R10_01.md` §D10-3 — 이월 대장에 행을 남겼다.)
    session = await curriculum_service.get_open_unit_session(db, user, unit, today)

    if session is None:
        # 진입 게이트(R10-01 §3.1·D6): 잠금 403 판정 **이후**, 세션 생성 **직전**에
        # 잔량을 검사한다 — 부족하면 429 OUT_OF_CLOUDS(전역 핸들러 변환). 무소모 검사.
        #
        # ⚠️ **재사용 분기 안이 아니라 신규 발급 분기 안에서만** 검사한다
        # (`GET /session/today`가 `if session is None:` 안에서만 거는 것과 같은
        # 계약). 게이트가 앞에 있으면 구름 0인 학습자가 **이미 발급된 세션**에
        # 재진입할 때 429로 쫓겨난다 — 「이미 발급된 세션은 잔량 0이어도 끝까지
        # 보장」(R10)이 깨진다. 종전에는 재사용 자체가 없어 이 결함이 잠재해
        # 있었고, 재사용이 생기는 이 편집에서 함께 닫힌다.
        await energy_service.require_entry(db, user)
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

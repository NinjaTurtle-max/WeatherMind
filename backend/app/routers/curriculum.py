"""커리큘럼 API (/api/v1/curriculum) — 스프린트 R5-01 §3.2.

| GET  | /curriculum                    | 섹션→유닛 트리(유저 진도·잠금 상태) |
| POST | /curriculum/units/{id}/session | 해당 유닛 문항으로 세션 발급(기존 엔진 재사용) |

유닛 세션은 mode='unit'·sessions.unit_id로 발급되며, 이후 답안 제출/완료는 기존
/session/{id}/answer·/complete 경로를 재사용한다(구름 소모·유닛 clear 왕관 포함).
잠금 유닛 403 UNIT_LOCKED, 미존재 404 UNIT_NOT_FOUND (§3.5).
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_TODAY, limiter, user_or_ip_key
from app.models.unit import Unit
from app.models.user import User
from app.routers.session import _progress_of, _session_logs, _to_session_item
from app.schemas.curriculum import CurriculumOut, SectionOut, UnitOut
from app.schemas.session import SessionToday
from app.services import curriculum_service
from app.services.weather_api import KST

router = APIRouter(prefix="/api/v1/curriculum", tags=["curriculum"])


@router.get("", response_model=CurriculumOut)
async def get_curriculum(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> CurriculumOut:
    """섹션→유닛 트리 — 유저 진도(왕관)·잠금 상태 포함 (§3.2)."""
    sections = await curriculum_service.get_curriculum(db, user)
    return CurriculumOut(
        sections=[
            SectionOut(
                section=section["section"],
                units=[UnitOut(**unit) for unit in section["units"]],
            )
            for section in sections
        ]
    )


@router.post("/units/{slug}/session", response_model=SessionToday)
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

    # 잠금 판정: 선행 유닛 crowns>=1 필요 (§3.2)
    progress = await curriculum_service.load_progress_by_unit(db, user)
    if curriculum_service.is_locked(unit, progress):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "선행 유닛을 먼저 완료해야 합니다.",
                "code": "UNIT_LOCKED",
            },
        )

    today = datetime.now(KST).date()
    session, _ = await curriculum_service.create_unit_session(db, user, unit, today)

    logs = await _session_logs(db, session)
    meta = {
        m.get("quiz_id"): m
        for m in (session.recipe_json or {}).get("items", [])
    }
    items = [
        _to_session_item(
            log.quiz_id,
            log.question_json or {},
            user.level_group,
            source=meta.get(log.quiz_id, {}).get("source", "bank"),
            slot_filled=meta.get(log.quiz_id, {}).get("slot_filled", False),
        )
        for log in logs
    ]
    return SessionToday(
        session_id=session.id,
        session_date=session.session_date,
        mode=session.mode,
        items=items,
        progress=_progress_of(logs),
    )

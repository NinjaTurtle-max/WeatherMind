"""온보딩 API (/api/v1/onboarding) — 스프린트 R7-01 §3.1.

| POST | /placement/start | 배치고사 세션 발급(mode='placement', 6문항) |

이미 완료(users.placement_completed_at NOT NULL)면 409 PLACEMENT_ALREADY_DONE.
당일 미완료 배치 세션 재호출은 멱등 재조회 — sessions의 daily 부분 유니크 인덱스
((user_id, session_date, mode) WHERE unit_id IS NULL)가 mode='placement'에도
그대로 적용되므로 get_today_session의 선조회→발급→IntegrityError 재조회 패턴을
답습한다. 이후 답안 제출/완료는 기존 /session/{id}/answer·/complete 경로 재사용
(placement는 구름 미소모·XP/퀘스트 스킵 — routers/session.py 분기).
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_TODAY, limiter, user_or_ip_key
from app.models.session import Session
from app.models.user import User
from app.routers.session import _progress_of, _session_logs, _to_session_item
from app.schemas.session import SessionToday
from app.services import placement_service
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


async def _get_placement_session(
    db: AsyncSession, user: User, today
) -> Session | None:
    return (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.session_date == today,
                Session.mode == placement_service.MODE_PLACEMENT,
            )
        )
    ).scalar_one_or_none()


@router.post("/placement/start", response_model=SessionToday)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def start_placement(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> SessionToday:
    """배치고사 세션 발급 (§3.1) — 완료자 409, 당일 미완료 세션은 멱등 재조회."""
    if user.placement_completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "이미 배치고사를 완료했습니다.",
                "code": "PLACEMENT_ALREADY_DONE",
            },
        )

    today = datetime.now(KST).date()

    # 1) 당일 미완료 배치 세션이 있으면 그대로 반환 (멱등 — daily 패턴)
    session = await _get_placement_session(db, user, today)

    # 2) 없으면 발급 — 동시 요청이 부분 유니크 인덱스에 걸리면 재조회
    if session is None:
        try:
            async with db.begin_nested():
                session, _ = await placement_service.create_placement_session(
                    db, user, today
                )
        except IntegrityError:
            logger.info(
                "배치 세션 동시 발급 감지 — 기존 세션 재조회 (user=%s)", user.id
            )
            session = await _get_placement_session(db, user, today)
            if session is None:
                raise

    logs = await _session_logs(db, session)
    meta = {
        m.get("quiz_id"): m
        for m in (session.recipe_json or {}).get("items", [])
    }
    items = [
        _to_session_item(
            log.quiz_id,
            log.question_json or {},
            meta.get(log.quiz_id, {}).get("level_group", user.level_group),
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

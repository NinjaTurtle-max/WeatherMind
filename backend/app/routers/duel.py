"""예보 대결 API (/api/v1/duel) — 스프린트 R4-01 §3.4 (R4-S4).

| GET  | /today   | 오늘 만드는 대결(=내일 예보) 상태. AI 예측은 제출 후에만 공개 |
| POST | /today   | {temp_max, rain_prob} 내일 예보 제출 (1일 1회, 재제출 409) |
| GET  | /history | 내 지난 대결 이력(정산 결과 포함) |

대결 모델(§3.4): duel_date = **예보 대상일(내일)**. 유저는 오늘 내일의 최고기온·
강수확률을 제출하고, AI 캐스터 예측을 결정적 노이즈로 함께 생성·고정한다(LLM 불필요).
UNIQUE(user_id, duel_date)로 1일 1회를 보장한다(재제출 409 ALREADY_SUBMITTED).
다음날(대상일이 어제가 되는 시점) celery 일일 태스크가 실측으로 정산한다.

에러 포맷·인증·레이트리밋은 기존 라우터(session·league) 규칙과 동일하다.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, LIMIT_TODAY, limiter, user_or_ip_key
from app.models.duel import Duel
from app.models.user import User
from app.schemas.duel import DuelHistoryItem, DuelSubmitRequest, DuelToday
from app.services import duel_service, league_service
from app.services.weather_api import KST, get_today_weather

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/duel", tags=["duel"])

# KMA 내일 예보가 없을 때의 중립 기준값 (AI가 유저 예측을 그대로 베끼지 않도록 고정 기준 사용)
_FALLBACK_BASE = {"temp_max": 20.0, "rain_prob": 30.0}

# 예측값 허용 범위 (범위 밖은 INVALID_PREDICTION — 프론트 mock 계약과 문자열 일치)
_TEMP_MIN, _TEMP_MAX = -60.0, 60.0


def _validate_prediction(temp_max: float, rain_prob: int) -> None:
    """예보 예측값 범위 검증 — 위반 시 422 INVALID_PREDICTION (§3.4)."""
    if not (_TEMP_MIN <= temp_max <= _TEMP_MAX) or not (0 <= rain_prob <= 100):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "최고기온·강수확률 값이 올바르지 않습니다.",
                "code": "INVALID_PREDICTION",
            },
        )


def _duel_target_date():
    """대결 대상일 = 내일(KST). 유저는 오늘 내일 예보를 제출한다."""
    return datetime.now(KST).date() + timedelta(days=1)


def _to_today_response(duel: Duel | None, duel_date) -> DuelToday:
    """오늘 대결 상태 응답 구성 — 미제출이면 submitted=false·AI 비공개."""
    if duel is None:
        return DuelToday(duel_date=duel_date, submitted=False)
    return DuelToday(
        duel_date=duel.duel_date,
        submitted=True,
        user_pred=duel.user_pred,
        ai_pred=duel.ai_pred,  # 제출 후 공개
        actual=duel.actual,
        user_score=duel.user_score,
        ai_score=duel.ai_score,
        result=duel.result,
        # R9-01 §3.2 — 제출 시점 스냅샷(ai_pred JSONB)에서 파생. R9 이전 행은 null.
        caster_grade=(duel.ai_pred or {}).get("caster_grade"),
    )


async def _get_duel(db: AsyncSession, user: User, duel_date) -> Duel | None:
    return (
        await db.execute(
            select(Duel).where(
                Duel.user_id == user.id, Duel.duel_date == duel_date
            )
        )
    ).scalar_one_or_none()


@router.get("/today", response_model=DuelToday)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def get_today_duel(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DuelToday:
    duel_date = _duel_target_date()
    duel = await _get_duel(db, user, duel_date)
    return _to_today_response(duel, duel_date)


@router.post("/today", response_model=DuelToday)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def submit_today_duel(
    request: Request,
    body: DuelSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DuelToday:
    _validate_prediction(body.temp_max, body.rain_prob)
    duel_date = _duel_target_date()

    # 1일 1회 — 이미 제출했으면 409 (league /predict 패턴)
    existing = await _get_duel(db, user, duel_date)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "오늘 예보 대결을 이미 제출했습니다.", "code": "ALREADY_SUBMITTED"},
        )

    # AI 캐스터 예측 — KMA 내일 예보(TMX·POP) 기준 결정적 노이즈로 제출 시점에 고정(§3.4)
    weather = await get_today_weather()
    base = duel_service.extract_forecast_for_date(weather, duel_date) or _FALLBACK_BASE

    # 적응형 캐스터(R9-01 §3.2): 유저 ELO 조달 → 티어별 노이즈 배율.
    # 시드는 (user,date) 불변 — 배율은 진폭에만 적용(결정성 보존).
    elo = await league_service.get_current_rating(db, user.id)
    noise_scale = duel_service.caster_noise_scale(elo)
    ai_pred = duel_service.ai_caster_prediction(
        base["temp_max"],
        base["rain_prob"],
        str(user.id),
        duel_date,
        noise_scale=noise_scale,
    )
    # 제출 시점 스냅샷을 ai_pred JSONB에 동봉(§3.2 감사 가능) — noise_scale은 계약
    # 필드, caster_grade는 컬럼·마이그레이션 없이 history 노출을 위한 티어명 스냅샷
    # (이후 티어가 변해도 과거 대결의 등급 표시는 제출 시점 그대로).
    ai_pred |= {
        "noise_scale": noise_scale,
        "caster_grade": duel_service.caster_grade(elo),
    }

    user_pred = {"temp_max": body.temp_max, "rain_prob": body.rain_prob}
    duel = Duel(
        user_id=user.id,
        duel_date=duel_date,
        user_pred=user_pred,
        ai_pred=ai_pred,
    )
    db.add(duel)
    try:
        await db.flush()
    except IntegrityError:
        # 동시 제출이 UNIQUE 제약에 걸림 — 재제출과 동일 취급(409)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "오늘 예보 대결을 이미 제출했습니다.", "code": "ALREADY_SUBMITTED"},
        )

    return _to_today_response(duel, duel_date)


@router.get("/history", response_model=list[DuelHistoryItem])
async def get_duel_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[DuelHistoryItem]:
    duels = (
        (
            await db.execute(
                select(Duel)
                .where(Duel.user_id == user.id)
                .order_by(Duel.duel_date.desc())
            )
        )
        .scalars()
        .all()
    )
    return [DuelHistoryItem.model_validate(d) for d in duels]

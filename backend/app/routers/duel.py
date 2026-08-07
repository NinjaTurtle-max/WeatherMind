"""예보 대결 API (/api/v1/duel) — 스프린트 R4-01 §3.4 (R4-S4).

| GET  | /today    | 오늘 만드는 대결(=내일 예보) 상태 + base_forecast. AI 예측은 제출 후에만 공개 |
| POST | /today    | {temp_max, rain_prob, evidence?} 내일 예보 제출 (1일 1회, 재제출 409) |
| GET  | /briefing | 대상일 판단 재료(시간별 예보·오늘/최근 실측) — R9-01 §3.1 ② |
| GET  | /history  | 내 지난 대결 이력(정산 결과 포함) |

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
from app.schemas.duel import DuelBriefing, DuelHistoryItem, DuelSubmitRequest, DuelToday
from app.services import duel_service, league_service
from app.services.weather_api import (
    DEFAULT_REGION,
    KST,
    KMAApiError,
    get_past_observation,
    get_today_weather,
)

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
    """대결 대상일 = 내일(KST) — 정의는 duel_service가 단독 소유한다.

    세션 마감 단계(session_service.forecast_closing_step)가 같은 함수를 봐야
    "오늘 이미 제출했다" 판정이 두 경로에서 같은 날짜를 가리킨다.
    """
    return duel_service.duel_target_date()


def _validate_evidence(evidence: list[str] | None) -> list[str] | None:
    """근거 코드 화이트리스트 검증 + 순서 보존 중복 제거 (R9-01 §3.1 ③).

    미지 코드는 422 INVALID_EVIDENCE(도메인 코드 — INVALID_PREDICTION과 동일 관례).
    빈 리스트는 미선택(None)으로 정규화한다.
    """
    if not evidence:
        return None
    unknown = [c for c in evidence if c not in duel_service.EVIDENCE_CODES]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": f"알 수 없는 근거 코드입니다: {', '.join(unknown)}",
                "code": "INVALID_EVIDENCE",
            },
        )
    return list(dict.fromkeys(evidence))


def _to_today_response(
    duel: Duel | None, duel_date, base_forecast: dict | None = None
) -> DuelToday:
    """오늘 대결 상태 응답 구성 — 미제출이면 submitted=false·AI 비공개.

    base_forecast는 KMA 대상일 예보(R9-01 §3.1 additive) — 실패 시 None 그대로
    내려 프론트가 배너를 숨긴다(_FALLBACK_BASE는 캐스터 내부용, 여기 비노출).
    evidence는 user_pred JSONB 동봉분에서 추출, evidence_review는 정산 후에만
    계산된다(§3.1 ④ — review_evidence가 미정산이면 None).
    """
    if duel is None:
        return DuelToday(
            duel_date=duel_date, submitted=False, base_forecast=base_forecast
        )
    return DuelToday(
        duel_date=duel.duel_date,
        submitted=True,
        base_forecast=base_forecast,
        user_pred=duel.user_pred,
        ai_pred=duel.ai_pred,  # 제출 후 공개
        actual=duel.actual,
        user_score=duel.user_score,
        ai_score=duel.ai_score,
        result=duel.result,
        evidence=(duel.user_pred or {}).get("evidence"),
        evidence_review=duel_service.review_evidence(duel.user_pred, duel.actual),
        # R9-01 §3.2 — 제출 시점 스냅샷(ai_pred JSONB)에서 파생. R9 이전 행은 null.
        caster_grade=(duel.ai_pred or {}).get("caster_grade"),
        xp_earned=_duel_xp_earned(duel.result),
    )


async def _base_forecast_for(duel_date) -> dict | None:
    """대상일 KMA 기준 예보 {temp_max, rain_prob} — 실패·키 부재·대상일 미포함이면 None.

    get_today_weather가 Redis 1h 캐시(+5분 실패 마커) 뒤에 있어 GET마다 호출해도
    KMA 재호출·타임아웃 비용은 지불하지 않는다 (R9-01 §1).
    **서울 고정**(R11-01 §8 계약 정정) — 대결은 리그와 같은 채점 축이라 정산
    (celery settle_daily_duel, 서울 실측)과 같은 지역을 봐야 한다. 유저 지역화는
    duels.region 스냅샷 + 정산 지역화와 함께만 성립(R12 후속, 아래 submit 주석).
    """
    weather = await get_today_weather()
    return duel_service.extract_forecast_for_date(weather, duel_date)


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
    base_forecast = await _base_forecast_for(duel_date)
    return _to_today_response(duel, duel_date, base_forecast)


@router.get("/briefing", response_model=DuelBriefing)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def get_duel_briefing(
    request: Request,
    user: User = Depends(get_current_user),
) -> DuelBriefing:
    """예보 브리핑 (R9-01 §3.1 ②) — 대상일 예측 판단 재료 일괄 제공.

    전부 기존 weather_api 재사용(Redis 1h 캐시+실패 마커 뒤). 부분 실패는 해당
    필드만 null/빈 배열로 내리고 200을 유지한다 — KMA 키 부재 시 프론트 degraded
    모드(예측 입력은 가능). 시간별 시계열은 제출일+대상일을 함께 담아 추세
    (pop_trend)·전일 대비(temp_drop) 판단이 가능하게 한다. DB 미사용.
    """
    today = datetime.now(KST).date()
    target_date = _duel_target_date()

    # ⚠️ 대결 브리핑은 유저 지역화 **대상이 아니다** (R11-01 §8 계약 정정 — PM 판정).
    # 정산이 서울 실측 고정(celery settle_daily_duel)이라 판단 재료를 유저 지역으로
    # 주면 "부산 예보 보고 예측 → 서울 실측 채점"의 정합성 붕괴가 생긴다. 대결·리그는
    # 같은 채점 축("서울 기준 전국 대결")을 유지한다 — 세션 실황·RAG 피드백과 다른 점.
    weather = await get_today_weather()  # 실패 시 {} — hourly는 빈 배열이 된다
    hourly = duel_service.briefing_hourly(weather, (today, target_date))

    try:
        rows = await get_past_observation(
            (today - timedelta(days=duel_service.BRIEFING_RECENT_DAYS_MAX)).strftime("%Y%m%d"),
            today.strftime("%Y%m%d"),
        )
    except (KMAApiError, ValueError) as exc:
        logger.error("브리핑 과거관측 조회 실패: %s", exc)
        rows = []
    today_observed, recent_days = duel_service.split_daily_observations(rows, today)

    return DuelBriefing(
        region=DEFAULT_REGION,
        target_date=target_date,
        hourly=hourly,
        today_observed=today_observed,
        recent_days=recent_days,
    )


@router.post("/today", response_model=DuelToday)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def submit_today_duel(
    request: Request,
    body: DuelSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DuelToday:
    _validate_prediction(body.temp_max, body.rain_prob)
    evidence = _validate_evidence(body.evidence)
    duel_date = _duel_target_date()

    # 1일 1회 — 이미 제출했으면 409 (league /predict 패턴)
    existing = await _get_duel(db, user, duel_date)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": "오늘 예보 대결을 이미 제출했습니다.", "code": "ALREADY_SUBMITTED"},
        )

    # AI 캐스터 예측 — KMA 내일 예보(TMX·POP) 기준 결정적 노이즈로 제출 시점에 고정(§3.4).
    # **서울 고정**(R11-01 §8 계약 정정) — 정산(celery settle_daily_duel)이 서울 실측
    # 기준이므로 유저·캐스터의 판단 재료도 같은 축이어야 공정하다. 대결의 유저
    # 지역화는 duels.region 제출 시점 스냅샷 + 정산 지역화 + ASOS 지점 12도시 보강
    # (현재 서울·부산·강릉 3/12)이 갖춰져야 성립 — KMA 키 이후 별건(R12 후속).
    weather = await get_today_weather()
    base_forecast = duel_service.extract_forecast_for_date(weather, duel_date)
    base = base_forecast or _FALLBACK_BASE

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

    # 근거 선택은 user_pred JSONB에 동봉 저장 (§3.1 ③ — 마이그레이션 0).
    # temp_drop 판정용 기준 기온(제출일 예보 최고기온)도 함께 스냅샷해
    # 정산 후 review_evidence가 결정적으로 대조할 수 있게 한다(§3.1 ④).
    user_pred = {"temp_max": body.temp_max, "rain_prob": body.rain_prob}
    if evidence:
        user_pred["evidence"] = evidence
        if "temp_drop" in evidence:
            today_base = duel_service.extract_forecast_for_date(
                weather, datetime.now(KST).date()
            )
            user_pred["evidence_ctx"] = {
                "today_temp_max": today_base["temp_max"] if today_base else None
            }
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

    return _to_today_response(duel, duel_date, base_forecast)


def _duel_xp_earned(result: str | None) -> int | None:
    """정산으로 받은 XP (R10 ponytail). 정산 전이면 null, 승리면 DUEL_WIN_XP, 그 외 0.

    액수를 프론트가 하드코딩하지 않게 **서버가 보낸다** — 프론트에 있던 미러 상수
    (lib/xpConstants.js)를 지운 이유다. 값의 단일 소유자는 duel_service.DUEL_WIN_XP.
    """
    if result is None:
        return None
    return duel_service.DUEL_WIN_XP if result == "win" else 0


def _history_item(duel: Duel) -> DuelHistoryItem:
    """이력 항목 구성 — evidence는 user_pred 동봉분 추출, 적중 해설은 정산분만 계산."""
    return DuelHistoryItem(
        id=duel.id,
        duel_date=duel.duel_date,
        user_pred=duel.user_pred,
        ai_pred=duel.ai_pred,
        actual=duel.actual,
        user_score=duel.user_score,
        ai_score=duel.ai_score,
        result=duel.result,
        evidence=(duel.user_pred or {}).get("evidence"),
        evidence_review=duel_service.review_evidence(duel.user_pred, duel.actual),
        xp_earned=_duel_xp_earned(duel.result),
    )


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
    return [_history_item(d) for d in duels]

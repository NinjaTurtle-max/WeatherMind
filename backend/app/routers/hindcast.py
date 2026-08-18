"""과거 예보 API (/api/v1/hindcast) — MT-30 (대장 §0.8.6 「과거 날짜 리플레이 1개」).

| GET  | /cases                      | 회차 목록 — **실측·해설 없음**(정답 비공개) |
| POST | /cases/{case_id}/predict    | {temp_max, rain_prob} 제출 → 서버 채점·판정 |
| GET  | /attempts                   | 내 과거 예보 이력 |

「예보 대결」(duel)은 오늘 제출 → **다음날 정산**이라 결과를 보려면 하루를 기다려야
하고, 실데이터가 쌓이기를 기다려야 한다. hindcast는 실측이 **이미 확정된 과거 날짜**를
쓰므로 제출 즉시 판정이 끝난다 — celery 정산 배치가 관여하지 않는다.

## 이 라우터가 지키는 성질

1. **채점 권위는 서버.** 요청 본문은 `temp_max`·`rain_prob` 둘뿐이다. 점수·승패·
   실측을 클라이언트가 주입할 통로가 **구조적으로 없다**(`HindcastSubmitRequest`에
   그 필드가 없다). 판정은 `hindcast_service.grade` → `duel_service.settle_scores`
   → `league_service.accuracy_score`로, duel과 **같은 공식 단일 소유자**를 탄다.
2. **정답 비공개.** `GET /cases`가 쓰는 `HindcastCaseSummary`에는 실측·해설 필드가
   없다(스키마 독스트링). 제출 전에 긁어낼 자리가 없다.
3. **회차당 1회.** 재제출은 409 `ALREADY_SUBMITTED`(duel `/today`와 같은 코드).
   정답이 고정된 회차라 이 계약이 없으면 반복 제출로 100점을 만들 수 있다.
   경합은 DB UNIQUE(user_id, case_id)가 막고 IntegrityError를 409로 바꾼다.
4. **유저 격리.** 이력 조회는 `user_id` 앱 필터 + RLS user_isolation 2층이다
   (0016). 남의 기록을 지목해 읽는 경로가 없다 — 조회 키가 유저 자신뿐이다.
5. **KMA 키·LLM 없이 동작.** 실측이 픽스처에 있어 외부 호출이 0이다. degraded가
   아니라 **키 유무와 무관하게 같은 동작**이다(이 저장소의 무키 전 기능 동작 계약).

에러 포맷·인증·레이트리밋은 기존 라우터(duel·detective) 규칙과 동일하다.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, LIMIT_TODAY, limiter, user_or_ip_key
from app.models.hindcast_attempt import HindcastAttempt
from app.models.user import User
from app.schemas.hindcast import (
    HindcastAttemptList,
    HindcastCaseList,
    HindcastCaseSummary,
    HindcastResult,
    HindcastSubmitRequest,
)
from app.services import hindcast_service, league_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/hindcast", tags=["hindcast"])


def _result_payload(case: dict | None, row: HindcastAttempt) -> dict:
    """저장된 시도 행 + 픽스처 메타 → 응답 dict.

    해설·출처·제목은 저장하지 않고 픽스처에서 붙인다(값의 소유자를 한 곳에 둔다).
    회차가 픽스처에서 사라진 뒤에도 이력이 열려야 하므로 case가 None이면 메타만
    비우고 채점 결과는 그대로 돌려준다.
    """
    return {
        "case_id": row.case_id,
        "observed_date": (
            case["observed_date"] if case else row.actual.get("observed_date")
        ),
        "title": case["title"] if case else row.case_id,
        "user_pred": row.user_pred,
        "ai_pred": row.ai_pred,
        "actual": row.actual,
        "user_score": float(row.user_score),
        "ai_score": float(row.ai_score),
        "result": row.result,
        "explanation": case["explanation"] if case else None,
        "sources": case["sources"] if case else None,
        "created_at": row.created_at,
    }


@router.get("/cases", response_model=HindcastCaseList)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def list_hindcast_cases(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> HindcastCaseList:
    """제공 중인 과거 예보 회차 — 실측·해설은 담지 않는다(스키마가 구조적으로 배제)."""
    played = set(
        (
            await db.execute(
                select(HindcastAttempt.case_id).where(
                    HindcastAttempt.user_id == user.id
                )
            )
        )
        .scalars()
        .all()
    )
    cases = [
        HindcastCaseSummary(
            case_id=case["case_id"],
            observed_date=case["observed_date"],
            region=case["region"],
            station=case["station"],
            title=case["title"],
            intro=case["intro"],
            climatology=case["caster_base"],
            is_demo_fixture=True,
            disclosure=hindcast_service.DISCLOSURE,
            already_played=case["case_id"] in played,
        )
        for case in hindcast_service.list_cases()
    ]
    return HindcastCaseList(cases=cases, disclosure=hindcast_service.DISCLOSURE)


@router.post("/cases/{case_id}/predict", response_model=HindcastResult)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def submit_hindcast_prediction(
    request: Request,
    case_id: str,
    body: HindcastSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> HindcastResult:
    """과거 날짜 예보 제출 → 서버가 실측으로 즉시 채점한다 (회차당 1회)."""
    case = hindcast_service.get_case(case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "그런 과거 예보 회차가 없습니다.", "code": "CASE_NOT_FOUND"},
        )

    if not hindcast_service.validate_prediction(body.temp_max, body.rain_prob):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "최고기온·강수확률 값이 올바르지 않습니다.",
                "code": "INVALID_PREDICTION",
            },
        )

    # 회차당 1회 (duel /today 패턴). 경합은 아래 UNIQUE가 막는다.
    existing = await db.execute(
        select(HindcastAttempt).where(
            HindcastAttempt.user_id == user.id,
            HindcastAttempt.case_id == case_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "이 회차는 이미 예보했습니다.",
                "code": "ALREADY_SUBMITTED",
            },
        )

    # AI 캐스터 — 평년값 기준 결정적 노이즈. 적응형 배율은 duel과 같은 함수를 탄다.
    elo = await league_service.get_current_rating(db, user.id)
    ai_pred = hindcast_service.caster_prediction(case, user.id, elo)

    user_pred = {"temp_max": body.temp_max, "rain_prob": body.rain_prob}
    user_score, ai_score, result = hindcast_service.grade(case, user_pred, ai_pred)

    actual_snapshot = {
        **hindcast_service.scoring_actual(case),
        "sum_rn": case["actual"]["sum_rn"],
        # 회차가 픽스처에서 사라져도 이력의 날짜가 남게 스냅샷에 함께 적는다.
        "observed_date": case["observed_date"].isoformat(),
    }

    row = HindcastAttempt(
        user_id=user.id,
        case_id=case_id,
        user_pred=user_pred,
        ai_pred=ai_pred,
        actual=actual_snapshot,
        user_score=user_score,
        ai_score=ai_score,
        result=result,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        # UNIQUE(user_id, case_id) — 동시 제출 경합. 위 SELECT가 놓친 경로.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "이 회차는 이미 예보했습니다.",
                "code": "ALREADY_SUBMITTED",
            },
        )
    await db.refresh(row)

    return HindcastResult(**_result_payload(case, row))


@router.get("/attempts", response_model=HindcastAttemptList)
@limiter.limit(LIMIT_TODAY, key_func=user_or_ip_key)
async def list_hindcast_attempts(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> HindcastAttemptList:
    """내 과거 예보 이력 — 최신순. 조회 키가 유저 자신뿐이라 남의 기록 경로가 없다.

    메타는 `find_case_meta`로 붙인다(**보류분 포함**) — 회차가 보류돼도 이미 제출한
    사람의 기록이 제목·해설·출처를 잃지 않아야 한다. 제출은 `get_case`(활성 한정)를
    타므로 이 경로가 보류 회차의 플레이를 열어 주지는 않는다.
    """
    rows = (
        (
            await db.execute(
                select(HindcastAttempt)
                .where(HindcastAttempt.user_id == user.id)
                .order_by(HindcastAttempt.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return HindcastAttemptList(
        attempts=[
            HindcastResult(
                **_result_payload(hindcast_service.find_case_meta(row.case_id), row)
            )
            for row in rows
        ]
    )

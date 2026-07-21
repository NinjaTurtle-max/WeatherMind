"""예보 대결 API 스키마 — 스프린트 R4-01 §3.4.

AI 예측(ai_pred)은 제출 후에만 공개한다 — GET(미제출)에서는 submitted=false로
숨기고, POST 응답과 GET(제출 후)에서만 노출한다.
"""
import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class DuelPrediction(BaseModel):
    """예보 예측값(유저·AI 공통) — 내일 최고기온·강수확률."""

    temp_max: float
    rain_prob: int = Field(ge=0, le=100)


class DuelSubmitRequest(BaseModel):
    """POST /duel/today 요청 — 내일 예보 제출.

    범위 검증은 라우터에서 수행해 도메인 에러 코드(INVALID_PREDICTION)로 응답한다
    (프론트 mock 계약과 문자열 일치). 여기서 ge/le를 걸면 일반 VALIDATION_ERROR로
    선점되므로 걸지 않는다 — 숫자 형변환 실패만 pydantic이 잡는다.
    """

    temp_max: float
    rain_prob: int


class DuelToday(BaseModel):
    """GET/POST /duel/today 응답 — 오늘 대결 상태.

    submitted=false면 ai_pred=null(제출 전 비공개), true면 내 예측·AI 예측을 함께 준다.
    result/user_score/ai_score는 다음날 정산 후 채워진다(그 전엔 null).
    """

    duel_date: date
    submitted: bool
    user_pred: DuelPrediction | None = None
    ai_pred: DuelPrediction | None = None
    actual: DuelPrediction | None = None
    user_score: Decimal | None = None
    ai_score: Decimal | None = None
    result: str | None = None


class DuelHistoryItem(BaseModel):
    """GET /duel/history 항목."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    duel_date: date
    user_pred: dict
    ai_pred: dict
    actual: dict | None = None
    user_score: Decimal | None = None
    ai_score: Decimal | None = None
    result: str | None = None

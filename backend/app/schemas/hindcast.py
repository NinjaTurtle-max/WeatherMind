"""과거 예보(hindcast) API 스키마 — MT-30.

**정답은 구조적으로 없다.** 회차 목록·상세(`HindcastCaseSummary`)에는 `actual`·
`sum_rn`·`user_score`·`ai_score`·`result`·`explanation`·`sources` 필드가 **모델에
아예 존재하지 않는다** — 세션의 `QUESTION_PAYLOAD_FIELDS` 화이트리스트와
`schemas/detective.py`가 세운 관례와 같은 급의 보증이다. 필드를 하나 늘리다
실측을 딸려 보내는 회귀를 타입이 막는다.

실측·점수·해설은 **제출 응답(`HindcastResult`)에서만** 나간다.
"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class HindcastClimatology(BaseModel):
    """그 달력날짜의 평년값 — AI 캐스터의 기준값이자 학습자에게 주는 판단 재료.

    실측이 아니다(평년값은 정답을 알려주지 않는다). duel의 base_forecast가
    참고용으로 공개되는 것과 같은 위치다.
    """

    temp_max: float
    rain_prob: int = Field(ge=0, le=100)


class HindcastCaseSummary(BaseModel):
    """GET /hindcast/cases 원소 — **실측·해설 없음**(위 독스트링).

    is_demo_fixture·disclosure: 이 회차가 「데모용 고정 날짜」임을 응답에 담는다.
    화면만 고지하면 API를 직접 보는 심사자에게는 그 사실이 닿지 않는다.
    already_played: 이미 제출한 회차인지(재제출은 409) — UI가 완료 표시에 쓴다.
    """

    case_id: str
    observed_date: date
    region: str
    station: str
    title: str
    intro: str
    climatology: HindcastClimatology
    is_demo_fixture: bool
    disclosure: str
    already_played: bool


class HindcastCaseList(BaseModel):
    cases: list[HindcastCaseSummary]
    disclosure: str


class HindcastSubmitRequest(BaseModel):
    """POST /hindcast/cases/{case_id}/predict 요청.

    범위 검증은 라우터가 도메인 에러 코드(INVALID_PREDICTION)로 응답한다 —
    duel `DuelSubmitRequest`와 같은 이유로 여기서 ge/le를 걸지 않는다(걸면
    일반 VALIDATION_ERROR가 선점한다).
    """

    temp_max: float
    rain_prob: int


class HindcastPrediction(BaseModel):
    temp_max: float
    rain_prob: int = Field(ge=0, le=100)
    # AI 캐스터 전용(적응형 노이즈 감사 스냅샷) — 유저 예측에는 없어 null이다.
    noise_scale: float | None = None


class HindcastActual(BaseModel):
    """채점에 쓴 실측값 + 원 관측 강수량.

    rain_prob은 관측 강수 유무 이진화(sumRn>0 → 100)다 — celery
    `settle_daily_duel`과 같은 규칙. sum_rn은 이진화 전 실관측 mm.
    """

    temp_max: float
    rain_prob: float
    sum_rn: float | None = None


class HindcastResult(BaseModel):
    """POST 응답 · GET /hindcast/attempts 원소 — 제출 후에만 실측·점수·해설 공개.

    sources: 값마다의 출처. 「데모용 고정 날짜」가 어디서 온 값인지 화면에서
    확인할 수 있게 응답에 담는다(합성이 아님을 스스로 증명하는 자리).
    """

    model_config = ConfigDict(from_attributes=True)

    case_id: str
    observed_date: date
    title: str
    user_pred: HindcastPrediction
    ai_pred: HindcastPrediction
    actual: HindcastActual
    user_score: float
    ai_score: float
    result: str
    explanation: str | None = None
    sources: dict[str, str] | None = None
    created_at: datetime | None = None


class HindcastAttemptList(BaseModel):
    attempts: list[HindcastResult]

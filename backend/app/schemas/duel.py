"""예보 대결 API 스키마 — 스프린트 R4-01 §3.4.

AI 예측(ai_pred)은 제출 후에만 공개한다 — GET(미제출)에서는 submitted=false로
숨기고, POST 응답과 GET(제출 후)에서만 노출한다.
"""
import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class DuelPrediction(BaseModel):
    """예보 예측값(유저·AI 공통) — 내일 최고기온·강수확률.

    noise_scale은 AI 캐스터 전용(R9-01 §3.2 감사 스냅샷) — 유저 예측·R9 이전
    행에는 없어 null이다(additive).
    """

    temp_max: float
    rain_prob: int = Field(ge=0, le=100)
    noise_scale: float | None = None


class DuelSubmitRequest(BaseModel):
    """POST /duel/today 요청 — 내일 예보 제출.

    범위 검증은 라우터에서 수행해 도메인 에러 코드(INVALID_PREDICTION)로 응답한다
    (프론트 mock 계약과 문자열 일치). 여기서 ge/le를 걸면 일반 VALIDATION_ERROR로
    선점되므로 걸지 않는다 — 숫자 형변환 실패만 pydantic이 잡는다.
    evidence(R9-01 §3.1 ③ additive)도 같은 이유로 라우터가 화이트리스트를 검증해
    미지 코드를 422 INVALID_EVIDENCE로 응답한다.
    """

    temp_max: float
    rain_prob: int
    evidence: list[str] | None = None


class EvidenceReviewItem(BaseModel):
    """근거 적중 판정 1건 (R9-01 §3.1 ④) — 정산 후 조회 시 계산·노출."""

    code: str
    hit: bool
    note: str


class DuelToday(BaseModel):
    """GET/POST /duel/today 응답 — 오늘 대결 상태.

    submitted=false면 ai_pred=null(제출 전 비공개), true면 내 예측·AI 예측을 함께 준다.
    result/user_score/ai_score는 다음날 정산 후 채워진다(그 전엔 null).
    base_forecast는 KMA 대상일 예보(참고용, R9-01 §3.1 additive) — 프론트 예보
    입력 폼(ForecastForm) 배너가 렌더한다. KMA 실패·키 부재 시 null(캐스터는 내부 폴백 base로 동작하되
    브리핑엔 비노출).
    caster_grade(R9-01 §3.2 additive): 제출 시점 캐스터 티어명 — 프론트
    "🤖 {티어}급 캐스터" 표시용. 미제출·R9 이전 행은 null.
    """

    duel_date: date
    submitted: bool
    base_forecast: DuelPrediction | None = None
    user_pred: DuelPrediction | None = None
    ai_pred: DuelPrediction | None = None
    actual: DuelPrediction | None = None
    user_score: Decimal | None = None
    ai_score: Decimal | None = None
    result: str | None = None
    # R9-01 §3.1 ③·④ additive — 제출 시 선택한 근거 코드와 정산 후 적중 해설
    evidence: list[str] | None = None
    evidence_review: list[EvidenceReviewItem] | None = None
    # R9-01 §3.2 additive — 제출 시점 캐스터 티어명 스냅샷
    caster_grade: str | None = None
    # R10 ponytail additive — 정산으로 받은 XP. 정산 전(result=null)이면 null,
    # 패/무는 0. 프론트가 액수를 하드코딩하지 않게 **서버가 액수를 보낸다**
    # (액수 단일 소유자 = duel_service.DUEL_WIN_XP · celery 복제본은
    #  tests/test_xp_contract.py가 감시).
    xp_earned: int | None = None


class DuelBriefingHour(BaseModel):
    """브리핑 시간별 예보 슬롯 (R9-01 §3.1 ②) — KMA 카테고리 소문자, 결측은 null."""

    datetime: str
    tmp: float | None = None   # 기온 ℃
    pop: float | None = None   # 강수확률 %
    pcp: float | None = None   # 강수량 mm ("강수없음"은 0.0으로 파싱됨)
    reh: float | None = None   # 습도 %
    wsd: float | None = None   # 풍속 m/s
    sky: int | None = None     # 하늘상태 1맑음/3구름많음/4흐림
    pty: int | None = None     # 강수형태 0없음/1비/2비눈/3눈/4소나기


class DuelBriefingObserved(BaseModel):
    """오늘 실측 요약 (ASOS 일자료 — 보통 D+1 공표라 당일엔 null인 경우가 많다)."""

    max_ta: float | None = None
    min_ta: float | None = None
    sum_rn: float | None = None


class DuelBriefingDay(BaseModel):
    """최근 실측 추이 1일치 (recent_rain 근거·차트 재료)."""

    date: date
    max_ta: float | None = None
    sum_rn: float | None = None


class DuelBriefing(BaseModel):
    """GET /duel/briefing 응답 (R9-01 §3.1 ②) — 대상일 판단 재료 일괄.

    부분 실패는 해당 필드만 null/빈 배열(200 유지) — KMA 키 부재 시 프론트가
    degraded 모드("실황 자료 수신 대기")로 표시하되 예측 입력은 그대로 가능.
    """

    region: str
    target_date: date
    hourly: list[DuelBriefingHour]
    today_observed: DuelBriefingObserved | None = None
    recent_days: list[DuelBriefingDay]


class DuelHistoryItem(BaseModel):
    """GET /duel/history 항목.

    evidence·evidence_review는 user_pred JSONB 동봉분에서 라우터가 추출·계산해
    채운다 (R9-01 §3.1 — 마이그레이션 0).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    duel_date: date
    user_pred: dict
    ai_pred: dict
    actual: dict | None = None
    user_score: Decimal | None = None
    ai_score: Decimal | None = None
    result: str | None = None
    evidence: list[str] | None = None
    evidence_review: list[EvidenceReviewItem] | None = None
    # R10 ponytail additive — 위 DuelToday.xp_earned와 같은 계약
    xp_earned: int | None = None

    @computed_field  # R9-01 §3.2 additive — ai_pred JSONB 스냅샷에서 파생
    @property
    def caster_grade(self) -> str | None:
        """제출 시점 캐스터 티어명. R9 이전 행(스냅샷 없음)은 null."""
        if isinstance(self.ai_pred, dict):
            return self.ai_pred.get("caster_grade")
        return None

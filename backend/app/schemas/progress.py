from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SpineCurrentUnit(BaseModel):
    """스파인 current 유닛 참조 — slug는 트리 노출 id와 동일한 안정 참조."""

    slug: str
    title: str


class SpineOut(BaseModel):
    """유닛 진도 축(스파인) 서버 집계 — R8-01 §3.3.

    CurriculumHome 클라 계산과 동일 정의(cleared=cleared_at 존재,
    crowns_total=Σcrown_target). current_unit은 build_curriculum의
    'current'(잠기지 않은 첫 미클리어) — 전부 클리어/잠금이면 null.
    """

    units_total: int
    units_cleared: int
    crowns_earned: int
    crowns_total: int
    current_unit: SpineCurrentUnit | None = None


class ProgressMe(BaseModel):
    xp: int
    level: int
    streak_count: int
    # 스트릭 프리즈("구름 방패") 보유 수 — R2-01 §3.5
    streak_freeze_count: int
    next_level_xp: int
    # 현재 리그 티어(최근 정산 기준, 없으면 stratus) — R4-01 §3.2
    tier: str
    # 구름 에너지 잔량·다음 회복 ETA(초) — R5-01 §3.3 (clouds=플레이 에너지)
    clouds: int
    next_regen_sec: int
    # 배치고사 완료 여부 — R7-01 §3.5 (additive: 프론트 온보딩 진입 분기용)
    placement_done: bool = False
    # 스파인(유닛 진도 축) 집계 — R8-01 §3.3 (additive: 홈 헤더 1순위 표시용)
    spine: SpineOut
    # 일일 목표 문항 수 — R10-01 §3.4·D4 (additive). null이면 미설정.
    daily_goal_items: int | None = None
    # 오늘(KST) 응답한 문항 수 — "오늘 목표 N/M"의 N. 배치고사분은 제외(D10-2).
    today_answered_count: int = 0
    # 사용자 지역 — R11-01 §8.2 (additive). null이면 미설정(서버 동작은 서울 폴백,
    # weather_api.user_region). 저장값 원본을 그대로 노출한다 — 프론트가 "미설정"
    # (픽커 유도)과 "서울로 설정"을 구분해야 하므로(daily_goal_items 선례).
    region: str | None = None
    # 표현 톤 — R13-0 §1 (additive). **해석된 값**을 노출한다(child·teen·adult).
    # region이 저장 원본(null 포함)을 노출한 것과 의도적으로 다르다: region은 프론트가
    # "미설정"과 "서울로 설정"을 구분해 픽커를 유도해야 했지만, 톤은 설정 화면이
    # 범위 밖(§3.2)이라 프론트가 구분할 일이 없고 필요한 건 "어떤 말투로 그릴까"
    # 하나뿐이다. 미신고 폴백은 weatherbrain_service.effective_tone이 소유한다.
    tone: str = "teen"


class DailyGoalUpdate(BaseModel):
    """PUT /progress/daily-goal 요청 — R10-01 §3.4·D4.

    허용값 {3, 5, 9} 검증을 Literal에 맡기지 않는 이유(D10-4): FastAPI 기본
    RequestValidationError 본문과 형식이 갈라지지 않도록 라우터가 명시적
    HTTPException(422, code="VALIDATION_ERROR")으로 낸다. strict=True도 쓰지
    않는다 — mock의 `Number(body.items)`와 동일하게 `"5"`를 수용한다(D10-5).
    """

    items: int


class DailyGoalOut(BaseModel):
    """PUT /progress/daily-goal 응답 — 저장된 목표값 하나뿐(mock 계약 일치, D10-1).

    오늘 응답 수는 GET /progress/me의 today_answered_count에서 읽는다.
    """

    daily_goal_items: int


class RegionUpdate(BaseModel):
    """PUT /progress/region 요청 — R11-01 §8.2.

    KMA_GRID 12도시 화이트리스트 검증을 Literal에 맡기지 않는 이유는 daily-goal과
    동일(D10-4): 라우터가 명시적 HTTPException(422, code="VALIDATION_ERROR")으로
    내야 mock 계약({detail: str, code}) 형식과 갈라지지 않는다.
    """

    region: str


class RegionOut(BaseModel):
    """PUT /progress/region 응답 — 저장된 지역값 하나뿐(daily-goal 계약 관례)."""

    region: str


class EnergyState(BaseModel):
    """GET /progress/energy 응답 — R5-01 §3.3."""

    clouds: int
    max: int
    next_regen_sec: int
    updated_at: datetime | None = None


class QuestOut(BaseModel):
    """GET /progress/quests 응답 항목 — R4-01 §3.1."""

    code: str
    title: str
    progress: int
    target: int
    done: bool
    xp_reward: int


class BadgeOut(BaseModel):
    """GET /progress/badges 응답 항목 — R4-01 §3.3 (미획득은 earned_at=null)."""

    code: str
    title: str
    description: str
    earned_at: datetime | None = None


class WeakConceptOut(BaseModel):
    """GET /progress/weak-tags 응답 항목 — θ 파생 약점 개념 (R8-01 §3.5).

    구 WeakTagOut(weak_tags 테이블 원값 노출)을 대체한다 — 프론트 소비 0 확인
    (api/progress.js fetchWeakTags 래퍼만 존재, 호출부 없음).
    threshold: 학령 상대 임계 θ(weatherbrain_service.weak_theta_threshold) —
    θ < threshold AND num_responses > 0 인 개념만 목록에 실린다.
    """

    concept_tag: str
    theta: float
    threshold: float
    num_responses: int


class ReviewQueueItem(BaseModel):
    """GET /progress/review-queue 응답 항목 — 간격반복 복습 스케줄 (R11-01 C2).

    weak-tags(θ 파생 약점 — 능력 축)와 다른 축이다: 마지막 학습 후 시간이 지나
    복습할 때가 된 개념(시간 축). quiz_logs read-model이라 저장 상태가 없고,
    배치고사 응답은 제외된다(D10-2 전례).
    next_review_at: 마지막 응답의 KST 달력일 + 간격 사다리(연속 정답 기반,
    review_schedule_service.REVIEW_INTERVALS_DAYS)의 KST 자정(UTC 표기).
    due: 그 시점이 이미 도래했는지 — 전 개념이 실려 오므로 큐 표시는 due 필터.
    """

    concept_tag: str
    last_answered_at: datetime
    consecutive_correct: int
    interval_days: int
    next_review_at: datetime
    due: bool


class ConceptAbilityOut(BaseModel):
    """WeatherBrain IRT 개념별 능력 θ (로짓 스케일). R6 §5.

    theta: 능력 추정치(높을수록 강함). theta_se: 불확실성(응답 적을수록 큼).
    num_responses: 반영된 실제 응답 수(0이면 가입 시 사전 배정값).
    level_label: θ를 초급/중급/고급으로 이산화한 사람이 읽는 난이도 라벨.
    """

    model_config = ConfigDict(from_attributes=True)

    concept_tag: str
    theta: float
    theta_se: float
    num_responses: int
    level_label: str
    updated_at: datetime | None = None


class AttendanceResult(BaseModel):
    streak_count: int
    is_new_record: bool

"""WeatherMind ai-worker FastAPI 앱 (포트 8001).

DEVELOPMENT_PLAN.md 2.1 backend → ai-worker 내부 API 계약:
  POST /internal/router-decide  {user_id, weak_tags, recent_results} → {route, target_concept_tag}
  POST /internal/rag-feedback   {question_text, user_answer, is_correct, concept_tag, today_weather} → {feedback}
  POST /internal/quiz-generate  {weather_data, level_group, route, target_concept_tag} → QuizQuestion JSON
  GET  /health                  → {status, service}

스프린트 R2-01 §3.4 품질 게이트:
  POST /internal/quiz-validate  {question, concept_tag, level_group} → {passed, checks}

스프린트 R5-01 §3.6 커리큘럼 무결성 게이트:
  POST /internal/curriculum-validate  {units, content_items} → {passed, checks}

스프린트 R13-01 §5-1 BKT 지식 추적(θ와 별개 축):
  POST /internal/weatherbrain/mastery {concepts:[{concept_tag, corrects}], params}
    → {masteries:[{concept_tag, p_mastery, p_next_correct, n, cold_start,
       params_source}], min_responses}

모든 /internal/* 엔드포인트는 X-Internal-API-Key 헤더를
AI_WORKER_INTERNAL_API_KEY와 비교해 검증한다 (불일치 시 401).
"""

from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app import llm_budget
from app.chains import quiz_gen_chain, rag_chain, router_chain, validate_chain
from app.config import settings
from app.weatherbrain.irt import calibrate_items, estimate_ability
from app.weatherbrain.knowledge_tracing import (
    MASTERY_MIN_RESPONSES,
    BKTParams,
    mastery_snapshot,
)
from app.weatherbrain.placement import initial_abilities
from app.weatherbrain.priors import level_group_prior, prior_item_b

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="WeatherMind AI Worker", version="0.1.0")


# ── 내부 API 키 검증 ───────────────────────────────────────────────────────
def verify_internal_api_key(
    x_internal_api_key: str | None = Header(default=None, alias="X-Internal-API-Key"),
) -> None:
    expected = settings.AI_WORKER_INTERNAL_API_KEY
    if (
        not expected
        or not x_internal_api_key
        or not secrets.compare_digest(x_internal_api_key, expected)
    ):
        raise HTTPException(status_code=401, detail="invalid internal api key")


# ── 요청/응답 스키마 ───────────────────────────────────────────────────────
class WeakTag(BaseModel):
    concept_tag: str
    accuracy_rate: float

    model_config = {"extra": "allow"}  # weak_tags row의 부가 필드 허용


class Ability(BaseModel):
    """WeatherBrain IRT 개념별 능력 추정치 (θ)."""

    concept_tag: str
    theta: float
    se: float = 1.0
    n: int = 0


class RouterDecideRequest(BaseModel):
    user_id: str
    weak_tags: list[WeakTag] = Field(default_factory=list)
    recent_results: list[bool] = Field(default_factory=list)
    # R6 WeatherBrain: 있으면 θ가 1순위 분기 신호, weak_tags는 폴백.
    abilities: list[Ability] = Field(default_factory=list)
    # R13 CO-U-3-A: θ "focused" 임계의 기준점(학령 상대). 미전달(None)이면
    # router_chain이 종전 절대 임계(= middle_high 값)로 폴백한다.
    level_group: Optional[str] = None


class RouterDecideResponse(BaseModel):
    route: str
    target_concept_tag: Optional[str] = None


class RagFeedbackRequest(BaseModel):
    question_text: str
    user_answer: Optional[str] = None
    is_correct: bool
    concept_tag: str
    today_weather: dict = Field(default_factory=dict)


class RagFeedbackResponse(BaseModel):
    feedback: str


class QuizGenerateRequest(BaseModel):
    weather_data: dict
    level_group: str
    route: str = "general"
    target_concept_tag: Optional[str] = None


class QuizValidateRequest(BaseModel):
    question: dict  # §3.3 template_json 형식
    concept_tag: str
    level_group: str


class ValidationCheck(BaseModel):
    name: str
    passed: bool
    reason: str


class ValidateResponse(BaseModel):
    """quiz-validate·curriculum-validate 공용 — {passed, checks}."""

    passed: bool
    checks: list[ValidationCheck]


class CurriculumValidateRequest(BaseModel):
    units: list[dict] = Field(default_factory=list)  # §3.2 units.json 시드
    content_items: list[dict] = Field(default_factory=list)


# ── WeatherBrain (IRT) 스키마 — R6 §5 ──────────────────────────────────────
class IRTResponse(BaseModel):
    """단일 채점 응답 — 문항난이도 b, 변별도 a, 정오답.

    b가 null이면 보정 이력이 없는 문항 — level_group 사전 난이도로 대체한다
    (사전값을 ai-worker에 단일 소유하기 위한 계약).
    """

    b: Optional[float] = None
    a: float = 1.0
    correct: bool


class ConceptResponses(BaseModel):
    concept_tag: str
    responses: list[IRTResponse] = Field(default_factory=list)


class EstimateRequest(BaseModel):
    """개념별 θ 추정 — 배치고사·주기적 재추정 공용. 응답 0개면 사전값 반환."""

    level_group: str
    concepts: list[ConceptResponses] = Field(default_factory=list)


class EstimateResponse(BaseModel):
    abilities: list[Ability]


class PlacementRequest(BaseModel):
    """신규 유저 초기 난이도 배정 — 사전(prior)만 또는 배치고사 응답 결합."""

    level_group: str
    concept_tags: list[str] = Field(default_factory=list)
    placement_responses: dict[str, list[IRTResponse]] = Field(default_factory=dict)


class CalibrateItem(BaseModel):
    user_id: str
    item_id: str
    correct: bool


class CalibrateRequest(BaseModel):
    """문항난이도 b 재보정 — celery 재학습이 누적 quiz_logs로 호출(휴면-정확)."""

    responses: list[CalibrateItem] = Field(default_factory=list)
    iterations: int = 20


class CalibrateResponse(BaseModel):
    item_b: dict[str, float]
    n_items: int
    n_responses: int


# ── BKT 지식 추적 (R13-01 §5-1) ────────────────────────────────────────────
class BKTParamsIn(BaseModel):
    """개념별 BKT 파라미터 주입 — 실운영 로그 재적합(fit_bkt) 결과의 투입구."""

    p_init: float
    p_learn: float
    p_guess: float
    p_slip: float


class MasteryConcept(BaseModel):
    """한 개념의 정오답 시퀀스 — **시간 오름차순**(순서가 곧 모델 입력이다)."""

    concept_tag: str
    corrects: list[bool] = Field(default_factory=list)


class MasteryRequest(BaseModel):
    """개념별 P(숙련) 스냅샷 요청 — 순수 계산(LLM·네트워크·DB 없음)."""

    concepts: list[MasteryConcept] = Field(default_factory=list)
    # 개념별 파라미터 덮어쓰기. 비어 있으면 SERVING_PRIOR(사전값).
    params: dict[str, BKTParamsIn] = Field(default_factory=dict)


class Mastery(BaseModel):
    concept_tag: str
    p_mastery: float
    p_next_correct: float
    n: int
    cold_start: bool
    params_source: str  # "prior" | "fitted"


class MasteryResponse(BaseModel):
    masteries: list[Mastery]
    min_responses: int


# ── 엔드포인트 ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """가동 여부 + **LLM이 지금 무엇으로 서빙 중인가.**

    후자를 여기 싣는 이유: 한도를 넘겨 정적 문구로 강등돼도 화면은 정상으로
    보인다. 심사 기간 대부분이 무인이라, 조용한 강등을 사람이 알아챌 창구가
    이것 말고 없다.
    """
    return {
        "status": "ok",
        "service": "weathermind-ai-worker",
        "llm": llm_budget.health_snapshot(),
    }


@app.post(
    "/internal/router-decide",
    response_model=RouterDecideResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def router_decide(body: RouterDecideRequest) -> RouterDecideResponse:
    result = router_chain.route(
        weak_tags=[t.model_dump() for t in body.weak_tags],
        recent_results=body.recent_results,
        abilities=[a.model_dump() for a in body.abilities],
        level_group=body.level_group,
    )
    return RouterDecideResponse(**result)


@app.post(
    "/internal/rag-feedback",
    response_model=RagFeedbackResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def rag_feedback(body: RagFeedbackRequest) -> RagFeedbackResponse:
    feedback = rag_chain.generate_feedback(
        question_text=body.question_text,
        user_answer=body.user_answer,
        is_correct=body.is_correct,
        concept_tag=body.concept_tag,
        today_weather=body.today_weather,
    )
    return RagFeedbackResponse(feedback=feedback)


@app.post(
    "/internal/quiz-generate",
    dependencies=[Depends(verify_internal_api_key)],
)
def quiz_generate(body: QuizGenerateRequest) -> dict:
    return quiz_gen_chain.generate_quiz(
        weather_data=body.weather_data,
        level_group=body.level_group,
        route=body.route,
        target_concept_tag=body.target_concept_tag,
    )


@app.post(
    "/internal/quiz-validate",
    response_model=ValidateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def quiz_validate(body: QuizValidateRequest) -> ValidateResponse:
    result = validate_chain.validate_quiz(
        question=body.question,
        concept_tag=body.concept_tag,
        level_group=body.level_group,
    )
    return ValidateResponse(**result)


@app.post(
    "/internal/curriculum-validate",
    response_model=ValidateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def curriculum_validate(body: CurriculumValidateRequest) -> ValidateResponse:
    result = validate_chain.validate_curriculum(
        units=body.units,
        content_items=body.content_items,
    )
    return ValidateResponse(**result)


# ── WeatherBrain (IRT) 엔드포인트 — R6 §5 ──────────────────────────────────
@app.post(
    "/internal/weatherbrain/estimate",
    response_model=EstimateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def weatherbrain_estimate(body: EstimateRequest) -> EstimateResponse:
    """개념별 θ를 EAP로 추정한다. level_group이 사전분포를 정한다.

    `r.b`(문항 난이도)가 None일 때의 `prior_b` 대체는 **방어적 기본값**이다 —
    backend(weatherbrain_service.assemble_responses)는 R13 CO-U-1 이후 항상
    **문항의** 사전 b를 채워 보낸다. 여기서 채우는 값은 **유저의** level_group
    사전 b라서, 실제로 이 분기를 타면 θ 추정에 문항 난이도가 들어가지 않고
    θ̂ = 사전평균 + f(정답수, 응답수)로 축소된다(약점 판정의 학령 상대성이
    항등 상쇄되는 CO-U-2의 원인이었다). 스키마 호환을 위해 남겨둘 뿐
    정상 경로에서는 도달하지 않는다.
    """
    mean, sd = level_group_prior(body.level_group)
    prior_b = prior_item_b(body.level_group)
    out: list[Ability] = []
    for concept in body.concepts:
        resp = [
            (r.b if r.b is not None else prior_b, r.a, r.correct)
            for r in concept.responses
        ]
        est = estimate_ability(resp, prior_mean=mean, prior_sd=sd)
        out.append(
            Ability(
                concept_tag=concept.concept_tag,
                theta=est.theta,
                se=est.se,
                n=est.n,
            )
        )
    return EstimateResponse(abilities=out)


@app.post(
    "/internal/weatherbrain/placement",
    response_model=EstimateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def weatherbrain_placement(body: PlacementRequest) -> EstimateResponse:
    """신규 유저 초기 난이도 배정 — 사전만 또는 배치고사 응답 결합."""
    prior_b = prior_item_b(body.level_group)
    placement = {
        tag: [(r.b if r.b is not None else prior_b, r.a, r.correct) for r in responses]
        for tag, responses in body.placement_responses.items()
    }
    abilities = initial_abilities(
        level_group=body.level_group,
        concept_tags=body.concept_tags,
        placement_responses=placement,
    )
    return EstimateResponse(
        abilities=[
            Ability(concept_tag=tag, theta=v["theta"], se=v["se"], n=int(v["n"]))
            for tag, v in abilities.items()
        ]
    )


@app.post(
    "/internal/weatherbrain/calibrate",
    response_model=CalibrateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def weatherbrain_calibrate(body: CalibrateRequest) -> CalibrateResponse:
    """누적 응답에서 문항난이도 b를 결합추정한다(재학습). 데이터 희소 시 빈 결과."""
    responses = [(r.user_id, r.item_id, r.correct) for r in body.responses]
    item_b = calibrate_items(responses, iterations=body.iterations)
    return CalibrateResponse(
        item_b=item_b,
        n_items=len(item_b),
        n_responses=len(responses),
    )


@app.post(
    "/internal/weatherbrain/mastery",
    response_model=MasteryResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def weatherbrain_mastery(body: MasteryRequest) -> MasteryResponse:
    """개념별 P(숙련)을 BKT로 필터링한다 — θ와 **다른 축**(R13-01 §5-1).

    θ(estimate)는 응답을 순서 없는 집합으로 보고 "지금 실력"을 재는데, BKT는
    같은 응답을 **시간 순서**로 보고 "이 개념을 익혔을 확률"의 전이를 추적한다.
    두 엔드포인트는 서로를 읽지 않으므로 한쪽 변경이 다른 쪽을 흔들지 않는다.

    LLM도 DB도 쓰지 않는 순수 계산이라 estimate와 같은 무상태 계약이다 —
    backend가 quiz_logs에서 시퀀스를 조립해 보내고 결과만 받는다.
    """
    out: list[Mastery] = []
    for concept in body.concepts:
        override = body.params.get(concept.concept_tag)
        params = BKTParams(**override.model_dump()) if override else None
        snap = mastery_snapshot(concept.corrects, params)
        out.append(
            Mastery(
                concept_tag=concept.concept_tag,
                p_mastery=snap["p_mastery"],
                p_next_correct=snap["p_next_correct"],
                n=snap["n"],
                cold_start=snap["cold_start"],
                params_source="fitted" if override else "prior",
            )
        )
    return MasteryResponse(masteries=out, min_responses=MASTERY_MIN_RESPONSES)

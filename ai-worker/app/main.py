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

모든 /internal/* 엔드포인트는 X-Internal-API-Key 헤더를
AI_WORKER_INTERNAL_API_KEY와 비교해 검증한다 (불일치 시 401).
"""

from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.chains import quiz_gen_chain, rag_chain, router_chain, validate_chain
from app.config import settings

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


class RouterDecideRequest(BaseModel):
    user_id: str
    weak_tags: list[WeakTag] = Field(default_factory=list)
    recent_results: list[bool] = Field(default_factory=list)


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


class QuizValidateResponse(BaseModel):
    passed: bool
    checks: list[ValidationCheck]


class CurriculumValidateRequest(BaseModel):
    units: list[dict] = Field(default_factory=list)  # §3.2 units.json 시드
    content_items: list[dict] = Field(default_factory=list)


class CurriculumValidateResponse(BaseModel):
    passed: bool
    checks: list[ValidationCheck]


# ── 엔드포인트 ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "weathermind-ai-worker"}


@app.post(
    "/internal/router-decide",
    response_model=RouterDecideResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def router_decide(body: RouterDecideRequest) -> RouterDecideResponse:
    result = router_chain.route(
        weak_tags=[t.model_dump() for t in body.weak_tags],
        recent_results=body.recent_results,
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
    response_model=QuizValidateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def quiz_validate(body: QuizValidateRequest) -> QuizValidateResponse:
    result = validate_chain.validate_quiz(
        question=body.question,
        concept_tag=body.concept_tag,
        level_group=body.level_group,
    )
    return QuizValidateResponse(**result)


@app.post(
    "/internal/curriculum-validate",
    response_model=CurriculumValidateResponse,
    dependencies=[Depends(verify_internal_api_key)],
)
def curriculum_validate(body: CurriculumValidateRequest) -> CurriculumValidateResponse:
    result = validate_chain.validate_curriculum(
        units=body.units,
        content_items=body.content_items,
    )
    return CurriculumValidateResponse(**result)

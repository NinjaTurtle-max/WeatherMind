import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class QuizQuestion(BaseModel):
    """02번 스펙 QuizQuestion 스키마."""

    quiz_id: str
    concept_tag: str
    question_type: str
    question_text: str
    options: list[str] | None = None
    level_group: str


class AnswerRequest(BaseModel):
    answer: str
    elapsed_sec: int | None = None


class AnswerResult(BaseModel):
    """02번 스펙 AnswerResult 스키마."""

    is_correct: bool
    correct_answer: str
    feedback: str
    xp_earned: int
    concept_tag: str


class QuizLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    quiz_id: str
    concept_tag: str
    question_type: str | None = None
    question_json: dict[str, Any]
    user_answer: str | None = None
    is_correct: bool | None = None
    elapsed_sec: int | None = None
    answered_at: datetime | None = None

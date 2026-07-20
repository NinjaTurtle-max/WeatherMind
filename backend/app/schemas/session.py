"""세션 API 스키마 — 스프린트 R2-01 §3.1.

SessionItem = 기존 QuizQuestion + {"source": "bank"|"generated", "slot_filled": bool}.
"""
import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.schemas.quiz import AnswerResult, QuizQuestion


class SessionItem(QuizQuestion):
    source: Literal["bank", "generated"] = "bank"
    slot_filled: bool = False


class SessionProgress(BaseModel):
    answered: int
    total: int


class SessionToday(BaseModel):
    """GET /session/today 응답 — 당일 재호출 시 동일 세션 (멱등)."""

    session_id: uuid.UUID
    session_date: date
    mode: str = "daily"
    items: list[SessionItem]
    progress: SessionProgress


class SessionAnswerRequest(BaseModel):
    quiz_id: str
    answer: str
    elapsed_sec: int | None = None


class SessionAnswerResult(AnswerResult):
    """기존 AnswerResult + session_progress (§3.1)."""

    session_progress: SessionProgress


class SessionCompleteResult(BaseModel):
    xp_total: int
    correct_count: int
    total: int
    streak_count: int

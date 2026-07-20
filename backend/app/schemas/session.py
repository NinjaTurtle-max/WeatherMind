"""세션 API 스키마 — 스프린트 R2-01 §3.1.

SessionItem = 기존 QuizQuestion + {"source": "bank"|"generated", "slot_filled": bool}.
"""
import uuid
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.quiz import AnswerResult, QuizQuestion


class SessionItem(QuizQuestion):
    source: Literal["bank", "generated"] = "bank"
    slot_filled: bool = False
    # board 유형만: render된 board 플레이 필드(mode·guide_steps·initial_state·
    # palette·goal_conditions·hints·question_text). 프론트가 팔레트·초기배치 없이는
    # 보드를 못 그리므로 세션 응답에 노출한다(R3-01 §3.3). 비밀 정답(correct_answer)은
    # 방어적으로 제외한다. board 외 유형은 None.
    template_json: dict[str, Any] | None = None


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
    """세션 답안 제출 (R3-01 §3.4: board 유형은 board_state 필수).

    board 유형 문항은 board_state(§3.1 JSON)로 제출하고 answer는 무시된다
    (누락 시 라우터가 422 BOARD_STATE_REQUIRED).
    """

    quiz_id: str
    answer: str = ""
    elapsed_sec: int | None = None
    board_state: dict[str, Any] | None = None


class SessionAnswerResult(AnswerResult):
    """기존 AnswerResult + session_progress (§3.1)."""

    session_progress: SessionProgress


class SessionCompleteResult(BaseModel):
    xp_total: int
    correct_count: int
    total: int
    streak_count: int

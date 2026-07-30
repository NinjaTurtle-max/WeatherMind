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
    """답안 제출 (R3-01 §3.4: board 유형은 board_state 필수 — 라우터가 422 검증).

    answer는 문자열(기존 유형·match·ordering·cloze). board 유형은 board_state(§3.1
    JSON)로 제출하며 answer는 무시된다(서버가 board_state를 권위 채점).
    """

    answer: str = ""
    elapsed_sec: int | None = None
    board_state: dict[str, Any] | None = None


class AnswerResult(BaseModel):
    """02번 스펙 AnswerResult 스키마 (+ R3-01 §3.4 phenomena)."""

    is_correct: bool
    correct_answer: str
    feedback: str
    xp_earned: int
    concept_tag: str
    # board 유형만: 존별 판정 결과 배열 (그 외 유형은 None) —
    # {zone, zone_name, phenomenon, cloud, rule_id, explain}
    # (zone_name·explain은 R9-01 §1 additive — 확정 리플레이 캡션용)
    phenomena: list[dict[str, Any]] | None = None


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

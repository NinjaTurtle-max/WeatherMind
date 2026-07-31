from typing import Any

from pydantic import BaseModel


class QuizQuestion(BaseModel):
    """02번 스펙 QuizQuestion 스키마."""

    quiz_id: str
    concept_tag: str
    question_type: str
    question_text: str
    options: list[str] | None = None
    level_group: str


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

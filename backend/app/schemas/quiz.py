from typing import Any, Literal

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
    # feedback이 **어디서 왔는지** (R13 CO-I-1 후속, additive).
    # CO-I-1이 사람 저작 해설(배선 당시 158건 · 2026-08-09 실측 193건)을 피드백
    # 경로에 붙이면서, 화면 배지가
    # "AI 피드백" 하나로 고정돼 **사람이 쓴 글에 AI 라벨이 붙는** 표기 오류가
    # 생겼다(2026-08-08 감사). 심사 배점 ⑤(생성형 AI 활용)에 직결되므로
    # 서버가 출처를 말하고 프론트가 라벨을 고른다.
    #   board    — board_rules.json의 explain/hints (LLM 미호출)
    #   authored — template_json.explanation_hint (사람 저작)
    #   ai       — RAG Chain (키 없으면 내부 정적 문구로 강등)
    feedback_source: Literal["board", "authored", "ai"] = "ai"
    xp_earned: int
    # xp_earned의 분해값 (R10-01 §3.5 마감 3, additive) — 항상
    # xp_base + xp_weak_bonus == xp_earned. xp_base는 약점 배율 적용 전 금액,
    # xp_weak_bonus는 배율로 늘어난 차액(약점 아님·오답·배치고사는 0).
    # 프론트가 "약점 극복 +7"을 역산(xp_earned − 상수 사본)하지 않게 하는 계약 —
    # 배율·반올림 규칙은 xp_service.quiz_xp_breakdown이 단독 소유한다.
    xp_base: int = 0
    xp_weak_bonus: int = 0
    concept_tag: str
    # board 유형만: 존별 판정 결과 배열 (그 외 유형은 None) —
    # {zone, zone_name, phenomenon, cloud, rule_id, explain}
    # (zone_name·explain은 R9-01 §1 additive — 확정 리플레이 캡션용)
    phenomena: list[dict[str, Any]] | None = None

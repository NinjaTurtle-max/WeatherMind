"""세션 API 스키마 — 스프린트 R2-01 §3.1.

SessionItem = 기존 QuizQuestion + {"source": "bank"|"generated", "slot_filled": bool}.
"""
import uuid
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.curriculum import CrownAward
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
    """기존 AnswerResult + session_progress (§3.1) + 구름 소모 결과 (R10-01 §3.1).

    clouds_spent·clouds는 additive (D10-1): "오답 피드백에 구름 −1 명시"는
    is_correct만으로 구현할 수 없다 — 잔량 0에서는 오답이어도 소모가 0이기 때문
    (진행 중 세션을 끊지 않는 계약). 프론트가 계산하지 않고 서버 실측을 읽는다.
    clouds_spent = 실제 소모량(0 또는 CLOUD_COST) · clouds = 소모 후 잔량.
    """

    session_progress: SessionProgress
    clouds_spent: int = 0
    clouds: int = 0


class PlacementAbility(BaseModel):
    """배치고사 완료 응답의 개념별 초기 θ (R7-01 §3.3).

    GET /progress/abilities(ConceptAbilityOut)와 동일 형식 — 프론트가 한 렌더러로
    두 응답을 그린다(§3.1 보강 확정: se/n 축약형 금지). updated_at은 완료 직후라
    의미가 없어 제외.
    """

    concept_tag: str
    theta: float
    theta_se: float
    num_responses: int
    level_label: str


class UnitResult(BaseModel):
    """유닛 세션 complete의 유닛 진도 결과 (R8-01 §3.1) — 유닛 세션일 때만.

    grant_unit_crown 반환을 그대로 노출한다(all_correct·crown_target 보강) —
    프론트 UnitSessionPage(UnitSummary)가 읽는 계약 필드. 만점이 아니거나
    재완료(멱등)면 저장된 진도 스냅샷(unit_xp=0)이다.
    """

    all_correct: bool
    crowns: int
    crown_target: int
    cleared: bool
    unit_xp: int


class SessionCompleteResult(BaseModel):
    xp_total: int
    correct_count: int
    total: int
    streak_count: int
    # ── 배치고사(mode='placement') 전용 (R7-01 §3.3) — daily/unit 세션은 None ──
    abilities: list[PlacementAbility] | None = None
    placement_done: bool | None = None
    # ── 유닛 세션 전용 (R8-01 §3.1, additive) — daily/placement는 None ──
    unit_result: UnitResult | None = None
    # ── 데일리 만점 왕관 유입 (R8-01 §3.4, additive) — 대상 없으면 None ──
    crown_award: CrownAward | None = None

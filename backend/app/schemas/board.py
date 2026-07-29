"""대기 보드 연습 API 스키마 — 스프린트 R3-01 §3.5.

보드 유형은 비밀 정답이 없으므로 template_json 전체를 노출한다(힌트 단계 공개는
클라이언트가 제어). attempt 응답은 서버 권위 판정 결과(passed·phenomena)와
피드백·획득 XP를 담는다.
"""
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class BoardPuzzle(BaseModel):
    """GET /puzzles 항목 — active board 문항 + cleared 여부 + 난이도 라벨.

    difficulty: 1(쉬움)~3(어려움) — routers.board.board_difficulty가 template_json
    (mode·time_limit_sec·palette)과 level_group에서 산출(R7-02 §3.5). 표시 전용
    additive 필드이며 잠금 없음(전 퍼즐 개방 유지)."""

    content_item_id: UUID
    template_json: dict[str, Any]
    cleared: bool
    difficulty: int


class BoardAttemptRequest(BaseModel):
    board_state: dict[str, Any] | None = None


class BoardAttemptResult(BaseModel):
    passed: bool
    phenomena: list[dict[str, Any]]
    feedback: str
    xp_earned: int

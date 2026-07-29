"""온보딩 API 스키마 — 스프린트 R7-02 §3.1 배치고사 일괄 채점.

채점 권위는 서버 소유(CLAUDE.md — 클라이언트가 결과를 주입할 통로 없음):
제출 body에 채점 결과 필드(is_correct 등)를 정의하지 않으며, extra='forbid'로
미정의 필드 주입 자체를 422(RequestValidationError)로 거부한다. 프로젝트의
다른 요청 스키마는 pydantic 기본(extra='ignore')이지만, 이 엔드포인트는
"결과 필드 수신 금지"가 명시 계약이라 조용한 무시 대신 명시적 거부를 택한다.
"""
from pydantic import BaseModel, ConfigDict

from app.schemas.session import SessionProgress


class PlacementAnswerItem(BaseModel):
    """일괄 제출 답안 1건 — SessionAnswerRequest와 동일 필드 구성.

    placement 풀은 board 유형을 구조적으로 제외하므로 board_state는 받지 않는다.
    """

    model_config = ConfigDict(extra="forbid")

    quiz_id: str
    answer: str = ""
    elapsed_sec: int | None = None


class PlacementSubmitAllRequest(BaseModel):
    """POST /onboarding/placement/submit-all body."""

    model_config = ConfigDict(extra="forbid")

    answers: list[PlacementAnswerItem]


class PlacementAnswerOutcome(BaseModel):
    """답안 1건의 채점 결과 — 서버가 GRADERS로 재계산한 값."""

    quiz_id: str
    is_correct: bool


class PlacementSubmitAllResult(BaseModel):
    """일괄 채점 응답 — results는 제출 순, progress는 세션 전체 진행도."""

    results: list[PlacementAnswerOutcome]
    progress: SessionProgress

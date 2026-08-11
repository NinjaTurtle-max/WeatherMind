"""대기 보드 연습 API 스키마 — 스프린트 R3-01 §3.5.

보드 유형은 비밀 정답이 없으므로 template_json 전체를 노출한다(힌트 단계 공개는
클라이언트가 제어). attempt 응답은 서버 권위 판정 결과(passed·phenomena)와
피드백·획득 XP를 담는다.
"""
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.schemas.curriculum import CrownAward


class BoardPuzzle(BaseModel):
    """GET /puzzles 항목 — active board 문항 + cleared 여부 + 난이도 라벨.

    difficulty: 1(쉬움)~3(어려움) — routers.board.board_difficulty가 template_json
    (mode·time_limit_sec·palette)과 level_group에서 산출(R7-02 §3.5).

    locked: **학습 수준** 잠금(2026-08-10) — 초등은 쉬움, 중·고등은 보통까지,
    성인은 전부 열린다. 규칙은 routers.board.locked_difficulties가 소유하고
    열쇠는 users.level_group이다(진도가 아니다 — 「내 정보 → 학습 수준」이 통로).
    난이도 안에서는 순서가 없다(board_order는 배치의 근거일 뿐 강제가 아니다) —
    2026-08-06에 걷어낸 **퍼즐 단위** 순차 잠금과 강제 범위가 다르다.
    목록은 잠긴 퍼즐도 제목과 함께 내려보낸다(무엇이 기다리는지 보여야 동기가 된다).
    실제 차단은 진입(GET /puzzles/{id})이 403 PUZZLE_LOCKED로 한다.

    제목·요약·진행 순서는 template_json 안에 있다(title·summary·board_order —
    시드 저작). template_json을 통째로 노출하므로 별도 필드를 두지 않는다."""

    content_item_id: UUID
    template_json: dict[str, Any]
    cleared: bool
    difficulty: int
    locked: bool = False


class BoardAttemptRequest(BaseModel):
    board_state: dict[str, Any] | None = None


class BoardAttemptResult(BaseModel):
    passed: bool
    # 존별 판정 4건 — {zone, zone_name, phenomenon, cloud, rule_id, explain}
    # (zone_name·explain은 R9-01 §1 additive — 프론트 확정 리플레이 캡션용)
    phenomena: list[dict[str, Any]]
    feedback: str
    xp_earned: int
    # R8-01 §3.4 (additive): 그 퍼즐 최초 클리어가 같은 concept_tag의 열린
    # kind='board' 유닛에 왕관 +1을 유발했을 때만 채워진다 — 프론트 토스트용.
    crown_award: CrownAward | None = None
    # R10-01 §3.1 (additive, D10-1): 미통과 시도의 "구름 −1" 표기용 실측값.
    # passed=False라도 잔량 0이면 소모가 0이므로 프론트가 계산할 수 없다.
    # clouds_spent = 실제 소모량(0 또는 CLOUD_COST) · clouds = 소모 후 잔량.
    clouds_spent: int = 0
    clouds: int = 0

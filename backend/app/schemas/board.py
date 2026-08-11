"""대기 보드 연습 API 스키마 — 스프린트 R3-01 §3.5.

보드 유형은 비밀 정답이 없으므로 template_json 전체를 노출한다(힌트 단계 공개는
클라이언트가 제어). attempt 응답은 서버 권위 판정 결과(passed·phenomena)와
피드백·획득 XP를 담는다.
"""
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.schemas.curriculum import CrownAward
from app.schemas.reward import QuestReward


class BoardPuzzle(BaseModel):
    """GET /puzzles 항목 — active board 문항 + cleared 여부 + 난이도 라벨.

    difficulty: 1(쉬움)~3(어려움) — routers.board.board_difficulty가 template_json
    (mode·time_limit_sec·palette)과 level_group에서 산출(R7-02 §3.5).

    잠금 필드는 없다 — 순차 잠금을 넣었다가 걷어냈다(2026-08-06 제품 결정).
    학습자가 원하는 퍼즐을 골라 푼다. 순서(board_order)는 권유이지 강제가 아니다.

    제목·요약·진행 순서는 template_json 안에 있다(title·summary·board_order —
    시드 저작). template_json을 통째로 노출하므로 별도 필드를 두지 않는다."""

    content_item_id: UUID
    template_json: dict[str, Any]
    cleared: bool
    difficulty: int
    # MT-24 (2026-08-11, additive): 순차 잠금. **판정은 서버가 소유**하고 프론트는
    # 이 값을 그리기만 한다 — 목록은 잠긴 칸도 내려보내(진도감) 표시만 다르게 하고,
    # 진입(GET 단건)·attempt(POST)는 403 BOARD_LOCKED로 막는다.
    # 기본 True: 구 클라이언트·구 응답에서 잠금이 조용히 생기지 않는다.
    unlocked: bool = True


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
    # R13 CO-T-4 (additive): 이 attempt로 **새로 완료된** 일일 퀘스트와 그 보상 XP.
    # 보드 통과는 `daily_xp_30`을 넘길 수 있고(+10) 실제로 지급까지 되는데, 종전에는
    # `recalculate_quests` 반환을 버려 **보드 화면에서 그 사실이 보이지 않았다**.
    # 미통과(passed=False)면 재계산 자체를 안 하므로 항상 빈 리스트다.
    quest_rewards: list[QuestReward] = []
    # sum(quest_rewards.reward_xp) — 퍼즐 XP(xp_earned)와 축이 다르므로 합치지 않는다.
    bonus_xp: int = 0

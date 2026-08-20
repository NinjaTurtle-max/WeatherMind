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

    ⚠️ **이 자리에 `difficulty` 설명이 있었고 낡았다**(2026-08-20 정정). 종전 기술:
    *"difficulty: 1(쉬움)~3(어려움) — routers.board.board_difficulty가 template_json
    (mode·time_limit_sec·palette)과 level_group에서 산출(R7-02 §3.5)"*. 그 필드와
    그 함수는 **둘 다 철거됐다** — 응답 필드는 아래 `knowledge_level`이고 값은
    파생이 아니라 **저작값**(`content_items.knowledge_level`)이다. 경위를 남기는
    이유는 이 독스트링이 화면·목·계약 여러 곳에서 「난이도의 정의」로 인용됐기
    때문이다. 조용히 지우면 파생 규칙이 아직 산다는 오해가 남는다.

    **잠금은 두 축이고 둘 다 산다**(2026-08-12 병합 판정). 서로 다른 것을 막으므로
    합쳐도 모순이 아니고, 어느 한쪽을 버리면 사용자 지시 하나를 되돌리게 된다:

    locked: **학습 수준** 잠금(2026-08-10 지시) — *어느 층에 들어갈 수 있는가*.
    규칙의 소유자는 `routers.board.locked_tiers(ceiling)`이고 「천장 위 전 층이
    잠긴다 · 천장이 미상이면 아무것도 잠그지 않는다」가 그 내용이다.
    ⚠️ **종전 기술이 낡았다**(2026-08-20 정정): *"초등은 쉬움, 중·고등은 보통까지,
    성인은 전부. 규칙은 routers.board.locked_difficulties가 소유하고 열쇠는
    users.level_group이다"*. 셋 다 거짓이 됐다 — ⑴ 축이 난이도 3칸에서 **지식 단계
    10칸**으로 갈아탔고 ⑵ `locked_difficulties`는 **철거**됐고 ⑶ 열쇠가
    `users.level_group`이 아니다(학령 밴드를 천장 계산에서 빼는 것이 클라이언트
    판정이다).
    ✅ **천장의 소유자가 확정됐다**(2026-08-20 판정 — 이 독스트링이 몇 시간 전
    「판정 대기」라 적었던 그 자리다): **`routers.board.learner_tier`의 θ 파생 하나**다.
    학습자의 추정 단계(`weatherbrain_service.overall_knowledge_level`)가 천장이고,
    **θ가 없으면 잠그지 않는다.**
    ⚠️ **학령 밴드는 천장 계산에 들어가지 않는다** — 「밴드 폴백」 경로는 철거됐고
    `test_천장_계산이_학령_밴드를_읽지_않는다`가 되돌아오는 것을 막는다.
    ⚠️ **추천 판정(`router_chain`의 `focused|general|advanced`)은 천장에 쓰지 않는다.**
    그것은 「이번 세션에 무엇을 낼까」의 **순간 판정**이고 천장은 **지속 상태**라,
    순간 신호로 지속 상태를 정하면 3연속 정답 한 번에 층이 널뛴다. 경위·근거는
    대장 §5.27-h(실측)·§5.27-j(판정)가 소유한다.
    ⚠️ **범위 숫자를 여기 적지 않는다** — 천장 값은 사전 θ 파생이라 사전값이 바뀌면
    같이 바뀐다. 이 파일이 값을 적어 두 번 낡은 자리다.

    unlocked: **순차** 잠금(MT-24, 2026-08-11 멘토링 지시) — *열린 난이도 안에서
    어디까지 왔는가*. 2026-08-06에 "고를 자유가 없다"고 걷어냈던 것을 되살린 것이고,
    그때의 우려는 BOARD_UNLOCK_LOOKAHEAD가 흡수한다(벽 하나에 막히지 않는다).
    ⚠️ 순서는 **난이도로 거른 뒤에** 센다 — 전체를 대상으로 세면 초등 학습자의
    다음 칸이 「보통」인 순간 사슬이 영구히 끊긴다.

    목록은 두 축 모두 **무차단**이다. 잠긴 퍼즐도 제목과 함께 내려보내고 표시만
    다르게 한다 — 무엇이 기다리는지 보이지 않으면 잠금이 동기가 아니라 벽이 된다
    (에너지 게이트가 목록을 무차단으로 두는 것과 같은 이유).
    실제 차단은 진입(GET /puzzles/{id})·attempt(POST)가 403으로 한다.

    제목·요약·진행 순서는 template_json 안에 있다(title·summary·board_order —
    시드 저작). template_json을 통째로 노출하므로 별도 필드를 두지 않는다."""

    content_item_id: UUID
    template_json: dict[str, Any]
    cleared: bool
    # 🔴 2026-08-20: `difficulty`(파생 1~3)를 **제거하고 이 필드로 교체**했다
    # (클라이언트 판정 「지금 유닛 난이도와 똑같이 세분화」 · 어드바이저 판정 ⓒ).
    # 이름이 `knowledge_level`인 것이 요점이다 — 유닛·문항·표기가 쓰는 그 축과
    # **같은 이름**이어야 한다. 한 축에 이름을 둘 두면 이 저장소가 `level_label`로
    # 이미 치른 값을 다시 치른다.
    # ⚠️ **범위 숫자를 여기 적지 않는다** — 소유자는 `schemas/progress.KNOWLEDGE_LEVEL_MAX`
    # 하나다. 값이 없는 문항은 `None`이고 그때는 **잠그지 않는다**(routers.board.locked_tiers).
    knowledge_level: int | None = None
    # 두 기본값의 방향이 반대인 것은 의도다 — **구 클라이언트·구 응답에서 잠금이
    # 조용히 생기지 않아야** 한다. 각각 "안 잠김"이 기본이다.
    locked: bool = False
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

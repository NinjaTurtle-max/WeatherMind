"""세션 API 스키마 — 스프린트 R2-01 §3.1.

SessionItem = 기존 QuizQuestion + {"source": "bank"|"generated", "slot_filled": bool}.
"""
import uuid
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.curriculum import CrownAward
from app.schemas.duel import DuelPrediction
from app.schemas.quiz import AnswerResult, QuizQuestion
from app.schemas.reward import BadgeAward, QuestReward


class ForecastClosingStep(BaseModel):
    """일일 세션의 **마감 단계** — 예보 대결 (R13 A-1, additive).

    문항이 아니라 단계다: 예보의 정답은 **내일의 관측**이 정하므로 즉시 채점이
    불가능하고, 그래서 SESSION_RECIPE(15문항)에 들어가지 않는다. XP·구름 에너지·
    스트릭·만회 큐 어디에도 닿지 않는다 — 보상은 기존 리그·정산 경로가 소유한다.

    필드가 있으면 = 오늘 예보를 아직 안 냈고 판단 재료도 있다 → 프론트가 15문항
    뒤에 예보 입력 단계를 붙인다. **null이면 단계 없음**이고 세션은 15문항으로
    끝난다(오늘 이미 제출했거나, KMA 예보 부재 = degraded).

    프론트가 읽는 것:
    - `duel_date`  예보 대상일(=내일, KST). 화면 문구 "내일(8/8) 예보"
    - `submit_path` 제출 경로. **새 엔드포인트가 아니라 기존 예보 대결 제출**이다
      (`POST /api/v1/duel/today`, body는 DuelSubmitRequest). 재제출은 409
      ALREADY_SUBMITTED — 그때는 이 필드가 애초에 null이어야 정상이다.
    - `base_forecast` 대상일 KMA 기준 예보(참고 배너). 판단 재료 상세는 기존
      `GET /api/v1/duel/briefing`, **어제 낸 예보의 결과**는 기존
      `GET /api/v1/duel/history`(정산된 최신 항목)에서 읽는다 — 둘 다 이미 있다.
    """

    kind: Literal["forecast_duel"] = "forecast_duel"
    duel_date: date
    submit_path: str
    base_forecast: DuelPrediction | None = None


class SessionItem(QuizQuestion):
    source: Literal["bank", "generated"] = "bank"
    slot_filled: bool = False
    # 배합 블록 구분 (R13-01 §2.10, additive) — 완료 화면이 15문항을 "오늘의 발견
    # (new) / 복습(review) / 실황(live) / 진도(unit)"로 구분 표기하는 근거.
    # 서버 배합(plan_bank_picks)이 정한 값을 sessions.recipe_json items에 적어 두고
    # 그대로 흘려보낸다 — 프론트가 문항을 보고 되짚지 않는다(되짚을 방법도 없다).
    # 생성 폴백 문항은 어느 블록의 부족분인지 구분이 없어 'new'다.
    kind: Literal["new", "review", "live", "unit"] = "new"
    # 유형별 플레이 페이로드 — render된 값에서 유형 화이트리스트로 추린다
    # (routers/session.QUESTION_PAYLOAD_FIELDS). 프론트가 이 필드 없이는 문항을
    # 렌더하지 못한다(R3-01 §3.3 board → R10-07 §2.1 전 유형 확장):
    #   board    : mode·guide_steps·initial_state·palette·goal_conditions·hints·
    #              question_text·time_limit_sec·based_on
    #   match    : pairs
    #   ordering : items·shuffled
    #   slider   : min·max·step·unit (시드 저작 대기 — R10-07 S4)
    # multiple_choice·short_answer·cloze는 추가 페이로드가 필요 없어 None이며,
    # 저작된 키가 하나도 없는 경우에도 None이다(빈 값 주입 금지).
    # 비밀 정답(correct_answer)·해설(explanation_hint)은 어떤 유형에서도 제외한다.
    # (해설은 **채점 이후** AnswerResult.feedback으로만 나간다 — CO-I-1)
    template_json: dict[str, Any] | None = None
    # ── 재진입 복원 (CO-A5, additive) ──────────────────────────────────────
    # 문항별 채점 결과. `GET /session/today`는 하루 동안 멱등이라 중간 이탈 후 다시
    # 들어오는 것이 정상 경로인데, 그때 **어떤 문항을 틀렸는지 서버가 말해 주지
    # 않아** 프론트가 만회 큐를 복원하지 못했다(만회 라운드는 R13-01 §2.1의 핵심
    # 장치인데 새로고침 한 번에 사라졌다). 정답 자체는 여전히 안 나간다 — 나가는
    # 것은 "맞았나/틀렸나"뿐이라 정답 유출 경로가 아니다.
    #   is_correct    : 최초 채점 결과. **None = 아직 안 푼 문항**.
    #   retry_correct : 만회 라운드 결과. None = 만회 시도 없음.
    # 만회 대상 = `is_correct is False and retry_correct is not True`
    # (서버 판정 `answer_service.is_retry_eligible`과 **같은 식**이다 — 프론트가
    # 다른 규칙으로 큐를 만들면 제출이 409로 튕긴다).
    is_correct: bool | None = None
    retry_correct: bool | None = None


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
    # 마감 단계 (R13 A-1, additive) — daily 세션에서만, 필요할 때만 non-null.
    # unit·placement 세션은 항상 null이다.
    closing_step: ForecastClosingStep | None = None


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

    XP 분해값 xp_base·xp_weak_bonus도 additive로 상속한다 (R10-01 §3.5 마감 3,
    AnswerResult에 선언 — 이 응답이 유일한 소비자다): 프론트의 "약점 극복 +7"
    표기가 백엔드 상수 사본으로 역산되던 드리프트를 없앤다.
    xp_base + xp_weak_bonus == xp_earned가 계약이며
    tests/test_r10_xp_breakdown_contract.py가 감시한다.
    """

    session_progress: SessionProgress
    clouds_spent: int = 0
    clouds: int = 0
    # ── 만회 라운드 (R13-01 §2.1, additive) ──
    # is_retry: 이 응답이 **만회 재제출** 결과인가. True면 is_correct는 만회 채점
    #   결과이고 최초 기록(is_correct 컬럼)은 그대로 오답으로 남아 있다 —
    #   프론트가 "만회 성공/실패"와 "첫 시도 정답"을 구분하는 유일한 신호.
    # retry_correct: 만회 채점 결과(is_retry=False면 None). is_correct와 중복이지만
    #   응답만 보고 컬럼 의미를 되짚을 수 있게 명시적으로 싣는다.
    # xp_earned·clouds_spent는 만회에서 항상 0이다(파밍·벌 둘 다 차단 — §2.1).
    is_retry: bool = False
    retry_correct: bool | None = None


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
    # 만회 포함 해결 여부 (R13-01 §2.1, additive) — 왕관 부여 판정과 같은 값.
    # all_correct는 **최초 시도 만점**이라는 원래 뜻을 유지한다(두 값이 갈리는
    # 세션 = 만회로 클리어한 세션).
    all_resolved: bool = False


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
    # ── 만회 라운드 (R13-01 §2.1, additive) ──
    # all_resolved: 전 문항이 (is_correct=true) 또는 (retry_correct=true) — 왕관
    #   부여의 새 판정값. correct_count는 **최초 정답 수** 그대로다(회귀 방지).
    # retry_resolved_count: 만회로 해결한 문항 수 → 완료 화면 "만회 완료 N문항".
    all_resolved: bool = False
    retry_resolved_count: int = 0
    # ── 보상 획득 알림 (R13 CO-T-4, additive) ──
    # `recalculate_quests`·`award_badge`의 반환을 버리지 않고 내보낸다. 버렸을 때
    # 무슨 일이 있었나: 퀘스트 3종 최대 **+25 XP**와 `perfect_session` 배지가
    # 지급은 됐는데 **획득 순간 어느 화면에도 안 떴다**. 보유 목록(`/progress/quests`·
    # `/progress/badges`)에서 나중에 발견할 수는 있어도, 그건 "받았다"는 피드백이 아니다.
    #
    # 둘 다 **이번 호출에서 새로 일어난 것만** 담는다(멱등 재-complete는 빈 리스트).
    quest_rewards: list[QuestReward] = []
    badges_earned: list[BadgeAward] = []
    # 문항 XP 밖에서 이번 완료로 추가 지급된 XP 합 = sum(quest_rewards.reward_xp).
    bonus_xp: int = 0
    # 화면이 "+N XP"로 그릴 값 = xp_total + bonus_xp. **서버가 더해서 보낸다** —
    # `xp_total`은 세션 문항 XP라는 기존 의미를 그대로 두어야 하고(회귀 방지),
    # 프론트가 두 값을 더하게 두면 더하는 곳마다 빠뜨릴 수 있다(실제로 그래서
    # 표기가 실지급보다 최대 25 적었다). 유닛 세션의 `unit_result.unit_xp`는
    # 별개 축이라 여기 포함하지 않는다 — 그 페이지가 따로 더해 표기한다.
    xp_awarded: int = 0
    # ── 예보 마감 단계 (R13 A-1, additive) ──
    # 완료 화면이 15문항 결산 뒤에 붙일 단계. /session/today와 **같은 판정**이지만
    # 완료 시점에 다시 계산한다 — 세션 시작 후 다른 화면에서 예보를 냈으면 여기서
    # null이 되어야 프론트가 409로 끝나는 단계를 그리지 않는다.
    closing_step: ForecastClosingStep | None = None

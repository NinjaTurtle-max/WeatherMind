"""XP · 레벨 · 스트릭 계산 (docs/specs/07_gamification_spec.md 공식 그대로).

XP 원천 전수 카탈로그 — 유저 XP(users.xp)를 바꾸는 경로 전부, 11종 (R8-01 §3.6).
XP는 소비·게이팅이 없는 순수 보상 표시축이다(진척 모델은 07 §0).

| # | 원천 | XP | 지급 위치 | 출처 |
|---|---|---|---|---|
| 1 | 퀴즈 정답 | +10 (XP_QUIZ_CORRECT) | answer_service | 07 원안 |
| 2 | 퀴즈 오답(참여) | +2 (XP_QUIZ_WRONG) | answer_service | 07 원안 |
| 3 | 첫 시도 정답 보너스 | +5 (XP_FIRST_TRY_BONUS) | answer_service | 07 원안 |
| 4 | 일일 출석 | +5 (XP_DAILY_ATTENDANCE) | progress.py /attendance | 07 원안 |
| 5 | 스트릭 마일스톤 7/30/100일 공통 | +50 (XP_STREAK_MILESTONE_BONUS) | progress.py /attendance | 07 원안(7일)+R4-01 §3.3 확장 |
| 6 | 보드 퍼즐 최초 클리어 | +5 (XP_BOARD_CLEAR) | board.py attempt | R3-01 §3.5 |
| 7 | 유닛 cleared 전환 | +20 (XP_UNIT_CLEAR) | curriculum_service.grant_unit_crown | R5-01 §3.2 |
| 8 | 퀘스트 daily_xp_30 완료 | +10 | quest_service.recalculate_quests | R4-01 §3.1 |
| 9 | 퀘스트 weak_correct_1 완료 | +10 | quest_service.recalculate_quests | R4-01 §3.1 |
| 10 | 퀘스트 live_answered 완료 | +5 | quest_service.recalculate_quests | R4-01 §3.1 |
| 11 | 예보 대결 승리 | +15 (duel_service.DUEL_WIN_XP) | celery settle_daily_duel | R4-01 §3.4 |

- 약점 개념 정답 배율: 원천 1·3의 합에 1.5배 (WEAK_TAG_XP_MULTIPLIER) —
  독립 원천이 아니라 배율. 이 모듈은 배율만 소유하고 **약점 여부는 판정하지
  않는다**. 판정의 단일 공급원은 weatherbrain_service.weak_concepts(θ 파생,
  학령 상대 임계 — R8-01 §3.5)이고, is_weak 인자는 그 결과를 받아 온다.
- 원천 11만 add_xp를 거치지 않는다: celery는 별도 빌드 컨텍스트라 생 SQL
  (UPDATE users SET xp = xp + :bonus)로 지급. 상수 단일 소유는 duel_service,
  복제본 드리프트는 tests/test_xp_contract.py 교차 계약 테스트가 감시.
- 진단(placement) 세션은 grant_xp=False — 원천 1~3 미지급(answer_service).
- 로드맵(미구현, 상수 없음): 기후 탐정 +30 · 리그 상위 10% +40 (07 §1 로드맵 절).
"""
import math
import uuid
from datetime import date, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.weak_tag import WeakTag

# ── XP 획득 규칙 (07번 표 그대로) ──
XP_QUIZ_CORRECT = 10
XP_QUIZ_WRONG = 2
XP_FIRST_TRY_BONUS = 5
XP_DAILY_ATTENDANCE = 5
# 스트릭 마일스톤(7/30/100일) 공통 보너스 — 07 원안 "7일 +50"이 R4-01 §3.3에서
# 마일스톤 3종으로 확장되며 전부 동일 지급(progress.py 출석 경로)
XP_STREAK_MILESTONE_BONUS = 50
# 대기 보드 퍼즐 최초 클리어 보상 (스프린트 R3-01 §3.5, 재도전 0)
XP_BOARD_CLEAR = 5
# 커리큘럼 유닛 clear 전환 보상 (스프린트 R5-01 §3.2, cleared 전환 시 1회)
XP_UNIT_CLEAR = 20

# 약점 개념 정답 보너스 배율
WEAK_TAG_XP_MULTIPLIER = 1.5
# 스트릭 마일스톤 (7일/30일/100일 달성 시 배지 + 보너스 XP)
STREAK_MILESTONES = (7, 30, 100)

# ── 스트릭 프리즈 "구름 방패" (스프린트 R2-01 §3.5) ──
MAX_STREAK_FREEZE = 2          # 최대 보유 수
FREEZE_GRANT_MILESTONE = 7     # 7일 마일스톤 달성 시 +1 지급


def level_from_xp(xp: int) -> int:
    """레벨 N에 필요한 누적 XP = 50 * N^2. Lv1: 0~49, Lv2: 50~199, Lv3: 200~449 ..."""
    return int(math.sqrt(xp / 50)) + 1


def next_level_xp(current_level: int) -> int:
    return 50 * (current_level ** 2)


async def get_weak_tag(
    session: AsyncSession, user_id: uuid.UUID, concept_tag: str
) -> WeakTag | None:
    result = await session.execute(
        select(WeakTag).where(
            WeakTag.user_id == user_id, WeakTag.concept_tag == concept_tag
        )
    )
    return result.scalar_one_or_none()


async def update_weak_tag(
    session: AsyncSession, user_id: uuid.UUID, concept_tag: str, is_correct: bool
) -> None:
    """weak_tags upsert: total_count += 1, 오답이면 wrong_count += 1.

    accuracy_rate는 GENERATED 컬럼이라 DB가 자동 계산한다.
    """
    stmt = pg_insert(WeakTag).values(
        user_id=user_id,
        concept_tag=concept_tag,
        total_count=1,
        wrong_count=0 if is_correct else 1,
    ).on_conflict_do_update(
        constraint="uq_weak_tags_user_concept",
        set_={
            "total_count": WeakTag.total_count + 1,
            "wrong_count": WeakTag.wrong_count + (0 if is_correct else 1),
            "updated_at": text("now()"),
        },
    )
    await session.execute(stmt)


def quiz_xp_breakdown(
    is_correct: bool, is_first_try: bool, is_weak: bool
) -> tuple[int, int]:
    """퀴즈 1문항 XP의 분해값 (base, weak_bonus) — 합은 항상 quiz_xp()와 같다.

    R10-01 §3.5 마감 3: "+15 XP, 약점 극복 +7"의 분리 표기를 프론트가 역산하던
    구현(xp_earned − 백엔드 상수 사본)을 제거하기 위해 서버가 분해를 소유한다.
    프론트는 배율(1.5)도 반올림 규칙도 알 필요가 없다 — 두 정수만 읽는다.

    - base = 약점 배율 적용 **전** 금액 (정답 10 + 첫 시도 5 / 오답 2)
    - weak_bonus = 배율로 늘어난 차액. 약점이 아니거나 오답이면 0
      (1.5배는 "약점 개념을 맞혔을 때"의 보너스 — 오답에는 적용되지 않는다)

    반올림은 파이썬 round()(banker's rounding)를 그대로 유지한다:
    (10+5)*1.5 = 22.5 → 22 (base 15 + bonus 7). 이 함수가 그 유일한 소유자다.
    """
    if not is_correct:
        return XP_QUIZ_WRONG, 0
    base = XP_QUIZ_CORRECT + (XP_FIRST_TRY_BONUS if is_first_try else 0)
    if not is_weak:
        return base, 0
    return base, round(base * WEAK_TAG_XP_MULTIPLIER) - base


def quiz_xp(is_correct: bool, is_first_try: bool, is_weak: bool) -> int:
    """퀴즈 1문항 XP: 정답 +10 (+첫 시도 정답 +5), 오답 +2.

    약점 개념 정답이면 1.5배 (약점 극복 유도). is_weak 판정은 이 모듈이 아니라
    weatherbrain_service.weak_concepts(θ 파생)가 소유한다 — 옛 accuracy_rate < 60
    축은 아니다.
    계산은 quiz_xp_breakdown 단일 소유 — 여기서는 분해값을 합산만 한다.
    """
    return sum(quiz_xp_breakdown(is_correct, is_first_try, is_weak))


async def add_xp(session: AsyncSession, user_id: uuid.UUID, amount: int) -> int:
    """유저 XP 원자 가산(UPDATE xp = xp + n). 반환: 가산된 XP.

    User 로드·None 가드가 필요 없다 — 미존재 유저면 무동작(0행 갱신).
    """
    await session.execute(
        update(User).where(User.id == user_id).values(xp=User.xp + amount)
    )
    return amount


def update_streak(user: User, today: date) -> tuple[int, bool, bool]:
    """출석 시점 스트릭 계산 (07번 공식 + R2-01 §3.5 스트릭 프리즈).

    - 어제 출석: 연속 +1
    - 그제(이틀 전) 출석 + freeze ≥ 1: 프리즈 1 소모, 연속 유지(+1)
    - 사흘 이상 결손: 프리즈 보유와 무관하게 1로 리셋
    - 스트릭 7일 마일스톤 달성 시 프리즈 +1 지급 (최대 2, 초과 시 미지급)

    반환: (streak_count,
           milestone_hit — 마일스톤(7/30/100) 신규 달성 여부,
           freeze_used — 이번 출석에서 프리즈를 소모했는지)
    """
    yesterday = today - timedelta(days=1)
    day_before = today - timedelta(days=2)
    freeze_used = False
    if user.last_login_date == today:
        return user.streak_count, False, False  # 이미 출석, 변화 없음
    elif user.last_login_date == yesterday:
        user.streak_count += 1  # 연속
    elif user.last_login_date == day_before and user.streak_freeze_count >= 1:
        user.streak_freeze_count -= 1  # 하루 결손 방어 — 프리즈 소모
        user.streak_count += 1
        freeze_used = True
    else:
        user.streak_count = 1  # 끊김, 리셋
    user.last_login_date = today
    milestone_hit = user.streak_count in STREAK_MILESTONES
    if (
        user.streak_count == FREEZE_GRANT_MILESTONE
        and user.streak_freeze_count < MAX_STREAK_FREEZE
    ):
        user.streak_freeze_count += 1  # 7일 마일스톤 보상
    return user.streak_count, milestone_hit, freeze_used

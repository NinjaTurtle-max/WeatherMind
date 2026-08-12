"""배지 지급·조회 — 스프린트 R4-01 §3.3 (R4-S3).

정의 5종(코드 고정, badges.json 시드와 일치): streak_7 / streak_30 / streak_100 /
perfect_session / tier_promoted.

지급 시점(§3.3):
- streak_*: 출석 마일스톤(update_streak 반환 milestone_hit + 그 시점 streak_count)
- perfect_session: 세션 complete가 5/5 정답일 때
- tier_promoted: 리그 정산 태스크(직전 tier보다 상승 시 — celery/app/tasks/league.py)

중복 지급 없음: user_badges UNIQUE(user_id, badge_id) + ON CONFLICT DO NOTHING(멱등).
badges 시드가 아직 없으면(로더 미실행) 지급은 조용한 no-op이다.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import Badge, UserBadge

# ── 배지 코드 (고정) ──
BADGE_STREAK_7 = "streak_7"
BADGE_STREAK_30 = "streak_30"
BADGE_STREAK_100 = "streak_100"
BADGE_PERFECT_SESSION = "perfect_session"
BADGE_TIER_PROMOTED = "tier_promoted"

# 스트릭 마일스톤 → 배지 코드 (xp_service.STREAK_MILESTONES와 1:1)
STREAK_BADGE_BY_MILESTONE: dict[int, str] = {
    7: BADGE_STREAK_7,
    30: BADGE_STREAK_30,
    100: BADGE_STREAK_100,
}


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def streak_badge_code(streak_count: int) -> str | None:
    """스트릭 일수 → 마일스톤 배지 코드. 마일스톤(7/30/100)이 아니면 None."""
    return STREAK_BADGE_BY_MILESTONE.get(streak_count)


def is_perfect_session(correct_count: int, total: int) -> bool:
    """무오답 세션 판정 — 전 문항 정답(총 문항 ≥ 1). 빈 세션은 완벽 아님."""
    return total > 0 and correct_count == total


# ═══════════════════════════════════════════════════════════════
# DB 결합부
# ═══════════════════════════════════════════════════════════════


async def award_badge(
    db: AsyncSession, user_id: uuid.UUID, code: str
) -> bool:
    """유저에게 배지를 1회 지급한다(멱등). 반환: 신규 지급 여부.

    - 배지 코드가 badges 테이블에 없으면(시드 미적재) no-op으로 False.
    - 이미 보유 중이면 ON CONFLICT DO NOTHING으로 no-op, False.
    - 신규 지급 시 True.
    """
    badge_id = (
        await db.execute(select(Badge.id).where(Badge.code == code))
    ).scalar_one_or_none()
    if badge_id is None:
        return False

    stmt = (
        pg_insert(UserBadge)
        .values(user_id=user_id, badge_id=badge_id)
        .on_conflict_do_nothing(constraint="uq_user_badges_user_badge")
        .returning(UserBadge.id)
    )
    inserted = (await db.execute(stmt)).scalar_one_or_none()
    return inserted is not None


async def badge_detail(db: AsyncSession, code: str) -> dict | None:
    """배지 코드 → 표시용 {code, title, description}. 시드에 없으면 None (CO-T-4).

    `award_badge`가 True(신규 지급)를 반환했을 때만 부르는 조회다 — 획득 알림에
    코드만 보내면 화면이 "무엇을 받았는지" 말할 수 없기 때문. `award_badge`의
    반환을 bool로 유지하는 대신 여기서 한 번 더 읽는다: 시그니처를 바꾸면
    출석(progress.py)·리그 정산(celery) 호출부까지 함께 끌려온다.
    """
    row = (
        await db.execute(
            select(Badge.code, Badge.title, Badge.description).where(
                Badge.code == code
            )
        )
    ).first()
    if row is None:
        return None
    return {"code": row[0], "title": row[1], "description": row[2]}


async def list_badges(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """GET /progress/badges — 전체 배지 정의 + 획득 시각(미획득은 null) (§3.3)."""
    rows = (
        (
            await db.execute(
                select(
                    Badge.code,
                    Badge.title,
                    Badge.description,
                    UserBadge.earned_at,
                )
                .join(
                    UserBadge,
                    (UserBadge.badge_id == Badge.id)
                    & (UserBadge.user_id == user_id),
                    isouter=True,
                )
                .order_by(Badge.code.asc())
            )
        )
    ).all()
    return [
        {
            "code": code,
            "title": title,
            "description": description,
            "earned_at": earned_at,
        }
        for code, title, description, earned_at in rows
    ]

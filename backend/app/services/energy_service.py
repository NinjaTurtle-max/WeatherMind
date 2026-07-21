"""구름 에너지 서비스 — 스프린트 R5-01 §3.3·§3.4.

"구름"을 소모성 자원으로 두고, 문항 시도가 1 소모하며 시간 경과로 회복한다
(재방문·체류시간 유도). 스트릭 프리즈("구름 방패")와 **독립 자원**이다.

지연 회복 모델(크론 불필요): 읽기·소모 시점에 elapsed = now - clouds_updated_at으로
회복량을 계산해 clamp(clouds + elapsed // REGEN, MAX) 하고 clouds_updated_at을
갱신한다. 잉여 시간(다음 회복까지의 진행분)은 updated_at을 tick만큼만 전진시켜
carry 한다 — 매 읽기마다 now로 리셋하면 잉여가 소실되기 때문.

구조적 결정: 회복량·다음 ETA·소모 계획은 DB 의존이 없는 **순수 함수**(regen_amount,
apply_regen, next_regen_sec, plan_consume)로 분리해 pytest가 DB 없이 경계를 검증한다
(TEAM_PROCESS §1.2 테스트 피라미드). DB 결합부(get_state·consume)는 원자 UPDATE로
회복 반영 + 가드된 1 감소를 수행한다(동시 요청 lost update 방지 — R4 교훈).

기능 플래그 ENERGY_ENABLED(core/config, 기본 true) — false면 무제한(소모 없음,
기존 동작). 레이트리밋과 별개 층(§3.4).
"""
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User

# ── 상수 (§3.3) ──
CLOUD_MAX = 5
CLOUD_REGEN_MINUTES = 20             # 구름 1개 회복 주기
CLOUD_REGEN_SECONDS = CLOUD_REGEN_MINUTES * 60
CLOUD_COST = 1                       # 시도당 소모량


class OutOfCloudsError(Exception):
    """구름 소진 — 소모 불가 (라우터에서 429 OUT_OF_CLOUDS로 변환).

    next_regen_sec: 다음 1개 회복까지 남은 초(재방문 유도 노출용).
    """

    def __init__(self, next_regen_sec: int):
        self.next_regen_sec = next_regen_sec
        super().__init__(f"구름이 부족합니다 (다음 회복까지 {next_regen_sec}초)")


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def regen_amount(
    clouds: int, updated_at: datetime | None, now: datetime
) -> int:
    """지연 회복량(clamp 반영). 만렙·기준시각 부재·미경과면 0.

    회복량 = min(elapsed // REGEN, MAX - clouds).
    """
    if clouds >= CLOUD_MAX or updated_at is None:
        return 0
    elapsed = (now - updated_at).total_seconds()
    if elapsed <= 0:
        return 0
    ticks = int(elapsed // CLOUD_REGEN_SECONDS)
    return max(0, min(ticks, CLOUD_MAX - clouds))


def apply_regen(
    clouds: int, updated_at: datetime | None, now: datetime
) -> tuple[int, datetime]:
    """지연 회복을 적용해 (새 clouds, 새 updated_at)를 반환한다 (순수).

    - 기준시각 부재: 회복 불가 → 기준시각을 now로 확립.
    - 만렙 도달: updated_at을 now로(만렙 동안은 회복 시계가 멈춘 것으로 취급 —
      이후 소모 시점부터 20분 카운트).
    - 그 외: updated_at을 회복한 tick(20분×n)만큼만 전진(잉여 carry).
    """
    if updated_at is None:
        return clouds, now
    amount = regen_amount(clouds, updated_at, now)
    new_clouds = clouds + amount
    if new_clouds >= CLOUD_MAX:
        return CLOUD_MAX, now
    return new_clouds, updated_at + timedelta(seconds=amount * CLOUD_REGEN_SECONDS)


def next_regen_sec(
    clouds: int, updated_at: datetime | None, now: datetime
) -> int:
    """다음 구름 1개 회복까지 남은 초. 만렙이면 0."""
    new_clouds, new_updated = apply_regen(clouds, updated_at, now)
    if new_clouds >= CLOUD_MAX:
        return 0
    elapsed = (now - new_updated).total_seconds()
    remaining = CLOUD_REGEN_SECONDS - elapsed
    return max(0, int(math.ceil(remaining)))


def plan_consume(
    clouds: int,
    updated_at: datetime | None,
    now: datetime,
    enabled: bool = True,
) -> tuple[int, datetime | None]:
    """1 소모 계획(순수). 반환: (소모 후 clouds, 소모 후 updated_at).

    - enabled=False: 무제한 → 상태 불변(no-op) 반환.
    - 회복 반영 후 0이면 OutOfCloudsError(next_regen_sec).
    - 소모는 updated_at을 바꾸지 않는다(현재 회복 주기 진행분 유지 — 만렙에서
      소모한 경우 apply_regen이 이미 now로 확립해 20분 카운트가 시작된다).
    """
    if not enabled:
        return clouds, updated_at
    new_clouds, new_updated = apply_regen(clouds, updated_at, now)
    if new_clouds < CLOUD_COST:
        raise OutOfCloudsError(next_regen_sec(new_clouds, new_updated, now))
    return new_clouds - CLOUD_COST, new_updated


# ═══════════════════════════════════════════════════════════════
# DB 결합부
# ═══════════════════════════════════════════════════════════════


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def get_state(
    db: AsyncSession, user: User, now: datetime | None = None
) -> dict:
    """구름 상태 읽기 — 지연 회복을 적용·영속하고 표시용 dict를 반환한다.

    ENERGY_ENABLED=false면 항상 만렙으로 표시(무제한).
    반환: {clouds, max, next_regen_sec, updated_at}.
    """
    now = now or _now()
    if not settings.ENERGY_ENABLED:
        return {
            "clouds": CLOUD_MAX,
            "max": CLOUD_MAX,
            "next_regen_sec": 0,
            "updated_at": now,
        }

    new_clouds, new_updated = apply_regen(user.clouds, user.clouds_updated_at, now)
    # 만렙(clouds 불변)일 때는 쓰지 않는다 — 매 폴링마다 updated_at=now UPDATE가
    # 나가는 write amplification 방지. 만렙 상태의 updated_at은 소모 시점에 consume이
    # 다시 now로 확립하므로 정합성 손실 없음. 기준시각 부재(None)만 예외적으로 확립.
    if new_clouds != user.clouds or user.clouds_updated_at is None:
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(clouds=new_clouds, clouds_updated_at=new_updated)
        )
        user.clouds = new_clouds
        user.clouds_updated_at = new_updated
    return {
        "clouds": new_clouds,
        "max": CLOUD_MAX,
        "next_regen_sec": next_regen_sec(new_clouds, new_updated, now),
        "updated_at": new_updated,
    }


async def consume(
    db: AsyncSession, user: User, now: datetime | None = None
) -> int:
    """구름 1 소모 (§3.3). ENERGY_ENABLED=false면 무제한(no-op, MAX 반환).

    지연 회복을 먼저 영속(잉여 carry 확정)한 뒤, 가드된 원자 UPDATE로 1 감소한다
    (동시 요청 lost update 방지). 소진 시 OutOfCloudsError(→429).

    반환: 소모 후 남은 구름 수.
    Raises:
        OutOfCloudsError: 소모 가능한 구름이 없음.
    """
    if not settings.ENERGY_ENABLED:
        return CLOUD_MAX

    now = now or _now()
    new_clouds, new_updated = apply_regen(user.clouds, user.clouds_updated_at, now)

    # 1) 회복분 먼저 반영 (updated_at carry 확정)
    if new_clouds != user.clouds or new_updated != user.clouds_updated_at:
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(clouds=new_clouds, clouds_updated_at=new_updated)
        )
        user.clouds = new_clouds
        user.clouds_updated_at = new_updated

    if new_clouds < CLOUD_COST:
        raise OutOfCloudsError(next_regen_sec(new_clouds, new_updated, now))

    # 2) 가드된 원자 소모 (동시 소모 경합 방어 — clouds >= COST 조건)
    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.clouds >= CLOUD_COST)
        .values(clouds=User.clouds - CLOUD_COST)
        .returning(User.clouds)
    )
    remaining = result.scalar_one_or_none()
    if remaining is None:
        # 경합으로 이미 소진 — 방어적 OUT_OF_CLOUDS
        raise OutOfCloudsError(next_regen_sec(0, new_updated, now))
    user.clouds = remaining
    return remaining

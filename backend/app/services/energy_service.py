"""구름 에너지 서비스 — 스프린트 R5-01 §3.3·§3.4 (R10-01 §3.1 정책 전환).

"구름"을 소모성 자원으로 두고, 시간 경과로 회복한다(재방문·체류시간 유도).
스트릭 프리즈("구름 방패")와 **독립 자원**이다.

R10-01 정책 전환 — 구름은 **노력이 아니라 실수에 소모된다**:
- 소모 트리거는 `should_consume`(순수) 하나로 모은다 — 오답만 1, 정답·재제출
  (멱등 히트)·배치고사는 0. 라우터 3곳이 같은 규칙을 공유한다.
- 소모는 **채점/판정 이후**에 `consume_if_available`로 하며, 가드 UPDATE가 0행이면
  **예외 없이** 소모를 생략한다 — 진행 중 세션을 429로 끊지 않기 위한 계약
  (§3.1 각주 7 "풀던 것을 뺏기지 않는다").
- 차단은 **문항 진입 전**에 `require_entry`가 담당한다(무소모 검사 전용).
  적용 지점은 세션 발급 2곳(`/session/today` 신규 발급 분기·`/units/{slug}/session`)과
  보드 퍼즐 상세(`/board/puzzles/{id}`) — D6 확정 목록.

지연 회복 모델(크론 불필요): 읽기·소모 시점에 elapsed = now - clouds_updated_at으로
회복량을 계산해 clamp(clouds + elapsed // REGEN, MAX) 하고 clouds_updated_at을
갱신한다. 잉여 시간(다음 회복까지의 진행분)은 updated_at을 tick만큼만 전진시켜
carry 한다 — 매 읽기마다 now로 리셋하면 잉여가 소실되기 때문.

구조적 결정: 회복량·다음 ETA·소모 계획은 DB 의존이 없는 **순수 함수**(regen_amount,
apply_regen, next_regen_sec, plan_consume, should_consume)로 분리해 pytest가 DB 없이
경계를 검증한다(TEAM_PROCESS §1.2 테스트 피라미드). DB 결합부(get_state·require_entry·
consume_if_available)는 원자 UPDATE로 회복 반영 + 가드된 1 감소를 수행한다
(동시 요청 lost update 방지 — R4 교훈).

기능 플래그 ENERGY_ENABLED(core/config, 기본 true) — false면 무제한(소모 없음,
기존 동작). 레이트리밋과 별개 층(§3.4).
"""
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User

# ── 상수 (§3.3) ── 계약 기본값은 settings에 있고(만렙 5·20분·1 소모), env로만
# 튜닝한다(R5.5 밸런스 외부화). 서버 기동 시점에 바인딩 — 변경은 재시작 반영.
CLOUD_MAX = settings.CLOUD_MAX
CLOUD_REGEN_MINUTES = settings.CLOUD_REGEN_MINUTES   # 구름 1개 회복 주기(분)
CLOUD_REGEN_SECONDS = CLOUD_REGEN_MINUTES * 60
CLOUD_COST = settings.CLOUD_COST                     # 시도당 소모량


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


def should_consume(
    *,
    is_correct: bool,
    already_answered: bool = False,
    is_placement: bool = False,
) -> bool:
    """소모 트리거 (R10-01 §3.1) — **오답일 때만** True.

    라우터 3곳(세션 제출·보드 시도·향후 경로)이 같은 규칙을 공유하도록 순수 판정으로
    분리한다. keyword-only인 이유는 정오답과 멱등 플래그를 위치인자로 혼동하면
    "정답에 과금"이 조용히 되살아나기 때문(계약 1~5).

    - is_correct: 채점 결과(보드는 passed) — 정답이면 0 소모("노력에는 과금 없음").
    - already_answered: 재제출(멱등 히트) — 새 시도가 아니므로 0.
    - is_placement: 배치고사(mode='placement') — 진단이므로 0(기존 면제 승계).
    """
    return not is_correct and not already_answered and not is_placement


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
    # 나가는 write amplification 방지. 만렙 상태의 updated_at은 소모·진입 시점에
    # _persist_regen이 다시 now로 확립하므로 정합성 손실 없음. 기준시각 부재(None)만
    # 예외적으로 확립.
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


async def _persist_regen(
    db: AsyncSession, user: User, now: datetime
) -> tuple[int, datetime]:
    """지연 회복분을 영속하고 (clouds, updated_at)을 반환한다 — 증가만 발생.

    회복 반영은 잉여 carry를 확정하는 것이므로 소모·차단 판정보다 **먼저** 일어나야
    한다(20분 지나 회복된 구름으로 진입이 가능해야 한다). 감소는 여기서 절대 쓰지
    않는다 — 소모는 consume_if_available의 가드 UPDATE 소유다.
    """
    new_clouds, new_updated = apply_regen(user.clouds, user.clouds_updated_at, now)
    if new_clouds != user.clouds or new_updated != user.clouds_updated_at:
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(clouds=new_clouds, clouds_updated_at=new_updated)
        )
        user.clouds = new_clouds
        user.clouds_updated_at = new_updated
    return new_clouds, new_updated


async def require_entry(
    db: AsyncSession, user: User, now: datetime | None = None
) -> dict:
    """진입 게이트 (R10-01 §3.1) — 잔량 부족이면 차단하되 **소모하지 않는다**.

    문항을 열기 전(세션 발급·보드 퍼즐 상세)에 호출한다. 회복분을 반영한 뒤
    `clouds < CLOUD_COST`면 OutOfCloudsError(→429 OUT_OF_CLOUDS, next_regen_sec 동봉).
    통과 시 반환은 get_state와 **동일 키**({clouds, max, next_regen_sec, updated_at}) —
    프론트가 한 스키마로 잔량을 읽는다.

    `plan_consume`을 검사용으로 재사용하지 않는다(감소값을 버리는 호출은 "게이트는
    소모하지 않는다"가 코드에서 읽히지 않는다 — D8-4). 순수 모델과의 경계 일치는
    계약 테스트가 오라클로 보증한다.

    ENERGY_ENABLED=false면 no-op(만렙 표시, DB 무접근 — get_state 전례).

    Raises:
        OutOfCloudsError: 진입에 필요한 구름이 없음.
    """
    now = now or _now()
    if not settings.ENERGY_ENABLED:
        return {
            "clouds": CLOUD_MAX,
            "max": CLOUD_MAX,
            "next_regen_sec": 0,
            "updated_at": now,
        }

    new_clouds, new_updated = await _persist_regen(db, user, now)
    if new_clouds < CLOUD_COST:
        raise OutOfCloudsError(next_regen_sec(new_clouds, new_updated, now))
    return {
        "clouds": new_clouds,
        "max": CLOUD_MAX,
        "next_regen_sec": next_regen_sec(new_clouds, new_updated, now),
        "updated_at": new_updated,
    }


async def consume_if_available(
    db: AsyncSession, user: User, now: datetime | None = None
) -> int:
    """구름 1 소모 — 잔량이 없으면 **예외 없이** 소모를 생략한다 (R10-01 §3.1).

    회복분을 먼저 영속한 뒤 가드된 원자 UPDATE(`clouds >= CLOUD_COST`)로 감소한다
    (동시 요청 lost update 방지). 가드가 0행을 반환하면(경합·소진) 구 consume()처럼
    429를 던지지 않고 **해당 행의 실측 잔량을 재조회해 반환**한다 — 진행 중 세션의
    마지막 오답이 429로 끊기지 않아야 하기 때문(§3.1 각주 7). 차단은 진입 게이트
    (require_entry)의 책임이다.

    0행 분기에서 `0`을 하드코딩하지 않는 이유(D8-3): 가드가 `>= CLOUD_COST`이므로
    COST가 env로 2 이상이면 0행에서도 잔량이 1일 수 있고, 그때 0을 돌려주면 구름을
    삼킨다.

    ENERGY_ENABLED=false면 no-op(DB 무접근, CLOUD_MAX 반환).

    반환: 소모 후(또는 생략 후) 남은 구름 수 — 항상 0 이상.
    """
    if not settings.ENERGY_ENABLED:
        return CLOUD_MAX

    now = now or _now()
    await _persist_regen(db, user, now)

    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.clouds >= CLOUD_COST)
        .values(clouds=User.clouds - CLOUD_COST)
        .returning(User.clouds)
    )
    remaining = result.scalar_one_or_none()
    if remaining is None:
        # 가드 미충족(잔량 부족·경합) — 소모 생략. 세션 캐시가 stale일 수 있으므로
        # in-memory 값이 아니라 행을 재조회해 실측 잔량을 돌려준다.
        remaining = (
            await db.execute(select(User.clouds).where(User.id == user.id))
        ).scalar_one_or_none()
        if remaining is None:  # 행을 못 읽으면(RLS·삭제) 세션 캐시로 폴백
            remaining = user.clouds
    user.clouds = max(0, remaining)
    return user.clouds

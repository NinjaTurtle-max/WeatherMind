"""기상 리그 — 정확도 점수 · ELO 레이팅 (docs/specs/07_gamification_spec.md 공식 그대로).

주간 정산(actual_value·accuracy_score·elo_rating_after 기록)은 Celery
(celery/app/tasks/league.py)가 수행하고, backend는 제출·조회와 공식만 소유한다.
"""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.league_result import LeagueResult

ELO_INITIAL = 1200
ELO_K = 32

# ── 리그 티어 (스프린트 R4-01 §3.2 — 구름 분류 네이밍) ──
# (코드, 하한 ELO). 낮은 순서 → 높은 순서. 인덱스가 승급 판정의 서열이다.
TIER_THRESHOLDS: tuple[tuple[str, int], ...] = (
    ("stratus", 0),          # 층운 — 기본(<1100)
    ("cumulus", 1100),       # 적운
    ("nimbostratus", 1250),  # 난층운
    ("cumulonimbus", 1400),  # 적란운
    ("typhoon_eye", 1550),   # 태풍의 눈
)
TIER_ORDER: tuple[str, ...] = tuple(code for code, _ in TIER_THRESHOLDS)
DEFAULT_TIER = TIER_ORDER[0]


def tier_from_elo(elo: int) -> str:
    """정산 시점 ELO를 구름 티어 코드로 산정한다 (§3.2, 순수 함수).

    임계값 이상이면 해당 티어 — <1100 stratus / ≥1100 cumulus / ≥1250 nimbostratus /
    ≥1400 cumulonimbus / ≥1550 typhoon_eye. 경계는 하한 포함(≥).
    """
    tier = DEFAULT_TIER
    for code, floor in TIER_THRESHOLDS:
        if elo >= floor:
            tier = code
    return tier


def is_tier_promoted(previous_tier: str | None, new_tier: str) -> bool:
    """직전 대비 티어가 상승했는지 (§3.2 tier_promoted 배지 조건, 순수 함수).

    직전 tier가 없으면(첫 정산) 기본 티어(stratus) 기준으로 비교한다 —
    첫 정산에서 cumulus 이상이면 승급으로 본다.
    """
    prev = previous_tier if previous_tier in TIER_ORDER else DEFAULT_TIER
    return TIER_ORDER.index(new_tier) > TIER_ORDER.index(prev)


def accuracy_score(predicted: dict, actual: dict) -> float:
    """각 항목 오차를 0~100 점수로 환산 후 평균 (07번 원문 그대로)."""
    temp_max_err = abs(predicted["temp_max"] - actual["temp_max"])
    temp_score = max(0, 100 - temp_max_err * 10)      # 1도당 -10점
    rain_err = abs(predicted["rain_prob"] - actual["rain_prob"])
    rain_score = max(0, 100 - rain_err)                # 1%당 -1점
    return round((temp_score + rain_score) / 2, 2)


def update_elo(rating: int, score: float, expected: float, k: int = ELO_K) -> int:
    """score: 이번 주 정확도(0~1 정규화), expected: 리그 평균 대비 기대값.

    초기 레이팅 1200. 리그 미참여 주는 변동 없음.
    """
    return round(rating + k * (score - expected))


def week_start_of(day: date) -> date:
    """해당 날짜가 속한 주의 월요일."""
    return day - timedelta(days=day.weekday())


async def get_current_rating(session: AsyncSession, user_id: uuid.UUID) -> int | None:
    """마지막으로 정산된 elo_rating_after. 정산 이력이 없으면 None(첫 참가).

    R9-01 §3.2: None은 적응형 캐스터에서 "첫 참가 = 기본 노이즈 1.00"으로
    해석된다(duel_service.caster_noise_scale). 정산 이력 없는 유저를 stratus로
    보는 get_current_tier와 일관 — ELO_INITIAL(1200) 폴백을 쓰면 첫 참가가
    cumulus(≥1100)로 오판정되므로 여기서 폴백하지 않는다.
    """
    result = await session.execute(
        select(LeagueResult.elo_rating_after)
        .where(
            LeagueResult.user_id == user_id,
            LeagueResult.elo_rating_after.is_not(None),
        )
        .order_by(LeagueResult.week_start.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_current_tier(session: AsyncSession, user_id: uuid.UUID) -> str:
    """최근 정산된 league_results.tier. 정산 이력이 없으면 기본 티어(stratus) (§3.2)."""
    result = await session.execute(
        select(LeagueResult.tier)
        .where(
            LeagueResult.user_id == user_id,
            LeagueResult.tier.is_not(None),
        )
        .order_by(LeagueResult.week_start.desc())
        .limit(1)
    )
    tier = result.scalar_one_or_none()
    return tier if tier is not None else DEFAULT_TIER

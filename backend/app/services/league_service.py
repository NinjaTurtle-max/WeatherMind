"""기상 리그 — 정확도 점수 · ELO 레이팅 (docs/specs/07_gamification_spec.md 공식 그대로).

주간 정산(actual_value·accuracy_score·elo_rating_after 기록)은 Celery
(celery/app/tasks/league.py)가 수행하고, backend는 제출·조회와 공식만 소유한다.
"""
import uuid
from datetime import date, timedelta
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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


# ── 분반 리더보드 (R13-01 §2.8) ────────────────────────────────────────────
# 설계: **전역 순위의 연속 블록 분할**(rank-block). 주간 리더보드를 이미 계산된
# 정렬 순서대로 DIVISION_SIZE명씩 잘라 분반을 만들고, 내 분반 안에서의 지역 순위와
# 바로 위·아래와의 점수 격차를 돌려준다.
#
# 왜 해시 분반이 아니라 순위 블록인가:
#   - 친구·팔로우 모델 신설이 금지(§2.8)라 소속의 근거로 쓸 관계 데이터가 없다.
#   - 결정적 해시는 실력이 뒤섞여 "3점만 더 올리면 위로" 같은 격차 표시가 무의미해진다.
#   - ELO 구간(티어) 분할은 인원이 균등하지 않아 "기본 30인" 계약을 만족하지 못한다.
#   - 순위 블록은 (a) 분반 크기가 정확히 보장되고(마지막 분반만 잔여), (b) 이웃이
#     실력이 가장 가까운 사람이라 격차 표시가 행동으로 이어지며, (c) 신규 모델·
#     신규 컬럼이 0이다(정렬은 이미 /leaderboard가 하고 있다).
# 대가: 소속이 주중 점수 변동에 따라 바뀐다. 정산이 주 1회이고 accuracy_score는
# 정산 전 NULL이라 실제 변동은 정산 시점 1회다 — 감수 가능하다고 판단했다.
#
# 결정성: 정렬 마지막 키로 user_id를 넣어 동점자 순서를 고정한다(§2.8이 요구하는
# "내 분반"이 요청마다 달라지지 않게 하는 최소 조건 — ranked_leaderboard가 소유).
DIVISION_SIZE: int = settings.LEAGUE_DIVISION_SIZE
NEIGHBOR_SPAN: int = settings.LEAGUE_NEIGHBOR_SPAN


def division_index_of(rank: int, size: int | None = None) -> int:
    """1-based 전역 순위 → 0-based 분반 번호 (순수 함수)."""
    size = size or DIVISION_SIZE
    return (rank - 1) // size


def division_count_of(total: int, size: int | None = None) -> int:
    """참가자 수 → 분반 개수. 참가자 0명이어도 1(빈 분반 0번) (순수 함수)."""
    size = size or DIVISION_SIZE
    return max(1, -(-total // size))


def _gap(higher: Any, lower: Any) -> Any | None:
    """두 accuracy_score의 격차. 한쪽이라도 미정산(None)이면 None."""
    if higher is None or lower is None:
        return None
    return higher - lower


def build_division_view(
    ranked: Sequence[dict],
    user_id: uuid.UUID | None,
    size: int | None = None,
    span: int | None = None,
) -> dict:
    """전역 정렬된 주간 순위 → 내 분반 + 이웃 격차 (순수 함수, §2.8).

    ranked: 전역 순위 오름차순(1등이 index 0)의 dict 목록.
        각 원소는 {"user_id", "nickname", "accuracy_score", "elo_rating", "tier"}.
    user_id: 조회자. 이번 주 미참가(목록에 없음)면 0번 분반 상단을 미리보기로 준다
        — my_rank·격차는 None이고 is_me는 전부 False다.
    span: 이웃 범위. entries는 나를 중심으로 위·아래 각 span명(최대 2*span+1명)이며
        분반 경계에서 잘린다(반대쪽으로 늘려 채우지 않는다 — 순위 창이 분반을
        넘지 않는다는 성질이 더 중요하다).

    반환 dict의 rank는 **분반 내 지역 순위**(1부터), global_rank는 전역 순위다.
    """
    size = size or DIVISION_SIZE
    span = NEIGHBOR_SPAN if span is None else span

    total = len(ranked)
    me_index = next(
        (i for i, row in enumerate(ranked) if row["user_id"] == user_id), None
    )
    index = 0 if me_index is None else me_index // size
    start = index * size
    members = list(ranked[start : start + size])

    local = None if me_index is None else me_index - start
    # 미참가 미리보기는 분반 상단(0번 자리 기준)과 같은 크기의 창을 보여준다.
    window_start = 0 if local is None else max(0, local - span)
    window_end = (2 * span + 1) if local is None else (local + span + 1)
    window = members[window_start:window_end]

    entries = [
        {
            **row,
            "rank": window_start + offset + 1,
            "global_rank": start + window_start + offset + 1,
            "is_me": local is not None and window_start + offset == local,
        }
        for offset, row in enumerate(window)
    ]

    my_score = members[local]["accuracy_score"] if local is not None else None
    return {
        "division_size": size,
        "division_index": index,
        "division_count": division_count_of(total, size),
        "division_member_count": len(members),
        "total_participants": total,
        "my_rank": None if local is None else local + 1,
        "my_global_rank": None if me_index is None else me_index + 1,
        "gap_above": (
            _gap(members[local - 1]["accuracy_score"], my_score)
            if local is not None and local > 0
            else None
        ),
        "gap_below": (
            _gap(my_score, members[local + 1]["accuracy_score"])
            if local is not None and local + 1 < len(members)
            else None
        ),
        "entries": entries,
    }


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

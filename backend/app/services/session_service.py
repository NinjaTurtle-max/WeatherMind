"""일일 세션 발급 서비스 — 스프린트 R2-01 §3.1~§3.3 (S1·S2·S3).

배합 규칙 (§3.2 → R11-01 §9.2 → R13-01 §2.10 개정):
recipe {"new": 5, "review": 4, "live": 1, "unit": 5} 합계 15문항.
- new: 뱅크 active 문항 중 해당 유저 미출제분 (level_group 일치, 슬롯 문항 제외)
- review: θ 파생 약점 개념(weatherbrain_service.weak_concepts — 학령 상대 임계,
  R8-01 §3.5) 태그의 뱅크 문항 우선, 없으면 new로 대체
- live: uses_live_slots=true 문항 + {today.*} 슬롯을 Redis weather 캐시 값으로 치환,
  치환 불가(문항 없음·날씨 값 부재) 시 기존 quiz-generate 폴백
- unit(진도 블록, R13-01 §2.10): **현재 진행 유닛의 다음 진도** 5문항을 세션
  마지막에 덧붙인다(기존 3종을 대체하지 않는다). 풀은 curriculum_service의
  `progress_block_pool`(= `_unit_content_pool` 재사용) — 유닛 잔여가 5 미만이면
  다음 열린 유닛으로 이어지고, 그래도 모자라면 부족분을 new로 메워 총합 15를 지킨다.
- 뱅크 부족분은 ai-worker quiz-generate 폴백 (현행 /quiz/today 경로와 동일).
  폴백은 asyncio.gather 병렬 실행 — 개별 실패는 수집·로깅하고 성공분으로 세션을
  구성하며, 전부 실패 시에만 AIWorkerError(→503)를 낸다 (웨이브 1 리뷰 3번.
  부분 세션(배합 총합 미만) 허용 여부는 R3 검토 — §5 기술 부채)
- 같은 question_type 3연속 금지 (enforce_type_variety)
- recipe와 router-decide 결과는 sessions 행 JSONB에 저장 (route 미로깅 부채 상환)

구조적 결정: 배합(plan_bank_picks)·순서(enforce_type_variety)·슬롯 추출/치환
(extract_slot_values, fill_live_slots)은 DB 의존이 없는 순수 함수로 분리해
pytest가 DB 없이 검증한다 (TEAM_PROCESS §1.2 테스트 피라미드).
new/review 풀에서 슬롯 문항을 제외하는 이유: 슬롯 치환 없이 서빙되면
"{today.temp_max}" 원문이 유저에게 노출되기 때문 (live 슬롯 전용 풀로만 사용).
"""
import asyncio
import copy
import logging
import re
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Callable, Sequence

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.item_param import ItemParam
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.models.weak_tag import WeakTag
from app.services import ai_client, weather_api, weatherbrain_service
from app.services.ai_client import AIWorkerError
from app.services.weather_api import KST, SKY_TEXT, get_today_weather, user_region

logger = logging.getLogger(__name__)

# ── 배합 계약 (§3.2) ── 기본값은 settings(env 튜닝, R5.5). SESSION_SIZE는 합에서 파생.
DEFAULT_RECIPE = settings.SESSION_RECIPE
SESSION_SIZE = sum(DEFAULT_RECIPE.values())
# new 풀 조회 한도 — new는 review·unit 부족분의 대체 공급원이라(§3.2·R13-01 §2.10)
# 최악의 수요가 세 블록의 합이다. 이보다 작으면 뱅크에 문항이 있어도 부족분이
# quiz-generate 폴백으로 새어 비용이 된다.
NEW_POOL_LIMIT = (
    DEFAULT_RECIPE.get("new", 0)
    + DEFAULT_RECIPE.get("review", 0)
    + DEFAULT_RECIPE.get("unit", 0)
)
MODE_DAILY = "daily"

# ── 실황 슬롯 (§3.3 허용 5종) ──
ALLOWED_SLOTS = (
    "today.temp_max",
    "today.temp_min",
    "today.sky",
    "today.rain_prob",
    "today.region",
)
SLOT_RE = re.compile(r"\{(today\.[a-z_]+)\}")
# SKY_TEXT는 KMA 도메인 소유자 weather_api에서 import (중복 정의 제거, R5.5).


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB·네트워크 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def _fmt_num(value: float) -> str:
    """28.0 → '28', 27.5 → '27.5' (문항 텍스트 자연스러움)."""
    number = float(value)
    return str(int(number)) if number.is_integer() else str(round(number, 1))


def extract_slot_values(weather: dict) -> dict[str, str]:
    """weather 캐시(get_short_forecast 반환 형식)에서 §3.3 슬롯 값을 추출한다.

    - temp_max/temp_min: TMX/TMN(일 1회 값) 우선, 없으면 TMP의 최대/최소
    - rain_prob: POP 최대값
    - sky: 시간대별 SKY 최빈값 → 맑음/구름많음/흐림
    값을 구할 수 없는 슬롯은 결과 dict에서 빠진다 (호출측이 폴백 판단).
    """
    values: dict[str, str] = {}
    region = weather.get("region")
    if region:
        values["today.region"] = str(region)

    forecasts = weather.get("forecasts") or []

    temp_max = weather_api.forecast_temp_max(forecasts)
    if temp_max is not None:
        values["today.temp_max"] = _fmt_num(temp_max)

    tmn = weather_api.forecast_numbers(forecasts, "TMN")
    tmp = weather_api.forecast_numbers(forecasts, "TMP")
    if tmn:
        values["today.temp_min"] = _fmt_num(tmn[0])
    elif tmp:
        values["today.temp_min"] = _fmt_num(min(tmp))

    pop = weather_api.forecast_numbers(forecasts, "POP")
    if pop:
        values["today.rain_prob"] = _fmt_num(max(pop))

    sky = weather_api.forecast_numbers(forecasts, "SKY")
    if sky:
        most_common = Counter(int(v) for v in sky).most_common(1)[0][0]
        values["today.sky"] = SKY_TEXT.get(most_common, "맑음")

    return values


def fill_live_slots(
    template_json: dict[str, Any], slot_values: dict[str, str]
) -> tuple[dict[str, Any], bool]:
    """template_json의 문자열 필드에서 {today.*} 슬롯을 실황 값으로 치환한다.

    question_text·options·correct_answer 등 모든 문자열 필드를 재귀 치환한다
    (예: 슬라이더 정답이 {today.rain_prob}인 문항).
    반환: (치환된 사본, 모든 슬롯이 값으로 치환되었는지 — False면 호출측이
    quiz-generate 폴백해 미치환 원문이 유저에게 노출되지 않게 한다)
    """
    ok = True

    def render(value: Any) -> Any:
        if isinstance(value, str):
            def repl(match: re.Match) -> str:
                nonlocal ok
                key = match.group(1)
                if key in slot_values:
                    return slot_values[key]
                ok = False
                return match.group(0)

            return SLOT_RE.sub(repl, value)
        if isinstance(value, list):
            return [render(v) for v in value]
        if isinstance(value, dict):
            return {k: render(v) for k, v in value.items()}
        return value

    return render(copy.deepcopy(template_json)), ok


def _item_id(item: Any) -> Any:
    return item["id"] if isinstance(item, dict) else item.id


def plan_bank_picks(
    new_pool: Sequence[Any],
    review_pool: Sequence[Any],
    live_pool: Sequence[Any],
    recipe: dict[str, int] | None = None,
    unit_pool: Sequence[Any] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """뱅크 후보 풀에서 §3.2 배합대로 선택한다 (순수 함수 — 풀은 랜덤 정렬 전제).

    - review 부족분은 new 풀에서 대체 (§3.2 "없으면 new로 대체")
    - unit(진도 블록, R13-01 §2.10) 부족분도 같은 선례로 new 풀에서 대체 —
      열린 유닛이 없거나(신규 유저) 유닛 잔여가 5 미만이어도 총합은 배합 합계다.
    - 같은 문항 중복 선택 금지 (id 기준 — new/review/unit 풀이 겹칠 수 있음).
      **블록 간 중복 차단은 picked_ids 하나가 전담**한다: 신규 5와 유닛 5가 같은
      뱅크에서 뽑혀도 같은 문항이 두 번 나오지 않는다.
    반환: (picks: [{"kind": "new"|"review"|"live"|"unit", "item": ...}],
           generate_count — 뱅크가 못 채운 폴백 생성 문항 수)
    """
    recipe = recipe or DEFAULT_RECIPE
    picked_ids: set[Any] = set()

    def take(pool: Sequence[Any], count: int, kind: str) -> list[dict[str, Any]]:
        taken: list[dict[str, Any]] = []
        for item in pool:
            if len(taken) >= count:
                break
            item_id = _item_id(item)
            if item_id in picked_ids:
                continue
            picked_ids.add(item_id)
            taken.append({"kind": kind, "item": item})
        return taken

    picks = take(new_pool, recipe["new"], "new")
    review_picks = take(review_pool, recipe["review"], "review")
    review_picks += take(new_pool, recipe["review"] - len(review_picks), "new")
    picks += review_picks
    picks += take(live_pool, recipe["live"], "live")

    unit_count = recipe.get("unit", 0)
    if unit_count:
        unit_picks = take(unit_pool or (), unit_count, "unit")
        unit_picks += take(new_pool, unit_count - len(unit_picks), "new")
        picks += unit_picks

    total = sum(recipe.values())
    return picks, total - len(picks)


def pool_level_groups(user_level_group: str, theta: float | None) -> list[str]:
    """뱅크 풀 level_group 필터 집합 (R7 §3.2 — θ→출제 난이도 연결).

    θ가 있으면 가입 그룹 ∪ θ 매핑 그룹(theta_to_level_group) — θ가 가입 학령을
    넘어서면 더 어려운(또는 쉬운) 그룹의 문항이 풀에 들어온다. θ None(콜드스타트)
    이면 기존과 동일하게 가입 그룹 하나만(동작 불변).
    """
    if theta is None:
        return [user_level_group]
    return sorted(
        {user_level_group, weatherbrain_service.theta_to_level_group(theta)}
    )


def kst_day_start_utc(day: date) -> datetime:
    """`day`(KST 달력일) 00:00 KST에 해당하는 UTC 시각 — R10-01 D2.

    세션 발급이 하루를 `datetime.now(KST).date()`로 정의하므로(session.py ·
    curriculum.py) 당일 중복 제외 경계도 같은 기준이어야 한다. UTC 자정을 쓰면
    KST 00:00~09:00 응답이 "어제"로 새어 중복 방지가 그 구간에서 무력해진다.
    반환값은 timestamptz 비교에 안전하도록 UTC로 정규화된 tz-aware datetime.
    """
    return datetime(day.year, day.month, day.day, tzinfo=KST).astimezone(timezone.utc)


def answered_today_subq(user_id: uuid.UUID, day_start_utc: datetime):
    """"오늘 이미 응답한 content_item_id" SELECT 구성 (실행 없음) — R10-01 D2.

    review·live 풀의 `NOT IN` 제외 대상. new 풀의 전기간 served 제외와 달리
    `answered_at >= day_start_utc`로 당일에 한정한다 — 복습·실황 문항은 다음
    날부터 재출제되는 것이 정상이고, 전기간 제외는 풀을 영구 고갈시킨다.
    `content_item_id IS NOT NULL` 조건은 필수다: NULL이 섞이면 SQL `NOT IN`이
    전건 UNKNOWN → false가 되어 풀이 통째로 비워진다(생성 문항·보드 로그는
    content_item_id가 NULL).
    """
    return select(QuizLog.content_item_id).where(
        QuizLog.user_id == user_id,
        QuizLog.content_item_id.is_not(None),
        QuizLog.answered_at >= day_start_utc,
    )


def build_pool_query(
    *,
    level_groups: Sequence[str],
    theta: float | None,
    live: bool,
    served_subq: Any | None = None,
    weak_concepts: Sequence[str] | None = None,
    limit: int,
):
    """new/review/live 풀 SELECT 구성 — 실행 없는 순수 구성이라 DB 없이 검증 가능.

    θ가 있으면 item_params를 outerjoin해 `abs(coalesce(보정 b, 사전 b CASE) − θ)`
    오름차순(동률은 random)으로 정렬한다 — θ에 가장 알맞은 난이도의 문항부터.
    사전 b CASE는 weatherbrain_service.LEVEL_GROUP_ITEM_B(ai-worker priors와
    동일값 — 계약 테스트 감시). θ None이면 기존 그대로 random 정렬만.
    """
    stmt = select(ContentItem)
    if theta is not None:
        stmt = stmt.outerjoin(
            ItemParam, ItemParam.content_item_id == ContentItem.id
        )
    stmt = stmt.where(
        ContentItem.status == "active",
        ContentItem.level_group.in_(list(level_groups)),
        ContentItem.uses_live_slots.is_(live),
    )
    if served_subq is not None:
        stmt = stmt.where(ContentItem.id.not_in(served_subq))
    if weak_concepts is not None:
        stmt = stmt.where(ContentItem.concept_tag.in_(list(weak_concepts)))
    if theta is None:
        return stmt.order_by(func.random()).limit(limit)
    prior_b = case(
        *(
            (ContentItem.level_group == lg, b)
            for lg, b in weatherbrain_service.LEVEL_GROUP_ITEM_B.items()
        ),
        else_=weatherbrain_service.DEFAULT_ITEM_B,
    )
    difficulty_distance = func.abs(func.coalesce(ItemParam.b, prior_b) - theta)
    return stmt.order_by(difficulty_distance, func.random()).limit(limit)


def enforce_type_variety(
    items: Sequence[Any],
    type_of: Callable[[Any], Any] | None = None,
) -> list[Any]:
    """같은 question_type 3연속 금지 (§3.2) — 위반 지점을 뒤쪽의 다른 유형과 교환.

    구성상 불가능하면(예: 전 문항 동일 유형) 원 순서를 유지한다.
    """
    key = type_of or (lambda q: q.get("question_type"))
    result = list(items)
    for i in range(2, len(result)):
        if key(result[i]) == key(result[i - 1]) == key(result[i - 2]):
            for j in range(i + 1, len(result)):
                if key(result[j]) != key(result[i]):
                    result[i], result[j] = result[j], result[i]
                    break
    return result


# ═══════════════════════════════════════════════════════════════
# DB·외부 서비스 결합부
# ═══════════════════════════════════════════════════════════════


async def _load_weak_tag_rows(db: AsyncDBSession, user: User) -> list[WeakTag]:
    """유저의 weak_tags 전체 행 — decide_route와 review 풀 구성이 공유 (리뷰 6번)."""
    return list(
        (await db.execute(select(WeakTag).where(WeakTag.user_id == user.id)))
        .scalars()
        .all()
    )


async def decide_route(
    db: AsyncDBSession,
    user: User,
    weak_tag_rows: list[WeakTag] | None = None,
    abilities: list[dict] | None = None,
) -> dict:
    """weak_tags + 최근 정오답 + θ로 Router Chain 분기 (실패 시 general).

    routers/quiz.py에 있던 _decide_route를 세션 발급(S1)과 공유하도록 이동.
    weak_tag_rows를 넘기면 재조회를 생략한다 (세션 발급이 이미 조회한 결과 재사용).
    abilities도 같은 전례 — 넘기면 refresh_abilities를 생략한다 (세션 발급이
    이미 재추정한 θ 재사용, 이중 refresh 금지 — R7 §3.2). None이면 현행처럼
    내부에서 재추정한다 (quiz.py 등 레거시 호출부 하위 호환).
    """
    tags = (
        weak_tag_rows
        if weak_tag_rows is not None
        else await _load_weak_tag_rows(db, user)
    )
    weak_tags = [
        {"concept_tag": t.concept_tag, "accuracy_rate": float(t.accuracy_rate or 0)}
        for t in tags
        if t.total_count
    ]
    recent = (
        (
            await db.execute(
                select(QuizLog.is_correct)
                .where(QuizLog.user_id == user.id, QuizLog.is_correct.is_not(None))
                .order_by(QuizLog.answered_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    recent_results = [bool(v) for v in reversed(recent)]  # 시간순(과거 → 최근)
    # R6 WeatherBrain: 누적 응답으로 θ 재추정·영속화 후 Router 1순위 신호로 공급.
    # 실패해도 refresh_abilities가 저장된 θ(또는 빈 리스트)로 폴백 → 세션 발급 계속.
    if abilities is None:
        abilities = await weatherbrain_service.refresh_abilities(db, user)
    return await ai_client.router_decide(
        str(user.id), weak_tags, recent_results, abilities
    )


async def _fetch_pools(
    db: AsyncDBSession,
    user: User,
    weak_concepts: Sequence[str],
    theta: float | None = None,
) -> tuple[list[ContentItem], list[ContentItem], list[ContentItem]]:
    """new/review/live 후보 풀 조회 (active + level_group, θ 난이도 정렬).

    weak_concepts는 호출측이 θ(refresh_abilities 결과)에서 산출해 넘긴다
    (weatherbrain_service.weak_concepts — θ 파생 단일 공급원, R8-01 §3.5).
    theta는 호출측이 refresh_abilities 결과에서 산출해 넘긴다 (R7 §3.2 —
    풀 그룹 확장 + |b−θ| 정렬은 build_pool_query·pool_level_groups 참조.
    None이면 기존 단일 그룹·random 정렬 그대로 — 콜드스타트 동작 불변).
    풀 크기는 배합 요구량보다 넉넉히(new NEW_POOL_LIMIT · review 10 · live 5)
    가져와 중복 제거·치환 실패 시의 여유분으로 쓴다. new 한도가 배합에서 파생되는
    이유(R13-01 §2.10): new는 review·unit 부족분의 **대체 공급원**이라 최악의
    수요가 new+review+unit이다 — 10으로 고정하면 유닛·복습 풀이 빈 유저에게
    부족분 4건이 매 세션 quiz-generate로 새고, 그건 곧 상시 과금이다.

    중복 방지 (R10-01 D2): new는 **전기간** served 제외(한 번 본 문항은 다시
    '신규'가 아니다), review·live는 **당일** 제외(answered_today_subq) —
    배치고사 직후 첫 세션이 방금 푼 문항을 재출제하던 P0의 직접 원인이 두 풀에
    제외가 전달되지 않은 것이었다.
    """
    served_subq = select(QuizLog.content_item_id).where(
        QuizLog.user_id == user.id, QuizLog.content_item_id.is_not(None)
    )
    today_subq = answered_today_subq(
        user.id, kst_day_start_utc(datetime.now(KST).date())
    )
    groups = pool_level_groups(user.level_group, theta)

    new_pool = (
        (
            await db.execute(
                build_pool_query(
                    level_groups=groups,
                    theta=theta,
                    live=False,
                    served_subq=served_subq,
                    limit=NEW_POOL_LIMIT,
                )
            )
        )
        .scalars()
        .all()
    )

    review_pool: list[ContentItem] = []
    if weak_concepts:
        review_pool = (
            (
                await db.execute(
                    build_pool_query(
                        level_groups=groups,
                        theta=theta,
                        live=False,
                        served_subq=today_subq,
                        weak_concepts=weak_concepts,
                        limit=10,
                    )
                )
            )
            .scalars()
            .all()
        )

    live_pool = (
        (
            await db.execute(
                build_pool_query(
                    level_groups=groups,
                    theta=theta,
                    live=True,
                    served_subq=today_subq,
                    limit=5,
                )
            )
        )
        .scalars()
        .all()
    )
    return list(new_pool), list(review_pool), list(live_pool)


async def _fetch_unit_pool(
    db: AsyncDBSession, user: User, abilities: list, count: int
) -> tuple[list[ContentItem], Any | None]:
    """진도 블록(§2.10) 후보 풀 — curriculum_service.progress_block_pool 위임.

    curriculum_service가 session_service를 import하므로(풀 쿼리 재사용) 여기서는
    **함수 안에서 지연 import**한다 — 모듈 최상단에 두면 순환 import가 된다.
    반환: (문항 목록, 블록 유닛 or None). count<=0이면 조회 없이 빈 결과.
    """
    if count <= 0:
        return [], None
    from app.services import curriculum_service

    return await curriculum_service.progress_block_pool(
        db, user, abilities, count=count
    )


async def allocate_quiz_ids(
    db: AsyncDBSession, user_id: uuid.UUID, today_str: str, count: int
) -> list[str]:
    """오늘자 quiz_id 채번 — {YYYYMMDD}-{seq:03d} (리뷰 7번: quiz.py와 공용 헬퍼).

    유저의 오늘자 기존 발급 수를 세어 이어서 count개를 부여한다
    (기존 /quiz/today 채번 규칙 그대로).
    """
    existing = (
        await db.execute(
            select(func.count())
            .select_from(QuizLog)
            .where(QuizLog.user_id == user_id, QuizLog.quiz_id.like(f"{today_str}-%"))
        )
    ).scalar_one()
    return [f"{today_str}-{existing + 1 + offset:03d}" for offset in range(count)]


async def create_daily_session(
    db: AsyncDBSession, user: User, today: date | None = None
) -> tuple[Session, list[dict[str, Any]]]:
    """오늘의 daily 세션을 새로 발급한다 (§3.1 GET /today 신규 경로).

    반환: (Session 행, entries — [{"quiz_id", "question", "source", "slot_filled"}]).
    뱅크 0건이어도 quiz-generate 폴백으로 배합 총합(기본 10문항)을 채운다 (S2 AC).
    생성 폴백이 부분 실패하면 성공분으로 세션을 구성하고,
    전부 실패 시에만 AIWorkerError 전파 (라우터에서 503 처리).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    # weak_tags 조회는 라우터 폴백 payload 전용으로만 남는다 (decide_route —
    # ai-worker 장애 복원력 유지, R8-01 §3.5).
    weak_rows = await _load_weak_tag_rows(db, user)
    # θ 재추정도 정확히 1회 — 분기(decide_route)와 풀 난이도(_fetch_pools)·
    # quiz-generate 난이도가 공유한다 (weak_tag_rows 재사용과 같은 전례, R7 §3.2).
    abilities = await weatherbrain_service.refresh_abilities(db, user)
    route_decision = await decide_route(db, user, weak_rows, abilities=abilities)
    # review 풀의 약점 개념은 θ 파생 단일 공급원 (R8-01 §3.5, 학령 상대 임계)
    weak_concepts = weatherbrain_service.weak_concepts(abilities, user.level_group)

    # 실황은 유저 지역 기준 (R11-01 §8.2 — NULL=서울). 캐시 키(weather:{date}:{region})가
    # 지역별로 갈리므로 today.* 슬롯·생성 폴백 weather_data가 함께 지역화된다.
    weather = await get_today_weather(user_region(user))
    slot_values = extract_slot_values(weather)

    # 대표 θ — route 목표 개념 우선, 없으면 가중 평균 (콜드스타트면 None)
    theta = weatherbrain_service.overall_theta(
        abilities, route_decision.get("target_concept_tag")
    )
    new_pool, review_pool, live_pool = await _fetch_pools(
        db, user, weak_concepts, theta=theta
    )
    # 진도 블록(R13-01 §2.10) — 현재 진행 유닛의 다음 문항. 열린 유닛이 없으면
    # 빈 풀이고 부족분은 plan_bank_picks가 new로 메운다(총합 불변).
    unit_pool, block_unit = await _fetch_unit_pool(
        db, user, abilities, DEFAULT_RECIPE.get("unit", 0)
    )
    picks, generate_count = plan_bank_picks(
        new_pool, review_pool, live_pool, unit_pool=unit_pool
    )

    entries: list[dict[str, Any]] = []
    for pick in picks:
        item: ContentItem = pick["item"]
        template = dict(item.template_json or {})
        slot_filled = False
        if pick["kind"] == "live":
            rendered, ok = fill_live_slots(template, slot_values)
            if not ok:
                # 날씨 값 부재 → 미치환 원문 노출 방지, 생성 폴백 (§3.2 live)
                logger.warning(
                    "live 슬롯 치환 실패 (item=%s) — quiz-generate 폴백", item.id
                )
                generate_count += 1
                continue
            template, slot_filled = rendered, True
        question = {
            **template,
            "concept_tag": item.concept_tag,
            "question_type": item.question_type,
        }
        entries.append(
            {
                "question": question,
                "source": "bank",
                "slot_filled": slot_filled,
                "content_item_id": item.id,
                "kind": pick["kind"],
            }
        )

    # 뱅크 부족분 — 현행 quiz-generate 경로로 병렬 폴백 (S2, 리뷰 3번)
    if generate_count:
        # 생성 난이도도 θ를 따른다 (R7 §3.2 — API 계약 무변경, 값만 θ 매핑)
        generate_level_group = (
            weatherbrain_service.theta_to_level_group(theta)
            if theta is not None
            else user.level_group
        )
        results = await asyncio.gather(
            *(
                ai_client.quiz_generate(
                    weather_data=weather,
                    level_group=generate_level_group,
                    route=route_decision.get("route", "general"),
                    target_concept_tag=route_decision.get("target_concept_tag"),
                )
                for _ in range(generate_count)
            ),
            return_exceptions=True,
        )
        generated = [r for r in results if not isinstance(r, BaseException)]
        for exc in (r for r in results if isinstance(r, BaseException)):
            logger.warning("quiz-generate 폴백 실패 (수집): %s", exc)
        if not generated:
            # 전부 실패 — 기존과 동일한 실패 의미론 (라우터에서 503 변환)
            raise AIWorkerError(
                f"quiz-generate 폴백 전부 실패 ({generate_count}건)"
            )
        for question in generated:
            entries.append(
                {
                    "question": question,
                    "source": "generated",
                    "slot_filled": False,
                    "content_item_id": None,
                    # 생성 폴백은 어느 블록의 부족분인지 구분이 없다 — "오늘의 발견"
                    # (new)으로 표기한다. 진도(unit)로 새면 왕관 판정 대상이 뱅크
                    # 유닛 문항이 아닌 것까지 포함되므로 절대 unit을 붙이지 않는다.
                    "kind": "new",
                }
            )

    # 같은 question_type 3연속 금지 (§3.2) — 단, 진도 블록(§2.10)은 **세션 끝에
    # 붙어 있는 것 자체가 계약**("마지막 5문항 = 내 진도")이라 두 구간을 각각
    # 정렬해 경계를 보존한다. 한 리스트로 섞으면 교환이 블록을 가로질러 진도가
    # 세션 중간으로 흩어진다.
    def _variety(block: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return enforce_type_variety(
            block, type_of=lambda e: e["question"].get("question_type")
        )

    entries = _variety([e for e in entries if e["kind"] != "unit"]) + _variety(
        [e for e in entries if e["kind"] == "unit"]
    )

    session = Session(
        user_id=user.id,
        session_date=today,
        mode=MODE_DAILY,
        route_decision=route_decision,
    )
    db.add(session)
    await db.flush()  # session.id 확보

    quiz_ids = await allocate_quiz_ids(db, user.id, today_str, len(entries))
    for quiz_id, entry in zip(quiz_ids, entries):
        entry["quiz_id"] = quiz_id
        db.add(
            QuizLog(
                user_id=user.id,
                quiz_id=quiz_id,
                session_id=session.id,
                content_item_id=entry["content_item_id"],
                concept_tag=entry["question"].get("concept_tag", "pressure_front"),
                question_type=entry["question"].get("question_type"),
                question_json=entry["question"],
            )
        )

    # recipe + 발급 문항 메타 저장 (§3.2 — 멱등 재조회 시 source/slot_filled 복원용).
    # kind(R13-01 §2.10)는 완료 화면 블록 표기("오늘의 발견/복습/실황/진도")와
    # **왕관 판정 범위**(진도 블록 5문항)의 유일한 근거다 — 세션 행에 남겨야
    # 멱등 재조회·complete 시점에도 블록 구분이 복원된다.
    session.recipe_json = {
        "recipe": DEFAULT_RECIPE,
        "generated_count": sum(1 for e in entries if e["source"] == "generated"),
        # 진도 블록 유닛 — 왕관 대상 선정(kind)에 쓴다. 열린 유닛이 없으면 None.
        "unit_block": (
            {
                "unit_id": str(block_unit.id),
                "unit_slug": block_unit.slug,
                "kind": block_unit.kind,
            }
            if block_unit is not None
            and any(e["kind"] == "unit" for e in entries)
            else None
        ),
        "items": [
            {
                "quiz_id": e["quiz_id"],
                "source": e["source"],
                "slot_filled": e["slot_filled"],
                "kind": e["kind"],
            }
            for e in entries
        ],
    }
    await db.flush()
    return session, entries

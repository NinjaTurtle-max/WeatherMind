"""일일 세션 발급 서비스 — 스프린트 R2-01 §3.1~§3.3 (S1·S2·S3).

배합 규칙 (§3.2): recipe {"new": 2, "review": 2, "live": 1} 합계 5문항.
- new: 뱅크 active 문항 중 해당 유저 미출제분 (level_group 일치, 슬롯 문항 제외)
- review: weak_tags accuracy_rate < 60 태그의 뱅크 문항 우선, 없으면 new로 대체
- live: uses_live_slots=true 문항 + {today.*} 슬롯을 Redis weather 캐시 값으로 치환,
  치환 불가(문항 없음·날씨 값 부재) 시 기존 quiz-generate 폴백
- 뱅크 부족분은 ai-worker quiz-generate 폴백 (현행 /quiz/today 경로와 동일).
  폴백은 asyncio.gather 병렬 실행 — 개별 실패는 수집·로깅하고 성공분으로 세션을
  구성하며, 전부 실패 시에만 AIWorkerError(→503)를 낸다 (웨이브 1 리뷰 3번.
  부분 세션(5문항 미만) 허용 여부는 R3 검토 — §5 기술 부채)
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
from datetime import date, datetime
from typing import Any, Callable, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.models.weak_tag import WeakTag
from app.services import ai_client
from app.services.ai_client import AIWorkerError
from app.services.weather_api import KST, SKY_TEXT, get_today_weather

# 약점 분기 임계값 — xp_service와 단일 공급원 공유 (웨이브 1 리뷰 6번)
from app.services.xp_service import WEAK_ACCURACY_THRESHOLD

logger = logging.getLogger(__name__)

# ── 배합 계약 (§3.2) ── 기본값은 settings(env 튜닝, R5.5). SESSION_SIZE는 합에서 파생.
DEFAULT_RECIPE = settings.SESSION_RECIPE
SESSION_SIZE = sum(DEFAULT_RECIPE.values())
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

    def _numbers(category: str) -> list[float]:
        return [
            float(f[category])
            for f in forecasts
            if isinstance(f.get(category), (int, float))
        ]

    tmx, tmn, tmp = _numbers("TMX"), _numbers("TMN"), _numbers("TMP")
    if tmx:
        values["today.temp_max"] = _fmt_num(tmx[0])
    elif tmp:
        values["today.temp_max"] = _fmt_num(max(tmp))
    if tmn:
        values["today.temp_min"] = _fmt_num(tmn[0])
    elif tmp:
        values["today.temp_min"] = _fmt_num(min(tmp))

    pop = _numbers("POP")
    if pop:
        values["today.rain_prob"] = _fmt_num(max(pop))

    sky = _numbers("SKY")
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
) -> tuple[list[dict[str, Any]], int]:
    """뱅크 후보 풀에서 §3.2 배합대로 선택한다 (순수 함수 — 풀은 랜덤 정렬 전제).

    - review 부족분은 new 풀에서 대체 (§3.2 "없으면 new로 대체")
    - 같은 문항 중복 선택 금지 (id 기준 — new/review 풀이 겹칠 수 있음)
    반환: (picks: [{"kind": "new"|"review"|"live", "item": ...}],
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

    total = sum(recipe.values())
    return picks, total - len(picks)


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
    db: AsyncDBSession, user: User, weak_tag_rows: list[WeakTag] | None = None
) -> dict:
    """weak_tags + 최근 정오답으로 Router Chain 분기 (실패 시 general).

    routers/quiz.py에 있던 _decide_route를 세션 발급(S1)과 공유하도록 이동.
    weak_tag_rows를 넘기면 재조회를 생략한다 (세션 발급이 이미 조회한 결과 재사용).
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
    return await ai_client.router_decide(str(user.id), weak_tags, recent_results)


async def _fetch_pools(
    db: AsyncDBSession, user: User, weak_concepts: Sequence[str]
) -> tuple[list[ContentItem], list[ContentItem], list[ContentItem]]:
    """new/review/live 후보 풀 조회 (active + level_group 일치, 랜덤 정렬).

    weak_concepts는 호출측이 weak_tags 조회 결과에서 산출해 넘긴다
    (accuracy_rate < 60 — 중복 SELECT 방지, 리뷰 6번).
    풀 크기는 배합 요구량보다 넉넉히(new 10 · review 10 · live 5) 가져와
    중복 제거·치환 실패 시의 여유분으로 쓴다.
    """
    served_subq = select(QuizLog.content_item_id).where(
        QuizLog.user_id == user.id, QuizLog.content_item_id.is_not(None)
    )
    base_filter = (
        (ContentItem.status == "active")
        & (ContentItem.level_group == user.level_group)
    )

    new_pool = (
        (
            await db.execute(
                select(ContentItem)
                .where(
                    base_filter,
                    ContentItem.uses_live_slots.is_(False),
                    ContentItem.id.not_in(served_subq),
                )
                .order_by(func.random())
                .limit(10)
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
                    select(ContentItem)
                    .where(
                        base_filter,
                        ContentItem.uses_live_slots.is_(False),
                        ContentItem.concept_tag.in_(list(weak_concepts)),
                    )
                    .order_by(func.random())
                    .limit(10)
                )
            )
            .scalars()
            .all()
        )

    live_pool = (
        (
            await db.execute(
                select(ContentItem)
                .where(base_filter, ContentItem.uses_live_slots.is_(True))
                .order_by(func.random())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    return list(new_pool), list(review_pool), list(live_pool)


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
    뱅크 0건이어도 quiz-generate 폴백으로 5문항을 채운다 (S2 AC).
    생성 폴백이 부분 실패하면 성공분으로 세션을 구성하고,
    전부 실패 시에만 AIWorkerError 전파 (라우터에서 503 처리).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    # weak_tags는 한 번만 조회 — 분기와 review 풀 구성이 공유 (리뷰 6번)
    weak_rows = await _load_weak_tag_rows(db, user)
    route_decision = await decide_route(db, user, weak_rows)
    weak_concepts = [
        row.concept_tag
        for row in weak_rows
        if row.total_count
        and row.accuracy_rate is not None
        and row.accuracy_rate < WEAK_ACCURACY_THRESHOLD
    ]

    weather = await get_today_weather()
    slot_values = extract_slot_values(weather)

    new_pool, review_pool, live_pool = await _fetch_pools(db, user, weak_concepts)
    picks, generate_count = plan_bank_picks(new_pool, review_pool, live_pool)

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
            }
        )

    # 뱅크 부족분 — 현행 quiz-generate 경로로 병렬 폴백 (S2, 리뷰 3번)
    if generate_count:
        results = await asyncio.gather(
            *(
                ai_client.quiz_generate(
                    weather_data=weather,
                    level_group=user.level_group,
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
                }
            )

    # 같은 question_type 3연속 금지 (§3.2)
    entries = enforce_type_variety(
        entries, type_of=lambda e: e["question"].get("question_type")
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

    # recipe + 발급 문항 메타 저장 (§3.2 — 멱등 재조회 시 source/slot_filled 복원용)
    session.recipe_json = {
        "recipe": DEFAULT_RECIPE,
        "generated_count": sum(1 for e in entries if e["source"] == "generated"),
        "items": [
            {
                "quiz_id": e["quiz_id"],
                "source": e["source"],
                "slot_filled": e["slot_filled"],
            }
            for e in entries
        ],
    }
    await db.flush()
    return session, entries

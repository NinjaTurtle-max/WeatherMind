"""커리큘럼 서비스 — 스프린트 R5-01 §3.2.

섹션→유닛 트리 구성·잠금 판정(순수 함수: prereq crowns>=1)과, 유닛 세션 발급·유닛
clear 왕관/XP 처리(DB 결합부)를 담당한다. 유닛 세션은 기존 세션 엔진을 재사용해
발급하되(mode='unit', sessions.unit_id 기록), 문항 풀은 유닛의 concept_tag+kind로
결정한다 — unit_id를 content_items에 추가하지 않는다(기존 시드 하위 호환, §3.2).

잠금 규칙(§3.2): prereq_unit_id가 있으면 그 유닛 crowns>=1 이어야 열림. 첫 유닛 무잠금.
진도: 유닛 세션 5/5(전 문항 정답) 또는 board 클리어 시 crowns +1(crown_target까지),
cleared 전환 시 +20 XP 1회.
"""
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.course import Course
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.unit import Unit, UserUnitProgress
from app.models.user import User
from app.services import session_service, weatherbrain_service, xp_service
from app.services.weather_api import KST

MODE_UNIT = "unit"
UNIT_SESSION_SIZE = settings.UNIT_SESSION_SIZE   # 기본 5 — env 튜닝(R5.5)

# §0 제품 결정의 4섹션 교육적 순서 (섹션 정렬 키 — DB 컬럼 없이 표현).
# 미등재 섹션은 뒤로(알파벳). unit_order는 섹션 내 유일(§3.6).
SECTION_ORDER = (
    "하늘 읽기", "공기의 힘", "큰 바람", "도시와 기후",
    # 기초과학 코스 3섹션 (R12 §9 — specs/11 §2 순서: 열·복사 → 압력·밀도 → 상태변화).
    # 코스가 갈려도 정렬 키는 전역 하나로 충분하다 — 섹션명이 코스 간 유일.
    "열과 빛", "공기의 무게", "물과 에너지",
)

# 기본 코스 (R11-01 §3 F) — 기존 유저·course 파라미터 생략·코스 미시드 DB 전부
# weather가 기본이다. 코스별 유저 선택 영속화는 웨이브 2(코스 선택 UX와 함께).
DEFAULT_COURSE_SLUG = "weather"


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — 트리 구성·잠금 판정 (DB 의존 없음)
# ═══════════════════════════════════════════════════════════════


def is_locked(
    unit: Any,
    progress_by_unit: dict[Any, Any],
    unlock_floor: int = 0,
    order_index: int | None = None,
) -> bool:
    """잠금 판정 — 유일 지점(트리 노출·403 게이트 동일 적용).

    §3.2: prereq_unit_id가 있고 그 유닛 crowns<1 이면 잠금. 첫 유닛 무잠금.
    R7-02 §3.4 배치 선해제: 유닛의 전체 순서 인덱스(order_index, ordered_units
    기준) < unlock_floor 이면 prereq와 무관하게 열림 — placement_unlock_floor가
    산출한 선두 연속 구간. 기본값 unlock_floor=0 은 현행 동작(선해제 없음).
    순수 함수라 전체 순서를 스스로 알 수 없어 호출측이 order_index를 공급한다.

    progress_by_unit: {unit_id: progress}(progress는 .crowns 속성 보유).
    """
    if order_index is not None and order_index < unlock_floor:
        return False
    prereq = unit.prereq_unit_id
    if prereq is None:
        return False
    prog = progress_by_unit.get(prereq)
    return not (prog is not None and prog.crowns >= 1)


def scope_units_to_course(
    units: Iterable[Any], course_id: Any, *, is_default: bool
) -> list[Any]:
    """코스 귀속 필터 (R11-01 §3 F, 순수) — 판정 유일 지점.

    **하위 호환 핵심**: 기본 코스(weather)는 course_id가 NULL(또는 속성 부재 —
    기존 테스트 픽스처)인 유닛을 포함한다. 0009 이전 시드·코스 미시드 DB·기존
    유저가 코스 도입 후에도 동일한 트리를 본다. 비기본 코스는 정확히 그 코스에
    귀속된 유닛만 — NULL은 절대 비기본 코스로 새지 않는다.
    """
    if is_default:
        return [
            u for u in units if getattr(u, "course_id", None) in (None, course_id)
        ]
    if course_id is None:  # 비기본 + 코스 미상 — NULL 귀속이 새지 않게 빈 스코프
        return []
    return [u for u in units if getattr(u, "course_id", None) == course_id]


def course_view(
    course: Any, units: Iterable[Any], slug_by_id: dict[Any, str]
) -> dict[str, Any]:
    """코스 1개의 API 표현 (R11-01 §3 F, 순수) — read-only 목록/상세 공용.

    unit_view 선례: id·prereq_course_id는 안정 참조인 slug로 노출한다
    (slug_by_id: {내부 id → slug}). units_total은 귀속 유닛 수(기본 코스는
    NULL 귀속 포함 — scope_units_to_course 단일 정의 재사용).
    """
    is_default = course.slug == DEFAULT_COURSE_SLUG
    scoped = scope_units_to_course(units, course.id, is_default=is_default)
    prereq_slug = (
        slug_by_id.get(course.prereq_course_id)
        if course.prereq_course_id is not None
        else None
    )
    return {
        "id": course.slug,
        "title": course.title,
        "description": course.description,
        "course_order": course.course_order,
        "prereq_course_id": prereq_slug,
        "is_default": is_default,
        "units_total": len(scoped),
    }


def _section_key(section: str) -> tuple[int, str]:
    try:
        return (SECTION_ORDER.index(section), "")
    except ValueError:
        return (len(SECTION_ORDER), section)


def ordered_units(units: Iterable[Any]) -> list[Any]:
    """유닛 전체 순서 — 섹션은 SECTION_ORDER, 섹션 내 unit_order 오름차순.

    build_curriculum의 노출 순서와 동일 기준(단일 정의) — 배치 선해제(§3.4)의
    "전체 순서 인덱스"는 이 리스트의 위치다.
    """
    return sorted(units, key=lambda u: (_section_key(u.section), u.unit_order))


def placement_unlock_floor(abilities: list, units: Iterable[Any]) -> int:
    """배치 기반 커리큘럼 시작점 (R7-02 §3.4, 순수) — 선두 연속 선해제 유닛 수.

    전체 순서(ordered_units) 선두부터 "그 유닛 concept_tag의 θ ≥ 0.5
    (_THETA_INTERMEDIATE_MAX 재사용 — 상급 경계) AND num_responses>0"가 연속으로
    성립하는 유닛 개수. 조건이 끊기면 즉시 중단(선두 연속만 — 중간 점프 없음).
    n=0(placement 사전 θ)은 실응답 근거가 없으므로 불인정 — 배치고사 실응답 후
    refresh_abilities가 n을 채워야 선해제된다. 빈 abilities → 0(현행 동작).
    선해제는 잠금만 풀며 왕관·XP는 0 그대로(소급 보상 없음).

    abilities 원소는 load_abilities 반환 형식({"concept_tag","theta","se","n"}).
    """
    by_tag = {ab["concept_tag"]: ab for ab in abilities}
    floor = 0
    for unit in ordered_units(units):
        ab = by_tag.get(unit.concept_tag)
        if (
            ab is None
            or int(ab["n"]) <= 0
            or float(ab["theta"]) < weatherbrain_service._THETA_INTERMEDIATE_MAX
        ):
            break
        floor += 1
    return floor


def unit_view(
    unit: Any,
    progress_by_unit: dict[Any, Any],
    slug_by_id: dict[Any, str],
    unlock_floor: int = 0,
    order_index: int | None = None,
) -> dict[str, Any]:
    """유닛 1개의 트리 표현(진도·잠금·status 포함).

    API에는 안정 참조인 **slug**를 id로 노출한다(프론트·URL이 UUID 대신 slug 사용).
    prereq_unit_id도 대상 유닛의 slug로 변환해 노출한다(slug_by_id: {내부 id → slug}).
    잠금 판정은 내부 id(UUID) 키의 progress_by_unit으로 수행한다(is_locked —
    unlock_floor·order_index는 배치 선해제 §3.4).

    status(파생, additive — crowns/cleared/locked 기존 필드 불변):
    'cleared' | 'locked' | 'unlocked'. "잠기지 않은 첫 미클리어 유닛 1개"의
    'current' 승격은 전체 순서를 아는 build_curriculum이 수행한다.
    """
    prog = progress_by_unit.get(unit.id)
    crowns = prog.crowns if prog is not None else 0
    cleared = bool(prog is not None and prog.cleared_at is not None)
    locked = is_locked(unit, progress_by_unit, unlock_floor, order_index)
    prereq_slug = (
        slug_by_id.get(unit.prereq_unit_id)
        if unit.prereq_unit_id is not None
        else None
    )
    return {
        "id": unit.slug,
        "section": unit.section,
        "unit_order": unit.unit_order,
        "title": unit.title,
        "concept_tag": unit.concept_tag,
        "kind": unit.kind,
        "crown_target": unit.crown_target,
        "prereq_unit_id": prereq_slug,
        "crowns": crowns,
        "cleared": cleared,
        "locked": locked,
        "status": "cleared" if cleared else ("locked" if locked else "unlocked"),
    }


def plan_crown(
    crowns: int, cleared: bool, crown_target: int
) -> tuple[int, bool, int]:
    """유닛 clear 왕관 가산 계획(순수, §3.2). 반환: (새 crowns, newly_cleared, xp).

    - 왕관은 crown_target까지만 +1 (초과 미가산).
    - cleared 전환(왕관이 target에 처음 도달)에만 +20 XP 1회 — 재클리어는 XP 0.
    """
    new_crowns = crowns + 1 if crowns < crown_target else crowns
    newly_cleared = new_crowns >= crown_target and not cleared
    xp = xp_service.XP_UNIT_CLEAR if newly_cleared else 0
    return new_crowns, newly_cleared, xp


def majority_concept(
    concept_tags: Iterable[str | None], route_target: str | None = None
) -> str | None:
    """데일리 만점 왕관 대상 개념 선정 (R8-01 §3.4, 순수) — 세션 문항 최다 개념.

    동률이면 route target_concept_tag 우선, 그래도 동률이면 태그 사전순 — 결정적.
    빈 입력(태그 없음)은 None.
    """
    counts = Counter(tag for tag in concept_tags if tag)
    if not counts:
        return None
    top = max(counts.values())
    tied = sorted(tag for tag, count in counts.items() if count == top)
    if route_target in tied:
        return route_target
    return tied[0]


def pick_crown_unit(
    units: Iterable[Any],
    progress_by_unit: dict[Any, Any],
    *,
    concept_tag: str,
    kind: str,
    unlock_floor: int = 0,
    uncleared_only: bool = False,
) -> Any | None:
    """유닛 밖 활동(보드 탭·데일리)의 왕관 대상 유닛 선정 (R8-01 §3.4, 순수).

    전체 순서(ordered_units)상 concept_tag·kind가 일치하고 잠금을 통과한
    (is_locked — 트리 노출과 동일 규칙·unlock_floor 포함) **첫** 유닛을 돌려준다.
    uncleared_only=True면 미클리어(crowns < crown_target) 유닛만 후보 — 이미
    왕관이 가득 찬 유닛은 건너뛴다(grant가 어차피 무동작이라 중복 보상·거짓
    토스트 방지). 대상이 없으면 None(무동작).
    """
    ordered = ordered_units(units)
    for order_index, unit in enumerate(ordered):
        if unit.concept_tag != concept_tag or unit.kind != kind:
            continue
        if is_locked(unit, progress_by_unit, unlock_floor, order_index):
            continue
        if uncleared_only:
            prog = progress_by_unit.get(unit.id)
            crowns = prog.crowns if prog is not None else 0
            if crowns >= unit.crown_target:
                continue
        return unit
    return None


def build_curriculum(
    units: Iterable[Any],
    progress_by_unit: dict[Any, Any],
    unlock_floor: int = 0,
) -> list[dict[str, Any]]:
    """섹션→유닛 트리를 구성한다 (§3.2 + 배치 선해제·status §3.4, 순수).

    반환: [{"section": str, "units": [unit_view, ...]}] — 섹션은 SECTION_ORDER,
    유닛은 unit_order 오름차순. unlock_floor(기본 0=현행)는 전체 순서 선두
    unlock_floor개 유닛의 잠금을 해제한다(placement_unlock_floor 산출값).
    status 'current'는 전체 순서상 "잠기지 않은 첫 미클리어 유닛" 정확히 1개.
    """
    units = list(units)
    slug_by_id = {u.id: u.slug for u in units}  # prereq(UUID) → slug 노출 변환용
    index_of = {u.id: i for i, u in enumerate(ordered_units(units))}
    grouped: dict[str, list[Any]] = {}
    for unit in units:
        grouped.setdefault(unit.section, []).append(unit)

    sections: list[dict[str, Any]] = []
    for section in sorted(grouped, key=_section_key):
        ordered = sorted(grouped[section], key=lambda u: u.unit_order)
        sections.append(
            {
                "section": section,
                "units": [
                    unit_view(
                        u, progress_by_unit, slug_by_id, unlock_floor, index_of[u.id]
                    )
                    for u in ordered
                ],
            }
        )
    # 'current' 승격 — 트리 노출 순서 == ordered_units 전체 순서(동일 정렬 기준)
    first_open = next(
        (v for s in sections for v in s["units"] if v["status"] == "unlocked"),
        None,
    )
    if first_open is not None:
        first_open["status"] = "current"
    return sections


def build_spine(
    units: Iterable[Any],
    progress_by_unit: dict[Any, Any],
    unlock_floor: int = 0,
) -> dict[str, Any]:
    """스파인(유닛 진도 축) 집계 (R8-01 §3.3, 순수) — /progress/me additive용.

    build_curriculum의 unit_view 위에서 집계해 CurriculumHome 클라 계산과
    정의가 항상 일치한다(단일 정의 재사용 — 별도 판정 로직 없음):
    - units_total: 전체 유닛 수 / units_cleared: cleared(=cleared_at 존재) 수
    - crowns_earned: Σ crowns / crowns_total: Σ crown_target
    - current_unit: build_curriculum의 'current'(전체 순서상 잠기지 않은 첫
      미클리어 유닛) 그대로 — {"slug", "title"} 또는 전부 클리어/잠금이면 None.
    """
    views = [
        view
        for section in build_curriculum(units, progress_by_unit, unlock_floor)
        for view in section["units"]
    ]
    current = next((v for v in views if v["status"] == "current"), None)
    return {
        "units_total": len(views),
        "units_cleared": sum(1 for v in views if v["cleared"]),
        "crowns_earned": sum(v["crowns"] for v in views),
        "crowns_total": sum(v["crown_target"] for v in views),
        "current_unit": (
            {"slug": current["id"], "title": current["title"]}
            if current is not None
            else None
        ),
    }


# ═══════════════════════════════════════════════════════════════
# DB 결합부 — 조회·유닛 세션 발급·clear 처리
# ═══════════════════════════════════════════════════════════════


async def load_units(db: AsyncSession) -> list[Unit]:
    return list(
        (
            await db.execute(select(Unit).order_by(Unit.section, Unit.unit_order))
        )
        .scalars()
        .all()
    )


async def load_courses(db: AsyncSession) -> list[Course]:
    """코스 전량 로드 (R11-01 §3 F) — course_order 오름차순. 미시드 DB는 빈 목록."""
    return list(
        (await db.execute(select(Course).order_by(Course.course_order)))
        .scalars()
        .all()
    )


async def get_course_by_slug(db: AsyncSession, slug: str) -> Course | None:
    return (
        await db.execute(select(Course).where(Course.slug == slug))
    ).scalar_one_or_none()


async def load_scoped_units(
    db: AsyncSession, course_slug: str | None = None
) -> list[Unit]:
    """코스 범위 유닛 로드 (R11-01 §3 F) — 트리 GET의 코스 스코프 유일 지점.

    course_slug 생략(None)은 기본 코스(weather)다. 기본 코스는 courses가
    미시드여도(course 행 없음) NULL 귀속 유닛 전량을 돌려줘 현행과 동일 동작
    (하위 호환). 비기본 코스인데 course 행이 없으면 빈 목록(방어 —
    미존재 404는 라우터가 선판정).
    """
    units = await load_units(db)
    slug = course_slug or DEFAULT_COURSE_SLUG
    is_default = slug == DEFAULT_COURSE_SLUG
    course = await get_course_by_slug(db, slug)
    if course is None and not is_default:
        return []
    return scope_units_to_course(
        units, course.id if course is not None else None, is_default=is_default
    )


async def course_views(db: AsyncSession) -> list[dict[str, Any]]:
    """코스 목록의 API 표현 (R11-01 §3 F) — read-only, course_order 오름차순."""
    courses = await load_courses(db)
    units = await load_units(db)
    slug_by_id = {c.id: c.slug for c in courses}
    return [course_view(c, units, slug_by_id) for c in courses]


async def load_progress_by_unit(
    db: AsyncSession, user: User
) -> dict[uuid.UUID, UserUnitProgress]:
    rows = (
        (
            await db.execute(
                select(UserUnitProgress).where(UserUnitProgress.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    return {row.unit_id: row for row in rows}


async def get_curriculum(
    db: AsyncSession, user: User, course_slug: str | None = None
) -> list[dict[str, Any]]:
    """섹션→유닛 트리 (course_slug additive — R11-01 §3 F).

    course_slug 생략은 기본 코스(weather)이며 코스 미시드 DB에서 현행과 동일
    동작(load_scoped_units 하위 호환 규칙). 잠금·배치 선해제는 스코프된 유닛
    집합 위에서 평가한다 — 단일 코스 데이터에서는 전체 집합과 동일.
    """
    units = await load_scoped_units(db, course_slug)
    progress = await load_progress_by_unit(db, user)
    abilities = await weatherbrain_service.load_abilities(db, user)  # read-only
    return build_curriculum(
        units, progress, unlock_floor=placement_unlock_floor(abilities, units)
    )


async def get_spine(db: AsyncSession, user: User) -> dict[str, Any]:
    """스파인 집계 조회 (R8-01 §3.3) — /progress/me 서버 계산.

    트리 노출(get_curriculum)과 동일한 잠금 규칙(배치 선해제 포함)으로
    build_spine을 평가한다. θ 읽기는 load_abilities(read-only) — ai-worker 미호출.
    """
    units = await load_units(db)
    progress = await load_progress_by_unit(db, user)
    abilities = await weatherbrain_service.load_abilities(db, user)
    return build_spine(
        units, progress, unlock_floor=placement_unlock_floor(abilities, units)
    )


async def is_unit_locked(
    db: AsyncSession, user: User, unit: Unit, abilities: list | None = None
) -> bool:
    """403 게이트용 잠금 판정 — 트리 노출(get_curriculum)과 동일 규칙 적용 (§3.4).

    prereq 판정 + 배치 선해제(unlock_floor)를 is_locked 한 지점으로 통과시킨다.
    abilities 미전달 시 load_abilities(read-only, ai-worker 미호출) — 트리 GET과
    동일. 유닛 세션 발급 경로는 라우터가 refresh_abilities 1회 결과를 넘겨
    잠금 판정이 신선한 θ를 쓴다 (R8-01 §3.2 — session_service:295 전례).
    """
    progress = await load_progress_by_unit(db, user)
    units = await load_units(db)
    if abilities is None:
        abilities = await weatherbrain_service.load_abilities(db, user)
    index_of = {u.id: i for i, u in enumerate(ordered_units(units))}
    return is_locked(
        unit,
        progress,
        unlock_floor=placement_unlock_floor(abilities, units),
        order_index=index_of.get(unit.id),
    )


async def _unit_content_pool(
    db: AsyncSession, user: User, unit: Unit, abilities: list | None = None
) -> list[ContentItem]:
    """유닛의 concept_tag+kind 문항 풀 — θ→난이도 연결 (R7-02 §3.3).

    daily 세션과 동일한 θ 풀 확장·정렬을 session_service의
    pool_level_groups+build_pool_query **재사용**으로 적용한다:
    - θ = overall_theta(abilities, unit.concept_tag). abilities 미전달 시
      load_abilities — 저장된 θ만 읽는 read-only 경로(refresh_abilities·
      ai-worker 호출 없음). 발급 경로는 라우터의 refresh_abilities 1회 결과를
      받아 풀 정렬이 신선한 θ를 쓴다 (R8-01 §3.2).
    - θ가 있으면 level_group이 가입 그룹 ∪ θ 매핑 그룹으로 확장되고
      |b−θ| 오름차순 정렬 — 초등 board 0건 같은 학령 풀 공백이 θ로 해소된다.
    - 콜드스타트(θ None)는 현행과 동일: 가입 그룹 단일 + random 정렬.
    - 슬롯 미치환 노출 방지의 live 슬롯 제외(live=False)는 board에도 적용된다
      (유닛 세션은 슬롯 치환이 없고, 시드상 board는 전부 uses_live_slots=false).

    당일 중복 방지는 **best-effort**다 (R10-01 D2·D8-5): 1차 조회는 오늘 응답분을
    제외하고(신선도 우선), 그 결과가 UNIT_SESSION_SIZE보다 적으면 제외를 뗀
    2차 조회로 부족분을 백필한다. 유닛 세션에는 daily의 quiz-generate 폴백이
    없어(create_unit_session docstring) 하드 제외하면 같은 유닛 당일 재진입이
    0문항 세션으로 깨진다 — 반복 노출보다 나쁜 회귀다.
    """
    if abilities is None:
        abilities = await weatherbrain_service.load_abilities(db, user)
    theta = weatherbrain_service.overall_theta(abilities, unit.concept_tag)

    def _pool_stmt(served_subq):
        stmt = session_service.build_pool_query(
            level_groups=session_service.pool_level_groups(user.level_group, theta),
            theta=theta,
            live=False,
            served_subq=served_subq,
            weak_concepts=[unit.concept_tag],
            limit=UNIT_SESSION_SIZE,
        )
        if unit.kind == "board":
            return stmt.where(ContentItem.question_type == "board")
        return stmt.where(ContentItem.question_type != "board")

    today_subq = session_service.answered_today_subq(
        user.id, session_service.kst_day_start_utc(datetime.now(KST).date())
    )
    items = list((await db.execute(_pool_stmt(today_subq))).scalars().all())
    if len(items) >= UNIT_SESSION_SIZE:
        return items

    seen = {item.id for item in items}
    backfill = (await db.execute(_pool_stmt(None))).scalars().all()
    for item in backfill:
        if len(items) >= UNIT_SESSION_SIZE:
            break
        if item.id not in seen:
            seen.add(item.id)
            items.append(item)
    return items


async def create_unit_session(
    db: AsyncSession,
    user: User,
    unit: Unit,
    today: date | None = None,
    abilities: list | None = None,
) -> tuple[Session, list[dict[str, Any]]]:
    """유닛 문항으로 세션을 발급한다 (기존 세션 엔진 재사용, mode='unit', unit_id 기록).

    반환: (Session, entries — [{"quiz_id", "question", "source", "slot_filled",
    "content_item_id"}]). 잠금·미존재 판정은 라우터가 담당한다.
    abilities는 라우터의 refresh_abilities 1회 결과(R8-01 §3.2) — 풀 정렬에 전달.
    문항 풀이 비면 0문항 세션이 발급된다(데이터 저작 대기 — 클리어 불가).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    items = await _unit_content_pool(db, user, unit, abilities)
    entries: list[dict[str, Any]] = []
    for item in items:
        template = dict(item.template_json or {})
        question = {
            **template,
            "concept_tag": item.concept_tag,
            "question_type": item.question_type,
        }
        entries.append(
            {
                "question": question,
                "source": "bank",
                "slot_filled": False,
                "content_item_id": item.id,
            }
        )

    session = Session(
        user_id=user.id,
        unit_id=unit.id,
        session_date=today,
        mode=MODE_UNIT,
    )
    db.add(session)
    await db.flush()  # session.id 확보

    quiz_ids = await session_service.allocate_quiz_ids(
        db, user.id, today_str, len(entries)
    )
    for quiz_id, entry in zip(quiz_ids, entries):
        entry["quiz_id"] = quiz_id
        db.add(
            QuizLog(
                user_id=user.id,
                quiz_id=quiz_id,
                session_id=session.id,
                content_item_id=entry["content_item_id"],
                concept_tag=entry["question"].get("concept_tag", unit.concept_tag),
                question_type=entry["question"].get("question_type"),
                question_json=entry["question"],
            )
        )

    session.recipe_json = {
        "kind": "unit",
        "unit_id": str(unit.id),
        "items": [
            {"quiz_id": e["quiz_id"], "source": e["source"], "slot_filled": False}
            for e in entries
        ],
    }
    await db.flush()
    return session, entries


async def grant_unit_crown(
    db: AsyncSession, user: User, unit_id: uuid.UUID
) -> dict[str, Any]:
    """유닛 clear 처리 (§3.2): crowns +1(crown_target까지), cleared 전환 시 +20 XP 1회.

    호출측(세션 complete)이 "5/5 또는 board 클리어" 조건과 세션 최초 완료(멱등)를
    이미 판정한 뒤 호출한다 — 여기서는 왕관 가산과 cleared 전환만 담당한다.
    반환: {"crowns", "cleared", "newly_cleared", "xp_earned"}.
    """
    unit = await db.get(Unit, unit_id)
    if unit is None:
        return {"crowns": 0, "cleared": False, "newly_cleared": False, "xp_earned": 0}

    prog = (
        await db.execute(
            select(UserUnitProgress).where(
                UserUnitProgress.user_id == user.id,
                UserUnitProgress.unit_id == unit_id,
            )
        )
    ).scalar_one_or_none()
    if prog is None:
        prog = UserUnitProgress(user_id=user.id, unit_id=unit_id, crowns=0)
        db.add(prog)
        await db.flush()

    new_crowns, newly_cleared, xp_earned = plan_crown(
        prog.crowns, prog.cleared_at is not None, unit.crown_target
    )
    prog.crowns = new_crowns
    if newly_cleared:
        prog.cleared_at = datetime.now(timezone.utc)
        await xp_service.add_xp(db, user.id, xp_earned)

    await db.flush()
    return {
        "crowns": prog.crowns,
        "cleared": prog.cleared_at is not None,
        "newly_cleared": newly_cleared,
        "xp_earned": xp_earned,
    }


async def find_crown_unit(
    db: AsyncSession,
    user: User,
    *,
    concept_tag: str,
    kind: str,
    uncleared_only: bool = False,
) -> Unit | None:
    """왕관 유입로(R8-01 §3.4)의 DB 결합부 — pick_crown_unit에 잠금 맥락 공급.

    is_unit_locked와 동일한 잠금 맥락(진도·배치 선해제 unlock_floor)을 한 번만
    로드해 후보 전체를 순수 함수로 스캔한다. θ 읽기는 load_abilities(read-only).
    """
    units = await load_units(db)
    progress = await load_progress_by_unit(db, user)
    abilities = await weatherbrain_service.load_abilities(db, user)
    return pick_crown_unit(
        units,
        progress,
        concept_tag=concept_tag,
        kind=kind,
        unlock_floor=placement_unlock_floor(abilities, units),
        uncleared_only=uncleared_only,
    )


async def award_crown_for_activity(
    db: AsyncSession,
    user: User,
    *,
    concept_tag: str,
    kind: str,
) -> dict[str, Any] | None:
    """유닛 밖 활동(보드 탭 최초 클리어·데일리 만점)의 왕관 부여 (R8-01 §3.4).

    concept_tag·kind가 일치하고 열려 있는(잠금 통과) 첫 미클리어 유닛에
    grant_unit_crown +1. 대상이 없으면 None(무동작 — 응답 crown_award=null).
    반환은 crown_award 응답 형태: {"unit_slug","unit_title","crowns","cleared"}.
    """
    unit = await find_crown_unit(
        db, user, concept_tag=concept_tag, kind=kind, uncleared_only=True
    )
    if unit is None:
        return None
    grant = await grant_unit_crown(db, user, unit.id)
    return {
        "unit_slug": unit.slug,
        "unit_title": unit.title,
        "crowns": grant["crowns"],
        "cleared": grant["cleared"],
    }


async def unit_result_for_session(
    db: AsyncSession,
    user: User,
    unit_id: uuid.UUID,
    *,
    all_correct: bool,
    grant_crown: bool,
) -> dict[str, Any] | None:
    """유닛 세션 complete의 unit_result 조립 (R8-01 §3.1).

    grant_crown=True(세션 최초 완료 + 전 문항 정답 — 판정은 호출측)면
    grant_unit_crown을 호출해 그 반환을 그대로 노출하고, 아니면(오답 있음·재완료
    멱등) 저장된 진도 스냅샷(unit_xp=0)을 쓴다. 유닛 미존재면 None.
    반환: {"all_correct","crowns","crown_target","cleared","unit_xp"}.
    """
    unit = await db.get(Unit, unit_id)
    if unit is None:
        return None
    if grant_crown:
        grant = await grant_unit_crown(db, user, unit_id)
        crowns, cleared, unit_xp = (
            grant["crowns"], grant["cleared"], grant["xp_earned"],
        )
    else:
        prog = (await load_progress_by_unit(db, user)).get(unit_id)
        crowns = prog.crowns if prog is not None else 0
        cleared = bool(prog is not None and prog.cleared_at is not None)
        unit_xp = 0
    return {
        "all_correct": all_correct,
        "crowns": crowns,
        "crown_target": unit.crown_target,
        "cleared": cleared,
        "unit_xp": unit_xp,
    }

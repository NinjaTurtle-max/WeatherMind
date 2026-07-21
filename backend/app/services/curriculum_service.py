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
from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.unit import Unit, UserUnitProgress
from app.models.user import User
from app.services import session_service, xp_service
from app.services.weather_api import KST

MODE_UNIT = "unit"
UNIT_SESSION_SIZE = 5

# §0 제품 결정의 4섹션 교육적 순서 (섹션 정렬 키 — DB 컬럼 없이 표현).
# 미등재 섹션은 뒤로(알파벳). unit_order는 섹션 내 유일(§3.6).
SECTION_ORDER = ("하늘 읽기", "공기의 힘", "큰 바람", "도시와 기후")


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — 트리 구성·잠금 판정 (DB 의존 없음)
# ═══════════════════════════════════════════════════════════════


def is_locked(
    unit: Any, progress_by_unit: dict[Any, Any]
) -> bool:
    """§3.2 잠금 판정: prereq_unit_id가 있고 그 유닛 crowns<1 이면 잠금. 첫 유닛 무잠금.

    progress_by_unit: {unit_id: progress}(progress는 .crowns 속성 보유).
    """
    prereq = unit.prereq_unit_id
    if prereq is None:
        return False
    prog = progress_by_unit.get(prereq)
    return not (prog is not None and prog.crowns >= 1)


def _section_key(section: str) -> tuple[int, str]:
    try:
        return (SECTION_ORDER.index(section), "")
    except ValueError:
        return (len(SECTION_ORDER), section)


def unit_view(
    unit: Any,
    progress_by_unit: dict[Any, Any],
    slug_by_id: dict[Any, str],
) -> dict[str, Any]:
    """유닛 1개의 트리 표현(진도·잠금 포함).

    API에는 안정 참조인 **slug**를 id로 노출한다(프론트·URL이 UUID 대신 slug 사용).
    prereq_unit_id도 대상 유닛의 slug로 변환해 노출한다(slug_by_id: {내부 id → slug}).
    잠금 판정은 내부 id(UUID) 키의 progress_by_unit으로 수행한다(is_locked).
    """
    prog = progress_by_unit.get(unit.id)
    crowns = prog.crowns if prog is not None else 0
    cleared = bool(prog is not None and prog.cleared_at is not None)
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
        "locked": is_locked(unit, progress_by_unit),
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


def build_curriculum(
    units: Iterable[Any], progress_by_unit: dict[Any, Any]
) -> list[dict[str, Any]]:
    """섹션→유닛 트리를 구성한다 (§3.2, 순수).

    반환: [{"section": str, "units": [unit_view, ...]}] — 섹션은 SECTION_ORDER,
    유닛은 unit_order 오름차순.
    """
    units = list(units)
    slug_by_id = {u.id: u.slug for u in units}  # prereq(UUID) → slug 노출 변환용
    grouped: dict[str, list[Any]] = {}
    for unit in units:
        grouped.setdefault(unit.section, []).append(unit)

    sections: list[dict[str, Any]] = []
    for section in sorted(grouped, key=_section_key):
        ordered = sorted(grouped[section], key=lambda u: u.unit_order)
        sections.append(
            {
                "section": section,
                "units": [unit_view(u, progress_by_unit, slug_by_id) for u in ordered],
            }
        )
    return sections


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


async def get_curriculum(db: AsyncSession, user: User) -> list[dict[str, Any]]:
    units = await load_units(db)
    progress = await load_progress_by_unit(db, user)
    return build_curriculum(units, progress)


async def _unit_content_pool(
    db: AsyncSession, user: User, unit: Unit
) -> list[ContentItem]:
    """유닛의 concept_tag+kind에 해당하는 문항 풀 (active + level_group 일치, 랜덤)."""
    base = (
        (ContentItem.status == "active")
        & (ContentItem.level_group == user.level_group)
        & (ContentItem.concept_tag == unit.concept_tag)
    )
    if unit.kind == "board":
        base = base & (ContentItem.question_type == "board")
    else:
        # quiz 유닛: board 외 유형 + 슬롯 미치환 노출 방지 위해 live 슬롯 문항 제외
        base = base & (ContentItem.question_type != "board") & (
            ContentItem.uses_live_slots.is_(False)
        )
    return list(
        (
            await db.execute(
                select(ContentItem)
                .where(base)
                .order_by(func.random())
                .limit(UNIT_SESSION_SIZE)
            )
        )
        .scalars()
        .all()
    )


async def create_unit_session(
    db: AsyncSession, user: User, unit: Unit, today: date | None = None
) -> tuple[Session, list[dict[str, Any]]]:
    """유닛 문항으로 세션을 발급한다 (기존 세션 엔진 재사용, mode='unit', unit_id 기록).

    반환: (Session, entries — [{"quiz_id", "question", "source", "slot_filled",
    "content_item_id"}]). 잠금·미존재 판정은 라우터가 담당한다.
    문항 풀이 비면 0문항 세션이 발급된다(데이터 저작 대기 — 클리어 불가).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    items = await _unit_content_pool(db, user, unit)
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
        db_user = await db.get(User, user.id)
        if db_user is not None:
            await xp_service.add_xp(db, db_user, xp_earned)

    await db.flush()
    return {
        "crowns": prog.crowns,
        "cleared": prog.cleared_at is not None,
        "newly_cleared": newly_cleared,
        "xp_earned": xp_earned,
    }

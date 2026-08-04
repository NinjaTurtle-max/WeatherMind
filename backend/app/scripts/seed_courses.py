"""courses 시드 적재 스크립트 — 스프린트 R11-01 §3 F (다과정 구조).

database/seed/courses.json을 읽어 **slug(id)** 기준으로 courses에 멱등 upsert 한다
(seed_units와 같은 패턴). 재실행해도 중복이 생기지 않는다.

courses.json 스키마(units.json과 동일한 slug 방식):
  {"id": "<slug>", "title", "description"?, "course_order",
   "prereq_course_id": "<slug>" | null}

courses.json은 UUID를 알 수 없으므로 prereq를 slug로 참조한다. 2-pass 적재:
  (1) 전 코스를 slug 기준 upsert(prereq_course_id 제외, slug→Course 맵 구성),
  (2) prereq_course_id(slug)를 같은 파일 내 대상 코스의 UUID로 해석해 FK를 채운다.
미해석(dangling) prereq는 경고 후 NULL로 둔다(seed_units 선례).

실행 순서: **seed_courses → seed_units** — seed_units가 units.json의 course(slug)를
DB의 courses 행으로 해석하기 때문. 파일이 없으면 안내 후 정상 종료하며, 코스가
없어도 서비스는 동작한다(units.course_id NULL = 기본 코스 weather 취급 — 하위 호환).

실행 (backend/ 디렉토리에서):
    python -m app.scripts.seed_courses [경로 생략 시 database/seed/courses.json]
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.database import async_session, engine
from app.models.course import Course

DEFAULT_SEED_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "courses.json"
)


def validate_entry(entry: dict[str, Any], index: int) -> list[str]:
    """courses.json 스키마 검증 (순수 함수, slug 방식). 반환: 위반 사유 목록 (비면 통과)."""
    errors: list[str] = []
    prefix = f"[{index}]"

    if not isinstance(entry.get("id"), str) or not entry["id"].strip():
        errors.append(f"{prefix} id(slug) 누락")
    if not isinstance(entry.get("title"), str) or not entry["title"].strip():
        errors.append(f"{prefix} title 누락")
    if not isinstance(entry.get("course_order"), int) or isinstance(
        entry.get("course_order"), bool
    ):
        errors.append(f"{prefix} course_order(정수) 누락")

    description = entry.get("description")
    if description is not None and not isinstance(description, str):
        errors.append(f"{prefix} description은 null 또는 문자열이어야 함: {description!r}")

    prereq = entry.get("prereq_course_id")
    if prereq is not None and (not isinstance(prereq, str) or not prereq.strip()):
        errors.append(
            f"{prefix} prereq_course_id는 null 또는 slug 문자열이어야 함: {prereq!r}"
        )
    return errors


async def upsert_entries(entries: list[dict[str, Any]]) -> tuple[int, int, int]:
    """slug(id) 기준 멱등 upsert + prereq_course_id(slug→UUID) 2-pass 해석.

    반환: (inserted, updated, unresolved_prereq).
    """
    inserted = updated = 0
    async with async_session() as session:
        async with session.begin():
            # pass 1: 코스 본문 upsert (prereq 제외), slug → Course 맵 구성
            by_slug: dict[str, Course] = {}
            for entry in entries:
                slug = entry["id"]
                existing = (
                    await session.execute(select(Course).where(Course.slug == slug))
                ).scalar_one_or_none()
                if existing is not None:
                    existing.title = entry["title"]
                    existing.description = entry.get("description")
                    existing.course_order = entry["course_order"]
                    by_slug[slug] = existing
                    updated += 1
                else:
                    course = Course(
                        slug=slug,
                        title=entry["title"],
                        description=entry.get("description"),
                        course_order=entry["course_order"],
                    )
                    session.add(course)
                    by_slug[slug] = course
                    inserted += 1
            await session.flush()  # id(UUID) 확보

            # pass 2: prereq_course_id(slug) → 대상 코스 UUID 해석
            unresolved = 0
            for entry in entries:
                course = by_slug[entry["id"]]
                prereq_slug = entry.get("prereq_course_id")
                if prereq_slug is None:
                    course.prereq_course_id = None
                    continue
                target = by_slug.get(prereq_slug)
                if target is None:
                    print(
                        f"[seed_courses] prereq 미해석 — {entry['id']!r}의 "
                        f"prereq_course_id {prereq_slug!r} 없음 (NULL 유지)"
                    )
                    course.prereq_course_id = None
                    unresolved += 1
                else:
                    course.prereq_course_id = target.id
    return inserted, updated, unresolved


async def run(seed_path: Path) -> int:
    if not seed_path.exists():
        print(
            f"[seed_courses] 시드 파일이 아직 없습니다: {seed_path}\n"
            "(아무 것도 적재하지 않고 종료합니다 — units.course_id NULL은 "
            "기본 코스 weather로 취급되어 서비스는 동작합니다)"
        )
        return 0

    try:
        raw = json.loads(seed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[seed_courses] JSON 파싱 실패: {exc}")
        return 1
    if not isinstance(raw, list):
        print("[seed_courses] 최상위는 배열이어야 합니다")
        return 1

    valid: list[dict[str, Any]] = []
    skipped = 0
    seen_slugs: set[str] = set()
    seen_orders: set[int] = set()
    for index, entry in enumerate(raw):
        errors = validate_entry(entry, index)
        if not errors:
            slug = entry["id"]
            order = entry["course_order"]
            if slug in seen_slugs:
                errors.append(f"[{index}] id(slug) 중복: {slug!r}")
            elif order in seen_orders:
                errors.append(f"[{index}] course_order 중복: {order!r}")
            else:
                seen_slugs.add(slug)
                seen_orders.add(order)
        if errors:
            skipped += 1
            for error in errors:
                print(f"[seed_courses] 스킵 {error}")
        else:
            valid.append(entry)

    inserted, updated, unresolved = await upsert_entries(valid)
    await engine.dispose()
    print(
        f"[seed_courses] 완료 — 삽입 {inserted} / 갱신 {updated} / 스킵 {skipped} / "
        f"prereq 미해석 {unresolved} (총 {len(raw)}건, 파일: {seed_path})"
    )
    return 0


def main() -> None:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEED_PATH
    sys.exit(asyncio.run(run(seed_path)))


if __name__ == "__main__":
    main()

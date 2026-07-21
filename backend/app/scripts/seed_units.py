"""units 시드 적재 스크립트 — 스프린트 R5-01 §3.2 (데이터 저작 units.json의 백엔드 적재).

database/seed/units.json을 읽어 **slug(id)** 기준으로 units에 멱등 upsert 한다
(seed_content·seed_badges와 같은 패턴). 재실행해도 중복이 생기지 않는다.

units.json 스키마(§3.2, 데이터·AI 게이트와 동일한 slug 방식):
  {"id": "<slug>", "section", "unit_order", "title", "concept_tag", "kind",
   "crown_target"?, "prereq_unit_id": "<slug>" | null}

units.json은 UUID를 알 수 없으므로 prereq를 slug로 참조한다. 2-pass 적재:
  (1) 전 유닛을 slug 기준 upsert(prereq_unit_id 제외, slug→Unit 맵 구성),
  (2) prereq_unit_id(slug)를 같은 파일 내 대상 유닛의 UUID로 해석해 FK를 채운다.
미해석(dangling) prereq는 경고 후 NULL로 둔다 — 순환·존재 정밀 검증은 AI 게이트
(validate_curriculum, §3.6) 소관이며, 이 로더는 적재만 담당한다.

파일이 아직 없으면(데이터 담당이 병렬 저작 중) 안내 후 정상 종료한다 — 로더가 없어도
서비스는 동작한다(빈 units → GET /curriculum 빈 트리, POST 유닛 세션 404).

실행 (backend/ 디렉토리에서):
    python -m app.scripts.seed_units [경로 생략 시 database/seed/units.json]
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.database import async_session, engine
from app.models.unit import Unit
from app.scripts.seed_content import ALLOWED_CONCEPT_TAGS

DEFAULT_SEED_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "units.json"
)
ALLOWED_KINDS = {"quiz", "board"}


def validate_entry(entry: dict[str, Any], index: int) -> list[str]:
    """§3.2 유닛 스키마 검증 (순수 함수, slug 방식). 반환: 위반 사유 목록 (비면 통과)."""
    errors: list[str] = []
    prefix = f"[{index}]"

    if not isinstance(entry.get("id"), str) or not entry["id"].strip():
        errors.append(f"{prefix} id(slug) 누락")
    if not isinstance(entry.get("section"), str) or not entry["section"].strip():
        errors.append(f"{prefix} section 누락")
    if not isinstance(entry.get("unit_order"), int) or isinstance(
        entry.get("unit_order"), bool
    ):
        errors.append(f"{prefix} unit_order(정수) 누락")
    if not isinstance(entry.get("title"), str) or not entry["title"].strip():
        errors.append(f"{prefix} title 누락")
    if entry.get("concept_tag") not in ALLOWED_CONCEPT_TAGS:
        errors.append(f"{prefix} concept_tag 불허: {entry.get('concept_tag')!r}")
    if entry.get("kind") not in ALLOWED_KINDS:
        errors.append(f"{prefix} kind 불허: {entry.get('kind')!r}")
    crown_target = entry.get("crown_target", 1)
    if (
        not isinstance(crown_target, int)
        or isinstance(crown_target, bool)
        or crown_target < 1
    ):
        errors.append(f"{prefix} crown_target는 1 이상 정수여야 함: {crown_target!r}")

    prereq = entry.get("prereq_unit_id")
    if prereq is not None and (not isinstance(prereq, str) or not prereq.strip()):
        errors.append(
            f"{prefix} prereq_unit_id는 null 또는 slug 문자열이어야 함: {prereq!r}"
        )
    return errors


async def upsert_entries(entries: list[dict[str, Any]]) -> tuple[int, int, int]:
    """slug(id) 기준 멱등 upsert + prereq_unit_id(slug→UUID) 2-pass 해석.

    반환: (inserted, updated, unresolved_prereq).
    """
    inserted = updated = 0
    async with async_session() as session:
        async with session.begin():
            # pass 1: 유닛 본문 upsert (prereq 제외), slug → Unit 맵 구성
            by_slug: dict[str, Unit] = {}
            for entry in entries:
                slug = entry["id"]
                existing = (
                    await session.execute(select(Unit).where(Unit.slug == slug))
                ).scalar_one_or_none()
                if existing is not None:
                    existing.section = entry["section"]
                    existing.unit_order = entry["unit_order"]
                    existing.title = entry["title"]
                    existing.concept_tag = entry["concept_tag"]
                    existing.kind = entry["kind"]
                    existing.crown_target = entry.get("crown_target", 1)
                    by_slug[slug] = existing
                    updated += 1
                else:
                    unit = Unit(
                        slug=slug,
                        section=entry["section"],
                        unit_order=entry["unit_order"],
                        title=entry["title"],
                        concept_tag=entry["concept_tag"],
                        kind=entry["kind"],
                        crown_target=entry.get("crown_target", 1),
                    )
                    session.add(unit)
                    by_slug[slug] = unit
                    inserted += 1
            await session.flush()  # id(UUID) 확보

            # pass 2: prereq_unit_id(slug) → 대상 유닛 UUID 해석
            unresolved = 0
            for entry in entries:
                unit = by_slug[entry["id"]]
                prereq_slug = entry.get("prereq_unit_id")
                if prereq_slug is None:
                    unit.prereq_unit_id = None
                    continue
                target = by_slug.get(prereq_slug)
                if target is None:
                    print(
                        f"[seed_units] prereq 미해석 — {entry['id']!r}의 "
                        f"prereq_unit_id {prereq_slug!r} 없음 (NULL 유지)"
                    )
                    unit.prereq_unit_id = None
                    unresolved += 1
                else:
                    unit.prereq_unit_id = target.id
    return inserted, updated, unresolved


async def run(seed_path: Path) -> int:
    if not seed_path.exists():
        print(
            f"[seed_units] 시드 파일이 아직 없습니다: {seed_path}\n"
            "데이터 담당(§3.2)이 database/seed/units.json을 저작하면 "
            "이 스크립트를 다시 실행하세요. (아무 것도 적재하지 않고 종료합니다)"
        )
        return 0

    try:
        raw = json.loads(seed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[seed_units] JSON 파싱 실패: {exc}")
        return 1
    if not isinstance(raw, list):
        print("[seed_units] 최상위는 배열이어야 합니다 (§3.2)")
        return 1

    valid: list[dict[str, Any]] = []
    skipped = 0
    seen_slugs: set[str] = set()
    for index, entry in enumerate(raw):
        errors = validate_entry(entry, index)
        if not errors:
            slug = entry["id"]
            if slug in seen_slugs:
                errors.append(f"[{index}] id(slug) 중복: {slug!r}")
            else:
                seen_slugs.add(slug)
        if errors:
            skipped += 1
            for error in errors:
                print(f"[seed_units] 스킵 {error}")
        else:
            valid.append(entry)

    inserted, updated, unresolved = await upsert_entries(valid)
    await engine.dispose()
    print(
        f"[seed_units] 완료 — 삽입 {inserted} / 갱신 {updated} / 스킵 {skipped} / "
        f"prereq 미해석 {unresolved} (총 {len(raw)}건, 파일: {seed_path})"
    )
    return 0


def main() -> None:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEED_PATH
    sys.exit(asyncio.run(run(seed_path)))


if __name__ == "__main__":
    main()

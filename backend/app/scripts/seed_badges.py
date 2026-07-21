"""badges 시드 적재 스크립트 — 스프린트 R4-01 §3.3 (데이터 저작 badges.json의 백엔드 적재).

database/seed/badges.json을 읽어 code 기준으로 badges에 멱등 upsert 한다
(seed_content와 같은 패턴). code가 같은 행이 있으면 title·description 갱신,
없으면 삽입 — 재실행해도 중복이 생기지 않는다.

파일이 아직 없으면(데이터 담당이 병렬 저작 중) 안내 후 정상 종료한다(로더가 없어도
서비스는 동작 — 배지 지급은 코드가 badges에 있을 때만 이뤄지는 no-op 가드).

실행 (backend/ 디렉토리에서):
    python -m app.scripts.seed_badges [경로 생략 시 database/seed/badges.json]
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.database import async_session, engine
from app.models.badge import Badge

# 저장소 루트 기준 기본 시드 경로 (backend/app/scripts/ → 3단계 상위)
DEFAULT_SEED_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "badges.json"
)

# R4-01 §3.3 — 배지 코드 5종 (고정)
ALLOWED_BADGE_CODES = {
    "streak_7",
    "streak_30",
    "streak_100",
    "perfect_session",
    "tier_promoted",
}


def validate_entry(entry: dict[str, Any], index: int) -> list[str]:
    """§3.3 배지 스키마 검증 (순수 함수). 반환: 위반 사유 목록 (비면 통과)."""
    errors: list[str] = []
    prefix = f"[{index}]"

    code = entry.get("code")
    if code not in ALLOWED_BADGE_CODES:
        errors.append(f"{prefix} code 불허: {code!r}")
    title = entry.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append(f"{prefix} title 누락")
    description = entry.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append(f"{prefix} description 누락")
    return errors


async def upsert_entries(entries: list[dict[str, Any]]) -> tuple[int, int]:
    """검증 통과분을 code 기준 멱등 upsert. 반환: (inserted, updated)."""
    inserted = updated = 0
    async with async_session() as session:
        async with session.begin():
            for entry in entries:
                existing = (
                    await session.execute(
                        select(Badge).where(Badge.code == entry["code"])
                    )
                ).scalar_one_or_none()
                if existing is not None:
                    existing.title = entry["title"]
                    existing.description = entry["description"]
                    updated += 1
                else:
                    session.add(
                        Badge(
                            code=entry["code"],
                            title=entry["title"],
                            description=entry["description"],
                        )
                    )
                    inserted += 1
    return inserted, updated


async def run(seed_path: Path) -> int:
    if not seed_path.exists():
        print(
            f"[seed_badges] 시드 파일이 아직 없습니다: {seed_path}\n"
            "데이터 담당(§3.3)이 database/seed/badges.json을 저작하면 "
            "이 스크립트를 다시 실행하세요. (아무 것도 적재하지 않고 종료합니다)"
        )
        return 0

    try:
        raw = json.loads(seed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[seed_badges] JSON 파싱 실패: {exc}")
        return 1
    if not isinstance(raw, list):
        print("[seed_badges] 최상위는 배열이어야 합니다 (§3.3)")
        return 1

    valid: list[dict[str, Any]] = []
    skipped = 0
    for index, entry in enumerate(raw):
        errors = validate_entry(entry, index)
        if errors:
            skipped += 1
            for error in errors:
                print(f"[seed_badges] 스킵 {error}")
        else:
            valid.append(entry)

    inserted, updated = await upsert_entries(valid)
    await engine.dispose()
    print(
        f"[seed_badges] 완료 — 삽입 {inserted} / 갱신 {updated} / 스킵 {skipped} "
        f"(총 {len(raw)}건, 파일: {seed_path})"
    )
    return 0


def main() -> None:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEED_PATH
    sys.exit(asyncio.run(run(seed_path)))


if __name__ == "__main__":
    main()

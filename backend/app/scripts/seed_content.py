"""content_items 시드 적재 스크립트 — 스프린트 R2-01 §3.3 (S8 산출물의 백엔드 적재).

database/seed/content_items.json을 읽어 §3.3 스키마를 검증한 뒤 content_items에
멱등 upsert 한다. 멱등 기준: (concept_tag, template_json->>'question_text')가
같은 행이 있으면 갱신, 없으면 삽입 — 재실행해도 중복이 생기지 않는다.

파일이 아직 없으면(데이터 담당이 병렬 저작 중) 안내 후 정상 종료한다.

실행 (backend/ 디렉토리에서):
    python -m app.scripts.seed_content [경로 생략 시 database/seed/content_items.json]
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.core.database import async_session, engine
from app.models.content_item import ContentItem
from app.services.weatherbrain_service import (
    KNOWLEDGE_LEVEL_MAX,
    KNOWLEDGE_LEVEL_MIN,
)

# 저장소 루트 기준 기본 시드 경로 (backend/app/scripts/ → 3단계 상위)
DEFAULT_SEED_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "content_items.json"
)

# DEVELOPMENT_PLAN §1 표준: concept_tag 6종 / level_group 3종 / question_type 3종
ALLOWED_CONCEPT_TAGS = {
    # 기상 코스 6종 (DEVELOPMENT_PLAN §1 — 불변, specs/11 §0-2)
    "pressure_front",
    "typhoon",
    "air_mass",
    "heat_island",
    "co2_climate",
    "anomaly",
    # 기초과학 코스 신규 6종 — specs/11 §1. 코스 접두사 없는 평면 네임스페이스
    # (θ·약점 태그가 코스를 가로질러 태그 단위로 이어지는 계약). 개방 시점은
    # 문항 저작과 동시(§1 로더 반영 — 빈 태그가 약점 태그·복습 큐의 빈 축이 되지
    # 않도록 저작 배치와 함께 연다. R12 AU-2).
    "temperature_heat",
    "radiation_budget",
    "pressure_basics",
    "phase_change",
    "density_buoyancy",
    "energy_transfer",
    # 재난 축 1차 개통 2종 — R13 §2.4. 지진은 범위 밖 확정(지질학).
    # 기초과학 6종과 같은 평면 네임스페이스(θ가 코스를 가로지르는 단일 통화).
    "wildfire_weather",
    "flood_response",
}
# R13 §2.2 — expert(전문가) 밴드 추가. 순서는 난이도 오름차순이 아니라 집합이므로
# 무의미하고, 밴드 순서·θ 경계의 정본은 weatherbrain_service.LEVEL_GROUP_BANDS다.
# ⚠️ DB CHECK 제약(ck_content_items_level_group)은 아직 3종이다 — 실DB 적재는
# 마이그레이션이 선행돼야 한다(BE-1 0011 소유, PM 보고).
ALLOWED_LEVEL_GROUPS = {"elementary", "middle_high", "adult", "expert"}
# 스프린트 R3-01 §3.8 — question_type 7종 (§3.6 신규 4종 포함)
ALLOWED_QUESTION_TYPES = {
    "multiple_choice",
    "short_answer",
    "slider",
    "board",
    "match",
    "ordering",
    "cloze",
}
# correct_answer(정답 문자열)를 쓰는 유형 — board/match/ordering은 미사용(§3.3·§3.6):
# board는 goal_conditions, match는 pairs, ordering은 items 순서로 채점한다.
CORRECT_ANSWER_TYPES = {"multiple_choice", "short_answer", "slider", "cloze"}
ALLOWED_STATUSES = {"draft", "active", "retired"}

# slider 척도 기본값 — **min/max가 저작되지 않은 구형 문항 전용**이다 (CO-O-7).
# 0~100은 슬라이더가 암묵적으로 백분율이던 최초 설계(03번 스펙)의 흔적인데 제품은
# 항목별 범위로 옮겨갔다(`QUESTION_PAYLOAD_FIELDS["slider"]` = min·max·step·unit).
SLIDER_DEFAULT_MIN = 0.0
SLIDER_DEFAULT_MAX = 100.0


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def slider_bounds(template: dict[str, Any]) -> tuple[float, float]:
    """slider 채점 범위 = **문항 자신의 min/max** (CO-O-7, 순수 함수).

    ai-worker 1차 게이트(`validate_chain.slider_range`)와 **같은 규칙**이다 — 거기서만
    고치고 여기 하드코딩 0~100을 남겨 둔 탓에, 게이트 2개를 통과한 넓은 범위 문항
    (기압 900~1100 hPa · 정답 1008)이 4단계인 적재에서 죽었다. `session_service.
    persist_generated_items`가 **런타임에도 같은 함수를 부르므로**, 그 상태로 8/11~18을
    돌면 넓은 범위 slider는 영원히 일회용 문항이 된다.

    min/max가 없거나 숫자가 아니거나 역전(min>=max)이면 기본 0~100으로 되돌린다 —
    저작 실수가 범위 검사 자체를 무력화하지 않게 하기 위한 하한이다.
    """
    low = template.get("min", SLIDER_DEFAULT_MIN)
    high = template.get("max", SLIDER_DEFAULT_MAX)
    if not (_is_number(low) and _is_number(high)) or float(low) >= float(high):
        return SLIDER_DEFAULT_MIN, SLIDER_DEFAULT_MAX
    return float(low), float(high)


def validate_entry(entry: dict[str, Any], index: int) -> list[str]:
    """§3.3 스키마 검증 (순수 함수). 반환: 위반 사유 목록 (비면 통과)."""
    errors: list[str] = []
    prefix = f"[{index}]"

    concept_tag = entry.get("concept_tag")
    if concept_tag not in ALLOWED_CONCEPT_TAGS:
        errors.append(f"{prefix} concept_tag 불허: {concept_tag!r}")
    if entry.get("level_group") not in ALLOWED_LEVEL_GROUPS:
        errors.append(f"{prefix} level_group 불허: {entry.get('level_group')!r}")
    question_type = entry.get("question_type")
    if question_type not in ALLOWED_QUESTION_TYPES:
        errors.append(f"{prefix} question_type 불허: {question_type!r}")
    if entry.get("status", "active") not in ALLOWED_STATUSES:
        errors.append(f"{prefix} status 불허: {entry.get('status')!r}")

    # 지식 수준 (R13-0 §1) — **선택 키**다. 없으면 미분류(NULL)로 적재되고 소비자는
    # level_group에서 파생 폴백한다(0012 계약). 141건 전수 재분류가 끝나기 전까지
    # 본시드 대부분이 이 상태이므로 필수로 만들면 적재가 통째로 막힌다.
    # 상한은 앱이 소유한다 — DB CHECK에는 하한만 있다(0012 §2: 단계 수 N이 움직여도
    # 마이그레이션을 다시 열지 않기 위해). 그 "앱"이 여기다.
    knowledge_level = entry.get("knowledge_level")
    if knowledge_level is not None and (
        not isinstance(knowledge_level, int)
        or isinstance(knowledge_level, bool)
        or not KNOWLEDGE_LEVEL_MIN <= knowledge_level <= KNOWLEDGE_LEVEL_MAX
    ):
        errors.append(
            f"{prefix} knowledge_level 불허: {knowledge_level!r} "
            f"({KNOWLEDGE_LEVEL_MIN}~{KNOWLEDGE_LEVEL_MAX} 정수 또는 생략)"
        )

    template = entry.get("template_json")
    if not isinstance(template, dict):
        errors.append(f"{prefix} template_json 누락 또는 형식 오류")
        return errors

    question_text = template.get("question_text")
    if not isinstance(question_text, str) or not question_text.strip():
        errors.append(f"{prefix} template_json.question_text 누락")

    correct = template.get("correct_answer")
    if question_type in CORRECT_ANSWER_TYPES and (
        correct is None or str(correct).strip() == ""
    ):
        errors.append(f"{prefix} template_json.correct_answer 누락")

    if question_type == "multiple_choice":
        options = template.get("options")
        if not isinstance(options, list) or len(options) != 4:
            errors.append(f"{prefix} multiple_choice options는 4개여야 함")
        elif len(set(options)) != len(options):
            errors.append(f"{prefix} options 중복 금지")
        elif correct not in options:
            errors.append(f"{prefix} correct_answer가 options에 없음")

    if question_type == "slider" and correct is not None:
        try:
            value = float(str(correct))
        except ValueError:
            errors.append(f"{prefix} slider 정답이 숫자가 아님: {correct!r}")
        else:
            low, high = slider_bounds(template)
            if not low <= value <= high:
                errors.append(
                    f"{prefix} slider 정답은 {low:g}~{high:g} 범위여야 함: {correct!r}"
                )

    return errors


async def upsert_entries(entries: list[dict[str, Any]]) -> tuple[int, int]:
    """검증 통과분을 멱등 upsert. 반환: (inserted, updated)."""
    inserted = updated = 0
    async with async_session() as session:
        async with session.begin():
            for entry in entries:
                question_text = entry["template_json"]["question_text"]
                existing = (
                    await session.execute(
                        select(ContentItem).where(
                            ContentItem.concept_tag == entry["concept_tag"],
                            ContentItem.template_json["question_text"].astext
                            == question_text,
                        )
                    )
                ).scalar_one_or_none()

                if existing is not None:
                    existing.level_group = entry["level_group"]
                    # 키가 없으면 NULL로 되돌린다 — 시드 파일이 SSOT라는 기존 관례
                    # (source·status와 같은 취급). 재분류 결과를 파일에서 지우면
                    # DB에서도 지워지는 것이 맞다.
                    existing.knowledge_level = entry.get("knowledge_level")
                    existing.question_type = entry["question_type"]
                    existing.template_json = entry["template_json"]
                    existing.uses_live_slots = bool(entry.get("uses_live_slots", False))
                    existing.source = entry.get("source")
                    existing.status = entry.get("status", "active")
                    updated += 1
                else:
                    session.add(
                        ContentItem(
                            concept_tag=entry["concept_tag"],
                            level_group=entry["level_group"],
                            # 미분류(None)면 NULL — 소비자가 level_group에서 파생한다
                            knowledge_level=entry.get("knowledge_level"),
                            question_type=entry["question_type"],
                            template_json=entry["template_json"],
                            uses_live_slots=bool(entry.get("uses_live_slots", False)),
                            source=entry.get("source"),
                            # 시드는 사람 저작 — 기본 active (§3.3)
                            status=entry.get("status", "active"),
                        )
                    )
                    inserted += 1
    return inserted, updated


async def run(seed_path: Path) -> int:
    if not seed_path.exists():
        print(
            f"[seed_content] 시드 파일이 아직 없습니다: {seed_path}\n"
            "데이터 담당(S8)이 database/seed/content_items.json을 저작하면 "
            "이 스크립트를 다시 실행하세요. (아무 것도 적재하지 않고 종료합니다)"
        )
        return 0

    try:
        raw = json.loads(seed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[seed_content] JSON 파싱 실패: {exc}")
        return 1
    if not isinstance(raw, list):
        print("[seed_content] 최상위는 배열이어야 합니다 (§3.3)")
        return 1

    valid: list[dict[str, Any]] = []
    skipped = 0
    for index, entry in enumerate(raw):
        errors = validate_entry(entry, index)
        if errors:
            skipped += 1
            for error in errors:
                print(f"[seed_content] 스킵 {error}")
        else:
            valid.append(entry)

    inserted, updated = await upsert_entries(valid)
    await engine.dispose()
    print(
        f"[seed_content] 완료 — 삽입 {inserted} / 갱신 {updated} / 스킵 {skipped} "
        f"(총 {len(raw)}건, 파일: {seed_path})"
    )
    return 0


def main() -> None:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEED_PATH
    sys.exit(asyncio.run(run(seed_path)))


if __name__ == "__main__":
    main()

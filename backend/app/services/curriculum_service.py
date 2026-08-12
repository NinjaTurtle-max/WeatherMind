"""커리큘럼 서비스 — 스프린트 R5-01 §3.2.

섹션→유닛 트리 구성·잠금 판정(순수 함수: prereq crowns>=1)과, 유닛 세션 발급·유닛
clear 왕관/XP 처리(DB 결합부)를 담당한다. 유닛 세션은 기존 세션 엔진을 재사용해
발급하되(mode='unit', sessions.unit_id 기록), 문항 풀은 유닛의 concept_tag+kind로
결정한다 — unit_id를 content_items에 추가하지 않는다(기존 시드 하위 호환, §3.2).

잠금 규칙(§3.2): prereq_unit_id가 있으면 그 유닛 crowns>=1 이어야 열림. 첫 유닛 무잠금.

왕관 유입로는 **3개**다 (CO-L5 정정 — 이 자리에 "유닛 세션 5/5" 하나라고 적혀
있었으나 거짓이었다. `routers/session.py`의 유닛 세션 완료는 `grant_crown=False`
고정이라 **유닛 직접 진입은 왕관을 주지 않는다** — 연습 전용):
  ⑴ 일일 세션의 진도 블록 · ⑵ 보드 탭 최초 클리어 · ⑶ `/dev` 개발 경로.
⑴·⑵만 `grant_unit_crown`으로 수렴한다 — ⑶은 `UserUnitProgress`를 직접 upsert해
그 함수를 거치지 않는다(2026-08-08 재확인. "셋 다 수렴"이 이 자리에 적혀 있었다).
판정 조건은 각 유입로가 소유하므로 여기 적지 않는다 — 문서가 코드보다 앞서 나가면
다시 거짓이 된다.

**코스 경계(CO-L1)**: 진도·왕관·잠금·스파인은 **한 코스 안에서** 닫힌다.
`active_course_units`·`course_groups`가 유일 판정 지점이며, 이 경계가 없으면
다른 코스의 무잠금 유닛(basic-science 3유닛은 prereq=null)이 1일차부터 진도
블록에 섞여 왕관을 가져가고 기본 코스 트리가 영원히 열리지 않는다.
"""
import json
import logging
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.course import Course
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.unit import Unit, UserUnitProgress
from app.models.user import User
from app.services import session_service, weatherbrain_service, xp_service
# ⚠️ `get_today_weather`·`user_region`은 여기서 더 이상 쓰지 않는다 — 유닛 실황
# 경로(`unit_slot_values`)와 함께 2026-08-13에 철거됐다. 하루 첫 유닛 세션의 실황은
# `session_service.plan_daily_picks`가 자기 안에서 조회한다.
from app.services.weather_api import KST

MODE_UNIT = "unit"
# 유닛 세션 문항 수 — **「두 번째 이후」 전용**(2026-08-13 클라이언트 확정).
# 하루 첫 유닛 세션은 그 자체가 데일리 세션이라 크기의 소유자가 여기가 아니라
# `Settings.SESSION_RECIPE`의 총합(10)이다. 자세한 것은 `create_unit_session`.
UNIT_SESSION_SIZE = settings.UNIT_SESSION_SIZE   # env 튜닝(R5.5)

# ⚠️ **유닛 실황 경로는 2026-08-13에 철거됐다** — `UNIT_LIVE_CAP`(2) ·
# `UNIT_LIVE_POOL_LIMIT`(100) · `live_rotation_window` · `unit_slot_values` ·
# `_unit_content_pool(slot_values=...)`가 모두 여기 있었다. 되살리지 말 것.
#
# **왜 필터 보강이 아니라 철거인가** — 두 이유가 겹쳤다.
#   ⑴ **아무도 안 쓰는 경로가 됐다.** 확정 사양에서 하루 **첫** 유닛 세션은
#      데일리 배합(`실황2·신규4·복습3·보드1`)을 받으므로 실황을 daily 경로가 주고,
#      **두 번째 이후**는 실황이 **0건**인 순수 학습이다. 어느 쪽도 이 경로를 타지
#      않는다.
#   ⑵ **애초에 사양대로 돈 적이 없다.** 실황 풀 조회가 `weak_concepts=[unit.
#      concept_tag]`를 **하드 WHERE**로 걸어, 순환 풀이 실황 20종이 아니라
#      **개념당 1~4건**이었다. `pressure_front`는 2건뿐이라 `UNIT_LIVE_CAP=2`가
#      **매일 같은 2건 전부**를 넣었다 — 「20종·10일 순환」은 유닛 층위에서 한 번도
#      존재하지 않았고, 기상 138유닛 기준 실황 픽의 74%가 표적 단계에서 2단계
#      이상 벗어났다. 도는 적이 없던 순환에 창 필터를 덧대는 것은 낭비다.
#
# ⚠️ **딸려 나간 것 하나 — 같은 날 복원됐다.** `live_rotation_window`는 「날짜
# 결정적 10일 순환」의 저장소 유일 구현이었고, 철거 직후 클라이언트 결정 ④의
# 「실황 20유형 · 세션당 2건 · 10일 순환」은 코드에 소유자가 **없었다**(daily의
# 실황 선택이 `limit 5 · 오늘 응답분 제외 · |b−θ|→random`이라 순환이 아니었다).
# **새 소유자는 `session_service.live_rotation_order`**이고, 자리는 예고대로
# 유닛이 아니라 **daily live 풀**(`session_service._fetch_pools`)이다. 옮기면서
# 바뀐 것 하나: 표적 정렬(|kl − 표적|)이 1차 키로 앞에 붙어 회전 범위가 거리
# 계층 코호트로 좁아졌다 — 주기 산식과 그 근거는 그 함수의 독스트링이 소유한다.
# 여기 유닛 경로로 되살리지 말 것은 그대로다.

# 유닛 풀 선취 배수 (CO-L-F2) — θ 경로에서 SQL LIMIT을 UNIT_SESSION_SIZE의 이 배로
# 잡는다. SQL은 밴드 해상도(|b−θ|)로만 자를 수 있어, 5건에서 끊으면
# `rank_by_knowledge_level`이 지식 수준으로 다시 세울 후보가 남지 않기 때문이다.
# **계약 수치가 아니라 조회 여유분**이라 env 노브를 두지 않는다(최대 20행 — 유닛당
# 조회 횟수는 2회 그대로이므로 왕복 비용은 불변).
UNIT_POOL_PREFETCH = 4

# §0 제품 결정의 교육적 섹션 순서 (섹션 정렬 키 — DB 컬럼 없이 표현).
# 개수를 여기 적지 않는다: 이 자리에 "4섹션"이라 적혀 있었는데 바로 아래 튜플이
# 8섹션으로 자란 뒤에도 그대로였다(2026-08-09 정정). **섹션 수의 단일 소유자는
# 아래 튜플 자신**이고, 코스별 분포는 `database/seed/units.json`이 소유한다.
# 미등재 섹션은 뒤로(알파벳). unit_order는 섹션 내 유일(§3.6).
SECTION_ORDER = (
    # 기상 코스 10섹션 = 지식 단계 1~10 (CO-G1 순환식 — docs/design/cyclic_sections.md).
    # **섹션명은 여기가 원본이 아니다.** /me 화면이 렌더하는 10단계 표시명
    # (frontend/src/i18n/resources/ko.js `ability.knowledgeLevel.name`)의 사본이고,
    # 원본은 database/seed/units.json이 소유한다.
    "초등 3~4학년", "초등 5~6학년", "중학교 물질·에너지", "중학교 유체 지구",
    "고등학교 공통", "고등학교 일반선택", "고등학교 진로선택",
    "학부 대기과학", "학부 고학년", "기상청 현업",
    # 기초과학 3섹션 — **별도 코스로 존치**(2026-08-12 클라이언트 확인).
    # 코스가 갈려도 정렬 키는 전역 하나로 충분하다 — 섹션명이 코스 간 유일.
    "열과 빛", "공기의 무게", "물과 에너지",
)
# 종전 기상 5종("하늘 읽기"·"공기의 힘"·"큰 바람"·"도시와 기후"·"위험한 하늘")은
# 2026-08-12 재구조화로 사라졌다. 미등재 섹션은 `_section_key`가 뒤로(알파벳)
# 보내므로, 새 10종이 여기 없으면 **초등이 뒤쪽에서 렌더된다** — 교육과정이 거꾸로
# 선다. 실제로 그 상태로 한 번 실측됐고(담당 D: 13개 중 10번째), 클라이언트가
# "열과빛 → 공기의무게"로 시작하는 화면을 지적한 것이 바로 그 증상이다.

# 섹션 → 지식 단계. 기상 코스 섹션은 **이름 자체가 단계**라 별도 컬럼을 두지 않는다
# (units.json에 knowledge_level 필드를 넣으면 같은 사실이 두 곳에 적히고, 이 저장소
# 에서 가장 잘 기록된 실패 유형이 "두 번째 사본"이다). 앞 10종이 기상 코스의 단계
# 축이라는 것은 위 배열의 구조적 계약이고, 그 사실은 계약 테스트가 감시한다.
# 기초과학 3섹션은 단계 축이 아니라 **코스**이므로 매핑에 넣지 않는다 — 넣으면
# 그 유닛의 θ 파생 표적이 엉뚱한 단계로 덮인다.
WEATHER_SECTION_COUNT = 10
SECTION_KNOWLEDGE_LEVEL = {
    name: i + 1 for i, name in enumerate(SECTION_ORDER[:WEATHER_SECTION_COUNT])
}

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


# 섹션 표시 메타(부제·예상 소요·세부 주제) — 판정 미사용, 화면 전용. 프로세스 캐시.
# 유닛에서 파생할 수 없는 값이라 시드가 소유한다. 부재해도 트리는 그대로 동작한다
# (board_regions 선례) — 프론트가 None/빈 리스트면 아무것도 그리지 않는다.
logger = logging.getLogger(__name__)

SECTION_META_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "section_meta.json"
)
_section_meta_cache: dict[str, dict] | None = None


def load_section_meta() -> dict[str, dict]:
    """section_meta.json → {섹션명: {subtitle, est_minutes, topics}}."""
    global _section_meta_cache
    if _section_meta_cache is not None:
        return _section_meta_cache
    if not SECTION_META_PATH.exists():
        logger.info("section_meta.json 부재 — 섹션 메타 없이 진행: %s", SECTION_META_PATH)
        _section_meta_cache = {}
        return _section_meta_cache
    try:
        rows = json.loads(SECTION_META_PATH.read_text(encoding="utf-8"))
        _section_meta_cache = {
            r["section"]: {
                "subtitle": r.get("subtitle"),
                "est_minutes": r.get("est_minutes"),
                "topics": list(r.get("topics") or []),
            }
            for r in rows
            if r.get("section")
        }
    except (OSError, ValueError, KeyError, TypeError):
        logger.exception("section_meta.json 파싱 실패 — 섹션 메타 없이 진행")
        _section_meta_cache = {}
    return _section_meta_cache


def _section_key(section: str) -> tuple[int, str]:
    try:
        return (SECTION_ORDER.index(section), "")
    except ValueError:
        return (len(SECTION_ORDER), section)


def unit_target_level(unit: Any, fallback: int | None) -> int | None:
    """유닛의 표적 지식 단계 — 섹션이 단계를 말하면 그것이 이기고, 아니면 θ 파생값.

    CO-G1 순환식 배선의 본체다(`docs/design/cyclic_sections.md` §5-①). 배선 전에는
    `_unit_content_pool`이 `concept_tag + kind`로만 풀을 골랐고 단계 표적은 **유저
    θ에서만** 나왔다 — 그래서 `w01-pressure-front`(초등 3~4학년)와
    `w09-pressure-front`(학부 고학년)가 **완전히 같은 5문항**을 냈고, 10섹션은
    화면상의 장식이었다.

    ⚠️ **정렬 표적이지 필터가 아니다.** `rank_by_knowledge_level`에만 넘기고
    SQL의 `where`로 내리지 않는다 — `test_curriculum_band_fallback`의
    `test_지식수준_고정반경으로는_굶주림이_안_풀린다`가 "고정 kl 창은 밴드 공백을
    단계 공백으로 옮길 뿐"임을 실측으로 못 박아 두었다. 표적 단계에 문항이 없으면
    **가장 가까운 단계로 내려앉고 굶지 않는다**.

    기초과학 3섹션(단계 축이 아니라 코스다)과 섹션이 없거나 미등재인 유닛
    (대역 객체·재구조화 전 유닛)은 매핑에 없으므로 `fallback`(θ 파생)이 그대로
    산다 — 하위 호환이 이 한 줄에 들어 있다.
    """
    return SECTION_KNOWLEDGE_LEVEL.get(getattr(unit, "section", None), fallback)


def ordered_units(units: Iterable[Any]) -> list[Any]:
    """유닛 전체 순서 — 섹션은 SECTION_ORDER, 섹션 내 unit_order 오름차순.

    build_curriculum의 노출 순서와 동일 기준(단일 정의) — 배치 선해제(§3.4)의
    "전체 순서 인덱스"는 이 리스트의 위치다.
    """
    return sorted(units, key=lambda u: (_section_key(u.section), u.unit_order))


def placement_unlock_floor(
    abilities: list, units: Iterable[Any], level_group: str | None
) -> int:
    """배치 기반 커리큘럼 시작점 (R7-02 §3.4, 순수) — 선두 연속 선해제 유닛 수.

    전체 순서(ordered_units) 선두부터 "그 유닛 concept_tag의
    θ ≥ weatherbrain_service.unlock_theta_threshold(level_group) — 자기 학령 밴드의
    **상단 경계** AND num_responses>0"가 연속으로 성립하는 유닛 개수. 조건이 끊기면
    즉시 중단(선두 연속만 — 중간 점프 없음).
    n=0(placement 사전 θ)은 실응답 근거가 없으므로 불인정 — 배치고사 실응답 후
    refresh_abilities가 n을 채워야 선해제된다. 빈 abilities → 0(현행 동작).
    선해제는 잠금만 풀며 왕관·XP는 0 그대로(소급 보상 없음).

    **임계는 학령 상대다 (R13 CO-V-2 = CO-U-3-B).** 종전엔 절대 0.5
    (`_THETA_INTERMEDIATE_MAX`)를 전 학령에 적용해 판정이 뒤집혀 있었다 —
    성인은 학령 표준문항을 **틀려도** θ 0.586 ≥ 0.5로 선해제되고, 중고생·초등은
    **맞혀도** θ 0.413 < 0.5라 영영 열리지 않았다(게스트는 영구 middle_high라
    구조적으로 0 — CO-N-4). 지금은 세 학령 모두 **학령 표준문항 2연속 정답**이면
    열리고 1문항으로는 어느 학령도 열리지 않는다(test_weatherbrain_relative_
    thresholds가 고정).

    level_group은 **기본값이 없다** — 호출부가 유저를 손에 들고 있으면서 학령을
    빠뜨리면 조용히 종전 절대 임계로 돌아가는 것이 CO-U-3의 발생 경로였다.
    미지 값·None은 `band_prior_theta`의 중립 폴백(DEFAULT_ITEM_B=0)을 타서
    임계 0.5 = 종전 값이 된다.

    abilities 원소는 load_abilities 반환 형식({"concept_tag","theta","se","n"}).
    """
    floor_theta = weatherbrain_service.unlock_theta_threshold(level_group)
    by_tag = {ab["concept_tag"]: ab for ab in abilities}
    floor = 0
    for unit in ordered_units(units):
        ab = by_tag.get(unit.concept_tag)
        if ab is None or int(ab["n"]) <= 0 or float(ab["theta"]) < floor_theta:
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


def open_units_in_order(
    units: Iterable[Any],
    progress_by_unit: dict[Any, Any],
    unlock_floor: int = 0,
) -> list[Any]:
    """전체 순서상 "열려 있고 아직 클리어되지 않은" 유닛 목록 (R13-01 §2.10, 순수).

    build_curriculum이 'current'로 승격하는 유닛(잠기지 않은 첫 미클리어)의 일반화다
    — 이 목록의 **첫 원소가 곧 current**이고, 그 뒤가 "다음 열린 유닛"이다. 일일
    세션 진도 블록(§2.10)은 이 순서대로 문항을 모으므로 유닛이 소진되면 자동으로
    다음 유닛으로 넘어간다. 잠금 규칙은 트리 노출과 동일(is_locked 단일 정의).
    """
    result: list[Any] = []
    for order_index, unit in enumerate(ordered_units(units)):
        if is_locked(unit, progress_by_unit, unlock_floor, order_index):
            continue
        prog = progress_by_unit.get(unit.id)
        if prog is not None and prog.cleared_at is not None:
            continue
        result.append(unit)
    return result


def course_key(unit: Any) -> Any:
    """유닛의 코스 식별 키 (CO-L1, 순수) — 속성 부재·NULL은 하나의 기본 코스로 묶인다.

    `scope_units_to_course`가 GET 트리에서 쓰는 규칙(NULL=기본 코스)의 등가물인데,
    **DB 조회 없이** 성립해야 한다: `progress_block_pool`은 db 인자가 대역(None)인
    경로에서도 돌기 때문이다. seed_units는 파일 한 벌을 한 번에 적재하므로
    course_id는 전 유닛이 채워지거나 전 유닛이 NULL이다 — 섞이지 않는다.
    """
    return getattr(unit, "course_id", None)


def course_groups(units: Iterable[Any]) -> list[list[Any]]:
    """코스별 유닛 묶음 (CO-L1, 순수) — 전체 순서(ordered_units)상 **등장 순**.

    진도·왕관·잠금·스파인이 "전 코스 전 유닛"이 아니라 한 코스만 보게 하는 분할
    지점이다. 묶음 내부는 ordered_units 순서를 그대로 보존하므로, 각 묶음을
    그대로 placement_unlock_floor·open_units_in_order에 넘기면 그 코스 안에서의
    전체 순서 인덱스가 된다(코스 밖 유닛이 인덱스를 밀지 않는다 — CO-L4의 원인).
    """
    groups: dict[Any, list[Any]] = {}
    for unit in ordered_units(units):
        groups.setdefault(course_key(unit), []).append(unit)
    return list(groups.values())


def scope_units_to_unit_course(units: Iterable[Any], unit: Any) -> list[Any]:
    """`unit`이 속한 코스의 유닛만 (CO-L4, 순수) — 403 게이트의 잠금 맥락.

    트리 GET은 코스로 스코프된 집합 위에서 잠금을 평가하는데 403 게이트가 전 코스
    집합을 쓰면 **unlocked로 보이는 노드가 403**이 된다. 같은 분할 규칙(course_key)을
    쓰는 것이 그 어긋남을 구조적으로 막는 유일한 방법이다.
    """
    key = course_key(unit)
    return [u for u in units if course_key(u) == key]


def active_course_units(
    units: Iterable[Any],
    progress_by_unit: dict[Any, Any],
    abilities: list,
    level_group: str | None,
) -> tuple[list[Any], int]:
    """진도·스파인이 보는 **활성 코스**의 유닛과 그 unlock_floor (CO-L1, 순수).

    반환: (그 코스의 유닛 목록, placement_unlock_floor).

    level_group은 placement_unlock_floor에 그대로 통과시킨다 — 선해제 임계가
    학령 상대이기 때문(CO-V-2). 기본값 없음(사유는 placement_unlock_floor).

    활성 코스 = 전체 순서상 **열린 미클리어 유닛을 가진 첫 코스**. 유저별 코스
    선택 컬럼이 없으므로(스키마 무변경 — 4일차 범위) 진도 자체에서 파생한다:
    - 기본 코스(weather)는 SECTION_ORDER 선두라 신규 유저에게 항상 먼저 잡힌다
      → basic-science의 prereq=null 3유닛이 1일차부터 왕관을 가져가지 않는다.
    - 한 코스를 전부 클리어하면 다음 코스가 자동으로 활성이 된다.
    - 전 코스 클리어(열린 유닛 0)면 **마지막 코스**를 돌려준다 — 스파인이 0/0으로
      무너지지 않고 "다 끝냈다"를 그대로 표시한다.
    - 유닛이 없으면 ([], 0).
    """
    groups = course_groups(units)
    if not groups:
        return [], 0
    for group in groups:
        floor = placement_unlock_floor(abilities, group, level_group)
        if open_units_in_order(group, progress_by_unit, floor):
            return group, floor
    last = groups[-1]
    return last, placement_unlock_floor(abilities, last, level_group)


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
        meta = load_section_meta().get(section, {})
        sections.append(
            {
                "section": section,
                "subtitle": meta.get("subtitle"),
                "est_minutes": meta.get("est_minutes"),
                "topics": meta.get("topics", []),
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
        units,
        progress,
        unlock_floor=placement_unlock_floor(abilities, units, user.level_group),
    )


async def get_spine(db: AsyncSession, user: User) -> dict[str, Any]:
    """스파인 집계 조회 (R8-01 §3.3) — /progress/me 서버 계산.

    트리 노출(get_curriculum)과 동일한 잠금 규칙(배치 선해제 포함)으로
    build_spine을 평가한다. θ 읽기는 load_abilities(read-only) — ai-worker 미호출.

    **활성 코스 한 벌만 집계한다 (CO-L1·CO-L7)**: 전 코스를 합산하면 날씨 코스만
    하는 유저가 그 코스를 전부 클리어해도 헤더가 **(활성 코스 유닛 수)/(전 코스
    유닛 수)**에서 멈춰 100%에 영원히 닿지 못한다. 분모를 숫자로 적지 않는 이유는
    실제로 드리프트했기 때문이다 — 여기 "12/20"이라 박혀 있었고 시드가
    16/24가 된 뒤에도 그대로였다(2026-08-09 정정). 유닛 수의 소유자는
    `database/seed/units.json`이다. 활성 코스 판정은
    진도 블록(progress_block_pool)과 **같은 함수**를 쓰므로 "헤더가 가리키는 유닛"과
    "오늘 진도로 나오는 유닛"이 어긋날 수 없다.
    """
    units = await load_units(db)
    progress = await load_progress_by_unit(db, user)
    abilities = await weatherbrain_service.load_abilities(db, user)
    scoped, unlock_floor = active_course_units(
        units, progress, abilities, user.level_group
    )
    return build_spine(scoped, progress, unlock_floor=unlock_floor)


async def is_unit_locked(
    db: AsyncSession, user: User, unit: Unit, abilities: list | None = None
) -> bool:
    """403 게이트용 잠금 판정 — 트리 노출(get_curriculum)과 동일 규칙 적용 (§3.4).

    prereq 판정 + 배치 선해제(unlock_floor)를 is_locked 한 지점으로 통과시킨다.
    abilities 미전달 시 load_abilities(read-only, ai-worker 미호출) — 트리 GET과
    동일. 유닛 세션 발급 경로는 라우터가 refresh_abilities 1회 결과를 넘겨
    잠금 판정이 신선한 θ를 쓴다 (R8-01 §3.2 — session_service:295 전례).

    **"동일 규칙"은 잠금 함수만이 아니라 잠금이 평가되는 집합까지 같아야 성립한다
    (CO-L4)**: 트리 GET은 `?course=`로 스코프된 집합에서, 이 게이트는 전 코스
    전체(당시 20유닛, 2026-08-09 현재 24)에서 order_index·unlock_floor를 계산해
    왔다 — 그래서 트리에 unlocked로
    그려진 노드가 POST에서 403 UNIT_LOCKED로 튕겼다. 이제 **그 유닛이 속한 코스**로
    스코프한다(scope_units_to_unit_course — 단일 코스 DB에서는 전 집합과 동일).
    """
    progress = await load_progress_by_unit(db, user)
    units = scope_units_to_unit_course(await load_units(db), unit)
    if abilities is None:
        abilities = await weatherbrain_service.load_abilities(db, user)
    index_of = {u.id: i for i, u in enumerate(ordered_units(units))}
    return is_locked(
        unit,
        progress,
        unlock_floor=placement_unlock_floor(abilities, units, user.level_group),
        order_index=index_of.get(unit.id),
    )


def unit_pool_level_groups(user_level_group: str, theta: float | None) -> list[str]:
    """유닛 풀의 밴드 필터 집합 — **밴드 공백에 대한 폴백** (CO-L2·CO-L-F2·CO-L-F3).

    ⚠️ **2026-08-12부터 이 함수는 `session_service.pool_level_groups`와 같은 값을
    돌려준다.** 클라이언트 확정("무조건 배치고사에 따른 위치 배정")으로 daily 풀도
    θ 경로에서 전 밴드를 열었기 때문이다 — 즉 유닛 풀이 **먼저 옳았고** 나머지가
    따라온 형태다. 두 함수를 합치지 않고 남기는 이유는 이 자리가 넓힘의 근거
    (아래 실측·반경 검증)를 소유하고 있고, 유닛 풀만 다시 좁혀야 할 일이 생겨도
    호출측을 안 건드리게 하기 위해서다.

    `session_service.pool_level_groups`(종전: 가입 그룹 ∪ θ 매핑 그룹, 최대 2밴드)를
    유닛 풀에서만 넓힌다. 넓히는 이유는 실측이다 — 유닛 24개 × 4밴드 96칸 중
    **16칸이 0문항**(신고 가능한 3밴드로만 세도 9칸)이고, 밴드 정확 일치 필터에는
    강등 폴백이 없어 그 칸에 떨어진 유저는 **0문항 세션**을 받는다. 유닛 세션에는
    daily의 quiz-generate 폴백이 **없다**(`create_unit_session` 독스트링) —
    0문항은 복구되지 않는다.

    ⚠️ **칸 수를 여기 적는 것이 실제로 사고를 냈다**(2026-08-09 정정). 이 자리에
    "24칸(3밴드 17)"이 있었고, adult × basic-science 6태그가 **전건 0**이라
    "성인은 bs 8유닛 전부 0문항"이라고 단정했으며 `wildfire_weather` adult도 0이라
    적었다. 셋 다 지금은 거짓이다 — **같은 저작 배치(237→272건)가 그 칸들을 채우고
    이 독스트링만 안 고쳤다**. 실측 2026-08-09: adult × bs 공백은
    `bs-convection-board` **한 칸뿐**(board라 저작 대상이 아니었다),
    `wildfire_weather` adult는 **5건**. elementary board 공백은 남아 있다
    (`air-power-board`·`city-anomaly-board`·`risk-wildfire-board`·
    `risk-flood-board`) — 폴백이 필요한 이유 자체는 그대로다.

    **칸 인구의 소유자는 이 독스트링이 아니라 테스트다**:
    `backend/tests/test_curriculum_band_fallback.py`가 실 시드에서 칸을 세고
    (`TestBandHolesExistInRealSeed` = 공백이 실재함 · `TestWidenedPoolNeverStarves`
    = 넓힌 집합에는 굶주림이 없음), 저작이 진행되면 **그쪽이 먼저 빨개진다**.
    수치가 필요하면 여기가 아니라 그 파일을 읽을 것.

    **θ가 있을 때만 넓힌다.** θ 경로에서는 `build_pool_query`가 `|b − θ|`
    오름차순으로 정렬하므로, 밴드를 전부 열어도 **자기 난이도에 가장 가까운
    밴드가 먼저 나오고** 먼 밴드는 앞이 마를 때만 닿는다. 즉 넓힘이 풀을 흐리지
    않고 **빈 칸에만 작용**한다. 반대로 콜드스타트(θ None)는 정렬이 random이라
    넓히면 학령 표적이 통째로 무너지므로 **오늘 그대로 둔다**(가입 그룹 단일).
    실사용에서 θ None은 `seed_placement`가 실패한 유저뿐이다 — 가입·게스트 발급이
    개념별 θ 행을 만들고 `overall_theta`는 abilities가 빌 때만 None이다.

    **강등/승격 방향은 이 함수가 정하지 않는다.** 넓힘은 대칭이고(전 밴드), 어느
    쪽을 먼저 줄지는 거리 정렬이 판단한다 — 1차로 SQL의 `|b − θ|`, 2차로
    `rank_by_knowledge_level`의 `|kl − 단계|`. 방향을 여기 상수로 박으면 θ가 자기
    학령을 넘어선 유저에게 계속 쉬운 문항이 가거나(사다리 = 쉬운 쪽 고정) 그
    반대로 학습자를 막는다. 거리가 완전히 같을 때만 **쉬운 쪽 우선**이고, 그
    타이브레이크는 `rank_by_knowledge_level`이 단독 소유한다(사유는 그 독스트링).

    **지식 수준(knowledge_level) ±1로 좁게 넓히지 않은 이유 — 실측**: kl 창을
    재 봤고, 고정 반경은 **0문항 칸을 남긴다**(2026-08-09 실측으로 반경 1은 6칸,
    반경 2도 1칸 — 성인 × `bs-convection-board`가 그중 하나로, L2가 고치려던 바로
    그 칸이다). 시드가 태그마다 특정 단계에 통째로 비어 있어 **고정 반경은 밴드
    공백을 단계 공백으로 옮길 뿐**이다. 그래서
    **필터는 전 밴드로 열고, 정보 손실은 필터가 아니라 정렬로 줄인다** —
    `rank_by_knowledge_level`이 |kl − θ의 단계| 오름차순으로 다시 세워 성인에게
    kl 4를 kl 3보다, kl 3을 kl 2보다 먼저 준다(굶기지 않으면서 한 단계씩만 강등).

    **반경별 굶주림 실측의 소유자는 테스트다** —
    `test_curriculum_band_fallback.py::test_지식수준_고정반경으로는_굶주림이_안_풀린다`.
    위 6칸/1칸도 그 테스트와 **같은 표적 산출**(`theta_to_knowledge_level(
    LEVEL_GROUP_ITEM_B[band])`)로 센 값이라 두 자리가 갈리지 않는다. 다른 방법으로
    세면 다른 수가 나오므로(밴드 최하 단계를 표적으로 쓰면 7칸/5칸) 수치를 인용할
    때는 산출 방법을 함께 적을 것 — 종전 값 "11칸/2칸"은 저작 배치 전 실측이었다.
    """
    if theta is None:
        return session_service.pool_level_groups(user_level_group, theta)
    return sorted(
        set(weatherbrain_service.LEVEL_GROUP_BANDS)
        | set(session_service.pool_level_groups(user_level_group, theta))
    )


def rank_by_knowledge_level(items: list, target_level: int | None) -> list:
    """지식 수준 거리 |kl − target| 오름차순 재정렬 — 넓힌 풀의 정보 손실 상쇄.

    `unit_pool_level_groups`가 전 밴드를 열어 **굶주림을 없앤 뒤**, 여기서 6단계
    해상도로 다시 세워 **강등 폭을 한 단계로 줄인다**. 밴드 필터만으로는 성인
    (kl 5)이 middle_high 밴드를 받을 때 kl 3과 4가 구분되지 않는다 — 사전 b가
    밴드 단위라(CO-L-F4) SQL의 |b−θ| 정렬이 그 안에서 random으로 흩어지기
    때문이다. 이 함수가 그 한 겹을 메운다.

    **거리가 같으면 쉬운 쪽이 이긴다**(2차 키). 이것이 CO-L2의 "강등 방향" 판단
    이다: 한 단계 위 문항은 못 풀어서 **막고**, 한 단계 아래 문항은 쉬워도 여전히
    가르친다. 같은 취지가 `knowledge_level_of_level_group` 독스트링에 이미 있다
    ("과대평가는 학습자를 막는다"). 1차 키가 거리이므로 이 편향은 **동률에서만**
    작동한다 — 자기 단계에 문항이 있으면 아래로 새지 않는다.

    `target_level`이 None(콜드스타트)이면 **입력 순서를 그대로 돌려준다** — θ가
    없으면 단계 표적도 없고, 그 경로는 오늘 동작 불변이 계약이다.
    안정 정렬이라 남은 동률은 SQL이 정한 순서(|b−θ| → random, 백필은 신선도 우선)를
    유지한다. `effective_knowledge_level`은 미분류(NULL) 문항과 컬럼 없는 대역
    객체도 폴백 경로로 받는다 — 그 경우 전건 동률이라 순서가 보존된다.
    """
    if target_level is None:
        return list(items)

    def _key(item):
        level = weatherbrain_service.effective_knowledge_level(item)
        return abs(level - target_level), 0 if level <= target_level else 1

    return sorted(items, key=_key)


async def _unit_content_pool(
    db: AsyncSession,
    user: User,
    unit: Unit,
    abilities: list | None = None,
    today: date | None = None,
) -> list[ContentItem]:
    """유닛의 concept_tag+kind 문항 풀 — θ→난이도 연결 (R7-02 §3.3).

    daily 세션과 동일한 θ 풀 확장·정렬을 session_service의
    pool_level_groups+build_pool_query **재사용**으로 적용한다:
    - θ = overall_theta(abilities, unit.concept_tag). abilities 미전달 시
      load_abilities — 저장된 θ만 읽는 read-only 경로(refresh_abilities·
      ai-worker 호출 없음). 발급 경로는 라우터의 refresh_abilities 1회 결과를
      받아 풀 정렬이 신선한 θ를 쓴다 (R8-01 §3.2).
    - θ가 있으면 level_group 필터가 `unit_pool_level_groups`로 **전 밴드까지**
      확장되고(학령 풀 공백 96칸 중 0문항 16칸이 여기서 해소 — CO-L2.
      칸 인구는 test_curriculum_band_fallback.py가 소유한다),
      SQL이 |b−θ|로 좁힌 선취분을 `rank_by_knowledge_level`이 6단계 해상도로
      다시 세운다. 즉 **굶기지 않으면서 강등 폭은 한 단계**다(CO-L-F2).
      선취 배수(UNIT_POOL_PREFETCH)만큼 더 읽는 이유는 SQL LIMIT이 밴드 해상도로
      먼저 자르면 재정렬이 볼 후보가 남지 않기 때문이다 — 조회 **횟수**는 그대로다.
    - 콜드스타트(θ None)는 현행과 완전 동일: 가입 그룹 단일 + random 정렬 +
      선취 없음 + 재정렬 없음(단계 표적이 없으므로).

    ⚠️ **이 풀은 실황 문항을 내지 않는다** — `build_pool_query(live=False)`가
    `uses_live_slots=true`를 제외한다. 2026-08-12~13 사이에 잠깐 실황 예약분
    (`slot_values`·`UNIT_LIVE_CAP`·`live_rotation_window`)이 얹혀 있었으나
    **철거됐다**(사유는 모듈 상단 주석). 지금 이 풀의 소비자는 둘 다 실황을
    받으면 안 되는 자리다:
      · **두 번째 이후 유닛 세션** — 확정 사양이 「실황 0 · 보드 0」인 순수 학습.
      · **daily 진도 블록**(`progress_block_pool`) — `session_service`의 발급
        루프는 `pick["kind"] == "live"`인 문항에만 슬롯을 치환하는데 진도 블록의
        kind는 "unit"이라, 실황이 섞이면 「{today.temp_max}」 **원문이 그대로**
        화면에 나간다.
    하루 첫 유닛 세션의 실황 2건은 이 함수가 아니라 **daily 배합 경로**
    (`session_service.plan_daily_picks`)가 소유한다.

    당일 중복 방지는 **best-effort**다 (R10-01 D2·D8-5): 1차 조회는 오늘 응답분을
    제외하고(신선도 우선), 그 결과가 UNIT_SESSION_SIZE보다 적으면 제외를 뗀
    2차 조회로 부족분을 백필한다. 유닛 세션에는 daily의 quiz-generate 폴백이
    없어(create_unit_session docstring) 하드 제외하면 같은 유닛 당일 재진입이
    0문항 세션으로 깨진다 — 반복 노출보다 나쁜 회귀다.
    """
    if abilities is None:
        abilities = await weatherbrain_service.load_abilities(db, user)
    theta = weatherbrain_service.overall_theta(abilities, unit.concept_tag)
    # 표적 단계는 **유닛이 먼저**다 (CO-G1 — unit_target_level 독스트링).
    # 같은 개념이 10섹션을 가로질러 재등장하므로, 섹션이 곧 그 유닛이 겨냥하는
    # 단계다. 섹션이 단계를 말하지 않는 유닛(기초과학·대역)만 θ 파생값으로 간다.
    target_level = unit_target_level(
        unit,
        None if theta is None else weatherbrain_service.theta_to_knowledge_level(theta),
    )
    fetch_limit = UNIT_SESSION_SIZE * (1 if theta is None else UNIT_POOL_PREFETCH)

    def _pool_stmt(served_subq):
        stmt = session_service.build_pool_query(
            level_groups=unit_pool_level_groups(user.level_group, theta),
            theta=theta,
            live=False,
            served_subq=served_subq,
            weak_concepts=[unit.concept_tag],
            limit=fetch_limit,
        )
        if unit.kind == "board":
            return stmt.where(ContentItem.question_type == "board")
        return stmt.where(ContentItem.question_type != "board")

    # 기준일 — **KST**. 당일 중복 제외의 하루 경계다(UTC로 세면 09:00 KST에
    # 하루가 넘어간다 — 목의 `KST_OFFSET_MS`가 지키는 것과 같은 계약).
    day = today or datetime.now(KST).date()
    today_subq = session_service.answered_today_subq(
        user.id, session_service.kst_day_start_utc(day)
    )

    quota = UNIT_SESSION_SIZE
    fresh = list((await db.execute(_pool_stmt(today_subq))).scalars().all())
    items = rank_by_knowledge_level(fresh, target_level)[:quota]
    if len(items) >= quota:
        return items

    seen = {item.id for item in items}
    backfill = rank_by_knowledge_level(
        list((await db.execute(_pool_stmt(None))).scalars().all()), target_level
    )
    for item in backfill:
        if len(items) >= quota:
            break
        if item.id not in seen:
            seen.add(item.id)
            items.append(item)
    return items


async def progress_block_pool(
    db: AsyncSession,
    user: User,
    abilities: list | None = None,
    count: int = UNIT_SESSION_SIZE,
) -> tuple[list[ContentItem], Unit | None]:
    """일일 세션 진도 블록(R13-01 §2.10)의 문항 풀 — (items, 블록 유닛).

    현재 유닛(open_units_in_order의 첫 원소)부터 순서대로 **`_unit_content_pool`을
    재사용**해 count개까지 모은다. 한 유닛의 잔여가 모자라면 다음 열린 유닛으로
    이어붙인다(§2.10 "유닛 소진 시 다음 열린 유닛으로 자동 진행"). 그래도 모자란
    부족분은 호출측(plan_bank_picks)이 new 블록에서 메운다 — 총합 15는 불변.

    반환 unit은 **블록 첫 문항이 나온 유닛** = 왕관 대상 식별자다(호출측이
    `recipe_json.unit_block`에 기록해 왕관 대상을 정한다 — 첫 문항으로 역추론하지
    않는다). 열린 유닛이 없거나 (신규 유저·전 유닛 클리어) 풀이 비면
    (빈 목록, None) — 진도 블록 0으로 발급된다.

    **블록은 한 코스를 벗어나지 않는다 (CO-L1)**: `active_course_units`가 활성
    코스를 고르고 그 안에서만 다음 열린 유닛으로 이어붙인다. 이 경계가 없으면
    basic-science의 prereq=null 3유닛이 1일차부터 열려 있어, 기본 코스 유닛의
    풀이 5에 못 미치는 순간 블록의 다수 개념이 타 코스로 넘어가고 **왕관이 그쪽에
    붙는다** — 배합은 매일 같으므로 기본 코스 트리가 영원히 열리지 않는다.

    잠금 맥락(진도·배치 선해제)은 트리 노출과 같은 규칙을 한 번만 로드해 쓴다.
    스캔 유닛 수를 count개로 제한하는 이유는 쿼리 비용 상한이다 — **유닛당 최대
    2쿼리**(신선도 1차 + 백필 2차)라, 풀이 전부 빈 DB에서 제한 없이 훑으면 발급
    경로의 쿼리 수가 유닛 수에 비례해 늘어난다(2026-08-09 기준 24유닛 = 48쿼리.
    이 자리에 "20유닛 = 40쿼리"가 박혀 있어 시드가 자란 뒤 거짓이 됐다 —
    유닛 수는 `database/seed/units.json`이 소유하므로 곱셈만 남긴다).
    """
    if count <= 0:
        return [], None
    units = await load_units(db)
    if not units:
        return [], None
    progress = await load_progress_by_unit(db, user)
    if abilities is None:
        abilities = await weatherbrain_service.load_abilities(db, user)
    scoped, unlock_floor = active_course_units(
        units, progress, abilities, user.level_group
    )

    items: list[ContentItem] = []
    seen: set = set()
    block_unit: Unit | None = None
    for unit in open_units_in_order(scoped, progress, unlock_floor)[:count]:
        # slot_values를 넘기지 **않는다** — 이 블록은 daily 세션이 소비하고,
        # daily의 발급 루프는 kind="live"인 문항에만 슬롯을 치환한다(진도 블록의
        # kind는 "unit"). 실황을 넣으면 미치환 원문이 그대로 화면에 나간다.
        # daily의 실황 1문항은 배합의 live 블록이 이미 소유한다.
        for item in await _unit_content_pool(db, user, unit, abilities):
            if item.id in seen:
                continue
            seen.add(item.id)
            items.append(item)
            if block_unit is None:
                block_unit = unit
            if len(items) >= count:
                return items, block_unit
    return items, block_unit


async def is_first_unit_session_today(
    db: AsyncSession, user: User, today: date
) -> bool:
    """오늘 이 유저의 유닛 세션이 **아직 없는가** — 「하루 첫 세션」 판정.

    2026-08-13 클라이언트 확정: **하루의 첫 유닛 세션이 곧 데일리 세션이다.**
    그 세션만 10문항 데일리 배합을 받고 왕관을 준다.

    ⚠️ **판정을 완료 시점이 아니라 발급 시점에 하는 것이 설계의 핵심**이다.
    완료 시점에 재계산하면 경합에 진다 — 두 유닛을 열어 **역순으로** 완료하면
    "먼저 완료된 쪽"과 "먼저 발급된 쪽"이 갈려 둘 다 첫 세션이 되거나 둘 다
    아니게 된다. 발급 시점에 판정해 `recipe_json`에 도장을 찍으면 그 세션의
    성격이 발급 순간에 고정되고, 완료 경로는 **읽기만** 한다.

    **하루 경계는 KST다.** `session_date`가 이미 `datetime.now(KST).date()`
    파생이라 경계가 컬럼 자체에 들어 있다 — 여기서 UTC 타임스탬프를 다시 비교하면
    09:00 KST에 하루가 넘어간다.

    단순 count로 충분한 이유: `uq_sessions_daily` 부분 인덱스는 `unit_id IS NULL`
    에만 걸려 **유닛 행은 제약 밖**이다. 즉 DB가 "오늘 유닛 세션은 하나"를
    보장하지 않으므로, 판정은 제약이 아니라 이 질의가 한다.

    ⚠️ **잔여 위험(동시성)**: 같은 유저가 두 유닛 발급을 **동시에** 호출하면 둘 다
    0을 세어 둘 다 첫 세션 도장을 받는다(→ 왕관 2개). 막으려면 부분 유니크 인덱스
    (`mode='unit'`에도 daily 멱등 인덱스를 거는 것)가 필요한데 그것은
    마이그레이션이라 이 담당의 소유 밖이다. 실사용 창은 한 사람이 두 유닛을
    같은 순간에 여는 경우로 좁다.
    """
    return (
        await db.execute(
            select(func.count())
            .select_from(Session)
            .where(
                Session.user_id == user.id,
                Session.session_date == today,
                Session.mode == MODE_UNIT,
            )
        )
    ).scalar_one() == 0


async def create_unit_session(
    db: AsyncSession,
    user: User,
    unit: Unit,
    today: date | None = None,
    abilities: list | None = None,
) -> tuple[Session, list[dict[str, Any]]]:
    """유닛 문항으로 세션을 발급한다 (기존 세션 엔진 재사용, mode='unit', unit_id 기록).

    반환: (Session, entries — [{"quiz_id", "question", "source", "slot_filled",
    "content_item_id", "kind"}]). 잠금·미존재 판정은 라우터가 담당한다.
    abilities는 라우터의 refresh_abilities 1회 결과(R8-01 §3.2) — 풀 정렬에 전달.
    문항 풀이 비면 0문항 세션이 발급된다(데이터 저작 대기 — 클리어 불가).

    ══ **하루 첫 유닛 세션 = 데일리 세션** (2026-08-13 클라이언트 확정) ══════════

    한 함수가 **두 종류**의 세션을 낸다. 갈림은 발급 시점의 「오늘 첫 유닛 세션인가」
    하나이고, 그 판정을 `recipe_json["daily_first"]`에 **도장으로 찍는다**.

    | | 문항 수 | 배합 | 왕관 |
    |---|---|---|---|
    | 하루 **첫** 유닛 세션 | **10** | `실황2·신규4·복습3·보드1` | **준다**(만점 시) |
    | **두 번째 이후** | `UNIT_SESSION_SIZE`(4) | 실황 0 · 보드 0 — 순수 학습 | 안 준다 |

    ⚠️ **두 번째 이후가 「현행 유지」가 아니다.** 종전 4문항은 실황 2 + 일반 2였고,
    그 화면이 바로 클라이언트가 「2+4+3+1인데 왜 2+2로 뜨니」라고 지적한 대상이다.
    지금은 실황도 보드도 0이다 — 유닛 실황 경로 자체가 철거됐다(모듈 상단 주석).

    **왜 도장인가**: 완료 시점에 「이게 오늘 첫 세션이었나」를 재계산하면 경합에
    진다(`is_first_unit_session_today` 독스트링). 도장은 발급 순간에 성격을
    고정하고, `routers/session.py`의 왕관 분기는 그것을 **읽기만** 한다.
    도장은 **양쪽 분기 모두** 찍는다 — 키가 없는 세션(이 개정 이전 발급분)은
    라우터에서 False로 읽혀 왕관이 안 나간다(안전한 쪽으로 닫힘).

    첫 세션의 배합·치환·정렬은 daily와 **같은 함수**가 소유한다
    (`session_service.plan_daily_picks` → `entries_from_picks` →
    `order_session_entries`). 복사하지 않는 이유는 그 순간 두 화면이 갈리기
    때문이다 — 「오늘 날씨 2건이 앞, 오늘의 보드 1건이 끝」이라는 출제 순서까지
    같아야 "유닛 세션이 곧 데일리 세션"이 참이 된다.

    **첫 세션에도 quiz-generate 유료 폴백은 없다.** daily 경로가 뱅크 부족분을
    생성으로 메우는 것과 달리 여기서는 부족하면 **그만큼 적게** 발급한다 — 유닛
    세션에 생성 폴백이 없다는 것이 기존 계약이고(0문항 세션도 허용 — CO-H12),
    무키 실운영에서 이 경로가 상시 과금 지점이 되는 것을 막는다.
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    daily_first = await is_first_unit_session_today(db, user, today)
    entries: list[dict[str, Any]] | None = None
    if daily_first:
        try:
            plan = await session_service.plan_daily_picks(
                db, user, today, abilities=abilities
            )
        except Exception as exc:  # noqa: BLE001 — 사유는 아래
            # **학습 세션 발급은 실황·라우팅 장애로 막히지 않는다.** 이 방어는
            # 철거된 `unit_slot_values`가 갖고 있던 계약을 그대로 옮겨 온 것이다:
            # daily 배합 경로는 KMA·Redis 캐시·ai-worker에 닿으므로 무키 실운영과
            # 캐시 장애에서 터질 수 있는데, daily 세션은 그때 503으로 끝나도
            # 되지만(`GET /session/today`) **유닛 진입은 학습 자체가 막힌다**.
            # 그래서 배합을 포기하고 순수 학습 문항으로 내려앉는다.
            #
            # ⚠️ **`daily_first` 도장은 그대로 True로 남긴다** — 오늘의 첫 세션인
            # 것은 변함이 없고, 장애로 배합이 열화됐다고 왕관까지 뺏으면 학습자가
            # 서버 사정으로 진도를 잃는다.
            logger.warning(
                "첫 유닛 세션의 daily 배합 실패 — 순수 학습 문항으로 발급"
                " (user=%s unit=%s): %s",
                user.id,
                getattr(unit, "slug", None),
                exc,
            )
        else:
            entries = session_service.order_session_entries(
                session_service.entries_from_picks(plan.picks, plan.slot_values)
            )
            if plan.generate_count:
                logger.info(
                    "첫 유닛 세션 뱅크 부족 %d건 — 생성 폴백 없이 %d문항으로 발급"
                    " (user=%s unit=%s)",
                    plan.generate_count,
                    len(entries),
                    user.id,
                    getattr(unit, "slug", None),
                )
    if entries is None:
        items = await _unit_content_pool(db, user, unit, abilities, today)
        entries = [
            {
                "question": {
                    **dict(item.template_json or {}),
                    "concept_tag": item.concept_tag,
                    "question_type": item.question_type,
                    # 학습 단계 배지의 통로 (2026-08-12 담당 E 이월) — 라우터의
                    # `_to_session_item`이 `question_json`에서 읽으므로, 여기서
                    # 싣지 않으면 유닛 세션에서만 배지가 사라진다. nullable이라
                    # None이면 None 그대로 내려가고 프론트가 배지를 그리지 않는다.
                    "knowledge_level": getattr(item, "knowledge_level", None),
                },
                "source": "bank",
                # 실황이 없는 경로라 항상 False다 — 풀이 `live=False`로 조회한다.
                "slot_filled": False,
                "content_item_id": item.id,
                # 순수 학습 블록. daily의 「진도 블록」과 같은 kind를 쓰는 것이
                # 맞다 — 완료 화면이 "내 진도"로 표기하는 그 블록이다.
                "kind": "unit",
            }
            for item in items
        ]

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
        # ── 「오늘 첫 유닛 세션인가」 도장 (2026-08-13 확정) ──────────────────
        # **왕관 판정의 유일한 근거**다. `routers/session.py`는 이 값을 읽기만
        # 하고 재계산하지 않는다 — 재계산하면 두 유닛을 역순으로 완료할 때
        # 판정이 뒤집힌다(`is_first_unit_session_today` 독스트링).
        # 키가 없는 세션(개정 이전 발급분)은 라우터에서 False로 읽힌다.
        "daily_first": daily_first,
        # 첫 세션은 daily 배합을 그대로 받았다는 사실을 행에 남긴다 — 8/11~18
        # 실운영에서 "이 세션이 왜 10문항이었나"를 세션 행만으로 되짚을 수 있어야
        # 한다(daily의 `issued_count`가 같은 목적으로 있는 것과 같은 취지).
        "recipe": dict(session_service.DEFAULT_RECIPE) if daily_first else None,
        "issued_count": len(entries),
        "items": [
            {
                "quiz_id": e["quiz_id"],
                "source": e["source"],
                # 실제 치환 여부를 그대로 싣는다 — `session_today_response`가 이
                # 메타에서 slot_filled를 읽으므로, False 고정이면 치환이 화면
                # 계약에서 사라진다(재진입·재조회 응답까지).
                "slot_filled": e["slot_filled"],
                # 블록 표기(「오늘의 날씨/발견/복습/보드」)의 근거 — 첫 세션은
                # daily 배합이라 kind가 5종으로 갈린다.
                "kind": e["kind"],
            }
            for e in entries
        ],
    }
    await db.flush()
    return session, entries


async def grant_unit_crown(
    db: AsyncSession, user: User, unit_id: uuid.UUID
) -> dict[str, Any]:
    """유닛 clear 처리 (§3.2): crowns +1(crown_target까지), cleared 전환 시 +20 XP 1회.

    호출측이 부여 조건과 멱등(같은 세션·같은 퍼즐 재완료 불인정)을 이미 판정한 뒤
    호출한다 — 여기서는 왕관 가산과 cleared 전환만 담당한다.
    반환: {"crowns", "cleared", "newly_cleared", "xp_earned"}.

    **호출측은 3개다** (CO-L5 정정 — 여기 "호출측(세션 complete)"이라 단수로 적혀
    있었으나 거짓이었다. 유닛 세션 완료는 `grant_crown=False` 고정이라 왕관을 주지
    않는다 — 연습 전용):
      ⑴ 일일 세션의 진도 블록 (`routers/session.py` — 블록 전문 정답)
      ⑵ 보드 퍼즐 **최초** 클리어 (`routers/board.py` → award_crown_for_activity)
    ⑶ `/dev` 개발 경로(`routers/dev.py` action='crown'·'unlock_all')는 왕관
    유입로이지만 **이 함수를 거치지 않는다** — `UserUnitProgress`를 직접 upsert
    한다. 그래서 XP·crown_target 상한 로직을 우회한다(개발 전용이므로 의도된
    것이나, "셋 다 여기로 수렴한다"는 서술은 거짓이다).
    판정 조건은 각 유입로가 소유하므로 여기 적지 않는다 — 문서가 코드보다 앞서
    나가면 다시 거짓이 된다.
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

    스캔은 **코스별로** 돈다 (CO-L1·CO-L4): unlock_floor·order_index가 코스 안에서
    계산돼야 트리 노출과 같은 잠금 판정이 된다. 코스 간 순서는 course_groups의
    등장 순(=전체 순서상 첫 유닛 순)이고, 먼저 맞는 유닛이 나오면 거기서 멈춘다.
    개념 태그는 코스를 가로질러 유일하므로 실제로 두 코스가 경합하지 않는다.
    """
    units = await load_units(db)
    progress = await load_progress_by_unit(db, user)
    abilities = await weatherbrain_service.load_abilities(db, user)
    for group in course_groups(units):
        found = pick_crown_unit(
            group,
            progress,
            concept_tag=concept_tag,
            kind=kind,
            unlock_floor=placement_unlock_floor(abilities, group, user.level_group),
            uncleared_only=uncleared_only,
        )
        if found is not None:
            return found
    return None


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

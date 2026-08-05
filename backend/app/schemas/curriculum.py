"""커리큘럼 API 스키마 — 스프린트 R5-01 §3.2 (+ 코스 R11-01 §3 F)."""
from pydantic import BaseModel


class CourseOut(BaseModel):
    """코스 1개 (R11-01 §3 F) — read-only 목록/상세 공용.

    id·prereq_course_id는 안정 참조인 slug 문자열(UnitOut 선례). prereq는 코스 간
    선행의 **구조**만 노출한다 — 잠금 UX·판정은 웨이브 2. is_default는 기본 코스
    (weather — 기존 유저·course 파라미터 생략 시) 여부. units_total은 귀속 유닛
    수로, 기본 코스는 course_id NULL(레거시 시드) 귀속을 포함한다.
    """

    id: str
    title: str
    description: str | None = None
    course_order: int
    prereq_course_id: str | None = None
    is_default: bool
    units_total: int


class CoursesOut(BaseModel):
    """GET /courses 응답 — course_order 오름차순 목록."""

    courses: list[CourseOut]


class UnitOut(BaseModel):
    """유닛 1개 — 진도(왕관)·잠금 상태 포함.

    id·prereq_unit_id는 안정 참조인 slug 문자열이다(프론트·URL이 UUID 대신 사용).
    status는 crowns/cleared/locked에서 파생한 표시용 필드(R7-02 §3.4, additive):
    'cleared' | 'current'(잠기지 않은 첫 미클리어 유닛 정확히 1개) | 'unlocked' |
    'locked'. 기존 필드는 불변 유지.
    """

    id: str
    section: str
    unit_order: int
    title: str
    concept_tag: str
    kind: str
    crown_target: int
    prereq_unit_id: str | None = None
    crowns: int
    cleared: bool
    locked: bool
    status: str


class SectionOut(BaseModel):
    """섹션 1개 — 소속 유닛(unit_order 오름차순) + 표시용 메타(additive).

    메타 3종은 `database/seed/section_meta.json`이 소유한다. 유닛에서 파생할 수
    없는 값이라(섹션 단위 설명·소요시간·세부 주제) 시드로 둔다. 시드에 없는
    섹션은 전부 None/빈 리스트 — 프론트가 그 경우 아무것도 그리지 않으므로
    구 시드·타 코스에서도 무회귀다.

    topics는 유닛의 concept_tag(6종)보다 잘게 쪼갠 **세부 주제**다. concept_tag는
    IRT 능력 축이라 화면 설명용으로 쓰기엔 너무 굵다(한 섹션이 칩 1개가 된다).
    """

    section: str
    units: list[UnitOut]
    subtitle: str | None = None
    est_minutes: int | None = None
    topics: list[str] = []


class CurriculumOut(BaseModel):
    """GET /curriculum 응답 — 섹션→유닛 트리."""

    sections: list[SectionOut]


class CrownAward(BaseModel):
    """유닛 밖 활동의 왕관 부여 알림 (R8-01 §3.4) — 프론트 토스트용.

    보드 attempt(그 퍼즐 최초 클리어)·데일리 complete(만점) 응답의 additive
    필드로 노출된다. 대상 유닛이 없으면 필드 자체가 null(무동작).
    crowns/cleared는 grant_unit_crown 반환(부여 후 상태) 그대로.
    """

    unit_slug: str
    unit_title: str
    crowns: int
    cleared: bool

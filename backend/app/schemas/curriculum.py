"""커리큘럼 API 스키마 — 스프린트 R5-01 §3.2."""
from pydantic import BaseModel


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
    """섹션 1개 — 소속 유닛(unit_order 오름차순)."""

    section: str
    units: list[UnitOut]


class CurriculumOut(BaseModel):
    """GET /curriculum 응답 — 섹션→유닛 트리."""

    sections: list[SectionOut]

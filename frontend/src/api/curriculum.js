import client from './client';

/**
 * Curriculum API (스프린트 R5-01 계약 §3.2 — /api/v1/curriculum)
 * 단계별 학습: 섹션→유닛 트리 + 유닛 세션 발급(기존 세션 엔진 재사용).
 */

// GET /curriculum → {sections: [{section, units: [{id, unit_order, title,
//   concept_tag, kind, crown_target, crowns, cleared, cleared_at, locked, status}]}]}
//   status: 'cleared' | 'current' | 'locked' (선행 잠금 §3.2)
// R11-01 §6.2: ?course=<slug> 스코프(additive) — 생략 시 현행(기본 weather)과 동일.
export async function fetchCurriculum(course) {
  const res = await client.get('/curriculum', course ? { params: { course } } : undefined);
  return res.data;
}

// GET /courses → {courses: [{id(slug), title, description, course_order,
//   prereq_course_id(slug|null), is_default, units_total}]} — course_order 오름차순.
//   prereq는 구조 노출뿐, 잠금 아님(R11-01 웨이브 2 PM 판정 ①).
export async function fetchCourses() {
  const res = await client.get('/courses');
  return res.data;
}

// POST /curriculum/units/{unitId}/session
//   → {session_id, session_date, mode:'unit', unit_id, unit, items, progress}
//   해당 유닛 문항으로 세션 발급. 선행 미완료 시 403 UNIT_LOCKED, 없으면 404 UNIT_NOT_FOUND.
export async function startUnitSession(unitId) {
  const res = await client.post(`/curriculum/units/${unitId}/session`);
  return res.data;
}

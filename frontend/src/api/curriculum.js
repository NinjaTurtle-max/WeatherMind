import client from './client';

/**
 * Curriculum API (스프린트 R5-01 계약 §3.2 — /api/v1/curriculum)
 * 단계별 학습: 섹션→유닛 트리 + 유닛 세션 발급(기존 세션 엔진 재사용).
 */

// GET /curriculum → {sections: [{section, units: [{id, unit_order, title,
//   concept_tag, kind, crown_target, crowns, cleared, cleared_at, locked, status}]}]}
//   status: 'cleared' | 'current' | 'locked' (선행 잠금 §3.2)
export async function fetchCurriculum() {
  const res = await client.get('/curriculum');
  return res.data;
}

// POST /curriculum/units/{unitId}/session
//   → {session_id, session_date, mode:'unit', unit_id, unit, items, progress}
//   해당 유닛 문항으로 세션 발급. 선행 미완료 시 403 UNIT_LOCKED, 없으면 404 UNIT_NOT_FOUND.
export async function startUnitSession(unitId) {
  const res = await client.post(`/curriculum/units/${unitId}/session`);
  return res.data;
}

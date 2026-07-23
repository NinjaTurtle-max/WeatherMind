import client from './client';

/**
 * Placement API (스프린트 R7-01 S3 계약 — /api/v1/onboarding/placement)
 * 온보딩 배치고사(실력 진단): 가입 직후 1회, 6문항 진단 세션.
 * 문항 응답·완료는 기존 세션 엔진(sessionApi.submitSessionAnswer /
 * completeSession)을 그대로 재사용한다. 배치 세션의 answer는 구름 에너지를
 * 소모하지 않는다(429 OUT_OF_CLOUDS 없음).
 */

// POST /onboarding/placement/start
//   → 기존 GET /session/today와 동일한 SessionToday 형태
//     {session_id, items: SessionItem[6], progress: {answered, total}}
//   이미 완료한 사용자는 409 {detail, code: "PLACEMENT_ALREADY_DONE"}.
//   완료 시 POST /session/{id}/complete 응답에
//     {abilities: [{concept_tag, theta, se, n}], placement_done: true}가 포함된다.
export async function startPlacement() {
  const res = await client.post('/onboarding/placement/start');
  return res.data;
}

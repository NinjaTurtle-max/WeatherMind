import client from './client';

/**
 * Placement API (스프린트 R7-01 S3 계약 — /api/v1/onboarding/placement)
 * 온보딩 배치고사(실력 진단): 가입 직후 1회, 6문항 진단 세션.
 * 문항 응답·완료는 기존 세션 엔진(sessionApi.submitSessionAnswer /
 * completeSession)을 그대로 재사용한다. 배치 세션은 진단 전용 —
 * 구름 에너지 미소모(429 OUT_OF_CLOUDS 없음), XP·스트릭·퀘스트 미부여.
 */

// POST /onboarding/placement/start
//   → 기존 GET /session/today와 동일한 SessionToday 형태
//     {session_id, items: SessionItem[6], progress: {answered, total}}
//   이미 완료한 사용자는 409 {detail, code: "PLACEMENT_ALREADY_DONE"}.
//   완료 시 POST /session/{id}/complete 응답에 다음이 포함된다(/progress/abilities와 동일 형식):
//     {abilities: [{concept_tag, theta, theta_se, num_responses, level_label}], placement_done: true}
export async function startPlacement() {
  const res = await client.post('/onboarding/placement/start');
  return res.data;
}

// POST /onboarding/placement/submit-all (R7-02 S1)
//   body {answers: [{quiz_id, answer, elapsed_sec?}]}
//   → {results: [{quiz_id, is_correct}], progress: {answered, total}}
//   일괄 채점 — 이미 채점된 로그는 서버가 멱등 스킵(기존 결과 반환).
//   피드백 텍스트 없음(진단은 문항별 해설 없이 빠르게 진행).
export async function submitPlacementAll(answers) {
  const res = await client.post('/onboarding/placement/submit-all', { answers });
  return res.data;
}

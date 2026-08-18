import client from './client';

/**
 * 과거 예보 API (/api/v1/hindcast — MT-30).
 *
 * 채점 권위는 서버다. 회차 목록에는 실측(actual)·해설·출처가 **구조적으로 없고**,
 * 프론트가 점수를 계산할 재료 자체를 받지 못한다(detective·보드와 같은 관례).
 * 판정은 오직 submitHindcast의 응답으로만 온다.
 */

// GET /hindcast/cases → {cases: [{case_id, observed_date, region, station, title,
//   intro, climatology{temp_max, rain_prob}, is_demo_fixture, disclosure,
//   already_played}], disclosure}
//
// climatology는 그 달력날짜의 **평년값**이다 — 실측이 아니라 판단 재료다
// (duel의 base_forecast와 같은 위치). AI 캐스터도 이 값을 기준으로 예측한다.
export async function fetchHindcastCases() {
  const res = await client.get('/hindcast/cases');
  return res.data;
}

// POST /hindcast/cases/{case_id}/predict {temp_max, rain_prob}
//   → {case_id, observed_date, title, user_pred, ai_pred, actual{temp_max,
//      rain_prob, sum_rn}, user_score, ai_score, result('win'|'lose'|'draw'),
//      explanation, sources, created_at}
//   404 CASE_NOT_FOUND      — 없는 회차.
//   409 ALREADY_SUBMITTED   — 회차당 1회. 정답이 고정돼 있어 서버가 재제출을 막는다
//                             (UI가 버튼을 잠그는 것과 별개로 서버가 다시 막는다).
//   422 INVALID_PREDICTION  — 기온·강수확률 범위 밖.
export async function submitHindcast(caseId, tempMax, rainProb) {
  const res = await client.post(`/hindcast/cases/${caseId}/predict`, {
    temp_max: tempMax,
    rain_prob: rainProb,
  });
  return res.data;
}

// GET /hindcast/attempts → {attempts: [결과 형태와 동일]}  0건이면 빈 배열(200).
export async function fetchHindcastAttempts() {
  const res = await client.get('/hindcast/attempts');
  return res.data;
}

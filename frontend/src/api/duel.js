import client from './client';

/**
 * Duel API (R4-01 계약 §3.4 — /api/v1/duel)
 * 매일 AI 캐스터와 내일 예보(최고기온·강수확률) 대결. 1일 1회 제출.
 * AI 예측은 제출 후 공개, 결과(win/lose/draw)는 다음날 실측 정산 후.
 */

// GET /duel/today
//   → {duel_date, status, base_forecast|null, caster_grade(티어, R9-01 §3.2),
//      user_pred|null, ai_pred|null(제출 후 — noise_scale 스냅샷 동봉),
//      evidence|null, evidence_review|null(정산 후), actual|null,
//      user_score|null, ai_score|null, result|null}
export async function fetchTodayDuel() {
  const res = await client.get('/duel/today');
  return res.data;
}

// GET /duel/briefing (R9-01 §3.1) — 예보 브리핑 자료
//   → {region, target_date, hourly: [{datetime,tmp,pop,pcp,reh,wsd,sky,pty}],
//      today_observed: {max_ta,min_ta,sum_rn}|null, recent_days: [{date,max_ta,sum_rn}](≤7)}
//   KMA 실패·키 부재 시 실패 필드는 null/빈 배열(degraded — 예측 입력은 가능).
export async function fetchDuelBriefing() {
  const res = await client.get('/duel/briefing');
  return res.data;
}

// POST /duel/today {temp_max, rain_prob, evidence?}
//   → 오늘 대결 상태(ai_pred 공개 포함). 재제출 시 409 ALREADY_SUBMITTED.
//   evidence(R9-01 §3.1 additive): 판단 근거 코드 배열 — 빈 선택이면 미전송.
export async function submitDuel({ temp_max, rain_prob, evidence }) {
  const body = { temp_max, rain_prob };
  if (Array.isArray(evidence) && evidence.length > 0) body.evidence = evidence;
  const res = await client.post('/duel/today', body);
  return res.data;
}

// GET /duel/history
//   → Duel[] (최신순) — 정산 완료분은 actual·result·score에 더해
//     caster_grade·evidence·evidence_review(근거 적중 해설) 포함 (R9-01)
export async function fetchDuelHistory() {
  const res = await client.get('/duel/history');
  return res.data;
}

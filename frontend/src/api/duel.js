import client from './client';

/**
 * Duel API (R4-01 계약 §3.4 — /api/v1/duel)
 * 매일 AI 캐스터와 내일 예보(최고기온·강수확률) 대결. 1일 1회 제출.
 * AI 예측은 제출 후 공개, 결과(win/lose/draw)는 다음날 실측 정산 후.
 */

// GET /duel/today
//   → {duel_date, status, base_forecast?, user_pred|null, ai_pred|null(제출 후),
//      actual|null, user_score|null, ai_score|null, result|null}
export async function fetchTodayDuel() {
  const res = await client.get('/duel/today');
  return res.data;
}

// POST /duel/today {temp_max, rain_prob}
//   → 오늘 대결 상태(ai_pred 공개 포함). 재제출 시 409 ALREADY_SUBMITTED.
export async function submitDuel({ temp_max, rain_prob }) {
  const res = await client.post('/duel/today', { temp_max, rain_prob });
  return res.data;
}

// GET /duel/history
//   → Duel[] (최신순) — 정산 완료분은 actual·result·score 포함
export async function fetchDuelHistory() {
  const res = await client.get('/duel/history');
  return res.data;
}

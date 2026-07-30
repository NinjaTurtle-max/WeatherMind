import client from './client';

/** Progress API (02번 스펙 — /api/v1/progress) */

// GET /progress/me → {xp, level, streak_count, next_level_xp, ...}
//   + spine (R8-01 §3.3, additive): {units_total, units_cleared, crowns_earned,
//     crowns_total, current_unit: {slug, title} | null} — 서버 계산 스파인 집계.
export async function fetchMyProgress() {
  const res = await client.get('/progress/me');
  return res.data;
}

// GET /progress/weak-tags (R8-01 §3.5) — θ 파생 약점 개념, WeakConceptOut[]
//   → [{concept_tag, theta, threshold, num_responses}] (θ 오름차순 = 약한 순)
//   판정: num_responses > 0 AND θ < threshold(학령 상대 임계).
//   구 WeakTag[]({wrong_count, total_count, accuracy_rate, ...}) 형태를 대체.
export async function fetchWeakTags() {
  const res = await client.get('/progress/weak-tags');
  return res.data;
}

// POST /progress/attendance → {streak_count, is_new_record}
export async function checkAttendance() {
  const res = await client.post('/progress/attendance');
  return res.data;
}

// GET /progress/quests (R4-01 §3.1)
//   → [{code, title, progress, target, done, xp_reward}]
export async function fetchQuests() {
  const res = await client.get('/progress/quests');
  return res.data;
}

// GET /progress/badges (R4-01 §3.3)
//   → [{code, title, description, earned_at|null}]
export async function fetchBadges() {
  const res = await client.get('/progress/badges');
  return res.data;
}

// GET /progress/energy (R5-01 §3.3) — 구름 에너지 잔량·회복 ETA
//   → {clouds, max, next_regen_sec, updated_at}
export async function fetchEnergy() {
  const res = await client.get('/progress/energy');
  return res.data;
}

// GET /progress/abilities (R6 WeatherBrain) — 개념별 IRT 능력 θ (약한 개념 우선)
//   → [{concept_tag, theta, theta_se, num_responses, level_label, updated_at}]
//   theta: 로짓 스케일 능력치(대략 -3..+3, 높을수록 강함).
//   num_responses:0 이면 사전(prior)만 반영된 초기 배정으로 아직 측정값 아님.
export async function fetchAbilities() {
  const res = await client.get('/progress/abilities');
  return res.data;
}

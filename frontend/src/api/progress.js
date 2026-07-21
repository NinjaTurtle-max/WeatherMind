import client from './client';

/** Progress API (02번 스펙 — /api/v1/progress) */

// GET /progress/me → {xp, level, streak_count, next_level_xp}
export async function fetchMyProgress() {
  const res = await client.get('/progress/me');
  return res.data;
}

// GET /progress/weak-tags → WeakTag[] (accuracy_rate 오름차순)
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

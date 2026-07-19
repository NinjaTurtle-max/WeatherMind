import client from './client';

/** League API (02번 스펙 — /api/v1/league) */

// GET /league/current → {week_start, region, mid_forecast}
export async function fetchCurrentLeague() {
  const res = await client.get('/league/current');
  return res.data;
}

// POST /league/predict {temp_max, temp_min, rain_prob} → {"submitted": true}
export async function submitPrediction({ temp_max, temp_min, rain_prob }) {
  const res = await client.post('/league/predict', { temp_max, temp_min, rain_prob });
  return res.data;
}

// GET /league/leaderboard?week=... → LeagueRank[]
export async function fetchLeaderboard(week) {
  const res = await client.get('/league/leaderboard', { params: week ? { week } : {} });
  return res.data;
}

// GET /league/me/results → LeagueResult[]
export async function fetchMyLeagueResults() {
  const res = await client.get('/league/me/results');
  return res.data;
}

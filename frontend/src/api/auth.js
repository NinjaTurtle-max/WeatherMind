import client from './client';

/** Auth API (02번 스펙 — /api/v1/auth) */

// POST /auth/register → {user_id, access_token}
export async function register({ email, password, nickname, level_group }) {
  const res = await client.post('/auth/register', { email, password, nickname, level_group });
  return res.data;
}

// POST /auth/login → {access_token, refresh_token}
export async function login({ email, password }) {
  const res = await client.post('/auth/login', { email, password });
  return res.data;
}

// POST /auth/refresh → {access_token}
export async function refresh(refresh_token) {
  const res = await client.post('/auth/refresh', { refresh_token });
  return res.data;
}

// POST /auth/logout → {"success": true}
export async function logout() {
  const res = await client.post('/auth/logout');
  return res.data;
}

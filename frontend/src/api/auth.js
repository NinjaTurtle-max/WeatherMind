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

/**
 * GET /auth/me → {user_id, email, nickname, is_guest, level_group} (R13 P-4/P-10)
 *
 * 서버가 "너는 누구인가"를 알려주는 유일한 경로다. 게스트 판별을 클라이언트 상태에만
 * 맡기면 그 상태가 유실될 때 **로그아웃 경고가 사라진다** — 게스트는 무작위 시크릿이라
 * 재진입 경로가 없어서 그 순간 진도가 영구 소실된다.
 */
export async function me() {
  const res = await client.get('/auth/me');
  return res.data;
}

/**
 * PATCH /auth/me {level_group} → MeResponse (R13 P-5)
 *
 * 학령 신고 writer가 `POST /auth/register`의 필드 하나뿐이었다 — 게스트 진입은
 * register를 타지 않고 전환도 학령을 안 받아서, 그 동선을 탄 사람은 초등학생이든
 * 성인이든 **평생 middle_high**였다. 같은 행 갱신이라 진도·θ는 보존되고, 배합은
 * 발급 시점에 확정되므로 **다음 세션부터** 반영된다.
 */
export async function updateLevelGroup(level_group) {
  const res = await client.patch('/auth/me', { level_group });
  return res.data;
}

// POST /auth/logout → {"success": true}
export async function logout() {
  const res = await client.post('/auth/logout');
  return res.data;
}

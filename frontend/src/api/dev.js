import client from './client';

/**
 * Dev API (스프린트 R7-03 계약 — /api/v1/dev)
 * 개발자 모드 전용 인스펙터·조작 엔드포인트. DEV_MODE가 꺼진 서버는 전 경로가
 * 404를 돌려주며, 프론트는 GET /dev/state 404를 노출 게이트로 사용한다
 * (404면 DevPanel 자체를 렌더하지 않음 — 프론트 env 불필요).
 *
 * POST 응답 본문 형태는 백엔드 병렬 구현 중이라 미확정 — 프론트는 응답 본문에
 * 의존하지 않고, 조작 후 react-query invalidate로 화면을 갱신한다.
 */

// GET /dev/state — 개발자 모드 상태 인스펙터.
//   → {dev_mode: true,
//      abilities: [{concept_tag, theta, theta_se, num_responses}],
//      overall_theta, target_level_group, unlock_floor,
//      clouds, streak_count, placement_done, weak_tags}
//   DEV_MODE 꺼짐 → 404 (패널 미렌더 게이트).
export async function fetchDevState() {
  const res = await client.get('/dev/state');
  return res.data;
}

// POST /dev/reset-me {reset: true} — 내 계정 진행 전체 초기화(진도·θ·배치·자원).
export async function resetMe() {
  const res = await client.post('/dev/reset-me', { reset: true });
  return res.data;
}

// POST /dev/theta {abilities: [{concept_tag, theta, num_responses?}]} — θ 직접 설정.
export async function setTheta(abilities) {
  const res = await client.post('/dev/theta', { abilities });
  return res.data;
}

// POST /dev/placement {action: "reset"|"complete"} — 배치고사 초기화/즉시완료.
export async function setPlacement(action) {
  const res = await client.post('/dev/placement', { action });
  return res.data;
}

// POST /dev/clouds {clouds} — 구름 에너지 잔량 직접 설정(0..최대).
export async function setClouds(clouds) {
  const res = await client.post('/dev/clouds', { clouds });
  return res.data;
}

// POST /dev/curriculum {action: "unlock_all"|"crown"|"reset", unit_slug?, crowns?}
//   unlock_all: 전 유닛 잠금 해제 / crown: 특정 유닛 왕관 설정 / reset: 진도 초기화.
export async function setCurriculum({ action, unitSlug, crowns } = {}) {
  const body = { action };
  if (unitSlug != null) body.unit_slug = unitSlug;
  if (crowns != null) body.crowns = crowns;
  const res = await client.post('/dev/curriculum', body);
  return res.data;
}

// POST /dev/streak {streak_count, last_login_days_ago?} — 스트릭 상태 설정.
export async function setStreak({ streakCount, lastLoginDaysAgo } = {}) {
  const body = { streak_count: streakCount };
  if (lastLoginDaysAgo != null) body.last_login_days_ago = lastLoginDaysAgo;
  const res = await client.post('/dev/streak', body);
  return res.data;
}

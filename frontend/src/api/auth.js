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

/**
 * POST /auth/resume {email, password} → {access_token, refresh_token}
 * (2026-08-19 **오후** — 클라이언트 결정, 주최측 확인 후)
 *
 * 「진도 불러오기」의 유일한 통로다. 같은 날 오전 판은 `{nickname}`이었고
 * **그것을 뒤집었다** — *"닉네임을 통한 호출은 보안의 개별성이 약하기에"*.
 * 저장(`POST /auth/guest/convert`)이 이미 이메일+비밀번호였으므로 이제 **저장과
 * 불러오기가 같은 열쇠**를 쓴다.
 *
 * ⚠️ **`login`과 바디가 같은데도 이 이름을 쓰는 이유**: 화면에 「로그인」이라는
 * 낱말을 쓸 수 없고(대회 규정 · i18n 금칙어 계약), 프론트가 부르는 통로의 이름이
 * 화면의 이름과 같아야 추적이 끊기지 않는다. 서버에서 자격 검사는 `_authenticate`
 * **한 곳**이 소유하므로 두 문의 강도가 갈릴 여지는 없다.
 *
 * 🔴 **`nickname`을 다시 실어 보내지 말 것.** 그 순간 「이름만으로 여는 문」이
 * 되살아난다 — 그것이 이번에 닫은 결함이고, 서버가 아니라 여기서 되살아나면
 * `loadProgress.contract`(나가는 바디 키 대조)가 운다.
 *
 * 실패는 **한 갈래**다: 401 `INVALID_CREDENTIALS`. 없는 계정과 틀린 비밀번호를
 * 가르면 응답이 「그 이메일은 있다」를 자백한다(계정 열거).
 */
export async function resume({ email, password }) {
  const res = await client.post('/auth/resume', { email, password });
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

/**
 * PATCH /auth/me {nickname} → 닉네임 변경 (2026-08-19 · 8/18 롤링분 ③)
 *
 * 🔴 종전에는 닉네임 writer가 **최초 진입 1회뿐**이었다. `App.jsx`의
 * `needsEntryInfo = atEntry && entryChoice === undefined`가 이미 들어온
 * 사용자에게는 영영 거짓이라, 한 번 지나가면 「기상 학습자」로 고정됐다.
 * 같은 엔드포인트를 쓰는 이유: 학령 변경과 **같은 행 갱신**이고, 그 자리가
 * 이미 "게스트가 갇히지 않게 하는 통로"로 존재한다.
 * 중복은 409 `NICKNAME_TAKEN`(자기 자신은 제외된다).
 */
export async function updateNickname(nickname) {
  const res = await client.patch('/auth/me', { nickname });
  return res.data;
}

// POST /auth/logout → {"success": true}
export async function logout() {
  const res = await client.post('/auth/logout');
  return res.data;
}

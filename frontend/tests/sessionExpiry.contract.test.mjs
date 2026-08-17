/**
 * 세션 만료 계약 — 갱신 실패가 진도를 지우지 않는다 (2026-08-14) —
 *   node tests/sessionExpiry.contract.test.mjs
 *
 * 왜 있나. `api/client.js`의 401 인터셉터는 `refreshAccessToken()`이 **던지기만
 * 하면** 종류를 안 보고 `authStore.logout()`을 불렀고, `logout()`은 access뿐 아니라
 * **refresh 토큰까지** 지운다. 게스트 비밀번호는 무작위 시크릿이라 그 토큰이 계정에
 * 닿는 유일한 열쇠다 — 즉 **지하철에서 잠깐 끊긴 것만으로 학습자의 계정이 영구
 * 소실**됐다. 진도는 서버에 멀쩡히 남아 있는데 다시 닿을 방법이 없어진다.
 *
 * 지키는 계약
 *   ① **서버가 토큰을 거절했을 때만** 버린다 — `/auth/refresh`의 401·403.
 *   ② 나머지는 전부 **들고 있는다** — 네트워크 실패(`response` 없음)·타임아웃·
 *      5xx·429. 이것들은 토큰의 유효성에 대해 아무 말도 하지 않는다.
 *   ③ refresh 토큰이 애초에 없으면 들고 있을 것도 없다(버린다).
 *   ④ `authStore.logout()`이 **refresh 토큰까지 지운다**는 전제가 유지된다 —
 *      이 전제가 깨지면 ①②의 위험도가 통째로 바뀌므로 함께 못박는다.
 *
 * 관례: 테스트 러너 의존 없음. 이 파일은 순수 판정 함수와 스토어만 보므로
 * jsdom·vite 마운트가 필요 없다 — `boardEngine.vectors`와 같은 경량 계열이다.
 * (만료 **화면**의 동선은 `entryFlow.smoke` ⑩이 소유한다. 여기는 그 앞단
 *  「토큰을 버릴 것인가」 하나만 본다.)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');

const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const httpServer = http.createServer(vite.middlewares);
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));

// `client.js`는 localStorage를 쓰는 zustand persist를 끌어온다 — 최소 스텁.
// zustand는 `window.localStorage`를 본다(전역만 놓으면 "storage unavailable"
// 경고가 뜨고 persist가 조용히 no-op이 된다) — 둘 다 놓는다.
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.localStorage = localStorageStub;
globalThis.window = { localStorage: localStorageStub };

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

try {
  const { refreshIsUnrecoverable } = await vite.ssrLoadModule('/src/api/client.js');
  const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');

  // ── ① 서버가 거절했다 → 버린다 ──────────────────────────────────────────
  for (const status of [401, 403]) {
    ok(
      refreshIsUnrecoverable({ response: { status } }) === true,
      `① /auth/refresh ${status} → 토큰을 버린다(진짜 만료·폐기)`,
    );
  }

  // ── ② 서버가 아무 말도 안 했다 → 들고 있는다 ────────────────────────────
  const keepCases = [
    ['네트워크 실패(response 없음)', { message: 'Network Error' }],
    ['타임아웃', { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }],
    ['500', { response: { status: 500 } }],
    ['502', { response: { status: 502 } }],
    ['503', { response: { status: 503 } }],
    ['504', { response: { status: 504 } }],
    ['429(레이트 리밋)', { response: { status: 429 } }],
    ['400(형식 오류 — 토큰 판정 아님)', { response: { status: 400 } }],
    ['undefined(무엇인지 모름)', undefined],
  ];
  for (const [label, err] of keepCases) {
    ok(
      refreshIsUnrecoverable(err) === false,
      `② 🔴 ${label} → 토큰을 들고 있는다(끊긴 연결은 만료가 아니다)`,
    );
  }

  // ── ③ 들고 있을 것이 없다 ───────────────────────────────────────────────
  ok(
    refreshIsUnrecoverable(new Error('no refresh token')) === true,
    '③ refresh 토큰이 없으면 버린다(보존할 대상 자체가 없다)',
  );

  // ── ④ logout()이 지우는 범위 — ①②의 위험도가 여기 걸려 있다 ────────────
  useAuthStore.getState().setTokens({ accessToken: 'a', refreshToken: 'r' });
  useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });
  useAuthStore.getState().logout();
  const after = useAuthStore.getState();
  ok(
    after.accessToken === null && after.refreshToken === null,
    '④ logout()은 refresh 토큰까지 지운다 — 그래서 ①의 판정이 계정의 생사를 가른다',
  );

  // ── ⑤ 「계정이 있었다」는 기억은 **새로고침을 건넌다** ────────────────────
  /**
   * 🔴 만료 안내 화면(`App.jsx`의 `SessionExpired`)이 서는 근거가 이 값이다.
   * 모듈 스코프 플래그(`guestSettled`)는 페이지 로드마다 초기화되므로, 토큰이
   * 지워진 뒤 **새로고침 한 번**이면 「첫 방문자」와 구분이 안 되고 새 게스트가
   * 조용히 발급된다 — 안내 화면을 만들어도 가장 흔한 사용자 행동으로 우회된다.
   * 그래서 `hadAccount`는 ⓐ `setTokens`가 세우고 ⓑ `logout()`이 **안 지우고**
   * ⓒ persist에 실리고 ⓓ 「새로 시작하기」(`forgetAccount`)에서만 지워진다.
   */
  ok(after.hadAccount === true, '⑤-a logout()은 「계정이 있었다」를 지우지 않는다');
  const persisted = JSON.parse(localStorageStub.getItem('weathermind-auth') ?? '{}');
  ok(
    persisted?.state?.hadAccount === true,
    `⑤-b 🔴 그 기억이 persist된다(새로고침을 건넌다) — 실제 ${JSON.stringify(persisted?.state ?? null)}`,
  );
  useAuthStore.getState().forgetAccount();
  ok(
    useAuthStore.getState().hadAccount === false,
    '⑤-c 「새로 시작하기」만 그 기억을 지운다(출구가 없으면 학습자가 갇힌다)',
  );
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 세션 만료(갱신 실패 분류 · logout 범위) 통과');
process.exit(0);

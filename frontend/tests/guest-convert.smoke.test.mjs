/**
 * 게스트 온보딩 재배치 + 계정 전환 실마운트 스모크 (R11-01 웨이브 2 §6.2 — R10-J) —
 *   node tests/guest-convert.smoke.test.mjs
 *
 * R10-J의 축("투자 후 계정 유도")을 상주 가드로 만든다:
 *   1. ~~LoginPage: 게스트 CTA가 주 동선~~ **폐기(2026-08-12)** — 로그인·회원가입
 *      구조 전면 제거로 그 화면이 삭제됐다. 계약("계정 없이 시작하는 길이 주
 *      동선")은 사라진 게 아니라 **유일 동선**이 되어 `onboardingGating`
 *      시나리오 10·10-b·11로 옮겨 갔다. 본문 해당 위치의 주석 참조.
 *   2. GuestSaveBanner 렌더 조건: 게스트 && 진도 있음(xp>0 ∨ streak≥1)일 때만.
 *      진도 없으면 **null**(빈 카드 금지) — 조건을 무력화(항상 렌더)하면 2-a가 문다.
 *      정식 계정이면 진도가 있어도 null(2-c).
 *   3. ConvertAccountPage: 폼 제출 → POST /auth/guest/convert → 토큰 교체 +
 *      게스트 표식 해제(is_guest:false) + 학습 홈 복귀.
 *   4. 실패 UX: 409 EMAIL_ALREADY_EXISTS·NOT_GUEST가 사용자 언어로 안내된다.
 *
 * 관례는 onboardingGating.smoke.test.mjs와 동일: 러너 의존 없음, vite
 * middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트.
 *
 * ── 전환 목 폴백 (FE-C 목 부재 시 안전망) ─────────────────────────────────
 * mock/apiMockPlugin.js의 POST /auth/guest/convert는 FE-C 소유(같은 페이즈 착지).
 * 목에 경로가 없으면 미들웨어가 next()로 흘려보내므로, 이 테스트가 §6.2 계약
 * 형태 그대로의 폴백 미들웨어를 **목 뒤에** 단다 — 목이 있으면 목이 먼저 응답해
 * 폴백은 비활성(응답 헤더 x-weathermind-mock으로 감지·INFO 출력). 409 시나리오는
 * 두 구현이 공유하는 계약면만 쓴다: 중복 시드 'taken@weathermind.dev'(목 시드와
 * 동일하게 폴백에도 시드) · 게스트 여부는 앱과 같은 경로(POST /auth/guest ·
 * /auth/login)로 구동.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const { default: apiMockPlugin } = await import('../mock/apiMockPlugin.js');

// ── §6.2 계약 형태의 전환 폴백 (목 미착지 시에만 도달) ─────────────────────
// BE-1 계약: Bearer 필수 · {email, password, nickname?} → 200 LoginResponse.
// 게스트 아님 → 409 NOT_GUEST · 이메일 중복 → 409 EMAIL_ALREADY_EXISTS(register 의미론).
const FALLBACK_HEADER = 'guest-convert-test-fallback';
const usedEmails = new Set(['taken@weathermind.dev']); // 목의 registeredEmails 시드와 패리티
function convertFallbackPlugin() {
  return {
    name: 'guest-convert-contract-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method !== 'POST' || path !== '/api/v1/auth/guest/convert') return next();
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const send = (status, payload) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('x-weathermind-mock', FALLBACK_HEADER);
            res.end(JSON.stringify(payload));
          };
          const auth = req.headers.authorization ?? '';
          if (!auth.startsWith('Bearer ')) {
            return send(401, { detail: '인증이 필요합니다.', code: 'UNAUTHORIZED' });
          }
          // 폴백 단순화: 목의 게스트 토큰('mock-guest-access')만 게스트로 본다.
          if (!auth.slice(7).includes('guest')) {
            return send(409, { detail: '게스트 계정이 아닙니다.', code: 'NOT_GUEST' });
          }
          let body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            /* ignore */
          }
          if (!body?.email || !body?.password) {
            return send(422, { detail: 'email·password가 필요합니다', code: 'VALIDATION_ERROR' });
          }
          if (usedEmails.has(body.email)) {
            return send(409, { detail: '이미 등록된 이메일입니다.', code: 'EMAIL_ALREADY_EXISTS' });
          }
          usedEmails.add(body.email);
          send(200, { access_token: 'converted-access', refresh_token: 'converted-refresh' });
        });
      });
    },
  };
}

const vite = await createServer({
  root,
  logLevel: 'error',
  plugins: [apiMockPlugin(), convertFallbackPlugin()], // 목이 먼저 — 착지 시 폴백 자동 비활성
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const httpServer = http.createServer(vite.middlewares);
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${httpServer.address().port}`;

// ── jsdom 전역 배선 (react 모듈 로드 전에) ──────────────────────────────────
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${origin}/`,
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
// i18n 전면 외부화(R11-01 §6.3) 이후 UI 문구는 로케일을 따른다 — jsdom의
// navigator.language 기본값(en-US)에 좌우되지 않도록 제품 기본 로케일(ko)을
// 저장값으로 고정한다(i18n.smoke.test.mjs와 동일 관례). 한국어 문구 단정은 불변.
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.XMLHttpRequest = window.XMLHttpRequest;
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = NoopResizeObserver;
globalThis.ResizeObserver = NoopResizeObserver;

const xhrLog = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  xhrLog.push(`${method} ${url}`);
  return origXhrOpen.call(this, method, url, ...rest);
};

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const GuestSaveBanner = (await vite.ssrLoadModule('/src/components/GuestSaveBanner.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
const { isGuestUser, GUEST_EMAIL_DOMAIN } = await vite.ssrLoadModule('/src/modules/auth/guest.js');
const { useOnboardingGate } = await vite.ssrLoadModule('/src/lib/onboardingGate.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element, initialPath) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, element)),
  );
  return reactRoot;
}

const api = async (method, path, body) => {
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const text = () => window.document.body.textContent ?? '';

/** React 제어 입력 채우기 — placementEntry.smoke 관례(네이티브 setter + input 이벤트) */
function fillInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
const byName = (name) => window.document.querySelector(`input[name="${name}"]`);
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const submitForm = () =>
  window.document
    .querySelector('form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

// (`loggedOut()` 헬퍼는 제거됐다 — 유일한 사용처가 시나리오 1(LoginPage)이었고
//  그 시나리오가 2026-08-12에 폐기됐다. 남은 시나리오는 전부 인증 상태에서 시작한다.)
function authenticateGuest(token = 'mock-guest-access') {
  useAuthStore.getState().setTokens({ accessToken: token, refreshToken: 'mock-guest-refresh' });
  useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });
}

let failed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 폴백 활성 여부 감지(정보용) — FE-C 목이 있으면 목이 먼저 응답한다(헤더 없음).
// 게스트 아님 상태의 프로브라 어느 쪽이든 409로 끝나고 상태를 바꾸지 않는다.
const probeRes = await fetch(`${origin}/api/v1/auth/guest/convert`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer probe-token' },
  body: JSON.stringify({ email: `probe@${GUEST_EMAIL_DOMAIN}`, password: 'probe-pass-1' }),
});
const fallbackActive = probeRes.headers.get('x-weathermind-mock') === FALLBACK_HEADER;
console.log(
  fallbackActive
    ? 'INFO 전환 목 폴백 활성 — mock/apiMockPlugin.js에 POST /auth/guest/convert 미착지'
    : 'INFO mock/apiMockPlugin.js의 전환 목 사용 (테스트 폴백 비활성)',
);

try {
  // ── 1. LoginPage 시나리오는 **폐기됐다** (2026-08-12 클라이언트 지시) ──────
  //
  // 로그인·회원가입 구조가 전면 제거되면서 `LoginPage.jsx`가 삭제됐다(git rm).
  // 이 시나리오는 그 화면 안에서 "게스트 CTA가 로그인 폼보다 **앞**에 있는가"를
  // DOM 순서로 쟀다 — 화면이 없으므로 잴 대상이 없다. `/login`으로 마운트하면
  // 이제 `*` → `/`로 리다이렉트되어 단정이 통째로 헛돈다.
  //
  // **계약이 사라진 것이 아니라 더 강해졌다.** 이 시나리오가 지키던 것은
  // "계정 없이 시작하는 길이 주 동선"이었는데, 지금은 게스트 발급이 **유일한**
  // 진입이다(App.jsx `RequireAuth`의 자동 발급). 그 계약의 수신자는
  // `onboardingGating.smoke.test.mjs` 시나리오 10·10-b·11이다 —
  // 토큰 없이 진입 → POST /auth/guest 정확히 1회 → 보호 라우트 렌더,
  // 발급 실패 → 로그인 폼이 아니라 재시도 화면.
  // 배치고사 진입(구 게스트 CTA의 목적지)은 `placementEntry.smoke.test.mjs`가 문다.
  //
  // 여기서 폐기만 하고 옮기지 않으면 이월이 증발하므로 **수신자 이름을 적어 둔다**
  // (CLAUDE.md 「이월할 때는 받는 문서에 행을 만들 것」).

  // ── 2. GuestSaveBanner 렌더 조건 (변이 검증 대상) ─────────────────────────
  await scenario('배너 2-a: 게스트 + 진도 없음 → null (빈 카드 금지)', async () => {
    await api('POST', '/dev/reset-me', { reset: true }); // xp=0, streak=0
    authenticateGuest();
    const r = mount(createElement(GuestSaveBanner), '/');
    // 부정 판정은 me 도착을 기다린 뒤 본다 — 로딩 중 null과 구분.
    await waitFor(
      () => xhrLog.filter((l) => l === 'GET /api/v1/progress/me').length > 0,
      4000,
      '/progress/me 소비',
    );
    await sleep(400);
    assert(!text().includes('30초 가입'), '진도 없는 게스트에게 배너가 떴다(투자 "후" 유도 위반)');
    assert(window.document.querySelector('a[href="/account/convert"]') == null, '전환 링크가 렌더됐다');
    r.unmount();
  });

  await scenario('배너 2-b: 게스트 + 진도 있음(streak≥1) → 렌더 + /account/convert 유도', async () => {
    const st = await api('POST', '/dev/streak', { streak_count: 1 });
    assert(st.status === 200, `/dev/streak 실패 (${st.status})`);
    authenticateGuest();
    const r = mount(createElement(GuestSaveBanner), '/');
    await waitFor(() => text().includes('30초 가입'), 4000, '배너 렌더');
    assert(text().includes('진도가 쌓였어요'), '"진도가 쌓였어요" 카피가 없다');
    const link = window.document.querySelector('a[href="/account/convert"]');
    assert(link, 'ConvertAccountPage 유도 링크(/account/convert)가 없다');
    r.unmount();
  });

  await scenario('배너 2-c: 정식 계정은 진도가 있어도 null', async () => {
    // streak=1 유지 상태에서 게스트 표식 없는 일반 유저로 전환
    useAuthStore.getState().setTokens({ accessToken: 't-regular', refreshToken: 'r-regular' });
    useAuthStore.getState().setUser({ user_id: 'u-1', email: 'user@test.dev', nickname: '정회원' });
    const r = mount(createElement(GuestSaveBanner), '/');
    await sleep(500);
    assert(!text().includes('30초 가입'), '정식 계정에 게스트 저장 배너가 떴다');
    r.unmount();
  });

  // ── 3. 전환 폼 제출 → 토큰 교체 + 게스트 표식 해제 + 홈 복귀 ──────────────
  await scenario('ConvertAccountPage: 제출 → POST /auth/guest/convert → 토큰 교체·표식 해제·홈 복귀', async () => {
    // 앱과 같은 경로로 게스트 상태를 확정한다(목의 isGuest 상태 기계 구동)
    const g = await api('POST', '/auth/guest');
    assert(g.status === 201, `POST /auth/guest 실패 (${g.status})`);
    authenticateGuest(g.body.access_token);
    const before = useAuthStore.getState();
    const r = mount(createElement(App), '/account/convert');
    await waitFor(() => text().includes('30초 가입으로 진도 저장'), 4000, '전환 폼 렌더');
    assert(text().includes('그대로'), '진도 보존(같은 user_id) 안내 카피가 없다');

    fillInput(byName('email'), 'saved@test.dev');
    fillInput(byName('password'), 'password-123');
    fillInput(byName('nickname'), '구름수집가');
    const mark = xhrLog.length;
    submitForm();
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'POST /api/v1/auth/guest/convert'),
      4000,
      'POST /auth/guest/convert 발화',
    );
    await waitFor(
      () => useAuthStore.getState().accessToken !== before.accessToken,
      4000,
      '액세스 토큰 교체',
    );
    const after = useAuthStore.getState();
    assert(after.refreshToken !== before.refreshToken, 'refresh 토큰이 교체되지 않았다');
    assert(after.user?.is_guest === false, '게스트 표식이 해제되지 않았다');
    assert(after.user?.email === 'saved@test.dev', `유저 이메일 갱신 실패 — ${after.user?.email}`);
    assert(!isGuestUser(after.user), '전환 후에도 isGuestUser가 참이다');
    await waitFor(() => !text().includes('진도 저장하기'), 4000, '학습 홈 복귀(폼 이탈)');
    r.unmount();
  });

  // ── 4. 실패 UX — 목·폴백 공통 계약면(중복 시드 + 게스트 상태 기계)으로 구동 ──
  await scenario('실패 4-a: 이메일 중복 409 EMAIL_ALREADY_EXISTS → 사용자 언어 안내', async () => {
    const g = await api('POST', '/auth/guest'); // 다시 게스트로(3에서 전환됨)
    authenticateGuest(g.body.access_token);
    const r = mount(createElement(App), '/account/convert');
    await waitFor(() => text().includes('진도 저장'), 4000, '전환 폼 렌더');
    fillInput(byName('email'), 'taken@weathermind.dev'); // 목·폴백 공통 중복 시드
    fillInput(byName('password'), 'password-123');
    submitForm();
    // ⚠️ 2026-08-12(PM 승인): 종전 단정은 `이미 가입된 이메일` + `로그인`이었다.
    // 안내 문구가 바뀐 이유는 화면이 바뀌었기 때문이다 — 로그인 화면이 같은 날
    // 제거돼 "그 계정으로 로그인해 주세요"가 **갈 곳 없는 안내**가 됐고, 대회
    // 규정(화면에 「로그인」 문구 금지)과도 충돌했다. 계약의 실질은 「실패를
    // 사용자 언어로 알리고 **지금 할 수 있는 행동**을 준다」이고, 그 행동이
    // '다른 이메일로 다시 저장'으로 바뀐 것이다. 문구 부재는
    // `onboardingSave.contract.test.mjs` ③이 렌더 텍스트로 따로 문다.
    await waitFor(() => text().includes('이미 사용 중인 이메일'), 4000, '중복 이메일 안내');
    assert(text().includes('다른 이메일'), '대안 행동(다른 이메일로 저장) 안내가 없다');
    // 게스트 상태·토큰은 그대로여야 한다 — 실패가 세션을 파괴하면 진도 유실 경로
    assert(useAuthStore.getState().user?.is_guest === true, '실패 후 게스트 표식이 사라졌다');
    r.unmount();
  });

  await scenario('실패 4-b: 게스트 아님 409 NOT_GUEST → "이미 정식 계정" 안내', async () => {
    // 서버 판정은 정식 계정, 스토어는 게스트로 믿는 스테일 상태 재현
    // (다른 탭에서 이미 전환한 뒤 이 탭이 재시도하는 경우)
    await api('POST', '/auth/login', { email: 'user@test.dev', password: 'password-123' });
    useAuthStore.getState().setTokens({ accessToken: 'mock-access', refreshToken: 'mock-refresh' });
    useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });
    const r = mount(createElement(App), '/account/convert');
    await waitFor(() => text().includes('진도 저장'), 4000, '전환 폼 렌더');
    fillInput(byName('email'), 'another@test.dev');
    fillInput(byName('password'), 'password-123');
    submitForm();
    await waitFor(() => text().includes('이미 정식 계정이에요'), 4000, 'NOT_GUEST 안내');
    r.unmount();
  });

  // ── 5. 정식 계정의 직접 진입 방어 — 폼 대신 "이미 정식 계정" 화면 ─────────
  await scenario('정식 계정이 /account/convert 직접 진입 → 폼 없이 안내 + 홈 유도', async () => {
    useAuthStore.getState().setTokens({ accessToken: 't-regular', refreshToken: 'r-regular' });
    useAuthStore.getState().setUser({ user_id: 'u-1', email: 'user@test.dev', nickname: '정회원' });
    const r = mount(createElement(App), '/account/convert');
    await waitFor(() => text().includes('이미 정식 계정이에요'), 4000, '정식 계정 안내 화면');
    assert(byName('email') == null, '정식 계정에 전환 폼이 렌더됐다');
    r.unmount();
  });
  // ── 6. CO-P-4 로그아웃 확인 시나리오 2건은 **폐기됐다** (2026-08-12) ───────
  //
  // 두 시나리오("게스트 로그아웃은 확인 1단을 거친다" · "정식 계정은 즉시
  // 로그아웃")가 여기 있었다. 클라이언트 지시로 헤더 로그아웃 버튼·확인 모달·
  // `doLogout`이 통째로 제거되어(`components/Layout.jsx`) 누를 버튼이 없다.
  //
  // **CO-P-4가 무효화된 것이 아니라, 더 센 수단으로 해결됐다.** CO-P-4가 막으려던
  // 위험은 "게스트가 로그아웃을 누르면 진도가 영구 소실된다"였고 — 게스트 비밀번호는
  // 무작위 시크릿이라 재진입 경로가 없다 — 확인 모달은 그 위험을 **줄이는** 완화책
  // 이었다. 버튼 자체를 없앤 것은 위험을 **제거**한다. 로그인 화면이 사라진 지금은
  // 정식 계정에게도 돌아올 문이 없어 완화책으로는 부족하기도 했다.
  //
  // 진도를 지키는 길(계정 전환)은 그대로 살아 있고 이 파일의 시나리오 2~5가
  // 계속 문다 — GuestSaveBanner 렌더 조건 · 전환 왕복 · 409 실패 UX ·
  // 정식 계정 직접 진입 방어. 즉 **이 파일의 본론은 손대지 않았다.**
  //
  // 로그아웃 버튼이 되살아나는 회귀는 `Layout.jsx`의 주석이 경위를 들고 있고,
  // 로그인 화면 쪽은 `backend/tests/test_r13_mock_policy_parity.py`의
  // `TestNoLoginInMainFlow`가 라우트 참조 0건으로 감시한다.

  // ── 7. 학습 수준 변경 통로 (R13 CO-P-5) ───────────────────────────────────
  // 학령 신고 writer가 `POST /auth/register`의 필드 하나뿐이라, 게스트로 들어온
  // 사람은 초등학생이든 성인이든 **평생 middle_high**였고 배치고사로도 못 바꿨다.
  await scenario('CO-P-5: 게스트도 내 정보에서 학습 수준을 바꾼다(서버에 반영)', async () => {
    const g = await api('POST', '/auth/guest');
    authenticateGuest(g.body.access_token);
    const before = await api('GET', '/auth/me');
    assert(before.body.level_group === 'middle_high', '게스트 시작 기본값이 middle_high가 아니다');

    const r = mount(createElement(App), '/me');
    await waitFor(() => window.document.querySelector('[data-level-group]'), 6000, '학습 수준 카드');
    const card = () => window.document.querySelector('[data-level-group]');
    assert(card().getAttribute('data-level-group') === 'middle_high',
      '카드가 서버의 현재 학령을 반영하지 않는다');

    const pick = (label) =>
      [...card().querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    assert(pick('중·고등학생').getAttribute('aria-pressed') === 'true', '현재 선택이 표시되지 않는다');
    click(pick('초등학생'));
    await waitFor(() => card()?.getAttribute('data-level-group') === 'elementary', 4000, '학령 변경 반영');

    const after = await api('GET', '/auth/me');
    assert(after.body.level_group === 'elementary',
      `서버에 반영되지 않았다 — ${after.body.level_group}`);
    assert(text().includes('학습 수준을 바꿨어요'), '변경 결과를 사용자에게 알리지 않는다');
    r.unmount();
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 게스트 온보딩 재배치(주 CTA·저장 배너 조건·계정 전환·실패 UX) 실마운트 스모크 통과');
process.exit(0);

/**
 * 진입 동선 계약 — 접속 → 정보 입력 → 배치고사 (2026-08-13 클라이언트 요구 ⑵⑶) —
 *   node tests/entryFlow.smoke.test.mjs
 *
 * 왜 있나. 로그인·회원가입 화면이 제거되면서(대회 규정 「로그인 없이 열려야」)
 * **학령을 물을 자리가 사라졌다.** 남은 진입은 `App.jsx`의 자동 게스트 발급
 * 하나인데 그것이 `client.post('/auth/guest')` — 바디가 없었다. 서버는
 * `POST /auth/guest {level_group?}`를 이미 받는데(`routers/auth.py` guest_login)
 * 프론트가 그 문을 안 써서 **모든 게스트가 `middle_high`로 시작**했고, 그것이
 * 클라이언트가 세 번 지적한 「초등인데 중등이 나온다」의 남은 뿌리다.
 *
 * ⚠️ **이 결함은 기존 스모크로는 원리적으로 안 잡힌다.** `onboardingGating`의
 * XHR 로그는 `"POST /api/v1/auth/guest"`(메서드+URL)만 남긴다 — 바디를 안 본다.
 * 그래서 여기서는 **axios 인터셉터로 요청 본문을 직접 집는다**(`region.smoke`가
 * 위경도 비전송을 재는 데 쓴 것과 같은 관례). 목은 소유 밖이라 손대지 않는다.
 *
 * 지키는 계약
 *   ① 맨 URL(`/`) 첫 접속에는 **정보 입력 화면이 발급보다 먼저** 뜬다. 발급은
 *      한 번뿐이라, 고르기 전에 발급해 버리면 학령을 실을 문이 영영 닫힌다.
 *      그 순간까지 `POST /auth/guest`가 **아직 안 나갔음**을 함께 단정한다.
 *   ② 그 화면은 **로그인·회원가입이 아니다** — 「로그인」·「회원가입」 문구가
 *      없고, 이메일·비밀번호 입력란도 없다(규정).
 *   ③ 학습 수준을 고르면 그 값이 **발급 바디에 실린다**(`{level_group}`) —
 *      요청 본문과 그 **결과**(`GET /auth/me`의 `level_group`)를 둘 다 본다.
 *      본문만 보면 서버가 무시해도 초록이고, 결과만 보면 어느 통로로 갔는지
 *      모른다(발급 바디인지 PATCH인지) — 요구 ⑶은 **발급 바디**를 지목했다.
 *   ④ 그 다음이 **배치고사**다 — `POST /onboarding/placement/start`가 실제로
 *      나가고 진단 화면이 뜬다. 「내 정보 입력창 이후로」가 지시 원문이다.
 *   ⑤ **건너뛸 수 있다.** 아무것도 고르지 않아도 학습 화면에 도달하고, 그때
 *      발급 바디는 **비어 있으며** 서버 기본값(`middle_high`)이 그대로다
 *      (하위 호환 — 「건너뛰면 지금과 같은 기본값」).
 *   ⑥ **딥링크는 게이트를 타지 않는다.** `/board`로 바로 들어온 심사위원은
 *      정보 입력을 거치지 않고 조작 0회로 보드에 도착한다 — 규정의 가장 강한
 *      형태를 딥링크에서는 그대로 유지한다.
 *
 * ⚠️ 시나리오 순서에 의존한다. 목의 `mockAuth.levelGroup`은 **프로세스 전역**이라
 * 앞 시나리오가 `elementary`로 바꿔 놓으면 뒤 시나리오의 기본값 단정이 오염된다.
 * 그래서 ⑤(건너뛰기, 바디 없음 → `middle_high` 복귀)를 ③ **뒤에** 둔다.
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트, 하네스 로케일 **ko 고정**.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const { default: apiMockPlugin } = await import('../mock/apiMockPlugin.js');

const vite = await createServer({
  root,
  logLevel: 'error',
  plugins: [apiMockPlugin()],
  server: { middlewareMode: true, hmr: false },
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
// 한국어 문구(「로그인」·「회원가입」 부재 포함)를 단정하므로 제품 기본 로케일로 고정
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
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

const AppMod = await vite.ssrLoadModule('/src/App.jsx');
const App = AppMod.default;
const { resetGuestAutoIssue } = AppMod;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
/**
 * ⚠️ `vite.ssrLoadModule`이어야 **App과 같은 axios 인스턴스**를 잡는다. 평범한
 * `import()`는 Node ESM으로 따로 적재돼 인터셉터가 App의 요청에 안 걸린다
 * (`onboardingGating` 10-b가 같은 함정을 주석으로 남겨 두었다).
 */
const client = (await vite.ssrLoadModule('/src/api/client.js')).default;

/** `POST /auth/guest`의 요청 본문 원본 — 이 파일의 핵심 관측 지점(요구 ⑶). */
const guestBodies = [];
client.interceptors.request.use((config) => {
  if (config.url === '/auth/guest') {
    // `undefined`(바디 없음)와 `{}`(빈 객체)는 서버에서 다른 뜻이다 — 그대로 담는다.
    guestBodies.push(config.data === undefined ? undefined : JSON.parse(JSON.stringify(config.data)));
  }
  return config;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${typeof label === 'function' ? label() : label}`);
}

function mountApp(path) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(App))),
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

const $ = (sel) => window.document.querySelector(sel);
const text = () => window.document.body.textContent ?? '';
const guestCalls = (mark) => xhrLog.slice(mark).filter((l) => l === 'POST /api/v1/auth/guest');

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};
async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  }
}

/**
 * 첫 접속 상태로 되돌린다 — 토큰·모듈 플래그·관측 버퍼 전부.
 *
 * ⚠️ **지우기 전에 조용해질 때까지 기다린다.** 앞 마운트가 띄운 요청이 아직
 * 날고 있으면 그 응답의 401을 `api/client.js`의 인터셉터가 받아
 * `POST /auth/refresh` → `setTokens`로 **토큰을 되살린다**. 그러면 다음
 * 시나리오는 발급이 필요 없다고 판단해 `POST /auth/guest`가 0회가 되고,
 * "게이트를 안 탔다"와 "이미 토큰이 있었다"가 구분되지 않는다(실측 — ⑥이
 * 그 이유로 붉었다). `onboardingGating` 시나리오 11이 같은 함정을 적어 두었다.
 */
async function coldOpen() {
  await sleep(600);
  resetGuestAutoIssue();
  useAuthStore.getState().logout();
  guestBodies.length = 0;
  return xhrLog.length;
}

try {
  // ── ①②③④ 정보 입력 → 학령이 발급 바디로 → 배치고사 ──────────────────────
  await scenario('①②③④ 접속 → 정보 입력(초등학생) → 발급 바디 → 배치고사', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');

    // ① 발급보다 먼저 뜬다
    await waitFor(() => $('[data-testid="entry-info"]'), 8000, '첫 접속 정보 입력 화면');
    ok(Boolean($('[data-testid="entry-info"]')), '① 맨 URL 첫 접속에 정보 입력 화면이 뜬다');
    ok(
      guestCalls(mark).length === 0,
      `① 정보 입력 전에는 게스트 발급이 나가지 않는다(학령을 실을 문) — 실제 ${guestCalls(mark).length}회`,
    );

    // ② 로그인·회원가입이 아니다 — 규정 계약(렌더 텍스트로 문다)
    ok(!text().includes('로그인'), '② 화면에 「로그인」 문구가 없다');
    ok(!text().includes('회원가입'), '② 화면에 「회원가입」 문구가 없다');
    ok(
      $('input[type="email"]') === null && $('input[type="password"]') === null,
      '② 계정을 만드는 화면이 아니다(이메일·비밀번호 입력란 없음)',
    );
    const notice = $('[data-testid="entry-info"]');
    ok(notice.getAttribute('aria-modal') === null, '② 안내가 모달 표식을 쓰지 않는다');
    ok(
      Boolean($('[data-testid="entry-info-skip"]')),
      '② 건너뛰기 통로가 화면에 있다(규정 「로그인 없이 열려야」)',
    );

    // ③ 초등학생을 고르고 다음 — 발급 바디에 실려야 한다
    const submit = $('[data-testid="entry-info-submit"]');
    ok(submit.disabled === true, '③ 아무것도 안 고르면 「다음」이 눌리지 않는다(건너뛰기와 구분)');
    $('[data-testid="entry-info-levels"] button[data-level="elementary"]').click();
    await sleep(60);
    ok(
      $('[data-testid="entry-info-submit"]').disabled === false,
      '③ 고르면 「다음」이 열린다',
    );
    $('[data-testid="entry-info-submit"]').click();

    await waitFor(() => guestBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      guestBodies[0]?.level_group === 'elementary',
      `③ 🔴 고른 학령이 **발급 바디**로 간다 — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
    // 결과까지 — 바디만 보면 서버가 무시해도 초록이다.
    await waitFor(() => Boolean(useAuthStore.getState().accessToken), 8000, '게스트 토큰');
    const me = await api('GET', '/auth/me');
    ok(
      me.body?.level_group === 'elementary',
      `③ 서버가 그 학령으로 계정을 세운다(「초등인데 중등이 나온다」의 뿌리) — 실제 ${me.body?.level_group}`,
    );

    // ④ 그 다음이 배치고사다
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      8000,
      () => `④ 정보 입력 뒤 배치고사가 시작되지 않았다 — 이후 XHR ${JSON.stringify(xhrLog.slice(mark))}`,
    );
    ok(true, '④ 정보 입력 → 배치고사 순서로 간다(POST /onboarding/placement/start)');
    // 화면까지 — 호출만 보면 "요청은 갔는데 화면이 안 떴다"를 놓친다. 문항 도착에
    // 한 왕복이 더 걸리므로 제목이 뜰 때까지 기다린다(즉시 재면 아직 로딩 문구다).
    await waitFor(
      () => text().includes('실력 진단'),
      8000,
      () => `배치고사 화면 렌더 — 실제 "${text().replace(/\s+/g, ' ').slice(0, 60)}"`,
    );
    ok(text().includes('건너뛰기'), '④ 진단도 건너뛸 수 있다(강제가 아니다)');
    r.unmount();
  });

  // ── ⑤ 건너뛰기: 바디 없이 발급 · 기본값 유지 · 학습 도달 ────────────────────
  await scenario('⑤ 건너뛰면 바디 없이 발급되고(기본값) 학습 화면에 도달한다', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $('[data-testid="entry-info-skip"]'), 8000, '첫 접속 정보 입력 화면');
    $('[data-testid="entry-info-skip"]').click();

    await waitFor(() => guestBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      guestBodies[0] === undefined || guestBodies[0]?.level_group === undefined,
      `⑤ 건너뛰면 발급 바디가 비어 있다(서버 기본값 그대로) — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
    const me = await api('GET', '/auth/me');
    ok(
      me.body?.level_group === 'middle_high',
      `⑤ 서버 기본값 middle_high가 유지된다(하위 호환) — 실제 ${me.body?.level_group}`,
    );
    // 아무것도 입력하지 않고 학습에 도달한다 — 규정의 본문.
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'GET /api/v1/curriculum'),
      8000,
      '⑤ 건너뛰었는데 학습 화면에 도달하지 못했다',
    );
    await waitFor(() => $('[data-testid="learn-entry"]'), 8000, '학습 진입 카드');
    ok(Boolean($('[data-testid="learn-entry"]')), '⑤ 입력 0회로 학습 화면이 열린다');
    ok(
      guestCalls(mark).length === 1,
      `⑤ 발급은 여전히 정확히 1회다 — 실제 ${guestCalls(mark).length}회`,
    );
    r.unmount();
  });

  // ── ⑥ 딥링크는 게이트를 타지 않는다 (조작 0회) ──────────────────────────────
  await scenario('⑥ 딥링크(/board)는 정보 입력 없이 조작 0회로 열린다', async () => {
    const mark = await coldOpen();
    const r = mountApp('/board');
    await waitFor(() => Boolean(useAuthStore.getState().accessToken), 8000, '자동 게스트 토큰');
    ok(
      $('[data-testid="entry-info"]') === null,
      '⑥ 딥링크에는 정보 입력 화면이 끼지 않는다(규정 — 조작 0회로 열려야 한다)',
    );
    ok(
      guestCalls(mark).length === 1,
      `⑥ 딥링크는 종전처럼 자동 발급된다 — 실제 ${guestCalls(mark).length}회`,
    );
    ok(
      guestBodies[0] === undefined || guestBodies[0]?.level_group === undefined,
      `⑥ 딥링크 발급은 바디가 없다(고른 적이 없다) — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
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
console.log('OK: 진입 동선(접속 → 정보 입력 → 배치고사 · 학령이 발급 바디로 · 건너뛰기 · 딥링크) 통과');
process.exit(0);

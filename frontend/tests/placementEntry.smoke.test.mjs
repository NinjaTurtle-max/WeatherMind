/**
 * 가입→배치고사 진입 회귀 가드 (R9-09 재발 방지 a) —
 *   node tests/placementEntry.smoke.test.mjs
 *
 * R9-09 회귀: 가입 성공 시 setTokens(외부 스토어 구독은 sync 우선 플러시)가
 * RegisterPage의 navigate('/onboarding/placement')보다 먼저 렌더를 일으켜
 * RedirectIfAuthed의 <Navigate to="/">가 목적지를 덮어썼다 — 서버에
 * POST /onboarding/placement/start가 아예 도착하지 않는 증상. SSR 렌더 스모크
 * (effect 미실행)로는 잡을 수 없어, jsdom 실마운트(React 18 createRoot,
 * useEffect까지 실행) + mock 서버(mock/apiMockPlugin.js) 실호출로 가드한다.
 *
 * 시나리오 (모두 실 XHR — 단언은 서버 도달 여부):
 *   1. 가입 플로우: /register에서 폼 제출 → placement/start 호출 발생 +
 *      배치고사 화면 도달 (R7 스모크에 있었으나 상주화되지 않아 회귀를 놓친 지점)
 *   2. PlacementPage 단독 마운트: 마운트 크래시·쿼리 미발화 가드
 *   3. daily(/daily)·unit(/learn/units/:id) 세션 무회귀: 각 세션 로드 호출 발생
 *
 * 관례: 테스트 러너 의존 없는 node 직접 실행. jsdom은 devDependency.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

// ── mock API 서버 (vite middlewareMode + apiMockPlugin, 임시 포트) ──────────
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const { default: apiMockPlugin } = await import('../mock/apiMockPlugin.js');

const vite = await createServer({
  root,
  logLevel: 'error',
  plugins: [apiMockPlugin()],
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
  url: `${origin}/register`,
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.XMLHttpRequest = window.XMLHttpRequest; // axios가 브라우저(XHR) 어댑터를 쓰게
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;

// XHR 관찰 — 실호출은 그대로 통과시키고 "서버에 어떤 요청이 나갔는가"만 기록
const xhrLog = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  xhrLog.push(`${method} ${url}`);
  return origXhrOpen.call(this, method, url, ...rest);
};

const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack ?? e.message)));

// ── React 앱 마운트 도우미 ──────────────────────────────────────────────────
const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const PlacementPage = (await vite.ssrLoadModule('/src/modules/onboarding/PlacementPage.jsx')).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element, initialPath) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, element)),
  );
  return reactRoot;
}

// React 18 제어 입력에 값 주입(네이티브 setter + input 이벤트)
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

let failed = 0;
async function scenario(name, fn) {
  const mark = xhrLog.length;
  try {
    await fn(mark);
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
    console.error(`  이후 XHR: ${JSON.stringify(xhrLog.slice(mark))}`);
    if (pageErrors.length) console.error(`  page errors: ${pageErrors.join(' | ')}`);
  }
}

const since = (mark) => xhrLog.slice(mark);

try {
  // ── 1. 가입 플로우: register 폼 제출 → placement/start 도달 (핵심 회귀 가드) ──
  await scenario('가입 → 배치고사 진입 (placement/start 호출 발생)', async (mark) => {
    const rootEl = mount(createElement(App), '/register');
    await waitFor(() => window.document.querySelector('input[name="email"]'), 3000, '회원가입 폼 렌더');
    setInputValue(window.document.querySelector('input[name="email"]'), `smoke-${Date.now()}@test.dev`);
    setInputValue(window.document.querySelector('input[name="password"]'), 'passw0rd!');
    setInputValue(window.document.querySelector('input[name="nickname"]'), '스모크');
    await sleep(30);
    window.document.querySelector('form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(
      () => since(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      6000,
      'POST /onboarding/placement/start 발화 — 가입 직후 배치고사 미진입 회귀(R9-09)',
    );
    // 화면도 배치고사(전체 화면, '건너뛰기' 헤더)에 도달했는지 확인
    await waitFor(
      () => window.document.body.textContent.includes('건너뛰기'),
      3000,
      '배치고사 화면 렌더(건너뛰기 헤더)',
    );
    rootEl.unmount();
  });

  // ── 2. PlacementPage 단독 마운트: 크래시 없음 + 쿼리 발화 ──────────────────
  await scenario('PlacementPage 단독 마운트 → 쿼리 발화', async (mark) => {
    const rootEl = mount(createElement(PlacementPage), '/onboarding/placement');
    await waitFor(
      () => since(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      4000,
      'PlacementPage 마운트 시 placement/start 발화',
    );
    if (pageErrors.length) throw new Error(`마운트 중 페이지 에러: ${pageErrors[0]}`);
    rootEl.unmount();
  });

  // ── 3. daily/unit 세션 무회귀: 세션 로드 호출 발생 ─────────────────────────
  await scenario('daily 세션(/daily) 무회귀 — GET /session/today 발화', async (mark) => {
    const rootEl = mount(createElement(App), '/daily'); // 시나리오 1의 토큰이 스토어에 남아 인증 통과
    await waitFor(
      () => since(mark).some((l) => l === 'GET /api/v1/session/today'),
      4000,
      'GET /session/today 발화',
    );
    rootEl.unmount();
  });

  await scenario('unit 세션(/learn/units/:id) 무회귀 — 유닛 세션 발급 발화', async (mark) => {
    const unitId = 'u0000001-0000-4000-8000-000000000001'; // mock 커리큘럼 1번 유닛
    const rootEl = mount(createElement(App), `/learn/units/${unitId}`);
    await waitFor(
      () => since(mark).some((l) => l === `POST /api/v1/curriculum/units/${unitId}/session`),
      4000,
      '유닛 세션 발급 POST 발화',
    );
    rootEl.unmount();
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 가입→배치고사 진입 + 세션 3경로 실마운트 스모크 통과');
process.exit(0);

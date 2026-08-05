/**
 * 홈 대시보드 실마운트 스모크 —
 *   node tests/home.smoke.test.mjs
 *
 * 시안 `Soft Cloud 홈`을 앱에 옮긴 화면(`/`)이다. 관례는 다른 스모크와 동일:
 * 테스트 러너 의존 없음, vite middlewareMode + mock/apiMockPlugin(실 XHR) +
 * jsdom 실마운트.
 *
 * 여기서 지키는 것
 *   ① `/`는 홈, 학습 경로는 `/learn` — 라우트가 갈렸다(2026-08-05).
 *   ② 내비 항목은 **한 곳(navItems.js)이 소유**한다. 탭바와 사이드바가 다른
 *      목록을 갖게 되면 뷰포트별로 갈 수 있는 화면이 달라진다.
 *   ③ **연속 출석에 미래 요일을 칠하지 않는다.** 서버는 요일별 이력을 주지 않고
 *      streak_count(연속 일수)만 주는데, 이를 요일 칸에 잘못 대응시켜 오늘이
 *      수요일인데 금·토·일이 체크돼 보였다(실제로 그랬다).
 *   ④ level_label(beginner/intermediate/advanced)은 **번역해서** 보여준다 —
 *      서버 원문이 화면에 그대로 나오면 안 된다.
 *   ⑤ 출석 체크(POST /progress/attendance)는 **홈이 만들고, 학습 경로로 이동해도
 *      다시 부르지 않는다**. (useAttendance가 sessionStorage로 하루 1회를 이미
 *      보장하므로 이건 중복 방지가 아니라 "출석의 소유자는 홈"이라는 계약이다.)
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
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

const httpServer = http.createServer((req, res) => {
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ detail: 'not found', code: 'NOT_FOUND' }));
  });
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${httpServer.address().port}`;

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
// 한국어 문구를 단정하므로 로케일을 제품 기본값(ko)으로 고정한다.
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
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
const { NAV_ITEMS } = await vite.ssrLoadModule('/src/components/navItems.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(initialPath) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, createElement(App))),
  );
  return reactRoot;
}

useAuthStore.getState().setTokens({ accessToken: 't-home', refreshToken: 'r-home' });
useAuthStore.getState().setUser({ user_id: 'home-smoke', email: 'home@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

// ── ② 내비 단일 소유 (렌더 없이도 확인 가능) ────────────────────────────────
ok(NAV_ITEMS.length === 6, `내비 항목 6개 — 실제 ${NAV_ITEMS.length}`);
ok(NAV_ITEMS[0].to === '/' && NAV_ITEMS[1].to === '/learn', '첫 항목이 홈, 둘째가 학습');

// ── ① `/`는 홈 대시보드 ─────────────────────────────────────────────────────
{
  const r = mount('/');
  await waitFor(() => text().includes('바로 시작하기'), 6000, '홈 렌더');

  ok($('.wm-scroller') === null, '홈에는 학습 트랙(.wm-scroller)이 없다');
  for (const label of ['오늘의 목표', '연속 출석', '다시 볼 개념', 'WeatherBrain']) {
    ok(text().includes(label), `홈 카드: ${label}`);
  }

  // 탭바·사이드바가 같은 목록을 쓴다(둘 다 DOM에 있다 — CSS로만 갈린다)
  const tabs = $$('[data-testid="tabbar"] a');
  const sides = $$('[data-testid="sidenav"] nav a');
  ok(tabs.length === 6 && sides.length === 6, `탭바 6 · 사이드바 6 — 실제 ${tabs.length}/${sides.length}`);
  const hrefs = (els) => els.map((a) => a.getAttribute('href')).join(',');
  ok(hrefs(tabs) === hrefs(sides), `두 내비의 목적지가 같다 — ${hrefs(tabs)}`);

  // 학습 세션 카드 → /learn, 부제는 현재 유닛
  const learnCard = $$('a[href="/learn"]').find((a) => a.textContent.includes('학습 세션'));
  ok(Boolean(learnCard), '학습 세션 카드가 /learn을 가리킨다');
  ok(/기단의 성질|첫 유닛/.test(learnCard?.textContent ?? ''), `카드 부제가 현재 유닛 — "${learnCard?.textContent?.slice(0, 40)}"`);

  // ④ level_label 번역 — abilities는 별도 쿼리라 도착을 기다린다
  await waitFor(() => /초급|중급|고급/.test(text()), 6000, 'WeatherBrain 범례');
  ok(!text().includes('intermediate') && !text().includes('beginner'),
     'level_label 원문(intermediate/beginner)이 화면에 남지 않는다');
  ok(/초급|중급|고급/.test(text()), 'level_label이 한국어로 보인다');

  // ③ 연속 출석 — 미래 요일을 칠하지 않는다
  const weekCells = $$('[class*="rounded-[9px]"]').filter((d) => ['✓', '·'].includes(d.textContent.trim()));
  ok(weekCells.length === 7, `출석 칸 7개 — 실제 ${weekCells.length}`);
  const todayIdx = (new Date().getDay() + 6) % 7; // 월=0 … 일=6
  const futureFilled = weekCells.filter((d, i) => i > todayIdx && d.textContent.trim() === '✓').length;
  ok(futureFilled === 0, `오늘 이후 요일은 비어 있다 — 채워진 미래 칸 ${futureFilled}`);

  // ⑤ 출석 체크는 홈이 만든다 — 비동기라 도착을 기다린다
  const attendance = () => xhrLog.filter((l) => l.includes('/attendance')).length;
  await waitFor(() => attendance() >= 1, 6000, '홈의 출석 POST');
  ok(attendance() === 1, `홈 진입에서 출석 POST 1회 — 실제 ${attendance()}`);

  r.unmount();
}

// ── ① `/learn`은 학습 경로 · ⑤ 여기서는 출석 POST 없음 ──────────────────────
{
  const before = xhrLog.filter((l) => l.includes('/attendance')).length;
  const r = mount('/learn');
  await waitFor(() => $('.wm-scroller') !== null, 6000, '학습 트랙 렌더');
  ok(true, '/learn에 학습 트랙이 뜬다');
  ok(!text().includes('바로 시작하기'), '/learn에는 홈 카드가 없다');
  await sleep(400);
  const after = xhrLog.filter((l) => l.includes('/attendance')).length;
  ok(after === before, `학습 경로는 출석을 POST 하지 않는다 — 증가 ${after - before}`);
  r.unmount();
}

await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 홈 대시보드(라우트 분리·내비 단일 소유·출석 단일 호출·요일 채움·라벨 번역) 스모크 통과');
process.exit(0);

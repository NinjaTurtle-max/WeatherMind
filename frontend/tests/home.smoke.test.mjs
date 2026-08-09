/**
 * 학습 화면(홈 흡수) 실마운트 스모크 —
 *   node tests/home.smoke.test.mjs
 *
 * **2026-08-09에 홈 화면이 사라졌다**(사용자 지시). `/`는 홈 대시보드였고 `/learn`이
 * 학습 경로였는데, 둘을 학습 하나로 합쳤다. 이 파일은 종전 홈 스모크를 그 화면
 * 기준으로 옮긴 것이다 — 파일명·npm 스크립트(`test:home`)는 ci.sh FRONT_TESTS와
 * 짝이라 그대로 둔다.
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트.
 *
 * 여기서 지키는 것 — ①③④는 홈이 갖고 있던 계약이고, 소비 화면만 바뀌었다.
 *   ① `/`는 **`/learn`으로 리다이렉트**한다. 지우지 않는 이유: 로그인 성공 경로·
 *      북마크·딥링크가 전부 `/`로 들어온다. 「홈」 탭은 사라졌다(7 → 6).
 *   ② 내비 항목은 **한 곳(navItems.js)이 소유**한다. 탭바와 사이드바가 다른
 *      목록을 갖게 되면 뷰포트별로 갈 수 있는 화면이 달라진다.
 *   ③ 진입 카드는 **하나**고(§2.5), 현재 유닛을 제목으로 가리키며, 화자는
 *      **물방울이(/drop.png)**다. 홈 시절엔 태양이로 적혀 있었는데 그건 보드
 *      담당이라 사이드바 튜터(/learn → drop)와 어긋났다(2026-08-09 정정).
 *   ④ 오늘의 목표는 **진입 카드 안**에 있다. 미설정이면 줄째 뜨지 않는다 —
 *      0/0 진행 바는 "목표를 못 채웠다"로 읽힌다.
 *   ⑤ 출석 체크(POST /progress/attendance)의 **소유자는 이 화면**이다. 홈이
 *      갖고 있던 계약을 그대로 넘겨받았다 — 넘기지 않으면 출석 POST를 만드는
 *      화면이 앱에서 사라져 스트릭이 영영 안 오른다.
 *   ⑥ 흰 카드를 늘리지 않는다. 복습·자유 세션·지역은 **카드가 아니라 링크**로
 *      화면 맨 아래 줄에 있다(§2.5가 없앤 "무엇을 누를지 모름"의 재발 방지).
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
// CO-N-1 ②(2026-08-08): 「탐구」(/explore)가 6탭 어디에도 없어 URL을 손으로 쳐야
// 도달했다 — 심사 배점 ②가 가리키는 화면이라 내비에 세웠다.
// 2026-08-09: 「홈」이 빠져 7 → 6.
ok(NAV_ITEMS.length === 6, `내비 항목 6개 — 실제 ${NAV_ITEMS.length}`);
ok(NAV_ITEMS.some((i) => i.to === '/explore'), '내비에 /explore가 없다(CO-N-1 ②)');
ok(NAV_ITEMS[0].to === '/learn', `첫 항목이 학습 — 실제 ${NAV_ITEMS[0].to}`);
ok(!NAV_ITEMS.some((i) => i.to === '/'), '내비에서 홈(/)이 빠졌다 — 홈 화면은 삭제됐다');

// ── ① `/` → `/learn` 리다이렉트 + 화면 구성 ─────────────────────────────────
{
  const r = mount('/');
  // 리다이렉트가 걸리면 학습 트랙이 뜬다(홈에는 트랙이 없었다).
  await waitFor(() => $('.wm-scroller') !== null, 6000, '/ → /learn 리다이렉트 후 학습 트랙');
  ok(true, '`/`가 학습 화면으로 리다이렉트된다');

  // 탭바·사이드바가 같은 목록을 쓴다(둘 다 DOM에 있다 — CSS로만 갈린다)
  const tabs = $$('[data-testid="tabbar"] a');
  const sides = $$('[data-testid="sidenav"] nav a');
  ok(tabs.length === 6 && sides.length === 6, `탭바 6 · 사이드바 6 — 실제 ${tabs.length}/${sides.length}`);
  const hrefs = (els) => els.map((a) => a.getAttribute('href')).join(',');
  ok(hrefs(tabs) === hrefs(sides), `두 내비의 목적지가 같다 — ${hrefs(tabs)}`);

  // ③ 진입 카드 1개 — 현재 유닛 · 물방울이
  await waitFor(() => $('[data-testid="learn-entry"]') !== null, 6000, '진입 카드');
  const entries = $$('[data-testid="learn-entry"]');
  ok(entries.length >= 1, `진입 카드가 렌더된다 — ${entries.length}개(PC/모바일 각 1)`);
  await waitFor(() => entries[0].textContent.includes('기단의 성질'), 6000, '진입 카드 현재 유닛');
  ok(/기단의 성질|첫 유닛/.test(entries[0].textContent), `카드 제목이 현재 유닛 — "${entries[0].textContent.slice(0, 30)}"`);
  ok(entries[0].getAttribute('data-entry-kind') === 'unit', `진입 종류 unit — 실제 ${entries[0].getAttribute('data-entry-kind')}`);
  const mascotSrc = entries[0].querySelector('img')?.getAttribute('src');
  ok(mascotSrc === '/drop.png', `진입 카드 화자는 물방울이 — 실제 ${mascotSrc}`);

  // ④ 오늘의 목표 — 목 기본값은 미설정(null)이라 줄이 **없어야** 한다
  ok($('[data-testid="learn-goal"]') === null, '목표 미설정이면 오늘의 목표 줄을 그리지 않는다');

  // ⑥ 홈이 갖고 있던 카드들이 카드로 돌아오지 않았다
  for (const gone of ['연속 출석', 'WeatherBrain']) {
    ok(!text().includes(gone), `홈 카드가 되살아나지 않았다 — ${gone} 없음`);
  }
  ok(!text().includes('안녕하세요'), '홈 인사말이 되살아나지 않았다');
  ok($('[data-testid="review-queue-card"]') === null, '복습은 카드가 아니라 아래 줄(strip)이다');

  // ⑤ 출석 체크는 이 화면이 만든다 — 비동기라 도착을 기다린다
  const attendance = () => xhrLog.filter((l) => l.includes('/attendance')).length;
  await waitFor(() => attendance() >= 1, 6000, '학습 화면의 출석 POST');
  ok(attendance() === 1, `학습 화면 진입에서 출석 POST 1회 — 실제 ${attendance()}`);

  r.unmount();
}

// ── ④ 목표를 정하면 진입 카드 안에 뜬다 ─────────────────────────────────────
{
  // 목 서버에 목표를 직접 심는다(화면을 통하지 않는다 — 여기서 보려는 것은
  // "목표가 있으면 진입 카드 안에 뜨는가"이지 목표 설정 UI가 아니다).
  const res = await fetch(`${origin}/api/v1/progress/daily-goal`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t-home' },
    body: JSON.stringify({ items: 5 }),
  });
  ok(res.ok, `목표 설정 API 200 — 실제 ${res.status}`);
  const r = mount('/learn');
  await waitFor(() => $('[data-testid="learn-goal"]') !== null, 6000, '오늘의 목표 줄');
  const goal = $('[data-testid="learn-goal"]');
  ok(goal.textContent.includes('5'), `목표 문항 수가 보인다 — "${goal.textContent.replace(/\s+/g, ' ').slice(0, 40)}"`);
  ok(
    goal.closest('[data-testid="learn-entry"]') !== null,
    '오늘의 목표는 진입 카드 **안**에 있다(별도 카드가 아니다)',
  );
  r.unmount();
}

await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 학습 화면(홈 흡수 — / 리다이렉트·내비 6·진입 카드 1개·물방울이·목표 내장·출석 소유자) 스모크 통과');
process.exit(0);

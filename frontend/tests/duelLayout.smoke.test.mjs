/**
 * 예보 대결 배치 스모크 —
 *   node tests/duelLayout.smoke.test.mjs
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트. 로케일은 ko 고정(한국어 단정).
 *
 * 여기서 지키는 것 (2026-08-06 시안 — 자료 왼쪽 / 판단·제출 오른쪽)
 *   ① 미제출 화면은 **2열**이다: 브리핑 카드와 「근거+폼」 열이 같은 격자의
 *      형제다. 세로로 쌓으면 브리핑 차트 5종을 다 지나야 입력칸이 나오고,
 *      값을 채우는 동안 근거가 된 차트가 화면 밖이라 되짚어 올라가야 했다.
 *   ② 격자에 `grid-cols-[minmax(0,1fr)]`이 있다. 없으면 격자 항목의 기본
 *      min-width:auto 때문에 브리핑 안의 하늘 타임라인(8칸 × 52px, 자체
 *      가로 스크롤)이 카드를 밀어 390px에서 카드가 476px가 된다 — 페이지에
 *      가로 스크롤이 생겼다(실측). lg:grid-cols-2는 Tailwind가 이미 깔아 준다.
 *   ③ 오른쪽 열은 sticky다. 브리핑이 두 배 넘게 길어(1440 실측 940 ↔ 615)
 *      아래 차트를 보러 내려가면 입력칸이 화면 밖으로 나간다.
 *   ④ 예보 대결의 튜터는 **태풍이**다(Mascot 배정표 + SideNav TUTOR_BY_PATH).
 *
 * ①~③은 CSS 계산이 필요한 계약인데 jsdom에는 레이아웃 엔진이 없다. 그래서
 * "클래스가 붙어 있다"까지만 본다 — 실제 픽셀은 브라우저 실측으로 확인했고,
 * 여기서 막고 싶은 것은 그 클래스가 정리 중에 사라지는 회귀다.
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
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'SVGElement']) {
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

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

useAuthStore.getState().setTokens({ accessToken: 't-duel', refreshToken: 'r-duel' });
useAuthStore.getState().setUser({ user_id: 'duel-smoke', email: 'duel@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

const container = window.document.getElementById('root');
const reactRoot = createRoot(container);
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
});
reactRoot.render(
  createElement(QueryClientProvider, { client: qc },
    createElement(MemoryRouter, { initialEntries: ['/duel'] }, createElement(App))),
);

await waitFor(() => text().includes('예보 브리핑'), 8000, '브리핑 카드 렌더');
await waitFor(() => $$('form').length > 0, 8000, '예측 입력 폼 렌더');

// ── 세 덩어리가 다 있다 ─────────────────────────────────────────────────────
const heading = (t) => $$('h2, h3').find((e) => e.textContent.includes(t));
const briefingCard = heading('예보 브리핑')?.closest('.rounded-2xl') ?? null;
const evidenceCard = heading('근거')?.closest('.rounded-2xl') ?? null;
const form = $('form');
ok(Boolean(briefingCard), '왼쪽: 예보 브리핑 카드');
ok(Boolean(evidenceCard), '오른쪽: 판단 근거 고르기 카드');
ok(Boolean(form), '오른쪽: 예측 입력 폼');

// ── ① 2열 — 브리핑 칸과 「근거+폼」 칸이 같은 격자의 형제 ────────────────────
// 격자를 briefingCard.parentElement로 잡지 않는다 — 카드를 div로 한 겹 감싸는
// 순간(실제로 degraded 높이 때문에 감쌌다) 부모가 격자가 아니게 돼 검사 전체가
// 무너진다. 격자는 클래스로 찾고, 두 덩어리가 **서로 다른 칸**에 들어 있는지를
// 포함 관계로 본다. 구조 리팩터링에는 견디고 배치가 깨지면 잡힌다.
const grid = $$('div').find((d) => d.className.includes?.('lg:grid-cols-2')) ?? null;
const gridCls = grid?.className ?? '';
ok(Boolean(grid), `격자가 lg에서 2열 — "${gridCls}"`);

const cellOf = (node) =>
  grid && node ? [...grid.children].find((c) => c.contains(node)) ?? null : null;
const leftCell = cellOf(briefingCard);
const rightColumn = cellOf(evidenceCard);
ok(Boolean(leftCell) && Boolean(rightColumn), '브리핑·근거가 각각 격자 칸 안에 있다');
ok(
  Boolean(leftCell && rightColumn && leftCell !== rightColumn),
  '브리핑과 근거가 **서로 다른** 칸이다(세로로 쌓이지 않았다)',
);
ok(
  Boolean(rightColumn && form && rightColumn.contains(form)),
  '폼이 근거와 **같은** 오른쪽 칸 안에 있다',
);

// ── ② 격자 항목이 줄어들 수 있다 (390px 가로 넘침 회귀 방지) ────────────────
ok(
  gridCls.includes('grid-cols-[minmax(0,1fr)]'),
  `격자 항목 최소폭 0 — 없으면 브리핑 카드가 좁은 화면을 밀어낸다. "${gridCls}"`,
);

// ── ③ 오른쪽 열 sticky ──────────────────────────────────────────────────────
const stickyInner = rightColumn?.firstElementChild ?? null;
ok(
  Boolean(stickyInner && stickyInner.className.includes('lg:sticky')),
  `오른쪽 칸 안쪽이 sticky — "${stickyInner?.className ?? '(없음)'}"`,
);
ok(
  Boolean(rightColumn && !rightColumn.className.includes('lg:items-start') && !gridCls.includes('lg:items-start')),
  'items-start를 쓰지 않는다 — 칸이 늘어나야 sticky가 따라 내려온다',
);

// ── ③-2 리그로 가는 통로 (2026-08-11 합친 화면) ─────────────────────────────
//
// 리그는 내비에서 빠졌다 — 이 화면의 탭이 **앱에서 리그로 가는 유일한 길**이다.
// navItems에 없다는 단정만으로는 부족하다: 없애 놓고 통로도 안 만들면 그 단정은
// 통과하는데 화면은 도달 불가가 된다(CO-N-1 ②가 정확히 그 사고였다).
const leagueTab = $('[data-compete-tab="/league"]');
ok(Boolean(leagueTab), '탭바에 리그로 가는 링크가 없다 — 리그가 도달 불가 화면이 된다');
ok(
  leagueTab?.getAttribute('href') === '/league',
  `리그 탭이 /league로 간다 — 실제 ${leagueTab?.getAttribute('href')}`,
);
const duelTab = $('[data-compete-tab="/duel"]');
ok(
  duelTab?.getAttribute('aria-current') === 'page' && !leagueTab?.getAttribute('aria-current'),
  '지금 보고 있는 탭만 aria-current="page"',
);
// 내비도 이 화면을 **자기 것으로 표시해야 한다**. /league에서 어느 항목과도
// 안 맞아 아무 데도 안 켜지던 것을 navItems.isNavActive(alsoMatch)로 고쳤다.
const { NAV_ITEMS, isNavActive } = await vite.ssrLoadModule('/src/components/navItems.js');
const owner = NAV_ITEMS.filter((i) => isNavActive(i, '/league'));
ok(owner.length === 1 && owner[0].to === '/duel', `/league를 담당하는 내비 항목 1개 — ${owner.map((i) => i.to)}`);

// ── ③-3 로딩·오류에서도 껍데기(=탭바)가 남는가 ──────────────────────────────
//
// 조회가 실패했다고 리그까지 못 가면 안 된다. 목을 실패시킬 수단이 없어
// **소스 계약**으로 고정한다(BoardPage의 data-board-next 선례와 같은 방식) —
// 두 분기가 껍데기 밖으로 일찍 return하면 잡힌다. 위 단정들은 성공 경로만
// 지나므로, 이 검사가 없으면 early return을 되살려도 CI가 초록이다.
const { readFile } = await import('node:fs/promises');
for (const [rel, guard] of [
  ['src/modules/duel/DuelPage.jsx', 'todayQ.isLoading'],
  ['src/modules/league/LeaguePage.jsx', 'currentQ.isLoading'],
]) {
  const src = await readFile(resolve(root, rel), 'utf8');
  // 로딩 분기 시작 ~ 성공 경로의 최상위 `return (`(들여쓰기 2칸) 사이가
  // 「로딩 + 오류」 두 분기다. 그 안에 여는 태그가 정확히 둘이어야 한다.
  const from = src.indexOf(`if (${guard})`);
  const successReturn = src.indexOf('\n  return (', from);
  const wraps =
    from >= 0 && successReturn > from
      ? (src.slice(from, successReturn).match(/<CompeteLayout/g) ?? []).length
      : -1;
  ok(wraps === 2, `${rel}: 로딩·오류 분기가 CompeteLayout 안에서 그려진다 — 실제 감싼 수 ${wraps}`);
}

// ── ④ 튜터는 태풍이 ─────────────────────────────────────────────────────────
const tutorImg = $('[data-testid="sidenav"] img');
ok(tutorImg?.getAttribute('src') === '/typhoon.png', `사이드바 튜터 이미지 — ${tutorImg?.getAttribute('src')}`);
const sidenavText = $('[data-testid="sidenav"]')?.textContent ?? '';
ok(sidenavText.includes('태풍이'), `사이드바 튜터 이름이 태풍이 — "${sidenavText.slice(-40)}"`);

reactRoot.unmount();
await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 예보 대결 배치(2열·항목 최소폭·sticky·태풍이 튜터) 스모크 통과');

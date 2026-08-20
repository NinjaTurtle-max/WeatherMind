/**
 * 기후 탐정 XP 표시 계약 (2026-08-20) —
 *   node tests/detectiveXp.smoke.test.mjs   (npm run test:detective-xp)
 *
 * ── 왜 있나 ─────────────────────────────────────────────────────────────────
 * 서버가 기후 탐정 XP를 **실제로 적립**하게 됐는데(918a8e8 — 최초 정답 1회,
 * quiz_logs 마커) 화면에 `xp_earned` 소비처가 **0곳**이었다. 계약은 오직
 * `src/api/detective.js`의 **주석**에만 있었다 ⇒ 학습자는 185 XP를 받고도
 * 받은 줄 모른다. 「서버가 준다」와 「화면이 그것을 말한다」는 다른 사실이고,
 * 이 파일은 뒤엣것만 문다.
 *
 * ── 지키는 계약 ─────────────────────────────────────────────────────────────
 *   ⓐ `xp_earned > 0`이면 획득 표시가 **뜬다**.
 *   ⓑ `xp_earned === 0`이면 획득 표시가 **안 뜬다**. 정답인데 0(=이미 받은
 *      케이스)이면 「이미 받았다」 계열만 말한다. 🔴 **0을 자랑처럼 그리면
 *      결함이다** — 재제출 화면 어디에도 "XP"라는 글자가 없어야 한다.
 *   ⓒ 표시되는 값이 **응답의 `xp_earned`와 같다**(상수 사본이 아니다).
 *      케이스마다 30·35로 갈리고 시드가 바뀔 수 있어, 하드코딩은 화면이
 *      조용히 거짓말하는 형태로만 드러난다.
 *   ⓓ **목이 서버와 같은 모양**이다 — 재제출 응답에 `xp_earned` 키가 살아
 *      있고 값이 0이다(키를 지우면 목만 통과하는 갈래가 생긴다).
 *
 * ── 이 계약이 못 무는 것 ────────────────────────────────────────────────────
 *  · 배지의 색·자리. 텍스트와 testid만 본다.
 *  · 서버가 실제로 적립하는가 — 그것은 backend `test_detective_router.py` 몫이다.
 *
 * 관례는 detective.smoke.test.mjs와 동일(러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin 실 XHR + jsdom 실마운트, 로케일 ko 고정).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = JSON.parse(
  readFileSync(resolve(root, '../database/seed/detective_cases.json'), 'utf-8'),
).filter((c) => (c.status ?? 'active') === 'active');

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

// ── solve 응답을 **가로채 기록**한다 (ⓒ의 재료) ──────────────────────────────
// 화면의 숫자를 무엇과 비교할지가 이 계약의 전부다. 상수와 비교하면 상수 사본을
// 승인하게 되므로 **그 요청의 실제 응답 본문**과 비교한다. `override`가 있으면
// 클라이언트가 보는 본문만 바꾼다(목의 적립 장부는 건드리지 않는다).
const RealXHR = window.XMLHttpRequest;
let lastSolve = null; // 마지막 solve 응답(파싱본)
let override = null; // (obj) => obj  — 클라이언트에 보이는 본문 변조기
class SolveTapXHR extends RealXHR {
  open(method, url, ...rest) {
    this.__isSolve = /\/detective\/cases\/[^/]+\/solve$/.test(String(url));
    return super.open(method, url, ...rest);
  }
  get __body() {
    const raw = super.responseText;
    if (!this.__isSolve || !raw) return raw;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return raw;
    }
    if (obj && typeof obj === 'object' && 'verdict' in obj) {
      if (override) obj = override(obj);
      lastSolve = obj;
      return JSON.stringify(obj);
    }
    return raw;
  }
  get responseText() {
    return this.__body;
  }
  get response() {
    return this.__isSolve ? this.__body : super.response;
  }
}
window.XMLHttpRequest = SolveTapXHR;
globalThis.XMLHttpRequest = SolveTapXHR;

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 10000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

useAuthStore.getState().setTokens({ accessToken: 't-detxp', refreshToken: 'r-detxp' });
useAuthStore.getState().setUser({ user_id: 'detxp-smoke', email: 'detxp@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const text = () => window.document.body.textContent ?? '';
const click = async (el) => {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  await sleep(30);
};

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

function mount(entry) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [entry] }, createElement(App))),
  );
  return reactRoot;
}

/** 케이스를 하한만큼 조사하고 정답 가설로 제출한다. */
async function solveCorrectly(c) {
  for (const id of c.clues.map((x) => x.clue_id).slice(0, c.min_clues)) {
    await click($(`[data-testid="detective-clue-${id}"]`));
  }
  await click($(`[data-testid="detective-hypothesis-${c.solution.answer_hypothesis_id}"]`));
  await click($('[data-testid="detective-submit"]'));
}

const liveText = () => $('[data-testid="detective-verdict-live"]')?.textContent ?? '';

ok(CASES.length >= 2, `사건을 읽었다 — ${CASES.length}건(2건 미만이면 아래가 공집합을 통과한다)`);

// ═══ ⓐ 최초 정답 → 획득 표시가 뜬다 ════════════════════════════════════════
const CASE1 = CASES[0];
let reactRoot = mount(`/detective/${CASE1.case_id}`);
await waitFor(() => text().includes(CASE1.intro.headline), 10000, '사건1 상세 렌더');
ok(!$('[data-testid="detective-xp"]'), '제출 전에는 획득 표시가 없다');

await solveCorrectly(CASE1);
await waitFor(() => text().includes('사건 해결'), 10000, '정답 판정 렌더');
ok(lastSolve != null, 'solve 응답을 가로챘다 — 아니면 아래 값 대조가 공허하다');
ok(Number(lastSolve?.xp_earned) > 0, `최초 정답 응답이 XP를 싣는다 — 실제 ${lastSolve?.xp_earned}`);

const badge = $('[data-testid="detective-xp"]');
ok(Boolean(badge), 'ⓐ 최초 정답이면 획득 XP 표시가 뜬다');
ok(
  liveText().includes(badge?.textContent ?? ' '),
  '획득 표시가 판정 라이브 영역 **안**에 있다 — 밖이면 스크린리더에 아무 일도 안 일어난다',
);
ok(
  (badge?.textContent ?? '').includes(String(lastSolve?.xp_earned)),
  `ⓒ-1 표시된 값이 응답의 xp_earned(${lastSolve?.xp_earned})와 같다 — 실제 "${badge?.textContent}"`,
);
ok(!$('[data-testid="detective-xp-already"]'), '최초 정답에 「이미 받았다」가 뜨지 않는다');

// ═══ ⓑ 같은 케이스 재제출 → 0. 획득 표시가 사라지고 「0 XP」가 아니다 ═══════
await click($('[data-testid="detective-submit"]'));
await waitFor(() => Number(lastSolve?.xp_earned) === 0, 10000, '재제출 응답(0 XP)');
ok(
  Object.prototype.hasOwnProperty.call(lastSolve ?? {}, 'xp_earned'),
  'ⓓ 목이 재제출에도 xp_earned 키를 **싣는다**(지우지 않는다 — 서버와 같은 모양)',
);
ok(lastSolve?.xp_earned === 0, `ⓓ 재제출 적립액이 0이다 — 실제 ${lastSolve?.xp_earned}`);
await sleep(120);
ok(!$('[data-testid="detective-xp"]'), 'ⓑ xp_earned=0이면 획득 표시가 뜨지 않는다');
ok(
  !/XP/.test(liveText()),
  `ⓑ 재제출 화면 어디에도 「XP」가 없다 — 0을 자랑처럼 그리지 않는다: "${liveText().slice(0, 80)}"`,
);
ok(
  Boolean($('[data-testid="detective-xp-already"]')),
  'ⓑ 정답인데 0이면 「이미 받았다」 계열을 말한다(침묵보다 낫다)',
);
ok(text().includes('사건 해결'), '재제출에도 판정 자체는 그대로 온다');
reactRoot.unmount();

// ═══ ⓒ 값이 응답에서 온다 — 응답을 41로 바꾸면 화면도 41 ═══════════════════
// 시드의 어느 xp_reward(30·35)와도 다른 값을 골랐다. 컴포넌트가 상수를 그리거나
// 케이스 목록의 xp_reward를 읽고 있으면 여기서 30·35가 떠 **운다**.
const CASE2 = CASES[1];
override = (obj) => ({ ...obj, xp_earned: 41 });
reactRoot = mount(`/detective/${CASE2.case_id}`);
await waitFor(() => text().includes(CASE2.intro.headline), 10000, '사건2 상세 렌더');
await solveCorrectly(CASE2);
await waitFor(() => text().includes('사건 해결'), 10000, '사건2 정답 판정 렌더');
ok(lastSolve?.xp_earned === 41, '변조된 응답이 클라이언트에 닿았다(가로채기 성공)');
const badge2 = $('[data-testid="detective-xp"]');
ok(Boolean(badge2), 'ⓒ 변조 응답에서도 획득 표시가 뜬다');
ok(
  (badge2?.textContent ?? '').includes('41'),
  `ⓒ-2 화면 값이 응답을 따라간다(41) — 실제 "${badge2?.textContent}" (30·35면 상수 사본이다)`,
);
ok(
  !/\b(30|35)\b/.test(badge2?.textContent ?? ''),
  `ⓒ-3 시드의 xp_reward가 화면에 새지 않는다 — 실제 "${badge2?.textContent}"`,
);
override = null;
reactRoot.unmount();

// ── 문구가 리소스에 있다(컴포넌트에 한국어 리터럴 금지 — displayLayerParity의 짝) ──
{
  const src = readFileSync(resolve(root, 'src/modules/detective/CasePlayPage.jsx'), 'utf-8');
  ok(
    /t\('detective\.play\.xpEarned'/.test(src) && /t\('detective\.play\.xpAlready'/.test(src),
    '표시 문구가 i18n 키로 온다',
  );
  for (const loc of ['ko', 'en']) {
    const res = readFileSync(resolve(root, `src/i18n/resources/detective.${loc}.js`), 'utf-8');
    ok(/xpEarned:\s*'[^']*\{xp\}[^']*'/.test(res), `${loc}: xpEarned가 {xp} 자리표시자를 갖는다`);
    ok(/xpAlready:\s*'[^']{8,}'/.test(res), `${loc}: xpAlready 문구가 있다`);
    const already = res.match(/xpAlready:\s*'([^']*)'/)?.[1] ?? '';
    // 🔴 못 지킬 약속 금지(uiCopy ⑹⑺과 같은 뜻) — 「나중에·언제든·바꿀 수 있」
    ok(
      !/바꿀\s*수\s*있|언제든|나중에/.test(already) && !/\blater\b|\banytime\b|you can change/i.test(already),
      `${loc}: xpAlready가 없는 통로를 약속하지 않는다 — "${already}"`,
    );
  }
}

await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\n전건 통과');
process.exit(0);

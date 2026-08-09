/**
 * 홈 진입 통합 스모크 (R13-01 §2.5) —
 *   node tests/homeEntry.smoke.test.mjs
 *
 * 무엇을 지키는가
 *   1. **진입 카드는 하나다.** 2026-08-06까지 「바로 시작하기」에는 학습 세션·대기
 *      보드·예보 대결·리그 네 칸이 *같은 격*으로 서 있었고, 처음 온 사람은 무엇부터
 *      눌러야 하는지 알 수 없었다(사전 교육 Mo2 "진입 실패" 신호). 카드 수가 다시
 *      늘면 여기서 잡는다.
 *   2. **우선순위**: 진행 중 유닛 → 오늘 미발급 일일 세션 → 완료 축하.
 *      순수 함수 pickHomeEntry로 상태를 직접 먹여 전 분기를 고정한다(실 API로는
 *      "모든 유닛 클리어" 상태를 만들 수 없다).
 *   3. **자유 일일 세션은 보조 링크다** — 채움 버튼(주 CTA와 같은 무게)로 되돌아가면
 *      실패. 지역 픽커는 이 보조 줄이 계속 소유한다(홈에서 사라지면 안 된다).
 *   4. **내비 탭 구조 불변** — 진입 통합은 본문의 문제였다. 탭이 7개가 아니면 실패
 *      (2026-08-08 CO-N-1 ②로 「탐구」가 들어와 6 → 7).
 *   5. ko/en 양 로케일 렌더 — 카드 문구가 리소스에서 온다(하드코딩 회귀 가드).
 *
 * 관례는 home.smoke.test.mjs와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트.
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

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
// 2026-08-09: 홈 화면을 학습에 합치면서 순수 로직이 learnEntry.js로 옮겨졌다
// (pickHomeEntry → pickLearnEntry). 화면은 사라져도 "무엇을 눌러야 하는가"의
// 규칙은 남아야 하므로 이 스모크도 남는다.
const { pickLearnEntry: pickHomeEntry } = await vite.ssrLoadModule('/src/modules/curriculum/learnEntry.js');
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
const { useLocaleStore } = await vite.ssrLoadModule('/src/i18n/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

useAuthStore.getState().setTokens({ accessToken: 't-entry', refreshToken: 'r-entry' });
useAuthStore.getState().setUser({ user_id: 'entry-smoke', email: 'entry@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

// ── 2. 우선순위 — 순수 함수로 전 분기 고정 ──────────────────────────────────
{
  const CURRENT = [
    { id: 'a', slug: 'a', title: '기단의 성질', status: 'cleared' },
    { id: 'b', slug: 'b', title: '전선의 종류', status: 'current' },
    { id: 'c', slug: 'c', title: '태풍', status: 'locked' },
  ];
  const ALL_CLEARED = [
    { slug: 'a', title: '기단의 성질', status: 'cleared' },
    { slug: 'b', title: '전선의 종류', status: 'cleared' },
  ];

  // ① 진행 중 유닛이 최우선 — 오늘 일일 세션을 아직 안 했어도 유닛이 이긴다
  let e = pickHomeEntry({ units: CURRENT, todayAnswered: 0, dailyGoal: 10 });
  // 목적지가 `/learn`(제자리)이 아니라 **유닛 플레이**여야 한다 — 카드가 학습
  // 화면 위에 있으므로 `/learn`이면 눌러도 아무 일이 없다.
  ok(e.kind === 'unit' && e.to === '/learn/units/b' && e.unit?.title === '전선의 종류',
     `① 진행 중 유닛 우선 — ${e.kind}/${e.to}/${e.unit?.title}`);

  // ①-b 오늘 목표를 이미 채웠어도 진행 중 유닛이 있으면 유닛이다
  e = pickHomeEntry({ units: CURRENT, todayAnswered: 10, dailyGoal: 10 });
  ok(e.kind === 'unit', `①-b 목표 달성 후에도 유닛 — ${e.kind}`);

  // ①-c status가 current 없이 unlocked만 오는 응답(구 서버·부분 트리)도 진행 중
  e = pickHomeEntry({ units: [{ slug: 'x', title: '열린 유닛', status: 'unlocked' }], todayAnswered: 0 });
  ok(e.kind === 'unit' && e.unit?.title === '열린 유닛', `①-c unlocked도 진행 중 — ${e.kind}`);
  // ①-d id가 없는 응답(구 서버·부분 트리)은 학습 화면으로 떨어진다 —
  // `/learn/units/undefined`로 보내면 404 화면이 뜬다.
  ok(e.to === '/learn', `①-d id 없으면 /learn 폴백 — ${e.to}`);

  // ② 진행 중 유닛이 없고 오늘 몫이 남았으면 일일 세션
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 0, dailyGoal: 10 });
  ok(e.kind === 'daily' && e.to === '/daily', `② 유닛 없음+오늘 미발급 → 일일 — ${e.kind}/${e.to}`);

  // ②-b 목표 미달(진행 중)도 아직 오늘 몫이 남은 것으로 본다
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 3, dailyGoal: 10 });
  ok(e.kind === 'daily', `②-b 목표 미달은 일일 — ${e.kind}`);

  // ②-c 목표 미설정(null)이면 "오늘 한 문항이라도 풀었는가"로 가른다
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 0, dailyGoal: null });
  ok(e.kind === 'daily', `②-c 목표 미설정+오늘 0문항 → 일일 — ${e.kind}`);

  // ②-d 트리가 비어 있어도(코스에 유닛 0) 일일로 떨어진다 — 빈 화면 금지
  e = pickHomeEntry({ units: [], todayAnswered: 0, dailyGoal: null });
  ok(e.kind === 'daily', `②-d 빈 트리 → 일일 — ${e.kind}`);

  // ③ 둘 다 없으면 완료 축하
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 10, dailyGoal: 10 });
  ok(e.kind === 'done', `③ 전 유닛 클리어+목표 달성 → 완료 축하 — ${e.kind}`);
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 1, dailyGoal: null });
  ok(e.kind === 'done', `③-b 목표 미설정+오늘 풀었음 → 완료 축하 — ${e.kind}`);

  // 인자 없이 불러도 터지지 않는다(첫 렌더 방어)
  ok(pickHomeEntry().kind === 'daily', '인자 없음도 판정된다');
}

// ── 1·3·4·5 실마운트 ────────────────────────────────────────────────────────
{
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App))),
  );

  await waitFor(() => $('[data-testid="learn-entry"]') !== null, 8000, '진입 카드 렌더');
  // 목의 시드는 첫 유닛만 클리어 → 두 번째 유닛이 current다
  await waitFor(() => text().includes('기단의 성질'), 8000, '커리큘럼 트리 도착');

  // 1. 진입 **선택지**는 하나다.
  // DOM 노드는 2개다(PC 레일용·모바일용) — PC 경로 뷰가 `hidden md:block`이라
  // 뷰포트마다 하나만 보인다. jsdom에는 CSS 엔진이 없어 "보이는 것"을 셀 수
  // 없으므로, 지켜야 할 것을 **목적지가 하나인가**로 바꿔 단정한다. 예전 4칸
  // 회귀는 목적지가 갈리는 형태였으므로 이 단정이 그대로 잡는다.
  const cards = $$('[data-testid="learn-entry"]');
  ok(cards.length === 2, `진입 카드 마운트 2곳(레일·모바일) — 실제 ${cards.length}`);
  // 2026-08-09: 카드 바깥이 <div>가 됐다 — 복습 링크가 안으로 들어오면서 `<a>`
  // 안의 `<a>`가 되기 때문이다(HTML 불가). 목적지는 CTA가 갖는다.
  const hrefOf = (c) => c.querySelector('[data-testid="learn-entry-cta"]')?.getAttribute('href');
  const dests = new Set(cards.map(hrefOf));
  const kinds = new Set(cards.map((c) => c.getAttribute('data-entry-kind')));
  ok(dests.size === 1 && kinds.size === 1, `두 마운트가 같은 선택지 — ${[...dests]} / ${[...kinds]}`);
  const card = cards[0];
  ok(card.getAttribute('data-entry-kind') === 'unit',
     `진행 중 유닛이므로 kind=unit — 실제 ${card.getAttribute('data-entry-kind')}`);
  ok(/^\/learn\/units\//.test(hrefOf(card) ?? ''),
     `카드가 유닛 플레이를 가리킨다(제자리 /learn 아님) — ${hrefOf(card)}`);
  // 카드 전체가 링크로 되돌아가면 안 된다 — 복습 링크가 안에 있어 `<a>` 중첩이 된다.
  ok(card.tagName !== 'A', `카드 바깥은 링크가 아니다 — 실제 <${card.tagName.toLowerCase()}>`);
  ok(card.textContent.includes('기단의 성질'), '카드가 진행 중 유닛 제목을 말한다');

  // 1-b. 예전 4칸(보드·대결·리그)이 카드로 되돌아오지 않았다 — 링크로만 존재
  const secondary = $('[data-testid="learn-secondary"]');
  ok(Boolean(secondary), '보조 진입 줄이 있다');
  const secHrefs = [...(secondary?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
  // 2026-08-09: 자유 일일 세션(/daily)이 같은 줄로 내려왔다 — 예전에는 별도 흰
  // 카드였고, 카드로 두면 위의 진입 카드와 무게가 비슷해진다.
  // 2026-08-09: 보드·대결·리그 링크는 걷었다 — 내비(6탭)가 이미 갖고 있어
  // 같은 목적지가 한 화면에 두 벌이었다. 이 줄은 자유 일일 세션만 갖는다.
  ok(secHrefs.join(',') === '/daily', `자유 일일 세션 링크만 남는다 — ${secHrefs.join(',')}`);
  // 복습은 이 줄이 아니라 파란 진입 카드 안에 있다(2026-08-09 지시).
  // 자기 쿼리가 도착해야 그려지므로 기다린다 — 즉시 보면 due 0건과 구분되지 않는다.
  await waitFor(() => $$('[data-testid="review-queue-hero"]').length > 0, 6000, '복습 줄');
  ok(
    $('[data-testid="review-queue-hero"]').closest('[data-testid="learn-entry"]') !== null,
    '복습 줄이 진입 카드 안에 있다',
  );
  ok(
    $('[data-testid="review-queue-strip"]') === null && $('[data-testid="review-queue-card"]') === null,
    '복습이 하단 줄·별도 카드로 되돌아가지 않았다',
  );
  for (const a of secondary?.querySelectorAll('a') ?? []) {
    const cls = a.getAttribute('class') ?? '';
    ok(!/\bbg-(sky|slate|emerald)-\d/.test(cls), `보조 링크는 채움 버튼이 아니다 — "${cls}"`);
  }

  // 3. 자유 일일 세션 = 보조 링크(채움 버튼 금지) + 지역 픽커 동거
  const free = secondary;
  ok(Boolean(free), '자유 일일 세션 줄이 있다');
  const freeLink = free?.querySelector('a[href="/daily"]');
  ok(Boolean(freeLink), '자유 일일 세션이 /daily 링크를 준다');
  ok(!/\bbg-(slate|sky)-\d/.test(freeLink?.getAttribute('class') ?? ''),
     `자유 일일 세션이 채움 버튼으로 되돌아가지 않았다 — "${freeLink?.getAttribute('class')}"`);
  ok((free?.textContent ?? '').includes('서울') || Boolean(free?.querySelector('button')),
     '지역 픽커가 이 줄에 남아 있다');

  // 4. 내비 탭 구조 불변
  const tabs = $$('[data-testid="tabbar"] a');
  // CO-N-1 ②: 「탐구」 추가로 6 → 7. 진입 통합은 본문의 문제였고 탭 구조는 그대로다.
  // 2026-08-09: 홈 화면 삭제로 「홈」 탭이 빠져 7 → 6.
  ok(tabs.length === 6, `탭 6개 유지 — 실제 ${tabs.length}`);

  // 5. en 로케일 — 카드 문구가 리소스에서 온다
  useLocaleStore.getState().setLocale('en');
  await waitFor(() => text().includes('Learning session'), 6000, 'en 렌더');
  const enCard = $('[data-testid="learn-entry"]');
  ok(enCard?.textContent.includes('Learning session'), 'en: 카드 머리말이 영어');
  ok(enCard?.textContent.includes('A unit is in progress'), 'en: 카드 본문이 영어');
  ok(!/진행 중인 유닛|더 해보기/.test(text()), 'en에서 한국어 원문이 남지 않는다');
  useLocaleStore.getState().setLocale('ko');
  await waitFor(() => text().includes('진행 중인 유닛'), 6000, 'ko 복귀');
  ok(true, 'ko 복귀 렌더');

  reactRoot.unmount();
}

await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 홈 진입 통합(카드 1개·우선순위 3분기·보조 강등·탭 불변·ko/en) 스모크 통과');
process.exit(0);

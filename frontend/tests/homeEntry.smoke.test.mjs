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

  // ② 진행 중 유닛이 없고 오늘 몫이 남았으면 **마지막 유닛을 다시 연다**
  //
  // ⚠️ **계약이 뒤집혔다**(2026-08-12 — 자유 일일 세션 폐지). 종전 ②는
  // `kind:'daily'` + `to:'/daily'`를 단정했다. 그 라우트가 사라져 진입 배너의
  // 주 CTA가 **죽은 링크**가 됐고(눌러도 `*` → `/learn`), 목적지만 고치는 것으로는
  // 부족했다 — `CurriculumHome`의 `ENTRY_COPY.daily`가 제목·CTA로 없어진 기능의
  // 이름(「자유 일일 세션」·「오늘의 세션 풀기」)을 쓰기 때문이다. 그래서
  // `learnEntry`가 kind째 `unit`으로 접었다.
  //
  // **가르는 축은 살아 있다**: 오늘 몫이 남았으면 `unit`(=「이어서 풀기」로 초대),
  // 다 했으면 아래 ③의 `done`(=「오늘 몫은 다 했어요」). 목적지는 둘 다 마지막으로
  // 깬 유닛이다 — 자유 세션이 사라진 이유가 「학습 세션이 오늘 날씨를 받는다」라
  // 오늘 몫을 푸는 의도를 유닛 세션이 흡수한다.
  // ⚠️ `ALL_CLEARED`는 **id가 없는** 픽스처다(구 서버·부분 트리 재현) — 목적지는
  // `/learn` 폴백이 정답이다. 여기서 무는 것은 "죽은 `/daily`가 아니다"까지.
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 0, dailyGoal: 10 });
  ok(e.kind === 'unit' && e.to === '/learn',
     `② 유닛 없음+오늘 미발급 → 재개(id 없으면 /learn 폴백) — ${e.kind}/${e.to}`);

  // ②-a id가 있으면 **실제 유닛 플레이**로 간다 — 폴백에 가려 목적지가 영영
  // `/learn`(제자리걸음)이 되는 것을 막는다. 종전 `/daily` 자리를 무엇이
  // 이어받았는지 못 박는 줄이다.
  const ALL_CLEARED_WITH_ID = [
    { id: 'a', slug: 'a', title: '기단의 성질', status: 'cleared' },
    { id: 'b', slug: 'b', title: '전선의 종류', status: 'cleared' },
  ];
  e = pickHomeEntry({ units: ALL_CLEARED_WITH_ID, todayAnswered: 0, dailyGoal: 10 });
  ok(e.kind === 'unit' && e.to === '/learn/units/b',
     `②-a 마지막으로 깬 유닛을 다시 연다 — ${e.kind}/${e.to}`);

  // ②-b 목표 미달(진행 중)도 아직 오늘 몫이 남은 것으로 본다
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 3, dailyGoal: 10 });
  ok(e.kind === 'unit', `②-b 목표 미달은 아직 오늘 몫이 남았다 — ${e.kind}`);

  // ②-c 목표 미설정(null)이면 "오늘 한 문항이라도 풀었는가"로 가른다
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 0, dailyGoal: null });
  ok(e.kind === 'unit', `②-c 목표 미설정+오늘 0문항 — ${e.kind}`);

  // ②-d 트리가 비어 있어도(코스에 유닛 0) 빈 화면이 되지 않는다.
  // 다시 열 유닛이 없으므로 목적지는 `/learn` 폴백이다 — **죽은 링크가 아니어야**
  // 한다는 것이 이 줄의 요지다(종전에는 `/daily`로 떨어졌다).
  e = pickHomeEntry({ units: [], todayAnswered: 0, dailyGoal: null });
  ok(e.kind === 'unit' && e.to === '/learn', `②-d 빈 트리 → /learn 폴백 — ${e.kind}/${e.to}`);

  // ③ 둘 다 없으면 완료 축하
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 10, dailyGoal: 10 });
  ok(e.kind === 'done', `③ 전 유닛 클리어+목표 달성 → 완료 축하 — ${e.kind}`);
  e = pickHomeEntry({ units: ALL_CLEARED, todayAnswered: 1, dailyGoal: null });
  ok(e.kind === 'done', `③-b 목표 미설정+오늘 풀었음 → 완료 축하 — ${e.kind}`);

  // 인자 없이 불러도 터지지 않는다(첫 렌더 방어).
  // 빈 트리와 같은 자리로 떨어진다 — kind는 `unit`, 목적지는 `/learn` 폴백.
  const bare = pickHomeEntry();
  ok(bare.kind === 'unit' && bare.to === '/learn', `인자 없음도 판정된다 — ${bare.kind}/${bare.to}`);
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

  // 1. 진입 **선택지**는 하나다. 2026-08-09 시안(얇은 가로 배너)부터 DOM 노드도
  // 하나다 — 세로 레일이던 시절에는 PC 레일용·모바일용으로 둘을 걸고 CSS로
  // 하나씩 감췄는데, 가로 배너는 두 폭에서 같은 자리라 나눌 이유가 없다.
  const cards = $$('[data-testid="learn-entry"]');
  ok(cards.length === 1, `진입 배너 마운트 1곳 — 실제 ${cards.length}`);
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

  // 1-b. ⚠️ **「보조 진입 줄」(`learn-secondary`) 단정은 폐기됐다**(2026-08-12).
  //
  // 그 줄의 정체는 **자유 일일 세션 카드**였고(`LearnFooterCards`), 클라이언트
  // 지시로 `/daily` 라우트와 함께 카드째 제거됐다. 여기 있던 단정 —
  // "보조 진입 줄이 있다" · "링크는 정확히 `/daily` 하나뿐" — 은 이제 없어진
  // 화면 요소를 요구한다.
  //
  // **이 줄이 지키던 것 중 살아남은 계약은 아래 두 개다**(그래서 그것만 남긴다):
  //   · 예전 4칸(보드·대결·리그)이 카드로 되돌아오지 않았다 — 내비 탭이 이미
  //     같은 목적지를 갖고 있어 한 화면에 두 벌이 되는 것을 막는다.
  //   · 복습은 별도 카드/줄이 아니라 오른쪽 열(`learn-footer`) 안에 있다.
  // 첫 번째는 오른쪽 열 전체에서 그 세 목적지가 없음을 보는 것으로 옮긴다 —
  // 사라진 특정 컨테이너가 아니라 **화면**을 무는 편이 오래 간다.
  const rail = $('[data-testid="learn-footer"]');
  ok(Boolean(rail), '오른쪽 열(learn-footer)이 있다');
  const railHrefs = [...(rail?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
  ok(
    !railHrefs.some((h) => ['/board', '/duel', '/league'].includes(h)),
    `보드·대결·리그가 오른쪽 열로 되돌아왔다(내비와 중복) — ${railHrefs.join(',')}`,
  );
  // 죽은 링크 금지 — `/daily`는 폐지된 라우트다. 되살아나면 조용한 회귀가 된다.
  ok(
    !railHrefs.includes('/daily'),
    `폐지된 /daily 링크가 오른쪽 열에 남아 있다 — ${railHrefs.join(',')}`,
  );
  // 복습은 이 줄이 아니라 **하단 3카드의 첫 칸**이다(2026-08-09 시안).
  // 자기 쿼리가 도착해야 그려지므로 기다린다 — 즉시 보면 due 0건과 구분되지 않는다.
  await waitFor(() => $$('[data-testid="review-queue-tile"]').length > 0, 6000, '복습 칸');
  ok(
    $('[data-testid="review-queue-tile"]').closest('[data-testid="learn-footer"]') !== null,
    '복습 칸이 하단 3카드 줄 안에 있다',
  );
  ok(
    $('[data-testid="review-queue-strip"]') === null && $('[data-testid="review-queue-card"]') === null,
    '복습이 하단 줄·별도 카드로 되돌아가지 않았다',
  );
  // 3. ⚠️ **「자유 일일 세션」 단정 3건은 폐기됐다**(2026-08-12 — 카드 제거).
  //    "줄이 있다" · "/daily 링크를 준다" · "채움 버튼이 아니다"가 여기 있었다.
  //    카드가 사라졌으므로 잴 대상이 없다.
  //
  //    **지역 픽커 단정은 살린다** — 그것은 자유 세션에 딸린 것이 아니라 실황
  //    주입(`today.*` 슬롯)의 입력이고, 유닛 세션이 오늘 날씨를 받게 되면서 오히려
  //    더 중요해졌다. 없어진 카드 머리에 얹혀 있었을 뿐이라 카드와 함께 조용히
  //    사라질 뻔했다(그래서 `LearnFooterCards`가 독립 줄로 남겼다).
  //    컨테이너가 바뀌었으므로 **오른쪽 열 전체**에서 찾는다.
  ok(
    (rail?.textContent ?? '').includes('서울') || Boolean(rail?.querySelector('button')),
    '지역 픽커가 오른쪽 열에 남아 있다 — 실황 주입의 입력이라 카드와 함께 사라지면 안 된다',
  );

  // 4. 내비 탭 구조 불변
  const tabs = $$('[data-testid="tabbar"] a');
  // CO-N-1 ②: 「탐구」 추가로 6 → 7. 진입 통합은 본문의 문제였고 탭 구조는 그대로다.
  // 2026-08-09: 홈 화면 삭제로 「홈」 탭이 빠져 7 → 6.
  ok(tabs.length === 5, `탭 5개 유지 — 실제 ${tabs.length}`); // 2026-08-11 대결+리그 합침

  // 5. en 로케일 — 카드 문구가 리소스에서 온다
  useLocaleStore.getState().setLocale('en');
  await waitFor(() => text().includes('Clear units in order'), 6000, 'en 렌더');
  const enCard = $('[data-testid="learn-entry"]');
  // 머리글은 2026-08-09 시안부터 **섹션 이름**이다("Section 1 · 하늘 읽기").
  // 섹션명 자체는 서버 데이터라 번역되지 않는다 — 틀(Section {n} · {title})만 본다.
  ok(enCard?.textContent.includes('Section 1 ·'), 'en: 배너 머리글 틀이 영어');
  // 카드 본문(「진행 중인 유닛이에요…」)은 삭제됐다 — 배너 부제와 겹쳐서 뺐고,
  // 고아가 된 `home.entry.unitBody`도 ko/en에서 지웠다. 로케일 왕복은 **아직
  // 화면에 있는 문구**로 확인해야 하므로 부제를 본다.
  ok(enCard?.textContent.includes('Clear units in order'), 'en: 배너 부제가 영어');
  ok(!/유닛을 순서대로|더 해보기/.test(text()), 'en에서 한국어 원문이 남지 않는다');
  useLocaleStore.getState().setLocale('ko');
  await waitFor(() => text().includes('유닛을 순서대로'), 6000, 'ko 복귀');
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

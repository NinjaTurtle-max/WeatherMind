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
 *   ④ 오늘의 목표는 **진입 카드 안**에 있다. 미설정이어도 **자리는 남고** 내 정보
 *      (설정 통로)로 보낸다 — 한때 숨겼다가 되돌렸다(2026-08-09). 홈이 사라진 뒤로
 *      목표를 정하는 통로가 이 화면에 없어서, 숨기면 기능째 사라졌다.
 *   ⑤ 출석 체크(POST /progress/attendance)의 **소유자는 이 화면**이다. 홈이
 *      갖고 있던 계약을 그대로 넘겨받았다 — 넘기지 않으면 출석 POST를 만드는
 *      화면이 앱에서 사라져 스트릭이 영영 안 오른다.
 *   ⑥ 흰 카드를 늘리지 않는다. 복습·자유 세션·지역은 **카드가 아니라 링크**로
 *      화면 맨 아래 줄에 있다(§2.5가 없앤 "무엇을 누를지 모름"의 재발 방지).
 *   ⑦ 홈에서 뺀 것이 **사라지지 않고 내 정보에 도착했다.** 연속 출석 주간 스트립과
 *      능력 레이더는 학습 화면에서 걷어냈지만 기능째 버린 것이 아니다 —
 *      "옮겼다"고 말하려면 도착지도 같이 단정해야 한다. 여기가 그 유일한 지점이다
 *      (내 정보를 마운트하는 스모크가 따로 없다).
 */
import { readFileSync } from 'node:fs';
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
// 2026-08-11: 예보 대결 + 리그를 한 화면으로 합쳐 6 → 5.
ok(NAV_ITEMS.length === 5, `내비 항목 5개 — 실제 ${NAV_ITEMS.length}`);
// 리그는 내비에서 빠졌지만 **도달 가능해야 한다** — 탭바가 유일한 통로다.
// CO-N-1 ②(탐구가 내비 어디에도 없어 URL을 손으로 쳐야 했다)와 같은 종류의
// 사고를 여기서 되풀이하지 않기 위한 단정이다.
ok(!NAV_ITEMS.some((i) => i.to === '/league'), '리그가 아직 내비에 남아 있다(합친 의미가 없다)');
ok(NAV_ITEMS.some((i) => i.to === '/explore'), '내비에 /explore가 없다(CO-N-1 ②)');
ok(NAV_ITEMS[0].to === '/learn', `첫 항목이 학습 — 실제 ${NAV_ITEMS[0].to}`);
ok(!NAV_ITEMS.some((i) => i.to === '/'), '내비에서 홈(/)이 빠졌다 — 홈 화면은 삭제됐다');

// ── ① `/` → `/learn` 리다이렉트 + 화면 구성 ─────────────────────────────────
{
  const r = mount('/');
  // 🔴 **재방문은 이제 복귀 화면을 한 번 거친다**(2026-08-20, ⑫-b 클라이언트 지시분).
  //
  //   이 파일 머리에서 `setTokens({ accessToken: 't-home' })`를 먼저 심으므로
  //   `shouldShowReturnScreen('/')`가 참이고, `/`는 `<Navigate to="/learn">`가
  //   아니라 `ReturnHome`을 세운다. 종전 단정은 「`/`는 **항상** 리다이렉트한다」던
  //   시절 그대로라 `.wm-scroller`를 6초 기다리다 죽었다.
  //   #148의 diff에 `homeEntry.smoke`는 있고 이 파일은 없었다 — **누락**이다.
  //
  //   ⚠️ 게이트를 무르게 만들어 통과시키지 않는다. 그러면 클라이언트가 지시한
  //     ⑫-b가 계약상 사라진다. **계약이 화면을 지나가게** 고친다 —
  //     그러면 지키는 것이 하나 **늘어난다**: 「재방문은 복귀 화면을 거쳐 학습으로
  //     간다」. 종전 계약은 그 문장을 아예 갖고 있지 않았다.
  await waitFor(() => $('[data-testid="entry-return"]') !== null, 6000,
    '재방문 `/` → 복귀 화면');
  ok(true, '토큰이 있는 재방문에서 `/`가 복귀 화면을 세운다');
  const cont = $('[data-testid="entry-return-continue"]');
  ok(Boolean(cont), '복귀 화면에 「계속하기」가 없다 — 학습으로 갈 통로가 막힌다');
  cont?.dispatchEvent(new window.Event('click', { bubbles: true }));
  // 「계속하기」가 학습으로 보낸다 — 여기서부터는 종전 계약 그대로다.
  await waitFor(() => $('.wm-scroller') !== null, 6000, '복귀 화면 → /learn 학습 트랙');
  ok(true, '복귀 화면의 「계속하기」가 학습 화면으로 보낸다');

  // 탭바·사이드바가 같은 목록을 쓴다(둘 다 DOM에 있다 — CSS로만 갈린다)
  const tabs = $$('[data-testid="tabbar"] a');
  const sides = $$('[data-testid="sidenav"] nav a');
  ok(tabs.length === 5 && sides.length === 5, `탭바 5 · 사이드바 5 — 실제 ${tabs.length}/${sides.length}`); // 2026-08-11 대결+리그 합침
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

  // ④ 오늘의 목표 — 목 기본값은 미설정(null)이다. 그래도 **자리는 남아야 한다**:
  // 한때 숨겼는데, 홈이 사라진 뒤로 목표를 정하는 통로가 이 화면에 없어서
  // 목표를 안 정한 사람에게는 기능째 사라졌다(2026-08-09 사용자 제보).
  const unsetGoal = $('[data-testid="learn-goal"]');
  ok(Boolean(unsetGoal), '목표 미설정이어도 오늘의 목표 자리가 남는다');
  ok(unsetGoal?.getAttribute('data-goal-state') === 'unset', '미설정 상태로 표시된다');
  // 설정 통로는 내 정보다 — 카드가 좁아 3버튼 피커를 박지 않는다(2026-08-09 결정).
  // **해시까지 본다**(2026-08-11): 목표 카드가 내 정보 꼬리로 내려가면서 그냥
  // `/me`로 보내면 능력 분석 판 두 화면 위에 떨어진다. 목표를 정하러 온 사람이
  // 목표 카드를 못 보는 링크는 통로가 아니다. 앵커가 실재하는지는 ⑦에서 본다.
  ok(
    unsetGoal?.getAttribute('href') === '/me#daily-goal',
    `미설정 자리가 목표 카드로 보낸다 — 실제 ${unsetGoal?.getAttribute('href')}`,
  );
  // ⚠️ **접히는 열 안으로 들어가지 않았는가.** 2026-08-10 코드 리뷰에서 잡혔다:
  // 목표가 `hidden lg:block` 열 안에 있어 1024px 미만에서 표시와 설정 통로가
  // 통째로 사라졌다 — 위 단정만으로는 못 잡는다(요소는 DOM에 있으니 통과한다).
  // jsdom에는 CSS 엔진이 없지만 **클래스는 읽을 수 있다** — 조상에 `hidden`이
  // 붙어 있는지로 대신 본다.
  const hiddenAncestor = (() => {
    for (let el = unsetGoal; el && el.dataset?.testid !== 'learn-entry'; el = el.parentElement) {
      if (el.classList?.contains('hidden')) return el.className;
    }
    return null;
  })();
  ok(!hiddenAncestor, `목표가 접히는 열 안에 있지 않다 — 실제 조상 "${hiddenAncestor}"`);

  // ⑥ 홈이 갖고 있던 카드들이 카드로 돌아오지 않았다
  for (const gone of ['연속 출석', 'WeatherBrain']) {
    ok(!text().includes(gone), `홈 카드가 되살아나지 않았다 — ${gone} 없음`);
  }
  ok(!text().includes('안녕하세요'), '홈 인사말이 되살아나지 않았다');

  // ⑥-2 🔴 **원출처 표기가 화면에 있다 — 대회 규정 요구**(2026-08-14 감사 판정).
  //
  // README 고지만으로는 「화면에서 확인 가능한가」가 불확실하다는 판정이라 한 줄을
  // 화면에 세웠다. **레이아웃이 소유**하므로 어느 라우트로 들어와도 보인다 —
  // 화면마다 붙이면 새 화면이 생길 때 빠지고, 빠진 것을 아무도 모른다.
  //
  // ⚠️ **존재만 재지 않는다.** 요소가 있어도 문구가 「자료: …」로 바뀌어 기관명이
  //    빠지면 규정을 못 지킨다. 그래서 **기관명 문자열**을 함께 문다.
  // ⚠️ **탭바 위인지도 잰다.** 탭바는 모바일에서 하단 고정(fixed)이라 그 뒤로 가면
  //    화면에는 있는데 **사람 눈에는 안 보인다** — 규정이 요구하는 것은 DOM 존재가
  //    아니라 표기다. ⚠️ **B3(같은 날)이 탭바를 `fixed`에서 `sticky`로 바꿨다** —
  //    이제 탭바가 흐름에 자리를 먹으므로 「고정 요소 뒤로 가려진다」가 아니라
  //    「흐름에서 뒤로 밀린다」가 정확한 서술이다. 재는 것은 그대로 문서 순서다.
  //    jsdom에 레이아웃이 없어 좌표로는 못 재므로 **문서 순서**로
  //    대신한다(탭바보다 앞에 온다).
  const attribution = $('[data-testid="data-attribution"]');
  ok(Boolean(attribution), '🔴 원출처 표기 줄이 화면에 있다(대회 규정 — 원출처 표기 필수)');
  ok(
    (attribution?.textContent ?? '').includes('기상청'),
    `🔴 원출처 표기에 기관명이 들어 있다 — 실제 "${attribution?.textContent ?? '없음'}"`,
  );
  {
    const tabbar = $('[data-testid="tabbar"]') ?? $('nav');
    ok(
      Boolean(tabbar) &&
        Boolean(attribution) &&
        (attribution.compareDocumentPosition(tabbar) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      '원출처 표기가 탭바보다 앞에 온다(뒤에 두면 모바일에서 흐름상 밀려 안 보인다)',
    );
  }
  ok($('[data-testid="review-queue-card"]') === null, '복습이 236px짜리 큰 카드가 아니다');
  // 복습은 자기 쿼리(GET /progress/review-queue)가 도착해야 그려진다 — 즉시 보면
  // 아직 null이다(due 0건과 구분되지 않는다).
  // 2026-08-09 시안: 자리가 진입 배너 안 → **경로 아래 3카드**로 옮겼다.
  await waitFor(() => $('[data-testid="review-queue-tile"]') !== null, 6000, '복습 칸(하단 3카드)');
  const tile = $('[data-testid="review-queue-tile"]');
  ok(
    tile?.closest('[data-testid="learn-footer"]') !== null,
    '복습 칸이 하단 3카드 줄 안에 있다',
  );
  // ⚠️ **「자유 일일 세션 칸이 있다」 단정은 폐기됐다**(2026-08-12).
  // 그 칸(`learn-secondary`)은 `/daily` 라우트와 함께 카드째 제거됐다 —
  // 클라이언트 지시로 자유 일일 세션이 없어지고 학습(유닛) 세션이 오늘 날씨를
  // 받는 쪽으로 옮겨졌다. 없어진 요소를 요구할 수 없다.
  //
  // 리그 칸은 그 전에 뺐다(2026-08-10 사용자 지시) — 내비 탭이 이미 갖고 있어 같은
  // 목적지가 한 화면에 두 벌이었고, 정산 전에는 한 줄짜리라 칸값을 못 했다.
  ok($('[data-testid="learn-league"]') === null, '리그 칸이 되살아나지 않았다');

  // 오른쪽 열의 세로 순서를 DOM으로 못 박는다 — 복습은 due 0건이면 사라지므로
  // 순서가 뒤집혀도 화면만 보면 티가 안 난다.
  //
  // ⚠️ 종전 이 검사는 `order.indexOf('learn-secondary') < order.indexOf(...)`였는데,
  // 카드가 사라진 뒤 `indexOf`가 **-1**을 돌려주는 바람에 `-1 < 2`로 **공허하게
  // 통과**했다(오늘 실측). 없어진 요소를 무는 순서 검사는 조용히 무력화된다 —
  // 그래서 양쪽이 실제로 존재하는지 먼저 확인한 뒤 순서를 본다.
  const col = $('[data-testid="learn-footer"]');
  const order = [...(col?.children ?? [])].map((c) => c.getAttribute('data-testid'));
  const iRegion = order.indexOf('learn-region');
  const iReview = order.indexOf('review-queue-tile');
  ok(iRegion !== -1, `학습 지역 줄이 오른쪽 열에 있다 — 실제 ${order.join(' → ')}`);
  ok(iReview !== -1, `복습 칸이 오른쪽 열에 있다 — 실제 ${order.join(' → ')}`);
  ok(iRegion < iReview, `학습 지역이 복습보다 위 — 실제 ${order.join(' → ')}`);
  // 복습은 **개념명 키워드**다(2026-08-09 결정). 한때 담당 캐릭터 그림으로 바꿨다가
  // 되돌렸다 — 캐릭터 8장에 개념 14종이라 둘 이상이 같은 얼굴을 쓴다.
  ok(tile.querySelector('img') === null, '복습은 그림이 아니라 개념명 키워드다');

  // ── ⑧ 가로로 눕던 두 노드가 **오른쪽 세로 열**로 갔다 (2026-08-13 지시 ⑴) ──
  //
  // 옮긴 것은 둘이다: ⓐ 진입 배너(`learn-entry`) — 경로 위 폭 전체 가로 띠 ·
  // ⓑ 위치 안내(`RegionOnboardingNotice`) — `Layout`의 본문 맨 위 가로 띠.
  // 화면 첫 두 줄이 통째로 가로 띠라 학습 경로가 그만큼 아래에서 시작했다.
  //
  // ⚠️ **이 계약이 없으면 되돌림이 조용하다.** 배너를 다시 폭 전체로 올려도
  // `learn-entry`는 여전히 하나 있고 CTA도 살아 있어 위 단정이 전부 초록이다.
  // 그래서 **위치**를 문다 — 배너가 오른쪽 열의 **형제**이고 그 열의 **첫째**인가.
  const heroEl = $('[data-testid="learn-entry"]');
  const colEl = $('[data-testid="learn-footer"]');
  ok(
    heroEl?.parentElement === colEl?.parentElement,
    'ⓐ 진입 배너가 오른쪽 열과 같은 묶음 안에 있다(경로 위 가로 띠로 되돌아가지 않았다)',
  );
  ok(
    heroEl?.parentElement != null
      && [...heroEl.parentElement.children].indexOf(heroEl)
        < [...heroEl.parentElement.children].indexOf(colEl),
    'ⓐ 그 열의 맨 위가 「지금 할 일」(진입 배너)이다',
  );
  // ⓑ 위치 안내는 지역 미설정일 때만 뜨는데 **목은 region을 null로 못 준다**
  // (항상 '서울' — `onboardingSave.contract`가 같은 이유로 캐시를 직접 심는다).
  // 그래서 여기서는 소유자만 소스로 확인한다: 레이아웃이 놓고 오른쪽 열이 받았다.
  // 뜨는 모습·비차단 계약은 `onboardingSave.contract` ④⑤가 계속 소유한다.
  const layoutSrc = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8');
  const footerSrc = readFileSync(resolve(root, 'src/modules/curriculum/LearnFooterCards.jsx'), 'utf8');
  ok(
    !/^\s*<RegionOnboardingNotice/m.test(layoutSrc),
    'ⓑ 레이아웃이 위치 안내를 본문 맨 위에 다시 얹었다(전 라우트 가로 띠로 회귀)',
  );
  ok(
    /<RegionOnboardingNotice/.test(footerSrc),
    'ⓑ 오른쪽 열이 위치 안내를 소유한다',
  );

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
  await waitFor(
    () => $('[data-testid="learn-goal"]')?.getAttribute('data-goal-state') === 'set',
    6000,
    '오늘의 목표 진행 표시',
  );
  const goal = $('[data-testid="learn-goal"]');
  ok(goal.getAttribute('data-goal-state') === 'set', '설정 후에는 진행 표시로 바뀐다');
  ok(goal.textContent.includes('5'), `목표 문항 수가 보인다 — "${goal.textContent.replace(/\s+/g, ' ').slice(0, 40)}"`);
  ok(
    goal.closest('[data-testid="learn-entry"]') !== null,
    '오늘의 목표는 진입 카드 **안**에 있다(별도 카드가 아니다)',
  );
  r.unmount();
}

// ── ⑦ 홈에서 뺀 것이 내 정보에 도착했다 ────────────────────────────────────
{
  const r = mount('/me');
  await waitFor(() => text().includes('내 정보'), 6000, '내 정보 렌더');

  // 연속 출석 — 주간 스트립(요일 7칸). 프로필 카드의 🔥 숫자와는 다른 것이다:
  // 숫자는 "6일"만 말하고, 어느 요일을 빠뜨렸는지는 이 줄만 보여준다.
  await waitFor(() => $('[data-testid="streak-week"]') !== null, 6000, '주간 출석 스트립');
  const cells = $$('[data-testid="streak-week"] div div').filter((d) => ['✓', '·'].includes(d.textContent.trim()));
  ok(cells.length === 7, `출석 칸 7개 — 실제 ${cells.length}`);
  // **미래 요일을 칠하지 않는다** — 서버는 요일별 이력을 주지 않고 streak_count만
  // 준다. 오늘이 수요일인데 금·토·일이 체크돼 보이던 버그가 여기서 났다.
  // 요일은 KST 기준이다(CO-T-8) — 러너 타임존에 좌우되면 안 된다.
  const KST = 9 * 60 * 60 * 1000;
  const todayIdx = (new Date(Date.now() + KST).getUTCDay() + 6) % 7;
  const futureFilled = cells.filter((d, i) => i > todayIdx && d.textContent.trim() === '✓').length;
  ok(futureFilled === 0, `오늘(KST ${todayIdx}) 이후 요일은 비어 있다 — 채워진 미래 칸 ${futureFilled}`);

  // 능력 레이더 — 홈의 「WeatherBrain 분석」이 갖고 있던 그림.
  // 가로 막대(기존)는 그대로 두고 **옆에** 선다(막대는 개념 하나씩, 레이더는 치우침).
  await waitFor(() => $('[data-testid="ability-radar"]') !== null, 6000, '능력 레이더');
  const radar = $('[data-testid="ability-radar"]');
  ok(Boolean(radar), '능력 레이더가 내 정보에 있다');
  ok((radar.getAttribute('aria-label') ?? '').length > 0, '레이더가 읽을 수 있는 요약(aria-label)을 준다');
  ok($$('ul li').length > 0, '기존 가로 막대 목록이 그대로 남아 있다');

  // 목표 설정 카드 — /learn 배너의 「목표 미설정」이 겨냥하는 **앵커가 실재하는가**.
  // 위 ④는 href만 본다: 링크가 `#daily-goal`을 가리켜도 그런 id가 없으면
  // 브라우저는 페이지 맨 위에 그냥 떨어뜨린다(끊긴 통로가 초록으로 통과한다).
  // 기다림과 판정을 나눈다 — 맨 `await waitFor(...)`는 던지므로 이 블록의
  // 나머지와 **서버 정리(vite.close·httpServer.close)까지 건너뛴다**.
  // ⚠️ 이 파일에 그런 맨 waitFor가 아직 여럿 남아 있다(같은 블록에도 있다) —
  // 여기만 고쳤다고 파일 전체가 그 규칙을 지키는 것은 아니다. 새로 쓸 때 이
  // 꼴을 따르고, 기존 것은 손대는 김에 하나씩 옮긴다(2026-08-11 코드 리뷰).
  const goalCard = await waitFor(() => $('#daily-goal') !== null, 6000, '')
    .then(() => true)
    .catch(() => false);
  ok(goalCard, '내 정보에 목표 설정 카드(#daily-goal)가 없다');

  // **저장해도 사라지지 않는다** + **확인 문구가 이번 저장에만 뜬다**.
  //
  // ⚠️ 이 검사는 한 번 **헛돌았다**(2026-08-11 코드 리뷰). 위 ④에서 이미 목표를
  // 5로 저장해 목이 그 값을 들고 있어서, `waitFor(확인 문구)`가 클릭과 무관하게
  // 0ms에 통과했다. 계측해 보니 클릭 **전에** 이미 확인 문구가 떠 있었다.
  // 그래서 순서를 뒤집는다: 새로 연 /me에는 확인 문구가 **없어야** 하고(방금
  // 저장한 게 아니다), **다른 값**을 눌러야 그 값으로 뜬다.
  ok(
    !text().includes('오늘부터 하루'),
    '아무것도 안 눌렀는데 저장 확인 문구가 떠 있다(이미 정해 둔 사람에게 매번 뜬다)',
  );
  // ④가 5문항으로 저장해 뒀다 — 겹치지 않게 **세 번째 버튼**을 누른다.
  //
  // 🔴 **문항 수를 여기 적지 않는다**(2026-08-20 정정). 종전엔 `'하루 9문항'`을
  //   문자열로 박아 뒀는데, **이 커밋이 바로 그 9를 10으로 바꾼 커밋**이다
  //   (`DAILY_GOAL_CHOICES = [3, 5, SESSION_ITEMS]` · `SESSION_ITEMS = 10`).
  //   그래서 이 브랜치는 **자기 자신만으로도 붉었다** — 통합에서 처음 보인 것이
  //   아니라 처음부터 붉었고, 다른 빨강에 섞여 안 보였을 뿐이다.
  //   ⇒ 기대값을 **선택지에서 읽는다.** 상한이 또 바뀌어도 이 계약은 안 낡는다.
  const { DAILY_GOAL_CHOICES } = await vite.ssrLoadModule('/src/lib/onboardingGate.js');
  const goalBtns = $$('#daily-goal button');
  ok(goalBtns.length === DAILY_GOAL_CHOICES.length,
    `목표 선택 버튼 ${DAILY_GOAL_CHOICES.length}개 — 실제 ${goalBtns.length}`);
  if (goalBtns.length === DAILY_GOAL_CHOICES.length) {
    const pick = DAILY_GOAL_CHOICES[DAILY_GOAL_CHOICES.length - 1].items;
    goalBtns[goalBtns.length - 1].dispatchEvent(new window.Event('click', { bubbles: true }));
    const saved = await waitFor(() => text().includes(`하루 ${pick}문항`), 6000, '')
      .then(() => true)
      .catch(() => false);
    ok(saved, `${pick}문항을 눌렀는데 저장 확인 문구가 안 뜬다`);
    ok(Boolean($('#daily-goal')), '저장 직후 목표 카드가 사라졌다(확인 문구를 볼 수 없다)');
  }

  r.unmount();
}

// ── ⑧ 모바일 겹침 **구조** 계약 (B3 — 대장 §4.15) ──────────────────────────
//
// 실배포 첫 제보가 "모바일에서 「다음」이 가려 진행이 막혔다"였다. 응급 처치(X 버튼)는
// `sessionRunner.render.test.mjs`가 이미 물고 있고, **여기서 무는 것은 겹침이 애초에
// 일어날 수 없게 만든 구조**다. 되돌리면 겹침이 되살아나는 세 가지를 잰다.
//
// 🔴 **이 단정들이 무엇을 재고 무엇을 못 재는지** — jsdom에는 레이아웃 엔진이 없어
//    `getBoundingClientRect()`가 전부 0이고 CSS 파일도 적용되지 않는다. 그래서:
//    ✅ 잰다   — 클래스·문서 순서·데이터 속성. 즉 **구조가 어떤 규칙을 선언했는가**.
//    ❌ 못 잰다 — 실제 픽셀 겹침 · 탭바의 진짜 높이 · `sticky`가 정말 붙는지 ·
//                `max-lg:hidden`이 실제로 감추는지(Tailwind 컴파일 결과와 뷰포트 폭이
//                필요하다). 그 층은 실기기·브라우저 확인이 소유한다.
//    따라서 이 셋은 **회귀 방지**용이다 — 누가 `sticky`를 `fixed`로 되돌리거나
//    레인 양보를 걷어내면 여기서 운다. 「지금 화면이 안 겹친다」의 증명은 아니다.
{
  const { useSessionStore, SESSION_STATUS } = await vite.ssrLoadModule('/src/store/sessionStore.js');
  const r = mount('/');
  await waitFor(() => $('.wm-scroller') !== null, 6000, '/ → /learn');

  // ⑧-a 탭바가 **흐름에 자리를 차지한다**(`sticky`). `fixed`면 자리를 안 먹으므로
  //     자기 높이를 소비자들이 짐작해 비워 둬야 하고, 그 짐작이 어긋난 것이
  //     §4.15의 시작이었다. **`fixed`가 아님**까지 함께 무는 이유: `sticky`를
  //     남겨 둔 채 `fixed`를 덧붙이면 뒤에 오는 선언이 이겨 조용히 되돌아간다.
  const tabbar = $('[data-testid="tabbar"]');
  const tabCls = tabbar?.className ?? '';
  ok(
    /(^|\s)sticky(\s|$)/.test(tabCls) && !/(^|\s)fixed(\s|$)/.test(tabCls),
    `🔴 하단 탭바가 흐름에 참여한다(sticky · fixed 아님) — 실제 "${tabCls}"`,
  );

  // ⑧-b 본문이 **탭바 높이를 짐작한 여백을 갖지 않는다**. `pb-20`(80px)은 탭바가
  //     흐름 밖이던 시절의 짐작값이고, 실제 탭바 높이와 무관하게 굳은 숫자였다.
  //     ⚠️ 이 단정은 "80px 리터럴의 부활"만 막는다 — 다른 숫자로 다시 짐작하는
  //     것(예: `pb-24`)은 못 막는다. 그 방향은 ⑧-a가 이미 닫는다(탭바가 sticky인
  //     한 짐작 여백은 아무 일도 하지 않는다).
  const mainEl = $('main');
  ok(
    Boolean(mainEl) && !/(^|\s)pb-20(\s|$)/.test(mainEl.className),
    `🔴 본문에 탭바 짐작 여백(pb-20)이 되살아났다 — 실제 "${mainEl?.className ?? '없음'}"`,
  );

  // ⑧-c **화면 아래 오버레이 레인은 한 번에 한 명만 쓴다.**
  //     세션이 FEEDBACK이면 `FeedbackPanel`이 좁은 화면 아래를 차지하므로 안내봇이
  //     양보한다. 겹침이 사고가 아니라 설계였던 지점이다(Layout이 `lastAnswerCorrect`를
  //     주는 상태가 곧 그 상태다).
  //     ⚠️ **같은 노드로 남는지**를 함께 잰다. 조건부 렌더로 걷어내면 사용자가
  //     끌어다 둔 자리와 접어 둔 선택이 매번 날아간다 — 양보가 상태 파괴가 되면
  //     안 된다는 것이 계약의 절반이다.
  const botBefore = $('[data-testid="guide-bot"]');
  ok(botBefore?.getAttribute('data-guide-lane') === 'free', `안내봇이 평상시 레인을 쓴다 — 실제 ${botBefore?.getAttribute('data-guide-lane')}`);
  ok(!/max-lg:hidden/.test(botBefore?.className ?? ''), '평상시인데 안내봇이 이미 숨어 있다');

  useSessionStore.setState({ status: SESSION_STATUS.FEEDBACK });
  await waitFor(
    () => $('[data-testid="guide-bot"]')?.getAttribute('data-guide-lane') === 'yielded',
    6000,
    'FEEDBACK에서 안내봇이 레인을 양보',
  ).catch(() => {});
  const botAfter = $('[data-testid="guide-bot"]');
  ok(
    botAfter?.getAttribute('data-guide-lane') === 'yielded',
    `🔴 해설이 뜨는 동안 안내봇이 같은 자리를 계속 차지한다 — 실제 ${botAfter?.getAttribute('data-guide-lane')}`,
  );
  ok(
    /max-lg:hidden/.test(botAfter?.className ?? ''),
    `🔴 양보 표시만 하고 좁은 화면에서 안 비킨다(max-lg:hidden 없음) — 실제 "${botAfter?.className ?? '없음'}"`,
  );
  ok(botAfter === botBefore, '🔴 양보가 언마운트로 구현됐다 — 옮겨 둔 자리·접어 둔 선택이 날아간다');

  // 되돌아오는지도 잰다 — 양보가 편도면 세션 뒤 안내봇이 영영 안 보인다.
  useSessionStore.setState({ status: SESSION_STATUS.IN_PROGRESS });
  await waitFor(
    () => $('[data-testid="guide-bot"]')?.getAttribute('data-guide-lane') === 'free',
    6000,
    'FEEDBACK을 벗어나면 안내봇이 돌아온다',
  ).catch(() => {});
  ok(
    $('[data-testid="guide-bot"]')?.getAttribute('data-guide-lane') === 'free',
    '🔴 레인 양보가 편도다 — 세션이 끝나도 안내봇이 안 돌아온다',
  );

  r.unmount();
}

await vite.close();
await new Promise((r) => httpServer.close(r));
// ── 능력 분석 판의 두 레이더가 **한 쌍**이다 (2026-08-19 사용자 지시) ────────
/**
 * "개념 숙련도도 초록색으로 다이어그램" — 왼쪽 θ(파랑)와 오른쪽 숙련도(초록)가
 * 같은 부품·같은 치수·같은 임계로 그려져야 한 카드로 읽힌다. 색만 다르고,
 * 그 색이 유일한 구분이다(축도 범위도 다른 값이라 같은 색이면 겹쳐 읽힌다).
 *
 * jsdom에는 CSS 엔진이 없고 숙련도 데이터는 목이 안 주므로 **소스 계약**으로 둔다.
 * 되돌아갈 수 있는 길이 셋이라 셋을 다 문다:
 *  ⓐ 숙련도 레이더가 emerald 색조다 — 지우면 파랑 둘이 되어 구분이 사라진다
 *  ⓑ 두 레이더의 치수가 같다 — 한쪽만 키우면 두 열의 리듬이 깨진다
 *  ⓒ 임계를 **같은 상수**(RADAR_MIN_CONCEPTS)로 읽는다 — 숫자를 베끼면 한쪽만
 *     빈 줄이 남는다(왼쪽에서 실제로 있었던 결함이라 주석이 그 경위를 적어 뒀다)
 */
{
  const panel = readFileSync(resolve(root, 'src/modules/progress/WeatherBrainPanel.jsx'), 'utf8');
  ok(
    /testId="mastery-radar"[\s\S]{0,200}?tone=\{RADAR_TONES\.emerald\}/.test(panel),
    'ⓐ 숙련도 레이더가 초록(emerald) 색조다',
  );
  const sizes = [...panel.matchAll(/className="h-\[(\d+)px\] w-\[(\d+)px\]"/g)].map((m) => `${m[1]}x${m[2]}`);
  ok(
    sizes.length === 2 && sizes[0] === sizes[1],
    `ⓑ 두 레이더 치수가 같다 — ${sizes.join(' / ')}`,
  );
  const thresholds = (panel.match(/RADAR_MIN_CONCEPTS/g) ?? []).length;
  ok(
    thresholds >= 3 && !/length >= 3\b/.test(panel),
    `ⓒ 임계를 같은 상수로 읽는다(숫자 하드코딩 없음) — RADAR_MIN_CONCEPTS ${thresholds}회`,
  );
  // ⓓ **행 구성도 한 쌍이다**(2026-08-19 사용자 지시 "여기도 똑같이 배치").
  //    어제 θ 쪽만 한 줄로 바꾸고 숙련도는 3줄로 남겨 두었더니, 두 열이 한 카드
  //    안에서 **다른 리듬으로 내려가** 나란한 것으로 안 읽혔다. 이름 열의
  //    고정폭이 두 열에서 같아야 막대가 같은 자리에서 시작한다 — 그 값이
  //    한쪽만 바뀌는 것이 정확히 어제의 재발 경로다.
  const nameCol = (panel.match(/w-\[132px\] flex-none items-center gap-1\.5 sm:w-\[164px\]/g) ?? []).length;
  ok(
    nameCol === 2,
    `ⓓ 두 열의 이름 칸이 같은 고정폭이다(각 1회, 계 2회) — 실제 ${nameCol}회`,
  );
  // ⓔ **두 열의 머리 높이도 짝이다**(2026-08-19). 왼쪽 설명은 두 줄, 오른쪽은
  //    한 줄이라 그냥 두면 오른쪽 레이더가 20px 위에서 시작한다(실측 986 ↔ 1006).
  //    같은 `min-h`를 둘 다 달아야 맞는다 — 한쪽만 달면 고친 티도 안 나고 어긋난다.
  // ⚠️ 클래스 문자열 안만 센다 — 위 소스의 **주석에도 같은 토큰이 적혀 있어**
  //    그냥 세면 3회가 나온다(처음에 그렇게 세어 실패했다).
  const minH = (panel.match(/text-slate-500 lg:min-h-\[39px\]"/g) ?? []).length;
  ok(
    minH === 2,
    `ⓔ 두 열의 설명이 같은 최소 높이를 갖는다(계 2회) — 실제 ${minH}회`,
  );
}

// ── 능력 분석 탭과 그 자리는 **한 쌍**이다 (2026-08-19) ─────────────────────
/**
 * 제목이 `absolute bottom-full`로 카드 위에 솟으므로(탭) 그만큼의 자리를 위
 * 격자와의 사이에 비워 둬야 한다. 종전 `mt-4`(16px)로는 탭 49px이 왼쪽 열을
 * **33px 파고들었다** — 학습 지역이 왼쪽으로 돌아와 두 열 길이가 같아지면서
 * 드러났다(오른쪽에 있던 동안에는 그 자리가 비어 있어 안 보였다).
 *
 * 겹침은 좌표라 jsdom이 못 재고, 실제로 **오른쪽 열이 길던 동안에는 눈에도
 * 안 보였다** — 그래서 소스로 짝을 문다.
 */
{
  const page = readFileSync(resolve(root, 'src/modules/progress/ProgressPage.jsx'), 'utf8');
  const panel = readFileSync(resolve(root, 'src/modules/progress/WeatherBrainPanel.jsx'), 'utf8');
  const tabbed = /lg:absolute lg:bottom-full/.test(panel);
  const reserve = page.match(/className="mt-4 flex flex-col gap-4 lg:mt-(\d+)"/)?.[1];
  ok(
    !tabbed || Number(reserve) >= 14,
    `탭이 솟는 만큼 위 여백을 비워 뒀다 — 탭 ${tabbed ? '있음' : '없음'} · lg:mt-${reserve ?? '(없음)'}`,
  );
}

if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 학습 화면(홈 흡수 — / 리다이렉트·내비 5·진입 카드 1개·물방울이·목표 내장·출석 소유자) 스모크 통과');
process.exit(0);

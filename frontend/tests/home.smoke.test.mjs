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
  // 리다이렉트가 걸리면 학습 트랙이 뜬다(홈에는 트랙이 없었다).
  await waitFor(() => $('.wm-scroller') !== null, 6000, '/ → /learn 리다이렉트 후 학습 트랙');
  ok(true, '`/`가 학습 화면으로 리다이렉트된다');

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
  ok($('[data-testid="learn-secondary"]') !== null, '오른쪽 열에 자유 일일 세션 칸이 있다');
  // 리그 칸은 뺐다(2026-08-10 사용자 지시) — 내비 탭이 이미 갖고 있어 같은
  // 목적지가 한 화면에 두 벌이었고, 정산 전에는 한 줄짜리라 칸값을 못 했다.
  ok($('[data-testid="learn-league"]') === null, '리그 칸이 되살아나지 않았다');
  // 자유 일일 세션이 복습보다 **위**다(사용자 지시). DOM 순서로 못 박는다 —
  // 복습은 due 0건이면 사라지므로 순서가 뒤집혀도 화면만 보면 티가 안 난다.
  const col = $('[data-testid="learn-footer"]');
  const order = [...(col?.children ?? [])].map((c) => c.getAttribute('data-testid'));
  ok(
    order.indexOf('learn-secondary') < order.indexOf('review-queue-tile'),
    `자유 일일 세션이 복습보다 위 — 실제 ${order.join(' → ')}`,
  );
  // 복습은 **개념명 키워드**다(2026-08-09 결정). 한때 담당 캐릭터 그림으로 바꿨다가
  // 되돌렸다 — 캐릭터 8장에 개념 14종이라 둘 이상이 같은 얼굴을 쓴다.
  ok(tile.querySelector('img') === null, '복습은 그림이 아니라 개념명 키워드다');

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
  // ④가 5문항으로 저장해 뒀다 — 겹치지 않게 9문항(세 번째 버튼)을 누른다.
  const goalBtns = $$('#daily-goal button');
  ok(goalBtns.length === 3, `목표 선택 버튼 3개 — 실제 ${goalBtns.length}`);
  if (goalBtns.length === 3) {
    goalBtns[2].dispatchEvent(new window.Event('click', { bubbles: true }));
    const saved = await waitFor(() => text().includes('하루 9문항'), 6000, '')
      .then(() => true)
      .catch(() => false);
    ok(saved, '9문항을 눌렀는데 저장 확인 문구가 안 뜬다');
    ok(Boolean($('#daily-goal')), '저장 직후 목표 카드가 사라졌다(확인 문구를 볼 수 없다)');
  }

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

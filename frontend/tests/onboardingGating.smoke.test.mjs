/**
 * 온보딩 커밋 장치 + 점진적 잠금 해제 실마운트 스모크 (R10-01 §3.4 / S4) —
 *   node tests/onboardingGating.smoke.test.mjs
 *
 * §3.4가 "기존 사용자(진척 있음)는 전부 해제 상태로 계산되어 회귀 없음을 테스트로
 * 고정"하라고 못박은 지점을 상주 가드로 만든다. 잠금은 프론트 표시 계층이므로
 * (서버 권한 아님) 회귀는 조용히 발생한다 — 기존 사용자에게 갑자기 동기 부여
 * 화면이 뜨면 그건 기능 상실이고, 신규 사용자에게 안 뜨면 온보딩이 사라진다.
 *
 * 관례는 placementEntry.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트(createRoot,
 * useEffect 실행). 목 상태 조작은 기존 dev 경로(/dev/reset-me, /dev/clouds)만 쓴다.
 *
 * ⚠️ **2026-08-08 (CO-N-1) 계약 갱신 — 해제 사다리가 걷혔다.**
 * `FeatureUnlockGate`(board 1·duel 2·league 3 세션)를 제거했으므로 시나리오 2·3의
 * 단정이 뒤집혔다: 이제 **신규 사용자에게도 세 화면이 바로 실제 페이지로 뜬다**를
 * 고정한다. 근거는 심사 배점 ②(체험·참여형 25점)의 문면 — "단순 퀴즈·정답 맞히기를
 * **넘어**"인데 콜드 오픈 3클릭으로 닿는 것이 객관식 퀴즈뿐이었다. 게이트는
 * `lib/onboardingGate.js:15-22`가 스스로 밝히듯 순수 표시 계층이라 제거해도 로직이
 * 깨지지 않는다. 단계 계산 자체는 남아 있으나 **읽는 화면이 없다**(시나리오 3이
 * 그것을 가드한다 — 게이트가 되살아나면 거기서 깨진다).
 *
 * 시나리오
 *   1. 기존 사용자(목 기본 시드 xp=1180) → /league·/board 진입 시 실제 페이지가
 *      뜬다 = 회귀 0. 내비 항목은 **7개**(홈·학습·보드·**탐구**·대결·리그·내 정보).
 *   2. 신규 사용자(POST /dev/reset-me → xp=0, 게이트 로컬 기록 없음) → /board·
 *      /duel·/league가 **처음부터 실제 페이지**. 탭 차단은 종전대로 없다.
 *   3. 세션 완료 3회를 기록해도 같은 화면 — 단계가 화면을 바꾸지 않는다.
 *   4. 일일 목표 왕복: PUT /progress/daily-goal(3) → GET /progress/me의
 *      daily_goal_items=3 · 허용값 밖(4)은 422 VALIDATION_ERROR ·
 *      세션 완료 화면(SessionSummary)에 "오늘 목표 N/M" 표기.
 *   5. 배치고사 결과 화면(PlacementSummary)에서 "5문항" 선택 → PUT 발생 + 저장 확인.
 *  10·11. **자동 게스트 발급**(CO-N-1 ① — 대회 규정 「로그인 없이 열려야」):
 *      토큰 없이 진입하면 POST /auth/guest가 **정확히 1회** 나가고 보호 라우트가
 *      그대로 렌더된다(딥링크 보존). 토큰이 지워진 뒤에는 재발급하지 않고
 *      재시도 화면으로 받는다 — 2026-08-12에 「로그아웃 뒤」에서 갱신됐다
 *      (로그인·회원가입 구조 전면 제거로 로그아웃 버튼이 사라졌고, 토큰이
 *      지워지는 경로는 401 인터셉터만 남았다. 시나리오 11 본문 참조).
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
// i18n 전면 외부화(R11-01 §6.3) 이후 UI 문구는 로케일을 따른다 — jsdom의
// navigator.language 기본값(en-US)에 좌우되지 않도록 제품 기본 로케일(ko)을
// 저장값으로 고정한다(i18n.smoke.test.mjs와 동일 관례). 한국어 문구 단정은 불변.
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
// recharts(ResponsiveContainer)는 ResizeObserver를 요구한다 — jsdom에 없으므로 무동작 스텁.
// 이 테스트는 차트 크기가 아니라 "잠금 화면이 아니라 실제 페이지가 떴는지"만 본다.
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
const { resetGuestAutoIssue } = AppMod; // CO-N-1 ①: 자동 게스트 1회성 플래그 되돌리기
const SessionSummary = (await vite.ssrLoadModule('/src/modules/session/SessionSummary.jsx')).default;
const PlacementSummary = (await vite.ssrLoadModule('/src/modules/onboarding/PlacementSummary.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
const gateMod = await vite.ssrLoadModule('/src/lib/onboardingGate.js');
const { useOnboardingGate, selectUnlockStage } = gateMod;
const { useSessionStore } = await vite.ssrLoadModule('/src/store/sessionStore.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element, initialPath) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, element)),
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

const text = () => window.document.body.textContent ?? '';
// 2026-08-05: PC 좌측 사이드바(SideNav)가 생기면서 같은 항목이 DOM에 두 벌
// 존재한다(탭바는 md:hidden, 사이드바는 hidden md:flex — CSS로만 갈린다).
// 문서 전체에서 세면 12가 나오므로 **탭바로 한정**하고, 사이드바는 따로 센다.
const tabbar = () => window.document.querySelector('[data-testid="tabbar"]');
const sidenav = () => window.document.querySelector('[data-testid="sidenav"]');
const lockedTabCount = () =>
  [...(tabbar()?.querySelectorAll('button[disabled]') ?? [])].length;
const tabCount = () => tabbar()?.querySelectorAll('a, button').length ?? 0;
const sideNavCount = () => sidenav()?.querySelectorAll('nav a').length ?? 0;

/** 학습 홈의 두 경로 유닛 버튼 — jsdom은 CSS를 적용하지 않아 둘 다 DOM에 있다.
 *  PC = `hidden md:block` 컨테이너, 모바일 = `md:hidden` 컨테이너. 클래스 선택자에
 *  콜론이 들어가므로 속성 부분일치로 고른다.
 *
 *  ⚠️ 유닛 버튼은 `data-wm-unit`으로 고른다 — "aria-label 있는 button"으로 세면
 *  같은 컨테이너에 카드가 하나 붙을 때마다 개수가 흔들린다(2026-08-05: 우측
 *  레일·모바일 묶음에 들어간 RegionPicker 칩이 유닛으로 세어졌다). */
const pcUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:block"] button[data-wm-unit]')];
const mobileUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:hidden"] button[data-wm-unit]')];

/** 인증 상태 주입 — 목은 토큰을 검증하지 않는다(계정 식별만 필요). */
function authenticate(userId) {
  useAuthStore.getState().setTokens({ accessToken: `t-${userId}`, refreshToken: `r-${userId}` });
  useAuthStore.getState().setUser({ user_id: userId, email: `${userId}@test.dev`, nickname: '스모크' });
}

let failed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  // ── 1. 기존 사용자(진척 있음) → 전 기능 즉시 이용 가능(회귀 0) ────────────
  await scenario('기존 사용자(xp>0): /league·/board가 실제 페이지로 열린다', async () => {
    useOnboardingGate.getState().reset();
    authenticate('existing-user');
    const me = await api('GET', '/progress/me');
    assert(me.body.xp > 0, `목 기본 시드가 진척 있는 계정이어야 함 (xp=${me.body.xp})`);

    let r = mount(createElement(App), '/league');
    await waitFor(() => useOnboardingGate.getState().bootstrapped, 4000, '게이트 부트스트랩');
    const stage = selectUnlockStage(useOnboardingGate.getState());
    assert(stage === 3, `기존 사용자 단계는 최대(3)여야 함 — 실제 ${stage}`);
    await waitFor(() => text().includes('리그') && !text().includes('리그란 무엇인가요'), 4000, '리그 페이지 렌더');
    assert(!text().includes('세션을 3개 완료하면'), '기존 사용자에게 잠금 안내가 떴다(회귀)');
    assert(lockedTabCount() === 0, '탭바에 비활성 탭이 있다');
    // CO-N-1 ②: 「탐구」가 6탭 어디에도 없어서 /explore는 URL을 손으로 쳐야 갔다.
    // 2026-08-09: 홈 화면을 학습에 합치면서 「홈」 탭이 빠져 7 → 6개다.
    assert(tabCount() === 5, `탭 5개(탐구 포함·홈 삭제·대결+리그 합침)가 모두 있어야 함 — 실제 ${tabCount()}`);
    assert(sideNavCount() === 5, `PC 사이드바도 같은 5항목 — 실제 ${sideNavCount()}`);
    assert(
      [...(tabbar()?.querySelectorAll('a') ?? [])].some((a) => a.getAttribute('href') === '/explore'),
      '탭바에 /explore 진입점이 없다(CO-N-1 ②)',
    );
    r.unmount();

    r = mount(createElement(App), '/board');
    await waitFor(() => !text().includes('대기 보드란 무엇인가요'), 3000, '보드 페이지(잠금 화면 아님)');
    r.unmount();
  });

  // ── 2. 신규 사용자도 보드·예보 대결·리그가 **바로 열린다** (CO-N-1 ③) ─────
  //
  // ⚠️ **계약이 뒤집혔다**(2026-08-08). 종전 이 시나리오는 신규 사용자에게
  // "세션을 N개 완료하면" 동기 부여 화면이 뜨는 것을 단정했다. 그 해제 사다리
  // (FeatureUnlockGate — board 1·duel 2·league 3)를 걷어냈으므로 이제 반대를
  // 단정한다. 근거는 심사 배점 ②(체험·참여형 25점)의 문면이다: "단순 퀴즈·정답
  // 맞히기를 **넘어** 변수를 바꿔보며 학습 탐구가 가능하고" — 콜드 오픈 3클릭으로
  // 닿는 것이 객관식 퀴즈뿐이면 그 25점이 화면에 올라오지 않는다.
  // 게이트는 `lib/onboardingGate.js:15-22`가 스스로 밝히듯 **순수 표시 계층**이라
  // (서버 권한 아님·라우트 미차단) 제거해도 로직이 깨지지 않는다.
  await scenario('신규 사용자(dev/reset-me): 보드·예보 대결·리그가 처음부터 실제 페이지', async () => {
    const reset = await api('POST', '/dev/reset-me', { reset: true });
    assert(reset.status === 200, `/dev/reset-me 실패 (${reset.status})`);
    const me = await api('GET', '/progress/me');
    assert(me.body.xp === 0, `초기화 후 xp=0이어야 함 — 실제 ${me.body.xp}`);
    assert(me.body.daily_goal_items === null, '초기화 후 daily_goal_items=null이어야 함');

    useOnboardingGate.getState().reset();
    authenticate('fresh-user');

    for (const [path, gone, want] of [
      ['/board', '대기 보드란 무엇인가요', '대기 보드'],
      ['/duel', '예보 대결이란 무엇인가요', '예보 대결'],
      ['/league', '리그란 무엇인가요', '리그'],
    ]) {
      const r = mount(createElement(App), path);
      // ⚠️ 게이트 부트스트랩(=Layout의 /progress/me 도착)을 먼저 기다린다. 실제
      // 페이지는 로딩 스피너 문구부터 뜨므로 텍스트만 보면 me가 오기 전에 언마운트돼
      // 아래 stage 단정이 fail-open(=MAX)을 읽는다.
      await waitFor(() => useOnboardingGate.getState().bootstrapped, 6000, `${path} 게이트 부트스트랩`);
      await waitFor(() => text().includes(want) && !text().includes(gone), 5000, `${path} 실제 페이지`);
      assert(!/세션을 \d개 완료하면/.test(text()), `${path}에 해제 사다리 안내가 남아 있다`);
      assert(lockedTabCount() === 0, '탭 차단은 종전대로 없다');
      assert(tabCount() === 5, '탭 5개는 항상 활성');
      r.unmount();
    }
    const stage = selectUnlockStage(useOnboardingGate.getState());
    assert(stage === 0, `단계 계산 자체는 남아 있다(신규=0) — 실제 ${stage}`);
  });

  // ── 3. 단계가 올라가도 화면은 달라지지 않는다 (CO-N-1 ③ 회귀 가드) ────────
  // 단계 계산(onboardingGate)은 남겼지만 **소비하는 화면이 없다.** 세션 완료 수와
  // 무관하게 세 화면이 같은 실제 페이지여야 한다 — 게이트가 되살아나면 여기서 깨진다.
  await scenario('세션 완료 0회·3회 어느 쪽이든 보드·예보 대결·리그가 같은 실제 페이지', async () => {
    const gate = useOnboardingGate.getState();
    ['sess-1', 'sess-2', 'sess-3'].forEach((id) => {
      gate.recordSessionComplete(id);
      gate.recordSessionComplete(id); // 멱등: 같은 세션 id를 두 번 세지 않는다
    });
    const stage = selectUnlockStage(useOnboardingGate.getState());
    assert(stage === 3, `세션 3회 후 단계 3 기대 — 실제 ${stage}`);

    for (const [path, gone] of [
      ['/board', '대기 보드란 무엇인가요'],
      ['/duel', '예보 대결이란 무엇인가요'],
      ['/league', '리그란 무엇인가요'],
    ]) {
      const r = mount(createElement(App), path);
      await waitFor(() => !text().includes(gone), 5000, `${path} 실제 페이지`);
      r.unmount();
    }
  });

  // ── 4. 일일 목표 계약 왕복 + "오늘 목표 N/M" 표기 ─────────────────────────
  await scenario('PUT /progress/daily-goal 왕복 + 422 + 세션 완료 화면 N/M 표기', async () => {
    const bad = await api('PUT', '/progress/daily-goal', { items: 4 });
    assert(bad.status === 422, `허용값 밖은 422여야 함 — 실제 ${bad.status}`);
    assert(bad.body?.code === 'VALIDATION_ERROR', `code=VALIDATION_ERROR 기대 — 실제 ${bad.body?.code}`);

    const ok = await api('PUT', '/progress/daily-goal', { items: 3 });
    assert(ok.status === 200 && ok.body?.daily_goal_items === 3, `저장 응답 이상: ${JSON.stringify(ok)}`);
    const me = await api('GET', '/progress/me');
    assert(me.body.daily_goal_items === 3, `me.daily_goal_items=3 기대 — 실제 ${me.body.daily_goal_items}`);
    const answered = me.body.today_answered_count;
    assert(typeof answered === 'number', 'today_answered_count가 숫자여야 함');

    const r = mount(
      createElement(SessionSummary, {
        summary: { xp_total: 30, correct_count: 4, total: 5, streak_count: 1 },
      }),
      '/daily',
    );
    await waitFor(() => text().includes('오늘 목표'), 4000, '세션 완료 화면의 "오늘 목표 N/M"');
    assert(
      text().includes(`오늘 목표 ${Math.min(answered, 3)}/3`),
      `"오늘 목표 ${Math.min(answered, 3)}/3" 표기 기대 — 실제: ${text().slice(0, 200)}`,
    );
    r.unmount();
  });

  // ── 5. 배치고사 결과 화면에서 목표 선택 1스텝 ────────────────────────────
  await scenario('PlacementSummary 목표 선택 → PUT 저장 왕복', async () => {
    await api('POST', '/dev/reset-me', { reset: true });
    const mark = xhrLog.length;
    const r = mount(
      createElement(PlacementSummary, {
        summary: { correct_count: 4, total: 6, abilities: [] },
        onDone: () => {},
      }),
      '/onboarding/placement',
    );
    await waitFor(() => text().includes('하루 목표를 정해요'), 4000, '목표 선택 스텝 렌더');
    const btn = [...window.document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('9문항'),
    );
    assert(btn, '9문항 선택 버튼이 없다');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'PUT /api/v1/progress/daily-goal'),
      4000,
      'PUT /progress/daily-goal 발화',
    );
    const me = await api('GET', '/progress/me');
    assert(me.body.daily_goal_items === 9, `선택이 서버에 저장돼야 함 — 실제 ${me.body.daily_goal_items}`);
    await waitFor(() => text().includes('오늘부터 하루 9문항'), 3000, '저장 확인 문구');
    r.unmount();
  });
  // ── 6. Layout 배선: 세션 완료가 실제로 집계되고 배치고사는 제외된다 ───────
  await scenario('Layout이 세션 SUMMARY를 집계하고 배치고사(placement_done)는 제외', async () => {
    await api('POST', '/dev/reset-me', { reset: true });
    useOnboardingGate.getState().reset();
    useSessionStore.getState().reset();
    authenticate('layout-user');

    const r = mount(createElement(App), '/learn');
    await waitFor(() => useOnboardingGate.getState().bootstrapped, 4000, '게이트 부트스트랩');
    assert(selectUnlockStage(useOnboardingGate.getState()) === 0, '신규 사용자는 단계 0');

    // 배치고사 완료(placement_done) → 세지 않는다
    useSessionStore.setState({ sessionId: 'placement-session' });
    useSessionStore.getState().showSummary({ placement_done: true, correct_count: 4, total: 6 });
    await sleep(200);
    assert(
      selectUnlockStage(useOnboardingGate.getState()) === 0,
      '배치고사가 세션 완료로 집계됐다(진단은 세션이 아니다)',
    );

    // 데일리 세션 완료 → 1회로 집계
    useSessionStore.getState().reset();
    useSessionStore.setState({ sessionId: 'daily-session-1' });
    useSessionStore.getState().showSummary({ xp_total: 30, correct_count: 5, total: 5, streak_count: 1 });
    await waitFor(
      () => selectUnlockStage(useOnboardingGate.getState()) === 1,
      3000,
      'Layout이 세션 완료를 집계',
    );
    // CO-N-1 ③: 해제 축하 토스트는 **렌더하지 않는다**. 해제 사다리가 없어졌으니
    // "🧩 대기 보드가 열렸어요!"는 일어나지 않은 일을 알리는 문구다.
    await sleep(200);
    assert(!text().includes('대기 보드가 열렸어요'), '없어진 해제 토스트가 되살아났다');
    r.unmount();
    useSessionStore.getState().reset();
  });

  // ── 7. 에너지 신정책 UI: 잔량 0이면 누르기 전에 비활성 + 회복 ETA ─────────
  await scenario('구름 0: 학습 홈 세션 CTA 비활성 + "구름 회복까지" 인라인 표기', async () => {
    await api('POST', '/dev/reset-me', { reset: true }); // 오늘 세션·응답 없는 상태
    const zero = await api('POST', '/dev/clouds', { clouds: 0 });
    assert(zero.status === 200, `/dev/clouds 실패 (${zero.status})`);
    // 서버 계약 확인: 세션이 없으면 발급이 429로 막힌다(D6) → CTA 비활성이 정확
    const blocked = await api('GET', '/session/today');
    assert(blocked.status === 429 && blocked.body?.code === 'OUT_OF_CLOUDS',
      `세션 없음 + 잔량 0은 429 OUT_OF_CLOUDS여야 함 — 실제 ${blocked.status}`);
    useOnboardingGate.getState().reset();
    authenticate('empty-clouds-user');

    let r = mount(createElement(App), '/learn');
    await waitFor(() => text().includes('구름 회복까지 약'), 5000, '세션 CTA 인라인 회복 ETA');
    assert(text().includes('틀린 문항에만 1개'), '새 소모 규칙(실수에만 소모) 안내가 없다');
    // ⚠️ **하단 카드 CTA 단정은 삭제됐다**(2026-08-12 — 자유 일일 세션 제거).
    // 여기에는 `button` 중 「오늘의 세션 풀기」(`curriculum.daily.cta`)를 찾아
    // disabled를 확인하는 단정이 있었다. 그 문구의 소유자가 `LearnFooterCards`의
    // 자유 일일 세션 카드였고 카드째 제거됐다.
    //
    // 잃은 것은 없다. 그 단정은 이 시나리오의 **약한 쪽**이었다 — `button`을 훑어
    // 첫 번째를 찾으므로 하단 카드만 보고 통과했고, 화면에서 가장 큰 버튼인
    // **진입 배너**가 뚫려 있어도 초록이었다(2026-08-09 코드 리뷰에서 실제로
    // 발견된 구멍이다). 그래서 그때 배너를 따로 못 박는 아래 단정이 추가됐고,
    // 지금은 그것이 이 시나리오의 본체다: 잔량 0이면 `<a>`가 아니라 disabled
    // 버튼이어야 한다.
    const heroCta = window.document.querySelector('[data-testid="learn-entry-cta"]');
    assert(heroCta, '진입 배너 CTA를 찾지 못했다');
    assert(
      heroCta.tagName === 'BUTTON' && heroCta.disabled,
      `잔량 0에서 진입 배너 CTA가 살아 있다 — <${heroCta.tagName.toLowerCase()}> ` +
        '(누르면 429 OUT_OF_CLOUDS. R10이 폐지한 "누른 뒤에 알리는" 흐름이다)',
    );
    r.unmount();

    // 회복 후에는 원래대로 링크 CTA.
    // 종전에는 「오늘의 세션 풀기」 문구를 가진 `<a>`를 기다렸는데, 그 문구의
    // 소유자(자유 일일 세션 카드)가 제거됐다 — 진입 배너가 링크로 돌아오는 것을
    // 직접 기다린다. 어차피 아래 `heroBack` 단정이 재던 것이 그것이다.
    await api('POST', '/dev/clouds', { clouds: 5 });
    r = mount(createElement(App), '/');
    await waitFor(
      () => window.document.querySelector('[data-testid="learn-entry-cta"]')?.tagName === 'A',
      5000,
      '구름 회복 후 진입 배너 CTA 링크 복귀',
    );
    assert(!text().includes('구름 회복까지 약'), '회복 후에도 차단 안내가 남아 있다');
    const heroBack = window.document.querySelector('[data-testid="learn-entry-cta"]');
    assert(heroBack?.tagName === 'A', `회복 후 진입 배너 CTA가 링크로 안 돌아왔다 — <${heroBack?.tagName}>`);
    r.unmount();
  });

  // ── 7.1 뷰포트가 갈라지지 않는다: PC 스네이크 경로도 같은 게이트를 받는다 ──
  await scenario('구름 0: PC 경로(md↑) 유닛 노드가 모바일과 동일하게 잠긴다', async () => {
    await api('POST', '/dev/reset-me', { reset: true });
    const zero = await api('POST', '/dev/clouds', { clouds: 0 });
    assert(zero.status === 200, `/dev/clouds 실패 (${zero.status})`);
    useOnboardingGate.getState().reset();
    authenticate('pc-path-clouds-user');

    const r = mount(createElement(App), '/learn');
    // assert가 던져도 반드시 unmount한다 — 남은 트리가 다음 시나리오의
    // 뷰포트 선택자에 섞여 들어가면 실패 원인이 통째로 오해된다.
    try {
      await waitFor(() => pcUnitButtons().length > 0, 5000, 'PC 경로 유닛 노드 렌더');
      // jsdom에는 CSS 엔진이 없어 `md:hidden`/`hidden md:block`이 실제로 숨기지 않는다 —
      // 두 경로가 **동시에 DOM에 있으므로** 같은 상태에서 직접 대조할 수 있다.
      const pc = pcUnitButtons();
      const mobile = mobileUnitButtons();
      assert(mobile.length > 0, '모바일 지그재그 노드가 렌더되지 않았다');

      const openPc = pc.filter((b) => !b.disabled);
      assert(
        openPc.length === 0,
        `구름 0에서 PC 경로에 누를 수 있는 유닛이 ${openPc.length}개 남아 있다 — ` +
          'PcCurriculumPath에 energyBlocked가 전달되지 않으면 모바일만 잠기고 PC는 열려, ' +
          '문항 진입 전 차단(R10-01 S4)이 뷰포트별로 갈라진다',
      );
      assert(
        mobile.filter((b) => !b.disabled).length === 0,
        '모바일 경로에 누를 수 있는 유닛이 남아 있다(기존 계약 회귀)',
      );

      // 사유가 구분돼야 한다 — 선행 잠금(🔒)과 자원 부족은 다른 안내다.
      const energyLabelled = pc.filter((b) => (b.getAttribute('aria-label') ?? '').includes('구름 부족'));
      assert(
        energyLabelled.length > 0,
        'PC 경로에 "(구름 부족)" aria-label이 하나도 없다 — 선행 잠금과 사유가 구분되지 않는다',
      );
    } finally {
      r.unmount();
    }
  });

  // ── 7.2 회복 후 두 경로가 함께 열린다 (한쪽만 열리는 비대칭 금지) ─────────
  await scenario('구름 회복: PC·모바일 경로가 함께 열린다', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    useOnboardingGate.getState().reset();
    authenticate('pc-path-recovered-user');

    const r = mount(createElement(App), '/learn');
    try {
      await waitFor(() => pcUnitButtons().length > 0, 5000, 'PC 경로 유닛 노드 렌더');
      const pcOpen = pcUnitButtons().filter((b) => !b.disabled).length;
      assert(pcOpen > 0, '구름 회복 후에도 PC 경로가 전부 잠겨 있다');

      // ⚠️ **「열린 유닛 **수**가 같다」는 걷었다**(2026-08-13 — 섹션 접기 도입).
      //    PC 경로는 이제 **펼친 섹션의 노드만 마운트**하고(전 섹션을 펼치면
      //    콘텐츠가 12,836px이 되어 상위 섹션에 도달할 수 없었다) 모바일 목록은
      //    전 섹션을 그린다. 그래서 트리 전체를 세면 두 뷰포트가 반드시 갈린다
      //    (실측 PC 1 vs 모바일 2) — **세는 방법이 깨진 것이지 계약이 깨진 게 아니다.**
      //
      //    계약 본체는 「같은 게이트가 걸린다」이고 그것은 그대로 살아 있다.
      //    지키던 회귀도 그대로다: `PcCurriculumPath`에 `energyBlocked`를 안 넘기면
      //    모바일만 잠기고 PC는 열려, 문항 진입 전 차단(R10-01 S4)이 뷰포트별로
      //    갈라진다(실제로 났던 사고다 — 7.1 시나리오 주석 참조).
      //
      //    그래서 **두 뷰포트가 함께 그리는 유닛만 골라 하나씩 대조**한다.
      //    수 비교보다 오히려 촘촘하다 — 종전 식은 "PC가 A를 열고 모바일이 B를
      //    여는" 어긋남을 수만 같으면 통과시켰다. 이제 유닛 단위로 어긋나면 운다.
      //    양쪽 suffix는 전부 ` (…)` 꼴이라(잠김·구름 부족·진단으로 열림) 지운다.
      const unitKey = (b) => (b.getAttribute('aria-label') ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim();
      const verdicts = (list) => new Map(list.map((b) => [unitKey(b), !b.disabled]));
      const pcV = verdicts(pcUnitButtons());
      const mobileV = verdicts(mobileUnitButtons());
      const shared = [...pcV.keys()].filter((k) => mobileV.has(k));
      // 교집합이 비면 단정이 **조용히 통과**한다 — 대조가 성립하는지부터 못박는다.
      assert(
        shared.length > 0,
        `두 뷰포트가 함께 그리는 유닛이 없다 — PC ${pcV.size}종 / 모바일 ${mobileV.size}종`,
      );
      const mismatched = shared.filter((k) => pcV.get(k) !== mobileV.get(k));
      assert(
        mismatched.length === 0,
        `같은 유닛의 열림 여부가 뷰포트별로 다르다 — ${mismatched
          .slice(0, 3)
          .map((k) => `"${k}" PC ${pcV.get(k) ? '열림' : '잠김'} vs 모바일 ${mobileV.get(k) ? '열림' : '잠김'}`)
          .join(' / ')}`,
      );
      assert(
        pcUnitButtons().every((b) => !(b.getAttribute('aria-label') ?? '').includes('구름 부족')),
        '회복 후에도 "(구름 부족)" 표기가 남아 있다',
      );
    } finally {
      r.unmount();
    }
  });

  // ── 8. "풀던 것을 뺏기지 않는다": 진행 중 세션은 잔량 0에서도 재조회 200 ────
  //
  // ⚠️ **UI 단정은 걷어냈다**(2026-08-12 — 자유 일일 세션 `/daily` 제거).
  // 이 시나리오는 원래 화면까지 봤다: 잔량 0이어도 CTA가 disabled로 죽지 않고
  // 「풀던 세션 이어서 풀기」로 바뀌는지. 그 문구(`curriculum.daily.resume`)와
  // 재개 안내(`daily.regenResume`)의 소유자가 `LearnFooterCards`의 자유 일일 세션
  // 카드였고, 클라이언트 지시로 카드·라우트가 통째로 제거됐다.
  //
  // **폐기하지 않고 서버 계약 절반을 남기는 이유**: 불변식 자체("이미 발급된
  // 세션은 잔량 0에서도 200")는 살아 있고 오히려 더 중요해진다 — 유닛 세션이
  // 오늘 날씨를 받는 쪽으로 옮겨 가는 중이라(담당 B) 같은 규칙이 그쪽에 걸린다.
  // 여기서 지키는 것은 **목이 그 계약을 지키는가**이고, 이것이 깨지면 어느
  // 화면이 소비하든 함께 깨진다.
  //
  // ⚠️ **유닛 세션 쪽 재개 UI 단정은 아직 수신자가 없다** — 담당 B가 서버를
  // 착지시킨 뒤 그 화면을 소유하는 스모크에 행으로 받아야 한다. 여기 주석에만
  // 남기면 이월 대장이 못 본다(CLAUDE.md 「이월은 대장에만 존재한다」).
  await scenario('구름 0 + 진행 중 세션: 발급된 세션은 재조회 200(뺏기지 않는다)', async () => {
    await api('POST', '/dev/reset-me', { reset: true });
    await api('POST', '/dev/clouds', { clouds: 5 });
    const today = await api('GET', '/session/today');
    assert(today.status === 200, `세션 발급 실패 (${today.status})`);
    // 오답 1건 → today_answered_count=1 (진행 중 세션이 살아 있다는 신호)
    const ans = await api('POST', `/session/${today.body.session_id}/answer`, {
      quiz_id: today.body.items[0].quiz_id,
      answer: '__wrong__',
      elapsed_sec: 3,
    });
    assert(ans.status === 200, `답안 제출 실패 (${ans.status})`);
    assert(ans.body?.clouds_spent === 1, `오답은 clouds_spent=1이어야 함 — 실제 ${ans.body?.clouds_spent}`);
    await api('POST', '/dev/clouds', { clouds: 0 });
    // 서버 계약: 이미 발급된 세션은 잔량 0에서도 200 재조회
    const again = await api('GET', '/session/today');
    assert(again.status === 200, `발급된 세션 재조회는 200이어야 함 — 실제 ${again.status}`);

    // 재조회가 새로 소모하지도 않는다 — 200이면서 잔량은 0 그대로여야 한다.
    // (소모가 붙으면 "풀던 것을 뺏기지 않는다"가 음수 잔량으로 우회 위반된다.)
    const meAfter = await api('GET', '/progress/me');
    assert(
      meAfter.body?.clouds === 0,
      `발급된 세션 재조회가 구름을 더 소모했다 — 잔량 ${meAfter.body?.clouds}`,
    );
    await api('POST', '/dev/clouds', { clouds: 5 });
  });
  // ── 9. 오답 피드백의 "구름 −1"은 서버 실측 clouds_spent만 쓴다(D10-1) ─────
  await scenario('ResultBanner: clouds_spent>0에만 "구름 −1" 표기 (is_correct로 계산 금지)', async () => {
    const ResultBanner = (await vite.ssrLoadModule('/src/modules/quiz/ResultBanner.jsx')).default;
    let r = mount(createElement(ResultBanner, {
      result: { is_correct: false, correct_answer: 'A', xp_earned: 2, clouds_spent: 1, clouds: 3 },
    }), '/daily');
    await waitFor(() => text().includes('구름 −1'), 3000, '소모 표기');
    r.unmount();

    // 잔량 0에서 오답 → 소모 0: 오답이지만 표기하지 않는다(§3.1 각주 7)
    r = mount(createElement(ResultBanner, {
      result: { is_correct: false, correct_answer: 'A', xp_earned: 2, clouds_spent: 0, clouds: 0 },
    }), '/daily');
    await sleep(150);
    assert(!text().includes('구름 −'), '소모 0인 오답에 구름 표기가 떴다(is_correct로 계산한 회귀)');
    r.unmount();

    // 필드 부재(구 백엔드) → 미표기
    r = mount(createElement(ResultBanner, {
      result: { is_correct: false, correct_answer: 'A', xp_earned: 2 },
    }), '/daily');
    await sleep(150);
    assert(!text().includes('구름 −'), 'clouds_spent 부재 응답에 구름 표기가 떴다');
    r.unmount();
  });

  // ── 10. 자동 게스트 발급 (CO-N-1 ① — 대회 규정 「로그인 없이 열려야」) ─────
  //
  // 종전 `App.jsx`의 RequireAuth는 토큰이 없으면 곧장 `/login`으로 튕겼다. 규정은
  // 심사위원이 계정 없이 URL만으로 서비스를 열 수 있을 것을 요구한다. 서버에는
  // 이미 POST /auth/guest(실 유저 + 실 JWT)가 있으므로 첫 진입에서 대신 누른다.
  // `/`는 2026-08-09부터 `/learn` 리다이렉트다(홈 화면 삭제) — 이 시나리오가 보는
  // 것은 "보호 라우트가 로그인 화면으로 튕기지 않고 그대로 렌더되는가"라 목적지
  // 이름만 바뀌고 계약은 같다.
  //
  // ⚠️ **갱신됨(2026-08-13 클라이언트 지시 ⑵⑶ — 첫 접속 정보 입력).** 맨 URL(`/`)로
  // 들어온 첫 접속에는 이제 **발급 앞에** 정보 입력 화면이 한 장 선다. 학령을
  // `POST /auth/guest`의 **바디**에 실어야 하는데(요구 ⑶), 발급은 한 번뿐이라
  // 고르기 전에 발급해 버리면 그 문이 영영 닫히기 때문이다.
  //
  // 그래서 무는 것을 **둘로 나눈다**:
  //   ⓐ 규정(「로그인 없이 열려야」) — 화면이 뜨되 **아무것도 입력하지 않고
  //      건너뛸 수 있고**, 건너뛰면 곧장 서비스가 렌더된다. 로그인 폼이 아니다.
  //   ⓑ 종전 계약 그대로 — 발급은 **정확히 1회**, 게스트 표식이 서고, 보호
  //      라우트가 실제로 렌더된다(탭바 5).
  // 딥링크는 이 게이트를 타지 않는다 — 시나리오 11(`/explore`)이 그쪽을 문다.
  await scenario('토큰 없이 진입: 정보 입력 → 건너뛰기 → POST /auth/guest 1회 + 학습 화면', async () => {
    resetGuestAutoIssue();
    useAuthStore.getState().logout();
    useOnboardingGate.getState().reset();
    useSessionStore.getState().reset();
    const mark = xhrLog.length;

    const r = mount(createElement(App), '/');
    // ⓐ 첫 접속 정보 입력이 먼저다 — 그리고 **로그인 폼이 아니다**(규정).
    await waitFor(
      () => window.document.querySelector('[data-testid="entry-info"]') !== null,
      6000,
      '첫 접속 정보 입력 화면',
    );
    assert(
      !/로그인|회원가입/.test(text()),
      '정보 입력 화면에 「로그인」·「회원가입」 문구가 떴다(규정 위반)',
    );
    // 아직 발급 전이어야 한다 — 학령이 바디에 실릴 기회가 여기서만 있다.
    assert(
      xhrLog.slice(mark).filter((l) => l === 'POST /api/v1/auth/guest').length === 0,
      '정보 입력을 보여주기도 전에 게스트가 발급됐다 — 학령을 실을 문이 닫힌다',
    );
    // 아무것도 고르지 않고 건너뛴다(규정 — 입력 없이도 학습에 도달해야 한다).
    const skip = window.document.querySelector('[data-testid="entry-info-skip"]');
    assert(skip, '건너뛰기 통로가 없다 — 규정 「로그인 없이 열려야」가 깨진다');
    skip.click();

    await waitFor(
      () => Boolean(useAuthStore.getState().accessToken),
      6000,
      '자동 게스트 토큰 발급',
    );
    const calls = xhrLog.slice(mark).filter((l) => l === 'POST /api/v1/auth/guest');
    assert(calls.length === 1, `게스트 발급은 정확히 1회여야 함(중복 방지) — 실제 ${calls.length}`);
    assert(useAuthStore.getState().user?.is_guest === true, '게스트 표식(is_guest)이 없다');
    // 로그인 화면이 아니라 실제 서비스 화면이 떠야 한다
    await waitFor(() => !text().includes('계정 없이 바로 시작하기'), 5000, '로그인 화면이 아님');
    await waitFor(() => tabCount() === 5, 5000, '보호 라우트가 실제로 렌더됐다(탭바 존재)');
    r.unmount();
  });

  // ── 10-b. 발급 실패 → **재시도 화면**(로그인 폼이 아니다) — MT-29 ──────────
  //
  // ⚠️ 이 시나리오가 없어서 재시도 버튼이 **아무 일도 안 하는 채로** 커밋됐다
  // (코드 리뷰 2026-08-12). 소스에 `GuestIssueRetry`가 있는지 grep하는 계약은
  // 통과했지만, 버튼을 누르면 effect 의존성(`[accessToken]`)이 그대로라 발급이
  // 다시 안 돌았다 — 화면이 영구 스피너가 되고 사용자가 갇힌다. MT-29가 막으려던
  // 결과 그 자체다. **누르는 것까지** 봐야 계약이 성립한다.
  await scenario('발급 실패: 로그인 폼이 아니라 재시도 화면 · 누르면 실제로 다시 발급된다', async () => {
    resetGuestAutoIssue();
    useAuthStore.getState().logout();

    // ⚠️ `vite.ssrLoadModule`이어야 **App과 같은 모듈 인스턴스**를 잡는다.
    // 평범한 import()는 Node ESM으로 따로 적재돼 스텁이 App에 안 닿는다.
    const clientMod = await vite.ssrLoadModule('/src/api/client.js');
    const realPost = clientMod.default.post.bind(clientMod.default);
    let failing = true;
    clientMod.default.post = (url, ...rest) =>
      failing && url === '/auth/guest'
        ? Promise.reject(new Error('network down'))
        : realPost(url, ...rest);

    try {
      const r = mount(createElement(App), '/');
      // 2026-08-13: `/` 첫 접속에는 정보 입력이 먼저다 — 건너뛰어 발급을 태운다.
      // 여기서 재는 것은 **그 뒤의 실패 처리**라, 게이트 자체는 시나리오 10이 문다.
      await waitFor(
        () => window.document.querySelector('[data-testid="entry-info-skip"]') !== null,
        6000,
        '첫 접속 정보 입력 화면',
      );
      window.document.querySelector('[data-testid="entry-info-skip"]').click();
      await waitFor(() => text().includes('다시 시도하기'), 6000, '재시도 화면');
      // 규정: 로그인 없이 열려야 한다 — 실패했다고 로그인 폼을 들이밀지 않는다
      assert(!text().includes('계정 없이 바로 시작하기'), '발급 실패에 로그인 화면이 떴다');

      failing = false; // 연결이 돌아왔다
      const retry = [...window.document.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('다시 시도하기'),
      );
      assert(retry, '재시도 버튼을 못 찾았다');
      retry.click();

      await waitFor(
        () => Boolean(useAuthStore.getState().accessToken),
        6000,
        '재시도가 실제로 발급을 다시 일으킨다',
      );
      await waitFor(() => tabCount() === 5, 5000, '재시도 뒤 서비스 화면이 뜬다');
      r.unmount();
    } finally {
      clientMod.default.post = realPost;
      resetGuestAutoIssue();
    }
  });

  // ── 11. 딥링크 보존 + 토큰이 지워져도 조용한 재발급이 없다 ─────────────────
  //
  // ⚠️ **갱신됨(2026-08-12 클라이언트 지시 — 로그인·회원가입 구조 전면 제거).**
  // 이 시나리오의 뒷단은 원래 "**로그아웃**은 재발급 없음"이었다. 헤더 로그아웃
  // 버튼이 제거됐으므로 그 이름의 사용자 행동은 더 이상 존재하지 않는다.
  //
  // 그래도 **폐기하지 않고 갱신한다** — 무는 불변식이 로그아웃 버튼이 아니라
  // `guestAttempted` 플래그이고, 토큰이 지워지는 경로는 여전히 살아 있기 때문이다:
  // `api/client.js:112`의 401 인터셉터가 `authStore.logout()`을 부른다(만료·서버
  // 재시작). 그때 보호 라우트가 조용히 새 게스트를 발급하면 **만료가 계정 교체로
  // 둔갑한다** — 학습자가 남의 진도(정확히는 빈 진도)를 보게 된다. 버튼이 사라진
  // 지금이 오히려 이 가드가 유일한 감시자다.
  //
  // 단정 하나를 **더한다**: 재발급이 없을 뿐 아니라 화면이 `GuestIssueRetry`여야
  // 한다. 로그인 화면이 없어져 App.jsx의 `guestSettled` 분기가 여기로 오는데,
  // 그 분기가 빠지면 사용자는 빈 화면이나 영구 스피너에 갇힌다.
  await scenario('토큰 없이 /explore 딥링크 → /explore 렌더 · 토큰 소실 후 조용한 재발급 없음 + 재시도 화면', async () => {
    resetGuestAutoIssue();
    useAuthStore.getState().logout();
    const r = mount(createElement(App), '/explore');
    await waitFor(() => Boolean(useAuthStore.getState().accessToken), 6000, '자동 게스트 토큰');
    await waitFor(() => text().includes('탐구'), 5000, '/explore 화면 렌더(딥링크 보존)');
    r.unmount();

    // ⚠️ **언마운트 뒤 정지(quiesce)를 기다린 다음 로그아웃한다.** 앞 마운트가
    // 띄운 요청이 아직 날고 있으면, 그 응답의 401을 `api/client.js` 인터셉터가
    // 받아 `POST /auth/refresh` → `setTokens`로 **토큰을 되살린다**. 그러면 이
    // 시나리오는 재시도 화면 대신 학습 화면을 보고 간헐 실패한다(실측: 같은
    // 코드가 연속 3회 통과 뒤 실패). 지우기 전에 조용해질 때까지 기다린다.
    await sleep(600);
    const mark = xhrLog.length;
    useAuthStore.getState().logout();
    const r2 = mount(createElement(App), '/');
    await sleep(400);
    const calls = xhrLog.slice(mark).filter((l) => l === 'POST /api/v1/auth/guest');
    assert(calls.length === 0, `토큰 소실 후 게스트 재발급이 나갔다 — ${calls.length}회`);
    // 토큰이 되살아났으면 아래 화면 단정이 엉뚱한 이유로 죽는다 — 원인을 갈라 둔다.
    assert(
      !useAuthStore.getState().accessToken,
      '로그아웃 뒤 토큰이 되살아났다(늦게 도착한 401 → refresh 경로) — '
        + `이후 XHR: ${JSON.stringify(xhrLog.slice(mark))}`,
    );
    // 갈 곳이 없어 빈 화면이 되면 안 된다. 로그인 화면은 제거됐으므로 재시도가 답이다.
    // ⚠️ 단정이 아니라 `waitFor`다 — 렌더 분기가 보는 `guestSettled`는 발급
    // 프라미스의 **체인된** .then에서 세워지므로, 토큰 등장과 같은 순간이 아니다.
    // 그 사이를 단정으로 찍으면 아직 스피너라 간헐 실패한다.
    await waitFor(
      () => text().includes('다시 시도하기'),
      3000,
      '토큰이 없는데 재시도 화면이 아니다 — 로그인 화면이 제거된 지금 사용자가 갇힌다',
    );
    r2.unmount();
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 온보딩 목표 커밋 + 점진적 해제(기존 사용자 회귀 0) 실마운트 스모크 통과');
process.exit(0);

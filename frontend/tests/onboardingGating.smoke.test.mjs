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
 * 시나리오
 *   1. 기존 사용자(목 기본 시드 xp=1180) → /league·/board 진입 시 실제 페이지가
 *      뜬다(동기 부여 화면 없음) = 회귀 0.
 *   2. 신규 사용자(POST /dev/reset-me → xp=0, 게이트 로컬 기록 없음) → /board·
 *      /duel·/league 모두 동기 부여 화면(해제 조건 + 세션 시작 CTA). 탭은 5개 모두
 *      활성(자물쇠 차단 없음 — 2026-08-01 판정).
 *   3. 세션 완료를 1·2·3회 기록하면 보드 → 예보 대결 → 리그가 순서대로 열린다.
 *   4. 일일 목표 왕복: PUT /progress/daily-goal(3) → GET /progress/me의
 *      daily_goal_items=3 · 허용값 밖(4)은 422 VALIDATION_ERROR ·
 *      세션 완료 화면(SessionSummary)에 "오늘 목표 N/M" 표기.
 *   5. 배치고사 결과 화면(PlacementSummary)에서 "5문항" 선택 → PUT 발생 + 저장 확인.
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

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
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
const lockedTabCount = () =>
  [...window.document.querySelectorAll('nav button[disabled]')].length;
const tabCount = () => window.document.querySelectorAll('nav a, nav button').length;

/** 학습 홈의 두 경로 유닛 버튼 — jsdom은 CSS를 적용하지 않아 둘 다 DOM에 있다.
 *  PC = `hidden md:block` 컨테이너, 모바일 = `md:hidden` 컨테이너. 클래스 선택자에
 *  콜론이 들어가므로 속성 부분일치로 고른다. */
const pcUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:block"] button[aria-label]')];
const mobileUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:hidden"] button[aria-label]')];

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
    assert(tabCount() === 5, `탭 5개가 모두 있어야 함 — 실제 ${tabCount()}`);
    r.unmount();

    r = mount(createElement(App), '/board');
    await waitFor(() => !text().includes('대기 보드란 무엇인가요'), 3000, '보드 페이지(잠금 화면 아님)');
    r.unmount();
  });

  // ── 2. 신규 사용자 → 동기 부여 화면(차단 아님) ───────────────────────────
  await scenario('신규 사용자(dev/reset-me): 보드·예보 대결·리그가 동기 부여 화면', async () => {
    const reset = await api('POST', '/dev/reset-me', { reset: true });
    assert(reset.status === 200, `/dev/reset-me 실패 (${reset.status})`);
    const me = await api('GET', '/progress/me');
    assert(me.body.xp === 0, `초기화 후 xp=0이어야 함 — 실제 ${me.body.xp}`);
    assert(me.body.daily_goal_items === null, '초기화 후 daily_goal_items=null이어야 함');

    useOnboardingGate.getState().reset();
    authenticate('fresh-user');

    for (const [path, needText] of [
      ['/board', '세션을 1개 완료하면'],
      ['/duel', '세션을 2개 완료하면'],
      ['/league', '세션을 3개 완료하면'],
    ]) {
      const r = mount(createElement(App), path);
      await waitFor(() => text().includes(needText), 4000, `${path} 잠금 안내(${needText})`);
      assert(text().includes('오늘의 세션 시작하기'), `${path}에 해제 CTA가 없다`);
      assert(lockedTabCount() === 0, '잠금은 탭 차단이 아니라 화면 안내여야 한다');
      assert(tabCount() === 5, '탭 5개는 항상 활성');
      r.unmount();
    }
    const stage = selectUnlockStage(useOnboardingGate.getState());
    assert(stage === 0, `신규 사용자 단계는 0이어야 함 — 실제 ${stage}`);
  });

  // ── 3. 세션 완료 1·2·3회 → 순서대로 해제 ─────────────────────────────────
  await scenario('세션 완료 1·2·3회 → 보드 → 예보 대결 → 리그 순서 해제', async () => {
    const gate = useOnboardingGate.getState();
    const steps = [
      { id: 'sess-1', path: '/board', gone: '대기 보드란 무엇인가요', stillLocked: '세션을 2개 완료하면' },
      { id: 'sess-2', path: '/duel', gone: '예보 대결이란 무엇인가요', stillLocked: '세션을 3개 완료하면' },
      { id: 'sess-3', path: '/league', gone: '리그란 무엇인가요', stillLocked: null },
    ];
    for (const [i, step] of steps.entries()) {
      gate.recordSessionComplete(step.id);
      // 멱등: 같은 세션 id를 두 번 세지 않는다
      gate.recordSessionComplete(step.id);
      const stage = selectUnlockStage(useOnboardingGate.getState());
      assert(stage === i + 1, `세션 ${i + 1}회 후 단계 ${i + 1} 기대 — 실제 ${stage}`);
      assert(
        useOnboardingGate.getState().toast != null,
        `해제 순간 축하 토스트가 예약돼야 함 (${step.path})`,
      );
      useOnboardingGate.getState().clearToast();

      const r = mount(createElement(App), step.path);
      await waitFor(() => !text().includes(step.gone), 4000, `${step.path} 해제 후 실제 페이지`);
      r.unmount();

      if (step.stillLocked) {
        const nextPath = steps[i + 1].path;
        const r2 = mount(createElement(App), nextPath);
        await waitFor(() => text().includes(step.stillLocked), 4000, `${nextPath}는 아직 잠금`);
        r2.unmount();
      }
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

    const r = mount(createElement(App), '/');
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

    // 데일리 세션 완료 → 1회로 집계 + 보드 해제 토스트
    useSessionStore.getState().reset();
    useSessionStore.setState({ sessionId: 'daily-session-1' });
    useSessionStore.getState().showSummary({ xp_total: 30, correct_count: 5, total: 5, streak_count: 1 });
    await waitFor(
      () => selectUnlockStage(useOnboardingGate.getState()) === 1,
      3000,
      'Layout이 세션 완료를 집계',
    );
    await waitFor(() => text().includes('대기 보드가 열렸어요'), 3000, '해제 축하 토스트 렌더');
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

    let r = mount(createElement(App), '/');
    await waitFor(() => text().includes('구름 회복까지 약'), 5000, '세션 CTA 인라인 회복 ETA');
    assert(text().includes('틀린 문항에만 1개'), '새 소모 규칙(실수에만 소모) 안내가 없다');
    const cta = [...window.document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('오늘의 세션 풀기'),
    );
    assert(cta && cta.disabled, '잔량 0에서 세션 진입 CTA가 비활성이어야 한다');
    r.unmount();

    // 회복 후에는 원래대로 링크 CTA
    await api('POST', '/dev/clouds', { clouds: 5 });
    r = mount(createElement(App), '/');
    await waitFor(
      () => [...window.document.querySelectorAll('a')].some((a) => a.textContent.includes('오늘의 세션 풀기')),
      5000,
      '구름 회복 후 세션 CTA 링크 복귀',
    );
    assert(!text().includes('구름 회복까지 약'), '회복 후에도 차단 안내가 남아 있다');
    r.unmount();
  });

  // ── 7.1 뷰포트가 갈라지지 않는다: PC 스네이크 경로도 같은 게이트를 받는다 ──
  await scenario('구름 0: PC 경로(md↑) 유닛 노드가 모바일과 동일하게 잠긴다', async () => {
    await api('POST', '/dev/reset-me', { reset: true });
    const zero = await api('POST', '/dev/clouds', { clouds: 0 });
    assert(zero.status === 200, `/dev/clouds 실패 (${zero.status})`);
    useOnboardingGate.getState().reset();
    authenticate('pc-path-clouds-user');

    const r = mount(createElement(App), '/');
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

    const r = mount(createElement(App), '/');
    try {
      await waitFor(() => pcUnitButtons().length > 0, 5000, 'PC 경로 유닛 노드 렌더');
      const pcOpen = pcUnitButtons().filter((b) => !b.disabled).length;
      const mobileOpen = mobileUnitButtons().filter((b) => !b.disabled).length;
      assert(pcOpen > 0, '구름 회복 후에도 PC 경로가 전부 잠겨 있다');
      assert(
        pcOpen === mobileOpen,
        `열린 유닛 수가 뷰포트별로 다르다 — PC ${pcOpen} vs 모바일 ${mobileOpen}`,
      );
      assert(
        pcUnitButtons().every((b) => !(b.getAttribute('aria-label') ?? '').includes('구름 부족')),
        '회복 후에도 "(구름 부족)" 표기가 남아 있다',
      );
    } finally {
      r.unmount();
    }
  });

  // ── 8. "풀던 것을 뺏기지 않는다": 진행 중 세션은 잔량 0에서도 진입 가능 ────
  await scenario('구름 0 + 진행 중 세션: CTA는 링크로 남고 "이어서 풀기"로 바뀐다', async () => {
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

    useOnboardingGate.getState().reset();
    authenticate('resume-user');
    const r = mount(createElement(App), '/');
    await waitFor(() => text().includes('풀던 세션 이어서 풀기'), 5000, '재개 CTA 문구');
    const disabledCta = [...window.document.querySelectorAll('button[disabled]')].find((b) =>
      b.textContent.includes('세션'),
    );
    assert(!disabledCta, '진행 중 세션이 있는데 세션 CTA가 비활성됐다(재개를 막는 회귀)');
    assert(text().includes('끝까지 마칠 수 있어요'), '재개 가능 안내가 없다');
    r.unmount();
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

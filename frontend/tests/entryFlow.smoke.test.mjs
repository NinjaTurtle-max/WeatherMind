/**
 * 진입 동선 계약 — 접속 → 정보 입력 → 배치고사 (2026-08-13 클라이언트 요구 ⑵⑶) —
 *   node tests/entryFlow.smoke.test.mjs
 *
 * 왜 있나. 로그인·회원가입 화면이 제거되면서(대회 규정 「로그인 없이 열려야」)
 * **학령을 물을 자리가 사라졌다.** 남은 진입은 `App.jsx`의 자동 게스트 발급
 * 하나인데 그것이 `client.post('/auth/guest')` — 바디가 없었다. 서버는
 * `POST /auth/guest {level_group?}`를 이미 받는데(`routers/auth.py` guest_login)
 * 프론트가 그 문을 안 써서 **모든 게스트가 `middle_high`로 시작**했고, 그것이
 * 클라이언트가 세 번 지적한 「초등인데 중등이 나온다」의 남은 뿌리다.
 *
 * ⚠️ **이 결함은 기존 스모크로는 원리적으로 안 잡힌다.** `onboardingGating`의
 * XHR 로그는 `"POST /api/v1/auth/guest"`(메서드+URL)만 남긴다 — 바디를 안 본다.
 * 그래서 여기서는 **axios 인터셉터로 요청 본문을 직접 집는다**(`region.smoke`가
 * 위경도 비전송을 재는 데 쓴 것과 같은 관례). 목은 소유 밖이라 손대지 않는다.
 *
 * 지키는 계약
 *   ① 맨 URL(`/`) 첫 접속에는 **정보 입력 화면이 발급보다 먼저** 뜬다. 발급은
 *      한 번뿐이라, 고르기 전에 발급해 버리면 학령을 실을 문이 영영 닫힌다.
 *      그 순간까지 `POST /auth/guest`가 **아직 안 나갔음**을 함께 단정한다.
 *   ② 그 화면은 **로그인·회원가입이 아니다** — 「로그인」·「회원가입」 문구가
 *      없고, 이메일·비밀번호 입력란도 없다(규정).
 *   ③ 학습 수준을 고르면 그 값이 **발급 바디에 실린다**(`{level_group}`) —
 *      요청 본문과 그 **결과**(`GET /auth/me`의 `level_group`)를 둘 다 본다.
 *      본문만 보면 서버가 무시해도 초록이고, 결과만 보면 어느 통로로 갔는지
 *      모른다(발급 바디인지 PATCH인지) — 요구 ⑶은 **발급 바디**를 지목했다.
 *   ④ 그 다음이 **배치고사**다 — `POST /onboarding/placement/start`가 실제로
 *      나가고 진단 화면이 뜬다. 「내 정보 입력창 이후로」가 지시 원문이다.
 *   ⑤ **건너뛸 수 있다.** 아무것도 고르지 않아도 학습 화면에 도달하고, 그때
 *      발급 바디는 **비어 있으며** 서버 기본값(`middle_high`)이 그대로다
 *      (하위 호환 — 「건너뛰면 지금과 같은 기본값」).
 *   ⑥ **딥링크는 게이트를 타지 않는다.** `/board`로 바로 들어온 심사위원은
 *      정보 입력을 거치지 않고 조작 0회로 보드에 도착한다 — 규정의 가장 강한
 *      형태를 딥링크에서는 그대로 유지한다.
 *   ⑦ 🔴 **닉네임을 비우고도 두 출구 모두 끝까지 통과된다**(2026-08-14). 닉네임은
 *      선택 항목이고, 선택이 필수로 굳으면 ①~⑥ 중 어느 것도 울지 않는다.
 *   ⑧ 적은 닉네임은 **발급 바디에 실린다** — 「다음」이든 「건너뛰기」든. 학령과
 *      독립이라 학령을 안 골라도 이름은 버리지 않는다.
 *
 * ⚠️ 시나리오 순서에 의존한다. 목의 `mockAuth.levelGroup`은 **프로세스 전역**이라
 * 앞 시나리오가 `elementary`로 바꿔 놓으면 뒤 시나리오의 기본값 단정이 오염된다.
 * 그래서 ⑤(건너뛰기, 바디 없음 → `middle_high` 복귀)를 ③ **뒤에** 둔다.
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트, 하네스 로케일 **ko 고정**.
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
// 한국어 문구(「로그인」·「회원가입」 부재 포함)를 단정하므로 제품 기본 로케일로 고정
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

const xhrLog = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  xhrLog.push(`${method} ${url}`);
  this.__wmUrl = url;
  return origXhrOpen.call(this, method, url, ...rest);
};

/**
 * 발급 바디를 **전선에서** 집는다 — 인터셉터 층이 아니라 XHR 층이다(⑦⑧).
 *
 * ⚠️ 아래 `guestBodies`(axios 인터셉터)로는 ⑧을 잴 수 없다. 닉네임을 얹는 쪽도
 * 요청 인터셉터인데(`EntryInfoPage`), axios는 요청 인터셉터를 **등록 역순**으로
 * 돌린다 — 이 파일의 관측자는 App 모듈이 적재된 **뒤에** 등록되므로 얹기보다
 * 먼저 실행되고, 실제로는 나간 바디에 닉네임이 있는데도 못 본 것으로 보인다.
 * 등록 순서에 기대는 관측은 계약이 아니라 사고다. `send()`가 받는 문자열은
 * 그런 순서와 무관한 **실제로 나간 바이트**라 그쪽을 본다.
 */
const wireBodies = [];
const origXhrSend = window.XMLHttpRequest.prototype.send;
window.XMLHttpRequest.prototype.send = function (body) {
  if (this.__wmUrl === '/api/v1/auth/guest') {
    wireBodies.push(body == null ? undefined : JSON.parse(body));
  }
  return origXhrSend.call(this, body);
};

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const AppMod = await vite.ssrLoadModule('/src/App.jsx');
const App = AppMod.default;
const { resetGuestAutoIssue } = AppMod;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
/**
 * ⚠️ `vite.ssrLoadModule`이어야 **App과 같은 axios 인스턴스**를 잡는다. 평범한
 * `import()`는 Node ESM으로 따로 적재돼 인터셉터가 App의 요청에 안 걸린다
 * (`onboardingGating` 10-b가 같은 함정을 주석으로 남겨 두었다).
 */
const client = (await vite.ssrLoadModule('/src/api/client.js')).default;

/** `POST /auth/guest`의 요청 본문 원본 — 이 파일의 핵심 관측 지점(요구 ⑶). */
const guestBodies = [];
client.interceptors.request.use((config) => {
  if (config.url === '/auth/guest') {
    // `undefined`(바디 없음)와 `{}`(빈 객체)는 서버에서 다른 뜻이다 — 그대로 담는다.
    guestBodies.push(config.data === undefined ? undefined : JSON.parse(JSON.stringify(config.data)));
  }
  return config;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${typeof label === 'function' ? label() : label}`);
}

/**
 * 마운트한 루트 — **시나리오가 끝나면 실패했더라도 반드시 걷는다.**
 *
 * ⚠️ 안 걷으면 **뒤 시나리오가 아예 실행되지 않는다.** 앞 시나리오가 단정 실패로
 * 중간에 던지면 `r.unmount()`가 안 돌고, 다음 `mountApp`이 같은 `#root`에 두 번째
 * 루트를 만든다 → `NotFoundError: The node to be removed is not a child of this
 * node`로 **프로세스가 통째로 죽는다**(2026-08-14 실측 — ⑦ 변이 확인 중 발견).
 * 그러면 "⑦이 붉다"와 "⑦이 돌지도 못했다"가 구분되지 않아, 뒤쪽 계약이 조용히
 * 무력해진다. 걷기는 멱등이라 시나리오 안의 `r.unmount()`와 겹쳐도 안전하다.
 */
const liveRoots = [];
function mountApp(path) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(App))),
  );
  let unmounted = false;
  const handle = {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      try {
        reactRoot.unmount();
      } catch {
        /* 이미 걷힌 뒤 — 정리 경로라 삼킨다 */
      }
    },
  };
  liveRoots.push(handle);
  return handle;
}

const api = async (method, path, body) => {
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const $ = (sel) => window.document.querySelector(sel);
const text = () => window.document.body.textContent ?? '';
const guestCalls = (mark) => xhrLog.slice(mark).filter((l) => l === 'POST /api/v1/auth/guest');

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};
async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  } finally {
    while (liveRoots.length) liveRoots.pop().unmount();
  }
}

/**
 * 첫 접속 상태로 되돌린다 — 토큰·모듈 플래그·관측 버퍼 전부.
 *
 * ⚠️ **지우기 전에 조용해질 때까지 기다린다.** 앞 마운트가 띄운 요청이 아직
 * 날고 있으면 그 응답의 401을 `api/client.js`의 인터셉터가 받아
 * `POST /auth/refresh` → `setTokens`로 **토큰을 되살린다**. 그러면 다음
 * 시나리오는 발급이 필요 없다고 판단해 `POST /auth/guest`가 0회가 되고,
 * "게이트를 안 탔다"와 "이미 토큰이 있었다"가 구분되지 않는다(실측 — ⑥이
 * 그 이유로 붉었다). `onboardingGating` 시나리오 11이 같은 함정을 적어 두었다.
 */
async function coldOpen() {
  await sleep(600);
  resetGuestAutoIssue();
  useAuthStore.getState().logout();
  guestBodies.length = 0;
  wireBodies.length = 0;
  return xhrLog.length;
}

const $ni = () => $('[data-testid="entry-info-nickname"]');
/** React 제어 입력 채우기 — onboardingSave·guest-convert 스모크와 같은 관례. */
function fillInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

try {
  // ── ①②③④ 정보 입력 → 학령이 발급 바디로 → 배치고사 ──────────────────────
  await scenario('①②③④ 접속 → 정보 입력(초등학생) → 발급 바디 → 배치고사', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');

    // ① 발급보다 먼저 뜬다
    await waitFor(() => $('[data-testid="entry-info"]'), 8000, '첫 접속 정보 입력 화면');
    ok(Boolean($('[data-testid="entry-info"]')), '① 맨 URL 첫 접속에 정보 입력 화면이 뜬다');
    ok(
      guestCalls(mark).length === 0,
      `① 정보 입력 전에는 게스트 발급이 나가지 않는다(학령을 실을 문) — 실제 ${guestCalls(mark).length}회`,
    );

    // ② 로그인·회원가입이 아니다 — 규정 계약(렌더 텍스트로 문다)
    ok(!text().includes('로그인'), '② 화면에 「로그인」 문구가 없다');
    ok(!text().includes('회원가입'), '② 화면에 「회원가입」 문구가 없다');
    ok(
      $('input[type="email"]') === null && $('input[type="password"]') === null,
      '② 계정을 만드는 화면이 아니다(이메일·비밀번호 입력란 없음)',
    );
    const notice = $('[data-testid="entry-info"]');
    ok(notice.getAttribute('aria-modal') === null, '② 안내가 모달 표식을 쓰지 않는다');
    ok(
      Boolean($('[data-testid="entry-info-skip"]')),
      '② 건너뛰기 통로가 화면에 있다(규정 「로그인 없이 열려야」)',
    );

    // ③ 초등학생을 고르고 다음 — 발급 바디에 실려야 한다
    const submit = $('[data-testid="entry-info-submit"]');
    ok(submit.disabled === true, '③ 아무것도 안 고르면 「다음」이 눌리지 않는다(건너뛰기와 구분)');
    $('[data-testid="entry-info-levels"] button[data-level="elementary"]').click();
    await sleep(60);
    ok(
      $('[data-testid="entry-info-submit"]').disabled === false,
      '③ 고르면 「다음」이 열린다',
    );
    $('[data-testid="entry-info-submit"]').click();

    await waitFor(() => guestBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      guestBodies[0]?.level_group === 'elementary',
      `③ 🔴 고른 학령이 **발급 바디**로 간다 — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
    // 결과까지 — 바디만 보면 서버가 무시해도 초록이다.
    await waitFor(() => Boolean(useAuthStore.getState().accessToken), 8000, '게스트 토큰');
    const me = await api('GET', '/auth/me');
    ok(
      me.body?.level_group === 'elementary',
      `③ 서버가 그 학령으로 계정을 세운다(「초등인데 중등이 나온다」의 뿌리) — 실제 ${me.body?.level_group}`,
    );

    // ④ 그 다음이 배치고사다
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      8000,
      () => `④ 정보 입력 뒤 배치고사가 시작되지 않았다 — 이후 XHR ${JSON.stringify(xhrLog.slice(mark))}`,
    );
    ok(true, '④ 정보 입력 → 배치고사 순서로 간다(POST /onboarding/placement/start)');
    // 화면까지 — 호출만 보면 "요청은 갔는데 화면이 안 떴다"를 놓친다. 문항 도착에
    // 한 왕복이 더 걸리므로 제목이 뜰 때까지 기다린다(즉시 재면 아직 로딩 문구다).
    await waitFor(
      () => text().includes('실력 진단'),
      8000,
      () => `배치고사 화면 렌더 — 실제 "${text().replace(/\s+/g, ' ').slice(0, 60)}"`,
    );
    ok(text().includes('건너뛰기'), '④ 진단도 건너뛸 수 있다(강제가 아니다)');
    r.unmount();
  });

  // ── ⑤ 건너뛰기: 바디 없이 발급 · 기본값 유지 · 학습 도달 ────────────────────
  await scenario('⑤ 건너뛰면 바디 없이 발급되고(기본값) 학습 화면에 도달한다', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $('[data-testid="entry-info-skip"]'), 8000, '첫 접속 정보 입력 화면');
    $('[data-testid="entry-info-skip"]').click();

    await waitFor(() => guestBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      guestBodies[0] === undefined || guestBodies[0]?.level_group === undefined,
      `⑤ 건너뛰면 발급 바디가 비어 있다(서버 기본값 그대로) — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
    const me = await api('GET', '/auth/me');
    ok(
      me.body?.level_group === 'middle_high',
      `⑤ 서버 기본값 middle_high가 유지된다(하위 호환) — 실제 ${me.body?.level_group}`,
    );
    // 아무것도 입력하지 않고 학습에 도달한다 — 규정의 본문.
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'GET /api/v1/curriculum'),
      8000,
      '⑤ 건너뛰었는데 학습 화면에 도달하지 못했다',
    );
    await waitFor(() => $('[data-testid="learn-entry"]'), 8000, '학습 진입 카드');
    ok(Boolean($('[data-testid="learn-entry"]')), '⑤ 입력 0회로 학습 화면이 열린다');
    ok(
      guestCalls(mark).length === 1,
      `⑤ 발급은 여전히 정확히 1회다 — 실제 ${guestCalls(mark).length}회`,
    );
    r.unmount();
  });

  // ── ⑥ 딥링크는 게이트를 타지 않는다 (조작 0회) ──────────────────────────────
  await scenario('⑥ 딥링크(/board)는 정보 입력 없이 조작 0회로 열린다', async () => {
    const mark = await coldOpen();
    const r = mountApp('/board');
    await waitFor(() => Boolean(useAuthStore.getState().accessToken), 8000, '자동 게스트 토큰');
    ok(
      $('[data-testid="entry-info"]') === null,
      '⑥ 딥링크에는 정보 입력 화면이 끼지 않는다(규정 — 조작 0회로 열려야 한다)',
    );
    ok(
      guestCalls(mark).length === 1,
      `⑥ 딥링크는 종전처럼 자동 발급된다 — 실제 ${guestCalls(mark).length}회`,
    );
    ok(
      guestBodies[0] === undefined || guestBodies[0]?.level_group === undefined,
      `⑥ 딥링크 발급은 바디가 없다(고른 적이 없다) — 실제 ${JSON.stringify(guestBodies[0])}`,
    );
    r.unmount();
  });

  // ── ⑦ 🔴 닉네임을 비우고도 끝까지 통과된다 (필수화 금지) ─────────────────────
  //
  // 🔴 **이 시나리오가 이 파일에서 가장 중요한 한 건이다.** 닉네임은 2026-08-14에
  // 붙은 **선택** 항목인데, 선택 항목이 필수로 굳는 것은 코드 한 글자로 일어난다
  // (`disabled={!picked}` → `disabled={!picked || !nickname.trim()}`). 그러면 대회
  // 규정(「로그인·결제 없이 열려야」)이 깨지는데 **다른 어떤 테스트도 안 운다** —
  // ①③④⑤는 닉네임을 아예 모르고, 건너뛰기를 잠가도 ⑤가 클릭만 하고 결과를
  // 기다리므로 시간 초과로만 갈린다.
  //
  // ⚠️ **`required` 속성의 부재를 재지 않는다.** 이 화면은 `<form>`이 없고 버튼이
  // `type="button"`이라 그 속성은 아무것도 막지 못한다 — 없다고 단정해 봐야 참인
  // 채로 필수화가 지나간다. 재는 것은 속성이 아니라 **비운 채로 도착하는가**다.
  await scenario('⑦ 닉네임을 비워도 두 출구 모두 통과된다(선택 항목 계약)', async () => {
    // ⑦-a 「다음」 출구 — 학령만 고르고 닉네임은 비운 채
    const markA = await coldOpen();
    let r = mountApp('/');
    await waitFor(() => $ni(), 8000, '닉네임 입력란');
    ok(Boolean($ni()), '⑦ 닉네임 입력란이 화면에 있다');
    ok($ni().value === '', '⑦ 처음엔 비어 있다(자동 입력 없음)');
    ok(
      $('[data-testid="entry-info-skip"]').disabled !== true,
      '⑦ 🔴 닉네임이 비어도 「건너뛰기」는 눌린다(규정 — 건너뛰기 상시)',
    );
    $('[data-testid="entry-info-levels"] button[data-level="adult"]').click();
    await sleep(60);
    ok(
      $('[data-testid="entry-info-submit"]').disabled === false,
      '⑦ 🔴 닉네임이 비어도 「다음」이 열린다(잠그는 것은 학령뿐)',
    );
    $('[data-testid="entry-info-submit"]').click();
    await waitFor(() => wireBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      wireBodies[0]?.nickname === undefined,
      `⑦ 안 적었으면 바디에 nickname 필드가 아예 없다 — 실제 ${JSON.stringify(wireBodies[0])}`,
    );
    await waitFor(
      () => xhrLog.slice(markA).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      8000,
      '⑦-a 닉네임 없이 배치고사에 도달하지 못했다',
    );
    ok(true, '⑦-a 🔴 닉네임을 비운 채 「다음」 → 배치고사까지 끝까지 간다');
    r.unmount();

    // ⑦-b 「건너뛰기」 출구 — 아무것도 안 적고 안 고른 채 학습까지
    const markB = await coldOpen();
    r = mountApp('/');
    await waitFor(() => $ni(), 8000, '닉네임 입력란');
    ok($ni().value === '', '⑦-b 닉네임을 비운 채로 둔다');
    $('[data-testid="entry-info-skip"]').click();
    await waitFor(() => $('[data-testid="learn-entry"]'), 8000, '⑦-b 학습 진입 카드');
    ok(Boolean($('[data-testid="learn-entry"]')), '⑦-b 🔴 닉네임을 비운 채 건너뛰기 → 학습 화면이 열린다');
    ok(
      guestCalls(markB).length === 1,
      `⑦-b 발급은 여전히 정확히 1회다 — 실제 ${guestCalls(markB).length}회`,
    );
    r.unmount();
  });

  // ── ⑧ 적은 닉네임은 발급 바디에 실린다 (두 출구 모두) ───────────────────────
  //
  // 학령과 같은 자리로 간다 — 게스트 유저 행이 만들어지는 곳이 발급 하나뿐이라
  // (`routers/auth.py guest_login`이 `nickname=f"게스트-{...}"`를 거기서 정한다)
  // 유일성을 걸 서버가 볼 자리도 거기다.
  //
  // ⚠️ **여기 있던 「오늘 서버는 이 필드를 조용히 무시한다」는 낡았다**(2026-08-14 오후).
  //    같은 날 `GuestStartRequest.nickname`(`min_length=1,max_length=50`)과 유일성
  //    검사가 착지했다 — 이제 서버가 받고, 겹치면 409 `NICKNAME_TAKEN`을 준다.
  //    이 시나리오가 **바디만** 재는 것은 그 시절의 잔재가 아니라 지금도 맞는 분업이다:
  //    「값이 실려 나가는가」는 여기가, 「겹쳤을 때 화면이 어떻게 되는가」는 아래 ⑨가 문다.
  await scenario('⑧ 적은 닉네임이 발급 바디에 실린다 — 「다음」·「건너뛰기」 양쪽', async () => {
    // ⑧-a 「다음」 — 학령과 나란히 실린다
    await coldOpen();
    let r = mountApp('/');
    await waitFor(() => $ni(), 8000, '닉네임 입력란');
    fillInput($ni(), '구름사냥꾼');
    await sleep(60);
    $('[data-testid="entry-info-levels"] button[data-level="elementary"]').click();
    await sleep(60);
    $('[data-testid="entry-info-submit"]').click();
    await waitFor(() => wireBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      wireBodies[0]?.nickname === '구름사냥꾼' && wireBodies[0]?.level_group === 'elementary',
      `⑧-a 🔴 닉네임이 학령과 함께 발급 바디로 간다 — 실제 ${JSON.stringify(wireBodies[0])}`,
    );
    r.unmount();

    // ⑧-b 「건너뛰기」 — 학령은 안 골랐어도 이름은 버리지 않는다. 닉네임은 학령과
    //      독립이므로 「건너뛰기 = 아무것도 안 보냄」이 아니라 「학령을 안 보냄」이다.
    await coldOpen();
    r = mountApp('/');
    await waitFor(() => $ni(), 8000, '닉네임 입력란');
    fillInput($ni(), '비구름');
    await sleep(60);
    $('[data-testid="entry-info-skip"]').click();
    await waitFor(() => wireBodies.length >= 1, 8000, 'POST /auth/guest 발화');
    ok(
      wireBodies[0]?.nickname === '비구름' && wireBodies[0]?.level_group === undefined,
      `⑧-b 건너뛰어도 이름은 실리고 학령은 안 실린다 — 실제 ${JSON.stringify(wireBodies[0])}`,
    );
    // 학령 기본값이 그대로여야 한다 — 닉네임을 얹는 인터셉터가 ⑤의 계약을
    // 건드리지 않았음을 여기서 한 번 더 못박는다(같은 바디를 만지는 코드다).
    const me = await api('GET', '/auth/me');
    ok(
      me.body?.level_group === 'middle_high',
      `⑧-b 이름만 적었으면 학령은 서버 기본값 그대로다 — 실제 ${me.body?.level_group}`,
    );
    r.unmount();
  });

  // ── ⑨ 이름이 겹치면 정보 입력으로 되돌아온다 (409 NICKNAME_TAKEN) ──────────
  //
  // 🔴 **이 계약이 없으면 「이름의 증발」이 되살아난다.** 처음 만든 판은 닉네임을
  //    axios 인터셉터로 요청에 얹었는데, 그 구조는 **응답의 종류를 화면에 알릴
  //    통로가 없다** — 409가 오면 일반 발급 실패로 취급돼 재시도 화면으로 가고,
  //    값이 일회성이라 재시도는 **이름 없이 나가 성공한다.** 학습자는 오류를 보는
  //    것이 아니라 자기가 적은 이름이 사라진 것을 겪는다(대장 §4.16).
  //
  // ⚠️ **`NICKNAME_TAKEN`만 폼으로 되돌린다.** 나머지 실패는 전부 `GuestIssueRetry`다
  //    — 넓히면 MT-29가 고친 결함(발급 실패를 폼으로 보내는 것)이 그대로 재발하고,
  //    그것이 규정의 「로그인 없이 열려야」를 연결 나쁜 심사위원에게서 깨뜨린다.
  //
  // 🔴 **그 경계를 무는 것은 이 파일이 아니다.** 처음 이 자리에 "⑨-c가 그 경계를
  //    문다"고 적었는데 **거짓이었고 되돌림 확인이 잡았다**: 분기를 `if (!ok)`로
  //    넓혀도 ⑨는 전건 초록이었다. 당연하다 — 이 시나리오가 만드는 실패는 **중복
  //    하나뿐**이라, 「중복 **아닌** 실패가 폼으로 새는가」를 잴 표본이 없다.
  //    실제 소유자는 `onboardingGating.smoke`의 「발급 실패: 로그인 폼이 아니라
  //    재시도 화면」이고, 같은 변이에서 그쪽이 6초 타임아웃으로 운다(실측).
  //    ⑨-c가 무는 것은 **반대 방향**이다 — 중복일 때 재시도 화면으로 새지 않는가.
  //    둘이 합쳐져야 경계가 양쪽에서 닫힌다.
  //
  // 목이 `날씨러버`를 **이미 쓰이는 이름으로 시드**해 둔다(정식 계정 닉네임 —
  // `registeredEmails`가 `taken@…`을 시드하는 것과 같은 관례). 그래서 이 시나리오는
  // 앞선 발급에 의존하지 않고 **결정적으로** 409를 만든다.
  await scenario('⑨ 겹치는 이름 → 정보 입력으로 되돌아오고 적은 이름이 남는다', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $ni(), 8000, '닉네임 입력란');
    fillInput($ni(), '날씨러버');
    await sleep(60);
    $('[data-testid="entry-info-levels"] button[data-level="adult"]').click();
    await sleep(60);
    $('[data-testid="entry-info-submit"]').click();

    // ⑨-a 되돌아온다 — 재시도 화면이 아니라 **정보 입력 화면**이다
    await waitFor(
      () => $('[data-testid="entry-info-nickname-taken"]'),
      8000,
      '중복 안내와 함께 정보 입력 화면 복귀',
    );
    ok(
      Boolean($('[data-testid="entry-info"]')),
      '⑨-a 🔴 겹치는 이름이면 정보 입력 화면으로 되돌아온다(재시도 화면이 아니다)',
    );

    // ⑨-b 적은 이름이 그대로 남는다 — 비우면 방금 친 것을 또 쳐야 한다
    ok(
      $ni()?.value === '날씨러버',
      `⑨-b 적은 이름이 입력란에 남아 있다 — 실제 "${$ni()?.value}"`,
    );

    // ⑨-c **경계** — 재시도 화면으로 새지 않았다. 이 단정이 MT-29 회귀를 문다.
    ok(
      $('[data-testid="guest-issue-retry"]') === null,
      '⑨-c 중복은 재시도 화면으로 가지 않는다(발급 실패와 사유가 다르다 — MT-29)',
    );

    // ⑨-d 이름을 바꾸면 통과한다 — 되돌아온 화면이 **살아 있는 화면**이어야 한다
    //     (얼어붙은 화면이면 학습자가 갇힌다 — 재시도가 effect 의존성에 있어야
    //      한다는 계약과 같은 뿌리다).
    fillInput($ni(), '아직안쓴이름');
    await sleep(60);
    $('[data-testid="entry-info-levels"] button[data-level="adult"]').click();
    await sleep(60);
    $('[data-testid="entry-info-submit"]').click();
    await waitFor(
      () => useAuthStore.getState().accessToken,
      8000,
      '이름을 바꾼 뒤 발급 성공',
    );
    const sent = wireBodies.at(-1);
    ok(
      sent?.nickname === '아직안쓴이름',
      `⑨-d 바꾼 이름으로 다시 나간다 — 실제 ${JSON.stringify(sent)}`,
    );
    ok(
      guestCalls(mark).length === 2,
      `⑨-d 발급은 겹친 1회 + 성공 1회 = 2회다 — 실제 ${guestCalls(mark).length}회`,
    );
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
console.log('OK: 진입 동선(접속 → 정보 입력 → 배치고사 · 학령·닉네임이 발급 바디로 · 닉네임은 선택 · 건너뛰기 · 딥링크) 통과');
process.exit(0);

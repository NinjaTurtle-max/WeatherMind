/**
 * 진도 불러오기 계약 — 닉네임 하나로 돌아온다 (2026-08-19 클라이언트 지시) —
 *   node tests/loadProgress.contract.test.mjs
 *
 * ## 왜 있나 — 「번들에 문자열이 있는지만 보고 화면을 안 열어서」 놓쳤다
 * 실서버가 두 가지를 동시에 틀리고 있었다.
 *   · 진입 화면에 **불러오기 진입점이 없었다** — `/login` URL을 직접 아는 사람만
 *     닿았다. 화면이 닉네임을 적게 해 놓고 그 이름으로 돌아올 문이 안 보였다.
 *   · 불러오기 화면이 **이메일·비밀번호**를 요구했다. 게스트 비밀번호는 무작위
 *     시크릿이라 **원리적으로 아무도 못 여는 문**이었다.
 * 둘 다 「문구가 저장소에 있다」로는 초록이었다. 그래서 이 파일의 단정은 예외 없이
 * **실제로 마운트한 화면의 렌더 결과**를 본다 — 소스 grep도, 번들 문자열도 아니다.
 *
 * ## 지키는 계약
 *   ① **진입 화면에 불러오기 진입점이 렌더된다.** 맨 URL(`/`) 콜드 오픈 — 첫
 *      방문자가 아니라 **돌아온 사람**이 보는 자리이므로, 아무것도 적기 전에
 *      화면에 있어야 한다.
 *   ② 그것을 누르면 **불러오기 화면이 실제로 뜬다.** 라우트 문자열이 아니라
 *      렌더된 폼을 본다(그 둘이 갈리는 것이 8/13 사고였다 — 라우트만 걷혔다).
 *   ③ 🔴 **불러오기가 닉네임만 받는다.** `input[type="password"]`·
 *      `input[type="email"]`이 **없다**는 것까지 단정한다 — 있는 것만 세는 계약은
 *      필드가 되살아나도 조용하다. 나가는 요청 바디도 `{nickname}` 하나뿐이다.
 *   ④ 🔴 **불러오기가 진입을 막지 않는다**(2026-08-19 PM 추가 계약). ①과 **반대
 *      방향**의 단정이고 둘 다 있어야 한다 — 하나만 있으면 「진입점을 키우다가 주
 *      동선을 덮는」 변경이 조용히 통과한다. 규정(「로그인·결제 없이 열려야」)이
 *      금지하는 것은 주 동선이 계정을 요구하는 것이고, 불러오기는 **선택 경로**다.
 *        ⓐ 「건너뛰기」가 여전히 렌더되고, 눌러서 **학습 화면에 도달**한다.
 *        ⓑ 「다음」도 종전대로 학령만 고르면 열린다.
 *        ⓒ 불러오기는 **필수 단계가 아니다** — 아무것도 안 넣고 앞으로 간다.
 *   ⑤ 실제로 **돌아와진다.** 저장된 이름을 넣으면 토큰이 갈리고 학습으로 간다.
 *      없는 이름·동명이인은 **각각 다른 안내**가 그 자리에 뜬다(서버 코드 1:1).
 *
 * ## 🔴 이 파일이 **못 무는 것** — 읽는 사람이 알아야 한다
 *   · **실화면(브라우저) 확인이 아니다.** jsdom 렌더라 CSS·레이아웃·겹침·색 대비를
 *     모른다. 「진입점이 렌더 트리에 있다」와 「사람 눈에 보인다」는 다르다.
 *   · **본인 확인을 안 본다.** 남의 닉네임을 넣으면 그 진도로 들어가는 것이 현재
 *     설계이고(규정 해석 — 클라이언트 결정), 이 파일은 그것을 결함으로 세지 않는다.
 *   · 서버 판정 자체는 `backend/tests/test_auth_resume.py`가 소유한다. 여기는 목을
 *     타므로 「프론트가 서버 계약대로 부르고 응답대로 말하는가」까지다.
 *
 * 관례는 `entryFlow.smoke`와 동일: 테스트 러너 의존 없음, vite middlewareMode +
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
// 한국어 문구를 단정하므로 제품 기본 로케일로 고정
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
 * 불러오기 요청 바디를 **전선에서** 집는다(③). axios 인터셉터가 아니라 XHR
 * `send()`인 이유는 `entryFlow`가 적어 둔 것과 같다 — 인터셉터 관측은 등록 순서에
 * 기대므로 계약이 아니라 사고다. `send()`가 받는 문자열은 **실제로 나간 바이트**다.
 */
const resumeBodies = [];
const origXhrSend = window.XMLHttpRequest.prototype.send;
window.XMLHttpRequest.prototype.send = function (body) {
  if (this.__wmUrl === '/api/v1/auth/resume') {
    resumeBodies.push(body == null ? undefined : JSON.parse(body));
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
 * 안 걷으면 다음 `mountApp`이 같은 `#root`에 두 번째 루트를 만들어 프로세스가
 * 통째로 죽고, 그러면 뒤 계약이 「붉다」가 아니라 「돌지도 못했다」가 된다
 * (`entryFlow.smoke`가 실측으로 남긴 함정).
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

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

let failed = 0;
const ok = (cond, label) => {
  // 라벨은 문자열이거나 **함수**다(실패했을 때만 화면을 훑도록) — 함수를 그대로
  // 찍으면 실패 메시지 자리에 소스 코드가 나와 원인을 못 가리킨다.
  console.log(`${cond ? 'PASS' : 'FAIL'} ${typeof label === 'function' ? label() : label}`);
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
 * ⚠️ 지우기 전에 조용해질 때까지 기다린다: 앞 마운트의 요청이 아직 날고 있으면
 * 그 401을 인터셉터가 받아 토큰을 되살리고, 「게이트를 안 탔다」와 「이미 토큰이
 * 있었다」가 구분되지 않는다(`entryFlow`·`onboardingGating`이 남긴 함정).
 */
async function coldOpen() {
  await sleep(600);
  resetGuestAutoIssue();
  useAuthStore.getState().logout();
  // `hadAccount`는 logout()이 지우지 않는다(persist — 만료 화면의 근거) —
  // 남겨 두면 첫 접속이 만료 화면으로 갈려 정보 입력 화면이 아예 안 뜬다.
  useAuthStore.getState().forgetAccount();
  resumeBodies.length = 0;
  return xhrLog.length;
}

/** React 제어 입력 채우기 — onboardingSave·guest-convert 스모크와 같은 관례. */
function fillInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** 목이 「이미 쓰이고 있다」고 선언한 이름 — `mockAuth.takenNicknames` 시드. */
const SAVED_NICKNAME = '날씨러버';
/** 목이 「같은 이름이 여럿」이라고 선언한 이름 — 자동 부여 닉네임의 충돌. */
const AMBIGUOUS_NICKNAME = '게스트-2b1c8b';

try {
  // ── ① 진입 화면에 진입점이 **렌더**된다 ────────────────────────────────────
  //
  // 🔴 이 단정이 이번 실패의 직접 재발 방지다. 종전 검수가 「번들에 문자열이
  //    있는지」만 봤고, 그래서 진입점이 **한 곳도 없는** 실서버가 초록이었다.
  await scenario('① 진입 화면에 「진도 불러오기」 진입점이 렌더된다', async () => {
    await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $('[data-testid="entry-info"]'), 8000, '첫 접속 정보 입력 화면');
    const link = $('[data-testid="entry-info-load"]');
    ok(
      Boolean(link),
      () => `① 🔴 진입 화면에 불러오기 진입점이 없다 — 화면 텍스트 "${text().replace(/\s+/g, ' ').slice(0, 120)}"`,
    );
    ok(
      (link?.textContent ?? '').includes('진도 불러오기'),
      `① 진입점이 무엇인지 읽힌다 — 실제 "${link?.textContent ?? '(없음)'}"`,
    );
    // 「건너뛰기와 같은 층위」 — 같은 부모 안에 나란히 있다(지시 원문).
    ok(
      link?.parentElement === $('[data-testid="entry-info-skip"]')?.parentElement,
      '① 「건너뛰기」와 같은 층위에 있다',
    );
    // 규정 — 진입점이 생겨도 금칙 문구는 여전히 0건이어야 한다.
    ok(!text().includes('로그인'), '① 진입점이 생겨도 화면에 「로그인」 문구가 없다');
    ok(!text().includes('회원가입'), '① 화면에 「회원가입」 문구가 없다');
    r.unmount();
  });

  // ── ② 누르면 불러오기 화면이 **실제로 뜬다** ────────────────────────────────
  await scenario('② 진입점을 누르면 불러오기 화면이 렌더된다', async () => {
    await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $('[data-testid="entry-info-load"]'), 8000, '진입 화면의 불러오기 진입점');
    $('[data-testid="entry-info-load"]').click();
    await waitFor(
      () => $('[data-testid="load-progress"]'),
      8000,
      () => `② 진입점을 눌렀는데 불러오기 화면이 뜨지 않았다 — 실제 "${text().replace(/\s+/g, ' ').slice(0, 120)}"`,
    );
    ok(Boolean($('[data-testid="load-progress"]')), '② 불러오기 화면이 뜬다(라우트 문자열이 아니라 렌더)');
    ok(text().includes('진도 불러오기'), '② 화면이 자기 이름을 말한다');
    r.unmount();
  });

  // ── ③ 🔴 닉네임 하나만 받는다 (되살아나면 여기가 운다) ──────────────────────
  await scenario('③ 불러오기가 닉네임만 받는다 — 이메일·비밀번호 입력란이 없다', async () => {
    await coldOpen();
    const r = mountApp('/login');
    await waitFor(() => $('[data-testid="load-progress"]'), 8000, '불러오기 화면');

    // 🔴 **부재**를 단정한다 — 있는 것만 세면 필드가 추가돼도 조용하다.
    ok(
      $('input[type="password"]') === null,
      `③ 🔴 비밀번호 입력란이 없다 — 실제 ${$$('input[type="password"]').length}개`,
    );
    ok(
      $('input[type="email"]') === null,
      `③ 🔴 이메일 입력란이 없다 — 실제 ${$$('input[type="email"]').length}개`,
    );
    const inputs = $$('[data-testid="load-progress"] input');
    ok(
      inputs.length === 1 && inputs[0].type === 'text',
      `③ 입력란이 텍스트 하나뿐이다 — 실제 ${JSON.stringify(inputs.map((i) => i.type))}`,
    );
    ok(
      Boolean($('[data-testid="load-progress-nickname"]')),
      '③ 그 하나가 닉네임 입력란이다',
    );
    // 안내 문구도 함께 — 문구만 이메일을 안내하면 필드가 없어도 거짓말이 남는다.
    ok(
      !text().includes('이메일') && !text().includes('비밀번호'),
      `③ 안내 문구가 이메일·비밀번호를 요구하지 않는다 — 실제 "${text().replace(/\s+/g, ' ').slice(0, 120)}"`,
    );

    // 나가는 바디까지 — 화면에 없어도 코드가 실어 보내면 계약이 아니다.
    fillInput($('[data-testid="load-progress-nickname"]'), SAVED_NICKNAME);
    $('[data-testid="load-progress-submit"]').click();
    await waitFor(() => resumeBodies.length >= 1, 8000, 'POST /auth/resume 발화');
    ok(
      JSON.stringify(Object.keys(resumeBodies[0] ?? {})) === JSON.stringify(['nickname']),
      `③ 요청 바디가 {nickname} 하나뿐이다 — 실제 ${JSON.stringify(resumeBodies[0])}`,
    );
    r.unmount();
  });

  // ── ④ 🔴 불러오기가 진입을 막지 않는다 (①과 반대 방향) ──────────────────────
  //
  // 🔴 ①만 있으면 「진입점을 크게 만들다가 주 동선을 덮는」 변경이 조용히 통과한다.
  //    규정이 금지하는 것은 주 동선이 계정을 요구하는 것이고, 불러오기는 선택이다.
  await scenario('④ 진입점이 주 동선을 막지 않는다(건너뛰기·다음 그대로)', async () => {
    const mark = await coldOpen();
    const r = mountApp('/');
    await waitFor(() => $('[data-testid="entry-info"]'), 8000, '첫 접속 정보 입력 화면');

    // ⓑ 「다음」은 종전대로 — 학령만 고르면 열린다(불러오기와 무관).
    ok(
      $('[data-testid="entry-info-submit"]').disabled === true,
      '④-b 아무것도 안 고르면 「다음」이 잠겨 있다(종전 계약 유지)',
    );
    $('[data-testid="entry-info-levels"] button[data-level="elementary"]').click();
    await sleep(60);
    ok(
      $('[data-testid="entry-info-submit"]').disabled === false,
      '④-b 🔴 학령만 고르면 「다음」이 열린다 — 불러오기는 관문이 아니다',
    );

    // ⓐⓒ 「건너뛰기」가 여전히 렌더되고, 아무것도 안 넣고 학습에 도달한다.
    const skip = $('[data-testid="entry-info-skip"]');
    ok(Boolean(skip) && skip.disabled !== true, '④-a 「건너뛰기」가 여전히 있고 눌린다');
    // 없으면 여기서 **이유를 말하고** 멈춘다 — 그냥 `skip.click()`을 하면
    // "Cannot read properties of null"이 나와 실패 메시지가 원인을 안 가리킨다.
    if (!skip) throw new Error('④ 「건너뛰기」 출구가 사라졌다 — 주 동선의 출구가 없으면 ④-c(입력 0회로 학습 도달)를 잴 수 없다');
    skip.click();
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === 'GET /api/v1/curriculum'),
      8000,
      '④-c 건너뛰었는데 학습 화면에 도달하지 못했다',
    );
    await waitFor(() => $('[data-testid="learn-entry"]'), 8000, '학습 진입 카드');
    ok(
      Boolean($('[data-testid="learn-entry"]')),
      '④-c 🔴 불러오기를 쓰지 않고 입력 0회로 학습 화면이 열린다(규정)',
    );
    ok(
      resumeBodies.length === 0,
      `④-c 주 동선은 불러오기를 부르지 않는다 — 실제 ${resumeBodies.length}회`,
    );
    r.unmount();
  });

  // ── ⑤ 실제로 돌아와진다 · 실패는 갈라서 말한다 ──────────────────────────────
  await scenario('⑤ 저장된 닉네임으로 돌아오고, 실패는 갈라서 말한다', async () => {
    await coldOpen();
    let r = mountApp('/login');
    await waitFor(() => $('[data-testid="load-progress"]'), 8000, '불러오기 화면');

    // ⑤-a 없는 이름 → 그 자리에서 「못 찾았다」
    fillInput($('[data-testid="load-progress-nickname"]'), '없는사람입니다');
    $('[data-testid="load-progress-submit"]').click();
    await waitFor(() => $('[data-testid="load-progress-error"]'), 8000, '실패 안내');
    ok(
      $('[data-testid="load-progress-error"]').textContent.includes('닉네임을 다시 확인'),
      `⑤-a 없는 이름은 「못 찾았다 + 이름을 확인하라」고 말한다(리소스 문구 — 서버 detail보다 앞) — 실제 "${$('[data-testid="load-progress-error"]')?.textContent}"`,
    );
    ok(
      Boolean($('[data-testid="load-progress"]')),
      '⑤-a 실패해도 이 화면에 남는다(다른 화면으로 튕기지 않는다)',
    );

    // ⑤-b 동명이인 → **다른** 안내. 한 문구로 뭉치면 학습자가 할 행동이 사라진다.
    fillInput($('[data-testid="load-progress-nickname"]'), AMBIGUOUS_NICKNAME);
    $('[data-testid="load-progress-submit"]').click();
    await waitFor(
      () => $('[data-testid="load-progress-error"]')?.textContent.includes('다른 이름으로 저장'),
      8000,
      () => `⑤-b 동명이인 안내 — 실제 "${$('[data-testid="load-progress-error"]')?.textContent}"`,
    );
    ok(true, '⑤-b 동명이인은 다른 안내다(서버 NICKNAME_AMBIGUOUS와 1:1)');

    // ⑤-c 저장된 이름 → 토큰이 갈리고 학습으로 간다
    fillInput($('[data-testid="load-progress-nickname"]'), SAVED_NICKNAME);
    $('[data-testid="load-progress-submit"]').click();
    await waitFor(
      () => useAuthStore.getState().accessToken === 'mock-resume-access',
      8000,
      () => `⑤-c 불러오기 토큰 — 실제 "${useAuthStore.getState().accessToken}"`,
    );
    ok(true, '⑤-c 🔴 저장된 이름으로 그 계정의 토큰을 받는다(새로 시작이 아니다)');
    await waitFor(() => $('[data-testid="learn-entry"]'), 8000, '학습 화면');
    ok(Boolean($('[data-testid="learn-entry"]')), '⑤-c 불러온 뒤 학습 화면으로 간다');
    r.unmount();
  });

  // ── ⑥ `/me`에서 두 피커가 **없다** · 이름은 **바꿀 수 있다** ─────────────────
  // 🔴 **없음을 무는 단정이다.** 있는 것만 세면 카드가 되살아나도 조용하다 —
  // 8/18에 놓친 6건이 정확히 그 형태였다(번들에 문자열이 있는지만 보고 화면을
  // 안 봤다). 그래서 `grep`이 아니라 **실제 렌더 결과**를 본다.
  await scenario('⑥ /me — 수준·목표 피커 없음 + 닉네임 변경 있음', async () => {
    useAuthStore.setState({ accessToken: 'mock-access', refreshToken: 'mock-refresh',
      user: { id: 1, nickname: '테스트이름', level_group: 'adult' } });
    const r = mountApp('/me');
    await waitFor(() => $('[data-nickname-edit]'), 8000, '⑥ 프로필 화면');

    // ⑥-a 🔴 학습 수준 카드가 없다 — 종전 `data-level-group` 속성이 그 카드의 표식이었다
    ok(!$('[data-level-group]'), '⑥-a 🔴 /me에 학습 수준 선택이 없다');

    // ⑥-b 🔴 하루 목표 **피커**가 없다. 진행 미터는 별개이므로 피커 고유 문구로 본다
    const body = document.body.textContent ?? '';
    ok(!body.includes('하루 목표를 정해요'),
      `⑥-b 🔴 /me에 하루 목표 피커가 없다 — 실제 본문에 그 제목이 ${body.includes('하루 목표를 정해요') ? '있다' : '없다'}`);

    // ⑥-c 이름을 바꿀 통로가 **실재한다**(③) — 최초 진입을 지난 사용자의 유일한 길
    // ⚠️ **되돌림 실측(2026-08-19): 이 단정은 「자기 자리」에서 울지 않는다.**
    // `data-nickname-edit`를 지우면 위 `waitFor`가 먼저 시간 초과로 죽어
    // `⑥ 프로필 화면` 이름으로 실패한다. 신호는 남지만 **원인을 덜 정확히**
    // 가리킨다. 그대로 두는 이유: 그 표식이 화면이 떴는지 판정하는 유일한
    // 안정 표식이라, 앞의 대기를 다른 것으로 바꾸면 화면이 안 뜬 상태를
    // 「없다」로 오독할 수 있다. **약점을 지우지 않고 적어 둔다.**
    ok(Boolean($('[data-nickname-edit]')), '⑥-c 🔴 닉네임 변경 통로가 화면에 있다');

    // ⑥-d 누르면 입력이 열린다 — 버튼만 있고 안 열리는 상태를 막는다
    $('[data-nickname-edit]').click();
    await waitFor(() => document.querySelector('input[type="text"]'), 8000, '⑥-d 이름 입력');
    ok(Boolean(document.querySelector('input[type="text"]')), '⑥-d 누르면 이름 입력이 열린다');
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
console.log('OK: 진도 불러오기(진입점 렌더 · 닉네임만 · 주 동선 불차단 · 왕복) 통과');
process.exit(0);

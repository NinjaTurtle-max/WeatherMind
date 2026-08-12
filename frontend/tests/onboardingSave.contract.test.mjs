/**
 * 온보딩 동선 계약 — 진도 저장 · 위치 안내 (2026-08-12 클라이언트 요구 ⑴~⑷) —
 *   node tests/onboardingSave.contract.test.mjs
 *
 * 왜 있나. 오늘 로그인·회원가입 화면이 통째로 제거됐다 — 대회 규정이 「로그인 없이
 * 열려야」이고 심사위원은 계정 없이 URL만으로 연다. 그런데 **진도 저장은 남아야**
 * 한다: 게스트 진도는 그 기기에만 있고 게스트 비밀번호는 무작위 시크릿이라
 * 잃으면 복구 경로가 없다. 그래서 같은 서버 API(`POST /auth/guest/convert`)를
 * 로그인 창이 아니라 **내 정보 안의 입력란**으로 다시 세웠다. 이 파일은 그
 * 재배치가 조용히 되돌아가지 않게 붙잡는다.
 *
 * 지키는 계약
 *   ① 학습 화면 **상단에 저장 배너가 없다**(요구 ⑷). 가로로 첫 줄을 덮던
 *      `GuestSaveBanner` 마운트를 걷었다. ⚠️ **파일은 남아 있다** —
 *      `guest-convert.smoke.test.mjs` 2-a/2-b/2-c가 그 컴포넌트를 직접 마운트해
 *      문구를 단정하므로 지우면 그쪽이 운다. 여기서 무는 것은 **`/learn` 화면에
 *      그 배너가 그려지는가**이지 파일의 존재가 아니다.
 *   ② 오른쪽 열에 **저장 안내 노드**가 있고(요구 ⑵), 누르면 정보 입력으로 간다.
 *      목적지는 `/me#save-progress` — 앵커가 **실재하는지**까지 본다(끊긴 통로가
 *      초록으로 통과하는 것을 `home.smoke` ⑦이 이미 한 번 겪었다).
 *   ③ **「로그인」·「회원가입」 문구가 화면에 없다.** 규정 계약이라 소스가 아니라
 *      **렌더된 텍스트**로 문다 — 리소스 키 이름(`auth.login.email`)은 상관없고
 *      사람이 읽는 글자만 본다. 세 화면 전부(`/learn`·`/me`·`/account/convert`).
 *   ④ 지역 **미설정**이면 위치 안내가 뜨고, **설정된 사용자에게는 안 뜬다**(요구 ⑶).
 *      판정 근거는 `GET /progress/me`의 `region` **원본**이다 — 서버가 null을 그대로
 *      주는 이유가 이것이다(`backend/app/schemas/progress.py:59`가 "프론트가
 *      미설정과 서울로 설정을 구분해야 하므로"라고 적어 두었다).
 *   ⑤ 위치 안내가 **길을 막지 않는다.** 규정이 「로그인 없이 열려야」이므로 아무것도
 *      안 눌러도 서비스가 조작 가능해야 한다: 뒤 요소가 눌리고, `aria-modal`도
 *      `fixed inset-0` 덮개도 없다. 닫으면 이 기기에서 다시 뜨지 않는다.
 *   ⑥ **이미 정식 계정인 사용자에게는 저장 노드가 안 뜬다.**
 *   ⑦ **저장 노드는 진도가 쌓여야 뜬다**(2026-08-13 클라이언트 판정). 처음 만들 때는
 *      「게스트면 무조건」이었고 이 파일도 그렇게 단정하고 있었다 — 뒤집혔다.
 *      게이트는 걷힌 종전 배너(`GuestSaveBanner`)의 원문 그대로
 *      **`xp>0 ∨ streak_count>=1`**이고, 게스트 조건은 유지된다(⑥).
 *      ⚠️ ⑦은 **같은 게스트 계정으로 두 번 재면서** 단정한다: 진도를 0으로 만들면
 *      안 뜨고, 진도만 올리면 뜬다. 한 번만 재면 "게이트가 물었다"와 "게스트 판정이
 *      아직 안 왔다"·"화면이 안 그려졌다"가 구분되지 않아 공허하게 통과한다.
 *
 * 세 갈래를 전부 문다: 진도 0 게스트(⑦-a, 안 뜬다) · 진도 있는 게스트(⑦-b·②, 뜬다) ·
 * 정식 계정(⑥, 안 뜬다).
 *
 * ⚠️ ④의 "뜬다" 쪽은 **목으로 만들 수 없다**: `mock/apiMockPlugin.js`는 region을
 * 항상 '서울'로 준다(state.region 기본값). 그래서 그 두 시나리오만 캐시를 직접
 * 심어 컴포넌트를 마운트한다 — 서버 계약(null 가능)은 위 스키마가 소유한다.
 * 반대로 "안 뜬다" 쪽은 목 그대로가 곧 「설정된 사용자」라 앱 전체로 검증된다.
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
const RegionOnboardingNotice = (await vite.ssrLoadModule('/src/components/RegionOnboardingNotice.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');
// 리소스 층위 금칙어 계약용 — 렌더를 안 거치므로 로케일 고정과 무관하게 en도 본다.
const koResource = (await vite.ssrLoadModule('/src/i18n/resources/ko.js')).default;
const enResource = (await vite.ssrLoadModule('/src/i18n/resources/en.js')).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  // 라벨은 **함수도 받는다** — 문자열로 넘기면 호출 시점(=대기 시작 전)의 화면을
  // 찍어 실패 순간의 상태를 못 본다. 디버깅에서 실제로 헛돌았다.
  throw new Error(`시간 초과(${timeoutMs}ms): ${typeof label === 'function' ? label() : label}`);
}

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
  return reactRoot;
}

/** 위치 안내만 따로 — `me`를 캐시에 심는다(목은 region null을 만들 수 없다). */
function mountNotice(me, extra = null) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    // ⚠️ staleTime을 무한으로 두지 않으면 배경 재조회가 목의 '서울'로 덮어써서
    // 단정 도중에 안내가 사라진다(목은 미설정을 표현하지 못한다).
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  qc.setQueryData(['progress', 'me'], me);
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: ['/learn'] },
        createElement('div', null, createElement(RegionOnboardingNotice), extra))),
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

const $ = (sel) => window.document.querySelector(sel);
const text = () => window.document.body.textContent ?? '';
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

/** React 제어 입력 채우기 — placementEntry·guest-convert 스모크 관례 */
function fillInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
const submitForm = (sel) =>
  $(sel).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

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
  }
}

/** 규정 계약 — 렌더된 텍스트에 금칙 문구가 없다(소스·키 이름은 보지 않는다). */
const BANNED = ['로그인', '회원가입'];
function assertNoAuthWords(where) {
  const body = text();
  for (const word of BANNED) {
    ok(!body.includes(word), `${where}: 화면에 「${word}」 문구가 없다`);
  }
}

/**
 * 같은 규정을 **리소스 층위**에서 한 번 더 잰다 — 위 렌더 단정만으로는 부족했다.
 *
 * ⚠️ 실제로 뚫렸다(2026-08-13 검수): ko는 2026-08-12에 세탁됐는데 **en만**
 * `auth.convert.title: 'Save your progress with a 30-second sign-up'`으로 남아
 * 있었다. 위 `assertNoAuthWords`가 못 잡은 이유는 두 겹이다 —
 *   ⓐ 금칙 목록이 한국어 전용이라 "sign-up"을 아예 안 봤다
 *   ⓑ 하네스가 `weathermind.locale`을 **ko로 고정**해서(위 :86) en 값은
 *      한 번도 렌더되지 않는다
 * 그래서 en 로케일을 켜는 대신 **리소스 값을 직접 읽는다**. 로케일 고정을
 * 풀면 다른 시나리오의 한국어 단정이 전부 무너지므로 그 길은 택하지 않았다.
 *
 * 범위는 **ko.js·en.js 리소스 전체**다(2026-08-13 확대). 처음 세울 때는
 * `auth.convert`·`saveProgress`·`regionNotice` 3블록으로 좁혀 두었는데, 그것은
 * `auth.login.*`·`auth.register.*`가 화면 삭제 뒤 값만 남은 고아라 넓히면 「지우기
 * 전까지 영구 실패」가 되기 때문이었다. 같은 날 고아 70키를 지웠으므로 그때 적어
 * 둔 약속대로 블록 필터를 없앤다 — **좁은 계약은 좁은 만큼만 잡는다**는 것이 위
 * ⓐⓑ가 남긴 교훈이고, 실제로 `logoutGuest.save`("sign up in 30 seconds")는 3블록
 * 밖이라 이 가드가 못 보던 값이었다.
 *
 * ⚠️ 범위는 `resources/ko.js`·`en.js`까지다 — `board.*`·`detective.*`는 파일 소유가
 * 갈려 있어(i18n/core.js가 병합) 여기서 물지 않는다. 2026-08-13 실측으로 그 4파일에
 * 금칙어는 0건이고, 넓히려면 그 파일 소유자와 함께 결정할 일이다.
 */
const BANNED_ANY_LOCALE = ['로그인', '회원가입', 'log in', 'login', 'sign up', 'sign-up'];

/**
 * 예외 — **근거 없이는 늘리지 않는다.**
 *
 * 예외는 한 번 적으면 영원히 남고, 목록이 길어질수록 계약은 이름만 남는다.
 * 그래서 규칙을 여기 못박는다: **새 항목을 추가하려면 (ⅰ) 왜 화면 규정을 어기지
 * 않는지와 (ⅱ) 그 값을 붙잡고 있는 것이 무엇인지(테스트 파일:단정)를 이 자리에
 * 한 줄로 적어야 한다.** 둘 중 하나라도 못 쓰겠으면 그것은 예외가 아니라 고쳐야
 * 할 문구다 — 문구를 고치는 쪽이 언제나 먼저다.
 *
 * · guestBanner — `GuestSaveBanner`는 학습 화면에서 마운트가 걷혔지만(계약 ①)
 *   컴포넌트 파일은 남아 있고 `tests/guest-convert.smoke.test.mjs` 2-a/2-b/2-c가
 *   **그것을 직접 마운트해 문구를 단정한다**(:265·:276·:288 "30초 가입"·"진도가
 *   쌓였어요"). 즉 사용자에게 렌더되지 않으므로 규정(화면에 가입/로그인 문구
 *   없음)을 어기지 않고, 값을 바꾸면 그쪽 스모크가 붉어진다.
 */
const EXEMPT_BLOCKS = ['guestBanner'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, path, out);
    else if (typeof v === 'string') out[path] = v;
  }
  return out;
}

function assertResourcesClean(localeName, resource) {
  const flat = flatten(resource);
  // 전수 검사라 키마다 ok()를 부르면 출력이 1,400줄이 된다 — **위반만** 보고하고
  // 마지막에 "전건 통과"를 한 줄로 단정한다(단정 수가 0이 되면 공허해지므로,
  // 검사한 키 수도 함께 찍어 범위가 조용히 줄어드는 것을 눈에 보이게 한다).
  const offenders = [];
  let scanned = 0;
  for (const [key, value] of Object.entries(flat)) {
    if (EXEMPT_BLOCKS.some((b) => key === b || key.startsWith(`${b}.`))) continue;
    scanned += 1;
    const haystack = value.toLowerCase();
    for (const word of BANNED_ANY_LOCALE) {
      if (haystack.includes(word)) offenders.push(`${key} 「${word}」 → "${value}"`);
    }
  }
  ok(
    offenders.length === 0,
    `${localeName} 리소스 ${scanned}키 전건에 금칙어가 없다`
      + (offenders.length ? `\n      위반 ${offenders.length}건:\n      - ${offenders.join('\n      - ')}` : ''),
  );
  // 범위 자체가 살아 있는지 — 예외가 늘어 검사 대상이 껍데기만 남는 것을 막는다.
  ok(scanned > 400, `${localeName} 검사 범위가 리소스 전체다 — 실제 ${scanned}키`);
}

const DISMISS_KEY = 'weathermind.regionNotice.dismissed';

try {
  // ── ⑥ 정식 계정: 저장 노드가 안 뜬다 ──────────────────────────────────────
  // 목의 mockAuth.isGuest 기본값은 false다 — POST /auth/guest를 부르기 전이라
  // GET /auth/me가 정식 계정으로 답한다(이 시나리오를 먼저 두는 이유).
  //
  // ⚠️ 이 시나리오가 **진도 게이트 덕에** 통과하면 안 된다. 목의 초기 state.xp는
  // 1180이고 POST /auth/guest는 state를 건드리지 않으므로(핸들러 실측) 여기서는
  // 진도가 이미 있다 — 그래서 노드가 안 뜨는 이유는 게스트 조건 하나뿐이다.
  // 게스트 게이트를 지우면 이 단정이 붉어진다(변이 검증 대상).
  await scenario('⑥ 정식 계정', async () => {
    const seed = await api('GET', '/progress/me');
    ok(
      (seed.body?.xp ?? 0) > 0 || (seed.body?.streak_count ?? 0) >= 1,
      `⑥ 전제: 이 시점에 진도가 있다(게스트 조건만이 노드를 막는다) — xp ${seed.body?.xp}, streak ${seed.body?.streak_count}`,
    );
    useAuthStore.getState().setTokens({ accessToken: 't-regular', refreshToken: 'r-regular' });
    useAuthStore.getState().setUser({ user_id: 'u-1', email: 'user@test.dev', nickname: '정회원' });
    const r = mountApp('/learn');
    await waitFor(() => $('[data-testid="learn-footer"]'), 8000, '오른쪽 열');
    await sleep(500); // /auth/me 도착 여유 — 부정 판정은 기다린 뒤에 본다
    ok(
      $('[data-testid="learn-guest-save"]') === null,
      '⑥ 정식 계정에는 저장 노드가 안 뜬다',
    );
    r.unmount();

    const r2 = mountApp('/me');
    await waitFor(() => $('[data-testid="save-progress-card"]'), 8000, '내 정보 진도 저장 카드');
    ok(
      $('#save-progress input[name="email"]') === null,
      '⑥ 정식 계정에는 내 정보에도 입력 폼이 안 뜬다(저장할 것이 이미 저장돼 있다)',
    );
    r2.unmount();
  });

  // ── ⑦ 진도 게이트: 진도 0 게스트에게는 안 뜨고, 진도가 생기면 뜬다 ──────────
  //
  // 2026-08-13 클라이언트 판정으로 「게스트면 무조건 표시」가 「진도가 쌓이면 표시」로
  // 뒤집혔다. 게이트 원문은 걷힌 배너 그대로 `xp>0 ∨ streak_count>=1`.
  // ⚠️ **같은 게스트 계정으로 두 번** 재는 것이 이 시나리오의 핵심이다 — a에서 안
  // 뜨는 것만 재면 게스트 판정이 늦게 오거나 화면이 안 그려진 것과 구분되지 않는다.
  // b에서 진도만 바꿔 뜨게 만들어야 "막은 것이 진도 게이트"임이 확정된다.
  await scenario('⑦ 진도 게이트(진도 0 게스트 → 진도 있는 게스트)', async () => {
    const g = await api('POST', '/auth/guest');
    ok(g.status === 201, `게스트 발급 201 — 실제 ${g.status}`);
    useAuthStore.getState().setTokens({ accessToken: g.body.access_token, refreshToken: g.body.refresh_token });
    useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });

    // 진도 0 — 갓 접속한 사람의 상태. 목 초기값은 xp 1180이라 반드시 지워야 한다.
    const reset = await api('POST', '/dev/reset-me', { reset: true });
    ok(reset.status === 200, `/dev/reset-me 200 — 실제 ${reset.status}`);
    const zero = await api('GET', '/progress/me');
    ok(
      (zero.body?.xp ?? 0) === 0 && (zero.body?.streak_count ?? 0) === 0,
      `⑦-a 전제: 진도가 0이다 — xp ${zero.body?.xp}, streak ${zero.body?.streak_count}`,
    );

    const rA = mountApp('/learn');
    await waitFor(() => $('[data-testid="learn-footer"]'), 8000, '오른쪽 열');
    // 부정 판정은 기다린 뒤에 본다 — /auth/me·/progress/me 둘 다 도착할 여유.
    await sleep(700);
    ok(
      $('[data-testid="learn-guest-save"]') === null,
      '⑦-a 진도 0인 게스트에게는 저장 노드가 안 뜬다(2026-08-13 판정 — 진도가 쌓이면 표시)',
    );
    rA.unmount();

    // 진도만 올린다 — 계정도 화면도 그대로다. 이제 떠야 한다.
    const st = await api('POST', '/dev/streak', { streak_count: 1 });
    ok(st.status === 200, `/dev/streak 200 — 실제 ${st.status}`);
    const some = await api('GET', '/progress/me');
    ok(
      (some.body?.streak_count ?? 0) >= 1,
      `⑦-b 전제: streak_count>=1 — 실제 ${some.body?.streak_count}`,
    );

    const rB = mountApp('/learn');
    await waitFor(
      () => $('[data-testid="learn-guest-save"]'),
      8000,
      () => '⑦-b 진도가 생겼는데도 저장 노드가 안 뜬다',
    );
    ok(
      Boolean($('[data-testid="learn-guest-save"]')),
      '⑦-b 같은 게스트라도 진도가 생기면 저장 노드가 뜬다(⑦-a가 공허하지 않다)',
    );
    rB.unmount();
  });

  // ── ①②③ 게스트: 상단 배너 없음 · 우측 노드 · 금칙 문구 없음 ─────────────
  await scenario('①②③ 게스트 학습 화면', async () => {
    const g = await api('POST', '/auth/guest');
    ok(g.status === 201, `게스트 발급 201 — 실제 ${g.status}`);
    useAuthStore.getState().setTokens({ accessToken: g.body.access_token, refreshToken: g.body.refresh_token });
    useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });
    // 진도를 쌓아 둔다 — 종전 상단 배너도, 지금의 저장 노드(⑦)도 진도가 있어야
    // 뜬다. 진도 없이 재면 "배너가 없다"가 **배너 조건 미충족** 때문일 수 있어
    // 공허하게 통과하고, ②의 "노드가 뜬다"는 아예 성립하지 않는다.
    const st = await api('POST', '/dev/streak', { streak_count: 1 });
    ok(st.status === 200, `/dev/streak 200 — 실제 ${st.status}`);

    const r = mountApp('/learn');
    await waitFor(() => $('[data-testid="learn-footer"]'), 8000, '오른쪽 열');

    // ② 우측 저장 노드 — 먼저 기다린다(게스트 판정이 /auth/me 도착에 달렸다)
    await waitFor(() => $('[data-testid="learn-guest-save"]'), 8000, '우측 저장 노드');
    const node = $('[data-testid="learn-guest-save"]');
    ok(
      node.closest('[data-testid="learn-footer"]') !== null,
      '② 저장 노드가 오른쪽 열 안에 있다',
    );
    ok(
      node.getAttribute('href') === '/me#save-progress',
      `② 누르면 정보 입력으로 간다 — 실제 ${node.getAttribute('href')}`,
    );
    ok(
      node.textContent.includes('정보를 입력해 진도를 저장'),
      `② 클라이언트 문구가 그대로 있다 — "${node.textContent.replace(/\s+/g, ' ').slice(0, 40)}"`,
    );

    // ① 상단 배너 부재 — 노드가 뜬 뒤에 재야 "아직 안 왔다"와 구분된다
    ok(
      !text().includes('진도가 쌓였어요'),
      '① 학습 화면 상단 저장 배너(GuestSaveBanner)가 없다',
    );
    ok(
      $('a[href="/account/convert"]') === null,
      '① 학습 화면에 전환 전체화면으로 가는 배너 링크가 없다',
    );

    // ③ 금칙 문구
    assertNoAuthWords('③ /learn');
    r.unmount();
  });

  // ── ②(앵커 실재)③ 내 정보: 정보 입력이 여기 있다 ──────────────────────────
  await scenario('①⑵③ 내 정보 입력', async () => {
    const r = mountApp('/me');
    await waitFor(() => $('#save-progress'), 8000, '진도 저장 카드(앵커)');
    ok(Boolean($('#save-progress')), '② 노드가 가리키는 앵커(#save-progress)가 실재한다');
    await waitFor(() => $('#save-progress input[name="email"]'), 8000, '입력란');
    ok(
      Boolean($('#save-progress input[name="email"]'))
        && Boolean($('#save-progress input[name="password"]')),
      '⑴ 내 정보 안에서 정보를 입력할 수 있다(이메일·비밀번호)',
    );
    ok(
      $('#save-progress').textContent.includes('정보를 입력해 진도를 저장'),
      '⑴ 클라이언트 문구가 카드에 있다',
    );
    assertNoAuthWords('③ /me');
    r.unmount();
  });

  // ── ⑴⑥ 내 정보에서 실제로 저장한다 → 결과가 그 자리에 남고, 노드가 사라진다 ──
  //
  // ⚠️ 이 시나리오가 없으면 ⑥이 **저장 직후**를 보지 못한다. 게스트 판정의 1순위는
  // `GET /auth/me`의 is_guest(staleTime 60초)이고, 스토어만 갱신하면 방금 저장한
  // 사람이 최대 1분간 화면에서는 게스트로 남는다 — 저장 노드가 계속 떠 있고,
  // 다시 누르면 폼이 나와 제출 시 409 NOT_GUEST를 받는다. 심사 동선(저장 후
  // 둘러보기)에서 그대로 밟히는 경로다.
  await scenario('⑴⑥ 내 정보에서 저장 → 결과 표시 + 저장 노드 소멸', async () => {
    const r = mountApp('/me');
    await waitFor(() => $('#save-progress input[name="email"]'), 8000, '입력란');
    fillInput($('#save-progress input[name="email"]'), 'inline-saved@test.dev');
    fillInput($('#save-progress input[name="password"]'), 'password-123');
    // 입력 상태가 리액트에 반영된 뒤 제출한다 — 같은 틱에 던지면 제출 이벤트가
    // 렌더 사이에 끼어 핸들러에 닿지 않는 것을 실측했다.
    await sleep(100);
    submitForm('#save-progress form');
    await waitFor(
      () => xhrLog.some((l) => l.includes('/auth/guest/convert')),
      6000,
      'POST /auth/guest/convert 발화',
    );
    // 성공 문구가 **그 자리에** 남는다 — 저장에 성공하면 게스트가 아니게 되므로,
    // 게이트만 보고 카드를 갈아치우면 누른 사람이 결과를 못 본다.
    await waitFor(
      () => $('[data-testid="save-progress-done"]'),
      8000,
      () => `저장 결과 표시 — 카드 "${$('#save-progress')?.textContent?.replace(/\s+/g, ' ')}"`,
    );
    ok(
      $('[data-testid="save-progress-done"]')?.textContent.includes('진도를 저장했어요'),
      '⑴ 저장 결과가 누른 자리에 남는다(누른 순간 사라지는 버튼이 아니다)',
    );
    // ⚠️ **같은 마운트 안에서** 학습 화면으로 건너간다(새로 마운트하지 않는다).
    // 다시 마운트하면 조회가 새로 나가 서버가 "이제 정식 계정"이라고 답해 주므로,
    // 정작 문제인 **캐시 잔상**을 못 본다: 게스트 판정의 1순위는 `GET /auth/me`이고
    // 실서비스의 staleTime은 60초라, 캐시를 안 고치면 방금 저장한 사람이 최대
    // 1분간 저장 노드를 계속 보고 다시 눌러 409를 받는다. 탭바로 이동하면
    // 라우트만 바뀌고 캐시는 그대로라 그 창이 그대로 재현된다.
    const learnTab = window.document.querySelector('[data-testid="tabbar"] a[href="/learn"]');
    ok(Boolean(learnTab), '탭바에 학습 탭이 있다(이동 통로)');
    learnTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await waitFor(() => $('[data-testid="learn-footer"]'), 8000, '학습 화면으로 이동');
    await sleep(600);
    ok(
      $('[data-testid="learn-guest-save"]') === null,
      '⑥ 저장한 뒤에는 학습 화면에서 저장 노드가 사라진다(다시 눌러도 409뿐인 통로)',
    );
    r.unmount();
  });

  await scenario('③ 전환 전체화면', async () => {
    // 위에서 정식 계정이 됐으므로 폼을 보려면 다시 게스트로 — 전체 화면 라우트는
    // 게스트가 아니면 「이미 정식 계정」 안내로 떨어진다(그 방어도 계약이다).
    const g = await api('POST', '/auth/guest');
    useAuthStore.getState().setTokens({ accessToken: g.body.access_token, refreshToken: g.body.refresh_token });
    useAuthStore.getState().setUser({ nickname: '게스트', is_guest: true });
    const r = mountApp('/account/convert');
    await waitFor(() => $('form input[name="email"]'), 8000, '전환 폼');
    assertNoAuthWords('③ /account/convert');
    r.unmount();
  });

  // ── ④ 설정된 사용자에게는 위치 안내가 안 뜬다 (목 그대로 = region '서울') ──
  await scenario('④ 지역 설정됨 → 안내 없음', async () => {
    window.localStorage.removeItem(DISMISS_KEY);
    const me = await api('GET', '/progress/me');
    ok(me.body?.region === '서울', `목은 지역을 이미 설정된 상태로 준다 — ${me.body?.region}`);
    const r = mountApp('/learn');
    await waitFor(() => $('[data-testid="learn-footer"]'), 8000, '학습 화면');
    await sleep(500);
    ok(
      $('[data-testid="region-notice"]') === null,
      '④ 이미 지역을 고른 사용자에게는 위치 안내가 안 뜬다',
    );
    r.unmount();
  });

  // ── ④⑤ 미설정 사용자: 뜬다 · 길을 막지 않는다 · 닫으면 안 뜬다 ────────────
  await scenario('④⑤ 지역 미설정 → 안내', async () => {
    window.localStorage.removeItem(DISMISS_KEY);
    let behindClicks = 0;
    const behind = createElement(
      'button',
      { type: 'button', 'data-testid': 'behind', onClick: () => { behindClicks += 1; } },
      '뒤에 있는 화면',
    );
    const r = mountNotice({ region: null, xp: 0, streak_count: 0 }, behind);
    await waitFor(() => $('[data-testid="region-notice"]'), 8000, '위치 안내');
    const notice = $('[data-testid="region-notice"]');
    ok(Boolean(notice), '④ 지역 미설정 사용자에게 위치 안내가 뜬다');
    ok(
      notice.textContent.includes('어느 지역 날씨로'),
      '④ 안내가 지역을 왜 묻는지 말한다',
    );
    // 지역을 고르는 통로가 안내 안에 실재한다(칩 → 시트는 RegionPicker 소유)
    ok(
      Boolean(notice.querySelector('[data-testid="region-chip"]')),
      '④ 안내 안에 지역 선택 통로(칩)가 있다',
    );

    // ⑤ 길을 막지 않는다 — 구조(덮개·모달 표식)와 동작(뒤가 눌린다) 둘 다
    ok(notice.getAttribute('aria-modal') === null, '⑤ 안내가 모달이 아니다(aria-modal 없음)');
    ok(notice.getAttribute('role') !== 'dialog', '⑤ 안내가 dialog가 아니다');
    const cls = notice.className;
    ok(
      !/\bfixed\b/.test(cls) && !/inset-0/.test(cls),
      `⑤ 안내가 화면을 덮지 않는다(fixed·inset-0 없음) — "${cls}"`,
    );
    click($('[data-testid="behind"]'));
    ok(behindClicks === 1, '⑤ 안 닫아도 뒤 화면이 조작된다');

    // 닫힘 — 이 기기에서 다시 안 뜬다
    click($('[data-testid="region-notice-close"]'));
    await waitFor(() => $('[data-testid="region-notice"]') === null, 4000, '안내 닫힘');
    ok($('[data-testid="region-notice"]') === null, '⑤ 닫으면 사라진다');
    r.unmount();

    const r2 = mountNotice({ region: null, xp: 0, streak_count: 0 });
    await sleep(400);
    ok(
      $('[data-testid="region-notice"]') === null,
      '⑤ 한 번 닫으면 다시 접속해도 안 뜬다(안내가 매번 길을 막지 않는다)',
    );
    r2.unmount();
    window.localStorage.removeItem(DISMISS_KEY);
  });

  // ── ⑧ 규정: 리소스 **전체**에 금칙어가 없다 (**양 로케일**) ────────────────
  await scenario('⑧ ko·en 리소스 전체 금칙어', async () => {
    assertResourcesClean('ko', koResource);
    assertResourcesClean('en', enResource);
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 온보딩 동선 계약(진도 저장 재배치 · 위치 안내 비차단) 통과');
process.exit(0);

/**
 * 코스 선택 실마운트 스모크 (R11-01 §6.2 / FE-A) —
 *   node tests/course-select.smoke.test.mjs
 *
 * 관례는 onboardingGating.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트.
 *
 * ⚠️ mock/apiMockPlugin(FE-C 소유)에는 아직 `GET /courses`·`GET /curriculum?course=`
 * 경로가 없다(2026-08-04 실측 — 라우터가 쿼리스트링을 떼므로 ?course=는 기존
 * /curriculum에 흡수된다). 그래서 이 테스트는 **자기 파일 안에서만** 서버 계약
 * (database/seed/courses.json + backend CoursesOut) 형태의 픽스처 미들웨어를 mock
 * 앞단에 세운다 — mock 파일은 건드리지 않는다. FE-C가 parity mock을 붙이면 이
 * 심(shim)은 걷어낼 수 있다.
 *
 * 시나리오
 *   1. 코스 탭 렌더 + is_default(weather) 우선 선택 + weather 트리 무회귀.
 *   2. prereq 표기는 "선행 학습(권장)"까지 — 탭은 잠기지 않는다(PM 판정 ①).
 *   3. basic-science 전환 → ?course= 재조회 → 빈 트리 안내 + 3섹션 예고,
 *      다시 weather → 트리 복귀.
 *   4. /courses 부재(현 dev mock 상태) → 탭 없이 현행 화면 그대로(디그레이드).
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

// ── 코스 픽스처 심 — 서버 실형태(database/seed/courses.json · CoursesOut) 그대로 ──
// weather가 is_default지만 course_order는 2다(기초과학이 1) — "기본 우선 선택"이
// "첫 번째 탭 선택"으로 구현되면 여기서 잡힌다.
const COURSES_FIXTURE = {
  courses: [
    {
      id: 'basic-science',
      title: '기초과학',
      description: '온도·열·복사·기압·상태변화 — 기상 이해의 전제가 되는 과학 기초.',
      course_order: 1,
      prereq_course_id: null,
      is_default: false,
      units_total: 0,
    },
    {
      id: 'weather',
      title: '날씨와 기후',
      description: '실제 대기현상을 퍼즐로 체득하는 기상 커리큘럼 4섹션.',
      course_order: 2,
      prereq_course_id: 'basic-science',
      is_default: true,
      units_total: 12,
    },
  ],
};

let shimEnabled = true; // 시나리오 4에서 끈다(= 현 dev mock과 동일한 상태)
const httpServer = http.createServer((req, res) => {
  if (shimEnabled && req.method === 'GET') {
    const [path, qs = ''] = req.url.split('?');
    const sendJson = (status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };
    if (path === '/api/v1/courses') return sendJson(200, COURSES_FIXTURE);
    if (path === '/api/v1/curriculum' && qs.includes('course=basic-science')) {
      // 계약 F: basic-science는 빈 트리(유닛은 specs/11 설계 이후 저작)
      return sendJson(200, { sections: [] });
    }
    // /curriculum?course=weather는 mock의 GET /curriculum에 흡수된다(쿼리 스트립)
    // — 서버의 "생략·weather 동일 동작" 계약과 같은 결과라 그대로 통과시킨다.
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ detail: 'not found', code: 'NOT_FOUND' }));
  });
});
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

const text = () => window.document.body.textContent ?? '';
const courseTabs = () => [...window.document.querySelectorAll('[role="tablist"] button[role="tab"]')];
const selectedTab = () => courseTabs().find((b) => b.getAttribute('aria-selected') === 'true');
// 학습 홈 유닛 노드(모바일 지그재그) — onboardingGating과 동일 선택자 관례
const mobileUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:hidden"] button[aria-label]')];
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

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
  // ── 1~3. 코스 경로가 있는 환경(픽스처 심) — 탭·기본 선택·전환·빈 트리 ──────
  authenticate('course-user');
  const r = mount(createElement(App), '/');
  try {
    await scenario('코스 탭 렌더 + is_default(weather) 우선 선택 + weather 트리 무회귀', async () => {
      await waitFor(() => courseTabs().length === 2, 6000, '코스 탭 2개 렌더');
      assert(xhrLog.some((l) => l.endsWith('/api/v1/courses')), 'GET /courses가 발화되지 않았다');
      const sel = selectedTab();
      assert(sel, '선택된 탭이 없다');
      assert(
        sel.textContent.includes('날씨와 기후'),
        `is_default(weather)가 우선 선택돼야 함 — 실제 "${sel?.textContent}" ` +
          '(course_order 1위는 기초과학이다 — 첫 탭 선택으로 구현하면 안 된다)',
      );
      await waitFor(() => mobileUnitButtons().length > 0, 6000, 'weather 유닛 노드 렌더');
      assert(!text().includes('유닛 준비 중'), '기본 코스에 빈 트리 안내가 떴다(회귀)');
    });

    await scenario('prereq는 "선행 학습(권장)" 표기까지 — 탭 잠금 아님(PM 판정 ①)', async () => {
      const weatherTab = courseTabs().find((b) => b.textContent.includes('날씨와 기후'));
      const basicTab = courseTabs().find((b) => b.textContent.includes('기초과학'));
      assert(weatherTab && basicTab, '코스 탭이 없다');
      // prereq_course_id는 weather 쪽이다(basic-science가 권장 선행)
      assert(
        weatherTab.textContent.includes('선행 학습(권장)'),
        'prereq 있는 코스 탭에 "선행 학습(권장)" 표기가 없다',
      );
      assert(!basicTab.textContent.includes('선행 학습(권장)'), 'prereq 없는 탭에 표기가 붙었다');
      assert(!weatherTab.disabled && !basicTab.disabled, '코스 탭이 잠겼다 — 표기까지가 계약이다');
    });

    await scenario('basic-science 전환 → ?course= 재조회 → 빈 트리 안내 + 3섹션 예고 → weather 복귀', async () => {
      const mark = xhrLog.length;
      click(courseTabs().find((b) => b.textContent.includes('기초과학')));
      await waitFor(
        () => xhrLog.slice(mark).some((l) => l.includes('/api/v1/curriculum?course=basic-science')),
        6000,
        'GET /curriculum?course=basic-science 발화',
      );
      await waitFor(() => text().includes('개념 트리 설계 완료 — 유닛 준비 중'), 6000, '빈 트리 안내');
      for (const section of ['열과 빛', '공기의 무게', '물과 에너지']) {
        assert(text().includes(section), `3섹션 예고에 "${section}"이 없다 (specs/11 §2)`);
      }
      assert(mobileUnitButtons().length === 0, '빈 트리 코스에 유닛 노드가 렌더됐다');

      click(courseTabs().find((b) => b.textContent.includes('날씨와 기후')));
      await waitFor(() => mobileUnitButtons().length > 0, 6000, 'weather 복귀 후 트리 재렌더');
      assert(!text().includes('유닛 준비 중'), 'weather 복귀 후에도 빈 트리 안내가 남았다');
    });
  } finally {
    r.unmount();
  }

  // ── 4. /courses 부재(현 dev mock 상태) → 탭 없이 현행 화면 그대로 ──────────
  await scenario('/courses 없는 환경: 탭 미렌더 + weather 트리 현행 유지(디그레이드)', async () => {
    shimEnabled = false;
    authenticate('no-courses-user');
    const r2 = mount(createElement(App), '/');
    try {
      await waitFor(() => mobileUnitButtons().length > 0, 6000, '유닛 노드 렌더(현행)');
      // /courses 404가 소화된 뒤에도 탭이 없어야 한다 — 요청이 나갔음을 먼저 확인
      assert(xhrLog.some((l) => l.endsWith('/api/v1/courses')), 'GET /courses 시도조차 없다');
      await sleep(300);
      assert(courseTabs().length === 0, '/courses 없는 환경에서 코스 탭이 렌더됐다');
      assert(!text().includes('유닛 준비 중'), '디그레이드 상태에 빈 트리 안내가 떴다');
    } finally {
      r2.unmount();
    }
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 코스 선택(탭·기본 선택·빈 트리 안내·전환·디그레이드) 실마운트 스모크 통과');
process.exit(0);

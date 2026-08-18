/**
 * 코스 선택 실마운트 스모크 (R11-01 §6.2 / FE-A) —
 *
 * 2026-08-05: `/`가 홈 대시보드로 바뀌면서 코스 탭·유닛 노드는 `/learn`에 있다.
 *   node tests/course-select.smoke.test.mjs
 *
 * 관례는 onboardingGating.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트.
 *
 * ⚠️ **「목에 `GET /courses`가 없다」는 2026-08-18에 낡았다.** 그날 목에 추가됐다
 * (사유: 목이 안 덮은 경로가 dev 프록시로 빠져 **실제 백엔드 401**을 받아 오는
 * 바람에 `entryFlow ⑫`가 도커 기동 여부에 따라 갈렸다). `GET /curriculum?course=`는
 * 여전히 없다 — 라우터가 쿼리스트링을 떼므로 기존 `/curriculum`에 흡수된다.
 *
 * 이 파일은 계속 **자기 앞단 픽스처 심**을 쓴다. 목이 주는 값은 dev 화면용이고,
 * 여기서 무는 것은 **서버 계약 형태**(courses.json + `CoursesOut`)이며 특히
 * `is_default`와 `course_order`가 **어긋난 배치**(weather가 기본인데 순서는 2번)를
 * 일부러 만들어 「기본 우선 선택」이 「첫 탭 선택」으로 구현되면 잡히게 하기 때문이다.
 * 목 값과 같아지면 그 함정이 사라진다.
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

/**
 * 시나리오 4(디그레이드)를 위한 스위치.
 *
 * ⚠️ **끄면 「404를 준다」이지 「목으로 흘려보낸다」가 아니다**(2026-08-18 정정).
 * 종전에는 끄기 = 통과였고, 그때는 **목에 `GET /courses`가 없어서** 결과적으로
 * 404가 나왔다. 즉 이 시나리오가 **목의 공백에 얹혀 있었다.**
 *
 * 🔴 그 공백이 메워지자(같은 날 목에 `GET /courses` 추가) 이 시나리오가 깨졌다.
 * 더 나쁜 것은 **공백이 조용하지 않았다는 점**이다 — 목이 안 덮은 `/api/v1/*`는
 * `next()`로 빠지고, 스모크가 만드는 vite 서버는 `vite.config.js`의 **개발
 * 프록시를 물려받아** `localhost:8000`으로 나간다. 그래서 로컬 도커 백엔드가
 * 떠 있느냐에 따라 응답이 **404가 되기도 하고 진짜 401이 되기도 했다**
 * (`entryFlow ⑫`가 그 때문에 환경 따라 갈렸다).
 *
 * 그래서 「부재」를 **이 파일이 직접 만든다**. 다른 파일의 공백에 기대지 않는다.
 */
let shimEnabled = true;
const httpServer = http.createServer((req, res) => {
  if (!shimEnabled && req.method === 'GET' && req.url.split('?')[0] === '/api/v1/courses') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ detail: 'Not Found', code: 'NOT_FOUND' }));
  }
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
/**
 * 코스 탭 — **한 탭목록(tablist) 안의 탭만** 센다.
 *
 * ⚠️ 2026-08-13에 탭이 **두 벌 렌더된다**(클라이언트 지시로 PC 탭이 학습 경로
 * 카드 **안**으로 들어갔다 — 모바일 목록은 자기 위에 그대로 둔다). 화면에서는
 * 미디어쿼리로 한 벌만 보이지만 **jsdom은 CSS를 안 태우므로 둘 다 DOM에 있다.**
 * 종전처럼 문서 전체에서 세면 2가 아니라 4가 나와 「탭 2개」 계약이 시간 초과로
 * 죽는다 — 실제로 그렇게 죽었다.
 *
 * 그래서 **마지막 tablist**(= PC 경로 카드 안, 지시가 가리킨 그것)를 기준으로 센다.
 * 「두 벌이 같은 코스 집합을 그린다」는 아래 ⓐ가 따로 문다.
 */
const tablists = () => [...window.document.querySelectorAll('[role="tablist"]')];
const courseTabs = () => {
  const lists = tablists();
  const scope = lists[lists.length - 1];
  return scope ? [...scope.querySelectorAll('button[role="tab"]')] : [];
};
const selectedTab = () => courseTabs().find((b) => b.getAttribute('aria-selected') === 'true');
// 학습 홈 유닛 노드(모바일 지그재그) — onboardingGating과 동일 선택자 관례.
// data-wm-unit으로 고른다(aria-label로 세면 같은 묶음의 카드 버튼이 섞인다).
const mobileUnitButtons = () =>
  [...window.document.querySelectorAll('div[class*="md:hidden"] button[data-wm-unit]')];
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
  const r = mount(createElement(App), '/learn');
  try {
    await scenario('코스 탭 렌더 + is_default(weather) 우선 선택 + weather 트리 무회귀', async () => {
      await waitFor(() => courseTabs().length === 2, 6000, '코스 탭 2개 렌더');
      // ⓐ 두 벌(모바일·PC)이 **같은 코스 집합**을 그린다. 한쪽만 고치면 화면이
      //    갈리는데 위 선택자는 한 벌만 보므로, 그 축을 여기서 따로 문다.
      const lists = tablists();
      assert(lists.length >= 1, '탭목록이 하나도 없다');
      const labelSets = lists.map((l) =>
        [...l.querySelectorAll('button[role="tab"]')].map((b) => b.textContent.trim()).join('|'),
      );
      assert(
        new Set(labelSets).size === 1,
        `모바일·PC 탭이 서로 다른 코스를 그린다 — ${JSON.stringify(labelSets)}`,
      );
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

  // ── 4. /courses 부재 → 탭 없이 현행 화면 그대로(디그레이드) ──────────────
  // ⚠️ 「현 dev mock 상태」라고 적혀 있었으나 2026-08-18에 목이 그 경로를 덮었다.
  //    이 시나리오가 무는 것은 **구 백엔드·코스 미시드 DB**처럼 `/courses`가 없는
  //    배포이고, 그 부재는 이제 위 심이 **직접 404로** 만든다.
  await scenario('/courses 없는 환경: 탭 미렌더 + weather 트리 현행 유지(디그레이드)', async () => {
    shimEnabled = false;
    authenticate('no-courses-user');
    const r2 = mount(createElement(App), '/learn');
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

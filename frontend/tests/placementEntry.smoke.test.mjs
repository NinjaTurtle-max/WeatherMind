/**
 * 가입→배치고사 진입 회귀 가드 (R9-09 재발 방지 a) —
 *   node tests/placementEntry.smoke.test.mjs
 *
 * R9-09 회귀: 가입 성공 시 setTokens(외부 스토어 구독은 sync 우선 플러시)가
 * RegisterPage의 navigate('/onboarding/placement')보다 먼저 렌더를 일으켜
 * RedirectIfAuthed의 <Navigate to="/">가 목적지를 덮어썼다 — 서버에
 * POST /onboarding/placement/start가 아예 도착하지 않는 증상. SSR 렌더 스모크
 * (effect 미실행)로는 잡을 수 없어, jsdom 실마운트(React 18 createRoot,
 * useEffect까지 실행) + mock 서버(mock/apiMockPlugin.js) 실호출로 가드한다.
 *
 * 시나리오 (모두 실 XHR — 단언은 서버 도달 여부):
 *   1. 콜드 오픈: 토큰 없이 /onboarding/placement 진입 → 자동 게스트 발급 →
 *      placement/start 호출 발생 + 배치고사 화면 도달.
 *      **2026-08-12에 「가입 플로우(/register 폼 제출)」에서 갱신됐다** — 로그인·
 *      회원가입 구조가 제거되어 가입 화면도 `RedirectIfAuthed`도 없다(위 R9-09
 *      기술은 그래서 역사다). 본문 시나리오 1의 주석 참조.
 *   2. PlacementPage 단독 마운트: 마운트 크래시·쿼리 미발화 가드
 *   3. /daily **제거 가드**: 라우트가 없어져 자유 세션 발급이 나가지 않는다
 *      (2026-08-12에 「daily 세션 무회귀」에서 뒤집혔다).
 *   4. unit(/learn/units/:id) 세션 무회귀: 유닛 세션 발급 호출 발생 —
 *      `/daily`가 사라진 뒤로 **세션 발급 경로의 유일한 수신자**다.
 *
 * 관례: 테스트 러너 의존 없는 node 직접 실행. jsdom은 devDependency.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

// ── mock API 서버 (vite middlewareMode + apiMockPlugin, 임시 포트) ──────────
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
  url: `${origin}/register`,
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
globalThis.XMLHttpRequest = window.XMLHttpRequest; // axios가 브라우저(XHR) 어댑터를 쓰게
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;

// XHR 관찰 — 실호출은 그대로 통과시키고 "서버에 어떤 요청이 나갔는가"만 기록
const xhrLog = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  xhrLog.push(`${method} ${url}`);
  return origXhrOpen.call(this, method, url, ...rest);
};

const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack ?? e.message)));

// ── React 앱 마운트 도우미 ──────────────────────────────────────────────────
const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const PlacementPage = (await vite.ssrLoadModule('/src/modules/onboarding/PlacementPage.jsx')).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element, initialPath) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, element)),
  );
  return reactRoot;
}

// (`setInputValue` 헬퍼는 제거됐다 — 유일한 사용처가 삭제된 회원가입 폼 제출이었다.
//  폼을 채우는 스모크가 다시 필요하면 guest-convert.smoke.test.mjs의 `fillInput`을 볼 것.)

let failed = 0;
async function scenario(name, fn) {
  const mark = xhrLog.length;
  try {
    await fn(mark);
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
    console.error(`  이후 XHR: ${JSON.stringify(xhrLog.slice(mark))}`);
    if (pageErrors.length) console.error(`  page errors: ${pageErrors.join(' | ')}`);
  }
}

const since = (mark) => xhrLog.slice(mark);

try {
  // ── 1. 콜드 오픈 → 배치고사 도달 (구 "가입 플로우"의 후신) ─────────────────
  //
  // ⚠️ **갱신됨(2026-08-12 클라이언트 지시 — 로그인·회원가입 구조 전면 제거).**
  // 종전 이 시나리오는 `/register`에 마운트해 폼을 채우고 제출했다. 그 화면이
  // 삭제됐다(git rm). 원래 물던 R9-09 회귀 — 가입 성공의 `setTokens`가
  // `RedirectIfAuthed`의 `<Navigate to="/">`를 먼저 일으켜 배치고사 목적지를
  // 덮어쓰던 것 — 은 **구조적으로 불가능해졌다**: 가입 화면도, `RedirectIfAuthed`
  // 자체도 없다(App.jsx 주석 참조).
  //
  // 그래도 **폐기하지 않는다.** 이 시나리오의 값어치는 "배치고사가 라우팅을 거쳐
  // 실제로 도달되는가"이고, 그 위험은 진입 방식이 바뀌어도 남는다. 오히려 새 진입
  // (토큰 없는 콜드 오픈 → 자동 게스트 발급 → 보호 라우트 렌더)은 홉이 하나 더
  // 늘었다 — 발급이 끝나기 전에 라우트가 렌더되면 배치고사가 빈손으로 뜬다.
  // 시나리오 2(PlacementPage 단독 마운트)는 컴포넌트만 보므로 이 홉을 못 본다.
  //
  // 뒤 시나리오들이 쓰는 토큰도 여기서 선다(종전에는 가입이 세웠다).
  await scenario('콜드 오픈(토큰 없음) → 자동 게스트 발급 → 배치고사 도달', async (mark) => {
    const rootEl = mount(createElement(App), '/onboarding/placement');
    await waitFor(
      () => since(mark).some((l) => l === 'POST /api/v1/auth/guest'),
      6000,
      'POST /auth/guest 발화 — 토큰 없는 진입은 자동 게스트로 받는다(대회 규정)',
    );
    await waitFor(
      () => since(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      6000,
      'POST /onboarding/placement/start 발화 — 발급 후 배치고사가 실제로 시작되지 않았다',
    );
    // 화면도 배치고사(전체 화면, '건너뛰기' 헤더)에 도달했는지 확인
    await waitFor(
      () => window.document.body.textContent.includes('건너뛰기'),
      3000,
      '배치고사 화면 렌더(건너뛰기 헤더)',
    );
    rootEl.unmount();
  });

  // ── 1-b. 🔴 배치고사로 가는 **UI 경로가 최소 1개** 존재한다 ────────────────
  //
  // ⚠️ **이 계약이 없어서 진입 경로가 통째로 증발했다**(2026-08-12).
  // 로그인·회원가입 제거로 `LoginPage`가 삭제되자, 신규 학습자를
  // `/onboarding/placement`로 보내던 유일한 동선(가입 직후 진입)이 함께 사라졌다.
  // 라우트도 시작 호출도 멀쩡했기 때문에 **아무 테스트도 붉어지지 않았다** —
  // 시나리오 1·2는 "그 화면에 도착하면 동작하는가"를 물 뿐, "누가 보내주는가"를
  // 묻지 않았다. 규정상 심사위원은 계정 없이 열어 보므로, 진단은 도달 불가였다.
  //
  // 그래서 **화면에서 실제로 링크를 찾는다.** 소스 grep이 아니라 실마운트인 이유는
  // 진입점이 조건부(`placement_done === false`)라서다 — 렌더 조건이 뒤집히면
  // 링크는 소스에 남은 채 화면에서만 사라진다.
  //
  // 한 곳으로 못 박지 않는 이유: 어느 화면이 진입을 갖느냐는 제품 결정이다.
  // 계약은 **"최소 한 곳"**이고, 지금은 학습 홈(LearnFooterCards)과
  // 내 정보(ProgressPage) 두 곳이 갖는다.
  await scenario('배치고사 진입: 미진단 상태에서 UI 경로가 최소 1개 존재한다', async () => {
    const reset = await fetch(`${origin}/api/v1/dev/reset-me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    if (reset.status !== 200) throw new Error(`/dev/reset-me 실패 (${reset.status})`);

    const found = [];
    for (const path of ['/learn', '/me']) {
      const rootEl = mount(createElement(App), path);
      try {
        // 진입점은 /progress/me(placement_done)를 보고 그려지므로 도착을 기다린다.
        await waitFor(
          () => window.document.querySelector('a[href="/onboarding/placement"]') !== null,
          6000,
          `${path} 진단 진입점`,
        );
        found.push(path);
      } catch {
        /* 이 화면에는 없다 — 계약은 "최소 1개"라 여기서 실패시키지 않는다 */
      } finally {
        rootEl.unmount();
      }
    }

    if (found.length === 0) {
      throw new Error(
        '미진단 학습자가 배치고사로 갈 UI 경로가 **0개**다 — 온보딩 진단이 도달 '
          + '불가다(라우트는 살아 있어도 아무도 그 문을 열어 주지 않는다). '
          + '학습 홈 LearnFooterCards 또는 내 정보 ProgressPage의 진입 배너를 확인할 것',
      );
    }
    console.log(`     ↳ 진단 진입점 보유 화면: ${found.join(', ')}`);
  });

  // ── 2. PlacementPage 단독 마운트: 크래시 없음 + 쿼리 발화 ──────────────────
  await scenario('PlacementPage 단독 마운트 → 쿼리 발화', async (mark) => {
    const rootEl = mount(createElement(PlacementPage), '/onboarding/placement');
    await waitFor(
      () => since(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start'),
      4000,
      'PlacementPage 마운트 시 placement/start 발화',
    );
    if (pageErrors.length) throw new Error(`마운트 중 페이지 에러: ${pageErrors[0]}`);
    rootEl.unmount();
  });

  // ── 3. `/daily` 제거 가드 (구 "daily 세션 무회귀"의 후신) ──────────────────
  //
  // ⚠️ **뒤집혔다(2026-08-12 클라이언트 지시 — 자유 일일 세션 제거).**
  // 종전에는 `/daily`에서 `GET /session/today`가 **발화하는지**를 물었다. 이제는
  // 그 라우트가 없어야 한다: 자유 세션을 없애고 학습(유닛) 세션이 오늘 날씨를
  // 받는 쪽으로 옮겼다(서버 몫은 담당 B).
  //
  // 단정을 뒤집어 **되살아남을 잡는 가드**로 쓴다 — `/daily`는 매칭되는 라우트가
  // 없어 `*` → `/` → `/learn`으로 떨어지므로, 자유 세션 발급이 나가면 안 된다.
  // 라우트가 실수로 복구되면 여기서 먼저 운다.
  //
  // ⚠️ 아래 유닛 세션 시나리오가 이제 "세션이 실제로 열린다"의 **유일한** 수신자다.
  // 그것까지 지우면 세션 발급 경로 전체가 무가드가 된다 — 함께 지우지 말 것.
  await scenario('/daily는 제거됐다 — 자유 세션 발급이 나가지 않는다', async (mark) => {
    const rootEl = mount(createElement(App), '/daily'); // 시나리오 1의 게스트 토큰으로 인증 통과
    // 학습 화면으로 떨어졌는지: 커리큘럼 트리를 부르는 것이 그 신호다.
    await waitFor(
      () => since(mark).some((l) => l === 'GET /api/v1/curriculum'),
      5000,
      '/daily가 학습 화면으로 떨어지지 않았다',
    );
    await sleep(300); // 뒤늦은 발급이 있으면 잡히도록 여유를 준다
    const dailyIssued = since(mark).filter((l) => l === 'GET /api/v1/session/today');
    if (dailyIssued.length > 0) {
      throw new Error(
        `제거된 자유 일일 세션이 발급됐다(${dailyIssued.length}회) — /daily 라우트가 되살아났다`,
      );
    }
    rootEl.unmount();
  });

  await scenario('unit 세션(/learn/units/:id) 무회귀 — 유닛 세션 발급 발화', async (mark) => {
    const unitId = 'u0000001-0000-4000-8000-000000000001'; // mock 커리큘럼 1번 유닛
    const rootEl = mount(createElement(App), `/learn/units/${unitId}`);
    await waitFor(
      () => since(mark).some((l) => l === `POST /api/v1/curriculum/units/${unitId}/session`),
      4000,
      '유닛 세션 발급 POST 발화',
    );
    rootEl.unmount();
  });

  // ── 5. 배치고사 문항 수 = 서버 `Settings.PLACEMENT_SIZE`(10) ───────────────
  //
  // 이 브랜치가 서버를 6 → 10으로 올렸는데 목은 `CONCEPT_TAGS`(6종)에서 만들어져
  // **6문항에 멈춰 있었다**(2026-08-13 코드 리뷰 결함 ④). 목 위에서 본 진단 화면이
  // 실서버보다 4문항 짧았고, 화면 문구(`i18n placement.hint` 「딱 10문항」)와도
  // 어긋났다. 서버와의 수치 대조는 backend `test_r13_mock_policy_parity`가
  // `__mockPolicy().placement_size`로 소유하고, 여기서는 **실제 응답이 그만큼
  // 나오는가**를 HTTP 왕복으로 본다 — 정책을 신고하면서 페이로드는 안 따라오는
  // 갈림이 CO-J-9의 모양이었다.
  await scenario('배치고사 응답이 10문항이고 문항이 겹치지 않는다', async () => {
    const res = await fetch(`${origin}/api/v1/onboarding/placement/start`, {
      method: 'POST',
    });
    const body = await res.json();
    const items = body.items ?? [];
    if (items.length !== 10) {
      throw new Error(`배치고사가 ${items.length}문항이다 — 서버 PLACEMENT_SIZE는 10`);
    }
    const quizIds = new Set(items.map((it) => it.quiz_id));
    if (quizIds.size !== items.length) {
      throw new Error('quiz_id가 중복됐다 — 채점 맵이 문항을 덮어쓴다');
    }
    const texts = new Set(items.map((it) => it.question_text));
    if (texts.size !== items.length) {
      throw new Error('같은 문항이 두 번 나왔다 — 개념 순환에서 시드 중복 제거가 빠졌다');
    }
  });

  // ── 6~7. 「모르겠어요」 스킵이 **목 위에서** 서버와 같이 도는가 ─────────────
  //
  // 🔴 이 두 시나리오가 이 기능에서 가장 위험한 자리를 지킨다: 프론트 스모크는
  // 전부 목 위에서 돌기 때문에, 목이 서버를 안 따라오면 스모크가 **결함 상태를
  // 계약으로 굳힌다**(다른 갈림은 「안 닿았다」에서 멈추지만 이것은 틀린 상태를
  // 옳다고 증명한다). 목에는 *"서버와 같다"*는 주석이 이미 있었고 그래도 갈렸다.
  //
  // 값 대조(세 자리가 같은 리터럴인가)는 backend
  // `test_placement_skip_mock_parity.py`가 소유하고, 여기서는 **HTTP 왕복으로
  // 실제 채점 결과가 나오는가**를 본다 — 정책을 신고하면서 페이로드는 안 따라오는
  // 갈림이 CO-J-9의 모양이었다.
  //
  // ⚠️ 센티널을 `src`에서 import하지 않고 **리터럴로 적는다.** 이 스모크는
  // 「프론트와 목이 같은 상수를 참조한다」가 아니라 **「와이어에 이 바이트가
  // 실리면 오답이 나온다」**를 검증하는 자리다 — 상수를 공유하면 양쪽이 함께
  // 틀렸을 때도 초록이다.
  const SKIP = '__skip__';

  const startFreshPlacement = async () => {
    const reset = await fetch(`${origin}/api/v1/dev/placement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }), // 세션·완료표시·선해제 전부 철회
    });
    if (reset.status !== 200) throw new Error(`/dev/placement reset 실패 (${reset.status})`);
    const res = await fetch(`${origin}/api/v1/onboarding/placement/start`, { method: 'POST' });
    if (res.status !== 200) throw new Error(`placement/start 실패 (${res.status})`);
    return res.json();
  };

  // ── 6. 선재 결함 회귀 가드: **빈 답**은 목에서도 오답이다 ──────────────────
  //
  // ⚠️ 이것이 센티널 형식을 정한 실측 근거다(스킵과 **별개로 선재했다**).
  // 목 `gradeSessionItem`의 slider가 `Number('') = 0`이라 `|0 - 정답| <= 허용오차`가
  // 성립해, 배치고사 2번 문항(정답 `7` · 허용오차 10)에서 **빈 답이 「정답」**이었다.
  // 서버 `_grade_slider`는 `float('')` → ValueError → 오답이다 — 목과 서버가
  // **정반대** 판정을 내는 자리이고, 그래서 스킵 표식으로 빈 문자열을 쓰지 않는다.
  //
  // 스킵 시나리오와 따로 두는 이유: 센티널만 검증하면 이 결함은 그대로 살아 있고
  // (프론트가 빈 답을 못 보내게 하는 것은 계약이 아니라 구현이다), 되살아나도
  // 붉어지는 것이 없다.
  await scenario('빈 답은 목에서도 오답이다 (slider Number("")=0 선재 결함 가드)', async () => {
    const body = await startFreshPlacement();
    const slider = (body.items ?? []).find((it) => it.question_type === 'slider');
    if (!slider) throw new Error('배치고사에 slider 문항이 없다 — 이 가드의 대상이 사라졌다');

    const res = await fetch(`${origin}/api/v1/onboarding/placement/submit-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ quiz_id: slider.quiz_id, answer: '' }] }),
    });
    const graded = await res.json();
    const outcome = (graded.results ?? [])[0];
    if (!outcome) throw new Error(`채점 결과가 없다: ${JSON.stringify(graded)}`);
    if (outcome.is_correct !== false) {
      throw new Error(
        `빈 답이 「정답」으로 채점됐다(${slider.question_text}) — 목이 Number("")=0으로 `
          + '접었다. 서버는 float("") ValueError로 오답이다: 목 위 스모크가 '
          + '서버와 정반대 판정을 초록으로 통과시키는 상태다',
      );
    }
  });

  // ── 7. 전건 스킵: 오답으로 채점 · 진척 만석 · 정상 종료 · 선해제 0 ─────────
  //
  // 판정 확정분(서버와 같아야 하는 것): 스킵 → `is_correct=false` · 진척 **올림**.
  // 「안 푼 것」이 아니라 「틀린 것」이라서 진척이 오르고, 그래서 전건 스킵 세션도
  // `complete`가 409 SESSION_NOT_COMPLETED에 걸리지 않고 **정상 종료**한다 —
  // 진척이 안 오르면 학습자가 배치고사를 끝낼 수 없다.
  //
  // ⚠️ **θ 값을 서버와 대조하지 않는다.** 목은 `(정답률 - 0.5) * 2.4` 선형 근사이고
  // 서버는 IRT EAP 추정이다(의도된 근사 — backend 계약 독스트링 참조). 여기서 보는
  // 것은 **`is_correct=false`가 실제로 기록됐는가**의 귀결뿐이다: 전건 오답이면
  // θ가 음수여야 하고, 선해제(`unlock_floor`)는 0이어야 한다. 선해제 규칙 자체도
  // 목은 근사라 개수를 못박지 않고 **방향**(스킵이 늘면 열리는 유닛이 줄어든다)만 본다.
  await scenario('전건 스킵: 전부 오답 · 진척 만석 · 정상 종료 · 선해제 0', async () => {
    const body = await startFreshPlacement();
    const items = body.items ?? [];
    if (items.length === 0) throw new Error('배치고사 문항이 0건이다');

    const res = await fetch(`${origin}/api/v1/onboarding/placement/submit-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: items.map((it) => ({ quiz_id: it.quiz_id, answer: SKIP })),
      }),
    });
    if (res.status !== 200) throw new Error(`submit-all이 ${res.status}다 — 센티널이 거부됐다`);
    const graded = await res.json();

    // ① 전건 오답 — 유형별로 갈리지 않는다(6유형 전부 스킵 가능)
    const notWrong = (graded.results ?? []).filter((r) => r.is_correct !== false);
    if (notWrong.length > 0) {
      const types = notWrong.map((r) => {
        const it = items.find((i) => i.quiz_id === r.quiz_id);
        return `${it?.question_type ?? '?'}(${r.quiz_id})`;
      });
      throw new Error(
        `스킵이 오답이 아닌 문항 ${notWrong.length}건: ${types.join(', ')} — `
          + '「모르겠다 한것은 틀린 것으로」(클라이언트 지시)를 목이 안 지킨다',
      );
    }
    if ((graded.results ?? []).length !== items.length) {
      throw new Error(`채점 결과가 ${graded.results?.length}건 — 문항은 ${items.length}건이다`);
    }

    // ② 진척 올림 — 스킵은 「안 푼 문항」이 아니다
    const { answered, total } = graded.progress ?? {};
    if (answered !== items.length || total !== items.length) {
      throw new Error(
        `전건 스킵인데 진척이 ${answered}/${total}다 — 스킵이 진척을 안 올리면 `
          + 'complete가 409로 막혀 배치고사를 끝낼 수 없다',
      );
    }

    // ③ 정상 종료 — 409 SESSION_NOT_COMPLETED에 걸리지 않는다
    const done = await fetch(`${origin}/api/v1/session/${body.session_id}/complete`, {
      method: 'POST',
    });
    const summary = await done.json();
    if (done.status !== 200) {
      throw new Error(
        `전건 스킵 세션의 complete가 ${done.status}다(${summary?.code ?? ''}) — `
          + '스킵만 한 학습자가 진단 화면에 갇힌다',
      );
    }
    // ⚠️ 응답의 `placement_done`은 **못 박힌 리터럴**이라 단정으로 쓸 수 없다 —
    // 역검증에서 드러났다: 목의 `state.placementDone = true`를 지워도 페이로드는
    // 여전히 `placement_done: true`를 실어 이 스모크가 **초록**이었다. 저장이
    // 안 됐으므로 학습자는 다음 진입에서 진단을 다시 받는다. 그래서 페이로드가
    // 아니라 **남는 상태**를 본다(아래 ⑤에서 /dev/state로).
    if (summary.placement_done !== true) {
      throw new Error('complete 응답에 placement_done이 없다 — 계약 필드가 사라졌다');
    }
    if (summary.correct_count !== 0) {
      throw new Error(`전건 스킵인데 correct_count가 ${summary.correct_count}다`);
    }

    // ④ θ는 **값이 아니라 부호**만 본다(위 ⚠️ 참조) — 전건 오답의 귀결
    const abilities = summary.abilities ?? [];
    if (abilities.length === 0) throw new Error('배치 결과에 abilities가 없다');
    const nonNegative = abilities.filter((a) => a.theta >= 0);
    if (nonNegative.length > 0) {
      throw new Error(
        `전건 스킵인데 θ >= 0인 개념이 있다: ${nonNegative.map((a) => `${a.concept_tag}=${a.theta}`).join(', ')}`
          + ' — 스킵이 is_correct=false로 기록되지 않았거나 집계에서 빠졌다',
      );
    }
    // 스킵도 표본이다 — 분모에서 빠지면 「안 본 개념」이 되어 θ가 사전값에 머문다
    const noSample = abilities.filter((a) => !(a.num_responses > 0));
    if (noSample.length > 0) {
      throw new Error(
        `스킵한 문항이 표본에 안 셌다: ${noSample.map((a) => a.concept_tag).join(', ')}`
          + ' — 「안 푼 것」으로 취급되면 배치고사가 스킵을 보상한다',
      );
    }

    // ⑤ **남는 상태** — 응답 페이로드가 아니라 서버가 기억하는 것을 본다
    const devState = await (await fetch(`${origin}/api/v1/dev/state`)).json();
    if (devState.placement_done !== true) {
      throw new Error(
        '전건 스킵 세션을 끝냈는데 진단 완료가 **저장되지 않았다** — 학습자가 '
          + '다음 진입에서 진단을 처음부터 다시 받는다(응답의 placement_done은 '
          + '못 박힌 리터럴이라 이 갈림을 못 본다)',
      );
    }
    // 선해제 방향 — 개수를 못박지 않고 「전건 스킵이면 안 열린다」만 본다
    if (devState.unlock_floor !== 0) {
      throw new Error(
        `전건 스킵인데 유닛 ${devState.unlock_floor}개가 선해제됐다 — 스킵이 늘면 `
          + '열리는 유닛은 줄어드는 방향이어야 한다',
      );
    }
    console.log(`     ↳ 전건 스킵 ${items.length}문항 → 전부 오답 · θ 전건 음수 · 선해제 0`);
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(
  'OK: 콜드 오픈→배치고사 진입 + /daily 제거 + 유닛 세션 실마운트 + 「모르겠어요」 스킵 스모크 통과',
);
process.exit(0);

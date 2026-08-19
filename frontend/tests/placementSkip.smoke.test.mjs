/**
 * 배치고사 「모르겠어요」 문항 스킵 계약 (2026-08-19 클라이언트 지시) —
 *   node tests/placementSkip.smoke.test.mjs
 *
 * 지시: "배치고사에 문제마다 모르겠어요 버튼을 만들어 문제 건너 뛰도록 하자,
 * 그리고 모르겠다 한 것은 틀린 것으로." 프론트 몫은 **버튼과 와이어 형식**이다:
 * 스킵한 문항은 답안 `answer`에 센티널 `__skip__`을 담아 보낸다(새 필드 금지 —
 * 서버 스키마가 extra='forbid'라 요청 전체가 422가 된다. 빈 문자열도 금지 —
 * 목의 slider 채점이 Number('')=0으로 접어 스킵이 **정답**이 된다).
 *
 * 이 스모크가 무는 것 4가지:
 *   1. 배치고사 문항 화면에 스킵 버튼이 **있다**, 그리고 헤더의 「건너뛰기 →」
 *      (진단을 통째로 버리고 홈으로 나가는 버튼)와 **다른 문구**다.
 *   2. 누르면 `answered`가 오르고 **다음 문항**으로 넘어간다.
 *   3. 전 문항을 스킵하면 finalize(submit-all)가 **발화하고**, 그 payload의
 *      답안 전건이 정확히 `__skip__`이며 이어서 complete가 나간다.
 *      ⚠️ 「수집하지 않고 인덱스만 넘김」으로 구현하면 answered가 안 올라
 *      finalize 이펙트(answered >= total)가 **영원히 발화하지 않는다** — 이 항목이
 *      기능 성립의 핵심이라 payload보다 먼저 발화 자체를 본다.
 *   4. 🔴 **일반 세션(unit)에는 버튼이 없다.** `SessionRunner`는 daily·unit과
 *      공유되고 그쪽에는 XP·구름 소모·만회 라운드가 붙는다 — 게이트(`bulkMode`)가
 *      풀리면 안 푼 문항이 오답으로 기록되며 만회 큐에까지 들어간다.
 *      부재 단정은 **문항이 실제로 그려진 뒤에** 한다(안 그러면 아무것도 렌더되지
 *      않은 화면에서 "버튼이 없다"가 진공으로 통과한다).
 *
 * 관례: 테스트 러너 의존 없는 node 직접 실행 + jsdom 실마운트(React 18
 * createRoot, useEffect 실행) + mock 서버(mock/apiMockPlugin.js) 실 XHR.
 * placementEntry.smoke.test.mjs의 하네스를 그대로 따른다(로케일 ko 고정 포함).
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
  url: `${origin}/onboarding/placement`,
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
// 러너 환경이 en-US여도 제품 기본 로케일(ko)로 고정 — 한국어 문구 단정을 위해
// (i18n.smoke·placementEntry와 동일 관례).
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

// XHR 관찰 — 실호출은 통과시키고 "무엇이 나갔는가"만 기록한다.
// ⚠️ open만 감으면 **본문**을 못 본다(placementEntry는 open만 감는다). 이 스모크의
// 핵심 단정이 payload의 `answer` 값이라 send까지 감아 본문을 남긴다.
const xhrLog = [];
const requests = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
const origXhrSend = window.XMLHttpRequest.prototype.send;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__wmMethod = method;
  this.__wmUrl = url;
  xhrLog.push(`${method} ${url}`);
  return origXhrOpen.call(this, method, url, ...rest);
};
window.XMLHttpRequest.prototype.send = function (body) {
  requests.push({ method: this.__wmMethod, url: this.__wmUrl, body });
  return origXhrSend.call(this, body);
};

const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack ?? e.message)));

// ── React 앱 마운트 도우미 ──────────────────────────────────────────────────
const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
// 센티널은 **화면 코드의 값을 그대로** 쓴다 — 테스트가 리터럴을 따로 적으면
// 프론트가 값을 바꿔도 초록이라, 계약이 아니라 사본 두 벌이 된다.
const { PLACEMENT_SKIP_SENTINEL } = await vite.ssrLoadModule('/src/modules/session/SessionRunner.jsx');
// 스토어는 모듈 싱글턴이고 같은 vite 모듈 그래프이므로 화면이 쓰는 그 인스턴스다.
const { useSessionStore, SESSION_STATUS } = await vite.ssrLoadModule('/src/store/sessionStore.js');
const { translate } = await vite.ssrLoadModule('/src/i18n/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

const q = (sel) => window.document.querySelector(sel);
const skipButton = () => q('[data-session-skip]');
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const buttonsWithText = (text) =>
  [...window.document.querySelectorAll('button')].filter((b) => b.textContent.trim() === text);
const store = () => useSessionStore.getState();

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
const started = (mark) => since(mark).some((l) => l === 'POST /api/v1/onboarding/placement/start');

/** 배치고사를 열고 첫 문항의 스킵 버튼이 뜰 때까지 기다린다(공통 진입). */
async function openPlacement(mark, label) {
  const rootEl = mount(createElement(App), '/onboarding/placement');
  await waitFor(() => started(mark), 10000, `${label}: placement/start 발화`);
  await waitFor(
    () => store().status === SESSION_STATUS.IN_PROGRESS && store().items.length > 0,
    8000,
    `${label}: 배치 세션 문항 적재`,
  );
  return rootEl;
}

try {
  // ── 1. 버튼이 보인다 + 페이지 이탈 「건너뛰기」와 구별된다 ─────────────────
  //
  // 콜드 오픈(토큰 없음)이므로 자동 게스트 발급까지 함께 지난다 — 뒤 시나리오가
  // 쓰는 토큰도 여기서 선다(placementEntry 시나리오 1과 같은 이유).
  //
  // 「구별된다」를 문구로 무는 이유: 두 버튼은 결과가 정반대다(문항 하나를 넘김 ↔
  // 진단을 통째로 버리고 홈으로 나감). 같은 낱말이면 학습자가 진단을 버리는
  // 버튼을 문항 스킵으로 알고 누른다. 그래서 `placement.skip` 재사용을 금지하고
  // 새 키(`placement.dontKnow`)를 쓴다 — 이 단정이 그 금지의 수신자다.
  await scenario('배치고사 문항 화면에 「모르겠어요」가 있고 페이지 이탈 「건너뛰기 →」와 다른 문구다', async (mark) => {
    const rootEl = await openPlacement(mark, '버튼 노출');
    try {
      await waitFor(() => skipButton() !== null, 8000, '문항 스킵 버튼(data-session-skip) 렌더');
      const label = skipButton().textContent.trim();
      const dontKnow = translate('ko', 'placement.dontKnow');
      const leave = translate('ko', 'placement.skip');
      assert(label === dontKnow, `스킵 버튼 문구가 리소스와 다르다 — 화면 "${label}" ↔ placement.dontKnow "${dontKnow}"`);
      assert(
        label !== leave,
        `문항 스킵과 페이지 이탈이 **같은 문구**다("${label}") — 학습자가 진단을 통째로 버리는 버튼과 구별할 수 없다`,
      );
      assert(
        !label.includes('건너뛰기'),
        `문항 스킵 문구가 페이지 이탈 버튼의 낱말(「건너뛰기」)을 쓴다 — "${label}"`,
      );
      // 이탈 버튼은 **여전히 존재하고** 스킵 버튼과 다른 요소여야 한다
      const leaveButtons = buttonsWithText(leave);
      assert(leaveButtons.length === 1, `페이지 이탈 「${leave}」 버튼이 ${leaveButtons.length}개다(1개여야 한다)`);
      assert(leaveButtons[0] !== skipButton(), '이탈 버튼과 문항 스킵 버튼이 같은 요소다');
      // 안내 문구가 「오답으로 채점된다」를 미리 말한다(눌러 놓고 나중에 아는 일 방지)
      assert(
        window.document.body.textContent.includes(translate('ko', 'placement.dontKnowNote')),
        '스킵이 오답 처리라는 안내(placement.dontKnowNote)가 화면에 없다',
      );
    } finally {
      rootEl.unmount();
    }
  });

  // ── 2. 누르면 다음 문항으로 넘어간다(answered +1) ──────────────────────────
  //
  // answered를 함께 보는 이유: 「인덱스만 넘김」 구현이면 화면은 다음 문항으로
  // 가는 것처럼 보이지만 finalize가 영영 안 뜬다(시나리오 3의 뿌리).
  await scenario('「모르겠어요」를 누르면 answered가 1 오르고 다음 문항으로 넘어간다', async (mark) => {
    const rootEl = await openPlacement(mark, '스킵 전진');
    try {
      await waitFor(() => skipButton() !== null, 8000, '스킵 버튼 렌더');
      const before = store();
      assert(before.total >= 2, `문항이 ${before.total}건이라 "다음 문항"을 볼 수 없다`);
      const idx0 = before.currentIndex;
      const answered0 = before.answered;
      const firstQuizId = before.items[idx0].quiz_id;
      click(skipButton());
      await waitFor(
        () => store().answered === answered0 + 1,
        4000,
        `스킵이 answered를 올리지 않았다(${answered0} → ${store().answered}) — finalize가 발화하지 못한다`,
      );
      assert(
        store().currentIndex === idx0 + 1,
        `다음 문항으로 넘어가지 않았다(currentIndex ${idx0} → ${store().currentIndex})`,
      );
      const nowQuizId = store().items[store().currentIndex].quiz_id;
      assert(nowQuizId !== firstQuizId, '같은 문항이 그대로 남아 있다');
      // 스킵은 서버 왕복이 없다(bulk 로컬 수집) — 문항별 채점 호출이 나가면 안 된다
      const perItem = since(mark).filter((l) => /POST .*\/session\/.*\/answer$/.test(l));
      assert(perItem.length === 0, `스킵이 문항별 채점을 호출했다: ${JSON.stringify(perItem)}`);
    } finally {
      rootEl.unmount();
    }
  });

  // ── 3. 전 문항 스킵 → finalize 발화 + payload 전건이 `__skip__` ────────────
  await scenario('전 문항을 스킵하면 finalize가 발화하고 submit-all 답안 전건이 센티널이다', async (mark) => {
    const rootEl = await openPlacement(mark, '전건 스킵');
    try {
      const total = store().total;
      assert(total > 0, '배치 세션이 0문항이다');
      const sessionId = store().sessionId;
      for (let k = 0; k < total; k += 1) {
        await waitFor(() => skipButton() !== null, 5000, `${k + 1}/${total}번째 문항의 스킵 버튼`);
        click(skipButton());
        await waitFor(
          () => store().answered === k + 1,
          5000,
          `${k + 1}/${total}번째 스킵 뒤 answered=${k + 1} (실제 ${store().answered})`,
        );
      }
      // finalize 발화 — 이것이 안 되면 학습자는 마지막 문항 뒤에서 갇힌다
      await waitFor(
        () => requests.some((r) => (r.url ?? '').includes('/onboarding/placement/submit-all')),
        8000,
        '전 문항 스킵 뒤 finalizeBulk(submit-all)가 발화하지 않았다 — 스킵이 answered를 올리지 못했다',
      );
      const req = requests.find((r) => (r.url ?? '').includes('/onboarding/placement/submit-all'));
      const body = JSON.parse(req.body);
      const answers = body?.answers ?? [];
      assert(answers.length === total, `submit-all 답안이 ${answers.length}건이다(문항 ${total}건 전건이어야 한다)`);
      const wrong = answers.filter((a) => a.answer !== PLACEMENT_SKIP_SENTINEL);
      assert(
        wrong.length === 0,
        `스킵 답안이 센티널("${PLACEMENT_SKIP_SENTINEL}")이 아니다 — ${JSON.stringify(wrong.slice(0, 3))}`,
      );
      // 새 필드 금지(서버 extra='forbid' — 얹으면 요청 전체가 422)
      const extraKeys = answers.flatMap((a) =>
        Object.keys(a).filter((k) => !['quiz_id', 'answer', 'elapsed_sec'].includes(k)),
      );
      assert(extraKeys.length === 0, `답안에 계약 밖 필드가 있다: ${JSON.stringify([...new Set(extraKeys)])}`);
      // 이어서 complete까지 나가야 진단이 닫힌다(θ 배정)
      await waitFor(
        () => since(mark).some((l) => l === `POST /api/v1/session/${sessionId}/complete`),
        8000,
        'submit-all 뒤 complete가 발화하지 않았다',
      );
    } finally {
      rootEl.unmount();
    }
  });

  // ── 4. 🔴 일반 세션(unit)에는 버튼이 없다 ─────────────────────────────────
  await scenario('일반 세션(unit)에는 「모르겠어요」가 나타나지 않는다', async (mark) => {
    const unitId = 'u0000001-0000-4000-8000-000000000001'; // mock 커리큘럼 1번 유닛
    const rootEl = mount(createElement(App), `/learn/units/${unitId}`);
    try {
      await waitFor(
        () => since(mark).some((l) => l === `POST /api/v1/curriculum/units/${unitId}/session`),
        8000,
        '유닛 세션 발급 POST 발화',
      );
      // **문항이 실제로 그려졌는가** — 부재 단정의 전제. 이걸 빼면 아무것도
      // 렌더되지 않은 화면(에러·로딩)에서 "버튼이 없다"가 진공으로 통과한다.
      await waitFor(
        () => store().status === SESSION_STATUS.IN_PROGRESS && store().items.length > 0,
        8000,
        '유닛 세션 문항 적재',
      );
      const item = store().items[store().currentIndex];
      await waitFor(
        () => window.document.body.textContent.includes(`#${item.quiz_id}`),
        6000,
        `유닛 세션 문항 카드 렌더(#${item.quiz_id})`,
      );
      assert(
        skipButton() === null,
        '일반 세션(unit)에 「모르겠어요」가 새어 나왔다 — 이 경로는 문항별 서버 채점·'
          + '구름 소모·만회 라운드가 붙어 있어서, 안 푼 문항이 오답으로 기록되며 만회 큐에까지 들어간다',
      );
    } finally {
      rootEl.unmount();
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
console.log('OK: 배치고사 「모르겠어요」 노출·전진·센티널 payload·일반 세션 무유출 스모크 통과');
process.exit(0);

/**
 * 보드 진입 게이트 실마운트 스모크 (R10-01 §3.1 · D1 / S1) —
 *   node tests/boardEntryGate.smoke.test.mjs
 *
 * **이 테스트가 존재하는 이유(P1 회귀의 재발 방지)**
 * 웨이브 1에서 진입 게이트 엔드포인트 `GET /board/puzzles/{id}`를 신설했는데
 * 프론트가 그것을 **아무도 호출하지 않았다**. 계약 테스트는 "라우트가 존재한다"만
 * 확인했고 "프론트가 그 라우트를 실제로 호출한다"는 검증하지 않았으므로 전부
 * 초록이었다. 그 상태의 실제 동작은 단순 미구현보다 나쁘다 —
 *   - attempt는 **미통과 시에만** 소모하고, 잔량 0에서는 가드 UPDATE가 0행이라
 *     **0 소모·200**을 돌려준다(진행 중 세션 보호를 위한 의도된 설계)
 *   - 차단해야 할 유일한 지점(상세 진입)이 도달 불가
 *   → **잔량 0에서 보드 퍼즐이 무제한**. R10 이전에는 0에서 429로 막혔으니 회귀다.
 * 그래서 여기서는 "라우트 존재"가 아니라 **프론트가 그 라우트를 호출하는지**를
 * 실제 XHR 관측으로 고정한다.
 *
 * 관례는 onboardingGating.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트(createRoot,
 * useEffect 실행). 목 상태 조작은 기존 dev 경로(/dev/clouds)만 쓴다.
 * BoardPage를 직접 마운트한다(FeatureUnlockGate·Layout은 이 가드의 관심사가 아님).
 *
 * 검증 4건
 *   1. 퍼즐 시작이 상세 엔드포인트를 **실제로 호출**한다(목록 payload 직행 금지).
 *   2. 잔량 0이면 시작 CTA가 비활성 + "구름 회복까지 N분" 인라인(누르기 전에 안내)
 *      + 눌러도 상세 요청이 나가지 않는다.
 *   3. 목록은 잔량 0에서도 200으로 렌더된다(cleared 표시 유지 — D1 무차단).
 *   4. 진행 중 퍼즐의 제출은 잔량 0에서도 막히지 않는다("풀던 것을 뺏기지 않는다").
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

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
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = NoopResizeObserver;
globalThis.ResizeObserver = NoopResizeObserver;
// 보드 비주얼(강수 Canvas·WebGL 오버레이)은 전부 컨텍스트 null 가드가 있다.
// jsdom의 "not implemented" 잡음만 없애고 null을 돌려준다 — 이 가드는 비주얼이
// 아니라 진입 게이트를 본다.
window.HTMLCanvasElement.prototype.getContext = () => null;

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

const BoardPage = (await vite.ssrLoadModule('/src/modules/board/BoardPage.jsx')).default;
// 자유 실험은 2026-08-10에 **탐구로 이사했다** — 보드 목록에는 더 이상 없다.
// 「채점 없는 판은 구름과 무관하다」는 계약은 살아 있으므로, 화면만 바꿔 잡는다.
const SandboxPage = (await vite.ssrLoadModule('/src/modules/explore/SandboxPage.jsx')).default;
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

// 마운트된 루트를 추적해 시나리오 종료 시 반드시 정리한다. 정리하지 않으면
// 실패한 시나리오가 루트를 남겨 다음 시나리오가 같은 컨테이너에 겹쳐 마운트되고
// (DOMException) 실패가 크래시로 바뀌어 종료 코드가 0이 된다 — 가드가 무력해진다.
let currentRoot = null;
function safeUnmount() {
  if (!currentRoot) return;
  try {
    currentRoot.unmount();
  } catch {
    /* 이미 정리됨 */
  }
  currentRoot = null;
  const container = window.document.getElementById('root');
  if (container) container.innerHTML = '';
}

function mount(element, initialPath = '/board') {
  safeUnmount();
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  currentRoot = reactRoot;
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
const buttons = () => [...window.document.querySelectorAll('button')];
const findButton = (needle) => buttons().find((b) => (b.textContent ?? '').includes(needle));
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

/** 인증 상태 주입 — 목은 토큰을 검증하지 않는다(계정 식별만 필요). */
useAuthStore.getState().setTokens({ accessToken: 't-board', refreshToken: 'r-board' });
useAuthStore.getState().setUser({ user_id: 'board-user', email: 'board@test.dev', nickname: '스모크' });

let failed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  } finally {
    safeUnmount();
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 목록 첫 퍼즐 — 카드 텍스트/상세 URL 대조에 쓴다
const listRes = await api('GET', '/board/puzzles');
const firstPuzzle = listRes.body?.[0];
// 카드에 **보이는** 문구로 찾는다 — 2026-08-05 퍼즐 조각 카드부터 화면에 뜨는
// 것은 짧은 제목(template_json.title)이고, 미션 문장 원문은 title 속성에만 있다.
// question_text로 찾으면 카드가 멀쩡히 떠 있는데도 "목록 렌더" 대기가 터진다.
const firstQuestion = firstPuzzle?.template_json?.title
  ?? firstPuzzle?.template_json?.question_text
  ?? '';
const detailUrl = `GET /api/v1/board/puzzles/${firstPuzzle?.content_item_id}`;

/** 목록이 렌더될 때까지 대기 + 첫 퍼즐 카드 반환 */
async function mountListAndFindCard() {
  const r = mount(createElement(BoardPage));
  await waitFor(() => text().includes(firstQuestion), 6000, '퍼즐 목록 렌더');
  const card = buttons().find((b) => (b.textContent ?? '').includes(firstQuestion));
  assert(card, '첫 퍼즐 카드를 찾지 못했다');
  return { r, card };
}

try {
  assert(listRes.status === 200 && Array.isArray(listRes.body) && listRes.body.length > 0,
    `목 퍼즐 목록이 비어 있다: ${JSON.stringify(listRes).slice(0, 160)}`);

  // ── 1. 퍼즐 시작 → 상세 엔드포인트 실호출 ────────────────────────────────
  await scenario('퍼즐 시작이 GET /board/puzzles/{id}(상세)를 실제로 호출한다', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const { r, card } = await mountListAndFindCard();
    // 목록 렌더 단계에서는 아직 상세를 부르지 않는다(목록은 무차단·무게이트)
    assert(!xhrLog.includes(detailUrl), '목록 렌더만으로 상세가 호출됐다(불필요한 게이트 소진)');

    const mark = xhrLog.length;
    click(card);
    await waitFor(() => xhrLog.slice(mark).includes(detailUrl), 5000,
      `상세 호출(${detailUrl}) — 목록 payload로 바로 플레이하는 회귀`);
    // 상세 응답으로 플레이 화면 진입
    await waitFor(() => text().includes('← 목록으로') && text().includes('제출하기'), 5000, '플레이 화면 진입');
    r.unmount();
  });

  // ── 2. 잔량 0 → 시작 CTA 비활성 + 회복 안내 + 요청 자체가 나가지 않음 ─────
  await scenario('구름 0: 시작 CTA 비활성 + "구름 회복까지 N분" + 상세 요청 미발생', async () => {
    const zero = await api('POST', '/dev/clouds', { clouds: 0 });
    assert(zero.status === 200, `/dev/clouds 실패 (${zero.status})`);
    // 서버 계약 확인 — 상세 진입이 429 OUT_OF_CLOUDS로 막힌다(§3.1 차단 지점 3)
    const gated = await api('GET', `/board/puzzles/${firstPuzzle.content_item_id}`);
    assert(gated.status === 429 && gated.body?.code === 'OUT_OF_CLOUDS',
      `잔량 0에서 상세는 429 OUT_OF_CLOUDS여야 함 — 실제 ${gated.status} ${gated.body?.code}`);
    assert(typeof gated.body?.next_regen_sec === 'number', 'next_regen_sec가 동봉돼야 함');

    const { r, card } = await mountListAndFindCard();
    await waitFor(() => text().includes('구름 회복까지 약'), 5000, '카드 인라인 회복 ETA');
    assert(text().includes('구름이 모두 흩어졌어요'), '소진 안내 배너가 없다');
    assert(card.disabled, '잔량 0에서 퍼즐 시작 CTA가 비활성이어야 한다');

    // 누르기 전에 알리는 계약이므로, 눌러도 상세 요청이 나가지 않아야 한다
    const mark = xhrLog.length;
    click(card);
    await sleep(300);
    assert(!xhrLog.slice(mark).includes(detailUrl), '비활성 카드가 상세를 호출했다');
    assert(!text().includes('제출하기'), '잔량 0에서 플레이 화면으로 들어갔다(게이트 무력화)');
    r.unmount();
  });

  // ── 3. 목록은 잔량 0에서도 무차단(D1) ────────────────────────────────────
  await scenario('구름 0에서도 목록은 200 + cleared 표시 렌더(무차단)', async () => {
    const list = await api('GET', '/board/puzzles');
    assert(list.status === 200, `잔량 0에서 목록은 200이어야 함 — 실제 ${list.status}`);
    assert(list.body.every((p) => 'cleared' in p), 'cleared 필드가 목록에 있어야 함');

    const { r } = await mountListAndFindCard();
    // 난이도 라벨은 '난이도 {쉬움|보통|어려움}' 꼴이다. 예전에는 특정 라벨
    // 낱말('도전')을 단정했는데, 문구를 바꾸는 순간 검사 절반이 조용히 죽는다
    // (2026-08-06에 '도전' → '어려움'으로 바꾸며 드러났다). 낱말이 아니라
    // **배지가 붙었다는 사실**을 본다.
    assert(text().includes('✓ 클리어') || text().includes('난이도 '),
      '잔량 0에서 클리어/난이도 배지가 사라졌다(목록을 차단한 회귀)');
    assert(!text().includes('퍼즐을 불러오지 못했어요'), '잔량 0에서 목록이 에러 화면이 됐다');
    // 자유 실험은 **보드에서 사라졌다**(2026-08-10 탐구로 이사) — 카드가 남아
    // 있으면 "채점되는 것"과 "채점 안 되는 것"이 한 판에 다시 섞인다.
    assert(!findButton('자유 실험'), '자유 실험 카드가 보드로 되돌아왔다');
    assert(!text().includes('탐구 실험실'), '탐구 실험실 카드가 보드로 되돌아왔다');
    r.unmount();

    // 그 계약(채점 없는 판은 잔량 0에서도 열린다)은 이사한 화면에서 지킨다.
    // 잔량 0인 지금 그대로 마운트해 화면이 뜨는지 본다.
    //
    // ⚠️ "서버 호출 0"이 아니다. 판은 `/board/rules`·`/board/regions`(판정 규칙과
    // 지도 — 유저와 무관한 **정적 자료**)를 부른다. 구름을 소모하는 것은 퍼즐
    // **진입**(`/board/puzzles/{id}`) 하나뿐이고, 그게 429의 주인이다.
    // 그래서 "아무것도 안 부른다"가 아니라 **그 하나를 안 부른다**를 단정한다.
    const sandboxMark = xhrLog.length;
    const sandboxRoot = mount(createElement(SandboxPage));
    await waitFor(() => text().includes('채점하지 않아요'), 5000, '탐구의 자유 실험 화면');
    const gated = xhrLog.slice(sandboxMark).filter((u) => /\/board\/puzzles\/[^/]+$/.test(u));
    assert(
      gated.length === 0,
      `자유 실험이 구름 게이트를 탔다: ${gated.join(' , ')}`,
    );
    sandboxRoot.unmount();
    return;
    r.unmount();
  });

  // ── 4. 진행 중 퍼즐은 잔량 0이 되어도 제출까지 가능 ───────────────────────
  await scenario('진행 중 퍼즐: 진입 후 잔량 0이 되어도 제출이 막히지 않는다', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const { r, card } = await mountListAndFindCard();
    click(card);
    await waitFor(() => text().includes('제출하기'), 5000, '플레이 화면 진입');

    // 진입 후 소진 — 서버 계약: attempt는 429가 아니라 0 소모·200
    await api('POST', '/dev/clouds', { clouds: 0 });
    const attemptId = `${firstPuzzle.content_item_id}`;
    const direct = await api('POST', `/board/puzzles/${attemptId}/attempt`, {
      board_state: { elements: [] }, // zones 생략 허용(boardEngine.validateBoardState)
    });
    assert(direct.status === 200, `잔량 0에서 attempt는 200이어야 함 — 실제 ${direct.status}`);
    assert(direct.body?.clouds_spent === 0,
      `잔량 0에서는 0 소모여야 함 — 실제 ${direct.body?.clouds_spent}`);

    // UI: 제출 버튼이 비활성되지 않았고, 실제 제출이 나가고 판정 결과가 뜬다
    const submit = findButton('제출하기');
    assert(submit && !submit.disabled, '진행 중 퍼즐의 제출 버튼이 잔량 0에서 비활성됐다(회귀)');
    const mark = xhrLog.length;
    click(submit);
    await waitFor(
      () => xhrLog.slice(mark).some((l) => l === `POST /api/v1/board/puzzles/${attemptId}/attempt`),
      5000,
      '진행 중 퍼즐의 attempt 발화',
    );
    await waitFor(() => text().includes('다시 시도') || text().includes('한 번 더 도전'), 5000,
      '판정 결과 렌더(제출이 차단되지 않음)');
    assert(!text().includes('구름이 모두 흩어졌어요'),
      '진행 중 퍼즐 제출이 소진 화면으로 대체됐다(풀던 것을 뺏는 회귀)');
    r.unmount();
    await api('POST', '/dev/clouds', { clouds: 5 });
  });

  // ── 5. CO-K11: 클리어 후 나가는 문 + 「다음 퍼즐 →」 ───────────────────────
  //
  // 클라이언트 직접 관찰(2026-08-07): 성공하는 순간 AtmosphereBoard의
  // scrollIntoView({block:'center'})가 단면 패널을 화면 가운데로 끌어와 **유일한
  // 출구인 상단 「목록으로」 링크를 화면 밖으로 밀었다.** 그 자리에서 보이는 유일한
  // 버튼이 「다시 도전」이라 같은 퍼즐에 남는 것이 유일한 선택지였고, BoardPage
  // 머리말이 스스로 "순차 진행"이라 적어 놓고 **「다음 퍼즐」이 아예 없었다.**
  // 결과 블록(=자동 스크롤 도착 지점)에 3버튼이 있는지를 고정한다.
  await scenario('CO-K11: 결과 블록에 「목록으로」와 「다음 퍼즐 →」이 함께 있다', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const { card } = await mountListAndFindCard();
    click(card);
    await waitFor(() => text().includes('제출하기'), 5000, '플레이 화면 진입');
    const submit = findButton('제출하기');
    click(submit);
    await waitFor(
      () => window.document.querySelector('[data-board-back]'),
      5000,
      '결과 블록의 「목록으로」 버튼',
    );
    const back = window.document.querySelector('[data-board-back]');
    assert(
      (back.textContent ?? '').includes('목록으로'),
      `「목록으로」 버튼 문구가 다르다 — "${back.textContent}"`,
    );
    // 미클리어(빈 배치)에서는 「다시 도전」이 주 버튼이고 「다음 퍼즐」은 없다
    assert(findButton('다시 시도') || findButton('한 번 더 도전'), '재도전 버튼이 사라졌다');
    assert(
      !window.document.querySelector('[data-board-next]'),
      '미클리어인데 「다음 퍼즐 →」이 떴다(순서를 건너뛰게 된다)',
    );
    // 「목록으로」가 실제로 목록으로 되돌린다(같은 퍼즐에 남지 않는다)
    click(back);
    await waitFor(() => !text().includes('제출하기'), 5000, '목록 복귀');

    // 클리어 상태를 목에서 만들기 어려우므로(정답 배치가 필요) 「다음 퍼즐」의
    // **경로**는 소스 계약으로 고정한다: 반드시 openPuzzle(=상세 엔드포인트)을
    // 탄다. 목록 payload로 직행하면 보드측 유일한 구름 진입 게이트(D1·CO-K5)를
    // 우회해 잔량 0에서 보드가 무제한이 된다 — 이 파일이 존재하는 이유 그 자체다.
    const src = await readFile(resolve(root, 'src/modules/board/BoardPage.jsx'), 'utf8');
    assert(/data-board-next/.test(src), 'BoardPage에 data-board-next가 없다');
    assert(
      /data-board-next[\s\S]{0,240}openPuzzle\(nextPuzzle\)/.test(src),
      '「다음 퍼즐 →」이 openPuzzle(상세 진입 게이트)을 타지 않는다(CO-K5 우회)',
    );
  });

  // ── 6. CO-K7: 자유 실험은 마운트 즉시 자동 스크롤하지 않는다 ──────────────
  //
  // SANDBOX_PUZZLE.goal_conditions=[] → JS checkGoals가 `passed:true` →
  // scrollPhase='preview' → 아무것도 안 했는데 단면 패널로 화면이 튀었다(CO-K3의
  // 발현). 목표가 없으면 "달성"도 없다 — scrollIntoView 호출 0을 실측으로 고정한다.
  await scenario('CO-K7: 자유 실험 진입에서 scrollIntoView가 호출되지 않는다', async () => {
    const calls = [];
    const orig = window.Element.prototype.scrollIntoView;
    window.Element.prototype.scrollIntoView = function (...args) {
      calls.push(args);
    };
    try {
      // 2026-08-10: 보드에서 눌러 들어가던 화면이 탐구의 독립 라우트가 됐다.
      // 지키는 것은 같다 — 목표가 없는 판은 마운트만으로 화면을 튕기지 않는다.
      mount(createElement(SandboxPage));
      await waitFor(() => text().includes('채점하지 않아요'), 5000, '자유 실험 화면');
      await sleep(300); // 스크롤 이펙트가 늦게 붙을 여지를 준다
      assert(
        calls.length === 0,
        `자유 실험 진입에서 자동 스크롤이 ${calls.length}회 났다(CO-K7 회귀)`,
      );
    } finally {
      window.Element.prototype.scrollIntoView = orig;
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
console.log('OK: 보드 진입 게이트(상세 실호출·잔량 0 사전 차단·목록 무차단·진행 중 보호) 스모크 통과');
process.exit(0);

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

/**
 * 목록 응답을 **미리 심어** 마운트한다 — 목이 못 만드는 payload를 보기 위한 통로.
 *
 * 왜 필요한가: 배지 미표시 가드는 `knowledge_level`이 **null**일 때를 지키는데,
 * 목 뱅크의 board 문항은 전건 단계가 채워져 있어(미분류 0건) 실호출로는 그 갈래를
 * 밟을 수 없다. 목을 고치는 것은 남의 파일이고, 목을 고쳐서 볼 것도 아니다 —
 * 지켜야 하는 것은 「필드가 비면 아무것도 그리지 않는다」는 **화면의 성질**이다.
 * 그래서 react-query 캐시에 목록을 심고 그 화면만 본다.
 *
 * ⚠️ `gcTime`을 무한으로 둔다 — 기본 0이면 관찰자가 붙기 전에 심은 데이터가
 * 회수돼 컴포넌트가 실호출로 되돌아간다(그러면 이 함수가 아무 일도 안 한다).
 * 컴포넌트의 `staleTime`(60s)이 기본값을 이기므로 재요청도 나가지 않는다.
 */
function mountWithBoardList(element, list, initialPath = '/board') {
  safeUnmount();
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  currentRoot = reactRoot;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity } },
  });
  qc.setQueryData(['board', 'puzzles'], list);
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
    // 낱말이 아니라 **배지가 붙었다는 사실**을 본다. 특정 라벨을 단정하면 문구가
    // 바뀌는 순간 검사 절반이 조용히 죽는다 — 이 파일에서 두 번 그랬다('도전' →
    // '어려움' 2026-08-06 · '난이도 ' 접두어 → 지식 단계 표기 2026-08-20).
    // 그래서 이제 **문구가 아니라 속성**(data-knowledge-level)을 본다: 배지가
    // 무슨 낱말을 쓰든 붙어 있으면 잡히고, 사라지면 어떤 문구 개편에도 안 죽는다.
    assert(text().includes('✓ 클리어') || window.document.querySelector('[data-knowledge-level]'),
      '잔량 0에서 클리어/단계 배지가 사라졌다(목록을 차단한 회귀)');
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
    // ⚠️ 여기서 바로 xhrLog를 읽으면 **아무것도 안 잡힌다**. 위 문구는 첫 커밋에
    // 이미 들어 있어 waitFor가 0ms에 통과하고, 그 시점엔 어떤 요청도 아직
    // 나가지 않았다 — 게이트를 되살려도 초록이 된다(2026-08-10 리뷰).
    await sleep(300);
    const gated = xhrLog.slice(sandboxMark).filter((u) => /\/board\/puzzles\/[^/]+$/.test(u));
    assert(gated.length === 0, `자유 실험이 구름 게이트를 탔다: ${gated.join(' , ')}`);
    sandboxRoot.unmount();
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
    // 그리고 **잠긴 칸을 건너뛴다**(2026-08-10). 바로 다음 칸을 집으면 밴드
    // 경계(초등 23번·중고등 36번)를 깬 사람이 상 대신 403 에러를 받는다.
    assert(
      /const nextPuzzle =[\s\S]{0,220}!p\.locked/.test(src),
      '「다음 퍼즐 →」이 잠긴 칸을 건너뛰지 않는다',
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

  // ── 7. 학습 수준 잠금 (2026-08-10 사용자 지시 · 2026-08-20 축 전환) ───────
  //
  // 열쇠는 진도가 아니라 `users.level_group`이다. ⚠️ **잠기는 대상이 바뀌었다**:
  // 종전에는 학령 파생 `difficulty`(1~3)를 잠갔고 이 시나리오도 `p.difficulty === 3`
  // 으로 칸을 골랐는데, 그 필드는 **응답에 없다**(축이 `knowledge_level` 1~10으로
  // 갈아탔다). 그래서 필드가 사라진 날부터 이 시나리오는 「난이도 1·3 퍼즐이 둘 다
  // 있어야」에서 터져 있었다 — 잠금을 검사하지 못한 채로.
  //
  // ⚠️ **천장 값을 여기 박지 않는다**(2/4/6/9는 목·서버가 소유하고, 층 수 N도 자란다).
  // 대신 **성질**을 문다: 잠긴 집합은 층 순서의 **꼬리**다 —
  //   ceiling = 안 잠긴 칸의 최대 층  ⇒  (층 ≤ ceiling ⟺ 안 잠김)
  // 이 성질은 천장이 몇이든, 층이 10칸이든 12칸이든 참이라야 한다. 값을 베끼면
  // 목이 바뀔 때 테스트가 조용히 낡지만, 성질은 낡지 않는다.
  //
  // 여기서 지키는 것은 셋이다 —
  //   ① 잠긴 칸을 **눌러도 상세 요청이 안 나간다**(누르기 전에 알린다, §3.1)
  //   ② 서버가 실제로 막는다(403 PUZZLE_LOCKED) — 화면만 막으면 주소창으로 뚫린다
  //   ③ **수준을 바꾸면 그 자리에서 열린다** — 여는 통로가 없으면 벽이다
  await scenario('학습 수준 잠금: 잠긴 칸은 상세를 안 부르고, 수준을 올리면 열린다', async () => {
   // 목의 학령은 프로세스 전역이라 **실패해도** 원복해야 한다. 원복을 본문
   // 끝에 두면 단정 하나가 터진 순간 목이 elementary/adult로 남고, 뒤에 붙는
   // 시나리오가 엉뚱한 이유로 실패한다(2026-08-10 코드 리뷰).
   try {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const before = await api('PATCH', '/auth/me', { level_group: 'middle_high' });
    assert(before.status === 200, `학령 설정 실패 (${before.status})`);

    const list = await api('GET', '/board/puzzles');
    // 잠긴 집합이 층 순서의 꼬리인지 — 천장을 응답에서 **되읽어** 판정한다.
    const tierOf = (p) => p.knowledge_level;
    const assertTailPartition = (body, who) => {
      const open = body.filter((p) => !p.locked && tierOf(p) != null).map(tierOf);
      const shut = body.filter((p) => p.locked).map(tierOf);
      assert(open.length > 0, `${who}: 안 잠긴 칸이 하나도 없다 — 못 여는 것이 열리는 것보다 나쁘다`);
      const ceiling = Math.max(...open);
      assert(shut.every((tier) => tier > ceiling),
        `${who}: 천장(${ceiling}) 이하인데 잠긴 칸이 있다 — 잠긴 집합이 층 순서의 꼬리가 아니다 [${shut.filter((v) => v <= ceiling).join(',')}]`);
      // 층 미상(null)은 **절대 잠기지 않는다**(서버 locked_tiers와 같은 규칙 —
      // 「못 여는 것이 열리는 것보다 나쁘다」). 값이 비는 순간 퍼즐이 통째로
      // 사라지는 것을 막는 가드라, 잠금 쪽에서도 같이 물어야 한다.
      assert(body.filter((p) => tierOf(p) == null).every((p) => !p.locked),
        `${who}: 층 미상(null) 칸이 잠겼다 — 미상은 잠그지 않는다`);
      return ceiling;
    };

    const mhCeiling = assertTailPartition(list.body, '중·고등');
    const hard = list.body.find((p) => p.locked);
    const easy = list.body.find((p) => !p.locked);
    assert(hard && easy,
      `중·고등에서 잠긴 칸과 열린 칸이 둘 다 있어야 이 계약을 볼 수 있다 — 천장 ${mhCeiling}, 잠김 ${list.body.filter((p) => p.locked).length}건`);
    assert(tierOf(hard) > mhCeiling, '잠긴 칸의 층이 천장보다 높지 않다');

    // ② 서버가 막는다 — 화면을 거치지 않고 직접 부른다
    const blocked = await api('GET', `/board/puzzles/${hard.content_item_id}`);
    assert(blocked.status === 403 && blocked.body?.code === 'PUZZLE_LOCKED',
      `잠긴 난이도 상세는 403 PUZZLE_LOCKED여야 함 — 실제 ${blocked.status} ${blocked.body?.code}`);
    // 진입만 막으면 채점을 직접 불러 판정·XP·클리어를 다 받아간다(2026-08-10
    // 코드 리뷰에서 실제로 뚫려 있었다) — attempt도 같은 403이어야 한다.
    const graded = await api('POST', `/board/puzzles/${hard.content_item_id}/attempt`, {
      board_state: { elements: [] },
    });
    assert(graded.status === 403 && graded.body?.code === 'PUZZLE_LOCKED',
      `잠긴 퍼즐 채점도 403이어야 함 — 실제 ${graded.status} ${graded.body?.code}`);

    // ① 화면: 잠긴 칸은 비활성이고 눌러도 요청이 안 나간다
    const hardTitle = hard.template_json?.title ?? hard.template_json?.question_text ?? '';
    const r = mount(createElement(BoardPage));
    await waitFor(() => text().includes(hardTitle), 6000, '퍼즐 목록 렌더');
    const hardCard = buttons().find((b) => (b.textContent ?? '').includes(hardTitle));
    assert(hardCard?.disabled, '잠긴 퍼즐 카드가 비활성이 아니다');
    assert(text().includes('수준 올리면 열림'), '잠긴 칸에 사유가 안 뜬다');
    // 여는 통로가 화면에 있어야 한다 — 사유만 있고 방법이 없으면 벽이다
    assert(window.document.querySelector('a[href="/me"]'), '잠금 안내에 학습 수준 통로가 없다');
    const mark = xhrLog.length;
    click(hardCard);
    await sleep(300);
    const hardDetail = `GET /api/v1/board/puzzles/${hard.content_item_id}`;
    assert(!xhrLog.slice(mark).includes(hardDetail), '비활성인 잠긴 카드가 상세를 호출했다');
    r.unmount();

    // ③ 수준을 올리면 열린다
    const up = await api('PATCH', '/auth/me', { level_group: 'adult' });
    assert(up.status === 200 && up.body?.level_group === 'adult', '학령 상향 실패');
    const opened = await api('GET', '/board/puzzles');
    // ⚠️ **「성인은 전부 열린다」를 단정하지 않는다** — 2026-08-20에 거짓이 됐다.
    // 축이 10층이 되며 천장도 층 단위가 되어 성인 위에 밴드가 하나 더 있고(그
    // 위에도 못 여는 층이 남는다), 그래서 「전부」는 어떤 밴드에서도 참이 아닐 수
    // 있다. 무는 것은 **단조성**이다: 수준을 올리면 천장이 오르고, 방금 잠겨
    // 있던 칸이 열린다. 그것이 「여는 통로가 있다」의 실질이다.
    const adultCeiling = assertTailPartition(opened.body, '성인');
    assert(adultCeiling > mhCeiling,
      `수준을 올렸는데 천장이 안 올랐다 — 중·고등 ${mhCeiling} → 성인 ${adultCeiling}`);
    const hardNow = opened.body.find((p) => p.content_item_id === hard.content_item_id);
    assert(hardNow?.locked === false,
      `중·고등에서 잠겼던 ${tierOf(hard)}층 칸이 성인에서도 잠겼다 (천장 ${adultCeiling})`);
    // ⚠️ 여기서 **200을 단정하지 않는다**(2026-08-12 합성). 수준 잠금이 풀려도
    // 순차 잠금(MT-24)이 남아 있을 수 있다 — 어려움 퍼즐은 코스 뒤쪽이라 앞을
    // 안 풀었으면 BOARD_LOCKED다. 그건 결함이 아니라 **다른 축의 정상 동작**이고,
    // 여기서 200을 요구하면 두 지시 중 하나를 되돌리라는 뜻이 된다.
    // 이 시나리오가 무는 것은 **수준 축**이므로 "수준 때문에 막히지는 않는다"까지다.
    const nowOk = await api('GET', `/board/puzzles/${hard.content_item_id}`);
    assert(nowOk.body?.code !== 'PUZZLE_LOCKED',
      `성인인데 수준 잠금이 남았다 — ${nowOk.status} ${nowOk.body?.code}`);
    assert(nowOk.status === 200 || nowOk.body?.code === 'BOARD_LOCKED',
      `수준·순차 말고 다른 이유로 막혔다 — ${nowOk.status} ${nowOk.body?.code}`);

    // 초등은 천장이 더 낮다(밴드 셋 중 마지막 하나 — 방향이 반대인 쪽도 본다)
    await api('PATCH', '/auth/me', { level_group: 'elementary' });
    const elem = await api('GET', '/board/puzzles');
    const elemCeiling = assertTailPartition(elem.body, '초등');
    assert(elemCeiling < mhCeiling,
      `초등 천장이 중·고등보다 낮지 않다 — 초등 ${elemCeiling} vs 중·고등 ${mhCeiling}`);
    // 🔴 **`filter(...).every(...)`는 빈 배열에서 true다.** 종전 이 자리의 두
    // 단정이 `p.difficulty`(없어진 필드)로 걸러서, 필드가 사라진 뒤에도 **빈
    // 배열을 통과시키며 초록일 수 있었다**(이 저장소가 오늘 여러 번 잡은 형태:
    // 계약이 옳게 돌면서 아무것도 안 지킨다). 그래서 **센 다음에 단정한다** —
    // 「읽었다」를 확인하는 이 한 줄이 빠지면 아래 두 줄이 공집합을 통과한다.
    const aboveCeiling = elem.body.filter((p) => tierOf(p) > elemCeiling);
    const atOrBelow = elem.body.filter((p) => tierOf(p) != null && tierOf(p) <= elemCeiling);
    assert(aboveCeiling.length > 0 && atOrBelow.length > 0,
      `초등: 천장 위/아래 칸을 둘 다 읽어야 한다 — 위 ${aboveCeiling.length}건 · 아래 ${atOrBelow.length}건 (0이면 아래 두 단정이 공집합을 통과한다)`);
    assert(aboveCeiling.every((p) => p.locked), '초등인데 천장 위 층이 열려 있다');
    assert(atOrBelow.every((p) => !p.locked), '초등인데 천장 이하 층이 잠겼다');
   } finally {
    await api('PATCH', '/auth/me', { level_group: 'middle_high' });
   }
  });

  // ── #32b 난이도 배지는 교과 과정 표기다 — **지식 단계 10칸 판**(2026-08-20) ──
  //
  // 뜻을 새 축으로 다시 썼다(지우지 않았다). 종전 판이 무는 것은 셋이었고 그중
  // 둘은 **소유자가 옮겨 갔고 하나는 거짓이 됐다**:
  //   ⑴ 「상대 난이도 어휘로 안 돌아간다」 → 살아 있다. 다만 볼 곳이 board 리소스의
  //      difficulty1~3이 아니라 `ability.knowledgeLevel.name`이다(그 키 5개는
  //      2026-08-20에 삭제 — 소비처가 이 배지 하나뿐이었다).
  //   ⑵ 「배지 낱말 = 잠금 안내문 낱말」(한 몸 계약) → **버린다.** 배지는 이제
  //      지식 단계(1~10)를 말하고 `lockedBannerBody`는 학령 밴드를 말한다. 두
  //      문장이 다른 축이라 「같은 낱말」을 요구하면 옳은 상태를 빨강으로 만든다.
  //      ⚠️ 그 안내문은 지금 **거짓**이다(「성인은 전부 열려요」 ↔ 성인 위에 밴드가
  //      더 있고 그 위 층은 안 열린다). 배지 담당 소유 밖이라 여기서 고치지 않고
  //      **보고**했다 — 문구 소유자가 고치면 그때 계약도 이 자리에 붙인다.
  //   ⑶ 새로 문다: 지운 키가 되살아나지 않을 것 · 배지가 죽은 필드를 다시 읽지
  //      않을 것. 이 파일이 오늘 밟은 함정이 정확히 그것이다(없는 필드를 읽고도
  //      계약이 「돌기는」 했다).
  //
  // 낱말 자체를 단정하지 **않는다** — 이 파일이 2026-08-06에 「도전」을 단정했다가
  // 문구가 바뀌며 조용히 죽은 전례가 있다. 성질만 문다.
  await scenario('#32b: 배지 표기가 지식 단계 교과 과정 표기이고 죽은 축으로 되돌아가지 않았다', async () => {
    const RELATIVE_WORDS = {
      ko: ['쉬움', '보통', '어려움', '도전'],
      en: ['Easy', 'Normal', 'Hard'],
    };
    // 죽은 축의 라벨 — 배지가 다시 학령 3낱말로 되돌아가면 잡는다.
    const DEAD_BAND_LABELS = {
      ko: ['초등', '중·고등', '성인'],
      en: ['Elementary', 'Mid & high', 'Adult'],
    };
    for (const locale of ['ko', 'en']) {
      const res = (await vite.ssrLoadModule(`/src/i18n/resources/${locale}.js`)).default;
      const names = res.ability?.knowledgeLevel?.name;
      assert(names && Object.keys(names).length > 0,
        `${locale}: ability.knowledgeLevel.name이 없다 — 배지 명칭표의 소유자다`);
      const labels = Object.values(names);
      assert(labels.every((l) => typeof l === 'string' && l.trim()),
        `${locale}: 단계 표시명에 빈 값이 있다 (${labels.length}칸)`);
      for (const word of [...RELATIVE_WORDS[locale], ...DEAD_BAND_LABELS[locale]]) {
        assert(!labels.includes(word),
          `${locale}: 단계 표시명이 죽은 어휘 「${word}」로 되돌아갔다 — #32b는 교과 과정 표기다`);
      }
      // 지운 키가 되살아나지 않는다(두 번째 사본 = 두 배지가 갈리는 길).
      const boardPage = (await vite.ssrLoadModule(`/src/i18n/resources/board.${locale}.js`)).default.board.page;
      const revived = Object.keys(boardPage).filter((k) => k.startsWith('difficulty'));
      assert(revived.length === 0,
        `${locale}: 지운 배지 키가 되살아났다 — ${revived.join(', ')} (명칭표 소유자는 ability.knowledgeLevel.name 하나다)`);
    }
    // 배지가 **없어진 필드**를 다시 읽지 않는다. 소스 계약으로 무는 이유: 그
    // 필드를 읽으면 화면에서 배지가 **조용히 사라질** 뿐이라 문구 단정으로는
    // 「무엇이 없는지」가 안 잡힌다(2026-08-20에 실제로 그 상태였다).
    const src = await readFile(resolve(root, 'src/modules/board/BoardPage.jsx'), 'utf8');
    assert(!/puzzle\.difficulty\b/.test(src),
      'BoardPage가 puzzle.difficulty를 다시 읽는다 — 서버 응답에 없는 필드다(배지가 전 칸에서 사라진다)');
    assert(src.includes('KNOWLEDGE_LEVEL_NAME'),
      'BoardPage가 KNOWLEDGE_LEVEL_NAME을 안 읽는다 — 명칭표를 이 파일에서 지으면 세 화면이 갈린다');
  });

  // ── 🔴 역검증: 배지가 화면에 뜨는지 · 값이 없으면 미표시인지 ───────────────
  //
  // 위 시나리오는 **리소스와 소스**를 본다. 그것만으로는 「사전에 이름이 있다」와
  // 「화면에 그 이름이 뜬다」가 구분되지 않는다(이 파일이 오늘 밟은 함정: 계약이
  // 옳게 돌면서 아무것도 안 지킨다). 그래서 실제로 마운트해 DOM을 본다.
  //
  // 심어서 보는 이유는 `mountWithBoardList` 주석이 소유한다 — 요약하면 목 뱅크에
  // 단계 null인 board 문항이 없어 실호출로는 가드 갈래를 밟을 수 없다.
  await scenario('배지: 단계가 있으면 교과 표기가 뜨고, null이면 배지가 아예 없다', async () => {
    const { KNOWLEDGE_LEVEL_NAME } = await vite.ssrLoadModule('/src/lib/abilityDisplay.js');
    const LEVEL = 7;
    const expected = KNOWLEDGE_LEVEL_NAME[LEVEL];
    assert(typeof expected === 'string' && expected.trim(),
      `단계 ${LEVEL}의 표시명을 사전에서 못 읽었다 — 이 단정의 기준 자체가 거짓이 된다`);

    const puzzle = (id, level) => ({
      content_item_id: id,
      knowledge_level: level,
      template_json: { title: `단계표기-${id}`, mode: 'goal' },
      cleared: false,
      locked: false,
      unlocked: true,
    });
    const seeded = [puzzle('lv-known', LEVEL), puzzle('lv-null', null)];

    const r = mountWithBoardList(createElement(BoardPage), seeded);
    // 두 칸이 **다 떴는지** 먼저 본다 — 한 칸만 떠 있으면 아래 「배지 1개」가
    // 엉뚱한 이유로 통과한다.
    await waitFor(() => text().includes('단계표기-lv-known'), 6000, '심은 목록 렌더');
    assert(text().includes('단계표기-lv-null'),
      '단계 null 칸의 제목이 안 떴다 — 값이 없으면 카드째 사라지는 것은 회귀다(배지만 감춘다)');

    const badges = [...window.document.querySelectorAll('[data-knowledge-level]')];
    assert(badges.length === 1,
      `배지가 정확히 1개여야 한다(단계 있는 칸에만) — 실제 ${badges.length}개 [${badges.map((b) => b.getAttribute('data-knowledge-level')).join(',')}]`);
    assert(badges[0].getAttribute('data-knowledge-level') === String(LEVEL),
      `배지가 다른 단계를 가리킨다 — ${badges[0].getAttribute('data-knowledge-level')}`);
    assert(badges[0].textContent.includes(expected),
      `배지 문구에 교과 표기 「${expected}」가 없다 — 실제 「${badges[0].textContent}」`);
    // 읽어 주는 이름은 줄지 않는다(compact든 아니든 전체 문구).
    assert((badges[0].getAttribute('aria-label') ?? '').includes(expected),
      `배지 aria-label이 단계 이름을 안 읽어 준다 — 「${badges[0].getAttribute('aria-label')}」`);
    r.unmount();
  });

  // ── 503 BOARD_RULES_UNAVAILABLE은 내부 진단 문자열을 화면에 흘리지 않는다 ──
  // 2026-08-19 실사고: 도커 백엔드 이미지가 낡아(코드는 이미지 COPY · 시드는
  // 바인드 마운트라 **따로 낡는다**) 새 규칙 파일을 옛 PHENOMENA로 검증했고,
  // 세션 화면의 「AI 피드백」 자리에
  //   rules[0](tropical_cyclone_genesis): phenomenon 'typhoon' enum 밖
  // 이 그대로 떴다. 그 503은 `main.py`의 board_rules_handler가 detail에 예외
  // 문자열을 담아 내려보내는데, 두 제출 경로가 err.detail을 우선 쓰고 있었다.
  //
  // 소스 계약으로 무는 이유: 이 분기는 규칙 파일이 깨져야만 도는 경로라
  // 실마운트로 재현하려면 서버 데이터를 일부러 망가뜨려야 한다. 대신 **두
  // 경로가 같은 키를 쓰는지**를 본다 — 한쪽만 고치는 것이 이 결함의 재발 꼴이다.
  await scenario('보드 503(BOARD_RULES_UNAVAILABLE)이 두 제출 경로에서 사람 말로 나온다', async () => {
    const KEY = 'board.page.rulesUnavailable';
    // ⑴ 문구가 ko·en 양쪽에 있고, 진단 어휘를 흉내내지 않는다.
    for (const locale of ['ko', 'en']) {
      const res = (await vite.ssrLoadModule(`/src/i18n/resources/board.${locale}.js`)).default;
      const msg = res.board?.page?.rulesUnavailable;
      assert(typeof msg === 'string' && msg.trim(), `${locale}: ${KEY} 누락`);
      assert(!/rules\[|enum|phenomenon/i.test(msg),
        `${locale}: ${KEY}가 내부 진단 어휘를 담았다 — 학습자에게 규칙 배열이 보이면 안 된다`);
    }
    // ⑵ 두 제출 경로 모두 이 코드에서 err.detail이 아니라 위 키를 쓴다.
    for (const rel of ['src/modules/board/BoardPage.jsx', 'src/modules/session/SessionRunner.jsx']) {
      const src = await readFile(resolve(root, rel), 'utf8');
      assert(src.includes("'BOARD_RULES_UNAVAILABLE'"),
        `${rel}: BOARD_RULES_UNAVAILABLE 분기가 없다 — 503 detail이 그대로 화면에 나간다`);
      assert(src.includes(`t('${KEY}')`),
        `${rel}: 503 분기가 ${KEY}를 쓰지 않는다 (두 화면이 같은 503을 다른 말로 설명하면 안 된다)`);
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

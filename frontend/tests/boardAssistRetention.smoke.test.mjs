/**
 * 보드 풀이 보조 · 이탈 인텐트 · 콤보 · 마감 실마운트 스모크 (R10-01 §3.5 / S5) —
 *   node tests/boardAssistRetention.smoke.test.mjs
 *
 * **이 가드가 존재하는 이유**
 * S5는 전부 "프론트 표시·조작 계층"이라 서버 계약 테스트가 잡아주지 않는다.
 * 특히 두 성질은 조용히 깨지고, 깨진 상태가 미구현보다 나쁘다 —
 *   ① 힌트가 **정답 배치를 노출**하면 퍼즐이 퀴즈가 된다(기존 문항 저작 `hints`가
 *      실제로 "존 1에 한랭전선을 놓고 습기 60 이상"까지 알려주고 있었다).
 *   ② 언두가 서버를 건드리면 **구름을 소모**한다(에너지 정책의 전제가 무너진다).
 * 그래서 여기서는 렌더 존재가 아니라 **문구에 정답 요소가 없음**과 **요청이 나가지
 * 않음**을 실제 XHR 관측으로 고정한다.
 *
 * 관례는 boardEntryGate.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite middlewareMode + mock/apiMockPlugin(실 XHR) + jsdom 실마운트(createRoot,
 * useEffect 실행). 목 상태 조작은 기존 dev 경로(/dev/clouds)만 쓴다.
 *
 * 검증
 *   1. 언두가 배치를 되돌리고 **서버 요청 0 · 구름 잔량 불변**(스택 상한 20 포함)
 *   2. 점진적 힌트 2단이 **정답 배치를 노출하지 않는다**
 *      (1단=존 지목만, 2단=요소 종류까지. 문항 저작 hints의 정답 문구 미사용)
 *   3. board_rules.json `hint_needs` 8/8 저작 + 정답 요소명·임계 수치 미포함(데이터 계약)
 *   4. 보드 제출 성공(판정 확정) 후 "판정 중..." 잔존 없음(§3.5 마감 2)
 *   5. match 짝 성립 시 목록 순서·자리 불변 + 해제 안내(§3.5 마감 1)
 *   6. 콤보 4단 칭찬 전이(정답이에요→좋아요→훌륭해요→완벽해요, 상한 유지)
 *   7. 이탈 인텐트: 내부 링크 클릭 차단 → 확인 1단, 포커스 트랩·Esc(접근성)
 *   8. 세션 완료 화면 문항 수 카피가 실제 배합(total)과 동기화(§3.5 마감 4)
 *   9. 약점 보너스 XP 분리 표기가 **서버 실측 분해값**(xp_base·xp_weak_bonus)만
 *      쓴다(§3.5 마감 3) — 프론트 역산(xp_earned − 상수 사본) 회귀 가드.
 *      목이 약점 개념 정답에 배율을 적용해 보너스 줄이 실제로 렌더되는 것까지 고정.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) {
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
// 보드 비주얼(강수 Canvas·WebGL)은 전부 컨텍스트 null 가드가 있다 — 이 가드는
// 비주얼이 아니라 조작·문구를 본다.
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

const AtmosphereBoard = (await vite.ssrLoadModule('/src/modules/board/AtmosphereBoard.jsx')).default;
const QuestionCard = (await vite.ssrLoadModule('/src/modules/quiz/QuestionCard.jsx')).default;
const SessionSummary = (await vite.ssrLoadModule('/src/modules/session/SessionSummary.jsx')).default;
const SessionPage = (await vite.ssrLoadModule('/src/modules/session/SessionPage.jsx')).default;
const { comboPraise, COMBO_PRAISE } = await vite.ssrLoadModule('/src/modules/session/SessionRunner.jsx');
const ResultBanner = (await vite.ssrLoadModule('/src/modules/quiz/ResultBanner.jsx')).default;
const { AIR_MASS_META, FRONT_META } = await vite.ssrLoadModule('/src/modules/board/boardDisplay.js');
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
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
const key = (el, k, opts = {}) =>
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
/** React 제어 input에 값 주입 (네이티브 setter + input 이벤트) */
const setInput = (el, value) => {
  const proto = el.type === 'range' || el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};

useAuthStore.getState().setTokens({ accessToken: 't-assist', refreshToken: 'r-assist' });
useAuthStore.getState().setUser({ user_id: 'assist-user', email: 'assist@test.dev', nickname: '스모크' });

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

// 규칙 파일(프론트·서버 공유 단일 진실원) — 힌트 저작 필드 데이터 계약 대조용
const RULES = JSON.parse(readFileSync(resolve(root, '../database/seed/board_rules.json'), 'utf-8'));
// 정답 요소명 전수(기단 4 + 전선 3) — 힌트 문구에 하나라도 있으면 정답 노출이다
const ANSWER_LABELS = [
  ...Object.values(AIR_MASS_META).map((m) => m.label),
  ...Object.values(FRONT_META).map((m) => m.label),
];

/** 힌트 검증용 퍼즐 — 문항 저작 hints에는 "정답 그대로" 문구를 넣어 미사용을 확인한다 */
const PUZZLE = {
  question_text: '수도권에 소나기를 내려 보세요.',
  mode: 'goal_only',
  palette: ['front:cold', 'moisture'],
  goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
  initial_state: { elements: [] },
  hints: [
    '수도권(존 1)에 한랭전선을 놓으세요.',
    '한랭전선을 놓고 습기를 60 이상으로 올리면 소나기가 내려요.',
  ],
};

const zoneCard = (zone) => window.document.querySelector(`[data-board-zone="${zone}"]`);
const cloudsNow = async () => (await api('GET', '/progress/energy')).body?.clouds;

/**
 * 보드를 마운트하고 **초기화 effect가 끝난 뒤** 반환한다.
 * AtmosphereBoard는 마운트 effect에서 board·history·selected를 초기화하므로
 * (문항 전환 리셋), DOM이 커밋된 직후 조작하면 그 리셋에 조작이 덮여 사라진다.
 * 규칙 로드(비동기 쿼리) 완료까지 기다리면 effect 플러시도 함께 보장된다.
 */
async function mountBoard(props) {
  mount(createElement(AtmosphereBoard, { puzzle: PUZZLE, onSubmit: () => {}, ...props }));
  await waitFor(() => findButton('힌트 보기') != null, 6000, '보드 초기 렌더');
  await sleep(200);
}

/**
 * 팔레트에서 요소를 골라 존에 탭 배치. 두 클릭 사이에 **리렌더를 기다린다** —
 * 같은 turn에서 연달아 클릭하면 존 클릭 핸들러가 이전 렌더의 selected(null)를
 * 읽어 배치가 일어나지 않는다(실사용에서는 사람 손이 이 간격을 만든다).
 */
async function selectPalette(label) {
  const chip = buttons().find((b) => (b.textContent ?? '').includes(label));
  assert(chip, `팔레트 항목 "${label}"을 찾지 못했다`);
  // 이미 선택된 칩을 다시 누르면 선택이 해제된다 — 선택 상태(강조 클래스)를 본다
  if (!chip.className.includes('bg-sky-600')) {
    click(chip);
    await sleep(40);
  }
  return chip;
}

async function placeOnZone(label, zone) {
  await selectPalette(label);
  const card = zoneCard(zone);
  assert(card, `존 ${zone} 카드를 찾지 못했다`);
  click(card);
  await sleep(30);
}

try {
  // ── 1. 언두 — 배치 되돌림 · 서버 요청 0 · 구름 불변 · 스택 상한 ─────────────
  await scenario('언두: 배치를 되돌리고 서버 요청 0 · 구름 무소모 (스택 상한 20)', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const cloudsBefore = await cloudsNow();
    assert(cloudsBefore === 5, `구름 초기화 실패: ${cloudsBefore}`);

    await mountBoard();
    assert(findButton('되돌리기') != null, '되돌리기 버튼이 없다');
    assert(findButton('되돌리기').disabled, '히스토리가 비었는데 되돌리기가 활성 상태다');

    const mark = xhrLog.length;
    await placeOnZone('한랭전선', 1);
    await waitFor(() => window.document.querySelector('[aria-label="한랭전선 제거"]') != null, 4000,
      '배치 칩 렌더');
    assert((findButton('되돌리기').textContent ?? '').includes('(1)'), '히스토리 1칸이 안 잡혔다');

    click(findButton('되돌리기'));
    await waitFor(() => window.document.querySelector('[aria-label="한랭전선 제거"]') == null, 4000,
      '언두가 배치를 되돌리지 못했다');
    assert(findButton('되돌리기').disabled, '언두 후 스택이 비었는데 버튼이 활성이다');

    // 순수 클라이언트 계약: 언두 구간에서 어떤 요청도 나가지 않았다(구름 소모 불가)
    const during = xhrLog.slice(mark);
    assert(during.length === 0, `언두·배치가 서버를 호출했다: ${during.join(', ')}`);
    assert((await cloudsNow()) === cloudsBefore, '언두 후 구름 잔량이 변했다(무소모 계약 위반)');

    // 스택 상한: 배치·제거를 24회 반복해도 20칸을 넘지 않는다.
    // 팔레트 선택은 배치 후에도 유지되므로 여기서는 존 카드/제거만 번갈아 누른다
    // (팔레트를 다시 누르면 선택이 해제된다).
    await selectPalette('한랭전선');
    for (let i = 0; i < 12; i += 1) {
      click(zoneCard(1));
      await sleep(20);
      const remove = window.document.querySelector('[aria-label="한랭전선 제거"]');
      assert(remove, `${i}회차 배치 칩이 없다`);
      click(remove);
      await sleep(20);
      assert(window.document.querySelector('[aria-label="한랭전선 제거"]') == null,
        `${i}회차 제거가 즉시 되돌려졌다(제거 클릭이 존 재배치로 버블링)`);
    }
    await waitFor(() => (findButton('되돌리기').textContent ?? '').includes('(20)'), 4000,
      `히스토리 상한 20 — 실제 "${findButton('되돌리기').textContent?.trim()}"`);
  });

  // ── 2. 점진적 힌트 2단이 정답 배치를 노출하지 않는다 ────────────────────────
  await scenario('힌트 2단: 1단=존 지목 / 2단=요소 종류 — 정답 요소·임계 수치 미노출', async () => {
    await mountBoard();
    assert((findButton('힌트 보기').textContent ?? '').includes('(0/2)'), '힌트 카운터가 0/2가 아니다');

    // 1단 — 존만 지목. 요소 정보 없음.
    click(findButton('힌트 보기'));
    await waitFor(() => text().includes('힌트 1:'), 4000, '1단 힌트 렌더');
    const hint1 = text().slice(text().indexOf('힌트 1:'), text().indexOf('힌트 1:') + 200);
    assert(/수도권|영서|서해|동해/.test(hint1), `1단이 목표 지역을 지목하지 않는다: ${hint1}`);
    for (const label of ANSWER_LABELS) {
      assert(!hint1.includes(label), `1단 힌트가 정답 요소 "${label}"를 노출했다`);
    }
    assert(text().includes('여기부터'), '1단에서 목표 존 하이라이트 배지가 없다');
    assert((findButton('힌트 보기').textContent ?? '').includes('(1/2)'), '카운터가 1/2로 오르지 않았다');

    // 2단 — 요소 "종류"까지. subtype(정답 요소)·임계 수치는 여전히 없음.
    click(findButton('힌트 보기'));
    await waitFor(() => text().includes('힌트 2:'), 4000, '2단 힌트 렌더');
    const hint2 = text().slice(text().indexOf('힌트 2:'));
    assert(hint2.includes('전선 계열'), `2단이 요소 종류를 알려주지 않는다: ${hint2.slice(0, 160)}`);
    assert(hint2.includes('필요한 요소 종류'), '요소 종류 칩이 없다');
    for (const label of ANSWER_LABELS) {
      assert(!hint2.includes(label), `2단 힌트가 정답 요소 "${label}"를 노출했다`);
    }
    assert(!/\d/.test(hint2.replace('힌트 2:', '')), `2단 힌트에 임계 수치가 노출됐다: ${hint2.slice(0, 160)}`);
    assert(findButton('힌트 보기') == null, '2단까지 공개했는데 힌트 CTA가 남아 있다');

    // 문항 저작 hints(정답 그대로 알려주는 기존 문구)는 이 경로에서 쓰이지 않는다
    assert(!text().includes('한랭전선을 놓고'), '문항 저작 hints의 정답 노출 문구가 렌더됐다');
    assert(!text().includes('습기를 60 이상'), '문항 저작 hints의 임계 수치가 렌더됐다');
  });

  // ── 3. hint_needs 데이터 계약 (8종 전부 · 정답 요소·수치 미포함) ────────────
  await scenario('board_rules.json: hint_needs 8/8 저작 + 정답 요소·임계 수치 미포함', async () => {
    assert(RULES.length === 8, `규칙 8종이 아니다: ${RULES.length}`);
    for (const rule of RULES) {
      const needs = rule.hint_needs;
      assert(typeof needs === 'string' && needs.trim().length > 0,
        `${rule.id}: hint_needs 누락(§3.5 데이터 저작 8종 전부)`);
      assert(needs !== rule.explain, `${rule.id}: hint_needs가 explain 복사본이다(별도 저작 계약)`);
      for (const label of ANSWER_LABELS) {
        assert(!needs.includes(label), `${rule.id}: hint_needs가 정답 요소 "${label}"를 노출했다`);
      }
      assert(!/\d/.test(needs), `${rule.id}: hint_needs에 임계 수치가 들어 있다`);
      // when의 subtype 원문(cold·siberian 등)도 새면 안 된다
      for (const cond of rule.when) {
        const m = /^(air_mass|front):([a-z_]+)$/.exec(cond);
        if (m) assert(!needs.includes(m[2]), `${rule.id}: hint_needs에 subtype 원문 "${m[2]}"이 있다`);
      }
    }
  });

  // ── 4. 판정 확정 후 "판정 중..." 잔존 없음 (§3.5 마감 2) ────────────────────
  await scenario('보드: 판정 확정(phenomena 도착) 후 "판정 중..." 잔존 없음', async () => {
    // 제출 왕복 중 — 판정 중 표기가 맞다
    mount(createElement(AtmosphereBoard, {
      puzzle: PUZZLE, onSubmit: () => {}, disabled: true, submitting: true, phenomena: null,
    }));
    await waitFor(() => text().includes('판정 중'), 5000, '제출 왕복 중 판정 중 표기');

    // 서버 판정 도착(세션 경로는 result 없이 phenomena만 온다) — 표기가 사라져야 한다
    const phenomena = [0, 1, 2, 3].map((z) => ({
      zone: z, zone_name: ['서해', '수도권', '태백산맥', '동해안'][z],
      phenomenon: z === 1 ? 'shower' : 'cloudy', cloud: z === 1 ? 'cumulonimbus' : 'cumulus',
      rule_id: z === 1 ? 'cold_front_shower' : null, explain: null,
    }));
    mount(createElement(AtmosphereBoard, {
      puzzle: PUZZLE, onSubmit: () => {}, disabled: true, submitting: true, phenomena,
    }));
    await sleep(250);
    assert(!text().includes('판정 중'), '판정 확정 후에도 "판정 중..." 버튼이 남았다(§3.5 마감 2 회귀)');
    assert(!text().includes('제출하기'), '판정 확정 후 제출 버튼이 남았다(재제출 유도)');
  });

  // ── 5. match 짝 성립 시 목록 순서·자리 불변 (§3.5 마감 1) ───────────────────
  await scenario('match: 짝 성립 후에도 목록 순서·행 높이 불변 + 해제 안내', async () => {
    const question = {
      quiz_id: 'match-smoke-1',
      concept_tag: 'air_mass',
      question_type: 'match',
      question_text: '기단과 성질을 연결하세요.',
      pairs: [
        { left: '시베리아', right: '한랭 건조' },
        { left: '북태평양', right: '고온 다습' },
        { left: '양쯔강', right: '온난 건조' },
        { left: '오호츠크해', right: '한랭 다습' },
      ],
    };
    mount(createElement(QuestionCard, { question, disabled: false, onSubmit: () => {} }));
    await waitFor(() => window.document.querySelectorAll('[data-match-left]').length === 4, 5000,
      'match 좌측 4행 렌더');

    const leftOrder = () => [...window.document.querySelectorAll('[data-match-left]')]
      .map((b) => b.getAttribute('data-match-left'));
    const rightOrder = () => [...window.document.querySelectorAll('[data-match-right]')]
      .map((b) => b.getAttribute('data-match-right'));
    const rowClasses = () => [...window.document.querySelectorAll('[data-match-left],[data-match-right]')]
      .map((b) => b.className);

    const beforeLeft = leftOrder();
    const beforeRight = rightOrder();
    const beforeRows = rowClasses();
    assert(text().includes('다시 누르면 해제'), '해제 방법 안내가 없다(관찰 §1-3 "해제 방법 미안내")');

    // 첫 짝 성립
    click(window.document.querySelector('[data-match-left="시베리아"]'));
    await sleep(60);
    click(window.document.querySelector('[data-match-right="한랭 건조"]'));
    await waitFor(() => text().includes('→ 한랭 건조'), 4000, '연결 표시');

    assert(JSON.stringify(leftOrder()) === JSON.stringify(beforeLeft),
      `짝 성립 후 좌측 순서가 바뀌었다: ${beforeLeft} → ${leftOrder()}`);
    assert(JSON.stringify(rightOrder()) === JSON.stringify(beforeRight),
      `짝 성립 후 우측 순서가 바뀌었다: ${beforeRight} → ${rightOrder()}`);
    // 자리 고정: 행의 높이 클래스가 그대로여야 한다(연결 줄 추가로 아래 항목이 밀리는 회귀)
    assert(rowClasses().every((c, i) => sameHeightClass(c, beforeRows[i])),
      'match 행의 고정 높이 클래스가 짝 성립으로 바뀌었다(자리 밀림 회귀)');

    // 해제: 연결된 좌측을 다시 누르면 풀린다 — 자리·순서는 여전히 불변
    click(window.document.querySelector('[data-match-left="시베리아"]'));
    await waitFor(() => !text().includes('→ 한랭 건조'), 4000, '짝 해제');
    assert(JSON.stringify(leftOrder()) === JSON.stringify(beforeLeft), '해제 후 좌측 순서가 바뀌었다');
    assert(JSON.stringify(rightOrder()) === JSON.stringify(beforeRight), '해제 후 우측 순서가 바뀌었다');
  });

  // ── 6. 콤보 4단 칭찬 전이 ──────────────────────────────────────────────────
  await scenario('콤보: 칭찬 4단 전이(정답이에요→좋아요→훌륭해요→완벽해요) + 상한 유지', async () => {
    assert(JSON.stringify(COMBO_PRAISE) === JSON.stringify(['정답이에요', '좋아요', '훌륭해요', '완벽해요']),
      `칭찬 4단 문구 계약이 바뀌었다: ${COMBO_PRAISE}`);
    assert(comboPraise(0) === null && comboPraise(-1) === null, '콤보 0·음수에 칭찬이 붙었다');
    assert(comboPraise(1) === '정답이에요', '1단 문구 불일치');
    assert(comboPraise(2) === '좋아요', '2단 문구 불일치');
    assert(comboPraise(3) === '훌륭해요', '3단 문구 불일치');
    assert(comboPraise(4) === '완벽해요', '4단 문구 불일치');
    assert(comboPraise(9) === '완벽해요', '4단을 넘어 문구가 사라졌다(상한 미유지)');
  });

  // ── 7. 콤보 실제 렌더(진행바 위) — 목 세션 1문항 정답 ───────────────────────
  await scenario('콤보 렌더: 연속 정답 1→2에서 카운터·칭찬이 함께 오른다', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    mount(createElement(SessionPage), '/daily');
    await waitFor(() => text().includes('한랭 전선') && findButton('한랭 전선') != null, 8000,
      '목 세션 1번 문항(객관식) 렌더');
    click(findButton('한랭 전선'));
    await waitFor(() => text().includes('연속 정답 1'), 8000, '콤보 카운터 렌더');
    assert(text().includes('정답이에요'), '콤보 1단 칭찬이 없다');

    // 두 문항 연속 정답 → 카운터와 칭찬이 함께 오른다(에스컬레이션 실동작)
    click(findButton('다음 문항'));
    await waitFor(() => window.document.querySelector('input[type="text"]') != null, 6000,
      '2번 문항(단답) 렌더');
    const input = window.document.querySelector('input[type="text"]');
    setInput(input, '북태평양 기단');
    await sleep(50);
    input.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => text().includes('연속 정답 2'), 8000, '콤보 2단 카운터');
    assert(text().includes('좋아요'), '콤보 2단 칭찬(좋아요)이 없다');
  });

  // ── 8. 이탈 인텐트: 링크 차단 → 확인 1단 · 포커스 트랩 · Esc ────────────────
  await scenario('이탈 인텐트: 내부 링크 이탈 차단 + 확인 1단 + 포커스 트랩 + Esc', async () => {
    mount(createElement(SessionPage), '/daily');
    await waitFor(() => text().includes('문항') && buttons().length > 0, 8000, '세션 진행 화면');

    // 탭바처럼 앱 내 다른 경로로 가는 링크(캡처 단계에서 가로채야 한다)
    const link = window.document.createElement('a');
    link.setAttribute('href', '/board');
    link.textContent = '보드로';
    window.document.body.appendChild(link);
    try {
      const evt = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(evt);
      assert(evt.defaultPrevented, '내부 링크 이탈이 가로채지지 않았다(확인 없이 진도 이탈)');
      await waitFor(() => text().includes('지금 나가면 오늘 진도가 사라져요'), 4000, '확인 1단 렌더');

      const dialog = window.document.querySelector('[role="dialog"]');
      assert(dialog, 'role=dialog가 없다(접근성 계약)');
      assert(dialog.getAttribute('aria-modal') === 'true', 'aria-modal=true가 없다');
      const stayBtn = findButton('계속 풀기');
      const leaveBtn = findButton('그만두기');
      assert(stayBtn && leaveBtn, '주 CTA(계속 풀기)·종료 링크(그만두기)가 모두 있어야 한다');
      assert(window.document.activeElement === stayBtn, '진입 포커스가 주 CTA에 없다');

      // 포커스 트랩: 마지막 요소에서 Tab → 첫 요소로, 첫 요소에서 Shift+Tab → 마지막으로
      leaveBtn.focus();
      key(leaveBtn, 'Tab');
      assert(window.document.activeElement === stayBtn,
        '마지막 포커스에서 Tab이 모달 밖으로 나갔다(포커스 트랩 부재)');
      key(stayBtn, 'Tab', { shiftKey: true });
      assert(window.document.activeElement === leaveBtn,
        '첫 포커스에서 Shift+Tab이 모달 밖으로 나갔다(포커스 트랩 부재)');

      // Esc = 계속 풀기 (닫히고 세션은 그대로)
      key(window.document.activeElement, 'Escape');
      await waitFor(() => !text().includes('지금 나가면 오늘 진도가 사라져요'), 4000, 'Esc로 모달 닫힘');
      assert(text().includes('문항'), 'Esc가 세션 화면을 잃었다');
    } finally {
      link.remove();
    }
  });

  // ── 9. 세션 완료 화면 문항 수 = 실제 배합 (§3.5 마감 4) ─────────────────────
  await scenario('세션 완료 화면: 문항 수 카피가 실제 배합(total)과 동기화', async () => {
    mount(createElement(SessionSummary, {
      summary: { xp_total: 45, correct_count: 8, total: 9, streak_count: 3 },
    }), '/daily');
    await waitFor(() => text().includes('오늘의 세션 완료'), 4000, '완료 화면 렌더');
    assert(text().includes('9문항'), `실제 배합(9문항)이 카피에 반영되지 않았다: ${text().slice(-200)}`);
    assert(!text().includes('5문항'), '고정 "5문항" 카피가 남아 있다(관찰 §1-4 회귀)');
  });

  // ── 10. 약점 보너스 XP 분리 표기 = 서버 실측 분해값 (§3.5 마감 3) ───────────
  // 이전 구현은 프론트가 `xp_earned − 기본지급액(백엔드 상수 사본)`으로 역산했고,
  // 목이 항상 15를 줘서 보너스 줄이 **한 번도 렌더되지 않았다**(검증 불가 기능).
  // 여기서는 목 실측 응답(xp_base·xp_weak_bonus)을 그대로 배너에 먹여 고정한다.
  await scenario('약점 보너스: 목 실측 분해(15+7=22)가 "+15 XP · 약점 극복 +7"로 렌더', async () => {
    await api('POST', '/dev/clouds', { clouds: 5 });
    const today = await api('GET', '/session/today');
    assert(today.status === 200, `세션 조회 실패 (${today.status})`);
    const sid = today.body.session_id;
    const pick = (tag) => today.body.items.find((it) => it.concept_tag === tag);

    // (a) 약점 개념(typhoon — 목 WEAK_TAGS) 정답 → base 15 + 보너스 7 = 22
    const weakItem = pick('typhoon');
    assert(weakItem, '목 세션에 약점 개념(typhoon) 문항이 없다');
    const weak = await api('POST', `/session/${sid}/answer`, {
      quiz_id: weakItem.quiz_id, answer: '오른쪽(동쪽) 반원', elapsed_sec: 4,
    });
    assert(weak.status === 200 && weak.body.is_correct === true,
      `약점 문항 정답 제출 실패 (${weak.status}, is_correct=${weak.body?.is_correct})`);
    assert(weak.body.xp_base === 15 && weak.body.xp_weak_bonus === 7 && weak.body.xp_earned === 22,
      `약점 정답 분해값 불일치 — base=${weak.body.xp_base} bonus=${weak.body.xp_weak_bonus} earned=${weak.body.xp_earned} (서버 계약: 15+7=22)`);
    assert(weak.body.xp_base + weak.body.xp_weak_bonus === weak.body.xp_earned,
      '합 계약(xp_base + xp_weak_bonus === xp_earned) 위반');
    mount(createElement(ResultBanner, { result: weak.body }), '/daily');
    await waitFor(() => text().includes('약점 극복 +7'), 4000, '약점 보너스 분리 표기');
    assert(text().includes('+15 XP'), `기본 지급액 표기가 없다: ${text()}`);
    assert(!text().includes('+22 XP'), '보너스가 있는데 합계만 표기됐다(분리 표기 아님)');

    // (b) 비약점 개념(heat_island) 정답 → 보너스 0 → 보너스 줄 없음
    const plainItem = pick('heat_island');
    assert(plainItem, '목 세션에 비약점 개념(heat_island) 문항이 없다');
    const plain = await api('POST', `/session/${sid}/answer`, {
      quiz_id: plainItem.quiz_id, answer: '도시 상공의 오존층이 두꺼워져서', elapsed_sec: 4,
    });
    assert(plain.status === 200 && plain.body.is_correct === true,
      `비약점 문항 정답 제출 실패 (${plain.status}, is_correct=${plain.body?.is_correct})`);
    assert(plain.body.xp_base === 15 && plain.body.xp_weak_bonus === 0 && plain.body.xp_earned === 15,
      `비약점 정답 분해값 불일치 — base=${plain.body.xp_base} bonus=${plain.body.xp_weak_bonus} earned=${plain.body.xp_earned} (기존 목 동작 15 유지)`);
    mount(createElement(ResultBanner, { result: plain.body }), '/daily');
    await waitFor(() => text().includes('+15 XP'), 4000, '기본 XP 표기');
    assert(!text().includes('약점 극복'), '보너스 0인데 보너스 줄이 렌더됐다');

    // (c) 분해 필드 부재(구 백엔드) → 추정 금지: 합계만 표기, 보너스 줄 없음
    mount(createElement(ResultBanner, {
      result: { is_correct: true, correct_answer: 'A', xp_earned: 22 },
    }), '/daily');
    await waitFor(() => text().includes('+22 XP'), 4000, '분해 필드 부재 시 합계 표기');
    assert(!text().includes('약점 극복'),
      '분해 필드가 없는 응답에서 보너스를 추정해 표기했다(역산 회귀)');
  });
} finally {
  await vite.close();
  httpServer.close();
}

/** 행 높이 고정 클래스(min-h-*)가 동일한지 — 자리 밀림 회귀 감지 */
function sameHeightClass(a, b) {
  const h = (c) => (String(c).match(/min-h-\[[^\]]+\]/g) ?? []).join(' ');
  return h(a) === h(b) && h(a).length > 0;
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 보드 풀이 보조(언두·정답 미노출 힌트) + 이탈 인텐트 + 콤보 + 마감 스모크 통과');
process.exit(0);

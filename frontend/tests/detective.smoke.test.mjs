/**
 * 기후 탐정 스모크 (R13, 대장 CO-N-2) —
 *   node tests/detective.smoke.test.mjs
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트. 로케일은 ko 고정(한국어 단정).
 *
 * 여기서 지키는 것
 *   ① **진입이 있다** — /explore 카드에서 /detective로 갈 수 있다. 라우트만
 *      만들고 진입을 안 붙이면 URL을 손으로 쳐야 닿는 화면이 된다(CO-N-1 ②가
 *      /explore에서 실제로 그랬다).
 *   ② **조사가 먼저다** — 단서를 min_clues 미만으로 연 상태에서는 제출 버튼이
 *      잠긴다. 이게 없으면 「기후 탐정」은 객관식 한 문제로 붕괴한다(배점 ②
 *      "단순 퀴즈·정답 맞히기를 넘어").
 *   ③ **정답이 화면에 미리 와 있지 않다** — 상세 응답 시점의 DOM 어디에도
 *      해설·피드백 문구가 없다. 서버 계약(test_detective_router)의 프론트측 짝.
 *   ④ **정오 판정이 announce된다**(CO-S-A1) — 판정 문구가
 *      role=status·aria-live 영역 **안에** 들어간다. 화면에 보이기만 하고
 *      라이브 영역 밖에 있으면 스크린리더 사용자에게는 아무 일도 안 일어난다.
 *   ⑤ 오답은 다시 추리할 수 있고, 그때 해설은 나오지 않는다.
 *   ⑥ 케이스 0건이면 빈 상태 안내와 나갈 문이 보인다(CO-S-3 부류 방지).
 *
 * jsdom에는 레이아웃 엔진이 없어 recharts ResponsiveContainer는 크기 0으로
 * 접힌다 — 차트는 SVG 내부가 아니라 **figure/aria-label이 계열 단위만큼
 * 그려졌는가**까지만 본다(단위가 다른 계열을 한 차트에 겹치지 않는다는 계약).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = JSON.parse(
  readFileSync(resolve(root, '../database/seed/detective_cases.json'), 'utf-8'),
).filter((c) => (c.status ?? 'active') === 'active');

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

const httpServer = http.createServer((req, res) => {
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ detail: 'not found', code: 'NOT_FOUND' }));
  });
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${httpServer.address().port}`;

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
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'SVGElement']) {
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

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
const { useAuthStore } = await vite.ssrLoadModule('/src/store/authStore.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 10000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

useAuthStore.getState().setTokens({ accessToken: 't-det', refreshToken: 'r-det' });
useAuthStore.getState().setUser({ user_id: 'det-smoke', email: 'det@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';
// act()는 production 빌드에서 못 쓴다(다른 스모크와 같은 관례) — 이벤트를 쏘고
// 마이크로태스크·리렌더가 끝날 만큼만 기다린다.
const click = async (el) => {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  await sleep(30);
};

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

const CASE = CASES[0];
const ANSWER = CASE.solution.answer_hypothesis_id;
const WRONG = CASE.hypotheses.find((h) => h.verdict === 'incorrect');

function mount(entry) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [entry] }, createElement(App))),
  );
  return reactRoot;
}

// ═══ ① 탐구 홈에 진입 카드가 있다 ══════════════════════════════════════════
let reactRoot = mount('/explore');
await waitFor(() => text().includes('기후 탐정'), 10000, '탐구 홈 탐정 카드');
const entryLink = $$('a').find((a) => a.getAttribute('href') === '/detective');
ok(Boolean(entryLink), '탐구 홈(/explore)에 /detective 진입 카드가 있다');
ok(
  entryLink?.textContent.includes('가상 관측 자료'),
  `탐정 카드는 시뮬 배지가 아니라 가상 자료 고지를 단다 — "${entryLink?.textContent.slice(-30) ?? ''}"`,
);
reactRoot.unmount();

// ═══ 사건 목록 ═════════════════════════════════════════════════════════════
reactRoot = mount('/detective');
await waitFor(() => text().includes(CASE.title), 10000, '사건 목록 렌더');
ok(text().includes(CASE.intro.headline), '목록 카드에 사건 헤드라인이 보인다');
ok(
  $$('a').some((a) => a.getAttribute('href') === `/detective/${CASE.case_id}`),
  '목록에서 사건 상세로 가는 링크가 있다',
);
ok(!text().includes(CASE.solution.explanation.slice(0, 30)), '목록에 해설이 새지 않는다');
reactRoot.unmount();

// ═══ 사건 플레이 ═══════════════════════════════════════════════════════════
reactRoot = mount(`/detective/${CASE.case_id}`);
await waitFor(() => text().includes(CASE.intro.headline), 10000, '사건 상세 렌더');

// ③ 정답이 미리 와 있지 않다 — 해설·피드백 문구가 DOM에 없다
const bodyBefore = text();
ok(!bodyBefore.includes(CASE.solution.explanation.slice(0, 30)), '제출 전 DOM에 해설이 없다');
ok(
  CASE.hypotheses.every((h) => !bodyBefore.includes(h.feedback.slice(0, 30))),
  '제출 전 DOM에 가설 피드백이 없다',
);
ok(bodyBefore.includes(CASE.intro.data_note.slice(0, 20)), '가상 자료 고지가 화면에 있다');

// 차트: 단위 묶음 수만큼 figure가 있다(이중 축 금지 — 단위가 다르면 차트를 가른다)
const unitCount = new Set(CASE.series.map((s) => s.unit)).size;
ok(
  $$('figure').length === unitCount,
  `차트가 단위 묶음 수(${unitCount})만큼 그려졌다 — 실제 ${$$('figure').length}`,
);
ok($$('[role="img"][aria-label]').length === unitCount, '차트마다 aria-label이 붙는다');

// ② 조사가 먼저 — 단서를 덜 열면 제출 버튼이 잠긴다
const submit = $('[data-testid="detective-submit"]');
ok(Boolean(submit) && submit.disabled, '단서 0개 · 가설 미선택 상태에서 제출 잠김');

// 가설만 골라도 여전히 잠겨 있다 (**여기가 이 모듈의 핵심 계약**)
await click($(`[data-testid="detective-hypothesis-${ANSWER}"]`));
ok(
  $('[data-testid="detective-submit"]').disabled,
  '가설을 골라도 단서를 안 열었으면 제출 잠김 — 객관식으로 붕괴하지 않는다',
);

// 단서를 min_clues - 1개까지 열어도 여전히 잠김
const clueIds = CASE.clues.map((c) => c.clue_id);
for (const id of clueIds.slice(0, CASE.min_clues - 1)) {
  await click($(`[data-testid="detective-clue-${id}"]`));
}
ok(
  $('[data-testid="detective-submit"]').disabled,
  `단서 ${CASE.min_clues - 1}개(하한 미만)에서 제출 잠김`,
);
ok(
  text().includes(CASE.clues[0].text.slice(0, 20)),
  '연 단서는 본문이 펼쳐진다(조사 = 정보 획득)',
);
ok(
  $(`[data-testid="detective-clue-${clueIds[0]}"]`).getAttribute('aria-expanded') === 'true',
  '연 단서 카드에 aria-expanded=true',
);

// 하한을 채우면 열린다
await click($(`[data-testid="detective-clue-${clueIds[CASE.min_clues - 1]}"]`));
ok(!$('[data-testid="detective-submit"]').disabled, `단서 ${CASE.min_clues}개에서 제출 열림`);

// ④ 오답 제출 → 판정이 aria-live 영역 안에서 announce
await click($('[data-testid="detective-hypothesis-' + WRONG.hypothesis_id + '"]'));
await click($('[data-testid="detective-submit"]'));
await waitFor(() => text().includes('자료와 맞지 않아요'), 10000, '오답 판정 렌더');

const live = $('[data-testid="detective-verdict-live"]');
ok(Boolean(live), '판정 라이브 영역이 DOM에 상주한다');
ok(live?.getAttribute('aria-live') === 'polite', 'aria-live=polite');
ok(live?.getAttribute('role') === 'status', 'role=status');
ok(live?.textContent.includes('자료와 맞지 않아요'), '오답 판정 문구가 라이브 영역 **안**에 있다');
ok(live?.textContent.includes(WRONG.feedback.slice(0, 20)), '오답이어도 저작된 피드백은 보여 준다');
ok(!text().includes(CASE.solution.explanation.slice(0, 30)), '⑤ 오답에는 해설이 나오지 않는다');

// 단서 진행도도 라이브로 알린다
const progress = $('[data-testid="detective-clue-progress"]');
ok(progress?.getAttribute('aria-live') === 'polite', '단서 진행도가 aria-live로 알려진다');

// ⑤ 다시 추리 → 정답 제출 → 해설까지
await click($('[data-testid="detective-retry"]'));
ok(!text().includes(WRONG.feedback.slice(0, 20)), '다시 추리하면 이전 판정이 지워진다');
await click($(`[data-testid="detective-hypothesis-${ANSWER}"]`));
await click($('[data-testid="detective-submit"]'));
await waitFor(() => text().includes('사건 해결'), 10000, '정답 판정 렌더');

const live2 = $('[data-testid="detective-verdict-live"]');
ok(live2?.textContent.includes('사건 해결'), '정답 판정이 라이브 영역 안에서 announce된다');
ok(
  live2?.textContent.includes(CASE.solution.explanation.slice(0, 30)),
  '정답일 때만 해설(explanation)이 온다',
);
ok(
  live2?.textContent.includes(CASE.solution.takeaway.slice(0, 20)),
  '해설에 「기억할 것」(takeaway)이 함께 온다',
);
reactRoot.unmount();

// ═══ ⑦ 단위가 둘인 케이스는 차트가 갈린다(이중 축 금지) ═════════════════════
// 케이스 2는 ℃ 2계열 + cm 2계열이다. 한 차트에 담으면 이중 축이 되고, 그러면
// "바닷물은 그대로인데 상공만 떨어졌다"는 이 사건의 핵심 대비가 스케일에 묻힌다.
// 케이스 1은 단위가 하나라 이 분기를 밟지 않는다 — 그래서 여기서 따로 본다.
const CASE2 = CASES.find((c) => new Set(c.series.map((s) => s.unit)).size > 1);
if (CASE2) {
  reactRoot = mount(`/detective/${CASE2.case_id}`);
  await waitFor(() => text().includes(CASE2.intro.headline), 10000, '케이스2 상세 렌더');
  const units = new Set(CASE2.series.map((s) => s.unit)).size;
  ok(
    $$('figure').length === units,
    `단위 ${units}종 → 차트 ${units}개로 갈림 — 실제 ${$$('figure').length}`,
  );
  ok(
    $$('[role="img"][aria-label]').length === units,
    '갈린 차트마다 각각 aria-label이 붙는다',
  );
  reactRoot.unmount();
} else {
  ok(false, '단위가 2종 이상인 케이스가 시드에 없다 — 차트 분리 분기가 미검증이다');
}

// ═══ ⑥ 케이스 0건 빈 상태 ══════════════════════════════════════════════════
// 목을 건드리지 않고 XHR을 한 겹 감싸 목록만 빈 배열로 바꾼다 — 목의 라우트
// 테이블을 테스트가 고쳐 쓰면 다른 스모크에 새는 상태가 된다.
const RealXHR = window.XMLHttpRequest;
class EmptyCasesXHR extends RealXHR {
  open(method, url, ...rest) {
    this.__isCaseList = String(url).endsWith('/detective/cases');
    return super.open(method, url, ...rest);
  }
  get responseText() {
    return this.__isCaseList ? '[]' : super.responseText;
  }
  get response() {
    return this.__isCaseList ? '[]' : super.response;
  }
}
window.XMLHttpRequest = EmptyCasesXHR;
globalThis.XMLHttpRequest = EmptyCasesXHR;

reactRoot = mount('/detective');
await waitFor(() => text().includes('아직 열린 사건이 없어요'), 10000, '빈 상태 렌더');
ok(text().includes('아직 열린 사건이 없어요'), '케이스 0건이면 빈 상태 안내가 뜬다');
ok(
  $$('a').some((a) => a.getAttribute('href') === '/explore'),
  '빈 상태에도 나갈 문이 있다(탐구로 돌아가기) — 갇히지 않는다',
);
reactRoot.unmount();
window.XMLHttpRequest = RealXHR;

// ── 단서 카드가 4열 2줄이다 (2026-08-18 사용자 지시) ─────────────────────────
/**
 * "가로2줄 세로4줄인데 가로4줄 세로2줄로 바꿔줘."
 *
 * 단서가 7개라 2열이면 4줄이 된다. 4열로 바꾸려면 **둘이 같이** 있어야 한다:
 *  ⓐ `CasePlayPage`의 `xl:grid-cols-4`
 *  ⓑ `Layout`의 `isWide`에 `/detective` — 이게 없으면 셸이 576px이라 4열이
 *     한 칸 130px로 눌린다. 실측: 넓힌 뒤 셸 1152 · 한 칸 274px(종전 268px과
 *     사실상 같다 — 카드를 줄인 게 아니라 줄 수를 줄인 것이다).
 * 한쪽만 되돌려도 화면이 깨지는데 **에러는 안 난다** — 그래서 짝으로 문다.
 * jsdom에는 CSS 엔진이 없어 열 수를 좌표로 못 재므로 소스 계약으로 둔다.
 */
{
  const play = readFileSync(resolve(root, 'src/modules/detective/CasePlayPage.jsx'), 'utf-8');
  const clueUl = play.match(/<ul className="(grid grid-cols-1[^"]*)"/)?.[1] ?? '';
  // ⚠️ **정정(2026-08-19).** 이 줄은 `xl:grid-cols-4`를 요구했다. 그때는 옳았다 —
  //    단서 구역이 셸 **전폭**(1,120px)을 써서 4열이면 한 칸 268px였다.
  //    사건 화면이 2열이 되면서(왼쪽 자료·추리 / 오른쪽 단서) 단서가 오른쪽 열
  //    (1,536에서 약 500px) 안으로 들어갔고, 거기서 4열이면 한 칸 **118px** —
  //    라벨 한 줄도 못 들어간다. **열을 줄인 게 아니라 그릇이 바뀌었다.**
  //    ⓑ(넓은 셸)는 그대로 유효하다: 셸이 576이면 2열도 눌린다.
  ok(
    /\bsm:grid-cols-2\b/.test(clueUl) && !/\bgrid-cols-[34]\b/.test(clueUl),
    `단서 목록이 오른쪽 열 안에서 2열이다 — 실제 "${clueUl}"`,
  );
  const layout = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf-8');
  const isWide = layout.slice(layout.indexOf('const isWide ='), layout.indexOf('const shellWidth'));
  ok(
    /pathname\.startsWith\('\/detective'\)/.test(isWide),
    '탐정 화면이 넓은 셸을 쓴다 — 아니면 4열이 한 칸 130px로 눌린다',
  );

  // ── 「사건 게시판」 결 (2026-08-19 사용자 지시 "컨셉이 살짝 섞였으면") ──────
  /**
   * 심플한 틀을 지키면서 다섯 가지만 빌려 왔다. 그중 **뜻을 지닌 둘**을 문다 —
   * 나머지(크라프트 바탕·압정·미세 회전)는 순수 장식이라 바뀌어도 기능이 안 깨진다.
   *
   *  ㉠ **붉은 실은 한 색이다.** 단서 메모의 「차트 어느 지점」 줄과 차트의
   *     기준선(`ReferenceLine`)이 같은 `#B8443C`여야 «이 메모가 저 지점에 묶여
   *     있다»가 읽힌다. 한쪽만 바꾸면 실이 끊긴다 — 두 파일에 걸친 짝이라
   *     사람 눈으로는 두 화면을 나란히 놓고 봐야 알아챈다.
   *     ⚠️ 앱의 `rose-500`(오류)과 **다른 값**인 것도 계약이다. 같은 빨강이면
   *        기준선이 경고로 읽힌다(종전 amber는 「가상 자료 고지」 배지 색이라
   *        같은 이유로 틀렸다).
   *  ㉡ **웹폰트를 들이지 않았다.** 손글씨체가 분위기에는 맞지만 이 앱은 시스템
   *     글꼴만 쓴다 — 폰트 하나를 위해 외부 의존을 들이면 로드 실패 시 화면이
   *     조용히 달라진다. 등사 라벨(`font-mono`)이 그 몫을 대신한다.
   */
  const chart = readFileSync(resolve(root, 'src/modules/detective/CaseChart.jsx'), 'utf-8');
  const THREAD = '#B8443C';
  // ⚠️ **주석이 아니라 실제 값**을 본다. 처음에는 `chart.includes(THREAD)`로
  //    썼는데, 색을 amber로 되돌리는 변이에서도 **내가 쓴 주석 안의 색 문자열**
  //    이 남아 통과했다(변이 검증에서 잡혔다). 기준선의 `stroke=` 값을 뽑는다.
  const lineStroke = chart.match(/<ReferenceLine[\s\S]{0,400}?stroke="(#[0-9A-Fa-f]{6})"/)?.[1];
  ok(
    lineStroke === THREAD && play.includes(`bg-[${THREAD}]`),
    `㉠ 붉은 실이 한 색이다 — 차트 기준선 ${lineStroke} · 단서 메모 실 ${THREAD}`,
  );
  ok(
    !/#f43f5e/i.test(chart) && !/stroke="#f59e0b"/.test(chart),
    '㉠ 기준선이 오류색(rose)이나 고지색(amber)으로 되돌아가지 않았다',
  );
  const css = readFileSync(resolve(root, 'src/styles/index.css'), 'utf-8');
  const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf-8');
  ok(
    !/@import\s+url\(|fonts\.googleapis\.com/.test(css + indexHtml),
    '㉡ 웹폰트 의존이 없다 — 등사 라벨은 시스템 mono로 낸다',
  );
  ok(
    /font-mono[^"]*uppercase[^"]*tracking-\[0\.18em\]/.test(play),
    '㉡ 절 제목이 등사 라벨(mono·대문자·자간)이다 — 「증거 서류」 결의 본체',
  );

  // 사건 목록도 같은 이유로 짝이다(2026-08-18 "가로2줄 세로3줄 → 가로3줄 세로2줄").
  // ⚠️ **열 수와 폭 상한을 함께** 봐야 한다. `max-w-[760px]`이 남은 채 3열로
  // 바꾸면 격자가 760에 묶여 한 칸이 240px로 **작아진다** — 사용자가 본 것과
  // 반대 방향이다. 실측: 상한을 1120으로 풀면 1536에서 363px(종전 2열 368px).
  const list = readFileSync(resolve(root, 'src/modules/detective/CaseListPage.jsx'), 'utf-8');
  const listGrid = list.match(/<div className="(grid max-w-\[[^"]*)"/)?.[1] ?? '';
  ok(
    /\bxl:grid-cols-3\b/.test(listGrid),
    `사건 목록이 xl에서 3열이다 — 실제 "${listGrid}"`,
  );
  const cap = Number(listGrid.match(/max-w-\[(\d+)px\]/)?.[1]);
  ok(
    cap >= 1080,
    `목록 폭 상한이 3열을 담는다(${cap}px) — 760이면 3열이 한 칸 240px로 눌린다`,
  );
}

await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 기후 탐정(진입·단서 게이트·정답 비노출·판정 announce·빈 상태) 스모크 통과');
// ⚠️ **명시적 종료가 필요하다**(2026-08-19 실측으로 발견). jsdom XHR이 vite 개발
// 서버와 맺은 keep-alive 소켓 2개가 남아 `httpServer.close()`가 계속 기다리고,
// **OK를 찍고도 200초 넘게 프로세스가 안 끝난다.** 실패 경로는 위에서
// `process.exit(1)`로 강제 종료하고 있었으므로 **초록일 때만** 느렸다 — 그래서
// 아무도 못 보던 CI 시간 낭비다(이 파일만 그랬다. 다른 스모크 대부분은 이미
// 같은 줄을 갖고 있다). 실측 200초+ → 4초.
process.exit(0);

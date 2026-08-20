/**
 * 예보 대결 배치 스모크 —
 *   node tests/duelLayout.smoke.test.mjs
 *
 * 관례는 다른 스모크와 동일: 테스트 러너 의존 없음, vite middlewareMode +
 * mock/apiMockPlugin(실 XHR) + jsdom 실마운트. 로케일은 ko 고정(한국어 단정).
 *
 * 여기서 지키는 것 (2026-08-06 시안 — 자료 왼쪽 / 판단·제출 오른쪽)
 *   ① 미제출 화면은 **2열**이다: 브리핑 카드와 「근거+폼」 열이 같은 격자의
 *      형제다. 세로로 쌓으면 브리핑 차트 5종을 다 지나야 입력칸이 나오고,
 *      값을 채우는 동안 근거가 된 차트가 화면 밖이라 되짚어 올라가야 했다.
 *   ② 격자에 `grid-cols-[minmax(0,1fr)]`이 있다. 없으면 격자 항목의 기본
 *      min-width:auto 때문에 브리핑 안의 하늘 타임라인(8칸 × 52px, 자체
 *      가로 스크롤)이 카드를 밀어 390px에서 카드가 476px가 된다 — 페이지에
 *      가로 스크롤이 생겼다(실측). lg:grid-cols-2는 Tailwind가 이미 깔아 준다.
 *   ③ 오른쪽 열은 sticky다. 브리핑이 두 배 넘게 길어(1440 실측 940 ↔ 615)
 *      아래 차트를 보러 내려가면 입력칸이 화면 밖으로 나간다.
 *   ④ 예보 대결의 튜터는 **태풍이**다(Mascot 배정표 + SideNav TUTOR_BY_PATH).
 *
 * ①~③은 CSS 계산이 필요한 계약인데 jsdom에는 레이아웃 엔진이 없다. 그래서
 * "클래스가 붙어 있다"까지만 본다 — 실제 픽셀은 브라우저 실측으로 확인했고,
 * 여기서 막고 싶은 것은 그 클래스가 정리 중에 사라지는 회귀다.
 */
import { readFileSync, readdirSync } from 'node:fs';
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
async function waitFor(pred, timeoutMs = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

useAuthStore.getState().setTokens({ accessToken: 't-duel', refreshToken: 'r-duel' });
useAuthStore.getState().setUser({ user_id: 'duel-smoke', email: 'duel@test.dev', nickname: '스모크' });

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent ?? '';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

const container = window.document.getElementById('root');
const reactRoot = createRoot(container);
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
});
reactRoot.render(
  createElement(QueryClientProvider, { client: qc },
    createElement(MemoryRouter, { initialEntries: ['/duel'] }, createElement(App))),
);

await waitFor(() => text().includes('예보 브리핑'), 8000, '브리핑 카드 렌더');
await waitFor(() => $$('form').length > 0, 8000, '예측 입력 폼 렌더');

// ── 세 덩어리가 다 있다 ─────────────────────────────────────────────────────
const heading = (t) => $$('h2, h3').find((e) => e.textContent.includes(t));
const briefingCard = heading('예보 브리핑')?.closest('.rounded-2xl') ?? null;
const evidenceCard = heading('근거')?.closest('.rounded-2xl') ?? null;
const form = $('form');
ok(Boolean(briefingCard), '왼쪽: 예보 브리핑 카드');
ok(Boolean(evidenceCard), '오른쪽: 판단 근거 고르기 카드');
ok(Boolean(form), '오른쪽: 예측 입력 폼');

// ── ① 2열 — 브리핑 칸과 「근거+폼」 칸이 같은 격자의 형제 ────────────────────
// 격자를 briefingCard.parentElement로 잡지 않는다 — 카드를 div로 한 겹 감싸는
// 순간(실제로 degraded 높이 때문에 감쌌다) 부모가 격자가 아니게 돼 검사 전체가
// 무너진다. 격자는 클래스로 찾고, 두 덩어리가 **서로 다른 칸**에 들어 있는지를
// 포함 관계로 본다. 구조 리팩터링에는 견디고 배치가 깨지면 잡힌다.
const grid = $$('div').find((d) => d.className.includes?.('lg:grid-cols-2')) ?? null;
const gridCls = grid?.className ?? '';
ok(Boolean(grid), `격자가 lg에서 2열 — "${gridCls}"`);

const cellOf = (node) =>
  grid && node ? [...grid.children].find((c) => c.contains(node)) ?? null : null;
const leftCell = cellOf(briefingCard);
const rightColumn = cellOf(evidenceCard);
ok(Boolean(leftCell) && Boolean(rightColumn), '브리핑·근거가 각각 격자 칸 안에 있다');
ok(
  Boolean(leftCell && rightColumn && leftCell !== rightColumn),
  '브리핑과 근거가 **서로 다른** 칸이다(세로로 쌓이지 않았다)',
);
ok(
  Boolean(rightColumn && form && rightColumn.contains(form)),
  '폼이 근거와 **같은** 오른쪽 칸 안에 있다',
);

// ── ② 격자 항목이 줄어들 수 있다 (390px 가로 넘침 회귀 방지) ────────────────
ok(
  gridCls.includes('grid-cols-[minmax(0,1fr)]'),
  `격자 항목 최소폭 0 — 없으면 브리핑 카드가 좁은 화면을 밀어낸다. "${gridCls}"`,
);

// ── ③ 오른쪽 열 sticky ──────────────────────────────────────────────────────
const stickyInner = rightColumn?.firstElementChild ?? null;
ok(
  Boolean(stickyInner && stickyInner.className.includes('lg:sticky')),
  `오른쪽 칸 안쪽이 sticky — "${stickyInner?.className ?? '(없음)'}"`,
);
ok(
  Boolean(rightColumn && !rightColumn.className.includes('lg:items-start') && !gridCls.includes('lg:items-start')),
  'items-start를 쓰지 않는다 — 칸이 늘어나야 sticky가 따라 내려온다',
);

// ── ③-2 리그로 가는 통로 (2026-08-11 합친 화면) ─────────────────────────────
//
// 리그는 내비에서 빠졌다 — 이 화면의 탭이 **앱에서 리그로 가는 유일한 길**이다.
// navItems에 없다는 단정만으로는 부족하다: 없애 놓고 통로도 안 만들면 그 단정은
// 통과하는데 화면은 도달 불가가 된다(CO-N-1 ②가 정확히 그 사고였다).
const leagueTab = $('[data-compete-tab="/league"]');
ok(Boolean(leagueTab), '탭바에 리그로 가는 링크가 없다 — 리그가 도달 불가 화면이 된다');
ok(
  leagueTab?.getAttribute('href') === '/league',
  `리그 탭이 /league로 간다 — 실제 ${leagueTab?.getAttribute('href')}`,
);
const duelTab = $('[data-compete-tab="/duel"]');
ok(
  duelTab?.getAttribute('aria-current') === 'page' && !leagueTab?.getAttribute('aria-current'),
  '지금 보고 있는 탭만 aria-current="page"',
);
// 내비도 이 화면을 **자기 것으로 표시해야 한다**. /league에서 어느 항목과도
// 안 맞아 아무 데도 안 켜지던 것을 navItems.isNavActive(alsoMatch)로 고쳤다.
const { NAV_ITEMS, isNavActive } = await vite.ssrLoadModule('/src/components/navItems.js');
const owner = NAV_ITEMS.filter((i) => isNavActive(i, '/league'));
ok(owner.length === 1 && owner[0].to === '/duel', `/league를 담당하는 내비 항목 1개 — ${owner.map((i) => i.to)}`);

// ── ③-3 로딩·오류에서도 껍데기(=탭바)가 남는가 ──────────────────────────────
//
// 조회가 실패했다고 리그까지 못 가면 안 된다. 목을 실패시킬 수단이 없어
// **소스 계약**으로 고정한다(BoardPage의 data-board-next 선례와 같은 방식) —
// 두 분기가 껍데기 밖으로 일찍 return하면 잡힌다. 위 단정들은 성공 경로만
// 지나므로, 이 검사가 없으면 early return을 되살려도 CI가 초록이다.
const { readFile } = await import('node:fs/promises');
for (const [rel, guard] of [
  ['src/modules/duel/DuelPage.jsx', 'todayQ.isLoading'],
  ['src/modules/league/LeaguePage.jsx', 'currentQ.isLoading'],
]) {
  const src = await readFile(resolve(root, rel), 'utf8');
  // 로딩 분기 시작 ~ 성공 경로의 최상위 `return (`(들여쓰기 2칸) 사이가
  // 「로딩 + 오류」 두 분기다. 그 안에 여는 태그가 정확히 둘이어야 한다.
  const from = src.indexOf(`if (${guard})`);
  const successReturn = src.indexOf('\n  return (', from);
  const wraps =
    from >= 0 && successReturn > from
      ? (src.slice(from, successReturn).match(/<CompeteLayout/g) ?? []).length
      : -1;
  ok(wraps === 2, `${rel}: 로딩·오류 분기가 CompeteLayout 안에서 그려진다 — 실제 감싼 수 ${wraps}`);
}

// ── ④ 태풍이는 **상단 배너**가 말한다 (2026-08-12 사용자 지시) ─────────────
// 종전에는 사이드바 왼쪽 하단 튜터였다. 학습·보드처럼 배너로 옮기면서
// SideNav는 이 경로에서 튜터를 접는다 — **둘 다 뜨면 한 화면에 태풍이가 둘**이고
// 각자 다른 말을 한다(2026-08-11에 /board에서 실제로 그랬다).
const heroImg = $('[data-hero-mascot] img');
ok(
  $('[data-hero-mascot]')?.getAttribute('data-hero-mascot') === 'typhoon',
  `상단 배너 마스코트가 태풍이 — ${$('[data-hero-mascot]')?.getAttribute('data-hero-mascot')}`,
);
ok(heroImg?.getAttribute('src') === '/typhoon.png', `배너 튜터 이미지 — ${heroImg?.getAttribute('src')}`);
ok(
  !$('[data-testid="sidenav"] img'),
  '사이드바에 튜터 이미지가 없다 — 있으면 한 화면에 같은 캐릭터가 둘',
);

// ── ③-3 탭이 **카드 안**에 붙어 있다 (2026-08-17 사용자 지시) ───────────────
/**
 * "학습 세션처럼 예보/리그 탭을 카드 안에 넣어 줘". 종전에는 카드 **밖** 위쪽에
 * 알약 꼴로 떠 있어서, 무엇을 바꾸는 스위치인지가 화면에서 안 붙어 보였다.
 * 학습 경로가 2026-08-13에 같은 이유로 같은 꼴이 됐다(`CourseSwitcher`
 * variant='tab' — `PcCurriculumPath`의 카드 안 맨 위).
 *
 * 세 가지가 한 묶음이고 하나만 빠져도 "붙어 있다"가 깨진다:
 *   ⓐ 탭이 흰 카드(`rounded-[20px]`)의 **자손**이다.
 *   ⓑ 탭 줄이 아래 테두리를 갖는다(`border-b`) — 카드와 이어지는 선.
 *   ⓒ 선택된 탭이 `-mb-px`로 그 선을 **끊는다**. 이게 없으면 그냥 네모 버튼 둘이다.
 * ⚠️ 카드는 **탭 분기 바깥**에 있어야 한다 — 배너 분기 안에 두면 마스코트가
 *    없는 리그 탭에서 카드가 사라져 탭이 다시 허공에 뜬다.
 */
{
  const tabEl = $('[data-compete-tab="/duel"]');
  let card = tabEl;
  while (card && !/rounded-\[20px\]/.test(card.className || '')) card = card.parentElement;
  ok(Boolean(card), 'ⓐ 탭이 흰 카드 안에 있다 — 밖에 뜨면 무엇을 바꾸는지 안 붙어 보인다');
  ok(
    Boolean(card && /bg-white/.test(card.className)),
    `ⓐ 그 카드가 학습 경로 카드와 같은 프레임이다 — "${card?.className ?? '(없음)'}"`,
  );
  const strip = tabEl?.parentElement;
  ok(
    Boolean(strip && /border-b\b/.test(strip.className)),
    `ⓑ 탭 줄이 카드와 이어지는 선을 갖는다 — "${strip?.className ?? '(없음)'}"`,
  );
  ok(
    /-mb-px/.test(tabEl?.className ?? ''),
    'ⓒ 선택된 탭이 그 선을 끊는다(-mb-px) — 없으면 카드에 안 붙고 버튼처럼 보인다',
  );
}

// ── ④-b 배너 설명이 **한 줄로 잘리지 않는다** (2026-08-17 사용자 지시) ───────
// 종전 `truncate`는 300px에서 문장 끝을 «…»로 잘랐다 — 탐구·예보 둘 다
// "…체험하는 공…" / "…내일 예보를 겨…"로 끝났다. 두 줄 접기로 바꿨다.
//
// ⚠️ **`truncate`로 되돌리는 것을 막는 것이 요점이다.** 잘림은 픽셀 계산이라
// jsdom이 못 보고(레이아웃 엔진 없음), 화면에서도 "문장이 원래 저런가 보다"로
// 넘어가기 쉽다. 실제 폭은 브라우저 실측으로 확인했다(1440: 설명 2줄 37px ·
// 배너 h=90으로 **전후 동일**). 여기서는 소스 계약만 못박는다.
// ⚠️ 높이가 그대로여야 하는 이유는 이 파일 머리말의 「배너 치수는 어디서나
// 같다」 — 마스코트 원(62px)이 행 높이를 정하므로 두 줄(≈37px)은 안 넘긴다.
{
  const banner = readFileSync(resolve(root, 'src/components/HeroBanner.jsx'), 'utf8');
  // ⚠️ **클래스 전체**를 잡는다(종전에는 `basis-[300px]` **뒤**만 캡처했다).
  // 앵커에 넣은 토큰은 캡처에서 빠지므로, 그 토큰을 단정하는 줄이 영원히
  // 실패한다 — 폭 계약을 추가하다 실제로 그렇게 걸렸다.
  const descCls = banner.match(/<p className="(hidden min-w-0 [^"]*)"/)?.[1] ?? '';
  ok(
    /line-clamp-2/.test(descCls),
    `배너 설명이 두 줄까지 접힌다 — 실제 "${descCls.trim()}"`,
  );
  ok(
    !/\btruncate\b/.test(descCls),
    '배너 설명에 truncate가 없다 — 붙으면 문장 끝이 «…»로 잘린다',
  );
  // ⚠️ **`lg:block`이 같이 있으면 위 두 줄이 통과하면서도 클램프는 죽는다**
  // (2026-08-17 코드 리뷰가 잡았다 — 실제로 그 상태로 초록이었다).
  // `line-clamp-2`는 `display:-webkit-box`고 `lg:block`은 `display:block`인데
  // 특이도가 같고 컴파일 CSS에서 `.lg\:block`이 뒤에 온다(실측 54676 < 54779)
  // — block이 이긴다. 클래스가 붙어 있는지만 보는 계약은 이 충돌을 못 보므로
  // **충돌하는 짝을 직접 금지**한다. lg에서 펴지는 것은 `hidden`(7835)보다
  // `.lg\:line-clamp-2`(54676)가 뒤라 clamp 자신이 해낸다.
  ok(
    !/\blg:block\b/.test(descCls),
    'lg:block이 없다 — display:block이 line-clamp의 -webkit-box를 덮어 클램프가 죽는다',
  );
  // ⚠️ **폭을 넓히는 것은 `xl` 이상에서만이다**(2026-08-18 "줄 바꿈없이 일자로 쭉").
  // 한 줄에 필요한 폭이 351px이라 기본 300으로는 반드시 두 줄이 된다. 그런데
  // 1024·1152에서 360을 주면 예보·리그 배너(CompeteLayout 카드 안이라 더 좁다)의
  // **제목이 «…»로 잘린다** — 실측으로 확인하고 xl로 물렸다. 기본값을 360으로
  // 올리는 「간단한」 수정이 그 회귀다.
  ok(
    /\bbasis-\[300px\]/.test(descCls) && /\bxl:basis-\[360px\]/.test(descCls),
    `설명 폭이 xl에서만 넓어진다(기본 300 · xl 360) — 실제 "${descCls.trim()}"`,
  );

  // ── `note`(제목 아래 작은 글씨)도 같은 62px 예산 안에 있다 ─────────────────
  // 2026-08-19에 「교육용 단순화 모델」 고지가 배너 안, 제목 바로 아래로 들어왔다.
  // 그 줄이 배너 높이를 밀지 않으려면 제목 열이 마스코트 원(62px)을 넘지 않아야
  // 하고, 예산은 빠듯하다: eyebrow 14 + 제목 26 + 여백 2 + 고지 14 = **56**.
  //   ⓐ 간격이 `mt-1`(4px)이면 열이 64가 되어 배너가 90 → **92**가 된다.
  //      2px짜리라 눈으로는 안 보이고 화면을 오갈 때 본문이 튀는 것으로만 나타난다
  //      (실측으로 잡았다). 그래서 `mt-0.5`를 못박는다.
  //   ⓑ 두 줄 상한(`line-clamp-2`)이 없으면 긴 고지가 세 줄이 되어 원을 넘긴다.
  //   ⓒ **`hidden`을 붙이지 않는다** — 이 자리에 오는 것은 안내가 아니라 고지라
  //      좁은 화면에서 사라지면 안 된다(설명 `description`과 다른 점이 그것이다).
  const noteCls = banner.match(/<p className="(mt-0\.5 line-clamp-2[^"]*)"/)?.[1] ?? '';
  ok(/\bmt-0\.5\b/.test(noteCls), `제목 아래 고지의 간격이 mt-0.5다 — 실제 "${noteCls.trim()}"`);
  ok(/line-clamp-2/.test(noteCls), '제목 아래 고지가 두 줄까지만 접힌다 — 세 줄이면 62px 원을 넘긴다');
  ok(!/\bhidden\b/.test(noteCls), '제목 아래 고지는 좁은 화면에서도 접히지 않는다 — 안내가 아니라 고지다');

  // 🔴 **`description`과 `note`를 한 배너에 같이 주면 안 된다.** 설명이 360px를
  // 가져가면 제목 열이 658px로 좁아져 고지가 두 줄이 되고, 위 56px 예산이
  // 무너져 배너가 h=101이 된다(실측). 호출부 전수 검사 — 소스에 새 배너가
  // 늘어도 자동으로 걸린다.
  const jsxFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    return e.isDirectory() ? jsxFiles(full) : (e.name.endsWith('.jsx') ? [full] : []);
  });
  for (const file of jsxFiles(resolve(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const call of src.match(/<HeroBanner[\s\S]*?\/>/g) ?? []) {
      if (!/\bnote=/.test(call)) continue;
      ok(
        !/\bdescription=/.test(call),
        `${file.slice(root.length + 1)}: 배너가 description과 note를 같이 쓰지 않는다 — 둘 다 주면 고지가 두 줄이 되어 h=90이 깨진다`,
      );
    }
  }
}

// ── ⑤ 시각 라벨이 실서버 형식을 읽는가 (2026-08-10 실기동 회귀) ─────────────
// 실서버는 `"202608101500"`(YYYYMMDDHHMM)을 주는데 종전 fmtHour가 ISO만 가정해
// `slice(11,13)`으로 잘라, **전 슬롯이 「0시」로 찍혔다**. 키가 없던 동안 hourly가
// 늘 비어 degraded 카드만 떠서 여태 아무도 못 본 자리다.
// 목이 ISO를 주고 실서버가 압축형을 주던 **패리티 어긋남**이 근본 원인이라,
// 여기서 두 형식을 다 못 박고 목도 실서버 형식으로 맞췄다.
const { fmtHour } = await vite.ssrLoadModule('/src/modules/duel/briefingDisplay.js');
const hourOf = (s) => fmtHour(s, (_k, v) => String(v.h));
ok(hourOf('202608101500') === '15', `압축형 → 15시 (실제 ${hourOf('202608101500')})`);
ok(hourOf('2026-08-10T15:00:00') === '15', `ISO → 15시 (실제 ${hourOf('2026-08-10T15:00:00')})`);
ok(hourOf('202608100000') === '0', `자정은 0시로 (실제 ${hourOf('202608100000')})`);
ok(hourOf('') === '-' && hourOf(null) === '-', '빈 값은 대시');

// 목이 실서버와 같은 형식을 주는가 — 목이 더 친절하면 그 차이가 곧 버그다.
// `base`가 아니라 `origin`이다 — 이 파일이 서버를 띄우고 잡아 둔 이름(:51).
// 종전에 정의되지 않은 `base`를 참조해 **ReferenceError로 죽었고**, 그 아래 단정
// 3건(목이 실서버와 같은 hourly 형식을 주는가)이 한 번도 실행된 적이 없다.
// ci.sh의 frontend 단계가 이 파일 때문에 상시 FAIL이었다(2026-08-10 발견·수정).
const mockHourly = JSON.parse(await (await fetch(`${origin}/api/v1/duel/briefing`, {
  headers: { Authorization: 'Bearer test' },
})).text()).hourly ?? [];
ok(mockHourly.length > 0, `목 hourly 비어있지 않다 — ${mockHourly.length}건`);
ok(
  mockHourly.every((h) => /^\d{12}$/.test(String(h.datetime))),
  `목 datetime이 실서버와 같은 YYYYMMDDHHMM — 실제 "${mockHourly[0]?.datetime}"`,
);

reactRoot.unmount();
await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 예보 대결 배치(2열·항목 최소폭·sticky·태풍이 튜터·시각 라벨) 스모크 통과');

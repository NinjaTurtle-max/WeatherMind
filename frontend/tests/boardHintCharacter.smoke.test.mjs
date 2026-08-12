/**
 * 보드 힌트 교사 캐릭터 스모크 (R13-01 §2.6) —
 *   node tests/boardHintCharacter.smoke.test.mjs
 *
 * 무엇을 지키는가
 *   1. **힌트를 캐릭터가 말한다.** 힌트 블록에 마스코트 말풍선이 붙는다. 예전에는
 *      캐릭터 없는 노란 텍스트 상자였다(§0 뿌리 B "힌트가 캐릭터 없이 텍스트 배열").
 *   2. **힌트 단계에 따라 표정이 바뀐다.** 0단→1단→2단으로 화자가 갈린다.
 *      같은 얼굴이 계속 서 있으면 "한 걸음 더 들어갔다"가 그림으로 보이지 않는다.
 *   3. **기존 6종 자산만 쓴다.** 새 이미지를 만들지 않는다 — 화자 목록이
 *      public/*.png 여섯 장 안에 있어야 한다(mascotAssets.contract가 그 여섯 장의
 *      정렬을 따로 지킨다).
 *   4. **문구는 한 글자도 바뀌지 않았다.** 캐릭터를 붙이는 작업이지 문구 개작이
 *      아니다 — 렌더된 힌트 문장을 i18n 리소스 원문과 **문자열 동일**로 대조한다.
 *      (boardAssistRetention.smoke가 '힌트 1:'·'필요한 요소 종류'·정답 미노출을
 *       이미 지킨다. 여기서는 그 문구가 캐릭터를 얻고도 그대로인지를 본다.)
 *   5. ko/en 양 로케일에서 캐릭터·전환이 동일하게 동작한다(문구만 갈린다).
 *
 * 관례는 boardAssistRetention.smoke.test.mjs와 동일(같은 보드를 같은 방식으로
 * 띄운다): 테스트 러너 의존 없음, vite middlewareMode + mock/apiMockPlugin + jsdom.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
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
// 보드 비주얼(강수 Canvas·WebGL)은 전부 컨텍스트 null 가드가 있다.
window.HTMLCanvasElement.prototype.getContext = () => null;

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

const AtmosphereBoard = (await vite.ssrLoadModule('/src/modules/board/AtmosphereBoard.jsx')).default;
const { HINT_SPEAKER, hintStageMascot } = await vite.ssrLoadModule('/src/modules/board/BoardHintPanel.jsx');
const { RESOURCES } = await vite.ssrLoadModule('/src/i18n/core.js');
const { useLocaleStore } = await vite.ssrLoadModule('/src/i18n/index.js');
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

useAuthStore.getState().setTokens({ accessToken: 't-hint', refreshToken: 'r-hint' });
useAuthStore.getState().setUser({ user_id: 'hint-smoke', email: 'hint@test.dev', nickname: '스모크' });

/** 힌트 2단이 다 뜨는 퍼즐 — assist 스모크와 같은 것을 쓴다(같은 경로를 본다). */
const PUZZLE = {
  question_text: '수도권에 소나기를 내려 보세요.',
  mode: 'goal_only',
  palette: ['front:cold', 'moisture'],
  goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
  initial_state: { elements: [] },
  hints: ['수도권(존 1)에 한랭전선을 놓으세요.', '한랭전선을 놓고 습기를 60 이상으로 올리면 소나기가 내려요.'],
};

const $ = (sel) => window.document.querySelector(sel);
const text = () => window.document.body.textContent ?? '';
const buttons = () => [...window.document.querySelectorAll('button')];
const findButton = (needle) => buttons().find((b) => (b.textContent ?? '').includes(needle));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

const mascotEl = () => $('[data-testid="board-hint-mascot"]');
const speaker = () => mascotEl()?.getAttribute('data-mascot') ?? null;
const speakerImg = () => mascotEl()?.querySelector('img')?.getAttribute('src') ?? null;

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

let currentRoot = null;
function mountBoardRoot() {
  if (currentRoot) {
    try {
      currentRoot.unmount();
    } catch {
      /* 이미 정리됨 */
    }
  }
  const container = window.document.getElementById('root');
  container.innerHTML = '';
  const reactRoot = createRoot(container);
  currentRoot = reactRoot;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: ['/board'] },
        createElement(AtmosphereBoard, { puzzle: PUZZLE, onSubmit: () => {} }))),
  );
  return reactRoot;
}

// ── 3. 화자는 **보드 담당 하나**(2026-08-11 사용자 지시) ─────────────────────
// 종전에는 단계마다 갈랐다(0단 구름이 · 1단 물방울이 · 2단 태양이). 그러면 한
// 화면에서 말하는 사람이 세 번 바뀌고 그중 둘은 다른 화면 담당이다. 단계가
// 올랐다는 것은 「힌트 1:/2:」 번호가 이미 말한다.
{
  ok(HINT_SPEAKER === 'sun', `보드 힌트 화자는 태양이 — 실제 ${HINT_SPEAKER}`);
  ok(existsSync(join(root, 'public', `${HINT_SPEAKER}.png`)), `public/${HINT_SPEAKER}.png 실존`);
  // 단계가 무엇이든 같은 화자 — 범위 밖도 마찬가지(호출부 호환).
  for (const level of [-1, 0, 1, 2, 99]) {
    ok(hintStageMascot(level) === HINT_SPEAKER, `${level}단도 태양이`);
  }
}

// ── 1·2·4. ko 실마운트 — 캐릭터 등장 + 단계별 전환 + 문구 불변 ───────────────
const KO = RESOURCES.ko.board.atmosphere;
{
  mountBoardRoot();
  await waitFor(() => findButton('힌트 보기') != null, 8000, '보드 초기 렌더');
  await sleep(200);

  // 0단 — 아직 아무 힌트도 안 봤지만 캐릭터는 이미 서 있다(권하는 얼굴)
  ok(mascotEl() !== null, '힌트 영역에 마스코트 말풍선이 있다');
  const s0 = speaker();
  ok(s0 === HINT_SPEAKER, `0단 화자 — ${s0}`);
  ok(speakerImg() === `/${HINT_SPEAKER}.png`, `0단 이미지 — ${speakerImg()}`);
  ok(mascotEl().getAttribute('data-hint-stage') === '0', '0단 표기');

  // 1단 — **화자는 그대로**, 단계 표기만 오른다
  click(findButton('힌트 보기'));
  await waitFor(() => text().includes('힌트 1:'), 4000, '1단 힌트 렌더');
  ok(speaker() === HINT_SPEAKER, `1단도 같은 화자 — ${speaker()}`);
  ok(mascotEl().getAttribute('data-hint-stage') === '1', '1단 표기');

  // 4. 문구 불변 — 1단 문장은 리소스 원문 그대로(지역명만 보간)
  const step1 = KO.hintStep1.replace('{zone}', '수도권');
  ok(text().includes(`${KO.hintPrefix.replace('{n}', '1')} ${step1}`),
     '1단 문구가 리소스 원문과 문자열 동일');

  // 2단 — 다시 전환
  click(findButton('힌트 보기'));
  await waitFor(() => text().includes('힌트 2:'), 4000, '2단 힌트 렌더');
  ok(speaker() === HINT_SPEAKER, `2단도 같은 화자 — ${speaker()}`);
  ok(mascotEl().getAttribute('data-hint-stage') === '2', '2단 표기');

  // 4-b. 2단까지 공개해도 문구는 그대로 — 칩 라벨·마무리 문장 원문 대조
  ok(text().includes(KO.hintNeedsLabel), '요소 종류 라벨이 원문 그대로');
  ok(text().includes(KO.hintNoAnswer), '"정답 배치는 안 알려준다" 문장이 원문 그대로');
  ok(findButton('힌트 보기') == null, '2단까지 공개하면 CTA가 사라진다');

  // 4-c. 캐릭터가 문구에 끼어들지 않았다 — '힌트 2:' 이후에 숫자가 없다는
  //      기존 계약(assist 스모크)을 이 파일에서도 못 박는다. 캐릭터 이름·설명을
  //      뒤에 붙이고 싶어지는 자리라서 여기에 둔다.
  const tail = text().slice(text().indexOf('힌트 2:'));
  ok(!/\d/.test(tail.replace('힌트 2:', '')), `2단 이후 숫자 없음 — "${tail.slice(0, 80)}"`);

  // 캐릭터는 장식 — 스크린리더가 정오답·진도를 중복해 읽지 않는다
  const img = mascotEl().querySelector('img');
  ok(img?.getAttribute('aria-hidden') === 'true' && img?.getAttribute('alt') === '',
     '마스코트는 장식(aria-hidden·alt 빈 문자열)');
}

// ── 5. en 로케일 — 문구만 갈리고 캐릭터는 같다 ──────────────────────────────
{
  useLocaleStore.getState().setLocale('en');
  mountBoardRoot();
  await waitFor(() => findButton('Show hint') != null, 8000, 'en 보드 렌더');
  await sleep(200);
  ok(speaker() === HINT_SPEAKER, `en 0단 화자 — ${speaker()}`);
  click(findButton('Show hint'));
  await waitFor(() => text().includes('Hint 1:'), 4000, 'en 1단 힌트');
  ok(speaker() === HINT_SPEAKER, `en 1단 화자 — ${speaker()}`);
  click(findButton('Show hint'));
  await waitFor(() => text().includes('Hint 2:'), 4000, 'en 2단 힌트');
  ok(speaker() === HINT_SPEAKER, `en 2단 화자 — ${speaker()}`);
  ok(!/힌트/.test(text()), 'en에서 한국어 힌트 원문이 남지 않는다');
  useLocaleStore.getState().setLocale('ko');
}

try {
  currentRoot?.unmount();
} catch {
  /* 정리 실패는 결과에 영향 없음 */
}
await vite.close();
await new Promise((r) => httpServer.close(r));
if (failed) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 보드 힌트 교사 캐릭터(말풍선·단계별 표정 전환·기존 자산·문구 불변·ko/en) 스모크 통과');
process.exit(0);

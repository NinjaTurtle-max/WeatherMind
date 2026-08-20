/**
 * 라우트 상위 에러 바운더리 **실마운트** 계약 — node tests/errorBoundary.contract.test.mjs
 *
 * ── 무엇을 지키나 ───────────────────────────────────────────────────────────
 * 이월 대장 §4.31: 「에러 바운더리가 없어 이 패널 하나가 페이지 전체를 죽인다」.
 * 실측 기록 — `/explore/typhoon` 진입 후 **아무 조작 없이 24초 만에 백지**.
 * 그 예외 자체는 `2381d20`이 고쳤고 `exploreMount.smoke`가 문다. 여기는 **다른
 * 층**이다: 「예외가 나지 않게」가 아니라 **「예외가 나도 백지가 되지 않게」**.
 *
 * ── 🔴 「파일이 있다」로는 안 된다 ──────────────────────────────────────────
 * 이 저장소가 오늘 하루에만 네 번 만난 형태가 「초록인데 아무것도 안 지키는 계약」이다.
 * 그래서 여기서는 **일부러 던지는 자식을 실제로 마운트**하고, 그 뒤 화면에
 * ⓐ 글자가 남아 있고 ⓑ 되돌아갈 버튼이 둘 있고 ⓒ 스택이 새지 않는지를 잰다.
 * 「`getDerivedStateFromError`가 정의돼 있다」 같은 단정은 **일부러 쓰지 않았다** —
 * 그것은 배선이 아니라 모양이다.
 *
 * ── 무는 것 ─────────────────────────────────────────────────────────────────
 *  ① 전제: 경계 **없이** 같은 자식을 마운트하면 화면이 실제로 빈다.
 *     🔴 이 단정이 없으면 ②가 공허하다 — 원래 안 비는 것을 「안 비었다」고 셀 수 있다.
 *  ② 경계가 있으면 화면이 **비지 않는다**(글자가 남는다).
 *  ③ 대체 화면이 **사람이 읽을 것**이다 — i18n 문구 3종이 실제로 그려진다.
 *  ④ 되돌아갈 길이 **둘** 있다(다시 시도 · 학습 화면으로).
 *  ⑤ 🔴 **스택 트레이스가 화면에 없다.** 내부 경로 노출 금지.
 *  ⑥ 🔴 예외를 **조용히 삼키지 않는다** — `console.error`로 나간다. 삼키면 결함이
 *     안 보이고, 그것은 백지와 다른 종류의 손실이다.
 *  ⑦ 정상 자식은 **그대로 지나간다**(경계가 정상 경로를 안 건드린다).
 *  ⑧ 🔴 문구가 **못 지킬 약속을 하지 않는다** — `uiCopy.contract` ⑹⑺과 같은 원칙.
 *  ⑨ ko·en **양쪽에 키가 다 있다**. 한쪽만 있으면 로케일을 바꾼 순간 키가 샌다.
 *
 * ── 이 계약이 못 무는 것 ────────────────────────────────────────────────────
 *  · 그려진 그림·레이아웃·색. jsdom에는 래스터라이저가 없다(저장소 관례).
 *  · `window.location.reload()`가 실제로 새로고침하는 것. jsdom은 항해를 안 한다 —
 *    ④는 **버튼이 있다**까지이고 그 뒤는 실브라우저 몫이다.
 *
 * 관례: 러너 의존 없음 · vite ssrLoadModule · PASS/FAIL 출력 · 실패 시 exit 1.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'production';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
// 🔴 실패 이름은 **`console.log`로** 뱉는다. 아래에서 `console.error`를 가로채기
//    때문이다(⑥이 우리 코드의 콘솔 출구를 세야 한다). 종전에 `console.error`로
//    적었더니 **계약이 우는데 실패 이름이 화면에서 사라졌다** — 「3건 실패」만
//    남고 무엇이 실패했는지 안 보였다. 되돌림 시험에서 그것을 「안 울었다」로
//    읽을 뻔했다. 감지기가 우는 것과 그 울음이 들리는 것은 다르다.
const check = (name, cond, detail = '') => {
  if (cond) console.log(`PASS ${name}`);
  else { console.log(`FAIL ${name}${detail ? `\n${detail}` : ''}`); failed += 1; }
};

const { JSDOM, VirtualConsole } = await import('jsdom');
const virtualConsole = new VirtualConsole();
virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'SVGElement']) globalThis[k] = window[k];
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
globalThis.matchMedia = window.matchMedia;

// 🔴 **예외 수집기 — ①이 이것 없이는 아예 실행되지 않는다.**
// 경계가 **없는** 상태로 던지는 자식을 마운트하면 React가 그 예외를 다시 던지고,
// 그것이 렌더 스케줄러(비동기)에서 터져 **프로세스를 죽인다.** 수집기가 없으면
// 파일이 ① 중간에 죽어 나머지 단정이 실행되지도 않는다 — 실제로 그렇게 죽었다.
// 관례는 `exploreMount.smoke`와 같다.
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

// React는 경계가 잡은 예외도 콘솔로 한 번 더 뿜는다(개발 편의). ⑥이 **우리 코드의**
// console.error를 세야 하므로 원본을 감싸 기록만 하고 조용히 흘린다.
const errLog = [];
const realError = console.error;
console.error = (...a) => { errLog.push(a.map(String).join(' ')); };

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createServer } = await import('vite');

const server = await createServer({
  root, logLevel: 'error', server: { middlewareMode: true, hmr: false },
  appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mount(el, settle = 150) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const r = createRoot(host);
  r.render(el);
  await sleep(settle);
  return { host, unmount: () => { try { r.unmount(); } catch { /* 경계 밖 예외면 언마운트도 던진다 */ } host.remove(); } };
}

const SENTINEL = '경계-시험-스택-표식';
let completed = false;
try {
  const mod = await server.ssrLoadModule('/src/components/RouteErrorBoundary.jsx');
  const Boundary = mod.default;
  const ko = (await server.ssrLoadModule('/src/i18n/resources/ko.js')).default;
  const en = (await server.ssrLoadModule('/src/i18n/resources/en.js')).default;

  // 일부러 던지는 자식. 메시지에 표식을 넣어 ⑤가 「스택이 샜다」를 실제로 잴 수 있게 한다.
  const Bomb = () => { throw new Error(`터졌다 ${SENTINEL}`); };

  // ── ① 전제: 경계가 없으면 정말로 빈다 ─────────────────────────────────────
  errLog.length = 0;
  const bare = await mount(createElement(Bomb));
  const bareText = bare.host.textContent.trim();
  check('① 전제 — 경계 **없이** 같은 자식을 마운트하면 화면이 실제로 빈다',
    bareText === '', `실제 남은 글자: ${JSON.stringify(bareText.slice(0, 80))}`);
  bare.unmount();

  // ── ②~⑥ 경계가 있을 때 ───────────────────────────────────────────────────
  errLog.length = 0;
  const wrapped = await mount(createElement(Boundary, null, createElement(Bomb)));
  const text = wrapped.host.textContent;
  const $$ = (sel) => Array.from(wrapped.host.querySelectorAll(sel));

  check('② 화면이 **비지 않는다** — 경계가 대체 화면을 세운다', text.trim().length > 0);
  check('③ 대체 화면이 사람이 읽을 것이다 — 제목·본문 i18n 문구가 실제로 그려진다',
    text.includes(ko.errorBoundary.title) && text.includes(ko.errorBoundary.body),
    `실제 글자: ${JSON.stringify(text.slice(0, 160))}`);
  const btns = $$('button');
  check('④ 되돌아갈 길이 **둘** 있다 (다시 시도 · 학습 화면으로)',
    btns.length === 2
      && btns.some((b) => b.textContent.includes(ko.errorBoundary.retry))
      && btns.some((b) => b.textContent.includes(ko.errorBoundary.home)),
    `실제 버튼 ${btns.length}개: ${JSON.stringify(btns.map((b) => b.textContent))}`);
  check('⑤ 🔴 스택 트레이스가 화면에 **없다** — 내부 경로를 사용자에게 안 보인다',
    !text.includes(SENTINEL) && !/\.jsx|at [A-Z]\w+ \(|node_modules/.test(text));
  check('⑥ 🔴 예외를 **조용히 삼키지 않는다** — 콘솔에 남는다',
    errLog.some((l) => l.includes('RouteErrorBoundary')),
    `console.error 줄 ${errLog.length}건`);
  check('⑥-b 그 콘솔 줄이 **원본 예외를 담는다**(라벨만 찍고 버리지 않는다)',
    errLog.some((l) => l.includes('RouteErrorBoundary') && l.includes(SENTINEL)));
  wrapped.unmount();

  // ── ⑦ 정상 경로 무회귀 ───────────────────────────────────────────────────
  const fine = await mount(createElement(Boundary, null, createElement('p', null, '정상 자식')));
  check('⑦ 정상 자식은 그대로 지나간다 — 경계가 정상 경로를 안 건드린다',
    fine.host.textContent.includes('정상 자식'));
  fine.unmount();

  // ── ⑧ 못 지킬 약속 금지 (uiCopy.contract ⑹⑺과 같은 원칙) ─────────────────
  const koVals = Object.values(ko.errorBoundary);
  check('⑧ 🔴 문구가 못 지킬 약속을 하지 않는다 (「나중에」·「언제든」·「바꿀 수 있」)',
    koVals.every((v) => !/바꿀\s*수\s*있|언제든|나중에/.test(v)),
    JSON.stringify(koVals));
  check('⑧-b 문구가 비어 있지 않다 — 키가 비면 위 단정이 저절로 참이 된다',
    koVals.length === 4 && koVals.every((v) => typeof v === 'string' && v.length >= 4));

  // ── ⑨ ko·en 짝 ───────────────────────────────────────────────────────────
  const koKeys = Object.keys(ko.errorBoundary).sort().join(',');
  const enKeys = Object.keys(en.errorBoundary ?? {}).sort().join(',');
  check('⑨ ko·en 양쪽에 키가 다 있다 — 로케일을 바꾸면 키가 새지 않는다',
    koKeys === enKeys && koKeys.length > 0, `ko=${koKeys} / en=${enKeys}`);
  check('⑨-b en 문구도 약속을 하지 않는다 ("later"·"anytime"·"you can change")',
    Object.values(en.errorBoundary ?? {}).every((v) => !/\b(later|anytime|you can change)\b/i.test(v)));

  completed = true;
} catch (e) {
  console.error = realError;
  console.error(`FAIL 계약 실행 중 예외\n${e?.stack ?? e}`);
  failed += 1;
} finally {
  console.error = realError;
  await server.close();
  dom.window.close();
}

if (!completed && failed === 0) failed += 1;
if (failed > 0) { console.log(`\n${failed}건 실패`); process.exit(1); }
console.log('OK: 라우트 상위 에러 바운더리 계약 통과 (백지 방지 · 문구 · 콘솔 출구 · 정상 경로 무회귀)');

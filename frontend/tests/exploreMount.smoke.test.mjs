/**
 * 탐구 화면 **실마운트** 스모크 — node tests/exploreMount.smoke.test.mjs
 *   (npm run test:explore가 exploreSims.render 다음으로 이어 부른다)
 *
 * ── 왜 별도 종목인가 ────────────────────────────────────────────────────────
 * `exploreSims.render.test.mjs`는 **SSR**(renderToString)이다. SSR은 useEffect를
 * 돌리지 않으므로 **캔버스 코드에 한 줄도 닿지 않는다** — 그래서 `SatelliteView`가
 * `getContext('2d')` null에서 죽는 동안에도 그 스모크는 내내 초록이었다.
 * 여기는 jsdom에 **실제로 마운트해 효과까지 돌린다**.
 *
 * ── 한 계약군: 같은 함수의 **두 null 경로** ─────────────────────────────────
 * `stormSprites()`가 null을 돌려주는 이유가 둘인데 종전에는 **둘 다 터졌다.**
 *   ⓐ **2D 컨텍스트가 없다**(jsdom·컨텍스트 고갈) → `buildSprite`가 `createImageData`
 *      에서 `TypeError`. 사용자 영향은 없지만 **이 화면에 계약을 걸 수 없었다.**
 *   ⓑ **태풍이 없다**(세력이 양자화 하한 12.5 미만) → 그리기가 `nowIntensity > 0.5`
 *      라는 **별도 문턱**으로 열려서 없는 스프라이트의 `.outer`를 읽었다.
 *      🔴 이쪽은 **사용자가 밟는다**: 해수면온도를 내려 태풍을 없애는 조작이 바로
 *      이 화면 **탐구 목표 1번**이고, 재생 중에도 생애 말기에 그 구간을 지난다.
 * 둘 다 "구름만 빠지고 화면은 산다"가 옳은 동작이라 한 파일에서 함께 문다.
 *
 * ── 무엇을 무는가 ───────────────────────────────────────────────────────────
 *  ① 2D 컨텍스트가 **없는** 환경에서 `SatelliteView`가 예외 없이 마운트된다.
 *  ② 같은 환경에서 `TyphoonSimPage`가 통째로 마운트되고 캔버스 노드가 선다.
 *  ③ 예열 오버레이가 **걷힌다** — 스프라이트를 못 만드는 환경에서 진행률이 0에
 *     멈추면 화면은 안 죽어도 「예열 중」 판이 캔버스를 영영 덮는다. 조용히
 *     삼키는 것과 견디는 것은 다르다.
 *  ④ **세력 하한 구간이 실재한다**(순수 계산 — 캔버스 무관). 화면 기본값에서도
 *     재생 84프레임 중 일부가 그 구간이다. 이 사실이 ⓑ가 이론이 아닌 근거다.
 *  ⑤ 소스 계약 — 구름 게이트가 **스프라이트 유무**이지 별도 숫자 문턱이 아니다.
 *  ⑥ **컨텍스트가 있는 경로**(아래 스텁): 태풍이 없어도 **빈 바다가 정상 화면으로
 *     그려지고**, 세력이 있으면 구름이 실제로 얹힌다(수리가 정상 경로를 안 건드렸다는
 *     증거 — 「없을 때만 다른 길」).
 *
 * ── 🔴 ⑥의 스텁에 대하여 — 우회가 아니다 ───────────────────────────────────
 * 수리는 **소스에** 있고 ①②③이 **스텁 없이** 그것을 문다. ⑥의 기록용 2D 컨텍스트는
 * 수리를 감추려는 것이 아니라 **jsdom이 원리적으로 못 가는 분기**(컨텍스트가 있는
 * 그리기 경로)에 닿기 위한 것이다 — 그 분기가 곧 ⓑ가 사는 자리다.
 *
 * ── 🔴 이 계약이 **못** 무는 것 ─────────────────────────────────────────────
 *  · **그려진 그림.** jsdom에는 래스터라이저가 없다. 증명되는 것은 「마운트·재생에서
 *    예외가 없다」와 「어떤 그리기 호출이 몇 번 갔다」이지 **「무엇이 보인다」가
 *    아니다** — 픽셀은 이 하네스로 **원리적으로** 측정 불가다(실브라우저나
 *    node-canvas가 필요하다). ⑥의 호출 수도 "명령이 갔다"까지다.
 *  · **레이아웃·색·겹침.** 저장소 관례 그대로 jsdom이 못 잰다.
 *  · **실브라우저 타이밍.** 재생 6fps로 phase가 흐르는 실제 시간축은 여기서
 *    앞당겨 재현하지 않는다(④가 그 구간의 실재를 순수 계산으로 대신 문다).
 *
 * 관례: 러너 의존 없음 · vite ssrLoadModule · PASS/FAIL 출력 · 실패 시 exit 1.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}${detail ? `\n${detail}` : ''}`);
    failed += 1;
  }
};

// ── jsdom 환경 (detective.smoke.test.mjs 관례 — API 목·HTTP 서버는 불필요하다:
//    탐구 시뮬은 서버를 부르지 않는 순수 클라이언트 화면이다) ─────────────────
const { JSDOM, VirtualConsole } = await import('jsdom');
// jsdom은 `getContext()`를 만날 때마다 "Not implemented" jsdomError를 뿜는다 —
// 그것이 **정상 전제**인 하네스라 출력만 걷어낸다. 나머지 콘솔은 그대로 통과시키고,
// 다른 jsdomError는 숨기지 않는다(숨기면 진짜 결함이 조용해진다).
const virtualConsole = new VirtualConsole();
virtualConsole.forwardTo(console, { jsdomErrors: 'none' }); // jsdom 29 API(구 sendTo 아님)
virtualConsole.on('jsdomError', (err) => {
  if (!/Not implemented: HTMLCanvasElement's getContext/.test(err.message)) console.error(err.message);
});
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/explore/typhoon',
  pretendToBeVisual: true,
  virtualConsole,
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
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;

// ⚠️ ①~⑤ 동안에는 **캔버스 스텁을 넣지 않는다.** jsdom의 `getContext`는 null을
// 돌려주고, 그 null이 바로 이 계약이 무는 환경이다.
check('전제: jsdom의 2D 컨텍스트가 실제로 null이다 (①~⑤가 사는 환경 자체)',
  window.document.createElement('canvas').getContext('2d') === null);

// ── 예외 수집 — 효과에서 나는 예외는 렌더 호출 **뒤에** 비동기로 터진다.
//    렌더 직후에 단정하면 결함이 있어도 초록이 되고(되돌림 게이트 ④), 수집기가
//    없으면 프로세스가 파일 중간에 죽어 나머지 단정이 실행되지도 않는다. ────────
const caught = [];
process.on('uncaughtException', (err) => { caught.push(err); });
process.on('unhandledRejection', (err) => { caught.push(err instanceof Error ? err : new Error(String(err))); });
window.addEventListener('error', (e) => { caught.push(e.error ?? new Error(e.message)); });
const drain = () => caught.splice(0, caught.length);
const fmt = (errs) => errs.map((e) => `       ${e?.stack?.split('\n').slice(0, 5).join('\n       ') ?? e}`).join('\n');

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { createServer } = await import('vite');

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 조건이 참이 될 때까지 기다린다. 시간이 초과돼도 던지지 않는다 — 단정은 호출부가
 *  한다(초과 자체가 FAIL 문구로 읽혀야 한다). */
async function waitFor(pred, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(30);
  }
  return pred();
}

/** 컴포넌트 하나를 새 컨테이너에 마운트하고 패시브 효과가 돌 틈을 준다. */
async function mount(el, settle = 150) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const r = createRoot(host);
  r.render(createElement(MemoryRouter, null, el));
  await sleep(settle);
  return { host, unmount: () => { r.unmount(); host.remove(); } };
}

/**
 * 기록용 2D 컨텍스트(⑥ 전용) — **그리기 명령을 세기만 한다.**
 * `createImageData`만 진짜 버퍼를 돌려준다(스프라이트 루프가 거기 쓴다).
 * 오프스크린 스프라이트 캔버스와 화면 캔버스가 같은 기록기를 공유하지만,
 * 스프라이트 쪽은 createImageData/putImageData만 부르므로 `drawImage`·`fillRect`
 * 계수는 **화면 캔버스 몫**으로 읽어도 된다.
 */
function install2dRecorder() {
  const calls = { drawImage: 0, fillRect: 0, fill: 0, stroke: 0, createImageData: 0, putImageData: 0, arc: 0 };
  // 픽스처마다 `calls`는 0으로 되돌리지만 **누적**은 따로 센다 — 스프라이트는
  // 모듈 캐시라 한 번만 구워지고(예열이 첫 픽스처에서 다 한다), 뒤 픽스처에서
  // putImageData가 0인 것이 정상이다. 그 사실을 모르고 픽스처별로 단정했다가
  // 실제로 한 번 헛짚었다.
  const totals = { ...calls };
  const noop = () => {};
  const tally = (k) => { calls[k] += 1; totals[k] += 1; };
  const ctx = {
    save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, clearRect: noop,
    setLineDash: noop, setTransform: noop,
    arc: () => tally('arc'),
    fillRect: () => tally('fillRect'),
    fill: () => tally('fill'),
    stroke: () => tally('stroke'),
    drawImage: () => tally('drawImage'),
    createImageData: (w, h) => {
      tally('createImageData');
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: () => tally('putImageData'),
  };
  const proto = window.HTMLCanvasElement.prototype;
  const original = proto.getContext;
  proto.getContext = function getContext(type) { return type === '2d' ? ctx : null; };
  // 해안선 블록은 `typeof Path2D === 'function'`으로 스스로를 지킨다 — jsdom에는
  // Path2D가 없어 그냥 건너뛴다. 육지도 그려지는지 보려면 그 자리를 열어야 한다.
  const hadPath2D = 'Path2D' in globalThis;
  if (!hadPath2D) globalThis.Path2D = class Path2DStub { constructor(d) { this.d = d; } };
  return {
    calls,
    totals,
    reset: () => { for (const k of Object.keys(calls)) calls[k] = 0; },
    restore: () => {
      proto.getContext = original;
      if (!hadPath2D) delete globalThis.Path2D;
    },
  };
}

// 🔴 하네스가 **완주했는지**를 따로 표시한다. 위 `uncaughtException` 수집기가
// 본문에서 던져진 예외까지 삼켜서, 종전 판은 파일 중간에 멈추고도 exit 0이었다
// (되돌림 게이트를 스스로 어기는 형태다 — 원복 판에서 실제로 그랬다).
let completed = false;

try {
  const SV = await server.ssrLoadModule('/src/modules/explore/SatelliteView.jsx');
  const SatelliteView = SV.default;
  const { default: TyphoonSimPage } = await server.ssrLoadModule('/src/modules/explore/TyphoonSimPage.jsx');
  const field = await server.ssrLoadModule('/src/modules/explore/satelliteField.js');
  const sims = await server.ssrLoadModule('/src/lib/exploreSims.js');
  const { default: ko } = await server.ssrLoadModule('/src/i18n/resources/board.ko.js');

  // ── ① SatelliteView 단독 — 세력·시어를 **직접 고정**한다.
  //    페이지 기본값에 기대면 다른 담당(MT-22)이 기본 슬라이더를 바꿀 때 픽스처가
  //    조용히 다른 분기를 지난다(되돌림 게이트 ④).
  {
    drain();
    const m = await mount(createElement(SatelliteView, { intensity: 85, shear: 'strong' }));
    const errs = drain();
    check('① SatelliteView가 2D 컨텍스트 없이도 예외 없이 마운트된다 (세력 85 · 시어 strong)',
      errs.length === 0, fmt(errs));
    check('①-b 캔버스 노드가 선다', m.host.querySelector('canvas[data-sat-canvas]') !== null);
    m.unmount();
  }

  // ── ② 화면 전체 — 태풍 시뮬 페이지(위성 도식을 품는다) ────────────────────
  {
    drain();
    const m = await mount(createElement(TyphoonSimPage, null));
    let errs = drain();
    check('② TyphoonSimPage가 2D 컨텍스트 없이도 예외 없이 마운트된다', errs.length === 0, fmt(errs));
    // ⚠️ 요소 **개수**를 단정하지 않는다 — MT-22 입체 모식도가 병합되면 이 화면에
    //    노드가 더 붙는다. 「있는가」만 묻는다.
    check('②-b 화면 안에 위성 캔버스가 있다', m.host.querySelector('canvas[data-sat-canvas]') !== null);

    // ── ③ 예열 오버레이가 걷힌다 ──────────────────────────────────────────
    // ⚠️ **살아 있는 화면에서** 걷혔는지를 묻는다. 「예열 문구가 없다」만 보면
    //    컴포넌트가 죽어 트리가 통째로 비어도 초록이다 — 원복 판에서 실제로 그랬다.
    const warming = ko.explore.satellite.warming;
    const alive = () => m.host.querySelector('canvas[data-sat-canvas]') !== null;
    const stillWarming = () => m.host.textContent.includes(warming);
    await waitFor(() => alive() && !stillWarming());
    check(`③ 화면이 산 채로 예열 표시가 걷힌다 — "${warming}" 판이 캔버스를 영영 덮지 않는다`,
      alive() && !stillWarming());

    drain();
    await sleep(600);   // 재생 인터벌 몇 프레임(6fps)
    errs = drain();
    check('②-c 재생이 몇 프레임 돌아도 예외가 없고 화면이 살아 있다',
      errs.length === 0 && alive(), fmt(errs));
    m.unmount();
  }

  // ── ④ 세력 하한 구간 — **캔버스 없이 순수 계산으로** ─────────────────────
  // `trackAt(phase).life`가 곧 지금 세력이라, 재생은 생애 끝에서 세력을 0까지
  // 끌고 내려간다. 그 도중 `quantize`가 0이 되는 구간에는 스프라이트가 **없다**.
  // 그리기가 별도 숫자 문턱으로 열리면 그 사이에서 없는 스프라이트를 읽는다.
  {
    const SETTINGS = [
      { sst: 28, shear: 'weak' },      // 화면 기본값
      { sst: 32, shear: 'weak' },      // 최강
      { sst: 30, shear: 'strong' },    // 시어로 깎인 중간
    ];
    const rows = SETTINGS.map(({ sst, shear }) => {
      const { intensity } = sims.typhoonIntensity({ sst, shear });
      let none = 0;
      for (let k = 0; k < 84; k += 1) {           // LOOP_SEC 14 × FPS 6 = 한 바퀴
        const now = intensity * field.trackAt((0.42 + k / 84) % 1).life;
        if (now > 0 && !SV.hasStormSprite(now)) none += 1;
      }
      return { sst, shear, intensity, none };
    });
    const detail = rows.map((r) => `${r.sst}℃·${r.shear} → 세력 ${r.intensity} · 스프라이트 없는 프레임 ${r.none}/84`).join(' | ');
    check(`④ 재생 중 "스프라이트가 없는 세력" 구간이 실재한다 — ${detail}`,
      typeof SV.hasStormSprite === 'function' && rows.every((r) => r.none > 0),
      '       hasStormSprite가 없으면 SatelliteView가 그 판정을 내보내지 않는 것이다.');
  }

  // ── ⑤ 소스 계약 — 구름은 **스프라이트 유무**로 게이트된다 ────────────────
  // 숫자 문턱을 따로 두면 그 문턱과 `quantize`의 하한이 갈리고, 갈린 구간이 그대로
  // ⓑ 결함이다. IR_RAMP 무채색 검사(exploreSims.render)와 같은 소스 계약 관례다.
  {
    const src = readFileSync(resolve(root, 'src/modules/explore/SatelliteView.jsx'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')            // 블록 주석 제거
      .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    const at = code.indexOf('const sp = stormSprites(');
    const gated = at >= 0 && /const sp = stormSprites\([^)]*\);\s*if \(sp\)/.test(code);
    check('⑤ 구름 그리기가 스프라이트 유무를 직접 묻는다(별도 숫자 문턱 금지)',
      gated && !/nowIntensity\s*[><]=?\s*[\d.]/.test(code),
      '       nowIntensity를 숫자와 비교해 그리기를 여는 자리가 남아 있다 — 그 문턱과\n'
      + '       quantize의 하한이 어긋나면 그 사이 프레임이 없는 스프라이트를 읽는다.');
  }

  // ── ⑥ 컨텍스트가 **있는** 경로 — 기록용 스텁(위 머리 주석의 단서 참조) ────
  {
    const rec = install2dRecorder();
    try {
      // ⑥-a 태풍이 아예 없다(세력 0) — 탐구 목표 1번의 **달성 상태**다.
      //     빈 바다·경로·격자가 그대로 그려지고 구름만 없어야 한다.
      drain();
      rec.reset();
      const a = await mount(createElement(SatelliteView, { intensity: 0, shear: 'weak' }));
      let errs = drain();
      check('⑥-a 세력 0 — 예외 없이 마운트된다(탐구 목표 1번이 시키는 상태)', errs.length === 0, fmt(errs));
      check(`⑥-a-2 빈 바다가 **정상 화면**으로 그려진다 (바다 ${rec.calls.fillRect}회 · 육지 ${rec.calls.fill}회 · 선 ${rec.calls.stroke}회 · 구름 ${rec.calls.drawImage}회)`,
        rec.calls.fillRect > 0 && rec.calls.fill > 0 && rec.calls.stroke > 0 && rec.calls.drawImage === 0);
      check(`⑥-a-3 「${ko.explore.satellite.noSystem}」 안내가 뜬다 — 검은 캔버스가 고장으로 안 읽히게`,
        a.host.textContent.includes(ko.explore.satellite.noSystem));
      a.unmount();

      // ⑥-b 🔴 **핵심 픽스처** — 세력이 있지만 양자화 하면 0인 구간.
      //     「낮은 세력」이 아니라 `quantize`가 0을 내는 값이어야 이 분기에 닿는다.
      check(`⑥-b-0 픽스처가 정말 q≤0 분기에 닿는다 (세력 5 → 스프라이트 ${SV.hasStormSprite(5) ? '있음' : '없음'})`,
        SV.hasStormSprite(5) === false && 5 > 0.5);
      drain();
      rec.reset();
      const b = await mount(createElement(SatelliteView, { intensity: 5, shear: 'weak' }));
      errs = drain();
      check('⑥-b 세력 5(스프라이트 하한 미만) — 예외 없이 마운트된다',
        errs.length === 0, fmt(errs));
      check(`⑥-b-2 구름만 빠지고 바다·경로는 그대로다 (바다 ${rec.calls.fillRect} · 선 ${rec.calls.stroke} · 구름 ${rec.calls.drawImage})`,
        rec.calls.fillRect > 0 && rec.calls.stroke > 0 && rec.calls.drawImage === 0);
      b.unmount();

      // ⑥-c **정상 경로 무회귀** — 컨텍스트가 있고 세력이 하한 위면 구름이 실제로
      //     얹힌다(코어·외곽 두 겹). 수리가 "없을 때만 다른 길"인지의 증거다.
      drain();
      rec.reset();
      const c = await mount(createElement(SatelliteView, { intensity: 85, shear: 'weak' }), 400);
      // 예열이 스프라이트 8장을 **진짜로** 굽는 유일한 픽스처다(기록기의
      // createImageData가 실제 버퍼를 준다) — 느린 러너를 넉넉히 기다린다.
      // 계약이 깜빡이면 사람이 그 계약을 지운다.
      await waitFor(() => rec.calls.drawImage >= 2, 20000);
      errs = drain();
      check('⑥-c 세력 85 — 예외 없이 마운트된다', errs.length === 0, fmt(errs));
      check(`⑥-c-2 컨텍스트가 있으면 구름 두 겹이 실제로 얹힌다 (이 프레임들에서 drawImage ${rec.calls.drawImage}회 · 예열이 구운 스프라이트 누적 ${rec.totals.putImageData}장)`,
        rec.calls.drawImage >= 2 && rec.totals.putImageData >= 2);
      c.unmount();
    } finally {
      rec.restore();
    }
  }
  completed = true;
} catch (err) {
  console.error(`FAIL 하네스가 완주하지 못했다\n${fmt([err])}`);
  failed += 1;
} finally {
  await server.close();
  dom.window.close();
}

if (!completed) failed += failed === 0 ? 1 : 0;
if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 실마운트 스모크 통과 (컨텍스트 없음·태풍 없음 두 null 경로 + 정상 경로 무회귀)');

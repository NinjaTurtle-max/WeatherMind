/**
 * renderer — 자립 3D 모식도 렌더러 (MT-22).
 *
 * 대상 3종: **T1 태풍 단면 · T2 태풍 생애 · C1 복사수지.** 셋 다 화살표가 주역이라
 * 이 렌더러가 잘 그려야 하는 것은 단 하나, **입체 화살표**다.
 *
 * ── 왜 기존 단면 렌더러를 안 고쳤나 ──────────────────────────────────────────
 * `board/webgl/crossSection/`의 화살표를 3D로 바꾸면 **기존 15개 장면 외형이 전부**
 * 바뀐다. 그래서 관례만 답습하고 파일은 새로 세웠다(`guideBotMesh.js:15-19`가 같은
 * 판단으로 같은 선택을 한 선례다). 대신 그 파일들이 피 흘려 얻은 계약은 그대로 가져온다:
 *  · 컨텍스트 1개 · 전 요소 인스턴싱 · 드로우콜 상한
 *  · **dispose는 loseContext를 부르지 않는다**(R10-06 실브라우저 결함 — 아래 참조)
 *  · 실패는 예외가 아니라 `onFail()` — 폴백 화면은 호출측 소유다
 *
 * ── 단면 렌더러와 **의도적으로 다른** 두 가지 ────────────────────────────────
 *  1. **깊이 테스트 ON.** 단면은 반투명 볼륨이라 painter 정렬로 껐지만, 입체 화살표는
 *     **불투명**이고 교차할 때 앞뒤가 가려지는 것이 이 과업의 목적이다.
 *  2. **원근 투영.** 직교는 돌려도 평평하다(guideBotMesh.js:166-175).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  장면 데이터 형식 — **T1/T2/C1을 쓸 다음 담당이 읽는 곳**
 * ═══════════════════════════════════════════════════════════════════════════
 * 장면 데이터와 화면 배선은 이 세션의 소유가 아니다. 아래 형식만 계약이고,
 * 실제 장면 3종은 별도 파일(예: `schematicScenes.js`)에서 만들어 `setScene`에 넘긴다.
 * 아래 `EXAMPLE_SCENE`이 형식을 그대로 보인 최소 표본이다.
 *
 * ```js
 * const scene = {
 *   id: 'c1-radiation',            // 식별용(로그·테스트). 렌더에는 안 쓴다
 *   camera: { yaw: 38, pitch: 22, dist: 3.2, fov: 34, target: [0, 0.28, 0] },
 *                                   // 부분 덮어쓰기(생략 시 camera.DEFAULT_VIEW)
 *   background: '#0b1220' | [r,g,b,a] | null,   // null이면 투명(CSS 배경이 비친다)
 *   items: [ ... ],
 * };
 * ```
 *
 * **items — 세 종류뿐이다.**
 *
 * ① `arrow` — 입체 화살표(이 모식도의 주역)
 * ```js
 * { type: 'arrow',
 *   origin: [x, y, z],     // 꼬리 위치(월드)
 *   dir:    [x, y, z],     // 방향. 정규화는 렌더러가 한다. **수직 [0,±1,0]도 안전**
 *   length: 0.5,           // 꼬리→촉 길이(월드 단위)
 *   thickness: 0.06,       // 굵기 배율(자루 반지름 = 0.075 × 이 값 ÷ 기본치)
 *   color: '#38bdf8',      // '#rrggbb' 또는 [r,g,b] 0~1
 *   alpha: 1,              // 기본 1(불투명 — 앞뒤 가림이 목적이므로 낮추지 말 것)
 *   travel: 0,             // >0이면 그 거리만큼 dir 방향으로 왕복 이동(흐름 표현)
 *   phase: 0, speed: 0.3,  // travel>0일 때의 위상·속도(회전/초). 결정적이다
 *   at: 0, until: 2 }      // 단계 가시 구간(setStep). until 생략 = 끝까지
 * ```
 * ② `line` — 보조 폴리라인(윤곽·진로·층 경계)
 * ```js
 * { type: 'line', points: [[x,y,z], ...], color: '#94a3b8', alpha: 0.6,
 *   closed: false, at: 0, until: undefined }
 * ```
 * ③ `label` — GL이 아니라 **호출측 SVG/HTML이 그린다**. `labelsFor(scene, step, aspect)`가
 *    `{ text, left, top, ... }`(캔버스 백분율)로 돌려주므로 드로우콜이 늘지 않는다.
 * ```js
 * { type: 'label', pos: [x,y,z], text: '눈벽', size: 11, weight: 600, color: '#0f172a',
 *   at: 0, until: undefined }
 * ```
 *
 * ⚠️ **회전 방향을 화살표 하나로 표현하려 하지 말 것.** T1의 「하층 반시계 · 상층
 * 시계」는 원둘레 위에 접선 방향 화살표를 **여러 개 배치**해서 만든다(하층 링은
 * 안쪽으로 기운 접선, 상층 링은 반대 감김). 이 렌더러에 회전 프리미티브가 없는 것은
 * 빠뜨린 것이 아니라, 그 배치가 **장면 데이터의 몫**이기 때문이다.
 *
 * ⚠️ 상한: 화살표 `MAX_ARROWS`개 · 보조선 정점 `MAX_LINE_VERTS`개. 넘는 항목은
 * 조용히 잘린다(모바일 예산). 넘겼는지는 `counts`로 확인할 수 있다.
 */
import {
  createContext, createProgram, createStaticBuffer, createDynamicBuffer, bindInterleaved, rgba,
} from './glCore';
import { schematicCamera, projectToPercent, ASPECT } from './camera';
import { arrowMesh3D, arrow3DVertexCount, arrowBasis, ARROW3D_DEFAULTS } from './arrowMesh';
import * as S from './shaders';

/** 인스턴스 예산 — 세 모식도 모두 화살표 수십 개 규모다 */
export const MAX_ARROWS = 64;
export const MAX_LINE_VERTS = 1024;
/** 프레임당 드로우콜 상한. 실제 패스는 2(화살표·보조선)뿐이라 여유 포함 상한이다 */
export const DRAW_BUDGET = 4;

const ARROW_STRIDE = 18; // origin3 dir3 side3 span2 color4 anim3
const LINE_STRIDE = 7; // pos3 color4

const visible = (item, step) => (item.at ?? 0) <= step && step <= (item.until ?? Infinity);

/**
 * 단계에 보이는 라벨 + 캔버스 백분율 좌표.
 * GL은 글자를 그리지 않는다 — 호출측이 SVG `<text>`로 겹쳐 그린다(드로우콜 0).
 */
export function labelsFor(scene, step = 0, aspect = ASPECT) {
  if (!scene?.items) return [];
  const { vp } = schematicCamera(aspect, scene.camera);
  return scene.items
    .filter((it) => it.type === 'label' && visible(it, step))
    .map((it, i) => ({ ...it, key: `${step}-${i}`, ...projectToPercent(vp, it.pos ?? [0, 0, 0]) }));
}

/**
 * WebGL2 렌더러. 컨텍스트·셰이더 실패 시 **null** — 호출측이 폴백을 정한다.
 */
export function createSchematicRenderer(canvas, meshOpts = null) {
  const gl = createContext(canvas);
  if (!gl) return null;

  let programs;
  try {
    programs = {
      arrow: createProgram(gl, S.ARROW_VS, S.ARROW_FS, 'arrow'),
      line: createProgram(gl, S.LINE_VS, S.LINE_FS, 'line'),
    };
  } catch (err) {
    if (typeof console !== 'undefined') console.warn(String(err?.message ?? err));
    return null;
  }

  const meshSegments = meshOpts?.segments ?? ARROW3D_DEFAULTS.segments;
  const arrowVerts = arrow3DVertexCount(meshSegments);
  const geo = {
    arrow: createStaticBuffer(gl, arrowMesh3D({ ...(meshOpts ?? {}), segments: meshSegments })),
  };

  const cpu = {
    arrow: new Float32Array(MAX_ARROWS * ARROW_STRIDE),
    line: new Float32Array(MAX_LINE_VERTS * LINE_STRIDE),
  };
  const gpu = {
    arrow: createDynamicBuffer(gl, cpu.arrow.byteLength),
    line: createDynamicBuffer(gl, cpu.line.byteLength),
  };
  const counts = { arrow: 0, line: 0, arrowDropped: 0, lineDropped: 0 };

  const vaos = {
    arrow: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.arrow.prog, geo.arrow, [
        { name: 'aPos', size: 3, offset: 0 },
        { name: 'aNormal', size: 3, offset: 3 },
      ], 6);
      bindInterleaved(gl, programs.arrow.prog, gpu.arrow, [
        { name: 'iOrigin', size: 3, offset: 0 },
        { name: 'iDir', size: 3, offset: 3 },
        { name: 'iSide', size: 3, offset: 6 },
        { name: 'iSpan', size: 2, offset: 9 },
        { name: 'iColor', size: 4, offset: 11 },
        { name: 'iAnim', size: 3, offset: 15 },
      ], ARROW_STRIDE, 1);
      gl.bindVertexArray(null);
      return vao;
    })(),
    line: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.line.prog, gpu.line, [
        { name: 'aPos', size: 3, offset: 0 },
        { name: 'aColor', size: 4, offset: 3 },
      ], LINE_STRIDE);
      gl.bindVertexArray(null);
      return vao;
    })(),
  };

  let scene = null;
  let step = 0;
  let dirty = true;
  let cam = schematicCamera();
  const stats = { drawCalls: 0, lastDrawCalls: 0, frames: 0, uploads: 0 };

  function setScene(next) {
    scene = next ?? null;
    step = 0;
    cam = schematicCamera(cam.aspect ?? ASPECT, scene?.camera);
    dirty = true;
  }
  function setStep(next) {
    if (next === step) return;
    step = next;
    dirty = true;
  }

  /** 캔버스 백버퍼를 CSS 크기 × dpr로 맞춘다(리사이즈 시 재계산) */
  function resize() {
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const rect = canvas.getBoundingClientRect?.() ?? { width: canvas.width, height: canvas.height };
    const w = Math.max(1, Math.round((rect.width || 1) * dpr));
    const h = Math.max(1, Math.round((rect.height || 1) * dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    const aspect = (rect.width || 1) / Math.max(rect.height || 1, 1);
    cam = schematicCamera(aspect, scene?.camera);
    cam.aspect = aspect;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function rebuild() {
    counts.arrow = 0; counts.line = 0; counts.arrowDropped = 0; counts.lineDropped = 0;
    if (!scene?.items) return;

    for (const it of scene.items) {
      if (it.type !== 'arrow' || !visible(it, step)) continue;
      if (counts.arrow >= MAX_ARROWS) { counts.arrowDropped += 1; continue; }
      // 🔴 특이점 해소는 여기(CPU)에서 끝난다 — 수직 화살표가 사라지는 결함의 자리다.
      const { d, side } = arrowBasis(it.dir);
      const c = rgba(it.color ?? '#38bdf8', it.alpha ?? 1);
      const o = counts.arrow * ARROW_STRIDE;
      const a = cpu.arrow;
      a[o] = it.origin?.[0] ?? 0; a[o + 1] = it.origin?.[1] ?? 0; a[o + 2] = it.origin?.[2] ?? 0;
      a[o + 3] = d[0]; a[o + 4] = d[1]; a[o + 5] = d[2];
      a[o + 6] = side[0]; a[o + 7] = side[1]; a[o + 8] = side[2];
      a[o + 9] = it.length ?? 0.4; a[o + 10] = it.thickness ?? 0.5;
      a[o + 11] = c[0]; a[o + 12] = c[1]; a[o + 13] = c[2]; a[o + 14] = c[3];
      a[o + 15] = it.travel ?? 0; a[o + 16] = it.phase ?? 0; a[o + 17] = it.speed ?? 0;
      counts.arrow += 1;
    }

    for (const it of scene.items) {
      if (it.type !== 'line' || !visible(it, step)) continue;
      const pts = it.points ?? [];
      const c = rgba(it.color ?? '#94a3b8', it.alpha ?? 0.7);
      const segs = it.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < segs; i += 1) {
        if (counts.line + 2 > MAX_LINE_VERTS) { counts.lineDropped += 1; break; }
        for (const p of [pts[i], pts[(i + 1) % pts.length]]) {
          const o = counts.line * LINE_STRIDE;
          cpu.line[o] = p?.[0] ?? 0; cpu.line[o + 1] = p?.[1] ?? 0; cpu.line[o + 2] = p?.[2] ?? 0;
          cpu.line[o + 3] = c[0]; cpu.line[o + 4] = c[1]; cpu.line[o + 5] = c[2]; cpu.line[o + 6] = c[3];
          counts.line += 1;
        }
      }
    }

    if (counts.arrow > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.arrow);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpu.arrow, 0, counts.arrow * ARROW_STRIDE);
      stats.uploads += 1;
    }
    if (counts.line > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.line);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpu.line, 0, counts.line * LINE_STRIDE);
      stats.uploads += 1;
    }
  }

  /**
   * 한 프레임. @param tSec 초(rAF timestamp/1000)
   *
   * 흐름 애니메이션은 **전부 셰이더의 uTime**이 만든다 — 정상 상태에서 CPU 버퍼
   * 업로드가 0이라 매 프레임 비용이 uniform 몇 개뿐이다(60fps 계약).
   */
  function render(tSec = 0) {
    if (!scene) return 0;
    if (dirty) {
      rebuild();
      dirty = false;
    }

    let calls = 0;
    // 🔴 깊이 테스트 — 이 모식도가 존재하는 이유. 상향·하향 화살표가 교차할 때
    // 앞의 것이 뒤의 것을 가려야 「어느 쪽이 나가는 에너지인가」가 읽힌다.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // 뒷면 제거는 켜지 않는다 — 감기 방향이 뒤집힌 삼각형이 하나라도 생기면 화살표에
    // 구멍이 뚫린다. 정점 1만 개 규모라 뒷면을 다 그려도 비용이 없다(guideBotMesh와 같은 판단).
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 프리멀티플라이드 알파
    const bg = scene.background ? rgba(scene.background, 1) : [0, 0, 0, 0];
    gl.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (counts.arrow > 0) {
      gl.useProgram(programs.arrow.prog);
      gl.uniformMatrix4fv(programs.arrow.uniforms.uVP, false, cam.vp);
      gl.uniform3fv(programs.arrow.uniforms.uEye, cam.eye);
      gl.uniform1f(programs.arrow.uniforms.uTime, tSec);
      gl.bindVertexArray(vaos.arrow);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, arrowVerts, counts.arrow);
      calls += 1;
    }
    if (counts.line > 0) {
      gl.useProgram(programs.line.prog);
      gl.uniformMatrix4fv(programs.line.uniforms.uVP, false, cam.vp);
      gl.bindVertexArray(vaos.line);
      gl.drawArrays(gl.LINES, 0, counts.line);
      calls += 1;
    }
    gl.bindVertexArray(null);

    stats.lastDrawCalls = calls;
    stats.drawCalls += calls;
    stats.frames += 1;
    return calls;
  }

  /**
   * GPU 리소스만 반납한다. **loseContext는 절대 호출하지 않는다** — 같은 <canvas>의
   * 컨텍스트는 한 번 잃으면 되살아나지 않고(getContext가 죽은 컨텍스트를 그대로
   * 돌려준다), StrictMode(dev)의 mount→cleanup→remount 2회차가 죽은 컨텍스트로
   * 셰이더를 컴파일해 "컴파일 실패: null"을 내고 **전 사용자가 폴백으로 떨어진다**.
   * 실브라우저 실측으로 잡은 R10-06 결함이고, `crossSection/renderer.js:423`과
   * `mapOverlay/MapOverlayGL.jsx`가 같은 상처를 갖고 있다.
   */
  let disposed = false;
  function dispose() {
    if (disposed) return; // 언마운트 경로가 두 번 불려도 안전(멱등)
    disposed = true;
    for (const v of Object.values(vaos)) gl.deleteVertexArray(v);
    for (const b of Object.values(gpu)) gl.deleteBuffer(b);
    for (const b of Object.values(geo)) gl.deleteBuffer(b);
    for (const p of Object.values(programs)) gl.deleteProgram(p.prog);
  }

  return {
    gl, setScene, setStep, resize, render, dispose, stats, counts, arrowVerts,
    get step() { return step; },
    get camera() { return cam; },
  };
}

/**
 * rAF 생명주기까지 포함한 마운트. **프레임워크를 모른다** — React 컴포넌트도,
 * 순수 DOM 코드도 이것만 부르면 된다(화면 배선은 다른 담당 몫이라 JSX를 만들지 않는다).
 *
 * 관례는 `CrossSectionGL.jsx` / `realisticEffects.PrecipCanvas`를 그대로 답습한다:
 *  · `visibilitychange` — 탭이 숨으면 정지
 *  · `IntersectionObserver` — 뷰포트 밖이면 정지
 *  · `ResizeObserver` — 백버퍼·종횡비 재계산
 *  · 해제 시 rAF 취소 + GL 리소스 반납
 *  · GL 실패·컨텍스트 소실 → `onFail()`. **폴백 화면은 호출측이 정한다**
 *
 * @returns {{setScene, setStep, resize, dispose, renderer}|null} 실패하면 null
 */
export function mountSchematic(canvas, { scene = null, step = 0, onFail, meshOpts = null } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    onFail?.();
    return null; // SSR — 여기까지 오면 안 되지만 조용히 아무 일도 안 일어나게 한다
  }
  const renderer = createSchematicRenderer(canvas, meshOpts);
  if (!renderer) {
    onFail?.();
    return null;
  }
  if (scene) renderer.setScene(scene);
  if (step) renderer.setStep(step);
  renderer.resize();

  let raf = 0;
  let running = false;
  let released = false;
  let hidden = document.visibilityState === 'hidden';
  let inView = true;

  const frame = (t) => {
    raf = 0;
    if (released || hidden || !inView) {
      running = false;
      return;
    }
    renderer.render(t / 1000);
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (running || released || hidden || !inView) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };

  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (!hidden) start();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        if (inView) start();
      })
    : null;
  io?.observe(canvas);

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { renderer.resize(); start(); })
    : null;
  ro?.observe(canvas);

  // 컨텍스트 소실(드라이버 리셋·탭 과다) → 「아무 일도 안 일어남」으로 수렴시킨다
  const onLost = (e) => {
    e.preventDefault?.();
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onFail?.();
  };
  canvas.addEventListener?.('webglcontextlost', onLost);

  start();

  return {
    renderer,
    setScene: (next) => { renderer.setScene(next); start(); },
    setStep: (next) => { renderer.setStep(next); start(); },
    resize: () => { renderer.resize(); start(); },
    dispose: () => {
      if (released) return; // 멱등
      released = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener?.('webglcontextlost', onLost);
      io?.disconnect();
      ro?.disconnect();
      renderer.dispose();
    },
  };
}

/**
 * 형식 표본 — **장면 데이터가 아니라 형식의 예시**다(T1/T2/C1은 다른 담당 몫).
 *
 * 일부러 **수직 화살표 2개가 교차**하도록 짰다. 두 가지를 한꺼번에 보이기 위해서다:
 *  · `arrowBasis`의 **특이점 분기**(방향이 월드 상방과 평행)에 실제로 도달하는 표본
 *  · 깊이 테스트가 켜져야 뜻이 통하는 배치 — 상향·하향이 앞뒤로 겹친다(C1 문법)
 */
export const EXAMPLE_SCENE = Object.freeze({
  id: 'example-vertical-pair',
  background: null,
  camera: { yaw: 34, pitch: 18, dist: 2.6, target: [0, 0.35, 0] },
  items: [
    { type: 'line', points: [[-0.6, 0, -0.3], [0.6, 0, -0.3], [0.6, 0, 0.3], [-0.6, 0, 0.3]], closed: true, color: '#94a3b8', alpha: 0.55, at: 0 },
    // 하향(입사) — 정확히 수직이라 cross(d, worldUp) = 0이 되는 분기다
    { type: 'arrow', origin: [-0.22, 0.85, 0], dir: [0, -1, 0], length: 0.62, thickness: 0.55, color: '#fbbf24', at: 0 },
    // 상향(방출) — 위와 앞뒤로 겹친다
    { type: 'arrow', origin: [0.16, 0.06, 0.12], dir: [0, 1, 0], length: 0.62, thickness: 0.42, color: '#f87171', at: 0 },
    // 수평 흐름(비교군) — travel>0이라 셰이더가 흘려 보낸다
    { type: 'arrow', origin: [-0.55, 0.34, -0.18], dir: [1, 0, 0.25], length: 0.34, thickness: 0.36, color: '#38bdf8', travel: 0.5, phase: 0.2, speed: 0.25, at: 0 },
    { type: 'label', pos: [-0.22, 0.9, 0], text: '입사', size: 11, weight: 600, color: '#0f172a', at: 0 },
    { type: 'label', pos: [0.16, 0.74, 0.12], text: '방출', size: 11, weight: 600, color: '#0f172a', at: 0 },
  ],
});

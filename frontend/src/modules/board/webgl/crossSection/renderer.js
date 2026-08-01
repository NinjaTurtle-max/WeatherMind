/**
 * renderer — 단면 모식도 WebGL2 렌더러 (R10-C / S2).
 *
 * 성능 계약(§3.2):
 *  - 컨텍스트 1개, **드로우콜 ≤ 32** — 실제 패스는 8개 고정(아래 PASSES 참조).
 *    모든 렌더 요소를 인스턴싱으로 묶어 요소 수가 늘어도 드로우콜은 변하지 않는다.
 *  - 60fps 목표: 정상 상태에서 CPU 버퍼 업로드 0(단계 전환 직후 등장 애니메이션
 *    구간에서만 인스턴스 배열을 재구성한다).
 *  - rAF 생명주기(visibilitychange·IntersectionObserver)는 호출측 컴포넌트가 소유
 *    — realisticEffects.PrecipCanvas 관례를 그대로 답습한다.
 *  - 깊이 버퍼를 쓰지 않고 **고정 카메라 + 시점 깊이 정렬(painter)**로 반투명
 *    볼륨을 합성한다(z-fighting 없음, 카메라가 고정이라 정렬이 항상 정확).
 *
 * 드로우콜 8 = 하늘 1 + 지표 솔리드 1 + 지표 격자 1 + 대기 솔리드 1 +
 *              기류 화살표 1 + 구름·번짐 빌보드 1 + 강수 파티클 1 + 상자 모서리 1
 * (해당 패스의 인스턴스가 0이면 그 드로우콜은 생략되므로 8은 상한이다.)
 */
import {
  createContext, createProgram, createStaticBuffer, createDynamicBuffer, bindInterleaved, rgba,
} from './glCore';
import { isoCamera, projectToPercent, dot, sub } from './camera';
import {
  unitCube, CUBE_VERTS, quadCentered, quadUp, QUAD_VERTS, arrowShape, ARROW_VERTS, groundGrid, boxEdges,
} from './geometry';
import * as S from './shaders';

/** 단계 등장 애니메이션 길이(ms) — 이 구간에서만 인스턴스 배열을 재구성한다 */
export const APPEAR_MS = 520;
/** 강수 파티클 상한 — precipEngine.MAX_PARTICLES(200)와 같은 예산을 따른다 */
export const MAX_PRECIP = 200;
const MAX_GROUND = 8;
const MAX_AIR = 32;
const MAX_BILLBOARD = 40;
const MAX_ARROW = 40;

const SOLID_STRIDE = 16; // center3 size3 taper2 shear2 color4 mode2
const BB_STRIDE = 12; // center3 size2 color4 mode3
const ARROW_STRIDE = 14; // origin3 dir3 span2 color4 anim2
const PRECIP_STRIDE = 10; // origin3 size3 mode4

const GRID_COLOR = rgba('#8fa87b', 0.5);
const GRID_COLOR_NIGHT = rgba('#94a3b8', 0.28);
const EDGE_COLOR = rgba('#64748b', 0.5);
const EDGE_COLOR_NIGHT = rgba('#94a3b8', 0.42);

const visible = (item, step) => item.at <= step && step <= (item.until ?? Infinity);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

/** 단계에 보이는 라벨 + 캔버스 백분율 좌표 — HTML 오버레이가 사용한다 */
export function labelsFor(scene, step, aspect) {
  if (!scene) return [];
  const { vp } = isoCamera(aspect);
  return scene.items
    .filter((it) => it.type === 'label' && visible(it, step))
    .map((it, i) => ({ ...it, key: `${step}-${i}`, ...projectToPercent(vp, it.pos) }));
}

/**
 * WebGL2 렌더러 생성. 컨텍스트·셰이더 실패 시 **null** — 호출측은 SVG로 폴백한다.
 */
export function createRenderer(canvas) {
  const gl = createContext(canvas);
  if (!gl) return null;

  let programs;
  try {
    programs = {
      sky: createProgram(gl, S.SKY_VS, S.SKY_FS, 'sky'),
      solid: createProgram(gl, S.SOLID_VS, S.SOLID_FS, 'solid'),
      line: createProgram(gl, S.LINE_VS, S.LINE_FS, 'line'),
      billboard: createProgram(gl, S.BILLBOARD_VS, S.BILLBOARD_FS, 'billboard'),
      arrow: createProgram(gl, S.ARROW_VS, S.ARROW_FS, 'arrow'),
      precip: createProgram(gl, S.PRECIP_VS, S.PRECIP_FS, 'precip'),
    };
  } catch (err) {
    if (typeof console !== 'undefined') console.warn(String(err?.message ?? err));
    return null;
  }

  // ── 정적 지오메트리 ───────────────────────────────────────────────────────
  const geo = {
    cube: createStaticBuffer(gl, unitCube()),
    quad: createStaticBuffer(gl, quadCentered()),
    quadUp: createStaticBuffer(gl, quadUp()),
    arrow: createStaticBuffer(gl, arrowShape()),
    fullscreen: createStaticBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3])),
    grid: createStaticBuffer(gl, groundGrid()),
    edges: createStaticBuffer(gl, boxEdges()),
  };
  const gridCount = groundGrid().length / 3;
  const edgeCount = boxEdges().length / 3;

  // ── 동적 인스턴스 버퍼 ────────────────────────────────────────────────────
  const cpu = {
    ground: new Float32Array(MAX_GROUND * SOLID_STRIDE),
    air: new Float32Array(MAX_AIR * SOLID_STRIDE),
    bb: new Float32Array(MAX_BILLBOARD * BB_STRIDE),
    arrow: new Float32Array(MAX_ARROW * ARROW_STRIDE),
    precip: new Float32Array(MAX_PRECIP * PRECIP_STRIDE),
  };
  const gpu = {
    ground: createDynamicBuffer(gl, cpu.ground.byteLength),
    air: createDynamicBuffer(gl, cpu.air.byteLength),
    bb: createDynamicBuffer(gl, cpu.bb.byteLength),
    arrow: createDynamicBuffer(gl, cpu.arrow.byteLength),
    precip: createDynamicBuffer(gl, cpu.precip.byteLength),
  };
  const counts = { ground: 0, air: 0, bb: 0, arrow: 0, precip: 0 };

  // ── VAO 구성 ──────────────────────────────────────────────────────────────
  const solidInstanceSpecs = [
    { name: 'iCenter', size: 3, offset: 0 },
    { name: 'iSize', size: 3, offset: 3 },
    { name: 'iTaper', size: 2, offset: 6 },
    { name: 'iShear', size: 2, offset: 8 },
    { name: 'iColor', size: 4, offset: 10 },
    { name: 'iMode', size: 2, offset: 14 },
  ];
  const makeSolidVAO = (buffer) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindInterleaved(gl, programs.solid.prog, geo.cube, [
      { name: 'aPos', size: 3, offset: 0 },
      { name: 'aNormal', size: 3, offset: 3 },
    ], 6);
    bindInterleaved(gl, programs.solid.prog, buffer, solidInstanceSpecs, SOLID_STRIDE, 1);
    gl.bindVertexArray(null);
    return vao;
  };
  const makeLineVAO = (buffer) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindInterleaved(gl, programs.line.prog, buffer, [{ name: 'aPos', size: 3, offset: 0 }], 3);
    gl.bindVertexArray(null);
    return vao;
  };
  const vaos = {
    ground: makeSolidVAO(gpu.ground),
    air: makeSolidVAO(gpu.air),
    grid: makeLineVAO(geo.grid),
    edges: makeLineVAO(geo.edges),
    sky: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.sky.prog, geo.fullscreen, [{ name: 'aPos', size: 2, offset: 0 }], 2);
      gl.bindVertexArray(null);
      return vao;
    })(),
    bb: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.billboard.prog, geo.quad, [{ name: 'aCorner', size: 2, offset: 0 }], 2);
      bindInterleaved(gl, programs.billboard.prog, gpu.bb, [
        { name: 'iCenter', size: 3, offset: 0 },
        { name: 'iSize', size: 2, offset: 3 },
        { name: 'iColor', size: 4, offset: 5 },
        { name: 'iMode', size: 3, offset: 9 },
      ], BB_STRIDE, 1);
      gl.bindVertexArray(null);
      return vao;
    })(),
    arrow: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.arrow.prog, geo.arrow, [{ name: 'aShape', size: 2, offset: 0 }], 2);
      bindInterleaved(gl, programs.arrow.prog, gpu.arrow, [
        { name: 'iOrigin', size: 3, offset: 0 },
        { name: 'iDir', size: 3, offset: 3 },
        { name: 'iSpan', size: 2, offset: 6 },
        { name: 'iColor', size: 4, offset: 8 },
        { name: 'iAnim', size: 2, offset: 12 },
      ], ARROW_STRIDE, 1);
      gl.bindVertexArray(null);
      return vao;
    })(),
    precip: (() => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bindInterleaved(gl, programs.precip.prog, geo.quadUp, [{ name: 'aCorner', size: 2, offset: 0 }], 2);
      bindInterleaved(gl, programs.precip.prog, gpu.precip, [
        { name: 'iOrigin', size: 3, offset: 0 },
        { name: 'iSize', size: 3, offset: 3 },
        { name: 'iMode', size: 4, offset: 6 },
      ], PRECIP_STRIDE, 1);
      gl.bindVertexArray(null);
      return vao;
    })(),
  };

  // ── 상태 ──────────────────────────────────────────────────────────────────
  let scene = null;
  let step = 0;
  let stepAt = 0; // 단계 진입 시각(초)
  let dirty = true;
  let cam = isoCamera();
  let cssW = 0;
  let cssH = 0;
  const stats = { drawCalls: 0, lastDrawCalls: 0, frames: 0, uploads: 0 };

  function setScene(next) {
    scene = next;
    step = 0;
    stepAt = -1;
    dirty = true;
  }
  function setStep(next, nowSec = 0) {
    if (next === step) return;
    step = next;
    stepAt = nowSec;
    dirty = true;
  }

  /** 캔버스 백버퍼 크기를 CSS 크기 × dpr로 맞춘다(리사이즈 시 재계산) */
  function resize() {
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const rect = canvas.getBoundingClientRect?.() ?? { width: canvas.width, height: canvas.height };
    const w = Math.max(1, Math.round((rect.width || 1) * dpr));
    const h = Math.max(1, Math.round((rect.height || 1) * dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    cssW = rect.width || 1;
    cssH = rect.height || 1;
    cam = isoCamera(cssW / Math.max(cssH, 1));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // ── 인스턴스 배열 재구성 ──────────────────────────────────────────────────
  function growOf(item, tSec) {
    if (item.at < step) return 1;
    if (stepAt < 0) return 1; // 최초 프레임(장면 교체 직후)은 즉시 완성
    return easeOut(Math.min(1, Math.max(0, (tSec - stepAt) / (APPEAR_MS / 1000))));
  }

  function pushSolid(arr, n, it, grow) {
    const o = n * SOLID_STRIDE;
    arr[o] = it.center[0]; arr[o + 1] = it.center[1]; arr[o + 2] = it.center[2];
    arr[o + 3] = it.size[0]; arr[o + 4] = it.size[1]; arr[o + 5] = it.size[2];
    arr[o + 6] = it.taper[0]; arr[o + 7] = it.taper[1];
    arr[o + 8] = it.shear[0]; arr[o + 9] = it.shear[1];
    arr[o + 10] = it.color[0]; arr[o + 11] = it.color[1]; arr[o + 12] = it.color[2];
    arr[o + 13] = it.color[3] * (0.25 + 0.75 * grow);
    arr[o + 14] = it.pattern ?? 0; arr[o + 15] = grow;
  }

  function rebuild(tSec) {
    counts.ground = 0; counts.air = 0; counts.bb = 0; counts.arrow = 0; counts.precip = 0;
    if (!scene) return;
    const { eye, forward } = cam;
    const depth = (p) => dot(sub(p, eye), forward);

    const solids = [];
    const bbs = [];
    for (const it of scene.items) {
      if (!visible(it, step)) continue;
      if (it.type === 'solid') solids.push(it);
      else if (it.type === 'billboard') bbs.push(it);
    }
    // 반투명 합성 — 뒤에서 앞으로(고정 카메라라 정렬이 항상 정확)
    solids.sort((a, b) => depth(b.center) - depth(a.center));
    bbs.sort((a, b) => depth(b.center) - depth(a.center));

    for (const it of solids) {
      const isGround = it.layer === 'ground';
      const cap = isGround ? MAX_GROUND : MAX_AIR;
      const key = isGround ? 'ground' : 'air';
      if (counts[key] >= cap) continue;
      pushSolid(cpu[key], counts[key], it, isGround ? 1 : growOf(it, tSec));
      counts[key] += 1;
    }

    for (const it of bbs) {
      if (counts.bb >= MAX_BILLBOARD) break;
      const o = counts.bb * BB_STRIDE;
      const g = growOf(it, tSec);
      cpu.bb[o] = it.center[0]; cpu.bb[o + 1] = it.center[1]; cpu.bb[o + 2] = it.center[2];
      cpu.bb[o + 3] = it.size[0]; cpu.bb[o + 4] = it.size[1];
      cpu.bb[o + 5] = it.color[0]; cpu.bb[o + 6] = it.color[1];
      cpu.bb[o + 7] = it.color[2]; cpu.bb[o + 8] = it.color[3];
      cpu.bb[o + 9] = it.kind; cpu.bb[o + 10] = it.seed; cpu.bb[o + 11] = g;
      counts.bb += 1;
    }

    for (const it of scene.items) {
      if (it.type !== 'arrow' || !visible(it, step) || counts.arrow >= MAX_ARROW) continue;
      const g = growOf(it, tSec);
      const o = counts.arrow * ARROW_STRIDE;
      cpu.arrow[o] = it.origin[0]; cpu.arrow[o + 1] = it.origin[1]; cpu.arrow[o + 2] = it.origin[2];
      cpu.arrow[o + 3] = it.dir[0]; cpu.arrow[o + 4] = it.dir[1]; cpu.arrow[o + 5] = it.dir[2];
      cpu.arrow[o + 6] = it.travel; cpu.arrow[o + 7] = it.scale * g;
      cpu.arrow[o + 8] = it.color[0]; cpu.arrow[o + 9] = it.color[1];
      cpu.arrow[o + 10] = it.color[2]; cpu.arrow[o + 11] = it.color[3] * g;
      cpu.arrow[o + 12] = it.phase; cpu.arrow[o + 13] = it.speed;
      counts.arrow += 1;
    }

    for (const it of scene.items) {
      if (it.type !== 'precip' || !visible(it, step)) continue;
      const n = Math.min(it.count, MAX_PRECIP - counts.precip);
      for (let i = 0; i < n; i += 1) {
        const o = counts.precip * PRECIP_STRIDE;
        cpu.precip[o] = it.origin[0]; cpu.precip[o + 1] = it.origin[1]; cpu.precip[o + 2] = it.origin[2];
        cpu.precip[o + 3] = it.size[0]; cpu.precip[o + 4] = it.size[1]; cpu.precip[o + 5] = it.size[2];
        cpu.precip[o + 6] = (i + 1) * 1.618 + it.origin[0] * 13.7; // seed
        cpu.precip[o + 7] = it.kind;
        cpu.precip[o + 8] = it.slant;
        cpu.precip[o + 9] = it.speed * (0.85 + ((i * 37) % 30) / 100);
        counts.precip += 1;
      }
    }

    for (const key of ['ground', 'air', 'bb', 'arrow', 'precip']) {
      if (counts[key] === 0) continue;
      const stride = key === 'bb' ? BB_STRIDE : key === 'arrow' ? ARROW_STRIDE : key === 'precip' ? PRECIP_STRIDE : SOLID_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu[key]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpu[key], 0, counts[key] * stride);
      stats.uploads += 1;
    }
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  const draws = { arrays: 0, instanced: 0 };
  const drawArrays = (mode, count) => { draws.arrays += 1; gl.drawArrays(mode, 0, count); };
  const drawInstanced = (mode, count, n) => { draws.instanced += 1; gl.drawArraysInstanced(mode, 0, count, n); };

  /** 한 프레임 렌더. @param tSec 초 단위 시간(rAF timestamp/1000) */
  function render(tSec) {
    if (!scene) return 0;
    if (stepAt < 0) stepAt = tSec - APPEAR_MS / 1000;
    const appearing = tSec - stepAt < APPEAR_MS / 1000 + 0.05;
    if (dirty || appearing) {
      rebuild(tSec);
      dirty = false;
    }

    draws.arrays = 0;
    draws.instanced = 0;
    gl.disable(gl.DEPTH_TEST); // 고정 카메라 + 깊이 정렬 합성(painter)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 프리멀티플라이드 알파
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const night = scene.night ? 1 : 0;

    // 1) 하늘
    gl.useProgram(programs.sky.prog);
    gl.uniform4fv(programs.sky.uniforms.uTop, scene.sky.top);
    gl.uniform4fv(programs.sky.uniforms.uBottom, scene.sky.bottom);
    gl.uniform1f(programs.sky.uniforms.uNight, night);
    gl.bindVertexArray(vaos.sky);
    drawArrays(gl.TRIANGLES, 3);

    // 2) 지표 솔리드(지면·바다·토양)
    gl.useProgram(programs.solid.prog);
    gl.uniformMatrix4fv(programs.solid.uniforms.uVP, false, cam.vp);
    gl.uniform1f(programs.solid.uniforms.uTime, tSec);
    if (counts.ground > 0) {
      gl.bindVertexArray(vaos.ground);
      drawInstanced(gl.TRIANGLES, CUBE_VERTS, counts.ground);
    }

    // 3) 지표 격자
    gl.useProgram(programs.line.prog);
    gl.uniformMatrix4fv(programs.line.uniforms.uVP, false, cam.vp);
    gl.uniform4fv(programs.line.uniforms.uColor, night ? GRID_COLOR_NIGHT : GRID_COLOR);
    gl.bindVertexArray(vaos.grid);
    drawArrays(gl.LINES, gridCount);

    // 4) 대기 솔리드(기단 볼륨·전선 슬랩) — 반투명, 뒤에서 앞으로
    if (counts.air > 0) {
      gl.useProgram(programs.solid.prog);
      gl.bindVertexArray(vaos.air);
      drawInstanced(gl.TRIANGLES, CUBE_VERTS, counts.air);
    }

    // 5) 기류 벡터 필드
    if (counts.arrow > 0) {
      gl.useProgram(programs.arrow.prog);
      gl.uniformMatrix4fv(programs.arrow.uniforms.uVP, false, cam.vp);
      gl.uniform3fv(programs.arrow.uniforms.uForward, cam.forward);
      gl.uniform1f(programs.arrow.uniforms.uTime, tSec);
      gl.bindVertexArray(vaos.arrow);
      drawInstanced(gl.TRIANGLES, ARROW_VERTS, counts.arrow);
    }

    // 6) 구름 볼륨·색 번짐·햇빛·안개·섬광
    if (counts.bb > 0) {
      gl.useProgram(programs.billboard.prog);
      gl.uniformMatrix4fv(programs.billboard.uniforms.uVP, false, cam.vp);
      gl.uniform3fv(programs.billboard.uniforms.uRight, cam.right);
      gl.uniform3fv(programs.billboard.uniforms.uUp, cam.up);
      gl.uniform1f(programs.billboard.uniforms.uTime, tSec);
      gl.bindVertexArray(vaos.bb);
      drawInstanced(gl.TRIANGLES, QUAD_VERTS, counts.bb);
    }

    // 7) 강수 파티클
    if (counts.precip > 0) {
      gl.useProgram(programs.precip.prog);
      gl.uniformMatrix4fv(programs.precip.uniforms.uVP, false, cam.vp);
      gl.uniform3fv(programs.precip.uniforms.uRight, cam.right);
      gl.uniform3fv(programs.precip.uniforms.uForward, cam.forward);
      gl.uniform1f(programs.precip.uniforms.uTime, tSec);
      gl.bindVertexArray(vaos.precip);
      drawInstanced(gl.TRIANGLES, QUAD_VERTS, counts.precip);
    }

    // 8) 유리 상자 모서리(교과서 블록 다이어그램 문법)
    gl.useProgram(programs.line.prog);
    gl.uniform4fv(programs.line.uniforms.uColor, night ? EDGE_COLOR_NIGHT : EDGE_COLOR);
    gl.bindVertexArray(vaos.edges);
    drawArrays(gl.LINES, edgeCount);

    gl.bindVertexArray(null);
    stats.lastDrawCalls = draws.arrays + draws.instanced;
    stats.drawCalls += stats.lastDrawCalls;
    stats.frames += 1;
    return stats.lastDrawCalls;
  }

  function dispose() {
    for (const v of Object.values(vaos)) gl.deleteVertexArray(v);
    for (const b of Object.values(gpu)) gl.deleteBuffer(b);
    for (const b of Object.values(geo)) gl.deleteBuffer(b);
    for (const p of Object.values(programs)) gl.deleteProgram(p.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return { gl, setScene, setStep, resize, render, dispose, stats, counts, get step() { return step; } };
}

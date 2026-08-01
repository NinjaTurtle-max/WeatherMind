/**
 * glCore — 지도 오버레이 전용 raw WebGL2 헬퍼 (R10-01 S3 §3.3).
 *
 * **자체 보유 원칙**: FE-1(단면 패널)도 자기 GL 헬퍼를 별도로 갖는다. 웨이브 1
 * 동안 공용 GL 모듈을 신설하지 않는다(두 사람이 같은 파일을 동시에 만들게 된다).
 * 이 파일은 `webgl/mapOverlay/` 안에서만 쓰인다.
 *
 * 외부 라이브러리 0 — three.js 불채택(§0). 셰이더·지오메트리는 전부 절차 생성.
 * 이 파일은 **동적 청크 전용**이다 — 지원 판정(`support.js`)만 정적 import 대상이고,
 * 여기부터는 WebGL2 브라우저가 실제로 오버레이를 볼 때만 내려온다.
 * 모듈 최상위에서 브라우저 API를 만지지 않는다(import만으로 부작용 0).
 */

// ── 셰이더·프로그램 ──────────────────────────────────────────────────────────
/** GLSL ES 3.00 공통 프리앰블 — userSpace(100×80) → clip 변환과 절차 노이즈. */
export const GLSL_COMMON = `#version 300 es
precision highp float;
uniform vec2 u_view;
uniform float u_time;

vec2 toClip(vec2 p) {
  return vec2(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
`;

export class GlInitError extends Error {}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new GlInitError(`shader compile failed: ${log}`);
  }
  return sh;
}

/** vs/fs 소스로 프로그램 링크. 실패 시 GlInitError → 호출측이 폴백으로 내려간다. */
export function createProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new GlInitError(`program link failed: ${log}`);
  }
  return p;
}

// ── 버퍼·VAO ────────────────────────────────────────────────────────────────
/** 인터리브 레이아웃의 float 스트라이드 */
export function strideOf(layout) {
  return layout.reduce((s, a) => s + a.size, 0);
}

/**
 * 인터리브 VBO + VAO 한 벌 생성. layout=[{name,size}] 순서가 곧 메모리 순서.
 * @returns {vao, vbo, stride} stride는 float 개수
 */
export function createMesh(gl, program, layout, dynamic = false) {
  const stride = strideOf(layout);
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  let offset = 0;
  for (const attr of layout) {
    const loc = gl.getAttribLocation(program, attr.name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    offset += attr.size;
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vao, vbo, stride, usage: dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW };
}

/** 메시에 정점 데이터 업로드. @returns 정점 개수 */
export function uploadMesh(gl, mesh, data, floatCount = data.length) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  const view = floatCount === data.length ? data : data.subarray(0, floatCount);
  gl.bufferData(gl.ARRAY_BUFFER, view, mesh.usage);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return floatCount / mesh.stride;
}

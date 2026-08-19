/**
 * glCore — raw WebGL2 최소 헬퍼 (MT-22 모식도).
 *
 * **three.js를 쓰지 않는다.** 이 저장소는 이미 두 번 명시적으로 거절했고 이유가
 * `lib/guideBotMesh.js:4-8`에 적혀 있다 — 여기서 필요한 것도 컨텍스트 생성과
 * 셰이더 컴파일 두 가지뿐이라 라이브러리가 할 일이 없다.
 *
 * **`crossSection/glCore.js`를 import하지 않고 베낀다.** 그 파일이 스스로
 * *"FE-1 전용 자체 보유 헬퍼 · 공용 모듈 신설 시 두 사람이 같은 파일을 만들게 되므로
 * 소량 중복을 의도적으로 허용"*이라고 밝히고 있고, `guideBotMesh.js:15-19`가 같은
 * 판단으로 같은 선택을 했다. 이 모듈은 기존 15개 단면 장면의 외형을 **한 픽셀도**
 * 건드리면 안 되므로 남의 소유 파일을 붙잡지 않는다.
 *
 * **SSR 계약**: 모듈 최상위에서 window·document를 만지지 않는다. 아래 함수들은
 * 호출될 때만 canvas를 만지고, 실패는 예외가 아니라 **null**로 수렴한다.
 */

/** 렌더용 컨텍스트 — 실패 시 null(호출측이 onFail로 올린다). */
export function createContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return (
      canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        // 🔴 깊이 버퍼가 이 모식도의 목적이다 — 입체 화살표는 불투명이고
        // 교차할 때 앞뒤가 가려져야 뜻이 통한다(단면 렌더러는 반투명 합성이라 껐다).
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      }) || null
    );
  } catch {
    return null;
  }
}

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[schematic] ${label} 셰이더 컴파일 실패: ${log}`);
  }
  return sh;
}

/** 프로그램 컴파일 + uniform 위치 캐시 */
export function createProgram(gl, vsSrc, fsSrc, label = 'prog') {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`[schematic] ${label} 프로그램 링크 실패: ${log}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    if (info) uniforms[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

export function createStaticBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

export function createDynamicBuffer(gl, byteLength) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
  return buf;
}

/**
 * 인터리브 버퍼의 속성들을 현재 VAO에 바인딩.
 * @param specs [{ name, size, offset }] — offset은 float 단위
 * @param strideFloats 스트라이드(float 개수)
 * @param divisor 1이면 인스턴스 속성
 */
export function bindInterleaved(gl, prog, buffer, specs, strideFloats, divisor = 0) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = strideFloats * 4;
  for (const spec of specs) {
    const loc = gl.getAttribLocation(prog, spec.name);
    if (loc < 0) continue; // 미사용 속성은 링커가 제거한다
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, spec.size, gl.FLOAT, false, stride, spec.offset * 4);
    if (divisor) gl.vertexAttribDivisor(loc, divisor);
  }
}

/** '#rrggbb'(또는 [r,g,b] 0~1) + alpha → [r,g,b,a] 0~1 */
export function rgba(color, a = 1) {
  if (Array.isArray(color)) {
    return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? a];
  }
  const h = String(color ?? '#ffffff').replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
}

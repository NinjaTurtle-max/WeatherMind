/**
 * glCore — raw WebGL2 최소 헬퍼 (R10-C / S2).
 *
 * 외부 라이브러리 0. 컨텍스트 생성·셰이더 컴파일·인터리브 인스턴스 버퍼 바인딩만
 * 담당한다. **모듈 최상위에서 window/document를 절대 만지지 않는다** — SSR 경로
 * (renderToString)에서 이 모듈이 로드되어도 안전해야 한다(boardVisual.render.test).
 *
 * 이 디렉토리는 FE-1 전용 자체 보유 헬퍼다(웨이브 1 동안 FE-2와 공유하지 않는다 —
 * 공용 모듈 신설 시 두 사람이 같은 파일을 만들게 되므로 소량 중복을 의도적으로 허용).
 *
 * 지원 판정(`supportsWebGL2`)만 `support.js`에 따로 있다 — 메인 번들이 정적으로
 * import하는 유일한 GL 모듈이어야 하기 때문(나머지는 lazy 청크).
 */

/** 실제 렌더용 컨텍스트 — 실패 시 null(호출측이 SVG 폴백으로 내려간다). */
export function createContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return (
      canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
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
    throw new Error(`[crossSection] ${label} 셰이더 컴파일 실패: ${log}`);
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
    throw new Error(`[crossSection] ${label} 프로그램 링크 실패: ${log}`);
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

/** '#rrggbb' + alpha → [r,g,b,a] 0~1 */
export function rgba(hex, a = 1) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
}

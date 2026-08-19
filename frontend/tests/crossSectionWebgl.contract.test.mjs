/**
 * 단면 WebGL 렌더러 성능·정합 상주 가드 (R10-01 웨이브 2 / QA-2)
 *   실행: node tests/crossSectionWebgl.contract.test.mjs   (npm run test:webgl)
 *
 * 왜 필요한가 — S2(FE-1)는 드로우콜 예산을 **일회성 하네스**로만 재보고 남기지
 * 않았다. renderer.js의 성능 계약("컨텍스트 1개, 드로우콜 ≤ 32")은 주석에만 있어
 * 패스를 하나 더 붙이거나 인스턴싱을 풀어도 아무 테스트가 빨개지지 않았다.
 * 또 scenes.SCENES와 CrossSectionPanel.STORYBOARDS의 rule_id 키가 어긋나면
 * buildScene이 null → CrossSectionGL onFail → **조용히 SVG 폴백**으로 떨어진다
 * (3D가 사라져도 렌더 스모크는 초록색이다 — SVG 마크업만 보므로).
 *
 * 고정하는 것:
 *  1) 드로우콜 예산 — 스텁 WebGL2 컨텍스트로 drawArrays/drawArraysInstanced 호출을
 *     **실측 카운트**한다. **전 규칙** × 전 단계 × 등장 애니메이션 구간/정상 상태에서
 *     프레임당 ≤ DRAW_BUDGET(32). 컨텍스트도 1개만 만드는지 확인.
 *     - 공허 통과 방지: createRenderer가 null이 아님 + 프레임당 드로우콜 > 0 +
 *       renderer.stats.lastDrawCalls와 스텁 실측치 일치를 함께 요구한다.
 *  2) 강수 인스턴스 상한 — counts.precip ≤ MAX_PRECIP(200) (precipEngine과 같은 예산)
 *  3) uniform 이름 정합 — 렌더러가 세팅하는 uniform이 셰이더 active uniform에 전부
 *     존재(오타·이름 변경 시 조용히 no-op 되는 것을 잡는다)
 *  4) SCENES ↔ STORYBOARDS 키 1:1 + board_rules.json **전 규칙** 커버 +
 *     3D 아이템의 단계 인덱스(at)가 스토리보드 단계 수를 넘지 않음
 *  5) **컨텍스트 생명주기 — dispose 후 재초기화**(R10-06 실브라우저 결함). 아래 참조.
 *
 * ── 스텁의 한계와 그 보완 (R10-06) ──────────────────────────────────────────
 * 이 가드는 초록색인데 실브라우저(Chrome)에서는 단면이 **한 번도 렌더되지 않았다**.
 * 원인은 스텁이 컨텍스트 생명주기를 모델링하지 않은 것이었다:
 *   - `renderer.dispose()`가 `WEBGL_lose_context.loseContext()`로 컨텍스트를 죽였고,
 *   - StrictMode(dev)의 mount→cleanup→remount에서 2회차 `createRenderer`가
 *     같은 canvas에서 **죽은 컨텍스트**를 받아(getContext는 기존 컨텍스트를 되돌려준다)
 *     셰이더 컴파일이 실패했다(`getShaderInfoLog() === null` → "컴파일 실패: null"),
 *   - 그 결과 onFail → 전 사용자가 SVG 폴백. 3D 캔버스는 DOM에 아예 없었다.
 * 옛 스텁은 `getExtension: () => null`이라 loseContext가 **아무 일도 하지 않았고**,
 * `getShaderParameter: () => true`라 컴파일은 항상 성공했다 → 원리적으로 못 잡는 결함.
 * 보완: 스텁이 `WEBGL_lose_context`를 실제로 구현한다(loseContext 호출 수 계수 +
 * lost 상태에서 getShaderParameter/getShaderInfoLog가 null — 실제 GL 거동).
 * 그 위에서 (a) dispose가 loseContext를 호출하지 않음 (b) dispose 후 같은 캔버스로
 * 재초기화 성공 + 실제 드로우 발생 (c) 소스에 loseContext 부재를 함께 고정한다.
 *
 * vite ssrLoadModule을 쓰는 이유: renderer.js가 확장자 없는 상대 import
 * (`./glCore`)를 쓰므로 순수 node로는 해석되지 않는다. (boardVisual.render.test와
 * 같은 방식 — node_modules 필요.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(resolve(root, '../database/seed/board_rules.json'), 'utf-8'));

/** renderer.js 주석의 성능 계약값. FE-1 실측 최대는 8 — 예산은 여유 포함 상한이다. */
const DRAW_BUDGET = 32;
/** 이 이상이면 "인스턴싱이 풀렸다"는 뜻이므로 예산 미만이어도 경고로 남긴다 */
const EXPECTED_MAX_PASSES = 8;

/**
 * 고장 주입(변이 검증용) — 가드가 공허하지 않음을 증명할 때만 쓴다.
 *   WM_FAULT=drawcalls  스텁 gl이 drawArrays 1회를 5회로 부풀린다
 *                       (렌더러가 패스를 더 그리는 상황과 동일한 관측)
 *   WM_FAULT=scene-key  SCENES 키 하나를 지운 사본으로 정합을 검사한다
 *   WM_FAULT=lose-ctx   dispose 직후 테스트가 직접 loseContext를 부른다
 *                       (= 고쳐지기 전 renderer.dispose()와 동일한 관측 →
 *                          컨텍스트 생명주기 가드가 실제로 빨개지는지 증명)
 */
const FAULT = process.env.WM_FAULT ?? '';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}${detail ? `\n     → ${detail}` : ''}`);
    failed += 1;
  }
};

// ── 스텁 WebGL2 컨텍스트 ─────────────────────────────────────────────────────
// 실제 GL 없이 렌더러를 끝까지 돌린다. 드로우 호출 수·업로드 수를 세고,
// getAttribLocation은 셰이더 소스에 실제로 선언된 속성만 유효 위치를 준다
// (실제 GL의 "미사용 속성은 링커가 제거" 거동을 흉내내 바인딩 경로도 검증).
function createStubGL() {
  const stats = {
    drawArrays: 0, drawInstanced: 0, uploads: 0, uniformMisses: [], contexts: 1,
    // 컨텍스트 생명주기 관측점(R10-06) — loseContext 호출 수와 소실 여부
    loseContextCalls: 0, lost: false,
  };
  let nextId = 1;
  const names = (src, kw) => {
    const out = [];
    const re = new RegExp(`^\\s*${kw}\\s+(?:lowp|mediump|highp\\s+)?\\w+\\s+(\\w+)`, 'gm');
    let m;
    while ((m = re.exec(src))) out.push(m[1]);
    return out;
  };
  const C = {
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406, TRIANGLES: 4, LINES: 1,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, ACTIVE_UNIFORMS: 0x8b86,
    DEPTH_TEST: 0x0b71, BLEND: 0x0be2, ONE: 1, ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
  };
  const gl = {
    ...C,
    stats,
    // 셰이더/프로그램
    createShader: (type) => ({ id: nextId++, type, src: '' }),
    shaderSource: (sh, src) => { sh.src = src; },
    compileShader: () => {},
    // 실제 GL 거동: 컨텍스트가 소실되면 질의가 전부 null이 된다
    // (관측된 실브라우저 증거 "셰이더 컴파일 실패: null"이 정확히 이 경로다)
    getShaderParameter: () => (stats.lost ? null : true),
    getShaderInfoLog: () => (stats.lost ? null : ''),
    deleteShader: () => {},
    createProgram: () => ({ id: nextId++, uniforms: [], attribs: [] }),
    attachShader: (prog, sh) => {
      prog.uniforms.push(...names(sh.src, 'uniform'));
      prog.attribs.push(...names(sh.src, 'in'));
    },
    linkProgram: () => {},
    getProgramParameter: (prog, p) => {
      if (stats.lost) return p === C.ACTIVE_UNIFORMS ? 0 : null;
      return p === C.ACTIVE_UNIFORMS ? prog.uniforms.length : true;
    },
    getProgramInfoLog: () => '',
    getActiveUniform: (prog, i) => ({ name: prog.uniforms[i], size: 1, type: 0 }),
    getUniformLocation: (prog, name) => (prog.uniforms.includes(name) ? { prog: prog.id, name } : null),
    getAttribLocation: (prog, name) => (prog.attribs.includes(name) ? prog.attribs.indexOf(name) : -1),
    useProgram: () => {},
    deleteProgram: () => {},
    // 버퍼/VAO
    createBuffer: () => ({ id: nextId++ }),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => { stats.uploads += 1; },
    deleteBuffer: () => {},
    createVertexArray: () => ({ id: nextId++ }),
    bindVertexArray: () => {},
    deleteVertexArray: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribDivisor: () => {},
    // 상태
    viewport: () => {}, disable: () => {}, enable: () => {}, blendFunc: () => {},
    clearColor: () => {}, clear: () => {},
    // 실제 확장을 구현한다 — 옛 스텁은 null을 돌려주어 loseContext가 no-op이었고,
    // 그래서 실브라우저를 망가뜨린 컨텍스트 소실을 원리적으로 관측할 수 없었다.
    isContextLost: () => stats.lost,
    getExtension: (name) => (name === 'WEBGL_lose_context'
      ? {
          loseContext: () => { stats.loseContextCalls += 1; stats.lost = true; },
          restoreContext: () => { stats.lost = false; },
        }
      : null),
    // uniform — location이 null/undefined면 "실제 GL에서 조용히 무시"되는 상황
    uniform1f: (loc) => { if (!loc) stats.uniformMisses.push('uniform1f'); },
    uniform3fv: (loc) => { if (!loc) stats.uniformMisses.push('uniform3fv'); },
    uniform4fv: (loc) => { if (!loc) stats.uniformMisses.push('uniform4fv'); },
    uniformMatrix4fv: (loc) => { if (!loc) stats.uniformMisses.push('uniformMatrix4fv'); },
    // 드로우 — 여기가 예산 측정점
    drawArrays: () => { stats.drawArrays += FAULT === 'drawcalls' ? 5 : 1; },
    drawArraysInstanced: () => { stats.drawInstanced += FAULT === 'drawcalls' ? 5 : 1; },
  };
  return gl;
}

function createStubCanvas() {
  const gl = createStubGL();
  let ctxRequests = 0;
  return {
    width: 1, height: 1,
    gl,
    get ctxRequests() { return ctxRequests; },
    getContext: (kind) => {
      ctxRequests += 1;
      return kind === 'webgl2' ? gl : null;
    },
    getBoundingClientRect: () => ({ width: 520, height: 300 }),
  };
}

const { createServer } = await import('vite');
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const rendererMod = await server.ssrLoadModule('/src/modules/board/webgl/crossSection/renderer.js');
  const scenesMod = await server.ssrLoadModule('/src/modules/board/webgl/crossSection/scenes.js');
  const panelMod = await server.ssrLoadModule('/src/modules/board/CrossSectionPanel.jsx');
  const { createRenderer, MAX_PRECIP, APPEAR_MS } = rendererMod;
  const { SCENES, buildScene } = scenesMod;
  // 카메라는 **camera.js가 소유한다** — 방위·고도·거리를 여기 베끼면 갈린 순간
  // 이 계약이 거짓을 단정한다(오늘 낡은 수로 겪은 그 형태).
  const { isoCamera } = await server.ssrLoadModule('/src/modules/board/webgl/crossSection/camera.js');
  // 라벨 투영은 **렌더러가 소유한다**(`labelsFor`) — 여기서 투영을 다시 구현하면
  // 갈린 순간 이 계약이 화면과 다른 것을 재게 된다.
  const { labelsFor } = rendererMod;
  const { STORYBOARDS } = panelMod;

  // ── 1) SCENES ↔ STORYBOARDS 키 정합 ───────────────────────────────────────
  const WHO_KEYS =
    'buildScene(ruleId)가 null이면 CrossSectionGL이 onFail로 SVG 스토리보드로 내려간다 — ' +
    '3D 단면이 그 규칙에서 조용히 사라지고 어떤 렌더 스모크도 빨개지지 않는다.';
  const sceneKeys = Object.keys(FAULT === 'scene-key'
    ? Object.fromEntries(Object.entries(SCENES).slice(0, -1))
    : SCENES).sort();
  const storyKeys = Object.keys(STORYBOARDS).sort();
  const ruleKeys = rules.map((r) => r.id).sort();

  check(
    `STORYBOARDS 키 ${storyKeys.length}종 === SCENES 키 ${sceneKeys.length}종 (rule_id 1:1)`,
    sceneKeys.length === storyKeys.length && sceneKeys.every((k, i) => k === storyKeys[i]),
    `SCENES에만: [${sceneKeys.filter((k) => !storyKeys.includes(k))}] / STORYBOARDS에만: [${storyKeys.filter((k) => !sceneKeys.includes(k))}]. ${WHO_KEYS}`,
  );
  check(
    `SCENES가 board_rules.json 전 규칙 커버 (규칙 ${ruleKeys.length}종)`,
    ruleKeys.every((k) => sceneKeys.includes(k)),
    `누락: [${ruleKeys.filter((k) => !sceneKeys.includes(k))}]. ${WHO_KEYS}`,
  );
  for (const id of storyKeys) {
    // buildScene 경로(폴백 판정에 실제로 쓰이는 함수)로도 확인
    check(`buildScene('${id}') 비-null (3D 경로 유지)`, Boolean(buildScene(id)), WHO_KEYS);
  }
  check(
    "buildScene(미지의 rule_id) === null (폴백 계약)",
    buildScene('__no_such_rule__') === null,
  );

  // 3D 아이템의 단계 인덱스가 스토리보드 단계 수를 넘지 않는지
  for (const id of Object.keys(SCENES)) {
    const story = STORYBOARDS[id];
    if (!story) continue;
    const items = buildScene(id)?.items ?? [];
    const maxAt = items.reduce((m, it) => Math.max(m, it.at ?? 0), 0);
    check(
      `장면 최대 단계 at=${maxAt} < 스토리보드 단계 ${story.steps.length}종 — ${id}`,
      maxAt < story.steps.length,
      '단계 수를 넘는 at은 절대 보이지 않는 3D 아이템이다(캡션과 3D 진행이 어긋난다).',
    );
  }

  // ── 2) 드로우콜 예산 ──────────────────────────────────────────────────────
  const WHO_BUDGET =
    'renderer.js 성능 계약(§3.2): 컨텍스트 1개 · 프레임당 드로우콜 ≤ 32. ' +
    '모든 요소를 인스턴싱으로 묶어 요소 수가 늘어도 패스 수는 8로 고정된다. ' +
    '패스를 추가하거나 인스턴싱을 풀면(요소별 드로우) 모바일에서 프레임이 무너진다.';
  const canvas = createStubCanvas();
  const r = createRenderer(canvas);
  check(
    'createRenderer(스텁 WebGL2) 성공 — 렌더 경로를 실제로 통과한다',
    Boolean(r),
    '여기서 null이면 아래 예산 검사가 전부 공허해진다(드로우 0건으로 통과).',
  );
  if (!r) throw new Error('createRenderer가 null — 스텁 계약이 렌더러와 어긋났다.');
  check('WebGL2 컨텍스트 요청 1회 (컨텍스트 1개 계약)', canvas.ctxRequests === 1, `실제 ${canvas.ctxRequests}회. ${WHO_BUDGET}`);

  r.resize();
  const s = canvas.gl.stats;
  const appearSec = APPEAR_MS / 1000;
  let worst = { calls: 0, rule: '', step: -1, t: 0 };
  let framesMeasured = 0;
  let minCalls = Infinity;
  let maxPrecipSeen = 0;

  for (const id of Object.keys(SCENES)) {
    const scene = buildScene(id);
    r.setScene(scene);
    const steps = STORYBOARDS[id]?.steps.length ?? 4;
    let t = 10;
    for (let step = 0; step < steps; step += 1) {
      r.setStep(step, t);
      // 등장 애니메이션 중(재구성 발생) + 정상 상태(업로드 0) 양쪽을 본다
      for (const dt of [0, appearSec * 0.3, appearSec * 0.9, appearSec + 0.5, appearSec + 2]) {
        const before = s.drawArrays + s.drawInstanced;
        const reported = r.render(t + dt);
        const calls = s.drawArrays + s.drawInstanced - before;
        framesMeasured += 1;
        minCalls = Math.min(minCalls, calls);
        maxPrecipSeen = Math.max(maxPrecipSeen, r.counts.precip);
        if (calls > worst.calls) worst = { calls, rule: id, step, t: dt };
        if (calls > DRAW_BUDGET || calls !== reported) {
          check(
            `프레임 드로우콜 ≤ ${DRAW_BUDGET} — ${id} step ${step} (+${dt.toFixed(2)}s)`,
            calls <= DRAW_BUDGET && calls === reported,
            `실측 ${calls}건 / 렌더러 자체 집계 ${reported}건. ${WHO_BUDGET}`,
          );
        }
      }
      t += appearSec + 2.5;
    }
  }

  check(
    `규칙 ${Object.keys(SCENES).length}종 × 전 단계 ${framesMeasured}프레임 모두 드로우콜 ≤ ${DRAW_BUDGET} (실측 최대 ${worst.calls}: ${worst.rule} step ${worst.step})`,
    worst.calls <= DRAW_BUDGET,
    WHO_BUDGET,
  );
  check(
    `프레임당 드로우콜 > 0 (최소 ${minCalls}) — 카운터가 실제로 드로우를 관측한다`,
    minCalls > 0 && Number.isFinite(minCalls),
    '드로우가 0이면 예산 검사는 아무것도 증명하지 않는다(공허 통과).',
  );
  check(
    `인스턴싱 유지 — 최대 드로우콜 ${worst.calls} ≤ 고정 패스 수 ${EXPECTED_MAX_PASSES}`,
    worst.calls <= EXPECTED_MAX_PASSES,
    `${WHO_BUDGET} 예산(32) 안이라도 패스가 8을 넘었다면 인스턴싱이 풀렸다는 신호다.`,
  );
  check(
    `강수 인스턴스 ≤ MAX_PRECIP(${MAX_PRECIP}) — 실측 최대 ${maxPrecipSeen}`,
    maxPrecipSeen <= MAX_PRECIP && MAX_PRECIP === 200,
    'precipEngine.MAX_PARTICLES(200)와 같은 모바일 파티클 예산을 공유한다.',
  );
  check(
    `uniform 이름 정합 — 셰이더 active uniform에 없는 위치로 세팅한 호출 0건 (실제 ${s.uniformMisses.length}건)`,
    s.uniformMisses.length === 0,
    `[${[...new Set(s.uniformMisses)].join(', ')}] — 이름이 어긋나면 실제 GL에서 조용히 no-op이 되어 화면만 이상해진다.`,
  );

  // 정상 상태(등장 애니메이션 종료 후)에는 CPU 버퍼 업로드가 없어야 한다 (60fps 계약)
  {
    const before = s.uploads;
    r.render(1000);
    r.render(1000.016);
    check(
      '정상 상태 2프레임 연속 렌더에서 인스턴스 업로드 0건 (등장 구간에서만 재구성)',
      s.uploads === before,
      `실제 ${s.uploads - before}건. 매 프레임 재구성은 60fps 계약(CPU 업로드 0) 위반이다.`,
    );
  }

  // ── 3) 컨텍스트 생명주기 — dispose 후 재초기화 (R10-06 실브라우저 결함 회귀) ──
  const WHO_LIFECYCLE =
    'dispose()는 GPU 리소스만 반납해야 한다. loseContext로 컨텍스트를 죽이면 같은 <canvas>는 ' +
    '되살아나지 않고(getContext가 죽은 컨텍스트를 되돌려준다), React StrictMode(dev)의 ' +
    'mount→cleanup→remount 2회차가 죽은 컨텍스트로 셰이더를 컴파일해 실패한다 ' +
    '("컴파일 실패: null") → onFail → 전 사용자가 SVG 폴백. 실브라우저에서 3D 캔버스가 ' +
    'DOM에 아예 없었던 R10-06 결함이 정확히 이것이다. 선례: mapOverlay/MapOverlayGL.jsx dispose.';

  r.dispose();
  check(
    'dispose()가 loseContext를 호출하지 않는다 (컨텍스트 살려둔다)',
    canvas.gl.stats.loseContextCalls === 0 && canvas.gl.stats.lost === false,
    `loseContext ${canvas.gl.stats.loseContextCalls}회 호출 / lost=${canvas.gl.stats.lost}. ${WHO_LIFECYCLE}`,
  );

  // 고장 주입: 옛 dispose()와 동일한 관측을 만들어 아래 재초기화 가드가 빨개지는지 증명
  if (FAULT === 'lose-ctx') canvas.gl.getExtension('WEBGL_lose_context').loseContext();

  check('dispose() 2회 호출 안전 (멱등)', (() => { try { r.dispose(); return true; } catch { return false; } })());

  // StrictMode 재마운트 = 같은 canvas에 createRenderer 재호출
  const r2 = createRenderer(canvas);
  check(
    'dispose 후 같은 캔버스로 createRenderer 재성공 (StrictMode 재마운트 경로)',
    Boolean(r2),
    `null 반환 = 셰이더 컴파일 실패 = 컨텍스트가 죽어 있다. ${WHO_LIFECYCLE}`,
  );
  check(
    `재초기화가 같은 컨텍스트를 재사용 (getContext 총 2회 요청, 컨텍스트 객체 동일)`,
    canvas.ctxRequests === 2 && r2?.gl === canvas.gl,
    `ctxRequests=${canvas.ctxRequests}, 동일객체=${r2?.gl === canvas.gl}. 캔버스당 컨텍스트는 1개다.`,
  );
  if (r2) {
    // 재초기화가 형태만 성공한 게 아니라 실제로 그리는지 — 공허 통과 방지
    const firstRule = Object.keys(SCENES)[0];
    r2.setScene(buildScene(firstRule));
    r2.resize();
    const before2 = s.drawArrays + s.drawInstanced;
    const reported2 = r2.render(2000);
    const calls2 = s.drawArrays + s.drawInstanced - before2;
    check(
      `재초기화 렌더러가 실제로 드로우한다 — ${firstRule}: ${calls2}건 (≤ ${DRAW_BUDGET})`,
      calls2 > 0 && calls2 === reported2 && calls2 <= DRAW_BUDGET,
      `실측 ${calls2} / 자체집계 ${reported2}. 재초기화가 성공해도 그리지 못하면 화면은 여전히 비어 있다.`,
    );
    r2.dispose();
  }

  // ── 6) 인스턴스 예산 — **조용히 버려지는 자리가 없다** ─────────────────────
  // 🔴 **2026-08-19 신설.** 드로우콜 예산(위 1)은 **패스 수**를 세고, 여기는
  // **인스턴스 수**를 센다. 둘은 다르다: 인스턴싱이라 볼륨을 몇 개 더 넣어도
  // 드로우콜은 8에서 안 변하는데, `renderer.js`의
  //   `if (counts[key] >= cap) continue;`
  // 가 상한(MAX_GROUND 8 · MAX_AIR 32)을 넘는 것을 **말없이 버린다.**
  // ⇒ 장면에 물체를 더하다 상한을 넘으면 **화면에서 사라지는데 전 시험이
  //    초록**이다. 홍수 3단계가 이미 air 26/32라 여유가 6뿐이다.
  {
    const rendererSrc = readFileSync(resolve(root, 'src/modules/board/webgl/crossSection/renderer.js'), 'utf-8');
    const capOf = (name) => {
      const m = rendererSrc.match(new RegExp(`const ${name} = (\\d+)`));
      return m ? Number(m[1]) : null;
    };
    // 상한은 렌더러가 소유한다 — 여기 숫자를 적으면 갈린다(오늘 낡은 수로 겪은 그 형태).
    const capGround = capOf('MAX_GROUND');
    const capAir = capOf('MAX_AIR');
    check(
      `상한을 렌더러에서 읽었다 (MAX_GROUND=${capGround} · MAX_AIR=${capAir})`,
      Number.isInteger(capGround) && Number.isInteger(capAir),
      'renderer.js에서 MAX_GROUND/MAX_AIR를 못 읽었다 — 이름이 바뀌면 이 검사가 공허해지므로 실패로 둔다.',
    );
    const over = [];
    let worstGround = 0;
    let worstAir = 0;
    for (const id of Object.keys(SCENES)) {
      const items = buildScene(id)?.items ?? [];
      const steps = STORYBOARDS[id]?.length ?? 4;
      for (let step = 0; step < steps; step += 1) {
        let g = 0;
        let a = 0;
        for (const it of items) {
          if (it.type !== 'solid') continue;
          if (step < (it.at ?? 0)) continue;
          if (it.until !== undefined && step > it.until) continue;
          if (it.layer === 'ground') g += 1;
          else a += 1;
        }
        worstGround = Math.max(worstGround, g);
        worstAir = Math.max(worstAir, a);
        if (g > capGround || a > capAir) over.push(`${id} step${step}: ground ${g}/${capGround} · air ${a}/${capAir}`);
      }
    }
    check(
      `solid 인스턴스가 상한 안 (최대 ground ${worstGround}/${capGround} · air ${worstAir}/${capAir})`,
      over.length === 0,
      `상한을 넘는 자리는 renderer.js가 **말없이 버린다** — 화면에서 사라지는데 다른 시험은 초록이다: ${over.join(' / ')}`,
    );
  }

  // ── 7) 홍수 — **잠긴 것이 보이는가**(합성 순서) ────────────────────────────
  // 🔴 **2026-08-19 클라이언트 3차 반려: 「건물 일부가 물에 잠기게」.**
  // 형상만으로는 이미 잠겨 있었다(수면 위로 벽의 절반쯤만 나온다). 안 보인 것은
  // `renderer.js`가 `gl.disable(gl.DEPTH_TEST)`로 **화가 알고리즘**을 쓰면서
  // 물체를 **중심 깊이 하나로** 정렬하기 때문이다 — 큰 물 상자 하나는 각 건물보다
  // 전부 앞이거나 전부 뒤이고, 뒤면 **불투명한 벽이 물을 덮어 수면선이 안 생긴다.**
  // 종전 실측: 앞줄 5채 중 3채 · 차 2대 중 1대가 그 상태였다(자가 절반만 작동).
  // ⇒ 이 단정은 **잠겨야 할 물체마다 그것보다 카메라에 가까운 물 조각이 있는가**를
  //    묻는다. 물 상자를 하나로 되돌리면 빨강이 난다.
  // ⚠️ 「그려진 그림이 잠겨 보인다」를 단정하는 것이 **아니다** — jsdom에 래스터라이저가
  //    없어 그것은 원리적으로 측정 불가다. 여기서 증명되는 것은 **합성 순서가
  //    수면선을 벽에 놓을 수 있는 상태인가**까지다. 최종 판정은 사람이 화면으로 한다.
  {
    const FLOOD = 'flood_risk_saturated_inflow';
    const items = buildScene(FLOOD)?.items ?? [];
    const { eye, forward } = isoCamera();
    const depth = (p) => (p[0] - eye[0]) * forward[0] + (p[1] - eye[1]) * forward[1] + (p[2] - eye[2]) * forward[2];
    const centerOf = (it) => it.center;
    const step = 3;
    const at3 = items.filter((it) => it.type === 'solid' && step >= (it.at ?? 0) && (it.until === undefined || step <= it.until));
    // 물 = 3단계에 등장하고 pattern 3(잔물결)인 지표수. 지하·빗물받이는 y가 음수라 뺀다.
    const water = at3.filter((it) => (it.at ?? 0) === 3 && it.pattern === 3 && centerOf(it)[1] > 0);
    // 🔴 **「쪼개야 한다」던 단정을 뒤집었다**(2026-08-19 7차, 클라이언트:
    //   *"모든 물 렌더링을 앞으로 당기고"*).
    //   3차는 물을 **6조각**으로, 5차는 **2판**으로 쪼개 중심 깊이 정렬을 이겼다.
    //   그때 단정은 「여러 조각으로 나뉘어 있는가」(≥2)였다 — **해법을 계약으로
    //   굳힌 것**이고, 그 해법이 틀렸다. 조각을 늘리는 것은 **원인을 늘려 증상을
    //   덮는 것**이었다(클라이언트: *"레이어를 너무 많이 쌓아서"*).
    //   7차는 **물을 한 판으로 합치고 덮을 것들을 뒤로 보내** 풀었다.
    //   ⇒ 이제 묻는 것은 **조각 수가 아니라 「물이 가장 앞인가」**이고, 그것은
    //     7-b가 묻는다. 여기서는 **한 판이라는 단순함**만 래칫으로 지킨다.
    check(
      `홍수 지표수가 한 판이다 (실측 ${water.length})`,
      water.length === 1,
      '물을 쪼개 정렬을 이기려 하지 말 것 — **덮을 것들을 뒤로 보내는 것**이 답이다. ' +
        '깊이 테스트가 없는 화가 알고리즘에서는 상자가 많을수록 어느 배치도 안전하지 않다.',
    );
    // 잠겨야 할 것 = 3단계 수면(물 조각의 y 상단) 아래에 중심이 있는 도시 물체
    const surfaceTop = Math.max(...water.map((w) => w.center[1] + w.size[1] / 2));
    // 🔴 **침수 구간을 물에서 파생한다**(2026-08-19 5차). 첫 판은 `c[2] < 0.20`을
    //   **하드코딩**했는데, 그것은 4차 배치(고지대가 카메라 쪽)의 값이었다.
    //   5차에서 배치를 뒤집자 **장면은 옳은데 계약이 빨강**이 났다 —
    //   오늘 반복된 「낡은 값 인용」이 계약 안에서 일어난 것이다.
    //   물이 어디 있는지는 물 조각이 안다. 여기 숫자를 적지 않는다.
    const floodZ0 = Math.min(...water.map((w) => w.center[2] - w.size[2] / 2));
    const floodZ1 = Math.max(...water.map((w) => w.center[2] + w.size[2] / 2));
    const inFloodZone = (c) => c[2] > floodZ0 && c[2] < floodZ1;
    // 🔴 **선별식 정정(첫 판이 틀렸다)**: 「**일부** 잠김」은 물체의 **밑면**이
    //   수면 아래라는 뜻이다. 첫 판은 **중심**이 수면 아래인 것만 골라서
    //   **앞줄 건물 5채 중 4채가 빠졌다**(중심 y 0.049~0.064 > 수면 0.046).
    //   벽 절반이 물에 담긴 건물이 「대상 아님」으로 빠지면 이 계약은 헛돈다.
    const submersible = at3.filter((it) => {
      if (water.includes(it)) return false;
      const c = centerOf(it);
      const bottom = c[1] - it.size[1] / 2;
      const top = c[1] + it.size[1] / 2;
      return (
        top > 0 &&                      // 지면 위로 나와 있다(지하·하수는 제외)
        bottom < surfaceTop - 1e-9 &&   // 밑면이 수면 아래 = **일부 잠김**
        inFloodZone(c) &&               // 물의 z 구간 안(고지대는 그 밖이고 마른 채다)
        c[0] > 0.33                     // 도시 구간(풀밭 0.21~0.335 제외)
      );
    });
    const uncovered = submersible.filter((it) => {
      const c = centerOf(it);
      const d = depth(c);
      return !water.some((w) => {
        const wc = w.center;
        const inX = Math.abs(c[0] - wc[0]) <= w.size[0] / 2;
        return inX && depth(wc) < d;
      });
    });
    // 🔴 **자(尺)가 실제로 자 노릇을 하는가** — 변이로 찾은 구멍(2026-08-19).
    //   차를 **아예 지워도** 위 단정들이 전부 초록이었다. 그런데 조사 §Q3의 결론이
    //   *"침수 보도가 쓰는 기준은 **차의 창문선**(60~80 cm)이고 건물은 자로 쓰이지
    //   않는다"*이고, 2차 반려의 정체가 **깊이를 잴 물건이 없어서**였다.
    //   ⇒ 그 장치가 사라지는 것을 잡지 못하면 계약이 결함의 원인을 안 지킨다.
    //
    //   묻는 것 둘: **수면을 걸치는 작은 물체**(= 지붕이 남는다)와 **수면 아래에
    //   온전히 잠긴 작은 물체**(= 창문선 아래가 잠긴다)가 함께 있는가.
    //   「작은」의 기준은 건물과 가르는 것이다 — 차는 높이 0.024~0.030이고
    //   가장 낮은 건물도 0.092다. 0.06은 그 사이의 여유 있는 경계다.
    {
      // 🔴 **높이만 보던 첫 판이 뚫렸다**(2026-08-19 변이③): 물을 창문선 아래로
      //   내려도 초록이었다. **포장면**(y 두께 0.008이지만 폭 0.665 × 깊이 0.295인
      //   판)이 「온전히 잠긴 작은 물체」로 세어졌기 때문이다.
      //   ⇒ 「작은」은 **세 축 전부**로 재야 한다. 자는 **뭉툭한 물체**다 —
      //      차는 0.070 × 0.030 × 0.052이고 가장 낮은 건물도 높이 0.092다.
      const CAR_MAX = [0.12, 0.06, 0.12];
      const compact = (it) => it.size.every((v, i) => v <= CAR_MAX[i]);
      const small = at3.filter((it) => !water.includes(it) && compact(it) && inFloodZone(it.center) && it.center[0] > 0.33);
      const straddling = small.filter((it) => {
        const bottom = it.center[1] - it.size[1] / 2;
        const top = it.center[1] + it.size[1] / 2;
        return bottom < surfaceTop && top > surfaceTop;
      });
      const fullyUnder = small.filter((it) => {
        const top = it.center[1] + it.size[1] / 2;
        const bottom = it.center[1] - it.size[1] / 2;
        return bottom >= 0 && top <= surfaceTop;
      });
      check(
        `침수 깊이의 **자**가 있다 — 수면을 걸치는 부분 ${straddling.length}개 + 온전히 잠긴 부분 ${fullyUnder.length}개`,
        straddling.length >= 1 && fullyUnder.length >= 1,
        '차(창문선 0.034 · 지붕 0.058, 수면 0.046)가 없거나 수면을 걸치지 않는다 — ' +
          '**깊이를 잴 물건이 없으면 사람이 침수를 못 읽는다**(조사 §Q3, 2차 반려의 원인). ' +
          '건물은 침수 깊이의 자로 쓰이지 않는다.',
      );
    }
    check(
      `수면 아래 도시 물체 전부에 **더 가까운** 물 조각이 있다 (대상 ${submersible.length}개)`,
      submersible.length > 0 && uncovered.length === 0,
      submersible.length === 0
        ? '수면 아래 도시 물체를 하나도 못 찾았다 — 대상 선별식이 낡았나? 공허 통과 방지로 실패로 둔다.'
        : `이 물체들은 물보다 카메라에 가까워 **물 위에 그려진다** ⇒ 벽에 수면선이 안 생긴다: ` +
          uncovered.map((it) => `x=${it.center[0].toFixed(3)} y=${it.center[1].toFixed(3)} z=${it.center[2].toFixed(3)}`).join(' / '),
    );
  }

  // ── 7-b) 🔴 **물을 가리는 것이 없는가** ────────────────────────────────────
  // **2026-08-19 클라이언트가 갤러리에서 직접 봤다**:
  //   *"홍수에서 물레이어 위에 건물하고 차량이 있어서 물이 가려지는게 나만 보여?"*
  //
  // 🔴 **4차 계약이 이것을 못 잡았다.** 「잠겨야 할 것마다 **더 가까운 물 조각이
  // 있는가**」만 물었고 **「물보다 더 가까운 것이 있는가」를 묻지 않았다.**
  // 그래서 4차는 고지대(높이 0.080 · alpha 0.94)를 **물 전체 앞**에 세우고도
  // 전 단정이 초록이었다 — 수면이 0.046인데 그보다 높은 불투명 벽이 앞을 막았다.
  //
  // ⚠️ **한 방향만 묻는 단정은 반대 방향으로 자유롭다.** 오늘 네 번째 형태다.
  {
    const FLOOD = 'flood_risk_saturated_inflow';
    const items = buildScene(FLOOD)?.items ?? [];
    const { eye, forward } = isoCamera();
    const depth = (p) => (p[0] - eye[0]) * forward[0] + (p[1] - eye[1]) * forward[1] + (p[2] - eye[2]) * forward[2];
    const step = 3;
    const at3 = items.filter((it) => it.type === 'solid' && step >= (it.at ?? 0) && (it.until === undefined || step <= it.until));
    const water = at3.filter((it) => (it.at ?? 0) === 3 && it.pattern === 3 && it.center[1] > 0);
    const nearestWater = Math.min(...water.map((w) => depth(w.center)));
    // 「가린다」의 조건: 물보다 카메라에 가깝고(먼저가 아니라 **나중에** 그려진다)
    // 반투명이 아니다(alpha ≥ 0.9면 뒤가 안 보인다) + 수면보다 위로 솟아 있다.
    const surfaceTop = Math.max(...water.map((w) => w.center[1] + w.size[1] / 2));
    const blockers = at3.filter((it) => {
      if (water.includes(it)) return false;
      const top = it.center[1] + it.size[1] / 2;
      return depth(it.center) < nearestWater && it.color[3] >= 0.9 && top > surfaceTop;
    });
    check(
      `홍수 3단계에서 물을 가리는 불투명 물체가 없다 (검사 ${at3.length}개)`,
      blockers.length === 0,
      `이 물체들이 **물보다 카메라에 가깝고 불투명하며 수면보다 높다** ⇒ 나중에 그려져 물을 덮는다. ` +
        `깊이 테스트가 없으므로 **잠긴 땅을 카메라 쪽에, 마른 땅을 뒤에** 두어야 한다: ` +
        blockers.map((it) => `x=${it.center[0].toFixed(3)} y=${it.center[1].toFixed(3)} z=${it.center[2].toFixed(3)} h=${it.size[1].toFixed(3)} a=${it.color[3]}`).join(' / '),
    );
  }

  // ── 7-e) 🔴 **잠긴 정도가 여러 단계인가** ────────────────────────────────
  // **2026-08-19 클라이언트가 침수 도판을 참고로 지정**(freepik "FLOOD ISOMETRIC").
  // ⚠️ 따라 그리지 않았다 — 가져온 것은 규약이다.
  //
  // 그 도판에서 **깊이를 읽게 하는 것은 물 색이 아니다** — 「지붕만 남은 집」과
  // 「벽 절반인 집」이 **함께** 있는 것이다. 한 단계만 있으면 「물이 있다」까지만
  // 읽히고 **얼마나 깊은지**는 안 읽힌다. 차(자)는 절대 기준을 주고, **집집마다
  // 다른 잠김**은 상대 기준을 준다 — 둘이 다른 일을 한다.
  //
  // ⚠️ **값이 아니라 분포를 묻는다.** 잠긴 비율의 최대 - 최소가 충분히 벌어졌는가.
  //    특정 높이를 못박으면 더 나은 배치가 빨강이 된다(오늘 「쪼개야 한다」로 겪었다).
  {
    const FLOOD = 'flood_risk_saturated_inflow';
    const items = buildScene(FLOOD)?.items ?? [];
    const step = 3;
    const at3 = items.filter((it) => it.type === 'solid' && step >= (it.at ?? 0) && (it.until === undefined || step <= it.until));
    const water = at3.filter((it) => (it.at ?? 0) === 3 && it.pattern === 3 && it.center[1] > 0);
    const surfaceTop = Math.max(...water.map((w) => w.center[1] + w.size[1] / 2));
    // 건물 = 지표에 서고 높이가 차보다 큰 것(0.06 초과 — 자 계약과 같은 경계)
    const ratios = at3
      .filter((it) => {
        const bottom = it.center[1] - it.size[1] / 2;
        return !water.includes(it) && it.size[1] > 0.06 && Math.abs(bottom) < 1e-6 && it.center[0] > 0.33;
      })
      .map((it) => Math.min(1, (surfaceTop - (it.center[1] - it.size[1] / 2)) / it.size[1]));
    const spread = ratios.length ? Math.max(...ratios) - Math.min(...ratios) : 0;
    const MIN_SPREAD = 0.2;
    check(
      `잠긴 정도가 여러 단계다 — 건물 ${ratios.length}채, 비율 ${ratios.map((r) => `${Math.round(r * 100)}%`).join(' · ')} (편차 ${Math.round(spread * 100)}%p ≥ ${MIN_SPREAD * 100}%p)`,
      ratios.length >= 3 && spread >= MIN_SPREAD,
      ratios.length < 3
        ? `지표에 선 건물이 ${ratios.length}채뿐이다 — 여러 단계를 보일 수 없다.`
        : `건물들이 **비슷한 비율로** 잠겨 있다(편차 ${Math.round(spread * 100)}%p). ` +
          `「지붕만 남은 집」과 「벽 절반인 집」이 함께 있어야 **얼마나 깊은지**가 읽힌다 — ` +
          `한 단계만 있으면 「물이 있다」까지만 읽힌다.`,
    );
  }

  // ── 7-c) 🔴 **라벨이 겹치지 않는가 · 프레임을 넘지 않는가** ────────────────
  // **2026-08-19 클라이언트**: *"글자 렌더링 겹침 확인하고 안 겹치도록"*.
  //
  // 라벨은 GL이 아니라 **SVG `<text>`**로 그려진다(`CrossSectionGL.jsx`):
  //   x = left/100 × 260 · y = top/100 × 150 · fontSize = size × 0.6 · anchor=middle
  // 그래서 겹침은 **화면 좌표에서만** 재진다 — 장면 좌표로는 알 수 없다.
  //
  // ⚠️ **글자 폭은 추정이다**(CJK 1.0em · 그 밖 0.55em · 공백 0.3em). 실제 폰트
  //    메트릭이 아니므로 **절대 판정이 아니라 회귀 감시**로 쓴다. 그래서 아래는
  //    래칫이다 — 「오늘보다 늘지 않는다」. 값을 **올리지 말 것**.
  // ⚠️ 남은 8건 중 **7건이 산불 2장면**이고 그 장면은 다른 조가 쥐고 있다
  //    (`wildfire_risk_dry_gale` 4+2 · `siberian_gale_wildfire` 1). 그 작업이
  //    착지하면 이 값을 내린다.
  {
    const VB_W = 260;
    const VB_H = 150;
    const LABEL_SCALE = 0.6; // CrossSectionGL.jsx가 소유 — 갈리면 이 계산이 거짓
    const isCJK = (c) => /[가-힣ㄱ-ㅎㅏ-ㅣ一-鿿]/.test(c);
    const widthEm = (t) => [...t].reduce((w, c) => w + (c === ' ' ? 0.3 : isCJK(c) ? 1.0 : 0.55), 0);
    const boxOf = (l) => {
      const fs = l.size * LABEL_SCALE;
      const lines = String(l.text).split('\n');
      const w = Math.max(...lines.map(widthEm)) * fs;
      const cx = (l.left / 100) * VB_W;
      const by = (l.top / 100) * VB_H;
      return { x0: cx - w / 2, x1: cx + w / 2, y0: by - fs * 0.8, y1: by + fs * 0.2 + (lines.length - 1) * fs * 1.25 };
    };
    const overlaps = (a, b) =>
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
    let ov = 0;
    let out = 0;
    const floodBad = [];
    for (const id of Object.keys(SCENES)) {
      const scene = buildScene(id);
      const steps = STORYBOARDS[id]?.length ?? 4;
      for (let step = 0; step < steps; step += 1) {
        const boxes = labelsFor(scene, step, VB_W / VB_H).map(boxOf);
        let localOv = 0;
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) if (overlaps(boxes[i], boxes[j])) localOv += 1;
        }
        const localOut = boxes.filter((b) => b.x0 < 0 || b.x1 > VB_W || b.y0 < 0 || b.y1 > VB_H).length;
        ov += localOv;
        out += localOut;
        if (id === 'flood_risk_saturated_inflow' && (localOv || localOut)) floodBad.push(`step${step}: 겹침 ${localOv} · 프레임밖 ${localOut}`);
      }
    }
    // 오늘의 값(래칫) — 내릴 때만 고친다
    // 🔴 8/6 → **2/2로 조인다**(2026-08-19). 이 PR이 산불 라벨을 5→2로 줄여
    //    그 여유를 만들었고, **느슨한 채로 두면 이 PR이 고친 것을 계약이 못 지킨다**
    //    — 되돌림 확인에서 `forestedRidge`의 `until`을 되돌려도 8 안이라 안 울었다.
    //    ⚠️ 값을 **올리지 말 것.** 새 장면이 걸리면 라벨을 걷는 쪽이 답이다.
    const MAX_OVERLAP = 2;
    const MAX_OUTSIDE = 2;
    check(
      `라벨 겹침이 ${MAX_OVERLAP}건을 넘지 않는다 (실측 ${ov})`,
      ov <= MAX_OVERLAP,
      `라벨이 서로 가려 읽을 수 없다. **이 상한을 올리지 말 것** — 좌표를 벌리거나 ` +
        `역할 끝난 라벨을 \`until\`로 걷는다.`,
    );
    check(
      `프레임 밖 라벨이 ${MAX_OUTSIDE}건을 넘지 않는다 (실측 ${out})`,
      out <= MAX_OUTSIDE,
      `라벨이 260×150 뷰박스를 넘어 잘린다.`,
    );
    check(
      `홍수는 겹침·프레임밖이 **0**이다 (PM 소유 장면)`,
      floodBad.length === 0,
      `홍수 라벨이 겹치거나 프레임을 넘었다: ${floodBad.join(' / ')}`,
    );
  }

  // ── 7-d) 🔴 **전선면은 경사면이다** ───────────────────────────────────────
  // **2026-08-19 클라이언트가 교재 도판을 지정**(「정체전선의 3차원 모식도」,
  // 출처 `The Atmosphere`). ⚠️ 도판을 따라 그리지 않았다 — 복제·트레이싱 금지이고
  // 제출물 저작권 위험이다. 가져온 것은 **표준 기상 규약**이고 저작물이 아니다.
  //
  // 규약: **찬 공기는 밀도가 커서 아래에 쐐기로 눕고, 따뜻한 공기는 그 위로
  // 올라탄다. 둘의 경계면(전선면)은 경사면이다** — 수직이면 물리가 아니다.
  // 종전에 이 요구를 지키는 단정이 **0건**이었다: 정체전선의 전선면을 수직으로
  // 되돌리고 두 기단을 같은 높이로 만드는 변이가 **둘 다 통과했다.**
  //
  // 🔴 그리고 이 계약을 세우다 **`front_convergence_flood`의 전선면이 shear
  //    0.020(거의 수직)**임을 찾았다. 나머지 4종은 -0.440 · -0.340 · +0.640 ·
  //    -0.240으로 전부 기울어 있었다 — **분포에서 벗어난 한 장면**이었다.
  //
  // ⚠️ 이것은 **요구**이지 방법이 아니다. 다만 지금은 「경사」를 `shear[0]`으로
  //    표현하므로 그 값을 본다. **경사면을 다른 프리미티브로 표현하게 되면 이
  //    단정을 의도적으로 갱신할 것** — 그때 빨강이 나는 것은 회귀가 아니다.
  {
    const MIN_SLOPE = 0.15; // 전선 5종 중 최소가 0.240이었다 — 여유를 두고 절반 아래
    const flat = [];
    for (const id of Object.keys(SCENES)) {
      for (const it of buildScene(id)?.items ?? []) {
        if (it.type !== 'solid' || it.pattern !== 1) continue; // pattern 1 = frontSlab
        if (Math.abs(it.shear[0]) < MIN_SLOPE) flat.push(`${id} shear=${it.shear[0].toFixed(3)}`);
      }
    }
    check(
      `전선면이 전부 경사면이다 (|shear| ≥ ${MIN_SLOPE})`,
      flat.length === 0,
      `전선면이 수직에 가깝다 — 찬 공기가 아래로 눕고 따뜻한 공기가 위로 올라타는 ` +
        `구조가 그림에서 사라진다: ${flat.join(' / ')}`,
    );
    // 정체전선 — **찬 기단이 따뜻한 기단보다 낮다**(아래에 깔린다)
    const wedges = (buildScene('stationary_front_monsoon')?.items ?? [])
      .filter((it) => it.type === 'solid' && it.taper && it.taper[0] !== 1);
    const cold = wedges.find((w) => w.center[0] < 0.5);
    const warm = wedges.find((w) => w.center[0] >= 0.5);
    check(
      `정체전선에서 찬 기단이 따뜻한 기단보다 낮다 (찬 ${cold ? cold.size[1].toFixed(3) : '?'} < 따뜻 ${warm ? warm.size[1].toFixed(3) : '?'})`,
      Boolean(cold && warm) && cold.size[1] < warm.size[1],
      !cold || !warm
        ? '정체전선에서 두 기단 쐐기를 못 찾았다 — 선별식이 낡았나? 공허 통과 방지로 실패로 둔다.'
        : '두 기단이 같은 높이면 「찬 공기가 **아래에 깔리고** 따뜻한 공기가 **위로 올라탄다」가 ' +
          '보이지 않는다 — 나란히 선 두 덩이가 된다.',
    );
  }

  // ── 8) 장면 복잡도 — **래칫**: 오늘보다 더 쌓을 수 없다 ────────────────────
  // 🔴 **2026-08-19 클라이언트 지적: *"레이어를 너무 많이 쌓아서 그래"*.**
  // 실측이 지적을 뒷받침했다 — 홍수가 20장면 중 **solid 29(2위의 3배)** ·
  // **라벨 누적 10(중앙값의 2배)**로 둘 다 1위였고, 그 더미가 두 결함의 원인이었다:
  //   ⓐ 깊이 테스트 없는 화가 알고리즘에서 **상자가 많을수록 가림이 엉킨다**
  //      (앞줄 5채 중 3채·차 2대 중 1대가 물 위에 그려졌다)
  //   ⓑ 라벨이 누적돼 마지막 단계에 몰린다 → *"글자들이 너무 난잡하다"*
  //
  // ⚠️ **중앙값 배수로 재는 첫 판을 버렸다.** 홍수·산불은 「위험」 복합 장면이라
  //    **정당하게 가장 복잡하다** — 중앙값의 몇 배인가로 재면 그 사실을 벌한다.
  //    그리고 그 상한은 지금 다른 조가 고치는 중인 장면(`wildfire_risk_dry_gale`
  //    라벨 10)을 즉시 빨갛게 만들어 **남의 CI를 막는다.**
  //
  // ⇒ **래칫으로 간다.** 절대 좋은 값을 정하는 것이 아니라 **오늘 값보다 나빠질
  //    수 없게** 못박는다. 개선이 들어오면 그때 이 숫자를 내린다 —
  //    **올리는 것은 답이 아니다**(그때는 표현을 줄이는 것이 답이다).
  {
    // 오늘의 값. 내릴 때만 고친다.
    const RATCHET = {
      // 전 장면 공통 — 오늘의 최악. `wildfire_risk_dry_gale`이 라벨 10이고,
      // 그 장면은 *"주황색 타원으로만 설명하는 게 너무 빈약해"* 반려로 재작업
      // 중이다(다른 조 소유). 그 작업이 착지하면 이 값을 내릴 것.
      anyLabels: 10,
      // 홍수 — 재작성으로 solid **29 → 19 → 15**(7차에서 고지대 슬래브 + 건물
      // 2채 + 물 한 판을 뺐다), 라벨 10 → 5. 되돌리거나 다시 쌓으면 빨강이다.
      floodSolids: 15,
      floodLabels: 5,
    };
    const measure = (id) => {
      const items = buildScene(id)?.items ?? [];
      const steps = STORYBOARDS[id]?.length ?? 4;
      let maxSolid = 0;
      let maxLabel = 0;
      for (let step = 0; step < steps; step += 1) {
        const vis = items.filter((it) => step >= (it.at ?? 0) && (it.until === undefined || step <= it.until));
        maxSolid = Math.max(maxSolid, vis.filter((it) => it.type === 'solid').length);
        maxLabel = Math.max(maxLabel, vis.filter((it) => it.type === 'label').length);
      }
      return { maxSolid, maxLabel };
    };
    const all = Object.keys(SCENES).map((id) => ({ id, ...measure(id) }));
    const overLabels = all.filter((r) => r.maxLabel > RATCHET.anyLabels);
    check(
      `어느 장면도 라벨 ${RATCHET.anyLabels}개를 넘지 않는다 (최대 ${Math.max(...all.map((r) => r.maxLabel))})`,
      overLabels.length === 0,
      `라벨이 누적돼 마지막 단계에 몰리면 판독이 무너진다 — 역할 끝난 라벨은 \`until\`로 걷는다. ` +
        `**이 상한을 올리지 말 것**(표현을 줄이는 것이 답이다): ` +
        overLabels.map((r) => `${r.id} ${r.maxLabel}`).join(' / '),
    );
    const flood = measure('flood_risk_saturated_inflow');
    check(
      `홍수 solid ≤ ${RATCHET.floodSolids} (실측 ${flood.maxSolid}) · 라벨 ≤ ${RATCHET.floodLabels} (실측 ${flood.maxLabel})`,
      flood.maxSolid <= RATCHET.floodSolids && flood.maxLabel <= RATCHET.floodLabels,
      `4차 재작성이 줄인 값(solid 19 · 라벨 5)을 넘었다. 깊이 테스트 없는 합성에서 ` +
        `상자를 늘리면 가림이 다시 엉키고, 라벨을 늘리면 3단계에 몰린다. **줄여서 풀 것.**`,
    );
  }

  // 소스 고정 — 동작 가드가 우회되더라도 loseContext 재도입 자체를 즉시 잡는다
  {
    const rendererSrc = readFileSync(resolve(root, 'src/modules/board/webgl/crossSection/renderer.js'), 'utf-8');
    const code = rendererSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 주석 제외
    check(
      'renderer.js 코드에 loseContext 호출 없음 (주석 언급은 허용)',
      !/loseContext/.test(code),
      `renderer.js가 loseContext를 다시 호출한다. ${WHO_LIFECYCLE}`,
    );
  }

  console.log(`\n· 요약: 프레임 ${framesMeasured}건 측정, 드로우콜 최대 ${worst.calls}/${DRAW_BUDGET}, 강수 인스턴스 최대 ${maxPrecipSeen}/${MAX_PRECIP}, loseContext 호출 ${canvas.gl.stats.loseContextCalls}회`);
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패 — 단면 3D 성능 계약(드로우콜 예산) 또는 rule_id 정합이 깨졌다.`);
  process.exit(1);
}
console.log('OK: 단면 WebGL 드로우콜 예산 + SCENES↔STORYBOARDS 정합 통과');

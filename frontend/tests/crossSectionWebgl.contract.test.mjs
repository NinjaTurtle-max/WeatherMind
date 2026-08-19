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
  const { isoCamera, WORLD } = await server.ssrLoadModule('/src/modules/board/webgl/crossSection/camera.js');
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

  // ══ 7) 홍수 — **요구 축으로 다시 쓴 계약**(2026-08-19 10차) ═══════════════
  //
  // 🔴 **종전 7 · 7-b · 7-e · 7-f는 전제를 잃었다.** 넷 다 *"물은 도시와 나란히
  // 놓인 또 하나의 카드이고, 문제는 어느 카드를 앞에 놓느냐"*를 **단정 안에 박아
  // 두고** 있었다 —
  //   · 7   「잠길 것마다 **더 가까운 물 조각**이 있는가」
  //   · 7-b 「**물보다 가까운** 불투명 물체가 0개인가」
  //   · 7-f 「도시 물체가 **한 깊이**에 있는가」
  // 물이 몸통의 면(`layer: 'ground'`)이 되면 물은 pass 2, 도시는 pass 4라
  // **정렬을 아예 거치지 않는다**(`renderer.js:359` vs `:371`). 「누가 앞이냐」가
  // 사라지므로 저 셋은 **참이든 거짓이든 아무것도 증명하지 않는다.**
  //
  // ⚠️ PM의 교훈을 그대로 적용한다: **「계약이 방법을 못박으면 더 나은 방법이
  //    빨강이 된다. 계약은 요구를 적고 해법을 적지 않아야 한다.」** 실제로 3차·5차의
  //    「물을 **쪼개야** 한다(≥2조각)」가 해법을 굳힌 계약이었고, 7차가 그 해법을
  //    버리자 **옳은 그림이 빨강**이 났다. 같은 실수를 반복하지 않기 위해 아래는
  //    전부 **사람이 화면에서 확인하려는 것**만 묻는다:
  //      A 물이 몸통의 면인가        E 잠긴 정도가 여러 단계인가
  //      B 바닥이 하나로 읽히는가    F 깊이를 잴 자가 있는가
  //      C 도시가 도시로 읽히는가    G 물의 색 계조가 살아 있는가
  //      D 발치가 수면선에서 잘리는가 H 수위를 올리지 않았는가
  //
  // ⚠️ **여기서 증명되는 것은 「기하와 합성이 그 그림을 낼 수 있는 상태인가」까지다.**
  //    jsdom에 래스터라이저가 없고 스텁 GL은 GLSL을 컴파일하지 않는다 —
  //    **아홉 판이 매번 계산은 통과하고 화면에서 틀렸다.** 최종 판정은 사람이 한다.
  {
    const FLOOD = 'flood_risk_saturated_inflow';
    const items = buildScene(FLOOD)?.items ?? [];
    const { eye, forward } = isoCamera();
    const depth = (p) => (p[0] - eye[0]) * forward[0] + (p[1] - eye[1]) * forward[1] + (p[2] - eye[2]) * forward[2];
    /** 화가 알고리즘의 그리는 차례 — 클수록 카메라에 가깝고 **나중에** 그려진다 */
    const order = (it) => -depth(it.center);
    const at = (step) => items.filter((it) => it.type === 'solid'
      && step >= (it.at ?? 0) && (it.until === undefined || step <= it.until));
    const lo = (it, i) => it.center[i] - it.size[i] / 2;
    const hi = (it, i) => it.center[i] + it.size[i] / 2;
    const dry = at(0);
    const wet = at(3);

    // ── 7-A) 🔴 **물은 몸통의 면인가** ──────────────────────────────────────
    // 조사 정정 2의 한 줄: *관례는 홍수를 「장면에 더한 물체」로 그리지 않고
    // 「지면이라는 몸통의 겉모습 변화」로 그린다.* 9차까지 물은 공중의 `air`
    // 카드였고, 그래서 정렬 키 하나로 물과 도시의 앞뒤를 **동시에** 만족시킬 수
    // 없었다(정정 3 실측: 뒷줄 건물 0.7176 > 물 0.4401 > 앞줄 건물 0.3999 —
    // **4차 증상과 9차 증상이 한 장면에 동시에** 있었다).
    //
    // ⚠️ **지표수의 판별에 색·좌표를 쓰지 않는다.** 「윗면이 지표에 닿는 물」이라는
    //    **뜻**으로 고른다 — 땅속 포화대·지하실 물은 지표에 안 닿으므로 저절로 빠지고,
    //    좌표를 옮겨도 선별식이 낡지 않는다(5차에 하드코딩 z로 겪은 실패).
    const surfaceWater = (list) => list.filter((it) => it.pattern === 3 && (it.at ?? 0) === 3 && hi(it, 1) >= 0);
    const water = surfaceWater(wet);
    const airWater = water.filter((it) => it.layer !== 'ground');
    check(
      `홍수 지표수가 **몸통의 면**이다 — ${water.length}장 전부 layer 'ground' (air 물판 ${airWater.length}장)`,
      water.length >= 1 && airWater.length === 0,
      water.length === 0
        ? '3단계에 지표에 닿는 물이 하나도 없다 — 선별식이 낡았나? 공허 통과 방지로 실패로 둔다.'
        : '물이 `air`로 돌아갔다 ⇒ 다시 **정렬에 참여하는 카드**가 된다. 정렬 키에 높이가 '
          + '들어 있어(0.549x + 0.358y + 0.755z) 낮은 물은 구조적으로 뒤로 밀리고, '
          + '카드가 열넷이면 **어떤 순서를 골라도 한쪽은 틀린다**. `layer: \'ground\'`로 둘 것.',
    );

    // ── 7-B) 🔴 **바닥이 하나로 읽히는가** ──────────────────────────────────
    // **2026-08-19 클라이언트**: *"비교대상인 것은 한 레이어에 다 담겨 있지 그래서
    // 그림이 모식을 가리거나 **바닥이 여러 개가 나타나지도 않고**"* — 그리고 실화면에서
    // *"벌써 보이는 것만 3개 레이어?"*(초록 풀밭 · 청록 물 · 갈색 포장).
    //
    // 🔴 원인은 **높이가 다른 수평판이 여럿**이라는 것 하나다. 수평판은 두께가 아니라
    // 깊이 방향 폭이 화면 높이를 만들지만(`Δz·sin21° + Δy·cos21°`), **띠가 몇 장으로
    // 보이느냐를 정하는 것은 윗면의 y**다 — 윗면이 다르면 턱이 생겨 층으로 읽힌다.
    // ⇒ 묻는 것 둘: 바닥 노릇 하는 판이 **전부 몸통(`ground`)에 속하는가**,
    //   그리고 그 **윗면들이 한 높이에 모여 있는가**(= 한 면 위의 색 차이).
    // 이 단정 하나가 지금까지의 「바닥」 결함을 전부 문다 — 4차 고지대 슬래브(h 0.080),
    // 7차까지의 초록 띠·포장면(공중 슬래브), 9차 물판(윗면 0.042).
    {
      const SLAB = (it) => it.size[0] >= 0.15 && it.size[2] >= 0.15 && it.size[1] <= 0.09;
      const slabs = wet.filter(SLAB);
      const floating = slabs.filter((it) => it.layer !== 'ground');
      // 「바닥」 = 윗면이 지표 근처인 판. 토양·포화대는 **땅속 층**이라 바닥이 아니다.
      const tops = slabs.filter((it) => hi(it, 1) >= -0.005).map((it) => hi(it, 1));
      const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
      const SAME_FACE = 0.01;
      check(
        `바닥이 하나로 읽힌다 — 수평판 ${slabs.length}장 전부 몸통(뜬 판 ${floating.length}장) · `
          + `윗면 ${tops.length}개가 한 높이(편차 ${spread.toFixed(3)} ≤ ${SAME_FACE})`,
        slabs.length >= 3 && floating.length === 0 && tops.length >= 3 && spread <= SAME_FACE,
        floating.length > 0
          ? `이 판들이 몸통을 떠나 **지표 위에 뜬 별개 상자**다 ⇒ 화면에서 층으로 읽힌다: `
            + floating.map((it) => `y[${lo(it, 1).toFixed(3)},${hi(it, 1).toFixed(3)}]`).join(' / ')
          : `바닥 노릇 하는 면들의 **윗면 높이가 ${spread.toFixed(3)}만큼 어긋나 있다** ⇒ 턱이 생겨 `
            + `「바닥이 여러 개」로 보인다. 투수↔불투수↔물은 **같은 면 위의 색 차이**여야 한다: `
            + slabs.filter((it) => hi(it, 1) >= -0.005).map((it) => `윗면 ${hi(it, 1).toFixed(3)}`).join(' / '),
      );
    }

    // ── 수면선을 **장면에서 캐낸다**(값을 여기 적지 않는다) ────────────────────
    // 🔴 5차에 침수 구간 z를 **하드코딩**했다가 「장면은 옳은데 계약이 빨강」을 겪었다.
    //   수면선이 어디인지는 장면이 안다 — 도시 물체의 조각들이 **가장 많이 공유하는
    //   경계 y**가 그것이다. 여기 숫자를 적으면 다음 판에서 또 낡는다.
    const inCity = (it) => it.center[0] > 0.33 && it.layer !== 'ground' && it.size[0] < 0.3;
    const city = wet.filter(inCity);
    const share = new Map();
    for (const it of city) {
      for (const y of [lo(it, 1), hi(it, 1)]) {
        if (y <= 0) continue; // 지표 아래 경계(지하·하수)는 수면선이 아니다
        const k = y.toFixed(4);
        share.set(k, (share.get(k) ?? 0) + 1);
      }
    }
    const best = [...share.entries()].sort((a, b) => b[1] - a[1])[0];
    const waterline = best ? Number(best[0]) : NaN;
    const shared = best ? best[1] : 0;

    // ── 7-C) 🔴 **도시가 여전히 도시로 읽히는가** ──────────────────────────
    // 2차 반려가 *"물이 안 잠긴다 — 깊이를 잴 것이 없다"*였고, 10차 도중 클라이언트가
    // 실화면에서 *"건물·차가 안 보입니다"*라고 했다. **잠기게 만들다 도시를 지우는 것**이
    // 이 장면의 상습 실패다(9차는 물로 덮었고, 잘라 없애도 결과는 같다).
    // ⇒ **0단계 도시의 실루엣 최고점이 3단계에도 그대로 남아 있어야 한다.**
    //    발치가 잘리든 물들든 **지붕은 내려오지 않는다** — 지붕이 내려오면 그것은
    //    「잠긴 집」이 아니라 「작아진 집」이고, 사람은 그것을 침수로 안 읽는다.
    {
      const roofs = (list) => {
        const m = new Map();
        for (const it of list.filter(inCity)) {
          const k = it.center[0].toFixed(2);
          m.set(k, Math.max(m.get(k) ?? -Infinity, hi(it, 1)));
        }
        return m;
      };
      const before = roofs(dry);
      const after = roofs(wet);
      const lost = [...before.entries()].filter(([k, y]) => y > 0.02 && Math.abs((after.get(k) ?? -1) - y) > 1e-6);
      check(
        `도시가 도시로 읽힌다 — 0단계 도시 물체 ${before.size}자리의 지붕이 3단계에도 같다 (내려앉은 자리 ${lost.length})`,
        before.size >= 4 && lost.length === 0,
        before.size < 4
          ? `0단계 도시 물체를 ${before.size}자리만 찾았다 — 선별식이 낡았나? 공허 통과 방지로 실패로 둔다.`
          : `이 자리의 지붕이 3단계에 사라지거나 내려앉았다 ⇒ 「잠긴 집」이 아니라 **「작아진 집」·「없어진 집」**이다: `
            + lost.map(([k, y]) => `x=${k} 0단계 ${y.toFixed(3)} → 3단계 ${(after.get(k) ?? -1).toFixed(3)}`).join(' / '),
      );
    }

    // ── 7-D) 🔴 **발치가 수면선에서 잘리는가** ─────────────────────────────
    // 조사 §2⑴이 **답의 전부**라고 적은 것: *"수면선(waterline)이 물체를 가로지르는
    // 것이 메시지다 · 수면선 위는 원색 그대로, 아래만 물빛으로 물든다 · **덮는 것이
    // 아니라 자르는 것이다.**"* 9차는 덮었고 그래서 실패했다.
    //
    // ⚠️ **해법을 묻지 않는다.** 발치를 지우든(잘라내기) 물빛으로 물들이든(침수선)
    //    통과해야 한다 — 묻는 것은 **「수면 높이 위아래로 겉모습이 갈리는가」** 하나다.
    //    그리고 그 높이가 **여러 채에서 같아야** 도시를 가로지르는 한 줄이 된다.
    {
      const tall = dry.filter((it) => inCity(it) && it.size[1] > 0.06);
      const bad = [];
      for (const b of tall) {
        const k = b.center[0].toFixed(2);
        const seg = city.filter((it) => it.center[0].toFixed(2) === k);
        const above = seg.find((it) => lo(it, 1) >= waterline - 1e-6 && hi(it, 1) > waterline);
        const below = seg.find((it) => lo(it, 1) < waterline - 1e-6);
        const changed = !below || below.color.some((v, i) => Math.abs(v - (above?.color[i] ?? -9)) > 1e-6);
        if (!above || !changed) bad.push(`x=${k}`);
      }
      check(
        `발치가 수면선에서 잘린다 — 건물 ${tall.length}채가 같은 높이 ${waterline.toFixed(3)}에서 갈린다(공유 경계 ${shared}개)`,
        tall.length >= 3 && Number.isFinite(waterline) && shared >= 3 && bad.length === 0,
        !Number.isFinite(waterline)
          ? '도시 물체에서 공유되는 수면선을 못 찾았다 — 3단계에 아무것도 안 갈렸다(= 도시가 마른 채다).'
          : `이 건물들이 수면 높이에서 **겉모습이 안 갈린다** ⇒ 마른 채 서 있는 것으로 읽힌다: ${bad.join(' / ')}. `
            + '발치를 지우든 물빛으로 물들이든 좋으나, **수면선 위아래가 달라야** 잠긴 것이 된다.',
      );
    }

    // ── 7-E) 🔴 **잠긴 정도가 여러 단계인가** ─────────────────────────────
    // **클라이언트가 침수 도판을 참고로 지정**(freepik "FLOOD ISOMETRIC"). ⚠️ 따라
    // 그리지 않았다 — 가져온 것은 규약이다. 그 도판에서 **깊이를 읽게 하는 것은 물
    // 색이 아니다** — 「지붕만 남은 집」과 「벽 절반인 집」이 **함께** 있는 것이다.
    // 한 단계만 있으면 「물이 있다」까지만 읽히고 **얼마나 깊은지**는 안 읽힌다.
    // 차(자)는 절대 기준을, 집집마다 다른 잠김은 상대 기준을 준다 — 둘이 다른 일을 한다.
    // ⚠️ **값이 아니라 분포를 묻는다.** 특정 높이를 못박으면 더 나은 배치가 빨강이 된다.
    {
      const ratios = dry
        .filter((it) => inCity(it) && it.size[1] > 0.06 && Math.abs(lo(it, 1)) < 1e-6)
        .map((it) => Math.min(1, (waterline - lo(it, 1)) / it.size[1]));
      const spread = ratios.length ? Math.max(...ratios) - Math.min(...ratios) : 0;
      const MIN_SPREAD = 0.2;
      check(
        `잠긴 정도가 여러 단계다 — 건물 ${ratios.length}채, 비율 ${ratios.map((r) => `${Math.round(r * 100)}%`).join(' · ')} (편차 ${Math.round(spread * 100)}%p ≥ ${MIN_SPREAD * 100}%p)`,
        ratios.length >= 3 && spread >= MIN_SPREAD,
        ratios.length < 3
          ? `지표에 선 건물이 ${ratios.length}채뿐이다 — 여러 단계를 보일 수 없다.`
          : `건물들이 **비슷한 비율로** 잠겨 있다(편차 ${Math.round(spread * 100)}%p). `
            + `「지붕만 남은 집」과 「벽 절반인 집」이 함께 있어야 **얼마나 깊은지**가 읽힌다.`,
      );
    }

    // ── 7-F) 🔴 **깊이를 잴 자가 있는가** ─────────────────────────────────
    // 🔴 **변이로 찾은 구멍**(2026-08-19): 차를 **아예 지워도** 종전 단정이 전부
    //   초록이었다. 그런데 조사 §Q3의 결론이 *"침수 보도가 쓰는 기준은 **차의
    //   창문선**이고 건물은 자로 쓰이지 않는다"*이고, **2차 반려의 정체가 「깊이를
    //   잴 물건이 없어서」**였다. 결함의 원인이던 장치가 사라지는 것을 계약이 못 잡으면
    //   그 계약은 헛돈다.
    // 🔴 **높이만 보던 판이 뚫린 적도 있다** — 넓적한 포장면이 「작은 물체」로 세어졌다.
    //   그래서 **세 축 전부**로 잰다. 특히 z(깊이 방향)가 결정적이다: 차는 0.05,
    //   건물은 0.09라 z만이 둘을 확실히 가른다(높이는 발치가 잘리면 건물도 작아진다).
    {
      const CAR_MAX = [0.12, 0.06, 0.06];
      const ruler = city.filter((it) => it.size.every((v, i) => v <= CAR_MAX[i]));
      const above = ruler.filter((it) => lo(it, 1) >= waterline - 1e-6);
      const below = ruler.filter((it) => hi(it, 1) <= waterline + 1e-6 && lo(it, 1) >= 0);
      const straddles = ruler.length > 0
        && Math.min(...ruler.map((it) => lo(it, 1))) < waterline
        && Math.max(...ruler.map((it) => hi(it, 1))) > waterline;
      const tinted = above.length > 0 && below.length > 0
        && below.some((b) => above.some((a) => a.color.some((v, i) => Math.abs(v - b.color[i]) > 1e-6)));
      check(
        `깊이를 잴 **자**가 있다 — 차 크기 조각 ${ruler.length}개가 수면선을 가로지르고(${straddles}) 위 ${above.length} · 아래 ${below.length}, 색이 갈린다(${tinted})`,
        ruler.length >= 2 && straddles && above.length >= 1 && below.length >= 1 && tinted,
        '차(창문선 0.034 · 지붕 0.058)가 없거나 수면선을 가로지르지 않는다 — '
          + '**깊이를 잴 물건이 없으면 사람이 침수를 못 읽는다**(조사 §Q3, 2차 반려의 원인). '
          + '건물은 침수 깊이의 자로 쓰이지 않고, 자는 **수면 위와 아래가 함께 보여야** 자 노릇을 한다.',
      );
    }

    // ── 7-G) 🔴 **물의 색 계조가 살아 있는가** ────────────────────────────
    // 물에서 두께를 뺀 대가로 **깊이를 높이로 말할 수 없다.** 조사 정정 2가 관례라고
    // 적은 대체 수단이 색이다 — *"깊이 = 색 진하기(가운데 진함 → 가장자리 옅음)"*.
    // ⚠️ `ground`도 자기들끼리는 중심 깊이로 정렬되므로 **진한 쪽이 나중에** 그려져야
    //    한다. 뒤집히면 계조가 사라지는 것이 아니라 **반대로 뒤집힌다** — 화면에서는
    //    「가장자리가 깊다」로 보이고, 어느 시험도 그것을 안 물으면 조용히 통과한다.
    {
      const sorted = [...water].sort((a, b) => a.color[3] - b.color[3]);
      const faint = sorted[0];
      const deep = sorted[sorted.length - 1];
      const nested = water.length >= 2
        && lo(deep, 0) >= lo(faint, 0) - 1e-9 && hi(deep, 0) <= hi(faint, 0) + 1e-9
        && lo(deep, 2) >= lo(faint, 2) - 1e-9 && hi(deep, 2) <= hi(faint, 2) + 1e-9;
      check(
        `물의 색 계조가 살아 있다 — ${water.length}장, alpha ${water.map((w) => w.color[3].toFixed(2)).join(' / ')} · `
          + `진한 쪽이 나중(${order(deep).toFixed(4)} > ${order(faint).toFixed(4)}) · 가운데다(${nested})`,
        water.length >= 2 && deep.color[3] - faint.color[3] >= 0.15 && order(deep) > order(faint) && nested,
        water.length < 2
          ? '지표수가 한 장뿐이라 **깊이를 말할 수단이 없다** — 두께를 뺐으므로 남은 것은 색 계조뿐이다.'
          : `진한 물이 옅은 물보다 **먼저** 그려지거나(순서 ${order(deep).toFixed(4)} vs ${order(faint).toFixed(4)}) `
            + `가장자리에 있다(가운데 ${nested}) ⇒ 계조가 뒤집혀 「가장자리가 깊다」로 보인다.`,
      );
    }

    // ── 7-H) 🔴 **수위를 올려서 해결하지 않았는가** ───────────────────────
    // 이 장면의 아홉 판 중 여럿이 「안 잠겨 보인다」의 답으로 **물을 더 올렸다.**
    // 그런데 수면은 이미 앞줄 건물을 3~6층으로 읽으면 **실척 3.6~10 m**이고,
    // 한국 내수침수위험지도의 **최상위 밴드(3.0 m 이상)를 넘는다.** 더 올리면
    // 홍수가 아니라 해일이 되고, 그러면 **사실이 틀린다.**
    // ⇒ 래칫: 수면선은 6차 값 이하로만. (`H(0.105)` = 0.105 × WORLD.Y)
    {
      const CAP = 0.105 * WORLD.Y;
      check(
        `수위를 올리지 않았다 — 수면선 ${waterline.toFixed(4)} ≤ ${CAP.toFixed(4)} (6차 고정값)`,
        Number.isFinite(waterline) && waterline <= CAP + 1e-9,
        `수면선이 ${waterline.toFixed(4)}로 올라갔다. 「안 잠겨 보인다」의 답은 **물을 올리는 것이 아니다** — `
          + '이미 최상위 위험 밴드를 넘었고, 안 읽히는 이유는 깊이가 아니라 **읽는 장치**(자·수면선·계조)였다.',
      );
    }
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
    const MAX_OVERLAP = 8;
    const MAX_OUTSIDE = 6;
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
      //
      // 🔴 **2026-08-19 10차: 15 → 18로 올린다. 래칫을 올리는 것은 규칙 위반이라
      //   근거를 남긴다.** 위 ⓐ가 *"상자가 많을수록 **가림이 엉킨다**"*고 적었는데,
      //   그 인과가 **끊겼다**: 물이 몸통의 면(`layer: 'ground'`)이 되면서 물과 도시는
      //   서로 다른 패스가 됐고(pass 2 vs 4) **정렬에 함께 참여하지 않는다**. 이
      //   래칫이 막으려던 위험이 더는 상자 수에서 오지 않는다.
      //   늘어난 3은 전부 **한 물체를 수면선에서 가른 조각**이다(건물 3채 × 1 —
      //   차·지하실·빗물받이는 갈라도 총수가 그대로이거나 줄었다). **표현을 늘린 것이
      //   아니라 한 물체에 선을 그은 것**이고, 그 선이 조사 §2⑴이 *"답의 전부"*라고
      //   적은 수면선이다.
      //   ⚠️ 그래도 래칫은 남긴다 — **원인을 늘려 증상을 덮는** 3차(물 6조각)·
      //     4차(물체마다 물 조각)의 습관을 막는 것이 이 숫자의 진짜 일이다.
      //     **다시 올리려는 판이 오면 먼저 의심할 것**: 조각을 늘려 무언가를
      //     이기려 하고 있지 않은가?
      floodSolids: 18,
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

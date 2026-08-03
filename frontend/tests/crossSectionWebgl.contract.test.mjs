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
 *     **실측 카운트**한다. 규칙 8종 × 전 단계 × 등장 애니메이션 구간/정상 상태에서
 *     프레임당 ≤ DRAW_BUDGET(32). 컨텍스트도 1개만 만드는지 확인.
 *     - 공허 통과 방지: createRenderer가 null이 아님 + 프레임당 드로우콜 > 0 +
 *       renderer.stats.lastDrawCalls와 스텁 실측치 일치를 함께 요구한다.
 *  2) 강수 인스턴스 상한 — counts.precip ≤ MAX_PRECIP(200) (precipEngine과 같은 예산)
 *  3) uniform 이름 정합 — 렌더러가 세팅하는 uniform이 셰이더 active uniform에 전부
 *     존재(오타·이름 변경 시 조용히 no-op 되는 것을 잡는다)
 *  4) SCENES ↔ STORYBOARDS 키 1:1 + board_rules.json 8종 커버 +
 *     3D 아이템의 단계 인덱스(at)가 스토리보드 단계 수를 넘지 않음
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
  const stats = { drawArrays: 0, drawInstanced: 0, uploads: 0, uniformMisses: [], contexts: 1 };
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
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => {},
    createProgram: () => ({ id: nextId++, uniforms: [], attribs: [] }),
    attachShader: (prog, sh) => {
      prog.uniforms.push(...names(sh.src, 'uniform'));
      prog.attribs.push(...names(sh.src, 'in'));
    },
    linkProgram: () => {},
    getProgramParameter: (prog, p) => (p === C.ACTIVE_UNIFORMS ? prog.uniforms.length : true),
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
    getExtension: () => null,
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
    `SCENES가 board_rules.json 8종 전부 커버 (${ruleKeys.length}종)`,
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

  r.dispose();
  console.log(`\n· 요약: 프레임 ${framesMeasured}건 측정, 드로우콜 최대 ${worst.calls}/${DRAW_BUDGET}, 강수 인스턴스 최대 ${maxPrecipSeen}/${MAX_PRECIP}`);
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패 — 단면 3D 성능 계약(드로우콜 예산) 또는 rule_id 정합이 깨졌다.`);
  process.exit(1);
}
console.log('OK: 단면 WebGL 드로우콜 예산 + SCENES↔STORYBOARDS 정합 통과');

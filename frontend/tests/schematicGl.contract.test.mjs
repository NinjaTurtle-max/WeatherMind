/**
 * 입체 화살표 모식도 계약 (MT-22) — `node tests/schematicGl.contract.test.mjs`
 *
 * MT-22가 만든 것은 「3D에 놓인 평면 리본」이 아니라 **원기둥 자루 + 원뿔 머리**의
 * 불투명 메시다. 그 차이가 화면에서 뜻을 만드는 지점은 셋뿐이고, 셋 다 여기서
 * **숫자로** 문다(GL도 브라우저도 없이):
 *
 *  ⑴ **메시가 닫혀 있는가** — 자루 끝과 머리 밑면이 같은 높이에서 만나고(구멍 금지),
 *     법선이 전부 단위길이인가(램버트 조명이 뭉개지지 않을 조건).
 *  ⑵ 🔴 **특이점** — 방향이 월드 상방과 평행하면 `cross(d, up)`이 0이 되어
 *     정규화가 NaN이 되고 **수직 화살표가 화면에서 사라진다.** 복사수지(C1)는 입사·
 *     방출이 전부 수직이라 이 분기를 **반드시** 밟는다. 그래서 합성 표본만이 아니라
 *     **실제 출하 장면이 그 분기에 도달하는 항목을 담고 있는지**까지 함께 단정한다.
 *  ⑶ **깊이 테스트가 켜진 채로 그리는가** — 상향·하향이 교차할 때 앞의 것이 뒤를
 *     가려야 「어느 쪽이 나가는 에너지인가」가 읽힌다. 이 과업이 존재하는 이유다.
 *
 * 그 위에 렌더러의 상주 계약을 얹는다: 드로우콜 예산 · uniform 이름 정합 ·
 * **dispose가 loseContext를 부르지 않음 + dispose 후 재초기화**(R10-06 실브라우저
 * 결함) · SSR에서 아무 일도 안 일어남.
 *
 * ── 🔴 이 가드가 못 재는 것 ──────────────────────────────────────────────────
 *  · **셰이더 문법.** 스텁은 GLSL을 컴파일하지 않는다 — `getShaderParameter`가 항상
 *    true다. 오타 하나로 전 사용자가 폴백으로 떨어져도 여기는 초록이다.
 *    **실 WebGL2 컴파일·링크 확인은 실기기(크롬) 하네스가 소유한다.**
 *  · **「입체로 보이는가」.** node에는 픽셀이 없다. 원근·조명·깊이가 실제로 입체로
 *    읽히는지는 사람이 실기기에서 본다 — 이 저장소에 **스텁 초록인데 실브라우저에서
 *    단면이 한 번도 안 뜬** 전례가 있다(R10-06).
 *
 * 관례는 `crossSectionWebgl.contract.test.mjs`를 그대로 답습한다(PASS/FAIL 출력 ·
 * 실패 시 exit 1 · `WM_FAULT` 고장 주입). 다만 **vite가 필요 없다** — 모식도 모듈은
 * 상대 import에 확장자를 붙여서 node가 직접 적재한다.
 *
 * 고장 주입(가드가 공허하지 않음을 증명할 때만 쓴다):
 *   WM_FAULT=cone-normal  뿔 옆면 법선 하나를 1.4배로 부풀린다
 *                         (= 원뿔 법선 공식을 틀리게 쓴 것과 같은 관측)
 *   WM_FAULT=singularity  특이점 대체축이 없는 옛 기저 함수로 바꿔 끼운다
 *   WM_FAULT=thickness    굵기를 제곱근 배분으로 바꾼다(= Sankey 문법 위반)
 *   WM_FAULT=no-depth     스텁 gl이 DEPTH_TEST enable을 삼킨다
 *                         (= 렌더러가 깊이를 안 켠 것과 같은 관측)
 *   WM_FAULT=lose-ctx     dispose 직후 테스트가 직접 loseContext를 부른다
 *                         (= 고쳐지기 전 dispose와 같은 관측)
 *   WM_FAULT=aspect       setScene의 종횡비 되읽기를 **파킹본 그대로** 되돌린 사본을
 *                         만들어 그것으로 렌더러를 세운다(임시 파일은 반드시 지운다)
 *   WM_FAULT=t1-rotation  T1 상층 링의 감김을 하층과 **같게** 만든다
 *                         (= 「회전 방향이 반대」를 못 그린 장면과 같은 관측)
 *   WM_FAULT=t1-maxwind   T1 눈 속 화살표를 가장 굵게 만든다
 *                         (= 「가운데가 제일 세다」로 틀리게 그린 장면)
 *   WM_FAULT=t2-cumulative T2에서 `until`을 걷어낸다(= 시간 전개가 아니라 누적 →
 *                         화면에 태풍이 5마리)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMATIC = resolve(root, 'src/modules/explore/schematic');
const FAULT = process.env.WM_FAULT ?? '';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}${detail ? `\n     → ${detail}` : ''}`);
    failed += 1;
  }
};

// 🔴 SSR 계약의 전제 — 이 파일은 jsdom 없이 돈다. 모듈 최상위에서 window·document를
// 만지면 아래 import가 **여기서 바로 터진다**(그것이 이 테스트의 첫 단정이다).
check('SSR — 러너에 window/document가 없다(전제)', typeof globalThis.window === 'undefined' && typeof globalThis.document === 'undefined');

const mesh = await import(`${SCHEMATIC}/arrowMesh.js`);
const cameraMod = await import(`${SCHEMATIC}/camera.js`);
const rendererMod = await import(`${SCHEMATIC}/renderer.js`);
const sceneMod = await import(`${SCHEMATIC}/radiationScene.js`);
const shaders = await import(`${SCHEMATIC}/shaders.js`);
const t1Mod = await import(`${SCHEMATIC}/typhoonSectionScene.js`);
const t2Mod = await import(`${SCHEMATIC}/typhoonLifecycleScene.js`);

const { arrowMesh3D, arrow3DVertexCount, arrowBasis, ARROW3D_DEFAULTS, PARALLEL_EPS } = mesh;
// WM_FAULT=aspect — 파킹본의 종횡비 되읽기(`cam.aspect ?? ASPECT`)를 되살린 사본으로
// 세운다. 고친 줄을 되돌렸을 때 아래 계약이 실제로 우는지 보이는 유일한 방법이다.
let faultFile = null;
const rendererUnderTest = await (async () => {
  if (FAULT !== 'aspect') return rendererMod;
  faultFile = resolve(SCHEMATIC, '.renderer.fault.mjs');
  const src = readFileSync(resolve(SCHEMATIC, 'renderer.js'), 'utf-8')
    .replace('cam = schematicCamera(aspect, scene?.camera);\n    dirty = true;',
      'cam = schematicCamera(cam.aspect ?? ASPECT, scene?.camera);\n    dirty = true;');
  writeFileSync(faultFile, src);
  return import(faultFile);
})();
process.on('exit', () => { if (faultFile) rmSync(faultFile, { force: true }); });

const { createSchematicRenderer, mountSchematic, labelsFor, MAX_ARROWS, DRAW_BUDGET } = rendererUnderTest;
const {
  RADIATION_SCENE, RADIATION_STEPS, UNITS, thicknessFor, radiationBalance,
  UNIT_THICKNESS, MIN_THICKNESS, FLOOR_UNITS,
} = sceneMod;

// ── ⑴ 메시 — 순수 함수라 값으로 전부 잡힌다 ──────────────────────────────────
const SEG = 16;
const HEAD_L = ARROW3D_DEFAULTS.headLength;
const SHAFT_R = ARROW3D_DEFAULTS.shaftRadius;
const HEAD_R = ARROW3D_DEFAULTS.headRadius;
const raw = arrowMesh3D({ segments: SEG });
// 고장 주입: 뿔 옆면 법선 하나만 부풀린다(공식을 틀리게 쓴 것과 같은 관측)
const verts = FAULT === 'cone-normal' ? (() => {
  const v = Float32Array.from(raw);
  const apex = (SEG - 1) * 15 + 14; // 마지막 분할의 뿔 꼭짓점 정점
  v[apex * 6 + 3] *= 1.4; v[apex * 6 + 4] *= 1.4; v[apex * 6 + 5] *= 1.4;
  return v;
})() : raw;

const count = arrow3DVertexCount(SEG);
check('메시 — 정점 수 = 분할 × 15(자루6 + 꼬리3 + 밑면3 + 뿔3)', count === SEG * 15 && verts.length === count * 6,
  `count=${count} floats=${verts.length}`);
check('메시 — 분할 수는 3~64로 갇힌다', arrow3DVertexCount(1) === 3 * 15 && arrow3DVertexCount(999) === 64 * 15);

let badNormal = null;
let nan = 0;
for (let i = 0; i < count; i += 1) {
  const b = i * 6;
  for (let k = 0; k < 6; k += 1) if (!Number.isFinite(verts[b + k])) nan += 1;
  const n = Math.hypot(verts[b + 3], verts[b + 4], verts[b + 5]);
  if (Math.abs(n - 1) > 1e-6 && badNormal === null) badNormal = { i, n };
}
check('메시 — NaN·Infinity 0개', nan === 0, `${nan}개`);
check('메시 — 법선이 전부 단위길이(조명이 뭉개지지 않을 조건)', badNormal === null,
  badNormal && `정점 ${badNormal.i}의 |n| = ${badNormal.n.toFixed(6)} (기대 1)`);

// 접합 — 자루 윗면과 머리 밑면이 **같은 높이**에 있고 그 사이에 다른 높이가 없다
const ys = new Set();
for (let i = 0; i < count; i += 1) ys.add(Number(verts[i * 6 + 1].toFixed(6)));
const yTop = Number((1 - HEAD_L).toFixed(6));
check('메시 — 높이는 0(꼬리)·1-headLength(접합)·1(촉) 셋뿐', ys.size === 3 && ys.has(0) && ys.has(yTop) && ys.has(1),
  `높이 ${[...ys].sort((a, b) => a - b).join(', ')} (기대 0, ${yTop}, 1)`);
// 접합면에서 자루 반지름 ≤ 머리 반지름이어야 구멍이 안 남는다
let maxShaftR = 0; let maxHeadR = 0;
for (let i = 0; i < count; i += 1) {
  const b = i * 6;
  const r = Math.hypot(verts[b], verts[b + 2]);
  if (Math.abs(verts[b + 1]) < 1e-9) maxShaftR = Math.max(maxShaftR, r);
  if (Math.abs(verts[b + 1] - yTop) < 1e-6) maxHeadR = Math.max(maxHeadR, r);
}
check('메시 — 접합에서 머리 밑면이 자루를 덮는다(구멍 금지)', maxHeadR >= maxShaftR - 1e-9 && Math.abs(maxShaftR - SHAFT_R) < 1e-6,
  `자루 ${maxShaftR.toFixed(4)} / 머리 ${maxHeadR.toFixed(4)}`);
const narrow = arrowMesh3D({ segments: 8, shaftRadius: 0.2, headRadius: 0.05 });
let minHeadRadiusWhenTiny = 0;
for (let i = 0; i < arrow3DVertexCount(8); i += 1) {
  const b = i * 6;
  if (Math.abs(narrow[b + 1] - (1 - HEAD_L)) < 1e-6) {
    minHeadRadiusWhenTiny = Math.max(minHeadRadiusWhenTiny, Math.hypot(narrow[b], narrow[b + 2]));
  }
}
check('메시 — headRadius < shaftRadius면 자루까지 끌어올린다(뚫린 화살표 방지)',
  Math.abs(minHeadRadiusWhenTiny - 0.2) < 1e-6, `머리 반지름 ${minHeadRadiusWhenTiny}`);
check('메시 — 결정적(같은 인자면 바이트 동일)',
  Buffer.from(arrowMesh3D({ segments: SEG }).buffer).equals(Buffer.from(arrowMesh3D({ segments: SEG }).buffer)));
check('메시 — 기본 비율이 「자루 < 머리」다', HEAD_R > SHAFT_R && HEAD_L > 0 && HEAD_L < 1);

// ── ⑵ 🔴 특이점 — 수직 화살표가 사라지지 않는가 ──────────────────────────────
// 고장 주입: 대체축 없이 cross(d, up)만 쓰는 옛 방식(= 이 과업 전의 2D 화살표 관례)
const naiveBasis = (dir) => {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const c = [d[1] * 0 - d[2] * 1, d[2] * 0 - d[0] * 0, d[0] * 1 - d[1] * 0]; // cross(d, [0,1,0])
  const m = Math.hypot(c[0], c[1], c[2]);
  const side = [c[0] / m, c[1] / m, c[2] / m];
  return { d, side, up: [side[1] * d[2] - side[2] * d[1], side[2] * d[0] - side[0] * d[2], side[0] * d[1] - side[1] * d[0]] };
};
const basisFn = FAULT === 'singularity' ? naiveBasis : arrowBasis;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);

for (const [name, dir] of [['수직 상향 [0,1,0]', [0, 1, 0]], ['수직 하향 [0,-1,0]', [0, -1, 0]],
  ['거의 수직 [0.01,1,0]', [0.01, 1, 0]], ['수평 [1,0,0]', [1, 0, 0]], ['비스듬 [0.3,0.8,-0.5]', [0.3, 0.8, -0.5]]]) {
  const { d, side, up } = basisFn(dir);
  const finite = [...d, ...side, ...up].every(Number.isFinite);
  const ortho = finite
    && Math.abs(len(d) - 1) < 1e-9 && Math.abs(len(side) - 1) < 1e-9 && Math.abs(len(up) - 1) < 1e-9
    && Math.abs(dot(d, side)) < 1e-9 && Math.abs(dot(d, up)) < 1e-9 && Math.abs(dot(side, up)) < 1e-9;
  const right = finite && Math.abs(det3(side, d, up) - 1) < 1e-9; // 로컬 (x,y,z) → (side, d, up)
  check(`특이점 — ${name}: 기저가 유한·정규직교·오른손계`, ortho && right,
    finite ? `직교 ${ortho} 오른손 ${right}` : `NaN 발생 — 수직 화살표가 화면에서 사라진다 (side=${side})`);
}
{
  const h = arrowBasis([1, 0, 0]);
  check('특이점 — 수평 방향에서는 up이 월드 상방과 같다(화살표가 눕지 않는다)', Math.abs(h.up[1] - 1) < 1e-9, `up=${h.up}`);
  const zero = arrowBasis([0, 0, 0]);
  check('특이점 — 0벡터·비정상 입력은 +y로 수렴한다(NaN 전파 금지)',
    Math.abs(zero.d[1] - 1) < 1e-9 && [...zero.side, ...zero.up].every(Number.isFinite));
  const nanDir = arrowBasis([Number.NaN, 1, 0]);
  check('특이점 — NaN 입력도 유한한 기저', [...nanDir.d, ...nanDir.side, ...nanDir.up].every(Number.isFinite));
  check('특이점 — 임계값이 실제로 「거의 평행」을 잡는다', PARALLEL_EPS > 0.9 && PARALLEL_EPS < 1);
}

// 🔴 픽스처가 그 분기에 **실제로 도달하는가** — 출하 장면에 수직 화살표가 있는지.
const arrows = RADIATION_SCENE.items.filter((it) => it.type === 'arrow');
const verticalUp = arrows.filter((a) => Math.abs(a.dir[1]) > PARALLEL_EPS && a.dir[1] > 0);
const verticalDown = arrows.filter((a) => Math.abs(a.dir[1]) > PARALLEL_EPS && a.dir[1] < 0);
check('픽스처 — 출하 장면이 특이점 분기에 도달한다(수직 상향·하향 둘 다 존재)',
  verticalUp.length > 0 && verticalDown.length > 0, `상향 ${verticalUp.length} · 하향 ${verticalDown.length}`);
check('픽스처 — 상향과 하향이 같은 단계에 함께 보인다(깊이 테스트가 일하는 배치)',
  RADIATION_STEPS.some((_, s) => verticalUp.some((a) => (a.at ?? 0) <= s) && verticalDown.some((a) => (a.at ?? 0) <= s)));
check('장면 — 화살표는 전부 불투명(반투명이면 깊이가 거짓말을 한다)',
  arrows.every((a) => (a.alpha ?? 1) === 1));

// ── C1 수지 — 그림이 아니라 숫자가 맞아야 한다 ───────────────────────────────
const bal = radiationBalance();
check('C1 — 반사 35 = 구름27 + 눈얼음2 + 대기6', bal.reflected === 35, String(bal.reflected));
check('C1 — 흡수 65 = 대기14 + 지표51', bal.absorbed === 65, String(bal.absorbed));
check('C1 — 입사 100 = 반사 35 + 흡수 65', UNITS.incoming === bal.reflected + bal.absorbed);
check('C1 — 지표 → 대기 34 = 잠열19 + 대류9 + 온실기체6', bal.surfaceToAir === 34, String(bal.surfaceToAir));
check('C1 — OLR 65 = 대기창17 + 대기방출48 ⇒ 흡수와 균형', bal.outgoing === 65 && bal.outgoing === bal.absorbed);

// 굵기 = 에너지 비례(Sankey 문법) — 바닥 위는 정확히 비례, 아래는 전부 같은 값
const thickFn = FAULT === 'thickness' ? (u) => Math.max(MIN_THICKNESS, Math.sqrt(Math.abs(u)) * 0.052) : thicknessFor;
const above = [UNITS.incoming, UNITS.absorbSurface, UNITS.atmosphereIR, UNITS.reflectCloud, UNITS.latent, UNITS.windowIR, UNITS.absorbAir];
const proportional = above.every((u) => Math.abs(thickFn(u) - u * UNIT_THICKNESS) < 1e-12);
check('C1 — 바닥 위 굵기는 에너지에 정확히 비례한다', proportional,
  above.map((u) => `${u}→${thickFn(u).toFixed(4)}(기대 ${(u * UNIT_THICKNESS).toFixed(4)})`).join(' '));
check('C1 — 바닥 아래(2·6·9단위)는 최소 굵기로 잘린다', [2, 6, 9].every((u) => u < FLOOR_UNITS && thickFn(u) === MIN_THICKNESS));
check('C1 — 굵기 순서가 에너지 순서를 뒤집지 않는다',
  [...above].sort((a, b) => a - b).every((u, i, arr) => i === 0 || thickFn(u) >= thickFn(arr[i - 1])));
check('C1 — 100단위의 기준이 340 W/m²다', sceneMod.TOA_INSOLATION_WM2 === 340 && sceneMod.EEI_WM2 === 0.9);

// 라벨 — GL이 아니라 호출측이 그린다. 단계 필터와 좌표가 유한한지만 문다
const l0 = labelsFor(RADIATION_SCENE, 0, 16 / 10);
const lLast = labelsFor(RADIATION_SCENE, RADIATION_STEPS.length - 1, 16 / 10);
check('라벨 — 단계가 오르면 늘어난다(누적)', l0.length > 0 && lLast.length > l0.length, `${l0.length} → ${lLast.length}`);
check('라벨 — 화면 백분율이 유한하다', lLast.every((l) => Number.isFinite(l.left) && Number.isFinite(l.top)));
check('라벨 — 장면이 없으면 빈 배열(예외 아님)', labelsFor(null, 0).length === 0);
check('단계 — 항목의 at이 단계 수를 넘지 않는다',
  RADIATION_SCENE.items.every((it) => (it.at ?? 0) < RADIATION_STEPS.length));

// 카메라 — 원근이어야 한다(직교는 돌려도 평평하다)
{
  const cam = cameraMod.schematicCamera(16 / 10, RADIATION_SCENE.camera);
  check('카메라 — 원근 투영이다(w = -z, 직교면 이 자리가 0이다)', cam.vp[11] !== 0, `vp[11]=${cam.vp[11]}`);
  check('카메라 — 시야각 34°(GuideBot3D와 같은 값)', (RADIATION_SCENE.camera.fov ?? cameraMod.DEFAULT_VIEW.fov) === 34);
  const near = cameraMod.projectToPercent(cam.vp, [0, 0.46, 0.4]);
  const far = cameraMod.projectToPercent(cam.vp, [0, 0.46, -0.4]);
  check('카메라 — 앞뒤가 다른 크기로 잡힌다(원근의 증거)', Math.abs(near.left - far.left) > 1e-6 || Math.abs(near.top - far.top) > 1e-6);
}

// ── ⑶ 렌더러 — 스텁 GL 위에서 관측 ───────────────────────────────────────────
function createStubGL() {
  const stats = {
    drawInstanced: 0, drawArrays: 0, uploads: 0, uniformMisses: [],
    loseContextCalls: 0, lost: false, enabled: new Set(), enabledAtArrowDraw: null, instances: 0,
  };
  let nextId = 1;
  const names = (src, kw) => {
    const out = [];
    const re = new RegExp(`^\\s*${kw}\\s+(?:lowp |mediump |highp )?\\w+\\s+(\\w+)`, 'gm');
    let m;
    while ((m = re.exec(src))) out.push(m[1]);
    return out;
  };
  const C = {
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406, TRIANGLES: 4, LINES: 1,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, ACTIVE_UNIFORMS: 0x8b86,
    DEPTH_TEST: 0x0b71, LEQUAL: 0x0203, CULL_FACE: 0x0b44, BLEND: 0x0be2,
    ONE: 1, ONE_MINUS_SRC_ALPHA: 0x0303, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100,
  };
  const gl = {
    ...C,
    stats,
    createShader: (type) => ({ id: nextId++, type, src: '' }),
    shaderSource: (sh, src) => { sh.src = src; },
    compileShader: () => {},
    getShaderParameter: () => (stats.lost ? null : true), // ⚠️ GLSL을 컴파일하지 않는다
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
    viewport: () => {},
    // 고장 주입 no-depth: enable(DEPTH_TEST)을 삼킨다 = 렌더러가 안 켠 것과 같은 관측
    enable: (cap) => { if (!(FAULT === 'no-depth' && cap === C.DEPTH_TEST)) stats.enabled.add(cap); },
    disable: (cap) => { stats.enabled.delete(cap); },
    depthFunc: () => {}, blendFunc: () => {}, clearColor: () => {}, clear: () => {},
    isContextLost: () => stats.lost,
    getExtension: (name) => (name === 'WEBGL_lose_context'
      ? { loseContext: () => { stats.loseContextCalls += 1; stats.lost = true; }, restoreContext: () => { stats.lost = false; } }
      : null),
    uniform1f: (loc) => { if (!loc) stats.uniformMisses.push('uniform1f'); },
    uniform3fv: (loc) => { if (!loc) stats.uniformMisses.push('uniform3fv'); },
    uniformMatrix4fv: (loc) => { if (!loc) stats.uniformMisses.push('uniformMatrix4fv'); },
    drawArrays: () => { stats.drawArrays += 1; },
    drawArraysInstanced: (mode, first, cnt, inst) => {
      stats.drawInstanced += 1;
      stats.instances = inst;
      // 깊이 테스트는 **화살표를 그리는 그 순간** 켜져 있어야 뜻이 있다
      stats.enabledAtArrowDraw = new Set(stats.enabled);
    },
  };
  return gl;
}
function createStubCanvas() {
  const gl = createStubGL();
  let ctxRequests = 0;
  const listeners = {};
  return {
    width: 1, height: 1, gl,
    get ctxRequests() { return ctxRequests; },
    getContext: (kind) => { ctxRequests += 1; return kind === 'webgl2' ? gl : null; },
    // 종횡비 1.5 — 기본값 ASPECT(1.6)와 **다른 값**이어야 아래 setScene 계약이 공허하지 않다
    getBoundingClientRect: () => ({ width: 600, height: 400 }),
    addEventListener: (t, fn) => { listeners[t] = fn; },
    removeEventListener: (t) => { delete listeners[t]; },
  };
}

{
  const canvas = createStubCanvas();
  const r = createSchematicRenderer(canvas);
  check('렌더러 — 생성된다(공허 통과 방지의 전제)', r !== null);
  r.setScene(RADIATION_SCENE);
  r.resize();
  const last = RADIATION_STEPS.length - 1;
  r.setStep(last);
  const calls = r.render(1.5);
  const st = canvas.gl.stats;
  check('렌더러 — 컨텍스트를 1개만 만든다', canvas.ctxRequests === 1, `${canvas.ctxRequests}회`);
  check('렌더러 — 프레임당 드로우콜 > 0 이고 예산 이내', calls > 0 && calls <= DRAW_BUDGET, `calls=${calls} budget=${DRAW_BUDGET}`);
  check('렌더러 — 렌더러 자기 집계와 스텁 실측이 일치', r.stats.lastDrawCalls === st.drawInstanced + st.drawArrays,
    `renderer=${r.stats.lastDrawCalls} stub=${st.drawInstanced + st.drawArrays}`);
  check('렌더러 — 화살표는 인스턴싱 1콜로 나간다(수십 개여도)', st.drawInstanced === 1 && st.instances === r.counts.arrow,
    `instanced=${st.drawInstanced} inst=${st.instances} counts=${r.counts.arrow}`);
  check('렌더러 — 마지막 단계에서 장면의 화살표가 전부 올라간다',
    r.counts.arrow === arrows.length && r.counts.arrowDropped === 0, `${r.counts.arrow}/${arrows.length}`);
  check('렌더러 — 인스턴스 상한 안', r.counts.arrow <= MAX_ARROWS);
  // 🔴 깊이 테스트 — 이 과업이 존재하는 이유
  check('🔴 깊이 — 화살표를 그리는 순간 DEPTH_TEST가 켜져 있다',
    st.enabledAtArrowDraw?.has(canvas.gl.DEPTH_TEST) === true,
    `그 시점에 켜진 것: ${[...(st.enabledAtArrowDraw ?? [])].map((v) => `0x${v.toString(16)}`).join(',')}`);
  check('렌더러 — uniform 이름이 셰이더의 active uniform과 전부 맞는다(오타 시 조용한 no-op)',
    st.uniformMisses.length === 0, st.uniformMisses.join(','));
  // 정상 상태에서는 CPU 업로드가 없다(단계가 안 바뀌면 uniform만 바뀐다)
  const before = st.uploads;
  r.render(1.6);
  check('렌더러 — 같은 단계 재렌더는 버퍼를 다시 안 올린다(60fps 계약)', st.uploads === before, `${before} → ${st.uploads}`);
  // 단계 필터
  r.setStep(0);
  r.render(1.7);
  check('렌더러 — 0단계는 마지막 단계보다 화살표가 적다', r.counts.arrow < arrows.length && r.counts.arrow > 0, `${r.counts.arrow}`);

  // 종횡비 — setScene이 resize로 잡은 값을 되돌리면 안 된다(파킹본이 그랬다:
  // `cam.aspect ?? ASPECT`인데 cam에 aspect가 없어 매번 16:10으로 되돌아갔다)
  const aspectAfterResize = r.aspect;
  const vpBefore = Array.from(r.camera.vp);
  r.setScene(RADIATION_SCENE);
  r.setStep(last);
  check('종횡비 — 캔버스 실측 비율을 쓴다(기본값이 아니라)', Math.abs(aspectAfterResize - 600 / 400) < 1e-9,
    `${aspectAfterResize}`);
  check('종횡비 — setScene이 그 값을 되돌리지 않는다', Array.from(r.camera.vp).every((v, i) => Math.abs(v - vpBefore[i]) < 1e-9),
    `setScene 전후 투영행렬이 달라졌다 — 다음 resize까지 그림이 눌린다`);

  // ── R10-06: dispose는 컨텍스트를 죽이지 않는다 + 재초기화가 산다 ───────────
  r.dispose();
  if (FAULT === 'lose-ctx') canvas.gl.getExtension('WEBGL_lose_context').loseContext();
  check('생명주기 — dispose가 loseContext를 부르지 않는다', canvas.gl.stats.loseContextCalls === 0,
    `${canvas.gl.stats.loseContextCalls}회 — 죽은 컨텍스트로 재마운트하면 전 사용자가 폴백이다`);
  const r2 = createSchematicRenderer(canvas);
  let reCalls = 0;
  if (r2) { r2.setScene(RADIATION_SCENE); r2.resize(); r2.setStep(last); reCalls = r2.render(0.2); }
  check('생명주기 — dispose 후 같은 캔버스로 재초기화되고 실제로 그린다', r2 !== null && reCalls > 0,
    r2 === null ? '재초기화가 null이다(컴파일 실패 경로)' : `재렌더 드로우콜 ${reCalls}`);
  r2?.dispose();
  r.dispose(); // 멱등 — 두 번 불러도 터지지 않는다
  check('생명주기 — dispose 멱등', true);
}

// 소스 대조 — loseContext가 코드에 아예 없어야 한다(스텁이 못 보는 경로 차단)
{
  const src = ['renderer.js', 'glCore.js'].map((f) => readFileSync(resolve(SCHEMATIC, f), 'utf-8')).join('\n');
  check('생명주기 — 소스에 loseContext 호출이 없다', !/loseContext\s*\(/.test(src));
  check('깊이 — 컨텍스트를 depth:true로 만든다', /depth:\s*true/.test(src));
}

// SSR — window가 없으면 마운트가 조용히 null이고 onFail이 온다
{
  let failCalls = 0;
  const m = mountSchematic(createStubCanvas(), { scene: RADIATION_SCENE, onFail: () => { failCalls += 1; } });
  check('SSR — window 없이 mountSchematic이 예외 없이 null + onFail', m === null && failCalls === 1);
}

// 셰이더 — 스텁이 컴파일하지 않으므로 **여기서는 문자열 계약만** 문다
{
  const vs = shaders.ARROW_VS;
  check('셰이더 — GLSL ES 3.0 선언이 첫 줄', vs.startsWith('#version 300 es'));
  check('셰이더 — 셋째 축을 셰이더에서 만든다(up = cross(side, d))', /cross\s*\(\s*s\s*,\s*d\s*\)/.test(vs));
  check('셰이더 — 난수·텍스처 0(결정적 그림)', !/random|texture\s*\(/i.test(vs + shaders.ARROW_FS));
  check('셰이더 — 램버트 조명이 있다(단색이면 입체가 안 읽힌다)', /dot\s*\(\s*n\s*,\s*L\s*\)/.test(shaders.ARROW_FS));
}

// ═══════════════════════════════════════════════════════════════════════════
//  T1 태풍 단면 — 🔴 **틀리게 그리면 틀린 것을 가르치는** 두 사실을 값으로 문다
// ═══════════════════════════════════════════════════════════════════════════
const { TYPHOON_SECTION_SCENE, T1_STEPS, T1_FACTS, KM_PER_UNIT, rightOfMotion, MOTION_DIR, tangent } = t1Mod;

// 고장 주입 — 장면 사본을 틀리게 만든다(저작자가 틀리게 그린 것과 같은 관측)
const t1Scene = (() => {
  if (FAULT === 't1-rotation') {
    return { ...TYPHOON_SECTION_SCENE, items: TYPHOON_SECTION_SCENE.items.map((it) => (it.ring && it.origin[1] >= 0.4
      ? { ...it, spin: +1, dir: [-it.dir[0], 0, -it.dir[2]] } : it)) };
  }
  if (FAULT === 't1-maxwind') {
    return { ...TYPHOON_SECTION_SCENE, items: TYPHOON_SECTION_SCENE.items.map((it) => (it.type === 'arrow'
      && Math.hypot(it.origin[0], it.origin[2]) < 0.02 ? { ...it, thickness: 2 } : it)) };
  }
  return TYPHOON_SECTION_SCENE;
})();
const t1Arrows = t1Scene.items.filter((it) => it.type === 'arrow');
const radiusKm = (a) => Math.hypot(a.origin[0], a.origin[2]) * KM_PER_UNIT;

// ① 최대 풍속은 **눈벽**(중심에서 40~100km)이지 중심이 아니다
const strongest = t1Arrows.reduce((m, a) => (a.thickness > m.thickness ? a : m), t1Arrows[0]);
check('🔴 T1 — 가장 굵은(=가장 센) 화살표가 눈벽 반지름 40~100km에 있다',
  radiusKm(strongest) >= T1_FACTS.maxWindInnerKm && radiusKm(strongest) <= T1_FACTS.maxWindOuterKm,
  `가장 굵은 화살표가 중심에서 ${radiusKm(strongest).toFixed(0)}km에 있다 — 「가운데가 제일 세다」는 틀린 그림이다`);
const eyeArrows = t1Arrows.filter((a) => radiusKm(a) < T1_FACTS.eyeRadiusKm);
check('🔴 T1 — 눈 속 화살표가 눈벽보다 가늘다(눈은 약풍·하강기류)',
  eyeArrows.length > 0 && Math.max(...eyeArrows.map((a) => a.thickness)) < strongest.thickness,
  `눈 속 최대 ${Math.max(...eyeArrows.map((a) => a.thickness))} ↔ 눈벽 ${strongest.thickness}`);
check('T1 — 눈 속에 하강 화살표가 있다(dir.y < 0)', eyeArrows.some((a) => a.dir[1] < -0.9));

// ② 하층 반시계 · 상층 시계 — **감김이 반대**여야 한다
const lowRing = t1Arrows.filter((a) => a.ring && a.origin[1] < 0.4);
const highRing = t1Arrows.filter((a) => a.ring && a.origin[1] >= 0.4);
const spinOf = (a) => {
  // 실제 방향벡터로 감김을 되잰다(주석이 아니라 좌표가 증거다):
  // (ŷ × p) · dir 의 부호 — 양수면 위에서 봤을 때 반시계
  const p = [a.origin[0], 0, a.origin[2]];
  const t = [p[2], 0, -p[0]];
  return Math.sign(t[0] * a.dir[0] + t[2] * a.dir[2]);
};
const lowSpins = new Set(lowRing.map(spinOf));
const highSpins = new Set(highRing.map(spinOf));
check('T1 — 링이 두 층 모두 실재한다(공허 통과 방지)', lowRing.length >= 8 && highRing.length >= 8,
  `하층 ${lowRing.length} · 상층 ${highRing.length}`);
check('🔴 T1 — 하층은 반시계(위에서 볼 때)', lowSpins.size === 1 && lowSpins.has(1), `부호 ${[...lowSpins]}`);
check('🔴 T1 — 상층은 시계 — 하층과 **반대**다', highSpins.size === 1 && highSpins.has(-1), `부호 ${[...highSpins]}`);
{
  // 좌표로 한 번 더: 동쪽(+x)에 선 하층 화살표는 **북(-z)**으로 흘러야 반시계다
  const east = lowRing.reduce((m, a) => (a.origin[0] > m.origin[0] ? a : m), lowRing[0]);
  const eastUp = highRing.reduce((m, a) => (a.origin[0] > m.origin[0] ? a : m), highRing[0]);
  check('T1 — 동쪽 하층 화살표가 북쪽(-z)으로 흐른다', east.dir[2] < -0.3, `dir.z=${east.dir[2].toFixed(2)}`);
  check('T1 — 동쪽 상층 화살표는 남쪽(+z)으로 흐른다(반대 감김의 좌표 증거)', eastUp.dir[2] > 0.3, `dir.z=${eastUp.dir[2].toFixed(2)}`);
}

// ③ 위험반원 — 진행 방향 **오른쪽**이 더 세다
{
  const right = rightOfMotion();
  check('T1 — 오른쪽 단위벡터가 진행 방향과 직교하고 화면 오른편이다',
    Math.abs(right[0] * MOTION_DIR[0] + right[2] * MOTION_DIR[2]) < 1e-9 && right[0] > 0);
  const side = (a) => (a.origin[0] * right[0] + a.origin[2] * right[2]);
  const r = lowRing.filter((a) => side(a) > 0.2);
  const l = lowRing.filter((a) => side(a) < -0.2);
  check('🔴 T1 — 위험반원(오른쪽)이 반대쪽보다 굵다(비대칭이 구조의 일부)',
    r.length > 0 && l.length > 0 && Math.max(...r.map((a) => a.thickness)) > Math.max(...l.map((a) => a.thickness)),
    `오른쪽 ${Math.max(...r.map((a) => a.thickness)).toFixed(2)} ↔ 왼쪽 ${Math.max(...l.map((a) => a.thickness)).toFixed(2)}`);
}
check('T1 — 수직 화살표(특이점 분기)를 담고 있다', t1Arrows.some((a) => Math.abs(a.dir[1]) > 0.99));
check('T1 — 축척이 조사값과 맞는다(눈 25km · 구름 꼭대기 12~20km)',
  T1_FACTS.eyeRadiusKm * 2 >= 20 && T1_FACTS.eyeRadiusKm * 2 <= 50 && T1_FACTS.cloudTopKm >= 12 && T1_FACTS.cloudTopKm <= 20);
check('T1 — 접선 함수의 부호 규약이 문서대로다', tangent(0, 1)[2] < 0 && tangent(0, -1)[2] > 0);

// ═══════════════════════════════════════════════════════════════════════════
//  T2 태풍의 생애 — 🔴 **시간 전개**가 렌더러 계약 안에서 성립하는가
// ═══════════════════════════════════════════════════════════════════════════
const { TYPHOON_LIFECYCLE_SCENE, T2_STEPS, T2_STAGES, t2Checks, zOfLat, speedLen } = t2Mod;
const t2Scene = FAULT === 't2-cumulative'
  ? { ...TYPHOON_LIFECYCLE_SCENE, items: TYPHOON_LIFECYCLE_SCENE.items.map(({ until, ...rest }) => rest) }
  : TYPHOON_LIFECYCLE_SCENE;
const visibleAt = (scene, step) => scene.items.filter((it) => (it.at ?? 0) <= step && step <= (it.until ?? Infinity));

{
  // 🔴 이 그림의 성립 조건: **한 단계에 태풍은 하나**. 누적이면 태풍이 5마리가 된다
  const perStep = T2_STEPS.map((_, s) => new Set(visibleAt(t2Scene, s).filter((it) => it.storm).map((it) => it.storm)).size);
  check('🔴 T2 — 단계마다 태풍이 정확히 하나다(시간 전개이지 누적이 아니다)',
    perStep.every((n) => n === 1), `단계별 태풍 수 ${perStep.join(',')} — 2 이상이면 지난 단계가 안 사라진 것이다`);
  // 경로는 반대로 **쌓여야** 한다(지나온 길이 남는다)
  const track = T2_STEPS.map((_, s) => visibleAt(t2Scene, s).filter((it) => it.track).length);
  check('T2 — 지나온 경로는 누적된다', track.every((n, i) => i === 0 || n > track[i - 1]), track.join(','));
  check('T2 — 단계 수와 조사의 생애 단계가 맞는다(형성·발달·최성/전향·가속·ET)',
    T2_STEPS.length === 5 && T2_STAGES[T2_STAGES.length - 1].key === 'et');
}
{
  const c = t2Checks();
  check('🔴 T2 — 전향은 북위 20~30° 사이에서 일어난다', c.recurveLat >= 20 && c.recurveLat <= 30, `${c.recurveLat}°`);
  check('🔴 T2 — 전향 때 정체(가장 짧은 이동) → 전향 후 급가속(가장 긴 이동)',
    c.stallLen < c.growLen && c.growLen < c.accelLen,
    `정체 ${c.stallLen.toFixed(3)} · 발달 ${c.growLen.toFixed(3)} · 가속 ${c.accelLen.toFixed(3)}`);
  check('T2 — 이동 화살표 길이가 속도(km/h)에 비례한다', Math.abs(speedLen(40) / speedLen(20) - 2) < 1e-9);
  check('T2 — 세력의 키가 최성기에서 최대다',
    T2_STAGES[2].height === Math.max(...T2_STAGES.map((s) => s.height)));
  check('T2 — 회전은 북반구 저기압성(반시계) 하나뿐', c.spins.length === 1 && c.spins[0] === 1);
  check('T2 — 위도가 커질수록 북(-z)으로 간다', zOfLat(40) < zOfLat(20) && zOfLat(20) < zOfLat(10));
  check('T2 — ET 단계 문구가 「사라진다」가 아니라 「성질이 바뀐다」다',
    /성질이 바뀐/.test(T2_STAGES[4].note) && !/사라진다$/.test(T2_STAGES[4].note));
}

// ── 두 장면을 스텁 GL로 실제로 돌린다(예산·깊이·드로우콜) ────────────────────
for (const [name, scene, steps] of [['T1', t1Scene, T1_STEPS], ['T2', t2Scene, T2_STEPS]]) {
  const canvas = createStubCanvas();
  const r = createSchematicRenderer(canvas);
  r.setScene(scene);
  r.resize();
  let minCalls = Infinity;
  let maxArrow = 0;
  let dropped = 0;
  for (let s = 0; s < steps.length; s += 1) {
    r.setStep(s);
    minCalls = Math.min(minCalls, r.render(s * 0.3));
    maxArrow = Math.max(maxArrow, r.counts.arrow);
    dropped += r.counts.arrowDropped + r.counts.lineDropped;
  }
  check(`${name} — 전 단계가 실제로 그려진다(드로우콜 > 0)`, minCalls > 0, `최소 ${minCalls}`);
  check(`${name} — 예산 안(화살표 ≤ ${MAX_ARROWS} · 잘린 항목 0)`, maxArrow <= MAX_ARROWS && dropped === 0,
    `최대 화살표 ${maxArrow} · 잘림 ${dropped}`);
  check(`${name} — 화살표를 그리는 순간 DEPTH_TEST가 켜져 있다`,
    canvas.gl.stats.enabledAtArrowDraw?.has(canvas.gl.DEPTH_TEST) === true);
  check(`${name} — 라벨 좌표가 전 단계에서 유한하다`,
    steps.every((_, s) => labelsFor(scene, s, 1.5).every((l) => Number.isFinite(l.left) && Number.isFinite(l.top))));
  r.dispose();
}


console.log(failed === 0 ? '\nOK — 입체 화살표 계약 통과' : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);

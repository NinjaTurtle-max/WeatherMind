/**
 * 지도 오버레이 순수 모듈 계약 가드 (R10-01 웨이브 2 / QA-2)
 *   실행: node tests/mapOverlayGeometry.contract.test.mjs   (npm run test:overlay)
 *   node_modules 불필요 — overlayScene/overlayGeometry/precipEngine/boardLayout은
 *   전부 확장자 포함 상대 import만 쓰는 순수 모듈이다(GL·DOM 접근 0).
 *
 * 왜 필요한가 — S3(FE-2)는 이 두 모듈을 임시 스크립트로만 확인하고 상주 가드를
 * 남기지 않았다. 오버레이는 **WebGL 경로와 SVG/Canvas2D 폴백이 같은 장면 기술을
 * 공유**하는 구조라, 좌표·상한이 어긋나도 화면은 "그려지긴" 하므로 렌더 스모크가
 * 잡지 못한다(구름이 지도 밖으로 나가거나 파티클이 폭증해도 초록색).
 *
 * 고정하는 것:
 *  1) 매핑 표 — cloudVariantFor 판정, CLOUD_SHAPES·PRECIP_META·EMITTER_BOX·
 *     BLOOM_RADIUS 값(SVG 경로와 같은 수치여야 한다)
 *  2) 정점 개수 — bloom/cloud/flow/precip 레이아웃 × 6정점 공식과 정확히 일치
 *     (레이아웃 float 수와 굽는 코드가 어긋나면 셰이더가 쓰레기 값을 읽는다)
 *  3) userSpace 좌표 경계 — 앵커(구름·번짐 중심·에미터 박스·화살표 머리)는
 *     VIEW_W×VIEW_H(100×80) **안**, 의도된 화면 밖 번짐(번짐 r=22·화살표 꼬리
 *     오프셋 ~32)까지 포함한 모든 정점은 블리드 여유(±20) 안
 *  4) 파티클 상한 — createSystem이 어떤 cap 요청에도 전역 200 초과 불가 +
 *     precipVertices가 주어진 버퍼를 절대 넘겨 쓰지 않음 + MapOverlayGL이
 *     cap을 MAX_PARTICLES로 클램프
 *  5) FLOW_META 사본 드리프트 — overlayScene.FLOW_META(값 사본)와 원본
 *     mapInfographic.jsx의 FLOW_META가 일치. 원본이 export되지 않아 **소스 텍스트를
 *     파싱**해 대조한다. 어긋나면 지도 오버레이의 유입 방향이 SVG 폴백과 달라진다.
 *
 * 변이 검증용 고장 주입(WM_FAULT):
 *   flow-meta   파싱한 원본 FLOW_META의 값 하나를 흔든다(드리프트 상황 재현)
 *   bounds      번짐 반경을 부풀려 경계 검사를 흔든다
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildScene, sceneIsEmpty, cloudVariantFor, precipEmitters,
  BLOOM_META, BLOOM_RADIUS, CLOUD_SHAPES, PRECIP_META, EMITTER_BOX, FLOW_META,
} from '../src/modules/board/webgl/mapOverlay/overlayScene.js';
import {
  bloomVertices, cloudVertices, flowVertices, precipVertices,
  BLOOM_LAYOUT, CLOUD_LAYOUT, FLOW_LAYOUT, PRECIP_LAYOUT, PRECIP_FLOATS_PER_PARTICLE,
} from '../src/modules/board/webgl/mapOverlay/overlayGeometry.js';
import { MAX_PARTICLES, createSystem, stepSystem } from '../src/modules/board/precipEngine.js';
import { VIEW_W, VIEW_H, toUser, FALLBACK_REGIONS } from '../src/modules/board/boardLayout.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
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
const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPS;
// 정점은 Float32Array에 담기므로 f32 반올림(≈1e-5 상대오차)만 허용한다.
// 1e-3은 f32 꼬리만 흡수하고 실제 계약 변경(반경·rx 1단위 변화)은 반드시 잡는다.
const nearF32 = (a, b) => Math.abs(a - b) < 1e-3;

// ── 좌표 경계 계약 ───────────────────────────────────────────────────────────
// 앵커는 지도 안, 정점은 "의도된 화면 밖 번짐"까지만 허용한다.
// BLEED=20의 근거: 번짐 반경 22(중심이 지도 안이면 최대 +22, 지도 가장자리 여백
// 고려해 x는 +18까지 관측) · 화살표 꼬리 오프셋 최대 |32| 중 지도 밖 성분.
// 좌표계 사고(정규화 0~1 사용·y 0.8 사영 누락·px 좌표 혼입)는 이 범위를 즉시 깬다.
const BLEED = 20;
const inBox = (x, y) => x >= 0 && x <= VIEW_W && y >= 0 && y <= VIEW_H;
const inBleed = (x, y) =>
  x >= -BLEED && x <= VIEW_W + BLEED && y >= -BLEED && y <= VIEW_H + BLEED;

/** 정점 배열 검사 — 유한성 + 블리드 경계 + (선택) 좌표 범위 보고 */
function scanVerts(label, arr, floatsPerVert, count) {
  const n = arr.length / floatsPerVert;
  let bad = null;
  let ext = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < arr.length; i += floatsPerVert) {
    for (let k = 0; k < floatsPerVert; k += 1) {
      if (!Number.isFinite(arr[i + k])) { bad = bad ?? `float ${i + k} = ${arr[i + k]}`; }
    }
    const x = arr[i];
    const y = arr[i + 1];
    ext = {
      x0: Math.min(ext.x0, x), x1: Math.max(ext.x1, x),
      y0: Math.min(ext.y0, y), y1: Math.max(ext.y1, y),
    };
    if (!inBleed(x, y)) bad = bad ?? `정점 ${i / floatsPerVert} (${x.toFixed(2)}, ${y.toFixed(2)}) 가 블리드 밖`;
  }
  check(`${label}: 정점 수 === ${count}개 × 6정점 = ${count * 6} (실제 ${n})`, n === count * 6,
    `레이아웃 float 수(${floatsPerVert})와 굽는 코드가 어긋나면 셰이더가 옆 정점 값을 읽는다.`);
  check(
    `${label}: 전 정점 유한 + userSpace 블리드([${-BLEED},${VIEW_W + BLEED}]×[${-BLEED},${VIEW_H + BLEED}]) 안 ` +
    `(x ${ext.x0.toFixed(1)}~${ext.x1.toFixed(1)} · y ${ext.y0.toFixed(1)}~${ext.y1.toFixed(1)})`,
    bad === null,
    `${bad}. 좌표계는 지도 SVG userSpace(${VIEW_W}×${VIEW_H}) 하나뿐이다 — 정규화(0~1)·px 좌표 혼입은 여기서 잡힌다.`,
  );
  return ext;
}

// ── 테스트 장면 — 실제 지도 좌표(시드 SSOT) 기반 ──────────────────────────────
const zonePoints = FALLBACK_REGIONS.map((r) => toUser(r.svg_point));
const airSubtypes = Object.keys(BLOOM_META); // siberian·okhotsk·north_pacific·yangtze
const board = {
  elements: airSubtypes.map((subtype, i) => ({ type: 'air_mass', subtype, zone: i % zonePoints.length })),
};
// 구름 변형 6종 + 강수 4종을 모두 밟는 존별 판정
const zoneVisuals = [
  { phenomenon: 'shower', cloud: 'cumulonimbus', rule_id: 'convective_shower' },
  { phenomenon: 'persistent_rain', cloud: 'nimbostratus', rule_id: 'stationary_front_monsoon' },
  { phenomenon: 'snow', cloud: 'nimbostratus', rule_id: 'siberian_snow' },
  { phenomenon: 'fog', cloud: 'stratus', rule_id: 'radiation_fog' },
];

// ── 1) 매핑 표 고정 ──────────────────────────────────────────────────────────
const VARIANT_VECTORS = [
  [null, null, '판정 없음'],
  [{ phenomenon: 'fog', cloud: 'stratus' }, 'fog', '안개는 구름보다 우선'],
  [{ phenomenon: 'snow', cloud: 'nimbostratus' }, 'snowcloud', '눈 → 눈구름'],
  [{ phenomenon: 'shower', cloud: 'cumulonimbus' }, 'cumulonimbus', '적란운'],
  [{ phenomenon: 'rain', cloud: 'nimbostratus' }, 'nimbostratus', '난층운'],
  [{ phenomenon: 'cloudy', cloud: 'stratus' }, 'stratus', '층운'],
  [{ phenomenon: 'cloudy', cloud: 'cumulus', rule_id: 'x' }, 'cumulus', '규칙 성립한 적운'],
  [{ phenomenon: 'cloudy', cloud: 'cumulus' }, null, '규칙 미성립 적운은 노드 아이콘만'],
  [{ phenomenon: 'clear', cloud: 'none' }, null, '맑음'],
];
for (const [v, want, why] of VARIANT_VECTORS) {
  check(`cloudVariantFor(${JSON.stringify(v)}) === ${JSON.stringify(want)} — ${why}`,
    cloudVariantFor(v) === want,
    `실제 ${JSON.stringify(cloudVariantFor(v))}. WebGL·SVG 두 경로가 이 판정을 공유한다.`);
}
check('CLOUD_SHAPES가 변형 6종 전부 보유 (cloudVariantFor 산출과 1:1)',
  ['cumulonimbus', 'nimbostratus', 'snowcloud', 'stratus', 'fog', 'cumulus']
    .every((k) => CLOUD_SHAPES[k] && Number.isFinite(CLOUD_SHAPES[k].rx)),
  `실제 키 [${Object.keys(CLOUD_SHAPES)}] — 빠진 변형은 구름이 아예 안 그려진다.`);
check('PRECIP_META가 강수 현상 4종 보유 (shower·persistent_rain·rain·snow)',
  ['shower', 'persistent_rain', 'rain', 'snow'].every((k) => PRECIP_META[k]?.kind),
  `실제 키 [${Object.keys(PRECIP_META)}]`);
check(`EMITTER_BOX === {dx:-7, dy:-4, w:14, h:12} (SVG 경로와 동일 수치)`,
  EMITTER_BOX.dx === -7 && EMITTER_BOX.dy === -4 && EMITTER_BOX.w === 14 && EMITTER_BOX.h === 12,
  `실제 ${JSON.stringify(EMITTER_BOX)}`);
const bloomRadius = FAULT === 'bounds' ? BLOOM_RADIUS * 9 : BLOOM_RADIUS;
check('BLOOM_RADIUS === 22 (SVG AirMassBloom r과 동일)', bloomRadius === 22, `실제 ${bloomRadius}`);

// ── 2) buildScene 앵커 — 좌표 재계산 없음(호출측 zonePoints를 그대로 쓴다) ─────
const scene = buildScene({ board, zoneVisuals, zonePoints });
check(`색 번짐 ${scene.blooms.length}건 === 기단 ${board.elements.length}건`,
  scene.blooms.length === board.elements.length);
check(`유동 흐름 ${scene.flows.length}건 === FLOW_META 보유 기단 수`,
  scene.flows.length === board.elements.filter((e) => FLOW_META[e.subtype]).length);
check(`구름 ${scene.clouds.length}건 === 변형 판정된 존 수`,
  scene.clouds.length === zoneVisuals.filter((v) => cloudVariantFor(v)).length);
check(`강수 에미터 ${scene.emitters.length}건 === 강수 현상 존 수`,
  scene.emitters.length === zoneVisuals.filter((v) => PRECIP_META[v.phenomenon]).length);

board.elements.forEach((el, i) => {
  const pt = zonePoints[el.zone];
  const b = scene.blooms[i];
  check(`번짐[${i}] 중심 === 존 ${el.zone} 좌표 (${pt}) · r=${BLOOM_RADIUS}`,
    near(b.x, pt[0]) && near(b.y, pt[1]) && b.r === BLOOM_RADIUS,
    `실제 (${b.x}, ${b.y}) r=${b.r}. overlayScene은 좌표를 재계산하지 않는다(boardLayout 동결 계약 우회 금지).`);
  check(`번짐[${i}] 중심이 지도 안 (${VIEW_W}×${VIEW_H})`, inBox(b.x, b.y), `실제 (${b.x}, ${b.y})`);
});
scene.flows.forEach((f, i) => {
  const el = board.elements[i];
  const pt = zonePoints[el.zone];
  const [ox, oy] = FLOW_META[el.subtype].from;
  check(`흐름[${i}] ${el.subtype}: 꼬리 = 존+오프셋, 머리 = 존+22% (SVG FlowArrow와 동일)`,
    near(f.x1, pt[0] + ox) && near(f.y1, pt[1] + oy)
    && near(f.x2, pt[0] + ox * 0.22) && near(f.y2, pt[1] + oy * 0.22)
    && f.w0 === 6 && f.w1 === 2,
    `실제 ${JSON.stringify(f)}`);
  check(`흐름[${i}] 화살표 머리가 지도 안 (꼬리는 화면 밖 유입이 의도)`,
    inBox(f.x2, f.y2), `머리 (${f.x2.toFixed(1)}, ${f.y2.toFixed(1)})`);
});
zoneVisuals.forEach((v, zone) => {
  const variant = cloudVariantFor(v);
  if (!variant) return;
  const shape = CLOUD_SHAPES[variant];
  const c = scene.clouds.find((k) => near(k.x, zonePoints[zone][0]) && near(k.y, zonePoints[zone][1] + shape.dy));
  check(`구름 zone ${zone}(${variant}) 앵커 = 존 좌표 + dy(${shape.dy}) · rx/ry = ${shape.rx}/${shape.ry}`,
    Boolean(c) && c.rx === shape.rx && c.ry === shape.ry,
    `실제 ${JSON.stringify(scene.clouds)}`);
  if (c) check(`구름 zone ${zone} 중심이 지도 안`, inBox(c.x, c.y), `실제 (${c.x}, ${c.y})`);
});
scene.emitters.forEach((e, i) => {
  check(`에미터[${i}] 박스가 지도 안 (${e.x.toFixed(1)},${e.y.toFixed(1)} ${e.w}×${e.h})`,
    inBox(e.x, e.y) && inBox(e.x + e.w, e.y + e.h),
    '에미터가 지도 밖이면 강수가 보이지 않는다(WebGL·Canvas2D 폴백 동시).');
});
check('precipEmitters(빈 판정) → 0건 · buildScene(빈 보드) → sceneIsEmpty true',
  precipEmitters(null, zonePoints).length === 0
  && sceneIsEmpty(buildScene({ board: { elements: [] }, zoneVisuals: [], zonePoints }))
  && sceneIsEmpty(null),
  '그릴 것이 없으면 컨텍스트를 아예 만들지 않는 계약(MapOverlayGL)이 이 판정에 걸려 있다.');
check('zonePoints 미제공 → 좌표 없는 장면은 비어 있음(NaN 정점 생성 금지)',
  sceneIsEmpty(buildScene({ board, zoneVisuals })),
  `실제 ${JSON.stringify(buildScene({ board, zoneVisuals }))}`);

// ── 3) 정점 개수·좌표 경계 ───────────────────────────────────────────────────
const BLOOM_FLOATS = BLOOM_LAYOUT.reduce((s, a) => s + a.size, 0);
const CLOUD_FLOATS = CLOUD_LAYOUT.reduce((s, a) => s + a.size, 0);
const FLOW_VERT_FLOATS = FLOW_LAYOUT.reduce((s, a) => s + a.size, 0);
const PRECIP_VERT_FLOATS = PRECIP_LAYOUT.reduce((s, a) => s + a.size, 0);
check(`레이아웃 float 수 — bloom ${BLOOM_FLOATS}=9 · cloud ${CLOUD_FLOATS}=8 · flow ${FLOW_VERT_FLOATS}=7 · precip ${PRECIP_VERT_FLOATS}=9`,
  BLOOM_FLOATS === 9 && CLOUD_FLOATS === 8 && FLOW_VERT_FLOATS === 7 && PRECIP_VERT_FLOATS === 9,
  '셰이더 attribute 스트라이드와 같은 값이어야 한다.');
check(`PRECIP_FLOATS_PER_PARTICLE === 6 × ${PRECIP_VERT_FLOATS} = ${6 * PRECIP_VERT_FLOATS}`,
  PRECIP_FLOATS_PER_PARTICLE === 6 * PRECIP_VERT_FLOATS, `실제 ${PRECIP_FLOATS_PER_PARTICLE}`);

const bloomsForGeo = FAULT === 'bounds'
  ? scene.blooms.map((b) => ({ ...b, r: bloomRadius }))
  : scene.blooms;
scanVerts('번짐 정점', bloomVertices(bloomsForGeo), BLOOM_FLOATS, scene.blooms.length);
{
  // 사각형 1장 단위 범위 = 중심 ± r (여러 번짐을 합치면 존 간 거리가 섞이므로 1건만)
  const one = bloomVertices([bloomsForGeo[0]]);
  const xs = [];
  const ys = [];
  for (let i = 0; i < one.length; i += BLOOM_FLOATS) { xs.push(one[i]); ys.push(one[i + 1]); }
  check(`번짐 사각형 1장 범위 = 중심 ± r(${bloomRadius}) → ${2 * bloomRadius}×${2 * bloomRadius} (SVG radialGradient와 같은 범위)`,
    nearF32(Math.max(...xs) - Math.min(...xs), 2 * bloomRadius)
    && nearF32(Math.max(...ys) - Math.min(...ys), 2 * bloomRadius),
    `실제 ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)}×${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);
}
{
  const one = cloudVertices([scene.clouds[0]]);
  const c = scene.clouds[0];
  const xs = [];
  const ys = [];
  for (let i = 0; i < one.length; i += CLOUD_FLOATS) { xs.push(one[i]); ys.push(one[i + 1]); }
  check(`구름 사각형 1장 범위 = 중심 ± (rx ${c.rx}, ry ${c.ry}) — 셰이더 노이즈가 이 범위 안에서만 그려진다`,
    nearF32(Math.max(...xs) - Math.min(...xs), 2 * c.rx) && nearF32(Math.max(...ys) - Math.min(...ys), 2 * c.ry),
    `실제 ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)}×${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);
}
scanVerts('구름 정점', cloudVertices(scene.clouds), CLOUD_FLOATS, scene.clouds.length);

// flow는 리본(세그먼트 14 × 6정점) + 화살촉 3정점 = 87정점 → 6의 배수가 아니므로 별도 계산
{
  const arr = flowVertices(scene.flows);
  const FLOW_FLOATS_PER_ARROW = (14 * 6 + 3) * FLOW_VERT_FLOATS;
  check(`흐름 정점: ${scene.flows.length}개 × (세그먼트 14×6 + 화살촉 3)정점 × ${FLOW_VERT_FLOATS}float = ${scene.flows.length * FLOW_FLOATS_PER_ARROW} (실제 ${arr.length})`,
    arr.length === scene.flows.length * FLOW_FLOATS_PER_ARROW,
    'SVG taperedArrowPath와 같은 분할 수(14)를 유지해야 두 경로의 화살표가 같은 자리를 지난다.');
  let bad = null;
  for (let i = 0; i < arr.length; i += FLOW_VERT_FLOATS) {
    if (!Number.isFinite(arr[i]) || !Number.isFinite(arr[i + 1])) bad = bad ?? `정점 ${i / FLOW_VERT_FLOATS} 비유한`;
    // 꼬리는 화면 밖 유입이 의도 — 오프셋(|32|) + 리본 폭까지 허용한 블리드로 본다
    if (!inBleed(arr[i], arr[i + 1])) bad = bad ?? `정점 ${i / FLOW_VERT_FLOATS} (${arr[i].toFixed(1)}, ${arr[i + 1].toFixed(1)}) 블리드 밖`;
    const u = arr[i + 2];
    if (!(u >= 0 && u <= 1)) bad = bad ?? `정점 ${i / FLOW_VERT_FLOATS} u=${u} 가 0~1 밖`;
    const v = arr[i + 3];
    if (!(v >= -1 && v <= 1)) bad = bad ?? `정점 ${i / FLOW_VERT_FLOATS} v=${v} 가 -1~1 밖`;
  }
  check('흐름 정점: 유한 + 블리드 안 + uv 범위(u 0~1 진행, v -1~1 폭)', bad === null, String(bad));
}

// ── 4) 강수 파티클 상한 + 버퍼 오버런 금지 ───────────────────────────────────
{
  const sys = createSystem(scene.emitters, 10_000);
  check(`과대 cap 요청(10000)도 전역 상한 ${MAX_PARTICLES} 초과 불가 — 실제 ${sys.particles.length}`,
    sys.particles.length > 0 && sys.particles.length <= MAX_PARTICLES,
    '모바일 파티클 예산(R9-08). 오버레이는 여기에 편승한다.');

  const buf = new Float32Array(MAX_PARTICLES * PRECIP_FLOATS_PER_PARTICLE);
  for (let f = 0; f < 60; f += 1) stepSystem(sys, 0.016);
  const floats = precipVertices(sys, buf);
  check(`precipVertices: 채운 float ${floats} = 파티클 ${sys.particles.length} × ${PRECIP_FLOATS_PER_PARTICLE} 이하 · 버퍼(${buf.length}) 이내`,
    floats <= buf.length && floats <= sys.particles.length * PRECIP_FLOATS_PER_PARTICLE && floats > 0);
  let bad = null;
  for (let i = 0; i < floats; i += PRECIP_VERT_FLOATS) {
    if (!inBleed(buf[i], buf[i + 1])) bad = bad ?? `(${buf[i].toFixed(1)}, ${buf[i + 1].toFixed(1)})`;
    if (!Number.isFinite(buf[i]) || !Number.isFinite(buf[i + 1])) bad = bad ?? '비유한';
  }
  check('강수 정점: 유한 + userSpace 블리드 안 (에미터 박스가 지도 안이므로 사실상 지도 안)', bad === null, String(bad));

  // 작은 버퍼 — 넘겨 쓰지 않고 잘라야 한다(GL 버퍼 오버런 = 쓰레기 정점)
  const small = new Float32Array(7 * PRECIP_FLOATS_PER_PARTICLE);
  small.fill(NaN);
  const wrote = precipVertices(sys, small);
  const tailIntact = wrote === small.length || Number.isNaN(small[small.length - 1]);
  check(`작은 버퍼(7파티클분)에 ${sys.particles.length}파티클 → 채운 float ${wrote} ≤ ${small.length} (오버런 없음)`,
    wrote <= small.length && tailIntact);
}
{
  const src = readFileSync(resolve(root, 'src/modules/board/webgl/mapOverlay/MapOverlayGL.jsx'), 'utf-8');
  check('MapOverlayGL이 cap을 MAX_PARTICLES로 클램프 (Math.min(cap, MAX_PARTICLES))',
    /Math\.min\(\s*cap\s*,\s*MAX_PARTICLES\s*\)/.test(src),
    '클램프가 없으면 호출측 cap prop 하나로 파티클 예산이 뚫린다.');
}

// ── 5) FLOW_META 사본 드리프트 ───────────────────────────────────────────────
// 원본: mapInfographic.jsx의 모듈 지역 상수(export 안 됨) → 소스 텍스트 파싱으로 대조.
// 사본: overlayScene.FLOW_META(값 사본, 색은 0~1 정규화 형태).
const WHO_FLOW =
  '유입 방향(from)·휘어짐(bend)·색이 갈라지면 같은 기단의 흐름 화살표가 ' +
  'WebGL 오버레이와 SVG 폴백에서 서로 다른 방향/색으로 그려진다(경로에 따라 다른 그림).';
{
  const infoPath = resolve(root, 'src/modules/board/mapInfographic.jsx');
  const infoSrc = readFileSync(infoPath, 'utf-8');
  const sceneSrcPath = resolve(root, 'src/modules/board/webgl/mapOverlay/overlayScene.js');
  const sceneSrc = readFileSync(sceneSrcPath, 'utf-8');

  const copyExists = /export const FLOW_META\s*=\s*\{/.test(sceneSrc);
  const originExported = /export const FLOW_META\s*=\s*\{/.test(infoSrc);

  if (!copyExists) {
    // 사본이 사라졌다면 단일 소유자로 승격된 것 — import 경로만 확인하고 대조 불필요
    check('overlayScene이 FLOW_META 사본 없이 원본을 import (단일 소유자 승격 — 대조 불필요)',
      /import[^;]*FLOW_META[^;]*mapInfographic/.test(sceneSrc),
      'FLOW_META 사본도 없고 import도 없다 — 흐름 화살표 메타가 사라졌다.');
  } else {
    // 원본 블록 추출
    const start = infoSrc.indexOf('const FLOW_META = {');
    const end = infoSrc.indexOf('\n};', start);
    check('mapInfographic.jsx에서 FLOW_META 원본 블록을 찾았다 (파싱 성공 — 실패 시 이 가드는 공허하다)',
      start >= 0 && end > start, `start=${start} end=${end}`);
    const block = infoSrc.slice(start, end);
    const origin = {};
    const entryRe = /(\w+):\s*\{([^}]*)\}/g;
    let m;
    while ((m = entryRe.exec(block))) {
      const [, key, body] = m;
      const from = /from:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(body);
      const bend = /bend:\s*(-?[\d.]+)/.exec(body);
      const color = /color:\s*'(#[0-9a-fA-F]{3,8})'/.exec(body);
      if (!from || !bend || !color) continue;
      origin[key] = {
        from: [Number(from[1]), Number(from[2])],
        bend: Number(bend[1]),
        color: color[1],
      };
    }
    if (FAULT === 'flow-meta' && origin.siberian) origin.siberian.from[0] -= 1;

    const originKeys = Object.keys(origin).sort();
    const copyKeys = Object.keys(FLOW_META).sort();
    check(`원본 파싱 결과 ${originKeys.length}종 (기단 4종 — 0종이면 파싱이 깨진 것이다)`,
      originKeys.length === 4, `실제 [${originKeys}]. 원본 리터럴 형태가 바뀌었으면 이 파서를 함께 고쳐야 한다.`);
    check(`FLOW_META 키 집합 일치 — 원본 [${originKeys}] === 사본 [${copyKeys}]`,
      originKeys.length === copyKeys.length && originKeys.every((k, i) => k === copyKeys[i]),
      WHO_FLOW);
    check(`원본이 여전히 export되지 않음 (사본이 필요한 이유가 유지된다)`,
      !originExported,
      'mapInfographic이 FLOW_META를 export하기 시작했다면 overlayScene의 값 사본을 지우고 import로 바꿔라(사본 유지 = 드리프트 위험 존속).');

    // 색: 원본 '#rrggbb' → 0~1 정규화 후 사본과 대조(사본은 소수 3자리로 적혀 있다)
    const hexToRgb = (hex) => {
      const h = hex.replace('#', '');
      const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
      return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    };
    for (const key of originKeys) {
      const o = origin[key];
      const c = FLOW_META[key];
      if (!c) continue;
      const wantColor = hexToRgb(o.color);
      const diffs = [];
      if (!near(o.from[0], c.from[0]) || !near(o.from[1], c.from[1])) {
        diffs.push(`from: 원본 [${o.from}] ≠ 사본 [${c.from}]`);
      }
      if (!near(o.bend, c.bend)) diffs.push(`bend: 원본 ${o.bend} ≠ 사본 ${c.bend}`);
      // 사본은 소수 3자리 반올림값 — 허용 오차는 반올림 폭(5e-4)만
      const colorOff = wantColor.map((w, i) => Math.abs(w - c.color[i]));
      if (colorOff.some((d) => d > 5e-4)) {
        diffs.push(`color: 원본 ${o.color}=[${wantColor.map((n) => n.toFixed(3))}] ≠ 사본 [${c.color}]`);
      }
      check(`FLOW_META ${key}: 원본(mapInfographic) ↔ 사본(overlayScene) 값 일치`,
        diffs.length === 0, `${diffs.join(' / ')}. ${WHO_FLOW}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패 — 지도 오버레이 순수 모듈 계약(좌표·상한·FLOW_META 사본)이 깨졌다.`);
  process.exit(1);
}
console.log('OK: 지도 오버레이 정점·좌표 경계·파티클 상한·FLOW_META 사본 대조 통과');

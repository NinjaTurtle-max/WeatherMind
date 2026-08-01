/**
 * overlayGeometry — 장면 → 정점 배열(순수) (R10-01 S3 §3.3).
 *
 * GL 호출 없음. Float32Array만 만든다 → node에서 단위 검증 가능하고,
 * WebGL 실패 시에도 이 파일은 아무 부작용을 남기지 않는다.
 * 좌표는 전부 userSpace(100×80) — 셰이더가 toClip으로 변환한다.
 */

// 사각형 1장 = 삼각형 2개. local 좌표 [-1,1]².
const QUAD = [
  [-1, -1], [1, -1], [1, 1],
  [-1, -1], [1, 1], [-1, 1],
];

// ── ① 기단 색 번짐 ──────────────────────────────────────────────────────────
/** layout: a_pos(2) a_local(2) a_color(3) a_seed(1) a_peak(1) = 9 */
export const BLOOM_LAYOUT = [
  { name: 'a_pos', size: 2 },
  { name: 'a_local', size: 2 },
  { name: 'a_color', size: 3 },
  { name: 'a_seed', size: 1 },
  { name: 'a_peak', size: 1 },
];

export function bloomVertices(blooms) {
  const out = new Float32Array(blooms.length * 6 * 9);
  let i = 0;
  for (const b of blooms) {
    for (const [lx, ly] of QUAD) {
      out[i++] = b.x + lx * b.r;
      out[i++] = b.y + ly * b.r;
      out[i++] = lx;
      out[i++] = ly;
      out[i++] = b.color[0];
      out[i++] = b.color[1];
      out[i++] = b.color[2];
      out[i++] = b.seed;
      out[i++] = b.peak;
    }
  }
  return out;
}

// ── ④ 터뷸런스 구름 ─────────────────────────────────────────────────────────
/** layout: a_pos(2) a_local(2) a_shape(3: bright,tall,alpha) a_seed(1) = 8 */
export const CLOUD_LAYOUT = [
  { name: 'a_pos', size: 2 },
  { name: 'a_local', size: 2 },
  { name: 'a_shape', size: 3 },
  { name: 'a_seed', size: 1 },
];

export function cloudVertices(clouds) {
  const out = new Float32Array(clouds.length * 6 * 8);
  let i = 0;
  for (const c of clouds) {
    for (const [lx, ly] of QUAD) {
      out[i++] = c.x + lx * c.rx;
      out[i++] = c.y + ly * c.ry;
      out[i++] = lx;
      out[i++] = ly;
      out[i++] = c.bright;
      out[i++] = c.tall;
      out[i++] = c.alpha;
      out[i++] = c.seed;
    }
  }
  return out;
}

// ── ③ 유동 흐름장 ───────────────────────────────────────────────────────────
/** layout: a_pos(2) a_uv(2: u=진행 0~1, v=폭 -1~1) a_color(3) = 7 */
export const FLOW_LAYOUT = [
  { name: 'a_pos', size: 2 },
  { name: 'a_uv', size: 2 },
  { name: 'a_color', size: 3 },
];

const FLOW_SEGMENTS = 14; // SVG taperedArrowPath와 같은 분할 수
const FLOW_FLOATS = (FLOW_SEGMENTS * 6 + 3) * 7; // 리본 + 화살촉

/**
 * flowRibbon — 2차 베지어 중심선 + 꼬리 넓고 머리 좁은 리본 삼각형 + 화살촉.
 * 기하 규칙은 mapInfographic.taperedArrowPath(동결·문자열 path 반환)와 동일하게
 * 유지한다 — WebGL/SVG 두 경로에서 화살표가 같은 자리를 지나야 하기 때문이다.
 */
export function flowVertices(flows) {
  const out = new Float32Array(flows.length * FLOW_FLOATS);
  let i = 0;
  const push = (x, y, u, v, c) => {
    out[i++] = x;
    out[i++] = y;
    out[i++] = u;
    out[i++] = v;
    out[i++] = c[0];
    out[i++] = c[1];
    out[i++] = c[2];
  };

  for (const f of flows) {
    const mx = (f.x1 + f.x2) / 2;
    const my = (f.y1 + f.y2) / 2;
    const dx = f.x2 - f.x1;
    const dy = f.y2 - f.y1;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx + (-dy / len) * len * f.bend;
    const cy = my + (dx / len) * len * f.bend;

    const left = [];
    const right = [];
    let endTan = [1, 0];
    let endPt = [f.x2, f.y2];
    for (let s = 0; s <= FLOW_SEGMENTS; s += 1) {
      const t = s / FLOW_SEGMENTS;
      const a = 1 - t;
      const px = a * a * f.x1 + 2 * a * t * cx + t * t * f.x2;
      const py = a * a * f.y1 + 2 * a * t * cy + t * t * f.y2;
      const tx = 2 * a * (cx - f.x1) + 2 * t * (f.x2 - cx);
      const ty = 2 * a * (cy - f.y1) + 2 * t * (f.y2 - cy);
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      const w = (f.w0 + (f.w1 - f.w0) * t) / 2;
      left.push([px + nx * w, py + ny * w]);
      right.push([px - nx * w, py - ny * w]);
      if (s === FLOW_SEGMENTS) {
        endTan = [tx / tl, ty / tl];
        endPt = [px, py];
      }
    }

    for (let s = 0; s < FLOW_SEGMENTS; s += 1) {
      const u0 = s / FLOW_SEGMENTS;
      const u1 = (s + 1) / FLOW_SEGMENTS;
      push(left[s][0], left[s][1], u0, 1, f.color);
      push(right[s][0], right[s][1], u0, -1, f.color);
      push(right[s + 1][0], right[s + 1][1], u1, -1, f.color);
      push(left[s][0], left[s][1], u0, 1, f.color);
      push(right[s + 1][0], right[s + 1][1], u1, -1, f.color);
      push(left[s + 1][0], left[s + 1][1], u1, 1, f.color);
    }

    // 화살촉 — 끝점 접선 방향 삼각형(SVG와 같은 hw/hl 비율)
    const [ux, uy] = endTan;
    const hw = f.w1 * 2.4;
    const hl = f.w1 * 3.4;
    push(endPt[0] + ux * hl, endPt[1] + uy * hl, 1, 0, f.color);
    push(endPt[0] - uy * hw, endPt[1] + ux * hw, 1, 0, f.color);
    push(endPt[0] + uy * hw, endPt[1] - ux * hw, 1, 0, f.color);
  }
  return out;
}

// ── ⑤ 강수 (precipEngine 물리 → 정점) ────────────────────────────────────────
/** layout: a_pos(2) a_uv(2) a_color(4) a_round(1) = 9 */
export const PRECIP_LAYOUT = [
  { name: 'a_pos', size: 2 },
  { name: 'a_uv', size: 2 },
  { name: 'a_color', size: 4 },
  { name: 'a_round', size: 1 },
];
export const PRECIP_FLOATS_PER_PARTICLE = 6 * 9;

// Canvas2D 폴백(realisticEffects.PrecipCanvas)과 같은 색 — 경로가 바뀌어도 톤 동일.
const RAIN = [0.490, 0.769, 0.941, 0.75]; // rgba(125,196,240,.75)
const SPLASH = [0.729, 0.902, 0.992, 0.85]; // rgba(186,230,253,.85)
const SNOW = [1, 1, 1, 0.9];
const RAIN_HALF_W = 0.17; // userSpace — 320px 지도폭에서 ≈1.1px (Canvas2D lineWidth와 동일)

/**
 * precipVertices — precipEngine 파티클 시스템을 사각형 정점으로 굽는다.
 * 비: 속도 방향 사선 줄기 / 지면 근처(박스 하단 92% 아래)는 가로 스플래시,
 * 눈: 원형 점(uv 원 마스크). Canvas2D 렌더 규칙을 그대로 옮긴 것이다.
 * @param out 미리 할당한 Float32Array(cap * PRECIP_FLOATS_PER_PARTICLE)
 * @returns 채운 float 개수
 */
export function precipVertices(sys, out) {
  let i = 0;
  const quad = (ax, ay, bx, by, halfW, color, round) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * halfW;
    const ny = (dx / l) * halfW;
    // (a-n) (a+n) (b+n) / (a-n) (b+n) (b-n) — u는 진행, v는 폭
    const verts = [
      [ax - nx, ay - ny, 0, -1],
      [ax + nx, ay + ny, 0, 1],
      [bx + nx, by + ny, 1, 1],
      [ax - nx, ay - ny, 0, -1],
      [bx + nx, by + ny, 1, 1],
      [bx - nx, by - ny, 1, -1],
    ];
    for (const [x, y, u, v] of verts) {
      out[i++] = x;
      out[i++] = y;
      out[i++] = u;
      out[i++] = v;
      out[i++] = color[0];
      out[i++] = color[1];
      out[i++] = color[2];
      out[i++] = color[3];
      out[i++] = round;
    }
  };

  for (const p of sys?.particles ?? []) {
    if (i + PRECIP_FLOATS_PER_PARTICLE > out.length) break;
    const em = sys.emitters[p.e];
    if (!em) continue;
    if (p.kind === 'snow') {
      const r = Math.max(0.25, p.len * 0.32);
      // 원형 점 — local uv가 [-1,1]²이 되도록 정사각 사각형으로 굽는다
      const a = [p.x - r, p.y];
      const b = [p.x + r, p.y];
      quadSquare(out, i, a, b, r, SNOW);
      i += PRECIP_FLOATS_PER_PARTICLE;
    } else if (p.y > em.y + em.h * 0.92) {
      quad(p.x - p.len * 0.4, p.y, p.x + p.len * 0.4, p.y, RAIN_HALF_W, SPLASH, 0);
    } else {
      const k = p.vy > 0 ? p.len / p.vy : 0;
      quad(p.x, p.y, p.x - p.vx * k, p.y - p.len, RAIN_HALF_W, RAIN, 0);
    }
  }
  return i;
}

/** 눈송이 정사각형 — uv가 [-1,1]²이 되어 프래그먼트 원 마스크가 정확히 맞는다 */
function quadSquare(out, at, a, b, r, color) {
  let i = at;
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  for (const [lx, ly] of QUAD) {
    out[i++] = cx + lx * r;
    out[i++] = cy + ly * r;
    out[i++] = lx;
    out[i++] = ly;
    out[i++] = color[0];
    out[i++] = color[1];
    out[i++] = color[2];
    out[i++] = color[3];
    out[i++] = 1;
  }
}

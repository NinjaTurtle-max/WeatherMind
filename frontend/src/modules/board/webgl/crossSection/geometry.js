/**
 * geometry — 절차 생성 지오메트리 (R10-C / S2).
 *
 * 외부 에셋 0. 단위 큐브·빌보드 쿼드·화살표 실루엣·지표 격자·유리 상자 모서리를
 * 전부 코드로 만든다. 전부 순수 함수 — DOM 접근 없음(SSR 안전).
 */
import { WORLD } from './camera';

/** 단위 큐브 [-0.5,0.5]^3 — pos(3)+normal(3), 36 정점(플랫 셰이딩) */
export function unitCube() {
  const faces = [
    // [normal, 4 corners(CCW)]
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
    [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
  ];
  const out = [];
  for (const [n, q] of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2]);
  }
  return new Float32Array(out);
}
export const CUBE_VERTS = 36;

/** 빌보드/파티클 쿼드 — corner(2) */
export function quadCentered() {
  return new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
}
/** 아래(y=0)에서 위(y=1)로 자라는 쿼드 — 강수 줄기 */
export function quadUp() {
  return new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]);
}
export const QUAD_VERTS = 6;

/** 화살표 실루엣(진행축 +y) — 자루 2삼각 + 머리 1삼각 = 9 정점 */
export function arrowShape() {
  const shaftW = 0.14;
  const shaftTop = 0.12;
  const headW = 0.36;
  return new Float32Array([
    -shaftW, -0.5, shaftW, -0.5, shaftW, shaftTop,
    -shaftW, -0.5, shaftW, shaftTop, -shaftW, shaftTop,
    -headW, shaftTop, headW, shaftTop, 0, 0.5,
  ]);
}
export const ARROW_VERTS = 9;

/** 지표 격자 라인 — 월드 XZ 평면, y=0 바로 위 */
export function groundGrid(nx = 10, nz = 5) {
  const y = 0.0015;
  const pts = [];
  for (let i = 0; i <= nx; i += 1) {
    const x = (i / nx) * WORLD.X;
    pts.push(x, y, 0, x, y, WORLD.Z);
  }
  for (let j = 0; j <= nz; j += 1) {
    const z = (j / nz) * WORLD.Z;
    pts.push(0, y, z, WORLD.X, y, z);
  }
  return new Float32Array(pts);
}

/** 유리 상자 모서리 — 교과서 3D 블록 다이어그램 문법(투명 공기 상자) */
export function boxEdges() {
  const { X, Y, Z } = WORLD;
  const c = [
    [0, 0, 0], [X, 0, 0], [X, 0, Z], [0, 0, Z],
    [0, Y, 0], [X, Y, 0], [X, Y, Z], [0, Y, Z],
  ];
  const e = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const pts = [];
  for (const [a, b] of e) pts.push(...c[a], ...c[b]);
  return new Float32Array(pts);
}

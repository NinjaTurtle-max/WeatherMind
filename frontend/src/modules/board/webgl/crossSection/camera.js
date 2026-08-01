/**
 * camera — 고정 아이소메트릭 카메라 + 최소 mat4 (R10-C / S2).
 *
 * 계약: **사용자 조작 없음**(학습 초점 유지). 방위·고도·직교 투영 배율이 상수라
 * 뷰-프로젝션 행렬은 종횡비가 바뀔 때만 재계산된다.
 *
 * 월드 좌표계 — SVG 단면(fp/gp)과 같은 의미축을 쓴다:
 *   x 0~1  서→동 (SVG fp의 fx)
 *   y 0~YT 고도  (SVG fp의 h, 0=지표)
 *   z 0~ZD 깊이  (SVG gp의 z, 0=앞/남)
 * 순수 함수만 — DOM 접근 없음(SSR 안전).
 */

export const WORLD = { X: 1, Y: 0.4, Z: 0.42 };
/** 화면 종횡비 기준(기존 SVG viewBox 260×150과 동일 — 패널 레이아웃 점프 방지) */
export const ASPECT = 260 / 150;

const AZIMUTH = (36 * Math.PI) / 180; // 방위(동쪽에서 바라보는 각)
const ELEVATION = (21 * Math.PI) / 180; // 고도(내려다보는 각)
const DIST = 4;
const TARGET = [0.5, 0.15, 0.2];
/** 세로 반경 — 월드 박스 투영 높이(≈0.69)보다 여유 있게 */
const HALF_H = 0.39;

export function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** column-major 4×4 곱 (WebGL 규약) */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function ortho(l, r, b, t, n, f) {
  const out = new Float32Array(16);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

export function lookAt(eye, center, up) {
  const f = normalize(sub(center, eye)); // forward
  const s = normalize(cross(f, up)); // right
  const u = cross(s, f);
  const out = new Float32Array(16);
  out[0] = s[0]; out[4] = s[1]; out[8] = s[2]; out[12] = -dot(s, eye);
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2]; out[13] = -dot(u, eye);
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = dot(f, eye);
  out[15] = 1;
  return out;
}

/**
 * 고정 아이소메트릭 뷰-프로젝션.
 * @returns {vp, eye, forward, right, up}
 */
export function isoCamera(aspect = ASPECT) {
  const ce = Math.cos(ELEVATION);
  const dir = [Math.sin(AZIMUTH) * ce, Math.sin(ELEVATION), Math.cos(AZIMUTH) * ce];
  const eye = [TARGET[0] + dir[0] * DIST, TARGET[1] + dir[1] * DIST, TARGET[2] + dir[2] * DIST];
  const view = lookAt(eye, TARGET, [0, 1, 0]);
  const halfW = HALF_H * Math.max(aspect, 1);
  const proj = ortho(-halfW, halfW, -HALF_H, HALF_H, 0.1, 12);
  const forward = normalize(sub(TARGET, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { vp: multiply(proj, view), eye, forward, right, up: cross(right, forward) };
}

/** 월드 좌표 → 캔버스 백분율 좌표({left, top} 0~100) — HTML 라벨 배치용 */
export function projectToPercent(vp, p) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15] || 1;
  return { left: ((x / w) * 0.5 + 0.5) * 100, top: (0.5 - (y / w) * 0.5) * 100 };
}

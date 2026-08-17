/**
 * camera — **원근** 카메라 + 최소 mat4 (MT-22 모식도).
 *
 * ⚠️ **직교가 아니라 원근이다.** 같은 문제를 먼저 겪은 곳이
 * `lib/guideBotMesh.js:166-175`이고 주석이 이렇게 적어 두었다: *"직교는 앞뒤가 같은
 * 크기로 그려져서 돌아도 평평해 보인다"*. 입체 화살표는 「앞의 것이 크다」가 있어야
 * 튀어나온 것으로 읽히므로 시야각 34°의 원근을 그대로 답습한다.
 * (단면 렌더러 `crossSection/camera.js`는 직교인데, 그쪽은 **고정 카메라 + 깊이 정렬**로
 * 반투명을 합성하는 다른 문제를 풀고 있다. 여기서 그 선택을 따라갈 이유가 없다.)
 *
 * 월드 좌표계 — 세 모식도가 공유한다:
 *   x  서→동 / y  고도(0 = 지표·해수면) / z  남→북(깊이)
 * 순수 함수만 — DOM 접근 없음(SSR 안전).
 */

/** 기본 시점. 장면이 `scene.camera`로 축별 덮어쓰기 가능하다. */
export const DEFAULT_VIEW = Object.freeze({
  yaw: 38, // 방위(도) — 0이면 +z에서 정면
  pitch: 22, // 내려다보는 각(도)
  dist: 3.2, // 타깃까지 거리
  fov: 34, // 시야각(도) — GuideBot3D와 같은 값
  target: Object.freeze([0, 0.28, 0]),
});
/** 기본 종횡비(가로:세로) — 패널 레이아웃이 흔들리지 않게 상수로 둔다 */
export const ASPECT = 16 / 10;

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

/** 원근 투영 — 깊이는 [-1,1](WebGL 기본 범위) */
export function perspective(fovRad, aspect, near, far) {
  const f = 1 / Math.tan(fovRad / 2);
  const out = new Float32Array(16);
  out[0] = f / Math.max(aspect, 1e-6);
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
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
 * 장면 시점 → { vp, eye, forward, right, up }.
 * **사용자 조작 없음**(학습 초점 유지) — 각도는 장면이 정하고 프레임 사이에 변하지 않는다.
 * @param view DEFAULT_VIEW를 부분 덮어쓰는 객체
 */
export function schematicCamera(aspect = ASPECT, view = null) {
  const v = { ...DEFAULT_VIEW, ...(view ?? {}) };
  const yaw = (v.yaw * Math.PI) / 180;
  const pitch = (v.pitch * Math.PI) / 180;
  const target = v.target ?? DEFAULT_VIEW.target;
  const cp = Math.cos(pitch);
  const dir = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const eye = [target[0] + dir[0] * v.dist, target[1] + dir[1] * v.dist, target[2] + dir[2] * v.dist];
  const viewM = lookAt(eye, target, [0, 1, 0]);
  // near를 너무 작게 잡으면 깊이 정밀도가 앞쪽에 몰려 **뒤쪽 화살표들끼리 z-fighting**한다.
  const proj = perspective((v.fov * Math.PI) / 180, aspect, Math.max(0.05, v.dist * 0.05), v.dist * 6);
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { vp: multiply(proj, viewM), eye, forward, right, up: cross(right, forward) };
}

/** 월드 좌표 → 캔버스 백분율({left, top} 0~100) — HTML/SVG 라벨 배치용 */
export function projectToPercent(vp, p) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15] || 1;
  return { left: ((x / w) * 0.5 + 0.5) * 100, top: (0.5 - (y / w) * 0.5) * 100 };
}

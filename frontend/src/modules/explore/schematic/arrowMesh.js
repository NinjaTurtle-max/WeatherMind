/**
 * arrowMesh — **입체 화살표** 지오메트리와 정규직교 기저 (MT-22).
 *
 * 왜 3D 화살표인가 — 조사(`docs/design/research/RESEARCH_MT22_CO2_TYPHOON.md` §3)가
 * 짚은 것이 정확히 이것이다: 태풍은 **하층에서 반시계로 빨려 들어가 상층에서
 * 시계로 빠져나간다**. 하층과 상층의 **회전 방향이 반대**라는 사실은 평면 화살표로는
 * 안 보인다(둘 다 그냥 굽은 선이 된다). 복사수지도 상향·하향이 교차하는데 앞뒤
 * 가림이 없으면 어느 쪽이 나가는 에너지인지 읽히지 않는다. 그래서 화살표가
 * **불투명 입체 메시**여야 하고, 그래야 깊이 버퍼가 앞뒤를 갈라 준다.
 *
 * ── 계약 ────────────────────────────────────────────────────────────────────
 * · **순수 함수**다. DOM·GL·시간·난수를 일절 모른다(SSR 안전 · 숫자로 검증 가능).
 * · **`Math.random` 금지** — 같은 인자면 언제나 **바이트 단위로 같은** 배열이다.
 *   렌더할 때마다 그림이 바뀌면 무엇 때문에 바뀐 건지 알 수 없다.
 * · 형식은 `crossSection/geometry.js`의 `unitCube()`를 그대로 답습한다:
 *   **pos(3) + normal(3) 인터리브**, 인덱스 없는 삼각형 나열, Float32Array 반환.
 *   정점 수는 분할 수에 따라 변하므로 상수 대신 `arrow3DVertexCount(segments)`가 짝이다.
 *
 * ── 로컬 좌표계 ──────────────────────────────────────────────────────────────
 *   y = **진행축**. y=0 꼬리, y=1 촉 끝(길이 1로 정규화 — 인스턴스가 배율을 준다)
 *   x,z = 굵기축(반지름 방향)
 * `crossSection/geometry.js:arrowShape()`도 +y가 진행축이라 감각이 이어진다.
 *
 * ⚠️ **왜 검증하지 않는 것을 굳이 이 파일에 모아 두었나** — jsdom에는 GL도 레이아웃도
 * 없어서 「입체로 보이는가」는 여기서 못 잰다. 대신 **입체가 성립하기 위한 수치 조건**
 * (법선 단위길이 · 자루와 머리의 접합 · 특이점 방향의 기저)은 전부 여기서 값으로
 * 단정할 수 있다. 그래서 GL이 필요한 부분을 최소로 밀어냈다.
 */

const TAU = Math.PI * 2;

/** 기본 비율 — 자루가 가늘고 머리가 셋 다 읽히는 값(교과서 화살표 감각) */
export const ARROW3D_DEFAULTS = Object.freeze({
  shaftRadius: 0.075,
  headRadius: 0.185,
  headLength: 0.34,
  segments: 16,
});

/**
 * 분할 수 → 정점 수. 부위별 내역:
 *   자루 옆면 6 (사각형 = 삼각형 2) + 꼬리 마개 3 + 머리 밑면 3 + 뿔 옆면 3 = **15/분할**
 * 16분할이면 240정점 · 인스턴스 40개여도 9,600정점/프레임이라 무시할 수준이다.
 */
export function arrow3DVertexCount(segments = ARROW3D_DEFAULTS.segments) {
  return normSegments(segments) * 15;
}

function normSegments(v) {
  const n = Math.round(Number.isFinite(v) ? v : ARROW3D_DEFAULTS.segments);
  return Math.max(3, Math.min(64, n));
}
function pick(v, fallback) {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 입체 화살표 — **원기둥 자루 + 원뿔 머리**.
 *
 * @param {object} [opts]
 * @param {number} [opts.shaftRadius] 자루 반지름(길이 1 기준)
 * @param {number} [opts.headRadius]  머리 밑면 반지름. **자루보다 작으면 자루 끝에
 *   구멍이 남으므로** 조용히 자루 반지름까지 끌어올린다(뚫린 화살표는 결함이지 표현이 아니다)
 * @param {number} [opts.headLength]  머리 길이(0<h<1). 나머지가 자루다
 * @param {number} [opts.segments]    원둘레 분할(3~64)
 * @returns {Float32Array} pos(3)+normal(3) 인터리브, `arrow3DVertexCount(segments)`개
 */
export function arrowMesh3D(opts = {}) {
  const seg = normSegments(opts.segments ?? ARROW3D_DEFAULTS.segments);
  const shaftR = pick(opts.shaftRadius, ARROW3D_DEFAULTS.shaftRadius);
  const headL = Math.min(0.95, Math.max(0.05, pick(opts.headLength, ARROW3D_DEFAULTS.headLength)));
  const headR = Math.max(shaftR, pick(opts.headRadius, ARROW3D_DEFAULTS.headRadius));
  const yTop = 1 - headL; // 자루 끝 = 머리 밑면. **두 부위가 공유하는 유일한 높이**다

  const out = new Float32Array(arrow3DVertexCount(seg) * 6);
  let o = 0;
  const push = (x, y, z, nx, ny, nz) => {
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
    out[o + 3] = nx; out[o + 4] = ny; out[o + 5] = nz;
    o += 6;
  };

  // 링을 **미리 표로** 만들고 인덱스를 `(i+1) % seg`로 감는다. cos(2π)와 cos(0)은
  // 부동소수에서 같지 않아서, 각도를 그때그때 계산하면 이음매에 머리카락만 한 틈이 생긴다.
  const cs = new Float64Array(seg);
  const sn = new Float64Array(seg);
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * TAU;
    cs[i] = Math.cos(a);
    sn[i] = Math.sin(a);
  }
  // 뿔 옆면의 기울기 법선 — 밑면 반지름 headR, 높이 headL인 원뿔의 옆면 법선은
  // normalize(headL·cosθ, headR, headL·sinθ)다(두 접선과의 내적이 0임을 계산으로 확인).
  const nl = Math.hypot(headL, headR) || 1;
  const coneR = headR / nl; // 법선의 y 성분
  const coneH = headL / nl; // 법선의 반지름 성분 배율

  for (let i = 0; i < seg; i += 1) {
    const j = (i + 1) % seg;
    const c0 = cs[i]; const s0 = sn[i];
    const c1 = cs[j]; const s1 = sn[j];

    // 1) 자루 옆면 — 법선은 반지름 방향(부드러운 원기둥)
    const ax = c0 * shaftR; const az = s0 * shaftR;
    const bx = c1 * shaftR; const bz = s1 * shaftR;
    push(ax, 0, az, c0, 0, s0);
    push(bx, 0, bz, c1, 0, s1);
    push(bx, yTop, bz, c1, 0, s1);
    push(ax, 0, az, c0, 0, s0);
    push(bx, yTop, bz, c1, 0, s1);
    push(ax, yTop, az, c0, 0, s0);

    // 2) 꼬리 마개 — 열어 두면 깊이 테스트가 켜진 채로 자루 속이 들여다보인다
    push(0, 0, 0, 0, -1, 0);
    push(bx, 0, bz, 0, -1, 0);
    push(ax, 0, az, 0, -1, 0);

    // 3) 머리 밑면 원반 — headR ≥ shaftR이라 자루 끝 구멍까지 함께 덮는다
    const hx0 = c0 * headR; const hz0 = s0 * headR;
    const hx1 = c1 * headR; const hz1 = s1 * headR;
    push(0, yTop, 0, 0, -1, 0);
    push(hx1, yTop, hz1, 0, -1, 0);
    push(hx0, yTop, hz0, 0, -1, 0);

    // 4) 뿔 옆면 — 꼭짓점 법선은 두 변 사이 중간 각도로 잡는다(꼭짓점에서 법선이
    //    수학적으로 정의되지 않으므로, 0벡터를 넣어 정규화가 NaN이 되는 것을 피한다)
    const am = ((i + 0.5) / seg) * TAU;
    push(hx0, yTop, hz0, c0 * coneH, coneR, s0 * coneH);
    push(hx1, yTop, hz1, c1 * coneH, coneR, s1 * coneH);
    push(0, 1, 0, Math.cos(am) * coneH, coneR, Math.sin(am) * coneH);
  }
  return out;
}

// ── 정규직교 기저 ─────────────────────────────────────────────────────────────
// 기존 2D 화살표 셰이더는 `d`와 `side` 둘뿐이라 3D 메시를 방향에 맞춰 **세울 수가
// 없다**(굵기축이 두 개 필요하다). 셋째 축은 셰이더에서 `cross(side, d)`로 만든다 —
// 두 벡터가 이미 직교 단위라 그 cross는 **절대 0이 되지 않는다**.
//
// 🔴 특이점은 여기, CPU에서 해소한다. `side = cross(d, [0,1,0])`은 **d가 수직일 때
// 0벡터**가 되고, 정규화하면 NaN이 되어 **수직 화살표가 화면에서 사라진다**.
// 복사수지(C1)는 입사·반사·재복사가 전부 수직이라 이 분기를 반드시 밟는다.
// CPU에서 푸는 이유는 GLSL로 밀면 같은 논리를 테스트용으로 JS에 한 번 더 써야 하기
// 때문이다 — 여기 있으면 jsdom이 값으로 직접 문다.

const UP = [0, 1, 0];
const ALT = [0, 0, 1]; // d가 UP과 (거의) 평행할 때 쓰는 대체 기준축

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function unit(v, fallback) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : fallback.slice();
}

/** 이 값을 넘으면 「UP과 평행」으로 보고 기준축을 갈아탄다(약 8.1°) */
export const PARALLEL_EPS = 0.99;

/**
 * 방향 벡터 → 정규직교 기저 `{ d, side, up }`(오른손계, up = cross(side, d)).
 *
 * 수평 방향에서는 `up`이 월드 상방과 일치한다 — 화살표가 옆으로 눕지 않는다.
 * 방향이 0벡터면 `+y`로 본다(장면 데이터의 오타가 NaN으로 번지지 않게).
 */
export function arrowBasis(dir) {
  const d = unit(Array.isArray(dir) ? dir : UP, UP);
  const ref = Math.abs(d[0] * UP[0] + d[1] * UP[1] + d[2] * UP[2]) > PARALLEL_EPS ? ALT : UP;
  const side = unit(cross3(d, ref), ALT);
  return { d, side, up: cross3(side, d) };
}

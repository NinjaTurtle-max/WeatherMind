/**
 * typhoonSectionScene — **T1 태풍 개별 단면** 장면 데이터 (MT-22).
 *
 * 🔴 **이 그림이 존재하는 이유가 회전 방향이다.** 조사(`docs/design/research/
 * RESEARCH_MT22_CO2_TYPHOON.md` §3 T1 · 출처 S1)의 핵심 문장:
 *   *"바람은 **하층에서 반시계 방향으로 중심을 향해 빨려 들어가** 꼭대기 부근에서
 *   **시계 방향으로 빠져나간다**"*
 * 하층과 상층의 **감김이 반대**라는 것이 평면 그림에서 가장 안 보이는 부분이고,
 * 클라이언트가 「화살표를 입체적으로」라고 콕 집어 말한 이유가 정확히 여기다.
 * 그래서 두 층을 **높이가 다른 접선 화살표 링 2개**로 세우고, 감는 방향을 반대로
 * 준다. 렌더러에 회전 프리미티브가 없는 것은 빠뜨린 것이 아니라 이 배치가
 * **장면 데이터의 몫**이기 때문이다(renderer.js 헤더가 그렇게 적어 두었다).
 *
 * 🔴 **틀리게 그리면 안 되는 사실 2건**(조사 §3 · 대장 §4.21이 재차 못박은 것):
 *  ① **최대 풍속은 중심이 아니라 눈벽 — 중심에서 40~100km.** 「가운데가 제일 세다」로
 *     그리면 틀린 것을 가르친다. 눈(지름 20~50km)은 오히려 **하강기류·약풍·맑음**이다.
 *     그래서 굵기(=풍속)가 **눈벽에서 최대**이고 **눈 중심에서 최소**다. 이 순서는
 *     `schematicGl.contract.test.mjs`가 값으로 문다.
 *  ② **진행 방향 오른쪽이 위험반원.** 비대칭이 구조의 일부라 오른쪽 유입 화살표를
 *     굵고 길게 준다(대칭으로 그리면 그것도 틀린 그림이다).
 *
 * ── 좌표 규약 ────────────────────────────────────────────────────────────────
 *   x = 동, **z = 남**(+z가 남쪽), y = 고도.
 * ⚠️ `camera.js`의 월드 규약(z = 남→북)과 **반대**다. 이유가 있다: 이 렌더러의
 * 시점에서 화면 오른쪽은 +x이고 화면 위쪽은 -z다. 지도 관례(동이 오른쪽·북이 위)를
 * 지키려면 **북이 -z**여야 하고, 안 그러면 지도가 아래위로 뒤집힌다. C1(복사수지)은
 * 지도가 아니라 옆에서 본 단면이라 그 규약이 필요 없었다.
 *
 * ── 축척 ─────────────────────────────────────────────────────────────────────
 *   가로 **1.0 = 300km** · 세로 **0.95 ≈ 16km**(구름 꼭대기 12~20km의 가운데).
 * ⚠️ 즉 **세로가 약 19배 과장**돼 있다. 실제 비율로 그리면 태풍은 지름 600km에
 * 두께 16km인 **종잇장**이라 연직 구조가 한 픽셀도 안 보인다. 교육용 모식도의
 * 관례대로 과장하되, 과장했다는 사실을 여기 적어 둔다(수치 라벨은 실제 값이다).
 */

const TAU = Math.PI * 2;

/** 가로 축척 — 이 값으로 나눈 km가 월드 단위다 */
export const KM_PER_UNIT = 300;
export const km = (v) => v / KM_PER_UNIT;

/** 조사 §3 T1의 수치 — 그림의 모든 반지름이 여기서 파생된다 */
export const T1_FACTS = Object.freeze({
  eyeRadiusKm: 25, // 지름 20~50km의 가운데
  maxWindInnerKm: 40, // 최대 풍속대 안쪽 경계
  maxWindOuterKm: 100, // 〃 바깥 경계
  outerRadiusKm: 285, // 전체 직경 200~2000km 중 작은 쪽
  cloudTopKm: 16, // 12~20km
  minPressureHpa: 950, // 최성기 970~930
});

const R_EYE = km(T1_FACTS.eyeRadiusKm); // 0.083
const R_WALL = km(70); // 눈벽 = 최대 풍속대(40~100km)의 한가운데
const R_OUTER = km(T1_FACTS.outerRadiusKm); // 0.95
const Y_LOW = 0.05; // 하층
const Y_TOP = 0.86; // 상층 유출 고도
const Y_CLOUD = 0.9; // 구름 꼭대기

// 굵기 = **풍속**. 이 셋의 대소가 곧 ①번 사실이다
export const T1_THICKNESS = Object.freeze({
  eyewall: 0.42, // 최대 — 눈벽(그래도 전체 최대여야 한다. 그것이 ①번 사실이다)
  inflow: 0.3, // 중간 — 바깥 유입
  outflow: 0.26, // 상층 유출
  eye: 0.09, // 최소 — 눈 속 하강기류(약풍)
});
/** 위험반원(진행 방향 오른쪽) 가중 — 비대칭이 구조의 일부다 */
export const DANGEROUS_GAIN = 1.55;

const SEA = '#38bdf8'; // 하층 유입(바다에서 빨려 든다)
const WALL = '#f472b6'; // 눈벽 상승
const OUT = '#fbbf24'; // 상층 유출
const EYE = '#a3a3a3'; // 눈 속 하강
const GRID = '#94a3b8';
const MOTION = '#e2e8f0';

/** 진행 방향 — 북서(무역풍대의 전형). z가 남이므로 북서 = (-x, -z) */
export const MOTION_DIR = Object.freeze([-Math.SQRT1_2, 0, -Math.SQRT1_2]);
/**
 * 진행 방향의 **오른쪽** 단위벡터 = m × ŷ. 화면(오른쪽 +x · 위 -z)에서 실제로
 * 오른편이 되는 쪽이다 — 위험반원의 정의가 「진행 방향 기준 오른쪽」이라 이 부호를
 * 틀리면 **위험한 쪽을 반대로 가르친다.**
 */
export function rightOfMotion(m = MOTION_DIR) {
  return [-m[2], 0, m[0]];
}

const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * 반지름 r·고도 y의 원 위 각도 a에서의 **접선 단위벡터**.
 * `spin > 0`이면 **위에서 봤을 때 반시계**다 — v = ŷ × p 이고, 이 렌더러 시점에서
 * 화면 오른쪽이 +x, 화면 위가 -z이므로 그 회전이 실제로 화면에서 반시계로 보인다.
 * (부호를 뒤집으면 시계다. 하층·상층이 이 부호 하나로 갈린다.)
 */
export function tangent(a, spin) {
  const p = [Math.cos(a), 0, Math.sin(a)];
  const t = [p[2], 0, -p[0]]; // ŷ × p
  return spin > 0 ? t : [-t[0], 0, -t[2]];
}
/** 바깥 방향(반지름) 단위벡터 */
export const radial = (a) => [Math.cos(a), 0, Math.sin(a)];

const arrow = (origin, dir, length, thickness, color, extra = {}) => ({
  type: 'arrow', origin, dir: norm(dir), length, thickness, color, alpha: 1, ...extra,
});
const label = (pos, text, color, extra = {}) => ({
  type: 'label', pos, text, size: 11, weight: 600, color, ...extra,
});
/** 수평 원 — 무대의 뼈대(눈·눈벽·바깥 경계·구름 꼭대기) */
function circle(r, y, seg = 48) {
  const pts = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * TAU;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return pts;
}
/** 나선대 — 로그 나선. 띠가 벽운으로 **말려 들어가는** 문법(조사 §3) */
function spiral(a0, turns = 0.85, seg = 34) {
  const pts = [];
  for (let i = 0; i <= seg; i += 1) {
    const u = i / seg;
    const a = a0 + u * TAU * turns;
    const r = R_WALL + (R_OUTER - R_WALL) * u ** 1.35;
    pts.push([Math.cos(a) * r, Y_LOW * 0.4, Math.sin(a) * r]);
  }
  return pts;
}

/**
 * 링 하나 — 같은 고도의 접선 화살표 n개.
 * @param spin +1 반시계(하층 유입) / -1 시계(상층 유출)
 * @param inward >0이면 안쪽으로 빨려 들고, <0이면 바깥으로 퍼진다
 */
function ring({ n, r, y, spin, inward, thickness, color, length, at, until, dangerous = false }) {
  const items = [];
  const right = rightOfMotion();
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const p = radial(a);
    const t = tangent(a, spin);
    const dir = [t[0] - inward * p[0], 0, t[2] - inward * p[2]];
    // 위험반원 가중 — 진행 방향 오른쪽 반원만 굵고 길다
    const side = dangerous ? dot2(p, right) : 0;
    const gain = side > 0.2 ? DANGEROUS_GAIN : 1;
    items.push(arrow(
      [p[0] * r, y, p[2] * r], dir, length * (gain > 1 ? 1.25 : 1), thickness * gain, color,
      { at, until, spin, ring: true },
    ));
  }
  return items;
}

/** 단계 — 「무대 → 하층이 감아 든다 → 눈벽이 솟는다 → 상층이 반대로 풀린다 → 어디가 센가」 */
export const T1_STEPS = Object.freeze([
  { key: 'stage', title: '눈과 눈벽' },
  { key: 'inflow', title: '하층 — 반시계로 빨려 든다' },
  { key: 'updraft', title: '눈벽은 솟고 눈은 가라앉는다' },
  { key: 'outflow', title: '상층 — 시계로 빠져나간다' },
  { key: 'danger', title: '최대 풍속은 눈벽 · 오른쪽이 위험반원' },
]);

export const TYPHOON_SECTION_SCENE = Object.freeze({
  id: 't1-typhoon-section',
  background: null,
  // 🔴 pitch가 낮으면 링이 옆에서 눌려 **감기는 방향이 안 보인다**(실기기에서 확인).
  // 회전을 읽히게 하려면 위에서 내려다봐야 하고, 그래도 원근이라 앞쪽이 크다.
  camera: { yaw: 24, pitch: 40, dist: 3.65, fov: 34, target: [0, 0.34, 0] },
  items: [
    // ── 0단계: 무대 ─────────────────────────────────────────────────────────
    { type: 'line', points: circle(R_OUTER, 0), closed: true, color: GRID, alpha: 0.45, at: 0 },
    { type: 'line', points: circle(R_WALL, 0), closed: true, color: WALL, alpha: 0.5, at: 0 },
    { type: 'line', points: circle(R_EYE, 0), closed: true, color: EYE, alpha: 0.8, at: 0 },
    { type: 'line', points: circle(km(150), Y_CLOUD, 40), closed: true, color: GRID, alpha: 0.3, at: 0 },
    { type: 'line', points: spiral(0.4), color: SEA, alpha: 0.4, at: 0 },
    { type: 'line', points: spiral(0.4 + TAU / 3), color: SEA, alpha: 0.4, at: 0 },
    { type: 'line', points: spiral(0.4 + (2 * TAU) / 3), color: SEA, alpha: 0.4, at: 0 },
    // 중심축 — 눈의 위치를 세로로 못박아 준다
    { type: 'line', points: [[0, 0, 0], [0, Y_CLOUD, 0]], color: EYE, alpha: 0.35, at: 0 },
    label([-0.62, Y_CLOUD + 0.2, 0.5], `구름 꼭대기 ${T1_FACTS.cloudTopKm}km(12~20km)`, GRID, { at: 0 }),
    label([0, -0.16, R_EYE + 0.16], `눈 — 지름 ${T1_FACTS.eyeRadiusKm * 2}km 안팎`, EYE, { at: 0 }),
    label([-R_WALL - 0.34, -0.06, R_WALL * 1.5], '눈벽(벽운)', WALL, { at: 0 }),
    // 진행 방향 — 위험반원 판정의 기준이라 0단계부터 세운다
    arrow([R_OUTER * MOTION_DIR[0] * 0.85, 0.02, R_OUTER * MOTION_DIR[2] * 0.85], MOTION_DIR, 0.42, 0.34, MOTION, { at: 0 }),
    label([R_OUTER * MOTION_DIR[0] * 1.15, 0.28, R_OUTER * MOTION_DIR[2] * 1.15], '진행 방향', MOTION, { at: 0 }),

    // ── 1단계: 하층 유입 — **반시계**(spin +1), 안쪽으로 빨려 든다 ───────────
    ...ring({ n: 12, r: R_OUTER * 0.86, y: Y_LOW, spin: +1, inward: 0.55, thickness: T1_THICKNESS.inflow, color: SEA, length: 0.32, at: 1, dangerous: true }),
    label([-R_OUTER * 0.72, 0.04, R_OUTER * 0.78], '하층: 반시계로 빨려 든다', SEA, { at: 1 }),
    // 눈벽 접선 — **여기가 최대 풍속**이다(중심이 아니다). 굵기가 그것을 말한다
    ...ring({ n: 8, r: R_WALL, y: Y_LOW + 0.02, spin: +1, inward: 0.18, thickness: T1_THICKNESS.eyewall, color: WALL, length: 0.19, at: 1, dangerous: true }),

    // ── 2단계: 눈벽 상승 + 눈 하강 ──────────────────────────────────────────
    // 정확히 수직이라 `arrowBasis`의 특이점 분기를 여기서도 밟는다
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * TAU + 0.26;
      const p = radial(a);
      return arrow([p[0] * R_WALL, Y_LOW + 0.03, p[2] * R_WALL], [p[0] * 0.16, 1, p[2] * 0.16],
        Y_TOP - Y_LOW - 0.05, T1_THICKNESS.eyewall * 0.5, WALL, { at: 2 });
    }),
    label([R_WALL + 0.1, Y_TOP * 0.95, -R_WALL * 2.4], '눈벽에서 솟아오른다', WALL, { at: 2 }),
    // 눈 속 — 하강기류·약풍·맑음. **가장 가는 화살표**여야 한다
    arrow([0, Y_TOP * 0.82, 0], [0, -1, 0], Y_TOP * 0.62, T1_THICKNESS.eye, EYE, { at: 2 }),
    label([-0.78, Y_TOP * 0.44, 0.34], '눈 속은 하강기류 · 바람 약함 · 맑음', EYE, { at: 2 }),

    // ── 3단계: 상층 유출 — **시계**(spin -1), 바깥으로 퍼진다 ────────────────
    ...ring({ n: 10, r: km(195), y: Y_TOP, spin: -1, inward: -0.45, thickness: T1_THICKNESS.outflow, color: OUT, length: 0.42, at: 3 }),
    label([R_OUTER * 0.3, Y_TOP + 0.26, -R_OUTER * 0.75], '상층: 시계로 빠져나간다 — 하층과 반대다', OUT, { at: 3 }),

    // ── 4단계: 틀리기 쉬운 두 가지를 글자로도 못박는다 ──────────────────────
    label([R_WALL + 0.72, 0.02, R_WALL * 2.6], `최대 풍속은 눈벽 — 중심에서 ${T1_FACTS.maxWindInnerKm}~${T1_FACTS.maxWindOuterKm}km`, WALL, { at: 4, size: 12 }),
    label([rightOfMotion()[0] * R_OUTER * 1.05, 0.42, rightOfMotion()[2] * R_OUTER * 1.05], '오른쪽 = 위험반원(더 세다)', '#fca5a5', { at: 4, size: 12 }),
    label([-0.5, -0.16, R_OUTER * 0.62], `중심기압 최성기 ${T1_FACTS.minPressureHpa}hPa 안팎 · 에너지원은 수증기의 잠열`, GRID, { at: 4 }),
  ],
});

/** 계약 테스트가 값으로 검산하는 표 — 「그림이 사실과 맞나」를 코드가 판정한다 */
export function t1Checks() {
  const arrows = TYPHOON_SECTION_SCENE.items.filter((it) => it.type === 'arrow');
  const radiusOf = (a) => Math.hypot(a.origin[0], a.origin[2]);
  const maxWind = arrows.reduce((m, a) => (a.thickness > m.thickness ? a : m), arrows[0]);
  return {
    maxWindRadiusKm: radiusOf(maxWind) * KM_PER_UNIT,
    maxWindThickness: maxWind.thickness,
    eyeThickness: Math.min(...arrows.filter((a) => radiusOf(a) < R_EYE).map((a) => a.thickness)),
    lowSpins: arrows.filter((a) => a.ring && a.origin[1] < 0.4).map((a) => a.spin),
    highSpins: arrows.filter((a) => a.ring && a.origin[1] >= 0.4).map((a) => a.spin),
    eyeRadius: R_EYE,
    wallRadius: R_WALL,
  };
}

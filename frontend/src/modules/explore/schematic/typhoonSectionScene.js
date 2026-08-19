/**
 * typhoonSectionScene — **T1 태풍 개별 단면** 장면 데이터 (MT-22 · 2026-08-19 재제작).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  왜 다시 그렸나 — **1단계가 「검은 상자에 떠 있는 글자 4개」였다**
 * ══════════════════════════════════════════════════════════════════════════════
 * 실측: 종전 0단계의 항목은 `{line 8, label 4, arrow 1}`. 그림이 하나도 없었다.
 * 종전 그림은 **위에서 내려다본 평면 링 다이어그램**이었고, 보드가 쓰는
 * 「투명 유리 상자 + 지도 시점 바닥 + 전면 수직 단면」과 **다른 언어**였다.
 *
 * 🔴 그래서 **판형을 바꿨다 — 이제 진짜 「단면」이다.** 눈을 가운데 두고 좌우로
 * 갈라 자른 연직 단면이고, 바닥은 바다 평면이다. 이름(「태풍 **단면**」)과 그림이
 * 처음으로 일치한다. 회전 방향은 단면 위에서 **남북(z) 성분**이 말한다(아래 ②).
 *
 * 🔴 **틀리게 그리면 안 되는 사실 3건**(조사 §3 T1 · 출처 S1 · 대장 §4.21):
 *  ① **최대 풍속은 중심이 아니라 눈벽 — 중심에서 40~100km.** 「가운데가 제일 세다」로
 *     그리면 틀린 것을 가르친다. 눈(지름 20~50km)은 **하강기류·약풍·맑음**이다.
 *     그래서 눈벽 화살표가 전체 최대이고 눈 속 화살표가 전체 최소다.
 *  ② **하층은 반시계로 수렴, 상층은 시계로 발산 — 감김이 반대다.**
 *     단면에서는 좌우가 아니라 **앞뒤(z)**가 그것을 말한다: 저기압성(반시계) 접선은
 *     `p × ŷ = (-pz, 0, px)`이므로 **동쪽(px>0) 하층은 북(+z)**으로 흐르고,
 *     상층은 고기압성이라 **동쪽에서 남(-z)**으로 흐른다. 부호가 곧 사실이다.
 *  ③ **진행 방향 오른쪽이 위험반원.** 진행이 북(+z)이므로 오른쪽은 동(+x)이고,
 *     동쪽 화살표만 `DANGEROUS_GAIN`만큼 굵다(대칭으로 그리면 그것도 틀린 그림).
 *
 * ── 좌표 규약 — **보드와 같다**(따로 만들지 않았다) ──────────────────────────
 *   x 0~1 서→동(0.5 = 눈 중심) · y 고도(`H(h)`, 0 = 해수면) · z 0~0.42 남→북(깊이).
 * 종전 파일은 「z = 남」이라는 **자기만의 규약**을 세웠는데, 그것이 보드와 어긋나
 * 두 그림이 다른 세계로 보이던 원인 중 하나였다. 규약을 보드로 되돌렸다.
 *
 * ── 축척 ─────────────────────────────────────────────────────────────────────
 *   가로 **1.0 = 600km** · 세로 `H(1)`이 약 **16km**(구름 꼭대기 12~20km의 가운데).
 * ⚠️ 즉 **세로가 약 37배 과장**돼 있다. 실제 비율로 그리면 태풍은 지름 600km에
 * 두께 16km인 **종잇장**이라 연직 구조가 한 픽셀도 안 보인다. 교육용 모식도의
 * 관례대로 과장하되, 과장했다는 사실을 여기 적어 둔다(수치 라벨은 실제 값이다).
 */
import {
  H, ZC, Z, bb, cbTower, flow, label, precip, puff, composeScene,
} from '../../board/webgl/crossSection/scenes.js';
import { rgba } from '../../board/webgl/crossSection/glCore.js';

/** 가로 축척 — 이 값으로 나눈 km가 월드 단위다(상자 폭 1.0 = 600km) */
export const KM_PER_UNIT = 600;
export const km = (v) => v / KM_PER_UNIT;

/** 조사 §3 T1의 수치 — 그림의 모든 반지름이 여기서 파생된다 */
export const T1_FACTS = Object.freeze({
  eyeRadiusKm: 25, // 지름 20~50km의 가운데
  maxWindInnerKm: 40, // 최대 풍속대 안쪽 경계
  maxWindOuterKm: 100, // 〃 바깥 경계
  outerRadiusKm: 285, // 전체 직경 200~2000km 중 작은 쪽
  cloudTopKm: 16, // 12~20km
  minPressureHpa: 950, // 최성기 970~930
  warmSeaC: 26.5, // 이 온도 위에서만 산다
});

/** 눈 중심의 x — 단면의 대칭축 */
export const EYE_X = 0.5;
const R_EYE = km(T1_FACTS.eyeRadiusKm); // 0.042
const R_WALL = km(70); // 눈벽 = 최대 풍속대(40~100km)의 한가운데 → 0.117
const R_OUTER = km(T1_FACTS.outerRadiusKm); // 0.475
const Y_LOW = H(0.1); // 하층 유입 고도
const Y_TOP = H(0.92); // 상층 유출 고도
const CLOUD_TOP = 0.98; // 구름 꼭대기(h)

/**
 * 굵기 = **풍속**. 보드 무대의 화살표 크기(`flow`의 `scale`) 단위다.
 * 이 넷의 대소가 곧 ①번 사실이고 `schematicGl.contract`가 값으로 문다.
 */
export const T1_THICKNESS = Object.freeze({
  eyewall: 0.058, // 최대 — 눈벽
  inflow: 0.042, // 중간 — 바깥 유입
  outflow: 0.038, // 상층 유출
  eye: 0.026, // 최소 — 눈 속 하강기류(약풍)
});
/**
 * 위험반원(진행 방향 오른쪽) 가중 — 비대칭이 구조의 일부다.
 * ⚠️ **유입에 이 가중을 곱해도 눈벽을 넘으면 안 된다**(넘으면 ①이 깨진다):
 *    inflow 0.042 × 1.35 = 0.0567 < eyewall 0.058 ✓
 */
export const DANGEROUS_GAIN = 1.35;

// ── 색 — **보드 팔레트 그대로** ──────────────────────────────────────────────
const SEA = '#0284c7'; // 하층 유입(바다에서 빨려 든다) — 보드 비·바다 계열
const SEA_TXT = '#0369a1';
const WALL = '#dc2626'; // 눈벽 상승 — 보드 온난·상승 계열
const WALL_TXT = '#b91c1c';
const OUT = '#7c3aed'; // 상층 유출 — 보드 시어·정체 계열(하층과 색부터 다르다)
const OUT_TXT = '#6d28d9';
const EYE_TXT = '#475569';
const WARM_TXT = '#c2410c';

/** 진행 방향 — **북**(+z). 위험반원 판정의 기준이라 0단계부터 세운다 */
export const MOTION_DIR = Object.freeze([0, 0, 1]);
/**
 * 진행 방향의 **오른쪽** 단위벡터 = ŷ × m.
 * 위험반원의 정의가 「진행 방향 기준 오른쪽」이라 이 부호를 틀리면
 * **위험한 쪽을 반대로 가르친다.** m = 북(+z) → 오른쪽 = 동(+x).
 */
export function rightOfMotion(m = MOTION_DIR) {
  return [m[2], 0, -m[0]];
}

/**
 * 저기압성(위에서 볼 때 **반시계**) 접선 = `p × ŷ = (-pz, 0, px)`.
 * `spin`이 -1이면 고기압성(시계)이다 — 하층과 상층이 이 부호 하나로 갈린다.
 */
export function tangent(p, spin) {
  const t = [-p[2], 0, p[0]];
  return spin > 0 ? t : [-t[0], 0, -t[2]];
}

/**
 * 단계 — **메커니즘 순서**로 나눈다. 태풍 단면에서 그 순서는
 * 「무대(따뜻한 바다와 구름벽) → 하층이 빨려 든다 → 눈벽이 솟고 눈은 가라앉는다 →
 * 상층이 반대로 풀린다 → 그래서 어디가 가장 센가」다. **③이 ②의 결과이고
 * ④가 ③의 배출구**라, 순서를 바꾸면 「왜 눈이 맑은가」가 설명되지 않는다.
 */
export const T1_STEPS = Object.freeze([
  { key: 'stage', title: '따뜻한 바다 위 — 눈과 눈벽' },
  { key: 'inflow', title: '하층 — 반시계로 빨려 든다' },
  { key: 'updraft', title: '눈벽은 솟고 눈은 가라앉는다' },
  { key: 'outflow', title: '상층 — 시계로 빠져나간다' },
  { key: 'danger', title: '최대 풍속은 눈벽 · 오른쪽이 위험반원' },
]);

/**
 * 단면 위 한 지점의 기류 — `side`가 +1이면 동(눈 오른쪽), -1이면 서.
 * 방향은 「반지름 성분(수렴/발산) + 접선 성분(회전)」의 합이고, 접선의 부호가
 * 곧 감김이다. 위험반원 가중은 **동쪽(오른쪽)에만** 붙는다.
 */
function limb({ side, x, y, radialGain, spin, rise = 0, thickness, color, travel, count, speed, at, dangerous = true }) {
  const p = [side, 0, 0]; // 단면 위에서 중심 → 이 지점의 방향(z 성분 0)
  const t = tangent(p, spin);
  const dir = [radialGain * p[0], rise, t[2]];
  const gain = dangerous && side > 0 ? DANGEROUS_GAIN : 1;
  return flow({
    from: [x, y, ZC], dir, travel: travel * (gain > 1 ? 1.2 : 1), count,
    scale: thickness * gain, color: rgba(color, 0.95), speed, at, spreadZ: 0.12,
    // 계약 테스트가 읽는 표식 — 층과 감김을 좌표 밖에서도 되짚을 수 있게 한다
  }).map((a) => ({ ...a, ring: spin > 0 ? 'low' : 'high', side, spin }));
}

export const TYPHOON_SECTION_SCENE = composeScene({
  night: false,
  sea: { from: 0, to: 1 }, // 바닥 전체가 바다 — 태풍은 바다 위에서만 산다
  items: [
    // ── 0단계: 무대 ─────────────────────────────────────────────────────────
    // 따뜻한 바다 = 연료. 보드의 `groundHeating` 관용구(bb kind 3)를 바다에 쓴다.
    bb({ x: 0.5, y: 0.004, w: 1.0, h: 0.1, color: rgba('#fb923c', 0.4), kind: 3, at: 0 }),
    label({ x: 0.2, y: H(0.06), text: `해수면 ${T1_FACTS.warmSeaC}°C 이상 — 태풍의 연료`, color: WARM_TXT, at: 0, size: 10 }),
    // 눈벽(벽운) — 좌우 두 개의 적란운 타워. **이것이 「단면」의 주역**이다.
    ...cbTower({ x: EYE_X - R_WALL, z: ZC, top: H(CLOUD_TOP), at: 0 }),
    ...cbTower({ x: EYE_X + R_WALL, z: ZC, top: H(CLOUD_TOP), at: 0 }),
    label({ x: EYE_X - R_WALL - 0.14, y: H(0.86), text: '눈벽(벽운)', color: WALL_TXT, at: 0, size: 11 }),
    label({ x: 0.34, y: H(1.1), text: `구름 꼭대기 ${T1_FACTS.cloudTopKm}km(12~20km)`, color: '#475569', at: 0, size: 10 }),
    // 바깥 나선대 — 눈벽에서 멀어질수록 낮고 성기다
    puff({ x: 0.09, y: H(0.46), s: 1.15, color: rgba('#cbd5e1', 0.9), at: 0 }),
    puff({ x: 0.91, y: H(0.46), s: 1.15, color: rgba('#cbd5e1', 0.9), at: 0 }),
    label({ x: 0.09, y: H(0.68), text: '바깥 나선 비구름대', color: '#475569', at: 0, size: 9.5 }),
    // 눈 — 구름을 **비워 두는 것**이 그림이다(중앙에 아무것도 놓지 않는다)
    label({ x: EYE_X, y: H(0.4), text: `눈 — 지름 ${T1_FACTS.eyeRadiusKm * 2}km 안팎`, color: EYE_TXT, at: 0, size: 10 }),

    // ── 1단계: 하층이 빨려 든다 — 반시계(spin +1) ───────────────────────────
    // 동쪽(오른쪽)은 접선이 북(+z), 서쪽은 남(-z) — 그것이 반시계다.
    ...limb({ side: +1, x: EYE_X + R_OUTER, y: Y_LOW, radialGain: -0.9, spin: +1, rise: 0.04, thickness: T1_THICKNESS.inflow, color: SEA, travel: 0.3, count: 3, speed: 0.5, at: 1 }),
    ...limb({ side: -1, x: EYE_X - R_OUTER, y: Y_LOW, radialGain: -0.9, spin: +1, rise: 0.04, thickness: T1_THICKNESS.inflow, color: SEA, travel: 0.3, count: 3, speed: 0.5, at: 1 }),
    label({ x: 0.15, y: H(0.28), text: '하층: 반시계로 빨려 든다', color: SEA_TXT, at: 1, size: 10 }),

    // ── 2단계: 눈벽은 솟고 눈은 가라앉는다 ──────────────────────────────────
    // 🔴 **여기가 전체 최대 굵기**다 — 최대 풍속은 눈벽이지 중심이 아니다.
    ...limb({ side: +1, x: EYE_X + R_WALL, y: H(0.14), radialGain: -0.12, spin: +1, rise: 2.6, thickness: T1_THICKNESS.eyewall, color: WALL, travel: 0.26, count: 3, speed: 0.62, at: 2 }),
    ...limb({ side: -1, x: EYE_X - R_WALL, y: H(0.14), radialGain: -0.12, spin: +1, rise: 2.6, thickness: T1_THICKNESS.eyewall, color: WALL, travel: 0.26, count: 3, speed: 0.62, at: 2 }),
    label({ x: EYE_X + R_WALL + 0.2, y: H(0.6), text: '눈벽에서 솟아오른다 — 여기가 가장 세다', color: WALL_TXT, at: 2, size: 10 }),
    // 눈 속 — 하강기류·약풍·맑음. **가장 가는 화살표**여야 한다
    ...flow({ from: [EYE_X, H(0.66), ZC], dir: [0, -1, 0], travel: 0.22, count: 1, scale: T1_THICKNESS.eye, color: rgba('#94a3b8', 0.95), speed: 0.24, at: 2 })
      .map((a) => ({ ...a, eye: true })),
    label({ x: EYE_X, y: H(0.2), text: '눈 속은 하강기류 · 바람 약함 · 맑음', color: EYE_TXT, at: 2, size: 10 }),
    // 눈벽 아래에만 비가 온다 — 눈에는 안 온다는 것이 이 배치의 뜻이다
    precip({ x0: EYE_X - R_WALL - 0.07, x1: EYE_X - R_WALL + 0.05, y1: H(0.7), z0: 0.06, z1: Z - 0.06, slant: 0.3, speed: 1.7, count: 26, at: 2 }),
    precip({ x0: EYE_X + R_WALL - 0.05, x1: EYE_X + R_WALL + 0.07, y1: H(0.7), z0: 0.06, z1: Z - 0.06, slant: 0.3, speed: 1.7, count: 26, at: 2 }),

    // ── 3단계: 상층이 반대로 풀린다 — 시계(spin -1) ─────────────────────────
    // 모루가 옆으로 퍼지는 것이 상층 발산의 겉모습이다
    bb({ x: 0.5, y: H(1.02), w: 0.86, h: 0.09, color: rgba('#e2e8f0', 0.9), kind: 1, at: 3 }),
    ...limb({ side: +1, x: EYE_X + R_WALL + 0.04, y: Y_TOP, radialGain: 0.9, spin: -1, rise: 0.1, thickness: T1_THICKNESS.outflow, color: OUT, travel: 0.32, count: 3, speed: 0.56, at: 3, dangerous: false }),
    ...limb({ side: -1, x: EYE_X - R_WALL - 0.04, y: Y_TOP, radialGain: 0.9, spin: -1, rise: 0.1, thickness: T1_THICKNESS.outflow, color: OUT, travel: 0.32, count: 3, speed: 0.56, at: 3, dangerous: false }),
    label({ x: 0.66, y: H(1.2), text: '상층: 시계로 빠져나간다 — 하층과 반대다', color: OUT_TXT, at: 3, size: 10 }),

    // ── 4단계: 그래서 어디가 센가 ───────────────────────────────────────────
    // 진행 방향은 바닥 평면 위에 둔다(지도 시점 바닥이 보드 문법의 절반이다)
    ...flow({ from: [0.5, 0.012, 0.04], dir: MOTION_DIR, travel: 0.16, count: 1, scale: 0.05, color: rgba('#334155', 0.9), speed: 0.3, at: 4 })
      .map((a) => ({ ...a, motion: true })),
    label({ x: 0.46, y: H(-0.1), text: '진행 방향(북)', color: '#334155', at: 4, size: 10 }),
    label({ x: 0.83, y: H(0.42), text: '오른쪽 = 위험반원(더 세다)', color: '#b91c1c', at: 4, size: 11 }),
    label({ x: 0.32, y: H(0.46), text: `최대 풍속은 눈벽 — 중심에서 ${T1_FACTS.maxWindInnerKm}~${T1_FACTS.maxWindOuterKm}km`, color: WALL_TXT, at: 4, size: 10 }),
    label({ x: 0.5, y: H(-0.22), text: `중심기압 최성기 ${T1_FACTS.minPressureHpa}hPa 안팎 · 에너지원은 수증기의 잠열`, color: '#475569', at: 4, size: 9.5 }),
  ],
});

/** 계약 테스트가 값으로 검산하는 표 — 「그림이 사실과 맞나」를 코드가 판정한다 */
export function t1Checks() {
  const arrows = TYPHOON_SECTION_SCENE.items.filter((it) => it.type === 'arrow');
  const radiusKm = (a) => Math.abs(a.origin[0] - EYE_X) * KM_PER_UNIT;
  const strongest = arrows.reduce((m, a) => (a.scale > m.scale ? a : m), arrows[0]);
  const eyeArrows = arrows.filter((a) => radiusKm(a) < T1_FACTS.eyeRadiusKm);
  return {
    maxWindRadiusKm: radiusKm(strongest),
    maxWindScale: strongest.scale,
    eyeScale: Math.min(...eyeArrows.map((a) => a.scale)),
    lowSpins: [...new Set(arrows.filter((a) => a.ring === 'low').map((a) => a.spin))],
    highSpins: [...new Set(arrows.filter((a) => a.ring === 'high').map((a) => a.spin))],
    eyeRadius: R_EYE,
    wallRadius: R_WALL,
  };
}

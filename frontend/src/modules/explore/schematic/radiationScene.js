/**
 * radiationScene — **C1 지구 복사수지** 모식도 장면 데이터 (MT-22).
 *
 * MT-22가 만들 모식도는 셋이었다(T1 태풍 단면 · T2 태풍 생애 · C1 복사수지).
 * **먼저 세우는 것은 C1 하나**다 — 「하나만 세우고 실기기로 확인, 되면 나머지」라는
 * 클라이언트·PM 지시이고, **C1이 미검증 항목을 가장 많이 결정하기 때문**이다:
 *  · 입사·방출이 **수직**이라 `arrowBasis`의 **특이점 분기를 반드시 밟는다**
 *    (수평 화살표만 있는 장면은 그 분기를 한 번도 안 지난다)
 *  · 상향·하향이 **앞뒤로 교차**해서 깊이 테스트가 없으면 뜻이 뒤집힌다 —
 *    이 과업이 존재하는 이유 그 자체다
 *  · 원기둥이 세로로 서 있어 램버트 음영의 좌우 그러데이션이 가장 크게 보인다
 *    (「원근에서 입체로 읽히는가」 판정에 가장 유리한 표본)
 *
 * ── 숫자의 출처와 저작권 선 ─────────────────────────────────────────────────
 * 수치는 `docs/design/research/RESEARCH_MT22_CO2_TYPHOON.md` §3 C1(출처 S2)이
 * 소유한다. **차용한 것은 「표현 문법」이지 그림이 아니다** — 어떤 이미지도 보고
 * 따라 그리지 않았고, 배치·색·카메라는 전부 이 파일이 새로 정한 것이다.
 * 문법 두 가지만 가져왔다:
 *   ① **TOA 입사 340 W/m²를 100단위로 정규화**한다
 *   ② **굵기가 에너지량에 비례**한다(Sankey 관례)
 *
 * ── 수지 (합이 맞는지 아래 UNITS로 직접 검산된다) ───────────────────────────
 *   입사 100 = 반사 35(구름 27 + 눈얼음 2 + 대기 6) + 흡수 65(대기 14 + 지표 51)
 *   지표 51 → 우주로 직접 17 · 대기로 34(잠열 19 + 대류·난류 9 + 온실기체 흡수 6)
 *   OLR 65 = 직접 17 + 대기 방출 48  ⇒ 흡수 65와 균형
 *   **EEI ≈ +0.9 W/m² = 0.26단위** — 이 미세한 초과가 온난화다
 *
 * ⚠️ **글자는 GL이 그리지 않는다.** `label` 항목은 `labelsFor()`가 화면 백분율로
 * 돌려주고 호출측이 겹쳐 그린다. 그래서 한국어 문자열이 이 파일에 리터럴로 있다 —
 * **i18n 외부화는 별도 담당 몫**이라 손대지 않았다(키가 필요하면 이 파일의
 * `text`·`caption`만 옮기면 된다).
 */

/** 100단위 정규화의 기준 — 이 값이 100단위다(W/m²) */
export const TOA_INSOLATION_WM2 = 340;
/** 지구 에너지 불균형(2005~2019) — 100단위로는 0.26 */
export const EEI_WM2 = 0.9;
export const EEI_UNITS = Math.round((EEI_WM2 / TOA_INSOLATION_WM2) * 1000) / 10; // 0.3

/** 갈래별 에너지(100단위). 그림의 모든 굵기가 여기서 파생된다 */
export const UNITS = Object.freeze({
  incoming: 100,
  reflectCloud: 27,
  reflectSurface: 2,
  reflectAir: 6,
  absorbAir: 14,
  absorbSurface: 51,
  windowIR: 17,
  latent: 19,
  thermals: 9,
  surfaceIR: 6,
  atmosphereIR: 48,
});

/**
 * 굵기 = 에너지량에 **선형 비례**(Sankey 문법). 다만 바닥이 있다.
 *
 * ⚠️ 순수 비례로 두면 2단위(눈·얼음 반사)가 100단위의 1/50이 되어 **실 화면에서
 * 선 한 올**로 사라진다. 그래서 `MIN_THICKNESS` 아래로는 내려가지 않게 잘랐다.
 * 이것은 문법의 예외이므로 **어디까지가 비례이고 어디부터가 바닥인지**를 값으로
 * 고정해 둔다(`schematicGl.contract.test.mjs`가 둘 다 문다):
 *   · u ≥ FLOOR_UNITS(≈13.5) 구간은 **정확히 비례**
 *   · 그 아래는 전부 같은 굵기 — 「작다」까지만 말하고 「얼마나 작은지」는 라벨이 말한다
 */
export const UNIT_THICKNESS = 0.0052; // 100단위 → 0.52
export const MIN_THICKNESS = 0.07;
export const FLOOR_UNITS = MIN_THICKNESS / UNIT_THICKNESS; // ≈ 13.5 — 이 아래(2·6·9)만 바닥

export function thicknessFor(units) {
  const u = Number.isFinite(units) ? Math.abs(units) : 0;
  return Math.max(MIN_THICKNESS, u * UNIT_THICKNESS);
}

// ── 고도 규약 ────────────────────────────────────────────────────────────────
// y = 0 지표 · y = 0.52 대기(구름)층 · y = 1.05 대기권 밖(TOA).
// x는 이야기 순서(왼쪽 = 들어오는 빛, 오른쪽 = 나가는 열)이고, z로 앞뒤를 갈라
// **상향과 하향이 화면에서 겹치게** 배치했다 — 깊이 테스트가 일을 하는 자리다.
const TOA = 1.05;
const AIR = 0.52;

const SUN = '#fbbf24'; // 태양 단파(들어오는 것)
const REFLECT = '#7dd3fc'; // 반사되어 되나가는 단파
const ABSORB = '#fb923c'; // 흡수(데워지는 것)
const LONGWAVE = '#f87171'; // 지구 장파(나가는 열)
const LATENT = '#34d399'; // 잠열·대류(물과 공기가 나르는 것)
const GRID = '#94a3b8';

const arrow = (origin, dir, length, units, color, extra = {}) => ({
  type: 'arrow',
  origin,
  dir,
  length,
  thickness: thicknessFor(units),
  color,
  alpha: 1, // 🔴 불투명 고정 — 앞뒤 가림이 이 그림의 뜻이다(반투명이면 깊이가 거짓말을 한다)
  units,
  ...extra,
});

const label = (pos, text, color, extra = {}) => ({
  type: 'label', pos, text, size: 11, weight: 600, color, ...extra,
});

/**
 * 단계(step) — 「들어온다 → 되나간다 → 데운다 → 나간다 → 그런데 조금 남는다」.
 * 항목의 `at`이 이 인덱스이고, 단계는 **누적**이다(끄지 않는다 — 마지막에 수지
 * 전체가 한 화면에 있어야 「균형」이 보인다).
 */
export const RADIATION_STEPS = Object.freeze([
  { key: 'incoming', title: '들어오는 햇빛 100' },
  { key: 'reflect', title: '되돌아 나가는 빛 35' },
  { key: 'absorb', title: '흡수해서 데우는 65' },
  { key: 'outgoing', title: '우주로 나가는 열 65' },
  { key: 'imbalance', title: `남는 ${EEI_WM2} W/m²가 온난화` },
]);

export const RADIATION_SCENE = Object.freeze({
  id: 'c1-radiation-budget',
  background: null, // 투명 — 패널 배경(CSS)이 하늘 역할을 한다
  camera: { yaw: 26, pitch: 16, dist: 3.05, fov: 34, target: [0, 0.46, 0] },
  items: [
    // ── 무대: 지표면과 대기권 경계 ──────────────────────────────────────────
    { type: 'line', points: [[-1.05, 0, -0.42], [1.05, 0, -0.42], [1.05, 0, 0.42], [-1.05, 0, 0.42]], closed: true, color: GRID, alpha: 0.75, at: 0 },
    { type: 'line', points: [[-1.05, TOA, -0.42], [1.05, TOA, -0.42], [1.05, TOA, 0.42], [-1.05, TOA, 0.42]], closed: true, color: GRID, alpha: 0.4, at: 0 },
    { type: 'line', points: [[-1.05, AIR, 0.42], [1.05, AIR, 0.42]], color: GRID, alpha: 0.28, at: 2 },

    // ── 0단계: 입사 100 — 정확히 수직이라 특이점 분기(dir ∥ +y)를 밟는다 ────
    arrow([-0.78, TOA, 0.02], [0, -1, 0], TOA, UNITS.incoming, SUN, { at: 0 }),
    label([-0.78, TOA + 0.14, 0.02], `햇빛 100 (${TOA_INSOLATION_WM2} W/m²)`, SUN, { at: 0 }),

    // ── 1단계: 반사 35 = 구름 27 + 눈·얼음 2 + 대기 6 ────────────────────────
    // 🔴 구름 반사 27은 **입사 100의 바로 앞(z가 크다)**에 세운다. 화면에서 두 화살표가
    // 같은 세로줄에 겹치고, 앞의 것이 뒤의 것을 **가린다** — 평면 화살표로는 「어느
    // 쪽이 들어오고 어느 쪽이 되나가는지」를 이 배치에서 구분할 방법이 없다.
    // (좌표는 카메라 yaw 26°에서 입사 화살표와 화면 세로줄이 겹치도록 역산한 값이다.)
    arrow([-0.57, AIR, 0.34], [0, 1, 0], TOA - AIR, UNITS.reflectCloud, REFLECT, { at: 1 }),
    // 라벨은 화살표 끝이 아니라 옆으로 뺀다 — 입사 라벨과 같은 자리에 겹치기 때문이다
    label([-1.02, 0.86, 0.34], '구름 반사 27', REFLECT, { at: 1 }),
    arrow([-0.16, 0, 0.24], [0, 1, 0], TOA, UNITS.reflectSurface, REFLECT, { at: 1 }),
    label([-0.16, TOA + 0.06, 0.24], '눈·얼음 2', REFLECT, { at: 1 }),
    arrow([-0.33, AIR * 0.6, -0.34], [0, 1, 0], TOA - AIR * 0.6, UNITS.reflectAir, REFLECT, { at: 1 }),
    label([-0.33, TOA + 0.14, -0.34], '대기 반사 6', REFLECT, { at: 1 }),

    // ── 2단계: 흡수 65 = 대기 14 + 지표 51 ──────────────────────────────────
    arrow([-0.62, AIR + 0.3, -0.3], [0, -1, 0], 0.3, UNITS.absorbAir, ABSORB, { at: 2 }),
    label([-0.62, AIR + 0.44, -0.3], '대기 흡수 14', ABSORB, { at: 2 }),
    arrow([-0.98, 0.34, -0.06], [0, -1, 0], 0.34, UNITS.absorbSurface, ABSORB, { at: 2 }),
    label([-0.98, 0.42, -0.06], '지표 흡수 51', ABSORB, { at: 2 }),

    // ── 3단계: 나가는 열 65 = 대기창 17 + 대기 방출 48, 그리고 지표 → 대기 34 ─
    arrow([0.3, 0, 0.16], [0, 1, 0], TOA, UNITS.windowIR, LONGWAVE, { at: 3 }),
    label([0.3, TOA + 0.06, 0.16], '대기창 17', LONGWAVE, { at: 3 }),
    arrow([0.74, AIR, -0.16], [0, 1, 0], TOA - AIR, UNITS.atmosphereIR, LONGWAVE, { at: 3 }),
    label([0.74, TOA + 0.14, -0.16], '대기 방출 48', LONGWAVE, { at: 3 }),
    // 지표에서 대기로 올라가는 34 — 셋을 나란히 세워 「잠열이 제일 굵다」가 보이게 한다
    arrow([0.05, 0, -0.3], [0, 1, 0], AIR, UNITS.latent, LATENT, { at: 3 }),
    label([0.05, AIR + 0.2, -0.3], '잠열 19', LATENT, { at: 3 }),
    arrow([0.3, 0, -0.3], [0, 1, 0], AIR, UNITS.thermals, LATENT, { at: 3 }),
    label([0.3, AIR + 0.1, -0.3], '대류 9', LATENT, { at: 3 }),
    arrow([0.55, 0, -0.3], [0, 1, 0], AIR, UNITS.surfaceIR, LONGWAVE, { at: 3 }),
    label([0.62, AIR + 0.22, -0.3], '온실기체 흡수 6', LONGWAVE, { at: 3 }),

    // ── 4단계: EEI ─────────────────────────────────────────────────────────
    // 🔴 **여기만 굵기가 비례가 아니다.** 0.3단위를 비례로 그리면 굵기 0.0016 —
    // 화면에서 존재하지 않는다. 「보이지 않는 것」과 「없는 것」은 다르므로
    // 바닥 굵기로 세우고, **짧게** 그려서 다른 갈래와 급이 다름을 길이로 말한다.
    // 얼마나 작은지는 라벨이 말한다(문법의 예외임을 여기 적어 둔다).
    arrow([0.92, 0, 0.3], [0, 1, 0], 0.22, EEI_UNITS, LONGWAVE, { at: 4 }),
    label([0.92, 0.34, 0.3], `남는 열 +${EEI_WM2} W/m² (${EEI_UNITS}단위)`, '#fca5a5', { at: 4 }),
    label([0.1, 0.12, 0.42], '흡수 65 = 방출 65 — 그 차이가 온난화다', '#e2e8f0', { at: 4, size: 12 }),
  ],
});

/** 수지가 실제로 맞는지 — 그림이 아니라 **숫자**로 검산한다(계약 테스트가 쓴다) */
export function radiationBalance() {
  const u = UNITS;
  return {
    reflected: u.reflectCloud + u.reflectSurface + u.reflectAir, // 35
    absorbed: u.absorbAir + u.absorbSurface, // 65
    surfaceToAir: u.latent + u.thermals + u.surfaceIR, // 34
    outgoing: u.windowIR + u.atmosphereIR, // 65
  };
}

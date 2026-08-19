/**
 * 홍수 장면(`flood_risk_saturated_inflow`)의 **옛 판 두 벌** — 갤러리 전용 재구성.
 *
 * 🔴 **`modules/board/**`를 한 글자도 고치지 않는다.** 옛 판은 히스토리에서
 * `git show <커밋>:frontend/src/modules/board/webgl/crossSection/scenes.js`로
 * **읽기만** 해서 옮겨 왔고, 무대·문법·팔레트는 현재 `scenes.js`가 내보내는
 * 프리미티브(`composeScene`·`vol`·`flow`·`puff`·`precip`·`bb`·`label`·`H`·`ZC`)를
 * 그대로 쓴다 — 복제하면 팔레트가 갈라져 비교가 거짓이 된다.
 *
 * 세 판을 나란히 놓는 이유: 이 장면은 **클라이언트가 직접 반려한 유일한 장면**이고,
 * 반려의 쟁점이 「무엇이 바뀌어야 하는가」였기 때문이다.
 *
 *   ① 옛 판   (7a851da, MT-23 이전) — 도시가 아예 없다. 젖은 지면 띠 하나.
 *   ② MT-23 판(4690a5d·c90e28b, 2026-08-18) — 도시·빗물받이·지하는 생겼는데
 *                                            **잠긴 것이 안 읽힌다** → 2차 반려.
 *   ③ 현재 판 (fix/flood-city-submerged) — 아래 파일이 아니라 `SCENES`가 소유한다.
 *
 * ⚠️ **③에서 바뀐 것은 「물 높이」가 아니다.** 수면 y=0.046은 앞줄 건물을 3~6층으로
 * 읽으면 **실척 3.6~10 m**이고 국내 내수침수위험지도의 최상위 밴드(3.0 m 이상)를
 * 이미 넘겼다 — 그래서 **수위는 올리지 않았다.** 바뀐 것은 ㉠ **깊이를 잴 자**
 * (창문선까지 잠긴 차)와 ㉡ **뒷줄 지반**(고지대 단을 만들어 뒷줄은 마른 채로 남긴다)
 * 둘이다. 근거는 `docs/design/research/RESEARCH_FLOOD_CITY_SUBMERGED.md`.
 */
import {
  composeScene, vol, flow, puff, precip, bb, label, H, ZC,
} from '../src/modules/board/webgl/crossSection/scenes.js';
import { rgba } from '../src/modules/board/webgl/crossSection/glCore.js';
import { V } from '../src/modules/board/crossSectionLabels.js';

/** `scenes.js`의 module-local `building`을 그대로 옮긴 것(내보내지 않는 헬퍼라 재작성). */
const building = ({ x, w = 0.055, h, z = ZC, base = 0, at, color = rgba('#94a3b8', 0.95) }) =>
  vol({ x0: x - w / 2, x1: x + w / 2, y0: base, y1: base + h, z0: z - 0.045, z1: z + 0.045, color, at });

/** ① 옛 판 — `7a851da:…/scenes.js` (도시가 없다) */
const OLD_ITEMS = () => [
  ...flow({ from: [0.08, H(0.4), ZC], dir: [1, 0.14, 0], travel: 0.4, count: 3, color: rgba('#0d9488', 0.92), at: 0, speed: 0.6, spreadZ: 0.14 }),
  label({ x: 0.26, y: H(0.72), text: V.vapourKeepsArriving, color: '#0f766e', at: 0, size: 10 }),

  puff({ x: 0.42, y: H(0.86), s: 1.5, color: rgba('#94a3b8', 0.9), at: 1 }),
  puff({ x: 0.66, y: H(0.9), s: 1.3, color: rgba('#cbd5e1', 0.9), at: 1 }),
  label({ x: 0.54, y: H(1.12), text: V.rainCloudRefills, color: '#475569', at: 1, size: 10 }),

  precip({ x0: 0.3, x1: 0.8, y1: H(0.82), kind: 'rain', slant: 0.16, speed: 1.3, count: 30, at: 2 }),

  bb({ x: 0.5, y: 0.004, w: 0.92, h: 0.12, color: rgba('#38bdf8', 0.55), kind: 3, at: 3 }),
  label({ x: 0.5, y: H(0.2), text: V.groundCannotAbsorb, color: '#0c4a6e', at: 3, size: 10 }),
];

/** ② MT-23 판(2차 반려) — `c90e28b:…/scenes.js`. 뒷줄이 평지(base 없음)이고 차가 없다. */
const MT23_ITEMS = () => [
  vol({ x0: 0.21, x1: 0.335, y0: 0, y1: 0.006, color: rgba('#65a30d', 0.95), pattern: 4, at: 0 }),
  vol({ x0: 0.335, x1: 1.0, y0: 0, y1: 0.008, color: rgba('#a8a29e', 0.94), pattern: 2, at: 0 }),
  building({ x: 0.44, h: 0.160, w: 0.052, z: ZC + 0.075, at: 0 }),
  building({ x: 0.575, h: 0.200, w: 0.056, z: ZC + 0.075, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.715, h: 0.145, w: 0.050, z: ZC + 0.075, at: 0 }),
  building({ x: 0.855, h: 0.185, w: 0.058, z: ZC + 0.075, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.395, h: 0.098, w: 0.048, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.515, h: 0.128, w: 0.054, z: ZC - 0.085, at: 0 }),
  building({ x: 0.635, h: 0.090, w: 0.046, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.795, h: 0.118, w: 0.050, z: ZC - 0.085, at: 0 }),
  building({ x: 0.915, h: 0.102, w: 0.046, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  vol({ x0: 0.488, x1: 0.542, y0: -0.050, y1: -0.002, color: rgba('#57534e', 0.94), z0: ZC - 0.13, z1: ZC - 0.04, at: 0 }),
  vol({ x0: 0.700, x1: 0.740, y0: -0.044, y1: 0.007, color: rgba('#44403c', 0.96), z0: ZC - 0.125, z1: ZC - 0.045, at: 0 }),
  label({ x: 0.27, y: H(0.30), text: V.greenGroundSoaks, color: '#3f6212', at: 0, size: 9.5 }),
  label({ x: 0.64, y: H(0.72), text: V.cityImpervious, color: '#44403c', at: 0, size: 9.5 }),

  // 유입 — MT-23 판에는 `until`이 없다(3단계까지 살아 있어 물이 바다에서 밀려오는 것으로 읽혔다)
  ...flow({ from: [0.02, H(0.20), ZC], dir: [1, 0.10, 0], travel: 0.40, count: 3, color: rgba('#0d9488', 0.92), at: 0, speed: 0.62, spreadZ: 0.15 }),
  ...flow({ from: [0.02, H(0.44), ZC], dir: [1, 0.14, 0], travel: 0.34, count: 2, scale: 0.046, color: rgba('#0d9488', 0.85), at: 0, speed: 0.5, spreadZ: 0.12 }),
  label({ x: 0.20, y: H(0.62), text: V.vapourKeepsArriving, color: '#0f766e', at: 0, size: 10 }),

  puff({ x: 0.34, y: H(0.78), s: 0.8, color: rgba('#94a3b8', 0.68), at: 1 }),
  puff({ x: 0.50, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.88), at: 1 }),
  puff({ x: 0.66, y: H(0.90), s: 1.5, color: rgba('#94a3b8', 0.92), at: 1 }),
  puff({ x: 0.80, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.78), at: 1 }),
  ...flow({ from: [0.36, H(1.02), ZC], dir: [1, 0, 0], travel: 0.34, count: 2, scale: 0.042, color: rgba('#64748b', 0.85), at: 1, speed: 0.5, spreadZ: 0.1 }),
  label({ x: 0.23, y: H(1.02), text: V.newCellsUpwind, color: '#475569', at: 1, size: 10 }),
  label({ x: 0.72, y: H(1.10), text: V.rainCloudRefills, color: '#475569', at: 1, size: 10 }),

  precip({ x0: 0.24, x1: 0.98, y1: H(0.82), kind: 'rain', slant: 0.14, speed: 1.25, count: 34, at: 2 }),
  ...flow({ from: [0.275, H(0.10), ZC], dir: [0, -1, 0], travel: 0.06, count: 2, scale: 0.034, color: rgba('#15803d', 0.9), at: 2, speed: 0.5, spreadZ: 0.1 }),
  ...flow({ from: [0.72, H(0.11), ZC - 0.085], dir: [0, -1, 0], travel: 0.075, count: 1, scale: 0.038, color: rgba('#0369a1', 0.9), at: 2, speed: 0.6 }),

  vol({ x0: 0, x1: 1, y0: -0.066, y1: -0.022, color: rgba('#0ea5e9', 0.34), pattern: 3, at: 3 }),
  vol({ x0: 0.490, x1: 0.540, y0: -0.048, y1: -0.004, color: rgba('#0284c7', 0.72), z0: ZC - 0.125, z1: ZC - 0.045, pattern: 3, at: 3 }),
  // 지표수가 x0: 0.02 — **바다(서쪽 0~0.2)에 붙어** 있고 풀밭(0.21~0.335)까지 덮는다
  vol({ x0: 0.02, x1: 0.98, y0: -0.006, y1: H(0.115), color: rgba('#38bdf8', 0.5), pattern: 3, at: 3 }),
  ...flow({ from: [0.72, H(0.03), ZC - 0.085], dir: [0, 1, 0], travel: 0.065, count: 2, scale: 0.04, color: rgba('#075985', 0.98), at: 3, speed: 0.7, spreadZ: 0.045 }),
  ...flow({ from: [0.90, H(0.20), ZC], dir: [-1, -0.05, 0], travel: 0.38, count: 3, scale: 0.052, color: rgba('#075985', 0.98), at: 3, speed: 0.9, spreadZ: 0.16 }),
  label({ x: 0.20, y: H(0.44), text: V.groundCannotAbsorb, color: '#0c4a6e', at: 3, size: 10 }),
  label({ x: 0.20, y: H(0.30), text: V.soilAlreadyFull, color: '#0369a1', at: 3, size: 9.5 }),
  label({ x: 0.73, y: H(0.32), text: V.drainOverwhelmed, color: '#075985', at: 3, size: 9.5 }),
];

const SEA = { from: 0, to: 0.2 };

export const FLOOD_OLD_SCENE = composeScene({ night: false, sea: SEA, items: OLD_ITEMS() });
export const FLOOD_MT23_SCENE = composeScene({ night: false, sea: SEA, items: MT23_ITEMS() });

export const FLOOD_VARIANTS = [
  {
    key: 'old',
    title: '① 옛 판 — MT-23 이전',
    src: '7a851da (읽기 전용 추출)',
    why: '도시가 없다. 「땅이 물을 못 먹는다」를 젖은 지면 띠 하나로만 말한다.',
    scene: FLOOD_OLD_SCENE,
  },
  {
    key: 'mt23',
    title: '② MT-23 판 — 클라이언트 2차 반려',
    src: 'c90e28b (읽기 전용 추출)',
    why: '도시·빗물받이·지하는 생겼으나 **잠긴 것이 안 읽힌다**. 지표수가 바다에 붙어 해일로도 읽힌다.',
    scene: FLOOD_MT23_SCENE,
  },
  {
    key: 'now',
    title: '③ 현재 판 — 자(잠긴 차) + 뒷줄 고지대',
    src: "SCENES['flood_risk_saturated_inflow'] (fix/flood-city-submerged 병합분)",
    why: '수위는 그대로다(실척 3.6~10 m — 이미 최상위 밴드). 더한 것은 깊이를 잴 자와 뒷줄 지반이고, 유입 화살표를 3단계에서 끊었다.',
    scene: null, // ruleId 경로로 그린다 — 현재 소스가 소유자다
  },
];

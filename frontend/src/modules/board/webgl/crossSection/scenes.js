/**
 * scenes — 규칙 8종 단면 장면 기술(記述) (R10-C / S2).
 *
 * **서버 계약·rule_id 매핑 불변**: 입력은 기존과 동일한 로컬 엔진 산출
 * {현상·구름·rule_id·explain}이고, 여기서는 rule_id → 3D 장면만 매핑한다.
 * 단계 시퀀스·캡션은 `CrossSectionPanel.STORYBOARDS`가 단일 진실원이며 이 파일은
 * **같은 단계 인덱스(at/until)에 3D 요소를 붙이는 표현 계층**일 뿐이다.
 * 즉 SVG 스토리보드와 WebGL 장면은 같은 메커니즘 순서를 공유한다.
 *
 * 좌표: camera.js WORLD (x 0~1 서→동 · y 0~0.4 고도 · z 0~0.42 깊이).
 * SVG 단면의 fp(fx,h)·gp(fx,z)와 축 의미가 1:1 대응한다.
 * 순수 데이터 — DOM 접근 없음(SSR 안전).
 */
import { WORLD } from './camera';
import { rgba } from './glCore';

const Z = WORLD.Z;
const ZC = Z / 2;
/** SVG fp의 고도 h(0~1) → 월드 y */
const H = (h) => h * WORLD.Y;

// ── 색 (SVG 스토리보드와 동일 팔레트) ───────────────────────────────────────
const COLD_FILL = rgba('#93c5fd', 0.46);
// 전선면 슬랩은 기단 볼륨보다 살짝 진하되, 뒤 볼륨이 투과해 보일 만큼만(0.4 근처)
const COLD_EDGE = rgba('#2563eb', 0.4);
const WARM_FILL = rgba('#fca5a5', 0.34);
const WARM_EDGE = rgba('#dc2626', 0.38);
const COLD_TXT = '#1d4ed8';
const WARM_TXT = '#b91c1c';

// ── 아이템 생성기 ───────────────────────────────────────────────────────────
/** 볼륨(기단·공기층) — 필요하면 위로 갈수록 좁아지고(taper) 기울어진다(shear) */
function vol({ x0, x1, y0 = 0, y1, z0 = 0, z1 = Z, color, taper = [1, 1], shear = [0, 0], pattern = 0, at = 0, until, layer = 'air' }) {
  return {
    type: 'solid', layer, at, until,
    center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    size: [x1 - x0, y1 - y0, z1 - z0],
    taper, shear, color, pattern,
  };
}

/** 쐐기 — 바닥 x0~x1, 정상 tx0~tx1(좁음). 한랭기단 쐐기·삼각 대치 단면에 사용 */
function wedge({ x0, x1, tx0, tx1, y1, color, at = 0, until, pattern = 0, z0 = 0, z1 = Z }) {
  const bw = x1 - x0;
  const tw = Math.max(tx1 - tx0, 0.001);
  return vol({
    x0, x1, y1, z0, z1, color, at, until, pattern,
    taper: [tw / bw, 1],
    shear: [(tx0 + tx1) / 2 - (x0 + x1) / 2, 0],
  });
}

/** 전선면 — 경사 슬랩(바닥 xb에서 정상 xt까지 기울어진 얇은 판) */
function frontSlab({ xb, xt, y1, color, at = 0, until, thick = 0.016, z0 = 0.0, z1 = Z }) {
  return vol({
    x0: xb - thick / 2, x1: xb + thick / 2, y1, z0, z1,
    color, at, until, pattern: 1, shear: [xt - xb, 0],
  });
}

/** 기류 벡터 필드 — 같은 방향 화살표 묶음(깊이 방향으로 흩뿌림) */
function flow({ from, dir, travel = 0.22, count = 3, scale = 0.052, color, speed = 0.42, at = 0, until, spreadZ = 0.13, spreadY = 0 }) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / n, dir[1] / n, dir[2] / n];
  return Array.from({ length: count }, (_, i) => {
    const k = i - (count - 1) / 2;
    return {
      type: 'arrow', at, until,
      origin: [from[0], from[1] + k * spreadY, from[2] + k * spreadZ],
      dir: d, travel, scale, color, speed,
      phase: (i / count) * 0.85,
    };
  });
}

let seedCounter = 0;
function bb({ x, y, z = ZC, w, h, color, kind = 1, at = 0, until }) {
  seedCounter += 1;
  return { type: 'billboard', at, until, center: [x, y, z], size: [w, h], color, kind, seed: (seedCounter * 0.37) % 10 };
}

/** 적란운 타워 — 모루 + 수직 발달 몸통(구름 볼륨 노이즈 빌보드 적층) */
function cbTower({ x, z = ZC, top = H(0.9), at }) {
  const body = [
    { dy: -0.055, w: 0.20, h: 0.14, c: rgba('#f1f5f9', 0.96) },
    { dy: -0.125, w: 0.235, h: 0.155, c: rgba('#e2e8f0', 0.96) },
    { dy: -0.195, w: 0.25, h: 0.16, c: rgba('#cbd5e1', 0.95) },
    { dy: -0.255, w: 0.225, h: 0.14, c: rgba('#94a3b8', 0.92) },
  ];
  return [
    bb({ x, y: top, z, w: 0.40, h: 0.085, color: rgba('#e2e8f0', 0.92), at }),
    ...body.map((b, i) => bb({ x: x + (i % 2 ? 0.016 : -0.014), y: top + b.dy, z, w: b.w, h: b.h, color: b.c, at })),
  ];
}

/** 층운·난층운 밴드 — 넓고 평평한 구름 띠 */
function layerBand({ x0, x1, y, z = ZC, at, dark = true, n = 4 }) {
  const w = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) =>
    bb({
      x: x0 + w * (i + 0.5), y: y + (i % 2 ? 0.012 : 0), z: z + (i % 2 ? 0.04 : -0.03),
      w: w * 1.9, h: 0.085,
      color: dark ? rgba('#cbd5e1', 0.94) : rgba('#e2e8f0', 0.9), at,
    }));
}

function puff({ x, y, z = ZC, s = 1, color = rgba('#e2e8f0', 0.95), at, until }) {
  return bb({ x, y, z, w: 0.17 * s, h: 0.12 * s, color, kind: 1, at, until });
}

/** 강수 — 인스턴싱 파티클 에미터 박스 */
function precip({ x0, x1, y1, z0 = 0.02, z1 = Z - 0.02, kind = 'rain', slant = 0.22, speed = 1.5, count = 24, at }) {
  return {
    type: 'precip', at,
    origin: [x0, 0, z0], size: [x1 - x0, y1, z1 - z0],
    kind: kind === 'snow' ? 1 : 0, slant, speed, count,
  };
}

function label({ x, y, z = 0.04, text, color = '#334155', size = 11, at, until, weight = 700 }) {
  return { type: 'label', at, until, pos: [x, y, z], text, color, size, weight };
}

// ── 지표 레이어(전 장면 공통) ───────────────────────────────────────────────
/** 지표 평면 + 바다 스트립 + 토양 앞단면 — 항상 표시(단계 무관) */
export function groundLayer({ night = false, sea = null }) {
  const items = [
    vol({ x0: 0, x1: 1, y0: -0.02, y1: 0.0, color: night ? rgba('#43533f', 1) : rgba('#c6dbb0', 1), pattern: 4, layer: 'ground' }),
    vol({ x0: 0, x1: 1, y0: -0.07, y1: -0.02, color: rgba('#d6c9a8', 1), pattern: 2, layer: 'ground' }),
  ];
  if (sea) {
    items.splice(1, 0, vol({
      x0: sea.from ?? 0, x1: sea.to, y0: -0.014, y1: 0.002,
      color: rgba('#7dd3fc', 0.97), pattern: 3, layer: 'ground',
    }));
  }
  return items;
}

// ── 장면 8종 (board_rules.json rule_id ↔ STORYBOARDS 단계 인덱스와 1:1) ────

/** cold_front_shower: 찬 공기 쐐기 → 급상승 → 적란운 수직 발달 → 소나기·번개 */
const coldFrontShower = () => [
  wedge({ x0: 0, x1: 0.6, tx0: 0.02, tx1: 0.16, y1: H(0.82), color: COLD_FILL, at: 0 }),
  frontSlab({ xb: 0.6, xt: 0.16, y1: H(0.82), color: COLD_EDGE, at: 0 }),
  ...flow({ from: [0.05, H(0.12), ZC], dir: [1, 0, 0], travel: 0.32, color: rgba('#2563eb', 0.85), at: 0, speed: 0.36 }),
  label({ x: 0.24, y: H(0.42), text: '찬 공기', color: COLD_TXT, at: 0 }),

  vol({ x0: 0.56, x1: 1, y1: H(0.8), color: WARM_FILL, at: 1 }),
  label({ x: 0.86, y: H(0.5), text: '따뜻하고 습한 공기', color: WARM_TXT, at: 1, size: 10 }),
  ...flow({ from: [0.56, H(0.1), ZC], dir: [-0.55, 1, 0], travel: 0.26, count: 3, color: rgba('#dc2626', 0.9), at: 1, speed: 0.5 }),
  ...flow({ from: [0.46, H(0.42), ZC], dir: [-0.55, 1, 0], travel: 0.2, count: 2, scale: 0.045, color: rgba('#ea580c', 0.85), at: 1, speed: 0.55 }),

  ...cbTower({ x: 0.63, top: H(0.94), at: 2 }),
  label({ x: 0.79, y: H(0.99), text: '적란운', at: 2, size: 10 }),

  precip({ x0: 0.54, x1: 0.73, y1: H(0.66), slant: 0.3, speed: 1.6, count: 28, at: 3 }),
  bb({ x: 0.55, y: H(0.5), w: 0.13, h: 0.13, color: rgba('#facc15', 0.95), kind: 4, at: 3 }),
];

/** stationary_front_monsoon: 세력 균형 대치 → 정체 → 습기 공급·비층운 → 장맛비 */
const stationaryFrontMonsoon = () => [
  wedge({ x0: 0, x1: 0.46, tx0: 0.0, tx1: 0.06, y1: H(0.62), color: COLD_FILL, at: 0 }),
  wedge({ x0: 0.54, x1: 1, tx0: 0.94, tx1: 1.0, y1: H(0.62), color: rgba('#fca5a5', 0.44), at: 0 }),
  ...flow({ from: [0.08, H(0.12), ZC], dir: [1, 0, 0], travel: 0.22, count: 2, color: rgba('#2563eb', 0.85), at: 0, speed: 0.3 }),
  ...flow({ from: [0.92, H(0.12), ZC], dir: [-1, 0, 0], travel: 0.22, count: 2, color: rgba('#dc2626', 0.85), at: 0, speed: 0.3 }),
  label({ x: 0.2, y: H(0.4), text: '찬 공기', color: COLD_TXT, at: 0 }),
  label({ x: 0.8, y: H(0.4), text: '따뜻한 공기', color: WARM_TXT, at: 0 }),

  frontSlab({ xb: 0.5, xt: 0.54, y1: H(0.74), color: rgba('#7c3aed', 0.5), at: 1, thick: 0.02 }),
  label({ x: 0.5, y: H(0.78), text: '정체전선', color: '#6d28d9', at: 1, size: 10 }),

  ...flow({ from: [0.98, H(0.56), ZC + 0.05], dir: [-1, 0.06, -0.12], travel: 0.34, count: 2, color: rgba('#0d9488', 0.9), at: 2, speed: 0.4 }),
  label({ x: 0.88, y: H(0.72), text: '습한 공기 공급', color: '#0f766e', at: 2, size: 10 }),
  ...layerBand({ x0: 0.16, x1: 0.88, y: H(0.66), at: 2, n: 4 }),
  label({ x: 0.42, y: H(0.9), text: '비층운(장마 구름 띠)', at: 2, size: 10 }),

  precip({ x0: 0.22, x1: 0.44, y1: H(0.62), slant: 0.06, speed: 0.85, count: 22, at: 3 }),
  precip({ x0: 0.5, x1: 0.74, y1: H(0.62), slant: 0.06, speed: 0.8, count: 22, at: 3 }),
];

/** warm_front_steady_rain: 온난공기 접근 → 완만한 활승 → 난층운 → 넓은 약한 비 */
const warmFrontSteadyRain = () => [
  wedge({ x0: 0.36, x1: 1, tx0: 0.9, tx1: 1.0, y1: H(0.66), color: COLD_FILL, at: 0 }),
  frontSlab({ xb: 0.36, xt: 1.0, y1: H(0.66), color: WARM_EDGE, at: 0, thick: 0.014 }),
  label({ x: 0.86, y: H(0.2), text: '찬 공기(물러남)', color: COLD_TXT, at: 0, size: 10 }),
  ...flow({ from: [0.04, H(0.16), ZC], dir: [1, 0.06, 0], travel: 0.26, color: rgba('#dc2626', 0.85), at: 0, speed: 0.34 }),
  label({ x: 0.18, y: H(0.46), text: '따뜻한 공기', color: WARM_TXT, at: 0 }),

  ...flow({ from: [0.4, H(0.06), ZC], dir: [0.92, 0.44, 0], travel: 0.26, count: 3, color: rgba('#dc2626', 0.9), at: 1, speed: 0.42 }),
  ...flow({ from: [0.56, H(0.3), ZC], dir: [0.92, 0.44, 0], travel: 0.2, count: 2, scale: 0.045, color: rgba('#ea580c', 0.85), at: 1, speed: 0.46 }),
  label({ x: 0.62, y: H(0.42), text: '활승', color: '#c2410c', at: 1, size: 10 }),

  ...layerBand({ x0: 0.1, x1: 0.56, y: H(0.5), at: 2, n: 3 }),
  ...layerBand({ x0: 0.44, x1: 0.94, y: H(0.66), at: 2, n: 3 }),
  label({ x: 0.36, y: H(0.92), text: '난층운(넓고 두꺼운 층 구름)', at: 2, size: 10 }),

  precip({ x0: 0.12, x1: 0.34, y1: H(0.46), slant: 0.04, speed: 0.8, count: 20, at: 3 }),
  precip({ x0: 0.38, x1: 0.6, y1: H(0.46), slant: 0.04, speed: 0.75, count: 20, at: 3 }),
];

/** siberian_snow: cP 남하 → 서해 열·수증기 공급 → 눈구름 발달 → 서해안 폭설 */
const siberianSnow = () => [
  // 기단 볼륨(반투명) + 색 번짐 — SVG는 번짐만 썼지만 3D에서는 덩어리감을 볼륨이 맡는다
  wedge({ x0: 0, x1: 0.52, tx0: 0.0, tx1: 0.2, y1: H(0.74), color: rgba('#93c5fd', 0.3), at: 0 }),
  bb({ x: 0.16, y: H(0.62), w: 0.62, h: 0.42, color: rgba('#3b82f6', 0.4), kind: 0, at: 0 }),
  ...flow({ from: [0.02, H(0.86), ZC + 0.09], dir: [0.92, -0.26, -0.3], travel: 0.34, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.36 }),
  label({ x: 0.2, y: H(1.02), text: '시베리아 기단(cP)', color: COLD_TXT, at: 0 }),
  label({ x: 0.2, y: H(0.88), text: '차고 건조', color: '#3b82f6', at: 0, size: 9.5 }),

  label({ x: 0.26, y: H(0.1), text: '따뜻한 서해', color: '#0369a1', at: 1, size: 10 }),
  ...flow({ from: [0.3, H(0.04), ZC], dir: [0.22, 1, 0], travel: 0.26, count: 3, color: rgba('#f59e0b', 0.92), at: 1, speed: 0.5, spreadZ: 0.15 }),
  label({ x: 0.44, y: H(0.62), text: '열·수증기 공급', color: '#b45309', at: 1, size: 10 }),

  puff({ x: 0.44, y: H(0.54), s: 0.8, at: 2 }),
  puff({ x: 0.58, y: H(0.62), s: 1.05, color: rgba('#cbd5e1', 0.95), at: 2 }),
  puff({ x: 0.73, y: H(0.7), s: 1.3, color: rgba('#cbd5e1', 0.96), at: 2 }),
  label({ x: 0.66, y: H(0.96), text: '눈구름 발달(기단 변질)', at: 2, size: 10 }),

  precip({ x0: 0.62, x1: 0.86, y1: H(0.66), kind: 'snow', slant: 0.02, speed: 0.32, count: 32, at: 3 }),
  label({ x: 0.82, y: H(0.16), text: '서해안 폭설', color: '#0c4a6e', at: 3, size: 10 }),
];

/** convective_shower: 강한 일사·지면 가열 → 대류 상승 → 적란운 → 오후 소나기 */
const convectiveShower = () => [
  bb({ x: 0.13, y: H(1.0), z: 0.06, w: 0.19, h: 0.19, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  bb({ x: 0.5, y: 0.004, w: 0.56, h: 0.36, color: rgba('#fb923c', 0.5), kind: 3, at: 0 }),
  label({ x: 0.5, y: H(0.16), text: '지면 가열', color: '#c2410c', at: 0, size: 10 }),

  ...flow({ from: [0.5, H(0.06), ZC], dir: [0.06, 1, 0], travel: 0.3, count: 3, color: rgba('#ea580c', 0.92), at: 1, speed: 0.5, spreadZ: 0.14 }),
  label({ x: 0.68, y: H(0.52), text: '대류 상승', color: '#c2410c', at: 1, size: 10 }),

  ...cbTower({ x: 0.52, top: H(0.92), at: 2 }),
  label({ x: 0.79, y: H(0.96), text: '적란운', at: 2, size: 10 }),

  precip({ x0: 0.44, x1: 0.62, y1: H(0.6), slant: 0.22, speed: 1.55, count: 26, at: 3 }),
  bb({ x: 0.45, y: H(0.46), w: 0.12, h: 0.12, color: rgba('#facc15', 0.95), kind: 4, at: 3 }),
];

/** radiation_fog: 맑은 밤 복사냉각 → 지표 공기 냉각 → 응결·안개층 → 새벽 안개 */
const radiationFog = () => [
  bb({ x: 0.84, y: H(1.02), z: 0.06, w: 0.1, h: 0.1, color: rgba('#fef9c3', 0.9), kind: 0, at: 0 }),
  ...flow({ from: [0.16, H(0.06), ZC - 0.1], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.3, spreadZ: 0.1 }),
  ...flow({ from: [0.5, H(0.06), ZC], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.28, spreadZ: 0.1 }),
  ...flow({ from: [0.84, H(0.06), ZC + 0.08], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.32, spreadZ: 0.1 }),
  label({ x: 0.3, y: H(0.9), text: '복사냉각 — 열 방출', color: '#fbbf24', at: 0, size: 10 }),

  vol({ x0: 0, x1: 1, y1: H(0.24), color: rgba('#60a5fa', 0.32), at: 1 }),
  label({ x: 0.5, y: H(0.3), text: '지표 부근 공기 냉각', color: '#bfdbfe', at: 1, size: 10 }),

  bb({ x: 0.36, y: 0.012, w: 0.72, h: 0.34, color: rgba('#f8fafc', 0.8), kind: 3, at: 2 }),
  bb({ x: 0.68, y: 0.026, w: 0.6, h: 0.28, color: rgba('#f1f5f9', 0.7), kind: 3, at: 2 }),
  bb({ x: 0.5, y: 0.05, w: 0.5, h: 0.22, color: rgba('#ffffff', 0.55), kind: 3, at: 2 }),
  label({ x: 0.2, y: H(0.6), text: '수증기 응결 → 안개층', color: '#e2e8f0', at: 2, size: 10 }),

  bb({ x: 0.92, y: H(0.42), z: 0.06, w: 0.14, h: 0.14, color: rgba('#fcd34d', 0.92), kind: 2, at: 3 }),
  label({ x: 0.72, y: H(0.72), text: '이른 아침, 짙은 안개', color: '#f8fafc', at: 3, size: 10 }),
];

/** north_pacific_heatwave: mT 정착 → 강한 일사 → 더운 공기 축적 → 폭염 지속 */
const northPacificHeatwave = () => [
  vol({ x0: 0, x1: 1, y1: H(0.58), color: rgba('#fca5a5', 0.28), taper: [0.9, 1], at: 0 }),
  bb({ x: 0.5, y: H(0.1), w: 1.18, h: 0.56, color: rgba('#ea580c', 0.4), kind: 0, at: 0 }),
  ...flow({ from: [0.99, H(0.56), ZC + 0.06], dir: [-1, -0.08, -0.1], travel: 0.28, count: 2, color: rgba('#ea580c', 0.9), at: 0, speed: 0.36 }),
  label({ x: 0.5, y: H(0.66), text: '북태평양 기단(mT)', color: '#c2410c', at: 0 }),
  label({ x: 0.5, y: H(0.54), text: '덥고 습함', color: '#ea580c', at: 0, size: 9.5 }),

  bb({ x: 0.15, y: H(1.02), z: 0.06, w: 0.2, h: 0.2, color: rgba('#f97316', 0.95), kind: 2, at: 1 }),
  label({ x: 0.32, y: H(0.24), text: '강한 햇볕', color: '#c2410c', at: 1, size: 10 }),

  ...flow({ from: [0.4, H(0.04), ZC - 0.06], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.24, spreadZ: 0.08 }),
  ...flow({ from: [0.58, H(0.04), ZC + 0.02], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.2, spreadZ: 0.08 }),
  ...flow({ from: [0.74, H(0.04), ZC + 0.08], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.28, spreadZ: 0.08 }),
  label({ x: 0.72, y: H(0.44), text: '더운 공기 축적 — 기온↑', color: '#b91c1c', at: 2, size: 10 }),

  label({ x: 0.5, y: H(0.92), text: '폭염', color: '#dc2626', at: 3, size: 15, weight: 800 }),
];

/** siberian_clear: cP 정착 → 수증기 부족(구름 형성 실패) → 춥고 맑은 하늘 */
const siberianClear = () => [
  vol({ x0: 0, x1: 1, y1: H(0.52), color: rgba('#93c5fd', 0.28), taper: [0.92, 1], at: 0 }),
  bb({ x: 0.42, y: H(0.08), w: 1.1, h: 0.5, color: rgba('#3b82f6', 0.36), kind: 0, at: 0 }),
  ...flow({ from: [0.02, H(0.84), ZC + 0.1], dir: [0.92, -0.24, -0.24], travel: 0.32, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.34 }),
  label({ x: 0.34, y: H(1.0), text: '시베리아 기단(cP)', color: COLD_TXT, at: 0 }),
  label({ x: 0.34, y: H(0.86), text: '차고 건조', color: '#3b82f6', at: 0, size: 9.5 }),

  puff({ x: 0.62, y: H(0.6), s: 1.1, color: rgba('#94a3b8', 0.3), at: 1, until: 1 }),
  label({ x: 0.62, y: H(0.34), text: '수증기 부족 — 구름이 못 생겨요', color: '#64748b', at: 1, until: 1, size: 10 }),

  bb({ x: 0.74, y: H(0.96), z: 0.06, w: 0.18, h: 0.18, color: rgba('#fcd34d', 0.92), kind: 2, at: 2 }),
  label({ x: 0.44, y: H(0.5), text: '춥고 맑은 겨울 하늘', color: '#1d4ed8', at: 2, size: 11 }),
];

// ── 레지스트리 ──────────────────────────────────────────────────────────────
/**
 * rule_id → 장면. `STORYBOARDS`(캡션·단계 수의 단일 진실원)와 키가 일치해야 하며
 * 불일치(규칙 드리프트)는 `buildScene`이 null을 반환해 CrossSectionGL이 onFail →
 * SVG 스토리보드로 내려보낸다.
 */
export const SCENES = {
  cold_front_shower: { build: coldFrontShower },
  stationary_front_monsoon: { build: stationaryFrontMonsoon },
  warm_front_steady_rain: { build: warmFrontSteadyRain },
  siberian_snow: { build: siberianSnow, sea: { from: 0.06, to: 0.56 } },
  convective_shower: { build: convectiveShower },
  radiation_fog: { build: radiationFog, night: true },
  north_pacific_heatwave: { build: northPacificHeatwave },
  siberian_clear: { build: siberianClear },
};

/** 장면 전체(지표 레이어 + 단계 아이템) 조립 — 단계 필터는 renderer가 수행 */
export function buildScene(ruleId) {
  const spec = SCENES[ruleId];
  if (!spec) return null;
  seedCounter = 0;
  const night = Boolean(spec.night);
  return {
    night,
    sky: night
      ? { top: rgba('#0f172a', 1), bottom: rgba('#475569', 1) }
      : { top: rgba('#bfdbfe', 1), bottom: rgba('#eff6ff', 1) },
    items: [...groundLayer({ night, sea: spec.sea ?? null }), ...spec.build()],
  };
}

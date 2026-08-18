/**
 * scenes — 규칙 13종 단면 장면 기술(記述) (R10-C / S2 · R13 확장 5종).
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
// 장면 내부 라벨 — SVG(CrossSectionPanel)와 공유하는 단일 소유자(MT-28)
import { V } from '../../crossSectionLabels.js';

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

/**
 * 불꽃(MT-23) — 겉불 + 심지 두 겹. **h가 곧 화선에서의 위치**다:
 * 조사 §3A(en.wikipedia Wildfire)의 화선 비대칭을 크기로 옮긴 것 —
 * 바람 아래쪽 「불머리」가 가장 크고 바람 위쪽 「배화」가 가장 작다.
 * 바닥(y=0)에 세우므로 중심은 h/2만큼 띄운다.
 */
function flame({ x, y = 0.004, z = ZC, h, at, until }) {
  return [
    bb({ x, y: y + h * 0.5, z, w: h * 0.66, h, color: rgba('#ea580c', 0.94), kind: 5, at, until }),
    bb({ x: x + h * 0.03, y: y + h * 0.33, z, w: h * 0.34, h: h * 0.6, color: rgba('#fde047', 0.95), kind: 5, at, until }),
  ];
}

/**
 * 침엽수 — `vol`을 taper로 좁혀 만든 원뿔. **새 표현이 아니다**(셰이더 0줄).
 * 산불 장면에 「탈 것이 나무」라는 것과 **산등성이**를 세우기 위한 지형 소품이다
 * (2026-08-18 클라이언트: *"산불인데 산이 없고"*).
 */
function tree({ x, base = 0.004, z = ZC, h = 0.075, w = 0.023, at }) {
  return vol({
    x0: x - w, x1: x + w, y0: base, y1: base + h,
    z0: z - 0.026, z1: z + 0.026,
    taper: [0.08, 0.08], color: rgba('#3f6212', 0.96), at,
  });
}

/**
 * 건물 — 도시 단면. 홍수 장면에 **불투수면**을 세우기 위한 지형 소품이다
 * (2026-08-18 클라이언트: *"홍수인데 주위 도시와 같은 모식이 없어"*).
 * 조사 §3C가 도시 침수의 1차 원인으로 지목한 것이 바로 이 포장면이다.
 */
function building({ x, w = 0.055, h, z = ZC, at, color = rgba('#94a3b8', 0.95) }) {
  return vol({
    x0: x - w / 2, x1: x + w / 2, y0: 0, y1: h,
    z0: z - 0.045, z1: z + 0.045, color, at,
  });
}

function smoke({ x, y, z = ZC, n = 3, lean = 0.06, rise = 0.055, s = 1, at, until }) {
  return Array.from({ length: n }, (_, i) =>
    bb({
      x: x + lean * (i + 1), y: y + rise * (i + 1), z: z + (i % 2 ? 0.035 : -0.028),
      w: (0.13 + 0.05 * i) * s, h: (0.10 + 0.042 * i) * s,
      color: rgba('#78716c', 0.52 - i * 0.1), kind: 6, at, until,
    }));
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

// ── 장면 v1 8종 (board_rules.json rule_id ↔ STORYBOARDS 단계 인덱스와 1:1) ──

/** cold_front_shower: 찬 공기 쐐기 → 급상승 → 적란운 수직 발달 → 소나기·번개 */
const coldFrontShower = () => [
  wedge({ x0: 0, x1: 0.6, tx0: 0.02, tx1: 0.16, y1: H(0.82), color: COLD_FILL, at: 0 }),
  frontSlab({ xb: 0.6, xt: 0.16, y1: H(0.82), color: COLD_EDGE, at: 0 }),
  ...flow({ from: [0.05, H(0.12), ZC], dir: [1, 0, 0], travel: 0.32, color: rgba('#2563eb', 0.85), at: 0, speed: 0.36 }),
  label({ x: 0.24, y: H(0.42), text: V.coldAir, color: COLD_TXT, at: 0 }),

  vol({ x0: 0.56, x1: 1, y1: H(0.8), color: WARM_FILL, at: 1 }),
  label({ x: 0.86, y: H(0.5), text: V.warmHumidAir, color: WARM_TXT, at: 1, size: 10 }),
  ...flow({ from: [0.56, H(0.1), ZC], dir: [-0.55, 1, 0], travel: 0.26, count: 3, color: rgba('#dc2626', 0.9), at: 1, speed: 0.5 }),
  ...flow({ from: [0.46, H(0.42), ZC], dir: [-0.55, 1, 0], travel: 0.2, count: 2, scale: 0.045, color: rgba('#ea580c', 0.85), at: 1, speed: 0.55 }),

  ...cbTower({ x: 0.63, top: H(0.94), at: 2 }),
  label({ x: 0.79, y: H(0.99), text: V.cumulonimbus, at: 2, size: 10 }),

  precip({ x0: 0.54, x1: 0.73, y1: H(0.66), slant: 0.3, speed: 1.6, count: 28, at: 3 }),
  bb({ x: 0.55, y: H(0.5), w: 0.13, h: 0.13, color: rgba('#facc15', 0.95), kind: 4, at: 3 }),
];

/** stationary_front_monsoon: 세력 균형 대치 → 정체 → 습기 공급·비층운 → 장맛비 */
const stationaryFrontMonsoon = () => [
  wedge({ x0: 0, x1: 0.46, tx0: 0.0, tx1: 0.06, y1: H(0.62), color: COLD_FILL, at: 0 }),
  wedge({ x0: 0.54, x1: 1, tx0: 0.94, tx1: 1.0, y1: H(0.62), color: rgba('#fca5a5', 0.44), at: 0 }),
  ...flow({ from: [0.08, H(0.12), ZC], dir: [1, 0, 0], travel: 0.22, count: 2, color: rgba('#2563eb', 0.85), at: 0, speed: 0.3 }),
  ...flow({ from: [0.92, H(0.12), ZC], dir: [-1, 0, 0], travel: 0.22, count: 2, color: rgba('#dc2626', 0.85), at: 0, speed: 0.3 }),
  label({ x: 0.2, y: H(0.4), text: V.coldAir, color: COLD_TXT, at: 0 }),
  label({ x: 0.8, y: H(0.4), text: V.warmAir, color: WARM_TXT, at: 0 }),

  frontSlab({ xb: 0.5, xt: 0.54, y1: H(0.74), color: rgba('#7c3aed', 0.5), at: 1, thick: 0.02 }),
  label({ x: 0.5, y: H(0.78), text: V.stationaryFront, color: '#6d28d9', at: 1, size: 10 }),

  ...flow({ from: [0.98, H(0.56), ZC + 0.05], dir: [-1, 0.06, -0.12], travel: 0.34, count: 2, color: rgba('#0d9488', 0.9), at: 2, speed: 0.4 }),
  label({ x: 0.88, y: H(0.72), text: V.humidAirSupply, color: '#0f766e', at: 2, size: 10 }),
  ...layerBand({ x0: 0.16, x1: 0.88, y: H(0.66), at: 2, n: 4 }),
  label({ x: 0.42, y: H(0.9), text: V.monsoonCloudBand, at: 2, size: 10 }),

  precip({ x0: 0.22, x1: 0.44, y1: H(0.62), slant: 0.06, speed: 0.85, count: 22, at: 3 }),
  precip({ x0: 0.5, x1: 0.74, y1: H(0.62), slant: 0.06, speed: 0.8, count: 22, at: 3 }),
];

/** warm_front_steady_rain: 온난공기 접근 → 완만한 활승 → 난층운 → 넓은 약한 비 */
const warmFrontSteadyRain = () => [
  wedge({ x0: 0.36, x1: 1, tx0: 0.9, tx1: 1.0, y1: H(0.66), color: COLD_FILL, at: 0 }),
  frontSlab({ xb: 0.36, xt: 1.0, y1: H(0.66), color: WARM_EDGE, at: 0, thick: 0.014 }),
  label({ x: 0.86, y: H(0.2), text: V.coldAirRetreating, color: COLD_TXT, at: 0, size: 10 }),
  ...flow({ from: [0.04, H(0.16), ZC], dir: [1, 0.06, 0], travel: 0.26, color: rgba('#dc2626', 0.85), at: 0, speed: 0.34 }),
  label({ x: 0.18, y: H(0.46), text: V.warmAir, color: WARM_TXT, at: 0 }),

  ...flow({ from: [0.4, H(0.06), ZC], dir: [0.92, 0.44, 0], travel: 0.26, count: 3, color: rgba('#dc2626', 0.9), at: 1, speed: 0.42 }),
  ...flow({ from: [0.56, H(0.3), ZC], dir: [0.92, 0.44, 0], travel: 0.2, count: 2, scale: 0.045, color: rgba('#ea580c', 0.85), at: 1, speed: 0.46 }),
  label({ x: 0.62, y: H(0.42), text: V.upglide, color: '#c2410c', at: 1, size: 10 }),

  ...layerBand({ x0: 0.1, x1: 0.56, y: H(0.5), at: 2, n: 3 }),
  ...layerBand({ x0: 0.44, x1: 0.94, y: H(0.66), at: 2, n: 3 }),
  label({ x: 0.36, y: H(0.92), text: V.nimbostratusWide, at: 2, size: 10 }),

  precip({ x0: 0.12, x1: 0.34, y1: H(0.46), slant: 0.04, speed: 0.8, count: 20, at: 3 }),
  precip({ x0: 0.38, x1: 0.6, y1: H(0.46), slant: 0.04, speed: 0.75, count: 20, at: 3 }),
];

/** siberian_snow: cP 남하 → 서해 열·수증기 공급 → 눈구름 발달 → 서해안 폭설 */
const siberianSnow = () => [
  // 기단 볼륨(반투명) + 색 번짐 — SVG는 번짐만 썼지만 3D에서는 덩어리감을 볼륨이 맡는다
  wedge({ x0: 0, x1: 0.52, tx0: 0.0, tx1: 0.2, y1: H(0.74), color: rgba('#93c5fd', 0.3), at: 0 }),
  bb({ x: 0.16, y: H(0.62), w: 0.62, h: 0.42, color: rgba('#3b82f6', 0.4), kind: 0, at: 0 }),
  ...flow({ from: [0.02, H(0.86), ZC + 0.09], dir: [0.92, -0.26, -0.3], travel: 0.34, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.36 }),
  label({ x: 0.2, y: H(1.02), text: V.siberianCp, color: COLD_TXT, at: 0 }),
  label({ x: 0.2, y: H(0.88), text: V.coldDry, color: '#3b82f6', at: 0, size: 9.5 }),

  label({ x: 0.26, y: H(0.1), text: V.warmYellowSea, color: '#0369a1', at: 1, size: 10 }),
  ...flow({ from: [0.3, H(0.04), ZC], dir: [0.22, 1, 0], travel: 0.26, count: 3, color: rgba('#f59e0b', 0.92), at: 1, speed: 0.5, spreadZ: 0.15 }),
  label({ x: 0.44, y: H(0.62), text: V.heatVapourSupply, color: '#b45309', at: 1, size: 10 }),

  puff({ x: 0.44, y: H(0.54), s: 0.8, at: 2 }),
  puff({ x: 0.58, y: H(0.62), s: 1.05, color: rgba('#cbd5e1', 0.95), at: 2 }),
  puff({ x: 0.73, y: H(0.7), s: 1.3, color: rgba('#cbd5e1', 0.96), at: 2 }),
  label({ x: 0.66, y: H(0.96), text: V.snowCloudDevelop, at: 2, size: 10 }),

  precip({ x0: 0.62, x1: 0.86, y1: H(0.66), kind: 'snow', slant: 0.02, speed: 0.32, count: 32, at: 3 }),
  label({ x: 0.82, y: H(0.16), text: V.westCoastSnow, color: '#0c4a6e', at: 3, size: 10 }),
];

/** convective_shower: 강한 일사·지면 가열 → 대류 상승 → 적란운 → 오후 소나기 */
const convectiveShower = () => [
  bb({ x: 0.13, y: H(1.0), z: 0.06, w: 0.19, h: 0.19, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  bb({ x: 0.5, y: 0.004, w: 0.56, h: 0.36, color: rgba('#fb923c', 0.5), kind: 3, at: 0 }),
  label({ x: 0.5, y: H(0.16), text: V.groundHeating, color: '#c2410c', at: 0, size: 10 }),

  ...flow({ from: [0.5, H(0.06), ZC], dir: [0.06, 1, 0], travel: 0.3, count: 3, color: rgba('#ea580c', 0.92), at: 1, speed: 0.5, spreadZ: 0.14 }),
  label({ x: 0.68, y: H(0.52), text: V.convectiveRise, color: '#c2410c', at: 1, size: 10 }),

  ...cbTower({ x: 0.52, top: H(0.92), at: 2 }),
  label({ x: 0.79, y: H(0.96), text: V.cumulonimbus, at: 2, size: 10 }),

  precip({ x0: 0.44, x1: 0.62, y1: H(0.6), slant: 0.22, speed: 1.55, count: 26, at: 3 }),
  bb({ x: 0.45, y: H(0.46), w: 0.12, h: 0.12, color: rgba('#facc15', 0.95), kind: 4, at: 3 }),
];

/** radiation_fog: 맑은 밤 복사냉각 → 지표 공기 냉각 → 응결·안개층 → 새벽 안개 */
const radiationFog = () => [
  bb({ x: 0.84, y: H(1.02), z: 0.06, w: 0.1, h: 0.1, color: rgba('#fef9c3', 0.9), kind: 0, at: 0 }),
  ...flow({ from: [0.16, H(0.06), ZC - 0.1], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.3, spreadZ: 0.1 }),
  ...flow({ from: [0.5, H(0.06), ZC], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.28, spreadZ: 0.1 }),
  ...flow({ from: [0.84, H(0.06), ZC + 0.08], dir: [0, 1, 0], travel: 0.28, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 0, speed: 0.32, spreadZ: 0.1 }),
  label({ x: 0.3, y: H(0.9), text: V.radiativeCooling, color: '#fbbf24', at: 0, size: 10 }),

  vol({ x0: 0, x1: 1, y1: H(0.24), color: rgba('#60a5fa', 0.32), at: 1 }),
  label({ x: 0.5, y: H(0.3), text: V.nearSurfaceCooling, color: '#bfdbfe', at: 1, size: 10 }),

  bb({ x: 0.36, y: 0.012, w: 0.72, h: 0.34, color: rgba('#f8fafc', 0.8), kind: 3, at: 2 }),
  bb({ x: 0.68, y: 0.026, w: 0.6, h: 0.28, color: rgba('#f1f5f9', 0.7), kind: 3, at: 2 }),
  bb({ x: 0.5, y: 0.05, w: 0.5, h: 0.22, color: rgba('#ffffff', 0.55), kind: 3, at: 2 }),
  label({ x: 0.2, y: H(0.6), text: V.condenseToFogLayer, color: '#e2e8f0', at: 2, size: 10 }),

  bb({ x: 0.92, y: H(0.42), z: 0.06, w: 0.14, h: 0.14, color: rgba('#fcd34d', 0.92), kind: 2, at: 3 }),
  label({ x: 0.72, y: H(0.72), text: V.denseFogEarlyMorning, color: '#f8fafc', at: 3, size: 10 }),
];

/** north_pacific_heatwave: mT 정착 → 강한 일사 → 더운 공기 축적 → 폭염 지속 */
const northPacificHeatwave = () => [
  vol({ x0: 0, x1: 1, y1: H(0.58), color: rgba('#fca5a5', 0.28), taper: [0.9, 1], at: 0 }),
  bb({ x: 0.5, y: H(0.1), w: 1.18, h: 0.56, color: rgba('#ea580c', 0.4), kind: 0, at: 0 }),
  ...flow({ from: [0.99, H(0.56), ZC + 0.06], dir: [-1, -0.08, -0.1], travel: 0.28, count: 2, color: rgba('#ea580c', 0.9), at: 0, speed: 0.36 }),
  label({ x: 0.5, y: H(0.66), text: V.northPacificMt, color: '#c2410c', at: 0 }),
  label({ x: 0.5, y: H(0.54), text: V.hotHumid, color: '#ea580c', at: 0, size: 9.5 }),

  bb({ x: 0.15, y: H(1.02), z: 0.06, w: 0.2, h: 0.2, color: rgba('#f97316', 0.95), kind: 2, at: 1 }),
  label({ x: 0.32, y: H(0.24), text: V.strongSun, color: '#c2410c', at: 1, size: 10 }),

  ...flow({ from: [0.4, H(0.04), ZC - 0.06], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.24, spreadZ: 0.08 }),
  ...flow({ from: [0.58, H(0.04), ZC + 0.02], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.2, spreadZ: 0.08 }),
  ...flow({ from: [0.74, H(0.04), ZC + 0.08], dir: [0, 1, 0], travel: 0.12, count: 2, scale: 0.04, color: rgba('#fb923c', 0.85), at: 2, speed: 0.28, spreadZ: 0.08 }),
  label({ x: 0.72, y: H(0.44), text: V.heatAccumulates, color: '#b91c1c', at: 2, size: 10 }),

  label({ x: 0.5, y: H(0.92), text: V.heatwave, color: '#dc2626', at: 3, size: 15, weight: 800 }),
];

/** siberian_clear: cP 정착 → 수증기 부족(구름 형성 실패) → 춥고 맑은 하늘 */
const siberianClear = () => [
  vol({ x0: 0, x1: 1, y1: H(0.52), color: rgba('#93c5fd', 0.28), taper: [0.92, 1], at: 0 }),
  bb({ x: 0.42, y: H(0.08), w: 1.1, h: 0.5, color: rgba('#3b82f6', 0.36), kind: 0, at: 0 }),
  ...flow({ from: [0.02, H(0.84), ZC + 0.1], dir: [0.92, -0.24, -0.24], travel: 0.32, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.34 }),
  label({ x: 0.34, y: H(1.0), text: V.siberianCp, color: COLD_TXT, at: 0 }),
  label({ x: 0.34, y: H(0.86), text: V.coldDry, color: '#3b82f6', at: 0, size: 9.5 }),

  puff({ x: 0.62, y: H(0.6), s: 1.1, color: rgba('#94a3b8', 0.3), at: 1, until: 1 }),
  label({ x: 0.62, y: H(0.34), text: V.vapourShortNoCloud, color: '#64748b', at: 1, until: 1, size: 10 }),

  bb({ x: 0.74, y: H(0.96), z: 0.06, w: 0.18, h: 0.18, color: rgba('#fcd34d', 0.92), kind: 2, at: 2 }),
  label({ x: 0.44, y: H(0.5), text: V.coldClearWinterSky, color: '#1d4ed8', at: 2, size: 11 }),
];

// ── 장면 5종 추가 (R13 확장 규칙 — board_rules.json 8 → 13종) ───────────────
// 라벨 문자열은 SVG 스토리보드의 CSText와 한 묶음이다(같은 어휘 규약: 십운형
// 명칭·"푄"·단열 감률 금지 — level_vocabulary v3에서 introduced_at 6).

/** okhotsk_sea_fog: 찬 기단 남하 → 찬 바다 위 하층 냉각 → 응결 → 해안 안개 */
const okhotskSeaFog = () => [
  wedge({ x0: 0.48, x1: 1, tx0: 0.8, tx1: 1.0, y1: H(0.72), color: rgba('#93c5fd', 0.3), at: 0 }),
  bb({ x: 0.84, y: H(0.6), w: 0.6, h: 0.4, color: rgba('#3b82f6', 0.38), kind: 0, at: 0 }),
  ...flow({ from: [0.98, H(0.82), ZC + 0.08], dir: [-0.94, -0.24, -0.26], travel: 0.34, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.36 }),
  label({ x: 0.78, y: H(1.0), text: V.okhotskAirMass, color: COLD_TXT, at: 0 }),
  label({ x: 0.78, y: H(0.86), text: V.coldHumid, color: '#3b82f6', at: 0, size: 9.5 }),

  label({ x: 0.82, y: H(0.1), text: V.coldSea, color: '#0369a1', at: 1, size: 10 }),
  // 하강 냉각 — 상승 대류와 반대 방향 벡터장이 "아래에서부터 식는다"를 만든다
  ...flow({ from: [0.6, H(0.5), ZC], dir: [-0.12, -1, 0], travel: 0.26, count: 3, color: rgba('#3b82f6', 0.9), at: 1, speed: 0.42, spreadZ: 0.15 }),
  label({ x: 0.42, y: H(0.62), text: V.coolsFromBelow, color: COLD_TXT, at: 1, size: 10 }),

  bb({ x: 0.66, y: 0.012, w: 0.66, h: 0.3, color: rgba('#f8fafc', 0.82), kind: 3, at: 2 }),
  bb({ x: 0.46, y: 0.03, w: 0.54, h: 0.24, color: rgba('#f1f5f9', 0.7), kind: 3, at: 2 }),
  label({ x: 0.5, y: H(0.4), text: V.condenseToSeaFog, color: '#0f172a', at: 2, size: 10 }),

  ...layerBand({ x0: 0.06, x1: 0.5, y: H(0.44), at: 3, dark: false, n: 3 }),
  bb({ x: 0.22, y: 0.02, w: 0.5, h: 0.24, color: rgba('#ffffff', 0.6), kind: 3, at: 3 }),
  label({ x: 0.24, y: H(0.72), text: V.fogLowCloudToShore, at: 3, size: 10 }),
];

/** okhotsk_foehn_clear: 산을 오르며 비 → 물기 상실 → 하강하며 데워짐 → 서쪽 맑음 */
const okhotskFoehnClear = () => [
  // 산맥 — 단계 무관 배경(at 0). taper로 위가 좁아지는 삼각 단면을 만든다.
  wedge({ x0: 0.3, x1: 0.82, tx0: 0.54, tx1: 0.58, y1: H(0.62), color: rgba('#9ca3af', 0.96), at: 0, z0: 0.04, z1: Z - 0.04 }),
  label({ x: 0.44, y: H(0.08), text: V.mountainRange, color: '#475569', at: 0, size: 9.5 }),

  ...flow({ from: [0.96, H(0.1), ZC], dir: [-0.86, 0.5, 0], travel: 0.3, count: 3, color: rgba('#2563eb', 0.9), at: 0, speed: 0.42 }),
  label({ x: 0.9, y: H(0.52), text: V.coldHumidAir, color: COLD_TXT, at: 0, size: 10 }),

  ...layerBand({ x0: 0.6, x1: 0.94, y: H(0.82), at: 1, n: 2 }),
  precip({ x0: 0.62, x1: 0.86, y1: H(0.78), slant: 0.08, speed: 0.85, count: 20, at: 1 }),
  label({ x: 0.78, y: H(1.02), text: V.rainOnRiseLosesWater, at: 1, size: 10 }),

  ...flow({ from: [0.5, H(0.6), ZC], dir: [-0.82, -0.58, 0], travel: 0.3, count: 3, color: rgba('#ea580c', 0.92), at: 2, speed: 0.46 }),
  bb({ x: 0.16, y: 0.006, w: 0.42, h: 0.24, color: rgba('#fb923c', 0.45), kind: 3, at: 2 }),
  label({ x: 0.22, y: H(0.48), text: V.descendCompressWarm, color: '#c2410c', at: 2, size: 10 }),

  bb({ x: 0.1, y: H(1.0), z: 0.06, w: 0.18, h: 0.18, color: rgba('#fcd34d', 0.92), kind: 2, at: 3 }),
  label({ x: 0.2, y: H(0.78), text: V.dryWarmWind, color: '#b45309', at: 3, size: 10 }),
  label({ x: 0.2, y: H(0.64), text: V.foehnClear, color: '#1d4ed8', at: 3, size: 11 }),
];

/** yangtze_mild_clear: 온난 건조 기단 이동 → 수증기 부족 → 구름 실패 → 맑고 포근 */
const yangtzeMildClear = () => [
  vol({ x0: 0, x1: 1, y1: H(0.54), color: rgba('#fdba74', 0.26), taper: [0.92, 1], at: 0 }),
  bb({ x: 0.38, y: H(0.1), w: 1.06, h: 0.48, color: rgba('#ea580c', 0.3), kind: 0, at: 0 }),
  ...flow({ from: [0.02, H(0.8), ZC + 0.08], dir: [0.94, -0.2, -0.22], travel: 0.32, count: 3, color: rgba('#ea580c', 0.88), at: 0, speed: 0.36 }),
  label({ x: 0.34, y: H(1.0), text: V.yangtzeAirMass, color: '#c2410c', at: 0 }),
  label({ x: 0.34, y: H(0.86), text: V.warmDry, color: '#ea580c', at: 0, size: 9.5 }),

  ...flow({ from: [0.44, H(0.16), ZC], dir: [1, 0.04, 0], travel: 0.28, count: 2, color: rgba('#f59e0b', 0.85), at: 1, speed: 0.34 }),
  label({ x: 0.72, y: H(0.32), text: V.lowVapourNoSea, color: '#b45309', at: 1, size: 10 }),

  puff({ x: 0.6, y: H(0.66), s: 1.1, color: rgba('#94a3b8', 0.28), at: 2, until: 2 }),
  label({ x: 0.6, y: H(0.9), text: V.cloudCannotGrow, color: '#64748b', at: 2, until: 2, size: 10 }),

  bb({ x: 0.8, y: H(0.98), z: 0.06, w: 0.19, h: 0.19, color: rgba('#fcd34d', 0.92), kind: 2, at: 3 }),
  label({ x: 0.42, y: H(0.56), text: V.mildClearSky, color: '#b45309', at: 3, size: 11 }),
];

/** yangtze_morning_fog: 맑은 밤 → 지표 냉각 → 물가 응결 → 새벽 안개·일출 소산 */
const yangtzeMorningFog = () => [
  bb({ x: 0.2, y: H(1.04), z: 0.06, w: 0.08, h: 0.08, color: rgba('#e2e8f0', 0.75), kind: 0, at: 0 }),
  bb({ x: 0.62, y: H(1.1), z: 0.06, w: 0.07, h: 0.07, color: rgba('#e2e8f0', 0.7), kind: 0, at: 0 }),
  label({ x: 0.5, y: H(0.94), text: V.clearCalmNight, color: '#fcd34d', at: 0, size: 10 }),
  label({ x: 0.5, y: H(0.8), text: V.warmDryAirMass, color: '#cbd5e1', at: 0, size: 9.5 }),

  ...flow({ from: [0.2, H(0.06), ZC - 0.1], dir: [0, 1, 0], travel: 0.26, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 1, speed: 0.3, spreadZ: 0.1 }),
  ...flow({ from: [0.56, H(0.06), ZC], dir: [0, 1, 0], travel: 0.26, count: 2, scale: 0.042, color: rgba('#f59e0b', 0.8), at: 1, speed: 0.26, spreadZ: 0.1 }),
  vol({ x0: 0, x1: 1, y1: H(0.2), color: rgba('#60a5fa', 0.3), at: 1 }),
  label({ x: 0.52, y: H(0.28), text: V.groundRadiatesCools, color: '#bfdbfe', at: 1, size: 10 }),

  bb({ x: 0.34, y: 0.012, w: 0.62, h: 0.3, color: rgba('#f8fafc', 0.82), kind: 3, at: 2 }),
  bb({ x: 0.52, y: 0.03, w: 0.46, h: 0.22, color: rgba('#ffffff', 0.6), kind: 3, at: 2 }),
  label({ x: 0.2, y: H(0.56), text: V.condenseByWater, color: '#e2e8f0', at: 2, size: 10 }),

  bb({ x: 0.9, y: H(0.46), z: 0.06, w: 0.15, h: 0.15, color: rgba('#fcd34d', 0.92), kind: 2, at: 3 }),
  label({ x: 0.7, y: H(0.74), text: V.liftsAfterSunrise, color: '#f8fafc', at: 3, size: 10 }),
];

/** dry_convection_clear: 지면 가열 → 공기 상승 → 응결할 수증기 없음 → 맑음 */
const dryConvectionClear = () => [
  bb({ x: 0.14, y: H(1.0), z: 0.06, w: 0.19, h: 0.19, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  bb({ x: 0.52, y: 0.004, w: 0.58, h: 0.36, color: rgba('#fb923c', 0.48), kind: 3, at: 0 }),
  label({ x: 0.52, y: H(0.16), text: V.groundHeating, color: '#c2410c', at: 0, size: 10 }),

  ...flow({ from: [0.52, H(0.06), ZC], dir: [0.04, 1, 0], travel: 0.32, count: 3, color: rgba('#ea580c', 0.92), at: 1, speed: 0.52, spreadZ: 0.14 }),
  label({ x: 0.74, y: H(0.5), text: V.warmedAirRises, color: '#c2410c', at: 1, size: 10 }),

  puff({ x: 0.52, y: H(0.86), s: 1.15, color: rgba('#94a3b8', 0.26), at: 2, until: 2 }),
  label({ x: 0.52, y: H(1.06), text: V.noVapourToCondense, color: '#64748b', at: 2, until: 2, size: 10 }),

  label({ x: 0.5, y: H(0.72), text: V.clearDespiteChurn, color: '#1d4ed8', at: 3, size: 11 }),
];

/**
 * ── R13 재난 축 2종 (CO-A3·CO-K4) — **MT-23에서 최소 기술을 회수했다** ──────
 *
 * 종전 주석은 *"의도적으로 최소 기술"*(2026-08-09 PM 「정직하게 최소로」)이었고,
 * 그 판단의 근거는 *"재난 2종이 말하는 것은 구조가 아니라 지면의 결과라 세울 구조가
 * 없다"* 였다. **이 전제가 틀렸다는 것이 MT-23 조사의 결론이다**
 * (`docs/design/research/RESEARCH_MT23_WILDFIRE_FLOOD.md`). 둘 다 구조가 있다:
 *   · 산불 = **화선의 비대칭**(불머리 / 측면 / 배화)과 **비화**로 앞에 새 불이 선다
 *   · 홍수 = **포화초과**의 순서(땅속이 먼저 참 → 위에 고임 → 낮은 곳으로 흐름)와
 *            **후방 생성**(밴드는 서 있고 셀만 상류에서 새로 생긴다)
 * 없던 것은 구조가 아니라 **그 구조를 그릴 표현**이었다. 그래서 실제로 바뀐 것은
 * 배치가 아니라 **빌보드 kind 2종(불꽃 5·연기 6)**과 **물을 빌보드가 아닌 볼륨으로
 * 세운 것**이다 — 종전에는 불꽃이 `kind: 2`(**태양 원반 셰이더**)를 주황으로 칠한
 * 것이었고 물이 지표에 눕는 판 하나였다.
 *
 * ⚠️ 계약은 그대로다: kind는 프래그먼트 분기라 **드로우 패스 8 불변**, 라벨은 SVG
 * 오버레이(드로우콜 0), 난수는 해시 노이즈뿐, 애니메이션은 기존 `uTime`·grow.
 * SVG 스토리보드(CrossSectionPanel)는 이번 소유 범위 밖이라 손대지 않았다 —
 * WebGL2가 없으면 여전히 그쪽 4단계가 뜬다(폴백 3경로 유지).
 */
/** wildfire_risk_dry_gale: 마른 숲 → 강풍 → **비탈을 타고 오르는 화선**·비화 → 위험한 맑음 */
const wildfireRiskDryGale = () => [
  // 지형 — **산**. 2026-08-18 클라이언트: *"산불이면 산에서 불이 나야지"*.
  //   처음 판은 산을 배경으로만 두고 불은 평지에서 태웠다 — 그건 들불이지 산불이 아니다.
  //   조사 §3E(en.wikipedia Wildfire modeling)가 지형 요인으로 콕 집은 것이
  //   **「불은 비탈을 더 빨리 오른다」**이므로, 화선 자체가 비탈 위에 있어야 한다.
  //   산은 `okhotsk_foehn_clear`와 같은 관용구 — 바닥이 넓고 정상이 뾰족한 삼각 단면.
  //   서쪽 비탈 높이 ≈ 0.288 × (x-0.42)/0.42 — 아래 나무·불꽃의 base가 전부 이 값이다.
  wedge({ x0: 0.42, x1: 1.06, tx0: 0.80, tx1: 0.88, y1: H(0.72), color: rgba('#93ad78', 0.97), at: 0, z0: 0.03, z1: Z - 0.03 }),
  tree({ x: 0.20, h: 0.07, at: 0 }),
  tree({ x: 0.305, h: 0.062, z: ZC - 0.04, at: 0 }),
  tree({ x: 0.50, base: 0.055, h: 0.072, z: ZC - 0.06, at: 0 }),
  tree({ x: 0.575, base: 0.106, h: 0.068, z: ZC - 0.09, at: 0 }),
  tree({ x: 0.65, base: 0.158, h: 0.066, z: ZC - 0.07, at: 0 }),
  tree({ x: 0.725, base: 0.209, h: 0.064, z: ZC - 0.10, at: 0 }),
  tree({ x: 0.79, base: 0.253, h: 0.058, z: ZC - 0.065, at: 0 }),
  label({ x: 0.86, y: H(1.00), text: V.forestedRidge, color: '#3f6212', at: 0, size: 9.5 }),

  // 0 — 연료. 「마름」은 오늘 습도가 아니라 **며칠의 누적**이다(실효습도, 조사 §3B).
  bb({ x: 0.10, y: H(1.02), z: 0.06, w: 0.15, h: 0.15, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  bb({ x: 0.26, y: 0.004, w: 0.42, h: 0.08, color: rgba('#ca8a04', 0.42), kind: 3, at: 0 }),
  label({ x: 0.22, y: H(0.16), text: V.driedLeavesTwigs, color: '#92400e', at: 0, size: 10 }),
  label({ x: 0.22, y: H(0.30), text: V.daysOfDrying, color: '#a16207', at: 0, size: 9.5 }),

  // 1 — 강풍. 두 층으로 나눠 「지면을 훑는 바람」을 만들고 비탈 밑에서 멈춘다.
  ...flow({ from: [0.02, H(0.16), ZC], dir: [1, 0.02, 0], travel: 0.30, count: 3, color: rgba('#0e7490', 0.9), at: 1, speed: 0.8, spreadZ: 0.15, spreadY: 0.016 }),
  ...flow({ from: [0.02, H(0.38), ZC], dir: [1, 0.05, 0], travel: 0.26, count: 2, scale: 0.046, color: rgba('#0e7490', 0.82), at: 1, speed: 0.6, spreadZ: 0.12 }),
  label({ x: 0.14, y: H(0.54), text: V.strongWind, color: '#0e7490', at: 1, size: 11 }),

  // 2 — **비탈 위의 화선**. 바람도 비탈도 동쪽을 가리키므로 위로 갈수록 크다:
  //     아래가 배화, 위가 불머리다(조사 §3A 비대칭 + §3E 상향 가속).
  ...flame({ x: 0.52, y: 0.069, h: 0.09, z: ZC - 0.04, at: 2 }),
  ...flame({ x: 0.60, y: 0.123, h: 0.135, z: ZC - 0.04, at: 2 }),
  ...flame({ x: 0.68, y: 0.178, h: 0.185, z: ZC - 0.04, at: 2 }),
  ...smoke({ x: 0.70, y: H(0.52), n: 3, lean: 0.05, rise: 0.062, at: 2 }),
  label({ x: 0.40, y: H(0.50), text: V.fireRunsUphill, color: '#9a3412', at: 2, size: 10 }),
  label({ x: 0.66, y: H(0.88), text: V.fireFrontHead, color: '#9a3412', at: 2, size: 10 }),
  // 비화 — 불티가 **능선을 넘어** 반대 비탈에 새 불을 놓는다(조사 §3A: 방화선을 뛰어넘는다)
  ...flow({ from: [0.70, H(0.72), ZC], dir: [1, 0.28, 0], travel: 0.24, count: 3, scale: 0.03, color: rgba('#f97316', 0.95), at: 2, speed: 0.9, spreadZ: 0.1 }),
  label({ x: 0.80, y: H(1.10), text: V.embersRideWind, color: '#c2410c', at: 2, size: 10 }),
  ...flame({ x: 0.93, y: 0.215, h: 0.065, at: 2 }),
  label({ x: 0.95, y: H(0.74), text: V.spotFireAhead, color: '#c2410c', at: 2, size: 9.5 }),

  // 3 — **수관화**. 지표화가 사다리 연료를 타고 나무 꼭대기로 옮겨붙는 것이
  //     조사 §3A·§3E가 말하는 surface → crown 전이다. 산불이 커지는 분기점이다.
  ...flame({ x: 0.575, y: 0.160, h: 0.072, z: ZC - 0.09, at: 3 }),
  ...flame({ x: 0.65, y: 0.212, h: 0.068, z: ZC - 0.07, at: 3 }),
  label({ x: 0.40, y: H(0.72), text: V.crownFireInTrees, color: '#b45309', at: 3, size: 10 }),
  label({ x: 0.22, y: H(0.74), text: V.clearSkyWildfire, color: '#b45309', at: 3, size: 11 }),
];

/** flood_risk_saturated_inflow: 수증기 유입 → 후방 생성 → 지속 강수 → 포화·배수 초과 */
const floodRiskSaturatedInflow = () => [
  // 지형 — **도시**. 2026-08-18 클라이언트: *"도시도 디테일이 떨어져"*.
  //   조사 §3F(en.wikipedia Urban flooding)가 도시 침수를 정의하는 문장이
  //   *"배수 체계(빗물받이)의 용량을 넘어서는 것"*이라, 도시에 있어야 하는 것은
  //   건물 실루엣이 아니라 **① 포장면 ② 빗물받이 ③ 지하 ④ 스며드는 땅과의 대비**다.
  //   ④가 핵심이다 — 「왜 도시에서만 잠기나」는 투수/불투수 대비로만 설명된다.
  vol({ x0: 0.21, x1: 0.335, y0: 0, y1: 0.006, color: rgba('#65a30d', 0.95), pattern: 4, at: 0 }),
  vol({ x0: 0.335, x1: 1.0, y0: 0, y1: 0.008, color: rgba('#a8a29e', 0.94), pattern: 2, at: 0 }),
  // 두 줄로 세운다 — 한 줄이면 「건물 몇 개」이지 도시가 아니다. 뒷줄은 높고 앞줄은
  // 낮게 두어 그 사이가 **거리**로 읽히게 하고, 그 거리에 빗물받이를 둔다.
  building({ x: 0.44, h: 0.160, w: 0.052, z: ZC + 0.075, at: 0 }),
  building({ x: 0.575, h: 0.200, w: 0.056, z: ZC + 0.075, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.715, h: 0.145, w: 0.050, z: ZC + 0.075, at: 0 }),
  building({ x: 0.855, h: 0.185, w: 0.058, z: ZC + 0.075, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.395, h: 0.098, w: 0.048, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.515, h: 0.128, w: 0.054, z: ZC - 0.085, at: 0 }),
  building({ x: 0.635, h: 0.090, w: 0.046, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  building({ x: 0.795, h: 0.118, w: 0.050, z: ZC - 0.085, at: 0 }),
  building({ x: 0.915, h: 0.102, w: 0.046, z: ZC - 0.085, at: 0, color: rgba('#a8a29e', 0.95) }),
  // 지하 — 도시 침수가 「지하부터」인 이유(§3F: 벽·바닥으로 스미고 하수로 역류한다)
  vol({ x0: 0.488, x1: 0.542, y0: -0.050, y1: -0.002, color: rgba('#57534e', 0.94), z0: ZC - 0.13, z1: ZC - 0.04, at: 0 }),
  // 빗물받이 — 배수 용량의 화신. 앞줄 두 건물 사이 **거리**에 있고,
  // 2단계에서 삼키다가 3단계에서 역류한다(§3F: 도시 침수의 정의가 이 용량 초과다)
  vol({ x0: 0.700, x1: 0.740, y0: -0.044, y1: 0.007, color: rgba('#44403c', 0.96), z0: ZC - 0.125, z1: ZC - 0.045, at: 0 }),
  label({ x: 0.27, y: H(0.30), text: V.greenGroundSoaks, color: '#3f6212', at: 0, size: 9.5 }),
  label({ x: 0.64, y: H(0.72), text: V.cityImpervious, color: '#44403c', at: 0, size: 9.5 }),

  // 0 — 유입. 두 층으로 나눠 「쉬지 않고」를 두께로 보인다(바다는 서쪽 0~0.2)
  ...flow({ from: [0.02, H(0.20), ZC], dir: [1, 0.10, 0], travel: 0.40, count: 3, color: rgba('#0d9488', 0.92), at: 0, speed: 0.62, spreadZ: 0.15 }),
  ...flow({ from: [0.02, H(0.44), ZC], dir: [1, 0.14, 0], travel: 0.34, count: 2, scale: 0.046, color: rgba('#0d9488', 0.85), at: 0, speed: 0.5, spreadZ: 0.12 }),
  label({ x: 0.20, y: H(0.62), text: V.vapourKeepsArriving, color: '#0f766e', at: 0, size: 10 }),

  // 1 — **후방 생성**(조사 §3D). 상류(서)에서 작은 셀이 새로 생겨 자라며 동으로 가고
  //     하류에서 흩어진다 — **밴드 자체는 서 있다**는 것이 이 그림의 요점이다.
  puff({ x: 0.34, y: H(0.78), s: 0.8, color: rgba('#94a3b8', 0.68), at: 1 }),
  puff({ x: 0.50, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.88), at: 1 }),
  puff({ x: 0.66, y: H(0.90), s: 1.5, color: rgba('#94a3b8', 0.92), at: 1 }),
  puff({ x: 0.80, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.78), at: 1 }),
  ...flow({ from: [0.36, H(1.02), ZC], dir: [1, 0, 0], travel: 0.34, count: 2, scale: 0.042, color: rgba('#64748b', 0.85), at: 1, speed: 0.5, spreadZ: 0.1 }),
  label({ x: 0.23, y: H(1.02), text: V.newCellsUpwind, color: '#475569', at: 1, size: 10 }),
  label({ x: 0.72, y: H(1.10), text: V.rainCloudRefills, color: '#475569', at: 1, size: 10 }),

  // 2 — 비. 풀밭은 스며들고(아래로 짧은 화살표) 빗물받이는 아직 삼킨다
  precip({ x0: 0.24, x1: 0.98, y1: H(0.82), kind: 'rain', slant: 0.14, speed: 1.25, count: 34, at: 2 }),
  ...flow({ from: [0.275, H(0.10), ZC], dir: [0, -1, 0], travel: 0.06, count: 2, scale: 0.034, color: rgba('#15803d', 0.9), at: 2, speed: 0.5, spreadZ: 0.1 }),
  ...flow({ from: [0.72, H(0.11), ZC - 0.085], dir: [0, -1, 0], travel: 0.075, count: 1, scale: 0.038, color: rgba('#0369a1', 0.9), at: 2, speed: 0.6 }),

  // 3 — **포화·배수 초과**(조사 §3C·§3F). 순서가 문법이다: 땅속이 차고 → 위에 고이고 →
  //     빗물받이가 역류하고 → 지하부터 잠기고 → 못 스민 물이 포장면을 타고 빠르게 흐른다.
  //     ⚠️ 물은 새 셰이더가 아니라 기존 `pattern: 3`(바다 잔물결, uTime 구동)이고,
  //        볼륨이라 등장 grow가 곧 **수위 상승**이 된다.
  vol({ x0: 0, x1: 1, y0: -0.066, y1: -0.022, color: rgba('#0ea5e9', 0.34), pattern: 3, at: 3 }),
  vol({ x0: 0.490, x1: 0.540, y0: -0.048, y1: -0.004, color: rgba('#0284c7', 0.72), z0: ZC - 0.125, z1: ZC - 0.045, pattern: 3, at: 3 }),
  vol({ x0: 0.02, x1: 0.98, y0: -0.006, y1: H(0.115), color: rgba('#38bdf8', 0.5), pattern: 3, at: 3 }),
  // 빗물받이 역류 — 아래로 못 내려가니 위로 되올라온다
  ...flow({ from: [0.72, H(0.03), ZC - 0.085], dir: [0, 1, 0], travel: 0.065, count: 2, scale: 0.04, color: rgba('#075985', 0.98), at: 3, speed: 0.7, spreadZ: 0.045 }),
  // 유출 — **포장면이 물살을 빠르게 한다**(§3F). 화살표는 수면 위에 둔다(물속은 안 읽힌다)
  ...flow({ from: [0.90, H(0.20), ZC], dir: [-1, -0.05, 0], travel: 0.38, count: 3, scale: 0.052, color: rgba('#075985', 0.98), at: 3, speed: 0.9, spreadZ: 0.16 }),
  label({ x: 0.20, y: H(0.44), text: V.groundCannotAbsorb, color: '#0c4a6e', at: 3, size: 10 }),
  label({ x: 0.20, y: H(0.30), text: V.soilAlreadyFull, color: '#0369a1', at: 3, size: 9.5 }),
  label({ x: 0.73, y: H(0.32), text: V.drainOverwhelmed, color: '#075985', at: 3, size: 9.5 }),
  label({ x: 0.515, y: H(0.14), text: V.basementFloods, color: '#0c4a6e', at: 3, size: 9.5 }),
  label({ x: 0.90, y: H(0.44), text: V.runoffGathersLow, color: '#0369a1', at: 3, size: 10 }),
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
  okhotsk_sea_fog: { build: okhotskSeaFog, sea: { from: 0.5, to: 1 } },
  okhotsk_foehn_clear: { build: okhotskFoehnClear },
  yangtze_mild_clear: { build: yangtzeMildClear },
  yangtze_morning_fog: { build: yangtzeMorningFog, night: true, sea: { from: 0.26, to: 0.44 } },
  dry_convection_clear: { build: dryConvectionClear },
  wildfire_risk_dry_gale: { build: wildfireRiskDryGale },
  flood_risk_saturated_inflow: { build: floodRiskSaturatedInflow, sea: { from: 0, to: 0.2 } },
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

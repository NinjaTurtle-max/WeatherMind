/**
 * scenes — **전 규칙** 단면 장면 기술(記述) (R10-C / S2 · R13 확장 5종).
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
 *
 * `base` — 건물이 선 **지반 높이**(기본 0 = 종전 동작, 하위 호환).
 * 🔴 **2026-08-19 결함: 홍수인데 도시가 잠기지 않는다**(클라이언트 직접 지적,
 * **두 번째 반려**). 원인은 수위가 낮아서가 **아니라** 이 함수가 `y0: 0`을 못박아
 * **앞줄과 뒷줄이 같은 지반** 위에 섰기 때문이다 — 물을 올리면 두 줄이 **비례해서**
 * 잠긴다. 앞줄 최저(0.090)를 삼키려면 수위 ≈ 0.095가 필요한데 그때 뒷줄이
 * 48~66% 잠겨 **해일 그림**이 된다. 도시 침수의 문법은 「낮은 곳부터」이므로
 * 고칠 것은 물이 아니라 **지반의 높이 차**다. 그래서 `base`가 생겼다.
 *
 * 🔴 **2026-08-19 10차 — `base`의 쓸모가 바뀌었다.** 위 「지반의 높이 차」 처방은
 * 물이 **공중의 카드**라는 전제 위에 있었다. 물이 몸통의 면(`ground`)이 되면
 * **물은 건물 몸통을 원리적으로 침범할 수 없다** — pass 2가 pass 4보다 먼저다.
 * 그러면 잠김을 「덮어서」 보일 방법이 없고, 조사 정정 2가 관례라고 적은 그대로
 * **발치를 잘라야** 한다: 3단계 건물은 `base = 수면`으로 다시 세운다. 잠긴 층은
 * 그리지 않고, 그 자리를 몸통(물)이 차지한다. 지반을 어긋내는 것이 아니라
 * **수면 하나가 도시 전체를 같은 높이에서 자르는 것**이 참조의 문법이다.
 * (`until` — 마른 판과 잘린 판을 단계로 갈아 끼우기 위해 추가. 이 두 함수는
 *  홍수 장면 전용이라 다른 19장면에 파급이 없다.)
 */
function building({ x, w = 0.055, h, z = ZC, base = 0, at, until, color = rgba('#94a3b8', 0.95) }) {
  return vol({
    x0: x - w / 2, x1: x + w / 2, y0: base, y1: base + h,
    z0: z - 0.045, z1: z + 0.045, color, at, until,
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
  const veg = night ? rgba('#43533f', 1) : rgba('#c6dbb0', 1);
  const items = [];
  if (!sea) {
    items.push(vol({ x0: 0, x1: 1, y0: -0.02, y1: 0.0, color: veg, pattern: 4, layer: 'ground' }));
  } else {
    // 🔴 **바다 구간에서 지면 윗면을 갈라 낸다**(2026-08-20 클라이언트 지시).
    //
    //   종전엔 지면 윗면이 x 0~1 한 장이고 그 **위에** 바다 스트립을 얹었다.
    //   그런데 `renderer.js`가 모든 solid를 중심 깊이로 정렬한 뒤 그리므로
    //   (`solids.sort` → `pushSolid`), **바다가 지면보다 먼저 그려지고 지면 윗면이
    //   바다를 통째로 덮었다.** 실측 nearness — 바다 0.2113 < 지면 0.4294.
    //   바다 윗면(y 0.002)이 지면 윗면(y 0)보다 0.002 높아 **뒷줄 가장자리에
    //   실선 한 줄**만 남았다. 몸통 윗면을 자홍, 바다를 노랑으로 칠해 확인했다.
    //
    //   ⇒ 겹치게 두고 순서로 이기려 하지 않는다 — **애초에 안 겹치게 자른다.**
    //     `tropical_cyclone_genesis`(sea 0~1)는 자르고 나면 지면 조각이 **0개**가
    //     되어 화면이 통째로 바다다. 그것이 그 장면의 뜻이다.
    //
    //   ⚠️ 바다가 **안쪽**에 있으면(`from > 0` 이면서 `to < 1`) 지면이 두 조각이
    //     되어 `ground` 예산을 하나 더 쓴다. `MAX_GROUND = 8`이고 그런 장면은
    //     `siberian_snow`(0.06~0.56)·`yangtze_morning_fog`(0.26~0.44) 둘뿐이며
    //     둘 다 여유 안이다(계약 7-i가 전 장면을 훑는다).
    // 🔴 **흙도 함께 자른다 — 윗면만 잘랐더니 흙이 바다를 덮었다**(같은 날 재실측).
    //   지면 윗면만 갈라 냈더니 이번엔 **심층토**(`#d6c9a8` · x 0~1 · nearness
    //   0.4168)가 바다(0.2113)보다 나중에 그려져 그 자리를 덮었다. 정렬 키에서
    //   x가 지배적이라(0.5487x) **x 0~1을 덮는 판은 서쪽 끝 판을 언제나 앞지른다**
    //   — 순서로는 못 이긴다. 자를 것을 덜 잘랐던 것이다.
    //   ⇒ 바다 구간에서는 **흙도 비우고 바다가 그 깊이를 통째로 갖는다**
    //     (y -0.07~0.002). 단면에서 바다가 **물기둥**으로 보이는 것이 관례이기도
    //     하다 — 얇은 띠보다 이쪽이 옳다.
    const from = sea.from ?? 0;
    const to = sea.to;
    const band = (x0, x1) => {
      items.push(vol({ x0, x1, y0: -0.02, y1: 0.0, color: veg, pattern: 4, layer: 'ground' }));
      items.push(vol({ x0, x1, y0: -0.07, y1: -0.02, color: rgba('#d6c9a8', 1), pattern: 2, layer: 'ground' }));
    };
    if (from > 0) band(0, from);
    if (to < 1) band(to, 1);
    items.push(vol({
      x0: from, x1: to, y0: -0.07, y1: 0.002,
      color: rgba('#7dd3fc', 0.97), pattern: 3, layer: 'ground',
    }));
    return items;
  }
  items.push(vol({ x0: 0, x1: 1, y0: -0.07, y1: -0.02, color: rgba('#d6c9a8', 1), pattern: 2, layer: 'ground' }));
  return items;
}


// ── 장면 v1 (도입 당시 8종 — rule_id ↔ STORYBOARDS 단계 인덱스와 1:1) ──

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
  // 🔴 **2026-08-19: 전선면을 교재 규약대로 고쳤다**(클라이언트가 참조 그림 지정).
  //   참조: 「정체전선의 3차원 모식도」(출처가 그림 캡션에 `The Atmosphere`로
  //   박혀 있는 **교재 도판**).
  //   ⚠️ **따라 그리지 않았다** — 복제·트레이싱 금지(클라이언트 상시 지시)이고
  //      제출물에 타인 저작물이 들어가면 실격 위험이다. 가져온 것은 **그 도판이
  //      쓰는 표준 기상 규약**이고, 그것은 WMO·교재 공통이라 저작물이 아니다.
  //
  //   종전 장면이 규약과 어긋난 자리 셋:
  //     ⓐ **두 기단이 같은 높이**(둘 다 H(0.62))라 「찬 공기가 **아래에 깔리고**
  //        따뜻한 공기가 **위로 올라탄다」가 안 보였다.** 나란히 선 두 덩이였다.
  //     ⓑ 따뜻한 기단 쐐기가 **위로 갈수록 좁아졌다**(tx 0.94~1.0) — 방향이
  //        반대다. 올라타려면 **위로 갈수록 찬 공기 쪽으로 더 뻗어야** 한다.
  //     ⓒ 전선면이 **거의 수직**이었다(xb 0.50 → xt 0.54, 0.04만 기울었다).
  //        정체전선의 전선면은 **뚜렷한 경사면**이고 그것이 이 그림의 주어다.
  //
  // 찬 기단 — **낮고 넓은 쐐기**, 팁이 따뜻한 쪽(동)으로 파고든다. 밀도가 커서
  //   지면을 붙잡고 눕는다. 높이를 H(0.62) → **H(0.44)**로 낮춰 「아래」를 만든다.
  wedge({ x0: 0, x1: 0.56, tx0: 0.0, tx1: 0.12, y1: H(0.44), color: COLD_FILL, at: 0 }),
  // 따뜻한 기단 — **찬 쐐기 위로 올라탄다.** 바닥은 전선 동쪽(0.46~1)이지만
  //   위로 갈수록 **서쪽으로 뻗어**(0.14~1) 찬 공기를 덮는다 — ⓑ의 정정이다.
  wedge({ x0: 0.46, x1: 1, tx0: 0.14, tx1: 1.0, y1: H(0.78), color: rgba('#fca5a5', 0.40), at: 0 }),
  // Cold ↔ Warm — 서로 마주 밀지만 어느 쪽도 못 밀어낸다(그래서 「정체」다).
  //   참조처럼 **전선 바로 양옆에 굵게** 둔다(종전엔 화면 양 끝에 작게 있었다).
  ...flow({ from: [0.30, H(0.16), ZC], dir: [1, 0, 0], travel: 0.16, count: 3, scale: 0.060, color: rgba('#2563eb', 0.90), at: 0, speed: 0.28, spreadZ: 0.14 }),
  ...flow({ from: [0.70, H(0.16), ZC], dir: [-1, 0, 0], travel: 0.16, count: 3, scale: 0.060, color: rgba('#dc2626', 0.90), at: 0, speed: 0.28, spreadZ: 0.14 }),
  label({ x: 0.16, y: H(0.30), text: V.coldAir, color: COLD_TXT, at: 0 }),
  label({ x: 0.86, y: H(0.56), text: V.warmAir, color: WARM_TXT, at: 0 }),
  // 전선면 — **경사면**. 지상에서 x=0.50이고 위로 갈수록 서쪽(0.16)으로 기운다.
  //   그 아래가 찬 공기, 위가 따뜻한 공기다. 두께도 0.02 → 0.026으로 키워
  //   「면」으로 읽히게 한다(선이 아니라 면이 이 그림의 주어다).
  frontSlab({ xb: 0.50, xt: 0.16, y1: H(0.78), color: rgba('#7c3aed', 0.46), at: 1, thick: 0.026 }),
  // ⚠️ x 0.34 → 0.26 · y H(0.90) → H(0.66). 실측 겹침(2026-08-19): 위로 올린 뒤
  //    「비층운(장마 구름 띠)」과 **세로 3.7 · 가로 22.4** 부딪혔다. 전선 라벨은
  //    **경사면 위에 붙는 것**이 뜻에도 맞다 — 면이 이 그림의 주어다.
  label({ x: 0.26, y: H(0.66), text: V.stationaryFront, color: '#6d28d9', at: 1, size: 10 }),
  // 습윤 유입 — 따뜻한 쪽에서 전선면을 타고 오른다
  ...flow({ from: [0.98, H(0.50), ZC + 0.05], dir: [-1, 0.10, -0.12], travel: 0.34, count: 2, color: rgba('#0d9488', 0.9), at: 2, speed: 0.4 }),
  label({ x: 0.88, y: H(0.34), text: V.humidAirSupply, color: '#0f766e', at: 2, size: 10 }),
  // 구름 밴드 — 전선면 위에 얹혀 남북으로 길게 선다(장마 전선의 정체)
  ...layerBand({ x0: 0.16, x1: 0.88, y: H(0.70), at: 2, n: 4 }),
  label({ x: 0.46, y: H(1.00), text: V.monsoonCloudBand, at: 2, size: 10 }),
  // 강수 — 전선면 **서쪽(찬 공기 위)**에 집중된다. 따뜻한 공기가 그쪽으로 올라타
  // 응결하기 때문이고, 실제 장마철 비가 전선 북쪽에 오는 이유다.
  precip({ x0: 0.18, x1: 0.42, y1: H(0.70), slant: 0.06, speed: 0.85, count: 22, at: 3 }),
  precip({ x0: 0.42, x1: 0.66, y1: H(0.70), slant: 0.06, speed: 0.8, count: 22, at: 3 }),
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

// ── 장면 5종 추가 (R13 확장 — **그때의** 증분 8 → 13. 현재 총수는 아니다) ──
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
  // ⚠️ y H(0.56) → H(0.44). 실측 겹침(2026-08-19): 1단계 `groundRadiatesCools`
  //    (H(0.28))·3단계 `liftsAfterSunrise`와 세로가 가까웠다. 응결은 지표 가까이
  //    일어나므로 낮추는 것이 뜻에도 맞다.
  label({ x: 0.2, y: H(0.44), text: V.condenseByWater, color: '#e2e8f0', at: 2, size: 10 }),

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
/**
 * 🔴 **한 줄 → 두 줄**(2026-08-20 클라이언트: *"건물을 두 줄 또는 3줄로 해서
 * 부자연스러움만 커버하고"*).
 *
 * ⚠️ **9차의 「단일 깊이」 규칙이 왜 폐지되는지 먼저 적는다.** 그때 클라이언트가
 *   *"물하고 건물하고 자동차를 한 레이어에 넣어. 지금 레이어를 쌓아서 부정합하니"*
 *   라고 한 것은 **물과 물체의 앞뒤**가 물체마다 달라졌기 때문이다 — 물이 `air`
 *   카드라 중심 깊이 하나로 같이 정렬됐고, 건물 z=0.22 · 차 z=0.25처럼 깊이가
 *   갈리면 **물이 어떤 건물 앞엔 오고 어떤 건물 뒤엔 가** 있었다.
 *
 * 🔴 **10차에 물을 `layer: 'ground'`(pass 2)로 내리면서 그 원인이 사라졌다.**
 *   물은 이제 **건물 전부보다 무조건 먼저** 그려진다 — 정렬 결과와 무관하다.
 *   그래서 건물끼리 깊이가 갈려도 물과의 관계는 **전부 같다.** 남는 정렬은
 *   건물끼리의 앞뒤뿐이고, 그것은 **앞줄이 나중에 그려지는 것이 맞다.**
 *   ⇒ 두 줄로 세운다. 뒷줄 z 0.13(0.085~0.175) · 앞줄 z 0.31(0.265~0.355) —
 *     건물 깊이가 0.09 고정이라 두 띠가 **겹치지 않는다.**
 *     실측 nearness 뒷줄 0.098 < 앞줄 0.234 ⇒ 앞줄이 나중 = 앞.
 *   ⚠️ 앞줄 x를 뒷줄 사이에 **엇물린다.** 나란히 세우면 앞줄이 뒷줄을 가려
 *     두 줄인 것이 안 보인다.
 */
const ZROW_BACK = 0.09;
const ZROW_MID = 0.20;
const ZROW_FRONT = 0.31;
/**
 * 빗물받이가 놓이는 깊이 — **줄과 줄 사이 길**이다.
 *
 * 🔴 종전 z 0.19~0.25는 가운데 줄 띠(0.155~0.245)를 **관통**했다(계약 7-F2가 잡았다).
 *   9차에 클라이언트가 반려한 「레이어를 쌓아서 부정합」이 정확히 그 상태다 —
 *   깊이 띠가 겹치면 앞뒤가 물체마다 갈린다.
 * ⇒ 가운데 줄과 앞줄 사이 틈(0.245~0.265)에 **얇게** 눕힌다. 빗물받이는 길바닥
 *   격자라 깊이가 얇은 것이 오히려 맞다.
 */
const ZDRAIN = 0.255;
/** 지하·빗물받이가 붙는 줄 — 지하는 뒷줄 건물 밑, 빗물받이는 두 줄 사이 길 */
const ZOBJ = ZROW_BACK;

/**
 * 🔴 **수면선** — 물의 「윗면」이 아니라 **물체에 긋는 가로선**이다(2026-08-19 10차).
 *
 * 9차까지 이 값은 물 상자의 `y1`이었다. 그런데 **수평판은 두께가 아니라 깊이 방향
 * 폭이 화면 높이를 만든다**(`Δz·sin21° + Δy·cos21°`) — z 0.14~0.42만으로도 화면
 * 높이의 10%를 먹는다. 거기에 y로 0.042를 더 세우면 **지표면과 다른 높이의 판**이
 * 되어 「바닥이 한 장 더」로 읽힌다. 클라이언트가 4단계에서 센 **띠 3장**
 * (초록 풀밭 · 청록 물 · 갈색 포장)이 정확히 그것이다.
 *
 * ⇒ 조사 정정 2대로 **물에서 두께를 뺀다.** 물의 윗면을 지표면·포장면과 **같은
 *   높이**(y ≈ 0.002)에 두면 셋이 **한 면 위의 색 차이**가 된다 — 클라이언트가
 *   요구한 「같은 면 위의 색 차이」가 이것이다.
 * ⇒ 그러면 잠김을 「물을 쌓아서」 보일 수 없으므로, 조사 §4ⓑ의 나머지 한 수를 쓴다:
 *   **수면선을 물이 아니라 물체 위에 긋는다.** 물체의 이 높이 아래 조각을 물빛으로
 *   물들이면(§2⑴ *"수면선 위는 원색 그대로, 아래만 물빛으로 물든다 — 윤곽은 계속
 *   비친다"*) 세 채와 차에 **같은 높이의 가로선**이 생겨 수위가 읽힌다.
 * ⚠️ **값은 6차부터 그대로다**(H(0.105)). 올리지 않는다 — 앞줄 건물을 3~6층으로
 *    읽으면 실척 3.6~10 m이고 내수침수위험지도 최상위 밴드(3.0 m 이상)를 넘는다.
 */
const WATERLINE = H(0.105);
/** 물빛 — 지표수·잠긴 조각이 공유하는 단 하나의 물 색 */
const FLOOD_WATER = rgba('#0891b2', 1);
/**
 * 수면선 **아래** 조각의 색 — 제 색을 물빛 쪽으로 72% 물들인다.
 * ⚠️ 「알파를 낮춰 뒤의 물이 비치게」가 아니다. 그러면 물체마다 **뒤에 무엇이 있느냐**로
 *    색이 달라져 수면선이 끊긴다. 색 자체를 물들여야 배경과 무관하게 선이 이어진다.
 */
const sunk = (c) => [
  c[0] + (FLOOD_WATER[0] - c[0]) * 0.72,
  c[1] + (FLOOD_WATER[1] - c[1]) * 0.72,
  c[2] + (FLOOD_WATER[2] - c[2]) * 0.72,
  Math.min(c[3], 0.94),
];
/** 도시 3채 — 마른 판과 잠긴 판이 **같은 제원**을 쓰도록 한 곳에서 소유한다 */
/**
 * 🔴 **높이를 전부 같게, 두 줄로**(2026-08-20 클라이언트: *"건물을 두 줄 또는
 * 3줄로 해서 부자연스러움만 커버하고, 추가로 건물의 높이는 다 동일하게 해줘"*).
 *
 * 🔴 **이 지시로 「잠긴 정도의 4단계」가 없어진다 — 그 대가를 여기 적는다.**
 *   직전 판은 h를 넷 다르게 줘 **33% · 46% · 62% · 76%**를 만들었고, 76%가 조사
 *   §2⑺의 「지붕만 남은 집」, 33%가 「벽 절반인 집」이었다. 높이가 같아지면
 *   **다섯 채가 전부 46%**라 그 어휘가 죽는다.
 *   ⇒ 깊이를 말하는 수단이 **둘로 줄어든다**: ⓐ 물 색 계조(3단), ⓑ 같은 높이의
 *     여러 채를 **한 줄로 가로지르는 수면선**. ⓑ는 오히려 강해진다 — 높이가
 *     제각각이면 「저 집이 낮은 건가 더 잠긴 건가」가 갈리는데, 같으면 잘린 선이
 *     곧 수위다. 실제 침수 사진의 읽는 법이 그것이다.
 *   ⚠️ 그래도 **잃은 것은 잃은 것**이다. 계약 7-E·7-F가 「편차 ≥ 20%p」를 물고
 *     있었으므로 함께 고쳤다 — 요구가 「여러 단계」에서 「한 선에 여럿이 잘린다」로
 *     바뀐 것이지, 요구를 없앤 것이 아니다.
 *
 * 🔴 **두 줄 → 세 줄, 다섯 채 → 여덟 채**(2026-08-20 클라이언트: *"3줄로 가게
 *    래칫 올려"*). 직전 판은 `RATCHET.floodSolids = 18`에 걸려 다섯 채가 상한이었고,
 *    그 계약이 *"이 상한을 올리지 말 것"*이라 적혀 있어 **제 판단으로는 안 올렸다.**
 *    클라이언트가 올리라고 판정했으므로 올린다 — 사유와 새 상한은 계약 쪽 주석이
 *    소유한다.
 *    줄 깊이 0.09 / 0.20 / 0.31 — 건물 깊이가 0.09 고정이라 세 띠
 *    (0.045~0.135 · 0.155~0.245 · 0.265~0.355)가 **서로 안 겹친다.**
 *    가운데 줄만 x를 엇물려 세 줄이 격자로 읽히게 한다.
 *
 * 높이 0.092 · 수면 0.042 ⇒ **46%** — 마른 것도 잠긴 것도 아닌 중간이라 잘린 선이
 * 가장 잘 읽히는 자리다.
 */
const FLOOD_H = 0.092;
const FLOOD_CITY = [
  // 뒷줄 3채
  { x: 0.34, z: ZROW_BACK, h: FLOOD_H, w: 0.055, color: rgba('#a8a29e', 0.95) },
  { x: 0.55, z: ZROW_BACK, h: FLOOD_H, w: 0.055, color: rgba('#94a3b8', 0.95) },
  { x: 0.76, z: ZROW_BACK, h: FLOOD_H, w: 0.055, color: rgba('#a8a29e', 0.95) },
  // 가운데 줄 2채 — 뒷줄·앞줄 **사이**에 엇물린다
  { x: 0.445, z: ZROW_MID, h: FLOOD_H, w: 0.055, color: rgba('#94a3b8', 0.95) },
  { x: 0.655, z: ZROW_MID, h: FLOOD_H, w: 0.055, color: rgba('#a8a29e', 0.95) },
  // 앞줄 3채 — 뒷줄과 같은 x. 등축에서 좌하로 내려앉아 서로 안 가린다.
  { x: 0.34, z: ZROW_FRONT, h: FLOOD_H, w: 0.055, color: rgba('#94a3b8', 0.95) },
  { x: 0.55, z: ZROW_FRONT, h: FLOOD_H, w: 0.055, color: rgba('#a8a29e', 0.95) },
  { x: 0.76, z: ZROW_FRONT, h: FLOOD_H, w: 0.055, color: rgba('#94a3b8', 0.95) },
];

const floodRiskSaturatedInflow = () => [
  // 🔴 **2026-08-19 7차 — 클라이언트**: *"모든 물 렌더링을 앞으로 당기고 저 이상한
  //   회색 바닥을 좀 제거해줘"*
  //
  //   두 지시가 같은 것을 가리킨다. **회색 바닥 = 제가 2차에 넣은 고지대 슬래브**
  //   (`#a8a29e` · 폭 0.665 × **높이 0.080** × 깊이 0.22)다. 「저지대만 잠긴다」를
  //   보이려고 넣었는데, 실제로는
  //     ⓐ **4차 가림 결함의 주범**이었고(수면 0.042보다 높은 불투명 벽),
  //     ⓑ 화면에서는 **뜬금없는 회색 덩이**로 읽혔다.
  //   ⇒ **뺀다.** 고지대 슬래브 + 그 위 건물 2채(solid 3개). 「왜 도시에서만
  //     잠기나」는 **풀밭(투수) ↔ 포장면(불투수) 대비**가 이미 설명하므로(조사
  //     §3F ④) 고지대 없이도 성립한다 — 그 대비가 원래 핵심이었다.
  //
  //   **물은 한 판으로 합쳐 전부 앞으로 당긴다**(종전 본체+앞막 2판 → **1판**).
  //   `renderer.js`가 `gl.disable(gl.DEPTH_TEST)`로 **중심 깊이 하나로** 정렬하므로,
  //   물이 전부 앞에 오려면 **물의 중심이 덮을 것들보다 카메라에 가까워야** 한다.
  //   ⇒ 물 z `0.10~Z`(중심 **0.260**) · 건물 z **0.22** · 차 z **0.25**.
  //     실측: 물을 가리는 물체 **0개** · 잠길 것 **전건 물이 덮음**.
  //   ⚠️ 종전에는 물을 쪼개 순서를 이겼다(3차 6조각·5차 2판). **쪼개는 것이 아니라
  //      다른 것을 뒤로 보내는 것**이 답이었다 — 조각을 늘리는 것은 원인을 늘린다.
  //
  //   solid **19 → 15** · 라벨 최대 5(단계별 [3,5,2,4]).
  //   ⚠️ 수면은 6차 값 그대로 `H(0.105)=0.042`다. 하한은 차의 창문선 0.034 —
  //      그 아래로 가면 침수 깊이의 자가 죽는다(조사 §Q3).
  //
  // ── 바닥은 **하나다** — 몸통의 윗면에 칠할 뿐 새 판을 얹지 않는다 ──────────
  // 🔴 **2026-08-19 클라이언트**: *"비교대상인 것은 한 레이어에 다 담겨 있지
  //   그래서 그림이 모식을 가리거나 **바닥이 여러 개가 나타나지도 않고**"*
  //
  //   「저 이상한 회색 바닥」은 7차에 뺀 고지대 슬래브 하나가 아니었다. **바닥
  //   노릇을 하는 것이 네 장**이었다 — 초록 띠(y 0~0.006) · 회색 포장면(0~0.008) ·
  //   물판(공중) · 그리고 `groundLayer()`의 진짜 지표면. 앞의 셋이 전부 **지표 위에
  //   뜬 별개 상자**라 화면에서 층이 겹쳐 보였다.
  //
  //   ⇒ 조사 정정 2의 문법으로 바꾼다: **몸통은 `groundLayer()` 하나**이고 나머지는
  //     그 **윗면에 칠한 얼룩**이다(바다 스트립이 이미 그 문법 — 두께 없이
  //     `y0 -0.014 · y1 0.002`로 몸통의 top face를 물고 있다).
  //     · **초록 띠를 지운다** — 투수면은 따로 그릴 것이 아니라 **몸통의 제 윗면**이다
  //       (`groundLayer()`의 `#c6dbb0` pattern 4 = 식생). 도시가 「몸통에서 자라
  //       나온다」는 것이 참조의 요점이고, 자연 지면을 한 겹 더 덮으면 그 뜻이 죽는다.
  //     · **포장면은 남되 얼룩이 된다** — 불투수면은 사람이 **덧칠한 것**이므로
  //       그리는 것이 옳다. 바다 스트립과 같은 y 구간으로 몸통에 박아 넣는다.
  //   ⇒ 바닥 노릇 4장 → **몸통 1개**. 지표 위로 뜬 수평판 **0장**.
  //   🔴 **3단계엔 이 면이 없다**(2026-08-20 클라이언트: *"물이 다 차서 회색 면은
  //     물로 비치지도 않아야 하는데 지금 계속 비치잖아"*). 포장면과 지표수는 **같은
  //     자리의 두 상태**이지 위아래로 겹치는 두 장이 아니다 — 겹쳐 두면 ⓐ 물이
  //     반투명이라 회색이 비치고, ⓑ 불투명하게 만들어도 **정렬이 뒤집힌다**
  //     (실측 nearness 포장 0.5227 > 물 0.5220 — 물을 깊이 전폭으로 넓히는 순간
  //     포장이 물보다 **나중에** 그려져 물을 덮는다).
  //   ⇒ 포장은 `until: 2`, 그 자리는 3단계에 물이 갖는다. 참조 문법 그대로
  //     **몸통 윗면의 겉모습이 바뀌는 것**이지 판이 하나 더 얹히는 것이 아니다.
  vol({ x0: 0.335, x1: 1.0, y0: -0.014, y1: 0.002, color: rgba('#a8a29e', 0.94), pattern: 2, at: 0, until: 2, layer: 'ground' }),
  // 도시 3채 — **몸통의 윗면에서 자라 나온다**(참조: 도시·나무가 지면에서 자란다).
  // ⓑ **잠긴 정도를 집집마다 다르게 한다**(참조 규약). 깊이를 읽게 하는 것은 물
  //   색이 아니라 **「지붕만 남은 집」과 「벽 절반인 집」이 함께 있는 것**이다.
  //   h 0.068·0.126·0.092에 수면 0.042를 대면 **62% · 33% · 46%** — 세 단계다.
  // 🔴 **0~2단계는 마른 채 온전히 서고, 3단계에 발치가 물빛에 잘린다.**
  //   같은 세 채를 **수면선에서 두 조각으로 갈라** 아래만 물들인다. 지붕 높이도
  //   윤곽도 그대로라 **「집이 작아진 것」이 아니라 「물에 잠긴 것」**으로 읽히고,
  //   물 상자가 건물 몸통을 침범할 일이 **원리적으로 없다** — 잠긴 부분은 건물 제
  //   자리에 건물의 조각으로 그려질 뿐이다.
  ...FLOOD_CITY.map((b) => building({ ...b, at: 0, until: 2 })),
  ...FLOOD_CITY.flatMap((b) => [
    building({ ...b, h: WATERLINE, at: 3, color: sunk(b.color) }),
    building({ ...b, h: b.h - WATERLINE, base: WATERLINE, at: 3 }),
  ]),
  // 지하 — 도시 침수가 「지하부터」인 이유(§3F: 벽·바닥으로 스미고 하수로 역류).
  // 🔴 **잠긴 것은 잘린 면 「안쪽」에 그린다**(조사 정정 2 — groundwater 패널의
  //   왼쪽 단면에 건물이 파란 포화대 **속에** 있다. 물 **앞**이 아니라 물 **속**).
  //   그래서 3단계에 물 상자를 따로 얹지 않고 **지하 칸 자체를 물빛으로 바꾼다** —
  //   상자를 겹치는 것이 아홉 판을 돌린 그 습관이다.
  vol({ x0: 0.525, x1: 0.575, y0: -0.050, y1: -0.002, color: rgba('#57534e', 0.94), z0: ZROW_BACK - 0.045, z1: ZROW_BACK + 0.045, at: 0, until: 2 }),
  vol({ x0: 0.525, x1: 0.575, y0: -0.050, y1: -0.002, color: rgba('#0284c7', 0.78), z0: ZROW_BACK - 0.045, z1: ZROW_BACK + 0.045, pattern: 3, at: 3 }),
  // 빗물받이 — 배수 용량의 화신. 2단계에서 삼키다 3단계에서 역류한다.
  // 3단계엔 수면(0.042) 한참 아래라 **물속**이다 ⇒ alpha를 낮춰 물이 비쳐 오르게 한다.
  vol({ x0: 0.580, x1: 0.620, y0: -0.044, y1: 0.007, color: rgba('#44403c', 0.96), z0: ZDRAIN - 0.009, z1: ZDRAIN + 0.009, at: 0, until: 2 }),
  vol({ x0: 0.580, x1: 0.620, y0: -0.044, y1: 0.007, color: sunk(rgba('#44403c', 0.96)), z0: ZDRAIN - 0.009, z1: ZDRAIN + 0.009, at: 3 }),
  // 🔴 **차는 뺐다**(2026-08-20 클라이언트 지시). 자 노릇은 위 `FLOOD_CITY`의
  //   **네 채가 저마다 다르게 잠긴 것**으로 넘겼다 — 사유는 그쪽 주석이 소유한다.
  //   `car()` 헬퍼도 함께 지웠다(호출자가 이 장면뿐이었다). 되살릴 일이 있으면
  //   `9e57928`에서 꺼낼 것.
  // 라벨 — `until`로 걷는다(3단계에 10개가 몰려 「난잡」 반려를 받았다).
  // 이 둘은 투수/불투수 **대비 쌍**이라 함께 뜨고 함께 걷힌다.
  label({ x: 0.27, y: H(0.30), text: V.greenGroundSoaks, color: '#3f6212', at: 0, until: 1, size: 9.5 }),
  label({ x: 0.64, y: H(0.78), text: V.cityImpervious, color: '#44403c', at: 0, until: 1, size: 9.5 }),

  // 0 — 유입. 두 층으로 나눠 「쉬지 않고」를 두께로 보인다(바다는 서쪽 0~0.2)
  ...flow({ from: [0.02, H(0.20), ZC], dir: [1, 0.10, 0], travel: 0.40, count: 3, color: rgba('#0d9488', 0.92), at: 0, until: 2, speed: 0.62, spreadZ: 0.15 }),
  ...flow({ from: [0.02, H(0.44), ZC], dir: [1, 0.14, 0], travel: 0.34, count: 2, scale: 0.046, color: rgba('#0d9488', 0.85), at: 0, until: 2, speed: 0.5, spreadZ: 0.12 }),
  label({ x: 0.20, y: H(0.62), text: V.vapourKeepsArriving, color: '#0f766e', at: 0, until: 1, size: 10 }),

  // 1 — **후방 생성**(조사 §3D). 상류(서)에서 작은 셀이 새로 생겨 자라며 동으로 가고
  //     하류에서 흩어진다 — **밴드 자체는 서 있다**는 것이 이 그림의 요점이다.
  puff({ x: 0.34, y: H(0.78), s: 0.8, color: rgba('#94a3b8', 0.68), at: 1 }),
  puff({ x: 0.50, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.88), at: 1 }),
  puff({ x: 0.66, y: H(0.90), s: 1.5, color: rgba('#94a3b8', 0.92), at: 1 }),
  puff({ x: 0.80, y: H(0.86), s: 1.2, color: rgba('#cbd5e1', 0.78), at: 1 }),
  ...flow({ from: [0.36, H(1.02), ZC], dir: [1, 0, 0], travel: 0.34, count: 2, scale: 0.042, color: rgba('#64748b', 0.85), at: 1, speed: 0.5, spreadZ: 0.1 }),
  label({ x: 0.23, y: H(1.02), text: V.newCellsUpwind, color: '#475569', at: 1, until: 2, size: 10 }),
  label({ x: 0.72, y: H(1.12), text: V.rainCloudRefills, color: '#475569', at: 1, until: 2, size: 10 }),

  // 2 — 비. 풀밭은 스며들고(아래로 짧은 화살표) 빗물받이는 아직 삼킨다
  // 🔴 **`until: 2` — 이 둘은 2단계에서 역할이 끝난다**(2026-08-20 실렌더 대조).
  //   종전엔 `until`이 없어 3단계까지 살아 **아래로 스미는 화살표 3개가 물 위를
  //   가리켰다.** 3단계 캡션은 *"땅이 스며들 수 있는 양을 넘겨"*이고 같은 단계에
  //   빗물받이 **역류**(위로 가는 화살표)를 그린다 — 그림이 캡션을, 그리고 제
  //   옆의 화살표를 **정면으로 부정하고** 있었다. 「역할 끝난 것은 `until`로
  //   걷는다」는 이 파일이 라벨에 이미 쓰던 규칙인데 화살표에만 안 걸려 있었다.
  precip({ x0: 0.24, x1: 0.98, y1: H(0.82), kind: 'rain', slant: 0.14, speed: 1.25, count: 34, at: 2 }),
  ...flow({ from: [0.275, H(0.10), ZC], dir: [0, -1, 0], travel: 0.06, count: 2, scale: 0.034, color: rgba('#15803d', 0.9), at: 2, until: 2, speed: 0.5, spreadZ: 0.1 }),
  ...flow({ from: [0.600, H(0.11), ZDRAIN], dir: [0, -1, 0], travel: 0.075, count: 1, scale: 0.038, color: rgba('#0369a1', 0.9), at: 2, until: 2, speed: 0.6 }),

  // 3 — **포화·배수 초과**(조사 §3C·§3F). 순서가 문법이다: 땅속이 차고 → 위에 고이고 →
  //     빗물받이가 역류하고 → 지하부터 잠기고 → 못 스민 물이 포장면을 타고 흐른다.
  // 땅속 포화대 — **몸통의 잘린 면에 칠한 층**이라 이것도 `ground`다. 물이 pass 2로
  // 내려온 이상 이 판이 `air`로 남으면 **물 위에 덧칠돼** 지표수의 색 계조를 뭉갠다
  // (alpha 0.34가 수면 전역을 균일하게 덮는다). z0을 0.10으로 당긴 것은 **그리는
  // 순서를 벌리기 위해서**다 — 실측 nearness 0.4550으로 지표면(0.4294)과
  // 포장(0.5227) 사이에 안전하게 앉는다(여유 0.026 / 0.068).
  // ⚠️ x는 0~1 전폭 그대로다. 3단계 라벨 `groundCannotAbsorb`가 x 0.20(풀밭 위)에
  //    있으므로, 포화를 도시 밑으로만 좁히면 **그림이 캡션과 어긋난다.**
  // 🔴 **앞 잘린 면에만 둔다 — z 0.40~Z**(2026-08-20 실렌더 대조).
  //   종전 z 0.10~Z는 몸통 깊이의 **4분의 3**이었고, `nearness` 0.4550이 몸통
  //   0.4294보다 커서 **몸통보다 나중에** 그려졌다. 땅속 층인데 **지표면 위로
  //   덧칠된** 것이다. 결과 둘, 둘 다 실렌더에서 확인했다:
  //     ⓐ **풀밭이 사라졌다.** 청록 0.34가 `#c6dbb0` 윗면을 뒤덮어, 남은 초록은
  //       이 판이 안 닿는 뒷줄 z 0~0.10 한 줄뿐이었다. 조사 §3F ④가 「왜 도시에서만
  //       잠기나」의 답으로 지목한 **투수↔불투수 대비**가 그림에서 죽어 있었다.
  //     ⓑ **앞 잘린 면에 수위선이 없었다.** 잘린 면 전체가 이 청록으로 균일하게
  //       덮여 「어디까지가 물인가」를 그을 자리가 없었다.
  //   ⇒ 깊이를 **앞 잘린 면 두께로만** 줄인다. 땅속 포화는 원래 **단면에서만 보이는
  //     것**이고(조사 정정 2: 잠긴 것은 잘린 면 「안쪽」에 그린다), 윗면에서 보일
  //     이유가 없다. 윗면으로 새는 것은 z 0.02 · 화면 0.7%다.
  //   실측 nearness 0.5680 — 흙(`#d6c9a8` 0.4168)보다 **나중**이라 잘린 면에서 흙을
  //     덮고, 지표수(얕음 0.5220)와는 y가 안 겹쳐(-0.066~-0.022 vs -0.018~0.002)
  //     서로 침범하지 않는다.
  vol({ x0: 0, x1: 1, y0: -0.066, y1: -0.022, z0: 0.40, z1: Z, color: rgba('#0ea5e9', 0.34), pattern: 3, at: 3, layer: 'ground' }),
  // (지하실 물은 **상자를 겹치지 않고** 지하 칸 자체를 물빛으로 바꿔 그린다 — 위 참조)
  // 🔴 **지표수는 몸통의 면이다 — `layer: 'ground'`**(2026-08-19 10차).
  //   조사 「정정 2」: *관례는 홍수를 「장면에 더한 물체」로 그리지 않고 「지면이라는
  //   몸통의 겉모습 변화」로 그린다.* 9차까지 물은 공중에 뜬 `air` 카드였고, 그래서
  //   **정렬 키 하나로 물과 도시의 앞뒤를 동시에 만족시킬 수 없었다**(정정 3:
  //   nearness = 0.549x + **0.358y** + 0.755z — 높은 것이 앞으로 오니 낮은 물은
  //   구조적으로 뒤로 밀린다. 뒷줄 건물 0.7176 > 물 0.4401 > 앞줄 건물 0.3999라
  //   **4차 증상(건물이 물을 가림)과 9차 증상(물이 건물을 가림)이 한 장면에 동시에**
  //   있었다). 카드가 열넷이면 어떤 순서를 골라도 한쪽은 틀린다.
  //
  //   ⇒ 답은 **정렬을 이기는 것이 아니라 정렬을 떠나는 것**이다. `ground`는
  //     `renderer.js:359`의 **pass 2**라 건물·차(`air`, pass 4)보다 **무조건 먼저**
  //     그려진다 — 정렬 결과와 무관하다. 그리고 같은 파일의 `groundLayer()` 바다
  //     스트립이 **이미 그 문법**이었다(두께 없음 · `layer: 'ground'`). 홍수 물만
  //     몸통을 떠나 있었다.
  //
  //   ⚠️ **대가**: `ground`는 `grow`가 항상 1이라(`renderer.js:270`) **「물이
  //     차오르는」 등장 애니메이션을 잃는다.** 받아들인다 — 아홉 판이 실패한 것은
  //     등장 연출이 아니라 정지 화면의 앞뒤였고, 바다 스트립도 같은 대가를 이미
  //     치르고 있다. `MAX_GROUND = 8` 예산은 아래 「바닥」 정리에서 함께 센다.
  //
  //   🔴 **그리고 물에서 두께를 뺀다.** 물의 윗면 y를 지표면(0)·포장면(0.002)·바다
  //   (0.002)와 **같은 높이**에 두면 넷이 **한 면 위의 색 차이**가 된다 — 종전
  //   `y1 = 0.042`는 그 면들보다 0.04 높은 **또 하나의 바닥**이었고, 클라이언트가
  //   4단계에서 센 「띠 3장」이 그것이다. 수위는 이제 물이 아니라 **물체에 그은 선**이
  //   갖는다(`WATERLINE` 참조).
  //
  //   ⓐ **깊이는 높이가 아니라 색 계조**(조사 정정 2). 두 장을 겹치되 **진한 쪽이
  //     반드시 나중에** 그려져야 한다. `ground`도 자기들끼리는 중심 깊이로
  //     정렬되므로(`renderer.js` rebuild) 그 순서는 좌표가 정한다.
  //     ⚠️ 이 대소가 뒤집히면 **계조가 사라지는 것이 아니라 반대로 뒤집힌다** —
  //        계약이 그 대소를 직접 문다(7-g).
  //   ⓑ 🔴 **진한 판을 「가운데 상자」에서 「동쪽 절반」으로 바꾼다**(2026-08-20
  //     실렌더 반려: *"깊이 계조가 **사각형 얼룩**으로 읽힌다 — 경계가 직선이라
  //     계조가 아니라 상자로 보인다"*).
  //     종전 진한 판(x 0.40~0.90 · z 0.22~Z)은 옅은 판(x 0.335~1.0 · z 0~Z)
  //     **안쪽에 동심으로 박힌 직사각형**이었다. 그래서 물 윗면에 제 경계선이
  //     **세 줄**(x=0.40 · x=0.90 · z=0.22) 생기고, 네 번째 변을 앞 잘린 면이
  //     막아 **닫힌 상자**가 됐다 — 얼룩의 정체가 그 세 줄이다.
  //     ⇒ 고칠 것은 색도 알파도 아니라 **어느 변을 옅은 판과 맞물리느냐**다.
  //       뒤(z 0)·앞(z Z)·동(x 1.0)을 **옅은 판과 같은 값으로 맞물린다** —
  //       맞물린 변에는 경계선이 **안 생긴다**(진한 물이 제 구역 끝까지 차서 물의
  //       원래 윤곽과 하나가 된다). 남는 경계는 **x=0.52 한 줄**뿐이다.
  //     ⚠️ **남길 한 줄은 반드시 깊이 방향(x 고정)이어야 한다.** z 고정 선을 남기면
  //       물 뒷변(z 0)·앞 잘린 면과 **나란한 세 번째 가로줄**이 되어 4단계에
  //       반려받은 「띠 3장」이 되살아난다. x 고정 선은 풀↔포장 경계(x 0.335)와만
  //       나란하고 화면에서는 우하향 사선이라 띠로 안 읽힌다.
  //     실측: 남은 경계선 x=0.52는 화면 (53.8,66.0)→(41.6,76.4)이고 그 **위쪽
  //       절반이 건물 0.55 실루엣(49.4~56.6 · 51.8~71.7)에 가려** 끊긴다 —
  //       그은 선이 아니라 물빛이 갈리는 자리로 읽힌다.
  //   ⓒ 그 대가로 **동쪽이 깊다**가 된다(종전 의도는 「가운데가 깊다」). 받아들이는
  //     이유 둘: 3단계 라벨 `runoffGathersLow`가 이미 **x 0.90(동쪽)**에서
  //     *"낮은 곳으로 모인다"*고 말하고 있어 그림이 그 말과 맞고, 정렬 키
  //     (nearness = 0.549x + 0.358y + 0.755z)가 **나중에 그릴 판을 동/앞으로만**
  //     허용하기 때문이다 — 서쪽을 진하게 하면 순서가 뒤집혀 계조가 거꾸로 선다.
  //     실측 nearness 여유 0.025 → **0.050**으로 오히려 두 배가 됐다.
  //   ⓓ 진한 쪽만 `y0`를 더 깊이(-0.026) 내린다. 윗면은 같은 높이라 화면에 턱이
  //     안 생긴다. ⚠️ 앞 잘린 면의 「두꺼워진 청록 층」은 **화면에서 0.5%**라
  //     깊이를 말하지 못한다(실측) — 계조를 지는 것은 색 하나다.
  //   ⓔ 🔴 **x0 0.335 → 0.2, 그리고 계조를 두 판에서 세 판으로**(2026-08-20
  //     클라이언트: *"범람한 물이 블록마냥 딱 잘려 있어 이상한데 다 채워줘"*).
  //     반려의 정체는 **직선 경계 두 줄**이다 — 물 서쪽 끝 x 0.335와 계조 경계
  //     x 0.52. 둘 다 등축 화면에서 우하향 사선으로 서서 「물이 블록으로 잘렸다」로
  //     읽혔다.
  //     ⇒ ⑴ **서쪽 끝을 0까지 밀어 지면 전역을 채운다.**
  //       ⚠️ 8차에 x0을 0.335로 올린 사유가 *"0.02는 바다에 붙어 **해일로 읽힌다**"*
  //         였다. 그 걱정의 전제가 **틀렸다**: 실렌더에서 몸통 윗면을 자홍으로, 바다
  //         스트립을 노랑으로 칠해 보니 **바다는 뒷줄 가장자리 실선 한 줄뿐**이었다.
  //         `groundLayer()`의 바다(nearness 0.2113)가 몸통(0.4294)보다 **먼저**
  //         그려져 몸통 윗면에 통째로 덮이기 때문이다. 즉 x 0~0.2는 화면에서
  //         **바다가 아니라 맨 지면**이었고, 클라이언트가 본 「블록으로 잘린 자리」의
  //         서쪽이 바로 그것이다. 붙을 바다가 없으니 해일로 읽힐 일도 없다.
  //       🔴 이 결함은 `groundLayer()` 소유라 **바다를 쓰는 장면 7종 전부**에 있다
  //         (특히 `tropical_cyclone_genesis`는 sea 0~1인데 화면은 풀밭이다).
  //         고치려면 몸통 윗면을 바다 구간에서 갈라야 하고 `MAX_GROUND` 예산이
  //         걸리므로 **여기서 손대지 않고 따로 올린다.**
  //         그리고 3단계 캡션이 *"땅이 스며들 수 있는 양을 넘겨"*이므로 **지면 전역이
  //         잠기는 것이 캡션과 맞다** — 투수/불투수 대비는 0~2단계가 소유한다.
  //     ⇒ ⑵ **계조를 3단으로.** 두 판이면 경계가 한 줄뿐이라 그 한 줄이 곧 「자른
  //       자리」로 보인다. 세 판이면 같은 폭에 단이 둘이라 **선이 아니라 계조**로
  //       읽힌다. 서쪽 끝은 셋이 서로 다르고, 나머지 세 변(동·앞·뒤)은 **전부 몸통
  //       변에 물려** 경계선을 만들지 않는다.
  //     (색은 아래 ⓕ가 소유한다 — 8차 값 `#0891b2`는 이제 물이 아니라
  //     `FLOOD_WATER`, 즉 **물체를 물들이는 색**이다.)
  //   ⓕ 🔴 **깊이 전폭 · 불투명**(2026-08-20 클라이언트 반려 2건).
  //     · *"회색 면이 뒤쪽에 왜 보여?"* — z0이 0.14였다. 깊이의 **3분의 1**(z 0~0.14)에
  //       물이 안 가서 뒤쪽에 마른 포장이 띠로 남았다. x1도 0.98이라 동쪽 끝이 비었다.
  //       그 값은 물이 `air`였을 때 **중심 깊이를 건물(z 0.22)보다 앞으로 당겨 정렬을
  //       이기려고** 넣은 것이다. 물을 `ground`(pass 2)로 내린 순간 그 제약은
  //       사라졌는데 값만 남았다 — **개선이 만든 유물**이다.
  //       ⇒ 몸통과 **같은 범위**(x 0.335~1.0 · z 0~Z)로 넓힌다. 이제 물은 정렬을
  //         이길 필요가 없다.
  //     · *"물로 비치지도 않아야 하는데 계속 비치잖아"* — alpha 0.42/0.72라 아래
  //       포장이 그대로 비쳤다. **불투명으로 올린다.** 잃는 것은 없다: 잠긴 물체의
  //       윤곽은 물의 투명도가 아니라 `sunk()`가 **물체 제 자리에 제 조각으로**
  //       그려서 살아 있고(§2⑴), 몸통의 격자선은 pass 3이라 물 **위에** 그어진다.
  //     · 알파를 뺀 만큼 계조는 **색이 진다**: 얕음 cyan-500 · 깊음 cyan-700.
  //       ⚠️ 「색은 8차 값(`#0891b2`) 그대로」는 여기서 낡았다 — `#0891b2`(cyan-600)는
  //         두 값 **사이**에 있고, 물체를 물들이는 `FLOOD_WATER`가 계속 그 값이라
  //         수면선 아래 조각이 얕은 물과 깊은 물 가운데에 앉는다.
  //     실측 nearness(= 0.5487x + 0.3584y + 0.7553z): 얕음 **0.5220** < 깊음 **0.5717**
  //       (여유 0.050) — 깊은 쪽이 나중이라 계조가 바로 선다. 3단계 `ground` 6장
  //       (심층 0.4168 → 몸통 0.4294 → 포화대 0.4550 → 얕음 → 깊음, 바다 0.2113)로
  //       `MAX_GROUND = 8` 안이다.
  //     실측 nearness(= 0.5487x + 0.3584y + 0.7553z) — 진할수록 나중이어야 한다:
  //       얕음 0.4850 < 중간 0.5530 < 깊음 0.6211. 밝기는 0.687 / 0.576 / 0.378.
  //   ⓖ 🔴 **서쪽 끝이 0 → 0.2 — 바다 스트립을 고친 대가다**(2026-08-20).
  //     `groundLayer()`가 바다 구간에서 지면 윗면을 갈라 내면서 이 장면의 육지
  //     조각이 x **0.2~1**이 됐다. 그러자 그 조각의 중심이 동쪽으로 밀려
  //     **정렬에서 물을 앞질렀다** — 실측 nearness 육지 0.4842 > 물(x 0~1) 0.4301.
  //     즉 **풀밭이 물 위에 덧칠**됐다(계약 7-G2가 잡았다).
  //     ⇒ 물의 x를 **육지 조각과 같게** 맞춘다. 중심이 같아지고 y가 조금 높아
  //       물이 **아슬하게 나중**이 된다 — 실측 여유 0.0007.
  //       ⚠️ 여유가 얇다. 좌표를 만지면 뒤집힌다. 뒤집히면 7-G2가 운다(실증).
  //     ⚠️ x 0~0.2는 이제 **바다**가 갖는다. 「다 채워줘」는 지켜진다 — 마른 지면이
  //       0이고 해안은 바다, 육지는 범람수다. 종전엔 그 자리가 **맨 지면**이었다.
  vol({ x0: 0.20, x1: 1.0, y0: -0.018, y1: 0.002, z0: 0, z1: Z,
    color: rgba('#22d3ee', 1), pattern: 3, at: 3, layer: 'ground' }),
  vol({ x0: 0.45, x1: 1.0, y0: -0.022, y1: 0.003, z0: 0, z1: Z,
    color: rgba('#06b6d4', 1), pattern: 3, at: 3, layer: 'ground' }),
  vol({ x0: 0.70, x1: 1.0, y0: -0.026, y1: 0.004, z0: 0, z1: Z,
    color: rgba('#0e7490', 1), pattern: 3, at: 3, layer: 'ground' }),
  // 빗물받이 역류 — 아래로 못 내려가니 위로 되올라온다
  ...flow({ from: [0.600, H(0.03), ZDRAIN], dir: [0, 1, 0], travel: 0.065, count: 2, scale: 0.04, color: rgba('#075985', 0.98), at: 3, speed: 0.7, spreadZ: 0.045 }),
  // 유출 — **포장면이 물살을 빠르게 한다**(§3F). 화살표는 수면 위에 둔다.
  // 🔴 **도시 동쪽 빈 구역으로 물린다**(2026-08-20 실렌더 반려: *"좌향 화살표
  //   하나가 가운데 높은 건물 면 위에 얹히고, 또 하나가 오른쪽 건물에 반쯤
  //   걸친다"*).
  //   원인은 **그리는 차례**다 — 화살표는 `renderer.js`의 **마지막 패스**라
  //   건물(pass 4)보다 무조건 나중이다. 라벨처럼 `until`로 걷을 수도 없다(3단계의
  //   결론이 이 화살표다). ⇒ 남는 수는 **비키는 것** 하나다.
  //   ⚠️ **왼쪽으로 갈수록 화면에서는 위로 오른다**(x가 줄면 좌상으로 간다) —
  //     지면 높이의 좌향 화살표는 길기만 하면 반드시 도시 실루엣으로 기어오른다.
  //     그래서 고친 것은 방향이 아니라 **출발점(0.90→0.98)과 길이(0.38→0.20)**다:
  //     x 0.78~0.98은 건물 동쪽 끝(0.703) 밖이라 실루엣이 없는 구역이다.
  //   ⚠️ z도 함께 얕게 민다(중심 0.21→0.12, 퍼짐 0.16→0.05). 깊은 z는 화면에서
  //     **좌하로** 내려와 도시와 다시 만난다 — 실측으로 z 0.24 이상은 건물 0.68에
  //     닿았다.
  //   실측(등거리 투영 · 화살표 글리프 실제 정점 · 경로 121점 전수):
  //     종전 3개 → 건물 0.55/0.68·차·빗물받이에 **겹침 총 187/243점**.
  //     지금 3개 → 도시 물체 5개 전부와 **겹침 0**, 최소 화면 여유 **3.0%**.
  ...flow({ from: [0.99, H(0.20), 0.12], dir: [-1, -0.05, 0], travel: 0.10, count: 3, scale: 0.046, color: rgba('#075985', 0.98), at: 3, speed: 0.9, spreadZ: 0.05 }),
  // 3단계 라벨 4개. `soilAlreadyFull`은 `groundCannotAbsorb`와 같은 사실의 두
  // 표현이고 그 뜻은 캡션 4번째 문장이 갖는다 — 지운 것이 아니라 캡션이 소유한다.
  label({ x: 0.20, y: H(0.40), text: V.groundCannotAbsorb, color: '#0c4a6e', at: 3, size: 10 }),
  label({ x: 0.73, y: H(0.34), text: V.drainOverwhelmed, color: '#075985', at: 3, size: 9.5 }),
  label({ x: 0.546, y: H(0.14), text: V.basementFloods, color: '#0c4a6e', at: 3, size: 9.5 }),
  label({ x: 0.90, y: H(0.60), text: V.runoffGathersLow, color: '#0369a1', at: 3, size: 10 }),
];

// ── ㉣ 변동 기상요소 3종(2026-08-18) ────────────────────────────────────────
// 규칙만 들어오고 장면이 없어 `buildScene`이 null → GL이 SVG로 폴백하고 있었다.
// 계약 테스트 2종(STORYBOARDS 1:1 · 규칙 전건 커버)이 그것을 잡는다.
// 단계 인덱스는 SVG 스토리보드와 **같은 메커니즘 순서**를 공유해야 한다.

/** cold_front_squall_storm: 지면 가열 → 전선이 밀어 올림 → 바람 시어 → 조직된 폭우 */
const coldFrontSquallStorm = () => [
  bb({ x: 0.86, y: H(1.0), z: 0.06, w: 0.17, h: 0.17, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  vol({ x0: 0.3, x1: 1, y1: H(0.14), color: rgba('#fdba74', 0.34), at: 0 }),
  ...flow({ from: [0.62, H(0.04), ZC], dir: [-0.1, 1, 0], travel: 0.2, count: 3, color: rgba('#ea580c', 0.9), at: 0, speed: 0.5 }),
  // ⚠️ `until: 2` 추가. 실측 겹침(2026-08-19): 3단계 `organizedStorm`(H(0.16))과
  //    **세로 1.9** 겹쳤다. 좌표를 옮기는 대신 걷은 이유 — **지면 가열은 0단계의
  //    일이고 3단계에서는 역할이 끝났다.** 「역할 끝난 라벨은 `until`로 걷는다」.
  label({ x: 0.6, y: H(0.24), text: V.groundHeating, color: '#c2410c', at: 0, until: 2, size: 10 }),

  wedge({ x0: 0, x1: 0.34, tx0: 0.0, tx1: 0.1, y1: H(0.62), color: COLD_FILL, at: 1 }),
  frontSlab({ xb: 0.34, xt: 0.1, y1: H(0.62), color: COLD_EDGE, at: 1 }),
  label({ x: 0.14, y: H(0.34), text: V.coldAir, color: COLD_TXT, at: 1 }),
  ...flow({ from: [0.4, H(0.06), ZC], dir: [0.5, 1, 0], travel: 0.3, count: 3, color: rgba('#dc2626', 0.9), at: 1, speed: 0.58 }),
  label({ x: 0.6, y: H(0.5), text: V.warmHumidAir, color: WARM_TXT, at: 1, size: 10 }),

  // 시어 — 위는 길고 동쪽으로, 아래는 짧고 서쪽으로. 두 화살표가 **같이** 보여야
  // 「차이」로 읽히므로 한 단계에 묶는다.
  ...flow({ from: [0.34, H(0.92), ZC], dir: [1, 0, 0], travel: 0.4, count: 2, color: rgba('#7c3aed', 0.9), at: 2, speed: 0.7 }),
  ...flow({ from: [0.74, H(0.22), ZC], dir: [-1, 0, 0], travel: 0.18, count: 2, scale: 0.04, color: rgba('#7c3aed', 0.85), at: 2, speed: 0.35 }),
  label({ x: 0.7, y: H(1.02), text: V.windShear, color: '#6d28d9', at: 2, size: 10 }),

  ...cbTower({ x: 0.56, top: H(1.0), at: 3 }),
  // ⚠️ y H(1.06) → H(1.22). 실측 겹침(2026-08-19): 2단계 `windShear`(H(1.02))와
  //    붙어 있었다. 적란운은 위로 뻗는 구름이라 더 높이 두는 것이 뜻에도 맞다.
  label({ x: 0.74, y: H(1.22), text: V.cumulonimbus, at: 3, size: 10 }),
  precip({ x0: 0.44, x1: 0.7, y1: H(0.72), slant: 0.32, speed: 1.75, count: 34, at: 3 }),
  label({ x: 0.56, y: H(0.16), text: V.organizedStorm, color: '#1e3a8a', at: 3, size: 10 }),
];

/** siberian_gale_wildfire: 찬 건조 기단 → 산 넘는 바람 → 일사로 더 마름 → 불씨 확산 */
const siberianGaleWildfire = () => [
  vol({ x0: 0, x1: 0.42, y1: H(0.56), color: rgba('#bfdbfe', 0.55), at: 0 }),
  label({ x: 0.16, y: H(0.34), text: V.siberianCp, color: COLD_TXT, at: 0, size: 10 }),
  label({ x: 0.16, y: H(0.2), text: V.coldDry, color: COLD_TXT, at: 0, size: 10 }),

  wedge({ x0: 0.4, x1: 0.6, tx0: 0.49, tx1: 0.51, y1: H(0.44), color: rgba('#a8a29e', 0.8), at: 1 }),
  label({ x: 0.5, y: H(0.52), text: V.mountainRange, color: '#57534e', at: 1, size: 9 }),
  ...flow({ from: [0.14, H(0.34), ZC], dir: [1, 0.1, 0], travel: 0.26, count: 3, color: rgba('#0e7490', 0.9), at: 1, speed: 0.7, spreadY: 0.02 }),
  ...flow({ from: [0.6, H(0.4), ZC], dir: [1, -0.5, 0], travel: 0.3, count: 3, color: rgba('#c2410c', 0.9), at: 1, speed: 0.85, spreadY: 0.02 }),
  label({ x: 0.84, y: H(0.34), text: V.dryWarmWind, color: '#c2410c', at: 1, size: 10 }),
  bb({ x: 0.5, y: 0.004, w: 0.86, h: 0.1, color: rgba('#ca8a04', 0.42), kind: 3, at: 1 }),
  label({ x: 0.5, y: H(0.1), text: V.driedLeavesTwigs, color: '#92400e', at: 1, size: 10 }),

  bb({ x: 0.88, y: H(1.0), z: 0.06, w: 0.17, h: 0.17, color: rgba('#f59e0b', 0.95), kind: 2, at: 2 }),
  ...flow({ from: [0.84, H(0.78), ZC], dir: [-0.25, -1, 0], travel: 0.3, count: 3, scale: 0.04, color: rgba('#f59e0b', 0.9), at: 2, speed: 0.5 }),
  label({ x: 0.8, y: H(0.9), text: V.strongSun, color: '#b45309', at: 2, size: 10 }),

  bb({ x: 0.6, y: H(0.12), w: 0.13, h: 0.22, color: rgba('#ea580c', 0.9), kind: 2, at: 3 }),
  bb({ x: 0.6, y: H(0.08), w: 0.07, h: 0.13, color: rgba('#fbbf24', 0.95), kind: 2, at: 3 }),
  ...flow({ from: [0.54, H(0.3), ZC], dir: [-1, 0.42, 0], travel: 0.32, count: 3, scale: 0.03, color: rgba('#f97316', 0.95), at: 3, speed: 0.95, spreadZ: 0.1 }),
  label({ x: 0.3, y: H(0.62), text: V.embersRideWind, color: '#c2410c', at: 3, size: 10 }),
  label({ x: 0.5, y: H(1.06), text: V.clearSkyWildfire, color: '#b45309', at: 3, size: 11 }),
];

/** front_convergence_flood: 정체 → 습기 유입 → 햇볕 차단 → 물 고임 */
const frontConvergenceFlood = () => [
  // 🔴 **2026-08-19: 정체전선과 **같은 결함 셋**이 여기에도 있었다.**
  //   일반 규칙(「전선면은 경사면이다」)을 계약으로 세우다 실측으로 발견했다 —
  //   이 장면의 전선면 shear가 **0.020**(거의 수직)이었다. 전선 4종 중 나머지는
  //   -0.440 · -0.340 · +0.640 · -0.240으로 전부 기울어 있었다.
  //   ⓐ 두 기단이 같은 높이(H(0.56)) ⓑ 따뜻한 쐐기가 위로 **좁아짐** ⓒ 전선면 수직.
  //   정체전선에 적용한 정정을 그대로 적용한다(사유의 소유자는 그쪽 주석이다).
  wedge({ x0: 0, x1: 0.52, tx0: 0.0, tx1: 0.10, y1: H(0.40), color: COLD_FILL, at: 0 }),
  wedge({ x0: 0.44, x1: 1, tx0: 0.12, tx1: 1.0, y1: H(0.72), color: rgba('#fca5a5', 0.38), at: 0 }),
  frontSlab({ xb: 0.48, xt: 0.14, y1: H(0.72), color: rgba('#7c3aed', 0.46), at: 0, thick: 0.026 }),
  label({ x: 0.5, y: H(0.8), text: V.stationaryFront, color: '#6d28d9', at: 0, size: 10 }),

  ...flow({ from: [0.06, H(0.24), ZC], dir: [1, 0.1, 0], travel: 0.4, count: 3, color: rgba('#0d9488', 0.92), at: 1, speed: 0.62, spreadZ: 0.14 }),
  label({ x: 0.26, y: H(0.5), text: V.vapourKeepsArriving, color: '#0f766e', at: 1, size: 10 }),

  ...layerBand({ x0: 0.14, x1: 0.9, y: H(0.68), at: 2, n: 4 }),
  label({ x: 0.5, y: H(0.94), text: V.cloudBlocksSun, color: '#475569', at: 2, size: 10 }),

  precip({ x0: 0.2, x1: 0.5, y1: H(0.64), slant: 0.06, speed: 0.85, count: 26, at: 3 }),
  precip({ x0: 0.52, x1: 0.84, y1: H(0.64), slant: 0.06, speed: 0.85, count: 26, at: 3 }),
  bb({ x: 0.5, y: 0.004, w: 0.94, h: 0.12, color: rgba('#38bdf8', 0.55), kind: 3, at: 3 }),
  label({ x: 0.5, y: H(0.18), text: V.groundCannotAbsorb, color: '#0c4a6e', at: 3, size: 10 }),
];

/** tropical_cyclone_genesis: 바다 가열 → 잠열 방출 → 약한 시어로 조직 → 눈벽 */
const tropicalCycloneGenesis = () => [
  bb({ x: 0.12, y: H(1.0), z: 0.06, w: 0.17, h: 0.17, color: rgba('#f59e0b', 0.95), kind: 2, at: 0 }),
  vol({ x0: 0, x1: 1, y1: H(0.2), color: rgba('#fca5a5', 0.3), at: 0 }),
  ...flow({ from: [0.5, H(0.04), ZC], dir: [0, 1, 0], travel: 0.24, count: 3, color: rgba('#dc2626', 0.9), at: 0, speed: 0.5 }),
  label({ x: 0.3, y: H(0.3), text: V.warmHumidAir, color: WARM_TXT, at: 0, size: 10 }),

  ...[0.44, 0.56].map((x) => puff({ x, y: H(0.6), s: 1.2, at: 1 })),
  label({ x: 0.78, y: H(0.4), text: V.latentHeatFuel, color: '#b91c1c', at: 1, size: 10 }),

  // 시어가 **작다** = 위아래 화살표가 같은 쪽으로 나란하다(squall과 반대 문법).
  ...flow({ from: [0.34, H(1.0), ZC], dir: [1, 0, 0], travel: 0.26, count: 2, color: rgba('#7c3aed', 0.85), at: 2, speed: 0.5 }),
  ...flow({ from: [0.34, H(0.7), ZC], dir: [1, 0, 0], travel: 0.24, count: 2, color: rgba('#7c3aed', 0.85), at: 2, speed: 0.5 }),
  label({ x: 0.5, y: H(1.1), text: V.lowShearColumn, color: '#6d28d9', at: 2, size: 10 }),

  ...cbTower({ x: 0.38, top: H(0.96), at: 3 }),
  ...cbTower({ x: 0.64, top: H(0.92), at: 3 }),
  precip({ x0: 0.32, x1: 0.72, y1: H(0.7), slant: 0.28, speed: 1.6, count: 30, at: 3 }),
  label({ x: 0.8, y: H(0.2), text: V.eyewallStrongest, color: '#b91c1c', at: 3, size: 10 }),
];

/** greenhouse_tropical_night: 낮 축열 → 장파 방출 → 수증기가 되돌림 → 안 식는 밤 */
const greenhouseTropicalNight = () => [
  bb({ x: 0.5, y: 0.004, w: 0.94, h: 0.12, color: rgba('#f97316', 0.5), kind: 3, at: 0 }),
  label({ x: 0.5, y: H(0.14), text: V.heatAccumulates, color: '#fed7aa', at: 0, size: 10 }),

  ...flow({ from: [0.3, H(0.1), ZC], dir: [0, 1, 0], travel: 0.24, count: 2, color: rgba('#fb923c', 0.9), at: 1, speed: 0.45 }),
  ...flow({ from: [0.7, H(0.1), ZC], dir: [0, 1, 0], travel: 0.24, count: 2, color: rgba('#fb923c', 0.9), at: 1, speed: 0.45 }),
  label({ x: 0.5, y: H(0.56), text: V.groundEmitsLongwave, color: '#fdba74', at: 1, size: 10 }),

  vol({ x0: 0, x1: 1, y0: H(0.34), y1: H(0.62), color: rgba('#38bdf8', 0.2), at: 2 }),
  ...flow({ from: [0.34, H(0.56), ZC], dir: [-0.2, -1, 0], travel: 0.3, count: 2, color: rgba('#fb923c', 0.9), at: 2, speed: 0.5 }),
  ...flow({ from: [0.68, H(0.56), ZC], dir: [0.2, -1, 0], travel: 0.3, count: 2, color: rgba('#fb923c', 0.9), at: 2, speed: 0.5 }),
  label({ x: 0.5, y: H(0.74), text: V.longwaveTrapped, color: '#7dd3fc', at: 2, size: 10 }),

  label({ x: 0.5, y: H(1.06), text: V.noWindNoMixing, color: '#fca5a5', at: 3, size: 10 }),
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
  cold_front_squall_storm: { build: coldFrontSquallStorm },
  siberian_gale_wildfire: { build: siberianGaleWildfire },
  front_convergence_flood: { build: frontConvergenceFlood, sea: { from: 0, to: 0.18 } },
  tropical_cyclone_genesis: { build: tropicalCycloneGenesis, sea: { from: 0, to: 1 } },
  greenhouse_tropical_night: { build: greenhouseTropicalNight, night: true },
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

/**
 * overlayScene — 보드 상태 → 오버레이 장면 기술(순수) (R10-01 S3 §3.3).
 *
 * GL도 DOM도 모르는 순수 모듈이다. PeninsulaMap이 WebGL 경로와 SVG/Canvas2D
 * 폴백 경로 **양쪽에서** 이 매핑을 쓴다 — 그래서 두 경로가 같은 장면을 그린다
 * (구름 변형·강수 에미터 박스가 한쪽만 바뀌는 드리프트 방지).
 *
 * 좌표는 전부 지도 SVG userSpace(boardLayout의 VIEW_W×VIEW_H = 100×80).
 * 이 파일은 좌표를 **재계산하지 않는다** — 호출측이 toUser로 사영한 존 좌표를
 * zonePoints로 넘겨준다(boardLayout 동결 계약을 우회하지 않기 위함).
 */

// ── 현상 → 표현 매핑 (SVG 경로와 공유) ───────────────────────────────────────
/**
 * cloudVariantFor — 현상/구름 → 지도 구름 변형(R9-08 §A).
 * (웨이브 0까지 PeninsulaMap 내부 함수였다. WebGL 경로도 같은 판단이 필요해
 *  단일 소유자로 승격 — 로직 변경 없음.)
 */
export function cloudVariantFor(v) {
  if (!v) return null;
  if (v.phenomenon === 'fog') return 'fog';
  if (v.phenomenon === 'snow') return 'snowcloud';
  if (v.cloud === 'cumulonimbus') return 'cumulonimbus';
  if (v.cloud === 'nimbostratus') return 'nimbostratus';
  if (v.cloud === 'stratus') return 'stratus';
  if (v.rule_id && v.cloud === 'cumulus') return 'cumulus';
  return null; // 기본 흐림(규칙 미성립)은 노드 아이콘만
}

/** 현상 → 강수 에미터 메타(weight=입자 배분, slant=사선 강도). 값 불변. */
export const PRECIP_META = {
  shower: { kind: 'rain', weight: 2, slant: 1.4 },
  persistent_rain: { kind: 'rain', weight: 2, slant: 0.7 },
  rain: { kind: 'rain', weight: 1, slant: 0.9 },
  snow: { kind: 'snow', weight: 1 },
  // R13 재난 축(CO-A3·CO-K4): 침수는 「비가 그치지 않는 상태」다 — 지도에 비층운만
  // 뜨고 비가 안 내리면 그 존만 그림이 멈춰 보인다. persistent_rain보다 촘촘하게.
  // (산불은 cloud=none이라 강수·구름이 없고 노드 아이콘 🔥만 뜨는 것이 옳다)
  flood_risk: { kind: 'rain', weight: 3, slant: 0.6 },
};

/** 강수 에미터 박스(userSpace) — 존 중심 기준 14×12 박스. SVG 경로와 동일 수치. */
export const EMITTER_BOX = { dx: -7, dy: -4, w: 14, h: 12 };

/**
 * precipEmitters — 강수 현상이 있는 존의 userSpace 에미터 박스 목록.
 * precipEngine(동결)이 그대로 먹는 {x,y,w,h,kind,weight,slant} 형태다.
 * Canvas2D 폴백은 여기서 컨테이너 분율(fx/fy/fw/fh)로 나눠 쓴다.
 */
export function precipEmitters(zoneVisuals, zonePoints) {
  const out = [];
  (zonePoints ?? []).forEach((pt, zone) => {
    const meta = PRECIP_META[zoneVisuals?.[zone]?.phenomenon];
    if (!meta || !pt) return;
    out.push({
      x: pt[0] + EMITTER_BOX.dx,
      y: pt[1] + EMITTER_BOX.dy,
      w: EMITTER_BOX.w,
      h: EMITTER_BOX.h,
      ...meta,
    });
  });
  return out;
}

// ── ① 기단 색 번짐 ──────────────────────────────────────────────────────────
// 색은 realisticEffects의 radialGradient(wm-bloom-*) 중심색과 같은 계열 —
// WebGL로 올려도 인포그래픽 색 문법이 바뀌지 않게.
export const BLOOM_META = {
  siberian: { color: [0.231, 0.510, 0.965], peak: 0.5 }, // #3b82f6
  okhotsk: { color: [0.031, 0.569, 0.698], peak: 0.48 }, // #0891b2
  north_pacific: { color: [0.918, 0.345, 0.047], peak: 0.48 }, // #ea580c
  yangtze: { color: [0.851, 0.467, 0.024], peak: 0.45 }, // #d97706
};
/** SVG AirMassBloom의 r=22와 동일 */
export const BLOOM_RADIUS = 22;

// ── ③ 유동 흐름장 ───────────────────────────────────────────────────────────
// 기단별 유입 방향(지리 관례) — mapInfographic FLOW_META와 같은 값.
// 동결 계약 파일에서 export되지 않아 여기 사본을 둔다(값 변경 금지 대상).
export const FLOW_META = {
  siberian: { from: [-30, -26], bend: 0.22, color: [0.231, 0.510, 0.965] },
  okhotsk: { from: [30, -24], bend: -0.22, color: [0.031, 0.569, 0.698] },
  north_pacific: { from: [26, 32], bend: 0.24, color: [0.976, 0.451, 0.086] },
  yangtze: { from: [-32, 24], bend: -0.2, color: [0.961, 0.620, 0.043] },
};

// ── ④ 터뷸런스 구름 ─────────────────────────────────────────────────────────
// rx·ry = 구름 덩어리 반경(userSpace), dy = 존 중심 대비 수직 오프셋,
// bright = 몸체 밝기, tall = 수직 발달 정도, alpha = 최대 불투명도.
// SVG RealCloudMass의 ellipse 묶음이 차지하던 범위와 대체로 일치시킨다.
export const CLOUD_SHAPES = {
  cumulonimbus: { rx: 9, ry: 8, dy: -8, bright: 0.82, tall: 1.0, alpha: 0.95 },
  nimbostratus: { rx: 10.5, ry: 4.2, dy: -7, bright: 0.72, tall: 0.35, alpha: 0.9 },
  snowcloud: { rx: 9.5, ry: 4, dy: -7, bright: 0.88, tall: 0.3, alpha: 0.88 },
  stratus: { rx: 11, ry: 3.2, dy: -7, bright: 0.9, tall: 0.15, alpha: 0.8 },
  fog: { rx: 13, ry: 3.4, dy: 2.5, bright: 0.98, tall: 0.0, alpha: 0.75 },
  cumulus: { rx: 5, ry: 2.8, dy: -7, bright: 0.96, tall: 0.5, alpha: 0.85 },
};

/**
 * buildScene — 보드 상태에서 오버레이 4요소를 뽑는다(순수).
 * @param board        {elements:[{type,subtype,zone}]}
 * @param zoneVisuals  존별 {phenomenon, cloud, rule_id} | null
 * @param zonePoints   존별 userSpace 좌표 [[x,y], ...] (호출측이 toUser로 사영)
 * @returns {blooms, flows, clouds, emitters} — 전부 userSpace
 */
export function buildScene({ board, zoneVisuals, zonePoints } = {}) {
  const points = zonePoints ?? [];
  const blooms = [];
  const flows = [];

  for (const el of board?.elements ?? []) {
    if (el?.type !== 'air_mass') continue;
    const pt = points[el.zone];
    if (!pt) continue;
    const bloom = BLOOM_META[el.subtype];
    if (bloom) {
      blooms.push({
        x: pt[0],
        y: pt[1],
        r: BLOOM_RADIUS,
        color: bloom.color,
        peak: bloom.peak,
        seed: el.zone * 1.7 + 0.3,
      });
    }
    const flow = FLOW_META[el.subtype];
    if (flow) {
      const [ox, oy] = flow.from;
      // SVG FlowArrow와 같은 시작·끝점(존 바깥 → 존 근처 22%)
      flows.push({
        x1: pt[0] + ox,
        y1: pt[1] + oy,
        x2: pt[0] + ox * 0.22,
        y2: pt[1] + oy * 0.22,
        bend: flow.bend,
        w0: 6,
        w1: 2,
        color: flow.color,
      });
    }
  }

  const clouds = [];
  points.forEach((pt, zone) => {
    const v = zoneVisuals?.[zone];
    if (!v || !pt) return;
    const variant = cloudVariantFor(v);
    const shape = variant ? CLOUD_SHAPES[variant] : null;
    if (!shape) return;
    clouds.push({
      x: pt[0],
      y: pt[1] + shape.dy,
      rx: shape.rx,
      ry: shape.ry,
      bright: shape.bright,
      tall: shape.tall,
      alpha: shape.alpha,
      seed: zone * 3.1 + 0.7,
    });
  });

  return { blooms, flows, clouds, emitters: precipEmitters(zoneVisuals, points) };
}

/** 그릴 것이 하나라도 있는지 — 없으면 컨텍스트를 아예 만들지 않는다 */
export function sceneIsEmpty(scene) {
  if (!scene) return true;
  return (
    scene.blooms.length === 0 &&
    scene.flows.length === 0 &&
    scene.clouds.length === 0 &&
    scene.emitters.length === 0
  );
}

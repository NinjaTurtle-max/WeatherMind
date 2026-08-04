/**
 * mapInfographic — 기상청 인포그래픽 일기도 문법 레이어 (R9-08 §A, 기준 이미지 하.png).
 *
 * 하.png 문법 4요소를 절차적 SVG로 구현한다:
 *  ① 기단·기압계 = 방사형 그라디언트 색 번짐(온난 주황 / 한랭 파랑) → AirMassBloom
 *  ② 전선 = 지도를 가로지르는 곡선 경로 + 표준 기호(삼각/반원) 반복 배치 → FrontCurve
 *     (배치된 존들을 잇는 스플라인, 존 1개면 그 존을 지나는 지역 스케일 사선 곡선)
 *  ③ 넓은 곡선 유동 화살표(공기 유입 — 그라디언트 채움 + 흐름 애니메이션) → FlowArrow
 *  ④ 현상 주석 라벨(리더선 + 짧은 설명) → ZoneAnnotation
 *
 * 좌표는 PeninsulaMap userSpace(100×80). 판정 로직 불변 — 표현 전용 레이어.
 * 기하 헬퍼(frontCurveGeometry·taperedArrowPath)는 순수 함수로 export — 테스트 가능.
 */
import { anim } from './realisticEffects';

// ── 기하 헬퍼 (순수) ────────────────────────────────────────────────────────
/** Catmull-Rom 스플라인 위 점 (p0~p3 제어, t∈[0,1] — p1→p2 구간) */
function crPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * frontCurveGeometry — 전선 곡선 경로 + 기호 배치점 계산.
 * @param points 전선이 지나야 하는 존 좌표들 [{x,y}] (1개 이상)
 * @param extend 양끝 연장 길이(지역 스케일 — 지도 밖까지 뻗는다)
 * @param spacing 기호 간격(호 길이)
 * @returns {d, samples:[{x,y,a}]} d=path, samples=기호 위치·접선각(도)
 */
export function frontCurveGeometry(points, { extend = 26, spacing = 9 } = {}) {
  let pts = (points ?? []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return { d: '', samples: [] };
  // 존 1개 — 그 존을 지나는 남서→북동 사선(하.png 정체전선 방향 관례)
  if (pts.length === 1) {
    const { x, y } = pts[0];
    pts = [
      { x: x - extend, y: y + extend * 0.42 },
      { x, y },
      { x: x + extend, y: y - extend * 0.42 },
    ];
  } else {
    pts = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    // 양끝을 끝 구간 방향으로 연장(지도 가로지름)
    const first = pts[0];
    const second = pts[1];
    const last = pts[pts.length - 1];
    const beforeLast = pts[pts.length - 2];
    const ext = (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: to.x + (dx / len) * extend, y: to.y + (dy / len) * extend };
    };
    pts = [ext(second, first), ...pts, ext(beforeLast, last)];
  }

  // Catmull-Rom 조밀 샘플링 → 경로 d + 호 길이 등간격 기호점
  const dense = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const steps = 14;
    for (let s = i === 0 ? 0 : 1; s <= steps; s += 1) {
      dense.push(crPoint(p0, p1, p2, p3, s / steps));
    }
  }
  const d = dense.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const samples = [];
  let acc = 0;
  let next = spacing * 0.7; // 시작 여백
  for (let i = 1; i < dense.length; i += 1) {
    const a = dense[i - 1];
    const b = dense[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (acc + seg >= next) {
      const t = (next - acc) / (seg || 1);
      samples.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      });
      next += spacing;
    }
    acc += seg;
  }
  return { d, samples };
}

/**
 * taperedArrowPath — 넓은 곡선 유동 화살표(꼬리 넓고 머리로 갈수록 좁아지는
 * 2차 베지어 리본 + 삼각 머리). 하.png의 공기 유입 화살표 문법.
 * @returns {body, head, line} body=리본 path d, head=화살촉 d, line=중심선 d(흐름 대시용)
 */
export function taperedArrowPath(x1, y1, x2, y2, { bend = 0.35, w0 = 5, w1 = 1.8 } = {}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * len * bend;
  const cy = my + ny * len * bend;

  const N = 14;
  const centre = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const a = 1 - t;
    centre.push({
      x: a * a * x1 + 2 * a * t * cx + t * t * x2,
      y: a * a * y1 + 2 * a * t * cy + t * t * y2,
      // 접선
      tx: 2 * a * (cx - x1) + 2 * t * (x2 - cx),
      ty: 2 * a * (cy - y1) + 2 * t * (y2 - cy),
    });
  }
  const left = [];
  const right = [];
  centre.forEach((p, i) => {
    const t = i / N;
    const w = (w0 + (w1 - w0) * t) / 2;
    const tl = Math.hypot(p.tx, p.ty) || 1;
    const px = -p.ty / tl;
    const py = p.tx / tl;
    left.push({ x: p.x + px * w, y: p.y + py * w });
    right.push({ x: p.x - px * w, y: p.y - py * w });
  });
  const fmt = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const body = `M${fmt(left[0])} ${left.slice(1).map((p) => `L${fmt(p)}`).join(' ')} ${right.reverse().map((p) => `L${fmt(p)}`).join(' ')} Z`;

  // 화살촉 — 끝점 접선 방향 삼각형
  const end = centre[N];
  const tl = Math.hypot(end.tx, end.ty) || 1;
  const ux = end.tx / tl;
  const uy = end.ty / tl;
  const px = -uy;
  const py = ux;
  const hw = w1 * 2.4;
  const hl = w1 * 3.4;
  const head = `M${(end.x + ux * hl).toFixed(2)},${(end.y + uy * hl).toFixed(2)} L${(end.x + px * hw).toFixed(2)},${(end.y + py * hw).toFixed(2)} L${(end.x - px * hw).toFixed(2)},${(end.y - py * hw).toFixed(2)} Z`;

  const line = `M${x1.toFixed(2)},${y1.toFixed(2)} Q${cx.toFixed(2)},${cy.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  return { body, head, line };
}

// ── ① 기단 색 번짐 ──────────────────────────────────────────────────────────
const BLOOM_META = {
  siberian: { grad: 'wm-bloom-cold' },
  okhotsk: { grad: 'wm-bloom-cool' },
  north_pacific: { grad: 'wm-bloom-warm' },
  yangtze: { grad: 'wm-bloom-warmdry' },
};

/** AirMassBloom — 기단 배치 존의 방사형 색 번짐(은은한 확산 맥동) */
export function AirMassBloom({ subtype, x, y, animate = true }) {
  const meta = BLOOM_META[subtype];
  if (!meta) return null;
  return (
    <circle
      cx={x}
      cy={y}
      r="22"
      fill={`url(#${meta.grad})`}
      className={anim(animate, 'animate-tint-spread')}
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    />
  );
}

// ── ② 전선 곡선 ─────────────────────────────────────────────────────────────
const FRONT_COLORS = { cold: '#2563eb', warm: '#dc2626' };

/** 전선 기호 1개 — 접선각에 맞춰 회전. cold=채운 삼각(진행 방향), warm=채운 반원 */
export function FrontTick({ x, y, a, kind, flip = false, s = 2.4 }) {
  const shape = kind === 'cold'
    ? `M${-s},0 L${s},0 L0,${-s * 1.25} Z`
    : `M${-s},0 A${s},${s} 0 0 1 ${s},0 Z`;
  return (
    <path
      d={shape}
      transform={`translate(${x} ${y}) rotate(${a + (flip ? 180 : 0)})`}
      fill={FRONT_COLORS[kind]}
    />
  );
}

/**
 * FrontCurve — 배치 존들을 잇는 전선 곡선 + 표준 기호 반복 배치.
 * stationary는 삼각/반원을 선 반대편에 교대로(표준 표기), 선도 빨강/파랑 교대 대시.
 */
export function FrontCurve({ subtype, points, animate = true }) {
  const { d, samples } = frontCurveGeometry(points);
  if (!d) return null;
  const stationary = subtype === 'stationary';
  const color = stationary ? FRONT_COLORS.warm : FRONT_COLORS[subtype] ?? '#475569';
  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }} className={anim(animate, 'animate-front-breathe')}>
      {/* 본선 — 정체전선은 빨강 바탕 + 파랑 교대 대시로 2색 표기 */}
      <path d={d} fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.95" />
      {stationary && (
        <path d={d} fill="none" stroke={FRONT_COLORS.cold} strokeWidth="1.1" strokeLinecap="round" strokeDasharray="7 7" opacity="0.95" />
      )}
      {samples.map((p, i) => {
        if (stationary) {
          // 교대: 온난 반원(위쪽) ↔ 한랭 삼각(아래쪽 — flip)
          return i % 2 === 0
            ? <FrontTick key={i} {...p} kind="warm" />
            : <FrontTick key={i} {...p} kind="cold" flip />;
        }
        return <FrontTick key={i} {...p} kind={subtype} />;
      })}
    </g>
  );
}

// ── ③ 곡선 유동 화살표 ──────────────────────────────────────────────────────
// 기단별 유입 방향(지리 관례): cP=북서, mP(오호츠크)=북동, mT=남동, cT=남서
const FLOW_META = {
  siberian: { from: [-30, -26], bend: 0.22, color: '#3b82f6', label: '한랭 건조한 공기 남하' },
  okhotsk: { from: [30, -24], bend: -0.22, color: '#0891b2', label: '차고 습한 공기 유입' },
  north_pacific: { from: [26, 32], bend: 0.24, color: '#f97316', label: '고온 다습한 공기 유입' },
  yangtze: { from: [-32, 24], bend: -0.2, color: '#f59e0b', label: '따뜻하고 건조한 공기 유입' },
};

/**
 * FlowArrow — 기단 유입을 나타내는 넓은 곡선 화살표(그라디언트 리본 +
 * 중심선 흐름 대시 애니메이션). 존 좌표(x,y)로 향한다.
 */
export function FlowArrow({ subtype, x, y, animate = true }) {
  const meta = FLOW_META[subtype];
  if (!meta) return null;
  const [ox, oy] = meta.from;
  const { body, head, line } = taperedArrowPath(x + ox, y + oy, x + ox * 0.22, y + oy * 0.22, {
    bend: meta.bend,
    w0: 6,
    w1: 2,
  });
  const gradId = `wm-flow-${subtype}`;
  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={x + ox} y1={y + oy} x2={x + ox * 0.22} y2={y + oy * 0.22}>
        <stop offset="0%" stopColor={meta.color} stopOpacity="0.08" />
        <stop offset="100%" stopColor={meta.color} stopOpacity="0.5" />
      </linearGradient>
      <path d={body} fill={`url(#${gradId})`} />
      <path d={head} fill={meta.color} opacity="0.65" />
      {/* 흐름 애니메이션 — 중심선 대시가 진행 방향으로 흐른다 */}
      <path
        d={line}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.7"
        strokeLinecap="round"
        strokeDasharray="2.5 5"
        opacity="0.7"
        className={animate ? 'animate-flow-dash' : ''}
      />
    </g>
  );
}

// ── ④ 현상 주석 라벨 ────────────────────────────────────────────────────────
/** 규칙 8종 → 인포그래픽 주석 문구(하.png "정체전선 형성, 집중호우 발생" 문법 — 자체 저작) */
// ⚠️ i18n 외부화 제외(R11-01 §6.3 판정): rule_id 파생 과학 콘텐츠 클러스터
// (STORYBOARDS·scenes.js 라벨과 한 묶음)이고 boardVisual.render.test가
// '소나기·번개' 문구를 렌더 HTML에서 직접 대조한다.
export const RULE_ANNOTATIONS = {
  cold_front_shower: '한랭전선 통과,\n소나기·번개',
  stationary_front_monsoon: '정체전선 형성,\n집중호우 발생',
  warm_front_steady_rain: '온난전선 접근,\n넓은 지역 약한 비',
  siberian_snow: '기단 변질,\n서해안 폭설',
  convective_shower: '강한 일사,\n오후 대류성 소나기',
  radiation_fog: '복사냉각,\n새벽 짙은 안개',
  north_pacific_heatwave: '고온 다습 공기,\n폭염 지속',
  siberian_clear: '한랭 건조 공기,\n맑고 추움',
};

/**
 * ZoneAnnotation — 리더선 + 짧은 설명 라벨. 존 x에 따라 좌/우로 뻗는다.
 */
export function ZoneAnnotation({ x, y, ruleId, animate = true }) {
  const text = RULE_ANNOTATIONS[ruleId];
  if (!text) return null;
  const lines = text.split('\n');
  const toRight = x < 50;
  const lx = toRight ? Math.min(x + 20, 78) : Math.max(x - 20, 22);
  const ly = Math.max(y - 14, 8);
  const wMax = Math.max(...lines.map((l) => l.length));
  const boxW = wMax * 3.3 + 4;
  const boxH = lines.length * 4.6 + 2.6;
  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }} className={anim(animate, 'animate-annot-in')}>
      <path
        d={`M${x},${y - 6} L${lx},${ly + boxH / 2}`}
        fill="none"
        stroke="#64748b"
        strokeWidth="0.4"
        strokeDasharray="1.4 1"
      />
      <rect
        x={lx - boxW / 2}
        y={ly}
        width={boxW}
        height={boxH}
        rx="1.6"
        fill="#ffffff"
        opacity="0.92"
        stroke="#cbd5e1"
        strokeWidth="0.3"
      />
      {lines.map((l, i) => (
        <text
          key={i}
          x={lx}
          y={ly + 3.6 + i * 4.6}
          textAnchor="middle"
          fontSize="3.1"
          fontWeight="700"
          fill="#334155"
        >
          {l}
        </text>
      ))}
    </g>
  );
}

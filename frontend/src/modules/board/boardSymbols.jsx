/**
 * boardSymbols — 표준 일기도 표기 SVG 심볼 레지스트리 (R9-01 §3.3 ②).
 *
 * boardDisplay.js의 이모지 매핑을 대체하는 자체 제작 SVG 컴포넌트 레지스트리.
 * 외부 라이브러리·에셋 금지(CSP) — 인라인 SVG만 사용한다.
 *
 * 표기 원칙(표준 일기도 관례):
 *  - 한랭전선: 파란 밴드 + 진행 방향 채운 삼각 톱니
 *  - 온난전선: 빨간 밴드 + 채운 반원
 *  - 정체전선: 파랑/빨강 교대(삼각·반원 반대편)
 *  - 기단: 원 + 한랭(파랑 계열)/온난(빨강 계열) 색 + 기단 약어(cP·mP·mT·cT)
 *  - 현상: 비/소나기/장마/눈/안개/폭염/맑음/흐림 + 재난 7종 아이콘
 *
 * ── 재난 7종의 표기 문법 (2026-08-20 저작) ───────────────────────────────────
 * 이 7종은 종전에 `EMOJI_FALLBACK`으로 그려졌고 계약이 면제로 등재하고 있었다
 * (`tests/displayLayerParity.contract.test.mjs` KNOWN_GAPS). 저작하면서 **한 눈에
 * 갈리는 것**을 예쁜 것보다 앞에 뒀다 — 두 현상이 비슷해 보이면 실패다.
 *
 *  · **주의보(`_risk`) ↔ 경보(`_warning`)는 같은 그림 + 배지로 가른다.** 같은
 *    재난이므로 **다른 그림을 주면 학습자가 다른 사건으로 읽는다.** 경보급에만
 *    `AlertBadge`(빨간 삼각형)를 오른쪽 위에 얹어 「같은 재난, 더 높은 등급」으로
 *    읽히게 한다. 삼각형 안에 `!`를 넣지 않는다 — 20px(`h-5 w-5` 칩)과 지도
 *    `scale 0.4`에서 뭉개지고, 채운 삼각형만으로 이미 경고로 읽힌다.
 *  · **홍수는 「채운 면」, 안개는 「가는 선」.** 둘 다 물결이라 겹칠 뻔했다 —
 *    물을 불투명 면으로 칠하고 잠긴 건물을 세워 갈랐다.
 *  · **번개는 15종 중 `severe_storm`에만 있다.** 소나기(어두운 구름 + 사선 비)와
 *    갈리는 유일한 단서가 그것이다.
 *  · **밤은 초승달로 말한다.** `tropical_night`은 열기 물결을 `heatwave`와 공유하는데
 *    (같은 「더위」 축이라 옳다), 위가 광선 달린 해냐 초승달이냐로 갈린다.
 *
 * 교체 지점 단일화: 렌더러는 이 파일의 <Glyph>(SVG userSpace용)나
 * <SymbolIcon>(HTML 컨텍스트용)만 쓴다. 레지스트리에 없는 값은 boardDisplay의
 * 이모지로 폴백한다(구 계약 enum 하위 호환).
 *
 * 모든 심볼은 중심 원점 기준 24×24 박스(-12..12)에 저작한다.
 */
import { AIR_MASS_META, FRONT_META, PHENOMENON_META, CLOUD_META } from './boardDisplay';

// ── 색 팔레트 (tailwind 계열 고정값 — SVG attr는 클래스 대신 명시색) ──────────
const C = {
  cold: '#2563eb', // blue-600
  coldBg: '#dbeafe', // blue-100
  coldWet: '#0891b2', // cyan-600
  coldWetBg: '#cffafe', // cyan-100
  warm: '#dc2626', // red-600
  warmBg: '#fee2e2', // red-100
  warmDry: '#ea580c', // orange-600
  warmDryBg: '#ffedd5', // orange-100
  cloud: '#94a3b8', // slate-400
  cloudDark: '#64748b', // slate-500
  cloudLight: '#cbd5e1', // slate-300
  rain: '#0ea5e9', // sky-500
  snow: '#7dd3fc', // sky-300
  sun: '#f59e0b', // amber-500
  heat: '#f97316', // orange-500
  fog: '#94a3b8',
  // ── 재난 7종 전용 (2026-08-20) ────────────────────────────────────────────
  alert: '#dc2626', // red-600 — 경보 배지. warm과 같은 값이지만 뜻이 달라 이름을 나눈다
  flood: '#0369a1', // sky-700 — 불어난 물의 앞면(rain보다 어두워 「깊다」로 읽힌다)
  bolt: '#facc15', // yellow-400 — 번개
  night: '#475569', // slate-600 — 초승달
  ground: '#166534', // green-800 — 불타는 산의 지면
};

// ── 공용 프리미티브 ──────────────────────────────────────────────────────────
/** 뭉게구름 실루엣 (원 3개 + 밑판) — fill 단색, 심 없음 */
export function CloudShape({ fill = C.cloud, y = -3, scale = 1, opacity = 1 }) {
  return (
    <g transform={`translate(0 ${y}) scale(${scale})`} opacity={opacity}>
      <circle cx="-4.5" cy="0.5" r="3.8" fill={fill} />
      <circle cx="0.5" cy="-2.2" r="4.8" fill={fill} />
      <circle cx="5" cy="0.8" r="3.4" fill={fill} />
      <rect x="-7.5" y="0" width="14.5" height="4" rx="2" fill={fill} />
    </g>
  );
}

/**
 * 해 — 코어 원 + 광선 + **부드러운 후광 두 겹**.
 *
 * ⚠️ **후광은 `filter`(feGaussianBlur)가 아니라 반투명 원이다.** 블러 필터는
 * `<defs>`에 id가 필요한데 이 컴포넌트는 한 화면에 여러 번(단면도 한 장에만
 * 최대 3개) 그려지고 인스턴스마다 `fill`이 다르다 — id를 공유하면 색이 하나로
 * 묶이고, 인스턴스마다 발급하면 SSR/클라이언트 id가 갈려 하이드레이션이 어긋난다.
 * 반투명 원 두 겹은 id도 필터도 없이 같은 「번지는」 인상을 준다.
 *
 * 2026-08-18 사용자 지시("이 해 모양을 더 부드럽게"). 종전에는 굵은 광선 8개가
 * 코어에서 뾰족하게 뻗어 **톱니바퀴처럼** 보였다. 바꾼 것 셋:
 *   · 광선 8 → 12개(촘촘할수록 별보다 빛무리로 읽힌다)
 *   · 굵기 1.4 → 1.05 · 길이 계수 0.78배 · 불투명도 0.82
 *   · 후광 2겹(코어 가까이 진하게, 광선 끝까지 옅게)
 * 실루엣은 그대로라 작은 아이콘(`ClearSymbol`, scale 1)에서도 해로 읽힌다.
 */
export function SunShape({ fill = C.sun, r = 4, ray = 2.6, scale = 1, x = 0, y = 0 }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  const len = ray * 0.78;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {/* 바깥 후광 — 광선 끝을 덮어 뾰족함을 지운다 */}
      <circle r={r + 1 + len} fill={fill} opacity="0.1" />
      {/* 안쪽 후광 — 코어에서 번지는 밝기 */}
      <circle r={r + 1.4} fill={fill} opacity="0.2" />
      {rays.map((deg) => (
        <line
          key={deg}
          x1="0"
          y1={-(r + 1)}
          x2="0"
          y2={-(r + 1 + len)}
          stroke={fill}
          strokeWidth="1.05"
          strokeLinecap="round"
          opacity="0.82"
          transform={`rotate(${deg})`}
        />
      ))}
      <circle r={r} fill={fill} />
    </g>
  );
}

/** 빗줄기(선) 묶음 — slant(도)·length·stroke 조절 */
export function RainStrokes({ count = 3, y = 4, length = 5, gap = 4.4, slant = 0, color = C.rain, width = 1.3, opacity = 1 }) {
  const x0 = -((count - 1) * gap) / 2;
  const dx = Math.tan((slant * Math.PI) / 180) * length;
  return (
    <g opacity={opacity}>
      {Array.from({ length: count }, (_, i) => (
        <line
          key={i}
          x1={x0 + i * gap}
          y1={y}
          x2={x0 + i * gap - dx}
          y2={y + length}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

/** 눈송이(6방 애스터리스크) */
export function SnowFlake({ x = 0, y = 0, r = 1.8, color = C.snow, width = 0.8 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 60, 120].map((deg) => (
        <line
          key={deg}
          x1={-r}
          y1="0"
          x2={r}
          y2="0"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          transform={`rotate(${deg})`}
        />
      ))}
    </g>
  );
}

/** 안개/열기 물결 가로선 */
export function WaveLine({ y = 0, width = 16, color = C.fog, strokeWidth = 1.4, opacity = 1 }) {
  const h = width / 2;
  const q = width / 4;
  return (
    <path
      d={`M${-h},${y} q${q / 2},-1.6 ${q},0 t${q},0 t${q},0 t${q},0`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      opacity={opacity}
    />
  );
}

// ── 전선 심볼 (표준 표기: 밴드 + 톱니/반원) ─────────────────────────────────
/** 한랭전선 — 파란 밴드 + 채운 삼각 톱니(진행 방향 위) */
function ColdFrontSymbol() {
  return (
    <g>
      <line x1="-10" y1="2.5" x2="10" y2="2.5" stroke={C.cold} strokeWidth="1.8" strokeLinecap="round" />
      {[-6, 0, 6].map((x) => (
        <path key={x} d={`M${x - 2.3},2.5 L${x + 2.3},2.5 L${x},-2.6 Z`} fill={C.cold} />
      ))}
    </g>
  );
}

/** 온난전선 — 빨간 밴드 + 채운 반원 */
function WarmFrontSymbol() {
  return (
    <g>
      <line x1="-10" y1="2.5" x2="10" y2="2.5" stroke={C.warm} strokeWidth="1.8" strokeLinecap="round" />
      {[-6, 0, 6].map((x) => (
        <path key={x} d={`M${x - 2.4},2.5 A2.4,2.4 0 0 1 ${x + 2.4},2.5 Z`} fill={C.warm} />
      ))}
    </g>
  );
}

/** 정체전선 — 파랑/빨강 교대 밴드, 반원(위)·삼각(아래) 반대편 */
function StationaryFrontSymbol() {
  return (
    <g>
      <line x1="-10" y1="0" x2="0" y2="0" stroke={C.warm} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="0" y1="0" x2="10" y2="0" stroke={C.cold} strokeWidth="1.8" strokeLinecap="round" />
      {/* 온난 반원 위쪽 */}
      <path d={`M${-7.4},0 A2.4,2.4 0 0 1 ${-2.6},0 Z`} fill={C.warm} />
      {/* 한랭 삼각 아래쪽 */}
      <path d="M2.6,0 L7.4,0 L5,5 Z" fill={C.cold} />
    </g>
  );
}

// ── 기단 심볼 (원 + 색 + 약어) ──────────────────────────────────────────────
// 약어는 기단 분류 관례: c(대륙성)/m(해양성) + P(한대)/T(열대)
const AIR_MASS_SVG_META = {
  siberian: { code: 'cP', color: C.cold, bg: C.coldBg },
  okhotsk: { code: 'mP', color: C.coldWet, bg: C.coldWetBg },
  north_pacific: { code: 'mT', color: C.warm, bg: C.warmBg },
  yangtze: { code: 'cT', color: C.warmDry, bg: C.warmDryBg },
};

function AirMassSymbol({ subtype }) {
  const m = AIR_MASS_SVG_META[subtype];
  if (!m) return null;
  return (
    <g>
      <circle r="9" fill={m.bg} stroke={m.color} strokeWidth="1.4" />
      <text
        y="0.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="8.5"
        fontWeight="800"
        fill={m.color}
        style={{ pointerEvents: 'none' }}
      >
        {m.code}
      </text>
    </g>
  );
}

// ── 현상 아이콘 ─────────────────────────────────────────────────────────────
function ShowerSymbol() {
  // 적란운(어두운 구름) + 굵은 사선 소나기
  return (
    <g>
      <CloudShape fill={C.cloudDark} y="-4.5" scale="0.95" />
      <RainStrokes count={3} y={3.5} length={5.5} slant={18} width={1.6} />
    </g>
  );
}

function RainSymbol() {
  return (
    <g>
      <CloudShape fill={C.cloud} y="-4.5" scale="0.95" />
      <RainStrokes count={3} y={3.5} length={4.6} width={1.2} />
    </g>
  );
}

function PersistentRainSymbol() {
  // 장마 — 넓은 구름 + 촘촘한 빗줄기
  return (
    <g>
      <CloudShape fill={C.cloudDark} y="-4.5" scale="1.05" />
      <RainStrokes count={4} y={3.2} length={5.8} gap={3.6} width={1.2} />
    </g>
  );
}

function SnowSymbol() {
  return (
    <g>
      <CloudShape fill={C.cloudLight} y="-4.5" scale="0.95" />
      <SnowFlake x={-4} y={5} />
      <SnowFlake x={0.5} y={8} />
      <SnowFlake x={5} y={5} />
    </g>
  );
}

function FogSymbol() {
  return (
    <g>
      <WaveLine y={-4.5} width={15} />
      <WaveLine y={0} width={18} />
      <WaveLine y={4.5} width={15} />
    </g>
  );
}

function HeatwaveSymbol() {
  return (
    <g>
      <SunShape fill={C.heat} y={-3.5} scale={0.9} />
      <WaveLine y={6.5} width={13} color={C.heat} strokeWidth={1.2} />
      <WaveLine y={9.5} width={13} color={C.heat} strokeWidth={1.2} opacity={0.6} />
    </g>
  );
}

function ClearSymbol() {
  return <SunShape />;
}

function CloudySymbol() {
  return (
    <g>
      <CloudShape fill={C.cloudLight} y="-1" scale="0.8" />
      <CloudShape fill={C.cloud} y="2.5" scale="1" />
    </g>
  );
}

// ── 재난 아이콘 (파일 머리말 「재난 7종의 표기 문법」이 이 절의 설계다) ──────
/**
 * 경보 배지 — 오른쪽 위 채운 빨간 삼각형.
 *
 * `_risk`(주의보)와 `_warning`(경보)은 **같은 재난**이므로 밑그림을 공유하고
 * 등급만 이것으로 가른다. 안에 `!`를 넣지 않는다 — h-5(20px)와 지도 scale 0.4에서
 * 뭉개진다. 흰 테두리는 뒤 그림 위에 얹혔을 때 실루엣이 묻히지 않게 한다.
 */
function AlertBadge() {
  return (
    <path
      d="M7.3,-11.0 L11.2,-4.6 L3.4,-4.6 Z"
      fill={C.alert}
      stroke="#ffffff"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  );
}

/** 불꽃 — 바깥 주황 + 안쪽 노랑 심 */
function FlameShape({ x = 0, y = 0, scale = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path
        d="M0,-9.4 C4.4,-4.8 6.6,-2.0 6.6,1.2 C6.6,5.2 3.6,8.0 0,8.0 C-3.6,8.0 -6.6,5.2 -6.6,1.2 C-6.6,-1.6 -4.8,-3.8 -2.6,-6.6 C-2.2,-3.8 -1.0,-2.6 0.3,-2.2 C0.7,-4.6 0.5,-7.0 0,-9.4 Z"
        fill={C.warmDry}
      />
      <path
        d="M0,-1.4 C2.3,1.0 3.2,2.6 3.2,4.0 C3.2,6.0 1.7,7.2 0,7.2 C-1.7,7.2 -3.2,6.0 -3.2,4.0 C-3.2,2.4 -1.6,1.0 0,-1.4 Z"
        fill={C.sun}
      />
    </g>
  );
}

/** 산불 — 불꽃 + 초록 지면(「산」이 타는 것임을 말한다) */
function WildfireShape() {
  return (
    <g>
      <FlameShape y={-1.4} scale={1.02} />
      <path d="M-9.5,10.4 L-5.6,5.4 L-2.4,10.4 Z" fill={C.ground} opacity="0.85" />
      <path d="M2.6,10.4 L6.2,5.8 L9.5,10.4 Z" fill={C.ground} opacity="0.85" />
      <line x1="-10.5" y1="10.6" x2="10.5" y2="10.6" stroke={C.ground} strokeWidth="1.6" strokeLinecap="round" />
    </g>
  );
}

/**
 * 홍수 — **불투명하게 채운 물의 면** + 잠긴 건물.
 * 안개(`FogSymbol`)도 물결이라 실루엣이 겹칠 뻔했다. 안개는 「가는 선」,
 * 홍수는 「채운 면」으로 갈랐다.
 */
function FloodShape() {
  return (
    <g>
      <rect x="-7.0" y="-9.5" width="7.2" height="14" fill={C.cloudDark} />
      <rect x="1.4" y="-3.4" width="5.4" height="7.9" fill={C.cloud} />
      <rect x="-5.6" y="-7.8" width="2.0" height="2.0" fill="#ffffff" />
      <rect x="-2.4" y="-7.8" width="2.0" height="2.0" fill="#ffffff" />
      <rect x="-5.6" y="-4.2" width="2.0" height="2.0" fill="#ffffff" />
      <path d="M-11,0.8 q2.75,-2.0 5.5,0 t5.5,0 t5.5,0 t5.5,0 L11,11 L-11,11 Z" fill={C.rain} />
      <path d="M-11,4.6 q2.75,-2.0 5.5,0 t5.5,0 t5.5,0 t5.5,0 L11,11 L-11,11 Z" fill={C.flood} />
    </g>
  );
}

/**
 * 호우·강풍(`severe_storm`) — 어두운 구름 + 사선 비 + **번개**.
 * 번개는 15종 가운데 여기에만 있다. 소나기(`ShowerSymbol`)와 갈리는 유일한 단서다.
 */
function SevereStormSymbol() {
  return (
    <g>
      <CloudShape fill={C.cloudDark} y="-5" scale="1" />
      <RainStrokes count={2} y={3.4} length={5.4} gap={11.5} slant={18} width={1.5} />
      {/* 빗줄기와 겹치지 않게 폭을 좁히고 상자 안(-12..12)에 들어오게 줄였다 */}
      <g transform="translate(0 -0.6) scale(0.88)">
        <path
          d="M1.6,0.6 L-3.8,0.6 L-1.0,5.2 L-3.6,5.2 L2.6,11.4 L0.4,6.4 L3.2,6.4 Z"
          fill={C.bolt}
          stroke={C.warmDry}
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

/**
 * 태풍 — 두 팔 소용돌이 + 가운데 눈.
 * 기단 심볼(원 + 약어)과 실루엣이 겹치지 않도록 **채운 원을 쓰지 않는다.**
 */
function TyphoonSymbol() {
  return (
    <g transform="scale(0.9)" fill="none" stroke={C.cold} strokeLinecap="round">
      {[0, 180].map((deg) => (
        <path
          key={deg}
          d="M0,-2.8 A5.6,5.6 0 0 1 6.4,2.4 A9.4,9.4 0 0 1 -1.2,10.2"
          strokeWidth="2.4"
          transform={`rotate(${deg})`}
        />
      ))}
      <circle r="1.9" strokeWidth="1.6" />
    </g>
  );
}

/**
 * 열대야 — 초승달 + 열기 물결.
 * 물결은 `HeatwaveSymbol`과 **일부러 공유한다**(같은 「더위」 축이라 그것이 옳다).
 * 갈리는 곳은 위다 — 광선 달린 해냐, 초승달이냐.
 */
function TropicalNightSymbol() {
  return (
    <g>
      <g transform="translate(0 0.8)">
        <path
          d="M-2.06,-11.66 A6.5,6.5 0 1 0 5.73,-2.43 A6.3,6.3 0 0 1 -2.06,-11.66 Z"
          fill={C.night}
        />
      </g>
      <WaveLine y={6.5} width={13} color={C.heat} strokeWidth={1.2} />
      <WaveLine y={9.5} width={13} color={C.heat} strokeWidth={1.2} opacity={0.6} />
    </g>
  );
}

function WildfireRiskSymbol() {
  return <WildfireShape />;
}

function WildfireWarningSymbol() {
  return (
    <g>
      <WildfireShape />
      <AlertBadge />
    </g>
  );
}

function FloodRiskSymbol() {
  return <FloodShape />;
}

function FloodWarningSymbol() {
  return (
    <g>
      <FloodShape />
      <AlertBadge />
    </g>
  );
}

// ── 구름(판정 출력 cloud enum) 아이콘 ───────────────────────────────────────
function CumulonimbusSymbol() {
  // 키 큰 적란운 — 모루(윗면 평평) + 수직 발달
  return (
    <g>
      <rect x="-8" y="-10" width="16" height="3" rx="1.5" fill={C.cloudDark} />
      <circle cx="-2" cy="-5" r="4.5" fill={C.cloudDark} />
      <circle cx="3.5" cy="-3" r="3.8" fill={C.cloudDark} />
      <CloudShape fill={C.cloudDark} y="4" scale="0.95" />
    </g>
  );
}

function NimbostratusSymbol() {
  // 낮고 두꺼운 비층운 — 어두운 층 2겹
  return (
    <g>
      <rect x="-9" y="-6" width="18" height="5" rx="2.5" fill={C.cloud} />
      <rect x="-10" y="0.5" width="20" height="5.5" rx="2.75" fill={C.cloudDark} />
    </g>
  );
}

function StratusSymbol() {
  // 얇게 깔린 층운
  return (
    <g>
      <rect x="-9" y="-5" width="18" height="3.4" rx="1.7" fill={C.cloudLight} />
      <rect x="-10" y="-0.5" width="20" height="3.4" rx="1.7" fill={C.cloud} />
      <rect x="-8" y="4" width="16" height="3.4" rx="1.7" fill={C.cloudLight} />
    </g>
  );
}

function CumulusSymbol() {
  return <CloudShape fill="#e2e8f0" y="0" scale="1.05" />;
}

function NoCloudSymbol() {
  return <SunShape r={3.4} ray={2.2} />;
}

// ── 레지스트리 ──────────────────────────────────────────────────────────────
const REGISTRY = {
  front: {
    cold: ColdFrontSymbol,
    warm: WarmFrontSymbol,
    stationary: StationaryFrontSymbol,
  },
  air_mass: {
    siberian: () => <AirMassSymbol subtype="siberian" />,
    north_pacific: () => <AirMassSymbol subtype="north_pacific" />,
    yangtze: () => <AirMassSymbol subtype="yangtze" />,
    okhotsk: () => <AirMassSymbol subtype="okhotsk" />,
  },
  phenomenon: {
    shower: ShowerSymbol,
    rain: RainSymbol,
    persistent_rain: PersistentRainSymbol,
    snow: SnowSymbol,
    fog: FogSymbol,
    heatwave: HeatwaveSymbol,
    clear: ClearSymbol,
    cloudy: CloudySymbol,
    // 재난 7종 (2026-08-20 저작 — 종전 EMOJI_FALLBACK)
    wildfire_risk: WildfireRiskSymbol,
    wildfire_warning: WildfireWarningSymbol,
    flood_risk: FloodRiskSymbol,
    flood_warning: FloodWarningSymbol,
    severe_storm: SevereStormSymbol,
    typhoon: TyphoonSymbol,
    tropical_night: TropicalNightSymbol,
  },
  cloud: {
    cumulonimbus: CumulonimbusSymbol,
    nimbostratus: NimbostratusSymbol,
    stratus: StratusSymbol,
    cumulus: CumulusSymbol,
    none: NoCloudSymbol,
  },
};

// 이모지 폴백 소스 (boardDisplay 매핑 — 구 enum 하위 호환)
const EMOJI_FALLBACK = {
  front: (v) => FRONT_META[v]?.icon ?? '➰',
  air_mass: (v) => AIR_MASS_META[v]?.icon ?? '🌀',
  phenomenon: (v) => PHENOMENON_META[v]?.icon ?? '❔',
  cloud: (v) => CLOUD_META[v]?.icon ?? '❔',
};

/** 레지스트리에 SVG 심볼이 있는지 */
export function hasSymbol(kind, value) {
  return Boolean(REGISTRY[kind]?.[value]);
}

/**
 * Glyph — 이미 열린 SVG 안(userSpace)에서 쓰는 심볼.
 * 24×24(-12..12) 박스 저작물을 (x,y) 이동·scale 배율로 놓는다.
 * 레지스트리에 없으면 이모지 <text> 폴백.
 */
export function Glyph({ kind, value, x = 0, y = 0, scale = 1 }) {
  const Sym = REGISTRY[kind]?.[value];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {Sym ? (
        <Sym />
      ) : (
        <text y="4.5" textAnchor="middle" fontSize="13">
          {EMOJI_FALLBACK[kind]?.(value) ?? '❔'}
        </text>
      )}
    </g>
  );
}

/**
 * SymbolIcon — HTML 컨텍스트(팔레트 칩·요약 카드 등)용 단독 <svg> 심볼.
 * 크기는 className(w-* h-*)으로 제어. 레지스트리에 없으면 이모지 <span> 폴백.
 */
export function SymbolIcon({ kind, value, className = 'h-5 w-5', label = null }) {
  if (!hasSymbol(kind, value)) {
    return (
      <span className={className.includes('text') ? className : undefined} aria-hidden={label ? undefined : 'true'} aria-label={label ?? undefined}>
        {EMOJI_FALLBACK[kind]?.(value) ?? '❔'}
      </span>
    );
  }
  return (
    <svg
      viewBox="-12 -12 24 24"
      className={`inline-block shrink-0 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <Glyph kind={kind} value={value} />
    </svg>
  );
}

/**
 * CrossSectionPanel — 판정 시 단면 모식도 애니메이션 패널 (R9-08 §B, 기준 이미지 중.png).
 *
 * 교과서 3D 블록 다이어그램 문법: 투명한 공기 상자 + 바닥 지면 평면(지도 시점)
 * + 전면 수직 단면. 규칙 8종(board_rules.json)마다 explain을 실제 메커니즘 순서로
 * 분해한 스토리보드(3~4단계, 단계당 1.4s 순차 재생 + 캡션)를 자체 저작했다.
 * 과학적 정확성 최우선 — 각 단계가 실제 기상 메커니즘 순서와 일치한다.
 *
 * - 재생/일시정지/단계 이동 컨트롤, 단계 점프 도트
 * - prefers-reduced-motion: 최종 단계 정지 화면 + 전체 단계 텍스트 목록
 * - rule_id 미등록(규칙 드리프트) 폴백: explain 캡션만 표시(애니메이션 없음)
 * - 서버 계약 불변: 입력은 존 판정 {zone, zone_name, phenomenon, cloud, rule_id, explain}
 *
 * 좌표계: viewBox 260×150.
 *  fp(fx,h) = 전면 단면 평면(fx 0~1 가로, h 0~1 고도) / gp(fx,z) = 지면 평면(z 0~1 깊이)
 */
import { useEffect, useState } from 'react';
import { phenomenonMeta, cloudMeta } from './boardDisplay';
import { SymbolIcon, SunShape, SnowFlake, WaveLine } from './boardSymbols';
import { anim, usePrefersReducedMotion } from './realisticEffects';
import { frontCurveGeometry, taperedArrowPath, FrontTick } from './mapInfographic';

const STEP_MS = 1400; // 단계당 1~1.5s (R9-08 §B)

// ── 블록 기하 (중.png 문법) ─────────────────────────────────────────────────
const BF = { L: 26, R: 214, T: 54, B: 118, DX: 24, DY: 26, W: 188, H: 64 };
/** 전면 단면 평면: fx 0~1(가로), h 0~1(고도 0=지표) → 화면 좌표 */
export const fp = (fx, h) => [BF.L + BF.W * fx, BF.B - BF.H * h];
/** 지면 평면(지도 시점): fx 0~1(가로), z 0~1(깊이 0=앞) → 화면 좌표 */
export const gp = (fx, z) => [BF.L + BF.W * fx + BF.DX * z, BF.B - BF.DY * z];
const P = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

const COLD_FILL = 'rgba(147,197,253,0.7)';
const COLD = '#2563eb';
const WARM_FILL = 'rgba(252,165,165,0.42)';
const WARM = '#dc2626';

// ── 공용 프리미티브 ─────────────────────────────────────────────────────────
/** 단계 등장 요소 — step ≥ at부터 표시, 현재 단계면 등장 애니메이션 1회 */
function Appear({ at, step, animate, enter = 'animate-cs-step', until = Infinity, children }) {
  if (step < at || step > until) return null;
  return <g className={`svg-anim ${animate && step === at ? enter : ''}`}>{children}</g>;
}

/** 반복 애니메이션 요소 — step ≥ at 동안 무한 재생(정적 모드면 클래스 미부여) */
function Loop({ at, step, animate, cls, until = Infinity, children }) {
  if (step < at || step > until) return null;
  return <g className={anim(animate, cls)}>{children}</g>;
}

/** 흰 테두리 헤일로 라벨 */
function CSText({ x, y, color = '#334155', size = 6.5, weight = 700, anchor = 'middle', children }) {
  return (
    <text
      x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color}
      stroke="#ffffff" strokeWidth="2" paintOrder="stroke" strokeLinejoin="round"
    >
      {children}
    </text>
  );
}

/** 넓은 유동 화살표(하.png 문법 재사용) — 공기 이동 */
function BroadArrow({ x1, y1, x2, y2, color, bend = 0.18, w0 = 9, w1 = 3.5, opacity = 0.75 }) {
  const { body, head } = taperedArrowPath(x1, y1, x2, y2, { bend, w0, w1 });
  return (
    <g opacity={opacity}>
      <path d={body} fill={color} opacity="0.45" />
      <path d={head} fill={color} />
    </g>
  );
}

/** 지면 평면 위 전선 선 + 표준 기호 (fx0,z=0 → fx1,z=1 대각) */
function GroundFrontLine({ fx0, fx1, kind, animate, wobble = false }) {
  const [ax, ay] = gp(fx0, 0.04);
  const [bx, by] = gp(fx1, 0.96);
  const { d, samples } = frontCurveGeometry([{ x: ax, y: ay }, { x: bx, y: by }], { extend: 4, spacing: 11 });
  const stationary = kind === 'stationary';
  return (
    <g className={wobble ? anim(animate, 'animate-cloud-drift') : undefined}>
      <path d={d} fill="none" stroke={stationary ? WARM : kind === 'cold' ? COLD : WARM} strokeWidth="1.6" strokeLinecap="round" />
      {stationary && <path d={d} fill="none" stroke={COLD} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="9 9" />}
      {samples.map((p, i) => {
        if (stationary) {
          return i % 2 === 0
            ? <FrontTick key={i} {...p} kind="warm" s={3} />
            : <FrontTick key={i} {...p} kind="cold" flip s={3} />;
        }
        return <FrontTick key={i} {...p} kind={kind} s={3} />;
      })}
    </g>
  );
}

/** 상승/유동 화살표 묶음 — rotate로 방향 제어(0=수직 상승, +는 시계 방향 기움) */
function RisingArrows({ cx, cy, rotate = 0, color = '#ea580c', count = 3, gap = 12, animate, step, at, until = Infinity }) {
  return (
    <Loop at={at} step={step} animate={animate} cls="" until={until}>
      <g transform={`translate(${cx} ${cy}) rotate(${rotate})`}>
        {Array.from({ length: count }, (_, i) => (
          <g key={i} transform={`translate(${(i - (count - 1) / 2) * gap} 0)`}>
            <g
              className={anim(animate, 'animate-board-updraft')}
              style={animate ? { animationDelay: `${(i * 0.4).toFixed(1)}s` } : undefined}
            >
              <path d="M0,7 L0,-7 M-3.4,-3 L0,-7 L3.4,-3" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        ))}
      </g>
    </Loop>
  );
}

/** 빗줄기 다발(단면) — 교과서 사선 해칭 + 낙하 애니메이션 */
function CSRain({ x, y0 = 96, y1 = 116, count = 5, gap = 5.5, slant = 12, width = 1.4, color = '#0284c7', slow = false, animate }) {
  const len = y1 - y0;
  const dx = Math.tan((slant * Math.PI) / 180) * len;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${x + (i - (count - 1) / 2) * gap} ${y0})`}>
          <g
            className={anim(animate, slow ? 'animate-board-rain-slow' : 'animate-board-rain')}
            style={animate ? { animationDelay: `${(i * 0.17).toFixed(2)}s` } : undefined}
          >
            <line x1="0" y1="0" x2={-dx} y2={len} stroke={color} strokeWidth={width} strokeLinecap="round" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** 눈송이 다발(단면) */
function CSSnow({ x, y = 70, count = 5, gap = 9, animate }) {
  return (
    <g>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${x + (i - (count - 1) / 2) * gap} ${y + (i % 2 === 0 ? 0 : 9)})`}>
          <g
            className={anim(animate, 'animate-board-snow')}
            style={animate ? { animationDelay: `${(i * 0.5).toFixed(2)}s` } : undefined}
          >
            <SnowFlake r={2.6} color="#e0f2fe" width={1.1} />
          </g>
        </g>
      ))}
    </g>
  );
}

/** 교과서식 뭉게구름(윤곽선 있는 퍼프) */
function PuffCloud({ x, y, scale = 1, fill = '#f8fafc', stroke = '#94a3b8', opacity = 1, dashed = false }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <g fill={fill} stroke={stroke} strokeWidth={dashed ? 1 : 0.9} strokeDasharray={dashed ? '3 2.4' : undefined}>
        <circle cx="-9" cy="1" r="7.5" />
        <circle cx="0.5" cy="-4" r="9.5" />
        <circle cx="10" cy="1.5" r="7" />
        <rect x="-14" y="1" width="28" height="7" rx="3.5" strokeWidth="0" />
        <line x1="-14" y1="8" x2="14" y2="8" strokeLinecap="round" />
      </g>
    </g>
  );
}

/** 적란운 타워(모루 포함) — 지면에서 상자 뚜껑을 뚫고 수직 발달 */
function CbTower({ x, groundY = 116, topY = 30, animate, grow }) {
  const h = groundY - topY;
  return (
    <g className={grow && animate ? 'svg-anim animate-board-grow' : 'svg-anim'}>
      {/* 모루(상부 평탄) */}
      <ellipse cx={x} cy={topY + 4} rx="27" ry="5.5" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
      {/* 수직 발달 몸통 */}
      <circle cx={x - 4} cy={topY + h * 0.28} r="11" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="0.8" />
      <circle cx={x + 6} cy={topY + h * 0.42} r="12" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />
      <circle cx={x - 5} cy={topY + h * 0.58} r="12" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />
      <ellipse cx={x} cy={topY + h * 0.76} rx="16" ry="7.5" fill="#94a3b8" />
    </g>
  );
}

/** 넓고 평평한 난층운/층운 밴드 */
function LayerCloud({ x, y, w = 60, dark = true, animate, grow }) {
  const fill1 = dark ? '#cbd5e1' : '#e2e8f0';
  const fill2 = dark ? '#94a3b8' : '#cbd5e1';
  return (
    <g className={grow && animate ? 'svg-anim animate-board-grow' : 'svg-anim'}>
      <ellipse cx={x - w * 0.18} cy={y - 5} rx={w * 0.34} ry="6" fill={fill1} stroke="#94a3b8" strokeWidth="0.7" />
      <ellipse cx={x + w * 0.18} cy={y - 7} rx={w * 0.36} ry="6.5" fill={fill1} stroke="#94a3b8" strokeWidth="0.7" />
      <ellipse cx={x} cy={y} rx={w * 0.5} ry="5.5" fill={fill2} />
    </g>
  );
}

/** 번개 */
function Bolt({ x, y, animate }) {
  return (
    <g transform={`translate(${x} ${y})`} className={animate ? 'animate-board-flash' : ''} opacity={animate ? undefined : 0.8}>
      <path d="M0,0 L-5,10 L-1,9 L-4,19" fill="none" stroke="#facc15" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// ── 블록 프레임 (투명 공기 상자 + 지면 평면 + 축 라벨) ─────────────────────
function BlockFrame({ night = false, sea = null, children }) {
  const ground = [gp(0, 0), gp(1, 0), gp(1, 1), gp(0, 1)];
  return (
    <svg viewBox="0 0 260 150" className="block h-auto w-full" aria-hidden="true">
      <defs>
        <linearGradient id="cs-sky-day" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#eff6ff" />
        </linearGradient>
        <linearGradient id="cs-sky-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <linearGradient id="cs-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9e7c8" />
          <stop offset="100%" stopColor="#b7cf9e" />
        </linearGradient>
        <linearGradient id="cs-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <radialGradient id="cs-bloom-cold">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-bloom-warm">
          <stop offset="0%" stopColor="#ea580c" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#fdba74" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-heat">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fdba74" stopOpacity="0" />
        </radialGradient>
        <filter id="cs-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {/* 하늘 배경 */}
      <rect width="260" height="150" fill={`url(#${night ? 'cs-sky-night' : 'cs-sky-day'})`} />

      {/* 지면 평면(지도 시점 바닥) + 바다 스트립 */}
      <polygon points={P(ground)} fill="url(#cs-ground)" stroke="#8fa87b" strokeWidth="0.6" />
      {sea && (
        <polygon
          points={P([gp(sea.from ?? 0, 0), gp(sea.to, 0), gp(sea.to, 1), gp(sea.from ?? 0, 1)])}
          fill="url(#cs-sea)"
          opacity="0.95"
        />
      )}
      {night && <polygon points={P(ground)} fill="#0f172a" opacity="0.35" />}

      {/* 지면 앞단면 슬래브(흙) + 해칭 */}
      <polygon points={P([[BF.L, BF.B], [BF.R, BF.B], [BF.R, BF.B + 10], [BF.L, BF.B + 10]])} fill="#d6c9a8" stroke="#b8a888" strokeWidth="0.5" />
      <polygon points={P([[BF.R, BF.B], [BF.R + BF.DX, BF.B - BF.DY], [BF.R + BF.DX, BF.B - BF.DY + 10], [BF.R, BF.B + 10]])} fill="#c4b593" stroke="#b8a888" strokeWidth="0.5" />
      {Array.from({ length: 16 }, (_, i) => (
        <line key={i} x1={BF.L + 6 + i * 12} y1={BF.B + 9} x2={BF.L + 12 + i * 12} y2={BF.B + 1} stroke="#a89878" strokeWidth="0.7" />
      ))}

      {/* 장면 콘텐츠 */}
      {children}

      {/* 투명 공기 상자 모서리(유리 상자 문법) */}
      <g fill="none" stroke={night ? '#94a3b8' : '#64748b'} strokeWidth="0.7" opacity="0.55">
        <polygon points={P([[BF.L, BF.T], [BF.R, BF.T], [BF.R + BF.DX, BF.T - BF.DY], [BF.L + BF.DX, BF.T - BF.DY]])} />
        <line x1={BF.L} y1={BF.T} x2={BF.L} y2={BF.B} />
        <line x1={BF.R} y1={BF.T} x2={BF.R} y2={BF.B} />
        <line x1={BF.R + BF.DX} y1={BF.T - BF.DY} x2={BF.R + BF.DX} y2={BF.B - BF.DY} />
        <line x1={BF.L + BF.DX} y1={BF.T - BF.DY} x2={BF.L + BF.DX} y2={BF.B - BF.DY} strokeDasharray="2 2" opacity="0.5" />
      </g>

      {/* 축 라벨 — 고도(좌) / 지표(하) */}
      <g stroke="#475569" strokeWidth="1" fill="none">
        <line x1="14" y1="112" x2="14" y2="62" />
        <path d="M11,66 L14,61 L17,66" />
      </g>
      <text x="14" y="57" textAnchor="middle" fontSize="6" fontWeight="700" fill="#475569">고도</text>
      <text x="238" y="127" textAnchor="middle" fontSize="6" fontWeight="700" fill="#57534e">지표</text>
    </svg>
  );
}

// ── 장면 8종 (규칙별 스토리보드 — 실제 메커니즘 순서) ───────────────────────
/** cold_front_shower: 찬 공기 쐐기 → 급상승 → 적란운 수직 발달 → 소나기·번개 */
function ColdFrontScene({ step, animate }) {
  const wedge = [fp(0, 0), fp(0.6, 0), fp(0.15, 0.75), fp(0, 0.82)];
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <GroundFrontLine fx0={0.6} fx1={0.74} kind="cold" animate={animate} />
        <polygon points={P(wedge)} fill={COLD_FILL} stroke={COLD} strokeWidth="1" />
        <BroadArrow x1={40} y1={100} x2={98} y2={100} color={COLD} bend={0.06} />
        <CSText x={64} y={92} color={COLD}>찬 공기</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <polygon points={P([fp(0.6, 0), fp(1, 0), fp(1, 0.8), fp(0.2, 0.8), fp(0.15, 0.75)])} fill={WARM_FILL} />
        <CSText x={178} y={86} color={WARM}>따뜻하고 습한 공기</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={128} cy={92} rotate={-32} color={WARM} />
      <RisingArrows at={1} step={step} animate={animate} cx={106} cy={76} rotate={-32} color={WARM} count={2} />
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={146} groundY={114} topY={26} animate={animate} grow={step === 2} />
        <CSText x={188} y={34} size={6}>적란운</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSRain x={146} y0={98} y1={116} count={5} slant={16} width={1.6} animate={animate} />
        <Bolt x={132} y={96} animate={animate} />
      </Appear>
    </BlockFrame>
  );
}

/** stationary_front_monsoon: 세력 균형 대치 → 정체전선 → 습기 공급·비층운 → 장맛비 */
function MonsoonScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate}>
        <polygon points={P([fp(0, 0), fp(0.46, 0), fp(0, 0.62)])} fill={COLD_FILL} stroke={COLD} strokeWidth="0.9" />
        <polygon points={P([fp(1, 0), fp(0.54, 0), fp(1, 0.62)])} fill="rgba(252,165,165,0.6)" stroke={WARM} strokeWidth="0.9" />
        <BroadArrow x1={44} y1={102} x2={86} y2={102} color={COLD} bend={0.05} w0={7} w1={3} />
        <BroadArrow x1={196} y1={102} x2={154} y2={102} color={WARM} bend={0.05} w0={7} w1={3} />
        <CSText x={62} y={90} color={COLD}>찬 공기</CSText>
        <CSText x={182} y={90} color={WARM}>따뜻한 공기</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <GroundFrontLine fx0={0.48} fx1={0.56} kind="stationary" animate={animate} wobble />
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <BroadArrow x1={236} y1={70} x2={172} y2={62} color="#0d9488" bend={-0.16} w0={8} w1={3} />
        <CSText x={222} y={54} color="#0f766e" size={6}>습한 공기 공급</CSText>
        <LayerCloud x={120} y={62} w={104} dark animate={animate} grow={step === 2} />
        <CSText x={120} y={44} size={6}>비층운(장마 구름 띠)</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSRain x={96} y0={74} y1={114} count={5} gap={7} slant={4} slow animate={animate} />
        <CSRain x={146} y0={74} y1={114} count={5} gap={7} slant={4} slow animate={animate} />
      </Appear>
    </BlockFrame>
  );
}

/** warm_front_steady_rain: 온난공기 접근 → 완만한 활승 → 난층운 → 넓은 약한 비 */
function WarmFrontScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <polygon points={P([fp(1, 0), fp(0.36, 0), fp(1, 0.66)])} fill={COLD_FILL} stroke={COLD} strokeWidth="1" />
        <GroundFrontLine fx0={0.36} fx1={0.5} kind="warm" animate={animate} />
        <CSText x={192} y={104} color={COLD}>찬 공기(물러남)</CSText>
        <BroadArrow x1={36} y1={98} x2={82} y2={94} color={WARM} bend={0.08} />
        <CSText x={58} y={84} color={WARM}>따뜻한 공기</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={116} cy={92} rotate={62} color={WARM} />
      <RisingArrows at={1} step={step} animate={animate} cx={152} cy={78} rotate={62} color={WARM} count={2} />
      <Appear at={2} step={step} animate={animate}>
        <LayerCloud x={100} y={78} w={70} dark animate={animate} grow={step === 2} />
        <LayerCloud x={150} y={62} w={76} dark animate={animate} grow={step === 2} />
        <CSText x={112} y={48} size={6}>난층운(넓고 두꺼운 층 구름)</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSRain x={78} y0={86} y1={114} count={5} gap={6.5} slant={3} width={1} slow animate={animate} />
        <CSRain x={118} y0={86} y1={114} count={4} gap={6.5} slant={3} width={1} slow animate={animate} />
      </Appear>
    </BlockFrame>
  );
}

/** siberian_snow: cP 남하 → 서해 열·수증기 공급(기단 변질) → 눈구름 발달 → 서해안 폭설 */
function SiberianSnowScene({ step, animate }) {
  return (
    <BlockFrame sea={{ from: 0.06, to: 0.56 }}>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <ellipse cx={gp(0.16, 0.72)[0]} cy={gp(0.16, 0.72)[1] - 26} rx="46" ry="30" fill="url(#cs-bloom-cold)" />
        <BroadArrow x1={48} y1={64} x2={106} y2={74} color={COLD} bend={0.1} />
        <CSText x={70} y={50} color={COLD}>시베리아 기단(cP)</CSText>
        <CSText x={70} y={58} color="#3b82f6" size={5.5}>차고 건조</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <CSText x={90} y={106} color="#0369a1" size={6}>따뜻한 서해</CSText>
        <CSText x={128} y={72} color="#b45309" size={6}>열·수증기 공급</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={102} cy={98} rotate={0} color="#f59e0b" count={3} gap={16} />
      <Appear at={2} step={step} animate={animate}>
        <PuffCloud x={112} y={74} scale={0.7} fill="#e2e8f0" />
        <PuffCloud x={140} y={68} scale={0.95} fill="#cbd5e1" />
        <PuffCloud x={172} y={62} scale={1.2} fill="#cbd5e1" />
        <CSText x={158} y={40} size={6}>눈구름 발달(기단 변질)</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSSnow x={176} y={74} count={5} animate={animate} />
        <CSText x={192} y={104} size={6} color="#0c4a6e">서해안 폭설</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** convective_shower: 강한 일사·지면 가열 → 대류 상승 → 적란운 발달 → 오후 소나기 */
function ConvectiveScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={48} y={26} scale={1.5} fill="#f59e0b" />
        </g>
        {[0, 1, 2].map((i) => (
          <line key={i} x1={60 + i * 6} y1={36 + i * 2} x2={92 + i * 10} y2={92} stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />
        ))}
        <ellipse cx={126} cy={116} rx="52" ry="10" fill="url(#cs-heat)" />
        <CSText x={126} y={104} color="#c2410c" size={6}>지면 가열</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={132} cy={88} rotate={0} color="#ea580c" />
      <Appear at={1} step={step} animate={animate}>
        <CSText x={168} y={84} color="#c2410c" size={6}>대류 상승</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={140} groundY={112} topY={28} animate={animate} grow={step === 2} />
        <CSText x={188} y={36} size={6}>적란운</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSRain x={140} y0={96} y1={115} count={4} slant={12} width={1.5} animate={animate} />
        <Bolt x={128} y={94} animate={animate} />
      </Appear>
    </BlockFrame>
  );
}

/** radiation_fog: 맑은 밤 복사냉각 → 지표 공기 냉각 → 응결·안개층 → 새벽 짙은 안개 */
function RadiationFogScene({ step, animate }) {
  return (
    <BlockFrame night>
      <Appear at={0} step={step} animate={animate}>
        <circle cx="210" cy="24" r="9" fill="#fef9c3" opacity="0.9" />
        <circle cx="205" cy="21" r="8" fill="#0f172a" opacity="0.85" />
        {[[60, 18], [96, 30], [150, 16], [186, 38]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1" fill="#e2e8f0" />
        ))}
        <CSText x={78} y={64} color="#fbbf24" size={6}>복사냉각 — 열 방출</CSText>
      </Appear>
      {[0, 1, 2].map((i) => (
        <Loop key={i} at={0} step={step} animate={animate} cls="" >
          <g transform={`translate(${72 + i * 48} 92)`}>
            <g className={anim(animate, 'animate-board-updraft')} style={animate ? { animationDelay: `${(i * 0.5).toFixed(1)}s` } : undefined}>
              <WaveLine y={0} width={12} color="#f59e0b" strokeWidth={1.4} />
              <WaveLine y={4} width={12} color="#f59e0b" strokeWidth={1.2} opacity={0.6} />
            </g>
          </g>
        </Loop>
      ))}
      <Appear at={1} step={step} animate={animate}>
        <polygon points={P([fp(0, 0), fp(1, 0), fp(1, 0.24), fp(0, 0.24)])} fill="rgba(96,165,250,0.3)" />
        <CSText x={120} y={100} color="#bfdbfe" size={6}>지표 부근 공기 냉각</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <g filter="url(#cs-soft)">
          <ellipse cx={100} cy={110} rx="66" ry="7" fill="#f8fafc" opacity="0.85" />
          <ellipse cx={150} cy={106} rx="58" ry="6" fill="#f1f5f9" opacity="0.75" />
          <ellipse cx={126} cy={98} rx="46" ry="5" fill="#ffffff" opacity="0.6" />
        </g>
        <CSText x={64} y={82} color="#e2e8f0" size={6}>수증기 응결 → 안개층</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <SunShape x={228} y={44} scale={0.9} fill="#fcd34d" />
        <circle cx="228" cy="44" r="12" fill="#e0f2fe" opacity="0.5" />
        <CSText x={186} y={70} color="#f8fafc" size={6}>이른 아침, 짙은 안개</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** north_pacific_heatwave: mT 정착 → 강한 일사 → 더운 공기 축적 → 폭염 지속 */
function HeatwaveScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate}>
        <ellipse cx={126} cy={116} rx="110" ry="72" fill="url(#cs-bloom-warm)" />
        <BroadArrow x1={224} y1={96} x2={168} y2={90} color="#ea580c" bend={-0.12} />
        <CSText x={120} y={70} color="#c2410c">북태평양 기단(mT)</CSText>
        <CSText x={120} y={78} color="#ea580c" size={5.5}>덥고 습함</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={52} y={26} scale={1.6} fill="#f97316" />
        </g>
        {[0, 1].map((i) => (
          <line key={i} x1={66 + i * 8} y1={36 + i * 3} x2={96 + i * 14} y2={90} stroke="#fb923c" strokeWidth="1.3" strokeDasharray="4 3" opacity="0.85" />
        ))}
        <CSText x={92} y={100} color="#c2410c" size={6}>강한 햇볕</CSText>
      </Appear>
      {[0, 1, 2].map((i) => (
        <Loop key={i} at={2} step={step} animate={animate} cls="">
          <g transform={`translate(${112 + i * 30} 0)`}>
            <g className={anim(animate, 'animate-board-shimmer')} style={animate ? { animationDelay: `${(i * 0.4).toFixed(1)}s` } : undefined}>
              <WaveLine y={104} width={16} color="#fb923c" strokeWidth={1.6} />
              <WaveLine y={98} width={13} color="#fb923c" strokeWidth={1.3} opacity={0.6} />
            </g>
          </g>
        </Loop>
      ))}
      <Appear at={2} step={step} animate={animate}>
        <CSText x={182} y={84} color="#b91c1c" size={6}>더운 공기 축적 — 기온↑</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <rect x="102" y="34" width="48" height="15" rx="7.5" fill="#dc2626" opacity="0.92" />
        <text x="126" y="45" textAnchor="middle" fontSize="8" fontWeight="800" fill="#ffffff">폭염</text>
      </Appear>
    </BlockFrame>
  );
}

/** siberian_clear: cP 정착 → 수증기 부족(구름 형성 실패) → 춥고 맑은 하늘 */
function SiberianClearScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <ellipse cx={110} cy={112} rx="104" ry="66" fill="url(#cs-bloom-cold)" />
        <BroadArrow x1={40} y1={58} x2={92} y2={70} color={COLD} bend={0.1} />
        <CSText x={92} y={48} color={COLD}>시베리아 기단(cP)</CSText>
        <CSText x={92} y={56} color="#3b82f6" size={5.5}>차고 건조</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate} until={1}>
        <PuffCloud x={150} y={74} scale={1.1} fill="none" stroke="#94a3b8" opacity={0.55} dashed />
        <line x1="136" y1="62" x2="164" y2="84" stroke="#94a3b8" strokeWidth="1.4" opacity="0.6" />
        <CSText x={150} y={100} size={6} color="#64748b">수증기 부족 — 구름이 못 생겨요</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={172} y={30} scale={1.4} />
        </g>
        <CSText x={120} y={80} color="#1d4ed8" size={6.5}>춥고 맑은 겨울 하늘</CSText>
      </Appear>
    </BlockFrame>
  );
}

// ── 스토리보드 레지스트리 (board_rules.json 8종 — explain을 메커니즘 순서로 분해) ──
export const STORYBOARDS = {
  cold_front_shower: {
    title: '한랭전선 — 좁고 강한 소나기',
    Scene: ColdFrontScene,
    steps: [
      '차가운 공기가 쐐기처럼 따뜻한 공기 밑을 빠르게 파고들어요.',
      '밀려난 따뜻하고 습한 공기가 가파른 전선면을 따라 급하게 상승해요.',
      '강한 상승기류 속에서 수증기가 응결해 적란운이 수직으로 발달해요.',
      '전선 부근 좁은 지역에 강한 소나기가 짧게 쏟아지고 번개가 치기도 해요.',
    ],
  },
  stationary_front_monsoon: {
    title: '정체전선 — 여러 날 이어지는 장맛비',
    Scene: MonsoonScene,
    steps: [
      '세력이 비슷한 찬 공기와 따뜻한 공기가 한자리에서 맞서요.',
      '어느 쪽도 밀리지 않아 전선이 한곳에 오래 머물러요 — 정체전선.',
      '남쪽에서 습한 공기가 계속 공급되어 두꺼운 비층운 띠가 만들어져요.',
      '같은 지역에 장마처럼 여러 날 지속되는 비가 내려요.',
    ],
  },
  warm_front_steady_rain: {
    title: '온난전선 — 넓은 지역의 약한 비',
    Scene: WarmFrontScene,
    steps: [
      '따뜻한 공기가 물러나는 찬 공기 쪽으로 다가와요.',
      '따뜻한 공기가 찬 공기 위로 완만한 전선면을 따라 타고 올라요(활승).',
      '천천히 식으며 넓은 지역에 층 모양의 난층운이 만들어져요.',
      '넓은 지역에 약한 비가 오랫동안 잔잔하게 내려요.',
    ],
  },
  siberian_snow: {
    title: '시베리아 기단 변질 — 서해안 폭설',
    Scene: SiberianSnowScene,
    steps: [
      '차고 건조한 시베리아 기단(cP)이 남쪽으로 이동해요.',
      '따뜻한 서해를 건너는 동안 바다에서 열과 수증기를 공급받아요.',
      '기단 아랫부분이 변질되어 눈구름이 줄지어 발달해요.',
      '눈구름이 도착하는 서해안 지역에 많은 눈이 내려요.',
    ],
  },
  convective_shower: {
    title: '대류 — 한여름 오후 소나기',
    Scene: ConvectiveScene,
    steps: [
      '한여름 강한 햇볕이 지면을 뜨겁게 데워요.',
      '데워진 습한 공기가 가벼워져 활발히 상승해요 — 대류.',
      '상승한 공기가 식으며 수증기가 응결해 적란운이 키 크게 발달해요.',
      '전선이 없어도 오후 한때 좁은 지역에 소나기가 쏟아져요.',
    ],
  },
  radiation_fog: {
    title: '복사안개 — 맑은 새벽의 안개',
    Scene: RadiationFogScene,
    steps: [
      '구름 없는 맑은 밤, 지표가 열을 내보내며 빠르게 식어요(복사냉각).',
      '차가워진 지표에 닿은 공기가 아래층부터 함께 식어요.',
      '식은 공기 속 수증기가 응결해 지표를 덮는 안개층이 만들어져요.',
      '해가 뜨는 이른 아침까지 짙은 안개가 낮게 깔려 있어요.',
    ],
  },
  north_pacific_heatwave: {
    title: '북태평양 기단 — 한여름 폭염',
    Scene: HeatwaveScene,
    steps: [
      '덥고 습한 북태평양 기단(mT)이 우리나라에 넓게 자리 잡아요.',
      '맑은 하늘 위로 강한 햇볕이 더해져 지면이 계속 가열돼요.',
      '더운 공기가 빠져나가지 못하고 쌓여 기온이 크게 올라요.',
      '한여름 무더위 — 폭염이 이어져요.',
    ],
  },
  siberian_clear: {
    title: '시베리아 기단 — 춥고 맑은 겨울',
    Scene: SiberianClearScene,
    steps: [
      '차고 건조한 시베리아 기단(cP)이 자리 잡아요.',
      '공기가 건조해 수증기가 부족하니 구름이 잘 만들어지지 않아요.',
      '구름 없는 하늘 — 춥지만 맑은 겨울 날씨가 돼요.',
    ],
  },
};

// ── 패널 본체 ───────────────────────────────────────────────────────────────
/**
 * @param zoneResult 존 판정 {zone, zone_name, phenomenon, cloud, rule_id, explain}
 * @param confirmed  true면 서버 확정 판정 리플레이(배지 구분)
 * @param reduced    (테스트용) prefers-reduced-motion 강제 오버라이드
 */
export default function CrossSectionPanel({ zoneResult, confirmed = false, reduced: reducedProp }) {
  const systemReduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  const reduced = reducedProp ?? systemReduced;
  const ruleId = zoneResult?.rule_id ?? null;
  const story = ruleId ? STORYBOARDS[ruleId] : null;
  const storyKey = `${zoneResult?.zone ?? ''}-${ruleId ?? zoneResult?.phenomenon ?? ''}-${confirmed ? 'c' : 'p'}`;

  // 규칙·존·판정 종류가 바뀌면 처음부터 리플레이
  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [storyKey]);

  // 자동 재생 — 단계당 STEP_MS, 마지막 단계에서 정지(수동 리플레이 가능)
  useEffect(() => {
    if (!story || reduced || !playing) return undefined;
    if (step >= story.steps.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, story.steps.length - 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [story, storyKey, reduced, playing, step]);

  if (!zoneResult) return null;

  const ph = phenomenonMeta(zoneResult.phenomenon);
  const cl = cloudMeta(zoneResult.cloud);
  const header = (
    <p className="text-xs font-bold text-slate-800">
      {zoneResult.zone_name ? `${zoneResult.zone_name} — ` : ''}
      {ph.label}
      <span className="ml-1 font-medium text-slate-400">({cl.label})</span>
    </p>
  );
  const badges = (
    <>
      <span
        className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
          confirmed ? 'bg-emerald-500 text-white' : 'bg-white/85 text-slate-500 ring-1 ring-slate-200'
        }`}
      >
        {confirmed ? '✓ 서버 판정' : '미리보기'}
      </span>
      {reduced && (
        <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
          정적 표시
        </span>
      )}
    </>
  );

  // 규칙 미성립·미등록 — 단면 없이 캡션 박스만 (구 기본 캡션과 동등)
  if (!story) {
    return (
      <div className="mb-3 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
        <div className="flex items-start gap-2">
          <SymbolIcon kind="phenomenon" value={zoneResult.phenomenon} className="mt-0.5 h-6 w-6" />
          <div className="min-w-0">
            {header}
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              {zoneResult.explain ?? '아직 성립한 규칙이 없어요 — 기단·전선·습기·일사를 조합해 보세요.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { Scene, steps, title } = story;
  const displayStep = reduced ? steps.length - 1 : step;
  const atEnd = step >= steps.length - 1;

  const jump = (i) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(i, steps.length - 1)));
  };
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (atEnd) setStep(0); // 끝에서 재생 → 처음부터 리플레이
    setPlaying(true);
  };

  return (
    <div className="mb-3 overflow-hidden rounded-xl ring-1 ring-slate-200">
      <div className="relative">
        <Scene step={displayStep} animate={!reduced} />
        {badges}
        <span className="absolute bottom-1.5 left-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
          단면 모식도 · {title}
        </span>
      </div>

      <div className="bg-white px-3 py-2">
        <div className="flex items-start gap-2">
          <SymbolIcon kind="phenomenon" value={zoneResult.phenomenon} className="mt-0.5 h-6 w-6" />
          <div className="min-w-0 flex-1">
            {header}

            {reduced ? (
              /* reduced-motion: 최종 장면 정지 + 단계 텍스트 전체 목록 */
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                {steps.map((caption, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-slate-600">
                    {caption}
                  </li>
                ))}
              </ol>
            ) : (
              <>
                {/* 현재 단계 캡션 */}
                <p key={step} className="animate-cs-step mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  <span className="font-bold text-sky-700">
                    {step + 1}/{steps.length}단계
                  </span>{' '}
                  {steps[step]}
                </p>

                {/* 재생 컨트롤 + 단계 점프 도트 */}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => jump(step - 1)}
                    disabled={step === 0}
                    aria-label="이전 단계"
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                  >
                    ◁
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? '일시정지' : '재생'}
                    className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-700"
                  >
                    {playing ? '❚❚ 일시정지' : atEnd ? '↻ 다시 재생' : '▷ 재생'}
                  </button>
                  <button
                    type="button"
                    onClick={() => jump(step + 1)}
                    disabled={atEnd}
                    aria-label="다음 단계"
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                  >
                    ▷
                  </button>
                  <div className="ml-1 flex items-center gap-1" role="group" aria-label="단계 이동">
                    {steps.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => jump(i)}
                        aria-label={`${i + 1}단계로 이동`}
                        className={`h-2 w-2 rounded-full transition ${i === step ? 'bg-sky-600' : 'bg-slate-300 hover:bg-slate-400'}`}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 규칙 explain — 스토리보드의 출처(단일 진실원 캡션) */}
            {zoneResult.explain && (
              <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[10px] leading-relaxed text-slate-400">
                {zoneResult.explain}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

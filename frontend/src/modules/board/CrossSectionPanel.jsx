/**
 * CrossSectionPanel — 판정 시 단면 모식도 애니메이션 패널 (R9-08 §B, 기준 이미지 중.png).
 *
 * 교과서 3D 블록 다이어그램 문법: 투명한 공기 상자 + 바닥 지면 평면(지도 시점)
 * + 전면 수직 단면. **board_rules.json의 전 규칙**마다 explain을 실제 메커니즘 순서로
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
 *
 * ── R10-C(S2): WebGL2 3D 단면 ───────────────────────────────────────────────
 * 같은 스토리보드 단계 시퀀스를 raw WebGL2로도 그린다(`webgl/crossSection/`).
 * **아래 SVG 경로는 폴백으로 그대로 남는다 — 삭제 금지**. 3경로에서 SVG를 쓴다:
 *  (1) SSR — 첫 렌더는 항상 SVG다(GL 판정은 마운트 후 useEffect에서만 일어남)
 *  (2) prefers-reduced-motion — 정적 최종 프레임 + 단계 텍스트 전체 목록(기존 계약)
 *  (3) WebGL2 미지원·컨텍스트 생성 실패·컨텍스트 소실 — `glFailed`로 SVG 복귀
 *  (4) rule_id → 3D 장면 매핑 누락(규칙 드리프트) — CrossSectionGL이 onFail
 * GL 코드는 `lazy()` 동적 청크다(메인 번들 증가 ≈0). Suspense fallback도 SVG 장면
 * 이므로 청크 로딩 중에도 화면이 비지 않는다.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { phenomenonMeta, cloudMeta } from './boardDisplay';
import { SymbolIcon, SunShape, SnowFlake, WaveLine } from './boardSymbols';
import { anim, usePrefersReducedMotion } from './realisticEffects';
import { frontCurveGeometry, taperedArrowPath, FrontTick } from './mapInfographic';
import { supportsWebGL2 } from './webgl/crossSection/support';
// 장면 내부 라벨 — SVG·WebGL 공유 단일 소유자(MT-28)
import { V } from './crossSectionLabels.js';
import { zoneLabel } from './PeninsulaMap';
import { useT } from '../../i18n';
// STORYBOARDS는 컴포넌트 밖 데이터라 훅(useT)을 못 쓴다 — core의 순수 함수를 쓴다.
import { translate, translateList, getCurrentLocale } from '../../i18n/core.js';

const tx = (key) => translate(getCurrentLocale(), key);
const txList = (key) => translateList(getCurrentLocale(), key);

const CrossSectionGL = lazy(() => import('./webgl/crossSection/CrossSectionGL'));

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

// ── 재난 2종 전용 프리미티브 (MT-23 표현 문법 — 조사 문서 §3A·E·F) ──────────
/**
 * 아래 넷은 **SVG 폴백이 WebGL과 같은 뜻을 그리게** 하려고 추가한 것이다
 * (`webgl/crossSection/scenes.js`의 `flame`·`smoke`·`tree`·`building` 관용구의 2D판).
 * 똑같이 그리지 않는다 — SVG는 2D이고 폴백이라 **뜻만 통하면 된다**.
 *
 * 🔴 `data-cs*` 속성은 **계약 테스트가 읽는 유일한 창**이다
 * (`tests/boardVisual.render.test.mjs` §8). jsdom·SSR에는 레이아웃 엔진이 없어
 * 「보기 좋은가」는 못 재고, 잴 수 있는 것은 **선언된 좌표 사이의 관계**뿐이다:
 * 화선이 비탈 위에 있는가 · 불머리가 위쪽인가 · 건물이 포장면 위에 서 있는가.
 * 그래서 수치는 path를 만드는 상수와 **같은 값**을 그대로 내보낸다(단일 소유).
 */
/** 불꽃 — 바람 아래(동)로 기운 물방울꼴. role: front(화선)·spot(비화)·crown(수관화) */
const flamePath = (x, y, h, w) =>
  `M${(x - w / 2).toFixed(1)},${y.toFixed(1)}`
  + ` C${(x - w * 0.52).toFixed(1)},${(y - h * 0.46).toFixed(1)}`
  + ` ${(x - w * 0.12).toFixed(1)},${(y - h * 0.54).toFixed(1)}`
  + ` ${(x + w * 0.3).toFixed(1)},${(y - h).toFixed(1)}`
  + ` C${(x + w * 0.14).toFixed(1)},${(y - h * 0.5).toFixed(1)}`
  + ` ${(x + w * 0.58).toFixed(1)},${(y - h * 0.34).toFixed(1)}`
  + ` ${(x + w / 2).toFixed(1)},${y.toFixed(1)} Z`;

function Flame({ x, y, h, role, animate, delay = 0 }) {
  const w = h * 0.66;
  return (
    <g
      className={anim(animate, 'animate-board-sun-pulse')}
      style={animate ? { animationDelay: `${delay.toFixed(2)}s` } : undefined}
    >
      <path
        data-cs="flame" data-cs-role={role}
        data-cs-x={x.toFixed(1)} data-cs-y={y.toFixed(1)} data-cs-h={h.toFixed(1)}
        d={flamePath(x, y, h, w)} fill="#ea580c"
      />
      <path d={flamePath(x, y - 0.3, h * 0.55, w * 0.52)} fill="#fbbf24" />
    </g>
  );
}

/** 침엽수 — 연료이자 수관화의 그릇(지표화 → 사다리 → 수관, 조사 §3A) */
function ConiferTree({ x, y, h = 12, w = 9 }) {
  return (
    <g>
      <rect x={x - 0.7} y={y - h * 0.16} width="1.4" height={h * 0.18} fill="#7c5b3f" />
      <polygon
        data-cs="tree" data-cs-x={x.toFixed(1)} data-cs-y={y.toFixed(1)} data-cs-h={h.toFixed(1)}
        points={P([[x, y - h * 0.72], [x + w * 0.5, y], [x - w * 0.5, y]])}
        fill="#4d7c0f" stroke="#365314" strokeWidth="0.5"
      />
      <polygon
        points={P([[x, y - h], [x + w * 0.34, y - h * 0.44], [x - w * 0.34, y - h * 0.44]])}
        fill="#3f6212" stroke="#365314" strokeWidth="0.5"
      />
    </g>
  );
}

/** 연기 기둥 — 바람 아래로 눕는다(조사 §3A). 난수 없음: i로만 어긋 배치 */
function SmokePlume({ x, y, n = 3, lean = 5, rise = 6, animate }) {
  return (
    <g className={anim(animate, 'animate-cloud-drift-slow')}>
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i} cx={x + lean * (i + 1)} cy={y - rise * (i + 1)} r={2.6 + i * 1.2}
          fill="#57534e" opacity={(0.3 - i * 0.06).toFixed(2)}
        />
      ))}
    </g>
  );
}

/** 도시 건물 — 앞줄/뒷줄 두 줄(한 줄이면 「건물 몇 개」이지 거리가 안 읽힌다) */
function CityBuilding({ x, base, h, w = 14, color = '#a8a29e', row = 'front' }) {
  const floors = Math.max(1, Math.floor((h - 7) / 7));
  return (
    <g>
      <rect
        data-cs="building" data-cs-row={row}
        data-cs-x={x.toFixed(1)} data-cs-base={base.toFixed(1)} data-cs-h={h.toFixed(1)}
        x={x - w / 2} y={base - h} width={w} height={h}
        fill={color} stroke="#78716c" strokeWidth="0.5"
      />
      {Array.from({ length: floors }, (_, r) => [0, 1].map((c) => (
        <rect
          key={`${r}-${c}`} x={x - w * 0.3 + c * w * 0.36} y={base - h + 3.5 + r * 7}
          width={w * 0.24} height="2.8" fill="#e7e5e4" opacity="0.72"
        />
      )))}
    </g>
  );
}

/** 수직 흐름 화살표 — 빗물받이가 삼키다(down) / 되넘치다(up), 투수면 침투(down) */
function VFlow({ x, y0, y1, marker, color = '#0369a1', animate, delay = 0 }) {
  const up = y1 < y0;
  const hy = up ? y1 + 3.4 : y1 - 3.4;
  return (
    <g
      className={anim(animate, up ? 'animate-board-updraft' : 'animate-board-rain')}
      style={animate ? { animationDelay: `${delay.toFixed(2)}s` } : undefined}
    >
      <path
        data-cs={marker} data-cs-dir={up ? 'up' : 'down'} data-cs-x={x.toFixed(1)}
        d={`M${x},${y0} L${x},${y1} M${x - 2.6},${hy} L${x},${y1} L${x + 2.6},${hy}`}
        fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
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
      <text x="14" y="57" textAnchor="middle" fontSize="6" fontWeight="700" fill="#475569">{V.altitude}</text>
      <text x="238" y="127" textAnchor="middle" fontSize="6" fontWeight="700" fill="#57534e">{V.surface}</text>
    </svg>
  );
}

// ── 장면 v1 (도입 당시 8종 — 규칙별 스토리보드, 실제 메커니즘 순서) ─────────
/** cold_front_shower: 찬 공기 쐐기 → 급상승 → 적란운 수직 발달 → 소나기·번개 */
function ColdFrontScene({ step, animate }) {
  const wedge = [fp(0, 0), fp(0.6, 0), fp(0.15, 0.75), fp(0, 0.82)];
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <GroundFrontLine fx0={0.6} fx1={0.74} kind="cold" animate={animate} />
        <polygon points={P(wedge)} fill={COLD_FILL} stroke={COLD} strokeWidth="1" />
        <BroadArrow x1={40} y1={100} x2={98} y2={100} color={COLD} bend={0.06} />
        <CSText x={64} y={92} color={COLD}>{V.coldAir}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <polygon points={P([fp(0.6, 0), fp(1, 0), fp(1, 0.8), fp(0.2, 0.8), fp(0.15, 0.75)])} fill={WARM_FILL} />
        <CSText x={178} y={86} color={WARM}>{V.warmHumidAir}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={128} cy={92} rotate={-32} color={WARM} />
      <RisingArrows at={1} step={step} animate={animate} cx={106} cy={76} rotate={-32} color={WARM} count={2} />
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={146} groundY={114} topY={26} animate={animate} grow={step === 2} />
        <CSText x={188} y={34} size={6}>{V.cumulonimbus}</CSText>
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
        <CSText x={62} y={90} color={COLD}>{V.coldAir}</CSText>
        <CSText x={182} y={90} color={WARM}>{V.warmAir}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <GroundFrontLine fx0={0.48} fx1={0.56} kind="stationary" animate={animate} wobble />
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <BroadArrow x1={236} y1={70} x2={172} y2={62} color="#0d9488" bend={-0.16} w0={8} w1={3} />
        <CSText x={222} y={54} color="#0f766e" size={6}>{V.humidAirSupply}</CSText>
        <LayerCloud x={120} y={62} w={104} dark animate={animate} grow={step === 2} />
        <CSText x={120} y={44} size={6}>{V.monsoonCloudBand}</CSText>
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
        <CSText x={192} y={104} color={COLD}>{V.coldAirRetreating}</CSText>
        <BroadArrow x1={36} y1={98} x2={82} y2={94} color={WARM} bend={0.08} />
        <CSText x={58} y={84} color={WARM}>{V.warmAir}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={116} cy={92} rotate={62} color={WARM} />
      <RisingArrows at={1} step={step} animate={animate} cx={152} cy={78} rotate={62} color={WARM} count={2} />
      <Appear at={2} step={step} animate={animate}>
        <LayerCloud x={100} y={78} w={70} dark animate={animate} grow={step === 2} />
        <LayerCloud x={150} y={62} w={76} dark animate={animate} grow={step === 2} />
        <CSText x={112} y={48} size={6}>{V.nimbostratusWide}</CSText>
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
        <CSText x={70} y={50} color={COLD}>{V.siberianCp}</CSText>
        <CSText x={70} y={58} color="#3b82f6" size={5.5}>{V.coldDry}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <CSText x={90} y={106} color="#0369a1" size={6}>{V.warmYellowSea}</CSText>
        <CSText x={128} y={72} color="#b45309" size={6}>{V.heatVapourSupply}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={102} cy={98} rotate={0} color="#f59e0b" count={3} gap={16} />
      <Appear at={2} step={step} animate={animate}>
        <PuffCloud x={112} y={74} scale={0.7} fill="#e2e8f0" />
        <PuffCloud x={140} y={68} scale={0.95} fill="#cbd5e1" />
        <PuffCloud x={172} y={62} scale={1.2} fill="#cbd5e1" />
        <CSText x={158} y={40} size={6}>{V.snowCloudDevelop}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSSnow x={176} y={74} count={5} animate={animate} />
        <CSText x={192} y={104} size={6} color="#0c4a6e">{V.westCoastSnow}</CSText>
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
        <CSText x={126} y={104} color="#c2410c" size={6}>{V.groundHeating}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={132} cy={88} rotate={0} color="#ea580c" />
      <Appear at={1} step={step} animate={animate}>
        <CSText x={168} y={84} color="#c2410c" size={6}>{V.convectiveRise}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={140} groundY={112} topY={28} animate={animate} grow={step === 2} />
        <CSText x={188} y={36} size={6}>{V.cumulonimbus}</CSText>
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
        <CSText x={78} y={64} color="#fbbf24" size={6}>{V.radiativeCooling}</CSText>
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
        <CSText x={120} y={100} color="#bfdbfe" size={6}>{V.nearSurfaceCooling}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <g filter="url(#cs-soft)">
          <ellipse cx={100} cy={110} rx="66" ry="7" fill="#f8fafc" opacity="0.85" />
          <ellipse cx={150} cy={106} rx="58" ry="6" fill="#f1f5f9" opacity="0.75" />
          <ellipse cx={126} cy={98} rx="46" ry="5" fill="#ffffff" opacity="0.6" />
        </g>
        <CSText x={64} y={82} color="#e2e8f0" size={6}>{V.condenseToFogLayer}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <SunShape x={228} y={44} scale={0.9} fill="#fcd34d" />
        <circle cx="228" cy="44" r="12" fill="#e0f2fe" opacity="0.5" />
        <CSText x={186} y={70} color="#f8fafc" size={6}>{V.denseFogEarlyMorning}</CSText>
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
        <CSText x={120} y={70} color="#c2410c">{V.northPacificMt}</CSText>
        <CSText x={120} y={78} color="#ea580c" size={5.5}>{V.hotHumid}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={52} y={26} scale={1.6} fill="#f97316" />
        </g>
        {[0, 1].map((i) => (
          <line key={i} x1={66 + i * 8} y1={36 + i * 3} x2={96 + i * 14} y2={90} stroke="#fb923c" strokeWidth="1.3" strokeDasharray="4 3" opacity="0.85" />
        ))}
        <CSText x={92} y={100} color="#c2410c" size={6}>{V.strongSun}</CSText>
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
        <CSText x={182} y={84} color="#b91c1c" size={6}>{V.heatAccumulates}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <rect x="102" y="34" width="48" height="15" rx="7.5" fill="#dc2626" opacity="0.92" />
        <text x="126" y="45" textAnchor="middle" fontSize="8" fontWeight="800" fill="#ffffff">{V.heatwave}</text>
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
        <CSText x={92} y={48} color={COLD}>{V.siberianCp}</CSText>
        <CSText x={92} y={56} color="#3b82f6" size={5.5}>{V.coldDry}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate} until={1}>
        <PuffCloud x={150} y={74} scale={1.1} fill="none" stroke="#94a3b8" opacity={0.55} dashed />
        <line x1="136" y1="62" x2="164" y2="84" stroke="#94a3b8" strokeWidth="1.4" opacity="0.6" />
        <CSText x={150} y={100} size={6} color="#64748b">{V.vapourShortNoCloud}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={172} y={30} scale={1.4} />
        </g>
        <CSText x={120} y={80} color="#1d4ed8" size={6.5}>{V.coldClearWinterSky}</CSText>
      </Appear>
    </BlockFrame>
  );
}

// ── 장면 5종 추가 (R13 확장 — **그때의** 증분 8 → 13. 현재 총수는 아니다) ──
// 어휘 규약: `database/seed/level_vocabulary.json` v3 기준으로 **화면 문자열**을
// 5단계 이하로 묶는다. 십운형 명칭(난층운·권층운 등 introduced_at 6)과 단열 감률·
// 실무 수치는 캡션·라벨에 쓰지 않는다. `okhotsk_foehn_clear`의 id에 있는 "푄"도
// introduced_at 6이라 노출 문자열에서는 **높새바람**(5) 또는 평이한 서술을 쓴다.
// (lint_seed_items는 template_json만 보므로 이 파일의 문자열은 자동 검사 밖이다.)

/** 오호츠크해 기단 + 습기 높음: 찬 기단 남하 → 찬 바다 위 하층 냉각 → 응결 → 해안 안개 */
function OkhotskSeaFogScene({ step, animate }) {
  return (
    <BlockFrame sea={{ from: 0.5, to: 1 }}>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <ellipse cx={gp(0.86, 0.6)[0]} cy={gp(0.86, 0.6)[1] - 28} rx="44" ry="30" fill="url(#cs-bloom-cold)" />
        <BroadArrow x1={224} y1={62} x2={162} y2={74} color={COLD} bend={-0.1} />
        <CSText x={186} y={48} color={COLD}>{V.okhotskAirMass}</CSText>
        <CSText x={186} y={56} color="#3b82f6" size={5.5}>{V.coldHumid}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <CSText x={188} y={106} color="#0369a1" size={6}>{V.coldSea}</CSText>
        <CSText x={104} y={70} color="#1d4ed8" size={6}>{V.coolsFromBelow}</CSText>
      </Appear>
      {/* 하강 냉각 — 상승 화살표를 180° 돌려 아래로 향하게 한다 */}
      <RisingArrows at={1} step={step} animate={animate} cx={150} cy={92} rotate={180} color="#3b82f6" count={3} gap={16} />
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <g filter="url(#cs-soft)">
          <ellipse cx={162} cy={110} rx="58" ry="7" fill="#f8fafc" opacity="0.9" />
          <ellipse cx={132} cy={104} rx="50" ry="6" fill="#f1f5f9" opacity="0.8" />
        </g>
        <CSText x={132} y={92} color="#0f172a" size={6}>{V.condenseToSeaFog}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <g className={anim(animate, 'animate-cloud-drift-slow')}>
          <LayerCloud x={92} y={76} w={78} dark={false} animate={animate} grow={step === 3} />
        </g>
        <g filter="url(#cs-soft)">
          <ellipse cx={78} cy={108} rx="52" ry="6" fill="#ffffff" opacity="0.7" />
        </g>
        <CSText x={78} y={62} size={6} color="#334155">{V.fogLowCloudToShore}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** 오호츠크해 기단 + 습기 낮음: 산을 오르며 비 → 물기 상실 → 하강하며 데워짐 → 서쪽 맑음 */
function OkhotskFoehnScene({ step, animate }) {
  const peak = fp(0.56, 0.62);
  const west = fp(0.3, 0);
  const east = fp(0.82, 0);
  const back = ([x, y]) => [x + BF.DX * 0.75, y - BF.DY * 0.75];
  return (
    <BlockFrame>
      {/* 산맥은 전 단계 공통 배경 — 단계마다 다시 등장하면 지형이 깜빡인다 */}
      <polygon points={P([peak, back(peak), back(east), east])} fill="#7d8794" stroke="#6b7280" strokeWidth="0.6" />
      <polygon points={P([west, peak, east])} fill="#9ca3af" stroke="#6b7280" strokeWidth="0.8" />
      <CSText x={116} y={112} size={5.5} color="#475569">{V.mountainRange}</CSText>

      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <BroadArrow x1={222} y1={104} x2={168} y2={78} color={COLD} bend={-0.14} />
        <CSText x={214} y={72} color={COLD} size={6}>{V.coldHumidAir}</CSText>
      </Appear>
      <RisingArrows at={0} step={step} animate={animate} cx={176} cy={86} rotate={-38} color={COLD} count={2} gap={11} />

      <Appear at={1} step={step} animate={animate}>
        <LayerCloud x={166} y={54} w={62} dark animate={animate} grow={step === 1} />
        <CSRain x={162} y0={62} y1={96} count={4} gap={6} slant={6} slow animate={animate} />
        <CSText x={186} y={40} size={6}>{V.rainOnRiseLosesWater}</CSText>
      </Appear>

      <Appear at={2} step={step} animate={animate}>
        <BroadArrow x1={128} y1={62} x2={62} y2={104} color="#ea580c" bend={0.16} />
        <ellipse cx={64} cy={114} rx="40" ry="9" fill="url(#cs-heat)" />
        <CSText x={72} y={78} color="#c2410c" size={6}>{V.descendCompressWarm}</CSText>
      </Appear>

      <Appear at={3} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={44} y={28} scale={1.3} />
        </g>
        <CSText x={62} y={54} color="#b45309" size={6}>{V.dryWarmWind}</CSText>
        <CSText x={62} y={64} color="#1d4ed8" size={6.5}>{V.foehnClear}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** 양쯔강 기단 + 습기 중간 이하: 온난 건조 기단 이동 → 수증기 부족 → 구름 실패 → 맑고 포근 */
function YangtzeMildClearScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate} enter="animate-board-front">
        <ellipse cx={104} cy={112} rx="96" ry="60" fill="url(#cs-bloom-warm)" />
        <BroadArrow x1={36} y1={64} x2={98} y2={72} color="#ea580c" bend={0.1} />
        <CSText x={100} y={48} color="#c2410c">{V.yangtzeAirMass}</CSText>
        <CSText x={100} y={56} color="#ea580c" size={5.5}>{V.warmDry}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <BroadArrow x1={132} y1={96} x2={200} y2={96} color="#f59e0b" bend={0.05} w0={7} w1={3} />
        <CSText x={172} y={88} color="#b45309" size={6}>{V.lowVapourNoSea}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} until={2}>
        <PuffCloud x={148} y={68} scale={1.1} fill="none" stroke="#94a3b8" opacity={0.55} dashed />
        <line x1="134" y1="56" x2="162" y2="78" stroke="#94a3b8" strokeWidth="1.4" opacity="0.6" />
        <CSText x={148} y={44} size={6} color="#64748b">{V.cloudCannotGrow}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={186} y={30} scale={1.4} />
        </g>
        <CSText x={116} y={72} color="#b45309" size={6.5}>{V.mildClearSky}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** 양쯔강 기단 + 일사 약 + 습기 높음: 맑은 밤 → 지표 냉각 → 물가 응결 → 새벽 안개·일출 소산 */
function YangtzeMorningFogScene({ step, animate }) {
  return (
    <BlockFrame night sea={{ from: 0.26, to: 0.44 }}>
      <Appear at={0} step={step} animate={animate}>
        {[[52, 20], [92, 34], [148, 18], [196, 30]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1" fill="#e2e8f0" />
        ))}
        <CSText x={122} y={50} color="#fcd34d" size={6}>{V.clearCalmNight}</CSText>
        <CSText x={122} y={60} color="#cbd5e1" size={5.5}>{V.warmDryAirMass}</CSText>
      </Appear>
      {[0, 1, 2].map((i) => (
        <Loop key={i} at={1} step={step} animate={animate} cls="">
          <g transform={`translate(${66 + i * 46} 94)`}>
            <g className={anim(animate, 'animate-board-updraft')} style={animate ? { animationDelay: `${(i * 0.45).toFixed(2)}s` } : undefined}>
              <WaveLine y={0} width={12} color="#f59e0b" strokeWidth={1.4} />
              <WaveLine y={4} width={12} color="#f59e0b" strokeWidth={1.2} opacity={0.6} />
            </g>
          </g>
        </Loop>
      ))}
      <Appear at={1} step={step} animate={animate}>
        <polygon points={P([fp(0, 0), fp(1, 0), fp(1, 0.2), fp(0, 0.2)])} fill="rgba(96,165,250,0.28)" />
        <CSText x={124} y={104} color="#bfdbfe" size={6}>{V.groundRadiatesCools}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} enter="animate-board-grow">
        <g filter="url(#cs-soft)">
          <ellipse cx={92} cy={110} rx="54" ry="7" fill="#f8fafc" opacity="0.85" />
          <ellipse cx={118} cy={104} rx="44" ry="5.5" fill="#ffffff" opacity="0.6" />
        </g>
        <CSText x={64} y={80} color="#e2e8f0" size={6}>{V.condenseByWater}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={222} y={40} scale={1} fill="#fcd34d" />
        </g>
        <circle cx="222" cy="40" r="13" fill="#fde68a" opacity="0.35" />
        <CSText x={172} y={68} color="#f8fafc" size={6}>{V.liftsAfterSunrise}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** 일사 강 + 습기 낮음: 지면 가열 → 공기 상승 → 응결할 수증기 없음 → 구름 없는 맑음 */
function DryConvectionClearScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate}>
        <g className={anim(animate, 'animate-board-sun-pulse')}>
          <SunShape x={50} y={26} scale={1.5} fill="#f59e0b" />
        </g>
        {[0, 1, 2].map((i) => (
          <line key={i} x1={62 + i * 6} y1={36 + i * 2} x2={94 + i * 10} y2={94} stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />
        ))}
        <ellipse cx={128} cy={116} rx="54" ry="10" fill="url(#cs-heat)" />
        <CSText x={128} y={106} color="#c2410c" size={6}>{V.groundHeating}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={134} cy={86} rotate={0} color="#ea580c" />
      <Appear at={1} step={step} animate={animate}>
        <CSText x={176} y={82} color="#c2410c" size={6}>{V.warmedAirRises}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate} until={2}>
        <PuffCloud x={134} y={54} scale={1.15} fill="none" stroke="#94a3b8" opacity={0.55} dashed />
        <line x1="120" y1="42" x2="148" y2="64" stroke="#94a3b8" strokeWidth="1.4" opacity="0.6" />
        <CSText x={134} y={34} size={6} color="#64748b">{V.noVapourToCondense}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSText x={132} y={66} color="#1d4ed8" size={6.5}>{V.clearDespiteChurn}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/**
 * ── R13 재난 축 2종 (CO-A3·CO-K4) — **MT-23 표현 격차를 폴백에서도 닫는다** ──
 *
 * 종전 주석은 *"전선면 문법을 흉내 내지 않고 지면에서 벌어지는 일만 그린다"*
 * (2026-08-09 PM 「정직하게 최소로」)였고, 그 최소판은 **산불에 산이 없고 홍수에
 * 도시가 없었다** — 불은 평지에서 탔고(들불이지 산불이 아니다) 물은 바닥 평면을
 * 파랗게 칠한 것이 전부였다.
 *
 * MT-23이 WebGL 쪽 두 장면을 조사 문법으로 다시 세웠지만
 * (`docs/design/research/RESEARCH_MT23_WILDFIRE_FLOOD.md`) **SVG는 범위 밖이라
 * 옛 표현 그대로 남았다**. 그 상태의 문제는 취향이 아니다: WebGL2 미지원 기기·
 * SSR 첫 렌더·reduced-motion 세 경로가 전부 이 SVG를 본다(위 파일 머리 주석).
 * `GuideBot3D`가 적어 둔 그대로 **심사위원 기기를 고를 수 없다.**
 *
 * 그래서 여기서 회수하는 것은 「같은 그림」이 아니라 **같은 뜻**이다:
 *   · 산불 = 산이 보이고 **화선이 비탈 위**에 있으며 위로 갈수록 크다(불머리),
 *            능선 너머로 **비화**가 새 불을 놓고, 마지막에 **수관화**로 옮겨붙는다
 *   · 홍수 = **투수면 ↔ 포장면 대비**가 있는 도시 단면이고, 빗물받이가 2단계에
 *            삼키다 3단계에 **역류**하며, 물은 **땅속·지하부터** 차고 수면이 오른다
 * 2D라서 못 옮기는 것(연기 셰이더·부피 물결)은 옮기지 않는다 — 폴백의 목적은
 * 대체가 아니라 **읽히는 것**이다.
 *
 * ⚠️ 4단계 캡션과 그림이 어긋나면 안 된다. 산불 4단계가 「구름 한 점 없이 맑지만」
 *    이므로 이 장면에는 **어떤 구름도 그리지 않는다**(조사 §3A의 화재적운도
 *    같은 이유로 뺐다). 그 금지는 계약 테스트가 소스로 문다.
 */
// 산불 지형 — 삼각 단면 산(`okhotsk_foehn_clear`와 같은 관용구). 바람이 서→동이라
// **동쪽으로 오르는 비탈**을 두면 바람과 경사가 같은 곳을 가리켜 그림이 한 방향으로
// 읽힌다(조사 §3E: 불은 비탈을 더 빨리 오른다). fx 상한은 1.0 — GL의 1.06을 그대로
// 옮기면 유리 상자 밖으로 나간다.
const WF = { foot: 0.4, apex: 0.82, east: 1, peak: 0.62 };
/** 산 능선의 고도(h) — 서쪽 비탈은 오르고 동쪽 비탈은 내린다 */
const wfSlopeH = (fx) => (fx <= WF.apex
  ? (WF.peak * (fx - WF.foot)) / (WF.apex - WF.foot)
  : (WF.peak * (WF.east - fx)) / (WF.east - WF.apex));
/** 능선 위의 점(화면 좌표) — 나무·화선의 base가 전부 여기서 나온다(단일 소유) */
const wfOn = (fx) => fp(fx, Math.max(0, wfSlopeH(fx)));

/** wildfire_risk_dry_gale: 마른 숲 → 강풍 → 비탈을 오르는 화선·비화 → 위험한 맑음 */
function WildfireRiskScene({ step, animate }) {
  const peak = fp(WF.apex, WF.peak);
  const west = fp(WF.foot, 0);
  const east = fp(WF.east, 0);
  const back = ([x, y]) => [x + BF.DX * 0.6, y - BF.DY * 0.6];
  // 화선 — 아래가 배화, 위가 불머리(조사 §3A 비대칭 + §3E 상향 가속)
  const front = [0.52, 0.62, 0.72].map((fx, i) => ({ fx, h: 9 + i * 3.2, p: wfOn(fx) }));
  // 비탈 4그루 + 평지 2그루 — 숲이 산 앞까지 이어져야 「산에 난 불」로 읽힌다
  const trees = [0.2, 0.3, 0.47, 0.57, 0.67, 0.77].map((fx) => ({ fx, p: wfOn(fx) }));
  const slope = trees.slice(2); // 수관화가 붙는 것은 비탈 위의 나무다
  const [ex, ey] = wfOn(0.92); // 능선 너머 — 비화가 놓는 새 불
  return (
    <BlockFrame>
      {/* 마른 평지 바닥칠은 **지형보다 먼저** — 뒤에 칠하면 반투명 노랑이 평지의
          나무를 덮는다(SVG는 JSX 순서가 곧 그리는 순서다) */}
      <Appear at={0} step={step} animate={animate}>
        <polygon points={P([gp(0, 0), gp(WF.foot, 0), gp(WF.foot, 1), gp(0, 1)])} fill="#fde68a" opacity="0.55" />
      </Appear>
      {/* 지형은 전 단계 공통 배경 — 단계마다 다시 등장하면 지형이 깜빡인다(foehn 규약) */}
      <polygon points={P([peak, back(peak), back(east), east])} fill="#6f7f5e" stroke="#4d5c3e" strokeWidth="0.6" />
      <polygon
        data-cs="mountain"
        data-cs-ax={peak[0].toFixed(1)} data-cs-ay={peak[1].toFixed(1)}
        data-cs-wx={west[0].toFixed(1)} data-cs-wy={west[1].toFixed(1)}
        data-cs-ex={east[0].toFixed(1)} data-cs-ey={east[1].toFixed(1)}
        points={P([west, peak, east])} fill="#8aa06e" stroke="#4d5c3e" strokeWidth="0.8"
      />
      {trees.map(({ fx, p }) => <ConiferTree key={fx} x={p[0]} y={p[1]} />)}
      <CSText x={152} y={68} color="#3f6212" size={5.5}>{V.forestedRidge}</CSText>

      {/* 0 — 연료. 「마름」은 오늘 습도가 아니라 **며칠의 누적**이다(실효습도, 조사 §3B) */}
      <Appear at={0} step={step} animate={animate}>
        <SunShape x={210} y={28} scale={1.1} fill="#f59e0b" />
        {/* 낙엽은 바닥 평면의 **안쪽**(z=0.75)에 흩는다 — 앞쪽에 두면 아래 두 줄
            라벨과 같은 높이에 놓여 글자에 그대로 덮인다(실렌더 확인) */}
        {[0.06, 0.16, 0.26].map((fx) => {
          const [lx, ly] = gp(fx, 0.75);
          return <path key={fx} d={`M${lx} ${ly} l4 -3 l4 3 l-4 2 Z`} fill="#a16207" opacity="0.85" />;
        })}
        <CSText x={64} y={106} color="#92400e" size={5.5}>{V.driedLeavesTwigs}</CSText>
        <CSText x={64} y={114} color="#a16207" size={5.5}>{V.daysOfDrying}</CSText>
      </Appear>

      {/* 1 — 강풍. 비탈 밑에서 멈춘다(그 앞은 산이다) */}
      <Appear at={1} step={step} animate={animate}>
        <BroadArrow x1={30} y1={80} x2={100} y2={78} color="#0e7490" bend={0.04} w0={9} w1={4} />
        <BroadArrow x1={30} y1={94} x2={94} y2={92} color="#0e7490" bend={0.03} w0={7} w1={3} />
        <CSText x={48} y={80} color="#0e7490" size={6}>{V.strongWind}</CSText>
      </Appear>

      {/* 2 — 비탈 위의 화선 + 능선을 넘는 비화(조사 §3A: 방화선을 뛰어넘는다) */}
      <Appear at={2} step={step} animate={animate}>
        {front.map(({ fx, h, p }, i) => (
          <Flame key={fx} x={p[0]} y={p[1]} h={h} role="front" animate={animate} delay={i * 0.25} />
        ))}
        <SmokePlume x={164} y={78} animate={animate} />
        <BroadArrow x1={168} y1={80} x2={ex - 3} y2={ey - 8} color="#f97316" bend={-0.34} w0={5} w1={2} opacity={0.9} />
        <Flame x={ex} y={ey} h={8} role="spot" animate={animate} delay={0.4} />
        <CSText x={72} y={90} color="#9a3412" size={5.5}>{V.fireRunsUphill}</CSText>
        <CSText x={205} y={80} color="#c2410c" size={5.5}>{V.embersRideWind}</CSText>
        <CSText x={190} y={112} color="#c2410c" size={5.5}>{V.spotFireAhead}</CSText>
      </Appear>

      {/* 3 — 수관화. 지표화가 사다리 연료를 타고 꼭대기로 옮겨붙는 분기점(조사 §3A·E).
              구름은 없다 — 4단계 캡션이 「구름 한 점 없이 맑지만」이다 */}
      <Appear at={3} step={step} animate={animate}>
        {[slope[1], slope[2]].map(({ fx, p }, i) => (
          <Flame key={fx} x={p[0]} y={p[1] - 12} h={7.5} role="crown" animate={animate} delay={i * 0.3} />
        ))}
        <CSText x={100} y={98} color="#b45309" size={5.5}>{V.crownFireInTrees}</CSText>
        <CSText x={70} y={56} color="#b45309" size={6.5}>{V.clearSkyWildfire}</CSText>
      </Appear>
    </BlockFrame>
  );
}

// 홍수 지형 — **도시 단면**. 조사 §3F가 도시 침수를 정의하는 문장이 *"배수 체계의
// 용량을 넘어서는 것"*이라, 있어야 하는 것은 건물 실루엣이 아니라
// ① 포장면 ② 빗물받이 ③ 지하 ④ 스며드는 땅과의 대비 넷이다. ④가 핵심이다 —
// 「왜 하필 도시에서 잠기나」는 투수/불투수 대비로만 설명된다.
const FL = {
  street: 114, // 포장면 윗면(도로 높이) — 3단계 수위가 이 위로 올라오는지가 계약이다
  perv: [fp(0.22, 0)[0], fp(0.34, 0)[0]], // 투수면(풀밭)
  paved: [fp(0.34, 0)[0], fp(1, 0)[0]], // 불투수면(포장)
  drain: 172.5, // 빗물받이 — 앞줄 두 건물 사이 「거리」
  basement: 128, // 지하실 — 도시 침수는 수면 높이보다 지하부터 체감된다
};

/** flood_risk_saturated_inflow: 수증기 유입 → 후방 생성 → 지속 강수 → 포화·배수 초과 */
function FloodRiskScene({ step, animate }) {
  return (
    <BlockFrame sea={{ to: 0.2 }}>
      {/* 지형은 전 단계 공통 배경 */}
      <rect
        data-cs="pervious" data-cs-x0={FL.perv[0].toFixed(1)} data-cs-x1={FL.perv[1].toFixed(1)}
        data-cs-y={(FL.street + 1.5).toFixed(1)}
        x={FL.perv[0]} y={FL.street + 1.5} width={FL.perv[1] - FL.perv[0]} height={118 - FL.street - 1.5}
        fill="#4d7c0f"
      />
      {[0, 1, 2, 3].map((i) => {
        const gx = FL.perv[0] + 3 + i * ((FL.perv[1] - FL.perv[0] - 6) / 3);
        return (
          <path
            key={i} d={`M${gx},${FL.street + 1.5} l-1.6,-4 M${gx},${FL.street + 1.5} l1.6,-3.4`}
            stroke="#4d7c0f" strokeWidth="0.9" fill="none" strokeLinecap="round"
          />
        );
      })}
      <rect
        data-cs="paved" data-cs-x0={FL.paved[0].toFixed(1)} data-cs-x1={FL.paved[1].toFixed(1)}
        data-cs-y={FL.street.toFixed(1)}
        x={FL.paved[0]} y={FL.street} width={FL.paved[1] - FL.paved[0]} height={118 - FL.street}
        fill="#a8a29e" stroke="#78716c" strokeWidth="0.5"
      />
      {/* 뒷줄은 높고 앞줄은 낮게 — 그 사이가 **거리**로 읽히고, 그 거리에 빗물받이를 둔다 */}
      {[[112, 20], [142, 28], [172, 17], [202, 24]].map(([x, h]) => (
        <CityBuilding key={`b-${x}`} x={x} base={FL.street - 13} h={h} w={12} color="#c8c2bc" row="back" />
      ))}
      {[[100, 26], [FL.basement, 34], [156, 21], [190, 30]].map(([x, h]) => (
        <CityBuilding key={`f-${x}`} x={x} base={FL.street} h={h} />
      ))}
      <rect
        data-cs="drain" data-cs-x={FL.drain.toFixed(1)} data-cs-top={(FL.street - 1).toFixed(1)}
        x={FL.drain - 4.5} y={FL.street - 1} width="9" height="11" fill="#44403c"
      />
      <rect
        data-cs="basement" data-cs-x={FL.basement.toFixed(1)} data-cs-top="119"
        x={FL.basement - 7} y="119" width="14" height="8" fill="#57534e"
      />
      {/* 두 라벨은 **수면(3단계 y=106) 위**에 둔다 — 아래에 두면 물에 덮여 사라지고,
          하필 그 둘이 「왜 도시에서 잠기나」를 설명하는 대비다 */}
      <CSText x={56} y={98} color="#3f6212" size={5.5}>{V.greenGroundSoaks}</CSText>
      <CSText x={160} y={98} color="#44403c" size={5.5}>{V.cityImpervious}</CSText>

      {/* 0 — 유입. 두 층으로 나눠 「쉬지 않고」를 두께로 보인다(바다는 서쪽 0~0.2) */}
      <Appear at={0} step={step} animate={animate}>
        <BroadArrow x1={30} y1={70} x2={100} y2={64} color="#0d9488" bend={0.1} w0={9} w1={4} />
        <BroadArrow x1={30} y1={82} x2={92} y2={76} color="#0d9488" bend={0.08} w0={7} w1={3} />
        <CSText x={58} y={58} color="#0f766e" size={6}>{V.vapourKeepsArriving}</CSText>
      </Appear>

      {/* 1 — **후방 생성**(조사 §3D). 상류(서)에서 작은 셀이 새로 생겨 자라며 동으로
              가고 하류에서 흩어진다 — **밴드 자체는 서 있다**는 것이 요점이다 */}
      <Appear at={1} step={step} animate={animate}>
        {[[96, 56, 0.55], [126, 50, 0.75], [156, 46, 0.95], [186, 50, 0.8]].map(([x, y, s]) => (
          <PuffCloud key={x} x={x} y={y} scale={s} fill="#cbd5e1" />
        ))}
        <CSText x={58} y={40} color="#475569" size={5.5}>{V.newCellsUpwind}</CSText>
        <CSText x={182} y={32} size={5.5}>{V.rainCloudRefills}</CSText>
      </Appear>

      {/* 2 — 비. 풀밭은 스며들고(아래로) 빗물받이는 아직 삼킨다(아래로) */}
      <Appear at={2} step={step} animate={animate}>
        {/* 가늘게·짧게 — 굵은 빗줄기 16줄이면 도시가 그 뒤로 사라진다(실렌더 확인) */}
        {[78, 112, 150, 190].map((x) => (
          <CSRain key={x} x={x} y0={68} y1={112} count={3} gap={6} slant={5} width={1} slow animate={animate} />
        ))}
        <VFlow x={78} y0={116} y1={124} marker="soak-flow" color="#15803d" animate={animate} />
      </Appear>
      {/* ⚠️ 삼키는 화살표는 **2단계에서 끝난다**(until). 그대로 두면 3단계에 역류
          화살표와 나란히 서서 「빗물받이가 동시에 삼키고 되넘친다」가 된다 —
          계약 테스트가 실제로 그 상태를 잡았다(2026-08-18). 용량 초과는 상태가
          아니라 **사건**이라 아래→위로 **바뀌어야** 뜻이 선다 */}
      <Appear at={2} until={2} step={step} animate={animate}>
        <VFlow x={FL.drain} y0={112} y1={122} marker="drain-flow" animate={animate} delay={0.3} />
      </Appear>

      {/* 3 — **포화·배수 초과**(조사 §3C·§3F). 순서가 문법이다: 땅속이 차고 → 지하가
              잠기고 → 빗물받이가 역류하고 → 위에 고여 수위가 오르고 → 못 스민 물이
              포장면을 타고 낮은 곳(서쪽 바다)으로 빠르게 흐른다 */}
      <Appear at={3} step={step} animate={animate}>
        <rect data-cs="water-soil" x={BF.L} y="120" width={BF.R - BF.L} height="7" fill="#0ea5e9" opacity="0.34" />
        <rect
          data-cs="water-basement" data-cs-top="119"
          x={FL.basement - 7} y="119" width="14" height="8" fill="#0284c7" opacity="0.8"
        />
        <rect
          data-cs="water-surface" data-cs-top="106"
          x={BF.L} y="106" width={BF.R - BF.L} height={118 - 106} fill="#38bdf8" opacity="0.5"
        />
        <VFlow x={FL.drain} y0={112} y1={102} marker="drain-flow" color="#075985" animate={animate} />
        <BroadArrow x1={200} y1={109} x2={112} y2={112} color="#075985" bend={0.05} w0={7} w1={3} opacity={0.9} />
        <CSText x={70} y={88} color="#0c4a6e" size={6}>{V.groundCannotAbsorb}</CSText>
        <CSText x={172} y={88} color="#0369a1" size={5.5}>{V.runoffGathersLow}</CSText>
        <CSText x={176} y={76} color="#075985" size={5.5}>{V.drainOverwhelmed}</CSText>
        <CSText x={60} y={126} color="#0369a1" size={5.5}>{V.soilAlreadyFull}</CSText>
        <CSText x={140} y={126} color="#0c4a6e" size={5.5}>{V.basementFloods}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/**
 * ㉣ 변동 기상요소 규칙 3종(2026-08-18) — `feat/board-wind-rules`가 규칙만 넣고
 * 스토리보드를 안 넣어 계약 테스트 2종이 울고 있었다(main 빨강). 세 장면 모두
 * **기존 형제 장면의 상위판**이라 그 문법을 물려받되, 한 단계씩을 새 조건에
 * 내준다 — 그 단계가 「왜 상위판인가」를 말하는 자리다.
 */

/** cold_front_squall_storm: 지면 가열 → 전선이 밀어 올림 → 바람 시어 → 조직된 폭우 */
function SquallStormScene({ step, animate }) {
  const wedge = [fp(0, 0), fp(0.5, 0), fp(0.12, 0.72), fp(0, 0.78)];
  return (
    <BlockFrame>
      {/* 배치는 `ColdFrontScene`에서 그대로 물려받았다 — 같은 메커니즘의 상위판이라
          라벨 자리를 새로 잡을 이유가 없고, 검증된 자리가 겹침도 없다. 다른 것은
          ①단계가 「전선」이 아니라 「지면 가열」로 시작하고 ③단계에 시어가 낀다는
          점뿐이다. */}
      <Appear at={0} step={step} animate={animate}>
        <SunShape x={214} y={24} scale={1.1} fill="#f59e0b" />
        <polygon points={P([gp(0.34, 0), gp(1, 0), gp(1, 1), gp(0.34, 1)])} fill="#fed7aa" opacity="0.5" />
        <RisingArrows at={0} step={step} animate={animate} cx={196} cy={100} rotate={0} color="#ea580c" count={2} />
        <CSText x={196} y={64} color="#c2410c" size={6}>{V.groundHeating}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate} enter="animate-board-front">
        <polygon points={P(wedge)} fill={COLD_FILL} stroke={COLD} strokeWidth="1" />
        <CSText x={40} y={92} color={COLD}>{V.coldAir}</CSText>
        <CSText x={178} y={86} color={WARM}>{V.warmHumidAir}</CSText>
      </Appear>
      <RisingArrows at={1} step={step} animate={animate} cx={118} cy={92} rotate={-32} color={WARM} />
      <RisingArrows at={1} step={step} animate={animate} cx={96} cy={76} rotate={-32} color={WARM} count={2} />
      <Appear at={2} step={step} animate={animate}>
        {/* 시어는 «차이»라 화살표 하나로는 안 읽힌다 — 위는 길고 동쪽으로, 아래는
            짧고 서쪽으로 두 개를 한 단계에 같이 둔다. */}
        <BroadArrow x1={64} y1={22} x2={196} y2={18} color="#7c3aed" bend={0.02} w0={7} w1={3} />
        <BroadArrow x1={116} y1={48} x2={72} y2={46} color="#7c3aed" bend={0.02} w0={5} w1={2} />
        <CSText x={128} y={10} color="#6d28d9" size={6}>{V.windShear}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={146} groundY={114} topY={26} animate={animate} grow={step === 3} />
        <CSRain x={134} y0={84} y1={114} count={6} gap={6} slant={16} width={1.7} animate={animate} />
        <CSText x={70} y={112} color="#1e3a8a" size={6}>{V.organizedStorm}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/**
 * 산불 경보급 4단계 「번짐」의 기하 — **단일 소유자**. 캡션이 *"작은 불씨 하나가
 * 바람을 타고 순식간에 번져요"*이므로 출발 → 경로 → 도착 셋이 좌표로 존재해야 한다.
 * 🔴 **동쪽(x 증가)이 곧 바람 아래**다: 1단계 활강풍 화살표가 134 → 220이므로
 *    `src < 도착점` · `arcFrom[0] < arcTo[0]`이 이 장면의 계약이다.
 *    종전 판은 불티가 `cx = 168 − 17i`로 서쪽으로 가 **바람을 거슬렀다**.
 */
const SGW = {
  ground: fp(0, 0)[1], // 지표선 — 불꽃·나무 밑동이 전부 여기 선다
  src: 152, // 출발 — 산(화면 x 105~144) 바로 동쪽, 작은 불씨 하나
  trees: [164, 186, 202], // 풍하쪽 숲 = 새 불이 붙을 연료
  arcFrom: [156, 110],
  apex: [182, 84],
  arcTo: [208, 106],
  embers: [[164, 99], [173, 92], [190, 90], [200, 99]],
  // 도착 — [x, 높이]. 멀수록 나중에 붙은 불이라 작다. 셋 다 `src`보다 동쪽이고,
  // 가장 가까운 새 불(13)이 출발한 불씨(8)보다 크다 = 「순식간에 번졌다」.
  spots: [[176, 13], [195, 10], [209, 7]],
};

/** siberian_gale_wildfire: 찬 건조 기단 → 산 넘는 바람 → 일사로 더 마름 → 불씨 확산 */
function SiberianGaleWildfireScene({ step, animate }) {
  return (
    <BlockFrame>
      <Appear at={0} step={step} animate={animate}>
        <polygon points={P([fp(0, 0), fp(0.42, 0), fp(0.42, 0.56), fp(0, 0.56)])} fill="#bfdbfe" opacity="0.6" />
        <CSText x={44} y={62} color="#1d4ed8" size={6}>{V.siberianCp}</CSText>
        <CSText x={44} y={80} color="#1d4ed8" size={6}>{V.coldDry}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <polygon points={P([gp(0.42, 0), gp(0.58, 0), gp(0.5, 1)])} fill="#a8a29e" opacity="0.7" />
        <CSText x={128} y={96} color="#57534e" size={5.5}>{V.mountainRange}</CSText>
        <BroadArrow x1={54} y1={54} x2={122} y2={44} color="#0e7490" bend={-0.06} w0={9} w1={4} />
        {/* 활강풍 — **4단계 비화의 방향을 결정하는 화살표**. 테스트가 「동쪽」을 손으로
            적지 않고 여기서 부호를 캐 가므로, 이 화살표를 뒤집으면 비화 단정이 운다. */}
        <g data-cs="wind" data-cs-x1="134" data-cs-x2="220">
          <BroadArrow x1={134} y1={48} x2={220} y2={86} color="#c2410c" bend={0.12} w0={8} w1={3} />
        </g>
        <CSText x={196} y={64} color="#c2410c" size={6}>{V.dryWarmWind}</CSText>
        <CSText x={128} y={116} color="#92400e" size={6}>{V.driedLeavesTwigs}</CSText>
        {/* 풍하(동)쪽 숲 — 불씨가 떨어질 곳에 **탈 것**이 있어야 4단계의 새 불이
            성립한다. `WildfireRiskScene`과 같은 `ConiferTree` 관용구다. */}
        {SGW.trees.map((x) => <ConiferTree key={x} x={x} y={SGW.ground} h={12} />)}
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <SunShape x={216} y={26} scale={1.1} fill="#f59e0b" />
        {[186, 208, 230].map((x) => (
          <BroadArrow key={x} x1={x} y1={44} x2={x - 6} y2={92} color="#f59e0b" bend={0.02} w0={4} w1={2} />
        ))}
        <CSText x={196} y={40} color="#b45309" size={6}>{V.strongSun}</CSText>
      </Appear>
      {/* 3 — **비화로 번진다**. 종전 판은 정지한 주황색 타원 두 겹이었고, 불티가
          `cx = 168 − 17i`로 **서쪽**(바람 반대)으로 갔으며, 도착이 없었다.
          GL과 같은 문법으로 셋을 세운다: 출발(작은 불씨 하나) → 경로(바람을 타고
          나는 포물선) → 도착(떨어진 자리마다 새 불). 조사 §3A의 비화(spotting)다. */}
      <Appear at={3} step={step} animate={animate}>
        <Flame x={SGW.src} y={SGW.ground} h={8} role="source" animate={animate} />
        <SmokePlume x={SGW.src + 4} y={SGW.ground - 10} animate={animate} />
        {/* 경로 — 두 도막으로 포물선. 둘 다 **동쪽으로** 간다(1단계 활강풍 134→220과
            같은 부호). 이 부호가 어긋나면 「바람을 타고」를 반대로 가르친다. */}
        <g
          data-cs="ember"
          data-cs-x1={SGW.arcFrom[0].toFixed(1)} data-cs-y1={SGW.arcFrom[1].toFixed(1)}
          data-cs-x2={SGW.arcTo[0].toFixed(1)} data-cs-y2={SGW.arcTo[1].toFixed(1)}
        >
          <BroadArrow
            x1={SGW.arcFrom[0]} y1={SGW.arcFrom[1]} x2={SGW.apex[0]} y2={SGW.apex[1]}
            color="#f97316" bend={-0.22} w0={5} w1={3} opacity={0.9}
          />
          <BroadArrow
            x1={SGW.apex[0]} y1={SGW.apex[1]} x2={SGW.arcTo[0]} y2={SGW.arcTo[1]}
            color="#f97316" bend={-0.22} w0={3.4} w1={2} opacity={0.9}
          />
          {SGW.embers.map(([cx, cy], i) => (
            <circle
              key={cx} cx={cx} cy={cy} r={2 - i * 0.3} fill="#f97316"
              className={anim(animate, 'animate-board-sun-pulse')}
            />
          ))}
        </g>
        {/* 도착 — 떨어진 자리마다 새 불. 멀수록 나중에 붙은 불이라 작다(시간 순서가
            크기로 읽힌다). 가장 가까운 새 불이 출발한 불씨보다 크다 = 「순식간에」. */}
        {SGW.spots.map(([x, h], i) => (
          <Flame key={x} x={x} y={SGW.ground} h={h} role="spot" animate={animate} delay={0.2 + i * 0.25} />
        ))}
        <CSText x={148} y={78} color="#c2410c" size={6}>{V.embersRideWind}</CSText>
        <CSText x={198} y={100} color="#c2410c" size={5.5}>{V.spotFireAhead}</CSText>
        <CSText x={100} y={14} color="#b45309" size={6}>{V.clearSkyWildfire}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** front_convergence_flood: 정체 → 습기 유입 → 햇볕 차단 → 물 고임 */
function FrontConvergenceFloodScene({ step, animate }) {
  return (
    <BlockFrame sea={{ to: 0.18 }}>
      <Appear at={0} step={step} animate={animate}>
        <polygon points={P([fp(0, 0), fp(0.46, 0), fp(0.46, 0.5), fp(0, 0.5)])} fill="#93c5fd" opacity="0.5" />
        <polygon points={P([fp(0.54, 0), fp(1, 0), fp(1, 0.5), fp(0.54, 0.5)])} fill="#fca5a5" opacity="0.42" />
        <path d={`M${P([fp(0.5, 0)])} L${P([fp(0.5, 0.68)])}`} stroke="#7c3aed" strokeWidth="1.6" strokeDasharray="4 3" fill="none" />
        <CSText x={56} y={26} color="#6d28d9" size={6}>{V.stationaryFront}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <BroadArrow x1={26} y1={102} x2={112} y2={92} color="#0d9488" bend={0.08} w0={9} w1={4} />
        <BroadArrow x1={26} y1={116} x2={98} y2={108} color="#0d9488" bend={0.06} w0={7} w1={3} />
        <CSText x={58} y={78} color="#0f766e" size={6}>{V.vapourKeepsArriving}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <LayerCloud x={110} y={54} w={104} dark animate={animate} grow={step === 2} />
        <LayerCloud x={184} y={50} w={84} dark animate={animate} grow={step === 2} />
        <CSText x={158} y={26} color="#475569" size={6}>{V.cloudBlocksSun}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSRain x={96} y0={66} y1={112} count={5} gap={7} slant={4} slow animate={animate} />
        <CSRain x={142} y0={66} y1={112} count={5} gap={7} slant={4} slow animate={animate} />
        <CSRain x={186} y0={64} y1={112} count={4} gap={7} slant={4} slow animate={animate} />
        <polygon points={P([gp(0, 0), gp(1, 0), gp(1, 1), gp(0, 1)])} fill="#38bdf8" opacity="0.5" />
        <CSText x={128} y={110} color="#0c4a6e" size={6}>{V.groundCannotAbsorb}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** tropical_cyclone_genesis: 바다 가열 → 잠열 방출 → 약한 시어로 조직 → 눈벽 */
function CycloneGenesisScene({ step, animate }) {
  return (
    <BlockFrame sea={{ to: 1 }}>
      <Appear at={0} step={step} animate={animate}>
        <SunShape x={30} y={24} scale={1.1} fill="#f59e0b" />
        <polygon points={P([gp(0, 0), gp(1, 0), gp(1, 1), gp(0, 1)])} fill="#fca5a5" opacity="0.3" />
        <CSText x={58} y={108} color={WARM} size={6}>{V.warmHumidAir}</CSText>
      </Appear>
      <RisingArrows at={0} step={step} animate={animate} cx={128} cy={100} rotate={0} color={WARM} />
      <Appear at={1} step={step} animate={animate}>
        <PuffCloud x={128} y={64} scale={1.1} />
      </Appear>
      {/* 연료 라벨은 **3단계 전까지만** 띄운다(`until`). 문장이 길어 상자 가운데를
          가로지르는데, 4단계에서 눈벽 기둥 둘이 정확히 그 자리에 서기 때문이다 —
          짧게 줄이면 뜻이 뭉개지고, 옆으로 밀 자리는 상자에 없다. 그 단계의 캡션이
          같은 말을 하고 있으므로 라벨이 물러나도 잃는 것이 없다. */}
      <Appear at={1} until={2} step={step} animate={animate}>
        <CSText x={128} y={92} color="#b91c1c" size={6}>{V.latentHeatFuel}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        {/* 시어가 **작다**는 것은 위아래 화살표가 **같은 쪽으로 나란한** 것으로 읽힌다
            — squall의 시어(서로 반대)와 일부러 대비를 이룬다. */}
        <BroadArrow x1={92} y1={26} x2={164} y2={24} color="#7c3aed" bend={0.02} w0={5} w1={3} />
        <BroadArrow x1={92} y1={48} x2={158} y2={46} color="#7c3aed" bend={0.02} w0={5} w1={3} />
        <CSText x={128} y={12} color="#6d28d9" size={6}>{V.lowShearColumn}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate} enter="animate-board-grow">
        <CbTower x={104} groundY={112} topY={30} animate={animate} grow={step === 3} />
        <CbTower x={162} groundY={112} topY={34} animate={animate} grow={step === 3} />
        <CSText x={128} y={118} color="#7f1d1d" size={6}>{V.eyewallStrongest}</CSText>
      </Appear>
    </BlockFrame>
  );
}

/** greenhouse_tropical_night: 낮 축열 → 장파 방출 → 수증기가 되돌림 → 안 식는 밤 */
function TropicalNightScene({ step, animate }) {
  return (
    <BlockFrame night>
      <Appear at={0} step={step} animate={animate}>
        <polygon points={P([gp(0, 0), gp(1, 0), gp(1, 1), gp(0, 1)])} fill="#f97316" opacity="0.42" />
        <CSText x={128} y={112} color="#7c2d12" size={6}>{V.heatAccumulates}</CSText>
      </Appear>
      <Appear at={1} step={step} animate={animate}>
        <RisingArrows at={1} step={step} animate={animate} cx={92} cy={96} rotate={0} color="#fb923c" count={2} />
        <RisingArrows at={1} step={step} animate={animate} cx={168} cy={96} rotate={0} color="#fb923c" count={2} />
        <CSText x={128} y={78} color="#fdba74" size={6}>{V.groundEmitsLongwave}</CSText>
      </Appear>
      <Appear at={2} step={step} animate={animate}>
        <polygon points={P([fp(0, 0.3), fp(1, 0.3), fp(1, 0.62), fp(0, 0.62)])} fill="#38bdf8" opacity="0.22" />
        <BroadArrow x1={116} y1={54} x2={104} y2={92} color="#fb923c" bend={0.1} w0={6} w1={3} />
        <BroadArrow x1={168} y1={54} x2={180} y2={92} color="#fb923c" bend={-0.1} w0={6} w1={3} />
        <CSText x={128} y={46} color="#7dd3fc" size={6}>{V.longwaveTrapped}</CSText>
      </Appear>
      <Appear at={3} step={step} animate={animate}>
        <CSText x={128} y={18} color="#fca5a5" size={6}>{V.noWindNoMixing}</CSText>
      </Appear>
    </BlockFrame>
  );
}

// ── 스토리보드 레지스트리 (board_rules.json 전 규칙 — explain을 메커니즘 순서로 분해) ──
// ⚠️ i18n 외부화 제외(R11-01 §6.3 판정): boardVisual.render.test가 이 모듈 데이터
// (steps·title)를 렌더 HTML과 **문자열 대조**하고, crossSectionWebgl.contract가
// steps.length를 SCENES 단계와 정합 검사한다. 장면 내 CSText 라벨·scenes.js 라벨
// 스프라이트와 한 묶음(rule_id 파생 과학 콘텐츠 클러스터)이라 부분 번역 시 SVG↔GL
// 표기가 어긋난다 — 로케일화는 테스트가 리소스를 읽도록 바뀌는 후속 웨이브에서.
export const SCENE_BY_RULE = {
  cold_front_shower: ColdFrontScene,
  stationary_front_monsoon: MonsoonScene,
  warm_front_steady_rain: WarmFrontScene,
  siberian_snow: SiberianSnowScene,
  convective_shower: ConvectiveScene,
  radiation_fog: RadiationFogScene,
  north_pacific_heatwave: HeatwaveScene,
  siberian_clear: SiberianClearScene,
  okhotsk_sea_fog: OkhotskSeaFogScene,
  okhotsk_foehn_clear: OkhotskFoehnScene,
  yangtze_mild_clear: YangtzeMildClearScene,
  yangtze_morning_fog: YangtzeMorningFogScene,
  dry_convection_clear: DryConvectionClearScene,
  wildfire_risk_dry_gale: WildfireRiskScene,
  flood_risk_saturated_inflow: FloodRiskScene,
  // ㉣ 변동 기상요소 3종(2026-08-18) — 규칙만 있고 장면이 없어 main이 빨갛던 자리.
  cold_front_squall_storm: SquallStormScene,
  siberian_gale_wildfire: SiberianGaleWildfireScene,
  front_convergence_flood: FrontConvergenceFloodScene,
  // 태풍 씨앗·열대야(2026-08-18) — 같은 공백이 두 번째로 반복돼 함께 채웠다.
  tropical_cyclone_genesis: CycloneGenesisScene,
  greenhouse_tropical_night: TropicalNightScene,
};

/**
 * rule_id → {title, Scene, steps} — **title·steps는 리소스 파생**(MT-28).
 *
 * 인덱싱 형태(`STORYBOARDS[ruleId]?.steps`)와 미지 키 undefined 폴백을 그대로
 * 유지한다. 접근 시점의 로케일로 풀리므로 로케일 전환이 즉시 반영되고, ko 값이
 * 원문과 바이트 동일이라 한국어를 단정하는 스모크가 그대로 통과한다.
 *
 * `steps` 길이의 소유자는 **리소스**다 — 코드가 길이를 따로 알면 리소스와 어긋난
 * 순간 조용히 잘린 스토리보드가 나온다(그래서 translateList를 썼다).
 */
export const STORYBOARDS = {};
for (const [ruleId, Scene] of Object.entries(SCENE_BY_RULE)) {
  Object.defineProperty(STORYBOARDS, ruleId, {
    enumerable: true,
    get: () => ({
      title: tx(`board.panel.story.${ruleId}.title`),
      Scene,
      steps: txList(`board.panel.story.${ruleId}.steps`),
    }),
  });
}

// ── 패널 본체 ───────────────────────────────────────────────────────────────
/**
 * @param zoneResult 존 판정 {zone, zone_name, phenomenon, cloud, rule_id, explain}
 * @param confirmed  true면 서버 확정 판정 리플레이(배지 구분)
 * @param reduced    (테스트용) prefers-reduced-motion 강제 오버라이드
 */
export default function CrossSectionPanel({ zoneResult, confirmed = false, reduced: reducedProp }) {
  const t = useT();
  const systemReduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  /**
   * WebGL2 사용 여부 — 초기값 false가 곧 SSR·하이드레이션 폴백이다.
   * (SSR에서 <canvas>가 나오면 보드 비주얼 스모크의 "강수 존 없으면 Canvas 미마운트"
   *  계약이 깨지므로, GL 판정은 반드시 마운트 후에만 한다.)
   */
  const [glOk, setGlOk] = useState(false);
  const [glFailed, setGlFailed] = useState(false);

  const reduced = reducedProp ?? systemReduced;
  const ruleId = zoneResult?.rule_id ?? null;
  const story = ruleId ? STORYBOARDS[ruleId] : null;
  const storyKey = `${zoneResult?.zone ?? ''}-${ruleId ?? zoneResult?.phenomenon ?? ''}-${confirmed ? 'c' : 'p'}`;

  // WebGL2 지원 판정 — 마운트 후 1회(브라우저 전용). 실패 시 SVG 경로 유지.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setGlOk(supportsWebGL2());
  }, []);

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
      {zoneResult.zone_name ? `${zoneLabel({ name: zoneResult.zone_name }, zoneResult.zone, t)} — ` : ''}
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
        {confirmed ? t('board.panel.badgeConfirmed') : t('board.panel.badgePreview')}
      </span>
      {reduced && (
        <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
          {t('board.panel.badgeStatic')}
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
              {zoneResult.explain ?? t('board.panel.noRule')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { Scene, steps, title } = story;
  const displayStep = reduced ? steps.length - 1 : step;
  const atEnd = step >= steps.length - 1;
  // 3D 경로 조건 — 하나라도 어긋나면 아래 <Scene>(SVG 스토리보드)이 그대로 쓰인다
  const useGL = glOk && !glFailed && !reduced;
  const svgScene = <Scene step={displayStep} animate={!reduced} />;

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
        {useGL ? (
          <Suspense fallback={svgScene}>
            <CrossSectionGL ruleId={ruleId} step={displayStep} onFail={() => setGlFailed(true)} />
          </Suspense>
        ) : (
          svgScene
        )}
        {badges}
        <span className="absolute bottom-1.5 left-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
          {t('board.panel.badgeCaption', { title })}
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
                    {t('board.panel.stepCounter', { n: step + 1, total: steps.length })}
                  </span>{' '}
                  {steps[step]}
                </p>

                {/* 재생 컨트롤 + 단계 점프 도트 */}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => jump(step - 1)}
                    disabled={step === 0}
                    aria-label={t('board.panel.prevStep')}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                  >
                    ◁
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? t('board.panel.pause') : t('board.panel.play')}
                    className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-700"
                  >
                    {playing ? t('board.panel.pauseBtn') : atEnd ? t('board.panel.replayBtn') : t('board.panel.playBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => jump(step + 1)}
                    disabled={atEnd}
                    aria-label={t('board.panel.nextStep')}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                  >
                    ▷
                  </button>
                  <div className="ml-1 flex items-center gap-1" role="group" aria-label={t('board.panel.jumpGroup')}>
                    {steps.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => jump(i)}
                        aria-label={t('board.panel.jumpTo', { n: i + 1 })}
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

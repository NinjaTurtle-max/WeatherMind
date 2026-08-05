/**
 * realisticEffects — 절차적 실사 이펙트 프리미티브 (R9-08 §A).
 *
 * 외부 이미지·라이브러리 금지(자체 제작 원칙) — 전부 절차적 생성:
 *  - feTurbulence + feDisplacementMap 구름 질감 (위성영상 지향 — 기준 이미지 상.png)
 *  - SVG 방사형 그라디언트 색 번짐(기단 대기 덩어리감 — 기준 이미지 하.png)
 *  - Canvas 2D 파티클 강수(비 사선 줄기 + 지면 스플래시 암시, 눈 흔들 낙하)
 *
 * 성능 계약(R9-08):
 *  - 파티클 총량 ≤ precipEngine.MAX_PARTICLES(200)
 *  - 탭 비활성(visibilitychange)·뷰포트 밖(IntersectionObserver) 시 rAF 정지
 *  - dt 클램프로 30fps 하한에서도 물리 안정 (precipEngine.stepSystem)
 *  - prefers-reduced-motion: 정적 최종 장면 1프레임만 그리고 정지
 *
 * SSR: Canvas 접근은 useEffect + typeof window 가드 안에서만 — renderToString
 * 경로에서는 <canvas> 마크업만 나오고 어떤 window/document 접근도 없다.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_PARTICLES, createSystem, stepSystem, shouldAnimate } from './precipEngine';

// ── 모션 훅 ─────────────────────────────────────────────────────────────────
/** prefers-reduced-motion 훅 (구 boardAnimations에서 이관 — 이중 안전망 유지) */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** 애니메이션 클래스 헬퍼 — animate=false면 정적(클래스 미부여) */
export const anim = (animate, cls) => (animate ? `svg-anim ${cls}` : 'svg-anim');

// ── Canvas 강수 파티클 ──────────────────────────────────────────────────────
/**
 * PrecipCanvas — 지도의 강수 존 위에 비/눈 파티클을 그리는 오버레이 캔버스.
 * @param emitters [{fx, fy, fw, fh, kind:'rain'|'snow', weight?, slant?}]
 *                 fx·fy·fw·fh는 캔버스 크기 대비 0~1 분율(리사이즈 대응)
 * @param reduced  true면 정적 1프레임(최종 장면)만 그리고 정지
 * @param cap      파티클 상한(기본·최대 MAX_PARTICLES=200)
 */
export function PrecipCanvas({ emitters, reduced = false, cap = MAX_PARTICLES, className = '' }) {
  const ref = useRef(null);
  const emittersKey = JSON.stringify(emitters ?? []);

  useEffect(() => {
    // SSR/미마운트 가드 — Canvas API는 브라우저에서만 존재한다
    if (typeof window === 'undefined') return undefined;
    const canvas = ref.current;
    if (!canvas || typeof canvas.getContext !== 'function') return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const parsed = JSON.parse(emittersKey);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let sys = null;
    let raf = 0;
    let running = false;
    let last = 0;
    let hidden = document.visibilityState === 'hidden';
    let inView = true;

    const rebuild = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const w = canvas.width;
      const h = canvas.height;
      sys = createSystem(
        parsed.map((e) => ({
          x: e.fx * w, y: e.fy * h, w: e.fw * w, h: e.fh * h,
          kind: e.kind, weight: e.weight, slant: e.slant,
        })),
        cap,
      );
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of sys.particles) {
        const em = sys.emitters[p.e];
        if (!em) continue;
        if (p.kind === 'snow') {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.8, p.len * 0.6) * dpr, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const nearGround = p.y > em.y + em.h * 0.92;
          ctx.strokeStyle = nearGround ? 'rgba(186,230,253,0.85)' : 'rgba(125,196,240,0.75)';
          ctx.lineWidth = 1.1 * dpr;
          ctx.lineCap = 'round';
          ctx.beginPath();
          if (nearGround) {
            // 지면 스플래시 암시 — 낙하 끝에서 짧은 가로 튐
            ctx.moveTo(p.x - p.len * 0.4, p.y);
            ctx.lineTo(p.x + p.len * 0.4, p.y);
          } else {
            const k = p.vy > 0 ? p.len / p.vy : 0; // 속도 방향으로 사선 줄기
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * k, p.y - p.len);
          }
          ctx.stroke();
        }
      }
    };

    const frame = (t) => {
      raf = 0;
      if (!shouldAnimate({ reduced, hidden, inView })) {
        running = false;
        return;
      }
      const dt = last ? (t - last) / 1000 : 0.016;
      last = t;
      stepSystem(sys, dt); // 내부에서 dt ≤ 0.05s 클램프(30fps 하한 안정)
      draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || !sys || sys.particles.length === 0) return;
      if (!shouldAnimate({ reduced, hidden, inView })) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    rebuild();
    if (reduced) {
      stepSystem(sys, 0.03); // 정적 최종 장면 1프레임
      draw();
    } else {
      start();
    }

    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (!hidden) start(); // frame 가드가 hidden이면 스스로 멈춘다
    };
    document.addEventListener('visibilitychange', onVisibility);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          inView = entries[0]?.isIntersecting ?? true;
          if (inView) start();
        })
      : null;
    io?.observe(canvas);

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          rebuild();
          if (reduced) {
            stepSystem(sys, 0.03);
            draw();
          }
        })
      : null;
    ro?.observe(canvas);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      io?.disconnect();
      ro?.disconnect();
    };
  }, [emittersKey, reduced, cap]);

  if (!Array.isArray(emitters) || emitters.length === 0) return null;
  return (
    <canvas
      ref={ref}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden="true"
    />
  );
}

// ── SVG defs (그라디언트·터뷸런스 필터) ─────────────────────────────────────
/**
 * InfographicDefs — 지도 인포그래픽 공용 defs. PeninsulaMap svg 안에서 1회 렌더.
 * id는 wm- 접두사로 고정(보드 화면에 svg 1개만 존재).
 */
export function InfographicDefs() {
  return (
    <defs>
      {/* 바다·지형 — 밝은 인포그래픽 톤(기준 이미지 하.png) + 은은한 음영 */}
      <linearGradient id="wm-sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e3edf6" />
        <stop offset="55%" stopColor="#d7e5f2" />
        <stop offset="100%" stopColor="#c9dbec" />
      </linearGradient>
      {/* 땅은 초록 계열이다(2026-08-05 결정, 시안 board_mockup 기준). 이전 베이지는
          바다(청회색)와 명도가 붙어서 "여기가 땅"이 한눈에 안 들어왔다 — 학습자가
          처음 보는 화면이라 지형임이 먼저 읽히는 쪽을 택한다. */}
      <linearGradient id="wm-land" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#D3EBCB" />
        <stop offset="55%" stopColor="#C2E2B7" />
        <stop offset="100%" stopColor="#AFD9A4" />
      </linearGradient>
      {/* 지형 그레인(wm-terrain)은 제거됐다 — 보드 지형이 "질감 없이 단순하게"로
          가면서 쓰는 곳이 사라졌고, 매 프레임 feTurbulence를 도는 비용만 남았다.
          되살릴 일이 있으면 git 이력에서 꺼낼 것. */}
      {/* 구름 질감 — 터뷸런스 변위로 가장자리를 찢는다(상.png 지향) */}
      <filter id="wm-cloud-turb" x="-45%" y="-45%" width="190%" height="190%">
        <feTurbulence type="fractalNoise" baseFrequency="0.14 0.2" numOctaves="3" seed="8" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5.5" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="0.25" />
      </filter>
      {/* 안개 질감 — 더 넓은 변위 + 강한 블러(저층 확산) */}
      <filter id="wm-fog-turb" x="-45%" y="-60%" width="190%" height="220%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.16" numOctaves="3" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="0.9" />
      </filter>
      {/* 기단 색 번짐(하.png 문법: 온난=주황 / 한랭=파랑 방사형 그라디언트) */}
      <radialGradient id="wm-bloom-cold">
        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
        <stop offset="45%" stopColor="#60a5fa" stopOpacity="0.26" />
        <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="wm-bloom-cool">
        <stop offset="0%" stopColor="#0891b2" stopOpacity="0.48" />
        <stop offset="45%" stopColor="#22d3ee" stopOpacity="0.24" />
        <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="wm-bloom-warm">
        <stop offset="0%" stopColor="#ea580c" stopOpacity="0.48" />
        <stop offset="45%" stopColor="#fb923c" stopOpacity="0.26" />
        <stop offset="100%" stopColor="#fdba74" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="wm-bloom-warmdry">
        <stop offset="0%" stopColor="#d97706" stopOpacity="0.45" />
        <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.24" />
        <stop offset="100%" stopColor="#fcd34d" stopOpacity="0" />
      </radialGradient>
      {/* 태양 글로우(맑음·폭염) */}
      <radialGradient id="wm-sun-glow">
        <stop offset="0%" stopColor="#fde047" stopOpacity="0.9" />
        <stop offset="45%" stopColor="#fcd34d" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
      </radialGradient>
      {/* 구름 몸체 명암 */}
      <linearGradient id="wm-cb-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="55%" stopColor="#94a3b8" />
        <stop offset="100%" stopColor="#475569" />
      </linearGradient>
      <linearGradient id="wm-ns-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#cbd5e1" />
        <stop offset="100%" stopColor="#64748b" />
      </linearGradient>
    </defs>
  );
}

// ── 실사풍 구름 덩어리 (feTurbulence 질감) ──────────────────────────────────
// 현상별 형태(R9-08 §A): 적란운=수직 발달 짙은 덩어리 / 층운·비층운=넓고 평평 /
// 안개=지면 저층 확산 / 눈구름=밝은 덩어리 / 적운=작은 뭉게 조각.
const CLOUD_VARIANTS = {
  cumulonimbus: {
    filter: 'wm-cloud-turb',
    body: (
      <g>
        <ellipse cx="0.5" cy="-8.5" rx="7.5" ry="2.4" fill="#f8fafc" opacity="0.95" />
        <ellipse cx="-1.5" cy="-5.5" rx="5" ry="3.2" fill="url(#wm-cb-body)" />
        <ellipse cx="1.8" cy="-2.4" rx="5.6" ry="3.4" fill="url(#wm-cb-body)" />
        <ellipse cx="0" cy="1.2" rx="6.4" ry="2.8" fill="#475569" />
      </g>
    ),
  },
  nimbostratus: {
    filter: 'wm-cloud-turb',
    body: (
      <g>
        <ellipse cx="-4.5" cy="-2.4" rx="6" ry="2.4" fill="url(#wm-ns-body)" />
        <ellipse cx="3.5" cy="-3" rx="6.5" ry="2.6" fill="url(#wm-ns-body)" />
        <ellipse cx="0" cy="0.6" rx="9.5" ry="2.2" fill="#64748b" />
      </g>
    ),
  },
  snowcloud: {
    filter: 'wm-cloud-turb',
    body: (
      <g>
        <ellipse cx="-4" cy="-2.4" rx="5.5" ry="2.4" fill="#e2e8f0" />
        <ellipse cx="3.5" cy="-3" rx="6" ry="2.6" fill="#cbd5e1" />
        <ellipse cx="0" cy="0.6" rx="8.5" ry="2" fill="#94a3b8" />
      </g>
    ),
  },
  stratus: {
    filter: 'wm-cloud-turb',
    body: (
      <g opacity="0.9">
        <ellipse cx="-3" cy="-1.6" rx="9" ry="1.8" fill="#e2e8f0" />
        <ellipse cx="3" cy="0.8" rx="10" ry="1.8" fill="#cbd5e1" />
      </g>
    ),
  },
  fog: {
    filter: 'wm-fog-turb',
    body: (
      <g>
        <ellipse cx="0" cy="0" rx="12" ry="2.2" fill="#f8fafc" opacity="0.85" />
        <ellipse cx="-3" cy="1.8" rx="10" ry="1.7" fill="#f1f5f9" opacity="0.75" />
        <ellipse cx="4" cy="-1.6" rx="8" ry="1.5" fill="#ffffff" opacity="0.6" />
      </g>
    ),
  },
  cumulus: {
    filter: 'wm-cloud-turb',
    body: (
      <g opacity="0.92">
        <ellipse cx="-2.5" cy="0" rx="4" ry="2" fill="#f8fafc" />
        <ellipse cx="2.5" cy="0.6" rx="3.4" ry="1.7" fill="#f1f5f9" />
      </g>
    ),
  },
};

/**
 * RealCloudMass — 터뷸런스 질감 구름 덩어리. 표류(cloud-drift) + 부풀기(billow).
 * @param flash true면 구름 내부 섬광(뇌우) 추가
 */
export function RealCloudMass({ variant = 'cumulus', x = 0, y = 0, scale = 1, animate = true, flash = false }) {
  const v = CLOUD_VARIANTS[variant] ?? CLOUD_VARIANTS.cumulus;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        {flash && (
          <ellipse
            cx="0" cy="0" rx="4.5" ry="2.8" fill="#fef08a"
            className={animate ? 'animate-board-flash' : ''}
            opacity={animate ? undefined : 0.55}
          />
        )}
        <g className={anim(animate, 'animate-cloud-billow')}>
          <g filter={`url(#${v.filter})`}>{v.body}</g>
        </g>
      </g>
    </g>
  );
}

/** SunGlint — 맑음/폭염 존의 태양 글로우 */
export function SunGlint({ x = 0, y = 0, hot = false, animate = true }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <g className={anim(animate, 'animate-board-sun-pulse')}>
        <circle r={hot ? 8 : 6.5} fill="url(#wm-sun-glow)" />
        <circle r={hot ? 2.4 : 2} fill={hot ? '#fb923c' : '#fde047'} />
      </g>
    </g>
  );
}

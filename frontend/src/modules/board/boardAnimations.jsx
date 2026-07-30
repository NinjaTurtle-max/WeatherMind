/**
 * boardAnimations — rule_id→현상 애니메이션 프리셋 8종 + 현상 스테이지 (R9-01 §3.3 ④).
 *
 * 로컬 미리보기 엔진(lib/boardEngine.evaluateBoard)의 존별 결과
 * {zone, zone_name, phenomenon, cloud, rule_id, explain}로 즉시 재생한다 —
 * 서버 계약 불변(판정 권위는 서버, 애니메이션은 표현 레이어).
 * 서버 판정 후에는 AnswerResult.phenomena(같은 형태)로 확정 리플레이한다.
 *
 * 프리셋 매핑(board_rules.json 8종 — rule_id 하드 매핑):
 *   cold_front_shower        → 한랭전선 쐐기 진입 + 적란운 상승 + 사선 소나기 + 번개
 *   stationary_front_monsoon → 정체전선 밴드 정체(드리프트) + 비층운 + 지속 비
 *   warm_front_steady_rain   → 온난전선 완만한 활승 + 난층운 + 넓은 약한 비
 *   siberian_snow            → cP 기단 서해 이동 + 눈구름 + 눈송이 낙하
 *   convective_shower        → 강한 일사 + 상승기류 + 적란운 발달 + 소나기
 *   radiation_fog            → 약한 일사 + 지표 안개층 드리프트
 *   north_pacific_heatwave   → mT 기단 + 태양 맥동 + 지면 아지랑이
 *   siberian_clear           → cP 기단 + 맑은 하늘(태양)
 * rule_id 미등록(구/신 규칙 드리프트) 시 phenomenon 기준 폴백, 그마저 없으면 흐림.
 *
 * prefers-reduced-motion: 애니메이션 클래스를 아예 붙이지 않은 정적 장면으로
 * 대체한다(§3.3 — index.css의 전역 차단과 이중 안전망). 캡션은 항상 표시.
 *
 * 인라인 SVG + Tailwind keyframes만 사용(외부 라이브러리·에셋 금지).
 */
import { useEffect, useState } from 'react';
import { phenomenonMeta, cloudMeta } from './boardDisplay';
import { Glyph, SymbolIcon, CloudShape, SunShape, SnowFlake, WaveLine } from './boardSymbols';

// ── prefers-reduced-motion 훅 ───────────────────────────────────────────────
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

// ── 장면 공용 프리미티브 ────────────────────────────────────────────────────
/** 무대 프레임 — 하늘은 부모 그라디언트, 지면 띠만 그린다. viewBox 120×64 */
function Scene({ children }) {
  return (
    <svg viewBox="0 0 120 64" className="block h-auto w-full" aria-hidden="true">
      {children}
      <rect x="0" y="57" width="120" height="7" fill="#bbf7d0" />
    </svg>
  );
}

/** 애니메이션 클래스 헬퍼 — animate=false면 정적(클래스 미부여) */
const anim = (animate, cls) => (animate ? `svg-anim ${cls}` : 'svg-anim');

/** 빗줄기 다발 — animate=false면 공중 정지(정적 결과 표시) */
function RainFall({ animate, x = 0, y = 30, count = 4, gap = 5, slant = 0, length = 6, width = 1.3, color = '#0ea5e9', slow = false }) {
  const dx = Math.tan((slant * Math.PI) / 180) * length;
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${(i - (count - 1) / 2) * gap} 0)`}>
          <g
            className={anim(animate, slow ? 'animate-board-rain-slow' : 'animate-board-rain')}
            style={animate ? { animationDelay: `${(i * 0.19).toFixed(2)}s` } : undefined}
          >
            <line x1="0" y1="0" x2={-dx} y2={length} stroke={color} strokeWidth={width} strokeLinecap="round" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** 눈송이 다발 */
function SnowFall({ animate, x = 0, y = 26, count = 4, gap = 6 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${(i - (count - 1) / 2) * gap} ${i % 2 === 0 ? 0 : 5})`}>
          <g
            className={anim(animate, 'animate-board-snow')}
            style={animate ? { animationDelay: `${(i * 0.55).toFixed(2)}s` } : undefined}
          >
            <SnowFlake r={2} color="#bae6fd" width={0.9} />
          </g>
        </g>
      ))}
    </g>
  );
}

/** 상승기류 화살표 */
function Updrafts({ animate, x = 60, y = 52, count = 3, gap = 7 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${(i - (count - 1) / 2) * gap} 0)`}>
          <g
            className={anim(animate, 'animate-board-updraft')}
            style={animate ? { animationDelay: `${(i * 0.45).toFixed(2)}s` } : undefined}
          >
            <path d="M0,4 L0,-4 M-2.2,-1.6 L0,-4 L2.2,-1.6" fill="none" stroke="#f97316" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** 번개 — 대부분 꺼져 있다 번쩍(무한). 정적 시 은은하게 표시 */
function Lightning({ animate, x = 0, y = 0 }) {
  return (
    <g transform={`translate(${x} ${y})`} className={animate ? 'animate-board-flash' : ''} opacity={animate ? undefined : 0.75}>
      <path d="M0,0 L-3,7 L0,6 L-2,13" fill="none" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// ── 프리셋 장면 8종 ─────────────────────────────────────────────────────────
/** cold_front_shower — 한랭전선 쐐기 진입 + 적란운 상승 + 소나기 + 번개 */
function ColdFrontShowerScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-board-front')}>
        {/* 찬 공기 쐐기(파고듦) */}
        <path d="M2,57 L52,57 L12,34 Z" fill="#bfdbfe" opacity="0.9" />
        <Glyph kind="front" value="cold" x={30} y={53} scale={1.1} />
      </g>
      <g transform="translate(80 22)">
        <g className={anim(animate, 'animate-board-grow')}>
          <Glyph kind="cloud" value="cumulonimbus" scale={1.5} />
        </g>
      </g>
      <Lightning animate={animate} x={74} y={36} />
      <RainFall animate={animate} x={84} y={38} count={4} slant={18} width={1.6} length={7} />
    </Scene>
  );
}

/** stationary_front_monsoon — 정체전선 밴드 + 비층운 + 여러 날 지속 비 */
function MonsoonScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <g transform="translate(60 14)">
          <Glyph kind="cloud" value="nimbostratus" scale={2.2} />
        </g>
      </g>
      <RainFall animate={animate} x={42} y={28} count={4} gap={6} length={6} slow />
      <RainFall animate={animate} x={78} y={28} count={4} gap={6} length={6} slow />
      {/* 정체전선 밴드 — 세력이 비슷해 제자리(좌우 드리프트만) */}
      <g className={anim(animate, 'animate-cloud-drift')}>
        <Glyph kind="front" value="stationary" x={60} y={50} scale={1.4} />
      </g>
    </Scene>
  );
}

/** warm_front_steady_rain — 온난전선 활승 + 난층운 + 넓고 약한 비 */
function WarmFrontRainScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-board-front')}>
        {/* 따뜻한 공기가 완만하게 타고 오르는 사면 */}
        <path d="M2,57 L86,57 L2,26 Z" fill="#fecaca" opacity="0.65" />
        <Glyph kind="front" value="warm" x={44} y={53} scale={1.1} />
      </g>
      <g transform="translate(78 14)">
        <g className={anim(animate, 'animate-board-grow')}>
          <Glyph kind="cloud" value="nimbostratus" scale={1.6} />
        </g>
      </g>
      <RainFall animate={animate} x={82} y={26} count={5} gap={6.5} length={5} width={1.1} slow />
    </Scene>
  );
}

/** siberian_snow — cP 기단이 서해를 건너며 변질 + 눈 */
function SiberianSnowScene({ animate }) {
  return (
    <Scene>
      {/* 서해(왼쪽 바다) */}
      <rect x="0" y="57" width="52" height="7" fill="#bae6fd" />
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <Glyph kind="air_mass" value="siberian" x={20} y={16} scale={0.8} />
      </g>
      <g transform="translate(72 16)">
        <g className={anim(animate, 'animate-board-grow')}>
          <CloudShape fill="#cbd5e1" scale={1.5} y={0} />
        </g>
      </g>
      <SnowFall animate={animate} x={72} y={30} count={4} gap={7} />
    </Scene>
  );
}

/** convective_shower — 강한 일사 + 대류 상승 + 적란운 + 오후 소나기 */
function ConvectiveShowerScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-board-sun-pulse')}>
        <SunShape x={18} y={13} scale={1} />
      </g>
      <Updrafts animate={animate} x={52} y={50} />
      <g transform="translate(88 20)">
        <g className={anim(animate, 'animate-board-grow')}>
          <Glyph kind="cloud" value="cumulonimbus" scale={1.4} />
        </g>
      </g>
      <RainFall animate={animate} x={90} y={36} count={3} slant={12} width={1.5} length={6} />
    </Scene>
  );
}

/** radiation_fog — 복사냉각 새벽 + 지표 안개층 */
function RadiationFogScene({ animate }) {
  return (
    <Scene>
      {/* 희미한 태양(약한 일사) */}
      <SunShape x={96} y={12} scale={0.7} fill="#fcd34d" />
      <circle cx="96" cy="12" r="7" fill="#e0f2fe" opacity="0.55" />
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <WaveLine y={38} width={70} strokeWidth={2.2} opacity={0.5} />
      </g>
      <g transform="translate(60 0)" className={anim(animate, 'animate-cloud-drift')}>
        <WaveLine y={45} width={86} strokeWidth={2.6} opacity={0.75} />
      </g>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <WaveLine y={52} width={96} strokeWidth={3} opacity={0.9} />
      </g>
    </Scene>
  );
}

/** north_pacific_heatwave — mT 기단 + 폭염(태양 맥동 + 아지랑이) */
function HeatwaveScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-board-sun-pulse')}>
        <SunShape x={30} y={15} scale={1.25} fill="#f97316" />
      </g>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <Glyph kind="air_mass" value="north_pacific" x={94} y={16} scale={0.8} />
      </g>
      {[0, 1, 2].map((i) => (
        <g
          key={i}
          transform={`translate(${48 + i * 14} 0)`}
          className={anim(animate, 'animate-board-shimmer')}
          style={animate ? { animationDelay: `${(i * 0.4).toFixed(1)}s` } : undefined}
        >
          <WaveLine y={50} width={10} color="#fb923c" strokeWidth={1.3} />
        </g>
      ))}
    </Scene>
  );
}

/** siberian_clear — cP 기단 + 춥고 맑은 하늘 */
function SiberianClearScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-board-sun-pulse')}>
        <SunShape x={62} y={16} scale={1.1} />
      </g>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <Glyph kind="air_mass" value="siberian" x={20} y={18} scale={0.8} />
      </g>
      {/* 걷혀 가는 옅은 구름 */}
      <CloudShape fill="#e2e8f0" y={30} scale={0.7} opacity={0.35} />
    </Scene>
  );
}

/** 기본 — 흐림(규칙 미성립) */
function CloudyScene({ animate }) {
  return (
    <Scene>
      <g className={anim(animate, 'animate-cloud-drift')}>
        <g transform="translate(48 22)">
          <CloudShape fill="#cbd5e1" scale={1.3} />
        </g>
      </g>
      <g className={anim(animate, 'animate-cloud-drift-slow')}>
        <g transform="translate(82 30)">
          <CloudShape fill="#94a3b8" scale={1} />
        </g>
      </g>
    </Scene>
  );
}

// ── 레지스트리 (rule_id 하드 매핑 — board_rules.json 8종) ───────────────────
export const ANIMATION_PRESETS = {
  cold_front_shower: ColdFrontShowerScene,
  stationary_front_monsoon: MonsoonScene,
  warm_front_steady_rain: WarmFrontRainScene,
  siberian_snow: SiberianSnowScene,
  convective_shower: ConvectiveShowerScene,
  radiation_fog: RadiationFogScene,
  north_pacific_heatwave: HeatwaveScene,
  siberian_clear: SiberianClearScene,
};

// rule_id 미등록 시 phenomenon 기반 폴백(규칙 드리프트 하위 호환)
const FALLBACK_BY_PHENOMENON = {
  shower: ConvectiveShowerScene,
  rain: WarmFrontRainScene,
  persistent_rain: MonsoonScene,
  snow: SiberianSnowScene,
  fog: RadiationFogScene,
  heatwave: HeatwaveScene,
  clear: SiberianClearScene,
  cloudy: CloudyScene,
};

/**
 * PhenomenonStage — 존 하나의 현상 애니메이션 무대 + explain 캡션.
 * @param zoneResult 로컬/서버 판정 항목 {zone_name, phenomenon, cloud, rule_id, explain}
 * @param confirmed  true면 서버 확정 판정 리플레이(배지 구분)
 */
export function PhenomenonStage({ zoneResult, confirmed = false }) {
  const reduced = usePrefersReducedMotion();
  if (!zoneResult) return null;

  const Preset =
    ANIMATION_PRESETS[zoneResult.rule_id] ?? FALLBACK_BY_PHENOMENON[zoneResult.phenomenon] ?? CloudyScene;
  const ph = phenomenonMeta(zoneResult.phenomenon);
  const cl = cloudMeta(zoneResult.cloud);
  // 프리셋·존이 바뀔 때 원샷 애니메이션(진입·발달)을 처음부터 리플레이
  const sceneKey = `${zoneResult.zone ?? ''}-${zoneResult.rule_id ?? zoneResult.phenomenon}-${confirmed ? 'confirmed' : 'preview'}`;

  return (
    <div className="mb-3 overflow-hidden rounded-xl ring-1 ring-slate-200">
      <div className="relative bg-gradient-to-b from-sky-200 via-sky-100 to-sky-50">
        <Preset key={sceneKey} animate={!reduced} />
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
      </div>
      {/* 캡션 = 규칙 explain (§3.3 ④) */}
      <div className="flex items-start gap-2 bg-white px-3 py-2">
        <SymbolIcon kind="phenomenon" value={zoneResult.phenomenon} className="mt-0.5 h-6 w-6" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-800">
            {zoneResult.zone_name ? `${zoneResult.zone_name} — ` : ''}
            {ph.label}
            <span className="ml-1 font-medium text-slate-400">({cl.label})</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            {zoneResult.explain ?? '아직 성립한 규칙이 없어요 — 기단·전선·습기·일사를 조합해 보세요.'}
          </p>
        </div>
      </div>
    </div>
  );
}

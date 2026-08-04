import { useCallback, useEffect, useMemo, useState } from 'react';
import { VIEW_H, VIEW_W, toUser } from './boardLayout';
import { phenomenonMeta } from './boardDisplay';
import { Glyph } from './boardSymbols';
import {
  InfographicDefs,
  PrecipCanvas,
  RealCloudMass,
  SunGlint,
  usePrefersReducedMotion,
} from './realisticEffects';
import { AirMassBloom, FlowArrow, FrontCurve, ZoneAnnotation } from './mapInfographic';
import { webglSupported } from './webgl/mapOverlay/support';
import { buildScene, cloudVariantFor, precipEmitters, sceneIsEmpty } from './webgl/mapOverlay/overlayScene';
import { useT } from '../../i18n';

// 한반도 실루엣 path (정규화 0~100 좌표 저작 — scale(1, VIEW_H/100)로 사영)
const PENINSULA_PATH =
  'M34,14 C40,10 50,12 53,20 C55,26 60,24 65,28 C70,32 67,39 71,44 C76,50 82,49 82,57 ' +
  'C82,65 74,66 70,72 C65,79 60,86 52,88 C46,89 41,86 39,80 C37,74 40,69 35,65 ' +
  'C30,61 24,60 24,52 C24,44 30,42 30,35 C30,29 28,24 32,19 C33,17 33,15 34,14 Z';

// 현상 → 지도 구름 변형 / 강수 에미터 메타는 webgl/mapOverlay/overlayScene가
// 단일 소유자다(WebGL 경로와 SVG·Canvas2D 폴백 경로가 같은 매핑을 써야 하므로).

/**
 * PeninsulaMap — 기상청 인포그래픽 문법의 한반도 일기도 (R9-08 §A, 기준 하.png).
 * 4개 지역 노드는 요소 드롭·탭 배치 대상(R9-01 드래그 UX 불변)이며, 그 위에
 *  ① 기단 색 번짐 ② 전선 곡선+표준 기호 ③ 곡선 유동 화살표
 *  ④ 현상 구름(터뷸런스 질감)+주석 라벨 ⑤ 파티클 강수
 * 를 겹친다. 판정 로직(boardEngine)은 불변 — 전부 표현 레이어.
 * prefers-reduced-motion이면 모든 레이어가 정적 최종 장면으로 대체된다.
 *
 * R10-01 S3: ①③④⑤는 WebGL2 오버레이 1장(`webgl/mapOverlay`)으로 격상됐다.
 * **베이스는 SVG 유지** — 반도 지형·존 노드·표준 전선 기호·라벨·주석은 그대로다.
 * 오버레이 캔버스는 pointer-events:none이라 존 탭·드래그 히트 테스트를 가로막지
 * 않는다(상호작용 소유자는 계속 SVG 계층).
 * 폴백 2경로: (a) WebGL2 미지원·초기화 실패·컨텍스트 소실 → 아래 SVG 레이어 +
 * Canvas2D PrecipCanvas 그대로, (b) SSR → 항상 폴백 경로(GL 접근 0).
 */
export default function PeninsulaMap({ regions, preview, board, goals, goalConditions, selected, interactive, onZoneTap, dragging = false, dragOverZone = null, zoneVisuals = null }) {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  const zonePoint = (zone) => toUser(regions[zone]?.svg_point);

  // WebGL2 가용 여부는 마운트 시 1회 탐지(모듈 캐시). SSR에서는 항상 false —
  // 이 앱은 createRoot(하이드레이션 없음)이라 첫 클라이언트 렌더에서 바로 켜도 안전하다.
  const [glCapable] = useState(() => typeof window !== 'undefined' && webglSupported());
  const [glFailed, setGlFailed] = useState(false);
  const [Overlay, setOverlay] = useState(null);
  const onGlFallback = useCallback(() => setGlFailed(true), []);

  // 오버레이 렌더러는 **동적 청크**다 — 폴백이 있는 향상 계층이므로 메인 번들에
  // 넣지 않는다. WebGL2 브라우저에서만 내려오고, SSR·미지원·청크 로드 실패에서는
  // 아래 SVG + Canvas2D 경로가 그대로 남는다(lazy+Suspense 대신 명시 상태를 쓰는
  // 이유: 청크 로드 실패를 에러 바운더리 없이 폴백으로 흡수하고, 로드되기 전까지
  // Canvas2D 강수를 계속 보여줄 수 있다).
  useEffect(() => {
    if (!glCapable || glFailed || Overlay) return undefined;
    let alive = true;
    import('./webgl/mapOverlay/MapOverlayGL')
      // setOverlay(m.default)로 넘기면 React가 컴포넌트 함수를 updater로 호출한다 —
      // 반드시 함수를 반환하는 updater 형태로 감싼다.
      .then((m) => alive && setOverlay(() => m.default))
      .catch(() => alive && setGlFailed(true));
    return () => {
      alive = false;
    };
  }, [glCapable, glFailed, Overlay]);

  // 전선 곡선(②) — 같은 subtype이 배치된 존들을 잇는 지역 스케일 곡선
  const frontZones = { cold: [], warm: [], stationary: [] };
  for (const el of board?.elements ?? []) {
    if (el.type === 'front' && frontZones[el.subtype]) {
      const [x, y] = zonePoint(el.zone);
      frontZones[el.subtype].push({ x, y });
    }
  }

  // 존 userSpace 좌표 — toUser(동결 계약)가 유일한 사영 경로. WebGL·SVG 공용.
  const zonePoints = useMemo(() => regions.map((r) => toUser(r?.svg_point)), [regions]);

  // WebGL 오버레이 장면(①③④⑤) — 순수 빌더. 그릴 것이 없으면 컨텍스트도 만들지 않는다.
  const scene = useMemo(() => buildScene({ board, zoneVisuals, zonePoints }), [board, zoneVisuals, zonePoints]);
  const glActive = glCapable && !glFailed && Boolean(Overlay) && !sceneIsEmpty(scene);

  // Canvas2D 폴백 강수 에미터(⑤) — userSpace 박스를 컨테이너 분율로 환산.
  // 박스 수치는 overlayScene.EMITTER_BOX 단일 소유(두 경로 동일 위치 보장).
  const emitters = useMemo(
    () =>
      precipEmitters(zoneVisuals, zonePoints).map((e) => ({
        fx: e.x / VIEW_W,
        fy: e.y / VIEW_H,
        fw: e.w / VIEW_W,
        fh: e.h / VIEW_H,
        kind: e.kind,
        weight: e.weight,
        slant: e.slant,
      })),
    [zoneVisuals, zonePoints],
  );

  return (
    <div className="relative mb-3 w-full overflow-hidden rounded-xl bg-[#dfe9f3] ring-1 ring-slate-200">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="group"
        aria-label={t('board.map.mapAria')}
      >
        <InfographicDefs />

        {/* 바다 + 주변 대륙 힌트(장식) — 밝은 인포그래픽 톤 */}
        <g aria-hidden="true">
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#wm-sea)" />
          {/* 대륙(북서) */}
          <path d="M0,0 L26,0 C20,6 22,13 15,19 C10,23 12,31 5,36 L0,38 Z" fill="url(#wm-land)" opacity="0.85" />
          {/* 일본 열도 힌트(남동) */}
          <path d="M100,52 C92,58 88,66 91,74 C93,78 97,80 100,80 Z" fill="url(#wm-land)" opacity="0.8" />
        </g>

        {/* 한반도 — 지형 그라디언트 + 터뷸런스 그레인 음영 + 태백 능선 */}
        <g transform={`scale(1 ${VIEW_H / 100})`} aria-hidden="true">
          <path d={PENINSULA_PATH} fill="url(#wm-land)" stroke="#a9bccb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={PENINSULA_PATH} fill="#334155" filter="url(#wm-terrain)" opacity="0.5" />
          {/* 태백산맥 능선 — 음영 + 능선 하이라이트 */}
          <path d="M56,30 L60,44 L57,58 L61,70" fill="none" stroke="#8a9a7a" strokeWidth="2" strokeLinejoin="round" opacity="0.55" vectorEffect="non-scaling-stroke" />
          <path d="M55,31 L59,44 L56,58 L60,69" fill="none" stroke="#f8fafc" strokeWidth="0.7" strokeLinejoin="round" opacity="0.5" vectorEffect="non-scaling-stroke" />
        </g>

        {/* ① 기단 색 번짐 + ③ 곡선 유동 화살표 — WebGL 오버레이가 켜지면 그쪽이 그린다 */}
        {!glActive && (board?.elements ?? [])
          .filter((el) => el.type === 'air_mass')
          .map((el) => {
            const [ux, uy] = zonePoint(el.zone);
            return (
              <g key={`air-${el.zone}`}>
                <AirMassBloom subtype={el.subtype} x={ux} y={uy} animate={animate} />
                <FlowArrow subtype={el.subtype} x={ux} y={uy} animate={animate} />
              </g>
            );
          })}

        {/* ② 전선 곡선 — 지도를 가로지르는 경로 + 표준 기호 반복 */}
        {Object.entries(frontZones).map(([subtype, pts]) =>
          pts.length > 0 ? <FrontCurve key={subtype} subtype={subtype} points={pts} animate={animate} /> : null,
        )}

        {/* ④ 현상 구름(터뷸런스 질감)·태양 글로우 + 주석 라벨 */}
        {regions.map((region, zone) => {
          const v = zoneVisuals?.[zone];
          if (!v) return null;
          const [ux, uy] = toUser(region.svg_point);
          const variant = cloudVariantFor(v);
          const clearLike = v.cloud === 'none' && (v.phenomenon === 'clear' || v.phenomenon === 'heatwave');
          return (
            <g key={`ph-${zone}`}>
              {clearLike && <SunGlint x={ux} y={uy - 6} hot={v.phenomenon === 'heatwave'} animate={animate} />}
              {/* ④ 구름 덩어리 — WebGL 터뷸런스 구름이 켜지면 SVG 질감은 생략 */}
              {!glActive && variant && (
                <RealCloudMass
                  variant={variant}
                  x={ux}
                  y={variant === 'fog' ? uy + 2.5 : variant === 'cumulonimbus' ? uy - 8 : uy - 7}
                  scale={variant === 'fog' ? 1.05 : 0.95}
                  animate={animate}
                  flash={v.phenomenon === 'shower' && v.cloud === 'cumulonimbus'}
                />
              )}
              {v.rule_id && <ZoneAnnotation x={ux} y={uy} ruleId={v.rule_id} animate={animate} />}
            </g>
          );
        })}

        {/* 지역 노드 — 지도와 같은 userSpace(<g transform>) */}
        {regions.map((region, zone) => {
          const [ux, uy] = toUser(region.svg_point);
          const [lx, ly] = toUser(region.label_anchor, [
            region.svg_point?.[0] ?? 50,
            (region.svg_point?.[1] ?? 50) + 11,
          ]);
          const pv = preview?.[zone];
          const ph = phenomenonMeta(pv?.phenomenon);
          const airEl = board?.elements?.find((el) => el.zone === zone && el.type === 'air_mass');
          const frontEl = board?.elements?.find((el) => el.zone === zone && el.type === 'front');
          const goalMet =
            (goals?.unmet ?? []).every((g) => g.zone !== zone) &&
            (goalConditions ?? []).some((g) => g.zone === zone);
          const isGoalZone = (goalConditions ?? []).some((g) => g.zone === zone);
          return (
            <g key={zone}>
              {/* 지역 라벨 — 시드 label_anchor 위치 (R9-01 §3.3) */}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                fontSize="3.6"
                fontWeight="700"
                fill="#334155"
                stroke="#f0f9ff"
                strokeWidth="0.8"
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {region.name}
              </text>

              <g
                transform={`translate(${ux} ${uy})`}
                data-board-zone={zone}
                role="button"
                tabIndex={interactive ? 0 : -1}
                aria-label={t('board.map.zoneAria', { name: region.name, goal: isGoalZone ? t('board.map.goalSuffix') : '', phenomenon: ph.label })}
                aria-disabled={!interactive}
                onClick={() => interactive && onZoneTap(zone)}
                onKeyDown={(e) => {
                  if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onZoneTap(zone);
                  }
                }}
                className={interactive ? 'cursor-pointer' : ''}
              >
                {/* 터치 히트 영역 — 지도폭 320px 기준 지름 ≥44px (r 8.5 = 17unit ≈ 54px) */}
                <circle r="8.5" fill="transparent" />

                {/* 목표/충족 링 */}
                {isGoalZone && !goalMet && (
                  <circle r="7.4" fill="none" stroke="#7dd3fc" strokeWidth="0.8" strokeDasharray="1.6 1.2" />
                )}
                {goalMet && <circle r="7.4" fill="none" stroke="#34d399" strokeWidth="1" />}
                {/* 탭 배치 대기(팔레트 선택 중)·드래그 중 유효 존 안내 링 */}
                {(selected || dragging) && interactive && (
                  <circle r="8.2" fill="none" stroke="#38bdf8" strokeWidth="0.6" strokeDasharray="1 1" opacity="0.9" />
                )}
                {/* 드래그 오버 존 강조(스냅 대상) */}
                {dragging && dragOverZone === zone && (
                  <circle r="8.2" fill="#e0f2fe" fillOpacity="0.55" stroke="#0284c7" strokeWidth="1" />
                )}

                {/* 노드 본체 + 미리보기 현상 아이콘 */}
                <circle
                  r="6"
                  fill={goalMet ? '#ecfdf5' : '#ffffff'}
                  fillOpacity="0.95"
                  stroke={goalMet ? '#34d399' : isGoalZone ? '#7dd3fc' : '#cbd5e1'}
                  strokeWidth="0.5"
                />
                <Glyph kind="phenomenon" value={pv?.phenomenon} scale={0.4} />

                {/* 배치된 요소 미니 배지 (노드 우측 스택) — 표준 표기 SVG(§3.3 ②) */}
                {airEl && <Glyph kind="air_mass" value={airEl.subtype} x={8.4} y={-2.6} scale={0.26} />}
                {frontEl && <Glyph kind="front" value={frontEl.subtype} x={8.4} y={3.2} scale={0.28} />}
                {/* 목표 마커 */}
                {isGoalZone && !goalMet && (
                  <text x="-7.6" y="-5.4" textAnchor="middle" fontSize="3.2" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                    🎯
                  </text>
                )}
                {goalMet && (
                  <text x="-7.6" y="-5.4" textAnchor="middle" fontSize="3.6" fill="#059669" fontWeight="700" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                    ✓
                  </text>
                )}
              </g>
            </g>
          );
        })}
      </svg>

      {/* WebGL 오버레이 1장 — ① 번짐 ③ 흐름장 ④ 터뷸런스 구름 ⑤ 강수.
          pointer-events:none이라 존 탭·드래그는 계속 SVG 계층이 받는다.
          실패하면 onFallback으로 아래 Canvas2D 경로로 되돌아간다. */}
      {glActive ? (
        <Overlay scene={scene} reduced={reduced} cap={160} onFallback={onGlFallback} />
      ) : (
        /* ⑤ Canvas2D 파티클 강수(폴백) — 비 사선 줄기+지면 스플래시 암시, 눈 흔들 낙하.
           상한 160(전역 200 이하), 탭 비활성·뷰포트 밖 정지, reduced-motion 정적 프레임. */
        <PrecipCanvas emitters={emitters} reduced={reduced} cap={160} />
      )}
    </div>
  );
}

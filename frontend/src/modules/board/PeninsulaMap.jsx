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

// 한반도 실루엣 (정규화 0~100 좌표 — scale(1, VIEW_H/100)로 사영).
// **손으로 찍지 말 것.** `docs/design/gen_peninsula.py`가 SSOT다 — 윤곽 15점을
// 저주파 푸리에(K=5)로 재구성해 뽑는다. 유한 삼각급수라 C∞라서 꺾이는 점이
// 없고, 브라우저 렌더 실측 최소 곡률반경 9.0(원본 다각형 0.9)이라 눈에도 각이
// 잡히지 않는다. 지리 정확도가 아니라 조작 보드로서의 알아봄이 기준이라
// 서해안 리아스식 굴곡 같은 건 전부 버렸다.
// 값 수정은 생성기 BASE_OUTLINE·HARMONICS에서만 — 지형·부속도서·능선·존 좌표가
// 같은 확대 배율을 타므로 하나만 손으로 고치면 조용히 어긋난다.
const PENINSULA_PATH =
  'M28.11,-10.96 C29.68,-12.11 31.75,-12.75 33.68,-13.24 C35.62,-13.73 37.69,-13.76 39.71,-13.90 ' +
  'C41.72,-14.03 43.75,-14.01 45.77,-14.05 C47.79,-14.08 49.82,-14.09 51.84,-14.10 C53.86,-14.11 ' +
  '55.88,-14.14 57.91,-14.11 C59.93,-14.08 61.96,-14.10 63.97,-13.92 C65.98,-13.73 68.08,-13.64 ' +
  '69.95,-13.00 C71.83,-12.37 73.85,-11.46 75.19,-10.10 C76.54,-8.73 77.39,-6.69 78.05,-4.81 ' +
  'C78.71,-2.94 78.88,-0.85 79.13,1.15 C79.39,3.15 79.46,5.18 79.57,7.20 C79.67,9.22 79.72,11.24 ' +
  '79.79,13.26 C79.85,15.28 79.90,17.30 79.94,19.33 C79.98,21.35 80.02,23.37 80.00,25.39 ' +
  'C79.98,27.41 79.96,29.44 79.82,31.45 C79.67,33.47 79.46,35.49 79.12,37.48 C78.79,39.47 ' +
  '78.33,41.45 77.81,43.40 C77.28,45.35 76.65,47.27 75.99,49.18 C75.33,51.10 74.61,52.99 ' +
  '73.86,54.87 C73.12,56.75 72.35,58.62 71.52,60.46 C70.70,62.31 69.86,64.16 68.92,65.94 ' +
  'C67.97,67.72 66.99,69.51 65.85,71.17 C64.70,72.82 63.46,74.46 62.03,75.88 C60.61,77.29 ' +
  '59.01,78.60 57.30,79.65 C55.59,80.69 53.70,81.55 51.79,82.15 C49.88,82.75 47.84,83.14 ' +
  '45.84,83.25 C43.84,83.37 41.75,83.28 39.81,82.84 C37.87,82.40 35.84,81.70 34.20,80.61 ' +
  'C32.57,79.52 31.03,77.97 30.00,76.31 C28.96,74.65 28.37,72.58 27.99,70.63 C27.62,68.67 ' +
  '27.67,66.59 27.75,64.58 C27.82,62.56 28.16,60.55 28.43,58.55 C28.71,56.55 29.13,54.57 ' +
  '29.41,52.56 C29.68,50.56 30.02,48.55 30.09,46.54 C30.16,44.53 30.12,42.47 29.82,40.49 ' +
  'C29.51,38.51 28.90,36.55 28.28,34.63 C27.66,32.71 26.80,30.87 26.08,28.98 C25.37,27.08 ' +
  '24.60,25.21 23.99,23.28 C23.38,21.36 22.82,19.40 22.42,17.43 C22.01,15.45 21.71,13.44 ' +
  '21.55,11.43 C21.39,9.42 21.34,7.38 21.46,5.37 C21.58,3.35 21.79,1.31 22.26,-0.64 C22.72,-2.59 ' +
  '23.28,-4.63 24.26,-6.35 C25.23,-8.07 26.54,-9.81 28.11,-10.96 Z';

// 부속 도서 — 라벨 없이 실루엣만(존이 아니라 "여기가 한국"이라는 표지다).
const JEJU = 'M36.0,91.0 A5.0,2.6 0 1 1 46.0,91.0 A5.0,2.6 0 1 1 36.0,91.0 Z';
const DOKDO = [
  'M88.7,45.0 A1.3,1.1 0 1 1 91.3,45.0 A1.3,1.1 0 1 1 88.7,45.0 Z',
  'M93.2,46.6 A0.8,0.7 0 1 1 94.8,46.6 A0.8,0.7 0 1 1 93.2,46.6 Z',
];

// 태백 능선 — 예전엔 L 세그먼트 꺾은선이었다. 해안선을 곡선으로 바꾼 뒤에는
// 이 한 줄만 각져서 더 튀었으므로 같이 곡선으로 돌린다.
const RIDGE = 'M62.0,22.0 C65.5,31.0 66.5,40.0 64.5,48.0 C62.8,55.5 59.0,61.0 55.5,68.0';

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

        {/* 한반도 — 단색에 가까운 지형 + 부속 도서 + 태백 능선 한 줄.
            터뷸런스 그레인(wm-terrain)은 뺐다: 질감 없이 단순하게 가는 판단이고,
            그레인은 해안선 곡선을 지저분하게 갉아 각져 보이게 만들었다. */}
        <g transform={`scale(1 ${VIEW_H / 100})`} aria-hidden="true">
          <path d={PENINSULA_PATH} fill="url(#wm-land)" stroke="#95C48B" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={JEJU} fill="url(#wm-land)" stroke="#95C48B" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {DOKDO.map((d) => (
            <path key={d} d={d} fill="url(#wm-land)" stroke="#95C48B" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {/* 태백산맥 능선 — 음영 + 능선 하이라이트 */}
          <path d={RIDGE} fill="none" stroke="#8a9a7a" strokeWidth="2" strokeLinecap="round" opacity="0.5" vectorEffect="non-scaling-stroke" />
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
                // 브라우저 기본 포커스 링을 그대로 두면 존을 고를 때마다 **두꺼운
                // 검은 사각형**이 지도 위에 뜬다(Chrome이 tabindex 붙은 SVG <g>에
                // 그리는 기본값). 지워 버리면 키보드 사용자가 지금 어디에 있는지
                // 알 수 없으므로, 없애지 않고 회색·절반 두께로 낮춘다(2026-08-06).
                className={`${interactive ? 'cursor-pointer' : ''} outline-none focus:outline focus:outline-[1.5px] focus:outline-offset-2 focus:outline-slate-400`}
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

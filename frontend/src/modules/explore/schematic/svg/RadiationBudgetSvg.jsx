/**
 * RadiationBudgetSvg (C1) — 지구 복사수지 모식도의 **SVG 바닥**. (MT-22)
 *
 * 이 저장소의 관례대로 실패 경로는 「아무 일도 안 일어남」으로 수렴한다. WebGL이
 * 없거나 컨텍스트를 잃은 기기에서도 이 그림 하나로 뜻이 통해야 한다 —
 * `CrossSectionGL`의 `onFail` → SVG 스토리보드와 같은 자리다.
 *
 * ── 수치 출처 ──────────────────────────────────────────────────────────
 * `docs/design/research/RESEARCH_MT22_CO2_TYPHOON.md` §3 C1. 전부 공개 사실이고
 * **어떤 이미지도 내려받거나 따라 그리지 않았다.** 차용한 것은 Sankey 관례
 * (*"선 두께가 에너지량에 선형 비례"*)라는 **표현 문법**이지 그림이 아니다.
 *
 * ── 이 파일의 제1원칙: 좌표를 손으로 찍지 않는다 ────────────────────────
 * 화살표 두께·레인 위치·요약 막대 길이·EEI 조각 길이가 전부 `BUDGET`의 단위값에서
 * 계산된다. 상수는 `UNIT_PX` **하나**뿐이고, 그래서 「두께 ∝ 에너지」가 코드로 참이다.
 * 마크업의 모든 흐름은 `data-units`를 달고 나가므로 그 비례는 **DOM에서 검증된다**
 * (`tests/schematicSvg.render.test.mjs`).
 *
 * ⚠️ 색만으로 뜻을 전달하지 않는다 — 모든 흐름에 이름표가 붙고, 선 종류(실선/파선/
 * 점선)가 색과 같은 정보를 중복해서 나른다.
 */

// ── §3 수치 (100단위 정규화. TOA 340 W/m² = 100) ───────────────────────────
export const TOA_WM2 = 340;
/** 지구 에너지 불균형(2005~2019). 이 미세한 잉여가 온난화다. */
export const EEI_WM2 = 0.9;

export const BUDGET = {
  incoming: 100,
  /** 반사(알베도) — 합 35 */
  reflected: { cloud: 27, atmosphere: 6, surface: 2 },
  /** 흡수 — 합 65 */
  absorbed: { atmosphere: 14, surface: 51 },
  /** 지표 51의 행방 — 우주로 직접 17 + 대기로 34(잠열 19·대류 9·적외 6) */
  surfaceOut: { window: 17, latent: 19, convection: 9, ir: 6 },
  /** 대기가 방출 */
  atmosphereEmitted: 48,
};

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** 반사 총량 — 합계는 **계산한다**(적어 두지 않는다). */
export const reflectedTotal = () => sum(BUDGET.reflected);
/** 흡수 총량 */
export const absorbedTotal = () => sum(BUDGET.absorbed);
/** OLR = 지표가 대기의 창으로 직접 내보낸 것 + 대기 방출 */
export const olrTotal = () => BUDGET.surfaceOut.window + BUDGET.atmosphereEmitted;
/** 지표가 내보내는 총량(= 지표 흡수와 같아야 한다) */
export const surfaceOutTotal = () => sum(BUDGET.surfaceOut);
/** 대기가 받는 총량(= 대기 방출과 같아야 한다) */
export const atmosphereInTotal = () =>
  BUDGET.absorbed.atmosphere + BUDGET.surfaceOut.latent
  + BUDGET.surfaceOut.convection + BUDGET.surfaceOut.ir;

/** EEI를 100단위로 환산 — 0.9 / 340 × 100 ≈ 0.265단위. 이것이 이 그림의 난제다. */
export const EEI_UNITS = (EEI_WM2 / TOA_WM2) * 100;
/** EEI 조각을 눈에 보이게 하는 배율. 화면에 **명시**한다(속이지 않는다). */
export const EEI_MAGNIFY = 100;

// ── 좌표계 ────────────────────────────────────────────────────────────────
export const VIEW_W = 760;
export const VIEW_H = 660;

/**
 * 🔴 이 그림 전체의 유일한 축척: 1단위(= 3.4 W/m²)당 px.
 * 화살표 굵기도, 요약 막대 길이도, EEI 조각도 전부 여기를 지난다.
 */
export const UNIT_PX = 2;

const MARGIN_X = 24;

/** 층위 y좌표(px). 화살표의 시작·끝은 이 이름으로만 지정한다. */
const Y = {
  space: 56,     // 우주(TOA 바깥)
  toaLine: 78,   // TOA 표시선
  atmTop: 190,   // 대기층 상단
  atmMid: 232,
  atmBot: 268,   // 대기층 하단
  ground: 402,   // 지표면
  groundBot: 434,
};

/**
 * 흐름 11종. `lane`이 있는 것은 앞 흐름과 **같은 레인**을 쓴다 —
 * 입사 100이 대기를 지나며 51로 가늘어지는 것을 한 줄기로 보이게 하기 위함이다.
 */
export const FLOWS = [
  { id: 'insolation', units: BUDGET.incoming, name: '태양 입사', from: 'space', to: 'atmTop', kind: 'shortwave' },
  { id: 'surfaceAbsorbed', units: BUDGET.absorbed.surface, name: '지표 흡수', from: 'atmBot', to: 'ground', kind: 'shortwave', lane: 'insolation' },
  { id: 'atmAbsorbed', units: BUDGET.absorbed.atmosphere, name: '대기 흡수', from: 'atmTop', to: 'atmMid', kind: 'shortwave' },
  { id: 'cloudReflected', units: BUDGET.reflected.cloud, name: '구름 반사', from: 'atmTop', to: 'space', kind: 'reflected' },
  { id: 'atmReflected', units: BUDGET.reflected.atmosphere, name: '대기 반사', from: 'atmMid', to: 'space', kind: 'reflected' },
  { id: 'surfaceReflected', units: BUDGET.reflected.surface, name: '눈·얼음 반사', from: 'ground', to: 'space', kind: 'reflected' },
  { id: 'latent', units: BUDGET.surfaceOut.latent, name: '잠열', from: 'ground', to: 'atmBot', kind: 'nonradiative' },
  { id: 'convection', units: BUDGET.surfaceOut.convection, name: '대류·난류', from: 'ground', to: 'atmBot', kind: 'nonradiative' },
  { id: 'surfaceIr', units: BUDGET.surfaceOut.ir, name: '지표 적외', from: 'ground', to: 'atmBot', kind: 'longwave' },
  { id: 'atmEmitted', units: BUDGET.atmosphereEmitted, name: '대기 방출', from: 'atmTop', to: 'space', kind: 'longwave' },
  { id: 'surfaceWindow', units: BUDGET.surfaceOut.window, name: '대기의 창', from: 'ground', to: 'space', kind: 'longwave' },
];

/** 선 종류·색 — 색이 안 보여도 선 종류가 같은 정보를 나른다. */
const KIND = {
  shortwave: { color: '#f59e0b', dash: null, legend: '단파(햇빛)' },
  reflected: { color: '#38bdf8', dash: '10 7', legend: '반사' },
  longwave: { color: '#ef4444', dash: null, legend: '장파(적외선)' },
  nonradiative: { color: '#0d9488', dash: '2 6', legend: '비복사 수송(잠열·대류)' },
};

/**
 * 레인 배치 — **누적 폭에서 계산한다.**
 * 레인 폭 = 단위값 × UNIT_PX, 레인 간격은 남는 폭을 균등 분배한 몫이다.
 * 그래서 어떤 값을 고쳐도 레인이 겹치지 않고 스스로 재배치된다.
 */
export function layout() {
  const lanes = FLOWS.filter((f) => !f.lane);
  const totalUnits = lanes.reduce((a, f) => a + f.units, 0);
  const gap = (VIEW_W - 2 * MARGIN_X - totalUnits * UNIT_PX) / (lanes.length - 1);

  const byId = {};
  let x = MARGIN_X;
  lanes.forEach((f, i) => {
    const w = f.units * UNIT_PX;
    byId[f.id] = { cx: x + w / 2, laneIndex: i };
    x += w + gap;
  });

  const out = {};
  FLOWS.forEach((f) => {
    const home = byId[f.lane ?? f.id];
    const w = f.units * UNIT_PX;
    const y1 = Y[f.from];
    const y2 = Y[f.to];
    // 라벨은 화살표 중간에 두되 레인 순서에 따라 위아래로 엇갈린다(겹침 방지).
    const labelY = (y1 + y2) / 2 + (home.laneIndex % 2 === 0 ? -14 : 14);
    out[f.id] = {
      ...f, w, cx: home.cx, y1, y2, labelY,
      dir: Math.sign(y2 - y1),
      laneIndex: home.laneIndex,
    };
  });
  return { flows: out, lanes, gap, totalUnits };
}

const L = layout();

/** 화살표 몸통(스트로크)과 머리(삼각형)를 폭에서 파생시킨다. */
function arrowGeometry({ cx, w, y1, y2 }) {
  const dir = Math.sign(y2 - y1);
  const head = Math.max(12, Math.min(30, w * 0.8));
  const bodyEnd = y2 - dir * head;
  return {
    body: `M ${cx} ${y1} L ${cx} ${bodyEnd}`,
    head: `${cx - w * 0.85},${bodyEnd} ${cx + w * 0.85},${bodyEnd} ${cx},${y2}`,
  };
}

function Flow({ f }) {
  const kind = KIND[f.kind];
  const g = arrowGeometry(f);
  return (
    <g>
      <path
        d={g.body}
        data-flow={f.id}
        data-units={f.units}
        stroke={kind.color}
        strokeWidth={f.w}
        strokeDasharray={kind.dash ?? undefined}
        strokeOpacity="0.85"
        fill="none"
      />
      <polygon points={g.head} fill={kind.color} fillOpacity="0.95" />
      <g transform={`translate(${f.cx} ${f.labelY})`}>
        <text
          textAnchor="middle" y="-5" fontSize="11" fill="#0f172a"
          stroke="#ffffff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
        >
          {f.name}
        </text>
        <text
          textAnchor="middle" y="11" fontSize="15" fontWeight="700" fill="#0f172a"
          stroke="#ffffff" strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round"
        >
          {f.units}
        </text>
      </g>
    </g>
  );
}

// ── 하단 「수지 점검」 막대 — 길이도 같은 UNIT_PX를 쓴다 ────────────────────
const BAR_X = 132;
const BAR_H = 20;
const ROWS = [
  { y: 486, label: '들어온 것', segs: [{ units: BUDGET.incoming, name: '입사 100', color: '#f59e0b' }] },
  {
    y: 522,
    label: '어디로 갔나',
    segs: [
      { units: reflectedTotal(), name: '반사 35', color: '#38bdf8' },
      { units: absorbedTotal(), name: '흡수 65', color: '#f59e0b' },
    ],
  },
  {
    y: 558,
    label: '다시 나간 것',
    segs: [
      { units: reflectedTotal(), name: '반사 35', color: '#38bdf8' },
      { units: olrTotal(), name: 'OLR 65', color: '#ef4444' },
    ],
  },
];

export default function RadiationBudgetSvg({ className = '' }) {
  const f = L.flows;
  const eeiPx = EEI_UNITS * UNIT_PX;           // 실제 굵기(px) — 사람 눈에 안 보인다
  const eeiShownPx = eeiPx * EEI_MAGNIFY;      // 확대해서 보이게 한 길이

  return (
    <figure className={`m-0 ${className}`}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-labelledby="c1-title c1-desc"
      >
        <title id="c1-title">지구 복사수지 모식도 (교육용)</title>
        <desc id="c1-desc">
          태양이 대기권 밖에 주는 340와트를 100단위로 놓은 에너지 수지 그림입니다.
          화살표 굵기가 에너지량에 비례합니다. 반사 35(구름 27, 대기 6, 눈·얼음 2)와
          흡수 65(대기 14, 지표 51)로 갈리고, 지표가 받은 51은 대기의 창 17,
          잠열 19, 대류 9, 적외 6으로 되나갑니다. 대기는 48을 내보내며 우주로 나가는
          총량은 17 더하기 48로 65가 되어 흡수 65와 균형을 이룹니다. 실제로는 그
          균형에 0.9와트의 미세한 초과가 있고 그것이 지구온난화입니다.
        </desc>

        <rect width={VIEW_W} height={VIEW_H} fill="#f8fafc" />

        {/* 우주 / 대기 / 지표 — 층을 먼저 깔고 화살표를 그 위에 얹는다 */}
        <rect x="0" y="0" width={VIEW_W} height={Y.toaLine} fill="#0f172a" opacity="0.06" />
        <rect x="0" y={Y.atmTop} width={VIEW_W} height={Y.atmBot - Y.atmTop} fill="#bae6fd" opacity="0.55" />
        <rect x="0" y={Y.ground} width={VIEW_W} height={Y.groundBot - Y.ground} fill="#a8b79a" />

        <line
          x1="0" y1={Y.toaLine} x2={VIEW_W} y2={Y.toaLine}
          stroke="#475569" strokeWidth="1" strokeDasharray="6 5"
        />
        <text x={MARGIN_X} y={Y.toaLine - 8} fontSize="12" fill="#334155">
          대기권 밖(TOA) — 태양 {TOA_WM2} W/㎡ 를 100단위로 놓는다
        </text>
        <text x={VIEW_W - MARGIN_X} y={Y.toaLine + 18} fontSize="12" fill="#334155" textAnchor="end">
          ↑ 위쪽이 우주
        </text>
        <text
          x={MARGIN_X} y={Y.atmTop - 8} fontSize="12" fill="#0c4a6e"
          stroke="#ffffff" strokeWidth="3" paintOrder="stroke"
        >
          대기
        </text>
        <text
          x={MARGIN_X} y={Y.groundBot - 10} fontSize="12" fill="#1e293b"
          stroke="#ffffff" strokeWidth="3" paintOrder="stroke"
        >
          지표·바다
        </text>

        {FLOWS.map((flow) => <Flow key={flow.id} f={f[flow.id]} />)}

        {/* 선 종류 범례 — 색이 안 보여도 뜻이 통하게 하는 장치 */}
        <g fontSize="11" fill="#334155">
          {Object.entries(KIND).map(([k, v], i) => (
            <g key={k} transform={`translate(${MARGIN_X + i * 178} ${Y.groundBot + 22})`}>
              <line
                x1="0" y1="-4" x2="26" y2="-4"
                stroke={v.color} strokeWidth="3" strokeDasharray={v.dash ?? undefined}
              />
              <text x="32" y="0">{v.legend}</text>
            </g>
          ))}
        </g>

        {/* ── 수지가 닫히는가 ────────────────────────────────────────────── */}
        <text x={MARGIN_X} y="466" fontSize="13" fontWeight="700" fill="#0f172a">
          수지 점검 — 막대 길이도 같은 축척이다
        </text>
        {ROWS.map((row) => {
          let x = BAR_X;
          return (
            <g key={row.label}>
              <text x={BAR_X - 10} y={row.y + 14} fontSize="12" fill="#334155" textAnchor="end">
                {row.label}
              </text>
              {row.segs.map((s) => {
                const w = s.units * UNIT_PX;
                const at = x;
                x += w;
                return (
                  <g key={s.name}>
                    <rect
                      x={at} y={row.y} width={w} height={BAR_H}
                      data-bar={s.name} data-units={s.units}
                      fill={s.color} fillOpacity="0.8" stroke="#ffffff" strokeWidth="1"
                    />
                    <text
                      x={at + w / 2} y={row.y + 14} fontSize="11" fill="#0f172a" textAnchor="middle"
                      stroke="#ffffff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
                    >
                      {s.name}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={BAR_X + BUDGET.incoming * UNIT_PX + 14} y="536" fontSize="12" fill="#0f172a">
          두 줄의 길이가 같다 = 흡수 {absorbedTotal()}과 OLR {olrTotal()}이 균형
        </text>

        {/* ── EEI — 균형 그림에 0.9를 어떻게 보이게 하나 ────────────────── */}
        <g transform="translate(0 596)">
          <rect x={MARGIN_X} y="-14" width={VIEW_W - 2 * MARGIN_X} height="42" fill="#fee2e2" opacity="0.6" rx="6" />
          <text x={MARGIN_X + 12} y="4" fontSize="12" fill="#7f1d1d">
            그런데 실제로는 나가는 쪽이 {EEI_WM2} W/㎡ 만큼 <tspan fontWeight="700">적다</tspan>(EEI).
            100단위로는 {EEI_UNITS.toFixed(3)}단위 — 이 축척에서 굵기 {eeiPx.toFixed(2)}px이라 보이지 않는다.
          </text>
          <rect
            x={MARGIN_X + 12} y="12" width={eeiShownPx} height="10"
            data-eei-magnified="true" fill="#dc2626"
          />
          <text x={MARGIN_X + 12 + eeiShownPx + 10} y="21" fontSize="12" fill="#7f1d1d">
            ×{EEI_MAGNIFY} 확대 — 매년 쌓이는 이 조각이 지구온난화다
          </text>
        </g>

        <text x={VIEW_W - MARGIN_X} y={VIEW_H - 8} fontSize="11" fill="#64748b" textAnchor="end">
          교육용 도식 — 실제 관측 영상·특정 기관 자료가 아닙니다
        </text>
      </svg>
    </figure>
  );
}

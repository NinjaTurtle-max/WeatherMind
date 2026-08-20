import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  climateResponse,
  CO2_BASELINE,
  CO2_MIN,
  CO2_MAX,
  CLIMATE_SENSITIVITY,
  CLIMATE_SENSITIVITY_MIN,
  CLIMATE_SENSITIVITY_MAX,
  CLIMATE_SENSITIVITY_STEP,
  CLIMATE_SENSITIVITY_LIKELY,
  SEA_LEVEL_CM_PER_DEG,
  SEA_LEVEL_CM_PER_DEG_MIN,
  SEA_LEVEL_CM_PER_DEG_MAX,
  SEA_LEVEL_CM_PER_DEG_STEP,
} from '../../lib/exploreSims';
// MT-24 탐구 목표 — 「변수를 바꿔보며」에 「해냈다」를 붙인다.
import GoalPanel from './GoalPanel';
import { CLIMATE_GOALS } from './exploreGoals';
// C1 복사수지 입체 모식도(MT-22) — 슬라이더가 못 보여주는 **경로**를 보인다.
import SchematicPanel from './SchematicPanel';
import { RADIATION_SCENE, RADIATION_STEPS } from './schematic/radiationScene';
import { useT } from '../../i18n';

/**
 * 기후변화 체험 페이지 (R9-01 §3.5 S5) — 순수 클라이언트 탐구 모듈, 라우트 /explore/climate.
 *
 * CO2 농도 슬라이더(280~560ppm, 현재값 마커) → 결정적 교육 모델
 * (src/lib/exploreSims.js climateResponse)로 즉시 재계산:
 *   온도 아노말리 곡선(SVG — 전 구간 로그 감도 곡선 + 현재 선택점 마커)
 *   + 파생 지표 카드 2종(해수면 상승·연간 폭염일수) + "왜 그럴까" 설명 패널.
 * 하단 CTA로 co2_climate 개념 유닛 학습 홈(/)에 연결(θ 루프 §3.5).
 *
 * 수치 기후 모델이 아니라 교육용 결정적 근사(ΔT = S·log2(C/C0), S=3.0)임을
 * 화면에 명시한다. 문구·그래픽 전부 자체 제작, 외부 라이브러리 없음.
 */

/** 오늘날 대기 CO2 농도 근사(ppm) — 슬라이더 위 "현재" 마커용 교육 표기. */
const CO2_PRESENT_DAY = 427;

/** 아노말리 크기에 따른 표현 색(교육용 온도 팔레트). */
function anomalyColor(anomaly) {
  if (anomaly < 0.75) return '#0284c7'; // sky-600
  if (anomaly < 1.5) return '#d97706'; // amber-600
  if (anomaly < 2.25) return '#ea580c'; // orange-600
  return '#e11d48'; // rose-600
}

/** 조건별 결정적 설명 문구. t는 호출부의 useT(). */
function explainWhy(t, co2, result, sensitivity, seaLevelPerDeg) {
  const lines = [];
  lines.push(
    t('explore.climate.why1', { baseline: CO2_BASELINE, co2, anomaly: result.anomaly.toFixed(2) }),
  );
  // ⚠️ 상수가 아니라 **지금 슬라이더에 있는 값**을 넣는다. 여기에 상수를 넣어 두면
  // 민감도를 4.5로 올려도 설명만 "약 3.0℃씩"이라 화면이 자기 그래프와 다른 말을 한다.
  lines.push(t('explore.climate.why2', { sens: Number(sensitivity).toFixed(1) }));
  lines.push(t('explore.climate.whySens', {
    sens: Number(sensitivity).toFixed(1),
    lo: CLIMATE_SENSITIVITY_LIKELY.lo.toFixed(1),
    hi: CLIMATE_SENSITIVITY_LIKELY.hi.toFixed(1),
  }));
  lines.push(t('explore.climate.whySea', {
    k: seaLevelPerDeg,
    anomaly: result.anomaly.toFixed(2),
    sea: result.sea_level,
  }));
  if (co2 <= CO2_BASELINE) {
    lines.push(t('explore.climate.whyBaseline'));
  } else if (co2 <= CO2_PRESENT_DAY) {
    lines.push(t('explore.climate.whyPast', { baseline: CO2_BASELINE, present: CO2_PRESENT_DAY }));
  } else {
    lines.push(t('explore.climate.whyFuture', { present: CO2_PRESENT_DAY }));
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// 곡선 도형 — 순수부를 **컴포넌트 밖**에 둔다
//
// jsdom에는 래스터라이저가 없어 「눈에 보인다」를 원리적으로 못 잰다. 그래서
// 위성 도식(satelliteField)이 쓴 것과 같은 관례로, 판정을 **좌표 계산**으로
// 내린다 — 테스트가 이 함수들을 직접 불러 "민감도를 바꾸면 곡선이 실제로
// 다른 자리를 지나는가"를 숫자로 확인한다.
// ─────────────────────────────────────────────────────────────────────────────

/** SVG 뷰박스·여백(px) */
export const CURVE_VIEW = Object.freeze({
  w: 280,
  h: 130,
  pad: Object.freeze({ left: 30, right: 12, top: 12, bottom: 22 }),
});

/**
 * 세로축 상한(℃) — 🔴 **현재 민감도가 아니라 민감도 슬라이더의 최대치로 고정한다.**
 *
 * 개정 전에는 `maxY = CLIMATE_SENSITIVITY`였다. 민감도가 상수일 때는 무해했지만,
 * 그것이 조작 변수가 된 지금 그대로 두면 **어떤 민감도에서도 곡선이 똑같이
 * 보인다**: y좌표가 anomaly/maxY = (S·log2(C/C₀))/S 로 S를 약분해 버려서 민감도를
 * 2로 낮추든 5로 올리든 폴리라인이 같은 자리를 지나고, 끝점은 늘 축 맨 위에 붙는다.
 * 「숫자만 바뀌고 그림은 그대로」의 가장 나쁜 형태이고 이 티켓이 없애려는 결함
 * 그 자체다(반대로 축만 따라 움직이고 곡선이 제자리여도 같은 증상이 된다).
 * ⇒ 축은 **탐구 가능한 전 범위**를 늘 담고(=슬라이더 최대치로 고정), 곡선만 움직인다.
 *
 * 대가를 명시해 둔다: 기본값 S=3.0에서 곡선이 그림 높이의 60%까지만 찬다. 종전에는
 * 100%였다. 그 여백은 낭비가 아니라 **민감도를 올렸을 때 곡선이 올라갈 자리**다.
 * 이 계약의 감시자는 tests/exploreSims.render.test.mjs다.
 */
export const CURVE_MAX_Y = CLIMATE_SENSITIVITY_MAX;

/** y 눈금(℃) — 축 상한에서 **파생**시킨다. 여기에 [1,2,3]을 다시 박으면 상한을
 *  올려도 눈금이 3℃에서 끝나 곡선이 눈금 없는 허공을 지난다. */
export const CURVE_Y_TICKS = Object.freeze(
  Array.from({ length: Math.floor(CURVE_MAX_Y) }, (_, i) => i + 1),
);

/** 곡선 샘플 간격(ppm) */
export const CURVE_SAMPLE_PPM = 20;

export const curveX = (co2) => {
  const { w, pad } = CURVE_VIEW;
  return pad.left + ((co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)) * (w - pad.left - pad.right);
};

export const curveY = (anomaly) => {
  const { h, pad } = CURVE_VIEW;
  return h - pad.bottom - (anomaly / CURVE_MAX_Y) * (h - pad.top - pad.bottom);
};

/** 폴리라인 `points` 문자열 — 민감도 하나로 결정되는 순수 함수. */
export function anomalyCurvePoints(sensitivity) {
  const pts = [];
  for (let c = CO2_MIN; c <= CO2_MAX; c += CURVE_SAMPLE_PPM) {
    const { anomaly } = climateResponse({ co2: c, sensitivity });
    pts.push(`${curveX(c).toFixed(1)},${curveY(anomaly).toFixed(1)}`);
  }
  return pts.join(' ');
}

/**
 * 온도 아노말리 곡선 — 280~560ppm 전 구간을 20ppm 간격으로 샘플링한 로그 곡선
 * 위에 현재 선택값 마커를 얹는다. 경량 SVG(외부 차트 라이브러리 없이).
 */
function AnomalyCurve({ co2, anomaly, sensitivity }) {
  const t = useT();
  const { w, h, pad } = CURVE_VIEW;
  const xOf = curveX;
  const yOf = curveY;

  // 🔴 의존성에 sensitivity가 **반드시** 있어야 한다. 종전 주석은 "xOf·yOf는 상수
  // 기반 — 의존성 없음"이었고 `[]`였다. 민감도가 변수가 된 뒤 그대로 두면 곡선이
  // 첫 렌더의 모양으로 얼어붙어, 슬라이더를 끝까지 밀어도 숫자만 바뀌고 그림은
  // 그대로다. 값을 넣는 자리(climateResponse 인자)와 의존성 목록은 **한 쌍**이다 —
  // 둘 중 하나만 고치면 결함이 그대로 남는다(anomalyCurvePoints가 인자를 받는
  // 형태인 이유도 그것이다: 인자를 안 넘기면 함수 시그니처에서 바로 드러난다).
  const points = useMemo(() => anomalyCurvePoints(sensitivity), [sensitivity]);

  const color = anomalyColor(anomaly);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t('explore.climate.curveAria', { co2, anomaly })}>
      {/* y 눈금 — 축 상한에서 파생(CURVE_Y_TICKS). 여기에 값을 다시 박지 말 것 */}
      {CURVE_Y_TICKS.map((g) => (
        <g key={g}>
          <line x1={pad.left} x2={w - pad.right} y1={yOf(g)} y2={yOf(g)} stroke="#f1f5f9" strokeWidth="1" />
          <text x={pad.left - 4} y={yOf(g) + 3} textAnchor="end" fontSize="9" className="fill-slate-400">
            +{g}℃
          </text>
        </g>
      ))}
      <line x1={pad.left} x2={w - pad.right} y1={yOf(0)} y2={yOf(0)} stroke="#cbd5e1" strokeWidth="1" />
      {/* x 라벨 */}
      <text x={xOf(CO2_MIN)} y={h - 8} textAnchor="start" fontSize="9" className="fill-slate-400">
        280ppm
      </text>
      <text x={xOf(CO2_MAX)} y={h - 8} textAnchor="end" fontSize="9" className="fill-slate-400">
        560ppm
      </text>
      {/* 현재(오늘날) 농도 기준선 */}
      <line
        x1={xOf(CO2_PRESENT_DAY)}
        x2={xOf(CO2_PRESENT_DAY)}
        y1={pad.top}
        y2={h - pad.bottom}
        stroke="#94a3b8"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x={xOf(CO2_PRESENT_DAY)} y={pad.top - 2} textAnchor="middle" fontSize="8" className="fill-slate-400">
        {t('explore.climate.presentMark', { n: CO2_PRESENT_DAY })}
      </text>
      {/* 로그 감도 곡선 */}
      <polyline points={points} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* 선택점 마커 */}
      <circle cx={xOf(co2)} cy={yOf(anomaly)} r="5" fill={color} stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}

function IndicatorCard({ icon, title, value, unit, note }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xl">{icon}</p>
      <p className="mt-1 text-[11px] font-bold text-slate-500">{title}</p>
      <p className="mt-0.5 text-xl font-extrabold text-slate-800">
        {value}
        <span className="ml-0.5 text-xs font-bold text-slate-400">{unit}</span>
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{note}</p>
    </div>
  );
}

export default function ClimateSimPage() {
  const t = useT();
  // ⚠️ co2의 useState가 **첫 번째**여야 한다 — tests/exploreGoals.test.mjs가
  // 소스에서 첫 `useState(...)`를 읽어 기본 CO₂를 알아낸다. 아래 두 상태는
  // 리터럴 숫자가 아니라 이름 있는 상수를 쓰므로 그 정규식에 걸리지 않는다.
  const [co2, setCo2] = useState(CO2_PRESENT_DAY);
  const [sensitivity, setSensitivity] = useState(CLIMATE_SENSITIVITY);
  const [seaLevelPerDeg, setSeaLevelPerDeg] = useState(SEA_LEVEL_CM_PER_DEG);

  const result = useMemo(
    () => climateResponse({ co2, sensitivity, seaLevelPerDeg }),
    [co2, sensitivity, seaLevelPerDeg],
  );
  const color = anomalyColor(result.anomaly);
  const whyLines = explainWhy(t, co2, result, sensitivity, seaLevelPerDeg);
  const resetAll = () => {
    setCo2(CO2_PRESENT_DAY);
    setSensitivity(CLIMATE_SENSITIVITY);
    setSeaLevelPerDeg(SEA_LEVEL_CM_PER_DEG);
  };

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/explore" className="text-xs font-medium text-sky-600 hover:text-sky-700">
            {t('explore.common.back')}
          </Link>
          <h1 className="text-lg font-extrabold text-slate-800">{t('explore.climate.title')}</h1>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold" style={{ color }}>
          +{result.anomaly.toFixed(2)}℃
        </span>
      </div>

      <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        {/* 고지 문구도 **지금 값**을 말해야 한다 — S를 상수로 박아 두면 슬라이더를
            움직인 화면이 자기 모델을 틀리게 설명한다(i18n 값에 {sens} 필요). */}
        {t('explore.climate.disclaimer', { sens: sensitivity.toFixed(1) })}
      </p>

      {/* 탐구 목표(MT-24) — 슬라이더보다 위. 판정 입력은 **화면에 뜨는 반올림값**
          그대로다(result.anomaly는 소수 2자리) — 원시값으로 다시 계산해 비교하면
          "화면은 1.40인데 미달"이 생긴다. */}
      <GoalPanel
        goals={CLIMATE_GOALS}
        facts={{
          co2,
          anomaly: result.anomaly,
          sea_level: result.sea_level,
          heat_days: result.heat_days,
        }}
      />

      {/* 아노말리 곡선 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">{t('explore.climate.anomalyTitle')}</p>
        <p className="text-[11px] text-slate-400">{t('explore.climate.anomalySub')}</p>
        <div className="mt-2">
          <AnomalyCurve co2={co2} anomaly={result.anomaly} sensitivity={sensitivity} />
        </div>
      </div>

      {/* C1 복사수지 입체 모식도(MT-22) — **곡선 카드를 대체하지 않고 덧붙인다.**
          곡선은 "얼마나 더워지나"(결과)를 말하고, 이 그림은 "그 열이 어디로 다니나"
          (경로)를 말한다 — 온실효과가 「나가는 열이 붙잡히는 것」임은 수치 카드로는
          보이지 않는다. 슬라이더 **위**에 두어 조작 전에 구조를 먼저 읽게 한다. */}
      <SchematicPanel
        title={t('explore.schematic.card.c1.title')}
        caption={t('explore.schematic.card.c1.caption')}
        scene={RADIATION_SCENE}
        steps={RADIATION_STEPS}
        ariaLabel={t('explore.schematic.card.c1.aria')}
      />

      {/* ── 조작 변수 3개 (대회 배점 「변수를 바꿔가며」) ─────────────────────
          ⓐ CO₂ 농도        — 원인. 세 지표 전부를 움직인다
          ⓑ 기후민감도       — 원인의 불확실성. 세 지표 전부 + **곡선 모양**을 움직인다
          ⓒ 해수면 반응 계수 — 영향의 불확실성. 해수면 하나만 움직인다
          셋의 성격이 다른 것이 요점이다: 전 지표를 움직이는 축만 있으면 "세상이 더
          더워졌다"와 "그 결과가 더 민감하다"가 구별되지 않고, 단일 지표 축만 있으면
          비교의 기준이 안 생긴다. 범위와 출처는 lib/exploreSims.js 상수 주석이 소유한다. */}
      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">{t('explore.climate.varsTitle')}</p>

        {/* ⓐ CO₂ 농도 */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-co2" className="text-sm font-bold text-slate-700">
              {t('explore.climate.co2Label')}
            </label>
            <span className="text-sm font-extrabold text-sky-700">{co2}ppm</span>
          </div>
          <input
            id="explore-co2"
            type="range"
            min={CO2_MIN}
            max={CO2_MAX}
            step={1}
            value={co2}
            onChange={(e) => setCo2(Number(e.target.value))}
            className="mt-2 w-full accent-sky-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{t('explore.climate.scaleMin', { min: CO2_MIN })}</span>
            <span className="font-bold text-slate-500">{t('explore.climate.scaleNow', { n: CO2_PRESENT_DAY })}</span>
            <span>{t('explore.climate.scaleMax', { max: CO2_MAX })}</span>
          </div>
        </div>

        {/* ⓑ 기후민감도 — 범위는 IPCC AR6 very likely range 2~5℃ 그대로 */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-sensitivity" className="text-sm font-bold text-slate-700">
              {t('explore.climate.sensLabel')}
            </label>
            <span className="text-sm font-extrabold text-sky-700">
              {sensitivity.toFixed(1)}℃
            </span>
          </div>
          <input
            id="explore-sensitivity"
            type="range"
            min={CLIMATE_SENSITIVITY_MIN}
            max={CLIMATE_SENSITIVITY_MAX}
            step={CLIMATE_SENSITIVITY_STEP}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="mt-2 w-full accent-sky-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{t('explore.climate.sensScaleMin', { min: CLIMATE_SENSITIVITY_MIN.toFixed(1) })}</span>
            <span className="font-bold text-slate-500">
              {t('explore.climate.sensScaleLikely', {
                lo: CLIMATE_SENSITIVITY_LIKELY.lo.toFixed(1),
                hi: CLIMATE_SENSITIVITY_LIKELY.hi.toFixed(1),
              })}
            </span>
            <span>{t('explore.climate.sensScaleMax', { max: CLIMATE_SENSITIVITY_MAX.toFixed(1) })}</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            {t('explore.climate.sensSource')}
          </p>
        </div>

        {/* ⓒ 해수면 반응 계수 — 해수면 카드 하나만 움직인다(곡선은 온도 축이라 무관) */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-sea-slope" className="text-sm font-bold text-slate-700">
              {t('explore.climate.seaSlopeLabel')}
            </label>
            <span className="text-sm font-extrabold text-sky-700">
              {seaLevelPerDeg}cm/℃
            </span>
          </div>
          <input
            id="explore-sea-slope"
            type="range"
            min={SEA_LEVEL_CM_PER_DEG_MIN}
            max={SEA_LEVEL_CM_PER_DEG_MAX}
            step={SEA_LEVEL_CM_PER_DEG_STEP}
            value={seaLevelPerDeg}
            onChange={(e) => setSeaLevelPerDeg(Number(e.target.value))}
            className="mt-2 w-full accent-sky-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{t('explore.climate.seaSlopeScaleMin', { min: SEA_LEVEL_CM_PER_DEG_MIN })}</span>
            <span className="font-bold text-slate-500">
              {t('explore.climate.seaSlopeScaleNow', { n: SEA_LEVEL_CM_PER_DEG })}
            </span>
            <span>{t('explore.climate.seaSlopeScaleMax', { max: SEA_LEVEL_CM_PER_DEG_MAX })}</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            {t('explore.climate.seaSlopeSource')}
          </p>
        </div>

        <button
          type="button"
          onClick={resetAll}
          className="w-full rounded-xl bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          {t('explore.climate.reset')}
        </button>
      </div>

      {/* 파생 지표 카드 2종 */}
      <div className="grid grid-cols-2 gap-3">
        <IndicatorCard
          icon="🌊"
          title={t('explore.climate.seaTitle')}
          value={result.sea_level}
          unit={t('explore.climate.seaUnit')}
          // ⚠️ 계수를 넘겨야 한다 — 이 문구가 「1℃당 약 {k}cm」라서, 안 넘기면
          // 슬라이더를 39로 올려도 설명만 「23cm」라 카드가 자기 값과 다른 말을 한다.
          note={t('explore.climate.seaNote', { k: seaLevelPerDeg })}
        />
        <IndicatorCard
          icon="🔥"
          title={t('explore.climate.heatTitle')}
          value={result.heat_days}
          unit={t('explore.climate.heatUnit')}
          note={t('explore.climate.heatNote')}
        />
      </div>

      {/* 왜 그럴까 설명 패널 */}
      <div className="rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
        <p className="text-sm font-bold text-sky-800">{t('explore.common.whyTitle')}</p>
        <ul className="mt-2 space-y-2">
          {whyLines.map((line, i) => (
            <li key={i} className="text-xs leading-relaxed text-sky-900">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-sky-100 pt-2 text-[10px] leading-relaxed text-sky-700/70">
          {t('explore.climate.caveat')}
        </p>
      </div>

      {/* θ 루프 연결 CTA */}
      {/* CO-S-10: 라벨은 "학습 경로에서 이어가기"인데 목적지가 `/`(홈)였다 —
          학습 경로는 `/learn`이다. 동봉하던 state={{focusConcept}}는 소비자가
          0건이라(대장 「죽은 분기」 등재) 함께 걷어낸다. */}
      <Link
        to="/learn"
        className="block rounded-2xl bg-sky-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-700"
      >
        {t('explore.climate.cta')}
      </Link>
    </div>
  );
}

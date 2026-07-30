import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  climateResponse,
  CO2_BASELINE,
  CO2_MIN,
  CO2_MAX,
  CLIMATE_SENSITIVITY,
} from '../../lib/exploreSims';

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

/** 조건별 결정적 설명 문구. */
function explainWhy(co2, result) {
  const lines = [];
  lines.push(
    `CO₂는 지구가 내보내는 적외선(열)을 흡수해 되돌려 보내는 온실기체예요. ` +
      `농도가 ${CO2_BASELINE}ppm(산업화 이전)에서 ${co2}ppm으로 오르면, 이 모델에서 ` +
      `지구 평균기온은 약 ${result.anomaly.toFixed(2)}℃ 올라요.`,
  );
  lines.push(
    '주목할 점은 온도가 농도에 정비례하지 않고 로그(배수)로 반응한다는 거예요. ' +
      `CO₂가 두 배(280→560ppm)가 될 때마다 약 ${CLIMATE_SENSITIVITY.toFixed(1)}℃씩 오르죠. ` +
      '같은 +10ppm이라도 농도가 낮을 때 더 큰 효과를 내요.',
  );
  if (co2 <= CO2_BASELINE) {
    lines.push('지금은 산업화 이전 수준이에요 — 기준점(아노말리 0℃)입니다.');
  } else if (co2 <= CO2_PRESENT_DAY) {
    lines.push(
      '이 구간은 인류가 이미 지나온 길이에요. 산업혁명 이후 화석연료 연소로 ' +
        `농도가 ${CO2_BASELINE}ppm에서 오늘날 약 ${CO2_PRESENT_DAY}ppm까지 올랐어요.`,
    );
  } else {
    lines.push(
      `${CO2_PRESENT_DAY}ppm(현재 근사)을 넘는 구간은 앞으로의 선택에 달린 미래예요. ` +
        '따뜻해진 바닷물은 부피가 커지고(열팽창) 빙하가 녹아 해수면이 오르고, ' +
        '평균기온이 조금만 올라도 극단적인 더위는 훨씬 자주 나타나요.',
    );
  }
  return lines;
}

/**
 * 온도 아노말리 곡선 — 280~560ppm 전 구간을 20ppm 간격으로 샘플링한 로그 곡선
 * 위에 현재 선택값 마커를 얹는다. 경량 SVG(외부 차트 라이브러리 없이).
 */
function AnomalyCurve({ co2, anomaly }) {
  const w = 280;
  const h = 130;
  const pad = { left: 30, right: 12, top: 12, bottom: 22 };
  const maxY = CLIMATE_SENSITIVITY; // 560ppm에서 3.0℃
  const xOf = (c) => pad.left + ((c - CO2_MIN) / (CO2_MAX - CO2_MIN)) * (w - pad.left - pad.right);
  const yOf = (a) => h - pad.bottom - (a / maxY) * (h - pad.top - pad.bottom);

  const points = useMemo(() => {
    const pts = [];
    for (let c = CO2_MIN; c <= CO2_MAX; c += 20) {
      pts.push(`${xOf(c).toFixed(1)},${yOf(climateResponse({ co2: c }).anomaly).toFixed(1)}`);
    }
    return pts.join(' ');
    // xOf·yOf는 상수 기반 — 의존성 없음
  }, []);

  const color = anomalyColor(anomaly);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`CO2 ${co2}ppm에서 온도 아노말리 ${anomaly}℃`}>
      {/* y 눈금 (1/2/3℃) */}
      {[1, 2, 3].map((g) => (
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
        현재≈{CO2_PRESENT_DAY}
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
  const [co2, setCo2] = useState(CO2_PRESENT_DAY);

  const result = useMemo(() => climateResponse({ co2 }), [co2]);
  const color = anomalyColor(result.anomaly);
  const whyLines = explainWhy(co2, result);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/explore" className="text-xs font-medium text-sky-600 hover:text-sky-700">
            ← 탐구
          </Link>
          <h1 className="text-lg font-extrabold text-slate-800">🌡️ 기후변화 체험</h1>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold" style={{ color }}>
          +{result.anomaly.toFixed(2)}℃
        </span>
      </div>

      <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        교육용 단순화 모델이에요. ΔT = S·log₂(C/C₀), S=3.0℃(배증당) 로그 감도
        근사로, 실제 기후 전망(수치 모델)·특정 연도 예측이 아닙니다.
      </p>

      {/* 아노말리 곡선 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">지구 평균기온 아노말리</p>
        <p className="text-[11px] text-slate-400">산업화 이전(280ppm) 대비 상승분 — 로그 감도 곡선</p>
        <div className="mt-2">
          <AnomalyCurve co2={co2} anomaly={result.anomaly} />
        </div>
      </div>

      {/* CO2 슬라이더 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between">
          <label htmlFor="explore-co2" className="text-sm font-bold text-slate-700">
            CO₂ 농도
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
          <span>{CO2_MIN}ppm 산업화 이전</span>
          <span className="font-bold text-slate-500">현재 ≈ {CO2_PRESENT_DAY}ppm</span>
          <span>{CO2_MAX}ppm 배증</span>
        </div>
        <button
          type="button"
          onClick={() => setCo2(CO2_PRESENT_DAY)}
          className="mt-2 w-full rounded-xl bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          현재 농도로 되돌리기
        </button>
      </div>

      {/* 파생 지표 카드 2종 */}
      <div className="grid grid-cols-2 gap-3">
        <IndicatorCard
          icon="🌊"
          title="해수면 상승"
          value={result.sea_level}
          unit="cm"
          note="열팽창·빙하 융해를 1℃당 약 23cm로 축약한 교육 근사"
        />
        <IndicatorCard
          icon="🔥"
          title="연간 폭염일수"
          value={result.heat_days}
          unit="일"
          note="기준 10일/년에서 1℃당 약 1.9배로 늘어나는 교육 근사"
        />
      </div>

      {/* 왜 그럴까 설명 패널 */}
      <div className="rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
        <p className="text-sm font-bold text-sky-800">🤔 왜 그럴까?</p>
        <ul className="mt-2 space-y-2">
          {whyLines.map((line, i) => (
            <li key={i} className="text-xs leading-relaxed text-sky-900">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-sky-100 pt-2 text-[10px] leading-relaxed text-sky-700/70">
          단순화: 실제 기후는 해양 열관성(수십 년 지연)·구름 되먹임·지역 차이가 커서
          같은 농도라도 시점·지역마다 반응이 달라요. 여기 값은 평형 응답의 전 지구
          평균 경향이에요.
        </p>
      </div>

      {/* θ 루프 연결 CTA */}
      <Link
        to="/"
        state={{ focusConcept: 'co2_climate' }}
        className="block rounded-2xl bg-sky-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-700"
      >
        🌡️ CO₂와 기후 개념 퀴즈 풀기 — 학습 경로에서 이어가기
      </Link>
    </div>
  );
}

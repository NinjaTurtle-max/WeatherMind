import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  climateResponse,
  CO2_BASELINE,
  CO2_MIN,
  CO2_MAX,
  CLIMATE_SENSITIVITY,
} from '../../lib/exploreSims';
// MT-24 탐구 목표 — 「변수를 바꿔보며」에 「해냈다」를 붙인다.
import GoalPanel from './GoalPanel';
import { CLIMATE_GOALS } from './exploreGoals';
import HeroBanner from '../../components/HeroBanner';
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
function explainWhy(t, co2, result) {
  const lines = [];
  lines.push(
    t('explore.climate.why1', { baseline: CO2_BASELINE, co2, anomaly: result.anomaly.toFixed(2) }),
  );
  lines.push(t('explore.climate.why2', { sens: CLIMATE_SENSITIVITY.toFixed(1) }));
  if (co2 <= CO2_BASELINE) {
    lines.push(t('explore.climate.whyBaseline'));
  } else if (co2 <= CO2_PRESENT_DAY) {
    lines.push(t('explore.climate.whyPast', { baseline: CO2_BASELINE, present: CO2_PRESENT_DAY }));
  } else {
    lines.push(t('explore.climate.whyFuture', { present: CO2_PRESENT_DAY }));
  }
  return lines;
}

/**
 * 온도 아노말리 곡선 — 280~560ppm 전 구간을 20ppm 간격으로 샘플링한 로그 곡선
 * 위에 현재 선택값 마커를 얹는다. 경량 SVG(외부 차트 라이브러리 없이).
 */
function AnomalyCurve({ co2, anomaly }) {
  const t = useT();
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
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t('explore.climate.curveAria', { co2, anomaly })}>
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
  const [co2, setCo2] = useState(CO2_PRESENT_DAY);

  const result = useMemo(() => climateResponse({ co2 }), [co2]);
  const color = anomalyColor(result.anomaly);
  const whyLines = explainWhy(t, co2, result);

  return (
    <div className="space-y-4 py-4">
      {/* 🔴 **상단 튜터 배너**(2026-08-19 사용자 지시). 담당은 **온도계**이고,
          소유자는 `SideNav.TUTOR_BY_PATH`의 `/explore/climate` 행이다
          (`mascotAssets.contract` ④가 그 표와 여기를 대조한다).
          태풍 실험실과 같은 꼴로 짠다 — 배너를 얹지 않고 **종전 제목 줄을
          바꿔 넣고**, 아노말리 배지는 `right` 슬롯으로 자리를 지킨다. */}
      <Link to="/explore" className="inline-block text-xs font-medium text-sky-600 hover:text-sky-700">
        {t('explore.common.back')}
      </Link>
      <HeroBanner
        testId="climate-hero"
        mascot="thermometer"
        as="h1"
        eyebrow={t('explore.climate.title')}
        title={t('explore.climate.heroTitle')}
        // 🔴 **모델 고지를 배너 안, 제목 바로 아래로**(2026-08-19 사용자 지시).
        // 종전에는 배너 아래 회색 띠 한 장으로 따로 서 있었다.
        // ⚠️ **`description`을 함께 쓰지 않는다.** 설명(explore.home.climateDesc)은
        //    탐구 홈 카드에서 이미 읽은 같은 문장이고, 그것을 오른쪽에 남기면
        //    제목 열이 658px로 좁아져 고지가 두 줄로 접히며 배너가 h=90 → 101이
        //    된다(실측). 비우면 제목 열이 1,018px이라 고지가 한 줄에 들어간다.
        //    한 배너에 설명문 두 벌을 두지 않는 편이 읽기에도 낫다.
        note={t('explore.climate.disclaimer')}
        right={
          // 칩 바탕이 `slate-100` → **흰색**이다. 남색 배너 위에서 slate-100은
          // 거의 안 보이고, 글자색(anomalyColor)은 전부 600단계라 남색 직접
          // 배치도 대비가 안 난다 — 흰 칩을 깔아야 그 색이 살아난다.
          // 색은 심각도를 나르는 채널이라 **없애지 않는다**(0.75/1.5/2.25 경계).
          <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold" style={{ color }}>
            +{result.anomaly.toFixed(2)}℃
          </span>
        }
      />

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

      {/* 🔴 **2열 구간**(2026-08-19 사용자 지시 — "아노말리 그래프 크기 줄여서
          왼쪽, 오른쪽에는 CO2 농도·해수면 상승·연간 폭염일수").

          왜 이 둘만 묶이나: 곡선은 **CO₂ 하나에만 반응하는 그림**이고 오른쪽 셋은
          그 CO₂와 그것이 낳는 값들이다. 슬라이더를 밀 때 눈이 오가야 하는 범위가
          이 사각형 안으로 들어온다 — 종전에는 곡선(582px)이 슬라이더를 화면
          밖으로 밀어내 **미는 손과 움직이는 그림이 같이 안 보였다**.
          탐구 목표는 위에 그대로, 「왜 그럴까」와 CTA는 아래에 그대로 남는다
          (사용자 지시 1·3) — 그 셋은 CO₂ 값에 따라 자리가 바뀌지 않는다.

          ⚠️ **곡선을 "줄인다"고 높이를 박지 않았다.** `AnomalyCurve`는 viewBox
          SVG에 `w-full`이라 **폭이 줄면 높이가 따라 준다** — 열을 나누는 것만으로
          582 → 약 380이 된다. `h-…`를 박으면 뷰포트마다 그림이 찌그러진다.
          ⚠️ `lg:` 아래에서는 한 열로 접힌다. 그때 곡선이 먼저 오는 순서는
          종전과 같다(곡선 → 슬라이더 → 지표). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* 아노말리 곡선 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">{t('explore.climate.anomalyTitle')}</p>
        <p className="text-[11px] text-slate-400">{t('explore.climate.anomalySub')}</p>
        <div className="mt-2">
          <AnomalyCurve co2={co2} anomaly={result.anomaly} />
        </div>
      </div>

      {/* 오른쪽 열 — CO₂ 농도(입력) 위, 그것이 낳는 지표 둘 아래. 순서가 인과다. */}
      <div className="flex flex-col gap-3">
      {/* CO2 슬라이더 카드 — 🔴 **오른쪽 열의 남는 세로를 여기가 먹는다**
          (2026-08-19 사용자 지시 — 지표 둘을 한 줄로 눕히고 "그 남은 한 줄 여백을
          CO₂ 농도 슬라이드 크기를 세로로 더 키워서 맞춰줘").

          `flex-1`이 그 몫이다: 왼쪽 곡선이 행 높이를 정하고, 지표 줄은 제 높이만
          쓰고, 남는 것을 이 카드가 가져간다. 그래서 **두 열이 같은 줄에서 끝난다.**
          ⚠️ 높이를 숫자로 박으면 안 된다 — 행 높이는 곡선의 폭(= 뷰포트)이 정하므로
          1536·1280·1024에서 값이 다 다르다. 실측 CO₂ 카드 271 / 271 / 271은
          우연이 아니라 지표 줄(130)과 간격(12)을 뺀 나머지다.

          늘어난 자리는 슬라이더 뭉치가 쓴다(`justify-center`) — 카드만 키우고
          내용을 위에 붙이면 아래가 빈 상자가 된다. 트랙도 함께 두꺼워진다
          (전역 `input[type=range]`는 h-2 · 여기만 h-3): 세로로 큰 카드에서
          2px 트랙은 카드 한복판에 실 한 줄이 그어진 것처럼 보인다. */}
      <div className="flex flex-1 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between">
          <label htmlFor="explore-co2" className="text-sm font-bold text-slate-700">
            {t('explore.climate.co2Label')}
          </label>
          <span className="text-lg font-extrabold text-sky-700">{co2}ppm</span>
        </div>
        <div className="flex flex-1 flex-col justify-center py-2">
          <input
            id="explore-co2"
            type="range"
            min={CO2_MIN}
            max={CO2_MAX}
            step={1}
            value={co2}
            onChange={(e) => setCo2(Number(e.target.value))}
            // `!h-3` — 전역 h-2를 이 화면에서만 덮는다. 전역을 키우면 태풍
            // 실험실·보드 조절값까지 함께 두꺼워진다(그쪽은 카드가 낮아 지금이 맞다).
            className="!h-3 w-full accent-sky-600"
          />
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{t('explore.climate.scaleMin', { min: CO2_MIN })}</span>
            <span className="font-bold text-slate-500">{t('explore.climate.scaleNow', { n: CO2_PRESENT_DAY })}</span>
            <span>{t('explore.climate.scaleMax', { max: CO2_MAX })}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCo2(CO2_PRESENT_DAY)}
          className="w-full rounded-xl bg-slate-100 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          {t('explore.climate.reset')}
        </button>
      </div>

      {/* 파생 지표 카드 2종 — **어느 폭에서나 한 줄**이다(2026-08-19 사용자 지시
          "해수면 상승·연간 폭염일수를 한 줄에 배치할 수 있게 가로 크기 줄여").
          ⚠️ 하루 전 판에서 이 줄이 `lg:grid-cols-1`로 세로 배치였다. 그때 근거로
          「좁은 열에서 한 칸 220px라 라벨이 두 줄로 접힌다」고 적었는데 **실측
          없이 어림한 값이라 틀렸다** — 실제 한 칸은 1536에서 250px이고 「연간
          폭염일수」는 한 줄에 든다. 세로로 쌓을 이유가 없었다.
          한 칸이 가장 좁아지는 lg(1024)에서 169px인데 거기서도 한 줄이다(실측). */}
      <div className="grid grid-cols-2 gap-3">
        <IndicatorCard
          icon="🌊"
          title={t('explore.climate.seaTitle')}
          value={result.sea_level}
          unit={t('explore.climate.seaUnit')}
          note={t('explore.climate.seaNote')}
        />
        <IndicatorCard
          icon="🔥"
          title={t('explore.climate.heatTitle')}
          value={result.heat_days}
          unit={t('explore.climate.heatUnit')}
          note={t('explore.climate.heatNote')}
        />
      </div>

      </div>{/* /오른쪽 열 */}
      </div>{/* /2열 구간 */}

      {/* 왜 그럴까 설명 패널 — 2열 **밖**이다(사용자 지시 3 "나머지 그대로 하단").
          긴 문단 셋이라 좁은 열에 넣으면 오른쪽 열만 혼자 길어진다. */}
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

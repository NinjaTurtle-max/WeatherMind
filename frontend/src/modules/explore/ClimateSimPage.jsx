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
      {/* 🔴 **상단 줄 — 왼쪽 뒤로가기 · 오른쪽 모델 고지**(2026-08-19 사용자
          정정 "튜터 카드 아예 밖으로 빼달라는 말이었어").

          고지는 하루 동안 세 자리를 거쳤다: 배너 아래 회색 띠 → 배너 안 제목
          아래(h=104) → 배너 안 오른쪽 열(h=90) → **배너 밖 위쪽 줄**(지금).
          경위를 남기는 이유는 그때마다 배너 치수 계약을 손댔기 때문이다 —
          지금은 배너가 고지를 아예 모르므로 그 계약이 단순해졌다(h=90 고정).

          뒤로가기와 **같은 행**에 두는 것이 요점이다. 위에 한 줄을 더 얹으면
          화면이 그만큼 길어지는데, 이 화면들을 손보는 내내 사용자가 세로를
          줄이라고 해 왔다. 왼쪽은 링크, 오른쪽은 고지라 서로 자리를 뺏지 않는다.
          ⚠️ 좁은 화면에서는 `flex-wrap`으로 두 줄이 되고 고지가 왼쪽 정렬로
          떨어진다 — `sm:text-right`라 그때는 오른쪽 정렬을 풀어 준다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link to="/explore" className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-700">
          {t('explore.common.back')}
        </Link>
        <p className="min-w-0 text-[10.5px] leading-snug text-slate-400 sm:text-right">
          {t('explore.climate.disclaimer')}
        </p>
      </div>
      <HeroBanner
        testId="climate-hero"
        mascot="thermometer"
        as="h1"
        eyebrow={t('explore.climate.title')}
        title={t('explore.climate.heroTitle')}
        // 설명은 탐구 홈 카드 문장을 그대로 쓴다 — 사용자가 이 화면의 문구를
        // 따로 지정하지 않았다(태풍만 전용 키를 받았다).
        description={t('explore.home.climateDesc')}
        tightDescription
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

      {/* 🔴 **2열 구간**(2026-08-19 사용자 지시로 세 번 다듬었다. 지금 판:
          "CO₂ 조절 슬라이드를 아노말리 그래프 아래로, 오른쪽에는 해수면온도·
           폭염일수를 상단에, 왜그럴까를 바로 아래에 크기 맞춰서").

            왼쪽 = 곡선 → CO₂ 슬라이더      (보고 · 만지고)
            오른쪽 = 지표 둘 → 왜 그럴까    (결과 · 설명)

          왼쪽이 **입력 축**이 된 것이 이번 판의 요점이다: 곡선 위 점을 보며 바로
          아래 슬라이더를 미는 동선이 한 열 안에서 끝난다. 오른쪽은 그 결과를
          숫자로 받고(지표) 말로 받는다(해설) — 위에서 아래로 읽으면 인과다.
          ⚠️ 「왜 그럴까」가 **2열 안으로 들어왔다.** 어제 이 자리에 *"긴 문단
          셋이라 좁은 열에 넣으면 오른쪽 열만 혼자 길어진다"*고 적고 밖에 뒀는데,
          지표 둘이 한 줄로 눕고(147px) 왼쪽이 곡선+슬라이더로 길어지면서
          **오히려 그 자리가 남게 됐다.** 종전 기술은 그 전 배치에서만 참이었다.
          탐구 목표와 CTA는 계속 격자 밖 위·아래다.

          ⚠️ **곡선을 "줄인다"고 높이를 박지 않았다.** `AnomalyCurve`는 viewBox
          SVG에 `w-full`이라 폭이 줄면 높이가 따라 준다. `h-…`를 박으면 뷰포트마다
          그림이 찌그러진다.
          ⚠️ `lg:` 아래에서는 한 열로 접힌다 — 곡선 → 슬라이더 → 지표 → 해설 순이라
          접혀도 읽는 순서가 그대로다. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* 왼쪽 열 — 곡선(보는 것) 위, CO₂ 슬라이더(만지는 것) 아래. */}
      <div className="flex flex-col gap-3">
      {/* 아노말리 곡선 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">{t('explore.climate.anomalyTitle')}</p>
        <p className="text-[11px] text-slate-400">{t('explore.climate.anomalySub')}</p>
        <div className="mt-2">
          <AnomalyCurve co2={co2} anomaly={result.anomaly} />
        </div>
      </div>

      {/* CO2 슬라이더 카드 — **곡선 바로 아래**(2026-08-19 사용자 지시). 곡선 위
          점을 보며 그 아래 슬라이더를 미는 동선이 한 열 안에서 끝난다.

          ⚠️ **`flex-1`은 남긴다 — 다만 뜻이 바뀌었다.** 양쪽 열이 각자 `flex-1`
          카드를 하나씩 갖고(왼쪽=이 카드, 오른쪽=「왜 그럴까」), **더 짧은 쪽이
          남는 세로를 흡수**한다. 어느 쪽이 짧은지는 뷰포트가 정한다:
            1536·1280 → 왼쪽이 길다(곡선이 크다). 이 카드는 143px 그대로.
            1024      → 오른쪽이 길다(해설 문단이 좁아져 늘어난다). 이 카드가
                        143 → 239로 늘어 왼쪽 아래 빈자리를 메운다.
          한쪽에만 달면 반대 폭에서 그 열 아래가 빈 채로 남는다(1024에서 96px).
          슬라이더 뭉치의 `justify-center`와 두꺼운 트랙은 유지한다 — 전역 h-2
          트랙은 이 카드 높이에서 실처럼 가늘다(전역을 키우면 태풍 실험실·보드
          조절값까지 번진다). */}
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

      </div>{/* /왼쪽 열 */}

      {/* 오른쪽 열 — 지표 둘(숫자로 받는 결과) 위, 해설(말로 받는 결과) 아래. */}
      <div className="flex flex-col gap-3">
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

      {/* 왜 그럴까 설명 패널 — 🔴 **오른쪽 열 아래, 지표 바로 밑**(2026-08-19
          사용자 지시 "왜그럴까를 바로 아래에 크기 맞춰서"). `flex-1`이 그
          「크기 맞춰서」다: 지표 줄은 제 높이(147px)만 쓰고, 왼쪽 열(곡선 +
          슬라이더)이 정한 행 높이에서 남는 것을 이 카드가 가져간다 —
          그래서 두 열이 같은 줄에서 끝난다.
          ⚠️ 높이를 숫자로 박지 말 것. 행 높이는 곡선의 폭(= 뷰포트)이 정하므로
          폭마다 다르다. */}
      <div className="flex flex-1 flex-col rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
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

      </div>{/* /오른쪽 열 */}
      </div>{/* /2열 구간 */}

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

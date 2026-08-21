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
            +{g}{t('common.celsius')}
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
    <div className="space-y-4 pt-2">
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
        <Link to="/explore" className="shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('explore.common.back')}
        </Link>
        <p className="min-w-0 text-[10.5px] leading-snug text-slate-400 sm:text-right">
          {/* 고지 문구도 **지금 값**을 말해야 한다 — S를 상수로 박아 두면
              슬라이더를 움직인 화면이 자기 모델을 틀리게 설명한다
              (i18n 값에 `{sens}` 자리표가 있으므로 인자 없이 부르면 글자로 뜬다). */}
          {t('explore.climate.disclaimer', { sens: sensitivity.toFixed(1) })}
        </p>
      </div>
      {/* 튜터 배너 — 담당은 **온도계**이고 소유자는 `SideNav.TUTOR_BY_PATH`의
          `/explore/climate` 행이다(`mascotAssets.contract` ④가 대조한다).
          ⚠️ 이 주석은 2026-08-19에 **상단 줄 위에 떠 있었다** — 고지를 배너 밖으로
             빼면서 그 사이에 새 블록이 들어왔는데 주석만 제자리에 남아, 배너를
             설명하는 글이 엉뚱한 요소를 가리켰다. 옮기면 주석도 따라가야 한다. */}
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
            +{result.anomaly.toFixed(2)}{t('common.celsius')}
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
          비교의 기준이 안 생긴다. 범위와 출처는 lib/exploreSims.js 상수 주석이 소유한다.

          ⚠️ **`flex-1`은 남긴다.** 양쪽 열이 각자 `flex-1` 카드를 하나씩 갖고
          (왼쪽=이 카드, 오른쪽=「왜 그럴까」), **더 짧은 쪽이 남는 세로를 흡수**한다.
          한쪽에만 달면 반대 폭에서 그 열 아래가 빈 채로 남는다(1024에서 96px).
          `space-y-4`는 카드 안 세 변수 사이의 간격이라 그대로 둔다 — 뒤에 붙여도
          Tailwind 클래스 순서는 뜻을 바꾸지 않는다. */}
      <div className="flex flex-1 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 space-y-4">
        <p className="text-sm font-bold text-slate-700">{t('explore.climate.varsTitle')}</p>

        {/* ⓐ CO₂ 농도 — 이 블록이 카드의 **흡수자**다. 늘어난 자리를 슬라이더
            뭉치가 `justify-center`로 쓴다(위에 붙이면 아래가 빈 상자로 보인다). */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-co2" className="text-sm font-bold text-slate-700">
              {t('explore.climate.co2Label')}
            </label>
            <span className="text-sm font-extrabold text-sky-700">{co2}ppm</span>
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
          // 🔴 `resetAll` — 변수가 셋인데 `setCo2`만 되돌리면 「초기화」가
          //    3개 중 1개만 되돌려 버튼이 거짓말을 한다.
          onClick={resetAll}
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

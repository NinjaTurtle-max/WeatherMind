import { useMemo, useState } from 'react';
// 위성 도식(MT-21) — 시어가 만드는 **비대칭**을 보인다. TyphoonEye가 못 보여주는 축이다.
import SatelliteView from './SatelliteView';
// MT-24 탐구 목표 — 「변수를 바꿔보며」에 「해냈다」를 붙인다.
import GoalPanel from './GoalPanel';
import { TYPHOON_GOALS } from './exploreGoals';
import { Link } from 'react-router-dom';
import {
  typhoonIntensity,
  SST_GENESIS_THRESHOLD,
  SST_MIN,
  SST_MAX,
} from '../../lib/exploreSims';
import HeroBanner from '../../components/HeroBanner';
import { useT } from '../../i18n';

/**
 * 태풍 시뮬 페이지 (R9-01 §3.5 S5) — 순수 클라이언트 탐구 모듈, 라우트 /explore/typhoon.
 *
 * 슬라이더(해수면온도 24~32℃·연직시어 약/중/강) → 결정적 교육 모델
 * (src/lib/exploreSims.js typhoonIntensity)로 즉시 재계산:
 *   강도 게이지(SVG 반원) + 카테고리 배지 + 발달 곡선(SVG 폴리라인)
 *   + 태풍 눈 시각화(강도 비례 회전 — CSS keyframes, prefers-reduced-motion 대응)
 *   + "왜 그럴까" 설명 패널(조건별 결정적 문구).
 * 하단 CTA로 typhoon 개념 유닛 학습 홈(/)에 연결(θ 루프 §3.5).
 *
 * 수치 모델이 아니라 교육용 결정적 근사임을 화면에 명시한다(R3 폐지 원칙 정합).
 * 문구·그래픽 전부 자체 제작, 외부 라이브러리·에셋 없음.
 */

// 라벨은 i18n 키 — 렌더 시 t()로 해석한다(R11-01 §6.3 외부화).
//
// ⚠️ 종전에는 항목마다 `color`(등급별 6색)가 있어 태풍 그림·게이지·발달 곡선을
// 전부 그 색으로 칠했다. **2026-08-11 사용자 지시로 제거**한다 — 태풍은 언제나
// 흰색이고 세기는 **크기로만** 읽는다. `badge`(라벨 칩)는 남긴다: 그것은 세기가
// 아니라 **등급 이름**을 가리키는 표식이고, 숫자·라벨과 함께 나오므로 색 단독으로
// 정보를 나르지 않는다(같은 저장소의 LEVEL_CHIP 관례와 동일).
const CATEGORY_META = {
  none: { labelKey: 'explore.typhoon.catNone', badge: 'bg-slate-100 text-slate-600' },
  TD: { labelKey: 'explore.typhoon.catTd', badge: 'bg-sky-100 text-sky-700' },
  TS: { labelKey: 'explore.typhoon.catTs', badge: 'bg-teal-100 text-teal-700' },
  STS: { labelKey: 'explore.typhoon.catSts', badge: 'bg-amber-100 text-amber-700' },
  TY: { labelKey: 'explore.typhoon.catTy', badge: 'bg-orange-100 text-orange-700' },
  super: { labelKey: 'explore.typhoon.catSuper', badge: 'bg-rose-100 text-rose-700' },
};

// 게이지·곡선의 단일 색. **등급에 따라 바뀌지 않는다** — 바뀌면 색이 세기를
// 다시 나르게 되어 "크기로만 구별"이 그 자리에서 깨진다. 값은 앱의 측정치 색
// (abilityDisplay.COLOR_MEASURED)과 같은 sky-600이다.
const CHART_ACCENT = '#0284c7';

const SHEAR_OPTIONS = [
  { value: 'weak', labelKey: 'explore.typhoon.shearWeak' },
  { value: 'moderate', labelKey: 'explore.typhoon.shearModerate' },
  { value: 'strong', labelKey: 'explore.typhoon.shearStrong' },
];

/** 조건별 결정적 설명 문구 — 같은 입력이면 항상 같은 설명. t는 호출부의 useT(). */
function explainWhy(t, sst, shear, result) {
  const lines = [];
  if (sst <= SST_GENESIS_THRESHOLD) {
    lines.push(t('explore.typhoon.whyBelow', { sst: sst.toFixed(1) }));
    lines.push(t('explore.typhoon.whyBelowCta'));
    return lines;
  }
  lines.push(t('explore.typhoon.whyAbove', { diff: (sst - SST_GENESIS_THRESHOLD).toFixed(1) }));
  if (shear === 'weak') {
    lines.push(t('explore.typhoon.whyShearWeak'));
  } else if (shear === 'moderate') {
    lines.push(t('explore.typhoon.whyShearModerate'));
  } else {
    lines.push(t('explore.typhoon.whyShearStrong'));
  }
  if (result.category === 'super') {
    lines.push(t('explore.typhoon.whySuper'));
  }
  return lines;
}

/** 반원 게이지 — 반지름 70, 둘레의 절반을 strokeDasharray로 채운다. */
function IntensityGauge({ intensity, color }) {
  const t = useT();
  const r = 70;
  const half = Math.PI * r; // 반원 호 길이
  const filled = (intensity / 100) * half;
  return (
    <svg viewBox="0 0 180 100" className="mx-auto w-48" role="img" aria-label={t('explore.typhoon.gaugeAria', { n: intensity })}>
      <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#e2e8f0" strokeWidth="14" strokeLinecap="round" />
      <path
        d="M 20 90 A 70 70 0 0 1 160 90"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${half}`}
        style={{ transition: 'stroke-dasharray 0.3s ease, stroke 0.3s ease' }}
      />
      <text x="90" y="78" textAnchor="middle" className="fill-slate-800" fontSize="28" fontWeight="800">
        {intensity}
      </text>
      <text x="90" y="95" textAnchor="middle" className="fill-slate-400" fontSize="11">
        {t('explore.typhoon.gaugeUnit')}
      </text>
    </svg>
  );
}

/** 발달 곡선 — 경량 SVG 폴리라인(외부 차트 라이브러리 없이). */
function DevelopmentCurve({ curve, color }) {
  const t = useT();
  const w = 280;
  const h = 110;
  const pad = 10;
  const points = curve
    .map((v, i) => {
      const x = pad + (i / (curve.length - 1)) * (w - pad * 2);
      const y = h - pad - (v / 100) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t('explore.typhoon.curveAria')}>
      {/* 눈금선 (25/50/75) */}
      {[25, 50, 75].map((g) => {
        const y = h - pad - (g / 100) * (h - pad * 2);
        return <line key={g} x1={pad} x2={w - pad} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />;
      })}
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#cbd5e1" strokeWidth="1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 태풍 눈 시각화 — 자체 제작 SVG 나선(강수 밴드 3개 + 눈).
 * 회전 속도는 강도에 비례(강할수록 빠름). prefers-reduced-motion이면 정지.
 */
function TyphoonEye({ intensity }) {
  const t = useT();
  // 강도 0→정지, 100→2.2초/회전. 선형 보간(느림 12초 ~ 빠름 2.2초).
  const duration = intensity > 0 ? 12 - (intensity / 100) * 9.8 : 0;
  // 강수 밴드 크기 — **강도를 나르는 유일한 채널**(2026-08-11 사용자 지시).
  // 종전에는 등급별 6색 + 투명도(0.35~0.80)가 강도를 함께 표현했는데, 색으로
  // 세기를 읽히면 (a) 색맹 사용자에게 정보가 사라지고 (b) 등급 경계가 실제보다
  // 뚜렷해 보인다 — 이 시뮬레이터는 연속량을 다루는데 색은 계단으로 읽힌다.
  // 이제 태풍은 언제나 흰색이고, 세기는 **밴드가 얼마나 크게 감기는가**로만 읽는다.
  const bandScale = 0.55 + (intensity / 100) * 0.45; // 0.55 ~ 1.00
  // 눈은 반대로 **강할수록 작다** — 실제 태풍도 발달할수록 눈이 조여든다.
  const eyeR = Math.max(5, 14 - (intensity / 100) * 8);
  return (
    <div className="relative mx-auto h-36 w-36" aria-label={intensity > 0 ? t('explore.typhoon.eyeSpinning') : t('explore.typhoon.eyeCalm')}>
      <style>{`
        @keyframes explore-typhoon-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .explore-typhoon-rotor { animation: none !important; }
        }
      `}</style>
      <svg viewBox="0 0 120 120" className="h-full w-full">
        {/* 바다 배경 — **어두운 남색**이다(2026-08-12 정정).
            흰 태풍으로 바꾼 첫 판에서 배경이 옅은 하늘색(#e0f2fe)이라 대비가
            사라졌고, 약한 태풍(강도 38)에서는 **그림이 아예 안 보였다**.
            실제 위성 영상이 어두운 바다 위 흰 구름인 것과 같은 이유로 뒤집는다 —
            흰색을 쓰려면 바탕이 어두워야 한다. */}
        <circle cx="60" cy="60" r="58" fill="#0c4a6e" />
        {intensity > 0 ? (
          <g
            className="explore-typhoon-rotor"
            style={{
              transformOrigin: '60px 60px',
              animation: duration > 0 ? `explore-typhoon-spin ${duration.toFixed(2)}s linear infinite` : undefined,
            }}
          >
            {/* 나선 강수 밴드 3개 — 120도 간격 복제 */}
            {[0, 120, 240].map((rot) => (
              <path
                key={rot}
                d="M 60 60 C 78 52, 92 60, 96 78 C 88 70, 76 66, 60 60 Z"
                fill="#ffffff"
                // 윤곽선을 주지 않는다 — 어두운 바다 위 흰 구름은 그 자체로
                // 경계가 선다. 밝은 배경이던 첫 판에서만 필요했던 보강이다.
                transform={`rotate(${rot} 60 60) translate(60 60) scale(${bandScale.toFixed(3)}) translate(-60 -60)`}
              />
            ))}
            {/* 눈 — **바다색으로 뚫는다.** 구름이 없는 자리라 위성에서도 어둡게
                보인다. 강할수록 작아지므로 이 구멍의 크기가 두 번째 크기 단서다. */}
            <circle cx="60" cy="60" r={eyeR} fill="#0c4a6e" />
          </g>
        ) : (
          <g>
            {/* 발생 없음 — 잔잔한 물결 */}
            <path d="M 30 62 Q 40 56, 50 62 T 70 62 T 90 62" fill="none" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" />
            <path d="M 36 76 Q 46 70, 56 76 T 76 76" fill="none" stroke="#bae6fd" strokeWidth="3" strokeLinecap="round" />
          </g>
        )}
      </svg>
    </div>
  );
}

export default function TyphoonSimPage() {
  const t = useT();
  const [sst, setSst] = useState(28);
  const [shear, setShear] = useState('weak');

  const result = useMemo(() => typhoonIntensity({ sst, shear }), [sst, shear]);
  const meta = CATEGORY_META[result.category];
  const whyLines = explainWhy(t, sst, shear, result);

  return (
    <div className="space-y-4 py-4">
      {/* 🔴 **상단 튜터 배너**(2026-08-19 사용자 지시 — "모든 각 실험실 화면에
          마찬가지로 상단 튜터 카드"). 담당은 **태풍이**이고, 소유자는
          `SideNav.TUTOR_BY_PATH`의 `/explore/typhoon` 행이다
          (`mascotAssets.contract` ④가 그 표와 여기를 대조한다).
          ⚠️ 배너를 **더하지 않고 종전 제목 줄을 바꿔 넣었다** — 위에 얹으면
          화면이 그만큼 길어지는데, 같은 지시의 다른 절반이 "세로로 길지 않게"다.
          등급 배지는 배너의 `right` 슬롯으로 들어가 자리를 그대로 지킨다. */}
      <Link to="/explore" className="inline-block text-xs font-medium text-sky-600 hover:text-sky-700">
        {t('explore.common.back')}
      </Link>
      <HeroBanner
        testId="typhoon-hero"
        mascot="typhoon"
        as="h1"
        eyebrow={t('explore.typhoon.title')}
        title={t('explore.typhoon.heroTitle')}
        // 🔴 오른쪽 한 줄 + 제목 아래 고지(2026-08-19 사용자 지시).
        // ⚠️ 문구가 `explore.home.typhoonDesc`(탐구 홈 카드)에서 **전용 키로
        //    갈렸다** — 사용자가 이 배너의 문장을 따로 지정했고, 홈 카드는 카드
        //    폭에 맞춘 긴 문장이 여전히 맞다. 두 자리가 같은 문장을 쓰지 않는
        //    첫 예외라 여기 적어 둔다(기후 탐정·과거 예보는 아직 공유한다).
        description={t('explore.typhoon.heroDesc')}
        tightDescription
        // 태풍 고지는 **가운데 낱말이 굵다**(「경향」) — 문자열 하나가 아니라
        // 조각 셋이라 노드로 넘긴다. `note`는 ReactNode를 그대로 받는다.
        note={
          <>
            {t('explore.typhoon.disclaimer1')} <b>{t('explore.typhoon.disclaimerBold')}</b>
            {t('explore.typhoon.disclaimer2')}
          </>
        }
        right={
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.badge}`}>{t(meta.labelKey)}</span>
        }
      />

      {/* 탐구 목표(MT-24) — **슬라이더보다 위**에 둔다. 화면에 들어선 사람이
          "무엇을 해 보면 되는지"를 조작하기 전에 읽어야 목표가 목표로 작동한다.
          판정 입력은 슬라이더 값(sst·shear)과 모델 산출(intensity·category)을
          합친 평평한 객체다 — **화면에 뜨는 값 그대로**여야 "보이는 숫자와 판정이
          다르다"가 안 생긴다. */}
      <GoalPanel
        goals={TYPHOON_GOALS}
        facts={{ sst, shear, intensity: result.intensity, category: result.category }}
      />

      {/* 🔴 **2열 구간 — 바람개비 왼쪽 · 발달 곡선 오른쪽**(2026-08-19 사용자 지시
          "해수면 온도 슬라이드는 고정, 바로 위에 바람개비를 왼쪽, 오른쪽에는
          발달곡선 그래프 크기 줄여서 배치").

          곡선이 여기까지 **올라온다** — 종전에는 위성 도식 아래(화면 2,100px
          지점)에 있어, 슬라이더를 미는 동안 강도가 시간에 따라 어떻게 자라는지를
          같이 볼 수 없었다. 바람개비(지금 세기)와 곡선(앞으로의 세기)은 **같은
          값의 두 표현**이라 나란히 서는 것이 맞다.

          비율이 1 : 1.35인 이유: 바람개비는 `h-36 w-36`(144px)·게이지는
          `w-48`(192px)로 **폭이 고정**이라 넓은 열을 줘도 안 커진다. 반대로 곡선은
          viewBox SVG라 폭을 준 만큼 커진다 — 남는 폭은 곡선이 가져간다.
          왼쪽 카드는 남는 세로를 `justify-center`로 흘린다(위에 붙이면 아래가
          빈 상자로 보인다). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        {/* 시각화 카드 — 바람개비 + 강도 게이지 */}
        <div className="flex flex-col justify-center rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <TyphoonEye intensity={result.intensity} />
          <IntensityGauge intensity={result.intensity} color={CHART_ACCENT} />
        </div>

        {/* 발달 곡선 카드 — 「크기 줄여서」는 높이를 박는 게 아니라 **열을 나누는
            것**이다. `DevelopmentCurve`는 viewBox 280×110에 `w-full`이라 폭이 줄면
            높이가 비례해 따라 준다(실측 519 → 361). h-…를 박으면 곡선이 찌그러진다. */}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-bold text-slate-700">{t('explore.typhoon.curveTitle')}</p>
          <p className="text-[11px] text-slate-400">{t('explore.typhoon.curveSub')}</p>
          <div className="mt-2">
            <DevelopmentCurve curve={result.curve} color={CHART_ACCENT} />
          </div>
          <p className="text-right text-[10px] text-slate-400">{t('explore.typhoon.timeAxis')}</p>
        </div>
      </div>

      {/* 조건 입력 카드 */}
      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-sst" className="text-sm font-bold text-slate-700">
              {t('explore.typhoon.sstLabel')}
            </label>
            <span className="text-sm font-extrabold text-sky-700">{sst.toFixed(1)}℃</span>
          </div>
          <input
            id="explore-sst"
            type="range"
            min={SST_MIN}
            max={SST_MAX}
            step={0.1}
            value={sst}
            onChange={(e) => setSst(Number(e.target.value))}
            className="mt-2 w-full accent-sky-600"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{t('explore.typhoon.sstCold', { min: SST_MIN })}</span>
            <span className="font-bold text-sky-500">{t('explore.typhoon.sstThreshold')}</span>
            <span>{t('explore.typhoon.sstHot', { max: SST_MAX })}</span>
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-slate-700">{t('explore.typhoon.shearLabel')}</p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label={t('explore.typhoon.shearAria')}>
            {SHEAR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setShear(opt.value)}
                aria-pressed={shear === opt.value}
                className={`rounded-xl py-2 text-sm font-bold transition-colors ${
                  shear === opt.value
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 🔴 **2열 구간 — 위성 도식 왼쪽 · 「왜 그럴까」 오른쪽**(2026-08-19 사용자
          지시 "위성 도식 크기 줄이고 오른쪽에 왜그럴까 배치"). CTA는 지시대로
          아래에 가로로 그대로 남는다.

          도식과 해설이 짝인 이유: 해설 문장이 **지금 화면의 도식을 설명한다**
          (시어가 약하면 「기둥이 곧게 선다」, 강하면 「흐트러진다」). 종전에는
          도식 847px을 지나 스크롤해야 그 문장이 나와, 읽을 때는 그림이 화면
          밖이었다.

          비율 1.35 : 1 — 도식은 `aspect-ratio 720/450`이라 폭을 준 만큼 커지고,
          해설은 문단 셋이라 좁아도 세로로 늘 뿐이다. 넓은 쪽을 그림이 갖는다.
          「크기 줄여서」는 높이를 박는 게 아니라 열을 나누는 것이다 — 캔버스가
          `w-full`이라 폭이 줄면 높이가 비례해 따라 준다(실측 847 → 508). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* 위성 도식(MT-21) — §0.5ⓔ가 정한 자리다. expert 밴드에만 붙이면
            θ>1.5가 필요해 심사 5분 동선에서 아무도 못 본다(CO-N-4) → **상시 노출**. */}
        <SatelliteView intensity={result.intensity} shear={shear} />

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
            {t('explore.typhoon.caveat')}
          </p>
        </div>
      </div>

      {/* θ 루프 연결 CTA */}
      {/* CO-S-10: 라벨은 "학습 경로에서 이어가기"인데 목적지가 `/`(홈)였다 —
          학습 경로는 `/learn`이다. 동봉하던 state={{focusConcept}}는 소비자가
          0건이라(대장 「죽은 분기」 등재) 함께 걷어낸다. */}
      <Link
        to="/learn"
        className="block rounded-2xl bg-sky-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-700"
      >
        {t('explore.typhoon.cta')}
      </Link>
    </div>
  );
}

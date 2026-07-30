import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  typhoonIntensity,
  SST_GENESIS_THRESHOLD,
  SST_MIN,
  SST_MAX,
} from '../../lib/exploreSims';

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

const CATEGORY_META = {
  none: { label: '발생 없음', badge: 'bg-slate-100 text-slate-600', color: '#94a3b8' },
  TD: { label: '열대저압부 (TD)', badge: 'bg-sky-100 text-sky-700', color: '#0284c7' },
  TS: { label: '열대폭풍 (TS)', badge: 'bg-teal-100 text-teal-700', color: '#0d9488' },
  STS: { label: '강한 열대폭풍 (STS)', badge: 'bg-amber-100 text-amber-700', color: '#d97706' },
  TY: { label: '태풍 (TY)', badge: 'bg-orange-100 text-orange-700', color: '#ea580c' },
  super: { label: '초강력 태풍', badge: 'bg-rose-100 text-rose-700', color: '#e11d48' },
};

const SHEAR_OPTIONS = [
  { value: 'weak', label: '약' },
  { value: 'moderate', label: '중' },
  { value: 'strong', label: '강' },
];

const SHEAR_LABEL = { weak: '약함', moderate: '중간', strong: '강함' };

/** 조건별 결정적 설명 문구 — 같은 입력이면 항상 같은 설명. */
function explainWhy(sst, shear, result) {
  const lines = [];
  if (sst <= SST_GENESIS_THRESHOLD) {
    lines.push(
      `해수면온도가 ${sst.toFixed(1)}℃로 발생 임계(26.5℃)를 넘지 못했어요. ` +
        '태풍은 따뜻한 바다가 내어주는 수증기의 응결열을 연료로 삼는데, ' +
        '바다가 이보다 차가우면 연료 공급이 부족해 소용돌이가 태풍으로 자라지 못해요.',
    );
    lines.push('슬라이더를 26.5℃ 위로 올리면 태풍이 발생하기 시작해요.');
    return lines;
  }
  lines.push(
    `바다가 임계(26.5℃)보다 ${(sst - SST_GENESIS_THRESHOLD).toFixed(1)}℃ 더 따뜻해요. ` +
      '따뜻한 바다일수록 증발이 활발해 더 많은 수증기가 공급되고, 수증기가 응결하며 ' +
      '내놓는 열이 태풍의 엔진을 더 세게 돌려요.',
  );
  if (shear === 'weak') {
    lines.push(
      '연직 시어(높이에 따른 바람 차이)가 약해서 태풍의 기둥(온난핵)이 곧게 서 있어요. ' +
        '구조가 흐트러지지 않으니 바다가 준 에너지를 온전히 강해지는 데 쓸 수 있어요.',
    );
  } else if (shear === 'moderate') {
    lines.push(
      '연직 시어가 중간이라 태풍의 기둥이 약간 기울어요. 상층과 하층의 바람이 ' +
        '서로 다른 방향으로 끌어당기면 열이 한곳에 모이지 못해, 같은 바다 온도라도 ' +
        '시어가 약할 때보다 덜 발달해요.',
    );
  } else {
    lines.push(
      '연직 시어가 강해서 태풍의 기둥이 크게 기울고 상부가 잘려 나가요. ' +
        '아무리 바다가 따뜻해도 구조가 무너지면 강해지기 어려워요 — 발달 곡선의 ' +
        '후반부가 꺾이는 이유예요.',
    );
  }
  if (result.category === 'super') {
    lines.push('두 조건이 모두 최적이라 이 모델에서 가장 강한 단계까지 발달했어요.');
  }
  return lines;
}

/** 반원 게이지 — 반지름 70, 둘레의 절반을 strokeDasharray로 채운다. */
function IntensityGauge({ intensity, color }) {
  const r = 70;
  const half = Math.PI * r; // 반원 호 길이
  const filled = (intensity / 100) * half;
  return (
    <svg viewBox="0 0 180 100" className="mx-auto w-48" role="img" aria-label={`강도 ${intensity} / 100`}>
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
        강도 지수 / 100
      </text>
    </svg>
  );
}

/** 발달 곡선 — 경량 SVG 폴리라인(외부 차트 라이브러리 없이). */
function DevelopmentCurve({ curve, color }) {
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
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="시간에 따른 발달 곡선">
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
function TyphoonEye({ intensity, color }) {
  // 강도 0→정지, 100→2.2초/회전. 선형 보간(느림 12초 ~ 빠름 2.2초).
  const duration = intensity > 0 ? 12 - (intensity / 100) * 9.8 : 0;
  return (
    <div className="relative mx-auto h-36 w-36" aria-label={intensity > 0 ? '회전하는 태풍 눈' : '잔잔한 바다'}>
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
        {/* 바다 배경 */}
        <circle cx="60" cy="60" r="58" fill="#e0f2fe" />
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
                fill={color}
                opacity={0.35 + (intensity / 100) * 0.45}
                transform={`rotate(${rot} 60 60)`}
              />
            ))}
            <circle cx="60" cy="60" r={Math.max(5, 14 - (intensity / 100) * 8)} fill="#f8fafc" stroke={color} strokeWidth="2" />
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
  const [sst, setSst] = useState(28);
  const [shear, setShear] = useState('weak');

  const result = useMemo(() => typhoonIntensity({ sst, shear }), [sst, shear]);
  const meta = CATEGORY_META[result.category];
  const whyLines = explainWhy(sst, shear, result);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/explore" className="text-xs font-medium text-sky-600 hover:text-sky-700">
            ← 탐구
          </Link>
          <h1 className="text-lg font-extrabold text-slate-800">🌪️ 태풍 만들기</h1>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.badge}`}>{meta.label}</span>
      </div>

      <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        교육용 단순화 모델이에요. 실제 태풍 예측(수치 모델)이 아니라, 바다 온도와
        바람 시어가 태풍 발달에 미치는 <b>경향</b>만 담은 결정적 근사입니다.
      </p>

      {/* 시각화 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <TyphoonEye intensity={result.intensity} color={meta.color} />
        <IntensityGauge intensity={result.intensity} color={meta.color} />
      </div>

      {/* 조건 입력 카드 */}
      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="explore-sst" className="text-sm font-bold text-slate-700">
              해수면온도 (SST)
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
            <span>{SST_MIN}℃ 차가운 바다</span>
            <span className="font-bold text-sky-500">임계 26.5℃</span>
            <span>{SST_MAX}℃ 뜨거운 바다</span>
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-slate-700">연직 시어 (높이에 따른 바람 차이)</p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="연직 시어 선택">
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
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 발달 곡선 카드 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-700">발달 곡선</p>
        <p className="text-[11px] text-slate-400">시간이 지나며 강도가 어떻게 변하는지 (교육용 무차원 시간)</p>
        <div className="mt-2">
          <DevelopmentCurve curve={result.curve} color={meta.color} />
        </div>
        <p className="text-right text-[10px] text-slate-400">시간 →</p>
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
          단순화: 실제 태풍 발생에는 대기 성층·수증기량·지구 자전(코리올리) 등 더 많은
          조건이 필요하고, 강도 지수는 실제 풍속·중심기압이 아니에요.
        </p>
      </div>

      {/* θ 루프 연결 CTA */}
      <Link
        to="/"
        state={{ focusConcept: 'typhoon' }}
        className="block rounded-2xl bg-sky-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-700"
      >
        🌪️ 태풍 개념 퀴즈 풀기 — 학습 경로에서 이어가기
      </Link>
    </div>
  );
}

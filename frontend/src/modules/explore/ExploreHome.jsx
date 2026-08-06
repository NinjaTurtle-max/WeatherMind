import { Link } from 'react-router-dom';
import { useT } from '../../i18n';

/**
 * 탐구 홈 (R9-01 §3.5 S5) — 라우트 /explore. 탐구 시뮬 v1 2종을 나란히 놓는다.
 *
 * 각 카드에 "교육용 단순화 모델" 고지를 명시한다 — 수치 예보/기후 모델이 아니라
 * 결정적 교육 근사 위의 체험 레이어(R3 시뮬레이터 폐지 원칙과 정합).
 * 순수 클라이언트(서버·채점 무관), 문구 전부 자체 제작.
 * 문자열은 i18n 리소스(explore.*)에서 온다 — R11-01 §6.3 외부화.
 */

const SIMS = [
  {
    to: '/explore/typhoon',
    icon: '🌪️',
    titleKey: 'explore.home.typhoonTitle',
    descriptionKey: 'explore.home.typhoonDesc',
    inputsKey: 'explore.home.typhoonInputs',
  },
  {
    to: '/explore/climate',
    icon: '🌡️',
    titleKey: 'explore.home.climateTitle',
    descriptionKey: 'explore.home.climateDesc',
    inputsKey: 'explore.home.climateInputs',
  },
];

export default function ExploreHome() {
  const t = useT();
  return (
    <div className="space-y-4 py-4">
      <div>
        <h1 className="text-lg font-extrabold text-slate-800">{t('explore.home.title')}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {t('explore.home.subtitle')}
        </p>
      </div>

      {/* 정사각에 가까운 두 칸을 **나란히**(2026-08-06). 가로로 긴 줄 두 개로
          쌓아 두니 시뮬 하나하나가 목록 항목처럼 보였다 — 탐구는 둘 중 하나를
          고르는 화면이라 나란히 놓고 크게 잡는다. 모바일은 1열(두 칸을 나란히
          두면 한 칸이 170px라 설명이 안 들어간다). */}
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        {SIMS.map((sim) => (
          <Link
            key={sim.to}
            to={sim.to}
            className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-sky-300 sm:aspect-square"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-[28px] ring-1 ring-slate-200">
              {sim.icon}
            </span>
            <p className="mt-3.5 text-[15px] font-extrabold text-slate-800">{t(sim.titleKey)}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{t(sim.descriptionKey)}</p>
            <p className="mt-2 text-[11px] font-bold text-sky-600">{t(sim.inputsKey)}</p>
            {/* 「교육용 단순화 모델」 고지는 카드마다 유지한다(R9-01 §3.5) —
                실제 예보·기후 전망으로 읽히면 안 된다. */}
            <p className="mt-auto inline-block self-start rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-medium text-slate-500">
              {t('explore.common.modelBadge')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

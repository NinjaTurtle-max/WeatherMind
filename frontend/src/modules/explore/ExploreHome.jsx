import { Link } from 'react-router-dom';
import { useT } from '../../i18n';

/**
 * 탐구 홈 (R9-01 §3.5 S5) — 라우트 /explore. 탐구 시뮬 v1 2종 카드 목록.
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

      {SIMS.map((sim) => (
        <Link
          key={sim.to}
          to={sim.to}
          className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md"
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl">{sim.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-slate-800">{t(sim.titleKey)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t(sim.descriptionKey)}</p>
              <p className="mt-1.5 text-[10px] font-bold text-sky-600">{t(sim.inputsKey)}</p>
              <p className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {t('explore.common.modelBadge')}
              </p>
            </div>
            <span className="text-slate-300">›</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

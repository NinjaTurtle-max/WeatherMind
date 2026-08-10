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
  // 자유 실험 — 2026-08-10에 **보드에서 옮겨 왔다**(사용자 지시). 보드는 목표가
  // 있는 미션판이고 여기는 목표가 없는 관찰이라, 같은 화면에 두면 "채점되는 것"과
  // "채점 안 되는 것"이 한 줄에 섞였다. 문구가 `board.*` 네임스페이스에 있는 것은
  // **판이 여전히 보드**이기 때문이다(옮긴 것은 입구이지 판이 아니다).
  {
    to: '/explore/sandbox',
    icon: '🧪',
    titleKey: 'explore.home.sandboxTitle',
    descriptionKey: 'explore.home.sandboxDesc',
    inputsKey: 'explore.home.sandboxInputs',
  },
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
  // R13 기후 탐정(대장 CO-N-2) — 계획서 [그림1] 4모듈 중 화면이 0이던 하나.
  // 내비 탭을 8개로 늘리는 대신 탐구 홈에 세운다(좁은 화면 탭바 넘침 방지).
  // 시뮬이 아니라 사건 조사라 배지 문구가 다르다(가상 관측 자료 고지).
  {
    to: '/detective',
    icon: '🕵️',
    titleKey: 'detective.entry.title',
    descriptionKey: 'detective.entry.desc',
    inputsKey: 'detective.entry.inputs',
    badgeKey: 'detective.entry.badge',
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
      <div className="grid max-w-[760px] grid-cols-1 gap-5 sm:grid-cols-2">
        {SIMS.map((sim) => (
          <Link
            key={sim.to}
            to={sim.to}
            className="flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:ring-sky-300 sm:aspect-square"
          >
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-[32px] ring-1 ring-slate-200">
              {sim.icon}
            </span>
            <p className="mt-4 text-[16.5px] font-extrabold text-slate-800">{t(sim.titleKey)}</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{t(sim.descriptionKey)}</p>
            <p className="mt-2 text-[11px] font-bold text-sky-600">{t(sim.inputsKey)}</p>
            {/* 「교육용 단순화 모델」 고지는 카드마다 유지한다(R9-01 §3.5) —
                실제 예보·기후 전망으로 읽히면 안 된다. */}
            <p className="mt-auto inline-block self-start rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-medium text-slate-500">
              {t(sim.badgeKey ?? 'explore.common.modelBadge')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

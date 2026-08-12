import { Link } from 'react-router-dom';
import HeroBanner from '../../components/HeroBanner';
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
      {/* 상단 배너 — 학습·보드와 같은 꼴(2026-08-12 사용자 지시). 왼쪽 하단
          사이드바 튜터를 걷고 여기서 구름이가 말한다. 화면 담당의 소유자는
          SideNav `TUTOR_BY_PATH`이고, 그 표에서 /explore가 구름이다. */}
      <HeroBanner
        testId="explore-hero"
        mascot="cloud"
        as="h1"
        eyebrow={t('explore.home.title')}
        title={t('explore.home.subtitle')}
      />

      {/* 넷을 **한 줄에**(2026-08-11 사용자 지시). 2열 정사각 시절에는 2×2로
          접혀 네 번째(기후 탐정)가 접힌 화면 밖으로 내려갔다 — 탐구는 넷 중
          하나를 고르는 화면이라 넷이 한눈에 보여야 고른다.
          그래서 셋을 줄였다: `max-w-[760px]` 해제(넷이 들어갈 폭이 필요하다) ·
          `aspect-square` 해제(1/4 폭에서 정사각이면 카드가 270px 기둥이 된다 —
          높이는 내용이 정하게 둔다) · 여백과 글자 한 단계 축소.
          계단은 1 / sm 2 / xl 4다. lg(1024)에서 4열로 가면 한 칸이 226px라
          제목이 두 줄로 접히면서 카드마다 높이가 달라진다. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SIMS.map((sim) => (
          <Link
            key={sim.to}
            to={sim.to}
            className="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-sky-300"
          >
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-50 text-[24px] ring-1 ring-slate-200">
              {sim.icon}
            </span>
            <p className="mt-3 text-[15px] font-extrabold text-slate-800">{t(sim.titleKey)}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{t(sim.descriptionKey)}</p>
            <p className="mt-1.5 text-[11px] font-bold text-sky-600">{t(sim.inputsKey)}</p>
            {/* 「교육용 단순화 모델」 고지는 카드마다 유지한다(R9-01 §3.5) —
                실제 예보·기후 전망으로 읽히면 안 된다. */}
            {/* mt-auto는 **감싼 div**가 갖는다 — 배지 자신에게 주면 그 위
                여백이 0으로 붙을 수 있어 짧은 카드에서 설명과 맞닿는다.
                설명 길이가 카드마다 달라도 격자가 칸 높이를 맞춰 주므로
                이것만으로 넷의 배지가 한 선에 선다. */}
            <div className="mt-auto pt-3">
              <p className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-medium text-slate-500">
                {t(sim.badgeKey ?? 'explore.common.modelBadge')}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

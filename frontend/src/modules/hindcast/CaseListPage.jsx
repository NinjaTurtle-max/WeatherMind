import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchHindcastCases } from '../../api/hindcast';
import LoadingSpinner from '../../components/LoadingSpinner';
import HeroBanner from '../../components/HeroBanner';
import { useT } from '../../i18n';
import DemoDataNotice from './DemoDataNotice';

/**
 * 회차 목록 (/hindcast) — MT-30 과거 예보.
 *
 * 세 상태를 모두 그린다: 로딩 · 실패(재시도) · **0건**. 0건에서 빈 화면이나 무한
 * 스피너를 두면 사용자가 갇힌다(detective CaseListPage와 같은 관례) — 회차가
 * 없으면 이유와 나갈 문을 함께 준다.
 *
 * ⚠️ 실측(정답)은 이 화면에 오지 않는다 — 서버 응답에 필드 자체가 없다.
 * 여기서 그리는 climatology는 **평년값**이고 판단 재료다.
 */
export default function CaseListPage() {
  const t = useT();
  const casesQ = useQuery({
    queryKey: ['hindcast', 'cases'],
    queryFn: fetchHindcastCases,
    staleTime: 5 * 60 * 1000,
  });

  const cases = casesQ.data?.cases ?? [];

  return (
    <div className="space-y-4 py-4">
      {/* 🔴 **상단 튜터 배너**(2026-08-19 사용자 지시). 담당은 **무지개**이고,
          소유자는 `SideNav.TUTOR_BY_PATH`의 `/hindcast` 행이다.
          기후 탐정과 같은 꼴 — 종전 제목 줄을 바꿔 넣고, 설명은 탐구 홈 카드와
          같은 문장(`hindcast.entry.desc`)을 쓴다.
          ⚠️ 「데모용 고정 날짜」 고지(DemoDataNotice)는 **배너 아래 그대로** 둔다.
             배너 안으로 넣으면 자료의 성격을 밝히는 줄이 장식으로 읽힌다. */}
      {/* 상단 줄 — 왼쪽 뒤로가기 · 오른쪽 「데모용 고정 날짜」 고지.
          탐구 실험실 넷과 같은 관례다. 숨기는 게 아니라 자리를 옮긴 것이다
          (고지 자체는 이 항목의 정직성 — DemoDataNotice 머리말 참조). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link to="/explore" className="shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('hindcast.list.back')}
        </Link>
        <DemoDataNotice inline />
      </div>
      <HeroBanner
        testId="hindcast-hero"
        mascot="rainbow"
        as="h1"
        eyebrow={t('hindcast.list.title')}
        title={t('hindcast.list.heroTitle')}
        description={t('hindcast.entry.desc')}
      />


      {casesQ.isLoading && <LoadingSpinner label={t('hindcast.list.loading')} />}

      {casesQ.isError && (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-bold text-slate-800">{t('hindcast.list.loadErrorTitle')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('hindcast.list.loadErrorBody')}</p>
          <button
            type="button"
            onClick={() => casesQ.refetch()}
            className="mt-4 rounded-full bg-sky-600 px-4 py-2 text-xs font-bold text-white"
          >
            {t('hindcast.list.retry')}
          </button>
        </div>
      )}

      {casesQ.isSuccess && cases.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-[28px]">🗂️</p>
          <p className="mt-2 text-sm font-bold text-slate-800">{t('hindcast.list.empty')}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t('hindcast.list.emptyBody')}
          </p>
          <Link
            to="/explore"
            className="mt-4 inline-block rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600"
          >
            {t('hindcast.list.emptyCta')}
          </Link>
        </div>
      )}

      {/* 🔴 **3열 격자**(2026-08-19 사용자 지시). 종전에는 카드가 한 줄에 하나라
          1,120px 폭을 다 먹고 화면 아래가 통째로 비었다.
          기후 탐정 목록과 **같은 규격**이다 — 둘은 탐구 홈에서 나란히 들어가는
          형제라 목록이 다르게 생기면 다른 서비스처럼 읽힌다.
          ⚠️ `lg`가 아니라 `xl`인 것도 그쪽과 같다: lg(1024) 뷰포트에서는 셸이
             769px이라 3열이면 한 칸 246px로 눌린다.
          ⚠️ 이 주석을 아래 `&& (` **안쪽 첫 줄**로 옮기지 말 것 — JSX 주석이 그
             자리에 오면 `{...}`가 객체 리터럴로 파싱돼 빌드가 깨진다. 탐정
             목록에도 같은 경고가 붙어 있는데 **여기서 또 밟았다**(2026-08-19). */}
      {casesQ.isSuccess && cases.length > 0 && (
        <ul className="grid max-w-[1120px] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="hindcast-case-list">
          {cases.map((c) => (
            <li key={c.case_id}>
              <Link
                to={`/hindcast/${c.case_id}`}
                data-testid={`hindcast-case-${c.case_id}`}
                className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200 hover:ring-sky-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-slate-800">{c.title}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                      {c.region} · {t('hindcast.list.station', { station: c.station })}
                    </p>
                  </div>
                  {c.already_played && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600">
                      {t('hindcast.list.played')}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600">{c.intro}</p>

                {/* 평년값 — 실측이 아니라 판단 재료(duel base_forecast와 같은 위치) */}
                <p className="mt-2 text-[11px] font-bold text-slate-500">
                  {t('hindcast.list.normalLabel')} {c.climatology.temp_max}℃ ·{' '}
                  {c.climatology.rain_prob}%
                </p>

                <p className="mt-2 text-xs font-bold text-sky-600">
                  {c.already_played ? t('hindcast.list.review') : t('hindcast.list.open')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchHindcastCases } from '../../api/hindcast';
import LoadingSpinner from '../../components/LoadingSpinner';
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
      <div>
        <Link to="/explore" className="text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('hindcast.list.back')}
        </Link>
        <h1 className="mt-1 text-lg font-extrabold text-slate-800">{t('hindcast.list.title')}</h1>
        <p className="mt-1 text-xs text-slate-500">{t('hindcast.list.subtitle')}</p>
      </div>

      {/* 「데모용 고정 날짜」 고지 — 목록 최상단. 숨기지 않는다. */}
      <DemoDataNotice />

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

      {casesQ.isSuccess && cases.length > 0 && (
        <ul className="space-y-3" data-testid="hindcast-case-list">
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

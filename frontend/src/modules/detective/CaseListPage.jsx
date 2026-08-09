import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchDetectiveCases } from '../../api/detective';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useT } from '../../i18n';

/**
 * 사건 목록 (/detective) — R13 기후 탐정.
 *
 * 세 상태를 모두 그린다: 로딩 · 실패(재시도) · **0건**. 0건에서 빈 화면이나
 * 무한 스피너를 두면 사용자가 갇힌다(대장 CO-S-3이 지적한 0문항 세션과 같은
 * 부류) — 사건이 없으면 이유와 나갈 문을 함께 준다.
 */
export default function CaseListPage() {
  const t = useT();
  const casesQ = useQuery({
    queryKey: ['detective', 'cases'],
    queryFn: fetchDetectiveCases,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4 py-4">
      <div>
        <Link to="/explore" className="text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('detective.list.back')}
        </Link>
        <h1 className="mt-1 text-lg font-extrabold text-slate-800">{t('detective.list.title')}</h1>
        <p className="mt-1 text-xs text-slate-500">{t('detective.list.subtitle')}</p>
      </div>

      {casesQ.isLoading && <LoadingSpinner label={t('detective.list.loading')} />}

      {casesQ.isError && (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <p className="text-sm font-bold text-slate-800">{t('detective.list.loadErrorTitle')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('detective.list.loadErrorBody')}</p>
          <button
            type="button"
            onClick={() => casesQ.refetch()}
            className="mt-4 rounded-full bg-sky-600 px-4 py-2 text-xs font-bold text-white"
          >
            {t('detective.list.retry')}
          </button>
        </div>
      )}

      {casesQ.isSuccess && casesQ.data.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-[28px]">🗂️</p>
          <p className="mt-2 text-sm font-bold text-slate-800">{t('detective.list.empty')}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t('detective.list.emptyBody')}
          </p>
          <Link
            to="/explore"
            className="mt-4 inline-block rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600"
          >
            {t('detective.list.emptyCta')}
          </Link>
        </div>
      )}

      {casesQ.isSuccess && casesQ.data.length > 0 && (
        <div className="grid max-w-[760px] grid-cols-1 gap-4 sm:grid-cols-2">
          {casesQ.data.map((item) => (
            <Link
              key={item.case_id}
              to={`/detective/${item.case_id}`}
              className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-sky-300"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-50 text-[24px] ring-1 ring-slate-200">
                🕵️
              </span>
              <p className="mt-3 text-[16px] font-extrabold text-slate-800">{item.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{item.headline}</p>
              <p className="mt-3 text-[11px] font-bold text-sky-600">
                {t('detective.list.clueCount', { count: item.clue_count })}
                {' · '}
                {t('detective.list.minClues', { count: item.min_clues })}
              </p>
              <span className="mt-3 self-start rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-bold text-slate-600">
                {t('detective.list.open')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

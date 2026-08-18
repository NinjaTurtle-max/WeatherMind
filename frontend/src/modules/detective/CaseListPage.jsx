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

      {/* 사건 6개 — `xl`부터 **3열**이라 두 줄로 끝난다(2026-08-18 사용자 지시.
          종전 2열 3줄). `lg`가 아니라 `xl`인 이유는 옆 화면(단서 목록)과 같다 —
          lg(1024) 뷰포트에서는 셸이 784px이라 3열이면 한 칸 246px로 눌린다
          (실측). xl에서 331px · 1536에서 363px로, 종전 2열(368px)과 사실상 같다.
          ⚠️ **폭 상한을 함께 풀어야 한다.** `max-w-[760px]`이 남아 있으면 셸이
          1152여도 격자가 760에 묶여 한 칸이 240px로 눌린다 — 열 수만 바꾸면
          카드가 작아지는 것으로 보인다. 1120이면 한 칸 364px로 종전 2열(368px)과
          사실상 같다.
          ⚠️ 이 주석을 아래 `&& (` **안쪽 첫 줄**로 옮기지 말 것 — JSX 주석이
          그 자리에 오면 `{...}`가 객체 리터럴로 파싱돼 빌드가 깨진다(실제로
          그렇게 썼다가 깨뜨렸다). */}
      {casesQ.isSuccess && casesQ.data.length > 0 && (
        <div className="grid max-w-[1120px] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

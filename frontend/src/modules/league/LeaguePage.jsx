import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi, leagueApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import ForecastForm from '../../components/ForecastForm';
import Leaderboard from './Leaderboard';
import BriefingRoom from '../duel/BriefingRoom';
import { useT } from '../../i18n';

/**
 * LeaguePage (04번 스펙 섹션 4 — 축소판)
 * CHECK_STATUS(GET /league/current) → 미제출: PREDICTION_FORM / 제출됨: WAITING(리더보드)
 * 제출 여부는 GET /league/me/results에 이번 주(week_start) 기록이 있는지로 판별하고,
 * 중복 제출(주 1회 제한) 에러는 서버 응답으로 처리한다.
 * RESULT_REVEALED(ELO 변동 애니메이션)는 주간 배치 이후 이력 리스트로 축소 표현.
 *
 * R9-01 §3.1: mid_forecast raw JSON 노출을 /duel/briefing 재사용 카드
 * (BriefingRoom compact)로 대체 — 리그 라우터의 mid_forecast는 하위 호환으로
 * 유지되지만 프론트는 더 이상 그리지 않는다.
 */
export default function LeaguePage() {
  const queryClient = useQueryClient();
  const t = useT();
  const [submitError, setSubmitError] = useState(null);

  const currentQ = useQuery({
    queryKey: ['league', 'current'],
    queryFn: leagueApi.fetchCurrentLeague,
    retry: 1,
  });

  const leaderboardQ = useQuery({
    queryKey: ['league', 'leaderboard'],
    queryFn: () => leagueApi.fetchLeaderboard(),
    retry: 1,
  });

  const myResultsQ = useQuery({
    queryKey: ['league', 'myResults'],
    queryFn: leagueApi.fetchMyLeagueResults,
    retry: 1,
  });

  // 브리핑 재사용 (R9-01 §3.1) — 듀얼과 같은 자료·같은 캐시 키를 공유한다
  const briefingQ = useQuery({
    queryKey: ['duel', 'briefing'],
    queryFn: duelApi.fetchDuelBriefing,
    retry: 1,
    staleTime: 60_000,
  });

  const predictMutation = useMutation({
    mutationFn: leagueApi.submitPrediction,
    onSuccess: () => {
      setSubmitError(null);
      queryClient.invalidateQueries({ queryKey: ['league'] });
    },
    onError: (err) => setSubmitError(err.detail ?? t('league.submitFailed')),
  });

  if (currentQ.isLoading) return <LoadingSpinner label={t('league.loading')} />;

  if (currentQ.isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌪️</p>
        <p className="mt-2 font-bold text-slate-800">{t('league.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{currentQ.error?.detail}</p>
        <button
          type="button"
          onClick={() => currentQ.refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const current = currentQ.data ?? {};
  const myResults = Array.isArray(myResultsQ.data) ? myResultsQ.data : [];
  const alreadySubmitted =
    predictMutation.isSuccess ||
    (current.week_start && myResults.some((r) => r.week_start === current.week_start));

  return (
    <div className="pt-2">
      <h1 className="mb-1 text-lg font-extrabold text-slate-900">{t('league.title')}</h1>
      <p className="mb-4 text-sm text-slate-500">
        {current.week_start ? t('league.week', { week: current.week_start }) : t('league.thisWeek')} ·{' '}
        {current.region ?? t('league.regionDefault')}
        {t('league.subtitleTail')}
      </p>

      {/* 참고자료: mid_forecast raw JSON → 브리핑 카드 재사용 (R9-01 §3.1) */}
      <div className="mb-4">
        <BriefingRoom
          compact
          briefing={briefingQ.data}
          loading={briefingQ.isLoading}
          error={briefingQ.isError}
        />
      </div>

      {alreadySubmitted ? (
        <div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-200">
          <p className="font-bold text-emerald-700">{t('league.submittedTitle')}</p>
          <p className="mt-1 text-xs text-emerald-600">{t('league.submittedBody')}</p>
        </div>
      ) : (
        <div className="mb-4">
          <ForecastForm
            title={t('league.formTitle')}
            fields={[
              { name: 'temp_max', label: t('league.tempMax'), step: '0.1' },
              { name: 'temp_min', label: t('league.tempMin'), step: '0.1' },
              { name: 'rain_prob', label: t('league.rainProb'), min: '0', max: '100' },
            ]}
            submitLabel={t('league.submit')}
            validate={(v) =>
              v.temp_min > v.temp_max ? t('league.minOverMax') : null
            }
            onSubmit={(values) => predictMutation.mutate(values)}
            submitting={predictMutation.isPending}
          />
          {submitError && (
            <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">
              {submitError}
            </p>
          )}
        </div>
      )}

      <h2 className="mb-2 text-base font-extrabold text-slate-900">{t('league.leaderboard')}</h2>
      {leaderboardQ.isLoading ? (
        <LoadingSpinner label={t('league.leaderboardLoading')} />
      ) : (
        <Leaderboard ranks={Array.isArray(leaderboardQ.data) ? leaderboardQ.data : []} />
      )}

      {myResults.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-base font-extrabold text-slate-900">{t('league.myHistory')}</h2>
          <ul className="flex flex-col gap-2">
            {myResults.map((r, i) => (
              <li
                key={r.week_start ?? i}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200"
              >
                <span className="font-medium text-slate-700">{r.week_start ?? '-'}</span>
                <span className="text-slate-500">
                  {r.accuracy_score != null
                    ? t('league.accuracy', { score: r.accuracy_score })
                    : t('league.accuracyPending')}
                </span>
                <span className="font-bold text-sky-700">
                  ELO {r.elo_rating_after ?? '-'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

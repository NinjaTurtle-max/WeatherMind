import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchHindcastAttempts, fetchHindcastCases, submitHindcast } from '../../api/hindcast';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useT } from '../../i18n';
import DemoDataNotice from './DemoDataNotice';
import ResultCard from './ResultCard';

/**
 * 회차 플레이 (/hindcast/:caseId) — MT-30.
 *
 * 흐름: 평년값을 보고 기온·강수확률을 입력 → 제출 → **서버 판정**을 받는다.
 * 프론트는 점수를 계산하지 않는다(재료 자체가 없다 — 실측은 제출 응답에만 온다).
 *
 * 이미 예보한 회차는 입력을 닫고 지난 결과를 보여준다. 서버도 409로 다시 막으므로
 * (UI 잠금과 별개) 클라이언트 우회로 재채점을 얻을 수 없다.
 */
export default function CasePlayPage() {
  const { caseId } = useParams();
  const t = useT();
  const queryClient = useQueryClient();

  const [tempMax, setTempMax] = useState('');
  const [rainProb, setRainProb] = useState('');

  const casesQ = useQuery({
    queryKey: ['hindcast', 'cases'],
    queryFn: fetchHindcastCases,
    staleTime: 5 * 60 * 1000,
  });
  const attemptsQ = useQuery({
    queryKey: ['hindcast', 'attempts'],
    queryFn: fetchHindcastAttempts,
  });

  const submitM = useMutation({
    mutationFn: () => submitHindcast(caseId, Number(tempMax), Number(rainProb)),
    onSuccess: () => {
      // 목록의 already_played와 이력을 함께 갱신한다.
      queryClient.invalidateQueries({ queryKey: ['hindcast'] });
    },
  });

  const kase = (casesQ.data?.cases ?? []).find((c) => c.case_id === caseId);
  const priorAttempt = (attemptsQ.data?.attempts ?? []).find((a) => a.case_id === caseId);
  // 방금 받은 판정이 있으면 그것을, 없으면 지난 기록을 그린다.
  const shown = submitM.data ?? priorAttempt ?? null;

  if (casesQ.isLoading) return <LoadingSpinner label={t('hindcast.play.loading')} />;

  if (casesQ.isSuccess && !kase) {
    return (
      <div className="space-y-4 py-4">
        <Link to="/hindcast" className="text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('hindcast.play.backToList')}
        </Link>
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-sm font-bold text-slate-800">{t('hindcast.play.notFoundTitle')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('hindcast.play.notFoundBody')}</p>
        </div>
      </div>
    );
  }

  const errCode = submitM.error?.response?.data?.code;
  const canSubmit = tempMax !== '' && rainProb !== '' && !submitM.isPending;

  return (
    <div className="space-y-4 py-4">
      <div>
        <Link to="/hindcast" className="text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('hindcast.play.backToList')}
        </Link>
        <h1 className="mt-1 text-lg font-extrabold text-slate-800">{kase?.title}</h1>
        <p className="mt-0.5 text-[11px] font-bold text-slate-400">
          {kase?.region} · {t('hindcast.list.station', { station: kase?.station })}
        </p>
      </div>

      <DemoDataNotice />

      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="text-xs leading-relaxed text-slate-700">{kase?.intro}</p>
      </div>

      {/* 평년값 — AI 캐스터의 기준값. 실측이 아니다. */}
      <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="text-xs font-extrabold text-slate-700">{t('hindcast.play.normalTitle')}</p>
        <p className="mt-1 text-sm font-bold text-slate-800">
          {kase?.climatology.temp_max}℃ · {kase?.climatology.rain_prob}%
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {t('hindcast.play.normalHint')}
        </p>
      </div>

      {shown ? (
        <>
          {!submitM.data && (
            <div className="rounded-2xl bg-sky-50 p-3 ring-1 ring-sky-200">
              <p className="text-[11px] font-extrabold text-sky-700">
                {t('hindcast.play.alreadyTitle')}
              </p>
              <p className="mt-1 text-[11px] text-sky-800">{t('hindcast.play.alreadyBody')}</p>
            </div>
          )}
          <ResultCard result={shown} />
        </>
      ) : (
        <form
          data-testid="hindcast-forecast-form"
          className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submitM.mutate();
          }}
        >
          <label className="block">
            <span className="text-[11px] font-extrabold text-slate-600">
              {t('hindcast.play.tempLabel')}
            </span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              data-testid="hindcast-temp-input"
              value={tempMax}
              onChange={(e) => setTempMax(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-extrabold text-slate-600">
              {t('hindcast.play.rainLabel')}
            </span>
            <input
              type="number"
              step="1"
              inputMode="numeric"
              data-testid="hindcast-rain-input"
              value={rainProb}
              onChange={(e) => setRainProb(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200"
            />
          </label>

          {submitM.isError && (
            <div className="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
              <p className="text-[11px] font-extrabold text-rose-700">
                {errCode === 'ALREADY_SUBMITTED'
                  ? t('hindcast.play.alreadyTitle')
                  : t('hindcast.play.errorTitle')}
              </p>
              <p className="mt-1 text-[11px] text-rose-800">
                {errCode === 'INVALID_PREDICTION'
                  ? t('hindcast.play.invalidBody')
                  : errCode === 'ALREADY_SUBMITTED'
                    ? t('hindcast.play.alreadyBody')
                    : t('hindcast.list.loadErrorBody')}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="hindcast-submit"
            className="w-full rounded-full bg-sky-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300"
          >
            {submitM.isPending ? t('hindcast.play.submitting') : t('hindcast.play.submit')}
          </button>
        </form>
      )}
    </div>
  );
}

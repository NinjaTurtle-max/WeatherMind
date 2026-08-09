import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi } from '../../api';
import ForecastForm from '../../components/ForecastForm';
import { useT } from '../../i18n';

/**
 * ClosingForecastStep (R13 A-1 — 세션 마감 단계 UI) — 2일차 서버 착지분의 짝.
 *
 * 무엇이 아닌가부터: **문항이 아니다.** 예보의 정답은 내일의 관측이 정하므로 즉시
 * 채점이 불가능하다 — 그래서 SESSION_RECIPE(15문항)에 들어가지 않고, XP·구름·
 * 스트릭·만회 큐 어디에도 닿지 않는다. 이 화면이 하는 일은 딱 둘이다:
 *   ① 제출 확인   ② 어제 낸 예보의 결과 회수
 * 문항처럼 정오 배너를 그리면 안 된다(계약 §A-1 — 즉시 채점 불가).
 *
 * 렌더 조건: `SessionCompleteResult.closing_step`이 **non-null일 때만**.
 * null이면 단계가 없는 것이고 세션은 15문항으로 정상 완료된다 — null이 되는 조건
 * 둘 중 하나가 **KMA 예보 부재(키 없음·장애)**라, 여기서 완주를 막으면 무키 동작
 * 계약이 깨진다. 그래서 이 컴포넌트는 상위에서 `step && <.../>`로만 붙는다.
 *
 * 제출: 새 엔드포인트가 아니라 기존 예보 대결 제출(`POST /api/v1/duel/today`).
 * 재제출은 409 ALREADY_SUBMITTED — 정상이라면 애초에 step이 null이지만, 세션
 * 완료와 제출 사이에 다른 탭에서 냈을 수 있어 코드로 구분해 안내한다.
 *
 * 정산 타이밍(틀리기 쉬움): 제출일 D → 예보 대상일 D+1(= step.duel_date) →
 * celery 정산 D+2. "내일 결과 확인"이 아니라 **대상일 다음 날**이다.
 */

/** ISO 날짜(YYYY-MM-DD) + n일 — 로컬 타임존 영향을 받지 않게 UTC 정오 기준으로 더한다. */
export function isoPlusDays(iso, days) {
  const base = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 정산일 = 예보 대상일 + 1 (D+2). 계산 근거를 한 곳에만 둔다. */
export const settlementDate = (duelDate) => isoPlusDays(duelDate, 1);

/** 이력에서 **정산 완료된 가장 최근 항목**을 고른다(result != null). 없으면 null. */
export function latestSettled(history) {
  if (!Array.isArray(history)) return null;
  return history.find((d) => d && d.result != null) ?? null;
}

const RESULT_KEY = { win: 'duel.result.win', lose: 'duel.result.lose', draw: 'duel.result.draw' };

export default function ClosingForecastStep({ step, onSubmitted }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // 어제 낸 예보의 결과 회수 — 기존 이력 엔드포인트 그대로. 실패해도 마감 단계
  // 자체는 막지 않는다(부가 정보다).
  const historyQ = useQuery({
    queryKey: ['duel', 'history'],
    queryFn: duelApi.fetchDuelHistory,
    retry: 1,
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: duelApi.submitDuel,
    onSuccess: () => {
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['duel'] });
      onSubmitted?.();
    },
    onError: (err) => {
      if (err?.code === 'ALREADY_SUBMITTED') {
        setAlreadySubmitted(true);
        setErrorMsg(null);
        queryClient.invalidateQueries({ queryKey: ['duel'] });
        return;
      }
      setErrorMsg(err?.detail ?? t('session.closing.failed'));
    },
  });

  if (!step || dismissed) return null;

  const duelDate = step.duel_date;
  const settleOn = settlementDate(duelDate);
  const base = step.base_forecast ?? null;
  const settled = latestSettled(historyQ.data);
  const done = submitMutation.isSuccess || alreadySubmitted;

  return (
    <section
      data-closing-step={step.kind ?? 'forecast_duel'}
      className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <h2 className="text-base font-extrabold text-slate-900">{t('session.closing.title')}</h2>

      {/* 어제 낸 예보의 결과 회수 — "다음날 회수"가 이 단계의 절반이다 */}
      {settled && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <span className="font-bold text-slate-500">{t('session.closing.lastResultTitle')}</span>
          {' · '}
          {t('session.closing.lastResult', {
            date: settled.duel_date,
            result: t(RESULT_KEY[settled.result] ?? 'duel.result.draw'),
          })}
        </p>
      )}

      {done ? (
        <div className="mt-3 rounded-xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-200">
          <p className="text-2xl" aria-hidden="true">📮</p>
          <p className="mt-1 text-sm font-extrabold text-emerald-700">
            {alreadySubmitted
              ? t('session.closing.alreadySubmitted')
              : t('session.closing.submittedTitle')}
          </p>
          {/* 정산 타이밍: 대상일 관측 뒤 그 **다음 날**이다(D+2) */}
          <p className="mt-1 text-xs leading-relaxed text-emerald-600">
            {t('session.closing.settleNote', { date: duelDate, settleDate: settleOn ?? '-' })}
          </p>
          <Link
            to="/duel"
            className="mt-3 inline-block text-xs font-bold text-sky-600 underline hover:text-sky-700"
          >
            {t('session.closing.briefingCta')}
          </Link>
        </div>
      ) : (
        <>
          <ForecastForm
            title={t('session.closing.subtitle', { date: duelDate })}
            description={t('session.closing.noJudge')}
            notice={
              base
                ? t('session.closing.base', { temp: base.temp_max, prob: base.rain_prob })
                : null
            }
            fields={[
              { name: 'temp_max', label: t('session.closing.tempLabel'), step: '0.1' },
              { name: 'rain_prob', label: t('session.closing.rainLabel'), min: 0, max: 100 },
            ]}
            submitLabel={t('session.closing.submit')}
            submitting={submitMutation.isPending}
            onSubmit={(values) => submitMutation.mutate(values)}
          />
          {errorMsg && (
            <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">{errorMsg}</p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <Link
              to="/duel"
              className="text-xs font-bold text-sky-600 underline hover:text-sky-700"
            >
              {t('session.closing.briefingCta')}
            </Link>
            {/* 마감 단계는 **선택**이다 — 15문항 세션은 이미 완료 처리됐다 */}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
            >
              {t('session.closing.skip')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

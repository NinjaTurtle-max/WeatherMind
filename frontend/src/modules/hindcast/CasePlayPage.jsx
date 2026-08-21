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
      <div className="space-y-4 pt-2">
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

  // 🔒 **판정이 뜨면 입력을 잠근다**(2026-08-19 사용자 지시 — "값을 남기고
  // 잠글까요"). 값을 지우지 않는 것이 요점이다: 내가 31℃라 적었고 실제가
  // 39.6℃였다는 대비가 **두 카드에 나란히** 남아야 배우는 것이 생긴다.
  // 종전에는 판정이 뜨면 폼이 통째로 사라져 내가 뭘 냈는지 판정 카드 안의
  // 요약으로만 남았다.
  //
  // ⚠️ **「다시 도전」으로 잠금을 푸는 길은 없다 — 서버가 회차당 1회다**
  //    (`routers/hindcast.py`: 재제출은 409 `ALREADY_SUBMITTED`). 그래서 풀리는
  //    버튼을 두면 누르는 족족 409가 난다. 지시의 절반은 그대로 구현하고(값 유지
  //    + 잠금), 나머지 절반 자리에는 **실제로 되는 행동**을 둔다: 다른 회차 고르기.
  // 값은 방금 제출한 것(submitM.data)이든 지난 기록(priorAttempt)이든 응답의
  // `user_pred`가 소유한다 — 새로고침 뒤에도 잠긴 칸에 내가 낸 값이 남는다.
  const locked = Boolean(shown);
  const lockedTemp = shown?.user_pred?.temp_max ?? '';
  const lockedRain = shown?.user_pred?.rain_prob ?? '';

  return (
    <div className="space-y-4 pt-2">
      {/* 상단 줄 — 왼쪽 뒤로가기 · 오른쪽 「데모용 고정 날짜」 고지.
          탐구 실험실 넷이 이미 쓰는 관례다(고지는 배너·카드 밖 위쪽 줄).
          종전에는 노란 띠 한 장이 본문에서 62px을 썼다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link to="/hindcast" className="shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('hindcast.play.backToList')}
        </Link>
        <DemoDataNotice inline />
      </div>

      <div>
        <h1 className="text-lg font-extrabold text-slate-800">{kase?.title}</h1>
        <p className="mt-0.5 text-[11px] font-bold text-slate-400">
          {kase?.region} · {t('hindcast.list.station', { station: kase?.station })}
        </p>
      </div>

      {/* ── 2열 — 왼쪽 판단 재료 · 오른쪽 내 답과 그 결과 ────────────────────
          다른 실험실의 「만지는 쪽 / 보는 쪽」과 뜻이 다르다: 이 화면에는 움직이는
          값이 없고 **답을 적고 채점을 받는다**. 그래서 왼쪽이 판단 재료(회차 소개·
          평년값), 오른쪽이 내 답과 판정이다. 평년값을 보면서 숫자를 적는 화면이라
          둘이 나란해야 한다 — 종전에는 세로로 쌓여 아래 절반이 통째로 비었다. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-xs leading-relaxed text-slate-700">{kase?.intro}</p>
          </div>

          {/* 평년값 — AI 캐스터의 기준값. 실측이 아니다. */}
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-extrabold text-slate-700">{t('hindcast.play.normalTitle')}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">
              {kase?.climatology.temp_max}{t('common.celsius')} · {kase?.climatology.rain_prob}%
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {t('hindcast.play.normalHint')}
            </p>
          </div>
        </div>

        <div className="space-y-4">
        {/* 예보 입력 — **판정 뒤에도 이 자리에 남는다**(잠긴 채로). */}
        <form
          data-testid="hindcast-forecast-form"
          className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submitM.mutate();
          }}
        >
          {/* 잠긴 상태는 **눈에도 보여야 한다** — 값만 회색이면 «아직 못 낸 칸»과
              구별이 안 된다. 자물쇠 한 줄로 「낸 답이고 못 고친다」를 말한다. */}
          {locked && (
            <p data-testid="hindcast-locked" className="text-[11px] font-extrabold text-slate-500">
              {t('hindcast.play.lockedNote')}
            </p>
          )}
          {/* 숫자 두 개짜리 칸이 열 폭을 다 먹을 이유가 없다 — 나란히 둔다. */}
          <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-extrabold text-slate-600">
              {t('hindcast.play.tempLabel')}
            </span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              data-testid="hindcast-temp-input"
              value={locked ? lockedTemp : tempMax}
              readOnly={locked}
              disabled={locked}
              onChange={(e) => setTempMax(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 disabled:bg-slate-100 disabled:font-bold disabled:text-slate-500"
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
              value={locked ? lockedRain : rainProb}
              readOnly={locked}
              disabled={locked}
              onChange={(e) => setRainProb(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 disabled:bg-slate-100 disabled:font-bold disabled:text-slate-500"
            />
          </label>
          </div>

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

          {/* 잠기면 제출 버튼 자리를 **되는 행동**이 물려받는다. 「다시 도전」이
              아니라 「다른 회차」인 이유는 위 잠금 주석 참조(서버가 회차당 1회). */}
          {locked ? (
            <Link
              to="/hindcast"
              data-testid="hindcast-next-case"
              className="block w-full rounded-full bg-slate-100 px-4 py-2.5 text-center text-sm font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
            >
              {t('hindcast.play.otherCase')}
            </Link>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="hindcast-submit"
              className="w-full rounded-full bg-sky-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300"
            >
              {submitM.isPending ? t('hindcast.play.submitting') : t('hindcast.play.submit')}
            </button>
          )}
        </form>

        {/* 판정 — **입력 바로 아래**로 이어진다. 내가 적은 값과 실측이 같은 열에
            붙어야 «31이라 했는데 39.6이었구나»가 한눈에 든다. */}
        {shown && (
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
        )}
        </div>{/* /오른쪽 열 */}
      </div>{/* /2열 */}
    </div>
  );
}

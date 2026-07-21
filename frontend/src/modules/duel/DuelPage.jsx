import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import DuelForm from './DuelForm';

/**
 * DuelPage (R4-01 S4) — "예보 대결" 탭.
 * GET /duel/today 오늘 상태 → 미제출: DuelForm / 제출됨: 내 예보 vs AI 예측 공개.
 * 정산 완료(actual 존재) 시 승패 결과·점수·승리 XP 표시. GET /duel/history 이력.
 * 승패 결과 토스트는 정산된 대결(오늘 또는 이력의 최신)이 확인될 때 노출한다.
 *
 * 화면 상태: LOADING → ERROR(재시도) → OPEN(폼) / SUBMITTED(공개) / SETTLED(결과).
 */

const RESULT_META = {
  win: { label: '승리', icon: '🏆', chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200', text: 'text-emerald-700' },
  lose: { label: '패배', icon: '😢', chip: 'bg-orange-100 text-orange-700 ring-orange-200', text: 'text-orange-700' },
  draw: { label: '무승부', icon: '🤝', chip: 'bg-slate-100 text-slate-600 ring-slate-200', text: 'text-slate-600' },
};

export default function DuelPage() {
  const queryClient = useQueryClient();
  const addXp = useProgressStore((s) => s.addXp);
  const [submitError, setSubmitError] = useState(null);
  const [toast, setToast] = useState(null);
  const [seenSettled, setSeenSettled] = useState(false);

  const todayQ = useQuery({
    queryKey: ['duel', 'today'],
    queryFn: duelApi.fetchTodayDuel,
    retry: 1,
  });

  const historyQ = useQuery({
    queryKey: ['duel', 'history'],
    queryFn: duelApi.fetchDuelHistory,
    retry: 1,
  });

  const submitMutation = useMutation({
    mutationFn: duelApi.submitDuel,
    onSuccess: () => {
      setSubmitError(null);
      setToast('✅ 예보 제출 완료! 내일 실측과 대결해요');
      setTimeout(() => setToast(null), 2600);
      queryClient.invalidateQueries({ queryKey: ['duel'] });
    },
    onError: (err) => setSubmitError(err.detail ?? '예보 제출에 실패했어요.'),
  });

  // 정산된 오늘 대결(win/lose/draw)이 처음 확인되면 결과 토스트 1회 노출.
  const today = todayQ.data;
  useEffect(() => {
    if (!today?.result || seenSettled) return;
    const meta = RESULT_META[today.result];
    if (!meta) return;
    const xpNote = today.result === 'win' ? ' (+15 XP)' : '';
    setToast(`${meta.icon} 어제 대결 ${meta.label}!${xpNote}`);
    if (today.result === 'win') addXp(15);
    setSeenSettled(true);
    setTimeout(() => setToast(null), 3000);
  }, [today, seenSettled, addXp]);

  if (todayQ.isLoading) return <LoadingSpinner label="오늘의 예보 대결을 불러오는 중..." />;

  if (todayQ.isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌡️</p>
        <p className="mt-2 font-bold text-slate-800">대결 정보를 불러오지 못했어요</p>
        <p className="mt-1 text-sm text-slate-500">{todayQ.error?.detail ?? '잠시 후 다시 시도해주세요.'}</p>
        <button
          type="button"
          onClick={() => todayQ.refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const submitted = Boolean(today?.user_pred) || submitMutation.isSuccess || today?.status === 'submitted' || today?.status === 'settled';
  const history = Array.isArray(historyQ.data) ? historyQ.data : [];

  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}

      <h1 className="mb-1 text-lg font-extrabold text-slate-900">🌡️ 예보 대결</h1>
      <p className="mb-4 text-sm text-slate-500">
        {today?.duel_date ? `${today.duel_date} · ` : ''}AI 캐스터와 내일 예보를 겨뤄요.
      </p>

      {submitted ? (
        <DuelResultCard duel={today} />
      ) : (
        <>
          <DuelForm
            onSubmit={(values) => submitMutation.mutate(values)}
            submitting={submitMutation.isPending}
            baseForecast={today?.base_forecast}
          />
          {submitError && (
            <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{submitError}</p>
          )}
        </>
      )}

      <h2 className="mb-2 mt-6 text-base font-extrabold text-slate-900">대결 이력</h2>
      {historyQ.isLoading ? (
        <LoadingSpinner label="이력 불러오는 중..." />
      ) : history.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          아직 대결 이력이 없어요. 첫 예보를 제출해 보세요!
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((d, i) => (
            <DuelHistoryRow key={d.duel_date ?? i} duel={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 오늘 대결(제출 후) 카드 — 내 예보 vs AI 예측, 정산 시 결과 표시 */
function DuelResultCard({ duel }) {
  const settled = Boolean(duel?.actual) && duel?.result;
  const meta = settled ? RESULT_META[duel.result] : null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {settled ? (
        <div className={`mb-3 flex items-center justify-center gap-2 text-lg font-extrabold ${meta.text}`}>
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
          {duel.result === 'win' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">+15 XP</span>
          )}
        </div>
      ) : (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-bold text-emerald-700">
          예보 제출 완료! 내일 실측으로 정산돼요. 🌙
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PredColumn title="🙋 내 예보" pred={duel?.user_pred} score={duel?.user_score} highlight />
        <PredColumn title="🤖 AI 캐스터" pred={duel?.ai_pred} score={duel?.ai_score} />
      </div>

      {settled && duel?.actual && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">실측</p>
          <p className="mt-0.5 text-sm font-bold text-slate-700">
            최고 {fmt(duel.actual.temp_max)}℃ · 강수 {fmt(duel.actual.rain_prob)}%
          </p>
        </div>
      )}
    </div>
  );
}

function PredColumn({ title, pred, score, highlight = false }) {
  return (
    <div className={`rounded-xl p-3 text-center ring-1 ${highlight ? 'bg-sky-50 ring-sky-200' : 'bg-slate-50 ring-slate-200'}`}>
      <p className="text-xs font-bold text-slate-600">{title}</p>
      <p className="mt-1.5 text-sm font-extrabold text-slate-800">{fmt(pred?.temp_max)}℃</p>
      <p className="text-xs text-slate-500">강수 {fmt(pred?.rain_prob)}%</p>
      {score != null && (
        <p className="mt-1 text-[11px] font-bold text-sky-600">정확도 {fmt(score)}점</p>
      )}
    </div>
  );
}

function DuelHistoryRow({ duel }) {
  const meta = duel?.result ? RESULT_META[duel.result] : null;
  return (
    <li className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200">
      <span className="font-medium text-slate-700">{duel?.duel_date ?? '-'}</span>
      <span className="text-xs text-slate-500">
        내 {fmt(duel?.user_pred?.temp_max)}℃ vs AI {fmt(duel?.ai_pred?.temp_max)}℃
      </span>
      {meta ? (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${meta.chip}`}>
          {meta.icon} {meta.label}
        </span>
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-400">정산 중</span>
      )}
    </li>
  );
}

function fmt(v) {
  return v == null ? '-' : v;
}

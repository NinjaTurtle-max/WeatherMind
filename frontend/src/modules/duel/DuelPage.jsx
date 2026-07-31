import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi } from '../../api';
import { DUEL_WIN_XP } from '../../lib/xpConstants';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import ForecastForm from '../../components/ForecastForm';
import BriefingRoom from './BriefingRoom';
import EvidencePicker from './EvidencePicker';
import CasterJudgmentCard, { CasterGradeBadge } from './CasterJudgmentCard';
import { evidenceMeta } from './briefingDisplay';

/**
 * DuelPage (R4-01 S4 → R9-01 S4 브리핑 룸 개편) — "예보 대결" 탭.
 * 미제출: 브리핑(차트 3종+보조) → 판단 근거 선택 → 예측 입력.
 * 제출됨: 내 예보 vs AI 예측 공개 + "AI 캐스터의 판단" 3단계 카드(§3.4 ④).
 * 정산 완료: 승패·점수·근거 적중 해설(evidence_review). 이력 행은 정산분에
 * 한해 근거 해설을 펼쳐볼 수 있다.
 *
 * degraded(§3.4): briefing이 비어도(KMA 키 부재) 예측 입력은 그대로 가능.
 * 화면 상태: LOADING → ERROR(재시도) → OPEN(브리핑+근거+폼) / SUBMITTED(공개) / SETTLED(결과).
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
  const [evidence, setEvidence] = useState([]); // 선택한 판단 근거 코드 (§3.1)

  const todayQ = useQuery({
    queryKey: ['duel', 'today'],
    queryFn: duelApi.fetchTodayDuel,
    retry: 1,
  });

  // 브리핑 자료(§3.1) — 실패해도 예측 플로우는 막지 않는다(degraded)
  const briefingQ = useQuery({
    queryKey: ['duel', 'briefing'],
    queryFn: duelApi.fetchDuelBriefing,
    retry: 1,
    staleTime: 60_000,
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
    const xpNote = today.result === 'win' ? ` (+${DUEL_WIN_XP} XP)` : '';
    setToast(`${meta.icon} 어제 대결 ${meta.label}!${xpNote}`);
    if (today.result === 'win') addXp(DUEL_WIN_XP);
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

  const toggleEvidence = (code) =>
    setEvidence((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-slate-900">🌡️ 예보 대결</h1>
        {today?.caster_grade && <CasterGradeBadge grade={today.caster_grade} />}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        {today?.duel_date ? `${today.duel_date} · ` : ''}브리핑을 읽고 AI 캐스터와 내일 예보를 겨뤄요.
      </p>

      {submitted ? (
        <>
          <DuelResultCard duel={today} />
          <CasterJudgmentCard
            baseForecast={today?.base_forecast}
            aiPred={today?.ai_pred}
            casterGrade={today?.caster_grade}
          />
        </>
      ) : (
        <>
          <BriefingRoom
            briefing={briefingQ.data}
            loading={briefingQ.isLoading}
            error={briefingQ.isError}
          />
          <EvidencePicker
            selected={evidence}
            onToggle={toggleEvidence}
            disabled={submitMutation.isPending}
          />
          <div className="mt-3">
            <ForecastForm
              title="내일 예보를 맞혀보세요"
              description="AI 캐스터와 내일 실측을 두고 대결해요. 승리 시 +15 XP! (하루 1회)"
              notice={
                today?.base_forecast &&
                `📡 참고 예보 — 최고 ${today.base_forecast.temp_max}℃ · 강수확률 ${today.base_forecast.rain_prob}%`
              }
              fields={[
                { name: 'temp_max', label: '내일 최고기온(°C)', step: '0.1' },
                { name: 'rain_prob', label: '강수확률(%)', min: '0', max: '100' },
              ]}
              submitLabel="예보 제출 (1일 1회)"
              onSubmit={(values) => submitMutation.mutate({ ...values, evidence })}
              submitting={submitMutation.isPending}
            />
          </div>
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

/** 오늘 대결(제출 후) 카드 — 내 예보 vs AI 예측, 정산 시 결과·근거 해설 표시 */
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
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">+{DUEL_WIN_XP} XP</span>
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

      {/* 근거 적중 해설(정산 후 — §3.1 evidence_review) / 선택한 근거(정산 전) */}
      {Array.isArray(duel?.evidence_review) && duel.evidence_review.length > 0 ? (
        <EvidenceReviewList review={duel.evidence_review} />
      ) : (
        Array.isArray(duel?.evidence) &&
        duel.evidence.length > 0 && (
          <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">내가 고른 근거</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {duel.evidence.map((code) => {
                const m = evidenceMeta(code);
                return (
                  <span
                    key={code}
                    className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200"
                  >
                    {m.icon} {m.label}
                  </span>
                );
              })}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">정산 후 근거가 맞았는지 해설해 드려요.</p>
          </div>
        )
      )}
    </div>
  );
}

/** 근거 적중 해설 (§3.4 ④) — hit별 ✓/✗ 아이콘 + 텍스트 라벨 병기 + note */
function EvidenceReviewList({ review }) {
  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">근거 적중 해설</p>
      <ul className="flex flex-col gap-1.5">
        {review.map((r) => {
          const m = evidenceMeta(r.code);
          return (
            <li key={r.code} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${
                  r.hit
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : 'bg-orange-100 text-orange-700 ring-orange-200'
                }`}
              >
                {r.hit ? '✓ 적중' : '✗ 빗나감'}
              </span>
              <span className="min-w-0">
                <span className="font-bold text-slate-700">
                  {m.icon} {m.label}
                </span>
                {r.note && <span className="mt-0.5 block leading-relaxed text-slate-500">{r.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
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

/** 이력 행 — 정산분(evidence_review 보유)은 탭하면 근거 해설을 펼친다 */
function DuelHistoryRow({ duel }) {
  const meta = duel?.result ? RESULT_META[duel.result] : null;
  const [open, setOpen] = useState(false);
  const hasReview = Array.isArray(duel?.evidence_review) && duel.evidence_review.length > 0;

  return (
    <li className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        disabled={!hasReview}
        aria-expanded={hasReview ? open : undefined}
        onClick={() => hasReview && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm disabled:cursor-default"
      >
        <span className="font-medium text-slate-700">{duel?.duel_date ?? '-'}</span>
        <span className="text-xs text-slate-500">
          내 {fmt(duel?.user_pred?.temp_max)}℃ vs AI {fmt(duel?.ai_pred?.temp_max)}℃
        </span>
        <span className="flex items-center gap-1.5">
          {meta ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${meta.chip}`}>
              {meta.icon} {meta.label}
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-400">정산 중</span>
          )}
          {hasReview && (
            <span aria-hidden="true" className="text-xs text-slate-400">
              {open ? '▲' : '▼'}
            </span>
          )}
        </span>
      </button>
      {open && hasReview && (
        <div className="border-t border-slate-100 px-4 pb-3 pt-1">
          {duel?.caster_grade && (
            <p className="mt-1.5">
              <CasterGradeBadge grade={duel.caster_grade} />
            </p>
          )}
          <EvidenceReviewList review={duel.evidence_review} />
        </div>
      )}
    </li>
  );
}

function fmt(v) {
  return v == null ? '-' : v;
}

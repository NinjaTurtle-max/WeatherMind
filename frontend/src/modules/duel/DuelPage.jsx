import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import ForecastForm from '../../components/ForecastForm';
import BriefingRoom from './BriefingRoom';
import EvidencePicker from './EvidencePicker';
import CasterJudgmentCard, { CasterGradeBadge } from './CasterJudgmentCard';
import { evidenceMeta } from './briefingDisplay';
import { useT } from '../../i18n';

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

// 결과 라벨은 duel.result.* 리소스(i18n) — 여기는 아이콘·색만.
const RESULT_META = {
  win: { labelKey: 'duel.result.win', icon: '🏆', chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200', text: 'text-emerald-700' },
  lose: { labelKey: 'duel.result.lose', icon: '😢', chip: 'bg-orange-100 text-orange-700 ring-orange-200', text: 'text-orange-700' },
  draw: { labelKey: 'duel.result.draw', icon: '🤝', chip: 'bg-slate-100 text-slate-600 ring-slate-200', text: 'text-slate-600' },
};

export default function DuelPage() {
  const queryClient = useQueryClient();
  const t = useT();
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
      setToast(t('duel.submitToast'));
      setTimeout(() => setToast(null), 2600);
      queryClient.invalidateQueries({ queryKey: ['duel'] });
    },
    onError: (err) => setSubmitError(err.detail ?? t('duel.submitFailed')),
  });

  // 정산된 오늘 대결(win/lose/draw)이 처음 확인되면 결과 토스트 1회 노출.
  const today = todayQ.data;
  useEffect(() => {
    if (!today?.result || seenSettled) return;
    const meta = RESULT_META[today.result];
    if (!meta) return;
    // XP 액수는 **서버가 보낸 값만** 쓴다(R10 ponytail — 프론트 미러 상수 제거).
    // 필드가 없거나 0이면 표기하지 않는다: 추정해서 틀린 액수를 보이지 않는다.
    const xp = today.xp_earned ?? 0;
    const xpNote = xp > 0 ? t('duel.xpNote', { xp }) : '';
    setToast(`${meta.icon} ${t('duel.settledToast', { result: t(meta.labelKey) })}${xpNote}`);
    if (xp > 0) addXp(xp);
    setSeenSettled(true);
    setTimeout(() => setToast(null), 3000);
  }, [today, seenSettled, addXp]);

  if (todayQ.isLoading) return <LoadingSpinner label={t('duel.loading')} />;

  if (todayQ.isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌡️</p>
        <p className="mt-2 font-bold text-slate-800">{t('duel.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{todayQ.error?.detail ?? t('common.retryLater')}</p>
        <button
          type="button"
          onClick={() => todayQ.refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const submitted = Boolean(today?.user_pred) || submitMutation.isSuccess || today?.status === 'submitted' || today?.status === 'settled';
  const history = Array.isArray(historyQ.data) ? historyQ.data : [];

  const toggleEvidence = (code) =>
    setEvidence((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  // 넓은 셸(Layout의 md:max-w-6xl)은 **미제출 2열 브리핑을 위한 것**이다. 제출
  // 후에는 결과도 이력도 1열이라 그 폭을 그대로 받으면 「내 예보 28℃」 한 칸이
  // 535px가 된다(1440 실측). 셸은 경로로만 폭을 정해 제출 여부를 모르므로 여기서
  // 되돌린다 — 결과 카드와 이력이 **같은 폭**이어야 아래위가 어긋나 보이지 않는다.
  const narrow = submitted ? 'mx-auto w-full max-w-3xl' : '';

  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-slate-900">{t('duel.title')}</h1>
        {today?.caster_grade && <CasterGradeBadge grade={today.caster_grade} />}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        {today?.duel_date ? `${today.duel_date} · ` : ''}
        {t('duel.subtitle')}
      </p>

      {submitted ? (
        <div className={narrow}>
          <DuelResultCard duel={today} />
          <CasterJudgmentCard
            baseForecast={today?.base_forecast}
            aiPred={today?.ai_pred}
            casterGrade={today?.caster_grade}
          />
        </div>
      ) : (
        // 자료(왼쪽) ↔ 판단·제출(오른쪽) 2열 — 세로로 쌓으면 브리핑 차트 5종을 다
        // 스크롤해 내려가야 입력칸이 나오고, 값을 채우는 동안에는 근거가 된 차트가
        // 화면 밖이라 되짚어 올라가야 했다. 나란히 두면 보면서 채운다.
        // lg 미만에서는 그대로 1열 — 브리핑 → 근거 → 폼이 읽는 순서다.
        // grid-cols-[minmax(0,1fr)]는 장식이 아니다 — 격자 항목은 기본이
        // min-width:auto라 브리핑 안의 하늘 타임라인(8칸 × 52px = 444px, 자체
        // overflow-x-auto로 가로 스크롤하게 돼 있다)이 카드를 밀어 올린다.
        // 390px에서 카드가 476px가 되어 페이지에 가로 스크롤이 생겼다(실측).
        // lg:grid-cols-2는 Tailwind가 이미 minmax(0,1fr)로 깔아 준다.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          <BriefingRoom
            briefing={briefingQ.data}
            loading={briefingQ.isLoading}
            error={briefingQ.isError}
          />
          {/* 오른쪽 열은 sticky다. 브리핑이 두 배 넘게 길어(1440 실측 940px ↔
              615px) 아래쪽 차트를 보러 내려가면 입력칸이 화면 밖으로 나간다 —
              나란히 놓은 이유가 사라진다. 바깥 div가 왼쪽 높이만큼 늘어나 주고
              (grid 기본 stretch — items-start를 주면 따라 내려올 여백이 없어져
              sticky가 죽는다) 안쪽이 따라 내려온다. top은 고정 헤더(64px) 아래. */}
          <div>
            <div className="flex flex-col gap-3 lg:sticky lg:top-[72px]">
              <EvidencePicker
                selected={evidence}
                onToggle={toggleEvidence}
                disabled={submitMutation.isPending}
              />
              <ForecastForm
                title={t('duel.form.title')}
                description={t('duel.form.desc')}
                notice={
                  today?.base_forecast &&
                  t('duel.form.notice', {
                    max: today.base_forecast.temp_max,
                    prob: today.base_forecast.rain_prob,
                  })
                }
                fields={[
                  { name: 'temp_max', label: t('duel.form.tempMax'), step: '0.1' },
                  { name: 'rain_prob', label: t('duel.form.rainProb'), min: '0', max: '100' },
                ]}
                submitLabel={t('duel.form.submit')}
                onSubmit={(values) => submitMutation.mutate({ ...values, evidence })}
                submitting={submitMutation.isPending}
              />
              {submitError && (
                <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{submitError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={narrow}>
        <h2 className="mb-2 mt-6 text-base font-extrabold text-slate-900">{t('duel.historyTitle')}</h2>
        {historyQ.isLoading ? (
          <LoadingSpinner label={t('duel.historyLoading')} />
        ) : history.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
            {t('duel.historyEmpty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((d, i) => (
              <DuelHistoryRow key={d.duel_date ?? i} duel={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 오늘 대결(제출 후) 카드 — 내 예보 vs AI 예측, 정산 시 결과·근거 해설 표시 */
function DuelResultCard({ duel }) {
  const t = useT();
  const settled = Boolean(duel?.actual) && duel?.result;
  const meta = settled ? RESULT_META[duel.result] : null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {settled ? (
        <div className={`mb-3 flex items-center justify-center gap-2 text-lg font-extrabold ${meta.text}`}>
          <span aria-hidden="true">{meta.icon}</span>
          {t(meta.labelKey)}
          {(duel.xp_earned ?? 0) > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">+{duel.xp_earned} XP</span>
          )}
        </div>
      ) : (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-bold text-emerald-700">
          {t('duel.submittedNote')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PredColumn title={t('duel.myPred')} pred={duel?.user_pred} score={duel?.user_score} highlight />
        <PredColumn title={t('duel.aiPred')} pred={duel?.ai_pred} score={duel?.ai_score} />
      </div>

      {settled && duel?.actual && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('duel.actual')}</p>
          <p className="mt-0.5 text-sm font-bold text-slate-700">
            {t('duel.actualValue', { max: fmt(duel.actual.temp_max), prob: fmt(duel.actual.rain_prob) })}
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
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('duel.myEvidence')}</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {duel.evidence.map((code) => {
                const m = evidenceMeta(code);
                return (
                  <span
                    key={code}
                    className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200"
                  >
                    {m.icon} {m.labelKey ? t(m.labelKey) : code}
                  </span>
                );
              })}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{t('duel.evidenceNote')}</p>
          </div>
        )
      )}
    </div>
  );
}

/** 근거 적중 해설 (§3.4 ④) — hit별 ✓/✗ 아이콘 + 텍스트 라벨 병기 + note */
function EvidenceReviewList({ review }) {
  const t = useT();
  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('duel.reviewTitle')}</p>
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
                {r.hit ? t('duel.hit') : t('duel.miss')}
              </span>
              <span className="min-w-0">
                <span className="font-bold text-slate-700">
                  {m.icon} {m.labelKey ? t(m.labelKey) : r.code}
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
  const t = useT();
  return (
    <div className={`rounded-xl p-3 text-center ring-1 ${highlight ? 'bg-sky-50 ring-sky-200' : 'bg-slate-50 ring-slate-200'}`}>
      <p className="text-xs font-bold text-slate-600">{title}</p>
      <p className="mt-1.5 text-sm font-extrabold text-slate-800">{fmt(pred?.temp_max)}℃</p>
      <p className="text-xs text-slate-500">{t('duel.rainShort', { prob: fmt(pred?.rain_prob) })}</p>
      {score != null && (
        <p className="mt-1 text-[11px] font-bold text-sky-600">{t('duel.accuracy', { score: fmt(score) })}</p>
      )}
    </div>
  );
}

/** 이력 행 — 정산분(evidence_review 보유)은 탭하면 근거 해설을 펼친다 */
function DuelHistoryRow({ duel }) {
  const t = useT();
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
          {t('duel.historyVs', { mine: fmt(duel?.user_pred?.temp_max), ai: fmt(duel?.ai_pred?.temp_max) })}
        </span>
        <span className="flex items-center gap-1.5">
          {meta ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${meta.chip}`}>
              {meta.icon} {t(meta.labelKey)}
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-400">{t('duel.settling')}</span>
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

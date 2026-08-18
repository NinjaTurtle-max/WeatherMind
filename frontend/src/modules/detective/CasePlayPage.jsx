import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchDetectiveCase, submitSolve } from '../../api/detective';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useT } from '../../i18n';
import CaseChart from './CaseChart';

/**
 * 사건 플레이 (/detective/:caseId) — R13 기후 탐정.
 *
 * 흐름은 세 단계다: ① 자료 살펴보기(시계열 차트) → ② 단서 조사(카드를 하나씩
 * 열면 본문이 열리고 그 시점이 차트에 기준선으로 찍힌다) → ③ 추리(가설 선택).
 * **min_clues 미만이면 제출 버튼이 잠긴다** — 그리고 잠금을 우회해도 서버가
 * 422 NOT_ENOUGH_CLUES로 다시 막는다(routers/detective.py). 조사 과정이
 * 화면 장식이 아니라 계약인 이유는 심사 배점 ②의 문면이다 —
 * "단순 퀴즈·정답 맞히기를 **넘어**".
 *
 * 접근성(대장 CO-S-A1 — "정오 판정이 어디에도 announce 되지 않는다"):
 *   - 판정 결과는 `role="status" aria-live="polite"` 영역에 **텍스트로** 들어간다.
 *     ✅/❌ 이모지가 아니라 문장을 읽어 준다(3분기 — 정답·부분정답·오답).
 *   - 단서 조사 진행도도 같은 방식으로 announce한다(몇 개 더 열어야 하는지).
 *   - 단서 카드는 button + aria-expanded, 가설은 radiogroup.
 */
export default function CasePlayPage() {
  const { caseId } = useParams();
  const t = useT();
  const [opened, setOpened] = useState(() => new Set());
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  const caseQ = useQuery({
    queryKey: ['detective', 'case', caseId],
    queryFn: () => fetchDetectiveCase(caseId),
    retry: false,
  });

  const solveMutation = useMutation({
    mutationFn: () => submitSolve(caseId, picked, [...opened]),
    onSuccess: (data) => {
      setResult(data);
      setSubmitError(null);
    },
    onError: (error) => {
      setResult(null);
      setSubmitError(
        error?.code === 'NOT_ENOUGH_CLUES'
          ? t('detective.play.notEnoughClues')
          : t('detective.play.submitFailed'),
      );
    },
  });

  const detail = caseQ.data;
  const minClues = detail?.min_clues ?? 0;
  const clues = detail?.clues ?? [];
  const remaining = Math.max(0, minClues - opened.size);
  const canSubmit = remaining === 0 && picked != null && !solveMutation.isPending;

  // 연 단서가 가리키는 시점만 차트 기준선으로 — 조사한 만큼 자료 위에 쌓인다.
  const markers = useMemo(
    () => clues.filter((c) => opened.has(c.clue_id) && c.x),
    [clues, opened],
  );

  if (caseQ.isLoading) return <LoadingSpinner label={t('detective.play.loading')} />;

  if (caseQ.isError || !detail) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm font-bold text-slate-800">{t('detective.play.notFoundTitle')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('detective.play.notFoundBody')}</p>
        <Link
          to="/detective"
          className="mt-4 inline-block rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600"
        >
          {t('detective.play.backToList')}
        </Link>
      </div>
    );
  }

  const intro = detail.intro ?? {};
  const verdictLine =
    result &&
    t(
      result.verdict === 'correct'
        ? 'detective.play.resultCorrect'
        : result.verdict === 'partial'
          ? 'detective.play.resultPartial'
          : 'detective.play.resultIncorrect',
    );

  function toggleClue(clueId) {
    setOpened((prev) => {
      if (prev.has(clueId)) return prev; // 한 번 조사한 단서는 닫히지 않는다
      const next = new Set(prev);
      next.add(clueId);
      return next;
    });
  }

  return (
    <div className="space-y-5 py-4">
      <div>
        <Link to="/detective" className="text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('detective.play.backToList')}
        </Link>
        <h1 className="mt-1 text-lg font-extrabold text-slate-800">{detail.title}</h1>
        <p className="mt-1 text-[13px] font-bold text-sky-700">{intro.headline}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">{intro.body}</p>
        <dl className="mt-3 grid gap-1 text-[11px] text-slate-500">
          {intro.region && (
            <div>
              <dt className="inline font-bold">{t('detective.play.region')}: </dt>
              <dd className="inline">{intro.region}</dd>
            </div>
          )}
          {intro.period && (
            <div>
              <dt className="inline font-bold">{t('detective.play.period')}: </dt>
              <dd className="inline">{intro.period}</dd>
            </div>
          )}
        </dl>
        {/* 가상 자료 고지 — 실제 관측 기록으로 읽히면 안 된다(케이스 데이터의 계약) */}
        {intro.data_note && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            <span className="font-bold">{t('detective.play.dataNoteLabel')}: </span>
            {intro.data_note}
          </p>
        )}
      </div>

      <section aria-labelledby="detective-charts">
        <h2 id="detective-charts" className="text-sm font-extrabold text-slate-800">
          {t('detective.play.chartsTitle')}
        </h2>
        <p className="mb-2 mt-0.5 text-[11px] text-slate-500">{t('detective.play.chartsHint')}</p>
        <CaseChart series={detail.series} markers={markers} />
      </section>

      <section aria-labelledby="detective-clues">
        <h2 id="detective-clues" className="text-sm font-extrabold text-slate-800">
          {t('detective.play.cluesTitle')}
        </h2>
        <p className="mb-2 mt-0.5 text-[11px] text-slate-500">
          {t('detective.play.cluesHint', { min: minClues })}
        </p>
        <p
          role="status"
          aria-live="polite"
          className="mb-2 text-[11.5px] font-bold text-sky-700"
          data-testid="detective-clue-progress"
        >
          {t('detective.play.progress', { opened: opened.size, total: clues.length })}
        </p>
        {/* 단서 7개 — `xl`부터 **4열**이라 두 줄로 끝난다(2026-08-18 사용자 지시.
            종전 2열 4줄). 카드 폭은 그대로다: 셸이 576 → 1152로 넓어졌기 때문에
            (`Layout.jsx` isWide에 /detective 추가) 열이 늘어도 한 칸이 268px다.
            ⚠️ `lg`가 아니라 `xl`인 이유 — lg(1024) 뷰포트에서는 사이드바를 뺀
            셸이 784px이라 4열이면 한 칸 180px로 눌린다. */}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {clues.map((clue) => {
            const isOpen = opened.has(clue.clue_id);
            const isSupport = result?.supporting_clues?.includes(clue.clue_id);
            return (
              <li key={clue.clue_id}>
                <button
                  type="button"
                  onClick={() => toggleClue(clue.clue_id)}
                  aria-expanded={isOpen}
                  data-testid={`detective-clue-${clue.clue_id}`}
                  className={`w-full rounded-2xl p-3 text-left ring-1 transition ${
                    isSupport
                      ? 'bg-amber-50 ring-amber-300'
                      : isOpen
                        ? 'bg-white ring-slate-200'
                        : 'bg-slate-50 ring-slate-200 hover:ring-sky-300'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-bold text-slate-800">
                      {isOpen ? '🔎 ' : '🔒 '}
                      {clue.label}
                    </span>
                    <span className="shrink-0 text-[10.5px] font-bold text-slate-500">
                      {isOpen ? t('detective.play.clueOpened') : t('detective.play.clueLocked')}
                    </span>
                  </span>
                  {isOpen && (
                    <>
                      <span className="mt-1.5 block text-[12px] leading-relaxed text-slate-600">
                        {clue.text}
                      </span>
                      {clue.x && (
                        <span className="mt-1 block text-[10.5px] font-medium text-amber-700">
                          {t('detective.play.clueMarker', {
                            metric:
                              detail.series.find((s) => s.metric_id === clue.metric_id)
                                ?.metric_label ?? '',
                            x: clue.x,
                          })}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="detective-hypotheses">
        <h2 id="detective-hypotheses" className="text-sm font-extrabold text-slate-800">
          {t('detective.play.hypothesesTitle')}
        </h2>
        <p className="mb-2 mt-0.5 text-[11px] text-slate-500">
          {t('detective.play.hypothesesHint')}
        </p>
        <div role="radiogroup" aria-labelledby="detective-hypotheses" className="space-y-2">
          {detail.hypotheses.map((h) => (
            <button
              key={h.hypothesis_id}
              type="button"
              role="radio"
              aria-checked={picked === h.hypothesis_id}
              onClick={() => setPicked(h.hypothesis_id)}
              data-testid={`detective-hypothesis-${h.hypothesis_id}`}
              className={`block w-full rounded-2xl p-3 text-left text-[12.5px] leading-relaxed ring-1 transition ${
                picked === h.hypothesis_id
                  ? 'bg-sky-50 font-bold text-sky-900 ring-sky-400'
                  : 'bg-white text-slate-700 ring-slate-200 hover:ring-sky-300'
              }`}
            >
              {h.text}
            </button>
          ))}
        </div>

        {remaining > 0 && (
          <p className="mt-2 text-[11.5px] font-bold text-amber-700">
            {t('detective.play.lockedHint', { remaining })}
          </p>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => solveMutation.mutate()}
          data-testid="detective-submit"
          className="mt-3 w-full rounded-full bg-sky-600 px-4 py-3 text-sm font-extrabold text-white disabled:bg-slate-300"
        >
          {solveMutation.isPending ? t('detective.play.submitting') : t('detective.play.submit')}
        </button>
      </section>

      {/* ── 판정 announce (CO-S-A1) — 비어 있어도 DOM에 상주해야 라이브 영역이 산다 ── */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="detective-verdict-live"
        className="space-y-3"
      >
        {submitError && (
          <p className="rounded-2xl bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700 ring-1 ring-rose-200">
            {submitError}
          </p>
        )}
        {result && (
          <div
            className={`rounded-2xl p-4 ring-1 ${
              result.verdict === 'correct'
                ? 'bg-emerald-50 ring-emerald-200'
                : result.verdict === 'partial'
                  ? 'bg-amber-50 ring-amber-200'
                  : 'bg-rose-50 ring-rose-200'
            }`}
          >
            <p className="text-[13px] font-extrabold text-slate-800">{verdictLine}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-700">{result.feedback}</p>

            {result.supporting_clues?.length > 0 && (
              <p className="mt-2 text-[11px] font-bold text-slate-500">
                {t('detective.play.supportingTitle')} · {result.supporting_clues.length}
              </p>
            )}

            {result.solution && (
              <div className="mt-3 rounded-xl bg-white/70 p-3 ring-1 ring-emerald-200">
                <p className="text-[12.5px] font-extrabold text-emerald-900">
                  {t('detective.play.solutionTitle')} — {result.solution.title}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-700">
                  {result.solution.explanation}
                </p>
                {result.solution.takeaway && (
                  <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
                    <span className="font-bold">{t('detective.play.takeawayLabel')}: </span>
                    {result.solution.takeaway}
                  </p>
                )}
                {result.solution.next_step_hint && (
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                    <span className="font-bold">{t('detective.play.nextStepLabel')}: </span>
                    {result.solution.next_step_hint}
                  </p>
                )}
              </div>
            )}

            {result.verdict === 'correct' ? (
              <Link
                to="/detective"
                className="mt-3 inline-block rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200"
              >
                {t('detective.play.backAfterSolve')}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setResult(null)}
                data-testid="detective-retry"
                className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200"
              >
                {t('detective.play.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="space-y-4 py-4">
      {/* ══ 「사건 게시판」 결 ══════════════════════════════════════════════
          2026-08-19 사용자 지시 — "심플한 디자인 틀은 벗어나지 않고, 가로로
          꽉차게 배치 유지하면서 (탐정 게시판) 컨셉이 **살짝** 섞였으면".

          그래서 **다섯 가지만** 빌려 왔다. 전부 기존 토큰 위의 얇은 층이고,
          카드 모양(rounded-2xl)·글자 크기·간격 체계는 그대로다:
            ① 크라프트 판 — 단서 구역 바탕을 종이색(#F6F0E4)으로. 코르크판.
            ② 압정 — 메모마다 벽돌색 점 하나(위 가운데).
            ③ 미세 회전 — ±0.5°. 그 이상은 격자가 어긋난 것처럼 보인다.
            ④ 붉은 실 — **장식이 아니라 뜻이다.** 「이 단서가 차트의 저 지점을
               가리킨다」와 「이 단서가 정답의 근거였다」에만 쓴다.
            ⑤ 등사 라벨 — `font-mono` 대문자. CASE FILE · EVIDENCE 0N.
          ⚠️ **웹폰트는 쓰지 않는다.** 손글씨체가 분위기에는 맞지만 이 앱은
             시스템 글꼴만 쓰고(styles/index.css) 폰트 하나를 위해 외부 의존을
             들이면 로드 실패 시 화면이 조용히 달라진다. 등사 라벨(mono)이
             「증거 서류」 느낌을 대신한다 — 참고 이미지의 타자기 문서와 같은 결.
          ⚠️ 벽돌색은 `#B8443C`다. 앱의 `rose-500`(오류)과 **일부러 다른 값**을
             쓴다 — 같은 빨강이면 실이 오류로 읽힌다. */}

      {/* 상단 줄 — 왼쪽 뒤로가기 · 오른쪽 가상 자료 고지(탐구 실험실 관례). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link to="/detective" className="shrink-0 text-xs font-bold text-slate-500 hover:text-sky-600">
          {t('detective.play.backToList')}
        </Link>
        {intro.data_note && (
          <p className="min-w-0 text-[10.5px] leading-snug text-amber-700 sm:text-right">
            <span className="font-bold">{t('detective.play.dataNoteLabel')}: </span>
            {intro.data_note}
          </p>
        )}
      </div>

      {/* ── 사건 파일 헤더 ──────────────────────────────────────────────────
          크라프트 판 위의 서류 한 장. 왼쪽에 사건 개요, 오른쪽에 관측 지점·기간을
          등사 라벨로 세운다 — 세로로 쌓던 `<dl>`을 옆으로 눕히면서 높이가 준다. */}
      <header className="rounded-2xl bg-[#F6F0E4] p-4 ring-1 ring-[#E0D3BC]">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-[420px]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#8A7A61]">
              {t('detective.play.caseFileLabel')}
            </p>
            <h1 className="mt-0.5 text-lg font-extrabold text-slate-800">{detail.title}</h1>
            <p className="mt-1 text-[13px] font-bold text-[#B8443C]">{intro.headline}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-700">{intro.body}</p>
          </div>
          {(intro.region || intro.period) && (
            <dl className="shrink-0 space-y-1 font-mono text-[10.5px] text-[#6F6250]">
              {intro.region && (
                <div>
                  <dt className="inline font-bold uppercase tracking-[0.1em]">{t('detective.play.region')} </dt>
                  <dd className="inline">{intro.region}</dd>
                </div>
              )}
              {intro.period && (
                <div>
                  <dt className="inline font-bold uppercase tracking-[0.1em]">{t('detective.play.period')} </dt>
                  <dd className="inline">{intro.period}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </header>

      {/* ── 2열 — 왼쪽 자료(붙박이) · 오른쪽 조사와 추리 ────────────────────
          왼쪽이 `sticky`인 것이 이 화면의 요점이다: 단서를 열면 그 시각이 차트에
          기준선으로 찍히는데, 세로로 쌓여 있던 종전 배치에서는 추리 보기를 고를
          때쯤 그 표시가 화면 위로 사라졌다(실측 pageH 1,244).
          ⚠️ `lg:` 이상에서만 붙박인다. 한 열로 접히는 좁은 화면에서 sticky를
             켜면 차트가 화면 절반을 계속 덮는다. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* 왼쪽 = **보고 판단하는 곳**(자료 + 추리), 오른쪽 = **조사하는 곳**(단서).
            추리를 차트 **바로 아래**에 두는 것이 이 배치의 값이다: 보기를 고를 때
            근거인 차트가 눈앞에 있고, 결론 버튼도 붙박이라 단서를 열다가 곧바로
            마무리할 수 있다.
            ⚠️ 번호는 ①자료 → ②단서 → ③추리 그대로다. 눈은 왼위 → 오른쪽 →
               왼아래로 도는데, 번호가 그 순서를 대신 말해 준다.
            ⚠️ 처음에는 왼쪽에 차트만 뒀다가 되돌렸다 — 실측으로 **왼쪽 288 ·
               오른쪽 777**이 나와 왼쪽 아래가 489px 비었다. */}
        <div className="space-y-4 lg:sticky lg:top-20">
        <section aria-labelledby="detective-charts">
          <h2 id="detective-charts" className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {t('detective.play.chartsTitle')}
          </h2>
          <p className="mb-2 mt-0.5 text-[11px] text-slate-500">{t('detective.play.chartsHint')}</p>
          <CaseChart series={detail.series} markers={markers} />
        </section>

        <section aria-labelledby="detective-hypotheses">
        <h2 id="detective-hypotheses" className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
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
        </div>{/* /왼쪽 열 */}

        <div className="space-y-4">
        <section aria-labelledby="detective-clues" className="rounded-2xl bg-[#F6F0E4] p-3 ring-1 ring-[#E0D3BC]">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="detective-clues" className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#8A7A61]">
              {t('detective.play.cluesTitle')}
            </h2>
            <p
              role="status"
              aria-live="polite"
              className="font-mono text-[10.5px] font-bold text-[#B8443C]"
              data-testid="detective-clue-progress"
            >
              {t('detective.play.progress', { opened: opened.size, total: clues.length })}
            </p>
          </div>
          <p className="mb-2 mt-0.5 text-[11px] text-[#6F6250]">
            {t('detective.play.cluesHint', { min: minClues })}
          </p>
          {/* 단서 메모 — 크라프트 판 위 **2열**이다.
              ⚠️ **`xl:grid-cols-4`에서 내려왔다(2026-08-19).** 그 4열은 단서
                 구역이 셸 **전폭**(1,120px)을 쓰던 시절의 값이고, 그때는 한 칸이
                 268px였다. 지금은 오른쪽 열(1,536에서 약 500px) 안이라 4열이면
                 한 칸 118px — 라벨 한 줄도 못 들어간다. 열을 줄인 것이 아니라
                 **그릇이 바뀐 것**이다. */}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {clues.map((clue, i) => {
              const isOpen = opened.has(clue.clue_id);
              const isSupport = result?.supporting_clues?.includes(clue.clue_id);
              return (
                <li key={clue.clue_id}>
                  <button
                    type="button"
                    onClick={() => toggleClue(clue.clue_id)}
                    aria-expanded={isOpen}
                    data-testid={`detective-clue-${clue.clue_id}`}
                    // 미세 회전은 **짝·홀로 갈린다** — 전부 같은 방향이면 판이
                    // 통째로 기운 것처럼 보인다. 누르는 동안 곧게 펴진다.
                    className={`relative w-full rounded-xl px-3 pb-3 pt-4 text-left shadow-sm ring-1 transition hover:rotate-0 motion-reduce:transition-none ${
                      i % 2 === 0 ? '-rotate-[0.5deg]' : 'rotate-[0.5deg]'
                    } ${
                      isSupport
                        ? 'bg-[#FFFCF5] ring-2 ring-[#B8443C]'
                        : isOpen
                          ? 'bg-[#FFFCF5] ring-[#E0D3BC]'
                          : 'bg-white/80 ring-[#E0D3BC] hover:ring-sky-300'
                    }`}
                  >
                    {/* 압정 */}
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full bg-[#B8443C] shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                    />
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#A2937B]">
                        {t('detective.play.evidenceNo', { n: String(i + 1).padStart(2, '0') })}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-500">
                        {isOpen ? t('detective.play.clueOpened') : t('detective.play.clueLocked')}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] font-bold text-slate-800">
                      {isOpen ? '🔎 ' : '🔒 '}
                      {clue.label}
                    </span>
                    {isOpen && (
                      <>
                        <span className="mt-1.5 block text-[12px] leading-relaxed text-slate-600">
                          {clue.text}
                        </span>
                        {clue.x && (
                          // 🔴 붉은 실 — 이 줄이 「이 메모가 차트의 저 지점에
                          // 묶여 있다」는 표시다. 차트 기준선과 같은 뜻이라
                          // 색을 맞춘다(CaseChart의 marker stroke).
                          <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-bold text-[#B8443C]">
                            <span aria-hidden="true" className="h-px w-4 flex-none bg-[#B8443C]" />
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

        </div>{/* /오른쪽 열 */}
      </div>{/* /2열 */}

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

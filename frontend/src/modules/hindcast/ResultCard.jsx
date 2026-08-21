import { useT } from '../../i18n';

/**
 * 서버 판정 결과 카드 (MT-30).
 *
 * 여기 있는 모든 숫자는 **서버가 계산해 내려준 것**이다 — 프론트는 점수를 다시
 * 계산하지 않는다(계산할 재료도 없다). `aria-live`로 판정을 읽어 주는 것은
 * detective 판정 카드가 세운 관례다.
 *
 * `sources`를 화면에 그리는 것이 이 항목의 정직성이다: 「데모용 고정 날짜」의 값이
 * 어디서 왔는지 사용자가 직접 확인할 수 있어야 합성과 구별된다.
 */
export default function ResultCard({ result }) {
  const t = useT();
  const verdictText =
    result.result === 'win'
      ? t('hindcast.result.win')
      : result.result === 'lose'
        ? t('hindcast.result.lose')
        : t('hindcast.result.draw');

  const rained = result.actual.rain_prob > 0;

  return (
    <div
      data-testid="hindcast-result"
      className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200"
    >
      <p
        aria-live="polite"
        data-testid="hindcast-verdict"
        className="text-sm font-extrabold text-slate-800"
      >
        {verdictText}
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-sky-50 p-2">
          <p className="text-[10px] font-extrabold text-sky-700">{t('hindcast.result.you')}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-800">
            {result.user_pred.temp_max}{t('common.celsius')} · {result.user_pred.rain_prob}%
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {t('hindcast.result.score')} {result.user_score}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-extrabold text-slate-600">{t('hindcast.result.caster')}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-800">
            {result.ai_pred.temp_max}{t('common.celsius')} · {result.ai_pred.rain_prob}%
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {t('hindcast.result.score')} {result.ai_score}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2">
          <p className="text-[10px] font-extrabold text-emerald-700">
            {t('hindcast.result.actual')}
          </p>
          <p className="mt-0.5 text-xs font-bold text-slate-800">{result.actual.temp_max}{t('common.celsius')}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {rained ? t('hindcast.result.rained') : t('hindcast.result.noRain')}
          </p>
        </div>
      </div>

      {rained && result.actual.sum_rn != null && (
        <p className="text-[11px] font-bold text-slate-500">
          {t('hindcast.result.rainfall', { mm: result.actual.sum_rn })}
        </p>
      )}

      {result.explanation && (
        <div>
          <p className="text-[11px] font-extrabold text-slate-600">
            {t('hindcast.result.explanationTitle')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{result.explanation}</p>
        </div>
      )}

      {/* 값의 출처 — 합성이 아님을 스스로 증명하는 자리 */}
      {result.sources && (
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] font-extrabold text-slate-600">
            {t('hindcast.result.sourcesTitle')}
          </p>
          <ul className="mt-1 space-y-1">
            {result.sources.temp_max && (
              <li className="text-[10px] leading-relaxed text-slate-600">
                <span className="font-bold">{t('hindcast.result.sourceTemp')}</span>{' '}
                {result.sources.temp_max}
              </li>
            )}
            {result.sources.sum_rn && (
              <li className="text-[10px] leading-relaxed text-slate-600">
                <span className="font-bold">{t('hindcast.result.sourceRain')}</span>{' '}
                {result.sources.sum_rn}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

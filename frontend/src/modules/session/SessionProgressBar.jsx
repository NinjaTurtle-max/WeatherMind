import { useT } from '../../i18n';

/**
 * SessionProgressBar (R2-01 S7) — 상단 진행 바.
 * answered/total을 세그먼트로 표시 (답한 문항 수 기준, 현재 풀이 중 문항은 하이라이트).
 */
export default function SessionProgressBar({ answered, total, currentIndex }) {
  const t = useT();
  if (!total) return null;

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500">{t('session.progressTitle')}</span>
        <span className="text-xs font-medium text-slate-500">
          {t('session.progressCount', { answered, total })}
        </span>
      </div>
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full transition-colors ${
              i < answered
                ? 'bg-sky-500'
                : i === currentIndex
                  ? 'bg-sky-200 ring-1 ring-inset ring-sky-400'
                  : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

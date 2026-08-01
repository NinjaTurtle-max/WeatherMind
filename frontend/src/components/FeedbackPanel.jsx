/**
 * FeedbackPanel (04번 스펙) — RAG 피드백 표시용 슬라이드업 패널.
 * 세션 경로 공용 — props로 message, isCorrect를 받는다.
 */
export default function FeedbackPanel({ message, isCorrect }) {
  if (!message) return null;

  const tone = isCorrect
    ? { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' }
    : { bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' };

  return (
    <div className="fixed inset-x-0 bottom-14 z-40 mx-auto max-w-xl px-3 pb-3">
      <div className="animate-slide-up overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className={`h-1.5 w-full ${tone.bar}`} />
        <div className="p-4">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}>
            AI 피드백
          </span>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

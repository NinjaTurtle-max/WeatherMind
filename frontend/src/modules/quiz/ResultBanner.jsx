/**
 * ResultBanner (04번 스펙) — 정답/오답 색상(초록/주황) + XP 획득 애니메이션
 */
export default function ResultBanner({ result }) {
  if (!result) return null;
  const { is_correct, correct_answer, xp_earned } = result;

  return (
    <div
      className={`mt-4 flex items-center justify-between rounded-2xl px-4 py-3 text-white shadow-md ${
        is_correct ? 'bg-emerald-500' : 'bg-orange-500'
      }`}
    >
      <div>
        <p className="text-base font-extrabold">
          {is_correct ? '정답이에요! 🎉' : '아쉬워요 😢'}
        </p>
        {!is_correct && correct_answer != null && (
          <p className="mt-0.5 text-sm text-white/90">
            정답: <span className="font-bold">{String(correct_answer)}</span>
          </p>
        )}
      </div>
      {xp_earned > 0 && (
        <span
          key={xp_earned}
          className="animate-xp-pop rounded-full bg-white/20 px-3 py-1.5 text-lg font-extrabold"
        >
          +{xp_earned} XP
        </span>
      )}
    </div>
  );
}

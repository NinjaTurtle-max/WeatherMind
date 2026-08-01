/**
 * ResultBanner (04번 스펙) — 정답/오답 색상(초록/주황) + XP 획득 애니메이션
 *
 * R10-01 §3.1·D10-1: 구름 소모 사유를 오답 피드백에 명시한다. 표기는 서버 실측
 * `clouds_spent`(SessionAnswerResult additive — 0 또는 CLOUD_COST)만 쓴다.
 * is_correct로 계산하면 안 된다 — 잔량 0에서는 오답이어도 소모가 0이다(진행 중
 * 세션을 끊지 않는 계약). 필드가 없는 응답(구 백엔드·목)에서는 미표기.
 */
export default function ResultBanner({ result }) {
  if (!result) return null;
  const { is_correct, correct_answer, xp_earned, clouds_spent: cloudsSpent } = result;

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
        {cloudsSpent > 0 && (
          <p className="mt-0.5 text-xs font-bold text-white/90">
            ☁️ 구름 −{cloudsSpent} · 구름은 틀린 문항에만 줄어들어요
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

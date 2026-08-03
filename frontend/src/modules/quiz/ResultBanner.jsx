/**
 * ResultBanner (04번 스펙) — 정답/오답 색상(초록/주황) + XP 획득 애니메이션
 *
 * R10-01 §3.1·D10-1: 구름 소모 사유를 오답 피드백에 명시한다. 표기는 서버 실측
 * `clouds_spent`(SessionAnswerResult additive — 0 또는 CLOUD_COST)만 쓴다.
 * is_correct로 계산하면 안 된다 — 잔량 0에서는 오답이어도 소모가 0이다(진행 중
 * 세션을 끊지 않는 계약). 필드가 없는 응답(구 백엔드·목)에서는 미표기.
 *
 * R10-01 §3.5 마감 3 (관찰 보고서 §1-5): 약점 극복 보너스가 적용됐는지 UI에서
 * 확인할 수 없었다. 서버는 배율(WEAK_TAG_XP_MULTIPLIER 1.5)을 xp_earned에 이미
 * 녹여 보내고 **is_weak을 노출하지 않으므로**, 기본 지급액과의 차이만큼을
 * "약점 극복" 보너스로 분리 표기한다(차이가 0이면 표기 없음 — 없는 보너스를
 * 만들어 보이지 않는다). 기본 지급액은 xp_service의 계약 수치와 짝이며,
 * 백엔드 상수가 바뀌면 여기도 함께 바꿔야 한다(스키마에 필드가 생기면 그것으로 대체).
 */
// xp_service.quiz_xp의 기본 지급액 — 정답 10 + 첫 시도 보너스 5 / 오답 2.
// (세션·유닛 경로는 문항당 1회 제출이라 정답이면 항상 첫 시도 정답이다)
const BASE_XP_CORRECT = 15;
const BASE_XP_WRONG = 2;

export default function ResultBanner({ result }) {
  if (!result) return null;
  const { is_correct, correct_answer, xp_earned, clouds_spent: cloudsSpent } = result;
  const baseXp = is_correct ? BASE_XP_CORRECT : BASE_XP_WRONG;
  const bonusXp = Number(xp_earned) > baseXp ? Number(xp_earned) - baseXp : 0;

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
        <span key={xp_earned} className="animate-xp-pop shrink-0 text-right">
          <span className="rounded-full bg-white/20 px-3 py-1.5 text-lg font-extrabold">
            +{bonusXp > 0 ? baseXp : xp_earned} XP
          </span>
          {/* 약점 극복 보너스 분리 표기 — "+15 XP, 약점 극복 +7" */}
          {bonusXp > 0 && (
            <span className="mt-1 block text-xs font-bold text-white/90">약점 극복 +{bonusXp}</span>
          )}
        </span>
      )}
    </div>
  );
}

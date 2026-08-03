/**
 * ResultBanner (04번 스펙) — 정답/오답 색상(초록/주황) + XP 획득 애니메이션
 *
 * R10-01 §3.1·D10-1: 구름 소모 사유를 오답 피드백에 명시한다. 표기는 서버 실측
 * `clouds_spent`(SessionAnswerResult additive — 0 또는 CLOUD_COST)만 쓴다.
 * is_correct로 계산하면 안 된다 — 잔량 0에서는 오답이어도 소모가 0이다(진행 중
 * 세션을 끊지 않는 계약). 필드가 없는 응답(구 백엔드·목)에서는 미표기.
 *
 * R10-01 §3.5 마감 3: 약점 극복 보너스도 같은 원칙 — **서버 실측 분해값만** 쓴다.
 * 서버가 `xp_base`(배율 적용 전)와 `xp_weak_bonus`(배율 증분)를 함께 보내고
 * `xp_base + xp_weak_bonus === xp_earned`가 계약이다. 이 파일은 배율(1.5)도
 * 기본 지급액도 반올림 규칙도 모른다 — 백엔드 상수 사본을 두지 않는 것이 요점
 * (사본이 있던 이전 구현은 백엔드가 수치를 바꾸면 조용히 틀린 금액을 표기했다.
 *  backend tests/test_r10_xp_breakdown_contract.py가 이 소스의 상수 부재를 가드).
 * 분해 필드가 없는 응답(구 백엔드·목)에서는 보너스 줄을 표기하지 않는다 —
 * 추정하지 않는다.
 */
export default function ResultBanner({ result }) {
  if (!result) return null;
  const {
    is_correct,
    correct_answer,
    xp_earned,
    clouds_spent: cloudsSpent,
    xp_base: xpBase,
    xp_weak_bonus: xpWeakBonus,
  } = result;
  // 서버 분해값만 신뢰: 보너스가 실측 0 초과일 때만 분리 표기한다.
  const bonusXp = Number(xpWeakBonus) > 0 ? Number(xpWeakBonus) : 0;
  const baseXp = bonusXp > 0 ? Number(xpBase) : Number(xp_earned);

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
            +{baseXp} XP
          </span>
          {/* 약점 극복 보너스 분리 표기 — 서버 xp_weak_bonus 그대로 */}
          {bonusXp > 0 && (
            <span className="mt-1 block text-xs font-bold text-white/90">약점 극복 +{bonusXp}</span>
          )}
        </span>
      )}
    </div>
  );
}

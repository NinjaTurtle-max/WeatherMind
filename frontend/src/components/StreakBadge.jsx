import { useProgressStore } from '../store/progressStore';

/**
 * StreakBadge (04번 스펙) — 스트릭 숫자 + 불꽃 아이콘
 */
export default function StreakBadge() {
  const streakCount = useProgressStore((s) => s.streakCount);

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-sm font-bold text-orange-600"
      title={`연속 출석 ${streakCount}일`}
    >
      <span aria-hidden="true">🔥</span>
      {streakCount}
      {/* 최협폭(360px 등)에선 헤더가 넘쳐 '일'을 접는다 — title에 전체 문구가 남는다 */}
      <span className="hidden text-xs font-medium text-orange-500 sm:inline">일</span>
    </span>
  );
}

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
      <span className="text-xs font-medium text-orange-500">일</span>
    </span>
  );
}

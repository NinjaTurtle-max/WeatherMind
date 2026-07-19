import { useProgressStore } from '../store/progressStore';

/**
 * XPBar (04번 스펙) — 상단 고정, xp / next_level_xp 프로그레스바
 */
export default function XPBar() {
  const { xp, level, nextLevelXp } = useProgressStore();

  // 현재 레벨 시작 XP = 50 * (level-1)^2 (07번 스펙 레벨 공식 기준)
  const levelStartXp = 50 * (level - 1) * (level - 1);
  const span = Math.max(1, nextLevelXp - levelStartXp);
  const ratio = Math.min(100, Math.max(0, ((xp - levelStartXp) / span) * 100));

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 rounded-full bg-sky-500 px-2 py-0.5 text-xs font-bold text-white">
        Lv.{level}
      </span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sky-950/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-400 transition-all duration-500"
          style={{ width: `${ratio}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-medium text-sky-100">
        {xp} / {nextLevelXp} XP
      </span>
    </div>
  );
}

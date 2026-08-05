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
    // 가장 좁은 폭(sm 미만)에선 통째로 접는다 — Lv 배지+막대의 최소 폭도 안 나와
    // 옆 배지와 겹치기 때문. 그 구간의 진척은 SpineBadge(유닛·왕관)가 대신한다.
    // flex-1로만 두면 넓은 화면에서 막대가 헤더 절반을 차지해 좌우가 쏠려 보인다
    // — 상한을 두고 남는 폭은 가운데 여백으로 넘긴다.
    <div className="hidden min-w-0 max-w-[240px] flex-1 items-center gap-2 sm:flex">
      <span className="shrink-0 rounded-full bg-sky-500 px-2 py-0.5 text-xs font-bold text-white">
        Lv.{level}
      </span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-400 transition-all duration-500"
          style={{ width: `${ratio}%` }}
        />
      </div>
      {/* 좁은 폭에선 숨긴다 — 진척은 막대가 이미 보여주므로, 이 숫자를 shrink-0으로
          붙들면 헤더가 넘쳐 옆 배지(구름 에너지)와 겹친다. */}
      <span className="hidden shrink-0 text-xs font-medium tabular-nums text-slate-500 md:inline">
        {xp} / {nextLevelXp} XP
      </span>
    </div>
  );
}

import { create } from 'zustand';

/**
 * 진행도 스토어 (04번 스펙: progressStore — xp, streak, level)
 * GET /progress/me 응답 {xp, level, streak_count, next_level_xp} 를 그대로 보관.
 * R8-01 §3.3: spine(스파인 집계 — 유닛 진도·왕관·current_unit)도 함께 보관한다.
 * 구 백엔드(spine 부재) 응답이면 null 유지 — 소비자(SpineBadge)는 미렌더.
 */
export const useProgressStore = create((set) => ({
  xp: 0,
  level: 1,
  streakCount: 0,
  nextLevelXp: 50,
  spine: null, // {units_total, units_cleared, crowns_earned, crowns_total, current_unit|null}

  setProgress: ({ xp, level, streak_count, next_level_xp, spine }) =>
    set((state) => ({
      xp: xp ?? state.xp,
      level: level ?? state.level,
      streakCount: streak_count ?? state.streakCount,
      nextLevelXp: next_level_xp ?? state.nextLevelXp,
      spine: spine ?? state.spine,
    })),

  setStreak: (streakCount) => set({ streakCount }),

  /** 퀴즈 답안 제출 직후 낙관적 반영 (서버 재조회 전까지) */
  addXp: (amount) => set((state) => ({ xp: state.xp + (amount || 0) })),

  reset: () => set({ xp: 0, level: 1, streakCount: 0, nextLevelXp: 50, spine: null }),
}));

import { create } from 'zustand';

/**
 * 진행도 스토어 (04번 스펙: progressStore — xp, streak, level)
 * GET /progress/me 응답 {xp, level, streak_count, next_level_xp} 를 그대로 보관.
 */
export const useProgressStore = create((set) => ({
  xp: 0,
  level: 1,
  streakCount: 0,
  nextLevelXp: 50,
  lastXpGain: 0, // XP 획득 애니메이션용 (ResultBanner)

  setProgress: ({ xp, level, streak_count, next_level_xp }) =>
    set((state) => ({
      xp: xp ?? state.xp,
      level: level ?? state.level,
      streakCount: streak_count ?? state.streakCount,
      nextLevelXp: next_level_xp ?? state.nextLevelXp,
    })),

  setStreak: (streakCount) => set({ streakCount }),

  /** 퀴즈 답안 제출 직후 낙관적 반영 (서버 재조회 전까지) */
  addXp: (amount) =>
    set((state) => ({
      xp: state.xp + (amount || 0),
      lastXpGain: amount || 0,
    })),

  clearLastXpGain: () => set({ lastXpGain: 0 }),

  reset: () => set({ xp: 0, level: 1, streakCount: 0, nextLevelXp: 50, lastXpGain: 0 }),
}));

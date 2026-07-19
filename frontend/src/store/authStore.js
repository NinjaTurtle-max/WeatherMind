import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 인증 스토어 (04번 스펙: authStore — user, token)
 * - accessToken / refreshToken 은 localStorage에 persist
 * - 02번 스펙: JWT Bearer 헤더는 api/client.js 인터셉터에서 부착
 */
export const useAuthStore = create(
  persist(
    (set) => ({
      user: null, // { user_id, email, nickname, level_group }
      accessToken: null,
      refreshToken: null,

      setUser: (user) => set({ user }),

      setTokens: ({ accessToken, refreshToken }) =>
        set((state) => ({
          accessToken: accessToken ?? state.accessToken,
          refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
        })),

      setAccessToken: (accessToken) => set({ accessToken }),

      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'weathermind-auth',
    },
  ),
);

export const isAuthenticated = () => Boolean(useAuthStore.getState().accessToken);

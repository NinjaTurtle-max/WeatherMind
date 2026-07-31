import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 인증 스토어 (04번 스펙: authStore — user, token)
 * - accessToken / refreshToken 은 localStorage에 persist
 * - 02번 스펙: JWT Bearer 헤더는 api/client.js 인터셉터에서 부착
 * - postAuthRoute (R9-09 버그픽스): 인증 완료 직후 보내야 할 경로(1회성 의도).
 *   가입 성공 → 배치고사처럼 "토큰이 생기는 순간 어디로 갈지"를 스토어에 실어,
 *   App의 RedirectIfAuthed가 이 값을 목적지로 쓴다. 페이지의 navigate와
 *   RedirectIfAuthed의 <Navigate>가 서로 다른 곳을 가리켜 경합하던 회귀의
 *   구조적 해소 — 어느 쪽이 이겨도 같은 곳으로 간다. persist 제외(전이 상태).
 */
export const useAuthStore = create(
  persist(
    (set) => ({
      user: null, // { user_id, email, nickname, level_group }
      accessToken: null,
      refreshToken: null,
      postAuthRoute: null, // 인증 직후 1회성 목적지 (기본 '/' — App에서 해석)

      setUser: (user) => set({ user }),

      setPostAuthRoute: (postAuthRoute) => set({ postAuthRoute }),

      setTokens: ({ accessToken, refreshToken }) =>
        set((state) => ({
          accessToken: accessToken ?? state.accessToken,
          refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
        })),

      setAccessToken: (accessToken) => set({ accessToken }),

      logout: () => set({ user: null, accessToken: null, refreshToken: null, postAuthRoute: null }),
    }),
    {
      name: 'weathermind-auth',
      // postAuthRoute는 인증 전이 순간에만 유효한 1회성 값 — 저장하지 않는다
      // (남으면 다음 로그인이 엉뚱한 곳으로 리다이렉트될 수 있음).
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);


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
      /**
       * 🔴 **이 기기가 계정을 가진 적이 있는가** — `logout()`이 지우지 않는 유일한 값.
       *
       * 없으면 이런 일이 난다: 401 인터셉터가 토큰을 지운 뒤 학습자가 **새로고침**
       * 하면, `App.jsx`의 모듈 스코프 플래그(`guestAttempted`)가 함께 초기화돼
       * 「토큰이 없는 첫 방문자」와 구분이 안 된다 → 조용히 새 게스트가 발급되고
       * 옛 진도는 영영 닿을 수 없게 된다. 게스트 비밀번호는 무작위 시크릿이라
       * 복구 경로가 없다. 만료 안내 화면(`SessionExpired`)을 만들어도 **가장 흔한
       * 사용자 행동 하나(새로고침)로 우회**되면 없는 것과 같다.
       *
       * 그래서 토큰과 **다른 수명**을 갖는다: `setTokens`가 세우고, `logout()`은
       * 건드리지 않으며, 지우는 것은 학습자가 「새로 시작하기」를 눌렀을 때
       * (`forgetAccount`)뿐이다. persist에 포함되어야 새로고침을 건넌다.
       */
      hadAccount: false,

      setUser: (user) => set({ user }),

      setPostAuthRoute: (postAuthRoute) => set({ postAuthRoute }),

      setTokens: ({ accessToken, refreshToken }) =>
        set((state) => ({
          accessToken: accessToken ?? state.accessToken,
          refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
          hadAccount: true,
        })),

      setAccessToken: (accessToken) => set({ accessToken }),

      // ⚠️ `hadAccount`는 **의도적으로 빠져 있다**(위 주석). 여기에 더하면
      // 만료 안내가 새로고침 한 번으로 사라진다.
      logout: () => set({ user: null, accessToken: null, refreshToken: null, postAuthRoute: null }),

      /** 「새로 시작하기」 — 옛 계정을 포기한다고 학습자가 명시했을 때만. */
      forgetAccount: () => set({ hadAccount: false }),
    }),
    {
      name: 'weathermind-auth',
      // postAuthRoute는 인증 전이 순간에만 유효한 1회성 값 — 저장하지 않는다
      // (남으면 다음 로그인이 엉뚱한 곳으로 리다이렉트될 수 있음).
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        // 새로고침을 건너야 의미가 있다 — 이 한 줄이 빠지면 위 주석의 결함이 그대로 돌아온다.
        hadAccount: state.hadAccount,
      }),
    },
  ),
);


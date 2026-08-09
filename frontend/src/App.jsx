import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import client from './api/client';
import { translate, getCurrentLocale } from './i18n/core.js';
import LoadingSpinner from './components/LoadingSpinner';
import Layout from './components/Layout';
import SessionPage from './modules/session/SessionPage';
import HomePage from './modules/home/HomePage';
import CurriculumHome from './modules/curriculum/CurriculumHome';
import UnitSessionPage from './modules/curriculum/UnitSessionPage';
import BoardPage from './modules/board/BoardPage';
import ExploreHome from './modules/explore/ExploreHome';
import TyphoonSimPage from './modules/explore/TyphoonSimPage';
import ClimateSimPage from './modules/explore/ClimateSimPage';
import DetectiveRoutes from './modules/detective/DetectiveRoutes';
import LeaguePage from './modules/league/LeaguePage';
import DuelPage from './modules/duel/DuelPage';
import ProgressPage from './modules/progress/ProgressPage';
import LoginPage from './modules/auth/LoginPage';
import RegisterPage from './modules/auth/RegisterPage';
import ConvertAccountPage from './modules/auth/ConvertAccountPage';
import PlacementPage from './modules/onboarding/PlacementPage';

// R7-03 개발자 패널 — 런타임 게이트(GET /dev/state 404=비활성)는 유지하되,
// lazy 코드 스플릿으로 메인 번들에서 분리 (compose 스택의 빌드 프론트에서도 동작)
const DevPanel = lazy(() => import('./modules/dev/DevPanel'));

/**
 * 라우팅 (04번 스펙 + R2-01 S7 + R3-01 S4 + R5-01 S4 + R7-01 S3) — react-router-dom v6, 하단 탭바.
 * R5-01: 기본 진입(/)은 학습 홈이었다. 2026-08-05부터 /는 홈 대시보드(HomePage)이고
 * 학습 경로는 /learn(CurriculumHome)이다. 유닛 세션은 /learn/units/:unitId.
 * 자유 일일 세션(SessionPage)은 /daily로 병존 유지(§3.4).
 * R3-01 §0 제품 결정: 기후 시뮬레이터(/simulator) 폐지 → 대기 보드 퍼즐(/board)로 대체.
 * R7-01 S3: 온보딩 배치고사(/onboarding/placement)는 인증 필요하되 Layout(탭바) 밖
 * 전체 화면 — 가입 직후 진입, 건너뛰기 가능.
 *
 * ~~R10-01 §3.4 (S4 — R10-F)~~ **해제됨 (CO-N-1 ③, 2026-08-08)**: 보드·예보 대결·
 * 리그를 `FeatureUnlockGate`(세션 1·2·3회)로 감싸 동기 부여 화면을 먼저 보여 주던
 * 것을 걷어냈다. 근거는 심사 배점이다 — 배점 ②(체험·참여형 25점)의 문면이
 * "단순 퀴즈·정답 맞히기를 **넘어**"인데, 콜드 오픈 3클릭으로 닿는 것이 객관식
 * 퀴즈뿐이었다. 게이트는 `lib/onboardingGate.js:15-22`가 스스로 밝히듯 **순수 표시
 * 계층**(서버 권한 아님·라우트 미차단)이라 제거해도 로직이 깨지지 않는다.
 * 게이트 모듈 자체는 남는다 — 일일 목표 선택지(DAILY_GOAL_CHOICES)를 소유한다.
 */
/**
 * 자동 게스트 발급 (CO-N-1 ①, 2026-08-08) — **「로그인 없이 열려야」 규정 대응**.
 *
 * 종전에는 토큰이 없으면 곧장 `/login`으로 튕겼다. 대회 규정은 심사위원이 계정
 * 없이 URL만으로 서비스를 열 수 있어야 한다고 요구하고, 우리는 이미 서버에
 * `POST /auth/guest`(실 유저 + 실 JWT)를 갖고 있다 — 첫 진입에서 그것을 대신
 * 눌러 준다. 딥링크가 보존되므로 `/explore`로 바로 들어온 심사위원은 `/explore`에
 * 도착한다(LoginPage의 명시적 게스트 CTA만 배치고사로 보낸다 — 그 동선은 불변).
 *
 * 중복 발급 방지가 이 모듈 스코프 두 변수의 전부다:
 *   - `guestAttempted`: **한 번 시도했으면 다시 시도하지 않는다.** 실패 시 무한
 *     재시도를 막고, 더 중요하게는 **로그아웃**을 막는다 — 보호 라우트에서
 *     토큰이 지워졌을 때 이 플래그가 없으면 조용히 새 게스트를 발급해 로그아웃이
 *     동작하지 않는다.
 *   - `guestPromise`: StrictMode 이중 마운트·동시 렌더가 한 요청을 공유한다.
 */
let guestAttempted = false; // 이 페이지 로드에서 이미 시도했는가(또는 토큰을 본 적 있는가)
let guestSettled = false; // 그 시도가 끝났는가(성공이면 토큰이, 실패면 /login이 다음 화면)
let guestPromise = null; // StrictMode 이중 실행·동시 렌더가 공유하는 단일 요청

/** 테스트 전용 — 다음 진입에서 자동 발급을 다시 시도할 수 있게 되돌린다. */
export function resetGuestAutoIssue() {
  guestAttempted = false;
  guestSettled = false;
  guestPromise = null;
}

function issueGuestOnce() {
  if (!guestPromise) {
    guestPromise = client
      .post('/auth/guest')
      .then(({ data }) => {
        const store = useAuthStore.getState();
        store.setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
        store.setUser({ nickname: translate(getCurrentLocale(), 'auth.login.guestNickname'), is_guest: true });
        return true;
      })
      .catch(() => false);
  }
  return guestPromise;
}

function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [, bump] = useState(0); // 모듈 스코프 플래그가 바뀐 뒤 한 번 다시 그린다

  useEffect(() => {
    // 토큰을 한 번이라도 본 순간 "시도 완료"로 못박는다 — 이후 **로그아웃으로
    // 토큰이 지워져도 새 게스트를 발급하지 않는다**(로그아웃이 안 되는 회귀 방지).
    if (accessToken) {
      guestAttempted = true;
      guestSettled = true;
      return;
    }
    if (guestAttempted) return;
    guestAttempted = true;
    issueGuestOnce().then(() => {
      guestSettled = true;
      bump((n) => n + 1);
    });
  }, [accessToken]);

  if (!accessToken) {
    // 시도가 끝났는데도 토큰이 없다 = 발급 실패(또는 로그아웃) → 종전 폴백 유지.
    if (guestSettled) return <Navigate to="/login" replace />;
    return <LoadingSpinner label={translate(getCurrentLocale(), 'auth.login.guestStarting')} />;
  }
  return (
    <>
      <Outlet />
      {/* R7-03 개발자 모드 플로팅 패널 — GET /dev/state 200일 때만 렌더(404=비활성) */}
      <Suspense fallback={null}>
        <DevPanel />
      </Suspense>
    </>
  );
}

/**
 * R9-09 버그픽스: 인증 직후 목적지는 authStore.postAuthRoute가 단일 진실원.
 * 가입 성공 흐름에서 setTokens(외부 스토어 구독 = sync 우선 플러시)가
 * 페이지의 navigate('/onboarding/placement')보다 먼저 렌더를 일으키면, 이
 * 컴포넌트의 <Navigate>가 뒤늦게 발화해 목적지를 '/'로 덮어쓰는 경합이 있었다
 * (가입 직후 배치고사 미진입 회귀). 페이지가 의도(postAuthRoute)를 스토어에
 * 실어 두면 어느 쪽이 이기든 같은 곳으로 간다 — 경합 자체가 무해해진다.
 */
function RedirectIfAuthed({ children }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const postAuthRoute = useAuthStore((s) => s.postAuthRoute);
  if (accessToken) return <Navigate to={postAuthRoute ?? '/'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthed>
            <RegisterPage />
          </RedirectIfAuthed>
        }
      />

      <Route element={<RequireAuth />}>
        {/* 온보딩 배치고사 — 탭바 없는 전체 화면(Layout 밖) */}
        <Route path="/onboarding/placement" element={<PlacementPage />} />
        {/* R11-01 웨이브 2 (R10-J): 게스트 → 정식 계정 전환 — 배치고사와 같은
            전체 화면 관례(Layout 밖). 진입은 GuestSaveBanner(학습 홈)에서. */}
        <Route path="/account/convert" element={<ConvertAccountPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          {/* 2026-08-05: `/`는 홈 대시보드, 학습 경로는 `/learn`으로 갈렸다. */}
          <Route path="/learn" element={<CurriculumHome />} />
          <Route path="/learn/units/:unitId" element={<UnitSessionPage />} />
          <Route path="/daily" element={<SessionPage />} />
          <Route path="/board" element={<BoardPage />} />
          {/* R9-01 §3.5: 탐구 시뮬 v1 — 순수 클라이언트 모듈. 진입은 BoardPage 카드
              **와 내비 「탐구」 탭**(CO-N-1 ②, 2026-08-08). */}
          <Route path="/explore" element={<ExploreHome />} />
          <Route path="/explore/typhoon" element={<TyphoonSimPage />} />
          <Route path="/explore/climate" element={<ClimateSimPage />} />
          {/* R13 기후 탐정(CO-N-2) — 하위 경로는 모듈이 소유한다(DetectiveRoutes). */}
          <Route path="/detective/*" element={<DetectiveRoutes />} />
          <Route path="/duel" element={<DuelPage />} />
          <Route path="/league" element={<LeaguePage />} />
          <Route path="/me" element={<ProgressPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

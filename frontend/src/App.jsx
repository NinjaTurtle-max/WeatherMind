import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import FeatureUnlockGate from './components/FeatureUnlockGate';
import SessionPage from './modules/session/SessionPage';
import HomePage from './modules/home/HomePage';
import CurriculumHome from './modules/curriculum/CurriculumHome';
import UnitSessionPage from './modules/curriculum/UnitSessionPage';
import BoardPage from './modules/board/BoardPage';
import ExploreHome from './modules/explore/ExploreHome';
import TyphoonSimPage from './modules/explore/TyphoonSimPage';
import ClimateSimPage from './modules/explore/ClimateSimPage';
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
 * R10-01 §3.4 (S4 — R10-F): 점진적 잠금 해제는 라우트를 없애지 않는다. 보드·예보
 * 대결·리그는 FeatureUnlockGate로 감싸 세션 완료 횟수가 모자라면 페이지 대신
 * **동기 부여 화면**(기능 설명 + 가치 + 해제 조건 + 세션 시작 CTA)을 보여준다.
 * 조건을 넘으면 원래 페이지가 그대로 렌더된다(자물쇠·차단 없음, 표시 계층 전용).
 * 하위 경로(/explore/*)는 게이트 밖 — 보드 진입 카드에서만 도달하므로 이중 안내
 * 불필요.
 */
function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
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
          <Route
            path="/board"
            element={
              <FeatureUnlockGate to="/board">
                <BoardPage />
              </FeatureUnlockGate>
            }
          />
          {/* R9-01 §3.5: 탐구 시뮬 v1 — 순수 클라이언트 모듈(진입은 BoardPage 카드) */}
          <Route path="/explore" element={<ExploreHome />} />
          <Route path="/explore/typhoon" element={<TyphoonSimPage />} />
          <Route path="/explore/climate" element={<ClimateSimPage />} />
          <Route
            path="/duel"
            element={
              <FeatureUnlockGate to="/duel">
                <DuelPage />
              </FeatureUnlockGate>
            }
          />
          <Route
            path="/league"
            element={
              <FeatureUnlockGate to="/league">
                <LeaguePage />
              </FeatureUnlockGate>
            }
          />
          <Route path="/me" element={<ProgressPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

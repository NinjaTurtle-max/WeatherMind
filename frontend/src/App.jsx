import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import SessionPage from './modules/session/SessionPage';
import CurriculumHome from './modules/curriculum/CurriculumHome';
import UnitSessionPage from './modules/curriculum/UnitSessionPage';
import QuizPage from './modules/quiz/QuizPage';
import BoardPage from './modules/board/BoardPage';
import ExploreHome from './modules/explore/ExploreHome';
import TyphoonSimPage from './modules/explore/TyphoonSimPage';
import ClimateSimPage from './modules/explore/ClimateSimPage';
import LeaguePage from './modules/league/LeaguePage';
import DuelPage from './modules/duel/DuelPage';
import ProgressPage from './modules/progress/ProgressPage';
import LoginPage from './modules/auth/LoginPage';
import RegisterPage from './modules/auth/RegisterPage';
import PlacementPage from './modules/onboarding/PlacementPage';
import DevPanel from './modules/dev/DevPanel';

/**
 * 라우팅 (04번 스펙 + R2-01 S7 + R3-01 S4 + R5-01 S4 + R7-01 S3) — react-router-dom v6, 하단 탭바.
 * R5-01: 기본 진입(/)은 학습 홈(CurriculumHome, 유닛 경로). 유닛 세션은 /learn/units/:unitId.
 * 자유 일일 세션(SessionPage)은 /daily로 병존 유지(§3.4).
 * 기존 "오늘의 퀴즈" 단일 문항 화면은 /quiz로 유지(하위 호환).
 * R3-01 §0 제품 결정: 기후 시뮬레이터(/simulator) 폐지 → 대기 보드 퍼즐(/board)로 대체.
 * detective(/detective)는 이번 라운드 제외(Phase 3 후순위)로 라우트 미등록.
 * R7-01 S3: 온보딩 배치고사(/onboarding/placement)는 인증 필요하되 Layout(탭바) 밖
 * 전체 화면 — 가입 직후 진입, 건너뛰기 가능.
 */
function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return (
    <>
      <Outlet />
      {/* R7-03 개발자 모드 플로팅 패널 — GET /dev/state 200일 때만 렌더(404=비활성) */}
      <DevPanel />
    </>
  );
}

function RedirectIfAuthed({ children }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (accessToken) return <Navigate to="/" replace />;
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
        <Route element={<Layout />}>
          <Route path="/" element={<CurriculumHome />} />
          <Route path="/learn/units/:unitId" element={<UnitSessionPage />} />
          <Route path="/daily" element={<SessionPage />} />
          <Route path="/quiz" element={<QuizPage />} />
          <Route path="/board" element={<BoardPage />} />
          {/* R9-01 §3.5: 탐구 시뮬 v1 — 순수 클라이언트 모듈(진입은 BoardPage 카드) */}
          <Route path="/explore" element={<ExploreHome />} />
          <Route path="/explore/typhoon" element={<TyphoonSimPage />} />
          <Route path="/explore/climate" element={<ClimateSimPage />} />
          <Route path="/duel" element={<DuelPage />} />
          <Route path="/league" element={<LeaguePage />} />
          <Route path="/me" element={<ProgressPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

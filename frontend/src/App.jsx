import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import SessionPage from './modules/session/SessionPage';
import QuizPage from './modules/quiz/QuizPage';
import SimulatorPage from './modules/simulator/SimulatorPage';
import LeaguePage from './modules/league/LeaguePage';
import LoginPage from './modules/auth/LoginPage';
import RegisterPage from './modules/auth/RegisterPage';

/**
 * 라우팅 (04번 스펙 + R2-01 S7) — react-router-dom v6, 하단 탭바 네비게이션.
 * 기본 진입(/)은 세션 플로우(SessionPage, 하루 1세션 5문항).
 * 기존 "오늘의 퀴즈" 단일 문항 화면은 /quiz로 유지(하위 호환).
 * detective(/detective)는 이번 라운드 제외(Phase 3 후순위)로 라우트 미등록.
 */
function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return <Outlet />;
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
        <Route element={<Layout />}>
          <Route path="/" element={<SessionPage />} />
          <Route path="/quiz" element={<QuizPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/league" element={<LeaguePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

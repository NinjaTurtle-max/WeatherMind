import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import QuizPage from './modules/quiz/QuizPage';
import SimulatorPage from './modules/simulator/SimulatorPage';
import LeaguePage from './modules/league/LeaguePage';
import LoginPage from './modules/auth/LoginPage';
import RegisterPage from './modules/auth/RegisterPage';

/**
 * 라우팅 (04번 스펙) — react-router-dom v6, 하단 탭바 네비게이션.
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
          <Route path="/" element={<QuizPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/league" element={<LeaguePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import XPBar from './XPBar';
import StreakBadge from './StreakBadge';
import CloudEnergyBadge from './CloudEnergyBadge';
import TabBar from './TabBar';
import { authApi, progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useProgressStore } from '../store/progressStore';

/**
 * 로그인 후 공통 레이아웃: 상단 고정 헤더(XPBar + StreakBadge) + 하단 탭바.
 * GET /progress/me 를 조회해 progressStore에 동기화한다.
 */
export default function Layout() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const logoutLocal = useAuthStore((s) => s.logout);
  const setProgress = useProgressStore((s) => s.setProgress);
  const resetProgress = useProgressStore((s) => s.reset);

  const { data: progress } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (progress) setProgress(progress);
  }, [progress, setProgress]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // 서버 로그아웃 실패해도 로컬 세션은 정리한다.
    }
    logoutLocal();
    resetProgress();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="fixed inset-x-0 top-0 z-50 bg-sky-900 shadow-md">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
          <span className="shrink-0 text-base font-extrabold tracking-tight text-white">
            ⛅ WeatherMind
          </span>
          <XPBar />
          <CloudEnergyBadge />
          <StreakBadge />
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 text-xs font-medium text-sky-200 hover:text-white"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 헤더/탭바 높이만큼 여백 확보 */}
      <main className="flex-1 px-4 pb-20 pt-16">
        <Outlet />
      </main>

      <TabBar />
    </div>
  );
}

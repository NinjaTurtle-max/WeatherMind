import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import XPBar from './XPBar';
import SpineBadge from './SpineBadge';
import StreakBadge from './StreakBadge';
import CloudEnergyBadge from './CloudEnergyBadge';
import TabBar from './TabBar';
import { authApi, progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useProgressStore } from '../store/progressStore';

/**
 * 로그인 후 공통 레이아웃: 상단 고정 헤더 + 하단 탭바.
 * GET /progress/me 를 조회해 progressStore에 동기화한다.
 * 헤더 진척 표시(R8-01 §3.7③ 제품 결정): 스파인(유닛 진도·왕관) 1순위 —
 * 로고 바로 옆 SpineBadge — 그리고 XPBar를 보상감으로 병기(교체 아님).
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
        {/* 항목이 7개라 max-w-xl(576px)에선 폭이 모자라 XP 텍스트가 구름 배지 위로
            넘친다. 데스크톱은 폭을 넓히고(PC 학습 경로도 이미 풀블리드), 모바일은
            로고 워드마크·XP 숫자를 접어 겹침 없이 들어가게 한다. */}
        <div className="mx-auto flex max-w-xl items-center gap-2 px-3 py-2.5 sm:px-4 md:max-w-3xl md:gap-3">
          <span className="shrink-0 text-base font-extrabold tracking-tight text-white">
            <span aria-hidden="true">⛅</span>
            <span className="ml-1 hidden md:inline">WeatherMind</span>
            <span className="sr-only md:hidden">WeatherMind</span>
          </span>
          <SpineBadge />
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

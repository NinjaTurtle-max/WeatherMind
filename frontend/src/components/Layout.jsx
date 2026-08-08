import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import XPBar from './XPBar';
import SpineBadge from './SpineBadge';
import StreakBadge from './StreakBadge';
import CloudEnergyBadge from './CloudEnergyBadge';
import LocaleSwitcher from './LocaleSwitcher';
import TabBar from './TabBar';
import SideNav from './SideNav';
import { useT } from '../i18n';
import { authApi, progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useProgressStore } from '../store/progressStore';
import { SESSION_STATUS, useSessionStore } from '../store/sessionStore';
import { useOnboardingGate } from '../lib/onboardingGate';

/**
 * 로그인 후 공통 레이아웃: 상단 고정 헤더 + 하단 탭바.
 * GET /progress/me 를 조회해 progressStore에 동기화한다.
 * 헤더 진척 표시(R8-01 §3.7③ 제품 결정): 스파인(유닛 진도·왕관) 1순위 —
 * 로고 바로 옆 SpineBadge — 그리고 XPBar를 보상감으로 병기(교체 아님).
 *
 * R10-01 §3.4 (S4 — R10-F): 점진적 잠금 해제의 관측 지점.
 * - /progress/me가 도착하면 온보딩 게이트를 1회 부트스트랩한다(기존 사용자 판정).
 * - 세션이 SUMMARY에 도달하면 "세션 1회 완료"로 센다. 배치고사는 Layout 밖
 *   전체 화면(App: /onboarding/placement)에서 돌고 응답에 placement_done이
 *   실려 오므로 이중으로 제외된다 — 진단은 세션 완료가 아니다.
 * - 새로 열린 탭은 1회성 축하 토스트로 알린다(§3.4).
 */
export default function Layout() {
  const navigate = useNavigate();
  const t = useT();
  // 넓은 컨테이너를 쓰는 화면(데스크톱) — 홈 대시보드와 학습 경로 둘 다 가로를
  // 넓게 쓴다. 페이지 쪽에서 100vw 음수 마진으로 컨테이너를 탈출하면 스크롤바
  // 폭만큼(100vw > clientWidth) 가로 스크롤이 생기므로, 폭은 레이아웃이 소유한다.
  const pathname = useLocation().pathname;
  // /board는 플레이가 3열(팔레트·지도·미션)이라 576px로는 가운데 열이 0으로 눌린다.
  // 한때 보드만 7xl로 한 단계 더 넓게 썼다(지도를 크게 쓰려고). 되돌렸다
  // (2026-08-07) — 헤더는 전 화면 고정 폭인데 본문만 넓어서, 보드에서만 제목·판이
  // 헤더 항목보다 40px 왼쪽에서 시작했다. 화면을 오갈 때 눈에 띄게 어긋난다.
  // 지도 열은 704 → 624px로 줄지만, 줄 맞는 쪽을 택했다(사용자 결정).
  const isBoard = pathname === '/board';
  // /explore는 시뮬 2종을 정사각으로 나란히 놓는다 — 576px 셸에서는 한 칸이
  // 264px까지 작아진다.
  // /duel은 브리핑(왼쪽) ↔ 근거·예측(오른쪽) 2열이라 576px에서는 한 열이
  // 264px — 시간별 기온 차트가 눌린다.
  // /league도 대시보드(위 3칸·아래 2칸)라 좁은 셸에서는 칸이 다 눌린다 —
  // 768px에서 닉네임이 "하."로 잘리고 티어 사다리 라벨이 "태풍…"이 됐다.
  const isWide =
    pathname === '/'
    || pathname === '/learn'
    || pathname === '/explore'
    || pathname === '/duel'
    || pathname === '/league'
    || pathname === '/me'
    || isBoard;
  const shellWidth = isWide ? 'md:max-w-6xl' : '';
  const accessToken = useAuthStore((s) => s.accessToken);
  const userKey = useAuthStore((s) => s.user?.user_id ?? null);
  const logoutLocal = useAuthStore((s) => s.logout);
  const setProgress = useProgressStore((s) => s.setProgress);
  const resetProgress = useProgressStore((s) => s.reset);

  const syncGate = useOnboardingGate((s) => s.syncFromProgress);
  const recordSessionComplete = useOnboardingGate((s) => s.recordSessionComplete);
  const resetGate = useOnboardingGate((s) => s.reset);
  const unlockToast = useOnboardingGate((s) => s.toast);
  const clearUnlockToast = useOnboardingGate((s) => s.clearToast);

  const sessionStatus = useSessionStore((s) => s.status);
  const sessionSummary = useSessionStore((s) => s.summary);
  const sessionId = useSessionStore((s) => s.sessionId);

  const { data: progress } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (progress) setProgress(progress);
  }, [progress, setProgress]);

  useEffect(() => {
    if (progress) syncGate(progress, userKey);
  }, [progress, userKey, syncGate]);

  // 세션 완료 집계(§3.4) — 완료 요약에 도달한 세션 id를 게이트에 기록(멱등).
  useEffect(() => {
    if (sessionStatus !== SESSION_STATUS.SUMMARY || !sessionSummary || !sessionId) return;
    if (sessionSummary.placement_done) return; // 배치고사는 세지 않는다
    recordSessionComplete(sessionId);
  }, [sessionStatus, sessionSummary, sessionId, recordSessionComplete]);

  useEffect(() => {
    if (!unlockToast) return undefined;
    const t = setTimeout(clearUnlockToast, 3200);
    return () => clearTimeout(t);
  }, [unlockToast, clearUnlockToast]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // 서버 로그아웃 실패해도 로컬 세션은 정리한다.
    }
    logoutLocal();
    resetProgress();
    resetGate(); // 다음 로그인 계정에서 다시 판정 — 계정 간 게이트 누출 방지
    navigate('/login', { replace: true });
  };

  return (
    <div className="md:pl-[208px]">
      <SideNav />
      <div className={`mx-auto flex min-h-screen max-w-xl flex-col ${shellWidth}`}>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white md:left-[208px]">
        {/* md↑에서 헤더를 사이드바 오른쪽부터 시작시킨다 — inset-x-0 그대로 두면
            헤더는 화면 전체 기준으로, 본문은 사이드바를 뺀 폭 기준으로 가운데
            정렬돼 좌우가 어긋난다. 브랜드는 사이드바 상단이 갖는다. */}
        {/* 항목이 7개라 max-w-xl(576px)에선 폭이 모자라 XP 텍스트가 구름 배지 위로
            넘친다. 데스크톱은 폭을 넓히고(넓은 화면에선 본문 컨테이너와 좌우를 맞춤),
            모바일은 로고 워드마크·XP 숫자를 접어 겹침 없이 들어가게 한다. */}
        {/* 헤더 폭은 **경로와 무관하게 고정**이다(2026-08-06). 본문 폭을 따라가게
            했더니 화면마다 헤더 항목이 좌우로 튀었다 — 실측 1440에서 홈·학습·
            대결 1152px, 보드 1232px, 리그·내 정보 768px로 셋이었고, 탭을 옮길
            때마다 XP 바와 로그아웃이 40~184px씩 이동했다. 헤더는 화면이 바뀌어도
            제자리에 있어야 하는 붙박이라, 홈 기준(6xl)으로 못 박는다.
            2026-08-07: 본문도 6xl로 맞췄다(보드만 7xl이던 예외 제거) — 이제
            헤더와 본문이 전 화면에서 같은 선에서 시작한다. 폭을 바꿀 일이 생기면
            **둘을 같이** 바꿀 것. 한쪽만 바꾸면 그 화면만 어긋난다. */}
        <div className="mx-auto flex max-w-xl items-center gap-2 px-3 py-2.5 sm:px-4 md:max-w-6xl md:gap-3">
          {/* 브랜드는 헤더에 두지 않는다 — PC는 사이드바가, 모바일은 탭바 「홈」이
              같은 자리를 이미 갖고 있다. 워드마크를 넣었더니 390px에서 로그아웃까지
              425px로 넘쳤다(실측). 진척·자원 배지에 폭을 준다. */}
          <SpineBadge />
          <XPBar />
          {/* 좌(진척) ↔ 우(자원·설정)를 갈라 놓는 여백. 이게 없으면 XPBar 상한을
              둔 뒤로 항목이 전부 왼쪽에 몰린다(1440에서 864px에서 끝났다). */}
          <div className="flex-1" />
          <CloudEnergyBadge />
          <StreakBadge />
          {/* 로케일 전환(§6.3) — header 안·nav 밖(gating 스모크가 탭바 항목 수를
              단정한다). compact = 버튼 1개 아이콘화로 R10 헤더 겹침 재발 방지. */}
          <LocaleSwitcher compact />
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            {t('nav.logout')}
          </button>
        </div>
      </header>

      {/* 잠금 해제 축하 토스트 (§3.4) — 1회성, 3.2초 후 자동 소멸 */}
      {unlockToast && (
        <div
          role="status"
          className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-lg"
        >
          {unlockToast}
        </div>
      )}

        {/* 헤더/탭바 높이만큼 여백 확보 — 탭바는 md↑에서 숨으므로 하단 여백을 줄인다 */}
        <main className="flex-1 px-4 pb-20 pt-16 md:pb-8">
          <Outlet />
        </main>

        <TabBar />
      </div>
    </div>
  );
}

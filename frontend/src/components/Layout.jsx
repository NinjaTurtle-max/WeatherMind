import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import XPBar from './XPBar';
import SpineBadge from './SpineBadge';
import StreakBadge from './StreakBadge';
import CloudEnergyBadge from './CloudEnergyBadge';
import LocaleSwitcher from './LocaleSwitcher';
import TabBar from './TabBar';
import SideNav from './SideNav';
import GuideBot from './GuideBot';
import { useT } from '../i18n';
import { authApi, progressApi } from '../api';
import { isGuestUser } from '../modules/auth/guest';
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
  const t = useT();
  // 넓은 컨테이너를 쓰는 화면(데스크톱) — 홈 대시보드와 학습 경로 둘 다 가로를
  // 넓게 쓴다. 페이지 쪽에서 100vw 음수 마진으로 컨테이너를 탈출하면 스크롤바
  // 폭만큼(100vw > clientWidth) 가로 스크롤이 생기므로, 폭은 레이아웃이 소유한다.
  const pathname = useLocation().pathname;
  // /board는 플레이가 넓은 배치(문제 배너 + 조작 / 관찰 2열 — 2026-08-11 개편 전에는
  // 팔레트·지도·미션 3열이었다)라 576px로는 지도 열이 0으로 눌린다.
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
    // CO-S-10: `/explore`만 있어서 `/explore/typhoon`·`/explore/climate`는 목록에
    // 없었다 — 카드를 누르는 순간 본문이 1152 → 576px로 접혔다. 하위 경로까지 본다.
    || pathname.startsWith('/explore')
    || pathname === '/duel'
    || pathname === '/league'
    || pathname === '/me'
    // 세션도 2열이 됐다(2026-08-11 사용자 지시 — 왼쪽 문항 / 오른쪽 정답·해설).
    // 576px에서는 한 열이 264px라 보기 4개짜리 문항이 다 접힌다.
    // 자유 일일 세션(`/daily`)이 여기 함께 있었는데 라우트가 제거됐다
    // (2026-08-12) — 이제 같은 SessionRunner를 쓰는 것은 유닛 세션뿐이다.
    || pathname.startsWith('/learn/units/')
    || isBoard;
  const shellWidth = isWide ? 'md:max-w-6xl' : '';
  const accessToken = useAuthStore((s) => s.accessToken);
  const userKey = useAuthStore((s) => s.user?.user_id ?? null);
  const setProgress = useProgressStore((s) => s.setProgress);

  const syncGate = useOnboardingGate((s) => s.syncFromProgress);
  const recordSessionComplete = useOnboardingGate((s) => s.recordSessionComplete);

  const sessionStatus = useSessionStore((s) => s.status);
  const sessionSummary = useSessionStore((s) => s.summary);
  const sessionId = useSessionStore((s) => s.sessionId);

  const { data: progress } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });

  // 안내봇용 에너지 — **CloudEnergyBadge와 같은 쿼리 키**라 react-query가 합쳐
  // 준다(네트워크 호출이 늘지 않는다). 키나 queryFn을 여기서 바꾸면 그 순간
  // 같은 값을 두 번 받아 오게 되므로 배지 쪽과 짝을 맞춰 둘 것.
  const { data: energy } = useQuery({
    queryKey: ['progress', 'energy'],
    queryFn: progressApi.fetchEnergy,
    enabled: Boolean(accessToken),
    staleTime: 10_000,
  });

  // 안내봇이 채점 결과에 반응한다 — 화자는 **FEEDBACK 단계에서만** 말한다.
  // answerState를 그대로 읽으면 다음 문항으로 넘어간 뒤에도 직전 정오답이 남아
  // 안내봇이 한 박자 늦게 떠든다(retryItem이 answerState를 비우기는 하지만
  // 요약·이탈 경로는 안 비운다). 단계로 한 번 더 거른다.
  const answerState = useSessionStore((s) => s.answerState);
  const lastAnswerCorrect =
    sessionStatus === SESSION_STATUS.FEEDBACK && typeof answerState?.is_correct === 'boolean'
      ? answerState.is_correct
      : undefined;

  // 세션 완료 — **요약에 막 도달한 잠깐만**.
  //
  // ⚠️ `status === SUMMARY`를 그대로 쓰면 안 된다. SUMMARY는 sessionStore에서
  // **종착 상태**라 그것을 벗어나는 유일한 writer가 `reset()`이고, 그건 다음 세션을
  // 열 때 SessionRunner의 마운트 effect에서만 불린다. Layout(=GuideBot)은 언마운트되지
  // 않으므로, 유닛 하나 끝내고 /board나 /me로 가면 **다음 세션을 열 때까지 모든
  // 화면에서 "오늘 치 끝!"이 떠 있는다**. 코드 리뷰가 잡았다.
  const [sessionComplete, setSessionComplete] = useState(false);
  useEffect(() => {
    if (sessionStatus !== SESSION_STATUS.SUMMARY) return undefined;
    setSessionComplete(true);
    const timer = setTimeout(() => setSessionComplete(false), 8000);
    return () => clearTimeout(timer);
  }, [sessionStatus]);

  // 레벨업 — `/progress/me`의 knowledge_level이 **올라간 순간**에만 참이다.
  // 서버가 "올랐다"를 안 알려 주므로 직전 값과 비교한다. 첫 조회(prev가 null)는
  // 레벨업이 아니다 — 그러지 않으면 로그인할 때마다 축하가 뜬다.
  const prevLevelRef = useRef(null);
  const [levelUp, setLevelUp] = useState(false);
  useEffect(() => {
    const level = progress?.knowledge_level;
    if (typeof level !== 'number') return;
    const prev = prevLevelRef.current;
    prevLevelRef.current = level;
    if (prev == null || level <= prev) return;
    setLevelUp(true);
    // 축하는 잠깐이면 된다 — 계속 띄우면 다음 화면 안내를 영영 가린다.
    const timer = setTimeout(() => setLevelUp(false), 8000);
    return () => clearTimeout(timer);
  }, [progress?.knowledge_level]);

  // 첫 방문 인사는 한 번만. localStorage는 SSR에서 못 읽으므로 effect에서만 만진다
  // (첫 페인트에는 화면 안내가 뜨고, 처음 온 사람에게만 인사로 바뀐다).
  // ⚠️ **인사는 반드시 스스로 꺼져야 한다.** firstVisit은 상태 규칙이고 상태 규칙은
  // 전부 화면 규칙을 이기므로, 안 끄면 첫 세션 내내 어느 화면에서든 "안녕! 나는
  // 구름이예요"만 반복되고 **화면별 안내가 영영 안 뜬다**. 규정상 로그인 없이
  // 열려야 해서 **심사위원은 전원 새 브라우저 = 전원 첫 방문자**다 — 그들이 보는
  // 것이 정확히 그 화면이 된다. 바로 위 levelUp이 같은 이유로 타이머를 갖는다.
  // 코드 리뷰가 잡았다.
  const [firstVisit, setFirstVisit] = useState(false);
  useEffect(() => {
    let timer;
    try {
      if (!window.localStorage?.getItem('weathermind.guidebot.seen')) {
        setFirstVisit(true);
        window.localStorage?.setItem('weathermind.guidebot.seen', '1');
        // 인사는 한 번, 잠깐. 그 뒤로는 화면별 안내가 자리를 넘겨받는다.
        timer = setTimeout(() => setFirstVisit(false), 8000);
      }
    } catch {
      /* 프라이빗 모드 — 인사를 매번 하게 되지만 기능은 산다 */
    }
    return () => clearTimeout(timer);
  }, []);

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


  /**
   * **로그아웃은 없다**(2026-08-12 클라이언트 지시 — 로그인·회원가입 구조 전면 제거).
   *
   * 없앤 것이 기능이 아니라 **막다른 길**이라는 점을 적어 둔다. 게스트 비밀번호는
   * 무작위 시크릿이라 재진입 경로가 존재하지 않는다 — 게스트에게 로그아웃은
   * 「진도 영구 소실」 버튼이었고(CO-P-4가 확인 1단을 붙인 이유가 그것이다),
   * 로그인 화면이 사라진 지금은 정식 계정에게도 돌아올 문이 없다.
   * 그래서 버튼·확인 모달·`doLogout`을 통째로 걷어냈다.
   *
   * 계정 전환(`/account/convert`)은 **남는다** — 진도를 지우는 길이 아니라
   * 지키는 길이고, 로그인 화면과 무관하게 성립한다.
   *
   * 게스트 판별(`isGuest`)은 계정 전환 배너가 계속 쓰므로 아래에 그대로 둔다.
   */
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: Boolean(accessToken),
    staleTime: 60_000,
    retry: false,
  });
  const storeUser = useAuthStore((s) => s.user);
  const isGuest = me ? me.is_guest === true : isGuestUser(storeUser);

  return (
    <div className="wm-shell pl-[var(--wm-shell-left)]">
      <SideNav />
      <div className={`mx-auto flex min-h-screen max-w-xl flex-col ${shellWidth}`}>
      <header className="fixed right-0 top-0 z-50 border-b border-slate-200 bg-white left-[var(--wm-shell-left)]">
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
        </div>
      </header>

{/* 잠금 해제 축하 토스트(§3.4)는 **걷어냈다** (CO-N-1 ③, 2026-08-08).
          FeatureUnlockGate가 사라져 보드·예보 대결·리그가 처음부터 열려 있으므로
          "🧩 대기 보드가 열렸어요!"는 일어나지 않은 일을 알리는 문구가 된다.
          토스트를 만드는 쪽(onboardingGate.recordSessionComplete)은 그대로 두고
          렌더만 끊는다 — 그 모듈은 일일 목표 선택지도 함께 소유한다.

          ⚠️ **되살릴 때는 `left-[calc(50%_+_var(--wm-shell-left)/2)]`를 쓸 것.**
          `left-1/2`는 화면 폭의 절반이고 본문은 사이드바를 뺀 나머지의 가운데라
          토스트만 왼쪽으로 밀린다(main #44에서 토스트 5개가 같은 이유로 고쳐졌다):
            본문 중심 = S + (W - S)/2 = W/2 + S/2   (S = 사이드바 폭)
          더할 값은 화면 폭과 무관하게 **항상 S/2**다. S를 상수로 박지 않는 이유는
          styles/index.css의 `--wm-shell-left` 주석 참고 — 사이드바 없는 라우트에서
          반대로 틀린다. */}

        {/* 헤더/탭바 높이만큼 여백 확보 — 탭바는 md↑에서 숨으므로 하단 여백을 줄인다 */}
        <main className="flex-1 px-4 pb-20 pt-16 md:pb-8">
          {/* 위치 안내(`RegionOnboardingNotice`)는 **여기서 걷었다**(2026-08-13
              클라이언트 지시 ⑴ — 「가로로 눕는 두 노드를 오른쪽 세로 열로」).
              본문 맨 위를 가로로 덮던 자리라 학습 경로보다 먼저 눈에 들어왔다.
              새 소유자는 `modules/curriculum/LearnFooterCards.jsx`이고, 그 열에서
              자기가 설명하는 지역 칩(`learn-region`) **바로 위**에 선다.
              ⚠️ **되돌릴 때 알아 둘 것**: 여기 있던 시절의 근거는 "라우트마다 다시
              붙이지 않고 레이아웃이 한 번만 소유한다 — 딥링크로 들어와도 보인다"
              였다. 오른쪽 열은 `/learn`에만 있으므로 그 보증은 사라졌다(딥링크로
              `/board`에 내린 사람은 위치 안내를 못 본다). 이것은 지시에 따른
              **의도된 축소**이지 누락이 아니다 — 전 라우트 노출이 다시 필요해지면
              레이아웃이 아니라 제품 결정으로 다룰 것. 컴포넌트 자체의 비차단
              계약(모달 아님)은 `onboardingSave.contract` ⑤가 위치와 무관하게 문다. */}
          <Outlet />
        </main>

        <TabBar />
      </div>

      {/* 안내봇(MT-26) — 셸 최상위에 둔다. 본문 안에 넣으면 화면마다 마운트가
          풀려 사용자가 옮겨 둔 자리와 접어 둔 상태가 이동할 때마다 되돌아간다.
          말할 내용은 lib/guideRules.js가 정한다(결정적 · LLM 호출 없음). */}
      <GuideBot
        pathname={pathname}
        state={{
          clouds: energy?.clouds,
          levelUp,
          sessionComplete,
          lastAnswerCorrect,
          firstVisit,
        }}
      />

    </div>
  );
}

import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import client from './api/client';
import { authApi } from './api';
import { translate, getCurrentLocale } from './i18n/core.js';
import LoadingSpinner from './components/LoadingSpinner';
import Layout from './components/Layout';
import CurriculumHome from './modules/curriculum/CurriculumHome';
import UnitSessionPage from './modules/curriculum/UnitSessionPage';
import BoardPage from './modules/board/BoardPage';
import ExploreHome from './modules/explore/ExploreHome';
import TyphoonSimPage from './modules/explore/TyphoonSimPage';
import ClimateSimPage from './modules/explore/ClimateSimPage';
import SandboxPage from './modules/explore/SandboxPage';
import DetectiveRoutes from './modules/detective/DetectiveRoutes';
import LeaguePage from './modules/league/LeaguePage';
import DuelPage from './modules/duel/DuelPage';
import ProgressPage from './modules/progress/ProgressPage';
import ConvertAccountPage from './modules/auth/ConvertAccountPage';
import PlacementPage from './modules/onboarding/PlacementPage';
import EntryInfoPage from './modules/onboarding/EntryInfoPage';

// R7-03 개발자 패널 — 런타임 게이트(GET /dev/state 404=비활성)는 유지하되,
// lazy 코드 스플릿으로 메인 번들에서 분리 (compose 스택의 빌드 프론트에서도 동작)
const DevPanel = lazy(() => import('./modules/dev/DevPanel'));

/**
 * 라우팅 (04번 스펙 + R2-01 S7 + R3-01 S4 + R5-01 S4 + R7-01 S3) — react-router-dom v6, 하단 탭바.
 * R5-01: 기본 진입(/)은 학습 홈이었다. 2026-08-05에 /는 홈 대시보드, /learn은 학습
 * 경로로 갈렸다가, **2026-08-09에 다시 하나로 합쳤다**(사용자 지시) — 홈 화면은
 * 삭제되고 /는 /learn(CurriculumHome)으로 리다이렉트한다. 홈이 갖고 있던 진입
 * 카드·오늘의 목표는 학습 화면 오른쪽 진입 카드(LearnHeroCard)가 흡수했고,
 * 출석 POST 소유자도 CurriculumHome으로 넘어왔다. 유닛 세션은 /learn/units/:unitId.
 *
 * **자유 일일 세션(`/daily`)은 제거됐다**(2026-08-12 클라이언트 지시). 학습(유닛)
 * 세션이 오늘 날씨를 직접 받는 쪽으로 바뀌면서, 같은 일을 하는 입구가 둘일 이유가
 * 없어졌다 — 「오늘 몫」과 「경로 진도」가 갈라져 있던 것을 하나로 합친 셈이다.
 * ⚠️ `SessionPage.jsx` 파일 자체는 **남는다**: 배치고사·유닛 세션이 같은
 * `SessionRunner`를 공유하고, 여러 렌더 테스트가 SessionPage를 직접 마운트한다.
 * 끊은 것은 라우트뿐이다.
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
 * 도착한다.
 *
 * **2026-08-12부터 이것이 유일한 진입이다** — 로그인·회원가입 화면이 제거되면서
 * 「명시적 게스트 CTA를 눌러 배치고사로」 가던 종전 대안 동선도 함께 사라졌다.
 *
 * ⚠️ ~~**그래서 배치고사로 보내는 UI 동선이 지금 없다.**~~ **해소됐다
 * (2026-08-13 클라이언트 지시 ⑵ — 「배치고사는 접속시 내 정보 입력창 이후로,
 * 이전에 회원가입 후 바로 나타나던 것처럼」).** 사라진 것은 가입 화면이었고,
 * 그 화면이 갖고 있던 두 가지 일 — **학령을 묻는 것**과 **직후 진단으로 보내는
 * 것** — 을 `EntryInfoPage`(첫 접속 정보 입력)가 이어받는다. 진입 동선은
 * 이제 **접속(`/`) → 정보 입력 → 배치고사 → 학습**이다.
 *
 * ⚠️ **게이트는 `/` 하나에만 건다**(아래 `AT_ENTRY`). 딥링크(`/explore`·`/board`·
 * `/onboarding/placement`…)는 종전 그대로 **아무 조작 없이** 자동 발급으로
 * 통과한다 — 규정 「로그인 없이 열려야」의 가장 강한 형태를 딥링크에서는
 * 유지하고, 맨 URL로 들어온 첫 접속에서만 한 화면을 끼운다(그마저도 건너뛸 수
 * 있다). 이 경계가 `onboardingGating` 시나리오 10·11과 `placementEntry`
 * 시나리오 1이 각각 무는 지점이다.
 *
 * 중복 발급 방지가 이 모듈 스코프 두 변수의 전부다:
 *   - `guestAttempted`: **한 번 시도했으면 다시 시도하지 않는다.** 실패 시 무한
 *     재시도를 막는다. 종전에는 "**로그아웃**을 막는다"가 더 큰 이유라고 적혀
 *     있었는데 로그아웃 버튼이 없어졌다 — 다만 토큰이 지워지는 경로는 남아 있다
 *     (`api/client.js`의 401 인터셉터가 `authStore.logout()`을 부른다). 그때
 *     조용히 새 게스트를 발급하면 만료가 계정 교체로 둔갑하므로 규칙은 그대로다.
 *   - `guestPromise`: StrictMode 이중 마운트·동시 렌더가 한 요청을 공유한다.
 */
let guestAttempted = false; // 이 페이지 로드에서 이미 시도했는가(또는 토큰을 본 적 있는가)
let guestSettled = false; // 그 시도가 끝났는가(성공이면 토큰이 다음 화면)
let guestPromise = null; // StrictMode 이중 실행·동시 렌더가 공유하는 단일 요청
// **발급 실패를 따로 표시한다**(MT-29, 2026-08-12). 원래 이 플래그는 실패와
// 로그아웃을 가르려고 만들었다 — 로그아웃은 본인이 한 일이라 로그인 화면이 맞고
// 발급 실패는 네트워크 사고라 재시도가 맞는데, 종전에는 둘 다 /login으로 보내서
// 규정이 "로그인 없이 열려야 한다"고 요구하는 바로 그 화면을 연결이 나쁜
// 심사위원에게 보여 줬다. 같은 날 로그인 화면이 통째로 제거되면서 **두 분기의
// 도착지가 같아졌지만**(둘 다 재시도), 플래그는 남긴다: 실패는 안내 문구가 다르고
// (「연결을 확인하세요」) 실패 분기가 먼저 잡혀야 그 문구가 산다.
let guestFailed = false;

/** 테스트 전용 — 다음 진입에서 자동 발급을 다시 시도할 수 있게 되돌린다. */
export function resetGuestAutoIssue() {
  guestAttempted = false;
  guestSettled = false;
  guestPromise = null;
  guestFailed = false;
}

/**
 * 게스트 발급 — **학령을 바디에 싣는다**(2026-08-13 요구 ⑶).
 *
 * 종전에는 `client.post('/auth/guest')`로 바디가 없었다. 서버는
 * `POST /auth/guest {level_group?}`를 이미 받는데(routers/auth.py `guest_login` —
 * "바디는 선택이다 — 없으면 level_group=middle_high") **프론트가 그 문을 안 써서
 * 모든 게스트가 `middle_high`로 시작**했다. 「초등인데 중등이 나온다」의 뿌리다.
 *
 * ⚠️ 값은 서버 `LevelGroup` Literal 3종뿐이다 — 밖의 값은 422라 발급이 실패하고
 * 사용자가 재시도 화면에 갇힌다. 고르지 않았으면(`null`) **바디를 아예 보내지
 * 않는다**: `{level_group: null}`은 pydantic이 거부하고, 무엇보다 "안 고름"의
 * 서버 표현은 필드 부재다(하위 호환 — 건너뛰면 지금과 같은 기본값).
 */
function issueGuestOnce(levelGroup = null) {
  if (!guestPromise) {
    guestPromise = client
      .post('/auth/guest', levelGroup ? { level_group: levelGroup } : undefined)
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

/**
 * 게스트 발급 실패 화면 — **로그인 폼을 보여주지 않는다**(MT-29).
 *
 * 대회 규정이 요구하는 것은 "로그인 없이 열린다"이고, 연결이 잠깐 나빴다는 이유로
 * 그 보증이 깨지면 안 된다. 여기서 할 일은 다시 시도하는 것이지 계정을 만드는
 * 것이 아니다.
 *
 * ⚠️ 여기에 "계정이 이미 있는 사람(R10-J로 전환한 사용자)을 위한 통로를 아래에
 * 작게 남긴다"고 적혀 있었으나 **그런 통로는 없다**(2026-08-12 정정). 로그인
 * 화면이 제거되면서 링크의 목적지 자체가 사라졌다. 전환한 사용자가 다른 기기에서
 * 다시 들어올 방법은 현재 **없다** — 이것은 알려진 공백이고, 지금 서비스가
 * 기기 1대에 묶인 게스트 진도를 전제로 선다는 뜻이다. 되살릴 때는 이 화면이
 * 아니라 제품 결정으로 다룰 것.
 */
function GuestIssueRetry({ onRetry }) {
  const locale = getCurrentLocale();
  return (
    <div className="mx-auto mt-24 max-w-sm px-6 text-center">
      <p className="text-4xl" aria-hidden="true">☁️</p>
      <h1 className="mt-3 text-lg font-extrabold text-slate-800">
        {translate(locale, 'auth.login.guestFailedTitle')}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {translate(locale, 'auth.login.guestFailedBody')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700"
      >
        {translate(locale, 'auth.login.guestFailedRetry')}
      </button>
    </div>
  );
}

/**
 * 정보 입력 게이트가 걸리는 경로 — **맨 URL로 들어온 첫 접속 하나뿐**이다.
 *
 * `/learn`을 넣지 않는 이유가 계약이다: `placementEntry` 시나리오 1-b가
 * `/learn`·`/me`에서 진단 진입점을 찾고, `onboardingSave`·`home` 스모크가
 * `/learn`을 직접 마운트한다 — 그 경로를 가로채면 "이미 들어와 있는 사람"의
 * 화면까지 바뀐다. 게이트는 **토큰이 아직 없을 때만** 뜨므로(아래 조건),
 * 이 기기에서 한 번 열어 본 사람에게는 두 번 다시 보이지 않는다
 * (`authStore`가 토큰을 localStorage에 persist한다).
 */
const AT_ENTRY = '/';

function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();
  const atEntry = useLocation().pathname === AT_ENTRY;
  const [, bump] = useState(0); // 모듈 스코프 플래그가 바뀐 뒤 한 번 다시 그린다
  // ⚠️ **재시도는 effect 의존성에 있어야 한다.** `bump`만 올리면 리렌더는 되지만
  // `[accessToken]`이 그대로(null)라 발급 effect가 다시 안 돈다 — 재시도 화면이
  // 영구 스피너로 바뀌고 사용자가 갇힌다. MT-29가 막으려던 결과 그 자체다.
  const [retryTick, setRetryTick] = useState(0);
  /**
   * 첫 접속 정보 입력의 결과 — 발급 바디에 실릴 값이다.
   *   `undefined` 아직 안 정함(= 화면을 보여줄 차례)
   *   `null`      건너뜀 → 바디 없이 발급(서버 기본값 `middle_high`, 하위 호환)
   *   문자열      고른 학령 → `POST /auth/guest {level_group}`
   * ⚠️ **모듈 스코프가 아니라 컴포넌트 상태**다. `RequireAuth`는 레이아웃 라우트라
   * 자식 라우트가 바뀌어도 언마운트되지 않으므로, 정보 입력 → 배치고사로 넘어가는
   * 동안 값이 살아 있다. 모듈 스코프로 두면 상태 변경이 리렌더를 못 일으켜
   * 화면이 그대로 멈춘다.
   */
  const [entryChoice, setEntryChoice] = useState(undefined);
  const needsEntryInfo = atEntry && entryChoice === undefined;

  useEffect(() => {
    // 토큰을 한 번이라도 본 순간 "시도 완료"로 못박는다 — 이후 **로그아웃으로
    // 토큰이 지워져도 새 게스트를 발급하지 않는다**(로그아웃이 안 되는 회귀 방지).
    if (accessToken) {
      guestAttempted = true;
      guestSettled = true;
      return;
    }
    if (guestAttempted) return;
    // 첫 접속 정보 입력이 **발급보다 먼저**다 — 학령이 발급 바디에 실려야 하므로
    // 여기서 기다리지 않으면 요구 ⑶이 성립할 수 없다(발급은 한 번뿐이다).
    if (needsEntryInfo) return;
    guestAttempted = true;
    issueGuestOnce(entryChoice ?? null).then((ok) => {
      guestSettled = true;
      guestFailed = !ok;
      bump((n) => n + 1);
    });
  }, [accessToken, retryTick, needsEntryInfo, entryChoice]);

  /**
   * 정보 입력 완료 — 고른 값을 상태에 싣고 **먼저 라우팅한다**.
   *
   * ⚠️ 순서가 계약이다. 발급을 여기서 직접 부르고 그 `.then`에서 이동하면
   * R9-09와 같은 경합이 된다(토큰 등장이 일으킨 렌더가 목적지를 덮어쓴다).
   * 대신 **경로를 먼저 바꾸고** 발급은 위 effect에 맡긴다 — 토큰이 생기는 순간
   * 이미 배치고사 라우트에 서 있으므로 어느 쪽이 먼저 끝나도 도착지가 같다.
   */
  const finishEntryInfo = (level) => {
    setEntryChoice(level ?? null);
    // 이미 발급된 뒤라면(경합·되돌아온 진입) 발급 바디가 아니라 갱신 통로를 쓴다 —
    // `PATCH /auth/me`가 학령 writer의 나머지 절반이다(R13 CO-P-5, `/me`의 학습
    // 수준 카드가 쓰는 바로 그 API). 지금 게이트 조건상 거의 닿지 않는 가지지만,
    // 닿았을 때 값이 조용히 버려지는 것보다 낫다.
    if (level && useAuthStore.getState().accessToken) {
      authApi.updateLevelGroup(level).catch(() => {});
    }
    if (level) navigate('/onboarding/placement', { replace: true });
  };

  if (!accessToken) {
    // 발급이 **실패**했다 → 재시도 화면. 로그인 폼이 아니다(MT-29).
    if (guestFailed) {
      return (
        <GuestIssueRetry
          onRetry={() => {
            resetGuestAutoIssue();
            setRetryTick((n) => n + 1); // effect 의존성 — 이것이 실제 재시도를 일으킨다
          }}
        />
      );
    }
    // 시도가 끝났고 실패도 아닌 상태(옛 로그아웃 경로)도 재시도로 받는다.
    // **로그인 화면이 없어졌으므로 보낼 곳이 없다**(2026-08-12 클라이언트 지시:
    // 로그인·회원가입 구조 전면 제거). 토큰이 없는 이유가 무엇이든 학습자가
    // 할 수 있는 일은 다시 여는 것 하나뿐이다.
    if (guestSettled) {
      return (
        <GuestIssueRetry
          onRetry={() => {
            resetGuestAutoIssue();
            setRetryTick((n) => n + 1);
          }}
        />
      );
    }
    // 첫 접속 정보 입력 (요구 ⑵⑶) — **발급 실패·정착 분기보다 뒤**다. 앞에 두면
    // 토큰이 지워진 사람(401 인터셉터)이 재시도 화면 대신 정보 입력을 다시 본다.
    if (needsEntryInfo) return <EntryInfoPage onSubmit={finishEntryInfo} />;
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

// `RedirectIfAuthed`는 로그인·가입 화면과 함께 제거됐다(2026-08-12 클라이언트
// 지시). "이미 로그인한 사람이 로그인 화면에 오면 돌려보낸다"는 컴포넌트라
// 그 화면이 없으면 존재 이유가 없다. `authStore.postAuthRoute`는 계정 전환
// (`/account/convert`)이 여전히 쓰므로 스토어에는 남는다.

export default function App() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        {/* 온보딩 배치고사 — 탭바 없는 전체 화면(Layout 밖) */}
        <Route path="/onboarding/placement" element={<PlacementPage />} />
        {/* R11-01 웨이브 2 (R10-J): 게스트 → 정식 계정 전환 — 배치고사와 같은
            전체 화면 관례(Layout 밖). 진입은 GuestSaveBanner(학습 홈)에서. */}
        <Route path="/account/convert" element={<ConvertAccountPage />} />
        <Route element={<Layout />}>
          {/* 2026-08-09: 홈 화면을 지우고 학습 하나로 합쳤다(사용자 지시).
              `/`는 남기되 **리다이렉트**다 — 지우면 북마크·외부 링크·로그인 직후
              기본 착지가 전부 죽는다(로그인 성공 경로가 `/`로 보낸다).
              2026-08-05에 `/`(홈)와 `/learn`(경로)을 갈랐던 것을 되돌린 셈이다. */}
          <Route path="/" element={<Navigate to="/learn" replace />} />
          <Route path="/learn" element={<CurriculumHome />} />
          <Route path="/learn/units/:unitId" element={<UnitSessionPage />} />
          <Route path="/board" element={<BoardPage />} />
          {/* R9-01 §3.5: 탐구 시뮬 v1 — 순수 클라이언트 모듈. 진입은 BoardPage 카드
              **와 내비 「탐구」 탭**(CO-N-1 ②, 2026-08-08). */}
          <Route path="/explore" element={<ExploreHome />} />
          <Route path="/explore/typhoon" element={<TyphoonSimPage />} />
          <Route path="/explore/climate" element={<ClimateSimPage />} />
          {/* 자유 실험 — 2026-08-10에 보드에서 옮겨 왔다(사용자 지시).
              판은 여전히 AtmosphereBoard지만 입구는 탐구다. */}
          <Route path="/explore/sandbox" element={<SandboxPage />} />
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

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
import LoadProgressPage from './modules/auth/LoadProgressPage';
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
/**
 * 실패의 **종류**를 들고 있는다 — `guestFailed`(참/거짓)만으로는 못 가르는 하나가 있다.
 *
 * 🔴 **`NICKNAME_TAKEN`만 특별하다.** 나머지 실패(네트워크·5xx·422…)는 학습자가
 * 할 수 있는 일이 「다시 열기」뿐이라 재시도 화면이 맞다. 그런데 닉네임 중복은
 * **학습자가 고칠 수 있는 유일한 실패**다 — 이름만 바꾸면 된다. 재시도 화면으로
 * 보내면 같은 이름으로 다시 시도해 또 막히거나(무한), 이름이 일회성이라 조용히
 * 지워진 채 성공한다(**자기 이름의 증발** — 대장 §4.16).
 *
 * ⚠️ **이 분기를 넓히지 말 것.** `NICKNAME_TAKEN` 하나만 정보 입력 화면으로
 * 되돌리고 나머지는 전부 `GuestIssueRetry`다. 느슨하게 하면 **MT-29가 고친 결함
 * (발급 실패를 폼으로 보내는 것)이 그대로 재발**하고, 그것이 규정이 요구하는
 * 「로그인 없이 열려야」를 연결 나쁜 심사위원에게서 깨뜨린다.
 * `backend/tests/test_r13_mock_policy_parity.py`의 계약 ③이 그 회귀를 문다.
 */
let guestErrorCode = null;

/**
 * 다음 진입에서 자동 발급을 다시 시도할 수 있게 되돌린다.
 *
 * 소비처는 둘이다: 테스트 하네스와 **만료 화면의 「새로 시작하기」**. 후자가
 * 있으므로 `authStore.hadAccount`도 함께 지운다 — 그것이 남아 있으면 아래
 * `RequireAuth`가 계속 만료 화면을 띄워 버튼이 아무 일도 안 하는 것처럼 보인다.
 * 「새로 시작하기」는 학습자가 옛 계정을 포기한다고 명시한 순간이라, 그 한
 * 지점에서만 기억을 지우는 것이 맞다.
 */
export function resetGuestAutoIssue() {
  guestAttempted = false;
  guestSettled = false;
  guestPromise = null;
  guestFailed = false;
  guestErrorCode = null;
  useAuthStore.getState().forgetAccount();
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
function issueGuestOnce(levelGroup = null, nickname = null) {
  if (!guestPromise) {
    // 바디는 **실어 보낼 것이 있을 때만** 만든다. 빈 객체를 보내도 서버는 받지만,
    // 「아무것도 안 골랐다」의 서버 표현이 **필드 부재**라 그 의미를 흐리지 않는다.
    const body = {};
    if (levelGroup) body.level_group = levelGroup;
    // 빈 문자열은 안 보낸다 — 서버가 `min_length=1`이라 422가 되고, 학습자는
    // 「이름을 안 적었다」가 아니라 **발급 실패 화면**을 보게 된다.
    if (nickname && nickname.trim()) body.nickname = nickname.trim();

    guestPromise = client
      .post('/auth/guest', Object.keys(body).length > 0 ? body : undefined)
      .then(({ data }) => {
        const store = useAuthStore.getState();
        // 🔴 **그 사이에 다른 통로로 토큰이 생겼으면 덮지 않는다.** 「진도
        // 불러오기」(`/login`)는 토큰 없이 열리므로(아래 `AT_LOAD_PROGRESS`)
        // 이 발급과 **동시에** 진행될 수 있다. 발급이 느리게 성공하면 방금
        // 복구한 계정 토큰을 게스트 토큰이 덮어써, 학습자가 로그인에 성공하고도
        // 빈 게스트로 떨어진다. 늦게 온 발급분은 버리는 쪽이 항상 옳다 —
        // 사용자가 명시적으로 만든 세션이 자동 발급보다 우선한다.
        if (store.accessToken) return true;
        store.setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token });
        // 학습자가 이름을 적었으면 **그 이름을 화면에 쓴다** — 서버가 그것으로
        // 계정을 만들었는데 화면만 「게스트」로 부르면 두 소유자가 갈린다.
        store.setUser({
          nickname:
            body.nickname ?? translate(getCurrentLocale(), 'auth.login.guestNickname'),
          is_guest: true,
        });
        return true;
      })
      .catch((err) => {
        // `client.js`가 `{detail, code}`를 `ApiError`로 정규화한다 — 여기서 종류를
        // 잃으면 위 `guestErrorCode` 주석의 「이름 증발」이 그대로 일어난다.
        guestErrorCode = err?.code ?? 'UNKNOWN_ERROR';
        return false;
      });
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
    // ⚠️ `data-testid`는 장식이 아니다 — `entryFlow` ⑨-c가
    // `$('[data-testid="guest-issue-retry"]') === null`로 「중복이 재시도 화면으로
    // 새지 않았다」를 단정하는데, **이 속성이 없어서 그 단정이 공허하게 통과**하고
    // 있었다(2026-08-14 발견). 붙이는 순간 그 계약이 실제로 물기 시작한다.
    <div data-testid="guest-issue-retry" className="mx-auto mt-24 max-w-sm px-6 text-center">
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
 * 세션 만료 화면 — **발급 실패(`GuestIssueRetry`)와 다른 상황이고, 다르게 받는다.**
 *
 * 🔴 여기 오는 조건이 곧 결함의 설명이다: `guestSettled`가 참인데 토큰이 없다 =
 * **토큰을 한 번 봤고 그 뒤 지워졌다**(401 인터셉터 → `authStore.logout()`).
 * 즉 이 사람에게는 **서버에 계정과 진도가 이미 있다.** 종전에는 이 분기가
 * `GuestIssueRetry`를 그대로 재사용했고, 그 「다시 시도」 버튼이
 * `resetGuestAutoIssue()`를 불러 **새 게스트를 발급**했다 — 게스트 비밀번호는
 * 무작위 시크릿이라 옛 계정으로 돌아갈 방법이 없다. 「다시 시도」라고 적힌
 * 버튼이 실제로는 **계정 교체**였고, 모듈 스코프 주석(:85)이 "조용히 새 게스트를
 * 발급하면 만료가 계정 교체로 둔갑한다"고 금지한 바로 그 일이다.
 *
 * 그래서 자동으로 아무것도 하지 않고 **묻는다**:
 *   ⑴ 진도 불러오기(`/login` = `LoadProgressPage`) — 진도를 저장해 둔 사람
 *   ⑵ 새로 시작하기 — 결과를 적어 두고 **누른 사람에게만** 새 게스트를 발급
 *
 * ⚠️ MT-29·`LoadProgressPage` 계약 ③(「발급 실패 폴백을 로그인 화면으로 되돌리지
 * 않는다」)과 충돌하지 않는다 — 그 계약이 막는 것은 **발급 실패**(위 `guestFailed`
 * 분기)이고 그쪽은 손대지 않았다. 연결 나쁜 심사위원은 계정 화면을 보지 않는다.
 * 여기는 토큰을 가진 적이 있어야만 닿는 분기라 첫 접속에서는 절대 뜨지 않는다.
 */
function SessionExpired({ onStartFresh }) {
  const locale = getCurrentLocale();
  const navigate = useNavigate();
  return (
    <div data-testid="session-expired" className="mx-auto mt-24 max-w-sm px-6 text-center">
      <p className="text-4xl" aria-hidden="true">🔑</p>
      <h1 className="mt-3 text-lg font-extrabold text-slate-800">
        {translate(locale, 'auth.login.expiredTitle')}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {translate(locale, 'auth.login.expiredBody')}
      </p>
      <button
        type="button"
        data-testid="session-expired-load"
        onClick={() => navigate(AT_LOAD_PROGRESS)}
        className="mt-5 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700"
      >
        {translate(locale, 'auth.login.expiredLoad')}
      </button>
      <button
        type="button"
        data-testid="session-expired-fresh"
        onClick={onStartFresh}
        className="mt-2 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-extrabold text-slate-600 hover:bg-slate-200"
      >
        {translate(locale, 'auth.login.expiredFresh')}
      </button>
      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
        {translate(locale, 'auth.login.expiredFreshNote')}
      </p>
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

/**
 * 진도 불러오기 경로 — **토큰 게이트를 통과시키는 유일한 예외다.**
 *
 * 이 화면은 「토큰을 되찾는 곳」이라 토큰을 요구하면 **필요한 사람만 정확히
 * 막힌다**(`LoadProgressPage` 독스트링이 "인증 가드를 씌우지 말 것"이라 적은
 * 것과 같은 함정이고, 그 가드가 라우터 층에 있다는 것만 다르다). 만료 화면
 * (`SessionExpired`)의 「진도 불러오기」 버튼이 여기로 보내는데, 게이트가
 * 그대로면 그 버튼이 만료 화면으로 되돌아와 무한 루프가 된다.
 *
 * 값은 `App`의 `<Route path="/login">`과 **같아야** 한다 — 갈리면 버튼이 조용히
 * 죽는다. `onboardingSave.contract`의 ㉮가 이 문자열의 존재로 「돌아올 문이
 * 있는가」를 판정한다.
 */
const AT_LOAD_PROGRESS = '/login';

function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  /**
   * 🔴 **새로고침을 건너는 만료 판정** — 모듈 스코프 플래그로는 못 한다.
   *
   * `guestSettled`는 이 페이지 로드에서만 산다. 401 인터셉터가 토큰을 지운 뒤
   * 학습자가 새로고침하면 플래그가 초기화돼 「첫 방문자」와 구분이 안 되고,
   * 만료 안내 대신 **새 게스트가 조용히 발급**된다 — 이 파일이 막으려는 계정
   * 교체가 가장 흔한 사용자 행동 하나로 되살아난다. persist되는
   * `hadAccount`(`store/authStore.js`)가 그 구분을 갖고 있다.
   */
  const hadAccount = useAuthStore((s) => s.hadAccount);
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const atEntry = pathname === AT_ENTRY;
  const atLoadProgress = pathname === AT_LOAD_PROGRESS;
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
  /**
   * 학습자가 적은 이름 — **`entryChoice`와 함께 발급 바디로 간다.**
   *
   * ⚠️ 종전에는 이 값이 `EntryInfoPage` 안의 **모듈 스코프 axios 인터셉터**로
   * 발급 요청에 얹혔다. 담당이 `App.jsx`를 소유 밖으로 받아 우회한 것인데,
   * 그 우회로는 **409를 화면으로 되돌릴 수가 없다** — 인터셉터는 요청만 알고
   * 응답의 종류를 화면에 알릴 통로가 없다. 여기로 올려 배선을 하나로 만든다.
   */
  const [entryNickname, setEntryNickname] = useState('');
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
    // 🔴 **이 기기에 계정이 있었으면 자동 발급하지 않는다.** 새로고침으로
    // 모듈 플래그가 초기화돼도 여기서 멈춘다 — 아래 렌더가 만료 안내를 띄우고,
    // 「새로 시작하기」가 `forgetAccount()`로 이 조건을 풀 때만 발급이 돈다.
    if (hadAccount) return;
    // 첫 접속 정보 입력이 **발급보다 먼저**다 — 학령이 발급 바디에 실려야 하므로
    // 여기서 기다리지 않으면 요구 ⑶이 성립할 수 없다(발급은 한 번뿐이다).
    if (needsEntryInfo) return;
    guestAttempted = true;
    issueGuestOnce(entryChoice ?? null, entryNickname).then((ok) => {
      guestSettled = true;
      guestFailed = !ok;
      // 🔴 **이름이 겹쳤을 때만** 정보 입력 화면으로 되돌린다 — 학습자가 고칠 수
      //    있는 유일한 실패다. 나머지 실패는 아래 `guestFailed` 분기가 재시도
      //    화면으로 받는다(MT-29 계약 ③ — 실패를 폼으로 보내지 않는다).
      // ⚠️ **`guestAttempted`도 함께 되돌려야 한다.** 안 그러면 위 `if
      //    (guestAttempted) return`에 걸려 **다시 적어도 발급이 안 일어나고**
      //    화면이 멈춘다(재시도가 effect 의존성에 있어야 한다는 계약과 같은 뿌리).
      if (!ok && guestErrorCode === 'NICKNAME_TAKEN') {
        guestAttempted = false;
        guestSettled = false;
        guestPromise = null;
        guestFailed = false;
        setEntryChoice(undefined);
        // 「다음」을 눌렀으면 이미 배치고사 라우트에 서 있다 — 진입으로 돌려놔야
        // `needsEntryInfo`(= `atEntry && …`)가 참이 되어 화면이 다시 뜬다.
        navigate(AT_ENTRY, { replace: true });
      }
      bump((n) => n + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `hadAccount`가 의존성에 있어야 「새로 시작하기」가 실제 발급을 일으킨다
    // (`forgetAccount()` → false 전이가 이 effect를 다시 돌린다).
  }, [accessToken, retryTick, needsEntryInfo, entryChoice, hadAccount]);

  /**
   * 정보 입력 완료 — 고른 값을 상태에 싣고 **먼저 라우팅한다**.
   *
   * ⚠️ 순서가 계약이다. 발급을 여기서 직접 부르고 그 `.then`에서 이동하면
   * R9-09와 같은 경합이 된다(토큰 등장이 일으킨 렌더가 목적지를 덮어쓴다).
   * 대신 **경로를 먼저 바꾸고** 발급은 위 effect에 맡긴다 — 토큰이 생기는 순간
   * 이미 배치고사 라우트에 서 있으므로 어느 쪽이 먼저 끝나도 도착지가 같다.
   */
  const finishEntryInfo = ({ level = null, nickname = '' } = {}) => {
    setEntryChoice(level ?? null);
    // 이름은 **상태로** 받는다 — 종전 인터셉터 우회는 응답의 종류를 화면에
    // 알릴 통로가 없어 409에서 이름이 조용히 증발했다(대장 §4.16).
    setEntryNickname(nickname ?? '');
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
    // 진도 불러오기만 토큰 없이 통과한다(위 `AT_LOAD_PROGRESS`) — 토큰을 되찾는
    // 화면이라 토큰을 요구하면 자기 목적을 스스로 막는다. 자동 발급 effect는
    // 위에서 그대로 돌므로, 첫 접속이 이 경로로 딥링크해도 게스트는 발급된다
    // (그때는 토큰이 생겨 이 분기 자체를 안 탄다).
    if (atLoadProgress) return <Outlet />;
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
    // 시도가 끝났고 실패도 아닌 상태 = **토큰을 봤는데 지워졌다**(401 인터셉터).
    // 이 사람에게는 서버에 계정이 이미 있으므로 **새 게스트를 자동 발급하지
    // 않는다** — 종전에는 여기가 `GuestIssueRetry`를 재사용해 「다시 시도」가
    // 곧 계정 교체였다(`SessionExpired` 독스트링). 이제 선택을 묻고,
    // 「새로 시작하기」를 누른 사람에게만 발급이 일어난다.
    // ⚠️ 2026-08-12 지시로 로그인 화면이 없던 시절의 주석("보낼 곳이 없다")은
    //    낡았다 — 8/14에 `/login`(진도 불러오기)이 되살아났다.
    // `guestSettled`(이 로드에서 토큰을 봤다) **또는** `hadAccount`(예전 로드에서
    // 봤다 — persist) 어느 쪽이든 계정이 있었다는 뜻이다. 뒤엣것이 없으면
    // 새로고침 한 번으로 이 화면이 사라진다.
    if (guestSettled || hadAccount) {
      return (
        <SessionExpired
          onStartFresh={() => {
            resetGuestAutoIssue();
            setRetryTick((n) => n + 1); // effect 의존성 — 이것이 실제 발급을 일으킨다
          }}
        />
      );
    }
    // 첫 접속 정보 입력 (요구 ⑵⑶) — **발급 실패·정착 분기보다 뒤**다. 앞에 두면
    // 토큰이 지워진 사람(401 인터셉터)이 재시도 화면 대신 정보 입력을 다시 본다.
    // ⚠️ **이름이 겹쳐 되돌아온 경우를 함께 넘긴다.** 되돌리기만 하고 이유를 안
    //    주면 학습자는 「왜 처음 화면으로 왔지」만 겪는다 — 적어 둔 이름을 그대로
    //    다시 채워 주고(`nickname`) 무엇이 문제였는지 말한다(`nicknameTaken`).
    if (needsEntryInfo) {
      return (
        <EntryInfoPage
          onSubmit={finishEntryInfo}
          nickname={entryNickname}
          nicknameTaken={guestErrorCode === 'NICKNAME_TAKEN'}
        />
      );
    }
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
        {/* 진도 불러오기 (2026-08-14 클라이언트 결정 ⓑ) — 전환(`/account/convert`)의
            **짝**이라 같은 전체 화면 관례를 쓴다.
            ⚠️ **경로 이름은 `/login`을 그대로 쓴다.** 더 예쁜 이름을 붙일 수 있지만
            URL은 렌더되는 텍스트가 아니라 규정(화면에 로그인 문구 없음)과 무관하고,
            `onboardingSave.contract`의 ㉮가 **이 문자열의 존재**로 「돌아올 문이
            있는가」를 판정한다. 이름을 바꾸면 그 계약의 조건부터 고쳐야 한다.
            ⚠️ **인증 가드(`RedirectIfAuthed` 류)를 씌우지 말 것.** 지금은 모든
            방문자가 게스트 토큰을 들고 있어서(위 `RequireAuth`가 발급한다), 그런
            가드는 **이 화면이 필요한 사람만 정확히 막는다.** 그 컴포넌트는 8/12에
            제거됐고 되살릴 이유가 없다(위 :288 주석).
            ⚠️ 진입 링크는 **「진도 저장」 카드 한 줄뿐**이다 — 주 동선(SideNav·
            TabBar·헤더)에 넣지 않는다(MT-29 계약, 대장 §4.14). */}
        <Route path="/login" element={<LoadProgressPage />} />
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

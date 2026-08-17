import { Link, useLocation } from 'react-router-dom';
// Mascot import는 걷었다(2026-08-17) — 튜터 카드가 사라지면서 이 파일에
// 그리는 캐릭터가 없어졌다. 배정표(`TUTOR_BY_PATH`)는 이름만 들고 있고
// 그리는 것은 각 배너와 `GuideBot`이다.
import { NAV_ITEMS, isNavActive } from './navItems';
import { useT } from '../i18n';

/**
 * 좌측 사이드바 — PC(md↑) 전용. 시안 `Soft Cloud 홈`의 사이드바 구현이다.
 *
 * 모바일에서는 하단 `TabBar`가 같은 목록(`navItems.js`)을 보여준다. 둘을 동시에
 * 띄우면 같은 6개가 위아래로 중복돼 어느 쪽을 눌러야 하는지 헷갈리므로,
 * **뷰포트별로 하나만** 보인다(여기 `hidden md:flex` ↔ TabBar `md:hidden`).
 *
 * ⚠️ CSS로 숨겨도 **DOM에는 남는다.** 내비 요소를 문서 전체에서 세는 테스트는
 * 탭바/사이드바를 구분해 세야 한다(`data-testid`) — 실제로 gating 스모크가
 * `nav a, nav button` 전체 개수를 단정하고 있어 함께 고쳤다.
 *
 * 아래 `TUTOR_BY_PATH`는 **화면별 담당 마스코트 배정표**다 — 보드 태양이 ·
 * 학습 물방울이 · 예보 태풍이 · 탐구 번개 · 리그 눈송이. 화면마다 안내하는
 * 캐릭터가 바뀌는 것이 이 표의 뜻이다.
 * ⚠️ **이 파일은 더 이상 그것을 그리지 않는다**(2026-08-17 — 아래 렌더부 주석).
 * 표는 각 화면의 배너가 하드코딩한 마스코트와 대조되는 **기준**으로만 남는다.
 */
const TUTOR_BY_PATH = [
  { match: (p) => p === '/board' || p.startsWith('/board/'), name: 'sun', key: 'board' },
  // `/learn` 자신도 넣는다(2026-08-12). 종전에는 하위 경로만 있어서 학습 홈은
  // **폴백**(구름이)으로 떨어졌다 — 그 화면은 튜터를 접으니 눈에 안 띄었을 뿐,
  // 담당표가 "이 화면 담당은 누구인가"의 소유자라면 비어 있으면 안 된다.
  // 값은 LearnHeroCard가 그리는 물방울이(learnEntry.ENTRY_MASCOT)와 같다.
  //
  // 자유 일일 세션(/daily) 행은 **제거됐다**(2026-08-12 — 라우트 폐지, main).
  // 그 행이 있던 이유(같은 화면에서 튜터와 정답/해설 말풍선의 화자가 갈리면 안
  // 된다)는 유효하지만, 이제 학습 세션은 `/learn/units/…` 하나뿐이라 아래 한
  // 행이 그 몫을 전부 받는다. 세션 라우트가 또 늘면 여기에 행을 더할 것.
  { match: (p) => p === '/learn' || p.startsWith('/learn/'), name: 'drop', key: 'learn' },
  { match: (p) => p === '/duel' || p.startsWith('/duel/'), name: 'typhoon', key: 'duel' },
  // 탐구 — **번개**(2026-08-17 사용자 지시. 2026-08-12에 구름이로 명시했던
  // 것을 바꿨다). 같은 날 잠깐 리그와 겹쳤다가, 리그가 눈송이가 되면서 풀렸다.
  { match: (p) => p === '/explore' || p.startsWith('/explore/'), name: 'bolt', key: 'explore' },
  // 리그 — **눈송이**(2026-08-17 사용자 지시 "기상 리그도 예보랑 똑같이 튜터
  // 카드가 있었으면, 눈결정으로"). 리그가 배너를 갖게 된 것이 같은 지시다.
  { match: (p) => p === '/league' || p.startsWith('/league/'), name: 'snow', key: 'league' },
];

export default function SideNav() {
  const t = useT();
  const pathname = useLocation().pathname;
  return (
    <aside
      data-testid="sidenav"
      className="fixed inset-y-0 left-0 z-50 hidden w-[var(--wm-shell-left)] flex-col gap-5 overflow-y-auto border-r border-slate-200 bg-sky-50 px-3.5 pb-4 pt-4 md:flex"
    >
      <Link
        to="/learn"
        className="flex items-center gap-2 rounded-lg px-2 py-0.5 text-[15px] font-extrabold text-sky-900"
      >
        <span aria-hidden="true">⛅</span>WeatherMind
      </Link>

      <nav aria-label={t('nav.primary')} className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            // ⚠️ NavLink를 쓰지 않는다(2026-08-11 코드 리뷰). NavLink의
            // `aria-current`는 **자기 판정**을 따르는데 색은 isNavActive가
            // 칠하므로, /league에서 「예보 대결」이 켜져 보이는데 읽어 주는
            // 현재 위치는 아무 데도 없는 어긋남이 난다. 판정을 하나로 둔다.
            aria-current={isNavActive(item, pathname) ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-bold transition ${
              isNavActive(item, pathname)
                ? 'bg-white text-sky-700 shadow-[0_1px_2px_rgba(12,44,66,0.07)]'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="w-[18px] text-center" aria-hidden="true">
              {item.icon}
            </span>
            {t(item.labelKey)}
          </Link>
        ))}
      </nav>

      {/* 🔴 **사이드바 튜터 카드는 걷혔다**(2026-08-17 사용자 지시).
          말하는 캐릭터를 `GuideBot` 하나로 통일하고, 그 자리(왼쪽 하단)를
          GuideBot이 물려받는다.

          걷은 이유가 위 주석들이 세 번 반복해 온 그것이다 — **한 화면에 튜터가
          둘**. 배너를 세운 4개 화면(`/learn`·`/board`·`/explore`·`/duel`)만
          `HERO_PATHS`로 카드를 접고 있었는데, 나머지 화면(`/me`·`/league`·
          `/learn/units/…`·`/board/{id}`·`/explore/typhoon`…)에서는 **이 카드와
          GuideBot이 나란히** 떠 있었다. 화면마다 접었다 폈다 하는 표를 늘리는
          대신 카드를 없앤다 — 그래서 `HERO_PATHS`도 함께 사라졌다(더 이상
          접을 것이 없다).

          ⚠️ 위 `TUTOR_BY_PATH`는 **남는다.** 이제 렌더 입력이 아니라
          「어느 화면을 어느 캐릭터가 맡는가」의 **단일 배정표**이고, 배너들이
          각자 하드코딩한 마스코트가 그 표와 어긋나지 않는지를
          `tests/mascotAssets.contract.test.mjs` ④가 대조한다. 표를 지우면 그
          대조의 기준이 사라진다.
          ⚠️ `nav.tutor.*.name`·`.line` 리소스도 이 카드가 마지막 소비처였다.
          지우지 않은 것은 배정표의 사람이 읽는 절반이고 카드를 되살릴 때
          그대로 필요하기 때문이다 — 되살릴 계획이 없어지면 그때 함께 걷을 것. */}
    </aside>
  );
}

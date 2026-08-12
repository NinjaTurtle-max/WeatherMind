import { Link, useLocation } from 'react-router-dom';
import Mascot from './Mascot';
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
 * 튜터는 **지금 있는 화면의 담당 마스코트**다(`Mascot.jsx` 배정표). 기본은 메인
 * 튜터인 구름이고, 보드에서는 태양이, 학습에서는 물방울이, 예보 대결에서는
 * 태풍이, 리그에서는 번개가 나온다 — 화면마다 안내하는 캐릭터가 바뀌는 것이
 * 배정표의 뜻이다.
 *
 * 학습 화면 우측 레일에도 물방울이 카드가 있었는데 걷어냈다(2026-08-05) —
 * 같은 캐릭터가 한 화면에 둘 뜨면 어느 쪽이 말하는 건지 알 수 없다.
 */
// 학습 화면(/learn)은 **튜터를 접는다**(2026-08-09). 홈을 흡수하면서 오른쪽
// 진입 카드가 물방울이를 104px로 그리는데, 사이드바가 같은 캐릭터를 74px로 한 번
// 더 그리면 한 화면에 같은 그림이 둘이라 어느 쪽이 말하는 건지 알 수 없다
// (이 파일 머리말이 2026-08-05에 반대 방향으로 같은 판단을 했다 — 그때는 레일
// 카드를 걷었고, 이번에는 레일이 이겼다).
// 유닛 플레이(/learn/units/…)는 진입 카드가 없는 화면이라 튜터가 남는다.
const TUTOR_BY_PATH = [
  { match: (p) => p === '/board' || p.startsWith('/board/'), name: 'sun', key: 'board' },
  // `/learn` 자신도 넣는다(2026-08-12). 종전에는 하위 경로만 있어서 학습 홈은
  // **폴백**(구름이)으로 떨어졌다 — 그 화면은 튜터를 접으니 눈에 안 띄었을 뿐,
  // 담당표가 "이 화면 담당은 누구인가"의 소유자라면 비어 있으면 안 된다.
  // 값은 LearnHeroCard가 그리는 물방울이(learnEntry.ENTRY_MASCOT)와 같다.
  { match: (p) => p === '/learn' || p.startsWith('/learn/'), name: 'drop', key: 'learn' },
  // 자유 일일 세션(/daily)도 **물방울이**다(2026-08-11 코드 리뷰). 표에 없어서
  // 폴백(구름이)이 떴는데, 같은 화면의 정답/해설 말풍선은 물방울이라
  // 한 화면에 말하는 사람이 둘이었다 — 이번 변경이 없애려던 바로 그 어긋남이다.
  // key는 learn을 함께 쓴다(같은 학습 세션 튜터 — 문구를 두 벌로 만들지 않는다).
  { match: (p) => p === '/daily' || p.startsWith('/daily/'), name: 'drop', key: 'learn' },
  { match: (p) => p === '/duel' || p.startsWith('/duel/'), name: 'typhoon', key: 'duel' },
  // 탐구 — 구름이(2026-08-12 사용자 지시). 표에 없어서 **폴백**으로 구름이가
  // 뜨고 있었는데, 폴백은 "담당이 정해졌다"가 아니라 "모르겠다"다. 그 화면에
  // 배너를 세우려면 담당이 명시돼야 한다(배너와 사이드바가 같은 표를 봐야
  // 한 화면에 둘이 안 뜬다).
  { match: (p) => p === '/explore' || p.startsWith('/explore/'), name: 'cloud', key: 'explore' },
  { match: (p) => p === '/league' || p.startsWith('/league/'), name: 'bolt', key: 'league' },
];

export default function SideNav() {
  const t = useT();
  const pathname = useLocation().pathname;
  const tutor = TUTOR_BY_PATH.find((r) => r.match(pathname));
  // 학습 홈에서는 튜터 카드를 통째로 내린다(위 주석).
  // 끝의 슬래시를 떼고 본다 — `/learn/`도 라우터가 같은 화면을 그리는데
  // 정확히 '/learn'만 보던 탓에 그 URL에서 사이드바 튜터와 배너 마스코트가
  // 함께 떴다(이 분기가 막으려던 바로 그 중복. 2026-08-09 코드 리뷰).
  // 화면 안에 **같은 캐릭터를 그리는 배너**가 있으면 사이드바 튜터를 접는다.
  //   /learn  진입 배너가 물방울이를 그린다(2026-08-09)
  //   /board  태양이 튜터 배너가 생겼다(2026-08-11) — 안 접으면 사이드바 74px
  //           태양이와 배너 62px 태양이가 한 화면에 둘, 각자 다른 말을 한다.
  // 끝의 슬래시를 떼고 본다 — `/learn/`도 라우터가 같은 화면을 그리는데 정확히
  // '/learn'만 보던 탓에 그 URL에서 둘이 함께 떴다(2026-08-09 코드 리뷰).
  // ⚠️ 하위 경로는 접지 않는다: /learn/units·/board/{id}는 배너가 없는 화면이라
  // 튜터가 남아야 한다.
  //   /explore·/duel  2026-08-12에 상단 배너가 생겼다(사용자 지시) — 탐구
  //           구름이 · 예보 태풍이. 배너를 세운 화면은 반드시 여기 넣을 것.
  //           하위 경로는 여기서도 안 접는다: 시뮬 화면(/explore/typhoon 등)은
  //           ExploreHome이 아니라 각자 페이지라 배너가 없다.
  const HERO_PATHS = ['/learn', '/board', '/explore', '/duel'];
  const hideTutor = HERO_PATHS.includes(pathname.replace(/\/+$/, ''));
  const mascot = tutor?.name ?? 'cloud';
  const nameKey = tutor ? `nav.tutor.${tutor.key}.name` : 'home.tutor.name';
  const lineKey = tutor ? `nav.tutor.${tutor.key}.line` : 'home.tutor.line';
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

      {!hideTutor && (
      <div className="mt-auto rounded-2xl border border-slate-200 bg-white p-3 text-center">
        {/* 정사각 박스 — 폭만 주면 세로가 원본 비율을 따라가 캐릭터마다 카드
            높이가 달라지고(가로형 cloud 43px ↔ 세로형 bolt 123px) 화면을 옮길
            때마다 사이드바 아래가 들썩인다. */}
        <Mascot name={mascot} className="mx-auto h-[74px] w-[74px]" />
        <p className="mt-1.5 text-[12.5px] font-extrabold text-slate-800">{t(nameKey)}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{t(lineKey)}</p>
      </div>
      )}
    </aside>
  );
}

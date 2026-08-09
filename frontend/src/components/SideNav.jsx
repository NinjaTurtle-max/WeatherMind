import { Link, NavLink, useLocation } from 'react-router-dom';
import Mascot from './Mascot';
import { NAV_ITEMS } from './navItems';
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
  { match: (p) => p.startsWith('/learn/'), name: 'drop', key: 'learn' },
  { match: (p) => p === '/duel' || p.startsWith('/duel/'), name: 'typhoon', key: 'duel' },
  { match: (p) => p === '/league' || p.startsWith('/league/'), name: 'bolt', key: 'league' },
];

export default function SideNav() {
  const t = useT();
  const pathname = useLocation().pathname;
  const tutor = TUTOR_BY_PATH.find((r) => r.match(pathname));
  // 학습 홈에서는 튜터 카드를 통째로 내린다(위 주석).
  const hideTutor = pathname === '/learn';
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
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-bold transition ${
                isActive
                  ? 'bg-white text-sky-700 shadow-[0_1px_2px_rgba(12,44,66,0.07)]'
                  : 'text-slate-500 hover:text-slate-900'
              }`
            }
          >
            <span className="w-[18px] text-center" aria-hidden="true">
              {item.icon}
            </span>
            {t(item.labelKey)}
          </NavLink>
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

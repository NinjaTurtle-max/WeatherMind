import { Link, NavLink } from 'react-router-dom';
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
 * 튜터는 메인 튜터인 구름이다(`Mascot.jsx` 배정표). 학습 경로 화면의 물방울이는
 * 유닛별 안내라 역할이 다르다 — 같은 화면에 둘이 떠도 중복이 아니다.
 */
export default function SideNav() {
  const t = useT();
  return (
    <aside
      data-testid="sidenav"
      className="fixed inset-y-0 left-0 z-50 hidden w-[208px] flex-col gap-5 overflow-y-auto border-r border-slate-200 bg-sky-50 px-3.5 pb-4 pt-4 md:flex"
    >
      <Link
        to="/"
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

      <div className="mt-auto rounded-2xl border border-slate-200 bg-white p-3 text-center">
        <Mascot name="cloud" className="mx-auto w-[74px]" />
        <p className="mt-1.5 text-[12.5px] font-extrabold text-slate-800">{t('home.tutor.name')}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{t('home.tutor.line')}</p>
      </div>
    </aside>
  );
}

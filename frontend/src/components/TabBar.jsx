import { NavLink } from 'react-router-dom';

/**
 * 하단 탭바 네비게이션 (04번 스펙 — 모바일 대응)
 * detective 모듈은 이번 라운드 제외(Phase 3)라 탭에 노출하지 않는다.
 */
const TABS = [
  { to: '/', label: '오늘의 세션', icon: '🌤️', end: true },
  { to: '/simulator', label: '시뮬레이터', icon: '🌡️' },
  { to: '/league', label: '기상 리그', icon: '🏆' },
];

export default function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-sky-600' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

import { NavLink } from 'react-router-dom';
import { useT } from '../i18n';

/**
 * 하단 탭바 네비게이션 (04번 스펙 — 모바일 대응)
 * R3-01 S4: 시뮬레이터 탭 폐지 → 대기 보드 퍼즐 탭으로 교체.
 * R5-01 S4: 기본 진입(/)을 학습 홈(커리큘럼)으로 교체. 자유 일일 세션(/daily)은
 * 학습 홈의 별도 진입 카드로 접근한다(탭 과밀 방지).
 *
 * R10-01 §3.4 (S4 — R10-F) 클라이언트 판정 정정(2026-08-01):
 * **탭을 자물쇠로 막지 않는다.** 아직 열리지 않은 기능도 탭은 그대로 눌러 들어갈
 * 수 있고, 목적지에서 "무엇인지 · 왜 좋은지 · 언제 열리는지 · 열려면 뭘 하면
 * 되는지"를 보여준다(FeatureUnlockGate). 잠금은 차단이 아니라 동기 부여 화면이다.
 * 따라서 이 컴포넌트는 게이트 상태를 알지 않는다 — 탭바는 항상 5탭 활성.
 */
const TABS = [
  { to: '/', labelKey: 'nav.learn', icon: '🎓', end: true },
  { to: '/board', labelKey: 'nav.board', icon: '🧩' },
  { to: '/duel', labelKey: 'nav.duel', icon: '🌡️' },
  { to: '/league', labelKey: 'nav.league', icon: '🏆' },
  { to: '/me', labelKey: 'nav.me', icon: '🏅' },
];

export default function TabBar() {
  const t = useT();
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
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

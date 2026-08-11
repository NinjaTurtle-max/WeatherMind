import { Link, useLocation } from 'react-router-dom';
import { NAV_ITEMS, isNavActive } from './navItems';
import { useT } from '../i18n';

/**
 * 하단 탭바 네비게이션 (04번 스펙 — 모바일 대응)
 * R3-01 S4: 시뮬레이터 탭 폐지 → 대기 보드 퍼즐 탭으로 교체.
 * R5-01 S4: 기본 진입(/)을 학습 홈(커리큘럼)으로 교체. 자유 일일 세션(/daily)은
 * 학습 홈의 별도 진입 카드로 접근한다(탭 과밀 방지).
 *
 * 2026-08-05: 홈 대시보드가 생기면서 `/`는 홈, 학습 경로는 `/learn`으로 갈렸다.
 * 항목 목록은 `navItems.js` 단일 소유 — PC 사이드바(SideNav)와 같은 값을 쓴다.
 * **PC(md↑)에서는 이 탭바가 숨는다**(사이드바와 중복이라).
 *
 * R10-01 §3.4 (S4 — R10-F) 클라이언트 판정 정정(2026-08-01):
 * **탭을 자물쇠로 막지 않는다.** 아직 열리지 않은 기능도 탭은 그대로 눌러 들어갈
 * 수 있고, 목적지에서 "무엇인지 · 왜 좋은지 · 언제 열리는지 · 열려면 뭘 하면
 * 되는지"를 보여준다(FeatureUnlockGate). 잠금은 차단이 아니라 동기 부여 화면이다.
 * 따라서 이 컴포넌트는 게이트 상태를 알지 않는다 — 탭은 항상 전부 활성.
 */
export default function TabBar() {
  const t = useT();
  // 선택 표시는 navItems가 정한다 — 합친 화면의
  // 둘째 탭(/league)에서 아무 항목도 안 켜지는 것을 막는다(2026-08-11).
  const pathname = useLocation().pathname;
  return (
    <nav
      data-testid="tabbar"
      aria-label={t('nav.primary')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-xl">
        {NAV_ITEMS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            // 색과 aria-current를 **같은 판정**으로 (SideNav와 같은 이유).
            aria-current={isNavActive(tab, pathname) ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              isNavActive(tab, pathname) ? 'text-sky-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {tab.icon}
            </span>
            {t(tab.labelKey)}
          </Link>
        ))}
      </div>
    </nav>
  );
}

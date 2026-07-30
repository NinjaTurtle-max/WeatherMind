import { Link } from 'react-router-dom';
import { useProgressStore } from '../store/progressStore';

/**
 * SpineBadge (R8-01 §3.7③) — 헤더 1순위 진척 표시: 스파인(유닛 n/m · 왕관).
 * 제품 결정(§1): 홈 최상위 진척은 "유닛 진척 + XP 병기" — 이 배지가 1순위,
 * XPBar는 보상감으로 병기(제거 금지). GET /progress/me의 spine(§3.3)을
 * progressStore 경유로 읽으며, spine 부재(구 백엔드) 시 렌더하지 않는다.
 * 탭하면 학습 홈(/)으로 이동한다.
 */
export default function SpineBadge() {
  const spine = useProgressStore((s) => s.spine);
  if (!spine) return null;

  return (
    <Link
      to="/"
      title={`유닛 ${spine.units_cleared}/${spine.units_total} 클리어 · 왕관 ${spine.crowns_earned}/${spine.crowns_total}`}
      className="flex shrink-0 items-center gap-1 rounded-full bg-sky-950/50 px-2 py-0.5 text-xs font-bold text-white transition hover:bg-sky-950/70"
    >
      <span aria-hidden="true">🎓</span>
      <span className="tabular-nums">
        {spine.units_cleared}/{spine.units_total}
      </span>
      <span className="text-amber-300 tabular-nums" aria-label="왕관">
        👑{spine.crowns_earned}
      </span>
    </Link>
  );
}

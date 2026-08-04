import { tierMeta } from '../lib/tierMeta';
import { useT } from '../i18n';

/**
 * TierBadge (R4-01 §3.2) — 리그 티어(구름 5단계) 배지 칩.
 * 리더보드 행·프로필·정산 이력에서 공유한다.
 *
 * props:
 *   - tier: 티어 코드 (stratus|cumulus|nimbostratus|cumulonimbus|typhoon_eye). 없으면 층운.
 *   - size: 'sm' | 'md' (기본 sm)
 *   - showIcon: 아이콘 표시 여부 (기본 true)
 */
export default function TierBadge({ tier, size = 'sm', showIcon = true }) {
  // meta.label(티어명)은 lib/tierMeta의 리소스 파생 getter(tier.name.*) — 아래
  // useT() 구독이 로케일 전환 리렌더를 보장하므로 접근 시점 로케일로 풀린다(§6.3).
  const meta = tierMeta(tier);
  const t = useT();
  const sizeClass = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ring-1 ${meta.chip} ${sizeClass}`}
      title={t('tier.title', { label: meta.label })}
    >
      {showIcon && <span aria-hidden="true">{meta.icon}</span>}
      {meta.label}
    </span>
  );
}

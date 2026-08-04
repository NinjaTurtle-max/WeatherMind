import { useProgressStore } from '../store/progressStore';
import { useT } from '../i18n';

/**
 * StreakBadge (04번 스펙) — 스트릭 숫자 + 불꽃 아이콘
 * R11-01 §3 D: i18n 파일럿 1건 — 문자열은 i18n 리소스(streak.*)에서 온다.
 */
export default function StreakBadge() {
  const streakCount = useProgressStore((s) => s.streakCount);
  const t = useT();

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-sm font-bold text-orange-600"
      title={t('streak.title', { count: streakCount })}
    >
      <span aria-hidden="true">🔥</span>
      {streakCount}
      {/* 최협폭(360px 등)에선 헤더가 넘쳐 단위 표기를 접는다 — title에 전체 문구가 남는다 */}
      <span className="hidden text-xs font-medium text-orange-500 sm:inline">{t('streak.days')}</span>
    </span>
  );
}

import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useT } from '../../i18n';

/**
 * BadgeCollection (R4-01 §3.3) — 배지 획득/미획득 그리드(5종).
 * GET /progress/badges → [{code, title, description, earned_at|null}]
 * earned_at 있으면 컬러+획득일, 없으면 회색 잠금 표시.
 *
 * R10-01 §3.4 (S4): collapsed=true면 **1개만 노출**한다(첫 세션 전 인지 부하 감소).
 * 기본값 false — 기존 호출·기존 사용자 화면 불변(회귀 0).
 */

// 배지 코드 → 아이콘 (계약 §3.3 5종 저작 코드와 1:1)
const BADGE_ICON = {
  streak_7: '🔥',
  streak_30: '⚡',
  streak_100: '💯',
  perfect_session: '🌈',
  tier_promoted: '🎖️',
};

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function BadgeCollection({ collapsed = false }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', 'badges'],
    queryFn: progressApi.fetchBadges,
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingSpinner label={t('badges.loading')} />;

  if (isError) {
    return (
      <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
        {t('badges.loadFailed', { detail: error?.detail ?? '' })}
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 block w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const badges = Array.isArray(data) ? data : [];
  const earnedCount = badges.filter((b) => b.earned_at).length;
  const visible = collapsed ? badges.slice(0, 1) : badges;
  const hiddenCount = badges.length - visible.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-slate-900">{t('badges.title')}</h2>
        <span className="text-xs font-bold text-slate-400">
          {t('badges.earnedCount', { earned: earnedCount, total: badges.length })}
        </span>
      </div>

      {badges.length === 0 ? (
        <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          {t('badges.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {visible.map((b) => {
            const earned = Boolean(b.earned_at);
            const date = formatDate(b.earned_at);
            return (
              <div
                key={b.code}
                title={b.description}
                className={`flex flex-col items-center rounded-2xl p-3 text-center shadow-sm ring-1 transition ${
                  earned ? 'bg-white ring-amber-200' : 'bg-slate-50 ring-slate-200'
                }`}
              >
                <span
                  className={`text-3xl leading-none ${earned ? '' : 'opacity-25 grayscale'}`}
                  aria-hidden="true"
                >
                  {earned ? (BADGE_ICON[b.code] ?? '🏅') : '🔒'}
                </span>
                <p
                  className={`mt-1.5 text-[11px] font-bold leading-tight ${
                    earned ? 'text-slate-800' : 'text-slate-400'
                  }`}
                >
                  {b.title}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">{earned ? date : t('badges.locked')}</p>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          {t('badges.moreAfterFirstSession', { count: hiddenCount })}
        </p>
      )}
    </div>
  );
}

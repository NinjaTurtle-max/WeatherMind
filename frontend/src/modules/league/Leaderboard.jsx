import { useAuthStore } from '../../store/authStore';
import TierBadge from '../../components/TierBadge';
import { useT } from '../../i18n';

/**
 * Leaderboard (04번 스펙) — 테이블, 내 순위 하이라이트
 */
export default function Leaderboard({ ranks }) {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  if (!ranks || ranks.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
        {t('league.board.empty')}
      </div>
    );
  }

  const isMe = (row) =>
    (user?.nickname && row.nickname === user.nickname) ||
    (user?.user_id && row.user_id === user.user_id) ||
    row.is_me === true;

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="px-4 py-2.5 font-semibold">{t('league.board.rank')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('league.board.nickname')}</th>
            <th className="px-4 py-2.5 text-right font-semibold">{t('league.board.accuracy')}</th>
            <th className="px-4 py-2.5 text-right font-semibold">ELO</th>
          </tr>
        </thead>
        <tbody>
          {ranks.map((row, i) => {
            const me = isMe(row);
            const rank = row.rank ?? i + 1;
            return (
              <tr
                key={row.user_id ?? `${row.nickname}-${i}`}
                className={`border-b border-slate-100 last:border-0 ${
                  me ? 'bg-sky-50 font-bold text-sky-800' : 'text-slate-700'
                }`}
              >
                <td className="px-4 py-2.5">
                  {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span>{row.nickname ?? t('league.board.anonymous')}</span>
                    {me && <span className="text-xs font-bold text-sky-600">{t('league.board.me')}</span>}
                  </div>
                  {row.tier && (
                    <div className="mt-1">
                      <TierBadge tier={row.tier} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {row.accuracy_score != null ? t('league.board.score', { score: row.accuracy_score }) : '-'}
                </td>
                <td className="px-4 py-2.5 text-right">{row.elo_rating ?? '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

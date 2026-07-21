import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import TierBadge from '../../components/TierBadge';
import QuestList from './QuestList';
import BadgeCollection from './BadgeCollection';

/**
 * ProgressPage (R4-01 S1·S2·S3) — "내 정보" 탭.
 * 프로필 헤더(현재 리그 티어·XP·레벨·스트릭) + 일일 퀘스트 + 배지 컬렉션.
 * 티어는 GET /progress/me 응답의 tier(최근 정산 기준, 없으면 stratus)로 표시(§3.2).
 */
export default function ProgressPage() {
  const user = useAuthStore((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  const xp = me?.xp ?? 0;
  const level = me?.level ?? 1;
  const streak = me?.streak_count ?? 0;
  const tier = me?.tier ?? 'stratus';

  return (
    <div className="pt-2">
      {/* 프로필 헤더 */}
      <div className="mb-4 rounded-2xl bg-sky-900 p-5 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">
              {user?.nickname ?? '기상 학습자'}
            </p>
            <p className="mt-0.5 text-xs text-sky-300">Lv.{level} · 누적 {xp} XP</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
              리그 티어
            </p>
            <TierBadge tier={tier} size="md" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">🔥 {streak}</p>
            <p className="text-[11px] text-sky-200">연속 출석</p>
          </div>
          <div className="rounded-xl bg-sky-950/50 p-2.5 text-center">
            <p className="text-lg font-extrabold text-amber-300">Lv.{level}</p>
            <p className="text-[11px] text-sky-200">현재 레벨</p>
          </div>
        </div>
      </div>

      <div className="mb-5">
        <QuestList />
      </div>

      <BadgeCollection />
    </div>
  );
}

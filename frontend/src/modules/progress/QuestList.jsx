import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';

/**
 * QuestList (R4-01 §3.1) — 일일 퀘스트 카드 3종.
 * GET /progress/quests → [{code, title, progress, target, done, xp_reward}]
 * 진행 바(progress/target)·완료 체크·보상 XP를 표시한다.
 * 세션·보드 플레이 후 ['progress','quests'] 무효화로 재조회된다.
 */
export default function QuestList() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', 'quests'],
    queryFn: progressApi.fetchQuests,
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="오늘의 퀘스트를 불러오는 중..." />;

  if (isError) {
    return (
      <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
        퀘스트를 불러오지 못했어요. {error?.detail ?? ''}
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 block w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const quests = Array.isArray(data) ? data : [];
  if (quests.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
        오늘의 퀘스트가 없어요.
      </div>
    );
  }

  const doneCount = quests.filter((q) => q.done).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-slate-900">🎯 일일 퀘스트</h2>
        <span className="text-xs font-bold text-slate-400">
          {doneCount}/{quests.length} 완료
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {quests.map((q) => (
          <QuestCard key={q.code} quest={q} />
        ))}
      </div>
    </div>
  );
}

function QuestCard({ quest }) {
  const { title, progress = 0, target = 1, done, xp_reward } = quest;
  const ratio = Math.min(100, Math.max(0, target > 0 ? (progress / target) * 100 : 0));

  return (
    <div
      className={`rounded-2xl p-4 shadow-sm ring-1 transition ${
        done ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
            }`}
            aria-hidden="true"
          >
            {done ? '✓' : '·'}
          </span>
          <p className={`truncate text-sm font-bold ${done ? 'text-emerald-800' : 'text-slate-800'}`}>
            {title}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
            done ? 'bg-emerald-500 text-white' : 'bg-amber-100 text-amber-700'
          }`}
        >
          +{xp_reward} XP
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              done ? 'bg-emerald-500' : 'bg-sky-500'
            }`}
            style={{ width: `${ratio}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-bold text-slate-500">
          {Math.min(progress, target)}/{target}
        </span>
      </div>
    </div>
  );
}

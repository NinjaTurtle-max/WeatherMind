import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import AtmosphereBoard from './AtmosphereBoard';
import { phenomenonMeta } from './boardDisplay';
import { ZONES } from '../../lib/boardEngine';

/**
 * BoardPage (R3-01 S3ui·S4) — "대기 보드" 연습 탭.
 * GET /board/puzzles 목록(클리어 표시) → 선택 → 플레이 → POST attempt.
 * 최초 클리어 시 +5 XP 토스트(재도전 0). 시뮬레이터 탭을 대체한다.
 *
 * 화면 상태: LOADING → ERROR(재시도) → LIST(목록) → PLAY(선택 퍼즐 플레이).
 */
export default function BoardPage() {
  const queryClient = useQueryClient();
  const addXp = useProgressStore((s) => s.addXp);
  const [selected, setSelected] = useState(null); // 플레이 중 퍼즐 {content_item_id, template_json}
  const [result, setResult] = useState(null); // 서버 판정 결과
  const [toast, setToast] = useState(null); // XP 토스트 메시지

  const { data: puzzles, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['board', 'puzzles'],
    queryFn: boardApi.fetchBoardPuzzles,
    staleTime: 60 * 1000,
  });

  const attemptMutation = useMutation({
    mutationFn: ({ id, boardState }) => boardApi.submitBoardAttempt(id, boardState),
    onSuccess: (res) => {
      setResult(res);
      if (res.passed && res.xp_earned > 0) {
        addXp(res.xp_earned);
        setToast(`🧩 첫 클리어! +${res.xp_earned} XP`);
        queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
        queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
        queryClient.invalidateQueries({ queryKey: ['board', 'puzzles'] });
        setTimeout(() => setToast(null), 2600);
      }
    },
    onError: (err) => {
      setResult({ passed: false, feedback: err.detail ?? '제출에 실패했어요. 잠시 후 다시 시도해주세요.' });
    },
  });

  const openPuzzle = (p) => {
    setSelected(p);
    setResult(null);
  };
  const backToList = () => {
    setSelected(null);
    setResult(null);
  };

  if (isLoading) return <LoadingSpinner label="대기 보드 퍼즐을 불러오고 있어요..." />;

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🧩</p>
        <p className="mt-2 font-bold text-slate-800">퍼즐을 불러오지 못했어요</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? '잠시 후 다시 시도해주세요.'}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700">
          다시 시도
        </button>
      </div>
    );
  }

  // PLAY 화면
  if (selected) {
    return (
      <div className="pt-2">
        {toast && (
          <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
            {toast}
          </div>
        )}
        <button type="button" onClick={backToList} className="mb-2 text-sm font-medium text-slate-500 hover:text-slate-700">
          ← 목록으로
        </button>
        <AtmosphereBoard
          puzzle={selected.template_json}
          disabled={false}
          submitting={attemptMutation.isPending}
          result={result}
          onSubmit={(boardState) => attemptMutation.mutate({ id: selected.content_item_id, boardState })}
        />
        {result && (
          <div className="mt-3 space-y-2">
            <PhenomenaSummary phenomena={result.phenomena} />
            <button
              type="button"
              onClick={() => setResult(null)}
              className="w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              {result.passed ? '한 번 더 도전' : '다시 시도'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // LIST 화면
  const list = puzzles ?? [];
  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
      <h1 className="mb-1 text-lg font-extrabold text-slate-900">🧩 대기 보드</h1>
      <p className="mb-3 text-sm text-slate-500">기상요소를 한반도 4개 지역에 배치해 목표 날씨를 만들어 보세요.</p>

      {list.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          아직 등록된 퍼즐이 없어요.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <button
              key={p.content_item_id}
              type="button"
              onClick={() => openPuzzle(p)}
              className="flex items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-sky-300"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800">{p.template_json?.question_text}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {p.template_json?.mode === 'guided' ? '안내 모드' : '목표 모드'}
                </p>
              </div>
              <span
                className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  p.cleared ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {p.cleared ? '✓ 클리어' : '도전'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 서버 재판정 존별 현상 요약 (§3.4 phenomena) */
function PhenomenaSummary({ phenomena }) {
  if (!Array.isArray(phenomena) || phenomena.length === 0) return null;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="mb-1.5 text-xs font-bold text-slate-500">서버 판정 결과</p>
      <div className="grid grid-cols-4 gap-1">
        {phenomena.map((p, i) => {
          const meta = phenomenonMeta(p.phenomenon);
          return (
            <div key={i} className="rounded-lg bg-slate-50 py-1.5 text-center">
              <div className="text-lg leading-none" aria-hidden="true">{meta.icon}</div>
              <div className="text-[10px] text-slate-500">{p.zone_name ?? ZONES[p.zone] ?? ''}</div>
              <div className="text-[11px] font-bold text-slate-700">{meta.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

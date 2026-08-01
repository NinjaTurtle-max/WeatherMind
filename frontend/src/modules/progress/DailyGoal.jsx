import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { progressApi } from '../../api';
import { DAILY_GOAL_CHOICES } from '../../lib/onboardingGate';

/**
 * 일일 목표(온보딩 커밋 장치) — R10-01 §3.4·D4 (S4 / R10-D)
 *
 * 계약:
 *   - 저장: PUT /api/v1/progress/daily-goal {items} → 200 {daily_goal_items}.
 *     허용값 3|5|9 밖은 422 {code:"VALIDATION_ERROR"}(D10-4) — 그래서 UI는
 *     선택지 3개만 노출하고 임의 입력 경로를 두지 않는다.
 *   - 읽기: GET /api/v1/progress/me의 daily_goal_items(null=미설정 → 선택 노출)와
 *     today_answered_count(배치고사 제외 — D10-2).
 *
 * 두 컴포넌트로 나뉜다:
 *   DailyGoalPicker — 배치고사 직후 결과 화면의 "1스텝" 선택(+ 프로필의 미설정 보정).
 *   DailyGoalMeter  — "오늘 목표 N/M" 표기(세션 완료 화면·프로필). 미설정이면 미렌더.
 */

const ME_KEY = ['progress', 'me'];

function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });
}

/** 하루 3·5·9문항 중 하나를 골라 서버에 커밋한다. onSaved(items)는 저장 성공 후 호출. */
export function DailyGoalPicker({ onSaved, className = '' }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();

  const mutation = useMutation({
    mutationFn: progressApi.setDailyGoal,
    onSuccess: (data) => {
      // 서버 응답은 {daily_goal_items} 하나뿐이므로 me 캐시에 부분 반영 후 재검증
      queryClient.setQueryData(ME_KEY, (prev) =>
        prev ? { ...prev, daily_goal_items: data?.daily_goal_items ?? null } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ME_KEY });
      onSaved?.(data?.daily_goal_items ?? null);
    },
  });

  const selected = mutation.data?.daily_goal_items ?? me?.daily_goal_items ?? null;

  return (
    <div className={`rounded-2xl bg-sky-50 p-4 text-left ring-1 ring-sky-100 ${className}`}>
      <p className="text-sm font-extrabold text-sky-900">🎯 하루 목표를 정해요</p>
      <p className="mt-0.5 text-xs leading-relaxed text-sky-700">
        작게 시작해도 매일이 더 중요해요. 언제든 바꿀 수 있어요.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {DAILY_GOAL_CHOICES.map((choice) => {
          const active = selected === choice.items;
          const pending = mutation.isPending && mutation.variables === choice.items;
          return (
            <button
              key={choice.items}
              type="button"
              aria-pressed={active}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(choice.items)}
              className={`rounded-xl px-2 py-2.5 text-center text-xs font-bold ring-1 transition disabled:cursor-not-allowed ${
                active
                  ? 'bg-sky-600 text-white ring-sky-600'
                  : 'bg-white text-slate-700 ring-slate-200 hover:ring-sky-300'
              }`}
            >
              <span className="block text-base font-extrabold">
                {pending ? '…' : `${choice.items}문항`}
              </span>
              <span className={active ? 'text-sky-100' : 'text-slate-400'}>{choice.label}</span>
            </button>
          );
        })}
      </div>

      {selected != null && !mutation.isError && (
        <p className="mt-2 text-xs font-bold text-sky-700">
          좋아요 — 오늘부터 하루 {selected}문항이 목표예요.
        </p>
      )}
      {mutation.isError && (
        <p className="mt-2 text-xs font-bold text-rose-600">
          목표를 저장하지 못했어요. {mutation.error?.detail ?? ''} 다시 눌러주세요.
        </p>
      )}
    </div>
  );
}

/**
 * "오늘 목표 N/M" — N=today_answered_count(배치고사 제외), M=daily_goal_items.
 * 목표 미설정(null)이면 아무것도 렌더하지 않는다(§3.4: 미설정은 선택 노출 대상).
 */
export function DailyGoalMeter({ className = '' }) {
  const { data: me } = useMe();
  const goal = me?.daily_goal_items ?? null;
  if (!goal) return null;

  const done = me?.today_answered_count ?? 0;
  const reached = done >= goal;
  const ratio = Math.min(100, Math.max(0, (done / goal) * 100));

  return (
    <div
      className={`rounded-2xl p-4 text-left shadow-sm ring-1 ${
        reached ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm font-extrabold ${reached ? 'text-emerald-800' : 'text-slate-900'}`}>
          🎯 오늘 목표 {Math.min(done, goal)}/{goal}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            reached ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {reached ? '달성!' : `${Math.max(0, goal - done)}문항 남음`}
        </span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            reached ? 'bg-emerald-500' : 'bg-sky-500'
          }`}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

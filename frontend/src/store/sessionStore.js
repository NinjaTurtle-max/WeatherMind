import { create } from 'zustand';

/**
 * 세션 스토어 (스프린트 R2-01 S7 — 하루 1세션 5문항 플로우)
 *
 * 화면 상태 머신 (상태를 먼저 정의 — TEAM_PROCESS §1.3 CDD):
 *   LOADING(GET /session/today)
 *     → ERROR(조회 실패, 재시도 버튼)
 *     → IN_PROGRESS(문항 n/total 표시, POST /session/{id}/answer 제출)
 *     → FEEDBACK(문항별 AI 피드백 + 정오 배너 표시)
 *     → (다음 문항 있으면) IN_PROGRESS 복귀
 *     → (마지막 문항이면) POST /session/{id}/complete → SUMMARY(정답 수·XP 합산·스트릭)
 *
 * 제출/완료 API 왕복 중에는 상태 전이 없이 isSubmitting 플래그만 켠다.
 * 당일 세션은 멱등이므로 재진입 시 progress.answered 위치에서 이어서 푼다.
 */
export const SESSION_STATUS = {
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  IN_PROGRESS: 'IN_PROGRESS',
  FEEDBACK: 'FEEDBACK',
  SUMMARY: 'SUMMARY',
};

export const useSessionStore = create((set, get) => ({
  status: SESSION_STATUS.LOADING,
  sessionId: null,
  items: [], // SessionItem[] = QuizQuestion + {source, slot_filled}
  currentIndex: 0,
  answered: 0,
  total: 0,
  answerState: null, // AnswerResult: {is_correct, correct_answer, feedback, xp_earned, concept_tag, session_progress}
  summary: null, // {xp_total, correct_count, total, streak_count}
  error: null,
  isSubmitting: false, // answer/complete 왕복 중 (상태 전이 없이 플래그만)

  currentItem: () => get().items[get().currentIndex] ?? null,
  isLastItem: () => get().currentIndex + 1 >= get().items.length,

  startLoading: () => set({ status: SESSION_STATUS.LOADING, error: null }),

  /** GET /session/today 응답 반영 — 재진입 시 answered 위치에서 재개 */
  setSession: ({ session_id, items, progress }) => {
    const list = items ?? [];
    const answered = progress?.answered ?? 0;
    set({
      sessionId: session_id,
      items: list,
      total: progress?.total ?? list.length,
      answered,
      currentIndex: Math.min(answered, Math.max(list.length - 1, 0)),
      answerState: null,
      summary: null,
      error: null,
      status: SESSION_STATUS.IN_PROGRESS,
    });
  },

  startSubmitting: () => set({ isSubmitting: true }),

  /** answer 응답 → FEEDBACK. session_progress로 진행 수를 서버 기준 동기화
   *  (_submitFailed: 제출 실패 시 진행 수를 올리지 않는다 → retryItem으로 재시도) */
  showFeedback: (answerState) =>
    set((state) => ({
      answerState,
      isSubmitting: false,
      answered:
        answerState?.session_progress?.answered ??
        (answerState?._submitFailed ? state.answered : state.answered + 1),
      status: SESSION_STATUS.FEEDBACK,
    })),

  /** 제출 실패한 문항을 같은 위치에서 다시 풀기 (FEEDBACK → IN_PROGRESS) */
  retryItem: () => set({ answerState: null, status: SESSION_STATUS.IN_PROGRESS }),

  /** FEEDBACK → 다음 문항 IN_PROGRESS (마지막 문항이면 페이지가 complete를 호출) */
  nextItem: () => {
    const { currentIndex, items } = get();
    if (currentIndex + 1 < items.length) {
      set({
        currentIndex: currentIndex + 1,
        answerState: null,
        status: SESSION_STATUS.IN_PROGRESS,
      });
    }
  },

  /** complete 응답 → SUMMARY */
  showSummary: (summary) =>
    set({ summary, answerState: null, isSubmitting: false, status: SESSION_STATUS.SUMMARY }),

  setError: (error) => set({ error, isSubmitting: false, status: SESSION_STATUS.ERROR }),

  reset: () =>
    set({
      status: SESSION_STATUS.LOADING,
      sessionId: null,
      items: [],
      currentIndex: 0,
      answered: 0,
      total: 0,
      answerState: null,
      summary: null,
      error: null,
      isSubmitting: false,
    }),
}));

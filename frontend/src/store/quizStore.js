import { create } from 'zustand';

/**
 * 퀴즈 스토어 (04번 스펙: quizStore — currentQuiz, answerState)
 *
 * 화면 상태 머신 (04번 스펙 섹션 1):
 * IDLE → LOADING(GET /quiz/today) → SHOWING_QUESTION
 *   → SUBMITTING(POST /quiz/{id}/answer) → RESULT_SHOWN
 *   → (다음 문제 있으면) SHOWING_QUESTION 복귀, 없으면 → COMPLETED
 */
export const PHASE = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  SHOWING_QUESTION: 'SHOWING_QUESTION',
  SUBMITTING: 'SUBMITTING',
  RESULT_SHOWN: 'RESULT_SHOWN',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
};

export const useQuizStore = create((set, get) => ({
  phase: PHASE.IDLE,
  questions: [], // QuizQuestion[] (02번 스펙 스키마)
  currentIndex: 0,
  answerState: null, // AnswerResult: {is_correct, correct_answer, feedback, xp_earned, concept_tag}
  error: null,

  currentQuiz: () => get().questions[get().currentIndex] ?? null,

  startLoading: () => set({ phase: PHASE.LOADING, error: null }),

  setQuestions: (questions) =>
    set({
      questions: questions ?? [],
      currentIndex: 0,
      answerState: null,
      phase: questions && questions.length > 0 ? PHASE.SHOWING_QUESTION : PHASE.COMPLETED,
    }),

  startSubmitting: () => set({ phase: PHASE.SUBMITTING }),

  showResult: (answerState) => set({ answerState, phase: PHASE.RESULT_SHOWN }),

  /** RESULT_SHOWN → 다음 문제 or COMPLETED */
  nextQuestion: () => {
    const { currentIndex, questions } = get();
    if (currentIndex + 1 < questions.length) {
      set({ currentIndex: currentIndex + 1, answerState: null, phase: PHASE.SHOWING_QUESTION });
    } else {
      set({ answerState: null, phase: PHASE.COMPLETED });
    }
  },

  setError: (error) => set({ error, phase: PHASE.ERROR }),

  reset: () =>
    set({ phase: PHASE.IDLE, questions: [], currentIndex: 0, answerState: null, error: null }),
}));

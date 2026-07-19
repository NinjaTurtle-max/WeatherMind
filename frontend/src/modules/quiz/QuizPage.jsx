import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quizApi } from '../../api';
import { PHASE, useQuizStore } from '../../store/quizStore';
import { useProgressStore } from '../../store/progressStore';
import { useAttendance } from '../../hooks/useAttendance';
import LoadingSpinner from '../../components/LoadingSpinner';
import FeedbackPanel from '../../components/FeedbackPanel';
import QuestionCard from './QuestionCard';
import ResultBanner from './ResultBanner';

/**
 * QuizPage (04번 스펙 섹션 1) — 상태머신 컨트롤러
 * IDLE → LOADING(GET /quiz/today) → SHOWING_QUESTION
 *   → SUBMITTING(POST /quiz/{id}/answer) → RESULT_SHOWN → ... → COMPLETED
 * 진입 시 출석 체크(POST /progress/attendance) 동시 호출.
 */
export default function QuizPage() {
  const queryClient = useQueryClient();
  const {
    phase,
    questions,
    currentIndex,
    answerState,
    setQuestions,
    startSubmitting,
    showResult,
    nextQuestion,
  } = useQuizStore();
  const addXp = useProgressStore((s) => s.addXp);

  // 출석 체크 (메인 페이지 최초 진입 시 자동)
  useAttendance(true);

  // LOADING: GET /quiz/today (react-query)
  const {
    data: todayQuestions,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['quiz', 'today'],
    queryFn: quizApi.fetchTodayQuiz,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // 조회 결과를 상태머신에 반영
  useEffect(() => {
    if (todayQuestions && (phase === PHASE.IDLE || phase === PHASE.LOADING)) {
      setQuestions(todayQuestions);
    }
  }, [todayQuestions, phase, setQuestions]);

  // SUBMITTING: POST /quiz/{quiz_id}/answer
  const answerMutation = useMutation({
    mutationFn: ({ quizId, answer }) => quizApi.submitAnswer(quizId, answer),
    onMutate: () => startSubmitting(),
    onSuccess: (result) => {
      showResult(result);
      if (result.xp_earned > 0) addXp(result.xp_earned);
      // 서버 기준 XP/레벨/스트릭 재동기화
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
    },
    onError: (err) => {
      showResult({
        is_correct: false,
        correct_answer: null,
        feedback: err.detail ?? '답안 제출에 실패했어요. 잠시 후 다시 시도해주세요.',
        xp_earned: 0,
        _submitFailed: true,
      });
    },
  });

  const currentQuestion = questions[currentIndex] ?? null;

  const handleSubmit = (answer) => {
    if (!currentQuestion || phase !== PHASE.SHOWING_QUESTION) return;
    answerMutation.mutate({ quizId: currentQuestion.quiz_id, answer });
  };

  // ── 렌더 분기 ──
  if (isLoading || phase === PHASE.IDLE || phase === PHASE.LOADING) {
    return <LoadingSpinner label="오늘의 퀴즈를 만들고 있어요..." />;
  }

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌧️</p>
        <p className="mt-2 font-bold text-slate-800">퀴즈를 불러오지 못했어요</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? '잠시 후 다시 시도해주세요.'}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === PHASE.COMPLETED) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-4xl">🌈</p>
        <h2 className="mt-3 text-xl font-extrabold text-slate-900">오늘의 퀴즈 완료!</h2>
        <p className="mt-2 text-sm text-slate-500">
          내일 또 새로운 기상 퀴즈가 준비돼요. 스트릭을 이어가 보세요!
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-900">오늘의 기상 퀴즈</h1>
        <span className="text-sm font-medium text-slate-500">
          {Math.min(currentIndex + 1, questions.length)} / {questions.length}
        </span>
      </div>

      <QuestionCard
        question={currentQuestion}
        disabled={phase !== PHASE.SHOWING_QUESTION}
        onSubmit={handleSubmit}
      />

      {phase === PHASE.SUBMITTING && <LoadingSpinner label="AI가 채점하고 있어요..." />}

      {phase === PHASE.RESULT_SHOWN && answerState && (
        <>
          <ResultBanner result={answerState} />
          <button
            type="button"
            onClick={nextQuestion}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
          >
            {currentIndex + 1 < questions.length ? '다음 문제 →' : '오늘의 퀴즈 마치기'}
          </button>
          <FeedbackPanel message={answerState.feedback} isCorrect={answerState.is_correct} />
          {/* FeedbackPanel(고정 슬라이드업)에 본문이 가리지 않도록 여백 확보 */}
          <div className="h-40" />
        </>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionApi } from '../../api';
import { SESSION_STATUS, useSessionStore } from '../../store/sessionStore';
import { useProgressStore } from '../../store/progressStore';
import { useAttendance } from '../../hooks/useAttendance';
import LoadingSpinner from '../../components/LoadingSpinner';
import FeedbackPanel from '../../components/FeedbackPanel';
import QuestionCard from '../quiz/QuestionCard';
import ResultBanner from '../quiz/ResultBanner';
import SessionProgressBar from './SessionProgressBar';
import SessionSummary from './SessionSummary';

/**
 * SessionPage (R2-01 S7) — 하루 1세션(5문항) 상태머신 컨트롤러.
 * 기존 quiz 모듈(QuestionCard·ResultBanner·FeedbackPanel)을 재사용한다.
 *
 * 화면 상태 (sessionStore.SESSION_STATUS — 상태 우선 정의):
 *   LOADING(GET /session/today) → ERROR(재시도)
 *     → IN_PROGRESS(문항 n/5, POST /session/{id}/answer)
 *     → FEEDBACK(문항별 AI 피드백)
 *     → (다음 문항) IN_PROGRESS … → (마지막 문항 후) POST /session/{id}/complete
 *     → SUMMARY(정답 수·XP 합산·스트릭)
 *
 * 세션은 당일 멱등이라 재진입 시 answered 위치에서 이어서 풀고,
 * 전 문항 응답 상태로 재진입하면 곧바로 complete를 호출해 SUMMARY로 간다.
 */
export default function SessionPage() {
  const queryClient = useQueryClient();
  const {
    status,
    sessionId,
    items,
    currentIndex,
    answered,
    total,
    answerState,
    summary,
    isSubmitting,
    setSession,
    startSubmitting,
    showFeedback,
    nextItem,
    retryItem,
    showSummary,
  } = useSessionStore();
  const addXp = useProgressStore((s) => s.addXp);

  // 출석 체크 (메인 페이지 최초 진입 시 자동 — 기존 quiz 진입 규칙 승계)
  useAttendance(true);

  // LOADING: GET /session/today (멱등 — 당일 재호출 시 동일 세션)
  const {
    data: session,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['session', 'today'],
    queryFn: sessionApi.fetchTodaySession,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // 조회 결과를 상태머신에 반영
  useEffect(() => {
    if (session && status === SESSION_STATUS.LOADING) {
      setSession(session);
    }
  }, [session, status, setSession]);

  // elapsed_sec 측정: 문항이 화면에 나타난 시각
  const shownAtRef = useRef(Date.now());
  useEffect(() => {
    if (status === SESSION_STATUS.IN_PROGRESS) shownAtRef.current = Date.now();
  }, [status, currentIndex]);

  // POST /session/{id}/answer
  const answerMutation = useMutation({
    mutationFn: ({ quizId, answer, elapsedSec, boardState }) =>
      sessionApi.submitSessionAnswer(sessionId, { quizId, answer, elapsedSec, boardState }),
    onMutate: () => startSubmitting(),
    onSuccess: (result) => {
      showFeedback(result);
      if (result.xp_earned > 0) addXp(result.xp_earned);
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
    },
    onError: (err) => {
      showFeedback({
        is_correct: false,
        correct_answer: null,
        feedback: err.detail ?? '답안 제출에 실패했어요. 잠시 후 다시 시도해주세요.',
        xp_earned: 0,
        _submitFailed: true,
      });
    },
  });

  // POST /session/{id}/complete — 마지막 문항 피드백 확인 후 호출
  const completeMutation = useMutation({
    mutationFn: () => sessionApi.completeSession(sessionId),
    onMutate: () => startSubmitting(),
    onSuccess: (result) => {
      showSummary(result);
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
    },
    onError: (err) => {
      // 409(미완료) 등 — 피드백 화면 유지 + 안내
      showFeedback({
        ...(answerState ?? { is_correct: false, correct_answer: null, xp_earned: 0 }),
        feedback: err.detail ?? '세션 완료 처리에 실패했어요. 잠시 후 다시 시도해주세요.',
        _submitFailed: true,
      });
    },
  });

  // 전 문항 응답 상태로 재진입한 경우 곧바로 complete → SUMMARY
  useEffect(() => {
    if (
      status === SESSION_STATUS.IN_PROGRESS &&
      total > 0 &&
      answered >= total &&
      !summary &&
      sessionId &&
      !completeMutation.isPending
    ) {
      completeMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, answered, total, sessionId, summary]);

  const currentItem = items[currentIndex] ?? null;
  const isLastItem = currentIndex + 1 >= items.length;

  // board 유형은 onSubmit('', {boardState})로 board_state를 별도 전달한다 (§3.4)
  const handleSubmit = (answer, options = {}) => {
    if (!currentItem || status !== SESSION_STATUS.IN_PROGRESS || isSubmitting) return;
    const elapsedSec = Math.max(1, Math.round((Date.now() - shownAtRef.current) / 1000));
    answerMutation.mutate({
      quizId: currentItem.quiz_id,
      answer,
      elapsedSec,
      boardState: options.boardState,
    });
  };

  const handleNext = () => {
    if (status !== SESSION_STATUS.FEEDBACK || isSubmitting) return;
    if (answerState?._submitFailed) {
      // 제출 실패 → 같은 문항 재시도 (진행 수 미증가)
      retryItem();
      return;
    }
    if (isLastItem) {
      completeMutation.mutate();
    } else {
      nextItem();
    }
  };

  // ── 렌더 분기 ──
  if (isLoading || status === SESSION_STATUS.LOADING) {
    return <LoadingSpinner label="오늘의 세션을 준비하고 있어요..." />;
  }

  if (isError || status === SESSION_STATUS.ERROR) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌧️</p>
        <p className="mt-2 font-bold text-slate-800">세션을 불러오지 못했어요</p>
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

  if (status === SESSION_STATUS.SUMMARY) {
    return <SessionSummary summary={summary} />;
  }

  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-900">오늘의 기상 세션</h1>
        <span className="text-sm font-medium text-slate-500">
          문항 {Math.min(currentIndex + 1, items.length)} / {items.length}
        </span>
      </div>

      <SessionProgressBar answered={answered} total={total} currentIndex={currentIndex} />

      {currentItem?.slot_filled && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
          ☀️ 오늘 실황 반영 문항
        </p>
      )}

      <QuestionCard
        question={currentItem}
        disabled={status !== SESSION_STATUS.IN_PROGRESS || isSubmitting}
        onSubmit={handleSubmit}
      />

      {isSubmitting && status === SESSION_STATUS.IN_PROGRESS && (
        <LoadingSpinner label="AI가 채점하고 있어요..." />
      )}

      {status === SESSION_STATUS.FEEDBACK && answerState && (
        <>
          <ResultBanner result={answerState} />
          <button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? '세션을 마무리하고 있어요...'
              : answerState._submitFailed
                ? '다시 시도'
                : isLastItem
                  ? '세션 마치기 →'
                  : '다음 문항 →'}
          </button>
          <FeedbackPanel message={answerState.feedback} isCorrect={answerState.is_correct} />
          {/* FeedbackPanel(고정 슬라이드업)에 본문이 가리지 않도록 여백 확보 */}
          <div className="h-40" />
        </>
      )}
    </div>
  );
}

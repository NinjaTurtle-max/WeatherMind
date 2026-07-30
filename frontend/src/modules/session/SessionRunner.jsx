import { useEffect, useRef, useState } from 'react';
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
 * SessionRunner — 세션 상태머신 컨트롤러(공용 엔진).
 * 자유 일일 세션(SessionPage)과 커리큘럼 유닛 세션(UnitSessionPage)이 공유한다.
 * "기존 세션 엔진 재사용"(R5-01 §3.2): 두 진입 모두 /session/{id}/answer·/complete를 쓴다.
 *
 * 상태(sessionStore.SESSION_STATUS): LOADING → ERROR / IN_PROGRESS ↔ FEEDBACK → SUMMARY.
 *
 * 구름 에너지(§3.3): 문항 제출마다 서버가 구름 1을 소모하므로, 응답/에러 시
 * ['progress','energy']를 무효화해 헤더 잔량을 갱신한다. 소진 시 429 OUT_OF_CLOUDS는
 * 채점 실패가 아니라 "에너지 부족"이므로 전용 안내로 구분하고 같은 문항 재시도를 허용한다.
 *
 * props:
 *   - queryKey, loadSession: 세션 로드(일일=GET /session/today, 유닛=POST 세션 발급)
 *   - staleTime: 로드 캐시 수명
 *   - title: 상단 제목
 *   - attendance: 진입 시 출석 체크 호출 여부(자유 세션·학습 홈에서만 true)
 *   - subheader: 제목 아래 보조 영역(유닛 배지 등)
 *   - renderSummary(summary): 완료 요약 렌더(기본 SessionSummary)
 *   - onSessionComplete(summary): 완료 후 부수효과(예: 커리큘럼 무효화)
 *
 * bulkMode (R7-02 S1 — 배치고사 전용, daily/unit 경로 불변):
 *   - 문항 제출 시 서버 왕복·스피너·피드백 없이 로컬 수집 후 즉시 다음 문항.
 *   - 전 문항 응답 후 finalizingScreen(전환 화면)을 띄우고 finalizeBulk 호출.
 *   - finalizeBulk({sessionId, answers}): 일괄 채점→완료를 수행하고 summary를 반환.
 *   - 실패 시 로컬 답안을 유지한 채 재시도 버튼 제공(답안 유실 없음).
 */
export default function SessionRunner({
  queryKey,
  loadSession,
  staleTime = 5 * 60 * 1000,
  title = '오늘의 기상 세션',
  attendance = false,
  subheader = null,
  renderSummary,
  onSessionComplete,
  bulkMode = false,
  finalizeBulk,
  finalizingScreen = null,
}) {
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
    advanceBulk,
    showSummary,
    reset,
  } = useSessionStore();
  const addXp = useProgressStore((s) => s.addXp);

  useAttendance(attendance);

  // bulkMode(R7-02 S1): 로컬 수집 답안·일괄 제출 상태
  const bulkAnswersRef = useRef([]);
  const bulkFinalizingRef = useRef(false);
  const [bulkError, setBulkError] = useState(null);

  // 진입 시 상태머신 초기화(공용 store가 이전 진입 상태를 들고 있을 수 있음).
  const keyString = JSON.stringify(queryKey);
  useEffect(() => {
    reset();
    bulkAnswersRef.current = [];
    bulkFinalizingRef.current = false;
    setBulkError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString]);

  const { data: session, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: loadSession,
    staleTime,
    retry: 1,
  });

  useEffect(() => {
    if (session && status === SESSION_STATUS.LOADING) setSession(session);
  }, [session, status, setSession]);

  const shownAtRef = useRef(Date.now());
  useEffect(() => {
    if (status === SESSION_STATUS.IN_PROGRESS) shownAtRef.current = Date.now();
  }, [status, currentIndex]);

  const answerMutation = useMutation({
    mutationFn: ({ quizId, answer, elapsedSec, boardState }) =>
      sessionApi.submitSessionAnswer(sessionId, { quizId, answer, elapsedSec, boardState }),
    onMutate: () => startSubmitting(),
    onSuccess: (result) => {
      showFeedback(result);
      if (result.xp_earned > 0) addXp(result.xp_earned);
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] }); // 구름 1 소모 반영(§3.3)
    },
    onError: (err) => {
      // 구름 소진(§3.3): 소모 전 429 — 채점 실패가 아니라 에너지 부족(재시도 가능)
      const outOfClouds = err.code === 'OUT_OF_CLOUDS';
      if (outOfClouds) queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      showFeedback({
        is_correct: false,
        correct_answer: null,
        feedback: err.detail ?? '답안 제출에 실패했어요. 잠시 후 다시 시도해주세요.',
        xp_earned: 0,
        _submitFailed: true,
        _outOfClouds: outOfClouds,
      });
    },
  });

  // 왕관 획득 토스트 (R8-01 §3.7⑤) — daily complete 응답의 crown_award(§3.4).
  const [crownToast, setCrownToast] = useState(null);

  const completeMutation = useMutation({
    mutationFn: () => sessionApi.completeSession(sessionId),
    onMutate: () => startSubmitting(),
    onSuccess: (result) => {
      showSummary(result);
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'badges'] });
      // 왕관 유입(R8-01 §3.4): daily 만점이 열린 quiz 유닛 왕관으로 인정되면
      // 커리큘럼(다음 유닛 열림)·스파인을 갱신하고 토스트를 띄운다.
      if (result.crown_award) {
        queryClient.invalidateQueries({ queryKey: ['curriculum'] });
        setCrownToast(`👑 왕관 획득 — ${result.crown_award.unit_title}`);
        setTimeout(() => setCrownToast(null), 3000);
      }
      onSessionComplete?.(result);
    },
    onError: (err) => {
      showFeedback({
        ...(answerState ?? { is_correct: false, correct_answer: null, xp_earned: 0 }),
        feedback: err.detail ?? '세션 완료 처리에 실패했어요. 잠시 후 다시 시도해주세요.',
        _submitFailed: true,
      });
    },
  });

  useEffect(() => {
    if (
      !bulkMode && // bulkMode는 finalizeBulk(일괄 채점→완료)가 대신 처리
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

  // bulkMode(R7-02 S1): 전 문항 응답 → 전환 화면 뒤에서 finalizeBulk(submit-all→complete)
  useEffect(() => {
    if (!bulkMode || typeof finalizeBulk !== 'function') return;
    if (status !== SESSION_STATUS.IN_PROGRESS || total === 0 || answered < total) return;
    if (!sessionId || summary || bulkError || bulkFinalizingRef.current) return;
    bulkFinalizingRef.current = true;
    finalizeBulk({ sessionId, answers: bulkAnswersRef.current })
      .then((result) => {
        showSummary(result);
        onSessionComplete?.(result);
      })
      .catch((err) => {
        bulkFinalizingRef.current = false; // 로컬 답안 유지 — 재시도 가능
        setBulkError(err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkMode, status, answered, total, sessionId, summary, bulkError]);

  const currentItem = items[currentIndex] ?? null;
  const isLastItem = currentIndex + 1 >= items.length;

  const handleSubmit = (answer, options = {}) => {
    if (!currentItem || status !== SESSION_STATUS.IN_PROGRESS || isSubmitting) return;
    const elapsedSec = Math.max(1, Math.round((Date.now() - shownAtRef.current) / 1000));
    if (bulkMode) {
      // 로컬 수집(R7-02 S1): 서버 호출·피드백 없이 즉시 다음 문항(빠른 진행감)
      if (answered >= total) return; // 전 문항 응답 후 중복 제출 방지
      bulkAnswersRef.current.push({
        quiz_id: currentItem.quiz_id,
        answer: String(answer ?? ''),
        elapsed_sec: elapsedSec,
      });
      advanceBulk();
      return;
    }
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
      retryItem();
      return;
    }
    if (isLastItem) completeMutation.mutate();
    else nextItem();
  };

  // ── 렌더 ──
  if (isLoading || status === SESSION_STATUS.LOADING) {
    return <LoadingSpinner label="세션을 준비하고 있어요..." />;
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
    return (
      <>
        {crownToast && (
          <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
            {crownToast}
          </div>
        )}
        {renderSummary ? renderSummary(summary) : <SessionSummary summary={summary} />}
      </>
    );
  }

  // bulkMode(R7-02 S1): 전 문항 응답 완료 — 전환 화면(그 뒤에서 submit-all→complete)
  if (bulkMode && status === SESSION_STATUS.IN_PROGRESS && total > 0 && answered >= total && !summary) {
    if (bulkError) {
      return (
        <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-3xl">🌧️</p>
          <p className="mt-2 font-bold text-slate-800">결과 계산에 실패했어요</p>
          <p className="mt-1 text-sm text-slate-500">
            {bulkError?.detail ?? '잠시 후 다시 시도해주세요. 푼 답안은 그대로 남아 있어요.'}
          </p>
          <button
            type="button"
            onClick={() => setBulkError(null)}
            className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return finalizingScreen ?? <LoadingSpinner label="결과를 계산하고 있어요..." />;
  }

  const outOfClouds = answerState?._outOfClouds;

  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
        <span className="text-sm font-medium text-slate-500">
          문항 {Math.min(currentIndex + 1, items.length)} / {items.length}
        </span>
      </div>

      {subheader}

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
        answerResult={status === SESSION_STATUS.FEEDBACK ? answerState : null}
      />

      {isSubmitting && status === SESSION_STATUS.IN_PROGRESS && (
        <LoadingSpinner label="AI가 채점하고 있어요..." />
      )}

      {status === SESSION_STATUS.FEEDBACK && answerState && (
        <>
          {outOfClouds ? (
            <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-center ring-1 ring-rose-200">
              <p className="text-2xl">☁️</p>
              <p className="mt-1 text-sm font-bold text-rose-700">구름이 모두 흩어졌어요</p>
              <p className="mt-1 text-xs text-rose-600">{answerState.feedback}</p>
            </div>
          ) : (
            <ResultBanner result={answerState} />
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? '세션을 마무리하고 있어요...'
              : answerState._submitFailed
                ? outOfClouds
                  ? '구름 회복 후 다시 시도'
                  : '다시 시도'
                : isLastItem
                  ? '세션 마치기 →'
                  : '다음 문항 →'}
          </button>
          {!outOfClouds && <FeedbackPanel message={answerState.feedback} isCorrect={answerState.is_correct} />}
          <div className="h-40" />
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { translate, useT } from '../../i18n';

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
 *
 * R10-01 §3.5 (S5 / R10-G):
 *   - 콤보·칭찬 에스컬레이션: 연속 정답 카운터를 진행바 **위**에 표시하고 칭찬을
 *     4단으로 올린다(comboPraise — 자체 카피).
 *   - 이탈 인텐트 1단: 세션 진행 중 앱 내 이동(탭바 등 링크)·뒤로가기·새로고침을
 *     확인 1단으로 받는다. 주 CTA "계속 풀기"(큼) / 종료는 작은 링크.
 *     배치고사(bulkMode)는 제외 — 온보딩 "건너뛰기" 경로를 막지 않는다.
 */

// 칭찬 4단 (§3.5 — 자체 카피). 연속 정답 수가 커져도 마지막 단계에서 멈춘다.
// 문구 원본은 session.praise.* 리소스(i18n) — 이 상수는 ko 사본으로, 계약 테스트
// (boardAssistRetention: ko 원문 4개 단정)와 순수 함수 comboPraise의 소스다.
// 렌더는 t('session.praise.{n}')를 직접 써서 로케일에 반응한다.
export const COMBO_PRAISE = Object.freeze(
  [1, 2, 3, 4].map((n) => translate('ko', `session.praise.${n}`)),
);

/** 연속 정답 수 → 칭찬 문구(ko — 계약용 순수 함수). 0·음수·비수는 null(표시 없음). */
export function comboPraise(combo) {
  const n = Number(combo);
  if (!Number.isFinite(n) || n < 1) return null;
  return COMBO_PRAISE[Math.min(Math.floor(n), COMBO_PRAISE.length) - 1];
}
export default function SessionRunner({
  queryKey,
  loadSession,
  staleTime = 5 * 60 * 1000,
  title = null,
  attendance = false,
  subheader = null,
  renderSummary,
  onSessionComplete,
  bulkMode = false,
  finalizeBulk,
  finalizingScreen = null,
}) {
  const queryClient = useQueryClient();
  const t = useT();
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

  // 연속 정답 콤보(§3.5) — 정답이면 +1, 오답·제출 실패면 0으로 초기화
  const [combo, setCombo] = useState(0);

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
    setCombo(0);
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
      setCombo((c) => (result.is_correct ? c + 1 : 0)); // 콤보(§3.5)
      if (result.xp_earned > 0) addXp(result.xp_earned);
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] }); // 구름 1 소모 반영(§3.3)
    },
    onError: (err) => {
      setCombo(0); // 제출 실패도 연속 정답 흐름은 끊긴다(§3.5)
      // 구름 소진(§3.3): 소모 전 429 — 채점 실패가 아니라 에너지 부족(재시도 가능)
      const outOfClouds = err.code === 'OUT_OF_CLOUDS';
      if (outOfClouds) queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      showFeedback({
        is_correct: false,
        correct_answer: null,
        feedback: err.detail ?? t('session.submitFailed'),
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
        setCrownToast(t('session.crownToast', { title: result.crown_award.unit_title }));
        setTimeout(() => setCrownToast(null), 3000);
      }
      onSessionComplete?.(result);
    },
    onError: (err) => {
      showFeedback({
        ...(answerState ?? { is_correct: false, correct_answer: null, xp_earned: 0 }),
        feedback: err.detail ?? t('session.completeFailed'),
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

  // ── 이탈 인텐트(§3.5) ────────────────────────────────────────────────────
  // 진행 중 = 문항이 남은 상태(요약·에러·로딩 제외). 배치고사는 제외(bulkMode).
  const navigate = useNavigate();
  const [leftOnPurpose, setLeftOnPurpose] = useState(false);
  const leaveGuardActive =
    !bulkMode &&
    !leftOnPurpose &&
    !summary &&
    items.length > 0 &&
    (status === SESSION_STATUS.IN_PROGRESS || status === SESSION_STATUS.FEEDBACK);
  const [leaveIntent, setLeaveIntent] = useLeaveIntent(leaveGuardActive);
  const stay = useCallback(() => setLeaveIntent(null), [setLeaveIntent]);
  const leave = useCallback(() => {
    const to = leaveIntent?.to ?? '/learn'; // 뒤로가기 인텐트는 학습 경로로 내보낸다
    setLeaveIntent(null);
    setLeftOnPurpose(true); // 가드 해제 → 링크 재클릭 없이 그대로 이동
    // replace(P2-1): 목적지가 **센티널 항목을 덮어쓴다**. push면 센티널이 히스토리
    // 중간에 묻혀 회수 불가(cleanup은 최상단만 회수한다)가 되고, 그만두기를 쓸수록
    // 헛도는 뒤로가기가 쌓인다. 센티널이 없던 환경에서도 안전하다 —
    // 이탈을 확정한 세션 화면으로 뒤로가기 복귀하지 않게 되는 것뿐이다.
    navigate(to, { replace: true });
  }, [leaveIntent, navigate, setLeaveIntent]);

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
    return <LoadingSpinner label={t('session.loading')} />;
  }

  if (isError || status === SESSION_STATUS.ERROR) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌧️</p>
        <p className="mt-2 font-bold text-slate-800">{t('session.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? t('common.retryLater')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('common.retry')}
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
          <p className="mt-2 font-bold text-slate-800">{t('session.bulkFailTitle')}</p>
          <p className="mt-1 text-sm text-slate-500">
            {bulkError?.detail ?? t('session.bulkFailBody')}
          </p>
          <button
            type="button"
            onClick={() => setBulkError(null)}
            className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
          >
            {t('common.retry')}
          </button>
        </div>
      );
    }
    return finalizingScreen ?? <LoadingSpinner label={t('session.bulkFinalizing')} />;
  }

  const outOfClouds = answerState?._outOfClouds;

  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-900">{title ?? t('session.title')}</h1>
        <span className="text-sm font-medium text-slate-500">
          {t('session.itemCount', {
            current: Math.min(currentIndex + 1, items.length),
            total: items.length,
          })}
        </span>
      </div>

      {subheader}

      {/* 콤보·칭찬 에스컬레이션(§3.5) — 진행바 위 */}
      {combo > 0 && (
        <p
          data-combo={combo}
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-extrabold text-orange-700"
        >
          <span aria-hidden="true">🔥</span>
          {t('session.combo', { combo })}
          <span className="text-orange-500">·</span>
          {t(`session.praise.${Math.min(Math.floor(combo), 4)}`)}
        </p>
      )}

      <SessionProgressBar answered={answered} total={total} currentIndex={currentIndex} />

      {currentItem?.slot_filled && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
          {t('session.slotFilled')}
        </p>
      )}

      <QuestionCard
        question={currentItem}
        disabled={status !== SESSION_STATUS.IN_PROGRESS || isSubmitting}
        onSubmit={handleSubmit}
        answerResult={status === SESSION_STATUS.FEEDBACK ? answerState : null}
      />

      {isSubmitting && status === SESSION_STATUS.IN_PROGRESS && (
        <LoadingSpinner label={t('session.grading')} />
      )}

      {status === SESSION_STATUS.FEEDBACK && answerState && (
        <>
          {outOfClouds ? (
            // 새 에너지 규칙 문구(R10-01 §3.1·D6 — 웨이브 1 잔여): 구름은 "노력"이
            // 아니라 "실수"에만 줄고, 이미 시작한 세션은 끝까지 마칠 수 있다.
            <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-center ring-1 ring-rose-200">
              <p className="text-2xl">☁️</p>
              <p className="mt-1 text-sm font-bold text-rose-700">{t('session.clouds.title')}</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-600">
                {t('session.clouds.seg1')}
                <span className="font-bold">{t('session.clouds.strong1')}</span>
                {t('session.clouds.seg2')}
                <span className="font-bold">{t('session.clouds.strong2')}</span>
                {t('session.clouds.seg3')}
              </p>
              {answerState.feedback && (
                <p className="mt-1.5 text-[11px] text-rose-500">{answerState.feedback}</p>
              )}
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
              ? t('session.finishing')
              : answerState._submitFailed
                ? outOfClouds
                  ? t('session.retryAfterRegen')
                  : t('common.retry')
                : isLastItem
                  ? t('session.finish')
                  : t('session.next')}
          </button>
          {!outOfClouds && <FeedbackPanel message={answerState.feedback} isCorrect={answerState.is_correct} />}
          <div className="h-40" />
        </>
      )}

      {/* 이탈 인텐트 확인 1단(§3.5) */}
      {leaveIntent && <LeaveIntentDialog onStay={stay} onLeave={leave} remaining={Math.max(0, total - answered)} />}
    </div>
  );
}

/**
 * useLeaveIntent — 세션 진행 중 이탈 의도를 1단 확인으로 받는다(§3.5).
 *
 * BrowserRouter(데이터 라우터 아님)라 `useBlocker`를 쓸 수 없어 3경로를 직접 잡는다:
 *   1. 앱 내 이동: document 캡처 단계에서 내부 링크 클릭을 가로챈다(탭바 NavLink 포함).
 *      새 탭·수정키·외부 도메인·같은 경로·`data-leave-allow` 링크는 통과시킨다.
 *   2. 뒤로가기: 활성화 시 **같은 URL**의 센티널 항목을 하나 밀어 넣고, popstate가
 *      오면 센티널을 다시 세워 그 자리에 머문 뒤 확인을 띄운다. URL이 같으므로
 *      라우터 위치는 변하지 않는다. 비용은 세션을 마친 뒤 같은 페이지에서 뒤로가기
 *      1회가 더 필요할 수 있다는 것뿐이며, 진행 중 이탈을 잡는 값이 더 크다.
 *   3. 새로고침·탭 닫기: beforeunload(브라우저 기본 확인 — 커스텀 모달 불가).
 *
 * 반환: [intent|null, setIntent] — intent = {to} | {back:true}
 */
function useLeaveIntent(active) {
  const [intent, setIntent] = useState(null);

  useEffect(() => {
    if (!active) {
      setIntent(null);
      return undefined;
    }

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ''; // 크롬 계열은 문자열 지정 필요(문구는 브라우저 고정)
      return '';
    };

    const onClickCapture = (e) => {
      if (e.defaultPrevented) return;
      if (e.button != null && e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target?.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute('data-leave-allow')) return;
      if (anchor.target && anchor.target !== '_self') return;
      const raw = anchor.getAttribute('href') ?? '';
      if (!raw || raw.startsWith('#')) return;
      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // 외부 링크는 관심 밖
      const to = `${url.pathname}${url.search}`;
      if (url.pathname === window.location.pathname) return; // 같은 화면
      e.preventDefault();
      e.stopPropagation();
      setIntent({ to });
    };

    // 뒤로가기 센티널. **최대 1개 불변식**(P2-1): 이미 센티널 위에 서 있으면
    // 새로 밀지 않고 재사용한다 — cleanup의 back()은 비동기 큐라, 세션을 닫고
    // 곧바로 다른 세션을 열면 회수가 착지하기 전에 두 번째 센티널이 쌓인다
    // (그러면 회수는 1개만 되고 나머지가 영구 잔류 = 헛도는 뒤로가기 누적).
    // 동기 검사인 history.state로 판별하므로 타이밍과 무관하게 스택되지 않는다.
    let sentinel = false;
    try {
      if (window.history.state?.wmLeaveGuard) {
        sentinel = true; // 직전 세션이 남긴 센티널을 그대로 물려받는다
      } else {
        window.history.pushState({ wmLeaveGuard: true }, '');
        sentinel = true;
      }
    } catch {
      /* 히스토리 조작 불가 환경(테스트·임베드) — 링크·새로고침 경로만 동작 */
    }
    const onPopState = () => {
      if (!sentinel) return;
      try {
        window.history.pushState({ wmLeaveGuard: true }, ''); // 제자리 복귀
      } catch {
        /* noop */
      }
      setIntent({ back: true });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClickCapture, true);
      // 센티널 회수(P2-1): 리스너를 먼저 떼었으므로 이 back()이 유발하는 popstate는
      // 아무것도 트리거하지 않는다. **최상단 항목이 우리 센티널일 때만** 되돌린다 —
      // 그 사이 다른 화면으로 이동했다면(그만두기 등) 최상단은 라우터의 항목이고,
      // 남의 히스토리를 건드리면 안 된다(그 경우는 leave()의 replace가 처리한다).
      // 회수하지 않으면 세션을 열 때마다 헛도는 뒤로가기가 1칸씩 쌓인다.
      if (!sentinel) return;
      try {
        if (window.history.state?.wmLeaveGuard) window.history.back();
      } catch {
        /* 히스토리 조작 불가 환경 — no-op */
      }
    };
  }, [active]);

  return [intent, setIntent];
}

/**
 * LeaveIntentDialog — 확인 1단(§3.5). 주 CTA "계속 풀기"가 크고, 종료는 작은 링크.
 * 접근성: role=dialog·aria-modal, 진입 시 주 CTA 포커스, Tab 순환(포커스 트랩),
 * Esc = 계속 풀기, 닫힐 때 이전 포커스 복원. 애니메이션 없음(reduced-motion 무관).
 */
function LeaveIntentDialog({ onStay, onLeave, remaining }) {
  const t = useT();
  const panelRef = useRef(null);
  const primaryRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    primaryRef.current?.focus();
    const focusables = () =>
      [...(panelRef.current?.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((el) => !el.disabled);
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onStay();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const activeEl = document.activeElement;
      const inside = panelRef.current?.contains(activeEl);
      if (e.shiftKey ? activeEl === first || !inside : activeEl === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-intent-title"
        aria-describedby="leave-intent-desc"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
      >
        <p className="text-3xl" aria-hidden="true">🌦️</p>
        <h2 id="leave-intent-title" className="mt-2 text-lg font-extrabold text-slate-900">
          {t('session.leave.title')}
        </h2>
        <p id="leave-intent-desc" className="mt-1.5 text-sm leading-relaxed text-slate-500">
          {remaining > 0 ? t('session.leave.remaining', { remaining }) : t('session.leave.almost')}
          {t('session.leave.tail')}
        </p>
        <button
          ref={primaryRef}
          type="button"
          onClick={onStay}
          className="mt-5 w-full rounded-xl bg-sky-600 py-3.5 text-base font-extrabold text-white transition hover:bg-sky-700"
        >
          {t('session.leave.stay')}
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="mt-3 text-xs font-medium text-slate-400 underline hover:text-slate-600"
        >
          {t('session.leave.quit')}
        </button>
      </div>
    </div>
  );
}

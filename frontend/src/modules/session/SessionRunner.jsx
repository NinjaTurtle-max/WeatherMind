import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import ClosingForecastStep from '../duel/ClosingForecastStep';
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

/**
 * 만회 큐 상한 (R13-01 §2.11) — **서버는 상한을 강제하지 않는다**(문항별 만회
 * 가능 여부만 판정한다). 상한은 프론트 몫이다: 15문항 + 만회 무제한이면 최악
 * 30문항이 되어 좋은 장치가 피로 유발로 뒤집힌다. 최대 20문항에서 멈춘다.
 */
export const RETRY_QUEUE_LIMIT = 5;

/**
 * 오답 quiz_id 목록 → 실제 만회 대상 (계약용 순수 함수).
 * 상한을 넘으면 **마지막 N개**만 남긴다 — 방금 놓친 것이 기억에 가깝고,
 * "오늘 놓친 것 몇 개를 마무리한다"는 의미가 선명해진다(§2.11).
 */
export function retryQueueOf(wrongIds, limit = RETRY_QUEUE_LIMIT) {
  if (!Array.isArray(wrongIds)) return [];
  return wrongIds.slice(-Math.max(0, limit));
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
    setError,
    startLoading,
    reset,
  } = useSessionStore();
  const addXp = useProgressStore((s) => s.addXp);

  useAttendance(attendance);

  // 연속 정답 콤보(§3.5) — 정답이면 +1, 오답·제출 실패면 0으로 초기화
  const [combo, setCombo] = useState(0);

  // ── 만회 라운드(R13-01 §2.1) · 상한 5(§2.11) ──────────────────────────────
  // wrongIds: 틀린 문항 quiz_id(출제 순서 보존). 이번 자리에서 틀린 것 **+ 재진입
  //   복원분**(CO-A5 — 서버 SessionItem.is_correct).
  // retryQueue: 마지막 문항 뒤에 확정되는 실제 만회 대상(= retryQueueOf(wrongIds)).
  //   길이가 0보다 크면 만회 라운드 진행 중이라는 뜻이다(retryPhase).
  const [wrongIds, setWrongIds] = useState([]);
  const [retryQueue, setRetryQueue] = useState([]);
  const [retryIndex, setRetryIndex] = useState(0);
  const retryPhase = retryQueue.length > 0;
  // 이 세션의 복원이 끝났는가(= 복원 대상 sessionId). **상태**여야 한다(ref 아님):
  // 복원이 자동완료보다 먼저 반영됐다는 사실을 렌더 사이클로 전달해야 자동완료
  // 이펙트가 같은 커밋에서 앞질러 발화하지 않는다(CO-M10의 발화 지점).
  const [restoredFor, setRestoredFor] = useState(null);

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
    setWrongIds([]);
    setRetryQueue([]);
    setRetryIndex(0);
    setRestoredFor(null);
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

  /**
   * 로드 실패를 상태머신에 배선한다 (CO-S-1 / CO-M4, 2026-08-08).
   *
   * `sessionStore.setError`의 호출자가 **0건**이라 `SESSION_STATUS.ERROR`가 도달
   * 불가였고, store가 초기값 LOADING에 머무는 동안 아래 렌더 가드가 `isLoading`을
   * 먼저 보는 바람에 **429·403 UNIT_LOCKED·500·503이 전부 무한 스피너 한 종류로
   * 수렴**했다(7초 실측). react-query v5의 useQuery에는 onError가 없으므로 이
   * 이펙트가 유일한 배선 지점이다.
   */
  useEffect(() => {
    if (isError && status === SESSION_STATUS.LOADING) setError(error ?? null);
  }, [isError, error, status, setError]);

  const shownAtRef = useRef(Date.now());
  useEffect(() => {
    if (status === SESSION_STATUS.IN_PROGRESS) shownAtRef.current = Date.now();
  }, [status, currentIndex]);

  const answerMutation = useMutation({
    mutationFn: ({ quizId, answer, elapsedSec, boardState }) =>
      sessionApi.submitSessionAnswer(sessionId, { quizId, answer, elapsedSec, boardState }),
    onMutate: () => startSubmitting(),
    onSuccess: (result, variables) => {
      showFeedback(result);
      // 만회 응답(§2.1)은 최초 시도가 아니다 — 콤보·XP·오답 큐 어디에도 닿지 않는다.
      // 서버가 xp_earned=0·clouds_spent=0으로 보내므로 배너도 저절로 조용하다.
      if (!result.is_retry) {
        setCombo((c) => (result.is_correct ? c + 1 : 0)); // 콤보(§3.5)
        if (result.xp_earned > 0) addXp(result.xp_earned);
        if (result.is_correct === false && variables?.quizId) {
          setWrongIds((prev) =>
            prev.includes(variables.quizId) ? prev : [...prev, variables.quizId],
          );
        }
      }
      queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
      queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] }); // 구름 1 소모 반영(§3.3)
    },
    onError: (err) => {
      setCombo(0); // 제출 실패도 연속 정답 흐름은 끊긴다(§3.5)
      // 구름 소진(§3.3): 소모 전 429 — 채점 실패가 아니라 에너지 부족(재시도 가능)
      const outOfClouds = err.code === 'OUT_OF_CLOUDS';
      // 만회 대상이 아닌 재제출은 **409 ALREADY_ANSWERED**다(§2.1 BE-1 실측 정정 —
      // 계약 문서 초안의 "409 아님"은 오류였다). 이건 채점 실패가 아니라 "이미
      // 해결된 문항"이라는 뜻이므로 재시도 버튼을 띄우면 안 된다 — 다음으로 넘긴다.
      const alreadyAnswered = err.code === 'ALREADY_ANSWERED';
      if (outOfClouds) queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      showFeedback({
        is_correct: false,
        correct_answer: null,
        feedback: alreadyAnswered ? t('session.retry.alreadyResolved') : (err.detail ?? t('session.submitFailed')),
        xp_earned: 0,
        // 409는 진행 수를 움직이면 안 된다 — 서버 진행값을 못 받았으므로 현재 값을 고정한다
        ...(alreadyAnswered ? { session_progress: { answered, total } } : {}),
        _submitFailed: !alreadyAnswered,
        _alreadyAnswered: alreadyAnswered,
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

  /**
   * 재진입 만회 복원 (CO-A5 / CO-M10) — **자동완료보다 반드시 먼저 선언한다.**
   *
   * 세션은 하루 동안 멱등이라 새로고침·중간 이탈 후 재진입이 정상 경로다. 그런데
   * 프론트는 `wrongIds`를 이번 자리의 제출 응답으로만 쌓아서, 재진입하면 오답을
   * 전부 잊었다. 만회 도중에 새로고침하면 `wrongIds=[]`인데 `answered >= total`이라
   * **자동완료가 곧바로 발화**해 만회 화면이 뜨지도 않고 세션이 끝났고, 그 순간의
   * `all_resolved`로 왕관이 확정됐다(대장 CO-M10).
   *
   * 복원 조건은 **`is_correct === false && retry_correct == null`**이다.
   * 서버 `is_retry_eligible`은 `retry_correct is not True`라 만회에 **실패한** 문항도
   * 여전히 재제출을 받아 주지만, 그 조건으로 복원하면 새로고침할 때마다 실패한
   * 만회가 되살아난다 — §2.11의 "성공·실패 모두 한 번씩만"이 새로고침으로 무너지고
   * 왕관 판정(all_resolved)이 재시도 횟수에 좌우된다. 서버 조건의 **진부분집합**이라
   * 이 큐가 409를 맞는 일은 없다(반대 방향의 어긋남만 위험하다).
   *
   * ⚠️ 복원 근거는 **로드 응답(`session`)**이지 스토어가 아니다. 스토어는 모듈
   * 싱글턴이라 진입 첫 패스에서 **직전 세션의 값**을 들고 있고(초기화 이펙트가 같은
   * 패스에서 방금 `reset()`을 불렀어도 이 이펙트가 보는 것은 그 이전 렌더의
   * 스냅샷이다), 일일 세션은 id가 매일 같아서 그 낡은 값으로 `restoredFor`가
   * 찍히면 **정작 진짜 데이터가 왔을 때 복원이 통째로 건너뛰어진다**(실측으로
   * 이 경로를 밟았다). `sessionId === session.session_id` 확인은 스토어가 이
   * 응답을 이미 반영했다는 뜻이며, 그래야 아래 자동완료를 열어 줄 수 있다.
   */
  useEffect(() => {
    const loadedId = session?.session_id;
    if (!loadedId || restoredFor === loadedId) return;
    if (sessionId !== loadedId) return; // 스토어가 아직 이 응답을 반영하지 않았다
    const restored = (session.items ?? [])
      .filter((it) => it.is_correct === false && it.retry_correct == null)
      .map((it) => it.quiz_id);
    if (restored.length > 0) {
      // 이번 자리에서 이미 쌓인 것이 있으면 그쪽이 최신이다(복원은 최초 1회뿐).
      setWrongIds((prev) => (prev.length > 0 ? prev : restored));
      // 본문 15문항이 이미 끝나 있었다 = 만회 라운드에서 이탈했다는 뜻이다.
      // 큐를 세워 두면 아래 자동완료가 `retryPhase`로 막힌다.
      const loaded = session.progress ?? {};
      if ((loaded.total ?? 0) > 0 && (loaded.answered ?? 0) >= loaded.total) {
        setRetryQueue(retryQueueOf(restored, RETRY_QUEUE_LIMIT));
        setRetryIndex(0);
      }
    }
    setRestoredFor(loadedId);
  }, [session, sessionId, restoredFor]);

  useEffect(() => {
    if (
      !bulkMode && // bulkMode는 finalizeBulk(일괄 채점→완료)가 대신 처리
      restoredFor === sessionId && // 복원 전에는 판단하지 않는다(CO-M10)
      !retryPhase && // 만회 라운드 중에는 answered==total이어도 아직 끝이 아니다(§2.1)
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
  }, [status, answered, total, sessionId, summary, retryPhase, restoredFor]);

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

  // 만회 라운드 중에는 큐가 출제 순서를 소유한다(§2.1) — store의 currentIndex는
  // 15문항 본문 진행에만 쓰이고 그대로 마지막 문항에 머문다.
  const retryTarget = retryPhase
    ? (items.find((it) => it.quiz_id === retryQueue[retryIndex]) ?? null)
    : null;
  const currentItem = retryPhase ? retryTarget : (items[currentIndex] ?? null);
  const isLastItem = currentIndex + 1 >= items.length;
  const isLastRetry = retryIndex + 1 >= retryQueue.length;
  // 마지막 문항 피드백 화면에서 확정되는 만회 대상 수 — 버튼 문구를 "세션 마치기"가
  // 아니라 "놓친 N문항 만회하기"로 바꾸는 근거(만회가 있다는 걸 미리 알린다).
  const pendingRetryCount =
    !retryPhase && isLastItem ? retryQueueOf(wrongIds, RETRY_QUEUE_LIMIT).length : 0;

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
    // ── 만회 라운드 진행 중(§2.1): 큐를 한 칸씩 소모하고 끝나면 완료 ──
    // 성공·실패 모두 한 번씩만 준다 — 서버는 만회 실패 문항을 계속 만회 가능으로
    // 두지만(is_retry_eligible), 무한 재시도는 §2.11의 피로 상한 취지에 어긋난다.
    if (retryPhase) {
      if (isLastRetry) completeMutation.mutate();
      else {
        setRetryIndex((i) => i + 1);
        retryItem(); // answerState 비우고 IN_PROGRESS 복귀(전이는 기존 액션 재사용)
      }
      return;
    }
    if (isLastItem) {
      // 마지막 문항 뒤 = 만회 라운드 진입 지점. 상한 5는 여기서 걸린다(§2.11).
      const queue = retryQueueOf(wrongIds, RETRY_QUEUE_LIMIT);
      if (queue.length > 0) {
        setRetryQueue(queue);
        setRetryIndex(0);
        retryItem();
        return;
      }
      completeMutation.mutate();
      return;
    }
    nextItem();
  };

  // ── 렌더 ──
  // ⚠️ **에러가 로딩보다 먼저다**(CO-S-1). 종전에는 `isLoading || status===LOADING`이
  // 위에 있어서, 로드가 실패해도 store가 LOADING에 남아 있는 한 스피너가 이겼다.
  // 실패는 실패로 보여야 한다 — 이 순서를 되돌리면 무한 스피너가 되살아난다.
  if (isError || status === SESSION_STATUS.ERROR) {
    // 실패의 **종류**를 가른다(CO-M4): 429 구름 소진 · 403 선행 잠금 · 그 밖.
    // 종전에는 OUT_OF_CLOUDS 전용 처리가 answer 뮤테이션에만 있었는데 현행 정책상
    // answer는 429를 못 낸다(소모가 예외를 안 던진다) — 그 분기는 죽어 있었고
    // 실제 429는 여기, **로드 경로**에서 난다.
    const code = error?.code;
    if (code === 'OUT_OF_CLOUDS') {
      // 회복 ETA는 429 본문의 next_regen_sec(ApiError.body) — CurriculumHome의
      // regenMin과 같은 산식. 재시도 버튼을 두지 않는다: 눌러도 다시 429다.
      const min = Math.max(1, Math.ceil((error?.body?.next_regen_sec ?? 0) / 60));
      const clouds = error?.body?.clouds;
      const max = error?.body?.max;
      return (
        <div
          data-session-error="OUT_OF_CLOUDS"
          className="mt-16 rounded-2xl bg-rose-50 p-6 text-center ring-1 ring-rose-200"
        >
          <p className="text-3xl">☁️</p>
          <p className="mt-2 font-extrabold text-rose-700">{t('session.outOfClouds.title')}</p>
          {typeof clouds === 'number' && typeof max === 'number' && (
            <p className="mt-1 text-sm font-bold text-rose-600">{`${clouds} / ${max}`}</p>
          )}
          <p className="mt-1 text-sm leading-relaxed text-rose-600">
            {t('session.outOfClouds.body', { min })}
          </p>
          <Link
            to="/learn"
            className="mt-4 inline-block rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-700"
          >
            {t('session.outOfClouds.cta')}
          </Link>
        </div>
      );
    }
    if (code === 'UNIT_LOCKED') {
      return (
        <div
          data-session-error="UNIT_LOCKED"
          className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200"
        >
          <p className="text-3xl">🔒</p>
          <p className="mt-2 font-extrabold text-slate-800">{t('session.unitLocked.title')}</p>
          <p className="mt-1 text-sm text-slate-500">
            {error?.detail ?? t('session.unitLocked.body')}
          </p>
          <Link
            to="/learn"
            className="mt-4 inline-block rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
          >
            {t('session.unitLocked.cta')}
          </Link>
        </div>
      );
    }
    return (
      <div
        data-session-error="GENERIC"
        className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200"
      >
        <p className="text-3xl">🌧️</p>
        <p className="mt-2 font-bold text-slate-800">{t('session.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? t('common.retryLater')}</p>
        <button
          type="button"
          onClick={() => {
            startLoading(); // ERROR → LOADING으로 되돌려야 setSession 이펙트가 다시 문다
            refetch();
          }}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (isLoading || status === SESSION_STATUS.LOADING) {
    return <LoadingSpinner label={t('session.loading')} />;
  }

  /**
   * 0문항 세션 (CO-S-3) — 서버는 **200으로** 빈 세션을 돌려줄 수 있다(성인×기초과학
   * 8유닛 = CO-L2, 밴드 강등 폴백 부재). 자동완료 이펙트에 `total > 0` 가드가 있어
   * complete가 영원히 안 나가고 QuestionCard도 null이라, 본문이 문자 그대로
   * "문항 0 / 0"인 화면에 갇혔다. 성공 응답이므로 위 에러 분기로는 안 잡힌다.
   */
  if (!bulkMode && status === SESSION_STATUS.IN_PROGRESS && items.length === 0 && !summary) {
    return (
      <div
        data-session-error="EMPTY"
        className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200"
      >
        <p className="text-3xl">🌤️</p>
        <p className="mt-2 font-extrabold text-slate-800">{t('session.empty.title')}</p>
        <p className="mt-1 text-sm text-slate-500">{t('session.empty.body')}</p>
        <Link
          to="/learn"
          className="mt-4 inline-block rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('session.empty.cta')}
        </Link>
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
        {renderSummary ? renderSummary(summary) : <SessionSummary summary={summary} items={items} />}
        {/* 예보 마감 단계 (R13 A-1) — **완료 응답의 closing_step이 정본**이다.
            /session/today의 값이 아니라 여기서 다시 계산된 값을 쓴다: 세션 도중
            다른 화면에서 예보를 냈으면 여기서 null이 되고, 그러면 409로 끝날
            단계를 그리지 않는다. null = 단계 없음이고 세션은 이미 완료됐다
            (KMA 부재 degraded도 이 경로 — 완주를 막지 않는다). */}
        {summary?.closing_step && <ClosingForecastStep step={summary.closing_step} />}
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
          {retryPhase
            ? t('session.retry.itemCount', {
                current: Math.min(retryIndex + 1, retryQueue.length),
                total: retryQueue.length,
              })
            : t('session.itemCount', {
                current: Math.min(currentIndex + 1, items.length),
                total: items.length,
              })}
        </span>
      </div>

      {subheader}

      {/* 만회 라운드 배너(§2.1) — 벌이 아니라는 것을 화면이 먼저 말한다.
          구름 무소모·XP 무가산은 서버 계약이고, 여기서 오해를 만들면 안 된다. */}
      {retryPhase && (
        <div
          data-retry-round={retryQueue.length}
          className="mb-2 rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200"
        >
          <p className="text-xs font-extrabold text-indigo-700">
            {t('session.retry.banner', { total: retryQueue.length })}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-indigo-500">
            {t('session.retry.note')}
            {wrongIds.length > RETRY_QUEUE_LIMIT
              ? ` ${t('session.retry.capNote', { limit: RETRY_QUEUE_LIMIT })}`
              : ''}
          </p>
        </div>
      )}

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

      {retryPhase ? (
        <SessionProgressBar
          answered={retryIndex}
          total={retryQueue.length}
          currentIndex={retryIndex}
        />
      ) : (
        <SessionProgressBar answered={answered} total={total} currentIndex={currentIndex} />
      )}

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
          ) : answerState._alreadyAnswered ? (
            // 409 ALREADY_ANSWERED(§2.1 정정) — 오답이 아니라 "이미 해결됨"이다.
            // 정오 배너를 그리면 틀렸다고 읽힌다.
            <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
              {answerState.feedback}
            </p>
          ) : (
            <>
              {/* 만회 결과(§2.1) — 서버 is_retry/retry_correct 실측만 읽는다.
                  "첫 시도 정답"과 "만회 성공"은 다른 사건이라 구분해 말한다. */}
              {answerState.is_retry && (
                <p
                  data-retry-result={answerState.retry_correct ? 'success' : 'fail'}
                  className={`mt-4 rounded-xl px-3 py-2 text-xs font-extrabold ${
                    answerState.retry_correct
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {answerState.retry_correct ? t('session.retry.success') : t('session.retry.fail')}
                </p>
              )}
              <ResultBanner result={answerState} />
            </>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            // 스모크가 문구가 아니라 역할로 이 버튼을 집는다(문구는 단계마다 바뀐다)
            data-session-next={retryPhase ? 'retry' : 'main'}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? t('session.finishing')
              : answerState._submitFailed
                ? outOfClouds
                  ? t('session.retryAfterRegen')
                  : t('common.retry')
                : retryPhase
                  ? isLastRetry
                    ? t('session.finish')
                    : t('session.retry.next')
                  : pendingRetryCount > 0
                    ? t('session.retry.start', { count: pendingRetryCount })
                    : isLastItem
                      ? t('session.finish')
                      : t('session.next')}
          </button>
          {!outOfClouds && !answerState._alreadyAnswered && (
            <FeedbackPanel
              message={answerState.feedback}
              isCorrect={answerState.is_correct}
              source={answerState.feedback_source}
            />
          )}
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

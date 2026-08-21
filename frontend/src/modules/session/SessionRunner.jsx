import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionApi } from '../../api';
import { SESSION_STATUS, useSessionStore } from '../../store/sessionStore';
import { useProgressStore } from '../../store/progressStore';
import { useAttendance } from '../../hooks/useAttendance';
import LoadingSpinner from '../../components/LoadingSpinner';
import FeedbackPanel, { FeedbackCard } from '../../components/FeedbackPanel';
import QuestionCard from '../quiz/QuestionCard';
import ResultBanner from '../quiz/ResultBanner';
import SessionProgressBar from './SessionProgressBar';
import SessionSummary from './SessionSummary';
import ClosingForecastStep from '../duel/ClosingForecastStep';
import { KNOWLEDGE_LEVEL_NAME, selectKnowledgeLevel } from '../../lib/abilityDisplay';
import { translate, useT } from '../../i18n';

/**
 * 문항의 **학습 수준 배지** (2026-08-12 클라이언트 지적 「학습 수준 태깅이 안 보인다」).
 *
 * 문항 1,000건 전건에 `knowledge_level`이 채워져 있는데도 화면 어디에도 안 떴다.
 * 데이터가 없던 게 아니라 **통로가 없었다** — 세션 응답 스키마에 필드가 없었다.
 *
 * ⚠️ **명칭표를 여기서 짓지 않는다.** 10단계 이름의 단일 소유자는
 * `i18n/resources/{ko,en}.js`의 `ability.knowledgeLevel.name`이고, 이 컴포넌트는
 * `lib/abilityDisplay.js`의 `KNOWLEDGE_LEVEL_NAME`(그 리소스 파생 사전)만 읽는다.
 * /me 화면의 KnowledgeLevelCard와 **같은 사전을 본다** — 두 화면이 같은 단계를
 * 다른 이름으로 부르는 일이 구조적으로 불가능하다.
 *
 * 값이 없으면(구 세션·단계 미분류 문항·유닛/배치 세션) **아무것도 그리지 않는다** —
 * 빈 배지도 "?"도 금지다(board의 DifficultyBadge와 같은 관례).
 * `selectKnowledgeLevel`이 정수 아님·0 이하를 전부 null로 접어 준다.
 */
function ItemKnowledgeLevelBadge({ item }) {
  const t = useT();
  const picked = selectKnowledgeLevel(item);
  if (!picked) return null;
  const name = KNOWLEDGE_LEVEL_NAME[picked.level];
  if (!name) return null; // 리소스에 없는 단계(N 확장 중) — 지어내지 않고 감춘다
  return (
    <span
      data-knowledge-level={picked.level}
      aria-label={t('session.knowledgeLevelAria', { level: picked.level, name })}
      className="mb-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600"
    >
      {t('session.knowledgeLevel', { name })}
    </span>
  );
}

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
 *   - renderSummary(summary, items): 완료 요약 렌더(기본 SessionSummary)
 *     ⚠️ `items`를 두 번째 인자로 넘기는 이유 — 유닛 완료 화면이 **블록 구분**
 *     (실황·신규·복습·오늘의 하늘)을 그리려면 kind가 붙은 문항 목록이 필요하다.
 *     `summary`만 넘기던 종전에는 유닛 세션이 10문항 데일리 배합을 받아도
 *     **무슨 구성인지 화면이 말할 방법이 없었다**.
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
 * 만회 큐 — **상한이 없다**(2026-08-12 클라이언트 확정: "만회 라운드는 만회할
 * 때까지 계속 기회를 줘, 유닛을 한 번 시도에 무조건 종료되도록").
 *
 * ⚠️ 종전에는 `RETRY_QUEUE_LIMIT = 5`가 있었고 그 근거가 **「15문항 + 만회
 * 무제한이면 최악 30문항이라 피로 유발」**이었다. 그 근거는 낡았다:
 * 배합이 15 → **10문항**(`SESSION_RECIPE = {live:2,new:4,review:3,board:1}`)으로
 * 줄었고 유닛 세션은 **4문항**(`UNIT_SESSION_SIZE`)이다. 4문항짜리 유닛에서
 * 만회 무제한의 최악은 8~12문항이라 피로 논거가 성립하지 않는다.
 *
 * 상한을 걷은 **적극적 이유**는 피로 계산이 아니라 학습 계약이다: 한 번 유닛에
 * 들어가면 **틀린 것을 다 맞힐 때까지 그 안에서 끝낸다**. 상한이 있으면 6번째
 * 오답부터는 "틀린 채로 종료"가 되어, 왕관 판정(all_resolved)이 실력이 아니라
 * 오답 개수에 좌우된다.
 *
 * ⚠️ 상한이 없으므로 **종료 조건이 유일한 안전장치**다(§만회 종료 조건 — handleNext).
 * 서버 `is_retry_eligible`(= `is_correct is False and retry_correct is not True`)이
 * False가 되는 문항은 409 ALREADY_ANSWERED로 돌아오고, 그 문항을 큐에서 빼지
 * 않으면 화면이 영영 안 끝난다.
 */

/**
 * 오답 quiz_id 목록 → 만회 큐 (계약용 순수 함수).
 * **전건**이고 출제 순서를 보존한다. 중복만 접는다(같은 문항이 두 자리를
 * 차지하면 진행 표기의 분모가 실제 대상 수와 어긋난다).
 */
export function retryQueueOf(wrongIds) {
  if (!Array.isArray(wrongIds)) return [];
  return [...new Set(wrongIds)];
}

/**
 * 만회 탈출구가 열리는 **바퀴 수**(2026-08-12 클라이언트 확정).
 *
 * 왜 필요한가: 상한이 없으므로 **채점이 잘못된 문항**이 큐에 들어오면 학습자가
 * 맞는 답을 내도 계속 오답 처리되어 세션이 영영 안 끝난다. 가상의 위험이 아니다 —
 * 이 저장소는 `lint_seed_items` 초록 상태에서 채점 결함 2건(오독이 정답 처리 ·
 * 맞는 답이 오답 처리)이 발견된 이력이 있다(CARRYOVER_R13 §1.1e).
 *
 * 값이 3인 근거:
 *  · **시도 총량 = 1(최초) + 3(만회) = 4회.** 유닛 세션이 4문항이므로 한 문항에
 *    4번은 "포기가 아니라 충분히 붙어 본" 양이다.
 *  · **해설을 3번 읽은 뒤에 열린다.** 만회 실패 화면은 매번 FeedbackPanel로
 *    해설을 이미 띄운다 — 탈출구는 "안 본 해설을 보여주는 문"이 아니라 "세 번
 *    읽고도 안 되면 놓아 주는 문"이다. 1~2였다면 해설을 읽기 전에 눌러 버리는
 *    회피 통로가 되어 클라이언트가 고른 「만회할 때까지」의 취지가 죽는다.
 *  · **상한 폐지의 근거를 훼손하지 않는다.** 상한 5는 "5번째 오답부터 틀린 채
 *    종료"라 실력이 아니라 오답 **개수**로 결과가 갈렸다. 이 상수는 개수가 아니라
 *    **같은 문항의 반복 실패**에만 걸리므로 그 결함이 되살아나지 않는다.
 *
 * ⚠️ **리터럴로 흩뿌리지 말 것.** 화면·테스트 모두 이 상수에서 파생시킨다 —
 * 값을 바꾸면 스모크가 함께 따라가야 계약이지 상수 대조가 아니다.
 */
export const RETRY_MERCY_ROUNDS = 3;

/**
 * 「모르겠어요」 센티널 (2026-08-19 클라이언트 지시 — 배치고사 문항 스킵).
 *
 * **와이어 형식**: 스킵한 문항은 답안 `answer`에 이 문자열을 담아 보낸다. 서버는
 * 이것을 **오답으로 채점**한다(안 푼 것이 아니라 틀린 것 — 그래야 θ 배정이 그
 * 문항을 못 본 것으로 취급하지 않는다).
 *
 * ⚠️ **값의 소유자는 백엔드의 `PLACEMENT_SKIP_SENTINEL`이고 여기는 그 사본이다.**
 * 프론트·목(`mock/apiMockPlugin.js`)·서버 **세 자리가 같은 리터럴**이어야 하며,
 * 그 정합은 목 담당이 계약 테스트로 문다. 값을 바꾸려면 세 자리를 함께 바꾼다.
 *
 * ⚠️ **새 필드를 만들지 않는다.** 서버 답안 스키마가 `extra='forbid'`라 `skipped`
 * 같은 플래그를 얹으면 요청 **전체**가 422가 된다 — 한 문항의 스킵이 세션의 전
 * 문항을 날린다. 그래서 스킵은 기존 `answer` 필드에 태워 보낸다.
 *
 * ⚠️ **빈 문자열은 금지다.** 목의 slider 채점이 `Number('')` = 0으로 접어서
 * 정답 0 근방의 문항을 **정답으로** 판정한다 — 스킵이 정답이 되는 정반대 결과다.
 */
export const PLACEMENT_SKIP_SENTINEL = '__skip__';

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

  // ── 만회 라운드(R13-01 §2.1) · **상한 없음**(2026-08-12) ───────────────────
  // wrongIds: 틀린 문항 quiz_id(출제 순서 보존). 이번 자리에서 틀린 것 **+ 재진입
  //   복원분**(CO-A5 — 서버 SessionItem.is_correct).
  // retryQueue: **아직 해결되지 않은** 만회 대상. 머리(=[0])가 지금 푸는 문항이고,
  //   만회에 실패하면 꼬리로 돌아간다(다음 바퀴에 다시 나온다). 길이가 0보다 크면
  //   만회 라운드 진행 중이라는 뜻이고(retryPhase), **0이 되는 것이 유일한 종료**다.
  //   인덱스 포인터를 두지 않는 이유: 무제한 반복에서는 "몇 번째"가 아니라
  //   "무엇이 남았는가"가 상태다 — 포인터와 큐가 두 벌이면 어긋난다.
  // retryTotal: 라운드 진입 시점의 대상 수(진행 표기의 분모. 반복해도 안 늘어난다).
  // retryFails: quiz_id → **만회에 실패한 횟수**(= 그 문항으로 돈 바퀴 수).
  //   RETRY_MERCY_ROUNDS에 닿으면 그 문항에 「해설 보고 넘어가기」 탈출구가 열린다.
  //   ⚠️ 실패 **횟수**여야 한다(큐를 돈 횟수가 아니라): 큐에 5문항이 있으면 한
  //   바퀴에 5번 제출이 일어나므로 "회전 수"로 세면 문항별 고집과 무관해진다.
  const [wrongIds, setWrongIds] = useState([]);
  const [retryQueue, setRetryQueue] = useState([]);
  const [retryTotal, setRetryTotal] = useState(0);
  const [retryFails, setRetryFails] = useState({});
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
    setRetryTotal(0);
    setRetryFails({});
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
      } else if (result.retry_correct === false && variables?.quizId) {
        // 만회 실패 1건 적립 — RETRY_MERCY_ROUNDS에 닿으면 탈출구가 열린다.
        // **여기서 센다**(handleNext가 아니라): 탈출구는 실패 피드백 화면에 함께
        // 떠야 하고, 그 화면은 이 응답이 만든다.
        setRetryFails((prev) => ({
          ...prev,
          [variables.quizId]: (prev[variables.quizId] ?? 0) + 1,
        }));
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
      // 503 BOARD_RULES_UNAVAILABLE(보드 문항 전용) — 규칙 파일 부재·스키마 오류.
      // detail이 `rules[0](tropical_cyclone_genesis): phenomenon 'typhoon' enum 밖`
      // 같은 내부 진단 문자열이라 그대로 찍으면 학습자가 규칙 배열 인덱스를 본다.
      // ⚠️ 이 문구는 **BoardPage와 같은 키**를 쓴다 — 같은 503을 두 화면이 다른
      //    말로 설명하면 같은 판이 화면마다 다른 사고처럼 보인다.
      const rulesUnavailable = err.code === 'BOARD_RULES_UNAVAILABLE';
      if (outOfClouds) queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      showFeedback({
        is_correct: false,
        correct_answer: null,
        feedback: alreadyAnswered
          ? t('session.retry.alreadyResolved')
          : rulesUnavailable
            ? t('board.page.rulesUnavailable')
            : (err.detail ?? t('session.submitFailed')),
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
   * 복원 조건은 **`is_correct === false && retry_correct !== true`**로,
   * 서버 `answer_service.is_retry_eligible`과 **글자 그대로 같은 식**이다
   * (`backend/app/services/answer_service.py:67` · 목 `apiMockPlugin.js:1878`).
   *
   * ⚠️ 2026-08-12 이전에는 `retry_correct == null`(= 만회를 아직 안 해 본 것)이라는
   * **진부분집합**이었고, 그 근거가 §2.11의 "성공·실패 모두 한 번씩만"이었다.
   * 만회가 무제한이 되면서 그 근거가 사라졌다 — 이제 **만회에 실패한 문항은
   * 새로고침 뒤에도 다시 나와야 한다**(안 그러면 새로고침이 "다 맞힐 때까지"를
   * 우회하는 통로가 된다). 두 식이 같아진 덕에 이 큐가 409를 맞는 경우도
   * 구조적으로 사라졌다(전에는 한쪽 방향의 어긋남만 안전했다).
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
      .filter((it) => it.is_correct === false && it.retry_correct !== true)
      .map((it) => it.quiz_id);
    if (restored.length > 0) {
      // 이번 자리에서 이미 쌓인 것이 있으면 그쪽이 최신이다(복원은 최초 1회뿐).
      setWrongIds((prev) => (prev.length > 0 ? prev : restored));
      // 만회 실패 이력도 되살린다 — `retry_correct === false`는 **최소 1바퀴는
      // 돌았다**는 서버의 증언이다. 정확한 횟수는 서버에 없으므로 1로 접는다:
      // 새로고침이 탈출구 카운터를 통째로 0으로 되돌려 "고쳐지지 않는 문항"에
      // 다시 처음부터 갇히는 것보다 낫다. (과대 계상은 구조적으로 불가 — 1이
      // 하한이다.) 라이브 카운트가 있으면 그쪽이 최신이라 건드리지 않는다.
      setRetryFails((prev) =>
        Object.keys(prev).length > 0
          ? prev
          : Object.fromEntries(
              (session.items ?? [])
                .filter((it) => it.retry_correct === false)
                .map((it) => [it.quiz_id, 1]),
            ),
      );
      // 본문이 이미 끝나 있었다 = 만회 라운드에서 이탈했다는 뜻이다.
      // 큐를 세워 두면 아래 자동완료가 `retryPhase`로 막힌다.
      const loaded = session.progress ?? {};
      if ((loaded.total ?? 0) > 0 && (loaded.answered ?? 0) >= loaded.total) {
        const queue = retryQueueOf(restored);
        setRetryQueue(queue);
        setRetryTotal(queue.length);
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
  // 본문 진행에만 쓰이고 그대로 마지막 문항에 머문다. 지금 푸는 것은 **큐의 머리**다.
  const retryTarget = retryPhase
    ? (items.find((it) => it.quiz_id === retryQueue[0]) ?? null)
    : null;
  const currentItem = retryPhase ? retryTarget : (items[currentIndex] ?? null);
  // 보드 문항인가 — 아래 2열 접기와 `QuestionCard`의 `layout="wide"`가 이 하나를
  // 보고 갈린다. 판정 기준을 `question_type` 하나로 두는 이유는 세션·보드 화면이
  // 같은 값을 쓰기 때문이다(문항 유형 7종의 소유자는 `content_items`).
  const isBoardItem = currentItem?.question_type === 'board';
  const isLastItem = currentIndex + 1 >= items.length;
  // 이번 만회로 라운드가 끝나는가 = 큐에 이것 하나뿐이고 **이번에 맞혔다**.
  // 상한이 없으므로 "마지막 문항"이라는 위치 개념은 없다 — 틀리면 다시 나온다.
  const isLastRetry = retryQueue.length === 1 && answerState?.retry_correct === true;
  // 탈출구가 열렸는가 — **지금 화면의 만회 실패**가 그 문항의 N번째 실패일 때만.
  // 성공·409·제출 실패 화면에는 뜨지 않는다(넘어갈 이유가 없거나 판단 근거가 없다).
  const mercyOpen =
    retryPhase &&
    status === SESSION_STATUS.FEEDBACK &&
    answerState?.is_retry === true &&
    answerState?.retry_correct === false &&
    (retryFails[retryQueue[0]] ?? 0) >= RETRY_MERCY_ROUNDS;
  // 마지막 문항 피드백 화면에서 확정되는 만회 대상 수 — 버튼 문구를 "세션 마치기"가
  // 아니라 "놓친 N문항 만회하기"로 바꾸는 근거(만회가 있다는 걸 미리 알린다).
  const pendingRetryCount = !retryPhase && isLastItem ? retryQueueOf(wrongIds).length : 0;

  /**
   * 큐 머리가 **이 세션의 문항이 아닐 때** 빼낸다 — 무한 루프 방지 ③.
   *
   * 복원분·오답 목록은 quiz_id 문자열이라, 세션 응답이 그 문항을 더 이상 싣지
   * 않으면(재발급·부분 응답 등) `retryTarget`이 null이 되고 QuestionCard가
   * 아무것도 그리지 못한 채 라운드가 멈춘다 — 화면에는 오류도 안 뜬다.
   * 큐가 비면 아래 자동완료 이펙트가 세션을 닫는다.
   */
  useEffect(() => {
    if (!retryPhase || items.length === 0) return;
    if (items.some((it) => it.quiz_id === retryQueue[0])) return;
    setRetryQueue((q) => q.slice(1));
  }, [retryPhase, retryQueue, items]);

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

  /**
   * 「모르겠어요」 — 배치고사 문항 스킵(2026-08-19 클라이언트 지시).
   *
   * 하는 일은 **답안으로 센티널을 제출하는 것뿐**이다. 별도 경로를 만들지 않고
   * `handleSubmit`을 타는 이유가 계약이다: 스킵도 `advanceBulk`로 `answered`를
   * 올려야 마지막 문항 뒤 일괄 제출(finalizeBulk) 이펙트가 발화한다
   * (`answered >= total`). 「수집하지 않고 인덱스만 넘김」으로 만들면 진단이
   * 영영 끝나지 않거나 문항 누락으로 complete가 409가 된다.
   *
   * ⚠️ `bulkMode` 가드가 **이 기능이 일반 세션(daily·unit)으로 새지 않게 하는
   * 유일한 지점**이다(렌더 게이트와 짝). 일반 세션은 문항마다 서버 채점·구름
   * 소모·만회 라운드가 붙으므로, 센티널이 그쪽으로 새면 안 푼 문항이 오답으로
   * 기록되면서 만회 큐에까지 들어간다. 가드를 **두 겹으로 만들지 않았다** —
   * 한 겹을 깨면 계약 테스트가 반드시 울어야 하기 때문이다.
   */
  const handleSkip = () => {
    if (!bulkMode) return;
    handleSubmit(PLACEMENT_SKIP_SENTINEL);
  };

  /**
   * 만회 큐 머리를 처리하고 다음 상태로 넘긴다 — 큐를 만지는 **유일한 통로**.
   * keepHead=true면 꼬리로 돌린다(다음 바퀴에 다시 나온다), false면 큐에서 뺀다.
   * 큐가 비면 그 자리에서 세션을 닫는다(§만회 종료 조건).
   */
  const advanceRetryQueue = ({ keepHead }) => {
    const head = retryQueue[0];
    const rest = retryQueue.slice(1);
    const next = keepHead ? [...rest, head] : rest;
    setRetryQueue(next);
    if (next.length === 0) completeMutation.mutate();
    else retryItem(); // answerState 비우고 IN_PROGRESS 복귀(전이는 기존 액션 재사용)
  };

  /**
   * 「해설 보고 넘어가기」(2026-08-12 클라이언트 확정) — 만회 탈출구.
   *
   * 같은 문항에서 RETRY_MERCY_ROUNDS 바퀴를 실패했을 때만 버튼이 뜨고, **학습자가
   * 스스로 눌러야** 발동한다(자동 스킵 금지 — 자동이면 「만회할 때까지」가 아니라
   * 그냥 상한이다). 해설은 이 화면에 이미 떠 있으므로(FeedbackPanel/FeedbackCard)
   * 새로 그릴 것이 없다 — 하는 일은 **큐에서 빼는 것뿐**이다.
   *
   * ⚠️ **서버에 아무것도 보내지 않는다.** 만회 제출이 구름 0·XP 0이라 해도, 안 푼
   * 문항을 푼 것으로 만들면 `all_resolved`가 거짓이 된다. 이 문항은 서버에
   * `is_correct=false · retry_correct=false`로 **미해결인 채** 남고, 화면 문구
   * (`session.retry.mercyNote`)도 그렇게 말한다.
   */
  const handleMercySkip = () => {
    if (!retryPhase || status !== SESSION_STATUS.FEEDBACK || isSubmitting) return;
    advanceRetryQueue({ keepHead: false });
  };

  const handleNext = () => {
    if (status !== SESSION_STATUS.FEEDBACK || isSubmitting) return;
    if (answerState?._submitFailed) {
      retryItem();
      return;
    }
    // ══ 만회 라운드 진행 중(§2.1) — **다 맞힐 때까지 반복한다**(2026-08-12) ══
    //
    // 종료 조건은 **큐가 비는 것 하나뿐**이고, 머리가 큐에서 빠지는 경우는 셋이다:
    //   ① `retry_correct === true`   — 만회 성공. 해결됐으므로 뺀다.
    //   ② `_alreadyAnswered`(409)    — 서버 `is_retry_eligible`이 False라는 뜻이다
    //      (최초 정답·이미 만회 성공). **이걸 안 빼면 화면이 영영 안 끝난다** —
    //      다시 내도 또 409라 큐가 줄지 않는다. 무한 루프 방지의 본체.
    //   ③ 큐 머리가 이 세션 문항이 아님 — 위 이펙트가 뺀다(방어적).
    // 만회 실패(`retry_correct === false`)는 **꼬리로 돌린다** — 남은 문항을 한
    // 바퀴 돈 뒤 다시 나온다. 서버가 그 문항을 계속 만회 가능으로 두므로
    // (`is_correct is False and retry_correct is not True`) 재제출은 200이다.
    // 제출 실패(네트워크·5xx)는 위 `_submitFailed` 분기가 먼저 받는다 — 큐를
    // 건드리지 않고 같은 문항을 다시 낼 뿐이다(답안 유실 없음).
    if (retryPhase) {
      const resolved =
        answerState?.retry_correct === true || answerState?._alreadyAnswered === true;
      advanceRetryQueue({ keepHead: !resolved });
      return;
    }
    if (isLastItem) {
      // 마지막 문항 뒤 = 만회 라운드 진입 지점. **오답 전건**이 들어온다(상한 없음).
      const queue = retryQueueOf(wrongIds);
      if (queue.length > 0) {
        setRetryQueue(queue);
        setRetryTotal(queue.length);
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
          <div className="fixed left-[calc(50%_+_var(--wm-shell-left)/2)] top-16 z-50 -translate-x-1/2 animate-toast-pop rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
            {crownToast}
          </div>
        )}
        {renderSummary ? renderSummary(summary, items) : <SessionSummary summary={summary} items={items} />}
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
  // 해설을 그리는 조건. 넓은 화면 카드(「다음 문항」 위)와 좁은 화면 고정 말풍선이
  // **떨어진 두 자리**에 있어서(2026-08-19 순서 교체) 조건을 한 곳이 갖는다 —
  // 한쪽만 고치면 화면 폭에 따라 해설이 뜨거나 안 뜨는 차이가 조용히 생긴다.
  // 구름 소진·409는 각자 전용 안내를 그리므로 그 위에 해설을 겹치지 않는다.
  const showExplanation = !outOfClouds && !answerState?._alreadyAnswered;

  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-slate-900">{title ?? t('session.title')}</h1>
        <span className="text-sm font-medium text-slate-500">
          {retryPhase
            ? // 분모는 라운드 진입 시점의 대상 수, 분자는 **해결한 수 + 1**이다.
              // 만회에 실패하면 분자가 안 움직인다 — 실제로 아직 그 자리이므로.
              t('session.retry.itemCount', {
                current: Math.min(retryTotal - retryQueue.length + 1, Math.max(retryTotal, 1)),
                total: Math.max(retryTotal, retryQueue.length),
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
          {/* 상한 안내(`session.retry.capNote`)가 있던 자리 — 상한이 없어졌으므로
              **그리지 않는다**(키도 삭제됐다). 대신 그 자리에서 말해야 하는 것은
              「다 맞힐 때까지 이어진다」이고, 그것이 아래 `untilAllCorrect`다.
              데이터 속성으로 집는다 — 문구는 저작으로 바뀌지만 "이 줄이 있다"는
              계약이다(상한 폐지를 화면이 실제로 말하는지의 유일한 증거). */}
          <p className="mt-0.5 text-[11px] leading-relaxed text-indigo-500">
            {t('session.retry.note')}
          </p>
          <p
            data-retry-until-all-correct=""
            className="mt-0.5 text-[11px] font-bold leading-relaxed text-indigo-600"
          >
            {t('session.retry.untilAllCorrect')}
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
          answered={retryTotal - retryQueue.length}
          total={Math.max(retryTotal, retryQueue.length)}
          currentIndex={retryTotal - retryQueue.length}
        />
      ) : (
        <SessionProgressBar answered={answered} total={total} currentIndex={currentIndex} />
      )}

      {/* 문항 위 칩 줄 — 실황 반영 · 학습 수준. 둘 다 없으면 줄 자체가 비고
          `gap`만 남으므로 레이아웃이 밀리지 않는다(빈 배지를 그리지 않는 계약). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {currentItem?.slot_filled && (
          <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
            {t('session.slotFilled')}
          </p>
        )}
        <ItemKnowledgeLevelBadge item={currentItem} />
      </div>

      {/* 2열(2026-08-11 사용자 지시) — **왼쪽 문항 / 오른쪽 정답·해설**.
          답을 고르기 전에도 두 열을 유지한다: 제출하는 순간 열이 생기면 문항
          카드가 절반으로 줄며 화면이 통째로 흔들린다. 오른쪽은 그때까지
          "고르면 여기에 나와요" 한 줄만 들고 있는다.
          lg 미만은 종전 그대로 한 줄로 쌓인다(해설은 아래 고정 말풍선).

          ⚠️ **배치고사(bulkMode)는 1열 그대로다.** 두 가지가 동시에 깨진다:
          (a) 배치고사는 Layout 밖(`/onboarding/placement`)이라 컨테이너가
              `max-w-xl`(576px)뿐이다 — 2열로 쪼개면 문항이 264px이 된다.
              Layout.jsx:62가 셸을 넓힌 이유가 바로 이 폭 문제다.
          (b) 배치고사는 문항별 채점이 없어(:380 handleSubmit 단락) status가
              FEEDBACK에 **영원히 닿지 않는다** — 오른쪽 열은 "답을 고르면
              여기에…"만 든 채 끝까지 비어 있게 된다. */}
      {/* ⚠️ **보드 문항은 2열을 접는다**(2026-08-19 사용자 지시). 보드는 판
          자체가 2열(조작 / 관찰)이라 절반 폭에 넣으면 지도가 눌린다 — 보드
          화면(`/board`)이 셸을 넓게 쓰는 이유와 같다(Layout.jsx의 isBoard).
          해설은 판 아래로 쌓이는데, 그것도 보드 화면과 같은 순서다.
          짝: `QuestionCard`가 보드에 `layout="wide"`를 준다. */}
      <div className={bulkMode || isBoardItem ? undefined : 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-4'}>
      <div className="min-w-0">
      <QuestionCard
        question={currentItem}
        disabled={status !== SESSION_STATUS.IN_PROGRESS || isSubmitting}
        onSubmit={handleSubmit}
        answerResult={status === SESSION_STATUS.FEEDBACK ? answerState : null}
      />

      {isSubmitting && status === SESSION_STATUS.IN_PROGRESS && (
        <LoadingSpinner label={t('session.grading')} />
      )}

      {/* 「모르겠어요」(2026-08-19 클라이언트 지시) — **배치고사에서만**.
          🔴 게이트는 `bulkMode` 하나다. `SessionRunner`는 daily·unit과 공유되고
          그쪽에는 XP·구름·만회 라운드가 붙으므로 새면 파급이 크다. bulkMode의
          유일한 사용처가 배치고사(PlacementPage)이고 이 컴포넌트의 docstring이
          그것을 「배치고사 전용」이라고 이미 소유한다 — 그래서 여기서 조건을
          새로 짓지 않고 그 하나에 얹는다.

          위치: 유형별 제출 버튼은 `QuestionCard` 안에 5곳 흩어져 있으므로 그
          아래 **공용 자리에 한 번만** 둔다. 객관식은 선택지 클릭이 곧 제출이라
          (QuestionCard) 버튼이 선택지 **아래**에 와야 「고르지 않고도 넘어갈 수
          있다」로 읽힌다.

          문구: 페이지 전체를 이탈하는 헤더의 「건너뛰기 →」(placement.skip)와
          **같은 낱말을 쓰지 않는다** — 문항 하나를 넘기는 버튼과 진단을 통째로
          버리는 버튼이 같은 말이면 학습자가 구별할 수 없다. 아래 note가 오답
          처리라는 것도 미리 말한다(눌러 놓고 나중에 아는 일이 없게). */}
      {bulkMode && status === SESSION_STATUS.IN_PROGRESS && currentItem && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleSkip}
            disabled={isSubmitting}
            data-session-skip=""
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-500 transition hover:border-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('placement.dontKnow')}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            {t('placement.dontKnowNote')}
          </p>
        </div>
      )}
      </div>

      {/* 오른쪽 열 — 정답·해설. 답을 고르기 전에는 자리만 지킨다(lg 이상에서만). */}
      <div className="min-w-0">
      {!bulkMode && status !== SESSION_STATUS.FEEDBACK && (
        <p className="hidden rounded-2xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-400 ring-1 ring-slate-200 lg:block">
          {t('session.answerHere')}
        </p>
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
          {/* 🔴 **해설이 「다음 문항」보다 위다**(2026-08-19 사용자 지시 — 종전에는
              배너 → 버튼 → 해설 순이라 해설을 읽기 전에 버튼이 먼저 눈에 들어왔다).
              읽고 나서 넘어가는 순서로 뒤집는다.
              ⚠️ 좁은 화면 몫(`lg:hidden` FeedbackPanel)은 **같이 올리지 않는다** —
              그쪽은 `fixed bottom-14` 오버레이라 DOM 순서가 화면에 안 보이는 대신,
              같이 딸린 `h-40` 자리막이는 흐름에 있다. 그걸 버튼 위로 올리면 좁은
              화면에서 버튼이 160px 아래로 밀린다. 그래서 lg 카드만 여기로 온다. */}
          {showExplanation && (
            <div className="mt-4 hidden lg:block">
              <FeedbackCard
                message={answerState.feedback}
                isCorrect={answerState.is_correct}
                source={answerState.feedback_source}
              />
            </div>
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
          {/* 만회 탈출구(2026-08-12) — N바퀴 실패한 문항에만, **주 CTA 아래 작게**.
              위 버튼("다음 만회 문항 →")이 여전히 기본값이다: 넘어가기는 학습자가
              스스로 고르는 부차 선택지여야 「만회할 때까지」의 취지가 산다.
              해설은 이미 떠 있다 — 넓은 화면은 **버튼 위**(FeedbackCard, 2026-08-19
              순서 교체), 좁은 화면은 화면 아래 고정 말풍선(FeedbackPanel). */}
          {mercyOpen && (
            <div data-session-mercy="" className="mt-2 text-center">
              <button
                type="button"
                onClick={handleMercySkip}
                disabled={isSubmitting}
                className="text-xs font-bold text-slate-500 underline transition hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('session.retry.mercy')}
              </button>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                {t('session.retry.mercyNote')}
              </p>
            </div>
          )}
          {/* 좁은 화면 몫만 남는다 — 넓은 화면 카드는 위 「다음 문항」 **앞**으로
              옮겼다(2026-08-19). 둘은 같은 본문(FeedbackBubble)을 그린다. */}
          {showExplanation && (
            <div className="lg:hidden">
              <FeedbackPanel
                message={answerState.feedback}
                isCorrect={answerState.is_correct}
                source={answerState.feedback_source}
              />
              {/* 고정 말풍선이 가리는 만큼의 바닥 여백 — 오버레이가 없는
                  넓은 화면에는 필요 없다. */}
              <div className="h-40" />
            </div>
          )}
        </>
      )}
      </div>
      </div>

      {/* 이탈 인텐트 확인 1단(§3.5) */}
      {/* 이탈 다이얼로그의 「남은 수」는 **지금 무엇을 하고 있는가**에 달렸다
          (2026-08-12). 만회 중에는 본문을 다 답했으므로 `total - answered`가 0이고,
          그러면 "조금만 더 하면 끝나요"가 떴다 — 거짓이다. 만회 중 남은 것은
          **큐에 남은 만회 문항 수**이고, 그것을 다 맞혀야 세션이 끝난다. */}
      {leaveIntent && (
        <LeaveIntentDialog
          onStay={stay}
          onLeave={leave}
          remaining={retryPhase ? retryQueue.length : Math.max(0, total - answered)}
          retryPhase={retryPhase}
        />
      )}
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
      // 센티널 회수(P2-1) — **`back()`이 아니라 `replaceState`로 마커만 지운다**
      // (2026-08-21 정정). 종전엔 `history.back()`을 썼는데, React 18
      // StrictMode(dev)가 이 effect를 마운트→cleanup→재마운트로 **두 번** 태우면
      // 1차 cleanup의 `back()`이 비동기로 큐잉된 채 남아 있다가, 2차 마운트가
      // 유닛 세션을 정상 렌더한 **직후** 뒤늦게 실행돼 브라우저를 실제로 한 칸
      // 뒤로 보냈다 — 화면이 0.2초 렌더됐다 `/learn`으로 튕기는 것으로 관측됐다
      // (실측: 유닛 클릭 → 문항 2/10 렌더 → 즉시 /learn 복귀). `back()`은 실제
      // 내비게이션이라 얼마나 걸릴지 우리가 못 정하지만, `replaceState`는 URL을
      // 안 바꾸고 **동기로** 끝나 그 경쟁이 생길 자리가 없다.
      // **최상단 항목이 우리 센티널일 때만** 지운다 — 그 사이 다른 화면으로
      // 이동했다면(그만두기 등) 최상단은 라우터의 항목이고, 남의 히스토리를
      // 건드리면 안 된다(그 경우는 leave()의 replace가 처리한다).
      if (!sentinel) return;
      try {
        if (window.history.state?.wmLeaveGuard) {
          const { wmLeaveGuard, ...rest } = window.history.state;
          window.history.replaceState(rest, '');
        }
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
function LeaveIntentDialog({ onStay, onLeave, remaining, retryPhase = false }) {
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
        <p
          id="leave-intent-desc"
          data-leave-phase={retryPhase ? 'retry' : 'main'}
          className="mt-1.5 text-sm leading-relaxed text-slate-500"
        >
          {retryPhase
            ? t('session.leave.retryRemaining', { remaining })
            : remaining > 0
              ? t('session.leave.remaining', { remaining })
              : t('session.leave.almost')}
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

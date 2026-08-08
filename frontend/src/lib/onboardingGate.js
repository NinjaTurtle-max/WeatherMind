import { create } from 'zustand';
// core만 import — index.js(zustand)를 끌면 mock의 순수 node 경로가 죽는다(core.js 주석)
import { translate, getCurrentLocale } from '../i18n/core.js';

/** 접근 시점의 현재 로케일로 리소스 키를 푼다(§6.3 라벨 외부화 — ko 값 바이트 동일) */
function tNow(key, params) {
  return translate(getCurrentLocale(), key, params);
}

/**
 * 온보딩 게이트 (R10-01 §3.4 — S4 / R10-D·R10-F)
 *
 * ⚠️ **2026-08-08 (CO-N-1 ③): 잠금 해제 단계는 UI 소비자가 없다.**
 * `components/FeatureUnlockGate`는 삭제됐고 Layout의 축하 토스트 렌더도 끊겼다 —
 * 심사 배점 ②(체험·참여형)가 요구하는 "콜드 오픈에서 바로 만져 볼 수 있음"과
 * 세션 1·2·3회 해제 사다리가 정면으로 충돌했기 때문이다. 남은 소비자는
 * **`DAILY_GOAL_CHOICES`(일일 목표 선택지)뿐**이고, 아래 단계 계산
 * (`UNLOCK_STAGE_BY_TAB`·`selectUnlockStage`·`isUnlocked`·`requiredStage`·
 * 토스트 예약)은 지금 아무 화면도 읽지 않는다. **재게이팅을 하지 않을 것이
 * 확정되면 이 절반은 지워야 한다** — 이월 대장에 남기려고 여기 적어 둔다.
 *
 * 두 가지를 한 모듈에 모은다:
 *   1) 일일 목표 선택지(3·5·9) — 서버 계약(PUT /progress/daily-goal, D4)의 허용값.
 *   2) 첫 화면 점진적 잠금 해제 단계 — **프론트 표시 계층 전용**이다.
 *      서버 권한이 아니다(§3.4 명시): 라우트는 그대로 열려 있고 딥링크도 막지
 *      않는다. 서버에 "세션 완료 횟수" 카운터가 없으므로(/progress/me·/dev/state
 *      어디에도 없음) 세션 완료를 로컬에 기록해 단계를 센다.
 *      ~~**차단이 아니라 동기 부여**~~ — 그 동기 부여 화면(FeatureUnlockGate)은
 *      2026-08-08에 삭제됐다. 탭바가 전 탭 활성이라는 것만 그대로다.
 *
 * 해제 조건(§3.4 표):
 *   학습(/)·내 정보(/me) = 처음부터 · 보드 = 세션 1회 · 예보 대결 = 2회 · 리그 = 3회.
 *
 * **기존 사용자 회귀 0**(§3.4 요구):
 *   로컬 기록이 없는 계정(=이미 쓰고 있던 사용자, 또는 스토리지를 비운 사용자)은
 *   /progress/me의 진척 흔적으로 1회 부트스트랩해 전부 해제 상태로 시작한다.
 *   판별은 `hasPriorProgress` — 배치고사는 XP를 주지 않으므로(backend
 *   answer_service.submit_answers_bulk 주석 + routers/session.py placement 분기:
 *   XP·스트릭·퀘스트 전부 스킵) `xp > 0`은 "채점된 비배치 응답이 최소 1건"과 같다.
 *   부트스트랩 전(=/progress/me 미도착)에는 **열린 상태로 가정**한다 — 기존
 *   사용자에게 잠금이 한 번 번쩍이는 회귀를 만들지 않는 쪽이 안전(fail-open).
 */

/**
 * 일일 목표 선택지 (§3.4·D4 — 허용값 {3,5,9}, 그 밖은 서버가 422 VALIDATION_ERROR)
 * label·caption은 리소스(`dailyGoal.*`) 파생 getter — export 형태(객체 배열의
 * 문자열 속성)는 유지하고, 소비처(DailyGoalPicker — useT 구독)의 리렌더 시점에
 * 현재 로케일로 풀린다. ko 값은 종전과 바이트 동일.
 */
export const DAILY_GOAL_CHOICES = [3, 5, 9].map((items) => ({
  items,
  get label() {
    return tNow(`dailyGoal.choiceLabel.${items}`);
  },
  get caption() {
    return tNow('dailyGoal.choiceCaption', { items });
  },
}));

/** 라우트 경로 → 필요한 세션 완료 횟수. 표에 없는 경로는 0(처음부터 열림). */
export const UNLOCK_STAGE_BY_TAB = {
  '/board': 1,
  '/duel': 2,
  '/league': 3,
};

/** 전부 해제되는 단계 */
export const MAX_UNLOCK_STAGE = Math.max(...Object.values(UNLOCK_STAGE_BY_TAB));

// 해제 축하 토스트(§3.4 `unlock.*`)는 **삭제됐다**(CO-N-1 ③, 2026-08-08) —
// 해제 사다리가 없어져 "🧩 대기 보드가 열렸어요!"가 일어나지 않은 일을 알리는
// 문구가 됐다. 리소스 키도 함께 지웠다(고아 키를 남기지 않는다 — CO-D6).

const STORAGE_KEY = 'weathermind-onboarding-gate';
const MAX_TRACKED_SESSIONS = 8; // 멱등용 id 캡 — 단계는 MAX_UNLOCK_STAGE에서 포화

const EMPTY = {
  userKey: null, // 계정 식별자(user_id) — 바뀌면 기록을 버린다(계정 전환)
  bootstrapped: false, // /progress/me로 기존 사용자 여부를 판정했는가
  experienced: false, // 기존 사용자(진척 있음) → 전부 해제
  sessionIds: [], // 완료를 센 세션 id(멱등 — 재렌더로 중복 집계되지 않게)
};

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // SSR·프라이버시 모드 — 게이트는 메모리 전용으로 동작
  }
}

function loadPersisted() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      userKey: parsed.userKey ?? null,
      bootstrapped: Boolean(parsed.bootstrapped),
      experienced: Boolean(parsed.experienced),
      sessionIds: Array.isArray(parsed.sessionIds) ? parsed.sessionIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function persist(next) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userKey: next.userKey,
        bootstrapped: next.bootstrapped,
        experienced: next.experienced,
        sessionIds: next.sessionIds,
      }),
    );
  } catch {
    // 저장 실패는 기능을 막지 않는다(표시 계층) — 세션 동안 메모리로만 유지
  }
}

/**
 * 진척 흔적 판별(기존 사용자 = 전부 해제). /progress/me 페이로드를 읽는다.
 * xp>0: 배치고사는 XP를 주지 않으므로 "비배치 채점 응답 1건 이상"과 동치.
 * units_cleared>0 / streak>1 / level>1: 하루 이상 써 온 계정의 흔적.
 */
export function hasPriorProgress(me) {
  if (!me) return false;
  return (
    (me.xp ?? 0) > 0 ||
    (me.spine?.units_cleared ?? 0) > 0 ||
    (me.streak_count ?? 0) > 1 ||
    (me.level ?? 1) > 1
  );
}

/** 현재 해제 단계(0~MAX). 부트스트랩 전에는 fail-open(전부 해제). */
export function selectUnlockStage(state) {
  if (!state.bootstrapped) return MAX_UNLOCK_STAGE;
  if (state.experienced) return MAX_UNLOCK_STAGE;
  return Math.min(MAX_UNLOCK_STAGE, state.sessionIds.length);
}

/** 경로에 필요한 단계(0이면 처음부터 열림) */
export function requiredStage(to) {
  return UNLOCK_STAGE_BY_TAB[to] ?? 0;
}

/** 표시 계층 판정 — stage가 조건을 충족했는가 */
export function isUnlocked(stage, to) {
  return stage >= requiredStage(to);
}

export const useOnboardingGate = create((set, get) => ({
  ...EMPTY,
  ...(loadPersisted() ?? {}),

  /**
   * /progress/me 도착 시 1회 부트스트랩. 계정이 바뀌면 기록을 버리고 다시 판정한다.
   * 이미 부트스트랩된 계정에서는 아무것도 하지 않는다 — 이후 xp가 오르는 것은
   * "기존 사용자"의 근거가 아니라 이번 사용자의 진행이므로 단계를 건너뛰게 하면
   * 잠금 해제 순서가 무의미해진다.
   */
  syncFromProgress: (me, userKey = null) => {
    if (!me) return;
    const state = get();
    const keyChanged = userKey != null && state.userKey !== userKey;
    if (state.bootstrapped && !keyChanged) return;
    const next = {
      userKey: userKey ?? state.userKey,
      bootstrapped: true,
      experienced: hasPriorProgress(me),
      sessionIds: keyChanged ? [] : state.sessionIds,
    };
    set(next);
    persist(next);
  },

  /** 세션 완료 1건 기록(멱등). 단계 계산에만 쓰인다(소비 화면 없음 — 위 ⚠️ 참고). */
  recordSessionComplete: (sessionId) => {
    const state = get();
    if (!sessionId) return;
    const id = String(sessionId);
    if (state.experienced || state.sessionIds.includes(id)) return;
    const sessionIds = [...state.sessionIds, id].slice(-MAX_TRACKED_SESSIONS);
    const next = { ...state, sessionIds };
    set({ sessionIds });
    persist(next);
  },

  /** 로그아웃·테스트용 초기화 */
  reset: () => {
    const store = storage();
    try {
      store?.removeItem(STORAGE_KEY);
    } catch {
      // 무시 — 메모리 상태만 되돌린다
    }
    set({ ...EMPTY });
  },
}));

/**
 * 세션 러너 3일차 스모크 (R13-01 §2.1 만회 · §2.11 상한 5 · §2.10 블록 표기 ·
 * R13 A-1 마감 단계) — node tests/sessionRetry.smoke.test.mjs
 *
 * 가드하는 계약 4축:
 *  1. 만회 성공 → 왕관. 오답 문항만 재제출이 열리고(is_retry/retry_correct),
 *     **구름 무소모·XP 무가산**이며, 전건 해결(all_resolved)이 왕관 판정값이다.
 *     최초 정답 문항·이미 만회 성공한 문항의 재제출은 **409 ALREADY_ANSWERED**
 *     (§2.1 BE-1 실측 정정 — 초안의 "409 아님"은 계약 문서 오류였다).
 *  2. **만회 무제한**(2026-08-12 클라이언트 확정 — 종전 「상한 5」 폐기). 오답이 N개면
 *     만회 대상도 N개이고, **다 맞힐 때까지** 큐가 돌며(실패하면 꼬리로 가서 다시
 *     나온다) 큐가 비면 그때 종료된다. 서버는 원래 상한을 강제하지 않았고
 *     (`is_retry_eligible = is_correct is False and retry_correct is not True`),
 *     상한을 걸던 쪽이 프론트였다. 무제한의 유일한 안전장치는 **종료 조건**이라
 *     여기서 세 갈래를 전부 실측한다: 성공 → 뺀다 / 실패 → 다시 나온다 /
 *     409 ALREADY_ANSWERED → **뺀다**(안 빼면 화면이 영영 안 끝난다).
 *  3. 15문항 완료 화면 구분 표기(§2.10) — kind(new/review/live/unit)를
 *     오늘의 발견/복습/실황/진도로. 진도 블록은 항상 마지막 5문항이다.
 *  4. 예보 마감 단계(R13 A-1). closing_step이 있으면 완료 화면 뒤에 붙고,
 *     **null이면 세션은 15문항으로 정상 완료**된다(null 조건 하나가 KMA 부재라
 *     여기서 완주를 막으면 무키 동작 계약이 깨진다). 정산은 대상일 **다음 날**.
 *
 * 방법: 앞부분(정답 키 수집·서버 계약)은 목 API에 직접 왕복하고, 뒷부분(만회 큐·
 * 표기·마감 단계)은 jsdom 실마운트로 화면을 몬다. 정답 키는 **한 번 전건 오답으로
 * 제출해 correct_answer를 회수**한 뒤 /dev/reset-me로 되돌려 만든다 — 픽스처에
 * 정답을 박지 않으므로 시드가 바뀌어도 따라간다.
 *
 * 관례: 테스트 러너 의존 없음(node 직접 실행), review-queue.smoke.test.mjs와 동일한
 * vite middlewareMode + apiMockPlugin + jsdom 배선.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

// ── mock API 서버 ───────────────────────────────────────────────────────────
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const { default: apiMockPlugin, __mockPolicy } = await import('../mock/apiMockPlugin.js');
// 배합 총합은 **목 정책에서 파생**한다 — 숫자를 박으면 배합이 바뀔 때 계약이 아니라
// 상수가 깨진다(실제로 15가 박혀 있어 10문항 전환에서 그렇게 됐다).
// `__mockPolicy`는 서버 Settings와 대조되는 값이라(backend test_r13_mock_policy_parity)
// 여기서 읽으면 사본이 늘지 않는다.
const MOCK_POLICY = {
  session_recipe_total: Object.values(__mockPolicy().session_recipe).reduce((a, b) => a + b, 0),
};

const vite = await createServer({
  root,
  logLevel: 'error',
  plugins: [apiMockPlugin()],
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const httpServer = http.createServer(vite.middlewares);
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${httpServer.address().port}`;

async function api(method, path, body) {
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ── jsdom 전역 배선 (react 모듈 로드 전에) ──────────────────────────────────
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${origin}/`,
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
// 한국어 문구를 단정하므로 로케일을 ko로 고정(러너 navigator.language 무관)
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.XMLHttpRequest = window.XMLHttpRequest;
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;

// XHR 관찰 — "몇 문항을 제출했는가"를 문구가 아니라 실호출로 센다
const xhrLog = [];
const origXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  xhrLog.push(`${method} ${url}`);
  return origXhrOpen.call(this, method, url, ...rest);
};

const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack ?? e.message)));

// ── React 마운트 ────────────────────────────────────────────────────────────
const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const SessionPage = (await vite.ssrLoadModule('/src/modules/session/SessionPage.jsx')).default;
const SessionSummary = (await vite.ssrLoadModule('/src/modules/session/SessionSummary.jsx')).default;
const ClosingForecastStep = (await vite.ssrLoadModule('/src/modules/duel/ClosingForecastStep.jsx'));
const { retryQueueOf, RETRY_MERCY_ROUNDS } = await vite.ssrLoadModule('/src/modules/session/SessionRunner.jsx');
const SessionRunnerMod = await vite.ssrLoadModule('/src/modules/session/SessionRunner.jsx');
const SessionRunner = SessionRunnerMod.default;
const FeedbackPanel = (await vite.ssrLoadModule('/src/components/FeedbackPanel.jsx')).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 조건이 truthy가 될 때까지 폴링하고 **그 값**을 돌려준다. */
async function waitFor(fn, label = '', timeoutMs = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = fn();
    if (last) return last;
    await sleep(30);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element, initialPath = '/daily') {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 } },
  });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: [initialPath] }, element)),
  );
  return reactRoot;
}

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

// React 18 제어 입력에 값 주입(네이티브 setter + input 이벤트) — placementEntry 관례
function setInputValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    .set.call(input, String(value));
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const text = () => window.document.body.textContent ?? '';

/** 지금 화면에 떠 있는 문항의 quiz_id (QuestionCard가 "#{quiz_id}"로 찍는다) */
function currentQuizId() {
  const el = [...window.document.querySelectorAll('span')].find(
    (s) => s.textContent?.startsWith('#') && s.textContent.length > 5 && s.children.length === 0,
  );
  return el ? el.textContent.slice(1) : null;
}

let failed = 0;
async function scenario(name, fn) {
  const mark = xhrLog.length;
  try {
    await fn(mark);
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
    console.error(`  이후 XHR: ${JSON.stringify(xhrLog.slice(mark).slice(-12))}`);
    if (pageErrors.length) console.error(`  page errors: ${pageErrors.slice(-2).join(' | ')}`);
  }
}
const since = (mark) => xhrLog.slice(mark);
const answerCalls = (mark) => since(mark).filter((l) => /POST .*\/session\/.*\/answer$/.test(l)).length;

// ── 정답 키 회수: 전건 오답 1회전 → correct_answer 수집 → 상태 되돌리기 ──────
const ANSWER_KEY = new Map(); // quiz_id → {type, options, correct}

// ── board 문항 제출 페이로드 (2026-08-12, SPRINT_R13_02 §T3) ────────────────
// 배합에 「오늘 날씨 반영 보드」 1문항이 들어오면서 이 스모크가 board를 만나게 됐다.
// board는 `answer` 문자열이 아니라 **`board_state`로 채점**되므로(없으면 422
// BOARD_STATE_REQUIRED) 정답표(ANSWER_KEY)에 담기지 않는다 — 대신 여기 둔다.
//
// 통과 상태는 **목 board 문항의 실제 팔레트에서 나왔다**. 그 문항은
// `density_buoyancy`이고 팔레트가 `['sun','moisture']` — **배치 요소가 없고 조절값
// 둘뿐**이다. 목표 `[{zone:1, phenomenon:'shower'}]`은 `board_rules.json`의
// `convective_shower`(`sun>=80` · `moisture>=60`)로 성립한다.
// ⚠️ 처음엔 `cold_front_shower`(한랭전선 배치)로 잡았는데, API 채점은 통과하지만
// **화면에서는 재현할 수 없었다** — 팔레트에 전선이 없어 놓을 칩 자체가 없다.
// 규칙이 바뀌면 공유 벡터를 읽는 `test:board`가 먼저 운다.
const BOARD_ZONES = ['서해', '수도권', '태백산맥', '동해안'];
const BOARD_SUN_PASS = 85;      // convective_shower 임계 sun>=80
const BOARD_MOISTURE_PASS = 75; // convective_shower 임계 moisture>=60
const BOARD_STATE_PASS = {
  zones: BOARD_ZONES,
  elements: [
    { type: 'sun', level: BOARD_SUN_PASS, zone: 1 },
    { type: 'moisture', level: BOARD_MOISTURE_PASS, zone: 1 },
  ],
};
// 형식은 유효하지만 목표를 못 만드는 상태 — "의도적 오답"의 board 판본.
// (빈 배치는 boardEngine.validateBoardState가 허용한다 — boardEntryGate 스모크 선례.)
const BOARD_STATE_FAIL = { zones: BOARD_ZONES, elements: [] };
/** harvest에서 만난 board 문항 id — 화면 조작기가 분기 근거로 쓴다. */
const BOARD_QUIZ_IDS = new Set();

/** 문항 1건의 제출 바디 — board면 board_state, 아니면 answer 문자열. */
function answerBody(item, wantCorrect) {
  if (item.question_type === 'board') {
    return {
      quiz_id: item.quiz_id,
      board_state: wantCorrect ? BOARD_STATE_PASS : BOARD_STATE_FAIL,
    };
  }
  const k = ANSWER_KEY.get(item.quiz_id);
  assert(k, `정답 키에 없는 문항: ${item.quiz_id}`);
  return { quiz_id: item.quiz_id, answer: wantCorrect ? String(k.correct) : '__의도적_오답__' };
}

/**
 * 유닛 세션 문항 1건의 제출 바디 (2026-08-13).
 *
 * 왜 생겼나: **유닛 세션에도 board 문항이 들어왔다**(마지막 자리). 아래 1b·1b-2는
 * 전건을 `answer: '__의도적_오답__'` 문자열로 냈는데, board는 `board_state`로
 * 채점되므로 그 제출이 **422 BOARD_STATE_REQUIRED**로 떨어졌다 — `is_correct`가
 * undefined가 되어 "의도적 오답이 정답 판정됐다"는 **엉뚱한 메시지**로 붉어졌다.
 * daily 배합이 board를 받았을 때 `answerBody`가 한 일과 같은 처치이고
 * (SPRINT_R13_02 §T3), 여기서 유닛 판을 따로 두는 이유는 정답표의 출처가 다르기
 * 때문이다: `ANSWER_KEY`는 **daily 세션**에서 회수한 것이라 유닛 문항 id가 없다.
 *
 * board 통과 상태는 daily와 **같은 값이 통한다**(실측: 유닛 board도 팔레트
 * `['sun','moisture']` · 목표 `[{zone:1, phenomenon:'shower'}]`). 규칙이 갈라지면
 * 공유 벡터를 읽는 `test:board`가 먼저 운다.
 */
function unitBody(item, wantCorrect, key) {
  if (item.question_type === 'board') {
    return {
      quiz_id: item.quiz_id,
      board_state: wantCorrect ? BOARD_STATE_PASS : BOARD_STATE_FAIL,
    };
  }
  return {
    quiz_id: item.quiz_id,
    answer: wantCorrect ? String(key.get(item.quiz_id)) : '__의도적_오답__',
  };
}

/**
 * 유닛 세션이 board를 **싣고 있다**는 사실을 기록한다.
 *
 * 위 처치는 board를 올바르게 답할 뿐이라, board가 유닛 세션에 들어온 것 자체가
 * 조용히 묻힐 수 있다. 그건 제품 사실이므로 눈에 보이게 둔다 — 없어지면 여기가
 * 먼저 울고, 그때 유닛 세션 구성이 다시 바뀐 것인지 판정하면 된다.
 */
function assertUnitHasBoard(items, where) {
  const boards = items.filter((it) => it.question_type === 'board');
  assert(boards.length === 1,
    `${where}: 유닛 세션의 board 문항이 1건이어야 한다 — ${boards.length}건. ` +
    '유닛 세션 구성이 바뀌었다면 unitBody의 board 분기를 다시 판정할 것.');
}

async function resetMe() {
  const r = await api('POST', '/dev/reset-me', { reset: true });
  assert(r.status === 200, `/dev/reset-me 실패: ${r.status}`);
}

async function harvestAnswerKey() {
  const { data: s } = await api('GET', '/session/today');
  for (const item of s.items) {
    // ── board는 수집 대상이 아니다 (2026-08-12, SPRINT_R13_02 §T3) ──────────
    // 배합에 「오늘 날씨 반영 보드」 1문항이 들어오면서 이 루프가 board까지 훑게
    // 됐는데, board 제출은 `answer` 문자열이 아니라 **`board_state`를 요구**한다
    // (없으면 422 BOARD_STATE_REQUIRED — 구름 소모 **전** 판정이라 잔량도 안 움직인다).
    // 그래서 `data.is_correct`가 undefined가 되어 아래 단정이 "정답으로 채점됐다"는
    // **엉뚱한 메시지로** 실패했다. 정답표(correct_answer)라는 개념 자체가 board에
    // 없으므로 — 판정은 배치 규칙(goal_conditions)이 한다 — 여기서 건너뛴다.
    // 뒤따르는 구름 단정이 왜곡되지 않는 근거: 목의 §3.1 순서가 422를 구름 소모
    // **전**에 내므로, 건너뛰든 422를 받든 잔량은 동일하다(담당 H 실측).
    if (item.question_type === 'board') {
      BOARD_QUIZ_IDS.add(item.quiz_id);
      continue;
    }

    const { data } = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: item.quiz_id,
      answer: '__의도적_오답__', // 어떤 유형에서도 정답이 될 수 없는 문자열(slider는 NaN)
    });
    assert(data.is_correct === false, `${item.quiz_id}: 의도적 오답이 정답으로 채점됐다`);
    ANSWER_KEY.set(item.quiz_id, {
      type: item.question_type,
      options: item.options ?? [],
      // match(pairs)·ordering(items) 위젯 조작에 필요한 원본 페이로드.
      // 정답성 필드는 여기 없다 — 정답은 채점 응답(correct_answer)에서만 온다.
      payload: item.template_json ?? {},
      correct: data.correct_answer,
    });
  }
  await resetMe();
}

/**
 * 화면의 board 문항을 실제로 푼다 (2026-08-12).
 *
 * 목 board 문항은 팔레트가 `['sun','moisture']`이라 **놓을 칩이 없고 조절값만 있다**.
 * `AtmosphereBoard`는 팔레트가 허용한 조절값만 존 카드 안에 `ZoneSlider`로 그리고,
 * 그 순서는 코드가 고정한 `moisture → sun → wind`다(팔레트로 걸러진 뒤에도 이 순서).
 * 그래서 존 1 카드의 range 입력을 **라벨이 아니라 순서로** 집는다.
 *
 * 정답 상태는 `BOARD_STATE_PASS`와 같은 값(sun 85 · moisture 75)이고,
 * 오답은 아무것도 건드리지 않는 것이다(기본값 50/50 → cloudy → 목표 미달).
 */
/**
 * ⚠️ 여기 있던 `boardZoneCard()`(슬라이더를 품은 존 카드를 찾는 헬퍼)는 걷었다
 * (2026-08-19) — 세션 board가 wide 배치가 되면서 **그런 카드가 없어졌다**.
 * 남겨 두면 다음 사람이 "왜 항상 null이지" 하며 그 함수를 고치려 든다.
 * 그때 적어 둔 관찰은 아래 helper로 옮겼다: `data-board-zone`은 SVG 노드와
 * 카드 **두 곳**에 붙으므로 `querySelector` 하나로 집으면 헛짚는다.
 */

/**
 * ⚠️ **세션의 board 문항이 2026-08-19에 wide 배치가 됐다**(사용자 지시 — 보드
 * 화면과 같은 꼴). 그러면서 조절값의 자리가 바뀌었다:
 *   · 종전(쌓는 배치): 존마다 카드가 있고 그 **안에** 슬라이더 2개
 *   · 지금(wide):      지도에서 존을 고르면 **옆 패널**에 그 존의 슬라이더 2개
 * 그래서 `boardZoneCard(1)`(= 슬라이더를 품은 존 카드)이 영영 안 나타나 8초
 * 기다리다 죽었다. 존을 **고르는 절차**를 넣고 슬라이더는 패널에서 찾는다.
 */
function boardRangeKnobs() {
  return [...window.document.querySelectorAll('input[type="range"]')];
}

async function answerBoardOnScreen(wantCorrect) {
  await waitFor(() => window.document.querySelector('[data-board-zone]'), 'board 존');
  await sleep(150); // 마운트 effect의 board 초기화가 조작을 덮지 않도록
  if (wantCorrect) {
    // 존 1(수도권)을 고른다 — wide 배치의 조절값 패널은 **고른 존**의 것이다.
    const zone = [...window.document.querySelectorAll('[data-board-zone="1"]')].pop();
    assert(zone, '존 1을 찾지 못했다');
    click(zone);
    await sleep(80);
    await waitFor(() => boardRangeKnobs().length >= 2, '존 1 조절값 슬라이더');
    const knobs = boardRangeKnobs();
    assert(knobs.length === 2,
      `존 1 조절값이 2개(moisture·sun)여야 한다 — ${knobs.length}. 팔레트가 바뀌었나?`);
    setInputValue(knobs[0], BOARD_MOISTURE_PASS); // levelKnobs 순서 ① moisture
    await sleep(40);
    setInputValue(knobs[1], BOARD_SUN_PASS);      // ② sun
    await sleep(40);
  }
  const submit = [...window.document.querySelectorAll('button')]
    .find((b) => !b.disabled && /제출/.test(b.textContent ?? ''));
  assert(submit, 'board 제출 버튼을 찾지 못했다');
  click(submit);
}

/** 화면의 현재 문항에 정답/오답을 넣는다(유형별 실제 위젯 조작). */
async function answerOnScreen(quizId, wantCorrect) {
  // board는 ANSWER_KEY에 없다 — `board_state`로 채점되므로 정답표 개념이 없다.
  if (BOARD_QUIZ_IDS.has(quizId)) return answerBoardOnScreen(wantCorrect);
  const k = ANSWER_KEY.get(quizId);
  assert(k, `정답 키에 없는 문항: ${quizId}`);
  if (k.type === 'multiple_choice') {
    const target = wantCorrect ? String(k.correct) : k.options.find((o) => String(o) !== String(k.correct));
    const btn = [...window.document.querySelectorAll('button')].find(
      (b) => b.textContent.replace(/^\s*\d+\s*/, '').trim() === String(target).trim(),
    );
    assert(btn, `선지 버튼 못 찾음: ${target}`);
    click(btn);
    return;
  }
  if (k.type === 'short_answer' || k.type === 'cloze') {
    const input = window.document.querySelector('input[type="text"]');
    assert(input, '텍스트 입력 없음');
    setInputValue(input, wantCorrect ? String(k.correct) : '__의도적_오답__');
    await sleep(30);
    input.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    return;
  }
  if (k.type === 'slider') {
    const input = window.document.querySelector('input[type="range"]');
    assert(input, '슬라이더 없음');
    const min = Number(input.min);
    const max = Number(input.max);
    const correct = Number(k.correct);
    // 오답은 정답에서 **가장 먼 끝**으로 — 허용 오차(tolerance)를 확실히 벗어난다
    const wrong = Math.abs(min - correct) >= Math.abs(max - correct) ? min : max;
    setInputValue(input, wantCorrect ? correct : wrong);
    await sleep(30);
    const btn = [...window.document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('이 값으로 제출'),
    );
    assert(btn, '슬라이더 제출 버튼 없음');
    click(btn);
    return;
  }
  if (k.type === 'match') {
    // 제출 형식 "left:right|left:right" (§3.6). 좌 버튼 → 우 버튼 순으로 짝짓는다.
    const pairs = String(k.correct).split('|').map((seg) => {
      const i = seg.indexOf(':');
      return [seg.slice(0, i).trim(), seg.slice(i + 1).trim()];
    });
    assert(pairs.length >= 2 || wantCorrect, 'match 오답을 만들려면 짝이 2개 이상이어야 한다');
    const pick = (attr, value) =>
      [...window.document.querySelectorAll(`[${attr}]`)].find(
        (el) => el.getAttribute(attr) === value,
      );
    for (let i = 0; i < pairs.length; i += 1) {
      // 오답은 **한 칸 회전**한 짝 — 어떤 짝도 맞지 않는다(부분 정답 없음).
      const right = wantCorrect ? pairs[i][1] : pairs[(i + 1) % pairs.length][1];
      const leftBtn = pick('data-match-left', pairs[i][0]);
      assert(leftBtn, `match 좌항 버튼 없음: ${pairs[i][0]}`);
      click(leftBtn);
      await sleep(20);
      const rightBtn = pick('data-match-right', right);
      assert(rightBtn, `match 우항 버튼 없음: ${right}`);
      click(rightBtn);
      await sleep(20);
    }
    click(await waitFor(() => submitButton(), 'match 제출 버튼(전건 연결 후 활성)'));
    return;
  }
  if (k.type === 'ordering') {
    // 제출 형식 "0,2,1,3" = **원본 인덱스 순열**(§3.6). 화면에는 텍스트만 있으므로
    // template_json.items(원본 순서)로 텍스트 → 원본 인덱스를 되짚고, ▲ 버튼으로
    // 목표 자리까지 한 칸씩 올린다(앞에서부터 확정하므로 확정분은 흐트러지지 않는다).
    const src = k.payload?.items ?? [];
    assert(src.length > 0, 'ordering 원본 items가 정답 키에 없다');
    const target = String(k.correct).split(',').map((n) => Number(n.trim()));
    for (let pos = 0; pos < target.length; pos += 1) {
      for (let guard = 0; ; guard += 1) {
        const rows = orderingRows();
        const cur = rows.map((r) => src.indexOf(r.text));
        const j = cur.indexOf(target[pos]);
        assert(j >= 0, `ordering 항목을 화면에서 못 찾음(원본 ${target[pos]})`);
        if (j === pos) break;
        assert(guard < 40, 'ordering 정렬이 수렴하지 않는다');
        click(rows[j].up);
        await sleep(15);
      }
    }
    if (!wantCorrect) {
      // 정답 배열을 만든 뒤 맨 앞 두 개를 뒤집는다 — 완전 일치 요구라 확실한 오답.
      const rows = orderingRows();
      assert(rows.length >= 2, 'ordering 오답을 만들려면 항목이 2개 이상이어야 한다');
      click(rows[1].up);
      await sleep(15);
    }
    click(await waitFor(() => submitButton(), 'ordering 제출 버튼'));
    return;
  }
  throw new Error(`스모크가 다루지 않는 유형: ${k.type} (${quizId}) — 목 배합이 바뀌었다`);
}

/** 활성화된 공용 제출 버튼(match·ordering이 공유하는 t('quiz.submit') = "제출") */
function submitButton() {
  return [...window.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === '제출' && !b.disabled,
  );
}

/** ordering 행 목록 — [{text, up}] (▲ 버튼에서 행을 거슬러 올라간다) */
function orderingRows() {
  return [...window.document.querySelectorAll('button')]
    .filter((b) => b.textContent.trim() === '▲')
    .map((up) => {
      const row = up.parentElement?.parentElement;
      return { text: row?.children?.[1]?.textContent?.trim() ?? '', up };
    });
}

/** 문항 1건 진행: 등장 대기 → 답안 → 피드백 → 다음 버튼 반환(클릭은 호출자 몫) */
async function playItem(expectedQuizId, wantCorrect) {
  await waitFor(() => currentQuizId() === expectedQuizId, `문항 ${expectedQuizId} 등장 (현재=${currentQuizId()})`);
  await answerOnScreen(expectedQuizId, wantCorrect);
  return waitFor(
    () => window.document.querySelector('[data-session-next]'),
    `문항 ${expectedQuizId} 피드백 → 다음 버튼`,
  );
}

try {
  await harvestAnswerKey();

  // ── 1. 만회 라운드 서버 계약: 오답만 열리고 · 구름/XP 0 · 전건 해결 → 왕관 ──
  await scenario('만회 성공 → 왕관 (구름 무소모 · XP 무가산 · 최초 기록 불변)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    // 틀릴 자리는 **인덱스를 박지 않고 배합에서 고른다**(2026-08-12): 배합이
    // 15 → 10으로 줄면서 옛 인덱스 {1,4,9}의 9번이 board(마지막)를 가리키게 됐다.
    // board는 `board_state`로 채점되므로 "의도적 오답 문자열"이 통하지 않는다.
    // 앞쪽 비board 3건을 고르면 배합이 또 바뀌어도 따라간다.
    const wrongAt = new Set(
      s.items.flatMap((it, i) => (it.question_type === 'board' ? [] : [i])).slice(0, 3),
    );
    const TOTAL = s.items.length;
    const results = [];
    for (const [i, item] of s.items.entries()) {
      const { data } = await api(
        'POST', `/session/${s.session_id}/answer`, answerBody(item, !wrongAt.has(i)),
      );
      assert(data.is_correct === !wrongAt.has(i), `${item.quiz_id}: 채점이 의도와 다르다`);
      assert(data.is_retry !== true, '최초 제출인데 is_retry가 붙었다');
      results.push(data);
    }

    // 최초 정답 문항의 재제출은 만회 대상이 아니다 → 409
    // 틀린 자리를 배합에서 고르게 바꾸면서 s.items[0]이 오답 후보가 됐다 —
    // 409(ALREADY_ANSWERED)를 보려면 **최초 정답** 문항을 골라야 한다.
    const okItem = s.items.find((it, i) => !wrongAt.has(i));
    assert(okItem, '최초 정답 문항이 하나도 없다 — 배합/오답 선택이 어긋났다');
    const re = await api('POST', `/session/${s.session_id}/answer`, answerBody(okItem, true));
    assert(re.status === 409 && re.data.code === 'ALREADY_ANSWERED',
      `최초 정답 재제출은 409 ALREADY_ANSWERED여야 한다 — 받은 값: ${re.status}/${re.data?.code}`);

    // 오답 3건 만회 — 구름 잔량은 만회 전후로 움직이지 않아야 한다
    const cloudsBefore = results[results.length - 1].clouds;
    for (const i of [...wrongAt]) {
      const item = s.items[i];
      const { data } = await api('POST', `/session/${s.session_id}/answer`, answerBody(item, true));
      assert(data.is_retry === true, `${item.quiz_id}: is_retry=true가 아니다`);
      assert(data.retry_correct === true, `${item.quiz_id}: retry_correct=true가 아니다`);
      assert(data.xp_earned === 0, '만회에 XP가 붙었다 — 파밍 차단 계약 위반');
      assert(data.clouds_spent === 0, '만회에서 구름이 소모됐다 — 만회는 벌이 아니다');
      assert(data.clouds === cloudsBefore, '만회로 구름 잔량이 움직였다');
    }

    // 이미 만회로 해결한 문항의 또 다른 재제출도 409
    const againItem = s.items[[...wrongAt][0]];
    const again = await api('POST', `/session/${s.session_id}/answer`, answerBody(againItem, true));
    assert(again.status === 409 && again.data.code === 'ALREADY_ANSWERED',
      '만회 성공 문항의 재제출은 409여야 한다');

    const { data: done } = await api('POST', `/session/${s.session_id}/complete`);
    assert(done.correct_count === TOTAL - wrongAt.size,
      `correct_count는 **최초 정답 수** ${TOTAL - wrongAt.size}여야 한다 — ${done.correct_count}`);
    assert(done.all_resolved === true, '전건 해결인데 all_resolved가 false다');
    assert(done.retry_resolved_count === wrongAt.size,
      `retry_resolved_count ${wrongAt.size} 기대 — ${done.retry_resolved_count}`);
  });

  // ── 1a. 서버 기본값 5필드가 **어느 갈래에서도** 응답에 있다 ────────────────
  // 왜 생겼나(2026-08-20): 목이 `...(phenomena ? { phenomena } : {})` ·
  // `...(placementResult ?? {})`로 **필드를 통째로 지우고** 있었다. 서버는
  // `AnswerResult.phenomena=None · is_retry=False · retry_correct=None`,
  // `SessionCompleteResult.abilities=None · placement_done=None`을 **항상 싣는다**.
  // 같은 목이 `closing_step`에 대해 이미 못박아 둔 기준이 근거다 —
  // *「null이지만 필드는 있어야 한다. 없으면 화면이 `undefined`와 `null`을 구분
  // 못 한다」*. 새 규칙이 아니라 그 기준을 다섯에 똑같이 적용한 것이다.
  // ⚠️ `in`으로 묻는다 — `!== true` 같은 값 검사는 필드가 **없어도** 통과한다
  //    (실제로 위 시나리오의 `data.is_retry !== true`가 부재를 못 봤다).
  await scenario('🔴 서버 기본값 5필드가 어느 갈래에서도 응답에 실린다 (undefined ≠ null)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const plain = s.items.find((it) => it.question_type !== 'board');
    assert(plain, '비board 문항이 없다 — 배합이 바뀌었다면 이 시나리오를 다시 판정할 것');

    // ⓐ 최초 제출(오답) 갈래 — 만회 두 필드와 phenomena가 서버 기본값으로 실린다
    const { data: first } = await api(
      'POST', `/session/${s.session_id}/answer`, answerBody(plain, false),
    );
    for (const [key, want] of [['is_retry', false], ['retry_correct', null], ['phenomena', null]]) {
      assert(key in first,
        `최초 제출 응답에 \`${key}\` 필드가 **없다** — 서버는 기본값을 싣는다. ` +
        '조건부 spread로 필드를 지우면 화면이 undefined와 null을 구분 못 한다.');
      assert(first[key] === want,
        `최초 제출 \`${key}\`가 서버 기본값 ${JSON.stringify(want)}이 아니다 — ${JSON.stringify(first[key])}`);
    }

    // ⓑ 만회 재제출 갈래 — 같은 세 필드가 **같이** 있어야 한다(갈래마다 모양이
    //    다르면 화면이 갈래를 먼저 알아내야 한다)
    const { data: retried } = await api(
      'POST', `/session/${s.session_id}/answer`, answerBody(plain, true),
    );
    assert(retried.is_retry === true && retried.retry_correct === true,
      '만회 갈래 배선이 깨졌다 — 아래 필드 검사의 전제가 성립하지 않는다');
    assert('phenomena' in retried,
      '만회 응답에 `phenomena` 필드가 **없다** — 최초 제출 갈래에만 있으면 모양이 갈린다');
    assert(retried.phenomena === null,
      `만회 \`phenomena\`가 null이 아니다 — ${JSON.stringify(retried.phenomena)}`);

    // ⓒ board 갈래 — `?? null`이 **실값을 덮지 않는다**는 반대편 가드.
    //    null 고정이 계약이 아니라 「필드가 항상 있다」가 계약이다.
    const board = s.items.find((it) => it.question_type === 'board');
    assert(board, 'board 문항이 없다 — 배합이 바뀌었다면 phenomena 실값 가드를 다시 둘 것');
    const { data: boardRes } = await api(
      'POST', `/session/${s.session_id}/answer`, answerBody(board, true),
    );
    assert(Array.isArray(boardRes.phenomena) && boardRes.phenomena.length > 0,
      `board 응답의 phenomena가 실값이 아니다 — ${JSON.stringify(boardRes.phenomena)}`);

    // ⓓ daily 완료 갈래 — 배치 전용 두 필드가 null로 실린다
    for (const item of s.items) {
      if (item.quiz_id === plain.quiz_id || item.quiz_id === board.quiz_id) continue;
      await api('POST', `/session/${s.session_id}/answer`, answerBody(item, true));
    }
    const { data: done } = await api('POST', `/session/${s.session_id}/complete`);
    for (const key of ['placement_done', 'abilities']) {
      assert(key in done,
        `daily 완료 응답에 \`${key}\` 필드가 **없다** — 서버 SessionCompleteResult는 ` +
        '배치 세션이 아니어도 기본값 None을 싣는다.');
      assert(done[key] === null,
        `daily 완료 \`${key}\`가 null이 아니다 — ${JSON.stringify(done[key])}`);
    }
  });

  // ── 1b. 만회로 해결한 유닛 세션은 왕관을 주지 않는다 ────────────────────────
  // ⚠️ **주석 정정(2026-08-12).** 종전 제목·주석은 「유닛 세션은 **연습 전용**이라
  // 왕관을 주지 않는다(§2.10 소유권 이전)」였다. 그 기술은 이제 거짓이다 —
  // 왕관은 2026-08-12 클라이언트 확정으로 **유닛 세션 완료가 소유**한다
  // (배합에서 `unit` kind가 빠져 daily 왕관 유입로가 닫힌 것의 대응).
  //
  // 그런데 이 시나리오는 여전히 초록이고, 그 이유가 계약이 아니다: **전 문항을
  // 의도적 오답으로 답한 뒤 만회로만 해결**하기 때문이다. 왕관 조건은
  // `all_correct`(**최초 시도** 만점)이므로 만회 경로에서는 0이 맞다.
  // 즉 이 시나리오가 지키는 것은 「연습 전용」이 아니라 **「만회는 왕관을 만들지
  // 않는다」**(파밍 차단)이고, 그 이름으로 고쳐 적는다.
  // 만점 경로의 왕관은 바로 아래 1b-2가 지킨다 — 종전에는 상주 가드가 없었다.
  await scenario('유닛 세션: 만회로만 해결하면 왕관 0 (최초 만점이 아니므로)', async () => {
    await resetMe();
    // reset-me는 유닛 진도까지 지워 선행 잠금이 되살아난다 — 전체 해제로 되돌린다
    await api('POST', '/dev/curriculum', { action: 'unlock_all' });
    const UNIT_ID = 'u0000002-0000-4000-8000-000000000002'; // 기단의 성질(quiz, 미클리어)
    const { status: us, data: u } = await api('POST', `/curriculum/units/${UNIT_ID}/session`);
    assert(us === 200 && Array.isArray(u.items), `유닛 세션 발급 실패: ${us} ${JSON.stringify(u)}`);
    assertUnitHasBoard(u.items, '1b');
    const key = new Map();
    for (const item of u.items) {
      const { data } = await api('POST', `/session/${u.session_id}/answer`, unitBody(item, false, key));
      assert(data.is_correct === false, `${item.quiz_id}(${item.question_type}): 유닛 문항이 의도적 오답에 정답 판정됐다`);
      key.set(item.quiz_id, data.correct_answer);
    }
    for (const item of u.items) {
      const { data } = await api('POST', `/session/${u.session_id}/answer`, unitBody(item, true, key));
      assert(data.is_retry === true && data.retry_correct === true, `${item.quiz_id} 만회 실패`);
    }
    const { data: done } = await api('POST', `/session/${u.session_id}/complete`);
    assert(done.unit_result, 'unit_result가 없다');
    assert(done.unit_result.all_correct === false,
      'all_correct는 **최초 시도 만점**이라는 뜻을 유지해야 한다(만회로 뒤집으면 안 된다)');
    assert(done.unit_result.all_resolved === true, 'all_resolved가 false다');
    assert(done.unit_result.crowns === 0 && done.unit_result.cleared === false,
      `유닛 직접 진입은 연습 전용이라 왕관이 없어야 한다 — ${JSON.stringify(done.unit_result)}`);
    assert(done.unit_result.unit_xp === 0, '연습 세션에 클리어 XP가 붙었다');
    assert(done.crown_award == null, '유닛 세션에서 daily 왕관 페이로드가 나왔다');
    assert(done.correct_count === 0, 'correct_count는 최초 정답 수(0) 그대로여야 한다');
    assert(done.retry_resolved_count === u.items.length, '만회 해결 수가 어긋난다');
  });

  // ── 1b-2. 유닛 세션 **최초 만점 → 왕관** (2026-08-12 소유권 복귀) ───────────
  // 왕관이 daily 진도 블록에서 유닛 세션으로 돌아온 뒤 **상주 가드가 없었다**
  // (담당 A가 수동으로만 확인). 여기가 그 자리다: 배합에서 진도 블록이 빠진 이상
  // 이 경로가 막히면 왕관이 **어디에서도** 나오지 않으므로, 학습 진도 전체가
  // 조용히 멈춘다 — 화면에는 아무 오류도 안 뜬다.
  await scenario('유닛 세션: 최초 시도 만점이면 왕관을 준다 (§2.10 소유권 복귀)', async () => {
    await resetMe();
    await api('POST', '/dev/curriculum', { action: 'unlock_all' });
    const UNIT_ID = 'u0000002-0000-4000-8000-000000000002'; // 기단의 성질(quiz, 미클리어)

    // 정답표를 먼저 회수한다 — 오답 1회로 correct_answer를 받고 진도를 되돌린다.
    // (harvestAnswerKey와 같은 수법. board는 정답표 개념이 없어 unitBody가 가른다.)
    const { data: probe } = await api('POST', `/curriculum/units/${UNIT_ID}/session`);
    assertUnitHasBoard(probe.items, '1b-2');
    const key = new Map();
    for (const item of probe.items) {
      const { data } = await api('POST', `/session/${probe.session_id}/answer`, unitBody(item, false, key));
      key.set(item.quiz_id, data.correct_answer);
    }
    await resetMe();
    await api('POST', '/dev/curriculum', { action: 'unlock_all' });

    // 본 시도 — 전건 **최초 정답**
    const { status, data: u } = await api('POST', `/curriculum/units/${UNIT_ID}/session`);
    assert(status === 200 && Array.isArray(u.items), `유닛 세션 발급 실패: ${status}`);
    for (const item of u.items) {
      const { data } = await api('POST', `/session/${u.session_id}/answer`, unitBody(item, true, key));
      assert(data.is_correct === true, `${item.quiz_id}(${item.question_type}): 정답표대로 냈는데 오답 판정`);
      assert(data.is_retry !== true, '최초 제출인데 is_retry가 붙었다');
    }
    const { data: done } = await api('POST', `/session/${u.session_id}/complete`);
    assert(done.unit_result, 'unit_result가 없다');
    assert(done.unit_result.all_correct === true,
      `최초 시도 만점인데 all_correct가 false다 — ${JSON.stringify(done.unit_result)}`);
    assert(done.unit_result.crowns >= 1,
      `최초 만점인데 왕관이 안 붙었다 — ${JSON.stringify(done.unit_result)}. ` +
      '진도 블록이 배합에서 빠진 뒤 이 경로가 유일한 왕관 유입로다.');
    assert(done.correct_count === u.items.length, '최초 정답 수가 전건이 아니다');

    // 재완료는 멱등 — 같은 진도에 왕관이 또 붙지 않는다(이중 수여 차단의 자리는
    // 라우터 분기가 아니라 grant_unit_crown의 crown_target 상한·cleared 1회 전환).
    const { data: again } = await api('POST', `/session/${u.session_id}/complete`);
    assert(again.unit_result.crowns === done.unit_result.crowns,
      `재완료로 왕관이 늘었다 — ${done.unit_result.crowns} → ${again.unit_result.crowns}`);
  });

  // ── 1c. 데일리 세션은 **왕관을 주지 않는다** (2026-08-12 소유권 재이전) ─────
  // ⚠️ 이 시나리오는 계약이 **반전됐다**. 종전 제목은 "진도 블록만 해결하면 나온다"
  // 였고, 서버 `_crown_scope_logs`가 `kind==='unit'` 문항만 왕관 판정 대상으로 삼는
  // 구조에 기대고 있었다. SPRINT_R13_02 §T3이 배합을
  // `{live:2,new:4,review:3,board:1}`로 바꾸면서 **`unit` kind가 배합에서 빠졌고**,
  // 그래서 daily 왕관 유입로는 판정 대상 0건이 되어 구조적으로 닫혔다.
  // 왕관은 **유닛 세션 완료**가 소유한다(클라이언트 확정 — 위 1b가 그 지점이다).
  //
  // 여기서 지키는 것은 그 사실이 **조용히** 성립하지 않게 하는 것이다: 진도 블록이
  // 배합에 돌아오면(env 롤백 포함) 이 단정이 즉시 깨져 왕관 소유권을 다시 정하게 만든다.
  await scenario('데일리 왕관: 진도 블록이 없으므로 daily는 왕관을 내지 않는다', async () => {
    await resetMe();
    const { data: s1 } = await api('GET', '/session/today');
    const unitItems = s1.items.filter((it) => it.kind === 'unit');
    assert(unitItems.length === 0,
      `진도 블록이 배합에 돌아왔다(${unitItems.length}문항) — daily 왕관 소유권을 ` +
      '다시 판정해야 한다. `_crown_scope_logs`(kind==="unit")와 유닛 세션 왕관이 ' +
      '동시에 열리면 **이중 수여**가 된다.');

    // 전건 정답으로 완주해도 daily 왕관은 없다
    for (const item of s1.items) {
      await api('POST', `/session/${s1.session_id}/answer`, answerBody(item, true));
    }
    const { data: d1 } = await api('POST', `/session/${s1.session_id}/complete`);
    assert(d1.all_resolved === true, '전건 정답인데 all_resolved가 false다');
    assert(d1.correct_count === s1.items.length, '전건 정답 결산이 아니다');
    assert(d1.crown_award == null,
      `진도 블록이 없는데 daily 왕관이 나왔다 — ${JSON.stringify(d1.crown_award)}`);
  });

  // ── 2. 만회 큐에 **상한이 없다** (2026-08-12 — 종전 「상한 5」 계약의 반전) ──
  // 서버는 원래 상한을 강제하지 않았다. 상한을 걸던 쪽이 프론트였고, 그 근거는
  // 「15문항 + 만회 무제한 = 최악 30문항」이라는 피로 계산이었다. 배합이 10문항으로
  // 줄고 유닛 세션이 4문항이 되면서 그 계산이 성립하지 않게 됐고, 클라이언트가
  // "만회할 때까지 계속"으로 확정했다. 여기서는 **오답 N건이면 큐도 N건**임을
  // 순수 함수와 서버 왕복 양쪽에서 단정한다.
  await scenario('만회 큐에 상한이 없다 (오답 N건이면 만회도 N건)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    // board를 뺀 전건을 틀린다 — "몇 개까지"가 아니라 "전부"가 계약이다.
    const wrongAt = new Set(
      s.items.flatMap((it, i) => (it.question_type === 'board' ? [] : [i])),
    );
    assert(wrongAt.size >= 6, `오답 후보가 6건 이상이어야 의미가 있다 — ${wrongAt.size}`);
    for (const [i, item] of s.items.entries()) {
      await api('POST', `/session/${s.session_id}/answer`, answerBody(item, !wrongAt.has(i)));
    }
    // 전부 만회가 열린다 — 프론트가 자를 근거가 서버 어디에도 없다
    for (const i of [...wrongAt]) {
      const { data, status } = await api(
        'POST', `/session/${s.session_id}/answer`, answerBody(s.items[i], true),
      );
      assert(status === 200 && data.is_retry === true, `서버가 ${i}번 만회를 거절했다`);
    }
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    assert(retryQueueOf(ids).join() === ids.join(),
      `만회 큐는 오답 전건을 출제 순서 그대로 담아야 한다 — ${retryQueueOf(ids).join()}`);
    assert(retryQueueOf(['a', 'b', 'a']).join() === 'a,b',
      '같은 문항이 큐에 두 번 들어가면 진행 표기의 분모가 어긋난다(중복만 접는다)');
    assert(retryQueueOf(null).length === 0, '비배열 입력은 빈 큐여야 한다');
  });

  // ── 3. 화면: 만회 무제한(실패는 다시 나온다) · 구분 표기 · 마감 단계 (실마운트) ──
  let mountedRoot = null;
  await scenario('화면 완주: 오답 3 → 만회 실패분이 다시 나오고 다 맞혀야 끝난다', async (mark) => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');

    // ⚠️ 배합에 들어온 「오늘의 하늘」(board)도 **화면에서 실제로 푼다**(2026-08-12).
    // 미리 API로 정답 처리해 두는 우회를 먼저 시도했는데 **틀린 방법이었다**:
    // 러너의 재개는 **위치 기준**(응답 수 → 인덱스)이라, 마지막 board를 미리 답하면
    // 화면이 1번 문항을 건너뛰고 2번부터 시작한다. 세션은 완주되지만 화면이 밟는
    // 경로가 달라져 만회 큐·제출 수 단정이 통째로 무의미해진다.
    // 그래서 `answerOnScreen`에 board 분기를 두고 팔레트·존·슬라이더를 실조작한다
    // (조작 방식은 `boardAssistRetention.smoke.test.mjs`의 선례를 따른다).
    const order = s.items.map((it) => it.quiz_id);
    // 3건 틀린다. board는 틀릴 대상에서 뺀다 — 만회 라운드의 board 재조작은 이
    // 스모크 소관이 아니고(보드 자체 계약은 boardEntryGate·boardAssistRetention이
    // 소유한다), board를 오답으로 넣으면 만회 큐에 들어가 그쪽을 끌어들인다.
    const WRONG_N = 3;
    const wrongIdx = s.items
      .flatMap((it, i) => (it.question_type === 'board' ? [] : [i]))
      .slice(0, WRONG_N);
    assert(wrongIdx.length === WRONG_N, '오답 후보가 모자란다 — 배합 확인');
    // 상한이 없으므로 만회 대상은 **오답 전건**이고 출제 순서 그대로다.
    const expectedRetry = wrongIdx.map((i) => order[i]);

    mountedRoot = mount(createElement(SessionPage));

    for (let i = 0; i < order.length; i += 1) {
      const next = await playItem(order[i], !wrongIdx.includes(i));
      if (i === order.length - 1) {
        // 마지막 문항 뒤 = 만회 진입 지점. 잘리지 않고 **전건**을 안내한다.
        assert(next.textContent.includes(`놓친 ${WRONG_N}문항 만회하기`),
          `마지막 버튼이 만회 ${WRONG_N}문항(오답 전건)을 안내해야 한다 — "${next.textContent.trim()}"`);
      }
      click(next);
      await sleep(20);
    }

    // 만회 라운드 진입 — 배너·진행 표기. 상한 안내(capNote)는 **사라져야 한다**.
    await waitFor(() => text().includes(`만회 라운드 — 아까 놓친 ${WRONG_N}문항`), '만회 라운드 배너');
    assert(text().includes('만회는 벌이 아니에요'), '만회 안내 문구(구름·XP 무관)가 없다');
    assert(!/만회는 마지막 \d+문항까지만/.test(text()),
      '상한 안내가 남아 있다 — 상한을 걷었는데 화면이 아직 상한을 말한다');
    assert(text().includes(`만회 1 / ${WRONG_N}`), `만회 진행 표기가 없다 — ${text().slice(0, 120)}`);
    assert(window.document.querySelector(`[data-retry-round="${WRONG_N}"]`),
      '만회 큐가 오답 전건으로 서지 않았다');

    // ── ① 만회 **실패**: 그 문항은 큐 꼬리로 가고 라운드는 끝나지 않는다 ────────
    const failFirst = expectedRetry[0];
    {
      const next = await playItem(failFirst, false);
      assert(window.document.querySelector('[data-retry-result="fail"]'),
        `${failFirst}: 만회 실패 표기가 없다`);
      click(next);
      await sleep(20);
    }
    // 남은 2건을 맞힌다 — 큐가 줄어들지만 실패분이 남아 있으므로 **끝나지 않는다**
    for (const quizId of expectedRetry.slice(1)) {
      const next = await playItem(quizId, true);
      assert(window.document.querySelector('[data-retry-result="success"]'),
        `${quizId}: 만회 성공 표기가 없다`);
      click(next);
      await sleep(20);
    }
    assert(!text().includes('오늘의 세션 완료!'),
      '만회에 실패한 문항이 남았는데 세션이 끝났다 — "다 맞힐 때까지"가 깨졌다');

    // ── ② 실패분이 **다시 나온다**. 그것을 맞혀야 비로소 종료된다 ──────────────
    {
      const next = await playItem(failFirst, true); // 다시 안 나오면 여기서 시간 초과
      assert(window.document.querySelector('[data-retry-result="success"]'),
        `${failFirst}: 두 번째 만회의 성공 표기가 없다`);
      click(next);
      await sleep(20);
    }

    // 완료 화면 — 만회 결산 + 블록 구분 표기(§2.10)
    await waitFor(() => text().includes('오늘의 세션 완료!'), '완료 화면');
    assert(text().includes(`만회 완료 ${WRONG_N}문항`), '완료 화면에 "만회 완료 N문항"이 없다');

    // 블록 표기는 **실제 세션 구성에서 파생**한다 — 라벨·개수를 박아 두면 배합이
    // 바뀔 때마다 깨진다(실제로 5·4·1·5가 박혀 있었다). 라벨의 소유자는 i18n
    // `session.summary.blocks`이고 여기서는 kind별 개수만 대조한다.
    const BLOCK_LABEL = { new: '오늘의 발견', review: '복습', live: '실황', unit: '진도', board: '오늘의 하늘' };
    const byKind = new Map();
    for (const it of s.items) byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + 1);
    assert(byKind.size >= 3, `블록이 ${byKind.size}종뿐 — 배합이 무너졌다`);
    for (const [kind, count] of byKind) {
      const label = BLOCK_LABEL[kind];
      assert(label, `i18n에 없는 kind: ${kind}`);
      assert(text().includes(`${label} ${count}문항`), `블록 표기 누락: ${label} ${count}문항`);
      assert(window.document.querySelector(`[data-block-kind="${kind}"]`), `${kind} 블록 칩이 없다`);
    }

    // 제출 실측: 화면 문항 전건 + 만회 3건 + **실패분 재도전 1건** = order+4.
    // 상한이 살아 있으면 이 수가 줄고, 종료 조건이 헐거우면(실패분을 안 빼거나
    // 성공분을 안 빼면) 늘어난다 — 양쪽으로 조이는 수다.
    const expectedCalls = order.length + WRONG_N + 1;
    assert(answerCalls(mark) === expectedCalls,
      `answer 호출은 ${expectedCalls}이어야 한다(화면 ${order.length} + 만회 ${WRONG_N} + 재도전 1) — ${answerCalls(mark)}`);

    // 마감 단계(R13 A-1)가 완료 화면 뒤에 붙는다
    await waitFor(() => text().includes('마지막 단계 — 내일 예보 내기'), '예보 마감 단계');
    const step = window.document.querySelector('[data-closing-step="forecast_duel"]');
    assert(step, '마감 단계 섹션이 없다');
    assert(text().includes('예보는 지금 채점하지 않아요'), '즉시 채점 불가 안내가 없다');
  });

  // ── 4. 마감 단계 제출 → 제출 확인 + 정산일(D+2) 표기 ─────────────────────
  await scenario('마감 단계 제출 → 제출 확인 · 정산은 대상일 다음 날', async () => {
    const { data: duel } = await api('GET', '/duel/today');
    const target = duel.duel_date; // 예보 대상일 = 내일
    const settle = ClosingForecastStep.settlementDate(target);
    const inputs = [...window.document.querySelectorAll('[data-closing-step] input[type="number"]')];
    assert(inputs.length === 2, `마감 단계 입력 2칸 기대 — ${inputs.length}`);
    setInputValue(inputs[0], '29.5');
    setInputValue(inputs[1], '55');
    await sleep(30);
    inputs[0].closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => text().includes('예보를 냈어요'), '제출 확인');
    const stepText = window.document.querySelector('[data-closing-step]')?.textContent ?? '';
    assert(stepText.includes(settle), `정산일(${settle}) 표기가 없다 — 대상일 ${target}의 다음 날이어야 한다`);
    // 이 단계는 문항이 아니다 — 정오 배너를 그리면 즉시 채점 계약이 깨진다
    assert(!/정답|오답/.test(stepText), `마감 단계에 정오 표기가 새어 들어갔다 — "${stepText.slice(0, 80)}"`);
    mountedRoot?.unmount();
  });

  // ── 4b. 재진입 만회 복원 (CO-A5 / CO-M10) ─────────────────────────────────
  // 세션은 하루 동안 멱등이라 새로고침·중간 이탈 후 재진입이 **정상 경로**다.
  // 종전에는 프론트가 이번 자리의 제출 응답으로만 오답을 쌓아서, 만회 도중
  // 새로고침하면 `wrongIds=[]`인데 `answered>=total`이라 자동완료가 곧바로 발화했다 —
  // 만회 화면이 뜨지도 않고 세션이 끝났고 그 순간의 all_resolved로 왕관이 확정됐다.
  await scenario('만회 중 새로고침: 서버 정오로 큐를 복원하고 자동완료를 막는다 (CO-A5/M10)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    // 화면 조작 없이 API로 배합 전량을 응답하고 2건만 오답으로 남긴다(= 이탈 상태 재현)
    const wrongIds = s.items
      .filter((it) => it.question_type === 'multiple_choice')
      .slice(0, 2)
      .map((it) => it.quiz_id);
    assert(wrongIds.length === 2, '다지선다 2건을 못 골랐다 — 목 배합이 바뀌었다');
    for (const item of s.items) {
      await api(
        'POST', `/session/${s.session_id}/answer`,
        answerBody(item, !wrongIds.includes(item.quiz_id)),
      );
    }

    // 서버(그리고 목)가 문항별 정오를 실어 준다 — 복원의 유일한 근거(CO-A5)
    const { data: reread } = await api('GET', '/session/today');
    const unresolved = reread.items
      .filter((it) => it.is_correct === false && it.retry_correct == null)
      .map((it) => it.quiz_id);
    assert(unresolved.length === 2 && wrongIds.every((id) => unresolved.includes(id)),
      `재조회 응답에 미해결 오답 2건이 실려야 한다 — ${JSON.stringify(unresolved)}`);
    assert(reread.items.every((it) => !('correct_answer' in it)),
      '재진입 복원 필드를 실으면서 정답까지 새어 나갔다');

    // 새 마운트 = 새로고침. 자동완료가 아니라 **만회 라운드**가 떠야 한다.
    const markMount = xhrLog.length;
    const root = mount(createElement(SessionPage));
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 2문항'), '복원된 만회 라운드');
    assert(window.document.querySelector('[data-retry-round="2"]'), '만회 큐 2건이 복원되지 않았다');
    assert(since(markMount).every((l) => !/\/complete$/.test(l)),
      '복원 전에 자동완료가 발화했다(CO-M10) — 그 순간의 all_resolved로 왕관이 확정된다');

    // 복원된 큐를 마치면 그때 완료된다. 화면이 내보내는 제출은 **복원된 2건뿐**이다
    // (앞의 전건은 이 테스트가 fetch로 보냈으므로 xhrLog에 없다) — 복원이 과하게
    // 잡아 이미 해결된 문항까지 다시 제출하면 이 수가 커진다.
    for (const quizId of wrongIds) {
      const next = await playItem(quizId, true);
      assert(text().includes('만회 성공'), `${quizId}: 만회 성공 표기가 없다`);
      click(next);
      await sleep(20);
    }
    await waitFor(() => text().includes('오늘의 세션 완료!'), '만회 완료 후 완료 화면');
    assert(text().includes('만회 완료 2문항'), '완료 화면에 만회 결산이 없다');
    assert(answerCalls(markMount) === 2,
      `복원 후 화면이 낸 제출은 만회 2건뿐이어야 한다 — ${answerCalls(markMount)}`);
    root.unmount();
  });

  // ── 4c. 만회 실패분은 **새로고침 뒤에도 다시 열린다** (2026-08-12 계약 반전) ──
  // ⚠️ 이 시나리오는 뜻이 뒤집혔다. 종전 제목은 「같은 문항이 다시 열리지 **않는다**」
  // 였고, 근거는 §2.11의 "성공·실패 모두 한 번씩만"이었다 — 그래서 프론트의 복원
  // 조건이 서버 `is_retry_eligible`의 **진부분집합**(`retry_correct == null`)이었다.
  // 만회가 무제한이 된 지금 그 진부분집합은 **새로고침으로 "다 맞힐 때까지"를
  // 우회하는 통로**가 된다: 틀린 채로 새로고침하면 세션이 그대로 끝나 버린다.
  // 그래서 복원 조건을 서버 식과 **글자 그대로 같게** 맞췄고, 여기가 그 가드다.
  await scenario('만회 실패 후 새로고침: 같은 문항이 다시 열린다 (복원 = is_retry_eligible)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const wrongId = s.items.find((it) => it.question_type === 'multiple_choice').quiz_id;
    for (const item of s.items) {
      await api(
        'POST', `/session/${s.session_id}/answer`, answerBody(item, item.quiz_id !== wrongId),
      );
    }
    const { data: failed } = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: wrongId, answer: '__또_오답__',
    });
    assert(failed.is_retry === true && failed.retry_correct === false, '만회 실패가 기록되지 않았다');

    const markMount = xhrLog.length;
    const root = mount(createElement(SessionPage));
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 1문항'),
      '만회 실패분이 새로고침 뒤에 복원되지 않았다(다 맞힐 때까지 계약)');
    assert(since(markMount).every((l) => !/\/complete$/.test(l)),
      '복원 전에 자동완료가 발화했다 — 틀린 채로 세션이 닫힌다');
    const next = await playItem(wrongId, true);
    assert(window.document.querySelector('[data-retry-result="success"]'), '만회 성공 표기가 없다');
    click(next);
    await waitFor(() => text().includes('오늘의 세션 완료!'), '다 맞힌 뒤에는 종료된다');
    root.unmount();
  });

  // ── 4d. 무한 루프 방지: 409 ALREADY_ANSWERED 문항은 큐에서 **빠진다** ────────
  // 상한이 없어진 뒤 유일한 안전장치가 종료 조건이다. 서버 `is_retry_eligible`이
  // False가 되는 문항(최초 정답·이미 만회 성공)은 재제출이 409로 돌아오는데, 그
  // 문항을 큐에서 안 빼면 **다시 내도 또 409**라 큐가 영원히 줄지 않는다 —
  // 화면에는 오류도 안 뜨고 세션이 끝나지도 않는다.
  //
  // 재현: 만회 라운드에 들어간 뒤 큐 **머리를 화면 밖(fetch)에서 해결**해 서버
  // 상태만 바꾸고, 화면이 그 문항을 제출하게 둔다. 화면은 자기 큐를 믿고 있으므로
  // 이때 409를 처음 만난다(= 실사용의 다중 탭·중복 제출 상황).
  await scenario('무한 루프 방지: 409 ALREADY_ANSWERED면 그 문항을 큐에서 뺀다', async (mark) => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const wrongIds = s.items
      .filter((it) => it.question_type === 'multiple_choice')
      .slice(0, 2)
      .map((it) => it.quiz_id);
    assert(wrongIds.length === 2, '다지선다 2건을 못 골랐다 — 목 배합이 바뀌었다');
    for (const item of s.items) {
      await api(
        'POST', `/session/${s.session_id}/answer`,
        answerBody(item, !wrongIds.includes(item.quiz_id)),
      );
    }

    const root = mount(createElement(SessionPage));
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 2문항'), '복원된 만회 라운드');
    const head = await waitFor(() => currentQuizId(), '만회 큐 머리 문항');
    assert(wrongIds.includes(head), `큐 머리가 오답 중 하나여야 한다 — ${head}`);

    // 화면 밖에서 그 문항을 해결한다 → 서버는 더 이상 만회 대상으로 보지 않는다
    const outOfBand = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: head, answer: String(ANSWER_KEY.get(head).correct),
    });
    assert(outOfBand.data.retry_correct === true, '화면 밖 만회가 성립하지 않았다');

    // 화면이 같은 문항을 낸다 → 409. "이미 해결한 문항"으로 안내하고 **빠져야** 한다.
    await answerOnScreen(head, true);
    const next = await waitFor(
      () => window.document.querySelector('[data-session-next]'), '409 뒤 다음 버튼',
    );
    assert(text().includes('이미 해결한 문항이에요'),
      `409를 오답으로 그렸다 — ${text().slice(0, 160)}`);
    click(next);

    // 남은 1건으로 넘어가고, 그것을 맞히면 끝난다. 409 문항이 다시 나오면
    // waitFor가 시간 초과로 운다(= 무한 루프의 실제 증상).
    const rest = wrongIds.find((id) => id !== head);
    const next2 = await playItem(rest, true);
    click(next2);
    await waitFor(() => text().includes('오늘의 세션 완료!'), '409 문항을 뺀 뒤 세션이 종료된다');
    // 화면이 낸 제출: 409 1건 + 남은 1건 = 2. 409 문항을 다시 냈다면 3 이상이 된다.
    assert(answerCalls(mark) === 2,
      `화면 제출은 2건(409 1 + 만회 1)이어야 한다 — ${answerCalls(mark)}`);
    root.unmount();
  });

  // ── 4e. 만회 탈출구: N바퀴 실패하면 「해설 보고 넘어가기」가 열린다 ──────────
  // 왜 있나: 상한이 없어진 뒤 **채점이 잘못된 문항**은 세션을 영구히 막는다 —
  // 학습자가 맞는 답을 내도 계속 오답 처리되고, 종료 조건(성공·409·세션 밖) 셋 중
  // 어느 것에도 걸리지 않는다. 이 저장소는 lint 초록 상태에서 채점 결함 2건이
  // 발견된 이력이 있으므로(CARRYOVER_R13 §1.1e) 가상의 위험이 아니다.
  //
  // 지키는 것 4가지. **바퀴 수는 상수에서 파생**한다(리터럴 금지 — 값이 바뀌면
  // 테스트가 함께 따라가야 계약이지, 상수 대조가 아니다):
  //   ① N-1바퀴까지는 **닫혀 있다** — 탈출구가 일찍 열리면 해설을 읽기 전에 눌러
  //      버리는 회피 통로가 되어 「만회할 때까지」의 취지가 죽는다.
  //   ② N바퀴째에 열린다.
  //   ③ **자동으로 넘어가지 않는다** — 열려 있어도 누르기 전에는 그 문항 그대로다.
  //   ④ 누르면 큐에서 빠지고(→ 큐가 비면 종료) **서버에는 아무것도 안 보낸다**.
  //      안 푼 문항을 푼 것으로 만들면 all_resolved가 거짓이 된다.
  await scenario('만회 탈출구: N바퀴 실패해야 열리고 · 자동 아님 · 서버 무통신', async (mark) => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    // 큐를 1건으로 만든다 — 같은 문항의 **반복 실패**가 이 계약의 축이다.
    const wrongId = s.items.find((it) => it.question_type === 'multiple_choice').quiz_id;
    for (const item of s.items) {
      await api(
        'POST', `/session/${s.session_id}/answer`, answerBody(item, item.quiz_id !== wrongId),
      );
    }

    const root = mount(createElement(SessionPage));
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 1문항'), '복원된 만회 라운드');
    // 상한 폐지를 화면이 실제로 말하는가(`session.retry.untilAllCorrect`).
    // 상한 안내를 걷어내면서 그 자리가 **빈 채로** 남아 있었다 — 화면이 "언제
    // 끝나는지"를 한마디도 안 하면 무제한 회전이 그냥 버그처럼 읽힌다.
    assert(window.document.querySelector('[data-retry-until-all-correct]'),
      '만회 배너에 "다 맞힐 때까지" 줄이 없다 — 상한을 걷은 사실을 화면이 말하지 않는다');
    assert(text().includes('다 맞힐 때까지 이어져요'),
      `untilAllCorrect 문구가 안 보인다 — ${text().slice(0, 200)}`);

    for (let lap = 1; lap <= RETRY_MERCY_ROUNDS; lap += 1) {
      // 같은 문항이라 quiz_id로는 화면 전환을 못 본다 — 피드백이 걷혔는지로 본다.
      await waitFor(() => !window.document.querySelector('[data-session-next]'),
        `${lap}바퀴: 문항 화면 복귀`);
      const next = await playItem(wrongId, false);
      assert(window.document.querySelector('[data-retry-result="fail"]'), `${lap}바퀴: 만회 실패 표기가 없다`);
      const mercy = window.document.querySelector('[data-session-mercy]');
      if (lap < RETRY_MERCY_ROUNDS) {
        assert(!mercy,
          `${lap}바퀴에 탈출구가 열렸다 — RETRY_MERCY_ROUNDS=${RETRY_MERCY_ROUNDS}바퀴 전에는 닫혀 있어야 한다`);
        click(next);
        await sleep(20);
      } else {
        assert(mercy,
          `${RETRY_MERCY_ROUNDS}바퀴를 실패했는데 탈출구가 없다 — 채점 결함 문항이 세션을 영구히 막는다`);
        assert(text().includes('해설 보고 넘어가기'), '탈출구 문구가 없다');
        // ③ 자동 금지: 열려 있을 뿐 아직 그 문항 화면이고 세션은 안 끝났다
        assert(currentQuizId() === wrongId, '누르지도 않았는데 다음으로 넘어갔다');
        assert(!text().includes('오늘의 세션 완료!'), '탈출구가 자동으로 발동했다');
      }
    }

    // ④ 누른다 — 큐가 비고 세션이 끝나며, 그 사이 answer 호출은 **늘지 않는다**
    const callsBeforeMercy = answerCalls(mark);
    assert(callsBeforeMercy === RETRY_MERCY_ROUNDS,
      `화면이 낸 제출은 만회 실패 ${RETRY_MERCY_ROUNDS}건뿐이어야 한다 — ${callsBeforeMercy}`);
    click(window.document.querySelector('[data-session-mercy] button'));
    await waitFor(() => text().includes('오늘의 세션 완료!'),
      '탈출구를 눌렀는데 큐가 비지 않았다(세션이 끝나지 않는다)');
    assert(answerCalls(mark) === callsBeforeMercy,
      `탈출구가 서버에 답안을 보냈다 — ${callsBeforeMercy} → ${answerCalls(mark)}. ` +
      '안 푼 문항을 푼 것으로 만들면 all_resolved가 거짓이 된다.');
    // 넘어간 문항은 **미해결**로 남는다 — 결산이 해결로 세면 화면이 거짓말을 한다
    assert(!/만회 완료 \d+문항/.test(text()),
      `넘어간 문항이 만회 완료로 결산됐다 — ${text().slice(0, 200)}`);
    root.unmount();
  });

  // ── 4f. 이탈 다이얼로그: 만회 중에는 "조금만 더"가 거짓이다 ─────────────────
  // 만회 중에는 본문을 전건 응답했으므로 `total - answered`가 **0**이고, 그러면
  // 종전 분기가 "조금만 더 하면 끝나요"를 띄웠다 — 실제로는 만회 큐를 다 맞혀야
  // 끝나므로 화면이 사실과 다른 말을 한 것이다(CARRYOVER_R13 §S가 세는 그 유형).
  await scenario('이탈 다이얼로그: 만회 중에는 만회 큐 잔량을 말한다("조금만 더" 금지)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const wrongIds = s.items
      .filter((it) => it.question_type === 'multiple_choice')
      .slice(0, 2)
      .map((it) => it.quiz_id);
    assert(wrongIds.length === 2, '다지선다 2건을 못 골랐다 — 목 배합이 바뀌었다');
    for (const item of s.items) {
      await api(
        'POST', `/session/${s.session_id}/answer`,
        answerBody(item, !wrongIds.includes(item.quiz_id)),
      );
    }
    const root = mount(createElement(SessionPage));
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 2문항'), '복원된 만회 라운드');

    // 이탈 인텐트는 document 캡처 리스너가 **내부 링크 클릭**에서 잡는다 —
    // 세션 화면에 링크가 없어도 되도록 앵커를 하나 심어 그 경로만 정확히 겨눈다.
    const anchor = window.document.createElement('a');
    anchor.setAttribute('href', '/learn');
    anchor.textContent = '학습 경로';
    window.document.body.appendChild(anchor);
    click(anchor);
    const desc = await waitFor(() => window.document.querySelector('[data-leave-phase]'), '이탈 확인 다이얼로그');
    anchor.remove();

    assert(desc.getAttribute('data-leave-phase') === 'retry',
      `만회 중인데 본문 문구 분기로 갔다 — data-leave-phase=${desc.getAttribute('data-leave-phase')}`);
    assert(text().includes('아직 만회할 2문항이 남았어요'),
      `만회 잔량(2문항)을 말하지 않는다 — "${desc.textContent}"`);
    assert(!text().includes('조금만 더 하면 끝나요'),
      `만회 중에 "조금만 더 하면 끝나요"가 떴다(거짓) — "${desc.textContent}"`);

    const stayBtn = [...window.document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === '계속 풀기',
    );
    assert(stayBtn, '주 CTA(계속 풀기)가 없다');
    click(stayBtn);
    await waitFor(() => !window.document.querySelector('[data-leave-phase]'), '다이얼로그 닫힘');
    root.unmount();
  });

  // ── 5. closing_step: null → 마감 단계 없이 15문항으로 정상 완료 ────────────
  await scenario('closing_step null(이미 제출) → 배합 전량 완주 · 마감 단계 미렌더', async () => {
    await resetMe();
    await api('POST', '/duel/today', { temp_max: 28, rain_prob: 30 }); // 오늘 예보 제출 완료
    const { data: s } = await api('GET', '/session/today');
    assert(s.closing_step === null, '이미 제출한 날인데 closing_step이 붙었다');
    // 문항 수는 **배합에서 파생**한다 — 15를 박아 둔 탓에 배합이 10이 됐을 때
    // "마감 단계가 완주를 막지 않는다"는 계약이 아니라 상수가 깨졌다.
    assert(s.items.length === MOCK_POLICY.session_recipe_total,
      `마감 단계가 없어도 배합 전량이어야 한다 — ${s.items.length}`);
    for (const item of s.items) {
      await api('POST', `/session/${s.session_id}/answer`, answerBody(item, true));
    }
    const { status, data: done } = await api('POST', `/session/${s.session_id}/complete`);
    assert(status === 200, `마감 단계 없이도 완료돼야 한다 — ${status}`);
    assert(done.closing_step === null, '완료 응답에도 closing_step이 없어야 한다');
    const N = MOCK_POLICY.session_recipe_total;
    assert(done.total === N && done.correct_count === N,
      `배합 전량(${N}문항) 완주 결산이 아니다 — total=${done.total} correct=${done.correct_count}`);

    // 컴포넌트도 step=null이면 아무것도 그리지 않는다(완주를 막지 않는 유일한 형태)
    const container = window.document.getElementById('root');
    const r = createRoot(container);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    r.render(createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, null, createElement(ClosingForecastStep.default, { step: null }))));
    await sleep(80);
    assert(!text().includes('마지막 단계'), 'step=null인데 마감 단계가 렌더됐다');
    r.unmount();
  });

  // ── 6. 완료 화면 구분 표기는 items의 kind만 근거로 한다(추정 금지) ─────────
  await scenario('SessionSummary: kind 없는 items면 블록 표기 자체를 그리지 않는다', async () => {
    const container = window.document.getElementById('root');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const summary = { xp_total: 10, correct_count: 2, total: 3, streak_count: 1 };

    let r = createRoot(container);
    r.render(createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, null,
        createElement(SessionSummary, { summary, items: [{ kind: 'unit' }, { kind: 'unit' }, { kind: 'live' }] }))));
    await waitFor(() => text().includes('진도 2문항'), '진도 블록 표기');
    assert(text().includes('실황 1문항'), '실황 블록 표기 누락');
    r.unmount();
    await sleep(30);

    r = createRoot(container);
    r.render(createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, null,
        createElement(SessionSummary, { summary, items: [{}, {}, {}] }))));
    await waitFor(() => text().includes('오늘의 세션 완료!'), '요약 렌더');
    assert(!window.document.querySelector('[data-session-blocks]'),
      'kind가 없는데 블록 표기를 추정해 그렸다');
    r.unmount();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CO-S-1 / CO-M4 — 실패가 무한 스피너로 수렴하지 않는다
  //
  // `sessionStore.setError`의 호출자가 0건이라 SESSION_STATUS.ERROR가 도달 불가였고,
  // 렌더 가드가 `isLoading`을 먼저 보는 바람에 429·403 UNIT_LOCKED·500이 **전부
  // "세션을 준비하고 있어요..." 한 종류로** 수렴했다(7초 실측). 8/11~18 무키 실운영
  // 상시 경로라 여기서 "에러가 **실제로 화면에 뜬다**"를 단정한다.
  //
  // 로드 함수를 직접 주입해 SessionRunner를 마운트한다 — 목 서버에 429/403을
  // 만들어 넣는 것보다 분기 자체를 정확히 겨눈다.
  // ══════════════════════════════════════════════════════════════════════════
  const apiError = ({ detail, code, status, body = null }) =>
    Object.assign(new Error(detail), { name: 'ApiError', detail, code, status, body });

  const mountRunner = (props) =>
    mount(createElement(SessionRunner, { queryKey: ['smoke', String(Math.random())], ...props }));

  await scenario('CO-S-1: 로드 500이 무한 스피너가 아니라 에러 카드 + 재시도로 뜬다', async () => {
    const r = mountRunner({
      loadSession: () => Promise.reject(apiError({ detail: '서버 오류', code: 'INTERNAL_ERROR', status: 500 })),
    });
    const card = await waitFor(
      () => window.document.querySelector('[data-session-error="GENERIC"]'),
      '제네릭 에러 카드',
    );
    assert(card, '에러 카드가 없다');
    assert(!text().includes('세션을 준비하고 있어요'), '스피너가 에러를 가리고 있다(가드 순서 회귀)');
    assert(text().includes('세션을 불러오지 못했어요'), '실패 문구가 없다');
    assert(
      [...window.document.querySelectorAll('button')].some((b) => b.textContent.includes('다시 시도')),
      '재시도 버튼이 없다',
    );
    r.unmount();
  });

  await scenario('CO-M4: 로드 429 OUT_OF_CLOUDS는 전용 화면(잔량·회복 ETA·재시도 없음)', async () => {
    const r = mountRunner({
      loadSession: () =>
        Promise.reject(
          apiError({
            detail: '구름이 모두 흩어졌어요',
            code: 'OUT_OF_CLOUDS',
            status: 429,
            body: { code: 'OUT_OF_CLOUDS', next_regen_sec: 540, clouds: 0, max: 5 },
          }),
        ),
    });
    await waitFor(() => window.document.querySelector('[data-session-error="OUT_OF_CLOUDS"]'), '구름 소진 전용 화면');
    assert(text().includes('구름이 모두 흩어졌어요'), '전용 제목이 없다');
    assert(text().includes('0 / 5'), `잔량 표기(0 / 5)가 없다 — 실제: ${text().slice(0, 200)}`);
    assert(text().includes('9분'), `회복 ETA(540초→9분)가 없다 — 실제: ${text().slice(0, 200)}`);
    // 눌러도 다시 429다 — 재시도 버튼을 두면 "계속 실패하는 버튼"이 된다(CO-M4 원문)
    assert(
      ![...window.document.querySelectorAll('button')].some((b) => b.textContent.includes('다시 시도')),
      '구름 소진 화면에 재시도 버튼이 있다(눌러도 계속 429다)',
    );
    assert(!window.document.querySelector('[data-session-error="GENERIC"]'), '제네릭 화면으로 샜다');
    r.unmount();
  });

  await scenario('CO-S-1: 로드 403 UNIT_LOCKED는 잠금 안내로 갈린다', async () => {
    const r = mountRunner({
      loadSession: () =>
        Promise.reject(apiError({ detail: '선행 유닛을 먼저 완료해야 열려요', code: 'UNIT_LOCKED', status: 403 })),
    });
    await waitFor(() => window.document.querySelector('[data-session-error="UNIT_LOCKED"]'), '잠금 안내 화면');
    assert(text().includes('아직 열리지 않은 유닛'), '잠금 제목이 없다');
    assert(text().includes('선행 유닛을 먼저 완료해야 열려요'), '서버 detail이 안 보인다');
    assert(!window.document.querySelector('[data-session-error="GENERIC"]'), '제네릭 화면으로 샜다');
    r.unmount();
  });

  await scenario('CO-S-3: 0문항 세션(200)은 "0 / 0"에 갇히지 않고 탈출구를 준다', async () => {
    const r = mountRunner({
      loadSession: () =>
        Promise.resolve({ session_id: 'empty-1', items: [], progress: { answered: 0, total: 0 } }),
    });
    await waitFor(() => window.document.querySelector('[data-session-error="EMPTY"]'), '빈 세션 안내');
    assert(text().includes('지금 낼 수 있는 문항이 없어요'), '빈 세션 안내 문구가 없다');
    assert(
      [...window.document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/learn'),
      '학습 경로로 나가는 링크가 없다',
    );
    r.unmount();
  });


  // ── CO-I-1 후속: 해설 배지가 **출처**를 말한다 ────────────────────────────
  // `explanation_hint` 158건을 배선한 뒤로 사람이 저작한 해설과 board 판정 근거가
  // 무조건 "AI 피드백" 배지 아래로 나갔다 — 심사 배점 ⑤(생성형 AI 활용) 표기 오류.
  // 서버 AnswerResult.feedback_source("board"|"authored"|"ai")로 라벨을 고른다.
  await scenario('FeedbackPanel: feedback_source가 배지를 고른다(부재는 ai 폴백)', async () => {
    for (const [source, label] of [
      ['ai', 'AI 피드백'],
      ['authored', '개념 해설'],
      ['board', '판정 근거'],
      [undefined, 'AI 피드백'], // 구 응답 하위 호환
      ['__unknown__', 'AI 피드백'], // 미지 값도 안전하게 떨어진다
    ]) {
      const r = mount(createElement(FeedbackPanel, { message: '설명입니다', isCorrect: true, source }));
      await waitFor(() => window.document.querySelector('[data-feedback-source]'), `배지(${source})`);
      assert(
        text().includes(label),
        `source=${source}는 "${label}" 배지여야 함 — 실제: ${text().slice(0, 80)}`,
      );
      r.unmount();
      await sleep(20);
    }
  });

} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 만회 라운드(무제한·종료 조건 3갈래)·블록 구분 표기·예보 마감 단계 스모크 통과');
process.exit(0);

/**
 * 세션 러너 3일차 스모크 (R13-01 §2.1 만회 · §2.11 상한 5 · §2.10 블록 표기 ·
 * R13 A-1 마감 단계) — node tests/sessionRetry.smoke.test.mjs
 *
 * 가드하는 계약 4축:
 *  1. 만회 성공 → 왕관. 오답 문항만 재제출이 열리고(is_retry/retry_correct),
 *     **구름 무소모·XP 무가산**이며, 전건 해결(all_resolved)이 왕관 판정값이다.
 *     최초 정답 문항·이미 만회 성공한 문항의 재제출은 **409 ALREADY_ANSWERED**
 *     (§2.1 BE-1 실측 정정 — 초안의 "409 아님"은 계약 문서 오류였다).
 *  2. 만회 큐 상한 5(§2.11). **서버는 상한을 강제하지 않는다** — 오답 7개를 내면
 *     서버는 7개 전부 만회 가능이라고 답한다. 상한은 프론트 몫이라, 여기서
 *     "15문항 + 만회 5 = 20제출에서 멈춘다"를 XHR 실측으로 단정한다.
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
const { default: apiMockPlugin } = await import('../mock/apiMockPlugin.js');

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
const { retryQueueOf, RETRY_QUEUE_LIMIT } = await vite.ssrLoadModule('/src/modules/session/SessionRunner.jsx');
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

async function resetMe() {
  const r = await api('POST', '/dev/reset-me', { reset: true });
  assert(r.status === 200, `/dev/reset-me 실패: ${r.status}`);
}

async function harvestAnswerKey() {
  const { data: s } = await api('GET', '/session/today');
  for (const item of s.items) {
    const { data } = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: item.quiz_id,
      answer: '__의도적_오답__', // 어떤 유형에서도 정답이 될 수 없는 문자열(slider는 NaN)
    });
    assert(data.is_correct === false, `${item.quiz_id}: 의도적 오답이 정답으로 채점됐다`);
    ANSWER_KEY.set(item.quiz_id, {
      type: item.question_type,
      options: item.options ?? [],
      correct: data.correct_answer,
    });
  }
  await resetMe();
}

/** 화면의 현재 문항에 정답/오답을 넣는다(유형별 실제 위젯 조작). */
async function answerOnScreen(quizId, wantCorrect) {
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
  throw new Error(`스모크가 다루지 않는 유형: ${k.type} (${quizId}) — 목 배합이 바뀌었다`);
}

/** 문항 1건 진행: 등장 대기 → 답안 → 피드백 → 다음 버튼 반환(클릭은 호출자 몫) */
async function playItem(expectedQuizId, wantCorrect) {
  await waitFor(() => currentQuizId() === expectedQuizId, `문항 ${expectedQuizId} 등장`);
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
    const wrongAt = new Set([1, 4, 9]); // 15문항 중 3건만 일부러 틀린다
    const results = [];
    for (const [i, item] of s.items.entries()) {
      const k = ANSWER_KEY.get(item.quiz_id);
      const answer = wrongAt.has(i) ? '__의도적_오답__' : String(k.correct);
      const { data } = await api('POST', `/session/${s.session_id}/answer`, { quiz_id: item.quiz_id, answer });
      assert(data.is_correct === !wrongAt.has(i), `${item.quiz_id}: 채점이 의도와 다르다`);
      assert(data.is_retry !== true, '최초 제출인데 is_retry가 붙었다');
      results.push(data);
    }

    // 최초 정답 문항의 재제출은 만회 대상이 아니다 → 409
    const okItem = s.items[0];
    const re = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: okItem.quiz_id, answer: String(ANSWER_KEY.get(okItem.quiz_id).correct),
    });
    assert(re.status === 409 && re.data.code === 'ALREADY_ANSWERED',
      `최초 정답 재제출은 409 ALREADY_ANSWERED여야 한다 — 받은 값: ${re.status}/${re.data?.code}`);

    // 오답 3건 만회 — 구름 잔량은 만회 전후로 움직이지 않아야 한다
    const cloudsBefore = results[results.length - 1].clouds;
    for (const i of [...wrongAt]) {
      const item = s.items[i];
      const { data } = await api('POST', `/session/${s.session_id}/answer`, {
        quiz_id: item.quiz_id, answer: String(ANSWER_KEY.get(item.quiz_id).correct),
      });
      assert(data.is_retry === true, `${item.quiz_id}: is_retry=true가 아니다`);
      assert(data.retry_correct === true, `${item.quiz_id}: retry_correct=true가 아니다`);
      assert(data.xp_earned === 0, '만회에 XP가 붙었다 — 파밍 차단 계약 위반');
      assert(data.clouds_spent === 0, '만회에서 구름이 소모됐다 — 만회는 벌이 아니다');
      assert(data.clouds === cloudsBefore, '만회로 구름 잔량이 움직였다');
    }

    // 이미 만회로 해결한 문항의 또 다른 재제출도 409
    const again = await api('POST', `/session/${s.session_id}/answer`, {
      quiz_id: s.items[1].quiz_id, answer: String(ANSWER_KEY.get(s.items[1].quiz_id).correct),
    });
    assert(again.status === 409 && again.data.code === 'ALREADY_ANSWERED',
      '만회 성공 문항의 재제출은 409여야 한다');

    const { data: done } = await api('POST', `/session/${s.session_id}/complete`);
    assert(done.correct_count === 12, `correct_count는 **최초 정답 수** 12여야 한다 — ${done.correct_count}`);
    assert(done.all_resolved === true, '전건 해결인데 all_resolved가 false다');
    assert(done.retry_resolved_count === 3, `retry_resolved_count 3 기대 — ${done.retry_resolved_count}`);
  });

  // ── 1b. 왕관 판정값이 all_correct → all_resolved로 바뀌었다는 것 자체 ──────
  // 유닛 세션은 왕관 경로가 짧아(grant_unit_crown) 개정 효과가 그대로 드러난다:
  // **전건 최초 오답 + 전건 만회 성공** → all_correct=false인데 왕관이 나와야 한다.
  await scenario('만회 성공 → 왕관 (all_correct=false인데 클리어 — §2.1 판정값 개정)', async () => {
    await resetMe();
    // reset-me는 유닛 진도까지 지워 선행 잠금이 되살아난다 — 전체 해제로 되돌린다
    await api('POST', '/dev/curriculum', { action: 'unlock_all' });
    const UNIT_ID = 'u0000002-0000-4000-8000-000000000002'; // 기단의 성질(quiz, 미클리어)
    const { status: us, data: u } = await api('POST', `/curriculum/units/${UNIT_ID}/session`);
    assert(us === 200 && Array.isArray(u.items), `유닛 세션 발급 실패: ${us} ${JSON.stringify(u)}`);
    const key = [];
    for (const item of u.items) {
      const { data } = await api('POST', `/session/${u.session_id}/answer`, {
        quiz_id: item.quiz_id, answer: '__의도적_오답__',
      });
      assert(data.is_correct === false, '유닛 문항이 의도적 오답에 정답 판정됐다');
      key.push([item.quiz_id, data.correct_answer]);
    }
    for (const [quizId, correct] of key) {
      const { data } = await api('POST', `/session/${u.session_id}/answer`, {
        quiz_id: quizId, answer: String(correct),
      });
      assert(data.is_retry === true && data.retry_correct === true, `${quizId} 만회 실패`);
    }
    const { data: done } = await api('POST', `/session/${u.session_id}/complete`);
    assert(done.unit_result, 'unit_result가 없다');
    assert(done.unit_result.all_correct === false,
      'all_correct는 **최초 시도 만점**이라는 뜻을 유지해야 한다(만회로 뒤집으면 안 된다)');
    assert(done.unit_result.all_resolved === true, 'all_resolved가 false다');
    assert(done.unit_result.crowns === 1 && done.unit_result.cleared === true,
      `만회로 전건 해결했는데 왕관이 없다 — ${JSON.stringify(done.unit_result)}`);
    assert(done.correct_count === 0, 'correct_count는 최초 정답 수(0) 그대로여야 한다');
    assert(done.retry_resolved_count === key.length, '만회 해결 수가 어긋난다');
  });

  // ── 2. 서버는 상한을 강제하지 않는다 = 상한 5는 프론트 몫이라는 근거 ────────
  await scenario('서버는 만회 상한을 강제하지 않는다 (오답 7건 전부 만회 가능)', async () => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const wrongAt = new Set([0, 1, 2, 3, 4, 5, 6]);
    for (const [i, item] of s.items.entries()) {
      const answer = wrongAt.has(i) ? '__의도적_오답__' : String(ANSWER_KEY.get(item.quiz_id).correct);
      await api('POST', `/session/${s.session_id}/answer`, { quiz_id: item.quiz_id, answer });
    }
    // 7건 전부 만회가 열린다 — 그래서 상한 5는 UI가 걸어야 한다(§2.11)
    for (const i of [...wrongAt]) {
      const { data, status } = await api('POST', `/session/${s.session_id}/answer`, {
        quiz_id: s.items[i].quiz_id, answer: String(ANSWER_KEY.get(s.items[i].quiz_id).correct),
      });
      assert(status === 200 && data.is_retry === true, `서버가 ${i}번 만회를 거절했다`);
    }
    assert(retryQueueOf(['a', 'b', 'c', 'd', 'e', 'f', 'g']).join() === 'c,d,e,f,g',
      '만회 큐는 마지막 5개만 남겨야 한다(§2.11)');
    assert(RETRY_QUEUE_LIMIT === 5, '만회 상한 상수가 5가 아니다');
  });

  // ── 3. 화면: 만회 큐 상한 5 · 블록 구분 표기 · 마감 단계 노출 (실마운트 완주) ──
  let mountedRoot = null;
  await scenario('화면 완주: 오답 7 → 만회 5(20제출에서 멈춤) → 구분 표기 → 마감 단계', async (mark) => {
    await resetMe();
    const { data: s } = await api('GET', '/session/today');
    const order = s.items.map((it) => it.quiz_id);
    const wrongIdx = [0, 1, 2, 3, 4, 5, 6]; // 7건 오답 → 만회 대상은 마지막 5건
    const expectedRetry = wrongIdx.slice(-RETRY_QUEUE_LIMIT).map((i) => order[i]);

    mountedRoot = mount(createElement(SessionPage));

    for (let i = 0; i < order.length; i += 1) {
      const next = await playItem(order[i], !wrongIdx.includes(i));
      if (i === order.length - 1) {
        // 마지막 문항 뒤 = 만회 진입 지점. 상한이 걸려 7이 아니라 5로 안내한다.
        assert(next.textContent.includes('놓친 5문항 만회하기'),
          `마지막 버튼이 만회 5문항을 안내해야 한다 — "${next.textContent.trim()}"`);
      }
      click(next);
      await sleep(20);
    }

    // 만회 라운드 진입 — 배너·상한 안내·진행 표기
    await waitFor(() => text().includes('만회 라운드 — 아까 놓친 5문항'), '만회 라운드 배너');
    assert(text().includes('만회는 벌이 아니에요'), '만회 안내 문구(구름·XP 무관)가 없다');
    assert(text().includes('만회는 마지막 5문항까지만 이어져요'), '상한 안내가 없다(오답 7건인데)');
    assert(text().includes('만회 1 / 5'), `만회 진행 표기가 없다 — ${text().slice(0, 120)}`);

    for (let i = 0; i < expectedRetry.length; i += 1) {
      const next = await playItem(expectedRetry[i], true);
      assert(text().includes('만회 성공'), `${expectedRetry[i]}: 만회 성공 표기가 없다`);
      click(next);
      await sleep(20);
    }

    // 완료 화면 — 만회 결산 + 블록 구분 표기(§2.10)
    await waitFor(() => text().includes('오늘의 세션 완료!'), '완료 화면');
    assert(text().includes('만회 완료 5문항'), '완료 화면에 "만회 완료 N문항"이 없다');
    for (const [label, count] of [['오늘의 발견', 5], ['복습', 4], ['실황', 1], ['진도', 5]]) {
      assert(text().includes(`${label} ${count}문항`), `블록 표기 누락: ${label} ${count}문항`);
    }
    const unitChip = window.document.querySelector('[data-block-kind="unit"]');
    assert(unitChip, '진도(unit) 블록 칩이 없다');

    // 제출 실측: 15문항 + 만회 5 = 20에서 멈춘다(무제한이면 22가 된다)
    assert(answerCalls(mark) === 20, `answer 호출은 20이어야 한다(15+만회5) — ${answerCalls(mark)}`);

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

  // ── 5. closing_step: null → 마감 단계 없이 15문항으로 정상 완료 ────────────
  await scenario('closing_step null(이미 제출) → 15문항 완주 · 마감 단계 미렌더', async () => {
    await resetMe();
    await api('POST', '/duel/today', { temp_max: 28, rain_prob: 30 }); // 오늘 예보 제출 완료
    const { data: s } = await api('GET', '/session/today');
    assert(s.closing_step === null, '이미 제출한 날인데 closing_step이 붙었다');
    assert(s.items.length === 15, `마감 단계가 없어도 15문항이어야 한다 — ${s.items.length}`);
    for (const item of s.items) {
      await api('POST', `/session/${s.session_id}/answer`, {
        quiz_id: item.quiz_id, answer: String(ANSWER_KEY.get(item.quiz_id).correct),
      });
    }
    const { status, data: done } = await api('POST', `/session/${s.session_id}/complete`);
    assert(status === 200, `마감 단계 없이도 완료돼야 한다 — ${status}`);
    assert(done.closing_step === null, '완료 응답에도 closing_step이 없어야 한다');
    assert(done.total === 15 && done.correct_count === 15, '15문항 완주 결산이 아니다');

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
console.log('OK: 만회 라운드·상한 5·블록 구분 표기·예보 마감 단계 스모크 통과');
process.exit(0);

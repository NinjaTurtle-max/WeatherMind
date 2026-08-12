/**
 * 복습 큐 스모크 (R11-01 §6.2 FE-C) — node tests/review-queue.smoke.test.mjs
 *
 * 검증 축 4개:
 *  1. mock↔서버 parity 가드: GET /progress/review-queue 항목의 키 집합이
 *     backend/app/schemas/progress.py ReviewQueueItem 필드와 **정확히 일치**
 *     (backend 테스트 파일은 소유 밖이라, 프론트 쪽에서 스키마 소스를 읽어 대조).
 *  2. 큐 파생: 목 내부 응답 이력 → 간격 사다리(1·3·7·14·30)·오답 리셋 의미론.
 *     세션 응답(실 XHR)이 큐를 실제로 움직이는지까지 본다 — 정적 배열이면 문다.
 *  3. ReviewQueueCard 실마운트(jsdom + createRoot): due 상위 3개 + /daily 링크.
 *  4. due 0건(dev/reset-me 후) → 카드 미렌더(null — 빈 카드 금지).
 *  + 게스트 전환 mock(POST /auth/guest/convert)의 §6.2 계약 형태(FE-C 소유분).
 *
 * ⚠️ 픽스처 결합(boardAssistRetention 선례): 세션 3·4번(typhoon·heat_island)
 * 문항의 정답 문자열을 단정한다 — mock PINNED_REVIEW_ITEMS를 바꾸면 함께 갱신.
 * 관례: 테스트 러너 의존 없는 node 직접 실행. jsdom은 devDependency.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';

process.env.NODE_ENV = 'production';

// ── mock API 서버 (vite middlewareMode + apiMockPlugin, 임시 포트) ──────────
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

// ── jsdom 전역 배선 (react 모듈 로드 전에 — placementEntry 스모크 관례) ─────
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
// i18n 전면 외부화(R11-01 §6.3) 이후 UI 문구는 로케일을 따른다 — jsdom의
// navigator.language 기본값(en-US)에 좌우되지 않도록 제품 기본 로케일(ko)을
// 저장값으로 고정한다(i18n.smoke.test.mjs와 동일 관례). 한국어 문구 단정은 불변.
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.XMLHttpRequest = window.XMLHttpRequest; // axios가 브라우저(XHR) 어댑터를 쓰게
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
}
globalThis.matchMedia = window.matchMedia;

const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack ?? e.message)));

// ── React 마운트 도우미 ─────────────────────────────────────────────────────
const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const ReviewQueueCard = (await vite.ssrLoadModule('/src/components/ReviewQueueCard.jsx')).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mountCard() {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  reactRoot.render(
    createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(ReviewQueueCard))),
  );
  return reactRoot;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let failed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
    if (pageErrors.length) console.error(`  page errors: ${pageErrors.join(' | ')}`);
  }
}

const CARD_SEL = '[data-testid="review-queue-card"]';
const byTag = (queue, tag) => queue.find((it) => it.concept_tag === tag);

try {
  // ── 1. parity 가드: 응답 키 == 서버 ReviewQueueItem 필드 (정확 일치) ────────
  await scenario('parity — 응답 키가 서버 ReviewQueueItem 6필드와 정확히 일치', async () => {
    const schemaSrc = readFileSync(
      resolve(root, '../backend/app/schemas/progress.py'), 'utf-8',
    );
    const block = schemaSrc.match(/class ReviewQueueItem\(BaseModel\):[\s\S]*?(?=\nclass |$)/)?.[0];
    assert(block, 'backend ReviewQueueItem 클래스를 찾지 못함 — 스키마 이동 시 이 가드 갱신');
    // 독스트링 안의 "필드명: 설명" 줄이 섞이지 않게 먼저 걷어낸다
    const code = block.replace(/"""[\s\S]*?"""/g, '');
    const serverFields = [...code.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]).sort();
    assert(serverFields.length === 6, `서버 필드 6개 기대, 실측 ${serverFields.length}: ${serverFields}`);

    const { status, data } = await api('GET', '/progress/review-queue');
    assert(status === 200, `GET review-queue ${status}`);
    assert(Array.isArray(data) && data.length > 0, '시드 이력이 큐로 파생되지 않음(빈 배열)');
    for (const item of data) {
      const keys = Object.keys(item).sort();
      assert(
        JSON.stringify(keys) === JSON.stringify(serverFields),
        `키 드리프트 — mock ${keys} vs server ${serverFields}`,
      );
    }
  });

  // ── 2. 큐 파생: 시드 이력 → 사다리·오답 리셋 → 세션 응답으로 실이동 ────────
  await scenario('파생 — 간격 사다리(스트릭→간격)와 due·정렬이 시드 이력과 정합', async () => {
    const { data: queue } = await api('GET', '/progress/review-queue');
    // 시드: typhoon 정답 2연속(10일 전) · heat_island 정답 1회(4일 전) ·
    //       air_mass 오답(2일 전 — 리셋 0) · pressure_front 정답 3연속(13일 전)
    const cases = [
      ['typhoon', 2, 7, true],
      ['heat_island', 1, 3, true],
      ['air_mass', 0, 1, true], // 오답 리셋 — 스트릭 0 → 1일 사다리
      ['pressure_front', 3, 14, false], // 내일 도래 — due 필터 대조군
    ];
    for (const [tag, streak, interval, due] of cases) {
      const it = byTag(queue, tag);
      assert(it, `${tag} 항목 없음`);
      assert(it.consecutive_correct === streak, `${tag} 스트릭 ${it.consecutive_correct} ≠ ${streak}`);
      assert(it.interval_days === interval, `${tag} 간격 ${it.interval_days} ≠ ${interval}(사다리 드리프트)`);
      assert(it.due === due, `${tag} due=${it.due} ≠ ${due}`);
    }
    // 정렬: next_review_at 오름차순 — 가장 오래 밀린 typhoon이 선두
    assert(queue[0].concept_tag === 'typhoon', `정렬 선두 ${queue[0].concept_tag} ≠ typhoon`);
  });

  await scenario('파생 — 세션 오답이 스트릭을 리셋하고 정답이 사다리를 올린다(실 XHR)', async () => {
    const { status, data: session } = await api('GET', '/session/today');
    assert(status === 200, `세션 발급 ${status}`);
    const typhoonItem = session.items.find((it) => it.concept_tag === 'typhoon');
    const heatItem = session.items.find((it) => it.concept_tag === 'heat_island');
    assert(typhoonItem && heatItem, '세션에 typhoon/heat_island 복습 문항이 없음(픽스처 변경?)');

    // typhoon 오답(임의 오답 문자열) → 스트릭 2 → 0 리셋, 간격 1일, 오늘은 미due
    await api('POST', `/session/${session.session_id}/answer`, {
      quiz_id: typhoonItem.quiz_id, answer: '오답-스모크', elapsed_sec: 3,
    });
    // heat_island 정답(픽스처 결합 — 파일 머리 주석) → 스트릭 1 → 2, 간격 7일
    const heatRes = await api('POST', `/session/${session.session_id}/answer`, {
      quiz_id: heatItem.quiz_id, answer: '도시 상공의 오존층이 두꺼워져서', elapsed_sec: 3,
    });
    assert(heatRes.data?.is_correct === true, 'heat_island 픽스처 정답이 오답 처리됨(픽스처 드리프트)');

    const { data: queue } = await api('GET', '/progress/review-queue');
    const typhoon = byTag(queue, 'typhoon');
    assert(typhoon.consecutive_correct === 0, `오답 리셋 실패 — typhoon 스트릭 ${typhoon.consecutive_correct} ≠ 0`);
    assert(typhoon.interval_days === 1, `오답 후 간격 ${typhoon.interval_days} ≠ 1`);
    assert(typhoon.due === false, '방금 틀린 개념의 다음 복습은 내일(KST) — due=false여야 함');
    const heat = byTag(queue, 'heat_island');
    assert(heat.consecutive_correct === 2, `정답 증가 실패 — heat_island 스트릭 ${heat.consecutive_correct} ≠ 2`);
    assert(heat.interval_days === 7, `정답 후 간격 ${heat.interval_days} ≠ 7`);
    assert(heat.due === false, '방금 맞힌 개념은 미due여야 함');
  });

  // ── 3. 카드 실마운트: due만, 상위 3개 이내, CTA가 **실재하는 라우트**로 간다 ─
  //
  // ⚠️ **계약을 고쳤다**(2026-08-12). 종전에는 `a[href="/daily"]`가 존재하는지만
  // 봤다. 그래서 `/daily` 라우트가 폐지된 뒤에도 **이 테스트는 초록이었고**, 카드의
  // 「복습하러 가기」는 눌러도 `*` → `/learn`으로 조용히 되돌아오는 죽은 링크였다.
  // 앵커의 **존재**를 무는 검사는 앵커의 **목적지**가 썩는 것을 영원히 못 잡는다.
  //
  // 그래서 목적지를 `App.jsx`의 라우트 표와 대조한다 — 하드코딩한 기대값이 아니라
  // **라우트 표를 소유자에게서 읽어** 맞춘다. 목적지가 바뀌어도(제품 결정) 그것이
  // 실재하는 화면이기만 하면 통과하고, 라우트가 사라지면 즉시 붉어진다.
  const liveRoutes = (() => {
    const appSrc = readFileSync(resolve(root, 'src/App.jsx'), 'utf-8');
    return [...appSrc.matchAll(/path="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => p !== '*'); // catch-all은 "도착지"가 아니라 실패 처리다
  })();
  const isLiveRoute = (href) =>
    liveRoutes.some((route) => {
      if (route.endsWith('/*')) return href === route.slice(0, -2) || href.startsWith(route.slice(0, -1));
      if (route.includes(':')) {
        const rx = new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
        return rx.test(href);
      }
      return href === route;
    });

  await scenario('카드 — due 개념만 렌더 + "복습하러 가기 →"가 실재 라우트로 간다', async () => {
    // 이 검사가 무의미해지는 경우를 먼저 배제한다: 헬퍼가 항상 참이면 계약이 죽는다.
    assert(liveRoutes.length > 3, `App.jsx 라우트 표를 못 읽었다 — ${liveRoutes.length}건`);
    assert(isLiveRoute('/learn'), '라우트 표 대조가 고장났다(/learn을 못 찾는다)');
    assert(!isLiveRoute('/daily'), '폐지된 /daily가 살아 있는 라우트로 잡힌다 — 대조가 헐겁다');

    // 위 시나리오 후 due는 air_mass 1건뿐(typhoon·heat_island는 방금 학습, pressure_front 내일)
    const reactRoot = mountCard();
    await waitFor(() => window.document.querySelector(CARD_SEL), 5000, '카드 렌더');
    const text = window.document.querySelector(CARD_SEL).textContent;
    assert(text.includes('기단'), 'due인 air_mass(기단) 칩이 없음');
    assert(!text.includes('태풍'), '미due인 typhoon(태풍)이 렌더됨 — due 필터 실패');

    const link = [...window.document.querySelectorAll(`${CARD_SEL} a`)].find((a) =>
      a.textContent.includes('복습하러 가기'),
    );
    assert(link, '「복습하러 가기」 링크 없음');
    const href = link.getAttribute('href');
    assert(
      isLiveRoute(href),
      `복습 CTA가 실재하지 않는 라우트로 간다 — href="${href}" · `
        + `살아 있는 라우트: ${liveRoutes.join(' ')}`,
    );
    assert(pageErrors.length === 0, `마운트 중 페이지 에러: ${pageErrors[0]}`);
    reactRoot.unmount();
  });

  // ── 4. due 0건 → 미렌더(null — 빈 카드 금지) ───────────────────────────────
  await scenario('카드 — 이력 0건(reset-me)이면 렌더하지 않는다', async () => {
    const reset = await api('POST', '/dev/reset-me', { reset: true });
    assert(reset.status === 200, `reset-me ${reset.status}`);
    const { data: queue } = await api('GET', '/progress/review-queue');
    assert(Array.isArray(queue) && queue.length === 0, '신규 가입 직후 큐는 빈 배열이어야 함');

    const reactRoot = mountCard();
    await sleep(900); // mock 응답 지연(250ms) + 렌더 여유 — 렌더가 없어야 하는 쪽 대기
    assert(!window.document.querySelector(CARD_SEL), 'due 0건인데 카드가 렌더됨(빈 카드 금지 위반)');
    reactRoot.unmount();
  });

  // ── + 게스트 전환 mock 계약 (§6.2 — FE-C 소유분 형태 검증) ──────────────────
  await scenario('전환 mock — NOT_GUEST·이메일 중복·성공 토큰 재발급', async () => {
    // 게스트가 아닌 상태(초기/reset 후) → 409 NOT_GUEST
    let res = await api('POST', '/auth/guest/convert', { email: 'a@b.dev', password: 'pw12345!' });
    assert(res.status === 409 && res.data?.code === 'NOT_GUEST', `비게스트 ${res.status}/${res.data?.code} ≠ 409/NOT_GUEST`);
    // 게스트 시작 → 중복 이메일 → register 의미론(409 EMAIL_ALREADY_EXISTS)
    res = await api('POST', '/auth/guest');
    assert(res.status === 201 && res.data?.access_token && res.data?.refresh_token, '게스트 발급 실패');
    res = await api('POST', '/auth/guest/convert', { email: 'taken@weathermind.dev', password: 'pw12345!' });
    assert(res.status === 409 && res.data?.code === 'EMAIL_ALREADY_EXISTS', `중복 ${res.status}/${res.data?.code} ≠ 409/EMAIL_ALREADY_EXISTS`);
    // 새 이메일 → 200 LoginResponse(토큰 재발급) → 이후 재전환은 NOT_GUEST
    res = await api('POST', '/auth/guest/convert', { email: `fe-c-${Date.now()}@test.dev`, password: 'pw12345!', nickname: '스모크' });
    assert(res.status === 200 && res.data?.access_token && res.data?.refresh_token, `전환 성공 형태 위반: ${res.status} ${JSON.stringify(res.data)}`);
    res = await api('POST', '/auth/guest/convert', { email: `fe-c2-${Date.now()}@test.dev`, password: 'pw12345!' });
    assert(res.status === 409 && res.data?.code === 'NOT_GUEST', '전환 후 재전환이 NOT_GUEST가 아님');
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 복습 큐 파생 + parity + 카드 실마운트 + 게스트 전환 mock 스모크 통과');
process.exit(0);

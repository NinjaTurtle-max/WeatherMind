/**
 * 학습 지역 스모크 (R12 선행 §8 FE-R) — node tests/region.smoke.test.mjs
 *
 * 검증 축:
 *  1. parity 가드 — 서버 화이트리스트(backend weather_api.py KMA_GRID 12도시)와
 *     geoSnap.REGIONS·mock 허용값이 정확히 일치. PUT 응답은 {region} 단일 키,
 *     밖의 지역은 422 VALIDATION_ERROR(daily-goal 동일 의미론), me 기본 '서울'.
 *  2. geoSnap 순수 함수 — 12도시 앵커 좌표 자기 스냅(상수 반환 변이가 여기서 문다)
 *     + 중간 지점 경계 케이스 + 비수치 입력 null.
 *  3. RegionPicker 실마운트(jsdom + createRoot) — 칩 렌더 → 시트 → 도시 선택 →
 *     PUT 발화 → 칩 갱신(me 캐시 반영).
 *  4. 422 UI 처리 — 요청 인터셉터로 본문을 오염시켜 강제 422 → 오류 문구 렌더 +
 *     칩(현재 지역) 유지.
 *  5. GPS 스냅 — geolocation 목 좌표 → 최근접 도시로 PUT. **PUT 본문에 위경도가
 *     실리지 않는 것**(§8.2 개인위치정보 미취급)을 본문 키로 단정.
 *  6. GPS 실패 UX — 권한 거부 시 PUT 미발화·조용한 수동 선택 안내(오류 승격 금지).
 *
 * 관례: 테스트 러너 의존 없는 node 직접 실행, vite ssrLoadModule + jsdom 실마운트,
 * 하네스 로케일 ko 고정(i18n.smoke.test.mjs 관례 — 한국어 문구·도시명 단정 불변).
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
// 하네스 로케일 ko 고정 — 칩·도시명 한국어 단정이 jsdom 기본(en-US)에 좌우되지 않게
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
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const RegionPicker = (await vite.ssrLoadModule('/src/components/RegionPicker.jsx')).default;
const geoSnap = await vite.ssrLoadModule('/src/lib/geoSnap.js');
// RegionPicker가 쓰는 것과 동일한 axios 인스턴스(vite 모듈 캐시 공유) — 인터셉터로
// PUT 본문을 관찰·오염시킬 수 있다(422 UI·프라이버시 계약 검증용).
const client = (await vite.ssrLoadModule('/src/api/client.js')).default;

// 전 구간 PUT /progress/region 본문 기록(§8.2 — 위경도 비전송 단정용)
const putBodies = [];
client.interceptors.request.use((config) => {
  if (config.url === '/progress/region') {
    putBodies.push(JSON.parse(JSON.stringify(config.data ?? {})));
  }
  return config;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mountPicker() {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  reactRoot.render(createElement(QueryClientProvider, { client: qc }, createElement(RegionPicker)));
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

const CHIP = '[data-testid="region-chip"]';
const SHEET = '[data-testid="region-picker"]';
const chipEl = () => window.document.querySelector(CHIP);
const sheetEl = () => window.document.querySelector(SHEET);

// 서버 화이트리스트 원문 — backend/app/services/weather_api.py KMA_GRID 키 12종
// (파일 소유 밖이라 프론트 쪽에서 소스를 읽어 대조하는 parity 관례 — review-queue 선례)
function readServerRegions() {
  const src = readFileSync(resolve(root, '../backend/app/services/weather_api.py'), 'utf-8');
  const block = src.match(/KMA_GRID = \{([\s\S]*?)\}/)?.[1];
  assert(block, 'KMA_GRID 블록을 찾지 못함 — weather_api.py 이동 시 이 가드 갱신');
  return [...block.matchAll(/"([^"]+)":\s*\(/g)].map((m) => m[1]);
}

try {
  // ── 1. parity: KMA_GRID == geoSnap.REGIONS == mock 허용값 ──────────────────
  await scenario('parity — 서버 KMA_GRID 12도시 == geoSnap.REGIONS == mock 화이트리스트', async () => {
    const serverRegions = readServerRegions();
    assert(serverRegions.length === 12, `서버 12도시 기대, 실측 ${serverRegions.length}`);
    const feRegions = geoSnap.REGIONS.map((r) => r.value);
    assert(
      JSON.stringify([...serverRegions].sort()) === JSON.stringify([...feRegions].sort()),
      `도시 목록 드리프트 — server ${serverRegions} vs geoSnap ${feRegions}`,
    );

    // me 기본값 '서울'(NULL=서울 해석 완료값) + region 필드 존재
    let res = await api('GET', '/progress/me');
    assert(res.status === 200 && res.data?.region === '서울', `me 기본 region ${res.data?.region} ≠ 서울`);

    // 12도시 전부 PUT 200, 응답은 {region} 단일 키(서버 형태 동일 계약)
    for (const region of serverRegions) {
      res = await api('PUT', '/progress/region', { region });
      assert(res.status === 200, `PUT ${region} → ${res.status}`);
      assert(
        JSON.stringify(Object.keys(res.data)) === JSON.stringify(['region']) && res.data.region === region,
        `PUT ${region} 응답 형태 위반: ${JSON.stringify(res.data)}`,
      );
    }
    // 화이트리스트 밖 → 422 VALIDATION_ERROR(daily-goal 동일 의미론)
    res = await api('PUT', '/progress/region', { region: '평양' });
    assert(res.status === 422 && res.data?.code === 'VALIDATION_ERROR', `밖 지역 ${res.status}/${res.data?.code} ≠ 422/VALIDATION_ERROR`);
    res = await api('PUT', '/progress/region', {});
    assert(res.status === 422, `region 누락 ${res.status} ≠ 422`);

    // 이후 시나리오 초기 상태 복원
    res = await api('PUT', '/progress/region', { region: '서울' });
    assert(res.status === 200, '서울 복원 실패');
  });

  // ── 2. geoSnap 순수 함수 — 자기 스냅 + 경계 + 방어 ─────────────────────────
  await scenario('geoSnap — 12도시 앵커 자기 스냅 + 중간 지점 경계 + 비수치 null', async () => {
    for (const r of geoSnap.REGIONS) {
      const got = geoSnap.nearestRegion(r.lat, r.lon);
      assert(got === r.value, `${r.value} 앵커가 ${got}로 스냅됨(최근접 계산 오류)`);
    }
    // 서울 시청 좌표 → 서울 (과제 명시 케이스)
    assert(geoSnap.nearestRegion(37.5665, 126.978) === '서울', '서울 좌표가 서울로 스냅되지 않음');
    // 부천 근방(서울-인천 사이, 인천 쪽) → 인천
    const bucheon = geoSnap.nearestRegion(37.48, 126.78);
    assert(bucheon === '인천', `서울-인천 중간(인천측) ${bucheon} ≠ 인천`);
    // 과천 근방(서울-수원 사이, 서울 쪽) → 서울
    const gwacheon = geoSnap.nearestRegion(37.43, 127.0);
    assert(gwacheon === '서울', `서울-수원 중간(서울측) ${gwacheon} ≠ 서울`);
    // 비수치 입력은 null(스냅 실패 → 수동 선택 폴백)
    assert(geoSnap.nearestRegion(NaN, 127) === null, '비수치 입력이 null이 아님');
    assert(geoSnap.nearestRegion(undefined, undefined) === null, 'undefined 입력이 null이 아님');
  });

  // ── 3. 픽커 실마운트: 칩 → 시트 → 선택 → PUT → 칩 갱신 ────────────────────
  await scenario('픽커 — 칩(서울) → 시트 열림 → 부산 선택 → PUT 발화 → 칩 갱신', async () => {
    const reactRoot = mountPicker();
    await waitFor(() => chipEl(), 5000, '칩 렌더');
    await waitFor(() => chipEl().textContent.includes('서울'), 5000, '칩 초기 지역(서울)');
    assert(!sheetEl(), '열기 전인데 시트가 렌더됨');

    chipEl().click();
    await waitFor(() => sheetEl(), 3000, '시트 열림');
    const cities = sheetEl().querySelectorAll('[data-region]');
    assert(cities.length === 12, `도시 버튼 ${cities.length}개 ≠ 12`);
    const seoulBtn = sheetEl().querySelector('[data-region="서울"]');
    assert(seoulBtn?.getAttribute('aria-pressed') === 'true', '현재 지역(서울) 버튼이 aria-pressed=true가 아님');

    const before = putBodies.length;
    sheetEl().querySelector('[data-region="부산"]').click();
    await waitFor(() => chipEl().textContent.includes('부산'), 6000, '칩이 부산으로 갱신');
    assert(putBodies.length === before + 1, 'PUT이 정확히 1회 발화하지 않음');
    assert(!sheetEl(), '저장 성공 후 시트가 닫히지 않음');
    const { data: me } = await api('GET', '/progress/me');
    assert(me?.region === '부산', `me.region ${me?.region} ≠ 부산(PUT 미반영)`);
    assert(pageErrors.length === 0, `마운트 중 페이지 에러: ${pageErrors[0]}`);
    reactRoot.unmount();
  });

  // ── 4. 422 UI 처리 — 본문 오염으로 강제 422 → 오류 문구 + 칩 유지 ──────────
  await scenario('픽커 — 422 응답은 오류 문구로 보여주고 칩(현재 지역)은 유지', async () => {
    const reactRoot = mountPicker();
    await waitFor(() => chipEl()?.textContent.includes('부산'), 5000, '칩 초기 지역(부산)');
    chipEl().click();
    await waitFor(() => sheetEl(), 3000, '시트 열림');

    // 인터셉터로 본문을 화이트리스트 밖 값으로 오염 — UI는 12도시만 노출하므로
    // 정상 경로에서 422를 만들 수 없다(서버 검증 소유). 전송 계층에서 강제한다.
    const id = client.interceptors.request.use((config) => {
      if (config.method === 'put' && config.url === '/progress/region') {
        config.data = { region: '평양' };
      }
      return config;
    });
    try {
      sheetEl().querySelector('[data-region="대구"]').click();
      await waitFor(
        () => sheetEl()?.querySelector('[data-testid="region-save-error"]'),
        6000,
        '422 오류 문구 렌더',
      );
      const errText = sheetEl().querySelector('[data-testid="region-save-error"]').textContent;
      assert(errText.includes('지역을 저장하지 못했어요'), `오류 문구 없음: ${errText}`);
      assert(chipEl().textContent.includes('부산'), '422인데 칩이 바뀜(현재 지역 유지 위반)');
      const { data: me } = await api('GET', '/progress/me');
      assert(me?.region === '부산', '422인데 서버 상태가 바뀜');
    } finally {
      client.interceptors.request.eject(id);
    }
    reactRoot.unmount();
  });

  // ── 5. GPS 스냅 — 좌표 → 최근접 도시 PUT, 위경도 비전송(§8.2) ──────────────
  await scenario('GPS — 울산 좌표 스냅 → PUT {region}만 전송(위경도 폐기) → 칩 갱신', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onOk) =>
          onOk({ coords: { latitude: 35.5384, longitude: 129.3114 } }), // 울산 시청 근방
      },
    });
    const reactRoot = mountPicker();
    await waitFor(() => chipEl()?.textContent.includes('부산'), 5000, '칩 초기 지역(부산)');
    chipEl().click();
    await waitFor(() => sheetEl(), 3000, '시트 열림');

    const before = putBodies.length;
    sheetEl().querySelector('[data-testid="region-gps"]').click();
    await waitFor(() => chipEl().textContent.includes('울산'), 6000, 'GPS 스냅 후 칩이 울산');
    assert(putBodies.length === before + 1, 'GPS 스냅 PUT이 1회 발화하지 않음');
    const body = putBodies[putBodies.length - 1];
    assert(
      JSON.stringify(Object.keys(body)) === JSON.stringify(['region']) && body.region === '울산',
      `PUT 본문에 region 외 필드 — 위경도 전송 금지 위반: ${JSON.stringify(body)}`,
    );
    reactRoot.unmount();
  });

  // ── 6. GPS 실패 — 권한 거부 → PUT 미발화, 조용한 수동 선택 안내 ─────────────
  await scenario('GPS — 권한 거부는 오류 승격 없이 수동 선택 안내로 폴백(PUT 0회)', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_onOk, onErr) => onErr({ code: 1, message: 'User denied Geolocation' }),
      },
    });
    const reactRoot = mountPicker();
    await waitFor(() => chipEl()?.textContent.includes('울산'), 5000, '칩 초기 지역(울산)');
    chipEl().click();
    await waitFor(() => sheetEl(), 3000, '시트 열림');

    const before = putBodies.length;
    sheetEl().querySelector('[data-testid="region-gps"]').click();
    await waitFor(
      () => sheetEl()?.querySelector('[data-testid="region-gps-fallback"]'),
      4000,
      '수동 선택 안내 렌더',
    );
    assert(putBodies.length === before, '거부됐는데 PUT이 발화됨');
    assert(sheetEl(), '거부됐는데 시트가 닫힘(수동 선택 경로 차단)');
    assert(!sheetEl().querySelector('[data-testid="region-save-error"]'), '거부가 저장 오류로 승격됨');
    assert(chipEl().textContent.includes('울산'), '거부됐는데 칩이 바뀜');
    assert(pageErrors.length === 0, `GPS 실패 경로 페이지 에러: ${pageErrors[0]}`);
    reactRoot.unmount();
  });
} finally {
  await vite.close();
  httpServer.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 지역 parity + geoSnap 스냅 + 픽커 실마운트 + 422·GPS 실패 UX 스모크 통과');
process.exit(0);

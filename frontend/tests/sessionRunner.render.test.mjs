/**
 * SessionRunner 3모드 SSR 렌더 스모크 (R9-09 재발 방지 b) —
 *   node tests/sessionRunner.render.test.mjs
 *
 * 세션 엔진의 세 진입 모드가 초기(LOADING) 상태에서 throw 없이 렌더되는지 확인한다:
 *   - daily: SessionPage (/daily, GET /session/today)
 *   - unit:  UnitSessionPage (/learn/units/:unitId, POST 유닛 세션 발급)
 *   - bulk placement: PlacementPage (/onboarding/placement, R7-02 일괄 채점 모드)
 *
 * 배경(R9-09): 가입 직후 배치고사 미진입 회귀 조사에서 "마운트 단계 크래시로
 * 쿼리가 발화하지 못하는" 경로가 상주 테스트 없이 방치돼 있었다. SSR 렌더는
 * effect를 실행하지 않으므로 여기서는 첫 페인트 크래시만 가드하고, effect까지
 * 포함한 실마운트·쿼리 발화는 placementEntry.smoke.test.mjs가 가드한다.
 *
 * exploreSims.render.test.mjs와 같은 관례: vite ssrLoadModule + renderToString,
 * 테스트 러너 의존 없음.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// react-dom dev 빌드의 SSR 경고 없이 조용히 렌더 — 동적 import보다 먼저 설정
process.env.NODE_ENV = 'production';

// 로케일 고정(ko) — 이 스모크는 "ko 화면 무회귀"를 검증한다. i18n 전면 외부화(R11
// 웨이브 2) 후 detectLocale()이 localStorage → navigator.language 순으로 고르는데,
// node에 localStorage가 없고 GitHub 러너의 navigator.language는 en-US라서 고정
// 없이는 CI에서만 en으로 렌더돼 한국어 단정 17건이 깨진다(en-US 강제 재현으로
// 실측). jsdom 스모크 7종의 weathermind.locale 고정과 같은 관례의 SSR판.
globalThis.localStorage = {
  getItem: (k) => (k === 'weathermind.locale' ? 'ko' : null),
  setItem() {}, removeItem() {},
};

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { createServer } = await import('vite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

// LOADING 상태의 공용 스피너 문구(SessionRunner) — 세 모드 공통 기대값
const LOADING_LABEL = '세션을 준비하고 있어요';

const TARGETS = [
  {
    name: 'daily (SessionPage)',
    path: '/src/modules/session/SessionPage.jsx',
    render: (Comp) =>
      createElement(MemoryRouter, { initialEntries: ['/daily'] }, createElement(Comp)),
    expects: [LOADING_LABEL],
  },
  {
    name: 'unit (UnitSessionPage)',
    path: '/src/modules/curriculum/UnitSessionPage.jsx',
    render: (Comp) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/learn/units/u0000001-0000-4000-8000-000000000001'] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/learn/units/:unitId', element: createElement(Comp) }),
        ),
      ),
    expects: [LOADING_LABEL, '학습 경로로'],
  },
  {
    name: 'bulk placement (PlacementPage)',
    path: '/src/modules/onboarding/PlacementPage.jsx',
    render: (Comp) =>
      createElement(MemoryRouter, { initialEntries: ['/onboarding/placement'] }, createElement(Comp)),
    expects: [LOADING_LABEL, '건너뛰기'],
  },
];

let failed = 0;
try {
  for (const { name, path, render, expects } of TARGETS) {
    let html;
    try {
      const mod = await server.ssrLoadModule(path);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      html = renderToString(
        createElement(QueryClientProvider, { client: qc }, render(mod.default)),
      );
    } catch (err) {
      console.error(`FAIL ${name}: 렌더 중 throw — ${err?.message ?? err}`);
      failed += 1;
      continue;
    }
    const missing = expects.filter((s) => !html.includes(s));
    if (missing.length > 0) {
      console.error(`FAIL ${name}: 기대 문구 누락 — ${missing.join(', ')}`);
      failed += 1;
      continue;
    }
    console.log(`PASS ${name} (${html.length} chars)`);
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: SessionRunner 3모드(daily/unit/bulk placement) SSR 렌더 스모크 통과');

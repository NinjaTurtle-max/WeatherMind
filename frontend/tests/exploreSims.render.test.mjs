/**
 * 탐구 시뮬 페이지 렌더 스모크 (R9-01 §3.5 S5) — node tests/exploreSims.render.test.mjs
 *
 * vite ssrLoadModule로 JSX 페이지 3종을 임포트한 뒤 기본 상태로
 * renderToString(MemoryRouter 래핑)이 성공하고 핵심 문구가 출력되는지 확인한다.
 * 테스트 러너 의존 없이 boardEngine.vectors.test.mjs와 같은 node 직접 실행 관례.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// react-dom dev 빌드의 SSR 경고(useLayoutEffect 등) 없이 조용히 렌더하기 위해
// 프로덕션 빌드를 쓴다 — CJS 진입점이 require 시점에 NODE_ENV를 읽으므로
// 반드시 동적 import보다 먼저 설정해야 한다.
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
const { MemoryRouter } = await import('react-router-dom');
const { createServer } = await import('vite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  { path: '/src/modules/explore/ExploreHome.jsx', name: 'ExploreHome', expects: ['탐구', '교육용 단순화 모델'] },
  // CO-S-10(2026-08-08): 두 시뮬의 θ 루프 CTA는 라벨이 "학습 경로에서 이어가기"인데
  // 목적지가 `/`(홈)였다 — 학습 경로는 `/learn`이다. href를 계약으로 고정한다.
  { path: '/src/modules/explore/TyphoonSimPage.jsx', name: 'TyphoonSimPage', expects: ['태풍', '왜 그럴까', 'href="/learn"'] },
  { path: '/src/modules/explore/ClimateSimPage.jsx', name: 'ClimateSimPage', expects: ['기후변화', '폭염일수', 'href="/learn"'] },
];

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  // ssrLoadModule만 쓰므로 클라이언트 dep 스캔(index.html 진입) 불필요 —
  // server.close()와의 경쟁으로 나는 무해한 dep-scan 오류 로그도 함께 제거된다.
  optimizeDeps: { noDiscovery: true, include: [] },
});

let failed = 0;
try {
  for (const { path, name, expects } of TARGETS) {
    const mod = await server.ssrLoadModule(path);
    if (typeof mod.default !== 'function') {
      console.error(`FAIL ${name}: default export가 컴포넌트가 아닙니다`);
      failed += 1;
      continue;
    }
    const html = renderToString(createElement(MemoryRouter, null, createElement(mod.default)));
    if (!html || html.length === 0) {
      console.error(`FAIL ${name}: 렌더 결과가 비어 있습니다`);
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

  // CO-S-10 덤: `/explore/typhoon`·`/explore/climate`가 Layout의 isWide 목록에
  // 없어서 **카드를 누르는 순간 본문이 1152 → 576px로 접혔다.** 하위 경로까지
  // 넓은 셸을 받는지 소스 계약으로 고정한다(뷰포트 폭은 jsdom이 재현 못 한다).
  {
    const { readFile } = await import('node:fs/promises');
    const layout = await readFile(resolve(root, 'src/components/Layout.jsx'), 'utf8');
    if (/pathname\.startsWith\('\/explore'\)/.test(layout)) {
      console.log('PASS Layout.isWide가 /explore 하위 경로까지 본다');
    } else {
      console.error("FAIL Layout.isWide: pathname.startsWith('/explore')가 없다 — 시뮬 화면이 576px로 접힌다");
      failed += 1;
    }
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 페이지 3종 렌더 스모크 통과');

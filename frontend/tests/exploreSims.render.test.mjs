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

/** MT-21 위성 도식 검사용 — 위 루프의 expects 방식과 달리 컴포넌트를 직접 그린다. */
const checkMt21 = (name, cond) => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
};
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

  // ── MT-21 위성 도식 — **정지 프레임에서 시어가 읽히는가** ──────────────────
  //
  // 이 패널의 존립 근거는 "TyphoonEye가 못 보여주는 것을 보인다"이고, 그 하나가
  // **연직 시어의 흔적**(구름 방패 쏠림 · 눈 유무)이다. 신호를 회전 애니메이션에
  // 실으면 SSR 한 프레임·reduced-motion 사용자에게는 존재하지 않는 것이 된다.
  // 그래서 마크업 자체가 시어에 따라 달라져야 하고, 여기서 그것을 문다.
  {
    const { default: SatelliteView } = await server.ssrLoadModule(
      '/src/modules/explore/SatelliteView.jsx',
    );
    const draw = (intensity, shear) =>
      renderToString(createElement(SatelliteView, { intensity, shear }));
    const EYE = /r="[\d.]+" fill="#0f172a"/; // 배경색으로 뚫은 눈

    const weak = draw(80, 'weak');
    const strong = draw(80, 'strong');

    // ⑴ 같은 강도인데 시어만 다르면 그림이 달라야 한다(안 달라지면 시어가 표시에 없다)
    checkMt21('시어 약/강이 서로 다른 도식을 그린다', weak !== strong);
    // ⑵ 시어 약 + 충분한 강도 → 눈이 뚫린다 / 시어 강 → 눈 없이 중심 십자만
    checkMt21('시어 약 + 강도 80 → 눈이 뚫린다', EYE.test(weak));
    checkMt21('시어 강 → 눈 없이 중심이 드러난다', !EYE.test(strong) && strong.includes('#f87171'));
    // ⑶ 미발생(강도 0)은 방패를 그리지 않는다
    // 색이 아니라 **구조**로 묻는다 — `#ffffff`는 범례에도 쓰여서 색 대조는
    // 거짓 양성이 난다(실제로 이 검사를 색으로 썼다가 헛failed가 났다).
    const quiet = draw(0, 'weak');
    checkMt21('강도 0 → 구름 방패 없음(정지 구름만)',
      quiet.includes('data-sat-quiet') && !quiet.includes('data-sat-shield'));
    // ⑷ **실사 아님 표기**는 이 컴포넌트의 계약이다 — 원 F3(KMA 실사 영상)를
    //    도식으로 재범위한 것이 착수를 가능하게 만든 경계이기 때문이다.
    checkMt21('실사 아님 표기가 항상 있다', weak.includes('교육용 도식'));
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 페이지 3종 렌더 스모크 통과');

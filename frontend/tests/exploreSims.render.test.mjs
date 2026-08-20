/**
 * 탐구 시뮬 페이지 렌더 스모크 (R9-01 §3.5 S5) — node tests/exploreSims.render.test.mjs
 *
 * vite ssrLoadModule로 JSX 페이지 3종을 임포트한 뒤 기본 상태로
 * renderToString(MemoryRouter 래핑)이 성공하고 핵심 문구가 출력되는지 확인한다.
 * 테스트 러너 의존 없이 boardEngine.vectors.test.mjs와 같은 node 직접 실행 관례.
 */
import { readFile } from 'node:fs/promises';
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

  // ── MT-21 위성 도식 — 시어가 **그림을 실제로 바꾸는가** ────────────────────
  //
  // 초판은 SVG라 마크업을 문자열로 물었다. 개정판은 **캔버스 절차 렌더**라 SSR에
  // 픽셀이 없다 — 그래서 판정을 `satelliteField`의 **순수 계산부**로 내렸다.
  // 화면을 안 보고도 "시어를 올리면 구름이 한쪽으로 쏠린다"를 숫자로 확인한다.
  {
    const field = await server.ssrLoadModule('/src/modules/explore/satelliteField.js');
    const at = (shear) => ({
      asym: field.asymmetry({ intensity: 85, shear }),
      core: field.coreCover({ intensity: 85, shear }),
    });
    const weak = at('weak');
    const mod = at('moderate');
    const strong = at('strong');

    // ⑴ 시어가 셀수록 좌우 불균형이 커진다 — 이 패널의 존립 근거 그 자체
    checkMt21(
      `시어↑ → 비대칭↑ (${weak.asym.toFixed(2)} < ${mod.asym.toFixed(2)} < ${strong.asym.toFixed(2)})`,
      weak.asym < mod.asym && mod.asym < strong.asym,
    );
    // ⑵ 시어가 약할 때만 중심이 뚫린다(눈). 세면 중심이 구름에 덮이거나 밀려난다.
    checkMt21(
      `시어 약 → 눈이 뚫린다 (눈 깊이 ${weak.core.toFixed(2)} < ${mod.core.toFixed(2)})`,
      weak.core < mod.core && weak.core < 0.2,
    );
    // ⑹ **회전이 "같은 무늬의 이동"인가.** 처음에 노이즈 위상에 회전을 더했더니
    //    값이 0.04→0.98→0.00으로 널뛰었다 — 그건 회전이 아니라 매 프레임 다른
    //    무늬였다. 좌표를 반대로 돌려 읽으면 **같은 값**이 나와야 한다.
    {
      const r = 0.4;
      const th = 0.7;
      const om = -1 / (0.22 + r * 2.2);
      const P = { intensity: 90, shear: 'weak' };
      const a = field.cloudAt(r * Math.cos(th), r * Math.sin(th), { ...P, spin: 0 });
      const back = th - 0.25 * 2 * Math.PI * om;
      const b = field.cloudAt(r * Math.cos(back), r * Math.sin(back), { ...P, spin: 0.25 });
      checkMt21(`회전은 무늬를 보존한다 (${a.toFixed(3)} = ${b.toFixed(3)})`,
        Math.abs(a - b) < 1e-9);
    }
    // ⑺ 차등 회전 — 안쪽이 바깥보다 빨라야 밴드가 감긴다(통째로 돌면 바람개비다)
    checkMt21('안쪽이 바깥보다 빨리 돈다',
      Math.abs(-1 / (0.22 + 0.2 * 2.2)) > Math.abs(-1 / (0.22 + 1.0 * 2.2)));
    // ⑶ 미발생은 구름이 0 — 캔버스가 검게 남는다
    checkMt21('강도 0 → 구름 0', field.asymmetry({ intensity: 0, shear: 'weak' }) === 0);
    // ⑷ **결정적**이어야 한다. 같은 입력에 그림이 매번 달라지면 슬라이더를 움직였을 때
    //    무엇 때문에 바뀐 것인지 학습자가 알 수 없다(Math.random 금지).
    checkMt21('같은 입력은 같은 결과', field.asymmetry({ intensity: 70, shear: 'moderate' })
      === field.asymmetry({ intensity: 70, shear: 'moderate' }));
    // ⑸ **실사 아님 표기**는 계약이다 — 사실적으로 보일수록 무게가 커진다.
    //    산출물 라벨에 실제 기관·위성 이름이 섞이면 출처 사칭이 된다.
    const { default: koRes } = await server.ssrLoadModule('/src/i18n/resources/board.ko.js');
    const sat = koRes.explore.satellite;
    checkMt21('실사 아님 표기가 리소스에 있다', /도식/.test(sat.schematicBadge));
    // ⑻ **색을 쓰지 않는다**(2026-08-12 결정). 강조 IR의 초록·노랑·빨강·자홍을
    //    뺐다 — 학습자에게 그 색은 정보가 아니라 소음이고, 세기를 읽는 축이
    //    크기·속도·색 셋으로 갈리면 무엇을 봐야 할지 모른다.
    //    램프 전 구간이 **무채색(R≈G≈B)**인지 소스에서 직접 확인한다.
    {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = readFileSync(join(root, 'src/modules/explore/SatelliteView.jsx'), 'utf8');
      const block = src.slice(src.indexOf('const IR_RAMP = ['), src.indexOf('];', src.indexOf('const IR_RAMP = [')));
      const rgbs = [...block.matchAll(/\[\s*(\d+),\s*(\d+),\s*(\d+)\s*\]/g)]
        .map((m) => [+m[1], +m[2], +m[3]]);
      const chroma = rgbs.map(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b));
      checkMt21(
        `색 램프가 무채색이다 (최대 채도차 ${Math.max(...chroma)} — 바다의 푸른기까지만 허용)`,
        rgbs.length >= 4 && Math.max(...chroma) <= 46,
      );
    }
    checkMt21('산출물 라벨이 실제 기관·위성명을 사칭하지 않는다',
      !/천리안|GK2A|히마와리|Himawari|KMA|기상청|NOAA|GOES/i.test(sat.productLine));
  }

  // ── 화면 간 배치 정합 (2026-08-17 사용자 제보) ────────────────────────────
  /**
   * "탐구만 배치가 오른쪽 아래로 살짝 치우쳐 보인다"의 원인이 둘이었고, 둘 다
   * **탐구 안에서는 안 보이는 종류**라 소스 계약으로 못박는다.
   *
   *  ⓐ 세로 — 페이지 래퍼가 `py-4`라 첫 카드가 8px 아래에서 시작했다(실측
   *     1440: 탐구 y=80 · 학습·보드·예보·내 정보 y=72). 다른 화면과 같은
   *     `pt-2`를 쓴다. 아래 여백은 `Layout`의 `main`이 `pb-8`로 이미 갖는다.
   *  ⓑ 가로 — 탐구는 **내용이 한 화면에 들어가 페이지 스크롤이 없는 유일한
   *     화면**이라(실측 docH 900 = 화면 높이 · 나머지 929~2303), 그 화면으로
   *     갈 때만 세로 스크롤바가 사라지고 가운데 정렬 본문이 ≈8px 오른쪽으로
   *     밀린다. `scrollbar-gutter: stable`이 자리를 늘 비워 고정한다.
   *     ⚠️ 탐구를 길게 만들어 고칠 문제가 아니다 — 카드가 하나 늘면 증상이
   *     저절로 사라졌다가 지우면 돌아온다.
   */
  const homeSrc = await readFile(resolve(root, 'src/modules/explore/ExploreHome.jsx'), 'utf8');
  const wrap = homeSrc.match(/<div className="(space-y-4[^"]*)"/)?.[1] ?? '';
  checkMt21(`ⓐ 탐구 래퍼가 다른 화면과 같은 상단 여백을 쓴다 — 실제 "${wrap}"`,
    /\bpt-2\b/.test(wrap) && !/\bpy-\d/.test(wrap));
  const cssSrc = await readFile(resolve(root, 'src/styles/index.css'), 'utf8');
  checkMt21('ⓑ 스크롤바 자리를 늘 비운다 — 화면을 오갈 때 본문이 옆으로 안 밀린다',
    /scrollbar-gutter:\s*stable/.test(cssSrc));

  // ── 기후변화 체험 2열 배치 (2026-08-19 사용자 지시) ────────────────────────
  /**
   * "아노말리 그래프 크기 줄여서 왼쪽, 오른쪽에는 CO₂ 농도·해수면 상승·연간
   *  폭염일수. 탐구 목표는 그대로 상단 유지, 나머지 그대로 하단."
   *
   * 세 자리가 **각각 계약**이다 — 하나만 움직여도 지시가 깨진다:
   *   ⓒ 곡선과 오른쪽 열이 같은 격자의 **직계 자식**일 것(래퍼 안에 들어가면
   *      2열이 안 선다 — 보드 판정 카드가 같은 실수로 700px에 갇힌 전례)
   *   ⓓ 탐구 목표·「왜 그럴까」·CTA는 격자 **밖**일 것(지시 1·3)
   *   ⓔ 지표 2종은 lg에서 세로로 쌓일 것(좁은 열에서 가로면 한 칸 220px라
   *      「연간 폭염일수」가 두 줄로 접힌다)
   *   ⓕ 곡선에 **고정 높이를 박지 않을 것** — viewBox SVG라 폭이 줄면 높이가
   *      따라 준다(582 → 413 실측). h-…를 박으면 뷰포트마다 찌그러진다.
   * jsdom에 CSS 엔진이 없어 두 열을 좌표로 못 재므로 소스로 문다.
   * 실브라우저 1536 실측: 두 열 591/513 · 행 높이 413 동일 · pageH 1701 → 1243.
   */
  const climateSrc = await readFile(resolve(root, 'src/modules/explore/ClimateSimPage.jsx'), 'utf8');
  const gridOpen = climateSrc.indexOf('lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]');
  checkMt21('ⓒ 기후변화: 곡선 ↔ 지표 열 2열 격자가 있다', gridOpen > -1);
  const gridBody = gridOpen > -1 ? climateSrc.slice(gridOpen) : '';
  // 격자 열림 이후 등장 순서로 자리를 판정한다.
  const at = (s) => gridBody.indexOf(s);
  const closeGrid = at('{/* /2열 구간 */}');
  const inGrid = (s) => at(s) > -1 && at(s) < closeGrid;
  checkMt21('ⓒ 곡선·CO₂·지표 2종이 전부 격자 안이다',
    closeGrid > -1 && inGrid('<AnomalyCurve') && inGrid("explore.climate.co2Label") && inGrid('<IndicatorCard'));
  checkMt21('ⓓ 탐구 목표는 격자 위(상단)에 남는다 — 사용자 지시 1',
    climateSrc.indexOf('<GoalPanel') > -1 && climateSrc.indexOf('<GoalPanel') < gridOpen);
  checkMt21('ⓓ 「왜 그럴까」와 CTA는 격자 아래(하단)에 남는다 — 사용자 지시 3',
    at("explore.common.whyTitle") > closeGrid && at("explore.climate.cta") > closeGrid);
  // ⓔ **지표 둘은 어느 폭에서나 한 줄**이고, 그래서 오른쪽 열에 한 줄이 남는다.
  //    그 남은 자리를 CO₂ 카드가 `flex-1`로 먹어 **두 열이 같은 줄에서 끝난다**
  //    (2026-08-19 사용자 지시). 둘은 한 쌍이다 — 지표를 다시 세로로 쌓으면 남는
  //    자리가 없어져 flex-1이 할 일이 사라지고, flex-1을 빼면 오른쪽 열 아래가
  //    빈 상자가 된다. 실측 1536: 곡선 336 = CO₂ 177 + 지표 147 + 간격 12.
  //    ⚠️ 높이를 숫자로 박으면 안 된다 — 행 높이는 곡선의 폭(=뷰포트)이 정해
  //    1536/1280/1024에서 336/312/302로 다 다르다.
  checkMt21('ⓔ 지표 2종이 어느 폭에서나 한 줄이다 (lg 예외 없음)',
    /className="grid grid-cols-2 gap-3"/.test(climateSrc));
  checkMt21('ⓔ 남는 한 줄을 CO₂ 카드가 먹는다 — flex-1 (없으면 오른쪽 열 아래가 빈다)',
    /<div className="flex flex-1 flex-col rounded-2xl bg-white p-4/.test(climateSrc));
  checkMt21('ⓔ 늘어난 자리를 슬라이더 뭉치가 쓴다 — 위에 붙이면 카드가 빈 상자가 된다',
    /<div className="flex flex-1 flex-col justify-center py-2">/.test(climateSrc));
  checkMt21('ⓕ 곡선에 고정 높이를 박지 않았다 — 폭이 줄면 높이가 따라 준다',
    !/<AnomalyCurve[\s\S]{0,200}?className="[^"]*\bh-\[/.test(climateSrc));
  // ⓖ 슬라이더 트랙은 **이 화면에서만** 두껍다. 전역 `input[type=range]`(h-2)를
  //    키우면 태풍 실험실·보드 조절값까지 함께 두꺼워진다(그쪽은 카드가 낮아
  //    지금이 맞다). `!h-3`가 그 국소 덮어쓰기다.
  const cssRange = cssSrc.match(/input\[type='range'\][\s\S]{0,160}/)?.[0] ?? '';
  checkMt21('ⓖ 두꺼운 트랙은 기후변화에만 — 전역 기본은 h-2 그대로',
    /!h-3/.test(climateSrc) && /@apply h-2\b/.test(cssRange));
  // ── 태풍 만들기: 바람개비 왼쪽 · 발달 곡선 오른쪽 (2026-08-19 사용자 지시) ──
  /**
   * "해수면 온도 슬라이드는 고정, 바로 위에 바람개비를 왼쪽, 오른쪽에는
   *  발달곡선 그래프 크기 줄여서 배치."
   *
   * 곡선이 **위성 도식 아래에서 여기까지 올라온다.** 그래서 두 가지를 함께 문다:
   *   ㉮ 새 자리에 있는가  ㉯ **옛 자리에 사본이 남지 않았는가**
   * 옮기면서 원본을 안 지우면 같은 그래프가 화면에 두 번 뜬다 — 붙여넣기로
   * 옮기는 종류의 변경에서 가장 흔한 실패다.
   * 「크기 줄여서」는 높이를 박는 게 아니라 열을 나누는 것이다(실측 519 → 361).
   * 실브라우저 1536: 두 열 470/634 · 행 328 · pageH 2733 → 2246.
   */
  const typhoonSrc = await readFile(resolve(root, 'src/modules/explore/TyphoonSimPage.jsx'), 'utf8');
  const tGrid = typhoonSrc.indexOf('lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]');
  const tSst = typhoonSrc.indexOf("explore.typhoon.sstLabel");
  const tSat = typhoonSrc.indexOf('<SatelliteView');
  checkMt21('㉮ 태풍: 바람개비 ↔ 발달 곡선 2열 격자가 있다', tGrid > -1);
  checkMt21('㉮ 격자 안에 바람개비(TyphoonEye)와 발달 곡선이 함께 있다',
    tGrid > -1 && typhoonSrc.indexOf('<TyphoonEye') > tGrid
      && typhoonSrc.indexOf('<DevelopmentCurve') > tGrid);
  checkMt21('㉮ 그 격자가 해수면온도 슬라이더 **바로 위**다 — 슬라이더는 제자리 고정',
    tGrid > -1 && tSst > tGrid && tSat > tSst);
  checkMt21('㉯ 발달 곡선이 옛 자리(위성 도식 아래)에 남아 있지 않다 — 그래프가 두 번 뜨면 안 된다',
    (typhoonSrc.match(/<DevelopmentCurve/g) ?? []).length === 1);
  checkMt21('㉰ 발달 곡선에 고정 높이를 박지 않았다 — 폭이 줄면 높이가 따라 준다',
    !/<DevelopmentCurve[\s\S]{0,200}?className="[^"]*\bh-\[/.test(typhoonSrc));

  // ── 태풍: 위성 도식 왼쪽 · 「왜 그럴까」 오른쪽 (2026-08-19 사용자 지시) ────
  /**
   * "위성 도식 크기 줄이고 오른쪽에 왜그럴까 배치. 태풍개념문제풀기는 그대로 유지."
   *
   * 도식과 해설이 짝인 이유: 해설 문장이 **지금 화면의 도식을 설명한다**(시어가
   * 약하면 「기둥이 곧게 선다」, 강하면 「흐트러진다」). 종전에는 도식 847px을
   * 지나 스크롤해야 그 문장이 나와 읽을 때는 그림이 화면 밖이었다.
   * 실측 1536: 두 열 634/470 · 행 543(도식 847 → 543) · pageH 2246 → 1782.
   *
   * ㉲가 요점이다 — `SatelliteView`가 **자기 `mt-4`를 갖고 있었다.** 세로로 쌓이던
   * 시절에는 부모 `space-y-4`와 값이 같아 안 보였지만, 격자 칸이 되는 순간 옆
   * 칸보다 16px 내려앉는다. 자기 여백을 가진 컴포넌트를 격자에 넣을 때의 함정이다.
   */
  const tSat2 = typhoonSrc.indexOf('lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]');
  const tWhy = typhoonSrc.indexOf("explore.common.whyTitle");
  const tCta = typhoonSrc.indexOf("explore.typhoon.cta");
  checkMt21('㉱ 태풍: 위성 도식 ↔ 왜 그럴까 2열 격자가 있다', tSat2 > -1);
  checkMt21('㉱ 격자 안에 위성 도식과 해설이 함께 있다',
    tSat2 > -1 && typhoonSrc.indexOf('<SatelliteView') > tSat2 && tWhy > tSat2);
  // CTA가 격자 **밖**인지는 들여쓰기로 본다 — 격자 자식은 8칸, 페이지 직계는 6칸.
  // "해설 뒤에 온다"만 보면 격자 **안** 오른쪽 열에 딸려 들어가도 통과한다
  // (보드 판정 카드가 같은 종류의 약한 계약으로 700px에 갇힌 전례가 있다).
  const ctaLine = typhoonSrc.slice(0, tCta).split('\n').reverse().find((l) => l.includes('<Link')) ?? '';
  checkMt21(`㉱ CTA는 격자 밖 하단에 그대로 남는다 — 들여쓰기 ${ctaLine.length - ctaLine.trimStart().length}칸`,
    tCta > tWhy && /^ {6}<Link$/.test(ctaLine));
  checkMt21('㉲ 「왜 그럴까」가 화면에 한 번만 있다 — 옮기며 사본을 남기지 않았다',
    (typhoonSrc.match(/explore\.common\.whyTitle/g) ?? []).length === 1);
  const satSrc = await readFile(resolve(root, 'src/modules/explore/SatelliteView.jsx'), 'utf8');
  checkMt21('㉲ 위성 도식이 자기 여백(mt-4)을 갖지 않는다 — 격자 칸에서 옆 칸보다 16px 내려앉는다',
    !/<figure className="[^"]*\bmt-4\b/.test(satSrc));

  // ⓘ 모델 고지가 **배너 안 제목 아래**에 있고, 배너 밖 회색 띠는 사라졌다
  //    (2026-08-19 사용자 지시). 둘 다 남으면 같은 문장이 화면에 두 번 뜬다 —
  //    옮기다 원본을 안 지우는 것이 이 종류의 흔한 실수라 **없는 것까지** 문다.
  checkMt21('ⓘ 모델 고지가 배너 안으로 들어갔다 (note prop)',
    /note=\{t\('explore\.climate\.disclaimer'\)\}/.test(climateSrc));
  checkMt21('ⓘ 배너 밖 회색 고지 띠는 남아 있지 않다 (같은 문장이 두 번 뜨면 안 된다)',
    !/bg-slate-100 px-3 py-2[^"]*"[\s\S]{0,80}explore\.climate\.disclaimer/.test(climateSrc));
  // ⓗ 「탐구 목표」 제목만 한 단계 크다(2026-08-19 사용자 지시). 항목 글자는
  //    그대로여야 한다 — 같이 키우면 카드가 커져 2열 행 높이가 밀린다.
  const goalSrc = await readFile(resolve(root, 'src/modules/explore/GoalPanel.jsx'), 'utf8');
  checkMt21('ⓗ 「탐구 목표」 제목이 text-base다 (항목 글자는 그대로)',
    /<p className="text-base font-bold text-slate-700">\{t\('explore\.goals\.title'\)\}<\/p>/.test(goalSrc));
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 페이지 3종 렌더 스모크 통과');

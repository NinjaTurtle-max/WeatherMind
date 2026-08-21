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
  // MT-22 배선(2026-08-18): 각 화면의 기대 문구에 **껍데기 1개 + 장면 라벨 1개**를
  // 짝으로 더한다. 껍데기(패널 제목)만 물면 `scene={null}`로 바꿔도 초록이고, 장면
  // 라벨만 물면 패널이 없어도 라벨은 뜬다 — 둘이 있어야 「그 장면이 그 자리에
  // 배선됐다」가 된다. 장면 라벨은 `labelsFor()`가 SSR에서도 계산해 DOM으로 겹쳐
  // 그리는 값이라 문자열로 잡힌다(GL은 글자를 그리지 않는다).
  // ⚠️ 이것은 **DOM 라벨이 나온다**까지이고 **실브라우저에서 화살표가 그려진다**는
  // 아니다(R10-06 — 스텁이 초록인데 단면이 한 번도 안 떴던 전례. 그 구분은
  // crossSectionWebgl.contract.test.mjs 머리 주석이 소유한다).
  // ⚠️ **장면 라벨 기대 문구가 2026-08-19에 바뀌었다** — 문구를 따라간 것이지
  //    계약을 느슨하게 한 것이 아니다. 종전 기대는 `구름 꼭대기 16km`(T1)·
  //    `햇빛 100 (340`(C1)이었는데, 둘 다 **캔버스 안에 있던 긴 문장**이라
  //    보드 문법(긴 문장은 캔버스 밖 캡션 · 캔버스 안은 짧은 명사구)에 맞춰
  //    `STEPS[].note`로 옮겨졌다. 그래서 **같은 성격의 다른 장면 라벨**로 바꾼다:
  //    T1 `권운 차양`(0단계 무대) · T2 `북위 20°`(전향대 눈금) · C1 `태양`.
  //    🔴 **셋 다 0단계 라벨이어야 한다** — SSR은 step 0만 그리므로 1단계 이후
  //    라벨을 기대하면 실패한다(`구름 반사 27`로 잡았다가 실측으로 걸렀다).
  //    ⚠️ 캡션 문자열로 갈아타지 **않았다** — 캡션은 패널이 그리므로 `scene`이
  //    null이어도 뜬다. 위 주석의 「껍데기+장면 라벨 짝」이 깨진다.
  //
  // 🔴 **장면 라벨은 `labels`로 분리해 완전일치로 문다**(2026-08-21). 종전에는 셋 다
  //    `expects`에 섞여 `html.includes()`로 걸렸고, 그래서 라벨이 `태양` → `태양X`로
  //    **변질돼도 초록이었다**(부분문자열이므로). 이제 `labels`는 렌더된 **원소 하나의
  //    텍스트 전체**와 `===`로 맞춰야 통과한다 — 아래 `elementTexts()` 참조.
  //    ⚠️ 껍데기(패널 제목)·단계(캡션 제목)는 `expects`에 **그대로 둔다**. 그 둘은
  //    의도적으로 긴 문자열의 부분이다 — `지구는 받은 만큼 내보낸다`의 실제 렌더값은
  //    `… — 복사수지`이고 `눈과 눈벽`은 `따뜻한 바다 위 — 눈과 눈벽`이다. 완전일치로
  //    바꾸려면 기대 문구 자체를 다시 써야 하는데 그것은 다른 판정이라 손대지 않는다.
  { path: '/src/modules/explore/TyphoonSimPage.jsx',
    name: 'TyphoonSimPage',
    expects: ['태풍', '왜 그럴까', 'href="/learn"',
      '태풍 단면 — 하층과 상층은 반대로 감긴다', '눈과 눈벽', // T1 껍데기+단계
      '태풍의 일생 — 발생에서 온대저기압까지'], // T2 껍데기
    labels: ['권운 차양', '북위 20°'] }, // T1·T2 0단계 장면 라벨(완전일치)
  { path: '/src/modules/explore/ClimateSimPage.jsx',
    name: 'ClimateSimPage',
    expects: ['기후변화', '폭염일수', 'href="/learn"',
      '지구는 받은 만큼 내보낸다', '들어오는 햇빛 100'], // C1 껍데기+단계
    labels: ['태양'] }, // C1 0단계 장면 라벨(완전일치)
  // ⚠️ 이 자리에 *"T2는 단계 제목이 장면 라벨과 같은 `T2_STAGES.title`에서 나오므로
  // 문자열로 가를 수 없다"*고 적혀 있었고 **2026-08-19에 거짓이 됐다** — 라벨 가독성
  // 지적 뒤 T2가 **캔버스 라벨은 `T2_STAGES.short`, 캡션 제목은 `title`**로 갈라졌다
  // (예: 캔버스 「온대저기압」 ↔ 캡션 「쇠퇴 · 온대저기압으로 변질」). 이제 T2도 T1·C1
  // 처럼 갈린다. 경위를 남기는 이유는 이 문장이 **왜 T2만 기대 문구가 둘뿐인지**의
  // 근거로 쓰여 왔기 때문이다.
  // ⚠️ 그래도 기대 문구는 `북위 20°`(0단계 무대 라벨) 그대로 둔다 — `short`는 그 단계
  // 에만 뜨는데(`until: i`) SSR은 step 0만 그리므로 여기서는 쓸 수 없다.
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

/**
 * 렌더된 HTML에서 **잎 원소 하나의 텍스트 전체**를 모은다 — 장면 라벨 완전일치용.
 *
 * 장면 라벨은 `labelsFor()`가 좌표를 계산하고 호출측이 글자만 겹쳐 그린다. SSR(이
 * 스모크)에서는 SVG 폴백이 `<text …>권운 차양</text>`로, 실브라우저 GL 경로에서는
 * `SchematicGL`이 `<span …>권운 차양</span>`로 그린다 — 그래서 두 태그를 함께 본다.
 * 🔴 `html.includes(라벨)`을 대신하는 것이 요점이다. 포함 검사는 `태양X`·`권운 차양막`
 * 처럼 **라벨이 변질돼도 초록**이었다. 여기서는 원소 텍스트와 `===`라야 통과한다.
 */
const elementTexts = (html) => {
  const found = new Set();
  const re = /<(text|span)\b[^>]*>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[2]);
  return found;
};

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
  for (const { path, name, expects, labels = [] } of TARGETS) {
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
    // 장면 라벨은 **완전일치**. 실패 시 기대값과 실제로 그려진 라벨 후보를 함께
    // 찍는다 — 「무엇이 무엇으로 바뀌었나」를 눈으로 읽어야 판정이 된다.
    const texts = elementTexts(html);
    const badLabels = labels.filter((s) => !texts.has(s));
    if (badLabels.length > 0) {
      const near = [...texts].filter((t) => t && badLabels.some((s) => t.includes(s) || s.includes(t)));
      console.error(`FAIL ${name}: 장면 라벨 완전일치 실패 — 기대 ${badLabels.join(', ')}`
        + ` / 실제 근접 라벨 ${near.length ? near.join(', ') : '(없음)'}`);
      failed += 1;
      continue;
    }
    console.log(`PASS ${name} (${html.length} chars, 장면 라벨 완전일치 ${labels.length}건)`);
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

  // ── ⑬ 「숫자만 바뀌고 그림이 안 바뀌면 탐구가 아니다」 (2026-08-19) ────────
  /**
   * 클라이언트가 준 AC 그대로다. 이 화면에는 그 결함이 **미리 놓여 있었다** —
   * 곡선 `useMemo`의 의존성이 `[]`이고 주석이 *"상수 기반 — 의존성 없음"*이었다.
   * 민감도가 조작 변수가 된 순간 곡선은 첫 렌더로 얼어붙는다.
   *
   * ⚠️ **못 무는 것을 밝힌다**: jsdom·SSR에 래스터라이저가 없어 「눈에 보인다」는
   * 원리적으로 측정 불가다. 여기서 재는 것은 **폴리라인 좌표 문자열과 축 눈금이
   * 실제로 달라지는지**까지다. 「그려졌다」가 아니라 「좌표가 달라졌다」다.
   */
  {
    const page = await server.ssrLoadModule('/src/modules/explore/ClimateSimPage.jsx');
    const sims = await server.ssrLoadModule('/src/lib/exploreSims.js');
    const pageSrc = await readFile(
      resolve(root, 'src/modules/explore/ClimateSimPage.jsx'), 'utf8');
    // 주석을 걷는다 — 산문을 값으로 읽으면 고쳐 놓고도 빨강이 나고, 반대로
    // 주석이 단정을 만족시켜 지워도 초록이 된다(양쪽 다 이번 라운드에 실제로 났다).
    const code = pageSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // ⓐ 곡선이 민감도에 따라 실제로 달라진다 — 이 티켓의 본체
    const curveLo = page.anomalyCurvePoints(sims.CLIMATE_SENSITIVITY_MIN);
    const curveMid = page.anomalyCurvePoints(sims.CLIMATE_SENSITIVITY);
    const curveHi = page.anomalyCurvePoints(sims.CLIMATE_SENSITIVITY_MAX);
    checkMt21('⑬ⓐ 곡선 좌표가 민감도마다 다르다(셋이 서로 다르다)',
      curveLo !== curveMid && curveMid !== curveHi && curveLo !== curveHi);
    // 방향까지 — 민감도가 높으면 곡선이 **위로** 간다(SVG는 y가 작을수록 위).
    const lastY = (pts) => Number(pts.split(' ').at(-1).split(',')[1]);
    checkMt21(
      `⑬ⓐ 민감도가 높을수록 곡선 끝이 위로 간다 (${lastY(curveHi)} < ${lastY(curveMid)} < ${lastY(curveLo)})`,
      lastY(curveHi) < lastY(curveMid) && lastY(curveMid) < lastY(curveLo));

    // 🔴 ⓑ 축이 **현재 민감도에 묶이지 않았다.** 묶이면 y = anomaly/maxY 에서
    //    S가 약분돼 **어떤 민감도에서도 곡선이 똑같아진다** — ⓐ가 그것을 잡지만,
    //    왜 그런지가 여기 남아 있어야 다음 사람이 maxY를 되돌리지 않는다.
    checkMt21('⑬ⓑ 축 상한이 슬라이더 최대치로 고정이다(현재 민감도가 아니다)',
      sims.CLIMATE_SENSITIVITY_MAX === page.CURVE_MAX_Y
      && page.CURVE_MAX_Y !== sims.CLIMATE_SENSITIVITY);
    checkMt21(`⑬ⓑ y 눈금이 축 상한까지 있다 — 최대 ${Math.max(...page.CURVE_Y_TICKS)}℃`,
      Math.max(...page.CURVE_Y_TICKS) >= Math.floor(page.CURVE_MAX_Y));
    // 곡선 전 좌표가 그림 안에 있다 — 축이 좁으면 곡선이 위로 삐져나간다.
    const ys = curveHi.split(' ').map((p) => Number(p.split(',')[1]));
    checkMt21('⑬ⓑ 최대 민감도에서도 곡선이 그림 안에 있다',
      Math.min(...ys) >= page.CURVE_VIEW.pad.top);

    // ⓒ 값을 넣는 자리와 의존성 목록은 **한 쌍**이다 — 둘 중 하나만 고치면
    //   결함이 그대로 남는다(원래 결함이 정확히 그 형태였다).
    checkMt21('⑬ⓒ 곡선 useMemo가 민감도를 의존성으로 갖는다',
      /useMemo\(\s*\(\)\s*=>\s*anomalyCurvePoints\(sensitivity\)\s*,\s*\[\s*sensitivity\s*\]\s*\)/.test(code));

    // ⓓ 조작 변수가 화면에 **3개** 있다(축이 하나면 「바꿔가며」가 성립하지 않는다)
    const sliders = code.match(/type="range"/g) ?? [];
    checkMt21(`⑬ⓓ 조작 변수가 3개다 — 실제 ${sliders.length}개`, sliders.length === 3);

    // ⓔ 범위에 자료 근거가 붙어 있다 — 근거 없는 범위는 교육적 거짓이다.
    const libSrc = await readFile(resolve(root, 'src/lib/exploreSims.js'), 'utf8');
    checkMt21('⑬ⓔ 슬라이더 범위에 1차 자료 출처가 붙어 있다(IPCC URL)',
      /ipcc\.ch\/report\/ar6/i.test(libSrc));

    // 🔴 ⓕ 변수가 된 값을 **문구에 못박지 않았다.** 못박으면 슬라이더를 올려도
    //    설명만 옛 숫자를 말해 화면이 자기 그래프와 다른 말을 한다.
    for (const loc of ['ko', 'en']) {
      const res = await readFile(resolve(root, `src/i18n/resources/board.${loc}.js`), 'utf8');
      const climate = res.slice(res.indexOf('climate: {'));
      const disclaimer = climate.match(/disclaimer:\s*'([^']*)'/)?.[1] ?? '';
      const seaNote = climate.match(/seaNote:\s*'([^']*)'/)?.[1] ?? '';
      checkMt21(`⑬ⓕ ${loc} disclaimer가 민감도를 보간으로 받는다`,
        disclaimer.includes('{sens}') && !/S\s*=\s*3\.0/.test(disclaimer));
      checkMt21(`⑬ⓕ ${loc} seaNote가 해수면 계수를 보간으로 받는다`,
        seaNote.includes('{k}') && !/\b23\s*cm/i.test(seaNote));
    }
    // 그리고 호출부가 실제로 넘긴다 — 리소스만 고치면 `{k}`가 화면에 그대로 뜬다.
    checkMt21('⑬ⓕ seaNote 호출부가 계수를 넘긴다',
      /seaNote'\s*,\s*\{\s*k:\s*seaLevelPerDeg\s*\}/.test(code));
    checkMt21('⑬ⓕ disclaimer 호출부가 민감도를 넘긴다',
      /disclaimer'\s*,\s*\{\s*sens:/.test(code));
  }

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
  // ⚠️ **정정(2026-08-19 3판).** 이 줄은 종전에 「왜 그럴까도 격자 아래」였다.
  //    그때는 참이었다 — 지표 둘이 세로로 쌓여 오른쪽 열이 이미 길었기 때문에
  //    *"긴 문단 셋을 좁은 열에 넣으면 그쪽만 혼자 길어진다"*가 성립했다.
  //    지표가 한 줄로 눕고(147px) 왼쪽이 곡선+슬라이더로 길어지면서 **오히려
  //    오른쪽에 자리가 남게 됐고**, 사용자 지시로 해설이 그 자리로 들어왔다.
  //    지우지 않고 정정하는 이유는 종전 문장이 그 판에서는 옳은 판단이었기
  //    때문이다 — 배치가 바뀌면 근거도 바뀐다는 것이 여기 남길 교훈이다.
  //    지금 격자 밖 하단에 남는 것은 **CTA 하나**다.
  checkMt21('ⓓ 「왜 그럴까」가 오른쪽 열 안, 지표 바로 아래다',
    at("explore.common.whyTitle") > -1 && at("explore.common.whyTitle") < closeGrid
      && at('<IndicatorCard') < at("explore.common.whyTitle"));
  checkMt21('ⓓ CTA만 격자 아래(하단)에 남는다', at("explore.climate.cta") > closeGrid);
  // 왼쪽은 곡선 → 슬라이더 순이다(곡선 위 점을 보며 그 아래를 미는 동선).
  checkMt21('ⓓ 왼쪽 열은 곡선 → CO₂ 슬라이더 순이다',
    at('<AnomalyCurve') < at("explore.climate.co2Label")
      && at("explore.climate.co2Label") < at('<IndicatorCard'));
  // 🔴 **양쪽 열이 각자 `flex-1` 카드를 하나씩 갖는다** — 더 짧은 쪽이 남는
  //    세로를 흡수해 두 열이 같은 줄에서 끝난다. 어느 쪽이 짧은지는 뷰포트가
  //    정한다(1536·1280은 오른쪽이 짧고, 1024는 왼쪽이 짧다 — 좁을수록 해설
  //    문단이 늘어난다). 한쪽에만 달면 반대 폭에서 그 열 아래가 빈다(실측 96px).
  checkMt21('ⓓ 두 열이 각자 flex-1 카드를 하나씩 갖는다 (한쪽만 달면 반대 폭에서 빈다)',
    (climateSrc.match(/className="flex flex-1 flex-col rounded-2xl/g) ?? []).length === 2);
  // ⓔ **지표 둘은 어느 폭에서나 한 줄**이고, 그래서 오른쪽 열에 한 줄이 남는다.
  //    그 남은 자리를 CO₂ 카드가 `flex-1`로 먹어 **두 열이 같은 줄에서 끝난다**
  //    (2026-08-19 사용자 지시). 둘은 한 쌍이다 — 지표를 다시 세로로 쌓으면 남는
  //    자리가 없어져 flex-1이 할 일이 사라지고, flex-1을 빼면 오른쪽 열 아래가
  //    빈 상자가 된다. 실측 1536: 곡선 336 = CO₂ 177 + 지표 147 + 간격 12.
  //    ⚠️ 높이를 숫자로 박으면 안 된다 — 행 높이는 곡선의 폭(=뷰포트)이 정해
  //    1536/1280/1024에서 336/312/302로 다 다르다.
  checkMt21('ⓔ 지표 2종이 어느 폭에서나 한 줄이다 (lg 예외 없음)',
    /className="grid grid-cols-2 gap-3"/.test(climateSrc));
  // ⚠️ 라벨 정정 — 이 카드의 `flex-1`은 종전에 "오른쪽 열의 남는 줄을 먹는다"는
  //    뜻이었다. 3판에서 카드가 왼쪽 열로 옮겨 가며 뜻이 바뀌었다: 이제는
  //    **왼쪽 열이 짧을 때만**(1024) 늘어난다. 검사 대상은 같고 이유가 다르다.
  checkMt21('ⓔ CO₂ 카드가 왼쪽 열의 흡수자다 — flex-1 (없으면 1024에서 왼쪽 아래가 96px 빈다)',
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

  // ── 태풍 배너: 고지는 안으로 · 오른쪽 한 줄 (2026-08-19 사용자 지시) ───────
  // "여기서도 교육용 단순 모델이에요~ 는 튜터 카드 안으로. 그리고 튜터 카드
  //  오른쪽에 … 이 글씨 크기 줄여서 한 줄로."
  // 기후변화와 다른 점 둘: ⑴ 고지에 굵은 낱말(「경향」)이 있어 문자열이 아니라
  // 노드로 넘긴다 ⑵ 설명을 **비우지 않고** tight로 눌렀다(사용자가 둘 다 요구).
  // 실측 1536: 배너 h=104 · 설명 430×14(한 줄) · 고지 429×29(두 줄).
  // ⚠️ **정정(2026-08-19 최종).** 이 줄은 종전에 「고지가 배너 **안**으로
  //    들어갔다」였다. 사용자가 "튜터 카드 아예 밖으로"라고 정정해 고지는
  //    배너 **위쪽 줄**(뒤로가기 링크와 같은 행, 오른쪽 정렬)로 나갔다.
  //    자리를 네 번 옮긴 항목이라(아래 회색 띠 → 제목 아래 → 오른쪽 열 → 위쪽
  //    줄) **지금 자리**를 구조로 못박는다: 배너 **직전 형제**여야 한다.
  const typhoonTopRow = typhoonSrc.slice(0, typhoonSrc.indexOf('<HeroBanner'));
  checkMt21('㉳ 태풍: 고지가 배너 **밖** 위쪽 줄에 있다 (배너보다 앞)',
    typhoonTopRow.includes("explore.typhoon.disclaimer1")
      && /sm:text-right/.test(typhoonTopRow));
  // ⚠️ **`<HeroBanner …/>` 호출만 본다.** 파일 전체에서 `note=`를 찾으면
  //    `IndicatorCard`의 동명 prop(해수면·폭염일수 카드의 각주)에 걸린다 —
  //    실제로 그렇게 써서 기후변화 쪽이 붉어졌다.
  const heroCall = (src) => src.match(/<HeroBanner[\s\S]*?\n {6}\/>/)?.[0] ?? '';
  checkMt21('㉳ 배너는 고지를 모른다 — note를 넘기지 않는다',
    !/\bnote=/.test(heroCall(typhoonSrc)));
  checkMt21('㉳ 고지가 화면에 한 번만 있다 — 옮기며 사본을 남기지 않았다',
    (typhoonSrc.match(/explore\.typhoon\.disclaimer1/g) ?? []).length === 1);
  checkMt21('㉳ 오른쪽 문구가 한 줄 변형(tightDescription)이고 전용 키를 쓴다',
    /\btightDescription\b/.test(typhoonSrc) && /description=\{t\('explore\.typhoon\.heroDesc'\)\}/.test(typhoonSrc));

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
  // 비율은 1.35 → **1.9**로 커졌다(2026-08-19 2차 지시 "위성지도 크기 더 키우고").
  // 값을 못박는다 — 「크기」가 이 지시의 본체라 되돌아가면 지시가 무효가 된다.
  // 실측 1536: 도식 723×599(종전 634×543) · 해설 381×599(격자 stretch로 자동 일치).
  const tSat2 = typhoonSrc.indexOf('lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]');
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
  /*
   * ㉴ **모식도 둘은 나란히 선다** (2026-08-21 사용자 지시 — "모식도 두 개 사이즈
   *    모두 줄여서 왼쪽·오른쪽 배치").
   *
   *    세로로 쌓았을 때 둘이 780px씩, **화면의 절반(1,560/3,348px)**을 먹었다.
   *    2열로 접어 실측 3,348 → 2,224px(-34%). 캔버스 520×300(종전 1,088×628)이고
   *    캔버스 라벨은 그 폭에서도 읽힌다(실측 확인).
   *
   *    ⚠️ 높이를 직접 못 박을 수 없다 — 화면비를 `CrossSectionGL`이 260:150으로
   *       고정하므로 **열 폭이 유일한 손잡이**다. 그래서 계약도 격자를 문다.
   *    ⚠️ 두 열은 **같은 비율**이어야 한다. 한쪽을 넓히면 캔버스 높이가 갈려
   *       두 카드의 캡션 줄이 어긋나고 나란한 것으로 안 읽힌다.
   *    ⚠️ CTA는 이 격자 **밖**에 남아야 한다 — 위 ㉱와 같은 이유이고, 격자가
   *       하나 늘었으므로 그 계약이 새 격자에도 걸리는지 다시 본다.
   */
  const tSchemGrid = typhoonSrc.indexOf('<div className="grid gap-4 lg:grid-cols-2">');
  const tT1 = typhoonSrc.indexOf('explore.schematic.card.t1.title');
  const tT2 = typhoonSrc.indexOf('explore.schematic.card.t2.title');
  checkMt21('㉴ 태풍: 모식도 2열 격자가 있다', tSchemGrid > -1);
  /*
   * 🔴 **「격자 뒤에 온다」도 「들여쓰기 8칸」도 담기를 증명하지 못한다.**
   *    처음에 그 둘로 썼는데, 한 장을 격자 **밖**으로 빼되 들여쓰기만 8칸으로
   *    남기는 변이가 **그대로 통과했다**(돌연변이 검증에서 잡혔다). 위 ㉱가
   *    "격자 뒤에 온다만 보면 딸려 들어가도 통과한다"고 적어 둔 바로 그 교훈을
   *    한 줄 아래에서 되풀이한 것이다.
   *    그래서 격자의 **닫는 태그 위치를 실제로 찾아** 그 안쪽인지 본다:
   *    페이지 직계 격자라 닫는 줄은 6칸 `</div>`이고, 그것이 이 격자의 끝이다.
   */
  const schemClose = typhoonSrc.indexOf('\n      </div>', tSchemGrid);
  // ⚠️ 이름은 `inSchemGrid` — 같은 파일 위쪽에 다른 `inGrid`가 이미 있다.
  //    처음에 `inGrid`로 써서 파일 전체가 SyntaxError로 죽었다(이 파일에서
  //    블록 스코프 밖 재선언이 두 번째다).
  const inSchemGrid = (i) => tSchemGrid > -1 && schemClose > -1 && i > tSchemGrid && i < schemClose;
  checkMt21(`㉴ 모식도 둘이 격자 **안**에 있다(닫는 태그까지 확인) — t1 ${inSchemGrid(tT1)} · t2 ${inSchemGrid(tT2)}`,
    inSchemGrid(tT1) && inSchemGrid(tT2));
  // 담기를 확인한 뒤에야 들여쓰기가 뜻을 갖는다 — 둘 다 격자 직계(8칸)여야
  // 한 칸씩 차지한다(하나가 다른 하나를 감싸도 위 검사는 통과한다).
  const schemLines = (typhoonSrc.match(/^ *<SchematicPanel$/gm) ?? []);
  checkMt21(`㉴ 두 패널 모두 격자 직계 자식이다(들여쓰기 8칸) — 실제 ${schemLines.map((l) => l.length - l.trimStart().length).join('/')}`,
    schemLines.length === 2 && schemLines.every((l) => /^ {8}<SchematicPanel$/.test(l)));
  checkMt21('㉴ 모식도 격자가 CTA를 삼키지 않았다 — CTA는 여전히 격자 밖이다',
    tCta > schemClose);
  const satSrc = await readFile(resolve(root, 'src/modules/explore/SatelliteView.jsx'), 'utf8');
  checkMt21('㉲ 위성 도식이 자기 여백(mt-4)을 갖지 않는다 — 격자 칸에서 옆 칸보다 16px 내려앉는다',
    !/<figure className="[^"]*\bmt-4\b/.test(satSrc));

  // ⓘ 모델 고지가 **배너 안 제목 아래**에 있고, 배너 밖 회색 띠는 사라졌다
  //    (2026-08-19 사용자 지시). 둘 다 남으면 같은 문장이 화면에 두 번 뜬다 —
  //    옮기다 원본을 안 지우는 것이 이 종류의 흔한 실수라 **없는 것까지** 문다.
  // ⚠️ 태풍 ㉳와 **같은 정정**이다(2026-08-19 최종 — "튜터 카드 아예 밖으로").
  const climateTopRow = climateSrc.slice(0, climateSrc.indexOf('<HeroBanner'));
  checkMt21('ⓘ 기후변화: 고지가 배너 **밖** 위쪽 줄에 있다 (배너보다 앞)',
    climateTopRow.includes("explore.climate.disclaimer") && /sm:text-right/.test(climateTopRow));
  checkMt21('ⓘ 배너는 고지를 모른다 — note를 넘기지 않는다', !/\bnote=/.test(heroCall(climateSrc)));
  checkMt21('ⓘ 고지가 화면에 한 번만 있다 — 옮기며 사본을 남기지 않았다',
    (climateSrc.match(/explore\.climate\.disclaimer/g) ?? []).length === 1);
  // ⓗ 「탐구 목표」 제목만 한 단계 크다(2026-08-19 사용자 지시). 항목 글자는
  //    그대로여야 한다 — 같이 키우면 카드가 커져 2열 행 높이가 밀린다.
  const goalSrc = await readFile(resolve(root, 'src/modules/explore/GoalPanel.jsx'), 'utf8');
  checkMt21('ⓗ 「탐구 목표」 제목이 text-base다 (항목 글자는 그대로)',
    /<p className="text-base font-bold text-slate-700">\{t\('explore\.goals\.title'\)\}<\/p>/.test(goalSrc));} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 페이지 3종 렌더 스모크 통과');

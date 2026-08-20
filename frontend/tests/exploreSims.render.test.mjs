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
  { path: '/src/modules/explore/TyphoonSimPage.jsx',
    name: 'TyphoonSimPage',
    expects: ['태풍', '왜 그럴까', 'href="/learn"',
      '태풍 단면 — 하층과 상층은 반대로 감긴다', '권운 차양', '눈과 눈벽', // T1 껍데기+장면+단계
      '태풍의 일생 — 발생에서 온대저기압까지', '북위 20°'] }, // T2 껍데기+장면
  { path: '/src/modules/explore/ClimateSimPage.jsx',
    name: 'ClimateSimPage',
    expects: ['기후변화', '폭염일수', 'href="/learn"',
      '지구는 받은 만큼 내보낸다', '태양', '들어오는 햇빛 100'] }, // C1 껍데기+장면+단계
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
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 페이지 3종 렌더 스모크 통과');

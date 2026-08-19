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
  // ── 고정 오버레이가 셸 폭을 변수로 받는다 (2026-08-08) ─────────────────────
  // Layout은 md↑에서 사이드바(208px) 오른쪽부터 본문을 잡는데, `fixed` 오버레이는
  // **화면 전체** 기준으로 자리를 잡는다. 그래서 피드백 카드만 104px(=208/2)
  // 왼쪽으로 밀려 결과 배너와 어긋났다(1440 실측: 중심 720 대 824).
  // 보정값을 상수로 박으면 **사이드바가 없는 라우트에서 반대로 틀린다** — 배치고사
  // (/onboarding/placement)는 Layout 밖인데 같은 SessionRunner를 쓴다. 그래서
  // `--wm-shell-left`(Layout 안 208 · 밖 0)를 쓰는지 소스로 단정한다.
  // jsdom·SSR 모두 레이아웃 엔진이 없어 좌표로는 잴 수 없다.
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const panel = readFileSync(resolve(root, 'src/components/FeedbackPanel.jsx'), 'utf8');
  const fixedLine = panel.split('\n').find((l) => /className="fixed /.test(l));
  if (fixedLine && fixedLine.includes('left-[var(--wm-shell-left)]')) {
    console.log('PASS FeedbackPanel 고정 컨테이너가 셸 변수(--wm-shell-left)로 왼쪽을 잡는다');
  } else {
    console.error(`FAIL FeedbackPanel이 셸 변수를 안 쓴다 — 실제 「${(fixedLine ?? '없음').trim()}」`);
    failed += 1;
  }

  // ── 피드백 화자는 **물방울이 하나** (2026-08-11 사용자 지시) ────────────────
  // 학습 세션의 튜터가 물방울이다(SideNav `/learn` → drop). 정답일 때만 다른
  // 캐릭터가 나오면 한 세션 안에서 말하는 사람이 문항마다 바뀐다.
  // 종전 값(정답 sun · 오답 cloud)으로 되돌아가면 여기서 잡힌다 —
  // **정오답 두 경우를 다 그려서** 본다(한쪽만 보면 반만 지킨다).
  {
    const FeedbackPanel = (await server.ssrLoadModule('/src/components/FeedbackPanel.jsx')).default;
    for (const isCorrect of [true, false]) {
      const html = renderToString(
        createElement(FeedbackPanel, { message: '테스트 해설', isCorrect, source: 'authored' }),
      );
      const m = html.match(/data-mascot="([a-z]+)"/);
      if (m?.[1] === 'drop') {
        console.log(`PASS 피드백 화자가 물방울이 (isCorrect=${isCorrect})`);
      } else {
        console.error(`FAIL 피드백 화자가 물방울이가 아니다 (isCorrect=${isCorrect}) — 실제 ${m?.[1] ?? '(없음)'}`);
        failed += 1;
      }
      // ⚠️ **닫기 X가 있어야 한다**(2026-08-13 클라이언트 제보). 이 패널은
      // `fixed bottom-14`인데 「다음」 컨트롤은 본문에 있어서, 좁은 화면에서는
      // 패널이 그 위를 덮어 **다음 문항으로 못 넘어간다.** 데스크톱은 세로 여유가
      // 있어 안 겹치므로 눈으로는 영영 안 보이는 결함이다 — 그래서 단정으로 문다.
      if (html.includes('data-testid="feedback-dismiss"')) {
        console.log(`PASS 해설 패널에 닫기 X가 있다 (isCorrect=${isCorrect})`);
      } else {
        console.error(`FAIL 해설 패널에 닫기 X가 없다 — 좁은 화면에서 「다음」이 가린 채로 막힌다 (isCorrect=${isCorrect})`);
        failed += 1;
      }
    }
    // 닫힘이 **문항마다 초기화**돼야 한다. 안 그러면 한 번 닫은 뒤로 해설이
    // 영영 안 보이고, 그건 사람 저작 해설을 화면에 띄운다는 이 패널의 존재
    // 이유(CO-I-1)를 지우는 셈이다. `message`를 의존성으로 갖는지 소스로 본다.
    const panelSrc = readFileSync(resolve(root, 'src/components/FeedbackPanel.jsx'), 'utf8');
    if (/useEffect\(\s*\(\)\s*=>\s*\{\s*setDismissed\(false\);?\s*\}\s*,\s*\[message\]\s*\)/.test(panelSrc)) {
      console.log('PASS 닫힘이 문항이 바뀌면 초기화된다');
    } else {
      console.error('FAIL 닫힘이 문항 변경에 초기화되지 않는다 — 한 번 닫으면 해설이 영영 안 뜬다');
      failed += 1;
    }
  }

  // ── 2열은 **배치고사를 비켜간다** (2026-08-11) ──────────────────────────────
  // 세션이 「왼쪽 문항 / 오른쪽 정답·해설」 2열이 됐는데, 같은 SessionRunner를
  // 쓰는 배치고사(bulkMode)에 그대로 걸리면 두 가지가 동시에 깨진다:
  //   (a) 배치고사는 Layout 밖(/onboarding/placement)이라 컨테이너가 max-w-xl
  //       하나뿐 — 2열이면 문항이 264px이 된다(위 셸 변수 항목과 같은 뿌리).
  //   (b) 배치고사는 문항별 채점이 없어 status가 FEEDBACK에 닿지 않는다 —
  //       오른쪽 열이 "답을 고르면 여기에…"만 든 채 끝까지 비어 있는다.
  // jsdom·SSR에 CSS 엔진이 없어 좌표로는 못 잰다 → 소스로 단정한다.
  {
    const runner = readFileSync(resolve(root, 'src/modules/session/SessionRunner.jsx'), 'utf8');
    const gridLine = runner.split('\n').find((l) => /lg:grid-cols-2/.test(l));
    if (gridLine && /bulkMode/.test(gridLine)) {
      console.log('PASS 세션 2열이 bulkMode(배치고사)를 비켜간다');
    } else {
      console.error(`FAIL 세션 2열이 배치고사에도 걸린다 — 실제 「${(gridLine ?? '없음').trim().slice(0, 90)}」`);
      failed += 1;
    }
    const placeholderLine = runner
      .split('\n')
      .find((l) => /status !== SESSION_STATUS\.FEEDBACK &&/.test(l));
    if (placeholderLine && /!bulkMode/.test(placeholderLine)) {
      console.log('PASS 오른쪽 열 자리표시자가 배치고사에서는 안 뜬다');
    } else {
      console.error(
        `FAIL 배치고사에서 채워지지 않을 자리표시자가 뜬다 — 실제 「${(placeholderLine ?? '없음').trim().slice(0, 90)}」`,
      );
      failed += 1;
    }
  }

  // 같은 함정이 상단 토스트 5개에도 있었다(2026-08-08). 파일 목록을 손으로 적지
  // 않는다 — 적어 두면 **새로 생긴 토스트가 검사를 비켜간다**. src 전체를 훑어
  // 가운데 고정 오버레이가 전부 셸 변수 식을 쓰는지 본다. TabBar처럼 md에서 아예
  // 숨는 것(md:hidden)은 사이드바와 공존하지 않으므로 제외한다.
  // ⚠️ 상수(`md:left-[calc(50%_+_104px)]`)로 되돌리지 말 것 — 사이드바가 없는
  // 배치고사 화면에서 반대로 104px 틀어진다. 그래서 `left-1/2`(맨 상수)도 잡는다.
  const jsxFiles = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = resolve(dir, name);
      return statSync(p).isDirectory() ? jsxFiles(p) : (/\.jsx$/.test(name) ? [p] : []);
    });
  const offenders = [];
  let scanned = 0;
  for (const file of jsxFiles(resolve(root, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!/\bfixed\b/.test(line)) continue;
      if (!/\bleft-1\/2\b/.test(line) && !/left-\[calc\(50%_\+_var/.test(line)) continue;
      if (/md:hidden/.test(line)) continue;
      scanned += 1;
      if (!/left-\[calc\(50%_\+_var\(--wm-shell-left\)\/2\)\]/.test(line)) {
        offenders.push(`${file.slice(root.length + 1)}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  if (scanned > 0 && offenders.length === 0) {
    console.log(`PASS 가운데 고정 오버레이 ${scanned}건 전부 셸 변수 보정(--wm-shell-left)을 쓴다`);
  } else {
    console.error(
      scanned === 0
        ? 'FAIL 가운데 고정 오버레이를 하나도 못 찾았다 — 스캔이 죽었다'
        : `FAIL 셸 변수 보정 없는 고정 오버레이 ${offenders.length}건\n    ${offenders.join('\n    ')}`,
    );
    failed += 1;
  }
} finally {
  await server.close();
}

// ── 보드 문항은 **판도 셸도 넓다** (2026-08-19 사용자 지시) ─────────────────
/**
 * "학습 세션의 보드 문제도 보드 게임 화면이랑 배치 맞춰서 가로로 확장."
 *
 * 둘이 **한 쌍**이라 하나만 되돌아가면 조용히 나빠진다:
 *  ⓐ `QuestionCard`가 보드에 `layout="wide"`를 준다 — 없으면 같은 판이 세션에서만
 *     세로로 쌓여 두 화면의 배치가 갈린다
 *  ⓑ `SessionRunner`가 보드 문항일 때 **2열을 접는다** — 안 접으면 wide 판이
 *     절반 폭(1536에서 약 550px)에 들어가 지도가 눌린다. 보드 화면이 셸을 넓게
 *     쓰는 이유와 같은 이유다(`Layout.jsx`의 isBoard).
 * jsdom에는 CSS 엔진이 없어 눌림을 좌표로 못 재므로 소스로 짝을 문다.
 */
{
  const { readFileSync } = await import('node:fs');
  const card = readFileSync(resolve(root, 'src/modules/quiz/QuestionCard.jsx'), 'utf8');
  const runner = readFileSync(resolve(root, 'src/modules/session/SessionRunner.jsx'), 'utf8');
  const say = (label, cond) => {
    if (cond) console.log(`PASS ${label}`);
    else { failed += 1; console.error(`FAIL ${label}`); }
  };
  say('ⓐ 세션 보드 문항이 wide 배치다', /<AtmosphereBoard[\s\S]{0,400}?layout="wide"/.test(card));
  say(
    'ⓑ 보드 문항일 때 세션 2열을 접는다 — 안 접으면 wide 판이 절반 폭에 눌린다',
    /const isBoardItem = /.test(runner)
      && /bulkMode \|\| isBoardItem \? undefined : 'lg:grid lg:grid-cols-2/.test(runner),
  );
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: SessionRunner 3모드(daily/unit/bulk placement) SSR 렌더 스모크 통과');

/**
 * 탐구 목표 계약 (MT-25) — node tests/exploreGoals.test.mjs
 *
 * ⚠️ 종전 머리말의 "MT-24"는 오기다(2026-08-18 정정). MT-24 = 보드 순차 열림,
 * MT-25 = 탐구 시뮬 목표 조건(CARRYOVER_R13 §2561 S-5).
 *
 * 「변수를 바꿔보며 학습 탐구」에 「해냈다」를 붙인 판정부의 계약이다. 무는 것은 네 가지:
 *  ⑴ **판정 의미론** — AND · 연산자 집합 {>=, <=, eq} · fail-closed(모르는 필드·
 *     연산자·형은 성립하지 않는다) · 조건 0건은 false. 마지막 항은 CO-K7 재발 방지다.
 *  ⑵ **기본 입력에서 달성 0건** — 화면에 들어서자마자 ✅가 켜져 있으면 학습자는
 *     자기가 한 일이 없다는 것을 안다. 목표 문구를 고칠 때 조건도 같이 흔들리면
 *     여기가 먼저 운다.
 *  ⑶ **목표마다 달라야 하는 변수 조합** — 실제 교육 모델(lib/exploreSims.js)을 돌려
 *     각 목표의 해집합을 센다. 「한 방향으로 끝까지 밀면 전부 켜지는」 목표 세트나,
 *     한 목표가 다른 목표를 포함해 한 번에 둘이 켜지는 배치를 여기서 막는다.
 *  ⑷ **문구가 ko·en 양쪽에 있다** — 목표 문구는 t(goal.titleKey)처럼 **동적 키**라
 *     i18n 스모크의 리터럴 스캔이 못 본다. 그 사각지대를 이 파일이 덮는다.
 *  ⑸ SSR 렌더에 목표 패널이 실제로 뜨고, 첫 페인트가 「0 / N 달성」인지.
 *
 * 러너 의존 없이 node 직접 실행 — exploreSims.render.test.mjs와 같은 관례.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'production';
// 로케일 ko 고정 — SSR 단정이 한국어라서(러너 navigator.language가 en-US다).
globalThis.localStorage = {
  getItem: (k) => (k === 'weathermind.locale' ? 'ko' : null),
  setItem() {}, removeItem() {},
};

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { createServer } = await import('vite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
};

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const G = await server.ssrLoadModule('/src/modules/explore/exploreGoals.js');
  const sims = await server.ssrLoadModule('/src/lib/exploreSims.js');

  // ── ⑴ 판정 의미론 ────────────────────────────────────────────────────────
  check('>= 는 경계 포함', G.conditionMet({ field: 'x', op: '>=', value: 5 }, { x: 5 }));
  check('<= 는 경계 포함', G.conditionMet({ field: 'x', op: '<=', value: 5 }, { x: 5 }));
  check('>= 미달은 불성립', !G.conditionMet({ field: 'x', op: '>=', value: 5 }, { x: 4.9 }));
  check('eq 는 범주형 동일 비교', G.conditionMet({ field: 'c', op: 'eq', value: 'super' }, { c: 'super' })
    && !G.conditionMet({ field: 'c', op: 'eq', value: 'super' }, { c: 'TY' }));
  // fail-closed 4종 — 잘못 저작된 목표가 **자동 달성** 쪽으로 기울면 안 된다.
  check('모르는 필드는 불성립', !G.conditionMet({ field: 'nope', op: '>=', value: 0 }, { x: 1 }));
  check('모르는 연산자는 불성립(> 는 문법 밖 — 보드와 같은 집합만 허용)',
    !G.conditionMet({ field: 'x', op: '>', value: 0 }, { x: 1 }));
  check('수치 연산자에 문자열 값은 불성립',
    !G.conditionMet({ field: 'x', op: '>=', value: 5 }, { x: 'high' }));
  check('조건이 객체가 아니면 불성립', !G.conditionMet('intensity>=60', { intensity: 99 }));
  // CO-K7: 빈 목표가 마운트 즉시 「달성」이 되던 결함의 탐구판 방어
  check('조건 0건 목표는 달성이 아니다', !G.goalMet({ id: 'empty', conditions: [] }, { x: 1 }));
  check('조건은 AND — 하나라도 어긋나면 미달',
    !G.goalMet({ conditions: [{ field: 'a', op: '>=', value: 1 }, { field: 'b', op: '>=', value: 1 }] },
      { a: 2, b: 0 }));

  // ── ⑵ 기본 입력에서 달성 0건 ────────────────────────────────────────────
  // 기본값의 소유자는 페이지 컴포넌트다 — 소스에서 **직접 읽어** 대조한다.
  // 여기 숫자를 손으로 적으면 페이지가 바뀌어도 이 테스트가 계속 초록이 된다.
  const { readFile } = await import('node:fs/promises');
  const typhoonSrc = await readFile(resolve(root, 'src/modules/explore/TyphoonSimPage.jsx'), 'utf8');
  const climateSrc = await readFile(resolve(root, 'src/modules/explore/ClimateSimPage.jsx'), 'utf8');
  const defaultSst = Number(typhoonSrc.match(/useState\((\d+(?:\.\d+)?)\);\s*\n\s*const \[shear/)?.[1]);
  const defaultShear = typhoonSrc.match(/useState\('(weak|moderate|strong)'\)/)?.[1];
  const defaultCo2Name = climateSrc.match(/useState\((CO2_PRESENT_DAY|\d+)\)/)?.[1];
  const defaultCo2 = defaultCo2Name === 'CO2_PRESENT_DAY'
    ? Number(climateSrc.match(/CO2_PRESENT_DAY = (\d+)/)?.[1])
    : Number(defaultCo2Name);
  check(`기본값을 소스에서 읽었다 (sst=${defaultSst} shear=${defaultShear} co2=${defaultCo2})`,
    Number.isFinite(defaultSst) && !!defaultShear && Number.isFinite(defaultCo2));

  const typhoonFacts = (sst, shear) => {
    const r = sims.typhoonIntensity({ sst, shear });
    return { sst, shear, intensity: r.intensity, category: r.category };
  };
  const climateFacts = (co2) => ({ co2, ...sims.climateResponse({ co2 }) });

  const tDefault = G.evaluateGoals(G.TYPHOON_GOALS, typhoonFacts(defaultSst, defaultShear));
  const cDefault = G.evaluateGoals(G.CLIMATE_GOALS, climateFacts(defaultCo2));
  check(`태풍 기본 입력에서 달성 0건 (${tDefault.join(',')})`, tDefault.every((v) => v === false));
  check(`기후 기본 입력에서 달성 0건 (${cDefault.join(',')})`, cDefault.every((v) => v === false));

  // ── ⑶ 목표마다 달라야 하는 변수 조합 ────────────────────────────────────
  const SHEARS = ['weak', 'moderate', 'strong'];
  const SSTS = [];
  for (let s = sims.SST_MIN; s <= sims.SST_MAX + 1e-9; s += 0.1) SSTS.push(Math.round(s * 10) / 10);
  const CO2S = [];
  for (let c = sims.CO2_MIN; c <= sims.CO2_MAX; c += 1) CO2S.push(c);

  /** 목표를 만족시키는 (sst, shear) 조합 전부 */
  const typhoonSolutions = (goal) => {
    const out = [];
    for (const shear of SHEARS) {
      for (const sst of SSTS) if (G.goalMet(goal, typhoonFacts(sst, shear))) out.push({ sst, shear });
    }
    return out;
  };
  const climateSolutions = (goal) => CO2S.filter((co2) => G.goalMet(goal, climateFacts(co2)));

  const byId = (goals, id) => goals.find((g) => g.id === id);

  // 세 목표 전부 **도달 가능**해야 한다 — 아무리 좋은 목표도 못 닿으면 벽이다.
  for (const goal of G.TYPHOON_GOALS) {
    const n = typhoonSolutions(goal).length;
    check(`태풍 목표 '${goal.id}' 는 도달 가능하다 (해 ${n}건)`, n > 0);
  }
  for (const goal of G.CLIMATE_GOALS) {
    const n = climateSolutions(goal).length;
    check(`기후 목표 '${goal.id}' 는 도달 가능하다 (해 ${n}건)`, n > 0);
  }

  // 「시어의 벽」은 **시어를 강으로 두지 않으면 절대 못 푼다** — 이 목표의 존립 근거.
  // 두 번째 변수를 만지지 않고 풀리면 목표가 SST 슬라이더 하나짜리가 된다.
  {
    const shears = new Set(typhoonSolutions(byId(G.TYPHOON_GOALS, 'shear-wall')).map((s) => s.shear));
    check(`'시어의 벽'은 시어 강에서만 풀린다 (${[...shears].join('|')})`,
      shears.size === 1 && shears.has('strong'));
  }
  // 「초강력」은 반대로 **약한 시어에서만** — 두 목표가 서로 반대쪽 극을 가리킨다.
  {
    const shears = new Set(typhoonSolutions(byId(G.TYPHOON_GOALS, 'super')).map((s) => s.shear));
    check(`'초강력'은 시어 약에서만 풀린다 (${[...shears].join('|')})`,
      shears.size === 1 && shears.has('weak'));
  }
  // 「바다를 식혀 보기」는 임계 **아래**에서만 — 다른 둘과 슬라이더 방향이 반대다.
  {
    const ssts = typhoonSolutions(byId(G.TYPHOON_GOALS, 'calm')).map((s) => s.sst);
    check(`'바다를 식혀 보기'는 임계 이하에서만 풀린다 (최대 ${Math.max(...ssts)}℃)`,
      Math.max(...ssts) <= sims.SST_GENESIS_THRESHOLD);
  }
  // 기후 목표 2종은 **창(window)**이고 서로 **겹치지 않는다.**
  // ⓐ 창이 아니면 슬라이더를 끝까지 밀어 통과한다 → 탐색이 사라진다.
  // ⓑ 겹치면 하나를 풀 때 다른 하나가 딸려 켜져 두 번째 목표가 아무것도 안 가르친다.
  {
    const a = climateSolutions(byId(G.CLIMATE_GOALS, 'line-1p5'));
    const b = climateSolutions(byId(G.CLIMATE_GOALS, 'heat-first'));
    check(`'1.5℃ 저지선'은 창이다 (${a[0]}~${a[a.length - 1]}ppm — 최대치로는 못 맞춘다)`,
      a.length > 0 && a[a.length - 1] < sims.CO2_MAX && a[0] > sims.CO2_MIN);
    check(`'폭염이 먼저 온다'도 창이다 (${b[0]}~${b[b.length - 1]}ppm)`,
      b.length > 0 && b[b.length - 1] < sims.CO2_MAX && b[0] > sims.CO2_MIN);
    const overlap = a.filter((c) => b.includes(c));
    check(`두 기후 목표의 창이 겹치지 않는다 (교집합 ${overlap.length}건)`, overlap.length === 0);
  }

  // ── ⑷ 문구가 ko·en 양쪽에 있다 (동적 키 — i18n 스모크의 사각지대) ───────
  {
    const { default: ko } = await server.ssrLoadModule('/src/i18n/resources/board.ko.js');
    const { default: en } = await server.ssrLoadModule('/src/i18n/resources/board.en.js');
    const at = (res, key) => key.split('.').reduce((n, p) => n?.[p], res);
    const keys = [
      'explore.goals.title', 'explore.goals.progress', 'explore.goals.doneBadge',
      'explore.goals.lessonLabel', 'explore.goals.howto', 'explore.goals.allDone',
      ...[...G.TYPHOON_GOALS, ...G.CLIMATE_GOALS].flatMap((g) => [g.titleKey, g.taskKey, g.lessonKey]),
    ];
    const missing = keys.filter((k) => typeof at(ko, k) !== 'string' || typeof at(en, k) !== 'string');
    check(`목표 문구 ${keys.length}종이 ko·en 양쪽에 있다`, missing.length === 0);
    if (missing.length) console.error(`  누락: ${missing.join(', ')}`);
    // 진행도는 보간 문구다 — 자리표시자가 빠지면 "0 / 3"이 화면에서 사라진다.
    check('진행도 문구에 {done}·{total} 자리표시자가 양 언어에 있다',
      ['done', 'total'].every((p) => at(ko, 'explore.goals.progress').includes(`{${p}}`)
        && at(en, 'explore.goals.progress').includes(`{${p}}`)));
  }

  // ── ⑷b 목표 항목은 **가로로 눕는다** (2026-08-21 사용자 판단) ────────────
  /*
   * 목표 셋이 세로로 쌓여 카드가 279px였다. 한 행이 1,088px 폭에 **제목 + 한 줄**
   * 뿐이라 옆으로 남는 폭을 아무도 안 썼다 — 실측 279 → 170px.
   *
   * ⚠️ 이 패널은 **태풍·기후 두 화면이 공유한다.** 여기서 열 수를 바꾸면 두 곳이
   *    같이 바뀐다 — 그래서 한쪽 화면만 보고 고치지 말 것.
   * ⚠️ 좁은 화면에서는 **접혀야 한다.** `sm:`·`lg:` 없이 3열을 박으면 휴대폰에서
   *    한 칸이 120px가 되어 제목부터 감긴다. 그래서 「3열」이 아니라
   *    「좁으면 1열 → sm 2열 → lg 3열」이 계약이다.
   */
  {
    const panel = await readFile(resolve(root, 'src/modules/explore/GoalPanel.jsx'), 'utf8');
    const listCls = panel.match(/<ul className="([^"]*)">/)?.[1] ?? '';
    check(`목표 목록이 격자다(세로 쌓기 아님) — 실제 "${listCls}"`,
      /\bgrid\b/.test(listCls) && !/space-y-/.test(listCls));
    check(`목표 격자가 좁은 화면에서 접힌다(sm 2열 · lg 3열) — 실제 "${listCls}"`,
      /sm:grid-cols-2/.test(listCls) && /lg:grid-cols-3/.test(listCls)
        && !/(?<!:)grid-cols-3/.test(listCls));
  }

  // ── ⑸b 태풍의 **기본 막은 개념**이다 (2026-08-21) ────────────────────────
  /*
   * 위 ⑸가 목표 패널을 보려고 `initialStage="mission"` 이음매를 쓴다. 이음매가
   * 생기면 **제품 기본값이 조용히 바뀌어도 아무도 안 운다** — 그 구멍을 여기서 막는다.
   * 지시의 본체가 「개념을 **먼저** 보고 미션으로」라, 기본이 미션이 되는 순간
   * 그 연출이 통째로 사라진다.
   */
  {
    const src = await readFile(resolve(root, 'src/modules/explore/TyphoonSimPage.jsx'), 'utf8');
    check("태풍의 기본 막이 '개념'이다 (이음매 기본값)",
      /initialStage = 'concept'/.test(src));
    const mod = await server.ssrLoadModule('/src/modules/explore/TyphoonSimPage.jsx');
    const html = renderToString(createElement(MemoryRouter, null, createElement(mod.default)));
    check('기본 렌더에 목표·조작이 없다 — 1막은 개념만 보여 준다',
      !html.includes('탐구 목표') && !html.includes('해수면온도'));
    check('기본 렌더에 모식도 둘이 다 있다 — 개념이 1막의 내용이다',
      html.includes('태풍 단면') && html.includes('태풍의 일생'));
  }

  // ── ⑸ SSR — 목표 패널이 실제로 화면에 뜬다 ──────────────────────────────
  for (const [path, name, total] of [
    ['/src/modules/explore/TyphoonSimPage.jsx', 'TyphoonSimPage', G.TYPHOON_GOALS.length],
    ['/src/modules/explore/ClimateSimPage.jsx', 'ClimateSimPage', G.CLIMATE_GOALS.length],
  ]) {
    const mod = await server.ssrLoadModule(path);
    // ⚠️ 태풍은 **2막 구성**이라(2026-08-21) 목표 패널이 「만들어보기」 막에 있다 —
    //    기본 렌더는 개념 막이므로 여기서는 이음매로 그 막을 그린다. 제품 기본이
    //    바뀌지 않았다는 것은 바로 아래 별도 단정이 지킨다.
    const props = name === 'TyphoonSimPage' ? { initialStage: 'mission' } : null;
    const html = renderToString(createElement(MemoryRouter, null, createElement(mod.default, props)));
    check(`${name}: 목표 패널이 렌더된다`, html.includes('탐구 목표'));
    check(`${name}: 첫 화면 진행도가 0 / ${total}`, html.includes(`0 / ${total} 달성`));
    // 기본 입력에서 달성 0건이므로 「달성!」 배지는 **한 건도 없어야** 한다(⑵의 화면판).
    check(`${name}: 첫 화면에 달성 배지가 없다`, !html.includes('달성!'));
    // 미달성 목표는 **할 일**을 보여 준다 — 지시문이 없으면 목표가 목표로 안 읽힌다.
    check(`${name}: 미달성 목표에 지시문이 붙는다`,
      html.includes('보세요'));
  }

  // ── ⑹ 달성했을 때 **화면이 바뀐다** ─────────────────────────────────────
  // 판정만 있고 화면이 조용하면 학습자는 자기가 해냈다는 것을 모른다. 조건을
  // 만족시킨 상태로 패널을 직접 그려 축하 표시 3종이 실제로 나오는지 본다.
  {
    const { default: GoalPanel } = await server.ssrLoadModule('/src/modules/explore/GoalPanel.jsx');
    const solved = renderToString(createElement(GoalPanel, {
      goals: G.CLIMATE_GOALS,
      facts: climateFacts(climateSolutions(byId(G.CLIMATE_GOALS, 'line-1p5'))[0]),
    }));
    check('목표 하나를 풀면 그 줄에 달성 배지가 뜬다', solved.includes('달성!'));
    check('진행도가 함께 오른다 (1 / 2)', solved.includes('1 / 2 달성'));
    // 달성한 줄은 **지시문 대신 「알아낸 것」**으로 바뀐다 — 성취의 보상이
    // 다음 지시문이 아니라 개념 한 줄이어야 탐구가 학습이 된다.
    check('달성한 줄이 「알아낸 것」으로 바뀐다', solved.includes('알아낸 것'));

    const all = renderToString(createElement(GoalPanel, {
      goals: [G.CLIMATE_GOALS[0]],
      facts: climateFacts(climateSolutions(byId(G.CLIMATE_GOALS, 'line-1p5'))[0]),
    }));
    check('전부 달성하면 축하 배너가 뜬다', all.includes('목표를 전부 달성했어요'));
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 탐구 목표 판정·해집합·문구·렌더 계약 통과');

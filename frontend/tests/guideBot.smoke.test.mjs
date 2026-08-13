/**
 * 안내봇 계약 (MT-26) — node tests/guideBot.smoke.test.mjs
 *
 * 무는 것은 여섯 가지다:
 *  ⑴ **우선순위** — 여러 상태가 동시에 참일 때 무엇이 이기는가. 규칙표는 순서가
 *     곧 계약이라, 배열을 재정렬하면 화면의 말이 조용히 바뀐다.
 *  ⑵ **로딩 중 오탐 금지** — 값이 아직 안 온 `undefined`가 "에너지 0"으로 읽히면
 *     첫 페인트마다 "구름이 다 떨어졌어요"가 번쩍인다. 명시적 비교의 계약이다.
 *  ⑶ **접두사 규칙의 정렬** — 짧은 접두사가 위로 올라가면 긴 경로를 먹는다.
 *  ⑷ **키 누락 0** — 규칙표가 쓰는 전 키가 ko·en 양쪽에 실재하는가. 안내봇 문구는
 *     화면·상태가 맞아떨어져야 뜨므로, 키 하나가 비어도 사람 눈에는 몇 주 동안
 *     안 보인다(그 자리에는 `guide.state.levelUp` 같은 날것의 키가 그려진다).
 *  ⑸ **LLM 호출 0** — 규칙표가 결정적이라는 것이 이 기능의 전제다(비용 게이트 ·
 *     무키 동작 원칙 · 할루시네이션 방어 MT-17). 소스에 네트워크 호출이 끼면 운다.
 *  ⑹ **SSR** — 서버 렌더에서 죽지 않고, 말풍선이 `role="status"`로 읽히는가.
 *     기존 Mascot은 `aria-hidden` 장식인데 안내봇은 **말풍선이 유일한 전달자**라
 *     반대로 가야 한다. 그 반전이 실수로 되돌려지면 여기가 잡는다.
 *
 * 러너 의존 없이 node 직접 실행 — exploreGoals.test.mjs와 같은 관례.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

process.env.NODE_ENV = 'production';
// 로케일 ko 고정 — SSR 단정이 한국어라서(러너 navigator.language가 en-US다).
globalThis.localStorage = {
  getItem: (k) => (k === 'weathermind.locale' ? 'ko' : null),
  setItem() {}, removeItem() {},
};

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');
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
  const R = await server.ssrLoadModule('/src/lib/guideRules.js');

  // ── ⑴ 우선순위 ──────────────────────────────────────────────────────────
  const all = { clouds: 0, levelUp: true, lastAnswerCorrect: false, firstVisit: true };
  check('전부 참이면 에너지 소진이 이긴다 — 지금 막힌 것이 가장 급하다',
    R.pickGuideMessage('/learn', all).ruleId === 'outOfClouds');
  check('에너지가 있으면 레벨업이 오답을 이긴다 — 축하 순간에 직전 오답을 꺼내지 않는다',
    R.pickGuideMessage('/learn', { ...all, clouds: 3 }).ruleId === 'levelUp');
  check('레벨업이 없으면 오답이 첫 방문을 이긴다',
    R.pickGuideMessage('/learn', { ...all, clouds: 3, levelUp: false }).ruleId === 'wrongAnswer');
  check('첫 방문은 나머지가 없을 때만 — 처음 온 사람에게 네 마디를 쏟지 않는다',
    R.pickGuideMessage('/learn', { firstVisit: true }).ruleId === 'firstVisit');

  // ── ⑵ 로딩 중 오탐 금지 ─────────────────────────────────────────────────
  const loading = R.pickGuideMessage('/learn', {});
  check('빈 상태에서는 상태 규칙이 하나도 안 걸린다', loading.kind === 'screen');
  check('clouds가 undefined면 「에너지 0」이 아니다 — truthy 검사로 바꾸면 여기가 운다',
    R.pickGuideMessage('/learn', { clouds: undefined }).ruleId !== 'outOfClouds');
  check('lastAnswerCorrect가 undefined면 오답이 아니다',
    R.pickGuideMessage('/learn', { lastAnswerCorrect: undefined }).ruleId !== 'wrongAnswer');
  check('정답(true)은 오답 규칙을 안 켠다',
    R.pickGuideMessage('/learn', { lastAnswerCorrect: true }).ruleId !== 'wrongAnswer');

  // ── ⑶ 접두사 규칙의 정렬 ────────────────────────────────────────────────
  const prefixes = R.SCREEN_RULES.map((r) => r.prefix);
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  check('SCREEN_RULES는 길이 내림차순 — 짧은 접두사가 위로 가면 긴 경로를 먹는다',
    JSON.stringify(prefixes) === JSON.stringify(sorted));
  check('하위 경로도 접두사로 잡힌다(/learn/units/xxx → learn)',
    R.pickGuideMessage('/learn/units/air-mass').key === 'guide.screen.learn');
  check('모르는 경로는 폴백', R.pickGuideMessage('/nowhere').key === R.FALLBACK_KEY);
  check('루트도 폴백', R.pickGuideMessage('/').key === R.FALLBACK_KEY);

  // ── ⑷ 키 누락 0 ─────────────────────────────────────────────────────────
  const { RESOURCES } = await server.ssrLoadModule('/src/i18n/core.js');
  const dig = (obj, key) => key.split('.').reduce((n, k) => (n == null ? n : n[k]), obj);
  for (const locale of ['ko', 'en']) {
    const missing = R.GUIDE_MESSAGE_KEYS.filter((k) => typeof dig(RESOURCES[locale], k) !== 'string');
    check(`${locale} 리소스에 규칙표의 전 키가 있다 (누락 ${missing.length}건)`, missing.length === 0);
  }
  // aria 라벨은 규칙표가 아니라 컴포넌트가 직접 부른다 — 목록에 안 들어가므로 따로 문다.
  for (const locale of ['ko', 'en']) {
    check(`${locale}에 접기/펼치기 접근 이름이 있다`,
      typeof dig(RESOURCES[locale], 'guide.aria.collapse') === 'string'
      && typeof dig(RESOURCES[locale], 'guide.aria.expand') === 'string');
  }
  // 번역 누락은 「키가 없다」가 아니라 「ko 문자열이 그대로 복사됐다」로 나타난다.
  const copied = R.GUIDE_MESSAGE_KEYS.filter((k) => dig(RESOURCES.ko, k) === dig(RESOURCES.en, k));
  check(`en이 ko를 그대로 복사한 키가 없다 (${copied.length}건)`, copied.length === 0);

  // ── ⑸ LLM 호출 0 ────────────────────────────────────────────────────────
  // 이 기능의 전제라 주석이 아니라 테스트로 못박는다. 규칙표에 네트워크가 들어오는
  // 순간 상시 과금 + 환각 가능성이 함께 생긴다.
  const rulesSrc = await readFile(resolve(root, 'src/lib/guideRules.js'), 'utf8');
  check('guideRules에 네트워크 호출이 없다',
    !/\bfetch\s*\(|axios|XMLHttpRequest|EventSource/.test(rulesSrc));
  check('guideRules는 한국어 문구를 갖지 않는다 — 문구는 리소스가 소유한다',
    !/[가-힣]/.test(rulesSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));

  // ── ⑹ SSR ───────────────────────────────────────────────────────────────
  const { default: GuideBot } = await server.ssrLoadModule('/src/components/GuideBot.jsx');
  const html = renderToString(createElement(GuideBot, { pathname: '/board', state: {} }));
  check('SSR에서 렌더된다', html.includes('data-testid="guide-bot"'));
  check('말풍선이 role=status로 읽힌다 — Mascot의 aria-hidden 관례와 반대로 간다',
    html.includes('role="status"'));
  check('aria-live는 polite다 — assertive는 읽던 것을 끊는다', html.includes('aria-live="polite"'));
  check('보드 화면의 기본 안내가 실제로 그려진다', html.includes('태양이가 알려'));
  check('첫 페인트는 CSS 기본 자리다 — localStorage를 렌더 중에 안 읽는다',
    html.includes('data-guide-placed="0"'));
  check('어떤 규칙이 골랐는지 DOM에 남는다', html.includes('data-guide-rule="/board"'));

  const outHtml = renderToString(createElement(GuideBot, { pathname: '/board', state: { clouds: 0 } }));
  check('에너지 0이면 화면 안내를 밀어내고 상태 안내가 뜬다',
    outHtml.includes('data-guide-kind="state"') && outHtml.includes('구름이 다 떨어졌'));
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 안내봇(우선순위·로딩 오탐·접두사 정렬·키 패리티·무LLM·SSR) 스모크 통과');

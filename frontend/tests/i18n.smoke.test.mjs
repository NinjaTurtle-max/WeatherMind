/**
 * i18n 골격 실마운트 스모크 (R11-01 §3 D) —
 *   node tests/i18n.smoke.test.mjs
 *
 * 가드하는 계약:
 *   1. ko↔en 리소스 키 패리티 — 한쪽에만 키를 추가/삭제하면 여기서 잡힌다.
 *      (파일럿의 en 키를 지우는 변이가 이 시나리오 + 시나리오 3의 실렌더
 *      대조에서 이중으로 실패해야 정상)
 *   2. translate() 순수 함수 — {name} 보간, 미지 키는 키 그대로 반환.
 *   3. 파일럿(StreakBadge)이 ko/en 양 언어로 실제 렌더되고, LocaleSwitcher를
 *      **직접 마운트**해 클릭하면 전환된다(스토어 구독 리렌더까지 실마운트로 확인).
 *      ⚠️ 이 컴포넌트는 2026-08-13부터 화면에 배선돼 있지 않다 — 여기가 en 리소스가
 *      실제로 렌더되는지 보는 유일한 지점이라 계약 1의 실렌더 절반으로 남긴다.
 *   4. 로케일 고정 — setLocale은 여전히 localStorage(weathermind.locale)에 쓰지만,
 *      detectLocale()은 **저장값도 navigator도 보지 않고 항상 ko**다.
 *   5. 「영어 기능 제거」 계약(2026-08-13 클라이언트 결정):
 *      ⓐ 화면에 언어 전환 통로가 없다 — src/ 어디에서도 LocaleSwitcher를 마운트하지
 *        않고, setLocale을 부르는 제품 코드가 없다(정적 원문 스캔).
 *      ⓑ navigator가 en-US이고 localStorage에 'en'이 남아 있어도 ko로 연다.
 *      되돌리면(헤더 재배선·detectLocale 감지 복원) 여기가 붉어야 한다.
 *
 * 관례는 onboardingGating.smoke.test.mjs와 동일: 테스트 러너 의존 없음,
 * vite ssrLoadModule + jsdom 실마운트(createRoot). API 호출이 없는 순수
 * 프론트 계약이라 mock 서버(apiMockPlugin)는 세우지 않는다.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// 시나리오 5ⓐ는 원문을 파싱해 대조한다 — 저장소 선례와 같은 형태
// (backend test_ci_workflow_contract가 워크플로 yml을 파싱해 ci.sh와 맞춘다).
import { readdirSync, readFileSync } from 'node:fs';

process.env.NODE_ENV = 'production';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');

const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

// ── jsdom 전역 배선 (react 모듈 로드 전에) ──────────────────────────────────
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
for (const k of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;

// i18n 모듈은 로드 시점에 detectLocale()로 초기 로케일을 정한다. 2026-08-13부터
// detectLocale()이 ko 고정이라 이 심기는 결과를 바꾸지 않지만, 다른 스모크 하네스
// 20여 종과 같은 형태를 유지한다(고정을 되돌리는 변이가 여기서 조용히 초록이 되지
// 않도록 하는 것은 시나리오 5ⓑ의 몫 — 그쪽은 'en'을 심고 ko를 단정한다).
window.localStorage.setItem('weathermind.locale', 'ko');

const { createElement, Fragment } = await import('react');
const { createRoot } = await import('react-dom/client');

const i18n = await vite.ssrLoadModule('/src/i18n/index.js');
const { RESOURCES, SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, translate, detectLocale, useLocaleStore } = i18n;
const StreakBadge = (await vite.ssrLoadModule('/src/components/StreakBadge.jsx')).default;
const LocaleSwitcher = (await vite.ssrLoadModule('/src/components/LocaleSwitcher.jsx')).default;
const { useProgressStore } = await vite.ssrLoadModule('/src/store/progressStore.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 4000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
}

function mount(element) {
  const container = window.document.getElementById('root');
  const reactRoot = createRoot(container);
  reactRoot.render(element);
  return reactRoot;
}

const text = () => window.document.body.textContent ?? '';
const badgeTitle = () => window.document.querySelector('span[title]')?.getAttribute('title') ?? '';

let failed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err?.message ?? err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 중첩 리소스를 'a.b.c' 점 경로 목록으로 평탄화 */
function flattenKeys(node, prefix = '') {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) =>
      flattenKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [`${prefix}<비문자열 값>`];
}

try {
  // ── 1. ko↔en 키 패리티 + 값 유효성 ─────────────────────────────────────────
  await scenario('리소스 키 패리티: ko↔en 키 집합 일치 + 전 값이 비어 있지 않은 문자열', async () => {
    assert(SUPPORTED_LOCALES.includes('ko') && SUPPORTED_LOCALES.includes('en'), 'ko/en이 지원 목록에 있어야 함');
    assert(DEFAULT_LOCALE === 'ko', `기본 로케일은 ko여야 함 — 실제 ${DEFAULT_LOCALE}`);
    const koKeys = flattenKeys(RESOURCES.ko).sort();
    const enKeys = flattenKeys(RESOURCES.en).sort();
    assert(koKeys.length > 0, 'ko 리소스가 비어 있다');
    const koSet = new Set(koKeys);
    const enSet = new Set(enKeys);
    const koOnly = koKeys.filter((k) => !enSet.has(k));
    const enOnly = enKeys.filter((k) => !koSet.has(k));
    assert(
      koOnly.length === 0 && enOnly.length === 0,
      `키 불일치 — ko에만: [${koOnly}] / en에만: [${enOnly}]`,
    );
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of flattenKeys(RESOURCES[locale])) {
        const v = translate(locale, key);
        assert(typeof v === 'string' && v.trim().length > 0, `${locale}.${key} 값이 빈 문자열`);
      }
    }
  });

  // ── 1-b. 소스가 부르는 키가 실제로 있다 ────────────────────────────────────
  // 패리티(1)는 **양쪽에 다 없는** 키를 잡지 못한다. 실제로 `duel.rainShort`가
  // ko·en 둘 다 빠진 채 통과했고, 예보 제출 화면에 "duel.rainShort"라는 글자가
  // 그대로 찍혔다(2026-08-06 리뷰에서 발견). 소스의 t('literal') 호출을 긁어
  // 리소스와 대조한다. 동적 키(t(변수)·템플릿 리터럴)는 정적으로 알 수 없어
  // 빠지므로, 이 검사는 "리터럴 키는 전부 있다"까지만 보장한다.
  // 1-c: **소스에 같은 키가 두 번 적혀 있지 않다** (2026-08-09).
  // 위 패리티 검사는 RESOURCES(이미 평가된 객체)를 보므로 중복을 못 본다 —
  // JS 객체 리터럴은 같은 키를 두 번 써도 에러가 아니고 **뒤엣것이 조용히 이긴다**.
  // 실제로 그렇게 됐다: 같은 결함(기초과학 개념 라벨 누락)을 두 갈래가 각각 고쳤고,
  // 파일의 서로 다른 위치라 git이 충돌 없이 둘 다 병합해 ko.js의 concept 블록에
  // 키 6개가 중복됐다. 화면에는 나중 것이 떴고 앞의 수정은 흔적 없이 죽어 있었다.
  await scenario('리소스 소스에 중복 키가 없다(병합이 조용히 덮어쓰는 것 차단)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const locale of SUPPORTED_LOCALES) {
      const src = readFileSync(resolve(root, `src/i18n/resources/${locale}.js`), 'utf8');
      // 문자열·주석을 먼저 지운다 — 값 안의 '{count}일' 같은 중괄호가 깊이 계산을
      // 망가뜨리고, 주석 속 `key:` 표기가 키로 잡힌다.
      const stack = [{ path: '(root)', keys: new Map() }];
      const dups = [];
      src.split('\n').forEach((raw, i) => {
        const line = raw
          .replace(/'(?:[^'\\]|\\.)*'/g, "''")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""')
          .replace(/`(?:[^`\\]|\\.)*`/g, '``')
          .replace(/\/\/.*$/, '')
          .replace(/\/\*.*?\*\//g, '');
        const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
        if (m) {
          const top = stack[stack.length - 1];
          if (top.keys.has(m[1])) {
            dups.push(`${locale}.js ${top.path}.${m[1]} — ${top.keys.get(m[1])}행과 ${i + 1}행`);
          } else {
            top.keys.set(m[1], i + 1);
          }
        }
        for (const ch of line) {
          if (ch === '{') stack.push({ path: m ? `${stack[stack.length - 1].path}.${m[1]}` : '?', keys: new Map() });
          else if (ch === '}' && stack.length > 1) stack.pop();
        }
      });
      assert(dups.length === 0, `${locale}.js 중복 키 ${dups.length}건 — ${dups.join(' · ')}`);
    }
  });

  await scenario('t() 리터럴 키가 전부 리소스에 있다(ko·en 동시 누락 차단)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.(jsx?|mjs)$/.test(name) ? [p] : [];
      });
    const used = new Set();
    for (const file of walk(join(root, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    assert(used.size > 100, `t() 리터럴 키를 못 긁었다 — ${used.size}건`);
    for (const locale of SUPPORTED_LOCALES) {
      const have = new Set(flattenKeys(RESOURCES[locale]));
      const missing = [...used].filter((k) => !have.has(k)).sort();
      assert(missing.length === 0, `${locale}에 없는 키 ${missing.length}건 — [${missing.slice(0, 8)}]`);
    }
  });

  /**
   * ⚠️ **이 시나리오는 `displayLayerParity.contract.test.mjs`의 `src/**` 전수 검사로
   * 대체됐다 — 대회 후 삭제 예정**(2026-08-18 PM 판정 · 대장 §4.25).
   *
   * 🔴 **지금 지우지 않는 이유**: 8/21 동결 직전에 살아 있는 테스트를 걷는 것은
   * 회귀면만 넓힌다. 중복 검사는 비용이지만 **잘못 지운 검사는 결함**이다.
   *
   * 남는 차이를 적어 둔다 — 지울 때 잃는 것이 무엇인지 알고 지우게:
   * 이쪽은 **파일 목록을 손으로 적어** 5개만 본다(`src/modules/board` 한 디렉터리만
   * 27파일이다). 전수 검사는 목록이 아니라 **디렉터리 전수 + 경로 규칙 제외**라
   * 새 파일·새 디렉터리가 생겨도 자동으로 본다. **덮는 범위는 전수 쪽이 진부분집합이
   * 아니라 상위집합**이므로, 지워도 잃는 검사는 없다.
   */
  await scenario('보드 시각화 모듈에 하드코딩 한국어가 없다 (MT-28 회귀)', async () => {
    // **왜 이 가드가 있나**: 이월 대장(:1409)이 *"하드코딩 한국어는 1건뿐"*이라
    // 단정하는 동안 실제로는 **246줄 / 5파일**이었다. 세 파일이 각자 주석으로
    // "§6.3 외부화 제외"를 자백해 놓고도 색인에 행이 없어 8/10까지 안 잡혔다.
    // **자백은 등재를 대신하지 못하고, 사람의 단정은 드리프트한다** — 그래서
    // 사람이 아니라 이 테스트가 소유한다.
    //
    // 하필 이 네 파일이 심사 배점 ②(체험·참여형)를 겨눈 보드 퍼즐의 **판정 순간
    // 화면 전부**다. en으로 한 번 풀면 단면 캡션·팔레트·지도 라벨이 통째로 한국어였다.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const GUARDED = [
      'src/modules/board/CrossSectionPanel.jsx',
      'src/modules/board/webgl/crossSection/scenes.js',
      'src/modules/board/boardDisplay.js',
      'src/modules/board/mapInfographic.jsx',
      'src/modules/board/crossSectionLabels.js',
    ];
    const hangul = /[가-힣]/;
    for (const rel of GUARDED) {
      const src = readFileSync(join(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')            // 블록 주석
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//'))
        .map((l) => l.replace(/\/\/.*$/, ''))        // 행말 주석
        .filter((l) => hangul.test(l));
      assert(
        src.length === 0,
        `${rel}: 코드에 한국어 ${src.length}줄 — 리소스(board.*.js)로 뺄 것. 예: ${src[0]?.trim().slice(0, 60)}`,
      );
    }
  });

  // ── 2. translate 순수 함수: 보간 + 미지 키 ────────────────────────────────
  await scenario('translate(): {name} 보간·미지 키는 키 반환·미지 파라미터는 원문 유지', async () => {
    assert(
      translate('ko', 'streak.title', { count: 7 }) === '연속 출석 7일',
      `ko 보간 실패: ${translate('ko', 'streak.title', { count: 7 })}`,
    );
    assert(
      translate('en', 'streak.title', { count: 7 }) === '7-day streak',
      `en 보간 실패: ${translate('en', 'streak.title', { count: 7 })}`,
    );
    assert(translate('en', 'no.such.key') === 'no.such.key', '미지 키는 키 문자열 그대로여야 함');
    assert(
      translate('ko', 'streak.title') === '연속 출석 {count}일',
      '파라미터 미전달 시 자리표시자가 원문으로 남아야 함',
    );
  });

  // ── 3. 파일럿 실마운트: ko 렌더 → 스위처 클릭 → en 렌더 ──────────────────
  // 여기서 마운트하는 LocaleSwitcher는 **제품 화면에 없다**(2026-08-13, 시나리오 5ⓐ).
  // 그래도 남기는 이유: 키 패리티(시나리오 1)는 "en에 키가 있다"만 보고 "en 값이
  // 화면에 그려진다"는 못 본다 — MT-28에서 실제로 en 리소스가 있는데도 서버 원문이
  // 그려지던 결함을 잡은 것이 이런 실렌더 대조였다. en을 되살릴 때의 안전망이다.
  await scenario('StreakBadge: ko 렌더 → LocaleSwitcher 클릭 → en 렌더(양 언어 실대조)', async () => {
    useLocaleStore.getState().setLocale('ko');
    useProgressStore.getState().setStreak(7);
    const r = mount(createElement(Fragment, null, createElement(StreakBadge), createElement(LocaleSwitcher)));
    try {
      await waitFor(() => text().includes('7'), 4000, 'StreakBadge 렌더');
      // ko: en 리소스 값이 아니라 ko 값이 떠야 한다
      assert(badgeTitle() === '연속 출석 7일', `ko title 기대 — 실제 "${badgeTitle()}"`);
      assert(text().includes('일'), 'ko 단위 표기("일")가 없다');
      assert(!text().includes('days'), 'ko 로케일인데 en 문자열이 떴다');

      const buttons = [...window.document.querySelectorAll('button')];
      const koBtn = buttons.find((b) => b.textContent === '한국어');
      const enBtn = buttons.find((b) => b.textContent === 'English');
      assert(koBtn && enBtn, '스위처 버튼(한국어/English)이 없다');
      assert(koBtn.getAttribute('aria-pressed') === 'true', 'ko 버튼이 눌린 상태여야 함');

      // en 전환 — 실클릭으로 스토어 구독 리렌더까지 확인
      enBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      await waitFor(() => badgeTitle() === '7-day streak', 4000, 'en 전환 후 title 갱신');
      assert(text().includes('days'), 'en 단위 표기("days")가 없다');
      assert(!badgeTitle().includes('연속 출석'), 'en 로케일인데 ko title이 남아 있다');
      assert(enBtn.getAttribute('aria-pressed') === 'true', 'en 버튼이 눌린 상태로 바뀌어야 함');
    } finally {
      r.unmount();
    }
  });

  // ── 4. 프로그램 전환의 저장 + setLocale 방어 ──────────────────────────────
  // 종전 이 시나리오는 "detectLocale이 저장값 → navigator → ko 순"을 단정했다.
  // 2026-08-13 ko 고정으로 **그 단정은 뜻을 잃었고**(우선순위 자체가 없어졌다)
  // 시나리오 5ⓑ가 그 자리를 대신한다. 여기 남는 것은 여전히 참인 두 가지다:
  // setLocale이 저장 키에 쓴다는 것, 그리고 미지원 로케일을 거부한다는 것.
  await scenario('setLocale: 저장 키에 남기고 미지원 로케일은 거부한다', async () => {
    assert(LOCALE_STORAGE_KEY === 'weathermind.locale', `저장 키 계약 드리프트: ${LOCALE_STORAGE_KEY}`);
    // 시나리오 3에서 en으로 전환했다 — 저장돼 있어야 한다
    assert(
      window.localStorage.getItem(LOCALE_STORAGE_KEY) === 'en',
      `전환이 저장되지 않았다: ${window.localStorage.getItem(LOCALE_STORAGE_KEY)}`,
    );

    // setLocale이 미지원 로케일을 거부한다
    useLocaleStore.getState().setLocale('ko');
    useLocaleStore.getState().setLocale('zz');
    assert(useLocaleStore.getState().locale === 'ko', 'setLocale이 미지원 로케일을 거부해야 함');
  });

  // ── 5. 「영어 기능 제거」 계약 (2026-08-13 클라이언트 결정) ────────────────
  // 이 두 단정이 있어야 제거가 되돌려질 때 CI가 운다. ⓐ는 화면 통로,
  // ⓑ는 시동 로케일 — **둘 다 걸어야** 한다. 한쪽만 되돌리면 en 화면이 아니라
  // "눌러도 안 바뀌는 버튼"이나 "통로는 없는데 en으로 열리는 앱"이 되기 때문이다.
  await scenario('ⓐ 화면에 언어 전환 통로가 없다(src 정적 스캔)', async () => {
    const srcDir = resolve(root, 'src');
    const files = readdirSync(srcDir, { recursive: true })
      .map((p) => String(p))
      .filter((p) => /\.(jsx?|mjs)$/.test(p))
      // 스위처 자신은 제외 — 파일은 존치한다(테스트가 직접 마운트한다).
      .filter((p) => !p.endsWith('components/LocaleSwitcher.jsx'));

    // 주석은 화면이 아니다 — 제거 사유·되살리는 법을 적은 주석이 스스로를 위반으로
    // 만들면 안 되므로 **주석을 걷어낸 코드**만 본다(Layout.jsx가 실제로 그렇다).
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    const mounts = [];
    const setters = [];
    for (const rel of files) {
      const code = stripComments(readFileSync(resolve(srcDir, rel), 'utf-8'));
      if (/LocaleSwitcher/.test(code)) mounts.push(rel);
      // i18n 스토어 자신이 setLocale을 **정의**하는 것은 통로가 아니다.
      if (/setLocale\s*\(/.test(code) && !rel.startsWith('i18n/')) setters.push(rel);
    }
    assert(
      mounts.length === 0,
      `언어 전환 통로가 화면에 되살아났다(LocaleSwitcher 참조): ${mounts.join(', ')} — ` +
        '되살리려면 i18n/core.js의 detectLocale 고정도 함께 풀어야 한다',
    );
    assert(
      setters.length === 0,
      `제품 코드가 setLocale을 부른다(전환 통로): ${setters.join(', ')}`,
    );
  });

  await scenario('ⓑ navigator가 en-US이고 저장값이 en이어도 detectLocale은 ko', async () => {
    // 심사위원 브라우저(en-US) + 개발 중 스위처를 눌러 본 사용자(저장값 en) 조건을
    // 동시에 세운다 — 종전 우선순위(저장값 → navigator)라면 둘 다 en으로 갔다.
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    assert(detectLocale() === 'ko', `en-US + 저장값 en에서도 ko여야 한다 — 실제 ${detectLocale()}`);

    // 저장값 없음 · navigator만 en-US
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    assert(detectLocale() === 'ko', `navigator(en-US)만으로도 ko여야 한다 — 실제 ${detectLocale()}`);

    // 미지원 언어·오염된 저장값도 당연히 ko(기존 폴백 성질 유지)
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'fr-FR' }, configurable: true });
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zz');
    assert(detectLocale() === 'ko', `미지원 값에서도 ko — 실제 ${detectLocale()}`);

    assert(DEFAULT_LOCALE === 'ko', `기본 로케일 계약 드리프트: ${DEFAULT_LOCALE}`);
  });
} finally {
  await vite.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: i18n 골격(키 패리티·보간·파일럿 양 언어 렌더·로케일 영속) 스모크 통과');
process.exit(0);

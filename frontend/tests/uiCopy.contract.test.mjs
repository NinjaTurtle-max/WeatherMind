/**
 * 화면 문구·표시 밴드 계약 (R13 4일차 — 리드4) —
 *   node tests/uiCopy.contract.test.mjs
 *
 * 왜 있나: 이번 스프린트 검수(CARRYOVER_R13 §S·§R·§L)가 **화면이 사실과 다른 말을
 * 하는** 결함을 4건 실측했다. 셋은 리소스 값 자체가 틀렸고, 하나는 표시 밴드 수가
 * 서버보다 적어 화면에 키 문자열이 그대로 떴다. 리소스는 서버 상수와 물리적으로
 * 이어져 있지 않아 **드리프트가 조용하다** — 그래서 여기서 대조한다.
 *
 * 관례: 테스트 러너 의존 없음, 순수 node. i18n/core.js·lib/abilityDisplay.js는
 * bare 지정자를 끌지 않으므로(core.js 주석 참조) node_modules 없이 그대로 import된다.
 *
 * 지키는 계약
 *   1. CO-S-4 / CO-L-F6 — `ability.level.*`가 서버 `THETA_BAND_LABELS` 4밴드와 1:1.
 *      (3개였을 때 HomePage:353·레이더 aria-label에 `ability.level.expert`가
 *       **키 문자열 그대로** 떴다. en 실렌더로 확인된 결함이다.)
 *   2. CO-L-F7 — `levelFromTheta` 경계가 서버 `THETA_BAND_BOUNDS`와 동일.
 *      (θ≥1.5에서 서버 expert ↔ 클라 advanced로 갈려 있었다.)
 *   3. CO-S-6 — 자유 일일 세션 진입 문구가 **문항 수를 상수로 단정하지 않는다**.
 *      ("오늘의 10문항"이 화면 3곳에 떴는데 실제 배합 합은 15다.)
 *   4. CO-R-9 — 예보 대결 문구가 **내일 예측 · D+2 채점**을 말한다.
 *      (같은 앱의 ClosingForecastStep은 D+2로 올바르게 안내했는데 gate·duel 문구만
 *       "오늘의 기온"·"내일 정산"이라 두 화면이 같은 사실을 다르게 말했다.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${label}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n      기대 ${e}\n      실제 ${a}`);
}

// ── 서버 원본(단일 진실원)에서 밴드를 읽는다 ────────────────────────────────
// 평문 상수라 텍스트 파서가 적법하다(파생 로직이 아니다 — mock parity 계약이
// 파서를 폐기한 이유는 "파생 로직을 못 읽는다"였고 여기 해당하지 않는다).
const brainSrc = readFileSync(
  resolve(repoRoot, 'backend/app/services/weatherbrain_service.py'),
  'utf-8',
);

function parsePyTuple(name) {
  // ⚠️ **정의행에만** 걸어야 한다(줄 시작 앵커 + 타입 주석 허용).
  // 앵커가 없으면 같은 이름을 언급하는 **주석**(weatherbrain_service.py:80·207)에
  // 먼저 걸려 값이 NaN이 된다 — 2026-08-08 감사가 잡은 이 파일 자신의 버그다.
  const m = brainSrc.match(
    new RegExp(`^${name}\\s*(?::[^=]*)?=\\s*\\(([^)]*)\\)`, 'm'),
  );
  assert(m, `${name}을 backend weatherbrain_service.py에서 찾지 못했다 — 상수 이름이 바뀌었나?`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

const SERVER_BAND_LABELS = parsePyTuple('THETA_BAND_LABELS');
const SERVER_BAND_BOUNDS = parsePyTuple('THETA_BAND_BOUNDS').map(Number);

const { RESOURCES } = await import('../src/i18n/core.js');
const ability = await import('../src/lib/abilityDisplay.js');

// ── 1. 표시 밴드가 서버와 1:1 ───────────────────────────────────────────────
check('CO-S-4: ability.level.* 가 서버 THETA_BAND_LABELS 4밴드와 1:1 (ko·en)', () => {
  assert(SERVER_BAND_LABELS.length === 4, `서버 밴드가 4개가 아니다: ${SERVER_BAND_LABELS}`);
  for (const locale of ['ko', 'en']) {
    const levels = Object.keys(RESOURCES[locale].ability.level);
    eq(levels.sort(), [...SERVER_BAND_LABELS].sort(), `${locale} ability.level 키 집합이 서버 밴드와 다르다`);
    for (const label of SERVER_BAND_LABELS) {
      const value = RESOURCES[locale].ability.level[label];
      assert(
        typeof value === 'string' && value.length > 0,
        `${locale}.ability.level.${label} 값이 비었다 — 미해결 키는 화면에 키 문자열로 뜬다`,
      );
      assert(
        value !== label,
        `${locale}.ability.level.${label} 값이 키와 같다(${value}) — 번역이 아니라 폴백이다`,
      );
    }
  }
});

check('CO-L-F6: LEVEL_KO·LEVEL_CHIP이 4밴드 전부를 덮는다', () => {
  for (const label of SERVER_BAND_LABELS) {
    assert(
      typeof ability.LEVEL_KO[label] === 'string' && ability.LEVEL_KO[label].length > 0,
      `LEVEL_KO에 ${label}이 없다 — 소비처의 '?? tag' 폴백이 영문 라벨을 그대로 띄운다`,
    );
    assert(ability.LEVEL_CHIP[label], `LEVEL_CHIP에 ${label}이 없다 — 칩이 색 폴백으로 떨어진다`);
  }
});

// ── 2. 클라 폴백 경계가 서버 경계와 동일 ────────────────────────────────────
check('CO-L-F7: levelFromTheta 경계가 서버 THETA_BAND_BOUNDS와 동일', () => {
  eq(ability.THETA_BAND_BOUNDS, SERVER_BAND_BOUNDS, '클라 경계 배열이 서버와 다르다');
  eq(ability.THETA_BAND_LABELS, SERVER_BAND_LABELS, '클라 라벨 배열이 서버와 다르다');
  // 경계는 하위 밴드 제외·상위 밴드 포함(<) — 서버 _theta_bucket과 같은 규칙
  eq(ability.levelFromTheta(-3), 'beginner', 'θ=-3');
  eq(ability.levelFromTheta(-0.5), 'intermediate', 'θ=-0.5 (경계는 상위 밴드)');
  eq(ability.levelFromTheta(0.49), 'intermediate', 'θ=0.49');
  eq(ability.levelFromTheta(0.5), 'advanced', 'θ=0.5');
  eq(ability.levelFromTheta(1.49), 'advanced', 'θ=1.49');
  eq(ability.levelFromTheta(1.5), 'expert', 'θ=1.5 — 여기서 서버 expert ↔ 클라 advanced로 갈려 있었다');
  eq(ability.levelFromTheta(3), 'expert', 'θ=3');
});

// ── 3. 문항 수를 문구가 단정하지 않는다 ─────────────────────────────────────
check('CO-S-6: 자유 일일 세션 진입 문구가 문항 수를 상수로 단정하지 않는다', () => {
  // ⚠️ 2026-08-09: 이 가드가 보던 `curriculum.daily.body`는 **삭제됐다.** 진입
  // 카드에서 안내 문단을 빼면서(사용자 지시 — 바로 위 튜터 말풍선과 겹쳤다)
  // 읽는 곳이 없어져 ko/en에서 함께 지웠다(고아 키 금지 — CO-D6, CO-N-1 ③ 선례).
  // 가드는 지우지 않고 **daily 블록 전체**로 넓힌다: CO-S-6의 실질은 "이 문구
  // 하나"가 아니라 "자유 일일 세션 설명이 문항 수를 상수로 말하지 않는다"이고,
  // 배합은 여전히 `Settings.SESSION_RECIPE`(env)가 소유한다. `regen`류는 {min}
  // 보간이라 숫자가 없고, 새 문구를 이 블록에 추가하면 자동으로 감시된다.
  for (const locale of ['ko', 'en']) {
    for (const [key, value] of Object.entries(RESOURCES[locale].curriculum.daily)) {
      if (typeof value !== 'string') continue;
      assert(
        !/\d/.test(value),
        `${locale}.curriculum.daily.${key}에 숫자가 남아 있다: "${value}" — 배합은 env로 바뀌고 실제 합은 15다`,
      );
    }
  }
});

// ── 4. 예보 대결이 D+1 예측 · D+2 채점을 말한다 ─────────────────────────────
check('CO-R-9: 예보 대결 문구가 "내일 예측 · 이틀 뒤 채점"을 말한다', () => {
  // ⚠️ 2026-08-08(CO-N-1 ③): `gate.duel.*`는 **삭제됐다.** 웨이브 1이 고친 두 문구는
  // FeatureUnlockGate(해제 사다리 동기 부여 화면)의 것이었고, 그 화면 자체를
  // 걷어내면서 고아 키가 되어 리소스에서 함께 지웠다(고아 키 금지 — CO-D6).
  // CO-R-9의 실질(=사용자가 실제로 보는 문구)은 `duel.submittedNote`에 남아 있고
  // 아래가 그것을 계속 고정한다. 게이트 화면이 부활하면 그때 다시 등재할 것.
  assert(!('gate' in RESOURCES.ko), 'gate.* 가 되살아났다 — 소비 화면 없이 키만 두지 않는다');
  const ko = RESOURCES.ko;
  assert(
    ko.duel.submittedNote.includes('이틀 뒤') && !ko.duel.submittedNote.includes('내일'),
    `duel.submittedNote가 아직 내일 정산이라 말한다: "${ko.duel.submittedNote}"`,
  );
  const en = RESOURCES.en;
  assert(
    /two days/i.test(en.duel.submittedNote) && !/tomorrow/i.test(en.duel.submittedNote),
    `en duel.submittedNote: "${en.duel.submittedNote}"`,
  );
});

check('CO-R-9: 같은 앱의 ClosingForecastStep도 D+2를 쓴다(두 화면이 같은 사실을 같게 말한다)', () => {
  const src = readFileSync(resolve(here, '..', 'src/modules/duel/ClosingForecastStep.jsx'), 'utf-8');
  assert(
    /setDate\(\s*[a-zA-Z]+\.getDate\(\)\s*\+\s*2\s*\)/.test(src) || /\+\s*2\b/.test(src),
    'ClosingForecastStep의 D+2 산출을 찾지 못했다 — 두 화면의 근거가 갈라졌는지 재확인 필요',
  );
});

// ── 화면 사이에서 어긋나던 두 가지 (2026-08-19 전 화면 실측) ────────────────
/**
 * 이 파일이 「화면이 사실과 다른 말을 하는 것」을 무는 자리라, 「화면마다 같은
 * 것이 다르게 생긴 것」도 여기서 문다. 둘 다 **한 화면만 봐서는 안 보이고**
 * 화면을 오갈 때만 드러난다는 성질이 같다.
 */
check('전 화면의 바깥 여백이 pt-2다 — py-4면 화면을 오갈 때 본문이 8px 내려앉는다', () => {
  // 2026-08-17에 탐구 홈에서 사용자가 제보해 고친 결함인데, **하위 실험실 넷
  // (태풍·기후변화·탐정·과거예보, 목록과 상세 합쳐 여섯 자리)에는 남아 있었다.**
  // 실측 2026-08-19: 실험실 첫 내용 y=80~85 ↔ 나머지 화면 72~74.
  // 아래 여백을 `py`로 주면 `Layout`의 `pb-8`과도 중복된다.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.jsx') ? [full] : []);
  });
  const bad = [];
  for (const f of walk(resolve(repoRoot, 'frontend/src/modules'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.match(/className="space-y-[\d.]+ py-\d+"/g) ?? []) {
      bad.push(`${f.split('/modules/')[1]}: ${m}`);
    }
  }
  assert(bad.length === 0, `페이지 루트에 py-*가 남아 있다 — pt-2여야 한다\n    ${bad.join('\n    ')}`);
});

check('뒤로가기 링크가 한 꼴이다 — 12px/14px·medium/bold·slate/sky가 섞여 있었다', () => {
  // 같은 「← 목록으로」인데 2026-08-19까지 **네 가지 꼴**이 있었다. 위치용 접두어
  // (`shrink-0`·`inline-block`·`mb-2`)만 자리마다 다르고 **글자 계열은 하나**여야 한다.
  const STD = 'text-xs font-bold text-slate-500 hover:text-sky-600';
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.jsx') ? [full] : []);
  });
  const bad = [];
  for (const f of walk(resolve(repoRoot, 'frontend/src/modules'))) {
    const src = readFileSync(f, 'utf8');
    // 뒤로가기 문구를 쓰는 요소의 className만 본다(다른 링크·버튼은 관심 밖).
    for (const m of src.match(/className="([^"]*)"[^>]*>\s*\{t\('[^']*(common\.back|list\.back|backToList)'\)\}/g) ?? []) {
      const cls = m.match(/className="([^"]*)"/)[1];
      // ⚠️ **알약 버튼은 뺀다.** 같은 문구를 쓰지만 역할이 다르다 — 오류 화면의
      //    「나가는 문」은 본문 위 작은 링크가 아니라 CTA다(탐정 사건 로드 실패
      //    화면이 그렇다). 텍스트 링크만 한 꼴로 모으는 것이 이 계약의 뜻이다.
      if (/\brounded-full\b/.test(cls)) continue;
      if (!cls.endsWith(STD)) bad.push(`${f.split('/modules/')[1]}: "${cls}"`);
    }
    // onClick 꼴(보드 목록 복귀 버튼)도 같은 계열이어야 한다.
    for (const m of src.match(/onClick=\{backToList\} className="([^"]*)"/g) ?? []) {
      const cls = m.match(/className="([^"]*)"/)[1];
      if (!cls.endsWith(STD)) bad.push(`${f.split('/modules/')[1]}: "${cls}"`);
    }
  }
  assert(bad.length === 0, `뒤로가기 링크가 표준 꼴과 다르다 (…${STD})\n    ${bad.join('\n    ')}`);
});

// ── 표기 통일 (fix/notation-unify, 2026-08-21) ──────────────────────────────
/**
 * 왜 여기인가: 이 파일은 「화면마다 같은 것이 다르게 생긴 것」을 무는 자리다.
 * 표기 흔들림 3종이 정확히 그 부류였다 — 한 화면은 `°C`, 옆 화면은 `℃`.
 *
 * 실측(HEAD 기준, 손대기 전):
 *   온도 — ko 계열 `℃` 38줄 vs `°C` 3줄 / en 계열 `°C` 28줄 vs `℃` 13줄
 *   문항 — ko 값에 `문제` 6곳(ko.js) · `퀴즈` 2곳(board.ko.js cta)
 *   예보 — `기상예보`·`날씨예보`는 프론트 리소스에 0곳(시드에만 있고 그건 남의 소유)
 *
 * 판정: **언어마다 그 언어의 다수 관례로 모은다.**
 *   ko = `℃`(U+2103) — KS X 1001 계보의 한국어 조판 관례이고 이미 다수다.
 *   en = `°C`(U+00B0 + C) — U+2103은 CJK 호환 문자라 NFKC가 `°C`로 분해한다.
 *        영문 본문에 넣으면 CJK 폰트로 폴백해 글자폭이 튄다. SI 표기도 `°C`다.
 *
 * ⚠️ 값(RESOURCES)만 본다 — **파일 원문을 스캔하면 안 된다.** board.ko.js:91·160의
 *    `문제`는 주석("서버 데이터·배포 문제")이라 원문 스캔은 거짓 실패를 낸다.
 * ⚠️ 앞으로 생길 거짓 실패 한 부류: 오류 문구의 「문제가 발생했어요」. 그때는
 *    정규식을 넓히지 말고 문구를 「오류가 발생했어요」로 고쳐라 — 금지어를 예외로
 *    빼기 시작하면 이 계약은 그 순간 없는 것이 된다.
 */
const BANNED_NOTATION = {
  ko: [
    ['°C', '℃'],
    ['도씨', '℃'],
    ['섭씨', '℃'],
    ['문제', '문항'],
    ['퀴즈', '문항'],
    ['기상예보', '예보'],
    ['날씨예보', '예보'],
  ],
  // en에는 문항/예보 대응 흔들림이 없다(영어는 문제/문항을 가르지 않는다).
  // 온도만 반대 방향으로 문다.
  en: [['℃', '°C']],
};

/** RESOURCES 트리의 문자열 값을 (키 경로, 값)으로 펼친다. */
function flattenStrings(node, path = [], out = []) {
  if (typeof node === 'string') {
    out.push([path.join('.'), node]);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) flattenStrings(v, [...path, k], out);
  }
  return out;
}

for (const [locale, bans] of Object.entries(BANNED_NOTATION)) {
  const entries = flattenStrings(RESOURCES[locale]);
  for (const [bad, good] of bans) {
    check(`표기 통일: ${locale} 리소스 값에 「${bad}」가 없다 (→ 「${good}」)`, () => {
      const hits = entries
        .filter(([, value]) => value.includes(bad))
        .map(([key, value]) => `${locale}.${key} = "${value}"`);
      assert(
        hits.length === 0,
        `${locale} 리소스에 금지 표기 「${bad}」가 ${hits.length}곳 남아 있다 — 「${good}」로 통일한다\n    ${hits.join('\n    ')}`,
      );
    });
  }
}

check('표기 통일: 화면 컴포넌트에 하드코딩된 「°C」가 없다 (ko 전용 렌더 — ℃여야 한다)', () => {
  // 온도 단위를 하드코딩해 그리는 자리가 15곳쯤 있다(DuelPage·ResultCard·
  // TyphoonSimPage·ClimateSimPage 등 — 리소스를 거치지 않는다). `detectLocale()`이
  // ko 고정이라 **사용자가 보는 것은 언제나 이쪽**이고, 지금 전부 `℃`다.
  // 리소스만 물면 이 15곳으로 흔들림이 되돌아온다 — 그래서 함께 문다.
  // en 리소스 두 계열은 당연히 제외한다(en의 정답이 `°C`다).
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(e.name) ? [full] : [];
  });
  const bad = [];
  for (const f of walk(resolve(repoRoot, 'frontend/src'))) {
    if (/\/i18n\/resources\/(en|[a-z]+\.en)\.js$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.includes('°C')) bad.push(`${f.split('/frontend/')[1]}:${i + 1}: ${line.trim()}`);
    });
  }
  assert(bad.length === 0, `ko가 그리는 자리에 「°C」가 있다 — 「℃」로 통일한다\n    ${bad.join('\n    ')}`);
});

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exitCode = 1;
} else {
  console.log('\nOK: 화면 문구·표시 밴드 계약 통과');
}

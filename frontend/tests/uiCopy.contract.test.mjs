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
import { readFileSync } from 'node:fs';
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
  const m = brainSrc.match(new RegExp(`${name}[^=]*=\\s*\\(([^)]*)\\)`));
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
  for (const locale of ['ko', 'en']) {
    const body = RESOURCES[locale].curriculum.daily.body;
    assert(
      !/\d/.test(body),
      `${locale}.curriculum.daily.body에 숫자가 남아 있다: "${body}" — 배합은 env로 바뀌고 실제 합은 15다`,
    );
  }
});

// ── 4. 예보 대결이 D+1 예측 · D+2 채점을 말한다 ─────────────────────────────
check('CO-R-9: 예보 대결 문구가 "내일 예측 · 이틀 뒤 채점"을 말한다', () => {
  const ko = RESOURCES.ko;
  assert(
    ko.gate.duel.p1.includes('내일') && !ko.gate.duel.p1.includes('오늘'),
    `gate.duel.p1이 아직 오늘을 말한다: "${ko.gate.duel.p1}"`,
  );
  assert(
    ko.gate.duel.p3.includes('이틀 뒤') && !ko.gate.duel.p3.includes('다음 날'),
    `gate.duel.p3이 아직 D+1을 말한다: "${ko.gate.duel.p3}"`,
  );
  assert(
    ko.duel.submittedNote.includes('이틀 뒤') && !ko.duel.submittedNote.includes('내일'),
    `duel.submittedNote가 아직 내일 정산이라 말한다: "${ko.duel.submittedNote}"`,
  );
  const en = RESOURCES.en;
  assert(/tomorrow/i.test(en.gate.duel.p1), `en gate.duel.p1: "${en.gate.duel.p1}"`);
  assert(/two days/i.test(en.gate.duel.p3), `en gate.duel.p3: "${en.gate.duel.p3}"`);
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

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exitCode = 1;
} else {
  console.log('\nOK: 화면 문구·표시 밴드 계약 통과');
}

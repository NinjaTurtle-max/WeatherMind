/**
 * 공유 테스트 벡터 검증 (R3-01 §4) — node tests/boardEngine.vectors.test.mjs
 * `npm run test:board`
 *
 * database/seed/board_test_vectors.json(입력 보드 → 기대 판정, 데이터 직군 저작)을
 * 읽어 JS 인터프리터(src/lib/boardEngine.js)가 동일 판정을 내는지 확인한다.
 * 백엔드 테스트도 같은 파일을 읽으므로 양측 의미론 일치가 보증된다.
 *
 * 규칙은 database/seed/board_rules.json(단일 진실원)을 사용한다.
 * 두 파일 중 하나라도 없으면(데이터 직군 병렬 저작 중) 스킵하고 0으로 종료한다.
 *
 * 벡터 형식(관용적으로 수용):
 *   [{ "name"?: str, "board": §3.1 보드, "expected": [{zone, phenomenon, cloud?} ...],
 *      "goals"?: [{ "note"?: str, "conditions": §3.3 goal_conditions, "passed": bool }] }]
 *   expected는 존별 전체(4건) 또는 일부 존만 명시해도 된다.
 *
 * ⚠️ `goals` 블록은 R13 추가다(CO-K3). 그 전까지 공유 벡터는 **현상 판정만** 물고
 * 목표 판정(checkGoals)은 0건이었고, 그 무방비 구간에서 JS와 Python이 실제로
 * 정반대였다(빈 목표에 JS `passed:true` ↔ Python `False`). 이제 양측 러너가 같은
 * `goals` 블록을 읽어 목표 판정도 함께 대조한다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateBoard, validateBoardState, checkGoals } from '../src/lib/boardEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, '../../database/seed');
const rulesPath = resolve(seedDir, 'board_rules.json');
const vectorsPath = resolve(seedDir, 'board_test_vectors.json');

if (!existsSync(rulesPath) || !existsSync(vectorsPath)) {
  const missing = [rulesPath, vectorsPath].filter((p) => !existsSync(p));
  console.log(`SKIP: 공유 테스트 벡터/규칙 파일이 아직 없습니다 (데이터 직군 저작 중)\n  - ${missing.join('\n  - ')}`);
  process.exit(0);
}

const rules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf-8'));
const cases = Array.isArray(vectors) ? vectors : (vectors.cases ?? vectors.vectors ?? []);

let failed = 0;
cases.forEach((tc, i) => {
  const name = tc.name ?? tc.id ?? `case #${i + 1}`;
  const board = tc.board ?? tc.input ?? tc.board_state;
  const expected = tc.expected ?? tc.expect ?? tc.phenomena;

  const validationErrors = validateBoardState(board);
  if (validationErrors.length > 0 && !tc.expect_invalid) {
    console.error(`FAIL ${name}: 입력 보드가 §3.1 검증 실패 — ${validationErrors.join('; ')}`);
    failed += 1;
    return;
  }

  const results = evaluateBoard(board, rules);
  const expectedList = Array.isArray(expected) ? expected : [];
  const mismatches = [];
  expectedList.forEach((exp, zoneIdx) => {
    const zone = exp.zone ?? zoneIdx;
    const actual = results[zone];
    if (!actual) {
      mismatches.push(`zone ${zone}: 결과 없음`);
      return;
    }
    if (exp.phenomenon != null && actual.phenomenon !== exp.phenomenon) {
      mismatches.push(`zone ${zone}: phenomenon 기대 ${exp.phenomenon} ≠ 실제 ${actual.phenomenon}`);
    }
    if (exp.cloud != null && actual.cloud !== exp.cloud) {
      mismatches.push(`zone ${zone}: cloud 기대 ${exp.cloud} ≠ 실제 ${actual.cloud}`);
    }
  });

  // 목표 판정(§3.3) 대조 — `goals` 블록이 있는 벡터만 (CO-K3)
  for (const g of tc.goals ?? []) {
    const label = g.note ?? JSON.stringify(g.conditions);
    const actual = checkGoals(results, g.conditions).passed;
    if (actual !== g.passed) {
      mismatches.push(`goals[${label}]: passed 기대 ${g.passed} ≠ 실제 ${actual}`);
    }
  }

  if (mismatches.length > 0) {
    console.error(`FAIL ${name}\n  ${mismatches.join('\n  ')}`);
    failed += 1;
  } else {
    console.log(`PASS ${name}`);
  }
});

console.log(`\n${cases.length - failed}/${cases.length} 통과`);
process.exit(failed > 0 ? 1 : 0);

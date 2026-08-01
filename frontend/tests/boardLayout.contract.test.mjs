/**
 * boardLayout 좌표계 계약 검증 (R10-00 웨이브 0) — node tests/boardLayout.contract.test.mjs
 *
 * boardLayout.js는 웨이브 1 동안 FE-1(단면 패널)·FE-2(지도 오버레이)·FE-4(보드 조작)가
 * 동시에 전제하는 동결 계약이다. 그런데 렌더 스모크(boardVisual.render.test.mjs)는
 * 마크업 문자열 존재만 확인하므로 좌표값이 바뀌어도 초록색으로 통과한다.
 * 이 파일이 그 구멍을 막는 기계적 가드다 — docstring의 "동결"을 테스트로 강제한다.
 *
 * 고정하는 것:
 *  1) VIEW_W·VIEW_H 값 자체 (viewBox 100×80)
 *  2) toUser 사영 규칙 — x 그대로, y ×0.8. 기대값을 **하드코딩**한다
 *     (VIEW_H로 재계산하면 VIEW_H가 바뀌어도 통과해 가드가 무력해진다)
 *  3) toUser 기본값 인자(dflt = [50, 50]) 폴백 동작
 *  4) FALLBACK_REGIONS 존 개수(=ZONES 길이)·좌표 필드 존재
 *  5) FALLBACK_REGIONS ↔ database/seed/board_regions.json 좌표 일치
 *     (좌표 SSOT는 시드 — 폴백은 사본이므로 드리프트하면 실패해야 한다)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VIEW_W, VIEW_H, toUser, FALLBACK_REGIONS } from '../src/modules/board/boardLayout.js';
import { ZONES } from '../src/lib/boardEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(here, '../../database/seed/board_regions.json');

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}${detail ? `\n     → ${detail}` : ''}`);
    failed += 1;
  }
};

// 부동소수 오차 허용(0.8 곱은 이진 표현상 33*0.8 = 26.400000000000002 같은 꼬리를 남긴다).
// 허용폭 1e-9는 꼬리만 흡수하고 실제 계약 변경(예: VIEW_H 80→100 → y가 26.4에서 33으로)은 반드시 잡는다.
const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPS;
const nearPoint = (got, want) =>
  Array.isArray(got) && got.length === 2 && near(got[0], want[0]) && near(got[1], want[1]);

// ── 1) viewBox 값 고정 ───────────────────────────────────────────────────────
const WHO_VIEW =
  '지도 viewBox·강수 에미터 컨테이너 분율·태백 능선 scale(1, VIEW_H/100)이 모두 이 값 기준이다. ' +
  '바뀌면 FE-2(지도 오버레이)의 노드·구름·강수 위치가 전부 밀리고, ' +
  '같은 userSpace(100×80)를 전제로 좌표를 저작한 mapInfographic.jsx(프리즈 계약, FE-1도 참조)와도 어긋난다.';
check('VIEW_W === 100 (userSpace 가로)', VIEW_W === 100, `실제 ${VIEW_W}. ${WHO_VIEW}`);
check('VIEW_H === 80 (userSpace 세로 — 정규화 y의 0.8 사영)', VIEW_H === 80, `실제 ${VIEW_H}. ${WHO_VIEW}`);

// ── 2) toUser 사영 규칙 — 기대값 하드코딩 ─────────────────────────────────────
// 정규화 0~100 → userSpace: x는 그대로(VIEW_W/100 = 1), y만 ×0.8.
const WHO_PROJ =
  'toUser는 지역 노드(drop 타깃 data-board-zone)·라벨·구름·강수 에미터의 유일한 좌표 변환이다. ' +
  '바뀌면 FE-2 지도 렌더가 어긋나고, FE-4(보드 조작)의 드래그·탭 히트 영역이 지도상 엉뚱한 지역을 가리킨다.';
const PROJECTION_VECTORS = [
  // [입력 정규화 좌표, 기대 userSpace(하드코딩)]
  [[21, 54], [21, 43.2], '서해상 svg_point'],
  [[43, 33], [43, 26.4], '수도권 svg_point'],
  [[61, 47], [61, 37.6], '영서·태백 svg_point'],
  [[82, 43], [82, 34.4], '영동·동해 svg_point'],
  [[88, 55], [88, 44], '영동·동해 label_anchor'],
  [[0, 0], [0, 0], '경계 — 좌상단'],
  [[100, 100], [100, 80], '경계 — 우하단(y가 80으로 압축되는지)'],
];
for (const [input, want, label] of PROJECTION_VECTORS) {
  const got = toUser(input);
  check(
    `toUser(${JSON.stringify(input)}) === ${JSON.stringify(want)} — ${label}`,
    nearPoint(got, want),
    `실제 ${JSON.stringify(got)}. ${WHO_PROJ}`,
  );
}
// x는 절대 스케일되지 않아야 한다(VIEW_W/100 = 1) — 위 벡터의 x 불변성을 명시적으로 한 번 더 고정
check(
  'toUser는 x를 스케일하지 않는다 (x 등방 — 노드·심볼 왜곡 방지)',
  PROJECTION_VECTORS.every(([input]) => near(toUser(input)[0], input[0])),
  `x가 스케일되면 userSpace가 비등방이 되어 원형 노드·표준 기상 기호가 타원으로 찌그러진다. ${WHO_PROJ}`,
);

// ── 3) 기본값 인자(dflt = [50, 50]) 폴백 동작 ────────────────────────────────
const WHO_DFLT =
  '시드/서버 응답에 좌표가 빠졌을 때 노드를 지도 중앙에 두는 안전망이다. ' +
  '깨지면 FE-2 지도에서 좌표 없는 지역 노드가 NaN 위치로 사라지고(SVG 렌더 무음 실패), ' +
  'FE-4의 드롭 타깃도 함께 사라진다.';
check('toUser(undefined) → 기본값 [50,50] 사영 = [50,40]', nearPoint(toUser(undefined), [50, 40]), `실제 ${JSON.stringify(toUser(undefined))}. ${WHO_DFLT}`);
check('toUser(null) → [50,40]', nearPoint(toUser(null), [50, 40]), `실제 ${JSON.stringify(toUser(null))}. ${WHO_DFLT}`);
check('toUser([7]) → 길이 부족이면 기본값 [50,40]', nearPoint(toUser([7]), [50, 40]), `실제 ${JSON.stringify(toUser([7]))}. ${WHO_DFLT}`);
check('toUser("x") → 비배열이면 기본값 [50,40]', nearPoint(toUser('x'), [50, 40]), `실제 ${JSON.stringify(toUser('x'))}. ${WHO_DFLT}`);
check(
  'toUser(null, [10,20]) → 호출자 지정 dflt 사용 = [10,16]',
  nearPoint(toUser(null, [10, 20]), [10, 16]),
  `실제 ${JSON.stringify(toUser(null, [10, 20]))}. PeninsulaMap이 label_anchor 누락 시 svg_point 기반 dflt를 넘긴다. ${WHO_DFLT}`,
);

// ── 4) FALLBACK_REGIONS 구조 ────────────────────────────────────────────────
const WHO_FB =
  'AtmosphereBoard가 GET /board/regions 실패·지연 시 ZONES와 zip해 regions를 만든다(AtmosphereBoard.jsx의 폴백 병합). ' +
  '개수가 어긋나면 그 자리가 undefined가 되어 FE-2 지도 노드 렌더와 FE-4 드롭 타깃이 동시에 붕괴한다.';
check(
  `FALLBACK_REGIONS 개수 === ZONES 길이 (${ZONES.length})`,
  Array.isArray(FALLBACK_REGIONS) && FALLBACK_REGIONS.length === ZONES.length,
  `실제 ${Array.isArray(FALLBACK_REGIONS) ? FALLBACK_REGIONS.length : typeof FALLBACK_REGIONS}. ${WHO_FB}`,
);
const isCoord = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n));
FALLBACK_REGIONS.forEach((r, i) => {
  check(
    `FALLBACK_REGIONS[${i}] 좌표 필드 완비 (name·svg_point·label_anchor)`,
    typeof r?.name === 'string' && r.name.length > 0 && isCoord(r?.svg_point) && isCoord(r?.label_anchor),
    `실제 ${JSON.stringify(r)}. ${WHO_FB}`,
  );
});

// ── 5) 시드 대조 — 좌표 SSOT = database/seed/board_regions.json ──────────────
const WHO_SEED =
  '시드는 서버 GET /board/regions가 내려주는 값이고 FALLBACK_REGIONS는 그 사본이다. ' +
  '어긋나면 같은 지도가 서버 로드 성공/실패에 따라 두 얼굴이 되어(FE-2 지도 노드가 지역별로 이동) ' +
  '재현 불가능한 위치 버그가 된다. 수정은 반드시 시드 → 폴백 방향으로만.';
if (!existsSync(seedPath)) {
  check('시드 파일 존재 (database/seed/board_regions.json)', false, `${seedPath} 없음. ${WHO_SEED}`);
} else {
  const seed = JSON.parse(readFileSync(seedPath, 'utf-8'));
  check(
    `시드 존 개수 === FALLBACK_REGIONS 개수 (${FALLBACK_REGIONS.length})`,
    Array.isArray(seed) && seed.length === FALLBACK_REGIONS.length,
    `시드 ${Array.isArray(seed) ? seed.length : typeof seed}건 vs 폴백 ${FALLBACK_REGIONS.length}건. ${WHO_SEED}`,
  );
  const byZone = new Map((Array.isArray(seed) ? seed : []).map((r) => [r.zone, r]));
  FALLBACK_REGIONS.forEach((fb, zone) => {
    const sd = byZone.get(zone);
    const diffs = [];
    if (!sd) {
      diffs.push(`시드에 zone ${zone} 없음`);
    } else {
      if (sd.name !== fb.name) diffs.push(`name: 시드 ${JSON.stringify(sd.name)} ≠ 폴백 ${JSON.stringify(fb.name)}`);
      for (const key of ['svg_point', 'label_anchor']) {
        if (JSON.stringify(sd[key]) !== JSON.stringify(fb[key])) {
          diffs.push(`${key}: 시드 ${JSON.stringify(sd[key])} ≠ 폴백 ${JSON.stringify(fb[key])}`);
        }
      }
    }
    check(
      `zone ${zone} 시드↔폴백 일치 (${fb.name})`,
      diffs.length === 0,
      `${diffs.join(' / ')}. ${WHO_SEED}`,
    );
  });
}

if (failed > 0) {
  console.error(`\n${failed}건 실패 — boardLayout.js는 웨이브 1 동결 계약이다. 값 변경은 FE-1/FE-2/FE-4 병합 후에.`);
  process.exit(1);
}
console.log('OK: boardLayout 좌표계 계약 통과 (viewBox·사영 규칙·폴백 인자·시드 대조)');

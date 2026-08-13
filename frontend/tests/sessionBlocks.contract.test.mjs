/**
 * 세션 블록 표기 계약 — 데일리와 유닛 완료 화면이 **한 벌을 공유한다**.
 *   node tests/sessionBlocks.contract.test.mjs
 *
 * 왜 있나. 2026-08-13에 「하루의 첫 유닛 세션 = 데일리 세션」이 착지하면서 유닛
 * 세션도 `실황2·신규4·복습3·보드1` 배합을 받게 됐다. 그런데 `UnitSummary`는
 * `session.summary.correct`·`.xp` 둘만 빌려 쓰고 있어서 **10문항이 무슨 구성인지
 * 화면이 한 번도 말하지 않았다.** 클라이언트가 「2+4+3+1인데 2+2로 뜬다」고 읽은
 * 것도 이 침묵과 무관하지 않다 — **문항 수가 맞는 것과 구성이 보이는 것은 다른
 * 일**이고, 앞의 것만 고치면 화면은 그대로 조용하다.
 *
 * 지키는 계약
 *   ① `blockCounts`가 배합 순서(`live→new→review→board`)로 돌려준다. dict 키
 *      순서가 아니라 **표기 순서 자체가 계약**이다(CLAUDE.md: "사양이 「실황이
 *      앞」이므로 그 순서도 계약이다").
 *   ② 화이트리스트에 없는 kind는 조용히 빠진다 — 이것이 board가 배합에 들어왔는데
 *      배열에 없어 「오늘의 하늘」이 영영 안 뜨던 사고의 형태다. 그래서 **배합
 *      kind 전건이 화이트리스트에 있다**를 따로 문다. 이 단정이 없으면 다음에
 *      kind가 늘 때 같은 방식으로 조용히 사라진다.
 *   ③ 두 화면이 **같은 함수**를 쓴다 — 복제하면 한쪽만 고쳐져 갈린다.
 *   ④ ko·en 양쪽에 블록 라벨이 있다(한쪽만 저작하면 en 화면에 키가 그대로 뜬다).
 *
 * ⚠️ 이 파일은 **순수 함수와 리소스만** 잰다. 렌더까지 재려면 jsdom 하네스가
 * 필요한데, `SessionBlocks`가 `useT()`를 부르므로 i18n 프로바이더가 함께 서야
 * 한다 — 그 값은 `session` 스모크가 이미 낸다. 여기서는 **표기의 소유자**를 문다.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

try {
  const { blockCounts, SessionBlocks } = await vite.ssrLoadModule('/src/modules/session/SessionSummary.jsx');
  const ko = (await vite.ssrLoadModule('/src/i18n/resources/ko.js')).default;
  const en = (await vite.ssrLoadModule('/src/i18n/resources/en.js')).default;

  // ── ① 표기 순서 = 배합 순서 ──────────────────────────────────────────────
  // 일부러 **뒤섞어** 넣는다. 입력 순서를 그대로 되돌려주면 이 단정이 공허해진다.
  const dailyItems = [
    { kind: 'board' }, { kind: 'review' }, { kind: 'new' }, { kind: 'live' },
    { kind: 'new' }, { kind: 'review' }, { kind: 'live' }, { kind: 'new' },
    { kind: 'review' }, { kind: 'new' },
  ];
  const blocks = blockCounts(dailyItems);
  ok(
    JSON.stringify(blocks.map((b) => b.kind)) === JSON.stringify(['new', 'review', 'live', 'board']),
    `① 표기 순서가 배합 순서다 — 실제 ${JSON.stringify(blocks.map((b) => b.kind))}`,
  );
  const counts = Object.fromEntries(blocks.map((b) => [b.kind, b.count]));
  ok(
    counts.live === 2 && counts.new === 4 && counts.review === 3 && counts.board === 1,
    `① 개수가 실황2·신규4·복습3·보드1이다 — 실제 ${JSON.stringify(counts)}`,
  );

  // ── ② 배합 kind 전건이 표기 화이트리스트 안에 있다 ────────────────────────
  // 소유자는 backend `Settings.SESSION_RECIPE`이고, 목이 그 값을 복제해 노출한다.
  // 여기서는 **목의 실값**에서 파생시킨다 — 리터럴로 적으면 배합이 바뀔 때
  // 이 테스트만 초록인 채 화면이 조용히 비어 간다.
  const { __mockPolicy } = await vite.ssrLoadModule('/mock/apiMockPlugin.js');
  const recipeKinds = Object.keys(__mockPolicy().session_recipe ?? {});
  ok(recipeKinds.length > 0, `② 배합 kind를 목에서 읽어 왔다 — ${JSON.stringify(recipeKinds)}`);
  const missing = recipeKinds.filter(
    (k) => blockCounts([{ kind: k }]).length === 0,
  );
  ok(
    missing.length === 0,
    `② 배합 kind 전건이 표기된다 — 빠진 것 ${JSON.stringify(missing)}`,
  );

  // ── ③ 두 화면이 같은 컴포넌트를 쓴다 ─────────────────────────────────────
  ok(typeof SessionBlocks === 'function', '③ SessionBlocks가 공유 컴포넌트로 export된다');
  const unitPage = await vite.ssrLoadModule('/src/modules/curriculum/UnitSessionPage.jsx');
  ok(typeof unitPage.default === 'function', '③ UnitSessionPage가 로드된다');
  // 복제 방지: 유닛 페이지가 자기 블록 표기를 따로 갖지 않는다.
  const { readFile } = await import('node:fs/promises');
  const unitSrc = await readFile(resolve(root, 'src/modules/curriculum/UnitSessionPage.jsx'), 'utf-8');
  // ⚠️ `includes('SessionBlocks')`로는 부족하다 — **import 문만 남아도 통과**한다.
  //    변이 테스트에서 실제로 그랬다: 렌더 한 줄을 지웠는데 계약이 초록이었다.
  //    JSX 사용부(`<SessionBlocks`)를 물어야 「화면에 그린다」가 성립한다.
  ok(
    /<SessionBlocks\b/.test(unitSrc),
    '③ 유닛 완료 화면이 공유 컴포넌트를 **렌더한다**(import만으로는 부족)',
  );
  ok(
    !unitSrc.includes('session.summary.blocks.'),
    '③ 유닛 완료 화면이 블록 라벨을 **직접** 부르지 않는다(복제 금지)',
  );

  // ── ④ ko·en 양쪽에 라벨이 있다 ───────────────────────────────────────────
  for (const kind of ['new', 'review', 'live', 'board']) {
    ok(
      typeof ko.session?.summary?.blocks?.[kind] === 'string',
      `④ ko에 blocks.${kind} 라벨이 있다`,
    );
    ok(
      typeof en.session?.summary?.blocks?.[kind] === 'string',
      `④ en에 blocks.${kind} 라벨이 있다`,
    );
  }

  // 「진도 문항은 다음 5문항」 같은 고정 숫자는 배합이 바뀌면 거짓이 된다.
  ok(
    !/\d/.test(ko.session?.summary?.unitBlockNote ?? ''),
    '④ 유닛 블록 안내가 고정 숫자를 말하지 않는다(배합이 바뀌면 거짓이 된다)',
  );
} finally {
  await vite.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 세션 블록 표기 계약(순서·화이트리스트·공유·양 로케일) 통과');
process.exit(0);

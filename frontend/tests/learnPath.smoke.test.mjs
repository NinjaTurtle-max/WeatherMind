/**
 * 학습 경로(PcCurriculumPath) 실마운트 스모크 —
 *   node tests/learnPath.smoke.test.mjs
 *
 * 시안 `docs/design/learn_session_mockup.html`을 앱에 옮긴 뷰다. 관례는 다른
 * 스모크와 동일: 테스트 러너 의존 없음, vite ssrLoadModule + jsdom 실마운트.
 *
 * 여기서 지키는 것 — 전부 실제로 한 번씩 깨졌던 것들이다.
 *   ① 완료(파란) 길이 **섹션 경계를 넘어** 이어진다. 단계별로 따로 계산하면
 *      1단계를 끝낸 직후 2단계에 완료 노드가 0개라 길이 끊긴다.
 *   ② 노드 밑 라벨을 뺐으므로 **유닛명은 aria-label이 유일한 통로**다.
 *   ③ 구름 0이면 노드가 잠긴다 — 모바일 UnitNode와 같은 의미론이어야 한다
 *      (넘기지 않으면 구름 0에서 PC만 열려 문항 진입 전 차단이 뷰포트별로 갈린다).
 *   ④ 접기는 **전 단계에 함께** 적용된다(단계마다 따로면 스크롤할 때마다 다시 접는다).
 *   ⑤ 노드 지름 계산에 쓰는 --n은 **전 단계가 공유하는 최대 노드 수**여야 한다.
 *      단계마다 자기 노드 수를 넣으면 3칸 섹션이 5칸 섹션보다 큰 동그라미를
 *      받아 단계를 넘길 때마다 아이콘이 커졌다 작아진다(2026-08-06 수정).
 *      최대값이라야 가장 긴 섹션도 넘치지 않는다 — 더 작은 값은 넘침이다.
 *   ⑥ 접기도 **아이콘 크기를 바꾸지 않는다** — ⑤와 같은 이유(출렁임 방지)이고,
 *      축은 다르다: ⑤는 단계 간, ⑥은 같은 단계의 펼침/접힘 간.
 *
 * 레이아웃 자체(스크롤 스냅·한 화면 한 단계·연결선 좌표)는 jsdom에 레이아웃
 * 엔진이 없어 여기서 재지 않는다 — 실브라우저 실측으로 확인한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
// 한국어 문구를 단정하므로 로케일을 제품 기본값(ko)으로 고정한다 — jsdom의
// navigator.language 기본값(en-US)에 좌우되지 않게(i18n.smoke.test.mjs와 같은 관례).
window.localStorage.setItem('weathermind.locale', 'ko');
for (const k of ['HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[k] = window[k];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
// 관측 대상을 기록하는 ResizeObserver 스텁.
// 연결선(StageLine)은 layout effect에서 경로 컨테이너를 잡아 관측한다. 그 시점에
// element가 null이면 선이 영영 안 그려지는데, jsdom은 레이아웃이 없어 좌표로는
// 확인할 수 없다 — **무엇을 관측했는지**로 대신 확인한다.
const observed = [];
class RecordingResizeObserver {
  observe(el) {
    observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = RecordingResizeObserver;
globalThis.ResizeObserver = RecordingResizeObserver;

const { createElement } = await import('react');
const { createRoot } = await import('react-dom/client');

// NODE_ENV=production으로 도는 하네스라 react의 act()를 쓸 수 없다
// (프로덕션 빌드는 act를 지원하지 않는다). 다른 스모크와 같은 관례로
// 렌더 후 매크로태스크 한 틱을 기다린다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mod = await vite.ssrLoadModule('/src/modules/curriculum/PcCurriculumPath.jsx');
const PcCurriculumPath = mod.default;
const { blueEndIndex, stageDoneCount, joinK } = mod;

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures += 1;
};

// ── 픽스처: 실제 시드(units.json) 모양 — 4섹션 3·3·2·4, 앞 3개 완료 ──────────
const SHAPE = [
  ['하늘 읽기', 3],
  ['공기의 힘', 3],
  ['큰 바람', 2],
  ['도시와 기후', 4],
];
let n = 0;
const SUBTITLE = '계절을 지배하는 네 기단과 그 변질';
const sections = SHAPE.map(([name, count], si) => ({
  section: name,
  // 서버 메타(section_meta.json) — 2번 섹션만 채워서 "없으면 안 그린다"도 함께 본다
  subtitle: si === 1 ? SUBTITLE : null,
  est_minutes: si === 1 ? 15 : null,
  topics: si === 1 ? ['시베리아 기단', '북태평양 기단', '기단 변질', '계절풍'] : [],
  units: Array.from({ length: count }, (_, i) => {
    const idx = n++;
    return {
      id: `u${idx}`,
      title: `유닛 ${idx + 1}`,
      concept_tag: i === 0 ? 'air_mass' : 'pressure_front',
      kind: i === count - 1 ? 'board' : 'quiz',
      crowns: idx < 3 ? 1 : 0,
      status: idx < 3 ? 'cleared' : idx === 3 ? 'current' : 'locked',
    };
  }),
}));
const TOTAL = n;

// ── ① 완료 구간이 섹션 경계를 넘는가 (순수 함수) ─────────────────────────────
{
  const statuses = sections.flatMap((s) => s.units.map((u) => u.status));
  const blueTo = blueEndIndex(statuses);
  ok(blueTo === 3, `blueEndIndex: 마지막 완료(2) 다음 칸(3)까지 — 실제 ${blueTo}`);
  ok(stageDoneCount(blueTo, 0, 3) === 3, '1단계(0~2): 3칸 전부 파랑');
  ok(stageDoneCount(blueTo, 3, 3) === 1, '2단계(3~5): 첫 칸이 파랑 — 경계를 넘어 이어진다');
  ok(stageDoneCount(blueTo, 6, 2) === 0, '3단계(6~7): 아직 안 옴');
  ok(blueEndIndex(['current', 'locked']) === -1, '완료 0건이면 파란 길 없음(-1)');
  const allDone = ['cleared', 'cleared'];
  ok(blueEndIndex(allDone) === 1, '전부 완료면 마지막 인덱스에서 멈춘다(넘치지 않음)');

  // 단계 경계에서 길이 튀지 않는가 — **위 단계의 아래꼬리와 아래 단계의 위꼬리가
  // 같은 x를 써야** 한 줄로 이어져 보인다. 각자 자기 노드 x로 뻗던 시절에는
  // 3→4 경계가 185px 어긋났다(실측). 좌표는 jsdom에서 못 재지만, **두 단계가
  // 같은 값을 받는가**는 여기서 지킬 수 있다.
  const stages = [{ units: [1, 2, 3] }, { units: [1, 2, 3] }, { units: [1, 2] }, { units: [1, 2, 3, 4] }];
  for (let i = 0; i < stages.length - 1; i += 1) {
    // 컴포넌트의 **두 호출 지점을 그대로** 흉내 낸다:
    //   위 단계 i   → joinOutK={joinK(stages, i, i + 1)}
    //   아래 단계 i+1 → joinInK ={joinK(stages, (i + 1) - 1, i + 1)}
    // 인덱스를 한 칸 잘못 넘기면 여기서 갈린다(그게 원래 버그의 모양이다).
    const out = joinK(stages, i, i + 1);
    const below = i + 1;
    const into = joinK(stages, below - 1, below);
    ok(out === into, `경계 ${i + 1}→${i + 2}: 두 단계가 같은 값을 쓴다 — ${out} / ${into}`);
  }
  // 순수 함수가 맞아도 **컴포넌트가 인덱스를 한 칸 잘못 넘기면** 다시 어긋난다.
  // 두 호출 지점이 같은 경계를 가리키는지는 소스로 확인한다(계약 테스트 관례).
  const pcSrc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/modules/curriculum/PcCurriculumPath.jsx'),
    'utf-8',
  );
  ok(
    pcSrc.includes('joinInK={joinK(withUnits, i - 1, i)}')
      && pcSrc.includes('joinOutK={joinK(withUnits, i, i + 1)}'),
    '경계 인덱스: 단계 i의 아래꼬리와 i+1의 위꼬리가 같은 쌍(i, i+1)을 가리킨다',
  );

  ok(joinK(stages, -1, 0) === 0, '맨 위 경계는 0 — 뻗을 이웃이 없다');
  ok(joinK(stages, stages.length - 1, stages.length) === 0, '맨 아래 경계는 0');
  // 중간값이 맞는가 — 한쪽 노드 x로 쏠리면 다시 어긋난다
  const mid = joinK([{ units: [1, 2] }, { units: [1, 2, 3, 4] }], 0, 1);
  ok(mid > -1 && mid < 1 && Math.abs(mid) < 0.5,
     `이웃 두 노드의 중간값이다(한쪽으로 쏠리지 않는다) — ${mid.toFixed(3)}`);
}

// ── 실마운트 헬퍼 ───────────────────────────────────────────────────────────
const container = window.document.getElementById('root');
const root2 = createRoot(container);
const opened = [];
async function render(props) {
  root2.render(
    createElement(PcCurriculumPath, {
      sections,
      onOpenUnit: (id) => opened.push(id),
      energyBlocked: false,
      regenMin: 7,
      ...props,
    }),
  );
  await sleep(60);
}
async function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
}

// ── ②③⑤ 기본 렌더 ─────────────────────────────────────────────────────────
await render({});
{
  const stages = [...container.querySelectorAll('.wm-stage')];
  ok(stages.length === 4, `단계 4개 렌더 — 실제 ${stages.length}`);

  const nodes = [...container.querySelectorAll('.wm-dot')];
  ok(nodes.length === TOTAL, `노드 ${TOTAL}개 — 실제 ${nodes.length}`);

  // ② 라벨을 뺀 대신 aria-label이 유닛명을 나른다
  const labelled = nodes.filter((b) => (b.getAttribute('aria-label') ?? '').includes('유닛 '));
  ok(labelled.length === TOTAL, `노드 aria-label 전부에 유닛명 — 실제 ${labelled.length}`);
  ok(
    !container.textContent.includes('유닛 5'),
    '노드 밑에 유닛명 텍스트를 두지 않는다(진도 바의 현재 유닛명은 예외)',
  );

  // 연결선이 경로 컨테이너를 실제로 잡았는가 — **프로덕션에서만 터진 버그의 가드**.
  // 부모의 ref를 받아 쓰면 자식 layout effect 시점에 아직 null이라 관측이 0건이 되고,
  // 개발 모드에서는 StrictMode의 이중 실행이 그걸 가려 준다(실제로 그랬다).
  const vpathObserved = observed.filter((el) => el?.classList?.contains('wm-vpath'));
  ok(vpathObserved.length >= stages.length,
     `단계마다 경로 컨테이너를 관측한다 — 관측 ${vpathObserved.length}건 / 단계 ${stages.length}개`);
  ok(observed.every(Boolean),
     '관측 대상에 null이 섞이지 않는다(부모 ref 미확보 시 null이 들어온다)');

  // 연결선 path 2개는 **항상** DOM에 있어야 한다. 조건부로 붙였다 떼면 그 순간
  // ref가 갈려서, 좌표를 다시 쓸 대상을 잃는다(선이 옛 자리에 굳는다).
  // jsdom은 레이아웃이 없어 d는 빈 값이지만, 요소가 있는지는 여기서 지킨다.
  const linePaths = container.querySelectorAll('.wm-line path');
  ok(linePaths.length === stages.length * 2,
     `단계마다 연결선 path 2개(회색·파랑)를 상시 둔다 — 실제 ${linePaths.length} / 기대 ${stages.length * 2}`);

  // 트랙 높이를 정하는 `--wm-track-top`이 실제로 써지는가.
  // 트랙 위에 붙는 것(게스트 배너·코스 탭·구름 경고)이 상황마다 달라서 상수로 두면
  // 하나만 떠도 페이지가 세로로 넘친다 — 실측: 코스 탭 하나에 1440×900이 37px 넘쳤다.
  // jsdom은 레이아웃이 없어 값은 0px지만, **써졌는지 여부**는 여기서 지킬 수 있다.
  const pcWrap = container.querySelector('.wm-track')?.closest('div[style*="--wm-track-top"]');
  ok(pcWrap, '경로 래퍼가 --wm-track-top을 자기 style에 넣는다(트랙 높이의 유일한 입력)');
  ok(observed.some((el) => el?.contains?.(container.querySelector('.wm-track'))),
     '트랙을 품은 조상을 관측한다 — 위쪽 형제가 나타났다 사라져도 높이를 다시 잡는다');

  // 섹션 메타 — 있으면 그리고, 없으면 그 줄 자체를 만들지 않는다
  ok(container.textContent.includes(SUBTITLE), '메타가 있는 섹션은 부제를 보여준다');
  ok(container.textContent.includes('예상 15분'), '예상 소요시간을 보여준다');
  ok(container.textContent.includes('시베리아 기단'), 'topics를 칩으로 보여준다');
  const stage1 = container.querySelectorAll('.wm-stage')[0];
  ok(!stage1.querySelector('p.truncate'), '메타 없는 섹션은 부제 줄을 만들지 않는다');
  // topics가 없는 섹션은 concept_tag 파생으로 떨어진다(칩이 아예 없으면 안 된다)
  ok(stage1.querySelectorAll('.rounded-full.bg-sky-100').length > 0,
     'topics 없는 섹션은 concept_tag 칩으로 폴백한다');

  // ⑤ --n 은 전 단계가 공유하는 **최대** 노드 수 (픽스처 섹션은 3·3·2·4칸)
  const ns = stages.map((s) => s.querySelector('.wm-vpath').style.getPropertyValue('--n'));
  const counts = stages.map((s) => s.querySelectorAll('[data-wm-node]').length);
  const maxCount = Math.max(...counts);
  ok(
    new Set(ns).size === 1,
    `전 단계가 같은 --n을 쓴다(아이콘 크기 통일) — 실제 ${ns.join(',')}`,
  );
  ok(
    Number(ns[0]) === maxCount,
    `--n이 최대 칸 수와 같다(가장 긴 섹션도 안 넘침) — 칸 수 ${counts.join(',')} · --n ${ns[0]}`,
  );

  // 상태 아이콘: 완료 3 + 현재 1
  ok(nodes.filter((b) => b.textContent.includes('👑')).length === 3, '완료 노드 3개(👑)');
  ok(nodes.filter((b) => b.textContent.includes('⭐')).length === 1, '현재 노드 1개(⭐)');

  // 진도 바 — 노드 라벨을 뺀 만큼 "지금 어디"를 여기서 말한다
  ok(container.textContent.includes(`3 / ${TOTAL} 유닛`), `진도 표기 3 / ${TOTAL} 유닛`);
  ok(container.textContent.includes('공기의 힘'), '진도 바가 현재 섹션명을 보여준다');

  // 잠긴 노드는 눌리지 않는다
  const locked = nodes.filter((b) => b.textContent.includes('🔒'));
  ok(locked.length === TOTAL - 4 && locked.every((b) => b.disabled), '잠금 노드는 전부 disabled');
}

// ── ④ 접기가 전 단계에 함께 적용된다 ────────────────────────────────────────
{
  const chipsBefore = container.querySelectorAll('.wm-stage .rounded-full.bg-sky-100').length;
  ok(chipsBefore > 0, `펼침 상태에서 개념 칩이 보인다 — ${chipsBefore}개`);
  const chromeOpen = container.querySelector('.wm-vpath').style.getPropertyValue('--chrome');
  ok(chromeOpen === '210px', `펼침 상태 --chrome=210px — 실제 ${chromeOpen}`);
  const toggle = container.querySelector('.wm-stage button[aria-expanded]');
  await click(toggle);
  const expandedAll = [...container.querySelectorAll('button[aria-expanded]')].map((b) =>
    b.getAttribute('aria-expanded'),
  );
  ok(expandedAll.every((v) => v === 'false'), `한 번 접으면 전 단계가 접힌다 — ${expandedAll.join(',')}`);
  ok(
    container.querySelectorAll('.wm-stage .rounded-full.bg-sky-100').length === 0,
    '접으면 개념 칩이 전 단계에서 사라진다',
  );
  // 접어도 **아이콘 크기는 그대로**다(2026-08-05 결정). 노드 지름은 --chrome에서
  // 역산하므로, 접기와 연동하면 접을 때마다 아이콘이 커졌다 작아져 화면이 출렁인다.
  const chromeFolded = container.querySelector('.wm-vpath').style.getPropertyValue('--chrome');
  ok(chromeFolded === '210px', `접어도 --chrome 불변(210px) — 실제 ${chromeFolded}`);
  await click(toggle); // 원복
}

// ── ③ 구름 0이면 노드가 잠긴다 (모바일과 같은 의미론) ────────────────────────
{
  await render({ energyBlocked: true });
  const nodes = [...container.querySelectorAll('.wm-dot')];
  ok(nodes.every((b) => b.disabled), '구름 0: 노드 전부 disabled(열린 유닛 포함)');
  const cta = [...container.querySelectorAll('button')].find((b) =>
    b.textContent.includes('이어서 학습하기'),
  );
  ok(cta?.disabled === true, '구름 0: 「이어서 학습하기」도 비활성');
  const energyLabelled = nodes.filter((b) =>
    (b.getAttribute('title') ?? '').includes('7'),
  ).length;
  ok(energyLabelled > 0, '구름 0: 회복 ETA(7분)를 title로 알린다');
}

// ── 클릭이 콜백으로 이어지는가 ──────────────────────────────────────────────
{
  await render({ energyBlocked: false });
  const current = [...container.querySelectorAll('.wm-dot')].find((b) => b.textContent.includes('⭐'));
  await click(current);
  ok(opened.length === 1 && opened[0] === 'u3', `현재 노드 클릭 → onOpenUnit('u3') — 실제 ${opened.join(',')}`);
}

// ── 유닛 0개면 렌더하지 않는다(빈 코스 트리) ────────────────────────────────
{
  root2.render(createElement(PcCurriculumPath, { sections: [], onOpenUnit: () => {} }));
  await sleep(60);
  ok(container.querySelector('.wm-stage') === null, '빈 트리: 아무것도 렌더하지 않는다');
}

await vite.close();
if (failures) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\nOK: 학습 경로(완료 구간 경계·aria 라벨·구름 차단·접기 일괄·노드 수) 스모크 통과');
process.exit(0);

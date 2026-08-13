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
 *   ⑦ 학습 화면이 **홈을 흡수했다**(2026-08-09). 진입 카드(LearnHeroCard)와
 *      출석 POST 소유권이 넘어왔고, 흰 카드를 늘리지 않기로 했다. 여기서는 그중
 *      **소스로만 확인 가능한 것**을 잡는다 — 진입 카드가 실제로 마운트되는지는
 *      home.smoke가 실 XHR로 본다.
 *      (2026-08-08의 ⑦ "PC에서 머리말이 숨지 않는다"는 폐기됐다. 그때는 머리말이
 *      없어 화면 첫 글자가 카드 안쪽 패딩부터 시작하는 것이 문제였고, 지금은
 *      진입 카드·경로 카드가 둘 다 셸 왼쪽 끝에서 시작해 그 증상이 없다.)
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
const { blueEndIndex, stageDoneCount, joinK, PATH_SIZING_FLOOR, PATH_SIZING_CAP, estDaysOf, CHROME } = mod;

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

  // ② 라벨을 뺀 대신 aria-label이 유닛명을 나른다. 2026-08-09 시안으로 눈에
  // 보이는 라벨이 잠깐 돌아왔다가 **2026-08-10 사용자 지시로 다시 뺐다** —
  // 경로가 왼쪽 열로 좁아지면서 라벨이 노드를 밀어냈다.
  const labelled = nodes.filter((b) => (b.getAttribute('aria-label') ?? '').includes('유닛 '));
  ok(labelled.length === TOTAL, `노드 aria-label 전부에 유닛명 — 실제 ${labelled.length}`);
  ok(
    !container.textContent.includes('유닛 5'),
    '노드 옆에 유닛명 텍스트를 두지 않는다(진도 바의 현재 유닛명은 예외)',
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
  // 「예상 N분」은 2026-08-13 클라이언트 지시로 걷었다 — 하루 리듬이 「하루에 유닛
  // 하나」인데 분 단위를 나란히 두면 한 자리에서 두 리듬을 말하는 꼴이었다.
  // 남는 것은 **일수**이고, 기대값은 리터럴이 아니라 소유자(estDaysOf)에서 파생한다.
  ok(!container.textContent.includes('예상 15분'), '예상 **분**은 더 이상 안 보인다');
  ok(
    container.textContent.includes(`예상 ${estDaysOf(sections[1])}일`),
    '예상 **일수**를 보여준다',
  );
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
  ok(chromeOpen === `${CHROME}px`, `펼침 상태 --chrome=${CHROME}px — 실제 ${chromeOpen}`);
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
  ok(chromeFolded === `${CHROME}px`, `접어도 --chrome 불변(${CHROME}px) — 실제 ${chromeFolded}`);
  await click(toggle); // 원복
}

// ── ③ 구름 0이면 노드가 잠긴다 (모바일과 같은 의미론) ────────────────────────
{
  await render({ energyBlocked: true });
  const nodes = [...container.querySelectorAll('.wm-dot')];
  ok(nodes.every((b) => b.disabled), '구름 0: 노드 전부 disabled(열린 유닛 포함)');
  // 2026-08-09: 진도 바의 「이어서 학습하기」 버튼은 **없앴다**(사용자 지시).
  // 그 자리는 스크롤 힌트가 쓴다. 되살리면 같은 목적지로 가는 문이 한 화면에
  // 셋이 된다(배너 CTA · 현재 노드 · 이 버튼) — 구름 0 비활성 처리를 세 곳에
  // 따로 걸어야 했던 것도 그래서였다.
  const revived = [...container.querySelectorAll('button')].find((b) =>
    b.textContent.includes('이어서 학습하기'),
  );
  ok(!revived, '진도 바에 「이어서 학습하기」 버튼이 되살아나지 않았다');
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

// ── ⑧ 동그라미 크기가 **코스마다 같다** + 상한을 넘는 섹션도 노드를 안 잃는다 ──
//
// ⚠️ **계약이 바뀌었다**(2026-08-12). 종전 단정은 「`PATH_SIZING_FLOOR` == 시드의
// 최장 섹션」이었고, `--n`이 "전 코스 통틀어 최장 섹션 칸 수"라는 정의에 기대고
// 있었다. 유닛이 93 → 237개가 되면서 최장 섹션이 4 → **35칸**이 됐고, n이 커질수록
// 지름이 줄어드는 `--dot` 식이 하한(44px)에 걸려 **노드가 서로 겹쳤다**. 그래서
// 크기 기준을 8칸에서 끊는 상한(`PATH_SIZING_CAP`)이 들어왔고, 그 순간 종전 단정은
// **영원히 어긋나는 식**이 됐다(시드 35 ≠ 상한 8). 시드를 그대로 따라가는 것 자체가
// 목적이었던 적은 없으므로, 원래 지키려던 두 가지로 고쳐 적는다:
//   ㉠ **크기가 코스마다 같다** — 코스를 옮길 때 아이콘이 커졌다 작아지지 않는다.
//      (바닥값과 상한이 둘 다 존재하는 이유가 이것이다.)
//   ㉡ **상한을 넘는 섹션도 노드를 잃지 않는다** — 8칸 상한은 *크기* 기준일 뿐,
//      35칸 섹션은 35개를 다 그린다.
// ⚠️ jsdom에는 레이아웃이 없어 "실제로 스크롤되는가"(px)는 **여기서 못 잰다** —
//    scrollHeight·clientHeight가 전부 0이다. 그래서 ㉡은 노드 수와 `--n`으로
//    구조를 단정한다(넘침의 시각적 처리는 브라우저 확인 몫으로 남는다).
{
  const seed = JSON.parse(readFileSync(resolve(root, '../database/seed/units.json'), 'utf8'));
  const perSection = new Map();
  for (const u of seed) {
    const key = `${u.course ?? 'weather'}\u0000${u.section}`;
    perSection.set(key, (perSection.get(key) ?? 0) + 1);
  }
  const longestOf = (course) =>
    Math.max(...[...perSection].filter(([k]) => k.startsWith(`${course} `)).map(([, v]) => v));

  // 바닥값·상한의 관계 — 상한이 바닥값보다 작아지면 두 상수가 서로를 무효화한다.
  ok(
    PATH_SIZING_FLOOR <= PATH_SIZING_CAP,
    `바닥값 ≤ 상한 — 바닥 ${PATH_SIZING_FLOOR} · 상한 ${PATH_SIZING_CAP}`,
  );

  const mk = (name, count) => ({
    section: name,
    units: Array.from({ length: count }, (_, i) => ({
      id: `${name}-${i}`, title: `u${i}`, status: i === 0 ? 'current' : 'locked',
    })),
  });
  const nOf = async (count) => {
    root2.render(createElement(PcCurriculumPath, { sections: [mk('S', count)], onOpenUnit: () => {} }));
    await sleep(60);
    return container.querySelector('.wm-vpath')?.style.getPropertyValue('--n');
  };

  // ㉠ 시드의 두 코스를 실제 칸 수로 세워 --n을 대조한다.
  const nWeather = await nOf(longestOf('weather'));
  const nBasic = await nOf(longestOf('basic-science'));
  ok(
    String(nWeather) === String(nBasic),
    `코스가 달라도 --n이 같다 — weather ${nWeather}(최장 ${longestOf('weather')}칸) · ` +
      `basic-science ${nBasic}(최장 ${longestOf('basic-science')}칸)`,
  );
  ok(
    String(nWeather) === String(PATH_SIZING_CAP),
    `시드 최장 섹션이 상한을 넘으므로 --n은 상한에서 끊긴다 — ${nWeather} / 상한 ${PATH_SIZING_CAP}`,
  );

  // 바닥값이 실제로 걸리는가: 상한보다 짧은 코스(3칸)도 바닥값을 받는다.
  ok(String(await nOf(3)) === String(PATH_SIZING_FLOOR),
    `3칸 코스도 --n=${PATH_SIZING_FLOOR}을 받는다(코스 간 크기 통일)`);

  // ㉡ 상한을 넘는 섹션이 노드를 잃지 않는다 — 크기는 8칸 기준, 노드는 전건.
  const longest = Math.max(...perSection.values());
  root2.render(createElement(PcCurriculumPath, { sections: [mk('L', longest)], onOpenUnit: () => {} }));
  await sleep(60);
  const drawn = container.querySelectorAll('[data-wm-node]').length;
  ok(drawn === longest, `최장 섹션(${longest}칸)의 노드를 전건 그린다 — 실제 ${drawn}`);
  ok(
    String(container.querySelector('.wm-vpath')?.style.getPropertyValue('--n')) ===
      String(PATH_SIZING_CAP),
    `${longest}칸이어도 크기 기준은 상한 ${PATH_SIZING_CAP}에서 멈춘다(겹침 방지)`,
  );
}

// ── ⑧-2 예상 **일수**가 화면에 뜬다 (2026-08-12 클라이언트 요구 ⑴) ──────────
// 「며칠」의 정의는 클라이언트 판정 대기라 **값이 아니라 배선**을 지킨다:
// 기준 스위치(EST_DAYS_BASIS)를 갈아끼우면 화면 숫자가 그대로 따라간다는 것.
// 문구가 아니라 data 속성을 본다 — 새 i18n 키가 아직 리소스에 없다(담당 J 소유).
{
  const s3 = {
    section: '열과 빛',
    est_minutes: 40,
    // ⚠️ 소요 표기는 「이 단계에서 배우는 것」 줄 안에 있고, 그 줄은 **칩이 하나라도
    // 있을 때만** 그려진다(기존 계약). 시드의 13섹션은 전건 topics를 갖고 있어
    // 실데이터에서는 늘 그려지지만, 픽스처가 칩을 비우면 소요·일수가 통째로 사라진다.
    topics: ['온도와 열'],
    units: Array.from({ length: 3 }, (_, i) => ({
      id: `d${i}`, title: `u${i}`, status: i === 0 ? 'current' : 'locked',
    })),
  };
  root2.render(createElement(PcCurriculumPath, { sections: [s3], onOpenUnit: () => {} }));
  await sleep(60);
  const badge = container.querySelector('[data-est-days]');
  ok(badge != null, '예상 일수 배지가 화면에 있다');
  ok(
    badge?.getAttribute('data-est-days') === String(estDaysOf(s3)),
    `배지 값이 estDaysOf와 같다 — 화면 ${badge?.getAttribute('data-est-days')} · 함수 ${estDaysOf(s3)}`,
  );
  ok(/\d+일/.test(badge?.textContent ?? ''), `사람이 읽는 문구에도 일수가 있다 — "${badge?.textContent}"`);

  // 기준 셋이 각각 무엇을 내는가 — 판정이 어디로 가든 산식이 살아 있는지 본다.
  ok(estDaysOf(s3, 'unitsPerDay') === 3, `unitsPerDay = 유닛 수 — ${estDaysOf(s3, 'unitsPerDay')}`);
  ok(estDaysOf(s3, 'minutesPerDay') === 4, `minutesPerDay = ceil(40/10) — ${estDaysOf(s3, 'minutesPerDay')}`);
  ok(estDaysOf(s3, 'itemsPerDay') === 2, `itemsPerDay = ceil(3×4/10) — ${estDaysOf(s3, 'itemsPerDay')}`);

  // 근거가 없으면 아무것도 그리지 않는다(est_minutes 관례와 같다)
  ok(estDaysOf({ units: [] }) === null, '유닛 0이면 일수 없음(null)');
  root2.render(createElement(PcCurriculumPath, {
    sections: [{ section: '빈', units: [] }], onOpenUnit: () => {},
  }));
  await sleep(60);
  ok(container.querySelector('[data-est-days]') === null, '근거가 없으면 일수 배지를 안 그린다');
}

// ── ⑦ 학습 화면이 홈을 흡수했다 (소스 계약) ────────────────────────────────
{
  const home = readFileSync(resolve(root, 'src/modules/curriculum/CurriculumHome.jsx'), 'utf8');

  // 출석 POST의 소유자 — 홈이 사라졌으므로 이 화면이 만들지 않으면 앱 어디서도
  // 만들지 않는다(세션 러너는 세션에 들어가야 돈다). 스트릭이 영영 안 오른다.
  ok(home.includes('useAttendance(true)'), '학습 화면이 출석 POST를 소유한다(useAttendance)');

  // 진입 배너는 **한 번만** 마운트한다(2026-08-09 시안 = 얇은 가로 배너).
  // 세로 레일이던 시절에는 레일·모바일에 하나씩 두 번 걸었는데, 가로 배너는
  // 두 폭에서 같은 자리라 두 벌이면 화면에 배너가 둘 뜬다.
  const heroMounts = (home.match(/<LearnHeroCard/g) ?? []).length;
  ok(heroMounts === 1, `진입 배너 마운트 1곳 — 실제 ${heroMounts}`);
  ok(!/rail=\{/.test(home), '경로에 레일을 넘기지 않는다(트랙이 폭 전체를 쓴다)');
  const path = readFileSync(resolve(root, 'src/modules/curriculum/PcCurriculumPath.jsx'), 'utf8');
  ok(!path.includes('rail'), '경로 뷰에 레일 잔재가 없다');

  // 페이지 머리말은 없다 — 같은 설명을 배너 부제가 말한다. 두 벌이면 세로만 먹는다.
  ok(!home.includes("t('curriculum.title')"), '페이지 머리말이 되살아나지 않았다');
  const hero = readFileSync(resolve(root, 'src/modules/curriculum/LearnHeroCard.jsx'), 'utf8');
  ok(hero.includes("t('curriculum.subtitle')"), '학습 설명을 배너가 부제로 말한다');

  // 복습·자유 세션·리그는 **경로 아래 3카드**가 소유한다(시안). 배너가 얇아지면서
  // 배너 안에 넣을 자리가 없어졌다 — 배너로 되돌리면 배너가 다시 두꺼워진다.
  ok(home.includes('<LearnFooterCards'), '경로 아래 3카드를 마운트한다');
  const footer = readFileSync(resolve(root, 'src/modules/curriculum/LearnFooterCards.jsx'), 'utf8');
  ok(footer.includes('variant="tile"'), '복습 큐를 하단 카드가 마운트한다');
  ok(
    !hero.includes('<ReviewQueueCard') && !hero.includes('RegionPicker'),
    '배너는 얇게 유지한다 — 복습·지역을 다시 안으로 들이지 않는다',
  );

  // 2026-08-10: 복습·자유 세션이 **오른쪽 세로 열**로 가면서 트랙 밑이 다시
  // 비었다. 그래서 `--wm-track-tail`은 재지 않고 index.css 기본값(32px)에 맡긴다 —
  // 재던 코드를 남겨 두면 **옆 열의 높이를 아래 여백으로 오해**해 트랙이 그만큼
  // 짧아진다. 트랙 밑에 무언가 다시 붙는 날에는 이 단정부터 뒤집을 것.
  // ⚠️ 문자열 등장 여부가 아니라 **쓰는지**를 본다 — 왜 안 재는지 설명한 주석에도
  // 이름이 나오는데, 그것까지 실패로 잡으면 근거를 지워야 통과하는 가드가 된다.
  ok(
    !/setProperty\(\s*'--wm-track-tail'/.test(path),
    '트랙 밑이 비었으므로 tail을 재지 않는다(옆 열 높이를 아래 여백으로 오해한다)',
  );

  // 사슬은 트랙 **위에 붙는다**(2026-08-11 사용자 제보: "섹션을 넘길 때 배치가
  // 일정하지 않다"). 가운데 정렬이면 블록이 칸 수만큼 커졌다 줄었다 하면서 첫
  // 노드의 y가 섹션마다 달라진다 — 실제 코스에서 공기의 힘(3칸) → 큰 바람(2칸)에
  // 51px, 다음 도시와 기후(4칸)에서 다시 102px 튄다.
  // jsdom에는 레이아웃 엔진이 없어 픽셀로는 못 잡는다. 선언으로 고정한다.
  const css = readFileSync(resolve(root, 'src/styles/index.css'), 'utf8');
  const vpath = css.slice(css.indexOf('.wm-vpath {'), css.indexOf('.wm-node {'));
  ok(
    /justify-content:\s*flex-start/.test(vpath),
    '.wm-vpath가 위로 붙지 않는다 — 섹션마다 첫 노드 y가 달라져 길이 튄다',
  );
  ok(
    !/justify-content:\s*center/.test(vpath),
    '.wm-vpath에 center가 되살아났다(같은 회귀)',
  );

  // 배너가 **보고 있는 섹션**을 따라간다(2026-08-10 사용자 지시).
  // ⚠️ 제목만 따라가면 "3섹션 제목 + 1섹션으로 가는 버튼"이 된다 — 목적지를 함께
  // 내는 `pickSectionEntry`를 쓰는지, 잠긴 섹션에서 CTA를 막는지까지 본다.
  ok(
    path.includes('onViewSection') && home.includes('onViewSection={setViewedIdx}'),
    '경로가 보고 있는 단계를 배너로 올린다',
  );
  ok(
    home.includes('pickSectionEntry(viewedSection)') && home.includes('lockedNote='),
    '배너가 그 섹션의 목적지까지 함께 받는다(제목만 바꾸지 않는다)',
  );
  const heroSrc = readFileSync(resolve(root, 'src/modules/curriculum/LearnHeroCard.jsx'), 'utf8');
  ok(
    /ctaBlocked\s*=\s*\n?\s*Boolean\(lockedNote\)/.test(heroSrc),
    '잠긴 섹션을 보고 있으면 CTA가 막힌다(눌러도 서버가 403으로 막는다)',
  );
  // 'daily'·'done'은 §2.5 우선순위 메시지라 스크롤로 덮으면 안 된다 —
  // 전 유닛을 깬 사람이 경로를 훑었다고 「오늘의 세션 풀기」가 사라지면 안 된다.
  ok(
    home.includes("entry.kind === 'unit' && viewedSection !== null"),
    "따라가기는 진입 종류가 'unit'일 때만 — 오늘 몫·완료 축하는 덮지 않는다",
  );
  // 3열 배치 — 진입 카드(왼쪽) · 경로(가운데) · 카드 2장(오른쪽).
  ok(
    /md:flex\b/.test(home) && home.includes('<LearnFooterCards'),
    '학습 화면이 진입 카드·경로·오른쪽 열을 한 행으로 세운다',
  );
  // 카드 바깥이 <Link>로 되돌아가면 안 된다 — 복습 링크가 안에 있어 `<a>` 중첩이 된다.
  ok(
    !/<Link\s+[^>]*data-testid="learn-entry"/.test(hero),
    '진입 카드 바깥은 Link가 아니다(a 중첩 방지)',
  );

  // 사이드바 튜터와 진입 카드가 같은 화면에서 겹치지 않는다.
  const side = readFileSync(resolve(root, 'src/components/SideNav.jsx'), 'utf8');
  // 2026-08-09 코드 리뷰: 종전 식은 `pathname === '/learn'`이라 **`/learn/`에서
  // 뚫렸다** — 라우터는 같은 화면을 그리는데 튜터와 배너 마스코트가 함께 떴다.
  // 끝의 슬래시를 떼고 비교하는지를 본다(문자열 그대로가 아니라 정규화 여부).
  //
  // 2026-08-11: 배너를 가진 화면이 둘이 되면서(보드에 태양이 배너가 생겼다)
  // 식이 목록 검사로 바뀌었다. **표현식 원문을 통째로 단정하지 않는다** —
  // 그러면 목록에 화면 하나 더 넣는 리팩터링마다 이 가드가 터진다. 지키려는
  // 것은 ① 슬래시를 정규화하고 ② 배너 있는 화면이 목록에 들어 있다는 것뿐이다.
  const heroPaths = side.match(/HERO_PATHS\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
  ok(
    /hideTutor\s*=\s*HERO_PATHS\.includes\(pathname\.replace\(/.test(side),
    '사이드바 튜터 접기가 끝 슬래시를 떼고 목록과 비교한다',
  );
  ok(
    heroPaths.includes("'/learn'") && heroPaths.includes("'/board'"),
    `배너가 있는 화면이 접기 목록에 다 있다 — 실제 [${heroPaths.trim()}]`,
  );

  // 화자는 물방울이 — 사이드바 TUTOR_BY_PATH(/learn → drop)와 같은 값이어야 한다.
  const entry = readFileSync(resolve(root, 'src/modules/curriculum/learnEntry.js'), 'utf8');
  ok(/unit:\s*'drop'/.test(entry), '진입 카드 화자가 물방울이(drop)다');
}

await vite.close();
if (failures) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\nOK: 학습 경로(완료 구간 경계·aria 라벨·구름 차단·접기 일괄·노드 수) 스모크 통과');
process.exit(0);

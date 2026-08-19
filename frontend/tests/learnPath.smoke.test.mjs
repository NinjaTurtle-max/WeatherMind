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
 *   ⑤ 노드 치수는 **고정 px**이고 소유자가 하나다(2026-08-13 클라이언트 지시로
 *      교체). 종전 ⑤는 "--n은 전 단계가 공유하는 최대 노드 수"였다 — 지름을
 *      뷰포트 높이에 n칸을 욱여넣어 구하던 시절, 섹션마다 크기가 달라지는 것을
 *      막는 보정이었다. 그 계산을 걷었으므로 지킬 것이 바뀐다:
 *        ㉮ 시각 지름이 **선행 학습 앱 실측 스케일 ±20%**(2026-08-13 교체 —
 *           종전 "24~36px(마우스 포인터 하나~하나 반)"은 지름이 44~86px 가변으로
 *           **겹치던** 시점의 지시였고, 클라이언트가 그 32px 결과를 보고 "부자연스럽다
 *           → 참고 앱을 봐라 → 전혀 반영이 안 됐다"를 연속으로 내며 대체됐다)
 *        ㉯ **클릭 표적은 44×44 이상**(WCAG 2.5.5) — 시각 크기와 분리된다
 *        ㉰ 세로 피치(지름+간격) ≥ 클릭 표적. 좁으면 표적이 겹쳐 엉뚱한 유닛이 열린다
 *        ㉱ 치수를 뷰포트에서 역산하지 않는다(cqh·--n·--chrome 부활 금지)
 *        ㉲ **진폭/피치 ≤ 0.9** — 길이 옆으로 눕지 않는다(종전 1.93)
 *        ㉳ **연결선을 렌더하지 않는다** — 진도는 노드 상태가 나른다
 *   ⑥ 접기도 **아이콘 크기를 바꾸지 않는다** — 축은 같은 단계의 펼침/접힘 간.
 *      이제는 고정값이라 구조적으로 성립하지만, 되살아나는 경로(높이 역산)를 막는
 *      가드로 단정은 남긴다.
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
const {
  blueEndIndex, stageDoneCount, joinK, estDaysOf, curvePath,
  PATH_DOT_PX, PATH_GAP_PX, PATH_AMP_PX, PATH_HIT_PX, PATH_WAVE_PERIOD, PATH_LINE_PX,
  PATH_ICON_RATIO,
  alignScrollTop, hasMoreBelow,
} = mod;

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
  // ⚠️ 여기 있던 **JSX 배선 단정**(`joinInK={joinK(withUnits, i - 1, i)}`)은 걷었다
  // (2026-08-13): 연결선을 마운트하지 않게 되면서 꼬리도, 그 꼬리를 잇는 배선도
  // 없어졌다. `joinK` 자체는 export로 남아 있고 **순수 함수 단정은 그대로 둔다** —
  // 선을 되살리는 날 이 계약이 먼저 필요해지기 때문이다(경위: StageLine 주석).
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
// 섹션 i를 펼친다(이미 펼쳐져 있으면 아무것도 안 누른다). 접힌 줄 **자체가**
// 전환 버튼이라는 것이 2026-08-13 확정 사항이라, 여기서도 그 줄을 누른다.
async function openSectionRow(i) {
  const row = container.querySelector(`[data-wm-collapsed][aria-controls="wm-stage-${i}"]`);
  if (row) await click(row);
  return container.querySelector('.wm-stage');
}

// ── ②③⑤ 기본 렌더 ─────────────────────────────────────────────────────────
await render({});
{
  // ⚠️ **「단계 4개 렌더」는 걷었다**(2026-08-13 클라이언트 확정 — 한 번에 한
  //    섹션만 펼친다). 전 섹션을 펼치면 콘텐츠가 12,836px(1470×745 실측)이 되고,
  //    그 길이가 스크롤 스냅을 불렀고 스냅이 상위 섹션을 못 가게 만들었다.
  const stages = [...container.querySelectorAll('.wm-stage')];
  const rows = [...container.querySelectorAll('[data-wm-collapsed]')];
  ok(stages.length === 1, `펼친 단계는 언제나 1개 — 실제 ${stages.length}`);
  ok(
    rows.length === sections.length - 1,
    `나머지 섹션은 접힌 줄 — ${sections.length - 1} / 실제 ${rows.length}`,
  );
  // 접힌 줄이 `.wm-stage`를 쓰면 그 클래스의 `min-height: 100%` 때문에 **한 줄이
  // 트랙 한 화면(1470×745 실측 641px)으로 부푼다** — 접는 의미가 통째로 사라진다.
  ok(
    rows.every((r) => !r.classList.contains('wm-stage')),
    '접힌 줄은 .wm-stage를 쓰지 않는다(min-height:100%가 한 줄을 한 화면으로 부풀린다)',
  );
  // 접힌 줄 **자체가** 전환 버튼이다 — 섹션 전환에 새 조작 표면을 만들지 않는다
  // (카드 맨 위 코스 탭이 이미 「탭 꼴」을 쓰고 있어 두 번째 탭 줄이 생긴다).
  ok(
    rows.every((r) => r.tagName === 'BUTTON' && r.getAttribute('aria-expanded') === 'false'),
    '접힌 줄은 aria-expanded=false인 button이다(줄 전체가 표적)',
  );
  // 첫 진입에 펼치는 것은 **현재 유닛이 있는 섹션**이다(픽스처: u3 = 2섹션).
  const OPEN_I = 1;
  ok(
    stages[0].textContent.includes(SHAPE[OPEN_I][0]),
    `첫 진입은 현재 유닛이 있는 섹션을 펼친다 — 실제 "${stages[0].textContent.slice(0, 14)}"`,
  );

  const OPEN_N = sections[OPEN_I].units.length;
  const nodes = [...container.querySelectorAll('.wm-dot')];
  ok(nodes.length === OPEN_N, `펼친 섹션의 노드만 그린다 — ${OPEN_N} / 실제 ${nodes.length}`);

  // ② 라벨을 뺀 대신 aria-label이 유닛명을 나른다. 2026-08-09 시안으로 눈에
  // 보이는 라벨이 잠깐 돌아왔다가 **2026-08-10 사용자 지시로 다시 뺐다** —
  // 경로가 왼쪽 열로 좁아지면서 라벨이 노드를 밀어냈다.
  const labelled = nodes.filter((b) => (b.getAttribute('aria-label') ?? '').includes('유닛 '));
  ok(labelled.length === OPEN_N, `노드 aria-label 전부에 유닛명 — 실제 ${labelled.length}`);
  ok(
    !container.textContent.includes('유닛 5'),
    '노드 옆에 유닛명 텍스트를 두지 않는다(진도 바의 현재 유닛명은 예외)',
  );

  // ⓐ 연결선을 **그리지 않는다**(2026-08-13). 선행 학습 앱은 길을 아예 안 그리고
  // 노드 상태(👑·⭐·🔒)로만 진도를 말한다 — 실측표는
  // `docs/Observation_Report_02_Benchmarking.md` §4.6가 소유한다.
  // ⚠️ 여기 있던 두 단정(「단계마다 .wm-vpath를 관측한다」·「path 2개를 상시 둔다」)은
  // 전부 **연결선이 있을 때만 뜻이 있던 것**이라 함께 걷었다. StageLine이 유일한
  // .wm-vpath 관측자였다. 트랙 조상 관측 단정(아래)은 wrapRef 몫이라 그대로 남는다.
  ok(
    container.querySelectorAll('.wm-line').length === 0
      && container.querySelectorAll('.wm-line path').length === 0,
    `연결선을 렌더하지 않는다 — .wm-line ${container.querySelectorAll('.wm-line').length}개`,
  );
  ok(observed.every(Boolean),
     '관측 대상에 null이 섞이지 않는다(부모 ref 미확보 시 null이 들어온다)');

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
  // ⚠️ 「메타 없는 섹션은 부제 줄을 안 만든다」·「topics 없으면 concept_tag 폴백」
  //    두 단정은 **아래 아코디언 블록으로 옮겼다** — 그 둘은 메타가 없는 1섹션을
  //    봐야 하는데, 첫 진입에 펼쳐지는 것은 현재 유닛이 있는 2섹션이다.

  // ⑤ 치수는 어느 섹션을 펼쳐도 **같은 고정 px**이다 (픽스처 섹션은 3·3·2·4칸)
  // ⚠️ 종전에는 한 화면에 있던 4단계를 map으로 훑었다. 한 번에 하나만 펼치므로
  //    **차례로 펼쳐 가며** 모은다 — 단정의 뜻("칸 수가 크기를 못 건드린다")은 같다.
  const dots = [];
  const counts = [];
  for (let i = 0; i < sections.length; i += 1) {
    const st = await openSectionRow(i);
    dots.push(st.querySelector('.wm-vpath').style.getPropertyValue('--dot'));
    counts.push(st.querySelectorAll('[data-wm-node]').length);
  }
  ok(
    new Set(dots).size === 1 && dots[0] === `${PATH_DOT_PX}px`,
    `칸 수가 달라도(${counts.join(',')}) --dot이 같다 — 실제 ${dots.join(',')}`,
  );
  ok(
    counts.join(',') === SHAPE.map(([, c]) => c).join(','),
    `펼친 섹션마다 자기 칸 수를 전건 그린다 — ${counts.join(',')}`,
  );
  // 종전 `--n`·`--chrome`은 지름을 뷰포트 높이에서 역산할 때만 필요했다. 되살아나면
  // 「섹션마다 범위 맞추기」 보정도 함께 돌아온다.
  const vpNow = container.querySelector('.wm-vpath');
  ok(
    !vpNow.style.getPropertyValue('--n') && !vpNow.style.getPropertyValue('--chrome'),
    '높이 역산용 --n/--chrome이 되살아나지 않았다',
  );

  // 상태 아이콘 — 완료(👑)는 1섹션, 현재(⭐)는 2섹션에 있다. 한 번에 한 섹션만
  // 보이므로 **각자 자기 섹션을 펼쳐 놓고** 센다.
  const stage0 = await openSectionRow(0);
  ok(
    [...stage0.querySelectorAll('.wm-dot')].filter((b) => b.textContent.includes('👑')).length === 3,
    '1섹션을 펼치면 완료 노드 3개(👑)',
  );
  // 메타가 없는 섹션이 여기다 — 위에서 옮겨 온 두 단정.
  ok(!stage0.querySelector('p.truncate'), '메타 없는 섹션은 부제 줄을 만들지 않는다');
  ok(
    stage0.querySelectorAll('.rounded-full.bg-sky-100').length > 0,
    'topics 없는 섹션은 concept_tag 칩으로 폴백한다',
  );
  const stageOpen = await openSectionRow(OPEN_I); // 뒤 블록이 기대하는 기본 상태로 원복
  ok(
    [...stageOpen.querySelectorAll('.wm-dot')].filter((b) => b.textContent.includes('⭐')).length === 1,
    '2섹션을 펼치면 현재 노드 1개(⭐)',
  );

  // 진도 바 — 노드 라벨을 뺀 만큼 "지금 어디"를 여기서 말한다
  ok(container.textContent.includes(`3 / ${TOTAL} 유닛`), `진도 표기 3 / ${TOTAL} 유닛`);
  ok(container.textContent.includes('공기의 힘'), '진도 바가 현재 섹션명을 보여준다');

  // 잠긴 노드는 눌리지 않는다 — 선행 잠금이 **클릭 차단까지** 가는지 본다.
  // 모바일 UnitNode와 같은 의미론이어야 한다(안 넘기면 구름 0에서 PC만 열린다).
  //
  // ⚠️ **뜻이 사라진 게 아니라 스코프만 바뀌었다**(2026-08-13). 한 번에 한 섹션만
  //    마운트되면서 잠긴 노드 8개가 한 화면에 같이 있지 않게 됐을 뿐, "잠긴 노드는
  //    disabled다"라는 계약 자체는 그대로다. 종전 한 줄은 사실 **두 가지**를 재고
  //    있었다 — ⓐ 잠긴 것이 전부 disabled인가(계약) ⓑ 픽스처에 잠금이 8개인가
  //    (모양 확인). 둘 다 살리려고 **섹션을 차례로 펼쳐 가며 합산**한다.
  //    약화가 아니라 오히려 촘촘해졌다: 이제 **섹션마다** 자기 잠금 노드를 제대로
  //    그리는지까지 본다(종전에는 어느 섹션 것인지 구분 없이 8개만 셌다).
  //    ⓑ를 빼고 ⓐ만 남기면 "잠긴 노드를 아예 안 그려도 통과"가 되므로 빼지 않는다.
  let lockedSeen = 0;
  let lockedEnabled = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const st = await openSectionRow(i);
    const here = [...st.querySelectorAll('.wm-dot')].filter((b) => b.textContent.includes('🔒'));
    lockedSeen += here.length;
    lockedEnabled += here.filter((b) => !b.disabled).length;
  }
  ok(
    lockedSeen === TOTAL - 4 && lockedEnabled === 0,
    `잠금 노드는 전부 disabled — 잠금 ${lockedSeen}개(기대 ${TOTAL - 4}) · 안 잠긴 것 ${lockedEnabled}개`,
  );
  await openSectionRow(OPEN_I); // 뒤 블록(⭐ 클릭·구름 0)이 기대하는 기본 상태로 원복
}

// ── ④ 접기가 전 단계에 함께 적용된다 ────────────────────────────────────────
{
  const chipsBefore = container.querySelectorAll('.wm-stage .rounded-full.bg-sky-100').length;
  ok(chipsBefore > 0, `펼침 상태에서 개념 칩이 보인다 — ${chipsBefore}개`);
  const dotOpen = container.querySelector('.wm-vpath').style.getPropertyValue('--dot');
  ok(dotOpen === `${PATH_DOT_PX}px`, `펼침 상태 --dot=${PATH_DOT_PX}px — 실제 ${dotOpen}`);
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
  // 접어도 **아이콘 크기는 그대로**다(2026-08-05 결정). 종전에는 지름을 --chrome
  // (머리말·칩 높이)에서 역산했기 때문에 이 단정이 실제로 위험을 막고 있었다.
  // 고정값이 된 지금은 구조적으로 성립하지만, 역산으로 되돌아가면 여기가 먼저 운다.
  const dotFolded = container.querySelector('.wm-vpath').style.getPropertyValue('--dot');
  ok(dotFolded === `${PATH_DOT_PX}px`, `접어도 --dot 불변(${PATH_DOT_PX}px) — 실제 ${dotFolded}`);
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

// ── ⑩ 섹션 전환 = 접힌 줄 클릭 · 배너는 **펼침 인덱스**를 따라간다 (2026-08-13) ─
{
  // 스크롤 위치에서 섹션을 되짚던 `syncViewed`는 걷혔다 — 한 번에 한 섹션만
  // 펼치므로 「보고 있는 섹션」이 「펼친 섹션」 그 자체가 됐다.
  // ⚠️ 이 단정이 **jsdom에서 가능해진 것 자체가 그 변화의 증거**다: 종전 식은
  //    scrollTop·offsetTop을 읽었는데 jsdom에는 레이아웃이 없어 전부 0이라,
  //    「배너가 3섹션을 가리킨다」를 여기서 만들 방법이 아예 없었다.
  root2.render(createElement('div')); // 펼침 인덱스는 state다 — 강제 언마운트로 초기화
  await sleep(30);
  const viewed = [];
  await render({ onViewSection: (i) => viewed.push(i) });
  ok(viewed.at(-1) === 1, `첫 진입은 현재 유닛의 섹션(1)을 올린다 — 실제 [${viewed.join(',')}]`);

  const row3 = container.querySelector('[data-wm-collapsed][aria-controls="wm-stage-3"]');
  ok(row3, '4섹션이 접힌 줄로 서 있다(펼친 것 하나 말고는 전부 줄이다)');
  await click(row3);
  ok(viewed.at(-1) === 3, `접힌 줄을 누르면 그 섹션을 배너로 올린다 — 실제 [${viewed.join(',')}]`);
  const nowStages = [...container.querySelectorAll('.wm-stage')];
  ok(
    nowStages.length === 1 && nowStages[0].textContent.includes(SHAPE[3][0]),
    `누른 섹션만 펼쳐진다(앞 섹션은 접힌다) — 단계 ${nowStages.length}개`,
  );
  ok(
    container.querySelectorAll('.wm-dot').length === SHAPE[3][1],
    `펼친 섹션의 칸 수만 그린다 — ${SHAPE[3][1]} / 실제 ${container.querySelectorAll('.wm-dot').length}`,
  );
  // 앞 섹션이 접힌 줄로 **돌아왔는가** — 펼침이 누적되면(인덱스가 아니라 집합이
  // 되면) 여기가 먼저 운다. 그게 「전 섹션이 펼쳐진다」 변이의 모양이다.
  ok(
    container.querySelectorAll('[data-wm-collapsed]').length === sections.length - 1,
    `펼친 하나를 뺀 나머지는 접힌 줄이다 — ${sections.length - 1} / 실제 ${container.querySelectorAll('[data-wm-collapsed]').length}`,
  );
}

// ── ㉶ 코스 전환: 눌러 둔 펼침 인덱스를 다음 코스로 들고 가지 않는다 ─────────
//
// `CurriculumHome`은 `PcCurriculumPath`를 **`key` 없이** 마운트하고 코스 탭
// (`CourseSwitcher`)을 `tabs` prop으로 **그 안에** 넣는다. 그래서 코스를 바꿔도
// 리마운트가 일어나지 않고 `sections`만 갈린다 — 눌러 둔 펼침 인덱스가 살아남는다.
//
// ⚠️ **범위 클램프(`Math.min(openIdx, len-1)`)로는 못 막는다.** 그것은 인덱스가
//    범위를 벗어날 때만 발화하는데, 벗어나든 안 벗어나든 **다른 코스의 인덱스**는
//    이미 틀린 값이다. 기상(4섹션)에서 4섹션을 펼쳐 두고 2섹션짜리 코스로 넘어가면
//    `min(3, 1) = 1`이라 **엉뚱하게 마지막 섹션**이 펼쳐졌고, 그 인덱스가
//    `onViewSection`으로 올라가 배너 제목·CTA까지 잠긴 섹션을 가리켰다.
//    (2026-08-13 `/code-review` 게이트 지적. 고치기 전에는 이 파일 어느 단정도
//     이 사고를 보지 못했다 — 수정 전후로 전 종목이 초록이었다.)
{
  root2.render(createElement('div')); // 펼침 인덱스는 state다 — 강제 언마운트로 초기화
  await sleep(30);
  const viewed = [];
  await render({ onViewSection: (i) => viewed.push(i) });

  const row3 = container.querySelector('[data-wm-collapsed][aria-controls="wm-stage-3"]');
  await click(row3);
  ok(viewed.at(-1) === 3, `전제: 4섹션을 펼쳐 뒀다 — 실제 [${viewed.join(',')}]`);

  // 접힌 줄을 누르면 그 줄이 **언마운트**된다(그 자리를 `<Stage>`가 대신한다).
  // React는 포커스를 옮겨 주지 않으므로 그냥 두면 `document.activeElement`가
  // `<body>`로 떨어져, 키보드로 4섹션까지 내려온 사용자가 문서 맨 처음으로 되돌아간다.
  ok(
    window.document.activeElement === container.querySelector('.wm-stage'),
    '펼친 직후 포커스가 새 패널로 옮겨간다(누른 줄이 사라지며 body로 떨어지지 않는다)',
  );

  // 같은 인스턴스에 **다른 코스**를 넘긴다 — 리마운트 없이 prop만 갈리는 실제 경로.
  const other = ['기초과학 하나', '기초과학 둘'].map((name, si) => ({
    section: name,
    subtitle: null,
    est_minutes: null,
    topics: [],
    units: [
      {
        id: `b${si}`,
        title: `기초 유닛 ${si + 1}`,
        concept_tag: 'air_mass',
        kind: 'quiz',
        crowns: 0,
        status: si === 0 ? 'current' : 'locked',
      },
    ],
  }));
  root2.render(
    createElement(PcCurriculumPath, {
      sections: other,
      onOpenUnit: () => {},
      onViewSection: (i) => viewed.push(i),
    }),
  );
  await sleep(60);

  const switched = container.querySelector('.wm-stage');
  ok(
    switched?.textContent.includes('기초과학 하나'),
    `코스를 바꾸면 앞 코스의 펼침 인덱스를 버리고 현재 섹션을 펼친다 — 실제 「${
      switched?.textContent.slice(0, 12) ?? '없음'
    }」`,
  );
  ok(
    viewed.at(-1) === 0,
    `배너로 올리는 인덱스도 새 코스 기준이다(0) — 실제 [${viewed.join(',')}]`,
  );
}

// ── 유닛 0개면 렌더하지 않는다(빈 코스 트리) ────────────────────────────────
{
  root2.render(createElement(PcCurriculumPath, { sections: [], onOpenUnit: () => {} }));
  await sleep(60);
  ok(container.querySelector('.wm-stage') === null, '빈 트리: 아무것도 렌더하지 않는다');
}

// ── ⑧ 고정 치수 계약 (2026-08-13 클라이언트 지시) ───────────────────────────
//
// ⚠️ **계약이 두 번 바뀐 자리다.** 원래는 「`PATH_SIZING_FLOOR` == 시드 최장 섹션」,
// 다음은 「크기가 코스마다 같다 + 상한(`PATH_SIZING_CAP`)을 넘으면 스크롤」이었다.
// 둘 다 **지름을 뷰포트 높이에 n칸 욱여넣어 구하는 식**을 전제로 한 보정이었고,
// 2026-08-13에 그 식 자체를 걷었다("섹션마다 학습 경로 범위를 정의하지 말고 그냥
// 간격을 규정하고 S자 또는 굴곡으로 잡고, 유닛마다의 칸을 마우스 포인트 하나에서
// 하나 반 정도로"). 지름이 상수가 되면 「어느 섹션에 맞출 것인가」라는 질문 자체가
// 사라지므로 바닥값·상한·`--n`·`--chrome`은 지킬 대상이 없다 — 지워야 할 단정이다.
//   ⚠️ 덧: 종전 ㉠은 실은 **아무것도 안 지키고 있었다.** 키를 NUL로 이어 놓고
//   `startsWith('weather ')`(공백)로 찾아 늘 빈 배열이었고, 두 코스가 나란히
//   `undefined`를 받아 통과했다. 새 단정은 값을 바꿔 실제로 붉어지는 것만 남긴다.
//
// 대신 새로 지킬 것:
//   ㉮ 시각 지름이 **선행 학습 앱 스케일**(실측 70px)의 ±20% 안
//      ⚠️ 종전 ㉮는 "24~36px(커서 하나~하나 반)"이었고 2026-08-13에 교체됐다.
//      그 지시는 지름이 44~86px 가변으로 **겹치던** 시점에 나온 것이라 「겹치지
//      말라」가 「작게」로 실현된 것이었는데, 클라이언트가 32px 결과를 보고
//      "부자연스럽다 → 참고 앱을 봐라 → 전혀 반영이 안 됐다"를 연속으로 내며
//      **나중 지시가 앞 지시를 대체**했다. 근거표는
//      `docs/Observation_Report_02_Benchmarking.md` §4.6가 소유한다.
//   ㉯ 클릭 표적 ≥ 44×44 — 시각 크기와 **분리**돼 있고 CSS가 실제로 그 상자를 만든다
//   ㉰ 세로 피치(지름+간격) ≥ 클릭 표적 — 좁으면 위아래 표적이 겹친다
//   ㉱ 굴곡이 S자다 — 한 주기 안에 좌우가 다 나오고, 좌우가 상쇄된다
//   ㉲ 칸 수와 무관하게 노드를 전건 그린다(35칸도 35개)
//   ㉳ 치수를 뷰포트에서 역산하지 않는다(cqh · contain:size 부활 금지)
// ⚠️ jsdom에는 레이아웃이 없어 "실제로 스크롤되는가"(px)는 **여기서 못 잰다** —
//    scrollHeight·clientHeight가 전부 0이다. 그래서 ㉳는 CSS 선언으로 단정하고,
//    넘침의 시각적 처리는 브라우저 실측 몫으로 남는다.
{
  const seed = JSON.parse(readFileSync(resolve(root, '../database/seed/units.json'), 'utf8'));
  const perSection = new Map();
  for (const u of seed) {
    const key = `${u.course ?? 'weather'}\u0000${u.section}`;
    perSection.set(key, (perSection.get(key) ?? 0) + 1);
  }
  const longest = Math.max(...perSection.values());
  // ⚠️ **주석을 걷고 본다.** 아래 단정들은 전부 "이 선언이 되살아났는가"를 묻는데,
  // 되살리지 말라고 적어 둔 주석에 옛 식이 그대로 인용돼 있다(`min-height: 0`·
  // `--dot: max(...)`). 원문을 그냥 grep하면 **근거를 지워야 통과하는 가드**가 된다 —
  // `--wm-track-tail` 단정에서 이미 겪은 함정이고 같은 처방을 쓴다.
  const css = readFileSync(resolve(root, 'src/styles/index.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const cut = (from, to) => css.slice(css.indexOf(from), css.indexOf(to));
  const mk = (name, count) => ({
    section: name,
    units: Array.from({ length: count }, (_, i) => ({
      id: `${name}-${i}`, title: `u${i}`, status: i === 0 ? 'current' : 'locked',
    })),
  });

  // ㉮ 노드 지름이 참고 스케일 대역. **리터럴을 박지 않고** 관찰 문서의 실측값에서
  //    파생한다 — 그래야 관찰이 갱신될 때 기대값이 따라 움직인다.
  const obsDoc = readFileSync(resolve(root, '../docs/Observation_Report_02_Benchmarking.md'), 'utf8');
  const refDot = Number(/노드 지름 \*\*(\d+)px\*\*/.exec(obsDoc)?.[1] ?? NaN);
  ok(Number.isFinite(refDot),
     `관찰 문서에서 참고 앱 노드 지름을 읽는다 — 실제 ${refDot}`);
  ok(
    Math.abs(PATH_DOT_PX - refDot) / refDot <= 0.2,
    `노드 지름이 참고 스케일 ±20% 안 — 우리 ${PATH_DOT_PX}px / 참고 ${refDot}px `
      + `(차 ${(((PATH_DOT_PX - refDot) / refDot) * 100).toFixed(1)}%)`,
  );
  // 32px 시절로 되돌아가면 위 단정이 운다(|32-70|/70 = 54%).

  // ⓑ **진폭/피치 ≤ 0.9** — 「부자연스럽다」의 정체였던 축이다.
  //    종전 104/(32+22) = 1.93으로, 한 칸 내려가는 동안 참고 앱(0.82)보다
  //    **2.4배 더 옆으로 누웠다**. 참고 앱의 길은 압도적으로 수직이다.
  //    ⚠️ 이것도 리터럴(64)이 아니라 **비율**로 문다 — 지름·간격이 다시 바뀌어도
  //    "너무 눕지 않는다"가 따라오게.
  const pitch = PATH_DOT_PX + PATH_GAP_PX;
  ok(
    PATH_AMP_PX / pitch <= 0.9,
    `진폭/피치 ≤ 0.9 (길이 옆으로 눕지 않는다) — ${PATH_AMP_PX}/${pitch} = `
      + `${(PATH_AMP_PX / pitch).toFixed(3)}. 종전 104/54 = 1.93이었다`,
  );

  // ㉯ 표적은 시각 크기와 **다른 값**이고, CSS가 그 상자를 실제로 만든다.
  ok(PATH_HIT_PX >= 44, `클릭 표적 최소 한 변 ≥ 44px(WCAG 2.5.5) — 실제 ${PATH_HIT_PX}px`);
  // ⚠️ **두 축을 따로 단정한다.** 한쪽만 보면 `width`만 되돌려도 초록이었다
  // (2026-08-13 변이 확인에서 실제로 통과했다) — 표적은 44×44지 44×32가 아니다.
  const dotRule = cut('.wm-dot {', '.wm-line {');
  const target = /\.wm-dot::before\s*\{([^}]*)\}/.exec(dotRule)?.[1] ?? '';
  ok(
    /width:\s*max\(\s*var\(--hit\)\s*,\s*var\(--dot\)\s*\)/.test(target)
      && /height:\s*max\(\s*var\(--hit\)\s*,\s*var\(--dot\)\s*\)/.test(target),
    '.wm-dot::before가 가로·세로 **둘 다** max(var(--hit), var(--dot))인 표적을 겹친다',
  );

  // ㉰ 피치가 표적보다 좁으면 위아래 표적이 겹쳐 엉뚱한 유닛이 열린다.
  ok(
    PATH_DOT_PX + PATH_GAP_PX >= PATH_HIT_PX,
    `세로 피치 ≥ 클릭 표적 — ${PATH_DOT_PX}+${PATH_GAP_PX}=${PATH_DOT_PX + PATH_GAP_PX} / ${PATH_HIT_PX}`,
  );

  // ㉰-2 「시작」 말풍선이 **위로 솟는 높이 ≤ 세로 간격**.
  // 노드가 86 → 32px이 되면서 간격이 22px이 됐는데 말풍선은 그대로라, 섹션 중간에
  // 서 있는 학습자에게 바로 위 노드를 **11.5px 덮었다**(2026-08-13 브라우저 실측).
  // 겹침 자체는 jsdom이 못 재지만 **치수 산술은 여기서 문다** — 글자를 키우거나
  // 간격을 줄이면 이 줄이 먼저 운다. leading-none이라 높이 = 글자 + 세로 패딩×2.
  const pcSrc3 = readFileSync(resolve(root, 'src/modules/curriculum/PcCurriculumPath.jsx'), 'utf8');
  const bubble = /status === 'current' && !blocked && \(\s*<span([\s\S]*?)>/.exec(pcSrc3)?.[1] ?? '';
  const num = (re) => Number(re.exec(bubble)?.[1] ?? NaN);
  const rise = num(/bottom-\[calc\(100%\+(\d+)px\)\]/)
    + num(/text-\[(\d+)px\]/) + 2 * num(/py-\[(\d+)px\]/);
  ok(
    /leading-none/.test(bubble) && rise <= PATH_GAP_PX,
    `「시작」 말풍선이 솟는 높이 ≤ 세로 간격 — ${rise}px / ${PATH_GAP_PX}px (leading-none 필수)`,
  );
  // 그 자리는 `.wm-vpath`의 padding-top이 대준다 — 첫 노드는 위에 이웃이 없고
  // 대신 「이 단계에서 배우는 것」 칩 줄이 있다(2026-08-13 클라이언트 제보).
  const padTop = Number(/padding-top:\s*(\d+)(?:px)?/.exec(cut('.wm-vpath {', '.wm-node {'))?.[1] ?? NaN);
  ok(padTop >= rise, `첫 노드 위 여백 ≥ 말풍선 높이 — padding-top ${padTop}px / ${rise}px`);

  // ㉱ S자인가 — 한 주기 안에서 좌우가 다 나오고 합이 0에 수렴한다(대칭 굴곡).
  //    weave는 export하지 않으므로 노드의 --k를 실제 렌더에서 읽는다.
  root2.render(createElement(PcCurriculumPath, {
    sections: [mk('W', PATH_WAVE_PERIOD)], onOpenUnit: () => {},
  }));
  await sleep(60);
  const ks = [...container.querySelectorAll('[data-wm-node]')].map((el) =>
    Number(el.style.getPropertyValue('--k')),
  );
  ok(ks.length === PATH_WAVE_PERIOD, `한 주기 = ${PATH_WAVE_PERIOD}칸 — 실제 ${ks.length}`);
  ok(ks.some((k) => k > 0.5) && ks.some((k) => k < -0.5),
     `한 주기 안에 좌우가 다 나온다 — k [${ks.join(', ')}]`);
  ok(Math.abs(ks.reduce((a, b) => a + b, 0)) < 0.01,
     '한 주기의 좌우가 상쇄된다(한쪽으로 쏠린 톱니가 아니다)');
  ok(ks.every((k) => Math.abs(k) <= 1), '흔들림 계수가 ±1을 넘지 않는다(진폭의 소유자는 --amp)');
  ok(ks[0] === 0, '섹션의 첫 노드는 가운데에서 시작한다(단계마다 위상이 다시 시작)');

  // 치수 넷이 실제로 화면까지 내려가는가 — 소유자는 JSX 상수 하나뿐이다.
  const vp = container.querySelector('.wm-vpath');
  for (const [name, want] of [
    ['--dot', PATH_DOT_PX], ['--gap', PATH_GAP_PX],
    ['--amp', PATH_AMP_PX], ['--hit', PATH_HIT_PX],
  ]) {
    const got = vp?.style.getPropertyValue(name);
    ok(got === `${want}px`, `${name}이 화면까지 내려간다(${want}px) — 실제 "${got}"`);
  }

  // ㉲ 시드 최장 섹션도 노드를 전건 그린다.
  root2.render(createElement(PcCurriculumPath, { sections: [mk('L', longest)], onOpenUnit: () => {} }));
  await sleep(60);
  const drawn = container.querySelectorAll('[data-wm-node]').length;
  ok(drawn === longest, `시드 최장 섹션(${longest}칸)의 노드를 전건 그린다 — 실제 ${drawn}`);
  ok(
    container.querySelector('.wm-vpath')?.style.getPropertyValue('--dot') === `${PATH_DOT_PX}px`,
    `${longest}칸이어도 지름은 ${PATH_DOT_PX}px 그대로다(칸 수가 크기를 못 건드린다)`,
  );

  // ㉳ 단계가 **자랄 수 있어야** 그 노드들이 스크롤로 흐른다.
  //    - height:100% 고정이면 내용이 넘쳐 다음 단계 위로 쏟아진다(2026-08-13 실측
  //      1470×801: 13칸 226px · 19칸 537px · 35칸 1368px).
  //    - container-type:size는 contain:size라 **내용과 무관하게** 높이를 확정한다 —
  //      넘침이 스크롤로 바뀌지 않던 진짜 원인이 이것이었다.
  const stageRule = cut('.wm-stage {', '.wm-vpath {');
  ok(/min-height:\s*100%/.test(stageRule), '.wm-stage는 min-height로 자란다');
  ok(!/^\s*height:\s*100%/m.test(stageRule), '.wm-stage에 height:100% 고정이 되살아나지 않았다');
  ok(
    !/container-type:\s*size\s*;/.test(stageRule),
    '.wm-stage에 container-type:size가 되살아나지 않았다(내용과 무관하게 높이를 확정한다)',
  );
  // ㉴ **스크롤 스냅이 되살아나지 않았다**(2026-08-13 오후 — 클라이언트 제보
  //    「상위 섹션 유닛에 도달할 수 없다」의 원인).
  //    스냅 계약은 "단계 ≤ 트랙"일 때만 성립했다. 노드가 고정 크기가 되면서
  //    단계 높이가 칸 수에 비례하게 됐고(시드 10섹션 전부 957px 이상), 트랙은
  //    clamp 상한이 800px이라 **그 전제가 다시 참이 될 수 없다**. 단계가 트랙보다
  //    크면 단계 경계 한 화면치가 **어느 단계도 스냅포트를 덮지 못하는 정지 불가
  //    구간**이 되어, 휠을 조금씩 굴리는 사람이 그 앞에서 되튕긴다.
  //
  //    브라우저 실측(1470×745 · 트랙 641px · scrollTop 0에서 휠 1틱씩):
  //      mandatory+always → 574↔674 무한 진동 / proximity+always → 동일
  //      mandatory+normal → 1섹션 꼬리를 건너뛰고 2574에서 정지
  //      none             → 0,200,…,2400 자유
  //
  // ⚠️ **이 단정의 한계**: jsdom에는 레이아웃이 없어 스냅을 계산하지 않는다
  //    (scrollHeight·clientHeight가 전부 0이고 `scroll-snap-*`은 무시된다).
  //    그래서 여기서 재는 것은 **"CSS 선언이 없다"뿐이고, "스크롤이 원하는 자리에
  //    선다"가 아니다.** 후자는 브라우저 실측 몫이고 위 표가 그 기록이다.
  //    선언이 없어도 JS가 스크롤을 붙잡는 회귀는 이 단정이 못 본다.
  const scrollerRule = cut('.wm-scroller {', '.wm-stage {');
  ok(
    !/scroll-snap-type\s*:/.test(scrollerRule),
    '.wm-scroller에 scroll-snap-type이 되살아나지 않았다(mandatory·proximity 둘 다 단계 경계를 정지 불가로 만든다)',
  );
  // ⚠️ 이 단정이 **없어서 아침 커밋에서 선언이 살아남았다.** 스냅을 걷을 때
  // `scroll-behavior: smooth`도 함께 걷어야 했는데 CSS 주석만 "되살리지 말 것"으로
  // 고치고 가드를 안 붙였고, 그래서 별도 커밋이 한 번 더 필요했다. 형제인
  // scroll-snap 3종에는 단정이 있는데 이것만 없던 비대칭을 코드 리뷰가 잡았다
  // (2026-08-13). 주석은 회귀를 막지 못한다 — 그게 이 줄이 있는 이유다.
  //
  // ⚠️⚠️ **이 단정을 처음 쓸 때 헛짚었다** — 그대로 적어 둔다.
  //   `/scroll-behavior\s*:/`는 같은 블록의 **`overscroll-behavior: contain`을
  //   부분 문자열로 잡는다.** 형제 `scroll-snap-*`에는 그런 접두 이웃이 없어
  //   같은 모양의 정규식이 거기서는 멀쩡했다. **가드를 새로 쓸 때 접두 이웃이
  //   있는 속성인지 먼저 볼 것.**
  //
  // ⚠️ **정정(2026-08-13, 다른 세션 지적)**: 여기 한때 "블록 안 주석의 글자도
  //   잡는다"가 두 번째 원인으로 적혀 있었는데 **거짓이다.** `:387~388`이 `css`를
  //   읽을 때 이미 전역으로 주석을 걷고, `:389`의 `cut()`이 그 결과를 자른다.
  //   즉 첫 빨강의 원인은 `overscroll-behavior` **하나뿐**이었다. 아래 재걷기는
  //   그래서 **필수가 아니라 이중 안전**이다 — 지우지 말 것. `:387`의 전역 걷기가
  //   나중에 바뀌면 이것이 유일한 방어가 된다.
  const scrollerDecls = scrollerRule.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(
    !/(^|[;{\s])scroll-behavior\s*:/.test(scrollerDecls),
    '.wm-scroller에 scroll-behavior가 되살아나지 않았다(빠르게 굴리면 관성이 밀려 원하는 자리에 못 선다)',
  );
  ok(
    !/scroll-snap-stop\s*:\s*always/.test(stageRule),
    '.wm-stage에 scroll-snap-stop:always가 되살아나지 않았다(한 제스처에 한 단계로 묶인다)',
  );
  ok(
    !/scroll-snap-align\s*:/.test(stageRule),
    '.wm-stage에 scroll-snap-align이 되살아나지 않았다(스냅포트가 없으면 죽은 선언이다)',
  );
  // ㉵ **여기 있던 `scroll-behavior: smooth` 한정 단정은 걷었다**(대장 §4.10,
  //    2026-08-14). 지운 것이지 완화한 것이 아니다 — 위 :660의 단정이
  //    **엄밀히 더 강하다**:
  //      · 이것: `scroll-behavior: smooth`만 잡는다
  //      · :660: **값 무관**(`auto`가 들어와도 잡는다) + 선언 시작 경계 요구
  //        + 주석 재걷기(이중 안전)
  //    같은 회귀를 둘이 무는데 약한 쪽을 남겨 둘 이유가 없다.
  //
  // ⚠️ **왜 중복이 생겼는지가 이 주석의 값이다.** 두 세션이 같은 날 같은 결함을
  //    **각자 발견해 각자 고쳤다**(#70·#72). 소통이 늦으면 놓치는 것이 아니라
  //    **겹치는** 쪽으로도 나타난다는 사례다(대장 §4.7·§4.8과 같은 뿌리).
  //
  // 남은 :660 단정이 지키는 것과 그 경위(스냅을 걷은 커밋이 CSS 주석만 고치고
  // 선언을 남겨 회귀가 살아남았다는 것, 실측 `scrollTop += 400`×12 → 기대 4800인데
  // 즉시 120·1.5초 뒤 511)는 그쪽 주석이 소유한다. 여기 복제하지 않는다 —
  // 한 사실을 두 곳에 적으면 한쪽만 갱신된다.

  const vpathRule = cut('.wm-vpath {', '.wm-node {');
  ok(!/\bcqh\b/.test(vpathRule), '.wm-vpath가 지름을 뷰포트 높이(cqh)에서 역산하지 않는다');
  ok(!/min-height:\s*0/.test(vpathRule),
     '.wm-vpath에 min-height:0이 되살아나지 않았다(내용보다 작아지면 다시 넘친다)');
  // 치수의 소유자는 JSX 한 곳 — CSS에 폴백을 두면 조용한 두 번째 소유자가 된다.
  ok(
    !/^\s*--(dot|gap|amp|hit):/m.test(vpathRule) && !/var\(--(dot|gap|hit),/.test(css),
    'CSS가 치수를 스스로 정하거나 폴백을 갖지 않는다(소유자 이중화 금지)',
  );
}

// ── ⑨ 길이 **곡선**이다 · 굵기가 노드에 비례한다 (2026-08-13) ────────────────
//
// 클라이언트 지시: "학습 경로가 지금 너무 형태는 좋은데 부자연스러워."
// 형태(S자·32px·고정 간격)는 바로 앞 라운드에 클라이언트가 직접 지시한 것이라
// 유지하고, **「부자연스러움」의 정체 2건**만 고쳤다. 둘 다 취향이 아니라 시안
// 대비 회귀이고, 둘 다 실측으로 특정했다:
//
//   ㉠ 꺾은선 — 시안(`docs/design/learn_session_mockup.html:529-540`)은 처음부터
//      3차 베지에인데 앱은 `L`로 이었다. 실측(1470×801) 마디 회전각이
//      `0°, ±24°, ±59°`로 굽이의 극점마다 59° 팔꿈치가 서고 그 사이는 완전 직선.
//   ㉡ 선 굵기 — 10px은 시안이 **지름 86px**일 때 고른 값(11.6%)인데, 노드가
//      32px이 되면서 **31%**가 됐다. 2026-08-13 축소 때 LIP·HALO·보드칩·말풍선은
//      전부 다시 재어졌고 **선 굵기만 그 사슬에서 빠져 있었다**.
//
// ⚠️ **두 축이 따로 울어야 한다.** `includes('C')` 한 줄로 두면 "C는 남기고
// 제어점만 끝점으로 바꾸는" 변이가 그대로 통과한다 — 그러면 화면은 다시 직선인데
// 테스트는 초록이다. 그래서 제어점 좌표를 **직접 잰다**.
{
  // d 문자열에서 C 세그먼트를 숫자로 되꺼낸다.
  const segs = (d) =>
    [...d.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)]
      .map((m) => m.slice(1).map(Number));

  // ㉠-1 두 점이면 C 한 구간. 제어점 x = 각 끝점의 x, y = 구간 중점 → **접선이 수직**.
  {
    const d = curvePath([{ x: 10, y: 0 }, { x: 50, y: 100 }]);
    const s = segs(d);
    ok(s.length === 1, `두 점 → C 한 구간 — 실제 ${s.length} ("${d}")`);
    const [c1x, c1y, c2x, c2y, ex, ey] = s[0] ?? [];
    ok(c1x === 10 && c2x === 50,
       `제어점 x가 각 끝점의 x와 같다(노드에서 접선이 수직) — 실제 ${c1x}, ${c2x}`);
    ok(c1y === 50 && c2y === 50,
       `제어점 y가 둘 다 구간 중점이다 — 실제 ${c1y}, ${c2y}`);
    ok(ex === 50 && ey === 100, `구간이 다음 노드에서 끝난다 — 실제 ${ex},${ey}`);
    // 제어점을 끝점으로 뭉개면(= 직선) 위 두 단정이 운다. 그 변이를 여기 박제한다.
    ok(!(c1x === 10 && c1y === 0), '제어점이 시작점과 같지 않다(같으면 C를 쓴 직선이다)');
  }

  // ㉠-2 꺾은선(L)으로 되돌아가지 않았다 — **분리된 축**이다.
  {
    const d = curvePath([{ x: 0, y: 0 }, { x: 40, y: 60 }, { x: 0, y: 120 }]);
    ok(!/\bL[-\d]/.test(d), `길에 직선 구간(L)이 없다 — "${d}"`);
    ok(segs(d).length === 2, `점 3개 → C 두 구간 — 실제 ${segs(d).length}`);
    ok(curvePath([{ x: 1, y: 1 }]) === '' && curvePath([]) === '',
       '점이 2개 미만이면 아무것도 그리지 않는다(빈 d)');
  }

  // ㉠-3 파란 길이 회색 위에 **정확히** 겹친다. 구간별 베지에라
  //      curvePath(앞부분)이 curvePath(전체)의 접두사여야 한다 — 이 성질이
  //      깨지면 완료 구간이 길에서 떠서 두 줄로 보인다.
  {
    const pts = [{ x: 0, y: 0 }, { x: 40, y: 60 }, { x: 0, y: 120 }, { x: -40, y: 180 }];
    ok(curvePath(pts).startsWith(curvePath(pts.slice(0, 3))),
       '완료 구간이 전체 길의 접두사다(파랑이 회색 위에 겹친다)');
  }

  // ㉠-4 컴포넌트가 실제로 이 함수를 쓴다 — 순수 함수만 고치고 StageLine이 옛
  //      지역 `line()`을 그대로 쓰면 화면은 하나도 안 바뀐다(alignScrollTop과 같은 관례).
  const pcSrc4 = readFileSync(resolve(root, 'src/modules/curriculum/PcCurriculumPath.jsx'), 'utf8');
  ok(
    /baseRef\.current\?\.setAttribute\('d',\s*curvePath\(all\)\)/.test(pcSrc4),
    '회색 길을 curvePath로 그린다(지역 폴리라인 빌더로 되돌아가지 않았다)',
  );
  ok(
    /doneRef\.current\?\.setAttribute\('d',[\s\S]{0,60}curvePath\(all\.slice\(0,\s*doneLen\)\)/.test(pcSrc4),
    '파란 길도 같은 curvePath로 그린다',
  );
  ok(
    !/=>\s*list\.map\(\(p, i\) =>\s*`\$\{i \? 'L' : 'M'\}/.test(pcSrc4),
    '옛 꺾은선 빌더(L 폴리라인)가 되살아나지 않았다',
  );

  // ㉡ 굵기 — **선을 마운트하지 않으므로 DOM 단정은 걷었다**(2026-08-13).
  //    상수 단정만 남긴다: 선을 되살리는 날 이 비율이 먼저 필요해지고, 그때
  //    10px(= 노드 86px 시절 값)으로 되돌아가는 것을 막는다.
  ok(
    PATH_LINE_PX <= PATH_DOT_PX * 0.25 && PATH_LINE_PX >= 4,
    `(주차된 계약) 길 굵기가 노드 지름의 1/4 이하이고 4px 이상 — ${PATH_LINE_PX}px / ${PATH_DOT_PX}px`,
  );
  ok(
    !/strokeWidth="10"/.test(pcSrc4),
    '굵기 10px 리터럴이 되살아나지 않았다(86px 노드 시절의 값)',
  );
}

// ── ⑧-3 첫 화면이 **현재 노드**에 선다 (고정 간격이 만든 새 분기) ───────────
//
// 「한 화면에 한 단계」였을 때는 `scrollTop = stage.offsetTop`이면 그 단계의 노드가
// 전부 보였다. 단계가 트랙보다 길어질 수 있게 되면서(19칸 1069px · 35칸 1987px vs
// 트랙 660px) 단계 맨 위에 떨어뜨리면 **25번째 유닛에 선 학습자의 ⭐가 두 화면
// 아래**에 있다 — 이 효과의 목적("매번 1단계부터 스크롤하게 두지 않는다")이 그대로
// 되살아난다. jsdom에는 레이아웃이 없어 실스크롤로는 못 재므로 순수 함수로 문다.
{
  const V = 660;
  // ㉠ 단계가 트랙보다 짧다 → 종전과 같이 단계 맨 위(스냅이 허용하는 유일한 자리)
  ok(
    alignScrollTop({ stageTop: 1000, stageHeight: 400, nodeTop: 1300, nodeHeight: 32, viewport: V })
      === 1000,
    '짧은 단계는 맨 위 그대로 — 회귀 0',
  );
  // ㉡ 긴 단계의 한가운데 → 노드가 세로 가운데
  ok(
    alignScrollTop({ stageTop: 1000, stageHeight: 2000, nodeTop: 2000, nodeHeight: 32, viewport: V })
      === 2000 + 16 - 330,
    '긴 단계 한가운데: 현재 노드를 화면 가운데에 둔다',
  );
  // ㉢ 긴 단계의 앞쪽 → 앞 단계로 넘어가지 않는다
  ok(
    alignScrollTop({ stageTop: 1000, stageHeight: 2000, nodeTop: 1020, nodeHeight: 32, viewport: V })
      === 1000,
    '단계 앞쪽에서도 앞 단계로 넘어가지 않는다(아래 한계 lo)',
  );
  // ㉣ 긴 단계의 끝 → 단계 밖(다음 단계)까지 밀지 않는다
  ok(
    alignScrollTop({ stageTop: 1000, stageHeight: 2000, nodeTop: 2960, nodeHeight: 32, viewport: V })
      === 1000 + 2000 - V,
    '단계 끝에서도 다음 단계를 넘겨다보지 않는다(위 한계 hi)',
  );
  // 세 분기가 서로를 무효화하지 않는가 — hi < lo(아주 짧은 단계)에서도 lo가 이긴다
  ok(
    alignScrollTop({ stageTop: 500, stageHeight: 100, nodeTop: 500, nodeHeight: 32, viewport: V })
      === 500,
    '단계가 트랙보다 훨씬 짧아도(hi < lo) 앞 단계로 새지 않는다',
  );
  // 순수 함수가 맞아도 **호출부가 옛 식(`el.scrollTop = stage.offsetTop`)이면**
  // 화면은 하나도 안 고쳐진다 — joinK 경계 단정과 같은 이유로 소스도 본다.
  const pcSrc2 = readFileSync(resolve(root, 'src/modules/curriculum/PcCurriculumPath.jsx'), 'utf8');
  ok(
    /el\.scrollTop\s*=\s*node[\s\S]{0,40}alignScrollTop\(\{/.test(pcSrc2),
    '초깃값 정렬이 alignScrollTop을 실제로 쓴다(단계 맨 위로 되돌아가지 않았다)',
  );

  // ── ㉰ 스크롤 힌트 판정 `hasMoreBelow` (대장 §4.13 — 2026-08-14) ────────────
  //
  // 🔴 **이 계약은 하루 늦게 왔다.** `#72` 코드리뷰가 낸 medium을 고칠 때 판정이
  //    컴포넌트 안에 인라인이라 물 방법이 없었고, 그동안 **되돌려도 우는 것이
  //    없었다**(기하 추론만이 근거였다). 순수 함수로 빼면서 세운다.
  //
  // 무는 것은 **「스크롤러가 넘치는가」가 아니라 「펼친 단계가 화면을 넘치는가」**다.
  // 접기 이후 스크롤러 안에는 접힌 줄들(각 52px)이 함께 살기 때문에, 스크롤러를
  // 재면 **더 볼 것이 없는 섹션에서도 힌트가 상주**한다(맨 끝 섹션일 때만 우연히 맞음).
  {
    const V = 640; // 트랙 한 화면
    // ⓐ 다 들어오는 섹션 — `.wm-stage`가 min-height:100%라 높이가 정확히 트랙이다.
    //    정렬 effect가 scrollTop을 stageTop에 두므로 이 조합이 실제로 일어난다.
    ok(
      hasMoreBelow({ scrollTop: 1000, viewport: V, stageTop: 1000, stageHeight: V }) === false,
      'ⓐ 다 들어오는 섹션에서는 힌트가 뜨지 않는다 — 아래 접힌 줄이 몇 개든 무관하다',
    );
    // ⓑ 긴 섹션의 맨 위 — 아직 볼 것이 남았다
    ok(
      hasMoreBelow({ scrollTop: 1000, viewport: V, stageTop: 1000, stageHeight: 1731 }) === true,
      'ⓑ 트랙보다 긴 섹션(19칸=1731px)의 맨 위에서는 힌트가 뜬다',
    );
    // ⓒ 그 섹션의 끝까지 내려왔다 — 남은 것이 없다
    ok(
      hasMoreBelow({ scrollTop: 1000 + 1731 - V, viewport: V, stageTop: 1000, stageHeight: 1731 })
        === false,
      'ⓒ 긴 섹션의 끝에 닿으면 힌트가 사라진다',
    );
    // ⓓ 바닥 근처 여유 — 소수점 오차로 깜빡이지 않는다
    ok(
      hasMoreBelow({ scrollTop: 1000 + 1731 - V - 10, viewport: V, stageTop: 1000, stageHeight: 1731 })
        === false,
      'ⓓ 끝에서 10px 못 미쳐도 「더 있음」으로 뒤집히지 않는다(slack 24)',
    );
    // ⓔ **회귀의 모양 그 자체** — 스크롤러 전체를 재던 옛 식이면 여기서 true가 된다.
    //    3칸 섹션(97+86×3=355px, min-height로 640까지 부푼다) 아래에 접힌 줄 9개(468px).
    //    옛 식: scrollTop(0) + 640 < scrollHeight(640+468) - 24 → **참**(거짓 힌트).
    ok(
      hasMoreBelow({ scrollTop: 0, viewport: V, stageTop: 0, stageHeight: V }) === false,
      'ⓔ 1섹션(다 들어옴) + 아래 접힌 줄 9개에서 힌트가 뜨지 않는다 — 이것이 고친 회귀다',
    );
  }
  // 순수 함수가 맞아도 **호출부가 옛 식이면** 화면은 안 고쳐진다 — 위와 같은 관례.
  ok(
    /setHasMore\(\s*hasMoreBelow\(\{/.test(pcSrc2),
    '힌트 판정이 hasMoreBelow를 실제로 쓴다(스크롤러 전체를 재던 식으로 안 돌아갔다)',
  );
  ok(
    !/setHasMore\([^)]*scrollHeight/.test(pcSrc2),
    '힌트 판정이 el.scrollHeight를 다시 보지 않는다(접힌 줄까지 세던 그 식이다)',
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
  // ⚠️ **2026-08-17에 이 가드의 방법이 바뀌었다.**
  // 종전에는 「접기 목록(`HERO_PATHS`)이 슬래시를 정규화하는가 · 배너 있는
  // 화면이 그 목록에 들어 있는가」 둘을 물었다. 사이드바 튜터 카드가 통째로
  // 걷히면서(사용자 지시 — 말하는 캐릭터를 `GuideBot` 하나로) **접을 것도
  // 목록도 없어졌다.** 두 단정은 이제 `HERO_PATHS`를 못 찾아 빈 문자열을
  // 비교하는 공허한 검사가 된다.
  //
  // 그래서 **지키려던 것 자체**를 직접 문다: 진입 카드가 물방울이를 그리는
  // 화면에서 사이드바가 같은 캐릭터를 또 그리면 안 된다 → 사이드바는 어떤
  // 캐릭터도 안 그린다. 카드가 되살아나면 여기서 운다(같은 단정을
  // `mascotAssets.contract` ④-ⓐ도 갖는다 — 한쪽이 지워져도 남게 둔다).
  ok(
    !/<Mascot\b/.test(side),
    '사이드바가 마스코트를 그리지 않는다 — 진입 카드 물방울이와 둘이 뜨는 것을 막는다',
  );
  ok(
    /const TUTOR_BY_PATH/.test(side),
    '담당표(TUTOR_BY_PATH)는 남아 있다 — 배너 마스코트 대조의 기준이다',
  );

  // 화자는 물방울이 — 사이드바 TUTOR_BY_PATH(/learn → drop)와 같은 값이어야 한다.
  const entry = readFileSync(resolve(root, 'src/modules/curriculum/learnEntry.js'), 'utf8');
  ok(/unit:\s*'drop'/.test(entry), '진입 카드 화자가 물방울이(drop)다');
}

// ── ⑪-b 아이콘이 원 안에 든다: 비율의 소유자는 **JSX 인라인**이다 (2026-08-19) ──
//
// 🔴 결함: 노드 지름 64px에 아이콘이 `0.55 × 64 = 35.2px`이었다. macOS/Chrome
// 실측(2026-08-19, Apple Color Emoji)으로 잉크 상자는 **폰트 크기의 1.079배**
// (35.2px에서 38×38 정사각. 17종 전건 동일 — 비트맵 폰트라 글리프마다 같다).
// 정사각 잉크가 **내접원**(반지름 32) 안에 들려면 반대각선 `0.763×F ≤ 32`,
// 즉 `F ≤ 41.9px = 0.655 × 지름`이 상한이다. 0.55는 그 상한의 84%라
// **여유가 16%뿐**이고, 3배 확대로 보면 🌈·🌊가 원 테두리에 닿는다(실측 스크린샷).
// 잉크 상자가 macOS보다 큰 플랫폼(Segoe UI Emoji·Noto Color Emoji는 아웃라인
// 폰트라 글리프마다 다르다)에서는 그 16%를 먹고 **테두리를 넘는다** — 클라이언트가
// 본 「해상도 사이즈 따라 짤린다」의 후보다.
//
// ⚠️ **소유자가 옮겨졌다.** 종전 소유자는 `src/styles/index.css`의
// `.wm-dot { font-size: calc(var(--dot) * 0.55) }`였는데, 그 파일은 ⑪-b의
// 배타 소유가 아니라 손댈 수 없다. 그래서 **JSX 인라인 style이 그 선언을
// 덮는다**(인라인 > 클래스). 그 결과 index.css의 0.55 줄은 **죽은 값**이다 —
// 지우는 것은 index.css 소유자 몫이고, 그때까지 이 계약이 인라인을 지킨다.
// 인라인이 지워지면 화면이 조용히 0.55로 되돌아가므로 **런타임에서** 문다.
{
  await render({}); // 앞 블록들이 구름 0·접힘 등으로 상태를 흔들어 놓았으므로 원복
  const ratioNodes = [...container.querySelectorAll('.wm-dot')];
  ok(ratioNodes.length > 0, `⑪-b 노드가 마운트됐다 — ${ratioNodes.length}개`);
  const want = `calc(var(--dot) * ${PATH_ICON_RATIO})`;
  const inlineSizes = new Set(ratioNodes.map((b) => b.style.fontSize));
  ok(
    inlineSizes.size === 1 && inlineSizes.has(want),
    `🔴 ⑪-b 전 노드가 인라인으로 아이콘 크기를 소유한다 — 기대 '${want}' / 실제 ${[...inlineSizes].map((v) => `'${v}'`).join(',')}`,
  );
}

await vite.close();

// ── ⑪-b 비율 자체가 기하 상한과 판독 바닥 사이에 있다 ────────────────────────
{
  // ㉮ 내접원 상한. 잉크 상자 한 변 = 1.079×F(macOS 실측)이므로 반대각선은
  //    0.7629×F. 지름 D의 내접원 반지름은 D/2 → `0.7629 × ratio × D ≤ 0.5 × D`
  //    ⇒ `ratio ≤ 0.655`. 그 상한을 그대로 쓰면 이질 플랫폼 여유가 0이라
  //    **0.5로 끊는다** = 잉크가 macOS보다 31% 커져도 원 안에 든다(0.55는 19%).
  const INK_PER_FONT = 1.079; // 2026-08-19 macOS/Chrome canvas measureText 실측
  const halfDiag = (INK_PER_FONT * Math.SQRT2) / 2; // 0.7629
  ok(
    PATH_ICON_RATIO <= 0.5,
    `🔴 ⑪-b 아이콘 비율 ≤ 0.5 — 내접원 상한 ${(0.5 / halfDiag).toFixed(3)}에 이질 플랫폼 여유 `
      + `${((0.5 / halfDiag / PATH_ICON_RATIO - 1) * 100).toFixed(0)}%를 남긴다. 실제 ${PATH_ICON_RATIO}`,
  );
  ok(
    PATH_ICON_RATIO * PATH_DOT_PX * halfDiag <= PATH_DOT_PX / 2,
    `⑪-b 잉크 반대각선이 내접원 반지름 안 — ${(PATH_ICON_RATIO * PATH_DOT_PX * halfDiag).toFixed(1)}px `
      + `/ ${PATH_DOT_PX / 2}px`,
  );
  // ㉯ 판독 바닥. 모바일 UnitNode가 같은 64px 노드에 24px(=0.375)로 그리는데
  //    확대 없이 읽힌다(2026-08-19 실측 스크린샷). 그 아래로는 내려가지 않는다 —
  //    보드 칩 🧩을 24 → 16px로 줄일 때 "이보다 작게 하면 안 읽힌다"고 적은
  //    것과 같은 절충이다(2026-08-13 선례).
  ok(
    PATH_ICON_RATIO >= 0.375,
    `🔴 ⑪-b 아이콘 비율 ≥ 0.375 — 모바일 24/64가 판독 바닥이다. 실제 ${PATH_ICON_RATIO}`,
  );
}

// ── ⑪-a 아이콘 규칙: 두 화면이 **같은 소유자**를 읽는다 (2026-08-19) ──────────
// 🔴 종전에 PC가 `STATUS_ICON[status] ?? '🌀'`로 **개념 아이콘을 덮어써서**, 열린
// 유닛이 많아질수록 화면이 **회오리 도배**가 됐다(클라이언트 지적). 작은 화면은
// 처음부터 개념 아이콘을 썼다 — **두 화면이 다른 규칙**이었다.
// ⚠️ 주석으로 「같다」고 적어 두면 갈린다(오늘 세 번 봤다: 목↔서버·ko↔en·PC↔모바일).
// 그래서 **소스에서 확인**한다 — 두 화면이 `unitIcon`만 부르고 자기 표를 안 갖는지.
{
  // ⚠️ **주석을 걷고 본다.** 처음엔 원문 그대로 검사했다가 빨강이 났다 — 수정 사유를
  // 적은 주석 안에 「종전에 `STATUS_ICON = {…}`이 있었다」는 문장이 들어 있어서
  // **자기 설명이 자기 계약에 걸렸다.** 계약은 **산문이 아니라 코드**를 봐야 한다.
  // (같은 형태를 오늘 ⑦에서도 겪었다: 새 라벨 안에 옛 문자열이 부분 문자열로 들어갔다.)
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pcSrc = stripComments(readFileSync(resolve(root, 'src/modules/curriculum/PcCurriculumPath.jsx'), 'utf-8'));
  const mbSrc = stripComments(readFileSync(resolve(root, 'src/modules/curriculum/CurriculumHome.jsx'), 'utf-8'));
  const ruleSrc = stripComments(readFileSync(resolve(root, 'src/modules/curriculum/unitIcon.js'), 'utf-8'));

  ok(/unitIcon\(unit,\s*status\)/.test(pcSrc), '⑪-a PC가 unitIcon()을 부른다');
  ok(/unitIcon\(unit,\s*status\)/.test(mbSrc), '⑪-a 모바일이 unitIcon()을 부른다');
  ok(!/STATUS_ICON\s*=/.test(pcSrc),
     '🔴 ⑪-a PC가 자기 상태 아이콘 표를 다시 갖지 않는다 — 두 벌이 되면 또 갈린다');
  ok(!/const CONCEPT_ICON\s*=/.test(mbSrc),
     '🔴 ⑪-a 모바일이 자기 개념 아이콘 표를 다시 갖지 않는다 — 표는 unitIcon.js 소유다');

  // 규칙 자체 — `unlocked`가 상태 표에 **없어야** 한다(그게 이 수정의 본체다)
  const statusTable = /const STATUS_WINS\s*=\s*\{([^}]*)\}/.exec(ruleSrc);
  ok(statusTable, '⑪-a unitIcon.js가 상태 표를 갖는다');
  ok(!/unlocked/.test(statusTable?.[1] ?? 'unlocked'),
     '🔴 ⑪-a 상태 표에 unlocked가 없다 — 있으면 열린 유닛이 다시 한 아이콘으로 덮인다');
  for (const tag of ['pressure_front', 'typhoon', 'air_mass', 'wildfire_weather', 'flood_response']) {
    ok(ruleSrc.includes(`${tag}:`), `⑪-a 개념 표에 ${tag}가 있다`);
  }
}

// ── ⑪-c 아이콘이 흑백(텍스트 표현)으로 떨어지지 않는다 (2026-08-19) ───────────
// 🔴 `anomaly`가 U+26A1 **단독**이라 macOS/Chrome에서 잉크가 `24×17.9`였다 —
// 같은 줄 다른 아이콘은 전건 `38×38`이라 **혼자 작고 좁게** 보였다. VS16(U+FE0F)이
// 붙으면 브라우저가 이모지 표현을 쓴다.
//
// ⚠️ **특정 글자를 하드코딩하지 않는다** — 표는 계속 자라고(오늘만 재난 축 2종·
// 기초과학 6종이 붙었다) 사람이 새 글자마다 VS16을 기억할 수는 없다. 그래서
// **조건에 맞는 값 전건**을 본다. 조건이 두 갈래인 것이 이 계약의 요점이다:
//
//   ㉠ **속성 기반** — 유니코드가 기본 표현을 텍스트로 정한 글자
//      (`Emoji=Yes` ∧ `Emoji_Presentation=No`). ☀ U+2600 · ☁ U+2601 ·
//      ❄ U+2744 · ⚠ U+26A0 · ⛈ U+26C8 · 🌤 U+1F324 · 🌫 U+1F32B 계열이고,
//      표에 이미 있는 🌡 U+1F321 · 🌪 U+1F32A · 🏙 U+1F3D9가 그렇다.
//      **다음에 ☀를 추가해도 이 단정이 문다.**
//
//   ㉡ **실측 예외** — `Emoji_Presentation=Yes`인데도 실제 화면에서 흑백으로
//      떨어진 글자. ㉠만으로는 **영원히 못 잡는다.** U+26A1이 바로 그 경우다:
//      유니코드 15.1에서 `Emoji_Presentation=Yes`인데(Node `\p{...}`·파이썬
//      `regex` 양쪽 실측) 그래도 `24×17.9`로 떨어졌다. 원인은 브라우저가 기본
//      표현을 보기 **전에 CSS 폰트 스택을 먼저 걷기** 때문이고, 스택 앞쪽 텍스트
//      폰트의 U+26A1 글리프는 정사각 em을 안 채운다.
//      🔴 그러니 이 목록을 「유니코드가 Yes라던데?」로 지우지 말 것 — 지우면
//      ⑪-c가 계약 없이 되살아난다. 지울 근거는 유니코드 표가 아니라 **재실측**이다.
{
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ⚠️ 주석을 먼저 걷는다. 머리말이 **VS16 없는 옛 ⚡을 이력으로 인용**하고 있고
  //    (§0-5: 틀린 기술은 지우지 말고 경위를 남긴다), 수정 사유 주석도 그 글자를
  //    다시 적는다 — 산문을 값으로 읽으면 고쳐 놓고도 빨강이 난다.
  const iconSrc = stripComments(
    readFileSync(resolve(root, 'src/modules/curriculum/unitIcon.js'), 'utf-8'),
  );
  const VS16 = '️';
  // 표 두 개(CONCEPT_ICON·STATUS_WINS)와 폴백('📘')을 **한 번에** 훑는다 —
  // 자리를 나열하면 새 표가 생겼을 때 조용히 빠진다.
  const values = [...new Set([...iconSrc.matchAll(/'([^']*)'/g)].map((m) => m[1]))]
    .filter((v) => [...v].some((c) => c.codePointAt(0) > 0x2000));

  // 파싱이 실제로 표를 잡았는지 먼저 확인한다 — 정규식이 0건을 반환하면 아래
  // 단정 둘이 **공집합을 통과**하고, 계약이 있는 척만 하게 된다(오늘 mascot
  // 계약이 옛 자리를 슬라이스해 빈 블록을 검사한 것과 같은 함정이다).
  ok(values.length >= 15, `⑪-c 아이콘 값을 읽었다 — ${values.length}종 (표가 옮겨지면 여기가 먼저 운다)`);

  const baseOf = (v) => String.fromCodePoint(v.codePointAt(0));
  const textDefault = values.filter((v) => {
    const base = baseOf(v);
    return /\p{Emoji}/u.test(base) && !/\p{Emoji_Presentation}/u.test(base);
  });
  const bareTextDefault = textDefault.filter((v) => !v.includes(VS16));
  ok(
    bareTextDefault.length === 0,
    `🔴 ⑪-c 기본 텍스트 표현 문자는 VS16을 갖는다 — Emoji_Presentation=No ${textDefault.length}종 중 `
      + `VS16 없는 것 ${bareTextDefault.length}종`
      + `${bareTextDefault.length ? ` (${bareTextDefault.map((v) => `U+${v.codePointAt(0).toString(16).toUpperCase()}`)})` : ''}`,
  );

  // 실측 예외 목록. 값이 아니라 **코드포인트로** 적는다 — 소스에 보이지 않는
  // VS16을 넣으면 목록 자신이 판정 대상과 구별되지 않는다.
  const MEASURED_MONOCHROME = [
    { cp: '⚡', why: 'macOS/Chrome 잉크 24×17.9 ↔ 다른 아이콘 38×38 (2026-08-19 실측)' },
  ];
  const bareMeasured = MEASURED_MONOCHROME.filter(({ cp }) =>
    values.some((v) => v.startsWith(cp) && !v.includes(VS16)));
  ok(
    bareMeasured.length === 0,
    `🔴 ⑪-c 실측으로 흑백이던 문자도 VS16을 갖는다 — 빠진 것 ${bareMeasured.length}종`
      + `${bareMeasured.length
        ? ` (${bareMeasured.map(({ cp, why }) => `U+${cp.codePointAt(0).toString(16).toUpperCase()}: ${why}`).join(' / ')})`
        : ''}`,
  );

  // 예외 목록이 **죽지 않았는지** 본다 — 그 글자가 표에서 사라지면 위 단정은
  // 공집합으로 조용히 통과한다. 배정이 바뀌어 정말 빠졌다면 목록에서 지울 것이고,
  // 그 판단을 사람이 하도록 여기서 소리를 낸다.
  const orphanExceptions = MEASURED_MONOCHROME.filter(({ cp }) => !values.some((v) => v.startsWith(cp)));
  ok(
    orphanExceptions.length === 0,
    `⑪-c 실측 예외 목록에 죽은 항목이 없다 — 표에 없는 것 ${orphanExceptions.length}종`
      + `${orphanExceptions.length ? ` (${orphanExceptions.map(({ cp }) => `U+${cp.codePointAt(0).toString(16).toUpperCase()}`)})` : ''}`,
  );
}

if (failures) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\nOK: 학습 경로(완료 구간 경계·aria 라벨·구름 차단·접기 일괄·노드 수) 스모크 통과');
process.exit(0);

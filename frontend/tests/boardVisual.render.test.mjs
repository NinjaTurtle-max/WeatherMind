/**
 * 보드 비주얼 SSR 렌더 스모크 (R9-08) — node tests/boardVisual.render.test.mjs
 *
 * vite ssrLoadModule + renderToString으로 검증한다:
 *  1) CrossSectionPanel STORYBOARDS가 board_rules.json 8종 전부를 커버하고
 *     각 스토리보드가 3단계 이상 + 비어 있지 않은 캡션을 갖는지
 *  2) 규칙 8종 각각 패널 렌더 — 1단계 캡션·재생 컨트롤·explain 출력
 *  3) reduced-motion(정적) 렌더 — 전체 단계 목록 + '정적 표시' 배지
 *  4) AtmosphereBoard 통합 렌더 — 인포그래픽 지도 defs·전선 곡선·색 번짐·
 *     주석 라벨·Canvas 강수 마운트(강수 존 있을 때만) 존재
 *  5) PrecipCanvas SSR 가드 — window 접근 없이 <canvas> 마크업만 출력,
 *     소스에 typeof window 마운트 가드 존재
 *  6) en 실렌더에 한국어 0건 (MT-28)
 *  7) 좁은 화면 재배치·카드 폭·힌트 배치 (소스 단정)
 *  8) **SVG 폴백이 WebGL과 같은 뜻을 그린다** (MT-23) — 산불에 산·비탈 위의 화선,
 *     홍수에 도시·포장면 대비·수위 상승. **무엇을 못 재는지는 그 절 머리에 적었다.**
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'production';

// 로케일 고정(ko) — 이 스모크는 "ko 화면 무회귀"를 검증한다. i18n 전면 외부화(R11
// 웨이브 2) 후 detectLocale()이 localStorage → navigator.language 순으로 고르는데,
// node에 localStorage가 없고 GitHub 러너의 navigator.language는 en-US라서 고정
// 없이는 CI에서만 en으로 렌더돼 한국어 단정 17건이 깨진다(en-US 강제 재현으로
// 실측). jsdom 스모크 7종의 weathermind.locale 고정과 같은 관례의 SSR판.
globalThis.localStorage = {
  getItem: (k) => (k === 'weathermind.locale' ? 'ko' : null),
  setItem() {}, removeItem() {},
};

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { createServer } = await import('vite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(resolve(root, '../database/seed/board_rules.json'), 'utf-8'));

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

let failed = 0;
// react SSR은 인접 텍스트 보간 사이에 <!-- --> 구분자를 끼운다 — 문구 검사 전 제거
const render = (el) => renderToString(el).replace(/<!--[\s\S]*?-->/g, '');
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

try {
  const panelMod = await server.ssrLoadModule('/src/modules/board/CrossSectionPanel.jsx');
  const { STORYBOARDS } = panelMod;
  const CrossSectionPanel = panelMod.default;

  // 1) 스토리보드 커버리지·단계 수·캡션
  for (const rule of rules) {
    const story = STORYBOARDS[rule.id];
    check(`스토리보드 존재: ${rule.id}`, Boolean(story));
    if (!story) continue;
    check(
      `  단계 ≥3 + 캡션 비어있지 않음 (${story.steps.length}단계)`,
      story.steps.length >= 3 && story.steps.every((s) => typeof s === 'string' && s.trim().length > 0),
    );
    check(`  Scene 컴포넌트 존재`, typeof story.Scene === 'function');
  }
  const extra = Object.keys(STORYBOARDS).filter((id) => !rules.some((r) => r.id === id));
  check('스토리보드에 규칙 외 잔여 항목 없음', extra.length === 0, extra.join(', '));

  // 2) 규칙 8종 패널 렌더 (애니메이션 모드 — 1단계 캡션 + 컨트롤)
  for (const rule of rules) {
    const zoneResult = {
      zone: 1, zone_name: '수도권',
      phenomenon: rule.then.phenomenon, cloud: rule.then.cloud,
      rule_id: rule.id, explain: rule.explain,
    };
    const html = render(h(CrossSectionPanel, { zoneResult }));
    const story = STORYBOARDS[rule.id];
    // ⚠️ 스토리보드가 없는 규칙에서 **여기서 죽지 않는다**(2026-08-18). 종전에는
    //    `story.steps`가 TypeError를 내며 파일 전체가 멈춰, 규칙 하나가 빠진 것이
    //    **뒤따르는 모든 검사를 못 돌게** 만들었다(실제로 4조건 규칙 3종이 붙었을 때
    //    이 파일이 통째로 죽었다). 누락 자체는 위 1)이 이미 FAIL로 세고 있으므로
    //    신호는 잃지 않는다 — 잃는 것은 나머지 검사뿐이었다.
    if (!story) continue;
    const okCaption = html.includes(story.steps[0]) && html.includes(`1/${story.steps.length}단계`);
    const okControls = html.includes('일시정지') && html.includes('다음 단계') && html.includes('단계 이동');
    const okExplain = html.includes(rule.explain.slice(0, 12));
    check(`패널 렌더: ${rule.id}`, okCaption && okControls && okExplain,
      `caption=${okCaption} controls=${okControls} explain=${okExplain}`);
  }

  // 3) reduced-motion 정적 렌더 — 최종 장면 + 단계 전체 목록
  {
    // 스토리보드가 **있는** 첫 규칙을 쓴다 — `rules[0]`은 시드 순서가 바뀌면 언제든
    // 스토리보드 없는 규칙이 되고(2026-08-18 실제로 그렇게 됐다), 그러면 이 검사가
    // 「단계 목록이 안 뜬다」가 아니라 TypeError로 죽어 뒤가 전부 안 돈다.
    const rule = rules.find((r) => STORYBOARDS[r.id]) ?? rules[0];
    const html = render(h(CrossSectionPanel, {
      zoneResult: { zone: 0, zone_name: '서해', phenomenon: rule.then.phenomenon, cloud: rule.then.cloud, rule_id: rule.id, explain: rule.explain },
      reduced: true,
    }));
    const story = STORYBOARDS[rule.id];
    check(
      'reduced-motion: 단계 텍스트 전체 목록 + 정적 표시 배지',
      story.steps.every((s) => html.includes(s)) && html.includes('정적 표시') && !html.includes('일시정지'),
    );
  }

  // 규칙 미성립 폴백 — 기본 안내 캡션
  {
    const html = render(h(CrossSectionPanel, {
      zoneResult: { zone: 0, zone_name: '서해', phenomenon: 'cloudy', cloud: 'cumulus', rule_id: null, explain: null },
    }));
    check('규칙 미성립 폴백 캡션', html.includes('아직 성립한 규칙이 없어요'));
  }

  // 4) AtmosphereBoard 통합 렌더 — 지도 오버레이 + 서버 확정 리플레이 경로
  {
    const boardMod = await server.ssrLoadModule('/src/modules/board/AtmosphereBoard.jsx');
    const qc = new QueryClient();
    const puzzle = {
      question_text: '수도권에 소나기를 만들어 보세요',
      initial_state: {
        elements: [
          { type: 'front', subtype: 'cold', zone: 1 },
          { type: 'air_mass', subtype: 'north_pacific', zone: 3 },
        ],
      },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: [],
    };
    const phenomena = [{ zone: 1, zone_name: '수도권', phenomenon: 'shower', cloud: 'cumulonimbus', rule_id: 'cold_front_shower', explain: rules[0].explain }];
    const html = render(
      h(QueryClientProvider, { client: qc }, h(boardMod.default, { puzzle, phenomena })),
    );
    check('지도: 인포그래픽 defs(wm-sea)·터뷸런스 구름 필터', html.includes('wm-sea') && html.includes('wm-cloud-turb'));
    check('지도: 기단 색 번짐 + 유동 화살표 흐름 대시', html.includes('wm-bloom-warm') && html.includes('animate-flow-dash'));
    check('지도: 주석 라벨(리더선 문구)', html.includes('소나기·번개'));
    check('지도: Canvas 강수 마운트(강수 존 존재 시)', html.includes('<canvas'));
    check('패널: 서버 확정 리플레이(✓ 서버 판정 배지 + 1단계 캡션)',
      html.includes('서버 판정') && html.includes(STORYBOARDS.cold_front_shower.steps[0]));
    check('노드 상호작용 유지(data-board-zone)', html.includes('data-board-zone'));

    // 강수 존이 없으면 canvas 미마운트(조건부 렌더)
    const htmlDry = render(
      h(QueryClientProvider, { client: new QueryClient() }, h(boardMod.default, { puzzle: { ...puzzle, initial_state: { elements: [] } } })),
    );
    check('지도: 강수 존 없으면 Canvas 미마운트', !htmlDry.includes('<canvas'));
  }

  // 5) PrecipCanvas SSR 가드
  {
    const fx = await server.ssrLoadModule('/src/modules/board/realisticEffects.jsx');
    const html = render(h(fx.PrecipCanvas, { emitters: [{ fx: 0, fy: 0, fw: 1, fh: 1, kind: 'rain' }] }));
    check('PrecipCanvas: SSR에서 <canvas> 마크업만 출력(window 미접근)', html.includes('<canvas'));
    const src = readFileSync(resolve(root, 'src/modules/board/realisticEffects.jsx'), 'utf-8');
    check('PrecipCanvas: typeof window 마운트 가드 존재', src.includes("typeof window === 'undefined'"));
  }

  // ── 6) **en 실렌더** — 심사위원이 보는 화면에 한국어가 남아 있지 않은가 (MT-28) ──
  //
  // 이 파일의 1~5는 전부 **로케일 ko 고정**이라(상단 localStorage 스텁) en 경로를
  // 한 번도 돌리지 않는다. 그래서 "키 패리티 통과 + ko 무회귀 통과"인데도 en 화면이
  // 통째로 한국어일 수 있고, MT-28 착수 시점이 정확히 그 상태였다(246줄).
  //
  // 실제로 이 검사가 **키 외부화만으로는 안 잡히는 것**을 잡았다: 존 이름 4종은
  // 서버 값(GET /board/regions·board_regions.json 시드)이라 리소스에 넣어도 화면에는
  // 서버 원문이 그려졌다. 표시 계층(zoneLabel)이 따로 필요했다.
  //
  // 검사 대상은 **태그를 벗긴 가시 텍스트**다 — 속성·주석·클래스명은 화면이 아니다.
  {
    // **왜 서버를 새로 띄우나**: i18n/core.js가 모듈 **로드 시점에** currentLocale을
    // 정하고, 위 검사들이 이미 ko로 적재해 뒀다. 로드 뒤에 스토어 setLocale로 바꿔도
    // 이미 만들어진 모듈 그래프의 초기값은 되돌아오지 않는다(실측: 절반만 en이 됐다).
    // 그래서 **fresh 그래프**를 하나 더 띄우고 그 그래프의 currentLocale을 en으로
    // 세운 뒤 화면 모듈을 적재한다.
    //
    // ⚠️ 2026-08-13(로케일 ko 고정) 전에는 localStorage 스텁을 'en'으로 갈아 끼웠다 —
    // 그때는 detectLocale()이 저장값을 읽었기 때문이다. 지금은 저장값도 navigator도
    // 보지 않고 항상 ko를 돌려주므로 그 방법은 **조용히 ko를 렌더**하고, 이 검사가
    // "한국어 0건"이 아니라 "전부 한국어"로 뒤집힌다. 그래서 en 적재 경로를
    // core.js의 `_syncLocale`(스토어 밖 소비자용 동기화 함수)로 바꿨다.
    // 화면 모듈 **적재 전에** 세워야 한다 — 모듈 최상위에서 값을 굳히는 표가 있다.
    const enServer = await createServer({
      // hmr:false — 두 번째 서버가 같은 HMR 포트(24678)를 잡으려다 경고를 뱉는다
      root, logLevel: 'error', appType: 'custom',
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    // 로케일은 **화면 모듈보다 먼저** 세운다. 순서가 계약이다:
    //   ① core.js를 적재하고 `_syncLocale('en')`으로 currentLocale을 en으로 놓는다.
    //   ② 그 다음 index.js를 적재한다 — zustand 스토어의 초기 locale이 core의
    //      currentLocale에서 오므로(§ src/i18n/index.js) 스토어도 en으로 생긴다.
    // ②가 ①보다 먼저면 스토어는 ko로 굳고 **되돌릴 수 없다**: zustand 5의 useStore는
    // SSR 스냅샷으로 `api.getInitialState()`를 넘기고(zustand/esm/react.mjs:9)
    // renderToString은 그 초기값만 본다 — setLocale로 나중에 바꿔도 훅 경로(useT)는
    // 안 따라온다. 원 주석의 "실측: 절반만 en이 됐다"가 정확히 그 절반이다.
    //
    // ⚠️ 2026-08-13(로케일 ko 고정) 전에는 localStorage 스텁을 'en'으로 갈아 끼웠다 —
    // detectLocale()이 저장값을 읽었기 때문이다. 지금은 저장값도 navigator도 보지
    // 않고 항상 ko라 그 방법은 **조용히 ko를 렌더**하고, 이 검사가 "한국어 0건"이
    // 아니라 "전부 한국어"로 뒤집힌다.
    const enCore = await enServer.ssrLoadModule('/src/i18n/core.js');
    enCore._syncLocale('en');
    const enI18n = await enServer.ssrLoadModule('/src/i18n/index.js');
    check('en 그래프 로케일 고정(스토어 밖 · 훅/SSR 스냅샷 양쪽)',
      enCore.getCurrentLocale() === 'en'
        && enI18n.useLocaleStore.getInitialState().locale === 'en',
      `${enCore.getCurrentLocale()} / ${enI18n.useLocaleStore.getInitialState().locale}`);
    const enPanel = await enServer.ssrLoadModule('/src/modules/board/CrossSectionPanel.jsx');
    const enBoard = await enServer.ssrLoadModule('/src/modules/board/AtmosphereBoard.jsx');
    const koWords = (html) => [
      ...new Set(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[가-힣]/.test(w))),
    ];

    let leaked = [];
    for (const rule of rules) {
      const html = render(h(enPanel.default, {
        zoneResult: { zone: 1, zone_name: 'Metro', phenomenon: rule.then.phenomenon,
                      cloud: rule.then.cloud, rule_id: rule.id, explain: 'X' },
      }));
      leaked.push(...koWords(html).map((w) => `${rule.id}:${w}`));
    }
    check(`en 단면 패널 ${rules.length}종에 한국어 0건`, leaked.length === 0, leaked.slice(0, 10).join(' '));

    const enPuzzle = {
      question_text: 'Make a shower over the metro area',
      initial_state: { elements: [
        { type: 'front', subtype: 'cold', zone: 1 },
        { type: 'air_mass', subtype: 'north_pacific', zone: 3 },
      ] },
      palette: ['front:cold', 'front:warm', 'front:stationary', 'air_mass:siberian',
                'air_mass:okhotsk', 'air_mass:yangtze', 'moisture', 'sun', 'wind'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }], hints: [],
    };
    const enHtml = render(h(QueryClientProvider, { client: new QueryClient() },
      h(enBoard.default, { puzzle: enPuzzle, phenomena: [{
        zone: 1, zone_name: 'Metro', phenomenon: 'shower', cloud: 'cumulonimbus',
        rule_id: 'cold_front_shower', explain: 'X' }] })));
    const boardLeak = koWords(enHtml);
    check('en 보드 전체(지도·팔레트·존 라벨)에 한국어 0건',
      boardLeak.length === 0, boardLeak.slice(0, 20).join(' '));

    // localStorage 스텁 되돌리기는 없다 — 더 이상 건드리지 않는다(위 주석 참고).
    // en 로케일은 enServer 전용 모듈 그래프 안에만 있으므로 서버를 닫으면 끝난다.
    await enServer.close();
  }

  // ── 7) 두 검사는 **서로 다른 것을 본다** — 병합이 한쪽을 밀어내지 않게 둘 다 둔다.
  //    위 6은 en 실렌더(MT-28), 아래는 좁은 화면 재배치(2026-08-11)다.

  // 7) wide 배치가 **좁은 화면에서 다시 줄을 선다** (2026-08-11)
  //
  // 보드 플레이는 lg에서만 2열이다. lg 미만에서는 두 열 래퍼를 `contents`로 지워
  // 블록들을 바깥 격자의 직계 칸으로 만들고 `order-*`로 다시 세운다 —
  // 그러지 않으면 「왼쪽 통째 → 오른쪽 통째」로 접혀 **판정이 지도 아래**로
  // 내려간다(시간 초과의 유일한 재도전 버튼이 화면 밖으로 나간다). 3열 시절에는
  // 오른쪽 열의 `order-first`가 이 일을 했는데 2열 개편에서 함께 사라졌다.
  // CSS 엔진이 없어 좌표로는 못 잰다 → 소스로 단정한다.
  {
    const src = readFileSync(resolve(root, 'src/modules/board/AtmosphereBoard.jsx'), 'utf-8');
    // wide 분기 **안쪽만** 본다 — 뒤따르는 stacked 배치에도 {verdictBlock}·
    // {hintBlock}이 있고 거기에는 순서·분기 클래스가 없는 것이 정상이다.
    // 끝은 stacked의 최상위 `return (`(들여쓰기 2칸)다.
    const wideStart = src.indexOf('if (wide) {');
    const stackedStart = src.indexOf('\n  return (', wideStart);
    check('wide 분기 경계를 찾았다', wideStart > 0 && stackedStart > wideStart);
    const body = src.slice(wideStart, stackedStart);
    const columns = (body.match(/className="contents lg:flex/g) ?? []).length;
    check(`wide: 좁은 화면에서 두 열 래퍼가 사라진다(contents ${columns}/2)`, columns === 2);
    // ⚠️ 여기 있던 「{verdictBlock}과 order-가 **같은 줄**에 있다」 단정은
    //    걷었다(2026-08-18). JSX가 두 줄로 나뉘자 바로 깨졌는데, 그때 바뀐 것은
    //    줄바꿈뿐이고 order는 멀쩡히 붙어 있었다 — **줄 단위로 보는 계약은
    //    서식에 걸려 넘어진다.** 같은 것을 아래 「order-3」 단정이 요소의
    //    className 전체를 읽어 더 정확하게 문다.

    // 「가이드」는 **열 안의 카드가 아니라 배너에서 여는 오버레이**다
    // (2026-08-12 사용자 지시 — 목표 진행 칩 자리를 가이드가 쓰고, 누르면
    // 회색 카드가 뜬다). 두 열이 같은 높이로 끝나는 배치라 어느 열에 카드를
    // 넣든 반대쪽에 ~150px 흰 자리가 생긴다(세 배치 실측). 열 안으로
    // 되돌리면 그 여백이 그대로 돌아온다.
    // ⚠️ indexOf를 그대로 slice에 넣지 말 것 — 격자 클래스를 조정하면 -1이 되고
    // slice(-1)은 **한 글자**가 돼 아래 단정이 영원히 공허하게 통과한다.
    const colsAt = body.indexOf('lg:grid-cols-[minmax(0,1.25fr)');
    check('wide: 두 열 격자를 찾았다', colsAt > 0);
    const colsBody = colsAt > 0 ? body.slice(colsAt) : '';
    check('wide: 가이드가 두 열 안에 카드로 있지 않다', colsAt > 0 && !colsBody.includes('guidePopover'));
    check('wide: 가이드 칩·카드가 배너 안에 있다', body.includes('{guideChip}') && body.includes('{guidePanel}'));
    // 카드는 **배너**(relative)에 매단다. 칩에 매달면 칩이 줄 어디에 있느냐에
    // 따라(목표 칩·타이머와 같이 뜨면 줄 가운데로 밀린다) 카드가 화면 밖으로
    // 나간다. 배너는 항상 화면 폭을 차지하므로 어느 조합에서도 안 넘친다.
    check('wide: 배너가 앵커(relative)다', /data-testid="board-mission-hero"[\s\S]{0,400}?className="relative /.test(src));

    // ── 오른쪽 열: 위에서부터 채운다 (2026-08-17 사용자 지시) ────────────────
    /**
     * "오른쪽 수도권-흐림 이거 상단으로 올려줘. 애니메이션 나오면 애니메이션은
     * 상단으로, 수도권 결과는 하단으로."
     *
     * 순서(애니메이션 → 결과)는 `CrossSectionPanel`이 구조로 갖는다 —
     * [단면 그림][캡션 상자]. 문제는 **정렬**이었다: 단면 카드가 `lg:flex-1`로
     * 왼쪽 열 높이만큼 늘어나는데 `justify-center`라 내용이 빈 카드 한복판에
     * 떠 있었다(규칙이 안 선 상태에서는 캡션 한 줄뿐이라 특히 그렇게 보였다).
     *
     * ⚠️ `lg:flex-1`은 **남아야 한다** — 두 열이 같은 높이로 끝나는 계약이
     * 거기 걸려 있다. 되돌아갈 수 있는 것은 `justify-center` 쪽이라 그것만 문다.
     */
    const sectionCard = src.match(/className="order-4 ([^"]*)"/)?.[1] ?? '';
    check(
      `wide: 단면 카드가 위에서부터 채운다 — "${sectionCard.slice(0, 56)}…"`,
      !/\bjustify-center\b/.test(sectionCard),
    );
    check(
      'wide: 단면 카드가 왼쪽 열 높이까지 늘어난다(두 열이 같이 끝난다)',
      /\blg:flex-1\b/.test(sectionCard),
    );
    // ── 카드 두 장만 셸 밖으로 넓힌다 (2026-08-18 사용자 지시) ──────────────
    /**
     * "상단바는 고정시키고 아래 보드/해설 카드 크기를 전체적으로 다 키워줘."
     *
     * 셸이 `md:max-w-6xl`(1152)이라 1536 화면에서 양옆 88px씩이 빈다. 지도·단면
     * 그림은 둘 다 `w-full`이라 **열 폭에 비례**하므로, 그 여백을 되찾는 것 말고는
     * 그림을 키울 방법이 없다(세로로만 늘리면 흰 여백만 는다). 실측 1536에서
     * 카드행 1120 → 1232 · 지도 401 → 464.
     *
     * 두 가지를 문다. 되돌아갈 수 있는 길이 둘이라서다:
     *  ⓐ **음수 마진이 `clamp(0px,…)`으로 막혀 있다.** 상한만 있고 하한이 없으면
     *     좁은 화면에서 계산이 음수가 되어 카드가 화면 밖으로 삐져나온다.
     *  ⓑ **미션 배너는 그 행 밖에 있다.** 안으로 들어가면 배너까지 같이 넓어져
     *     "상단바는 고정"이 깨진다. 눈으로는 두 값이 비슷해 잘 안 보인다.
     */
    const escapeCls = body.match(/className="(-mx-\[[^"]*?)\s+grid gap-4 lg:grid-cols/)?.[1] ?? '';
    check(
      `wide: 카드행이 셸 밖으로 남는 폭만큼 넓어진다 — "${escapeCls.slice(0, 40)}…"`,
      escapeCls.startsWith('-mx-[clamp(0px,'),
    );
    const heroAt = body.indexOf('data-testid="board-mission-hero"');
    const rowAt = body.indexOf('-mx-[clamp(0px,');
    check(
      'wide: 미션 배너는 넓어지는 행 **밖**에 있다(상단바 고정)',
      heroAt > 0 && rowAt > heroAt,
    );

    // ── 판정 결과가 **두 열을 가로지른다** (2026-08-18 사용자 지시) ─────────
    /**
     * "한반도 지도/애니메이션 카드 크기로 가로로 길게."
     *
     * 자리를 두 번 옮겼다. 오른쪽 열(단면 폭 500) → 왼쪽 열(보드 폭 676) →
     * **행 전체**(1232). 판정은 어느 한쪽 카드의 결과가 아니라 그 판 전체의
     * 결과라 행을 다 쓰는 쪽이 뜻에도 맞는다.
     *
     * 두 가지가 **함께** 있어야 성립한다 — 하나만 되돌아가면 폭이 조용히
     * 절반으로 줄고 에러는 안 난다:
     *  ⓐ `lg:col-span-2`
     *  ⓑ 두 열 래퍼 **밖**의 직계 격자 칸. 래퍼 안에 두면 col-span이 안 듣고
     *     그 열 폭에 갇힌다(왼쪽 열에 넣었던 판이 676에서 멈춘 이유가 그것).
     *
     * ⚠️ `order-3`도 남아야 한다. lg 미만에서는 두 열 래퍼가 `contents`라 이
     * 블록이 어차피 직계 칸이 되고, 좁은 화면 순서(조작 2 → 판정 3 → 단면 4)를
     * **그 숫자가** 정한다 — 자리를 옮겨도 좁은 화면은 안 바뀐다.
     */
    // ⚠️ **텍스트 순서로는 부족하다.** 「오른쪽 열 주석보다 뒤」는 래퍼 **안**에
    //    넣어도 참이라, 그 단정만으로는 col-span이 죽은 상태를 못 잡는다
    //    (실제로 그렇게 써 놓고 되살림 실험에서 통과해 버렸다). 들여쓰기로
    //    **격자의 직계 칸인지**를 본다 — 두 열 래퍼와 같은 칸이어야 한다.
    const indentOf = (needle) => {
      const at = body.indexOf(needle);
      if (at < 0) return -1;
      const lineStart = body.lastIndexOf('\n', at) + 1;
      return at - lineStart;
    };
    const colIndent = indentOf('<div className="contents lg:flex');
    const verdictIndent = indentOf('{hasVerdict &&');
    check(
      `wide: 판정 결과가 두 열 래퍼와 같은 칸(격자 직계)이다 — 열 ${colIndent} · 판정 ${verdictIndent}`,
      colIndent > 0 && verdictIndent === colIndent,
    );
    const verdictCls = body.match(/\{hasVerdict && \(?\s*<div className="([^"]*)"/)?.[1] ?? '';
    check(
      `wide: 판정 결과가 두 열을 가로지른다(lg:col-span-2) — 실제 "${verdictCls}"`,
      /\blg:col-span-2\b/.test(verdictCls),
    );
    check(
      `wide: 판정 결과가 좁은 화면 순서를 그대로 갖는다(order-3) — 실제 "${verdictCls}"`,
      /\border-3\b/.test(verdictCls),
    );
    // 판정이 붙어야 할 상대는 지도·단면 카드가 아니라 **바로 아래 이어지는
    // 「서버 판정 결과」와 3버튼**이다. 그쪽은 `BoardPage`가 격자 밖에서 그려
    // 셸 폭(1536에서 1120)이므로, 판정도 행의 음수 여백을 **양수로 되돌려**
    // 같은 폭으로 돌아온다(2026-08-18 사용자 지시). 실측 1280·1440·1536·1920
    // 네 폭 모두 성공 카드 · 서버 판정 결과 · 다음 퍼즐이 x·w 완전 일치.
    // ⚠️ **두 clamp 식이 글자까지 같아야 순수 상쇄다.** 상수로 빼서 템플릿
    //    문자열로 조립하면 Tailwind가 소스에서 못 찾아 **CSS가 아예 안 생긴다**
    //    — 그래서 일부러 두 번 적혀 있고, 그 짝을 여기서 문다.
    const rowEscape = escapeCls.replace(/^-mx-\[/, '').replace(/\]$/, '');
    const verdictMx = verdictCls.match(/(?:^|\s)mx-\[([^\]]*)\]/)?.[1] ?? '';
    check(
      `wide: 판정이 행의 넓힘을 정확히 되돌린다 — 행 "${rowEscape}" · 판정 "${verdictMx}"`,
      rowEscape.length > 10 && verdictMx === rowEscape,
    );

    // ── 현상 주석 상자가 이름표 띠 **위**에 산다 (2026-08-18 사용자 지시) ───
    /**
     * "카드가 지도랑 겹쳐. 수도권/영동·동해 글씨 사이로 상단에 배치해줘."
     *
     * ⚠️ **존에 상대적인 자리 잡기로는 못 고친다.** 이름표들이 저마다 다른
     * 높이에 흩어져 있어 한 존에서 비켜 놓으면 다른 존에서 다시 물린다 —
     * 실제로 두 번 고쳤고 두 번 다 다른 존에서 재발했다(수도권 → 영서·태백).
     * 그래서 상자를 **지도 맨 위 띠에 고정**한다: `ly`가 상수라야 한다.
     *
     * 이름표 y(userSpace = label_anchor × VIEW_H/100):
     *   수도권 17.1 · 영동·동해 22.5 · 서해상 46.9 · 영서·태백 47.8
     * 글자 높이를 감안한 **가장 높은 이름표 윗변이 13.8**이고, 2줄 상자 높이는
     * 11.8이다. 그래서 `ly + boxH ≤ 13.8`, 즉 `ly ≤ 2`면 어느 존을 가리켜도
     * 안 닿는다. 실측(1536)으로 네 존 전부 겹침 0 — 상자 y 228~282.
     *
     * jsdom에는 CSS 엔진이 없어 좌표로 못 재므로 소스로 문다. 이름표 y는
     * `boardLayout`이 소유하므로 **거기서 읽어** 상수와 대조한다 — 지도가
     * 바뀌어 이름표가 더 위로 올라가면 이 단정이 먼저 운다.
     */
    const anno = readFileSync(resolve(root, 'src/modules/board/mapInfographic.jsx'), 'utf8');
    const lyLine = anno.match(/const ly = (\d+(?:\.\d+)?);/);
    check(
      `주석 상자 y가 상수다 — 존 위치를 따라가면 다시 겹친다. 실제 ly=${lyLine?.[1]}`,
      lyLine != null,
    );
    const layout = readFileSync(resolve(root, 'src/modules/board/boardLayout.js'), 'utf8');
    const viewH = Number(layout.match(/export const VIEW_H = (\d+)/)?.[1]);
    const anchors = [...layout.matchAll(/label_anchor: \[[\d.]+, ([\d.]+)\]/g)].map((m) => Number(m[1]));
    check(`이름표 앵커를 읽었다(${anchors.length}개) · VIEW_H=${viewH}`, anchors.length >= 4 && viewH > 0);
    // 글자 윗변 ≈ 기준선 − 3.3(fontSize 3.6 실측). 2줄 상자 높이 = 2*4.6+2.6.
    const topLabel = Math.min(...anchors) * (viewH / 100) - 3.3;
    const boxH2 = 2 * 4.6 + 2.6;
    check(
      `상자가 가장 높은 이름표(윗변 ${topLabel.toFixed(1)})보다 위에서 끝난다 — ly ${lyLine?.[1]} + 높이 ${boxH2}`,
      Number(lyLine?.[1]) + boxH2 <= topLabel,
    );

    // 순서의 소유자는 패널이다 — 그림이 캡션보다 **위**에 있는지 소스로 확인한다.
    const panel = readFileSync(resolve(root, 'src/modules/board/CrossSectionPanel.jsx'), 'utf8');
    const sceneAt = panel.indexOf('{useGL ? (');
    const captionAt = panel.indexOf('<div className="bg-white px-3 py-2">');
    check(
      'wide: 애니메이션이 수도권 결과보다 위에 온다(CrossSectionPanel 순서)',
      sceneAt > 0 && captionAt > 0 && sceneAt < captionAt,
    );
    // 떠 있는 카드는 **격자 높이에 영향을 주지 않아야** 한다 — absolute가 빠지면
    // 배너가 카드만큼 늘어나 단면이 밀린다.
    check('wide: 가이드 카드가 absolute로 떠 있다', /id="board-guide-panel"[\s\S]{0,900}?absolute/.test(src));
    // 폰은 배너 폭을 꽉 채우고(left-4 right-4), sm↑는 배너 오른쪽에 320px.
    // 칩 기준(left-0/right-0)으로 되돌리면 칩 위치에 따라 화면을 넘는다.
    const popoverClass = src.match(/id="board-guide-panel"[\s\S]{0,900}?className="([^"]*)"/)?.[1] ?? '';
    check(
      `가이드 카드: 폰은 배너 폭, sm↑는 오른쪽 고정폭 — "${popoverClass.slice(0, 64)}…"`,
      /(^|\s)left-4(\s|$)/.test(popoverClass)
        && /(^|\s)right-4(\s|$)/.test(popoverClass)
        && /(^|\s)sm:right-4(\s|$)/.test(popoverClass)
        && /(^|\s)sm:w-\[/.test(popoverClass),
    );

    // 힌트는 조절값 열 아래에 **한 번만** 그려진다. 좁은 화면용을 따로 두고
    // CSS로 감추면 BoardHintPanel이 두 개 마운트돼 data-testid가 중복된다.
    const hintLines = body.split('\n').filter((l) => l.includes('{hintBlock}'));
    check(`wide: 힌트 인스턴스가 하나다(${hintLines.length}곳)`, hintLines.length === 1);
  }

  // ── 8) **SVG 폴백이 WebGL과 같은 뜻을 그린다** — 산불엔 산, 홍수엔 도시 (MT-23) ──
  //
  // 왜 이 검사가 있나: MT-23이 WebGL 단면 2종을 조사 문법으로 다시 세우는 동안
  // SVG 스토리보드는 범위 밖이라 **옛 표현으로 남았다**(산 없음·도시 없음). 그런데
  // 이 SVG는 장식이 아니라 **WebGL2 미지원 기기·SSR 첫 렌더·reduced-motion 세 경로가
  // 실제로 보는 화면**이다(CrossSectionPanel 머리 주석). 표현 격차는 조용하다 —
  // 3D가 멀쩡하면 아무도 폴백을 안 본다.
  //
  // 🔴 **무엇을 재고 무엇을 못 재는가** (이 구분이 이 절의 핵심이다)
  //  잰다  — SSR 문자열에 **선언된 좌표 사이의 관계**. 산이 지면 위로 솟았는가 ·
  //          화선이 그 비탈 **선 위에** 있는가 · 위로 갈수록 큰가(불머리) ·
  //          비화가 능선 **너머**인가 · 건물이 포장면 위에 서 있는가 ·
  //          투수면과 포장면이 **겹치지 않는가** · 3단계 수위가 도로 **위로**
  //          올라왔는가 · 빗물받이 화살표가 2→3단계에 **아래→위로 뒤집히는가**.
  //  못 잰다 — jsdom·SSR에는 **레이아웃/CSS 엔진이 없다**: 라벨끼리 겹치는지,
  //          글자가 읽히는지, 무엇이 무엇을 가리는지(z-order·불투명도 합성),
  //          색 대비, 애니메이션 타이밍, 「보기 좋은가」. 그건 사람이 봐야 한다.
  //          en 문자열이 ko보다 길어 라벨이 부딪히는 것도 여기서 안 잡힌다.
  //
  // 창은 `data-cs*` 속성 하나뿐이고, 그 수치는 도형을 만드는 상수와 **같은 값**이다
  // (CrossSectionPanel의 프리미티브가 단일 소유). 그래서 도형을 옮기면 수치도 같이
  // 움직인다 — 속성만 맞춰 놓고 그림을 되돌리는 우회가 안 된다.
  //
  // ⚠️ 공허 통과 방지: 관계를 묻기 **전에** 파싱 개수를 먼저 단정한다. data-cs 이름을
  //    오타 내거나 요소를 지우면 「관계가 참인 표본이 0개」로 조용히 통과하는 대신
  //    개수 단정이 먼저 운다.
  {
    // 단계별 장면을 **직접** 렌더한다 — 위 2)의 패널 렌더는 step 0에만 닿는다.
    const sceneAt = (ruleId, step) =>
      render(h(STORYBOARDS[ruleId].Scene, { step, animate: false }));
    /** data-cs="<kind>"를 단 요소들의 속성 표 — 값은 숫자면 숫자로 */
    const marks = (html, kind) =>
      [...html.matchAll(/<[a-z]+\s[^>]*data-cs="([^"]+)"[^>]*>/g)]
        .filter((m) => m[1] === kind)
        .map((m) => {
          const attrs = {};
          for (const a of m[0].matchAll(/data-cs-([a-z0-9-]+)="([^"]*)"/g)) {
            const n = Number(a[2]);
            attrs[a[1]] = Number.isFinite(n) && a[2].trim() !== '' ? n : a[2];
          }
          return attrs;
        });

    // ── 산불: 산이 보이고, 화선이 비탈 위에 있고, 위로 갈수록 크다 ──────────
    const wfTerrain = sceneAt('wildfire_risk_dry_gale', 0);
    const [mt] = marks(wfTerrain, 'mountain');
    check('산불: 산 단면(mountain)을 하나 그린다', Boolean(mt), '없으면 아래 관계 단정이 전부 공허해진다');
    if (mt) {
      // y는 아래로 증가한다 — 정상이 두 기슭보다 **위**(작은 y)에 있어야 산이다.
      check(
        `산불: 정상이 두 기슭보다 위로 솟았다 — 정상 y=${mt.ay} · 서 ${mt.wy} · 동 ${mt.ey}`,
        mt.ay < mt.wy - 20 && mt.ay < mt.ey - 20,
      );
      check(
        `산불: 두 기슭이 지면(y=118)에 닿는다 — 서 ${mt.wy} · 동 ${mt.ey}`,
        Math.abs(mt.wy - 118) < 0.6 && Math.abs(mt.ey - 118) < 0.6,
      );
    }
    const wfTrees = marks(wfTerrain, 'tree');
    check(`산불: 숲을 그린다(나무 ${wfTrees.length}그루)`, wfTrees.length >= 4);
    // 산 위의 숲인가 — 나무 밑동이 비탈 선 위에 있는지. 서쪽 비탈 y = 118 − 64·h(fx),
    // 화면 x = 26 + 188·fx 이므로 기울기만으로 검산한다(장면 상수를 테스트가 다시
    // 적으면 드리프트하므로, **정상·기슭 좌표에서 직선을 세워** 대조한다).
    const onWestSlope = (x) => (mt ? mt.wy + ((mt.ay - mt.wy) * (x - mt.wx)) / (mt.ax - mt.wx) : NaN);
    const treesOnSlope = wfTrees.filter((t) => t.x > (mt?.wx ?? 0) && Math.abs(t.y - onWestSlope(t.x)) < 1.5);
    check(
      `산불: 나무가 **비탈 위**에 서 있다(${treesOnSlope.length}/${wfTrees.length}그루가 능선 선상)`,
      treesOnSlope.length >= 3,
      wfTrees.map((t) => `x${t.x}:y${t.y}≠${onWestSlope(t.x).toFixed(1)}`).join(' '),
    );

    const wfFire = sceneAt('wildfire_risk_dry_gale', 2);
    const heads = marks(wfFire, 'flame').filter((f) => f.role === 'front').sort((a, b) => a.x - b.x);
    check(`산불: 화선을 이루는 불꽃이 여럿이다(${heads.length}개)`, heads.length >= 3);
    if (heads.length >= 3 && mt) {
      const off = heads.map((f) => Math.abs(f.y - onWestSlope(f.x)));
      check(
        `산불: 화선이 **비탈 위**에 있다 — 능선 선과의 차 [${off.map((d) => d.toFixed(2)).join(', ')}]`,
        off.every((d) => d < 1.5),
      );
      check(
        `산불: 위로 갈수록 불이 커진다(불머리) — 높이 [${heads.map((f) => f.h).join(', ')}]`,
        heads.every((f, i) => i === 0 || f.h > heads[i - 1].h),
      );
      check(
        `산불: 불이 비탈을 오른다(x가 커질수록 위) — y [${heads.map((f) => f.y).join(', ')}]`,
        heads.every((f, i) => i === 0 || f.y < heads[i - 1].y),
      );
    }
    const spot = marks(wfFire, 'flame').filter((f) => f.role === 'spot');
    check(`산불: 비화가 놓은 새 불이 있다(${spot.length}개)`, spot.length >= 1);
    check(
      `산불: 새 불이 **능선 너머**다 — 비화 x=${spot[0]?.x} · 정상 x=${mt?.ax}`,
      Boolean(mt) && spot.length >= 1 && spot[0].x > mt.ax,
    );

    const wfCrown = sceneAt('wildfire_risk_dry_gale', 3);
    const crown = marks(wfCrown, 'flame').filter((f) => f.role === 'crown');
    check(`산불: 4단계에 수관화가 있다(${crown.length}개)`, crown.length >= 1);
    check(
      `산불: 수관화가 지표보다 **나무 높이만큼 위**다 — ${crown.map((f) => `${(onWestSlope(f.x) - f.y).toFixed(1)}px`).join(' ')}`,
      Boolean(mt) && crown.length >= 1 && crown.every((f) => onWestSlope(f.x) - f.y >= 6),
    );
    // 4단계 캡션이 「구름 한 점 없이 맑지만」이다 — 구름을 그리면 캡션과 충돌한다.
    // 좌표로는 「구름이 없음」을 못 재므로(없는 것에는 data-cs가 안 붙는다) 소스로 문다.
    const panelSrc = readFileSync(resolve(root, 'src/modules/board/CrossSectionPanel.jsx'), 'utf8');
    const wfBody = panelSrc.slice(
      panelSrc.indexOf('function WildfireRiskScene'),
      panelSrc.indexOf('// 홍수 지형'),
    );
    check('산불 장면 본문을 찾았다', wfBody.length > 400);
    const cloudy = ['PuffCloud', 'LayerCloud', 'CbTower', 'CSRain', 'CSSnow'].filter((n) => wfBody.includes(n));
    check(
      `산불: 어떤 구름·강수도 그리지 않는다(4단계 캡션 「구름 한 점 없이 맑지만」) — 발견 [${cloudy.join(', ')}]`,
      cloudy.length === 0,
    );

    // ── 산불 **경보급**: 캡션이 말하는 「번짐」이 화면에서 일어나는가 (MT-23 3차) ──
    //
    // 2026-08-19 클라이언트: *"「작은 불씨 하나가 바람을 타고 순식간에 번져요」
    // 이 부분이 주황색 타원으로만 설명하는 게 너무 빈약해"*. 이 저장소에서 **세
    // 번째** 같은 유형이다(홍수가 「잠긴다」면서 안 잠갔고, 첫 판 태풍 단면은
    // 「태풍」이라면서 그림이 0개였다). 그래서 판정 기준은 「요소를 추가했다」가
    // 아니라 **「말하는 현상이 화면에서 일어나는가」**다.
    //
    // 🔴 **무엇이 있으면 「번졌다」로 치는가** — 개수만 세면 **자리가 틀려도 통과**한다
    //    (PM이 홍수에서 밟은 함정이 그 자리다: 「일부 잠김」을 중심으로 재서 앞줄
    //    5채 중 4채가 빠졌다). 그래서 **셋이 이어져 있을 때만** 번진 것으로 친다:
    //      ① 출발 — 작은 불씨 하나(role="source")
    //      ② 경로 — 그 불에서 **출발**해 바람 아래로 가는 불티(data-cs="ember")
    //      ③ 도착 — 그 경로가 **끝나는 자리에** 붙은 새 불(role="spot") 여럿
    //    ②의 시작이 ①에 붙어 있고 ②의 끝이 ③의 범위 안이라는 것까지 재야
    //    「불씨가 날아가 거기에 불을 놓았다」가 된다.
    //
    // 🔴 **방향은 손으로 적지 않는다.** 「동쪽」이라고 쓰면 장면이 좌우 반전돼도
    //    테스트가 같이 틀린다. 1단계 활강풍 화살표(data-cs="wind")에서 부호를 캐
    //    **그 부호와 같은지**를 묻는다 — 종전 판이 정확히 이걸 어겼다(불티가
    //    `cx = 168 − 17i`로 바람을 거슬러 날아 **틀린 것을 가르치고 있었다**).
    const sgw = sceneAt('siberian_gale_wildfire', 3);
    const [sgWind] = marks(sceneAt('siberian_gale_wildfire', 1), 'wind');
    const sgSrc = marks(sgw, 'flame').filter((f) => f.role === 'source');
    const sgSpots = marks(sgw, 'flame').filter((f) => f.role === 'spot').sort((a, b) => a.x - b.x);
    const [sgEmber] = marks(sgw, 'ember');
    // 공허 통과 방지 — 관계를 묻기 **전에** 파싱 개수를 단정한다.
    check('산불 경보급: 활강풍 화살표(wind)를 찾았다', Boolean(sgWind), '없으면 아래 방향 단정이 전부 공허해진다');
    check(`산불 경보급: 출발한 불씨가 하나다(source ${sgSrc.length}개)`, sgSrc.length === 1, '캡션이 「작은 불씨 하나」다');
    check(`산불 경보급: 비화 경로(ember)를 찾았다`, Boolean(sgEmber));
    check(`산불 경보급: 도착한 새 불이 여럿이다(spot ${sgSpots.length}개)`, sgSpots.length >= 3);
    if (sgWind && sgSrc.length === 1 && sgEmber && sgSpots.length >= 3) {
      const [src] = sgSrc;
      const downwind = Math.sign(sgWind.x2 - sgWind.x1); // 장면에서 캔 부호
      check(
        `산불 경보급: 불티가 **바람을 타고** 간다 — 바람 ${sgWind.x1}→${sgWind.x2} · 불티 ${sgEmber.x1}→${sgEmber.x2}`,
        Math.sign(sgEmber.x2 - sgEmber.x1) === downwind,
        '부호가 어긋나면 「바람을 타고 번진다」를 그림이 정반대로 가르친다.',
      );
      check(
        `산불 경보급: 불티가 **그 불에서** 출발한다 — 불 x=${src.x} · 경로 시작 x=${sgEmber.x1}`,
        Math.abs(sgEmber.x1 - src.x) <= 10,
        '출발이 불에 안 붙어 있으면 「불씨 하나가」가 아니라 떠도는 화살표다.',
      );
      check(
        `산불 경보급: 새 불이 전부 **바람 아래**다 — 불 x=${src.x} · 새 불 x [${sgSpots.map((f) => f.x).join(', ')}]`,
        sgSpots.every((f) => Math.sign(f.x - src.x) === downwind),
      );
      check(
        `산불 경보급: 불티가 **떨어진 자리에** 새 불이 있다 — 경로 끝 x=${sgEmber.x2} · 새 불 범위 [${sgSpots[0].x}, ${sgSpots[sgSpots.length - 1].x}]`,
        sgEmber.x2 >= sgSpots[0].x - 12 && sgEmber.x2 <= sgSpots[sgSpots.length - 1].x + 12,
        '경로의 끝과 새 불이 따로 놀면 「거기에 불을 놓았다」가 성립하지 않는다.',
      );
      check(
        `산불 경보급: 새 불이 전부 지표에 선다 — y [${sgSpots.map((f) => f.y).join(', ')}] (불씨 y=${src.y})`,
        sgSpots.every((f) => Math.abs(f.y - src.y) < 0.6),
        '개수만 세면 하늘에 뜬 불꽃도 통과한다.',
      );
      check(
        `산불 경보급: 번진 거리가 실재한다 — ${(sgSpots[sgSpots.length - 1].x - src.x).toFixed(1)}px`,
        Math.abs(sgSpots[sgSpots.length - 1].x - src.x) >= 40,
      );
      // 탈 것이 있어야 「불이 붙었다」가 성립한다 — 풍하쪽 숲
      const sgTrees = marks(sceneAt('siberian_gale_wildfire', 1), 'tree')
        .filter((t) => Math.sign(t.x - src.x) === downwind);
      check(`산불 경보급: 바람 아래에 탈 것(숲)이 있다(${sgTrees.length}그루)`, sgTrees.length >= 3);
    }
    // 경보급이 위험급보다 **세다** — 빈약하면 두 단계가 뒤집혀 읽힌다.
    // 크기가 아니라 **새 불의 수**로 센다(크기는 손보면 흔들리고 수는 현상이다).
    check(
      `산불: 경보급의 새 불(${sgSpots.length})이 위험급(${spot.length})보다 많다 — 등급 역전 방지`,
      sgSpots.length > spot.length,
    );

    // ── 홍수: 도시 단면이고, 포장면 ↔ 투수면 대비가 있고, 물이 도로 위로 오른다 ──
    const flTerrain = sceneAt('flood_risk_saturated_inflow', 0);
    const [paved] = marks(flTerrain, 'paved');
    const [perv] = marks(flTerrain, 'pervious');
    check('홍수: 포장면과 투수면을 둘 다 그린다', Boolean(paved) && Boolean(perv));
    if (paved && perv) {
      check(
        `홍수: 두 면이 겹치지 않는다(대비가 성립한다) — 투수 [${perv.x0}, ${perv.x1}] · 포장 [${paved.x0}, ${paved.x1}]`,
        perv.x1 <= paved.x0 && perv.x1 - perv.x0 > 8,
      );
    }
    const blds = marks(flTerrain, 'building');
    check(`홍수: 도시를 이루는 건물이 여럿이다(${blds.length}동)`, blds.length >= 6);
    check(
      `홍수: 건물이 **포장면 위**에 있다(투수면 위엔 없다) — x [${blds.map((b) => b.x).join(', ')}]`,
      Boolean(paved) && blds.length > 0 && blds.every((b) => b.x >= paved.x0 && b.x <= paved.x1),
    );
    const front = blds.filter((b) => b.row === 'front');
    check(
      `홍수: 앞줄 건물이 도로면(y=${paved?.y})에 서 있다 — base [${front.map((b) => b.base).join(', ')}]`,
      front.length >= 3 && Boolean(paved) && front.every((b) => Math.abs(b.base - paved.y) < 0.6),
    );
    check(
      `홍수: 앞줄·뒷줄 두 줄이라 그 사이가 「거리」로 읽힌다 — 앞 ${front.length} · 뒤 ${blds.length - front.length}`,
      front.length >= 3 && blds.length - front.length >= 3,
    );
    const [drain] = marks(flTerrain, 'drain');
    const [base] = marks(flTerrain, 'basement');
    check('홍수: 빗물받이와 지하를 그린다', Boolean(drain) && Boolean(base));
    check(
      `홍수: 지하가 지표(118) **아래**다 — 지하 윗면 y=${base?.top}`,
      Boolean(base) && base.top > 118,
    );

    // 「용량 초과」를 사건으로 보이는 것이 이 그림의 요점이다(조사 §3F):
    // 같은 빗물받이에서 화살표가 2단계 **아래**(삼킨다) → 3단계 **위**(역류)로 뒤집힌다.
    const swallow = marks(sceneAt('flood_risk_saturated_inflow', 2), 'drain-flow');
    const backup = marks(sceneAt('flood_risk_saturated_inflow', 3), 'drain-flow');
    check(`홍수: 2·3단계 모두 빗물받이 화살표가 있다(${swallow.length}·${backup.length})`,
      swallow.length >= 1 && backup.length >= 1);
    check(
      `홍수: 빗물받이가 2단계엔 삼키고 3단계엔 역류한다 — ${swallow[0]?.dir} → ${backup[0]?.dir}`,
      swallow[0]?.dir === 'down' && backup[0]?.dir === 'up',
    );
    check(
      `홍수: 두 화살표가 **같은 빗물받이**다 — x ${swallow[0]?.x} · ${backup[0]?.x}`,
      swallow.length >= 1 && backup.length >= 1 && Math.abs(swallow[0].x - backup[0].x) < 0.6,
    );
    const soak = marks(sceneAt('flood_risk_saturated_inflow', 2), 'soak-flow');
    check(
      `홍수: 투수면은 아직 스민다(아래 화살표 ${soak.length}개, dir=${soak[0]?.dir})`,
      soak.length >= 1 && soak[0].dir === 'down'
        && Boolean(perv) && soak[0].x >= perv.x0 - 6 && soak[0].x <= perv.x1 + 6,
    );

    const flFull = sceneAt('flood_risk_saturated_inflow', 3);
    const [surf] = marks(flFull, 'water-surface');
    const [soil] = marks(flFull, 'water-soil');
    const [bwater] = marks(flFull, 'water-basement');
    check('홍수: 4단계에 지표수·땅속물·지하실물이 다 있다', Boolean(surf) && Boolean(soil) && Boolean(bwater));
    check(
      `홍수: 수위가 도로면 **위**로 올라왔다 — 수면 y=${surf?.top} · 도로 y=${paved?.y}`,
      Boolean(surf) && Boolean(paved) && surf.top < paved.y - 4,
    );
    check(
      `홍수: 지하부터 잠긴다(지하실 물이 지하 칸 안에 있다) — 물 ${bwater?.top} · 칸 ${base?.top}`,
      Boolean(bwater) && Boolean(base) && Math.abs(bwater.top - base.top) < 0.6,
    );
  }

  // 7) 좁은 칸에 놓인 힌트는 캐릭터를 **위로 쌓는다** (2026-08-12)
  //
  // wide의 힌트는 168px 조절값 열 아래에 붙는다. 가로 배치면 마스코트 44 +
  // 간격 8 + 말풍선 안여백 24를 빼고 글자 폭이 92px만 남아 두 단짜리 힌트가
  // 리본이 된다. 세션 안 보드(stacked)는 칸이 넓어 종전 가로 배치 그대로다.
  {
    const panel = await server.ssrLoadModule('/src/modules/board/BoardHintPanel.jsx');
    const props = { steps: ['첫 단계 문구', '둘째 단계 문구'], level: 2, kindLabels: ['일사'] };
    const stacked = render(h(panel.default, { ...props, stack: true }));
    const inline = render(h(panel.default, props));
    check('힌트: stack이면 세로로 쌓는다', /data-hint-stacked="1"/.test(stacked) && /flex-col/.test(stacked));
    check('힌트: 기본은 가로 배치 그대로', /data-hint-stacked="0"/.test(inline) && !/flex-col/.test(inline));
    check('힌트: 두 배치 모두 본문 문구는 같다', ['첫 단계 문구', '둘째 단계 문구', '일사']
      .every((s) => stacked.includes(s) && inline.includes(s)));

    const board = readFileSync(resolve(root, 'src/modules/board/AtmosphereBoard.jsx'), 'utf-8');
    check('힌트: wide에서만 stack을 켠다', /stack=\{wide\}/.test(board));
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 보드 비주얼 SSR 렌더 스모크 통과');

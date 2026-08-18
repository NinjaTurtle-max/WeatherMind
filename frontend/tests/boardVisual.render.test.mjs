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
    const okCaption = html.includes(story.steps[0]) && html.includes(`1/${story.steps.length}단계`);
    const okControls = html.includes('일시정지') && html.includes('다음 단계') && html.includes('단계 이동');
    const okExplain = html.includes(rule.explain.slice(0, 12));
    check(`패널 렌더: ${rule.id}`, okCaption && okControls && okExplain,
      `caption=${okCaption} controls=${okControls} explain=${okExplain}`);
  }

  // 3) reduced-motion 정적 렌더 — 최종 장면 + 단계 전체 목록
  {
    const rule = rules[0];
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
    const verdictLine = body.split('\n').find((l) => l.includes('{verdictBlock}') && l.includes('order-'));
    check('wide: 판정 블록이 좁은 화면 순서를 갖는다(order-*)', Boolean(verdictLine));

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

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
    // 그래서 localStorage 스텁을 en으로 갈고 **fresh 그래프**를 하나 더 띄운다 —
    // 실제 심사 동선(en으로 처음 여는 브라우저)과 같은 조건이다.
    const prevStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (k === 'weathermind.locale' ? 'en' : null),
      setItem() {}, removeItem() {},
    };
    // hmr:false — 두 번째 서버가 같은 HMR 포트(24678)를 잡으려다 경고를 뱉는다
    const enServer = await createServer({
      root, logLevel: 'error', appType: 'custom',
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
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

    await enServer.close();
    globalThis.localStorage = prevStorage;
  }
} finally {
  await server.close();
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log('OK: 보드 비주얼 SSR 렌더 스모크 통과');

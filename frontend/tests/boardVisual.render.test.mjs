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

  // 6) wide 배치가 **좁은 화면에서 다시 줄을 선다** (2026-08-11)
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

    // 「가이드」 카드는 wide에서 **없어야 한다**(2026-08-12 사용자 지시 —
    // "오른쪽 하단 가이드는 없애고 애니메이션/해설이 더 집중될 수 있게").
    // 되살리면 오른쪽 열 세로를 다시 먹어 이번에 키운 단면이 도로 작아진다.
    check('wide: 가이드 카드가 없다', !src.includes('guidePanel'));

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

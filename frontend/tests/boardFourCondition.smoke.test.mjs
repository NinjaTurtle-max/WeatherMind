/**
 * 4조건 성취 표시 SSR 스모크 (2026-08-20) —
 *   node tests/boardFourCondition.smoke.test.mjs
 *
 * # 이 테스트가 존재하는 이유
 *
 * board_rules.json의 **4조건 규칙**은 이 게임에서 낼 수 있는 최고 성취다. 조건이
 * 2개인 지름길 규칙으로는 만들 수 없고(그래서 `board_engine.py`가 고유 결과 이름을
 * 따로 뒀다 — PHENOMENA 주석 ㉣), 가르치려는 요소를 **실제로 놓아야만** 난다.
 * 그런데 화면은 그것을 **아무 말도 하지 않았다**: 4조건으로 낸 통과와 2조건 지름길로
 * 낸 통과가 「🎉 성공!」 한 줄로 글자까지 같았다. 최고 성취를 내고도 학습자가 그 사실을
 * 모르는 상태였다.
 *
 * 🔴 **채점은 한 글자도 안 바뀐다.** 표시가 읽는 `rule_id`는 엔진이 이미 정한 값이고,
 * 이 테스트도 `passed`를 만들어 넣을 뿐 판정을 다시 돌리지 않는다. 여기서 지키는 것은
 * **판정 결과가 화면까지 도달하는가** 하나다.
 *
 * # 계약 2건과, 왜 「실패 판」이 반증이 아닌가
 *
 *   ⓐ 4조건 규칙으로 통과한 판에서 표시가 **뜬다**
 *   ⓑ 3조건 이하 규칙으로 통과한 판에서는 **안 뜬다**
 *
 * ⚠️ ⓑ의 대조군을 **미통과 판으로 두면 안 된다.** 미통과 판은 배지가 아니라 성공
 * 배너 전체가 없으므로 「안 뜬다」가 저절로 참이 되어 아무것도 못 지킨다. 가르는
 * 힘은 **통과했는데 4조건이 아닌 판**에서만 나온다 — 그래서 ⓑ는 2조건
 * `cold_front_shower`로 통과한 판이다.
 *
 * ⚠️ 그리고 판별이 **현상 이름 목록이 아님**을 함께 문다(④). 경보급 5종만 열거하면
 * `nocturnal_inversion_haze`를 놓친다 — 조건이 4개인데 결과는 평범한 `fog`다.
 * 그 한 건이 목록 방식과 조건 세기 방식을 가르는 유일한 지점이라 반드시 재료로 쓴다.
 *
 * 관례는 boardVisual.render.test.mjs와 같다(vite ssrLoadModule + renderToString,
 * 로케일 ko 고정). 규칙은 합성하지 않고 **실 seed**(database/seed/board_rules.json)에서
 * 읽는다 — 합성 규칙 위에서 초록인 채 실 규칙이 바뀌는 것이 이 저장소가 가장 크게
 * 기록한 실패 유형이다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'production';

// 로케일 고정(ko) — boardVisual.render.test.mjs와 같은 이유. node에 localStorage가
// 없고 CI 러너의 navigator.language는 en-US라, 고정 없이는 CI에서만 en으로 렌더된다.
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

const GOAL_ZONE = 1;
const ZONE_NAMES = ['서해', '수도권', '태백산맥', '동해안'];

/** 규칙 하나가 목표 존에서 발화한 서버 판정(phenomena)을 만든다 — 서버 형태와 동일. */
function verdictFor(ruleId) {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`실 규칙에 ${ruleId}가 없다 — 재료가 사라졌다`);
  return ZONE_NAMES.map((zone_name, zone) =>
    zone === GOAL_ZONE
      ? { zone, zone_name, ...rule.then, rule_id: rule.id, explain: rule.explain }
      : { zone, zone_name, phenomenon: 'cloudy', cloud: 'cumulus', rule_id: null, explain: null },
  );
}

try {
  const boardMod = await server.ssrLoadModule('/src/modules/board/AtmosphereBoard.jsx');
  const AtmosphereBoard = boardMod.default;
  const { fourConditionRule, conditionLabel } = boardMod;

  // ── 재료 실측 — 합성이 아니라 실 규칙 파일이 이 계약을 지탱하는지부터 센다 ──
  const fourCond = rules.filter((r) => (r.when ?? []).length === 4);
  const shortCond = rules.filter((r) => (r.when ?? []).length <= 3);
  check(
    `실 규칙에 4조건 ${fourCond.length}종 · 3조건 이하 ${shortCond.length}종 (양쪽 다 있어야 계약이 공허하지 않다)`,
    fourCond.length > 0 && shortCond.length > 0,
  );
  // 🔴 목록 방식과 조건 세기 방식을 가르는 그 한 건 — 사라지면 ④가 공허해진다.
  const plainOutcome = fourCond.filter((r) => !/warning|storm|typhoon|tropical_night/.test(r.then.phenomenon));
  check(
    `4조건인데 결과가 경보급이 아닌 규칙이 있다(${plainOutcome.map((r) => `${r.id}→${r.then.phenomenon}`).join(', ')})`,
    plainOutcome.length > 0,
    '현상 이름 목록으로 판별해도 통과해 버린다 — ④가 아무것도 못 지킨다',
  );

  function boardHtml({ ruleId, passed }) {
    const qc = new QueryClient();
    // 규칙은 useQuery(['board','rules'])로 들어온다 — SSR에서는 캐시에 심어 준다.
    qc.setQueryData(['board', 'rules'], rules);
    const rule = rules.find((r) => r.id === ruleId);
    const puzzle = {
      question_text: '수도권에 목표 현상을 만들어 보세요',
      initial_state: { elements: [] },
      palette: ['front:cold', 'moisture', 'sun', 'wind'],
      goal_conditions: [{ zone: GOAL_ZONE, phenomenon: rule.then.phenomenon }],
      hints: [],
    };
    const result = { passed, phenomena: verdictFor(ruleId), feedback: rule.explain, xp_earned: 0 };
    return render(h(QueryClientProvider, { client: qc }, h(AtmosphereBoard, { puzzle, result })));
  }

  // ── ⓐ 4조건으로 통과하면 뜬다 ──────────────────────────────────────────────
  {
    const html = boardHtml({ ruleId: 'cold_front_squall_storm', passed: true });
    check('ⓐ 4조건 통과: 성취 표시가 마크업에 있다', html.includes('data-board-four-condition="cold_front_squall_storm"'));
    check('ⓐ 축하 한 줄이 실제 글자로 뜬다', html.includes('4조건 규칙 달성'), '리소스가 안 풀렸거나 키가 없다');

    // 「무엇을 다 맞췄는지」 — 조건 4개가 전부 사람 말로 화면에 있어야 한다.
    const rule = rules.find((r) => r.id === 'cold_front_squall_storm');
    const missing = rule.when.map(conditionLabel).filter((label) => !html.includes(label));
    check(
      `ⓐ 맞춘 조건 4개가 전부 표시된다 (${rule.when.map(conditionLabel).join(' · ')})`,
      missing.length === 0,
      `누락: ${missing.join(', ')}`,
    );
    // 공허 통과 방지 — 라벨이 빈 문자열이면 위 includes가 저절로 참이 된다.
    check(
      'ⓐ 조건 라벨이 비어 있지 않다',
      rule.when.map(conditionLabel).every((l) => typeof l === 'string' && l.trim().length >= 2),
    );
    // 🔴 라벨이 **원문 토큰이 아니라 사람 말**인가 — 'moisture>=70'이 그대로 새면
    //    「표시했다」는 참인데 학습자는 못 읽는다.
    check(
      'ⓐ 조건 원문 토큰이 화면에 새지 않는다',
      !html.includes('moisture&gt;=70') && !html.includes('moisture>=70') && !html.includes('front:cold'),
    );
  }

  // ── ⓑ 3조건 이하로 통과하면 안 뜬다 (대조군은 **실패 판이 아니라 통과 판**) ──
  {
    const html = boardHtml({ ruleId: 'cold_front_shower', passed: true });
    check('ⓑ 2조건 통과: 성취 표시가 없다', !html.includes('data-board-four-condition'));
    check('ⓑ 그 판도 통과 배너 자체는 떠 있다(대조군이 공허하지 않다)', html.includes('성공'),
      '성공 배너가 아예 없으면 ⓑ는 아무것도 안 지킨다');
  }

  // ── ③ 통과하지 않은 판에서는 4조건이 발화해도 안 뜬다 ──────────────────────
  // 목표와 다른 현상을 4조건으로 낸 경우다 — 성취가 아니라 오답이다.
  {
    const html = boardHtml({ ruleId: 'cold_front_squall_storm', passed: false });
    check('③ 미통과 판: 4조건이 발화해도 성취 표시가 없다', !html.includes('data-board-four-condition'));
  }

  // ── ④ 판별이 현상 이름 목록이 아니다 — 4조건이면 결과가 평범해도 뜬다 ──────
  {
    const html = boardHtml({ ruleId: 'nocturnal_inversion_haze', passed: true });
    check(
      '④ 4조건 nocturnal_inversion_haze(결과 fog): 경보급이 아닌데도 성취 표시가 뜬다',
      html.includes('data-board-four-condition="nocturnal_inversion_haze"'),
      '경보급 현상 이름만 열거하는 판별이면 여기서 놓친다',
    );
  }

  // ── ⑤ 순수 함수 단위 — 목표 존만 본다 ─────────────────────────────────────
  {
    const four = rules.find((r) => r.when.length === 4);
    const two = rules.find((r) => r.when.length === 2);
    /** 규칙이 `zone`에서만 발화한 판정 배열. */
    const at = (zone, rule) =>
      ZONE_NAMES.map((zone_name, z) => ({ zone: z, zone_name, rule_id: z === zone ? rule.id : null }));
    check('⑤ 목표 존의 4조건 규칙을 찾는다', fourConditionRule(rules, at(2, four), 2)?.id === four.id);
    check('⑤ 다른 존이 낸 4조건은 성취가 아니다', fourConditionRule(rules, at(2, four), 1) === null);
    check('⑤ 2조건 규칙은 성취가 아니다', fourConditionRule(rules, at(2, two), 2) === null);
    check('⑤ 규칙 미로드(빈 배열)에서 터지지 않는다', fourConditionRule([], at(2, four), 2) === null);
    check('⑤ phenomena 없음에서 터지지 않는다', fourConditionRule(rules, null, 2) === null);
  }

  // ── ⑥ 문구가 없는 통로를 약속하지 않는다 (uiCopy.contract ⑸⑹와 같은 원칙) ──
  {
    const ko = (await server.ssrLoadModule('/src/i18n/resources/board.ko.js')).default;
    const en = (await server.ssrLoadModule('/src/i18n/resources/board.en.js')).default;
    for (const [loc, res] of [['ko', ko], ['en', en]]) {
      for (const key of ['fourConditionTitle', 'fourConditionMet']) {
        const val = res.board.atmosphere[key];
        check(`⑥ ${loc}.${key} 존재·비어있지 않음`, typeof val === 'string' && val.length >= 8, String(val));
        check(
          `⑥ ${loc}.${key}가 못 지킬 약속을 하지 않는다`,
          loc === 'ko'
            ? !/바꿀\s*수\s*있/.test(val) && !/언제든/.test(val) && !/나중에/.test(val)
            : !/\blater\b/i.test(val) && !/\banytime\b/i.test(val) && !/\byou can change\b/i.test(val),
          String(val),
        );
      }
    }
  }
} finally {
  await server.close();
}

console.log(failed === 0 ? '\nOK — 4조건 성취 표시 계약 전건 통과' : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);

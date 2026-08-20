/**
 * 과거 예보 배치·잠금 계약 (MT-30) —
 *   node tests/hindcast.smoke.test.mjs
 *
 * **소스 계약 전용이다.** 여기서 무는 것은 전부 jsdom이 못 보는 종류다:
 * 열 수는 CSS 계산이고(레이아웃 엔진 없음), 「제출 뒤 입력이 남는가」는 배치라
 * 실제 픽셀은 브라우저로 따로 쟀다(아래 값은 그 실측이다). 여기서 막고 싶은 것은
 * 그 결정들이 정리 중에 조용히 사라지는 회귀다.
 *
 * 2026-08-19 사용자 지시 두 가지에서 시작했다:
 *   ⑴ "판정 뜬 뒤 입력칸 — 값을 남기고 잠글까요"  → 잠금(값 유지)
 *   ⑵ "회차 목록 열 수는 3열로"
 *
 * ⚠️ ⑴의 괄호 안 「다시 도전 누르면 풀림」은 **구현하지 않았고 하면 안 된다** —
 *    서버가 회차당 1회이고 재제출은 409 `ALREADY_SUBMITTED`다
 *    (`backend/app/routers/hindcast.py`). 잠금을 푸는 버튼은 누르는 족족 409를
 *    받으므로, 그 자리에는 **실제로 되는 행동**(다른 회차 고르기)을 뒀다.
 *    ㉣가 그 결정을 지킨다 — 「다시」로 되돌리려는 순간 붉어진다.
 *
 * 실측(Chromium, 셸 1152):
 *   목록  1536 3열 카드 363px · 1280 3열 331px · 1024 2열 377px
 *   회차  1536 두 열 513/591 · 1280 469/540 · 1024 350/403
 *   판정 뒤 입력값 31·60 유지 + disabled · pageH 1,000
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');

/**
 * 🔴 **「없다」를 물을 때는 주석을 걷고 본다.**
 *
 * 이 파일의 계약 여럿이 「이 낱말이 코드에 **없어야** 한다」는 꼴이다(잠금 해제
 * 통로 · 고지 숨김). 그런데 그 결정을 설명하는 주석에는 바로 그 낱말이 들어간다
 * — "「다시 도전」으로 푸는 길은 없다"처럼. 그래서 「없음」 계약은 전부 이
 * 함수를 거친다.
 *
 * 2026-08-20에 `home.smoke`도 같은 것이 필요해져 **helpers/sourceScan.mjs로
 * 옮겼다** — 경위와 두 방향의 실패 사례는 그 파일이 소유한다. 여기 두 벌을
 * 두면 한쪽만 고쳐질 자리라 물리적으로 합친다(같은 컨텍스트 안의 중복).
 */
import { codeOnly } from './helpers/sourceScan.mjs';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failed += 1;
};

const play = read('src/modules/hindcast/CasePlayPage.jsx');
const list = read('src/modules/hindcast/CaseListPage.jsx');
const notice = read('src/modules/hindcast/DemoDataNotice.jsx');

// ── ㉠ 회차 목록 3열 (사용자 지시 ⑵) ────────────────────────────────────────
// 기후 탐정 목록과 **같은 규격**이어야 한다 — 둘은 탐구 홈에서 나란히 들어가는
// 형제라, 목록이 다르게 생기면 다른 서비스처럼 읽힌다. 그래서 열 수만 보지 않고
// 탐정 쪽 문자열과 **직접 대조**한다: 한쪽만 손대면 여기서 갈린다.
{
  const listGrid = list.match(/<ul className="(grid max-w-\[[^"]*)"/)?.[1] ?? '';
  const det = read('src/modules/detective/CaseListPage.jsx');
  const detGrid = det.match(/<div className="(grid max-w-\[[^"]*)"/)?.[1] ?? '';
  ok(/\bxl:grid-cols-3\b/.test(listGrid), `㉠ 회차 목록이 xl에서 3열 — 실제 "${listGrid}"`);
  ok(
    listGrid === detGrid,
    `㉠ 기후 탐정 목록과 격자 규격이 같다 — 과거예보 "${listGrid}" / 탐정 "${detGrid}"`,
  );
  // ⚠️ 폭 상한을 빼먹으면 3열이 760px에 묶여 한 칸이 **작아진다** — 탐정에서
  //    실제로 밟았던 함정이라 여기서도 함께 문다.
  ok(
    Number(listGrid.match(/max-w-\[(\d+)px\]/)?.[1]) >= 1080,
    '㉠ 폭 상한이 3열을 담는다 — 760이면 열만 늘고 카드가 작아진다',
  );
}

// ── ㉡ 회차 화면 2열 (판단 재료 / 내 답과 결과) ─────────────────────────────
// 다른 실험실의 「만지는 쪽 / 보는 쪽」과 **뜻이 다르다**: 이 화면에는 움직이는
// 값이 없고 답을 적고 채점을 받는다. 왼쪽이 판단 재료(회차 소개·평년값),
// 오른쪽이 내 답과 판정이다.
{
  const g = play.indexOf('lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]');
  ok(g > -1, '㉡ 회차 화면에 2열 격자가 있다');
  const body = g > -1 ? play.slice(g) : '';
  const at = (s) => body.indexOf(s);
  ok(
    at("hindcast.play.normalTitle") > -1 && at("hindcast.play.normalTitle") < at('hindcast-forecast-form'),
    '㉡ 왼쪽이 판단 재료(평년값)이고 오른쪽이 입력 폼이다',
  );
  ok(
    at('<ResultCard') > at('hindcast-forecast-form'),
    '㉡ 판정이 입력 **바로 아래**로 이어진다 — 내가 적은 값과 실측이 같은 열에 붙는다',
  );
}

// ── ㉢ 판정 뒤에도 입력이 남고 잠긴다 (사용자 지시 ⑴) ───────────────────────
// 종전에는 폼이 통째로 사라져(삼항의 반대편) 내가 뭘 냈는지 판정 카드 안의
// 요약으로만 남았다. 값의 임자는 응답의 `user_pred`다 — 새로고침 뒤에도,
// 지난 회차를 다시 열어도 잠긴 칸에 내가 낸 값이 그대로 있어야 한다.
{
  ok(/const locked = Boolean\(shown\);/.test(play), '㉢ 판정 여부로 잠금을 정한다');
  ok(
    /lockedTemp = shown\?\.user_pred\?\.temp_max/.test(play)
      && /lockedRain = shown\?\.user_pred\?\.rain_prob/.test(play),
    '㉢ 잠긴 값의 임자가 응답(user_pred)이다 — 새로고침 뒤에도 남는다',
  );
  // ⚠️ **`<input`부터 잡는다.** 처음에는 `data-testid=…`를 앵커로 삼고 320자
  //    안에서 `/>`를 찾았는데 `value`·`readOnly`·`onChange`·긴 className이 그보다
  //    뒤라 **0건**이 잡혔다. 그리고 0건이면 `.every()`가 참이라 **다음 줄이
  //    빈손으로 통과**했다 — 「못 찾았는데 초록」이 이 계약의 최악이므로 개수를
  //    먼저 단정한다.
  const inputs = play.match(/<input[\s\S]*?\/>/g) ?? [];
  ok(inputs.length === 2, `㉢ 입력칸 둘을 읽었다 — ${inputs.length}건`);
  ok(
    inputs.length === 2
      && inputs.every((i) => /disabled=\{locked\}/.test(i) && /locked \? locked(Temp|Rain) :/.test(i)),
    '㉢ 두 칸 모두 잠금 상태에서 값을 유지한 채 비활성이다',
  );
  // 잠긴 것이 **눈에도 보여야** 한다 — 값만 회색이면 「아직 못 낸 칸」과 구별이
  // 안 된다.
  ok(/data-testid="hindcast-locked"/.test(play), '㉢ 잠금 상태를 말하는 줄이 있다');
}

// ── ㉣ 「다시 도전」으로 잠금을 풀지 않는다 ─────────────────────────────────
// 🔴 **이 절이 이 파일에서 가장 중요하다.** 지시의 괄호("다시 도전 누르면 풀림")를
// 그대로 만들면 화면은 그럴듯한데 **서버가 409로 막는다**(회차당 1회). 되지 않는
// 버튼은 없는 버튼보다 나쁘다 — 누른 사람은 자기가 뭘 잘못했는지 모른다.
// 그래서 ⑴은 「값 유지 + 잠금」까지만 구현했고, 남은 자리에는 되는 행동을 뒀다.
// 나중에 이 결정을 모르는 사람이 「다시 도전」을 되살리려 하면 여기서 붉어진다.
{
  ok(
    !/setLocked|unlock|다시 도전/.test(codeOnly(play)),
    '㉣ 잠금을 푸는 통로가 없다 — 서버가 회차당 1회라(409) 「다시 도전」은 거짓이 된다',
  );
  ok(/data-testid="hindcast-next-case"/.test(play), '㉣ 그 자리에 되는 행동(다른 회차)이 있다');
  for (const loc of ['ko', 'en']) {
    const res = read(`src/i18n/resources/hindcast.${loc}.js`);
    const line = res.match(/otherCase: '([^']*)'/)?.[1] ?? '';
    ok(
      Boolean(line) && !/다시|again|retry/i.test(line),
      `㉣ ${loc} 문구가 재시도를 약속하지 않는다 — 실제 "${line}"`,
    );
  }
}

// ── ㉤ 「데모용 고정 날짜」 고지 — 자리는 옮기되 없애지 않는다 ──────────────
// 이 고지는 이 항목의 **정직성 자체**다(DemoDataNotice 머리말): 과거 관측 적재
// 경로가 없어 회차는 고정 픽스처이고, 그 사실을 화면이 숨기면 「과거 예보」가
// 아니라 「가짜 이력」이 된다. 그래서 줄이는 것은 되지만 **숨기는 것은 안 된다**.
// 두 꼴(카드/한 줄)이 같은 `data-testid`를 쓰는 것도 그 때문이다 — 어느 꼴이든
// 스모크가 존재를 확인할 수 있어야 한다.
{
  ok(/inline = false/.test(notice), '㉤ 고지에 한 줄 변형이 있다');
  ok(
    (notice.match(/data-testid="hindcast-demo-notice"/g) ?? []).length === 2,
    '㉤ 두 꼴이 같은 testid를 쓴다 — 어느 꼴이든 존재를 확인할 수 있다',
  );
  ok(!/\bhidden\b/.test(codeOnly(notice)), '㉤ 고지를 화면에서 숨기지 않는다 — 줄이는 것과 다르다');
  ok(
    /<DemoDataNotice inline \/>/.test(play) && /<DemoDataNotice inline \/>/.test(list),
    '㉤ 두 화면 모두 상단 줄 한 줄 꼴을 쓴다 (탐구 실험실 넷과 같은 관례)',
  );
}

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\nOK: 과거 예보(목록 3열 · 회차 2열 · 판정 뒤 잠금 · 고지 존치) 계약 통과');
process.exit(0);

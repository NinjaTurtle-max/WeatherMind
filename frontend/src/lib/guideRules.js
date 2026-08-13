/**
 * guideRules — 안내봇이 **무엇을 말할지**를 정하는 결정적 규칙표 (MT-26).
 *
 * **LLM을 부르지 않는다.** 이 파일에 네트워크 호출이 들어오면 안 된다. 이유가
 * 셋이고 전부 이 저장소의 기존 결정이다:
 *   ⑴ API 키는 발급됐지만 **비용 때문에 의도적으로 안 넣는다**(3게이트로만 투입).
 *      상시 말하는 캐릭터는 게이트의 정의상 「상시 과금」이라 그 결정과 정면충돌한다.
 *   ⑵ **키 없이 전 기능 동작**이 이 제품의 원칙이다. 심사 데모가 키 없이 돌아야 한다.
 *   ⑶ 피드백 할루시네이션(MT-17)이 멘토 지적 사항이다. 규칙표는 원리적으로 환각이 없다.
 *
 * 그래서 화면·상태 → 문구 키의 **순수 함수**다. React도 i18n도 모른다 —
 * 테스트가 브라우저 없이 규칙만 검증할 수 있게 하려는 것이고, 실제로
 * `tests/guideBot.smoke.test.mjs`가 이 파일만 임포트해서 전 분기를 돈다.
 *
 * 화자는 **구름이 하나**다. `BoardHintPanel`이 같은 판단을 이미 적어 뒀다 —
 * *"화면 하나에 화자 하나"*. 종전에 단계마다 화자를 갈랐다가 한 화면에서 말하는
 * 사람이 세 번 바뀌는 결과가 나왔고 그것을 되돌린 기록이 거기 있다. 안내봇은
 * **화면을 가로질러** 따라다니므로 그 규칙이 더 강하게 적용된다: 끝까지 구름이다.
 * (구름이는 `SideNav.TUTOR_BY_PATH`에서 담당 없는 화면의 폴백 튜터이기도 하다.)
 */

/**
 * 안내봇의 얼굴. 담당표를 안 탄다 — 어느 화면에서도 구름이다.
 *
 * `cloud`(12종 체계의 폴백 튜터)와 **갈라 둔다**. cloud를 그대로 쓰면 안내봇의
 * 그림을 바꿀 때마다 홈의 복습·최근 활동 줄까지 함께 바뀐다. 안내봇 것은
 * 사용자 제공 3D 모델(`weathermind-bot.glb`)에서 렌더한 전용 자산이다.
 */
export const GUIDE_SPEAKER = 'guidebot';

/**
 * 상태 규칙 — **위에서부터 처음 맞는 하나가 이긴다.** 순서가 곧 우선순위다.
 *
 * 순서를 이렇게 둔 이유: 지금 막지 못하는 것(에너지 0)이 축하(레벨업)보다 급하고,
 * 축하는 오답 위로해 주기보다 앞선다(레벨업 순간에 직전 오답을 다시 꺼내면
 * 성취를 깎는다). 첫 방문은 나머지가 하나도 안 걸릴 때만 나온다 — 처음 온 사람에게
 * 네 마디를 한꺼번에 쏟지 않는다.
 *
 * ⚠️ 규칙을 추가할 때 `when`을 느슨하게 쓰지 말 것. `s.clouds === 0`처럼 **명시적
 * 비교**를 쓴다 — truthy 검사로 두면 값이 아직 안 온 `undefined`가 0과 같이 취급돼
 * 로딩 중에 "에너지가 없어요"가 번쩍인다.
 */
export const STATE_RULES = [
  { id: 'outOfClouds', key: 'guide.state.outOfClouds', when: (s) => s.clouds === 0 },
  { id: 'levelUp', key: 'guide.state.levelUp', when: (s) => s.levelUp === true },
  { id: 'wrongAnswer', key: 'guide.state.wrongAnswer', when: (s) => s.lastAnswerCorrect === false },
  { id: 'firstVisit', key: 'guide.state.firstVisit', when: (s) => s.firstVisit === true },
];

/**
 * 화면 규칙 — 상태 규칙이 하나도 안 걸릴 때의 기본 안내.
 *
 * **접두사 일치**이지 정확 일치가 아니다(`/learn/units/xxx`도 `/learn`으로 잡힌다).
 * 긴 경로가 먼저 오도록 정렬해 둔 것이 계약이다 — `/` 를 위로 올리면 전부 그것에
 * 먹힌다. 그래서 아래 배열은 **길이 내림차순**을 스모크가 단정한다.
 */
export const SCREEN_RULES = [
  { prefix: '/explore', key: 'guide.screen.explore' },
  { prefix: '/league', key: 'guide.screen.league' },
  { prefix: '/board', key: 'guide.screen.board' },
  { prefix: '/learn', key: 'guide.screen.learn' },
  { prefix: '/duel', key: 'guide.screen.duel' },
  { prefix: '/me', key: 'guide.screen.me' },
];

/** 어느 화면에도 안 걸릴 때. */
export const FALLBACK_KEY = 'guide.screen.default';

/**
 * 지금 안내봇이 할 말의 **i18n 키**를 고른다.
 *
 * @param {string} pathname  현재 경로
 * @param {object} state     `{ clouds, levelUp, lastAnswerCorrect, firstVisit }` — 전부 선택
 * @returns {{ key: string, ruleId: string, kind: 'state'|'screen' }}
 *
 * 문구가 아니라 **키**를 돌려주는 것이 요점이다. 이 파일은 한국어를 한 글자도
 * 갖지 않는다 — ko/en 패리티는 `i18n.smoke.test.mjs`가 리소스에서 감시하고,
 * 여기 문자열을 박아 두면 그 감시망 밖으로 새어 나간다.
 */
export function pickGuideMessage(pathname = '/', state = {}) {
  for (const rule of STATE_RULES) {
    if (rule.when(state)) return { key: rule.key, ruleId: rule.id, kind: 'state' };
  }
  const screen = SCREEN_RULES.find((r) => pathname.startsWith(r.prefix));
  if (screen) return { key: screen.key, ruleId: screen.prefix, kind: 'screen' };
  return { key: FALLBACK_KEY, ruleId: 'default', kind: 'screen' };
}

/**
 * 이 규칙표가 쓰는 **전 키 목록** — 리소스 누락을 테스트가 잡게 하려고 노출한다.
 *
 * 안내봇 문구는 화면·상태가 맞아떨어져야 뜨므로, 키 하나가 비어도 사람 눈에는
 * 몇 주 동안 안 보일 수 있다(그때 화면에는 `guide.state.levelUp` 같은 날것의 키가
 * 그려진다 — i18n 폴백이 키 문자열을 그대로 내놓기 때문이다). 목록을 코드가 들고
 * 있어야 스모크가 ko/en 양쪽 리소스와 기계 대조할 수 있다.
 */
export const GUIDE_MESSAGE_KEYS = [
  ...STATE_RULES.map((r) => r.key),
  ...SCREEN_RULES.map((r) => r.key),
  FALLBACK_KEY,
];

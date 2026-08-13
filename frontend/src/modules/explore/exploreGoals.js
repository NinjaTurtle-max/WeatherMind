/**
 * 탐구 목표 — 「변수를 바꿔보며」에 「해냈다」를 붙인다 (MT-24)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 왜 여기에 있나 (보드의 goal_conditions를 그대로 못 쓰는 이유)
 * ─────────────────────────────────────────────────────────────────────────────
 * 보드에는 이미 목표 판정이 있다. 다만 **두 문법이 서로 다른 것**이라 구분해야 한다:
 *   ⓐ 규칙 조건(`board_rules.json`의 `when`) — `"<field><op><숫자>"` ·
 *      `"<type>:<subtype>"`. 소비자는 boardEngine.conditionHolds.
 *   ⓑ 목표(`template_json.goal_conditions`) — `{zone, phenomenon, cloud?}` **객체**.
 *      소비자는 boardEngine.checkGoals / board_engine.check_goals.
 * 탐구 시뮬은 존도 현상도 만들지 않는다(내는 것은 강도·등급·아노말리 같은 스칼라다).
 * 그래서 ⓑ는 형태가 아예 안 맞고, ⓐ의 `conditionHolds`는 필드 이름이
 * `moisture|sun|wind`로 **박혀 있어** 그대로는 못 부른다(그 파일은 서버 파이썬
 * 인터프리터와 의미론을 맞춘 공유 자산이라 탐구 편의로 넓히지 않는다).
 *
 * 그래서 **문자열 문법을 흉내 내지 않는다.** 같아 보이는데 다른 것이 가장 나쁘다 —
 * 여기 조건은 파싱이 필요 없는 평범한 객체 `{field, op, value}`다. 대신 **의미론은
 * 보드를 그대로 따른다**:
 *   · 한 목표의 조건은 전부 AND (boardEngine matchRuleForZone과 같다)
 *   · 수치 비교 연산자는 `>=`·`<=` 둘뿐 (board §3.2와 같은 집합)
 *   · 범주형은 `eq` — 보드의 `"<type>:<subtype>"` 존재 검사에 대응한다
 *   · **fail-closed**: 모르는 필드·모르는 연산자·숫자 아닌 값은 성립하지 않는다
 *     (boardEngine "문법 외 조건은 발화 금지"와 같은 방향 — 잘못 저작된 목표가
 *     자동 달성이 되는 쪽으로는 절대 기울지 않는다)
 *
 * 판정을 프론트가 해도 되는 근거: 탐구는 **보상·자원·진도를 하나도 움직이지 않는다.**
 * 구름을 소모하지 않고(퍼즐 진입 `/board/puzzles/{id}`를 부르지 않는다) 시도 로그도
 * 남기지 않으며 θ·왕관·리그에 값을 쓰지 않는다. 서버 채점 권위는 자원이 움직이는
 * 곳에만 필요하고, 여기는 그 자리가 아니다. 위조해서 얻는 것이 「내가 본 화면의
 * 체크 표시」뿐이라 위조 유인 자체가 없다.
 *
 * 순수·결정적: 난수·시간 의존 없음. 같은 입력이면 항상 같은 판정(R3 원칙 정합).
 */

/** 수치 비교 연산자 — 보드 §3.2와 **같은 집합**이다. 여기서 넓히지 않는다. */
const NUMERIC_OPS = Object.freeze(['>=', '<=']);

/**
 * 조건 1건 판정. facts는 시뮬이 지금 내놓은 값의 평평한 객체다.
 * 모르는 필드·연산자·형은 **성립하지 않음**(fail-closed).
 */
export function conditionMet(condition, facts) {
  if (!condition || typeof condition !== 'object') return false;
  const { field, op, value } = condition;
  if (typeof field !== 'string' || !facts || !(field in facts)) return false;
  const actual = facts[field];

  if (op === 'eq') return actual === value;
  if (!NUMERIC_OPS.includes(op)) return false;
  if (typeof actual !== 'number' || Number.isNaN(actual)) return false;
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  return op === '>=' ? actual >= value : actual <= value;
}

/**
 * 목표 1건 달성 여부 — 조건 전부 AND.
 *
 * ⚠️ **조건이 비면 false**다. 보드(checkGoals·check_goals)가 빈 목표를 false로
 * 판정하는 것과 같은 이유 — 목표 없는 판이 마운트 즉시 "달성"으로 튀던 CO-K7을
 * 여기서 되풀이하지 않는다.
 */
export function goalMet(goal, facts) {
  const conditions = goal?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  return conditions.every((c) => conditionMet(c, facts));
}

/** 목표 배열 → 달성 여부 배열 (순서 보존) */
export function evaluateGoals(goals, facts) {
  return (goals ?? []).map((goal) => goalMet(goal, facts));
}

// ─────────────────────────────────────────────────────────────────────────────
// 목표 정의 — 문구는 전부 i18n 키다(explore.goals.*). 하드코딩 금지.
//
// 설계 규칙 3가지:
//  ① **기본 입력에서는 하나도 달성이 아니어야 한다.** 화면에 들어서자마자 ✅가
//     켜져 있으면 학습자는 자기가 한 일이 없다는 것을 안다(CO-K7의 교훈).
//  ② 목표마다 **움직여야 하는 변수 조합이 다르다.** 같은 방향으로 끝까지 끌면
//     전부 켜지는 목표 세트는 「변수를 바꿔보며」를 시험하지 않는다.
//  ③ **창(window)으로 만든다.** 상한만 있으면 슬라이더를 끝까지 밀어 통과하지만,
//     상·하한이 함께 있으면 값을 찾아야 한다.
// 창의 실제 범위는 tests/exploreGoals.test.mjs가 모델을 돌려 못박는다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 태풍 시뮬 목표 3종. facts = {sst, shear, intensity, category}
 * 기본값(sst 28 · shear weak → intensity 38 · category 'TS')에서 3건 모두 미달.
 */
export const TYPHOON_GOALS = Object.freeze([
  {
    // 임계 **아래로** 내려가는 목표 — 다른 둘과 반대 방향이라 슬라이더 양끝을 다 쓴다.
    id: 'calm',
    titleKey: 'explore.goals.typhoon.calmTitle',
    taskKey: 'explore.goals.typhoon.calmTask',
    lessonKey: 'explore.goals.typhoon.calmLesson',
    conditions: [{ field: 'category', op: 'eq', value: 'none' }],
  },
  {
    // 뜨거운 바다 + 낮은 강도 = **시어를 강으로 두는 수밖에 없다**(실측: weak·moderate로는
    // sst≥31에서 강도가 절대 40 이하로 안 내려간다). 두 번째 변수를 강제로 만지게 하는 목표.
    id: 'shear-wall',
    titleKey: 'explore.goals.typhoon.shearWallTitle',
    taskKey: 'explore.goals.typhoon.shearWallTask',
    lessonKey: 'explore.goals.typhoon.shearWallLesson',
    conditions: [
      { field: 'sst', op: '>=', value: 31 },
      { field: 'intensity', op: '<=', value: 40 },
    ],
  },
  {
    // 반대로 **두 조건이 동시에 최적**이라야 닿는 자리(weak 시어 + sst≥31).
    id: 'super',
    titleKey: 'explore.goals.typhoon.superTitle',
    taskKey: 'explore.goals.typhoon.superTask',
    lessonKey: 'explore.goals.typhoon.superLesson',
    conditions: [{ field: 'category', op: 'eq', value: 'super' }],
  },
]);

/**
 * 기후 시뮬 목표 2종. facts = {co2, anomaly, sea_level, heat_days}
 *
 * ⚠️ 비교 대상은 **화면에 뜨는 반올림값**(result.anomaly는 소수 2자리)이다. 원시값으로
 * 재계산해 비교하면 "화면은 1.40인데 미달"이 생긴다 — 학습자가 보는 숫자가 판정 근거여야 한다.
 * 기본값(co2 427 → anomaly 1.83 · heat_days 32)에서 2건 모두 미달.
 */
export const CLIMATE_GOALS = Object.freeze([
  {
    // 창 = CO₂ 387~396ppm (실측). 상·하한이 함께 있어 끝까지 미는 것으로는 못 맞춘다.
    id: 'line-1p5',
    titleKey: 'explore.goals.climate.line15Title',
    taskKey: 'explore.goals.climate.line15Task',
    lessonKey: 'explore.goals.climate.line15Lesson',
    conditions: [
      { field: 'anomaly', op: '>=', value: 1.4 },
      { field: 'anomaly', op: '<=', value: 1.5 },
    ],
  },
  {
    // 창 = CO₂ 357~369ppm (실측). 위 목표의 창(387~396)과 **겹치지 않는다** — 하나를
    // 풀었다고 다른 하나가 딸려 켜지면 두 번째 목표는 아무것도 안 가르친다.
    id: 'heat-first',
    titleKey: 'explore.goals.climate.heatFirstTitle',
    taskKey: 'explore.goals.climate.heatFirstTask',
    lessonKey: 'explore.goals.climate.heatFirstLesson',
    conditions: [
      { field: 'heat_days', op: '>=', value: 20 },
      { field: 'anomaly', op: '<=', value: 1.2 },
    ],
  },
]);

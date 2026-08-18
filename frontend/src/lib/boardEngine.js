/**
 * boardEngine — 대기 보드 규칙 인터프리터 (스프린트 R3-01 계약 §3.1·§3.2)
 *
 * 백엔드(Python) 인터프리터와 **동일 의미론**을 보증해야 하는 모듈이다 (R3-S1).
 *  - 보드 모델(§3.1): 한반도 단면 4존(서해·수도권·태백산맥·동해안), 배치 요소는
 *    air_mass / front / moisture / sun / **wind** 5종. 존당 기단 최대 1·전선 최대 1·
 *    moisture/sun/wind 각 1. 구름·현상은 판정 **출력**이며 배치할 수 없다.
 *  - 규칙 문법(§3.2): 조건은 정확히 2형만 허용 —
 *      ① "<type>:<subtype>"          존재 검사 (예: "front:cold")
 *      ② "<field><op><숫자>"          수치 비교, op ∈ {>=, <=}, field ∈ {moisture, sun, wind}
 *    조건은 전부 **같은 존**에서 AND로 성립해야 한다.
 *  - 판정: 존별로 성립한 규칙 중 priority 최고 1개 적용(동률이면 규칙 배열의
 *    앞선 것 — 계약상 같은 조건·같은 priority 모순은 데이터 저작 단계에서 금지).
 *    성립 규칙이 없으면 기본값 {phenomenon: "cloudy", cloud: "cumulus"}.
 *  - 미배치 존 기본값: moisture 40, sun 50, wind 20.
 *
 * wind가 방향(subtype)이 아니라 세기(level)인 근거는 board_engine.py 모듈
 * 도크스트링에 있다(단일 서술 — 여기서 복제하지 않는다). 요지: 조건은 전부 같은
 * 존에서 AND이고 존↔존 전파가 없어 방향이 판정에 기여할 수 없다.
 *
 * 규칙 JSON은 GET /api/v1/board/rules 로 로드한다(단일 진실원 —
 * database/seed/board_rules.json). **이 파일에 규칙을 하드코딩하지 않는다.**
 *
 * 순수 ESM·무의존 모듈: 브라우저(React), vite dev mock 서버(node),
 * 공유 테스트 벡터 검증 스크립트(node)가 모두 이 파일 하나를 import한다.
 */

// ── §3.1 상수 ──────────────────────────────────────────────────────────────
export const ZONES = Object.freeze(['서해', '수도권', '태백산맥', '동해안']); // index 0~3 고정
export const ELEMENT_TYPES = Object.freeze(['air_mass', 'front', 'moisture', 'sun', 'wind']);
export const LEVEL_TYPES = Object.freeze(['moisture', 'sun', 'wind']); // 0~100 조절값
export const AIR_MASS_SUBTYPES = Object.freeze(['siberian', 'north_pacific', 'yangtze', 'okhotsk']);
export const FRONT_SUBTYPES = Object.freeze(['cold', 'warm', 'stationary']);
export const PHENOMENON_ENUM = Object.freeze([
  'shower', 'rain', 'persistent_rain', 'snow', 'fog', 'heatwave', 'clear', 'cloudy',
  // R13 재난 축(CO-A3·CO-K4) — 재난 보드가 'clear'를 목표로 삼던 상태를 끝낸다
  'wildfire_risk', 'flood_risk',
  // ㉣ 4조건 규칙의 고유 결과 — 경보급(2026-08-18). 백엔드 PHENOMENA와 같은 집합이어야 한다.
  'severe_storm', 'wildfire_warning', 'flood_warning',
  // MT-18 전문가 보드(2026-08-18) — 태풍·온실효과. 새 배치 요소는 0개이고 둘 다
  // 기존 5종의 조합으로 성립한다. 백엔드 PHENOMENA와 같은 집합이어야 한다.
  'typhoon', 'tropical_night',
]);
export const CLOUD_ENUM = Object.freeze(['cumulonimbus', 'nimbostratus', 'stratus', 'cumulus', 'none']);

export const DEFAULT_MOISTURE = 40; // 미배치 존 기본값 (§3.1)
export const DEFAULT_SUN = 50;
// 평상시 약한 바람. 낮게 잡는 것이 계약 — 재난 규칙이 wind>=로 발화하므로 기본값이
// 높으면 미배치 존 전부가 재난으로 뒤집힌다(백엔드 DEFAULT_WIND와 같은 값이어야 한다).
export const DEFAULT_WIND = 20;
export const DEFAULT_RESULT = Object.freeze({ phenomenon: 'cloudy', cloud: 'cumulus' }); // §3.2 기본 판정

// ── §3.1 보드 상태 검증 ────────────────────────────────────────────────────
/**
 * 보드 상태를 검증한다. 오류 메시지 배열을 반환하며 빈 배열이면 유효.
 * (백엔드 422와 같은 관점 — UI는 이 검증을 통과한 상태만 제출한다)
 */
export function validateBoardState(board) {
  const errors = [];
  if (!board || typeof board !== 'object') return ['board가 객체가 아닙니다'];

  if (board.zones != null) {
    const zones = board.zones;
    if (!Array.isArray(zones) || zones.length !== ZONES.length || zones.some((z, i) => z !== ZONES[i])) {
      errors.push(`zones는 고정 배열 ${JSON.stringify(ZONES)}여야 합니다`);
    }
  }

  const elements = board.elements;
  if (!Array.isArray(elements)) {
    errors.push('elements가 배열이 아닙니다');
    return errors;
  }

  // 존×타입 개수 제약 (기단·전선·moisture·sun 각각 존당 최대 1)
  const counts = new Map();
  elements.forEach((el, idx) => {
    const at = `elements[${idx}]`;
    if (!el || typeof el !== 'object') {
      errors.push(`${at}: 요소가 객체가 아닙니다`);
      return;
    }
    if (!ELEMENT_TYPES.includes(el.type)) {
      errors.push(`${at}: 알 수 없는 type "${el.type}" (구름·현상은 출력이며 배치 불가)`);
      return;
    }
    if (!Number.isInteger(el.zone) || el.zone < 0 || el.zone >= ZONES.length) {
      errors.push(`${at}: zone은 0~${ZONES.length - 1} 정수여야 합니다`);
      return;
    }
    if (el.type === 'air_mass' && !AIR_MASS_SUBTYPES.includes(el.subtype)) {
      errors.push(`${at}: air_mass subtype은 ${AIR_MASS_SUBTYPES.join('|')} 중 하나여야 합니다`);
    }
    if (el.type === 'front' && !FRONT_SUBTYPES.includes(el.subtype)) {
      errors.push(`${at}: front subtype은 ${FRONT_SUBTYPES.join('|')} 중 하나여야 합니다`);
    }
    if (LEVEL_TYPES.includes(el.type)) {
      const level = el.level;
      if (typeof level !== 'number' || Number.isNaN(level) || level < 0 || level > 100) {
        errors.push(`${at}: ${el.type} level은 0~100 숫자여야 합니다`);
      }
    }
    const key = `${el.zone}:${el.type}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  for (const [key, count] of counts) {
    if (count > 1) {
      const [zone, type] = key.split(':');
      errors.push(`존 ${ZONES[Number(zone)]}에 ${type}가 ${count}개 — 존당 1개만 배치할 수 있습니다`);
    }
  }
  return errors;
}

// ── 판정 (§3.2) ────────────────────────────────────────────────────────────
/** 보드 elements를 존별 상태 {airMass, front, moisture, sun, wind}로 정규화 (기본값 적용) */
export function zoneStates(board) {
  const zones = Array.from({ length: ZONES.length }, () => ({
    airMass: null,
    front: null,
    moisture: DEFAULT_MOISTURE,
    sun: DEFAULT_SUN,
    wind: DEFAULT_WIND,
  }));
  for (const el of board?.elements ?? []) {
    const zs = zones[el?.zone];
    if (!zs) continue;
    if (el.type === 'air_mass') zs.airMass = el.subtype;
    else if (el.type === 'front') zs.front = el.subtype;
    else if (LEVEL_TYPES.includes(el.type)) zs[el.type] = Number(el.level);
  }
  return zones;
}

// 조건 문법 2형 (§3.2 — 이 문법 외 금지)
const COND_EXISTS = /^(air_mass|front)\s*:\s*([a-z_]+)$/; // "<type>:<subtype>"
const COND_NUMBER = /^(moisture|sun|wind)\s*(>=|<=)\s*(\d+(?:\.\d+)?)$/; // "<field><op><숫자>"

/**
 * 단일 조건이 존 상태(zoneStates 항목)에서 성립하는지 판정.
 * 문법에 맞지 않는 조건은 성립하지 않는 것으로 본다(잘못 저작된 규칙은 절대 발화하지 않음).
 */
export function conditionHolds(condition, zs) {
  if (typeof condition !== 'string') return false;
  const cond = condition.trim();

  const exists = cond.match(COND_EXISTS);
  if (exists) {
    const [, type, subtype] = exists;
    if (type === 'air_mass') return zs.airMass === subtype;
    return zs.front === subtype;
  }

  const num = cond.match(COND_NUMBER);
  if (num) {
    const [, field, op, raw] = num;
    const actual = zs[field];
    const target = Number(raw);
    return op === '>=' ? actual >= target : actual <= target;
  }
  return false; // 문법 외 조건 — 발화 금지
}

/** 존 하나에 대해 성립 규칙 중 priority 최고 1개를 고른다 (없으면 null) */
export function matchRuleForZone(zs, rules) {
  let best = null;
  for (const rule of rules ?? []) {
    const conditions = rule?.when;
    if (!Array.isArray(conditions) || conditions.length === 0) continue;
    if (!conditions.every((c) => conditionHolds(c, zs))) continue;
    if (!best || (rule.priority ?? 0) > (best.priority ?? 0)) best = rule; // 동률은 앞선 규칙 유지
  }
  return best;
}

/**
 * 보드 전체 판정 — 존별 결과 4건을 반환.
 * @returns [{zone, zone_name, phenomenon, cloud, rule_id, explain}] (index 0~3 순)
 */
export function evaluateBoard(board, rules) {
  return zoneStates(board).map((zs, i) => {
    const rule = matchRuleForZone(zs, rules);
    return {
      zone: i,
      zone_name: ZONES[i],
      phenomenon: rule?.then?.phenomenon ?? DEFAULT_RESULT.phenomenon,
      cloud: rule?.then?.cloud ?? DEFAULT_RESULT.cloud,
      rule_id: rule?.id ?? null,
      explain: rule?.explain ?? null,
    };
  });
}

/**
 * goal_conditions(§3.3, AND) 충족 검사.
 * @returns {passed: bool, unmet: [{zone, phenomenon}]} — unmet은 미충족 목표 목록
 *
 * ⚠️ **빈 목표는 `passed:false`** — 서버(board_engine.check_goals)와 같은 판정이다.
 * CO-K3: 공유 벡터가 현상 판정만 물고 목표 판정은 0건이라 이 구간이 무방비였고,
 * 실제로 JS는 `true`·Python은 `False`로 **정반대**였다(자유 실험판이 마운트 즉시
 * "달성"이 되어 화면이 튀던 CO-K7이 그 발현). 목표 없는 문항이 자동 정답이 되는 것을
 * 막는 쪽(서버)이 옳고, 서버가 채점 권위이므로 JS를 서버에 맞춘다.
 * board_test_vectors.json의 `goals` 블록이 이 판정을 양측에서 함께 고정한다.
 */
export function checkGoals(zoneResults, goalConditions) {
  const goals = goalConditions ?? [];
  const unmet = goals.filter((goal) => {
    if (!goal || typeof goal !== 'object') return true;
    if (!Number.isInteger(goal.zone) || goal.zone < 0 || goal.zone >= ZONES.length) return true;
    const result = zoneResults?.[goal.zone];
    if (!result) return true;
    // phenomenon은 **항상** 비교한다(누락이면 미충족) — 서버는 goal.get() 결과가
    // None이라 자동으로 불일치가 된다. cloud는 키가 있을 때만 비교(서버 `"cloud" in goal`).
    if (result.phenomenon !== goal.phenomenon) return true;
    if ('cloud' in goal && result.cloud !== goal.cloud) return true;
    return false;
  });
  return { passed: goals.length > 0 && unmet.length === 0, unmet };
}

// ── UI용 보드 상태 조작 헬퍼 (불변 갱신) ───────────────────────────────────
/** 퍼즐 initial_state → 플레이 가능한 보드 상태 (깊은 복사, zones 보정) */
export function createBoard(initialState) {
  return {
    zones: [...ZONES],
    elements: (initialState?.elements ?? []).map((el) => ({ ...el })),
  };
}

/** 존의 특정 type 요소가 잠금(locked)인지 — 잠금 요소는 교체·제거 불가 (§3.3) */
export function isLocked(board, zone, type) {
  return (board?.elements ?? []).some((el) => el.zone === zone && el.type === type && el.locked);
}

/** 기단/전선 배치 — 같은 존의 같은 type을 교체한다. 잠금이면 원본 반환 */
export function placeElement(board, zone, type, subtype) {
  if (isLocked(board, zone, type)) return board;
  const elements = board.elements.filter((el) => !(el.zone === zone && el.type === type));
  elements.push({ type, subtype, zone });
  return { ...board, elements };
}

/** 기단/전선 제거 — 잠금이면 원본 반환 */
export function removeElement(board, zone, type) {
  if (isLocked(board, zone, type)) return board;
  return { ...board, elements: board.elements.filter((el) => !(el.zone === zone && el.type === type)) };
}

/** moisture/sun 슬라이더 값 설정 (0~100 clamp) — 잠금이면 원본 반환 */
export function setLevel(board, zone, type, level) {
  if (isLocked(board, zone, type)) return board;
  const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  const elements = board.elements.filter((el) => !(el.zone === zone && el.type === type));
  elements.push({ type, level: clamped, zone });
  return { ...board, elements };
}

/** 제출용 보드 상태 — UI 전용 locked 플래그를 제거해 §3.1 스키마만 남긴다 */
export function toSubmitState(board) {
  return {
    zones: [...ZONES],
    elements: (board?.elements ?? []).map(({ locked, ...el }) => el),
  };
}

// core만 import — index.js(zustand)를 끌면 mock의 순수 node 경로가 죽는다(core.js 주석)
import { RESOURCES, DEFAULT_LOCALE, translate, getCurrentLocale } from '../i18n/core.js';

/**
 * 능력(θ) 표시 공용 헬퍼 — WeatherBrainPanel(R6)에서 추출해
 * 온보딩 배치고사 결과 화면(R7-01 S3)과 공유한다.
 * θ(로짓, 대략 -3..+3)를 0..100 표시 스케일·라벨·레벨 칩으로 바꾸는 표현 계층.
 *
 * §6.3 외부화: CONCEPT_KO·LEVEL_KO는 이름·export 형태(`DICT[key] ?? fallback`
 * 인덱싱)를 보존한 채 i18n 리소스(`ability.*`) 파생 getter 사전으로 바꿨다 —
 * 소유 밖 소비처(ReviewQueueCard·DevPanel)가 그대로 동작한다. 접근 시점의
 * 현재 로케일로 풀리고, ko 값은 리소스에 바이트 동일(기존 스모크 단정 유지).
 * 미지 키는 종전처럼 undefined → 소비처의 `?? tag` 폴백이 그대로 산다.
 * ⚠️ ability.concept.*는 D2의 concept.*와 표기가 다른 별도 사전이다(원문 보존).
 */

/** 리소스 파생 사전 — 알려진 키만 enumerable getter로 노출(미지 키 undefined) */
function localizedDict(prefix, keys) {
  const dict = {};
  for (const key of keys) {
    Object.defineProperty(dict, key, {
      enumerable: true,
      get: () => translate(getCurrentLocale(), `${prefix}.${key}`),
    });
  }
  return dict;
}

// concept_tag → 표시명 (리소스 ability.concept.* 파생)
export const CONCEPT_KO = localizedDict('ability.concept', [
  'air_mass',
  'anomaly',
  'co2_climate',
  'heat_island',
  'density_buoyancy',
  'energy_transfer',
  'flood_response',
  'phase_change',
  'pressure_basics',
  'pressure_front',
  'radiation_budget',
  'temperature_heat',
  'typhoon',
  'wildfire_weather',
]);

// level_label → 표시명 + 배지 색(항상 텍스트와 함께 표기 — 색 단독 의미 아님)
// CO-S-4 / CO-L-F6: 서버 THETA_BAND_LABELS는 **4밴드**인데 여기가 3개라
// θ>1.5 유저에게 사전이 undefined를 주고, 소비처의 `?? tag` 폴백이 한국어 화면에
// 영문 `expert`를 그대로 띄웠다(칩은 색 폴백). 밴드 수를 서버와 맞춘다.
export const LEVEL_KO = localizedDict('ability.level', [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
]);
export const LEVEL_CHIP = {
  beginner: 'bg-slate-100 text-slate-600',
  intermediate: 'bg-sky-100 text-sky-700',
  advanced: 'bg-indigo-100 text-indigo-700',
  expert: 'bg-amber-100 text-amber-700',
};

// 단일 시리즈(사용자 1인의 능력) — 한 가지 색조(sky)만 사용.
export const COLOR_MEASURED = '#0284c7'; // sky-600 — 측정된 능력
export const COLOR_PRIOR = '#cbd5e1'; // slate-300 — 사전 배정(초기값)

/** θ(로짓 ~ -3..3) → 0..100 표시 스케일 */
export function thetaToScore(theta) {
  const t = typeof theta === 'number' ? theta : 0;
  return Math.round(Math.min(100, Math.max(0, ((t + 3) / 6) * 100)));
}

/**
 * θ → 레벨 라벨(초급/중급/고급/최상급) 클라이언트 파생 — 서버 level_label 부재 시
 * 폴백 전용. 경계는 backend `weatherbrain_service.THETA_BAND_BOUNDS`(-0.5, 0.5, 1.5)와
 * 동일해야 한다.
 * (R7-01 S3 계약 확정: 배치 complete abilities도 level_label을 포함 — 서버값 우선 사용)
 *
 * CO-L-F7: 경계가 3밴드(-0.5·0.5)뿐이라 독스트링이 "backend와 동일"이라 단정하면서도
 * **θ≥1.5에서 서버 `expert` ↔ 클라 `advanced`**로 갈렸다. 네 번째 경계를 세운다.
 */
export const THETA_BAND_BOUNDS = [-0.5, 0.5, 1.5];
export const THETA_BAND_LABELS = ['beginner', 'intermediate', 'advanced', 'expert'];

export function levelFromTheta(theta) {
  const t = typeof theta === 'number' ? theta : 0;
  for (let i = 0; i < THETA_BAND_BOUNDS.length; i += 1) {
    if (t < THETA_BAND_BOUNDS[i]) return THETA_BAND_LABELS[i];
  }
  return THETA_BAND_LABELS[THETA_BAND_LABELS.length - 1];
}

// ── 지식 단계(knowledge_level) 표시 — 위 4밴드와 **다른 축**이다 ─────────────
// 두 축은 대체가 아니라 병기다(backend weatherbrain_service의 「2축 분리」):
//   level_group(4밴드, 위 LEVEL_KO)  = 표현 톤
//   knowledge_level(N단계, 아래)      = 난이도
// 그래서 LEVEL_KO·THETA_BAND_BOUNDS는 한 글자도 건드리지 않았다.
//
// 단계 정의의 SSOT는 `database/seed/level_vocabulary.json`의 `anchor`(1~N)이고,
// 여기 라벨은 그 서술을 화면용으로 다듬은 것이다(마크다운 강조·성취기준 코드 제거,
// 뜻은 보존). 단계 수 N을 **여기에 박지 않는다** — 키 목록은 리소스에서 나오고,
// 분모는 서버가 주는 knowledge_level_max에서만 나온다. N이 10→12가 되면
// 리소스에 두 칸을 추가하는 것이 전부다(tests/knowledgeLevel.test.mjs가 감시).
const KNOWLEDGE_LEVEL_KEYS = Object.keys(
  RESOURCES[DEFAULT_LOCALE]?.ability?.knowledgeLevel?.name ?? {},
);

/** 단계 → 표시명(제도적 단계). 예: 7 → '고등학교 진로선택' */
export const KNOWLEDGE_LEVEL_NAME = localizedDict(
  'ability.knowledgeLevel.name',
  KNOWLEDGE_LEVEL_KEYS,
);
/** 단계 → 부제(영역·과목). 예: 7 → '지구시스템과학 · 고급 지구과학' */
export const KNOWLEDGE_LEVEL_SUB = localizedDict(
  'ability.knowledgeLevel.sub',
  KNOWLEDGE_LEVEL_KEYS,
);

/**
 * 서버 응답 → `{level, max}` 또는 null(= 화면에서 감춘다).
 *
 * 서버 계약(R13-02 T3): `knowledge_level`·`knowledge_level_max`.
 * **사용자 1인의 대표 단계는 `GET /progress/me`에만 있다.** /progress/mastery ·
 * /progress/abilities의 같은 이름 필드는 **개념별** 값이라 뜻이 다르다 —
 * 그것을 "현재 단계"로 접는 방법(평균? 최대?)은 제품 결정이라 여기서 정하지 않는다.
 *
 * 필드가 없거나(구 백엔드) null이면(콜드스타트 — θ 행 없음) null을 돌려 소비처가
 * 카드째 감추게 하는 것이 이 함수의 본체다(깨지지 않는 쪽 우선).
 *
 * 배열도 받는다: 한 행짜리 응답을 그대로 넘겨도 동작하게 하는 편의일 뿐이고,
 * 개념별 목록을 여기 넘기지 말 것(첫 행 = 가장 약한 개념이다).
 *
 * max는 선택이다: 없으면 진행 막대·다음 단계 줄만 빠지고 단계 자체는 뜬다.
 */
export function selectKnowledgeLevel(source) {
  const row = Array.isArray(source) ? source[0] : source;
  const level = row?.knowledge_level;
  if (!Number.isInteger(level) || level < 1) return null;
  const max = row?.knowledge_level_max;
  return { level, max: Number.isInteger(max) && max >= level ? max : null };
}

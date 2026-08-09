// core만 import — index.js(zustand)를 끌면 mock의 순수 node 경로가 죽는다(core.js 주석)
import { translate, getCurrentLocale } from '../i18n/core.js';

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

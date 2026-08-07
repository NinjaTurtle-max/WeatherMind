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
export const LEVEL_KO = localizedDict('ability.level', [
  'beginner',
  'intermediate',
  'advanced',
]);
export const LEVEL_CHIP = {
  beginner: 'bg-slate-100 text-slate-600',
  intermediate: 'bg-sky-100 text-sky-700',
  advanced: 'bg-indigo-100 text-indigo-700',
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
 * θ → 레벨 라벨(초급/중급/고급) 클라이언트 파생 — 서버 level_label 부재 시 폴백 전용.
 * 경계(-0.5, 0.5)는 backend weatherbrain_service.theta_level_label과 동일해야 한다.
 * (R7-01 S3 계약 확정: 배치 complete abilities도 level_label을 포함 — 서버값 우선 사용)
 */
export function levelFromTheta(theta) {
  const t = typeof theta === 'number' ? theta : 0;
  if (t < -0.5) return 'beginner';
  if (t < 0.5) return 'intermediate';
  return 'advanced';
}

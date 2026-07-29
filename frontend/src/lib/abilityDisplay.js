/**
 * 능력(θ) 표시 공용 헬퍼 — WeatherBrainPanel(R6)에서 추출해
 * 온보딩 배치고사 결과 화면(R7-01 S3)과 공유한다.
 * θ(로짓, 대략 -3..+3)를 0..100 표시 스케일·한글 라벨·레벨 칩으로 바꾸는 표현 계층.
 */

// concept_tag → 한글 표시명
export const CONCEPT_KO = {
  air_mass: '기단',
  anomaly: '이상기후',
  co2_climate: 'CO₂·기후변화',
  heat_island: '열섬효과',
  pressure_front: '기압·전선',
  typhoon: '태풍',
};

// level_label → 한글 + 배지 색(항상 텍스트와 함께 표기 — 색 단독 의미 아님)
export const LEVEL_KO = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급',
};
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

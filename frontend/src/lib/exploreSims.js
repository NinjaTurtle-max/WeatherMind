/**
 * 탐구 시뮬 v1 — 결정적 교육 모델 (R9-01 §3.5, S5)
 *
 * ⚠️ 이 파일은 **수치 예보/기후 모델이 아니다**. 실제 대기과학의 정성적 경향
 * (단조성·임계·로그 감도)만 보존한 교육용 결정적 근사다. R3 "시뮬레이터 폐지"
 * 원칙과 충돌하지 않는다 — 난수·시간 의존 없음, 같은 입력이면 항상 같은 출력.
 *
 * [태풍 모델의 과학적 근거와 단순화]
 * - 발생 임계 SST 26.5℃: 열대저기압 발생의 고전적 경험 조건(Gray 1968·Palmén 1948
 *   계열 교과 값). 실제로는 26~27℃ 범위에 대기 성층·와도 등 6개 조건이 더 붙지만,
 *   교육 모델은 SST 임계 하나로 단순화한다.
 * - 강도 ∝ SST 초과분: 잠재강도(Potential Intensity) 이론의 "따뜻한 바다가 연료"
 *   라는 핵심만 선형 근사. 실제 PI는 해양 열용량·유출온도 등의 비선형 함수다.
 * - 연직 시어가 강할수록 약화: 시어가 태풍의 연직 구조(온난핵)를 기울여 발달을
 *   방해한다는 정성적 사실을 계수 1개(0.35~1.0)로 축약.
 * - intensity 0~100은 무차원 교육 지수이며 실제 풍속(m/s)·중심기압(hPa)이 아니다.
 *   카테고리 표기는 국내 통보 관례(TD·TS·STS·TY·초강력)를 차용한 교육용 구간이다.
 *
 * [기후 모델의 과학적 근거와 단순화]
 * - ΔT = S · log2(C/C0): CO2 복사강제력이 농도의 로그에 비례한다는 표준 근사
 *   (Arrhenius 계보, IPCC의 5.35·ln(C/C0) W/m²)를 "배증당 S℃"로 표현.
 *   S = 3.0℃는 IPCC AR6 평형기후민감도 최적 추정값(교육값). 평형 응답이므로
 *   해양 열관성에 의한 지연(과도 응답)은 무시한다.
 * - 해수면·폭염일수는 ΔT의 파생 교육 지표(열팽창+빙하 융해 근사, 비선형 폭염
 *   증가 근사)로, 특정 연도·지역 전망치가 아니다.
 */

// ---------------------------------------------------------------------------
// 태풍 모델 상수
// ---------------------------------------------------------------------------

/** 태풍 발생 임계 해수면온도(℃) — 이 미만이면 발생하지 않는다. */
export const SST_GENESIS_THRESHOLD = 26.5;

/** 슬라이더 입력 범위(℃) */
export const SST_MIN = 24;
export const SST_MAX = 32;

/** 연직 시어 3단계 → 발달 효율 계수(1=방해 없음). 강할수록 발달을 깎는다. */
export const SHEAR_FACTOR = Object.freeze({
  weak: 1.0,
  moderate: 0.65,
  strong: 0.35,
});

/**
 * 교육 지수(0~100) → 카테고리 구간. 실제 통보 기준(최대풍속 m/s)이 아니라
 * 교육용 구간이다. 경계값은 하한 포함(intensity ≥ min).
 */
export const TYPHOON_CATEGORIES = Object.freeze([
  { category: 'super', min: 85 },
  { category: 'TY', min: 60 },
  { category: 'STS', min: 40 },
  { category: 'TS', min: 20 },
  { category: 'TD', min: 1 },
]);

/** 발달 곡선 단계 수(t = 0..11, 교육용 무차원 시간) */
export const CURVE_STEPS = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function categoryOf(intensity) {
  for (const { category, min } of TYPHOON_CATEGORIES) {
    if (intensity >= min) return category;
  }
  return 'none';
}

/**
 * 태풍 강도 교육 모델 (결정적 순수 함수).
 *
 * intensity = round((15 + 85 · excess/5.5) · shearFactor)
 *   - excess = max(0, sst − 26.5), 5.5 = 입력 최대 초과분(32 − 26.5)
 *   - sst < 26.5 ⇒ 발생 없음(category 'none', intensity 0, 곡선 평탄)
 *   - sst 고정 시 시어 약→강 단조감소, 시어 고정 시 sst 단조증가(비감소)
 *
 * 발달 곡선: 로지스틱 성장 L(t) = 1/(1+e^−(t−4)/1.6) 을 [0, intensity]로 정규화한
 * 12단계 배열. 시어 '강'일 때만 후반(t ≥ 8) 최대 30% 감쇠 — 시어가 발달 후에도
 * 구조를 무너뜨린다는 정성적 사실의 교육적 표현.
 *
 * @param {{sst: number, shear: 'weak'|'moderate'|'strong'}} input
 *   sst: 해수면온도(℃), 24~32로 클램프. shear: 연직 시어(약/중/강).
 * @returns {{category: 'none'|'TD'|'TS'|'STS'|'TY'|'super', intensity: number,
 *   curve: number[]}} intensity는 0~100 정수, curve는 길이 12(소수 1자리).
 */
export function typhoonIntensity({ sst, shear }) {
  const factor = SHEAR_FACTOR[shear];
  if (factor === undefined) {
    throw new Error(`shear는 weak|moderate|strong 중 하나여야 합니다: ${shear}`);
  }
  const t = clamp(Number(sst), SST_MIN, SST_MAX);

  if (t <= SST_GENESIS_THRESHOLD) {
    // 임계 미만(및 정확히 임계)에서는 초과 에너지가 0 — 발생하지 않는다.
    return { category: 'none', intensity: 0, curve: new Array(CURVE_STEPS).fill(0) };
  }

  const excess = t - SST_GENESIS_THRESHOLD; // 0 < excess ≤ 5.5
  const maxExcess = SST_MAX - SST_GENESIS_THRESHOLD;
  const intensity = clamp(Math.round((15 + 85 * (excess / maxExcess)) * factor), 1, 100);

  // 로지스틱 발달 곡선 — L(0)~L(11)을 [0, intensity]로 정규화.
  const L = (step) => 1 / (1 + Math.exp(-(step - 4) / 1.6));
  const l0 = L(0);
  const lEnd = L(CURVE_STEPS - 1);
  const curve = Array.from({ length: CURVE_STEPS }, (_, step) => {
    let v = (intensity * (L(step) - l0)) / (lEnd - l0);
    if (shear === 'strong' && step >= 8) {
      v *= 1 - 0.3 * ((step - 8) / (CURVE_STEPS - 1 - 8));
    }
    return Math.round(v * 10) / 10;
  });

  return { category: categoryOf(intensity), intensity, curve };
}

// ---------------------------------------------------------------------------
// 기후변화 모델 상수
// ---------------------------------------------------------------------------

/** 산업화 이전 기준 CO2 농도(ppm) */
export const CO2_BASELINE = 280;
/** 슬라이더 입력 범위(ppm) — 배증(560)까지 */
export const CO2_MIN = 280;
export const CO2_MAX = 560;
/** 평형기후민감도(℃/배증) — IPCC AR6 최적 추정 3.0을 교육값으로 채택 */
export const CLIMATE_SENSITIVITY = 3.0;
/** 해수면 상승 교육 근사: ΔT 1℃당 약 23cm(열팽창+빙하 융해 축약) */
export const SEA_LEVEL_CM_PER_DEG = 23;
/** 폭염일수 교육 근사: 기준 10일/년, ΔT 1℃당 ×1.9(비선형 증가 축약) */
export const HEAT_DAYS_BASELINE = 10;
export const HEAT_DAYS_GROWTH = 1.9;

/**
 * 기후 응답 교육 모델 (결정적 순수 함수).
 *
 * anomaly(℃) = S · log2(C / C0)   — S = 3.0, C0 = 280ppm (소수 2자리 반올림)
 * sea_level(cm) = round(anomaly · 23)
 * heat_days(일/년) = round(10 · 1.9^anomaly)
 *
 * 세 지표 모두 CO2에 단조증가. 280ppm에서 전부 기준값(0℃·0cm·10일).
 *
 * @param {{co2: number}} input CO2 농도(ppm), 280~560으로 클램프.
 * @returns {{anomaly: number, sea_level: number, heat_days: number}}
 *   anomaly: 산업화 이전 대비 온도 아노말리(℃), sea_level: 해수면 상승(cm),
 *   heat_days: 연간 폭염일수(일).
 */
export function climateResponse({ co2 }) {
  const c = clamp(Number(co2), CO2_MIN, CO2_MAX);
  const anomalyRaw = CLIMATE_SENSITIVITY * Math.log2(c / CO2_BASELINE);
  const anomaly = Math.round(anomalyRaw * 100) / 100;
  return {
    anomaly,
    sea_level: Math.round(anomalyRaw * SEA_LEVEL_CM_PER_DEG),
    heat_days: Math.round(HEAT_DAYS_BASELINE * Math.pow(HEAT_DAYS_GROWTH, anomalyRaw)),
  };
}

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
 * - **S와 해수면 계수는 상수가 아니라 조작 변수다**(2026-08-19). 두 값에는 실제로
 *   평가된 불확실성 폭이 있고, 그 폭을 만져 보는 것이 「변수를 바꿔가며 비교」의
 *   본체다. 범위의 출처는 각 상수 선언 위에 URL·원문 인용으로 적어 두었다 —
 *   범위를 고칠 때는 그 인용을 먼저 갱신할 것(근거 없는 범위는 교육적 거짓이다).
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
 *   - sst <= 26.5 ⇒ 발생 없음(category 'none', intensity 0, 곡선 평탄)
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
/** 평형기후민감도(℃/배증) — IPCC AR6 최적 추정 3.0을 교육값·**기본값**으로 채택 */
export const CLIMATE_SENSITIVITY = 3.0;

/**
 * 민감도 슬라이더 범위 — **IPCC AR6가 평가한 very likely range 2~5℃ 그대로**.
 *
 * 출처(2026-08-19 확인, IPCC AR6 WG1 Chapter 7 Executive Summary 원문):
 *   https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-7/
 *   "Based on multiple lines of evidence the best estimate of ECS is 3°C, the
 *    likely range is 2.5°C to 4°C, and the very likely range is 2°C to 5°C.
 *    It is virtually certain that ECS is larger than 1.5°C."
 *
 * likely(2.5~4) 대신 very likely(2~5)를 **슬라이더 폭**으로 쓴 이유: 둘 다 AR6가
 * 평가한 범위인데, 좁은 쪽을 쓰면 만질 수 있는 폭이 1.5℃뿐이라 "축을 바꿔가며
 * 비교"가 다시 좁아진다. 대신 likely 경계는 아래 상수로 남겨 화면 눈금에 적어
 * **어디까지가 가능성 높은 구간인지**를 함께 읽게 한다.
 * ⚠️ 이 범위를 임의로 넓히지 말 것 — 1.5℃ 아래는 AR6가 "virtually certain"으로
 * 배제한 값이라, 슬라이더에 넣으면 화면이 **교육적으로 거짓인 범위**를 가르친다.
 */
export const CLIMATE_SENSITIVITY_MIN = 2.0;
export const CLIMATE_SENSITIVITY_MAX = 5.0;
export const CLIMATE_SENSITIVITY_STEP = 0.1;
/** 참고 눈금용 — AR6 likely range(66%) 경계. 슬라이더 범위가 아니라 **표시**다. */
export const CLIMATE_SENSITIVITY_LIKELY = Object.freeze({ lo: 2.5, hi: 4.0 });

/** 해수면 상승 교육 근사: ΔT 1℃당 약 23cm(열팽창+빙하 융해 축약) — **기본값** */
export const SEA_LEVEL_CM_PER_DEG = 23;

/**
 * 해수면 계수 슬라이더 범위(cm/℃) 14~39 — **AR6가 cm/℃ 자체를 평가한 값은 없다.**
 * 그래서 SPM의 **평가값 두 개를 나눠 만든 탐구용 봉투**이고, 그 경위를 남긴다.
 *
 * 재료 ⓐ 2100년 전 지구 평균 해수면 상승(1995–2014 대비, likely) — AR6 WG1 SPM B.5.3:
 *   SSP1-1.9 0.28–0.55 m · SSP1-2.6 0.32–0.62 m · SSP2-4.5 0.44–0.76 m ·
 *   SSP5-8.5 0.63–1.01 m
 * 재료 ⓑ 2081–2100 승온(1850–1900 대비, very likely) — 같은 SPM 본문:
 *   SSP1-1.9 1.0–1.8℃ · SSP2-4.5 2.1–3.5℃ · SSP5-8.5 3.3–5.7℃
 *   (SSP1-2.6은 본문에 승온 범위가 인용돼 있지 않아 계산에서 뺐다 — 그 값의
 *    소유자는 Table SPM.1이고 그 표는 **그림 파일**이라 원문 대조가 불가했다.)
 * 계산 = ⓐ(cm) ÷ ⓑ의 중앙값(1.4 / 2.8 / 4.5℃):
 *   SSP1-1.9 20.0~39.3 · SSP2-4.5 15.7~27.1 · SSP5-8.5 14.0~22.4
 *   ⇒ 봉투 14.0~39.3 → 슬라이더 14~39 (기본 23은 그 안)
 * 출처(2026-08-19 확인): https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/
 *
 * ⚠️ 세 가지를 분명히 해 둔다.
 *  ① **평가된 신뢰구간이 아니다.** 서로 다른 평가값의 비라서 확률 해석이 없다.
 *  ② **승온의 불확실성은 일부러 뺐다**(범위 대신 중앙값으로 나눴다). 그쪽은 이미
 *     민감도 슬라이더가 담당하므로, 여기 또 넣으면 같은 불확실성을 두 축이
 *     중복으로 세고 학습자는 무엇 때문에 값이 커졌는지 분리할 수 없다.
 *  ③ **2100년 눈금이다.** 이 모델의 anomaly는 평형 응답인데 ⓐ·ⓑ는 21세기
 *     과도 응답이라, 장기 위임(commitment)은 이보다 훨씬 크다 — SPM B.5.4는
 *     "Over the next 2000 years, global mean sea level will rise by about 2 to 3 m
 *     if warming is limited to 1.5°C"로 평가한다(≈130~200 cm/℃). 즉 이 슬라이더는
 *     「금세기 안에 얼마나」의 폭이고, 천년 단위 위임을 가르치는 축이 아니다.
 */
export const SEA_LEVEL_CM_PER_DEG_MIN = 14;
export const SEA_LEVEL_CM_PER_DEG_MAX = 39;
export const SEA_LEVEL_CM_PER_DEG_STEP = 1;
/**
 * 폭염일수 교육 근사: 기준 10일/년, ΔT 1℃당 ×1.9(비선형 증가 축약).
 *
 * ⚠️ **이 계수는 일부러 슬라이더로 만들지 않았다**(2026-08-19 판정 — 근거를 남긴다).
 * 세 계수 중 하나를 더 조작 변수로 올릴 후보였는데, 1차 자료에서 **합의된 범위를
 * 찾지 못했다.** 찾아본 것과 결과:
 *  · AR6 WG1 Chapter 11 본문에는 고온 극값의 **빈도 배수가 숫자로 적혀 있지 않다**
 *    (강수는 "4℃에서 10년 사건 2배·50년 사건 3배"처럼 본문에 있는데 고온은 없다).
 *  · 배수가 있는 자리는 SPM Figure SPM.6인데 **그림 안의 값**이고, 무엇보다
 *    **다른 양이다** — 그쪽은 「1850–1900에 10년에 한 번이던 일최고기온 사건」의
 *    빈도 배수이고, 이 모델은 「연 10일이던 폭염일수」의 배수다. 기준 희귀도가
 *    다르면 배수도 다르다(희귀한 사건일수록 배수가 크다).
 *  · 게다가 SPM.6에서 역산되는 「1℃당 배수」는 **일정하지 않다**(승온이 커질수록
 *    작아진다). 상수 밑 g 하나로 표현되는 양이 아니라는 뜻이라, 그 값들로 만든
 *    범위는 이 식의 g의 범위가 아니다.
 * ⇒ 모르는 범위를 만지게 하는 것보다 축을 하나 덜 두는 것이 낫다. 근거 있는
 *    범위를 찾으면 그때 승격한다(그때도 기본값 1.9는 유지 — 아래 계약 참조).
 */
export const HEAT_DAYS_BASELINE = 10;
export const HEAT_DAYS_GROWTH = 1.9;

/**
 * 유한한 수만 받고 아니면 기본값으로 — 새 입력이 생략·null·NaN일 때 **현행 상수와
 * 똑같이** 동작해야 하기 때문이다(아래 하위 호환 계약). 그다음 범위로 클램프한다.
 */
function paramOr(value, fallback, lo, hi) {
  // 🔴 `Number(null)`과 `Number('')`는 **0이고 유한하다** — 그래서 `Number.isFinite`
  // 하나로는 그 둘이 기본값으로 안 떨어지고 **하한으로 클램프된다.** 민감도라면
  // null 하나가 3.0이 아니라 2.0으로 읽히는 것이고, 이 함수 주석이 약속한
  // "생략·null·NaN일 때 현행 상수와 똑같이"를 어긴다. 계약이 잡았다
  // (tests/exploreSims.test.mjs ⑬ⓒ, 2026-08-19).
  if (value === null || value === '') return clamp(fallback, lo, hi);
  const n = Number(value);
  return clamp(Number.isFinite(n) ? n : fallback, lo, hi);
}

/**
 * 기후 응답 교육 모델 (결정적 순수 함수).
 *
 * anomaly(℃) = S · log2(C / C0)          — C0 = 280ppm (소수 2자리 반올림)
 * sea_level(cm) = round(anomaly_raw · K)
 * heat_days(일/년) = round(10 · 1.9^anomaly_raw)
 *
 * **조작 변수 3개**(대회 배점 「변수를 바꿔가며」 — 축이 하나면 비교가 성립하지 않는다):
 *   C = co2             세 지표 전부를 움직인다 (원인 쪽 축)
 *   S = sensitivity     세 지표 전부를 움직인다 (원인의 **불확실성** 축, AR6 2~5℃)
 *   K = seaLevelPerDeg  해수면 하나만 움직인다 (영향의 불확실성 축, 14~39 cm/℃)
 * S·K를 함께 둔 이유: 전 지표를 움직이는 축(C·S)만 있으면 학습자는 "세상이 더
 * 더워졌다"와 "그 결과가 더 민감하다"를 분리할 수 없다. 지표 하나만 움직이는 축이
 * 있어야 둘이 갈린다. 반대로 단일 지표 축만 있으면 비교의 기준이 안 생긴다.
 *
 * 🔴 **하위 호환 계약**: `climateResponse({ co2 })` 한 인자 호출은 **개정 전과 완전히
 * 같은 값**을 낸다(S·K 기본값 = 종전 상수). 이 계약의 감시자는
 * tests/exploreSims.test.mjs이고, 기본값을 바꾸면 그쪽이 먼저 운다 — 목표 창
 * (exploreGoals CLIMATE_GOALS의 387~396ppm 같은 실측 창)이 전부 이 기본값 위에서
 * 측정된 값이라 조용히 바뀌면 목표가 도달 불가가 된다.
 *
 * 세 지표 모두 CO2·S에 단조증가, 해수면은 K에도 단조증가. 280ppm에서는 S·K와
 * 무관하게 전부 기준값(0℃·0cm·10일)이다 — log2(1) = 0이기 때문이다.
 *
 * @param {{co2: number, sensitivity?: number, seaLevelPerDeg?: number}} input
 *   co2: CO2 농도(ppm) 280~560 클램프.
 *   sensitivity: 평형기후민감도(℃/배증) 2~5 클램프, 기본 3.0.
 *   seaLevelPerDeg: 해수면 계수(cm/℃) 14~39 클램프, 기본 23.
 * @returns {{anomaly: number, sea_level: number, heat_days: number}}
 *   anomaly: 산업화 이전 대비 온도 아노말리(℃), sea_level: 해수면 상승(cm),
 *   heat_days: 연간 폭염일수(일).
 */
export function climateResponse({ co2, sensitivity, seaLevelPerDeg }) {
  const c = clamp(Number(co2), CO2_MIN, CO2_MAX);
  const s = paramOr(sensitivity, CLIMATE_SENSITIVITY, CLIMATE_SENSITIVITY_MIN, CLIMATE_SENSITIVITY_MAX);
  const k = paramOr(seaLevelPerDeg, SEA_LEVEL_CM_PER_DEG, SEA_LEVEL_CM_PER_DEG_MIN, SEA_LEVEL_CM_PER_DEG_MAX);
  const anomalyRaw = s * Math.log2(c / CO2_BASELINE);
  const anomaly = Math.round(anomalyRaw * 100) / 100;
  return {
    anomaly,
    sea_level: Math.round(anomalyRaw * k),
    heat_days: Math.round(HEAT_DAYS_BASELINE * Math.pow(HEAT_DAYS_GROWTH, anomalyRaw)),
  };
}

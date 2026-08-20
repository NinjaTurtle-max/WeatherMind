/**
 * 탐구 시뮬 교육 모델 단위 테스트 (R9-01 §3.5 S5) — node tests/exploreSims.test.mjs
 *
 * 결정적 순수 함수(src/lib/exploreSims.js)의 계약을 검증한다:
 *   태풍 — 발생 임계(26.5℃)·SST 단조증가·시어 단조감소·카테고리 경계·곡선 형태·클램프
 *   기후 — 기준점(280ppm=0)·배증(560ppm=3.0℃)·단조성·파생 지표·클램프·결정성
 */
import {
  typhoonIntensity,
  climateResponse,
  SST_GENESIS_THRESHOLD,
  SST_MIN,
  SST_MAX,
  CURVE_STEPS,
  CO2_BASELINE,
  CO2_MAX,
  CLIMATE_SENSITIVITY,
  CLIMATE_SENSITIVITY_MIN,
  CLIMATE_SENSITIVITY_MAX,
  SEA_LEVEL_CM_PER_DEG,
  SEA_LEVEL_CM_PER_DEG_MIN,
  SEA_LEVEL_CM_PER_DEG_MAX,
  HEAT_DAYS_BASELINE,
  HEAT_DAYS_GROWTH,
} from '../src/lib/exploreSims.js';

let failed = 0;
let passed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SHEARS = ['weak', 'moderate', 'strong'];

// --- 태풍: 발생 임계 ---------------------------------------------------------
for (const shear of SHEARS) {
  const below = typhoonIntensity({ sst: 26.4, shear });
  const at = typhoonIntensity({ sst: SST_GENESIS_THRESHOLD, shear });
  const above = typhoonIntensity({ sst: 26.6, shear });
  check(`임계 미만(26.4, ${shear})은 발생 없음`, below.category === 'none' && below.intensity === 0);
  check(`정확히 임계(26.5, ${shear})는 초과 에너지 0 — 발생 없음`, at.category === 'none' && at.intensity === 0);
  check(`임계 초과(26.6, ${shear})는 발생`, above.intensity > 0 && above.category !== 'none',
    `intensity=${above.intensity} category=${above.category}`);
  check(`임계 미만 곡선은 전부 0 (${shear})`, below.curve.every((v) => v === 0));
}

// --- 태풍: SST 단조성 (시어 고정, 0.1℃ 격자) --------------------------------
for (const shear of SHEARS) {
  let prev = -Infinity;
  let monotone = true;
  for (let sst = SST_MIN; sst <= SST_MAX + 1e-9; sst += 0.1) {
    const { intensity } = typhoonIntensity({ sst: Math.round(sst * 10) / 10, shear });
    if (intensity < prev) { monotone = false; break; }
    prev = intensity;
  }
  check(`SST 단조증가(비감소, ${shear})`, monotone);
}

// --- 태풍: 시어 단조성 (SST 고정) --------------------------------------------
for (const sst of [27, 28.5, 30, 32]) {
  const [w, m, s] = SHEARS.map((shear) => typhoonIntensity({ sst, shear }).intensity);
  check(`시어 약≥중≥강 (SST ${sst})`, w >= m && m >= s, `weak=${w} moderate=${m} strong=${s}`);
  check(`시어 약>강 강순서 (SST ${sst})`, w > s, `weak=${w} strong=${s}`);
}

// --- 태풍: 경계·카테고리 -----------------------------------------------------
{
  const maxWeak = typhoonIntensity({ sst: SST_MAX, shear: 'weak' });
  check('최대 조건(32℃·약)은 super/100', maxWeak.category === 'super' && maxWeak.intensity === 100,
    `category=${maxWeak.category} intensity=${maxWeak.intensity}`);
  const maxStrong = typhoonIntensity({ sst: SST_MAX, shear: 'strong' });
  check('최대 SST·강시어는 super 미만', maxStrong.category !== 'super' && maxStrong.intensity < 85,
    `category=${maxStrong.category} intensity=${maxStrong.intensity}`);
  check('intensity는 0~100 정수', Number.isInteger(maxStrong.intensity));
  const cats = new Set();
  for (let sst = SST_MIN; sst <= SST_MAX + 1e-9; sst += 0.1) {
    for (const shear of SHEARS) cats.add(typhoonIntensity({ sst: Math.round(sst * 10) / 10, shear }).category);
  }
  for (const c of ['none', 'TD', 'TS', 'STS', 'TY', 'super']) {
    check(`입력 격자에서 카테고리 ${c} 도달 가능`, cats.has(c));
  }
}

// --- 태풍: 클램프·발달 곡선 ---------------------------------------------------
{
  const under = typhoonIntensity({ sst: 20, shear: 'weak' });
  const over = typhoonIntensity({ sst: 40, shear: 'weak' });
  check('SST 하한 클램프(20→24)', under.intensity === typhoonIntensity({ sst: SST_MIN, shear: 'weak' }).intensity);
  check('SST 상한 클램프(40→32)', over.intensity === 100);

  const dev = typhoonIntensity({ sst: 30, shear: 'weak' });
  check('곡선 길이 12', dev.curve.length === CURVE_STEPS);
  check('곡선 시작 0', dev.curve[0] === 0);
  check('곡선 끝 = intensity', Math.abs(dev.curve[CURVE_STEPS - 1] - dev.intensity) < 0.05 + 1e-9,
    `end=${dev.curve[CURVE_STEPS - 1]} intensity=${dev.intensity}`);
  check('약시어 곡선 단조증가', dev.curve.every((v, i) => i === 0 || v >= dev.curve[i - 1]));
  const strong = typhoonIntensity({ sst: 30, shear: 'strong' });
  check('강시어 곡선 후반 감쇠(끝 < 최대)', strong.curve[CURVE_STEPS - 1] < Math.max(...strong.curve),
    `end=${strong.curve[CURVE_STEPS - 1]} max=${Math.max(...strong.curve)}`);
  check('곡선은 intensity 초과 없음', strong.curve.every((v) => v <= strong.intensity + 1e-9));
}

// --- 태풍: 결정성·입력 검증 ---------------------------------------------------
{
  const a = typhoonIntensity({ sst: 29.3, shear: 'moderate' });
  const b = typhoonIntensity({ sst: 29.3, shear: 'moderate' });
  check('태풍 결정성(같은 입력=같은 출력)', JSON.stringify(a) === JSON.stringify(b));
  let threw = false;
  try { typhoonIntensity({ sst: 28, shear: 'typhoon' }); } catch { threw = true; }
  check('알 수 없는 shear는 예외', threw);
}

// --- 기후: 기준점·배증·감도 ---------------------------------------------------
{
  const base = climateResponse({ co2: CO2_BASELINE });
  check('280ppm → 아노말리 0℃', base.anomaly === 0, `anomaly=${base.anomaly}`);
  check('280ppm → 해수면 0cm', base.sea_level === 0);
  check('280ppm → 폭염일수 기준값', base.heat_days === HEAT_DAYS_BASELINE);

  const doubled = climateResponse({ co2: CO2_MAX });
  check('560ppm(배증) → 아노말리 = S = 3.0℃', doubled.anomaly === CLIMATE_SENSITIVITY,
    `anomaly=${doubled.anomaly}`);
  const half = climateResponse({ co2: 396 }); // 280·√2 ≈ 396 → 반배증 ≈ S/2
  check('√2배(≈396ppm) → 아노말리 ≈ 1.5℃', Math.abs(half.anomaly - 1.5) <= 0.01, `anomaly=${half.anomaly}`);
}

// --- 기후: 단조성·파생 지표·클램프 --------------------------------------------
{
  let prev = { anomaly: -Infinity, sea_level: -Infinity, heat_days: -Infinity };
  let monotone = true;
  for (let co2 = CO2_BASELINE; co2 <= CO2_MAX; co2 += 5) {
    const r = climateResponse({ co2 });
    if (r.anomaly < prev.anomaly || r.sea_level < prev.sea_level || r.heat_days < prev.heat_days) {
      monotone = false;
      break;
    }
    prev = r;
  }
  check('CO2 증가 시 세 지표 모두 단조증가(비감소)', monotone);

  const doubled = climateResponse({ co2: 560 });
  check('파생 지표 양수(560ppm)', doubled.sea_level > 0 && doubled.heat_days > HEAT_DAYS_BASELINE,
    `sea_level=${doubled.sea_level} heat_days=${doubled.heat_days}`);
  check('CO2 하한 클램프(100→280)', climateResponse({ co2: 100 }).anomaly === 0);
  check('CO2 상한 클램프(900→560)', climateResponse({ co2: 900 }).anomaly === CLIMATE_SENSITIVITY);
  const a = climateResponse({ co2: 427 });
  const b = climateResponse({ co2: 427 });
  check('기후 결정성(같은 입력=같은 출력)', JSON.stringify(a) === JSON.stringify(b));
}

// ── ⑬ 조작 변수 3축 (2026-08-19) ──────────────────────────────────────────
/**
 * 대회 배점 「변수를 바꿔가며」 — 축이 하나면 비교가 성립하지 않아 CO₂ 하나였던
 * 것을 3개로 늘렸다. **무엇이 참이면 「탐구가 성립한다」인가**를 먼저 정의한다:
 *
 *   ⓐ 세 축이 각각 **결과를 바꾼다**(안 바꾸는 축은 조작 변수가 아니다)
 *   ⓑ 각 축이 **자기가 책임지는 지표만** 바꾼다(해수면 계수가 폭염일수를
 *      움직이면 학습자는 무엇 때문에 값이 커졌는지 분리할 수 없다)
 *   ⓒ **한 인자 호출이 값을 안 바꾼다**(기존 호출·기존 계약 불변)
 *   ⓓ 범위 밖 입력이 **범위로 클램프**된다(교육적으로 거짓인 값이 안 나온다)
 *
 * 「그림이 따라 움직인다」(이 티켓의 본체)는 곡선이 JSX 쪽에 있어
 * tests/exploreSims.render.test.mjs가 소유한다.
 */
{
  // ⓒ 하위 호환 — 새 인자를 생략·null·NaN으로 줘도 현행 상수와 같아야 한다.
  //    ⚠️ 기대값을 여기 다시 못박지 않는다(§0-2). 「명시 기본값 호출과 같다」로
  //    물면 상수가 바뀌어도 계약이 따라오고, 상수 자체의 값은 위 블록들이 문다.
  const oneArg = climateResponse({ co2: 420 });
  const explicit = climateResponse({
    co2: 420,
    sensitivity: CLIMATE_SENSITIVITY,
    seaLevelPerDeg: SEA_LEVEL_CM_PER_DEG,
  });
  check('⑬ⓒ 한 인자 호출 = 명시 기본값 호출', JSON.stringify(oneArg) === JSON.stringify(explicit),
    `${JSON.stringify(oneArg)} vs ${JSON.stringify(explicit)}`);
  for (const bad of [null, undefined, NaN, 'x']) {
    const r = climateResponse({ co2: 420, sensitivity: bad, seaLevelPerDeg: bad });
    check(`⑬ⓒ 못 쓰는 입력(${String(bad)})은 기본값으로 떨어진다`,
      JSON.stringify(r) === JSON.stringify(explicit));
  }

  // ⓐ 세 축이 각각 결과를 바꾼다
  const lo = climateResponse({ co2: 420, sensitivity: CLIMATE_SENSITIVITY_MIN });
  const hi = climateResponse({ co2: 420, sensitivity: CLIMATE_SENSITIVITY_MAX });
  check('⑬ⓐ 민감도가 온도를 바꾼다', lo.anomaly < oneArg.anomaly && oneArg.anomaly < hi.anomaly,
    `${lo.anomaly} < ${oneArg.anomaly} < ${hi.anomaly}`);
  const seaLo = climateResponse({ co2: 420, seaLevelPerDeg: SEA_LEVEL_CM_PER_DEG_MIN });
  const seaHi = climateResponse({ co2: 420, seaLevelPerDeg: SEA_LEVEL_CM_PER_DEG_MAX });
  check('⑬ⓐ 해수면 계수가 해수면을 바꾼다',
    seaLo.sea_level < oneArg.sea_level && oneArg.sea_level < seaHi.sea_level,
    `${seaLo.sea_level} < ${oneArg.sea_level} < ${seaHi.sea_level}`);
  check('⑬ⓐ CO₂가 세 지표 전부를 바꾼다',
    climateResponse({ co2: 300 }).anomaly < oneArg.anomaly
    && climateResponse({ co2: 300 }).sea_level < oneArg.sea_level
    && climateResponse({ co2: 300 }).heat_days < oneArg.heat_days);

  // ⓑ 축이 자기 지표만 바꾼다 — 축 분리가 이 화면의 교육적 요점이다
  check('⑬ⓑ 해수면 계수는 온도를 안 바꾼다',
    seaLo.anomaly === oneArg.anomaly && seaHi.anomaly === oneArg.anomaly);
  check('⑬ⓑ 해수면 계수는 폭염일수를 안 바꾼다',
    seaLo.heat_days === oneArg.heat_days && seaHi.heat_days === oneArg.heat_days);
  check('⑬ⓑ 민감도는 해수면·폭염일수도 함께 바꾼다(온도가 그 둘의 원인이므로)',
    hi.sea_level > oneArg.sea_level && hi.heat_days > oneArg.heat_days);

  // ⓓ 클램프 — 범위 밖은 범위로. AR6가 배제한 1.5℃ 아래가 화면에 나오면 안 된다.
  check('⑬ⓓ 민감도 하한 클램프',
    climateResponse({ co2: 560, sensitivity: 0.5 }).anomaly === CLIMATE_SENSITIVITY_MIN);
  check('⑬ⓓ 민감도 상한 클램프',
    climateResponse({ co2: 560, sensitivity: 99 }).anomaly === CLIMATE_SENSITIVITY_MAX);
  const clampSea = climateResponse({ co2: 560, seaLevelPerDeg: 9999 });
  check('⑬ⓓ 해수면 계수 상한 클램프',
    clampSea.sea_level === Math.round(CLIMATE_SENSITIVITY * SEA_LEVEL_CM_PER_DEG_MAX),
    `sea_level=${clampSea.sea_level}`);

  // 폭염 계수는 **일부러** 슬라이더가 아니다(1차 자료에 합의 범위가 없다 —
  // lib 쪽 주석이 경위를 소유). 기본값이 살아 있는지만 확인한다: 승격됐다면
  // 이 줄이 아니라 위 ⓐ에 축이 하나 더 있어야 한다.
  check('⑬ 폭염 계수는 상수로 남아 있다', HEAT_DAYS_GROWTH === 1.9 && HEAT_DAYS_BASELINE === 10);
}

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed}건 실패 / ${passed}건 통과`);
  process.exit(1);
}
console.log(`OK: 탐구 시뮬 교육 모델 단위 테스트 ${passed}건 전부 통과`);

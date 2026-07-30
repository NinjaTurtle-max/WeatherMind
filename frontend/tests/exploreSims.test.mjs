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
  HEAT_DAYS_BASELINE,
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

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed}건 실패 / ${passed}건 통과`);
  process.exit(1);
}
console.log(`OK: 탐구 시뮬 교육 모델 단위 테스트 ${passed}건 전부 통과`);

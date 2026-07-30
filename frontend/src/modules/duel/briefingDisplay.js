/**
 * 브리핑 룸 표시 헬퍼 (R9-01 §3.4) — KMA 코드→한글/아이콘, 근거 코드 메타,
 * 차트 팔레트. 표현 계층 전용(판정·계산 없음). DuelPage와 LeaguePage(브리핑
 * 카드 재사용)가 공유한다.
 *
 * 차트 색 원칙(§3.4): 단일 팔레트 일관 — 지표당 색 1개 고정, 색+텍스트 병기
 * (색약 대응 — 색 단독으로 의미를 싣지 않는다). 4색 조합은 dataviz 6검사
 * (밝기 밴드·채도 하한·CVD 분리·일반 시야 분리·표면 대비) 통과값.
 */

// 지표별 고정 색 (Tailwind 600 계열 — 라이트 전용 index.css color-scheme)
export const CHART_COLORS = {
  temp: '#ea580c', // orange-600 — 기온(℃)
  pop: '#0284c7', // sky-600 — 강수확률(%)
  rain: '#4f46e5', // indigo-600 — 강수량(mm)
  wind: '#0d9488', // teal-600 — 풍속(m/s)
  reference: '#94a3b8', // slate-400 — TMX/TMN 기준선(라벨 텍스트 병기)
  grid: '#e2e8f0', // slate-200 — 보조 그리드
  tick: '#64748b', // slate-500 — 축 라벨
};

// KMA 하늘상태(SKY) 코드 → 표시 메타 (1 맑음 · 3 구름많음 · 4 흐림)
export const SKY_META = {
  1: { label: '맑음', icon: '☀️' },
  3: { label: '구름많음', icon: '⛅' },
  4: { label: '흐림', icon: '☁️' },
};

// KMA 강수형태(PTY) 코드 → 표시 메타 (0 없음 — 표시 생략)
export const PTY_META = {
  1: { label: '비', icon: '🌧️' },
  2: { label: '비/눈', icon: '🌨️' },
  3: { label: '눈', icon: '❄️' },
  4: { label: '소나기', icon: '🌦️' },
};

// 판단 근거 코드 5종 (R9-01 §3.1 화이트리스트와 1:1 — 순서 고정)
export const EVIDENCE_META = [
  { code: 'pop_trend', icon: '📈', label: '강수확률 추세', desc: '시간이 갈수록 강수확률이 높아져요' },
  { code: 'humidity_high', icon: '💧', label: '높은 습도', desc: '공기가 습해 비구름이 자라기 좋아요' },
  { code: 'temp_drop', icon: '🌡️', label: '기온 하강', desc: '전일보다 기온이 내려갈 것 같아요' },
  { code: 'sky_overcast', icon: '☁️', label: '흐린 하늘', desc: '하늘이 흐려 일사가 약해질 거예요' },
  { code: 'recent_rain', icon: '🌧️', label: '최근 강수 이력', desc: '최근 며칠 사이 비가 온 적이 있어요' },
];

const EVIDENCE_BY_CODE = new Map(EVIDENCE_META.map((m) => [m.code, m]));

/** 근거 코드 → 메타 (미지 코드는 코드 문자열 그대로 라벨) */
export function evidenceMeta(code) {
  return EVIDENCE_BY_CODE.get(code) ?? { code, icon: '📌', label: code, desc: '' };
}

/** 캐스터 오차 모델 티어 5계단 (R9-01 §3.2 계약 수치 — 표시 전용 폴백).
 *  실값은 ai_pred.noise_scale 스냅샷을 우선 사용한다. */
export const CASTER_NOISE_SCALE = {
  stratus: 1.0,
  cumulus: 0.85,
  nimbostratus: 0.7,
  cumulonimbus: 0.55,
  typhoon_eye: 0.4,
};

// 캐스터 기본 노이즈 진폭 (backend §1 탐색 확정: ±2℃ / ±15%p)
export const CASTER_BASE_NOISE = { temp: 2, rain: 15 };

/** ISO datetime → "HH시" (브리핑 hourly 축 라벨) */
export function fmtHour(datetime) {
  const hh = String(datetime ?? '').slice(11, 13);
  return hh ? `${Number(hh)}시` : '-';
}

/** ISO date → "M/D" (최근 실측 축 라벨) */
export function fmtMonthDay(date) {
  const [, m, d] = String(date ?? '').split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : '-';
}

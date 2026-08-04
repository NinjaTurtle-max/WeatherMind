/**
 * 대기 보드 표시 메타데이터 (R3-01 §3.6 원칙: 인과의 즉각 가시화 — 이모지+텍스트).
 * 판정 enum(§3.2)과 배치 요소 subtype에 사람이 읽을 라벨/아이콘을 매핑한다.
 * 계약 enum과 1:1 — 값 추가는 계약 변경 시에만.
 *
 * ⚠️ i18n 외부화 제외(R11-01 §6.3 판정): 서버 enum↔표시명 사전(어휘 데이터)이고,
 * boardAssistRetention 스모크가 이 라벨을 ANSWER_LABELS(정답 노출 검사)·팔레트
 * 상호작용 셀렉터(selectPalette('한랭전선')·[aria-label="한랭전선 제거"])로 물고
 * 있다. 로케일화는 스모크 로케일 고정 이후 웨이브에서 일괄.
 */

// 배치 요소 팔레트 항목 정의 (§3.3 palette 토큰 → UI)
//   토큰 형식: "air_mass:siberian" / "front:cold" / "moisture" / "sun"
export const AIR_MASS_META = {
  siberian: { label: '시베리아 기단', icon: '❄️', hint: '한랭 건조' },
  north_pacific: { label: '북태평양 기단', icon: '🥵', hint: '고온 다습' },
  yangtze: { label: '양쯔강 기단', icon: '🌤️', hint: '온난 건조' },
  okhotsk: { label: '오호츠크해 기단', icon: '🧊', hint: '한랭 다습' },
};

export const FRONT_META = {
  cold: { label: '한랭전선', icon: '🔵', hint: '찬 공기가 파고듦' },
  warm: { label: '온난전선', icon: '🔴', hint: '따뜻한 공기가 타고 오름' },
  stationary: { label: '정체전선', icon: '🟣', hint: '두 기단이 대치(장마)' },
};

export const PHENOMENON_META = {
  shower: { label: '소나기', icon: '🌦️' },
  rain: { label: '비', icon: '🌧️' },
  persistent_rain: { label: '지속성 비(장마)', icon: '☔' },
  snow: { label: '눈', icon: '❄️' },
  fog: { label: '안개', icon: '🌫️' },
  heatwave: { label: '폭염', icon: '🔥' },
  clear: { label: '맑음', icon: '☀️' },
  cloudy: { label: '흐림', icon: '☁️' },
};

export const CLOUD_META = {
  cumulonimbus: { label: '적란운', icon: '⛈️' },
  nimbostratus: { label: '난층운', icon: '🌧️' },
  stratus: { label: '층운', icon: '🌁' },
  cumulus: { label: '적운', icon: '⛅' },
  none: { label: '구름 없음', icon: '🌈' },
};

/** 팔레트 토큰 → {type, subtype?, meta} 파싱 (§3.3 palette 항목) */
export function parsePaletteToken(token) {
  if (token === 'moisture') return { type: 'moisture', label: '습기', icon: '💧' };
  if (token === 'sun') return { type: 'sun', label: '일사', icon: '☀️' };
  const [type, subtype] = token.split(':');
  if (type === 'air_mass') {
    const meta = AIR_MASS_META[subtype] ?? { label: subtype, icon: '🌀' };
    return { type, subtype, label: meta.label, icon: meta.icon, hint: meta.hint };
  }
  if (type === 'front') {
    const meta = FRONT_META[subtype] ?? { label: subtype, icon: '➰' };
    return { type, subtype, label: meta.label, icon: meta.icon, hint: meta.hint };
  }
  return { type: token, label: token, icon: '❔' };
}

export function subtypeLabel(type, subtype) {
  if (type === 'air_mass') return AIR_MASS_META[subtype]?.label ?? subtype;
  if (type === 'front') return FRONT_META[subtype]?.label ?? subtype;
  return subtype;
}

export function phenomenonMeta(phenomenon) {
  return PHENOMENON_META[phenomenon] ?? { label: phenomenon, icon: '❔' };
}

export function cloudMeta(cloud) {
  return CLOUD_META[cloud] ?? { label: cloud, icon: '❔' };
}

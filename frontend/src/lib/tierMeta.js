/**
 * 리그 티어 메타데이터 (R4-01 계약 §3.2 — 구름 분류 5단계, 독자 세계관).
 * tier 코드 → 표시명/색상/아이콘/ELO 하한. 계약 표와 1:1로 고정한다.
 *
 *   stratus       층운      < 1100 (기본)
 *   cumulus       적운      >= 1100
 *   nimbostratus  난층운    >= 1250
 *   cumulonimbus  적란운    >= 1400
 *   typhoon_eye   태풍의 눈  >= 1550
 *
 * 색상은 Tailwind 팔레트 클래스로 고정(라이트 전용 — index.css color-scheme).
 */
export const TIER_ORDER = ['stratus', 'cumulus', 'nimbostratus', 'cumulonimbus', 'typhoon_eye'];

export const TIER_META = {
  stratus: {
    code: 'stratus',
    label: '층운',
    icon: '🌫️',
    minElo: 0,
    // 배지 칩 스타일 (배경/텍스트/링)
    chip: 'bg-slate-100 text-slate-600 ring-slate-200',
    solid: 'bg-slate-400',
  },
  cumulus: {
    code: 'cumulus',
    label: '적운',
    icon: '⛅',
    minElo: 1100,
    chip: 'bg-sky-100 text-sky-700 ring-sky-200',
    solid: 'bg-sky-400',
  },
  nimbostratus: {
    code: 'nimbostratus',
    label: '난층운',
    icon: '🌧️',
    minElo: 1250,
    chip: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
    solid: 'bg-indigo-500',
  },
  cumulonimbus: {
    code: 'cumulonimbus',
    label: '적란운',
    icon: '⛈️',
    minElo: 1400,
    chip: 'bg-violet-100 text-violet-700 ring-violet-200',
    solid: 'bg-violet-600',
  },
  typhoon_eye: {
    code: 'typhoon_eye',
    label: '태풍의 눈',
    icon: '🌀',
    minElo: 1550,
    chip: 'bg-amber-100 text-amber-700 ring-amber-300',
    solid: 'bg-amber-500',
  },
};

const DEFAULT_TIER = TIER_META.stratus;

/** tier 코드 → 메타 (미지정/미상은 기본 층운) */
export function tierMeta(code) {
  return TIER_META[code] ?? DEFAULT_TIER;
}

/** ELO → tier 코드 (계약 §3.2 정산 산정식) — mock 서버(apiMockPlugin)가 사용 */
export function tierFromElo(elo) {
  const n = Number(elo);
  if (Number.isNaN(n)) return 'stratus';
  let tier = 'stratus';
  for (const code of TIER_ORDER) {
    if (n >= TIER_META[code].minElo) tier = code;
  }
  return tier;
}

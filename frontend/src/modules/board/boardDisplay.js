/**
 * 대기 보드 표시 메타데이터 (R3-01 §3.6 원칙: 인과의 즉각 가시화 — 이모지+텍스트).
 * 판정 enum(§3.2)과 배치 요소 subtype에 사람이 읽을 라벨/아이콘을 매핑한다.
 * 계약 enum과 1:1 — 값 추가는 계약 변경 시에만.
 *
 * §6.3 외부화 (MT-28 — 2026-08-11). 종전에 *"i18n 외부화 제외 … 로케일화는 스모크
 * 로케일 고정 이후 웨이브에서 일괄"*이라 적혀 있었고, **그 선행 조건은 이미
 * 착지해 있었다** — `boardAssistRetention.smoke:73`이 `weathermind.locale='ko'`를
 * 고정한다. 사유가 만료된 채 주석만 남아 있었고, 그 주석이 스스로 제외를 자백하면서도
 * 이월 대장에는 행이 없어 감사에서 8/10까지 안 잡혔다(§0.8.1ⓐ).
 *
 * 방식은 `lib/abilityDisplay.js`의 선례와 같다: **이름·export 형태·인덱싱
 * (`DICT[key]?.label ?? fallback`)을 보존한 채** 리소스 파생 getter로 바꾼다.
 * 접근 시점의 로케일로 풀리므로 소유 밖 소비처가 그대로 동작하고, **ko 값은
 * 리소스에 바이트 동일**이라 한국어 문구를 단정하는 스모크가 손대지 않고 통과한다.
 * 미지 키는 종전처럼 undefined → 소비처의 `?? subtype` 폴백이 그대로 산다.
 */
// core만 import — index.js(zustand)를 끌면 mock의 순수 node 경로가 죽는다(core.js 주석)
import { translate, getCurrentLocale } from '../../i18n/core.js';

const tx = (key) => translate(getCurrentLocale(), key);

/**
 * {key: {label, icon, hint?}} 사전을 리소스 파생 getter로 만든다.
 * icon은 이모지라 로케일 무관 — 리소스로 빼지 않는다(번역 대상이 아닌 것을 리소스에
 * 넣으면 ko/en 패리티 검사가 "번역되지 않은 값"을 계속 보고한다).
 */
function metaDict(prefix, entries) {
  const dict = {};
  for (const [key, icon, hasHint] of entries) {
    const meta = { icon };
    Object.defineProperty(meta, 'label', {
      enumerable: true,
      get: () => tx(`${prefix}.${key}.label`),
    });
    if (hasHint) {
      Object.defineProperty(meta, 'hint', {
        enumerable: true,
        get: () => tx(`${prefix}.${key}.hint`),
      });
    }
    dict[key] = meta;
  }
  return dict;
}

// 배치 요소 팔레트 항목 정의 (§3.3 palette 토큰 → UI)
//   토큰 형식: "air_mass:siberian" / "front:cold" / "moisture" / "sun"
export const AIR_MASS_META = metaDict('board.meta.airMass', [
  ['siberian', '❄️', true],
  ['north_pacific', '🥵', true],
  ['yangtze', '🌤️', true],
  ['okhotsk', '🧊', true],
]);

export const FRONT_META = metaDict('board.meta.front', [
  ['cold', '🔵', true],
  ['warm', '🔴', true],
  ['stationary', '🟣', true],
]);

export const PHENOMENON_META = metaDict('board.meta.phenomenon', [
  ['shower', '🌦️'],
  ['rain', '🌧️'],
  ['persistent_rain', '☔'],
  ['snow', '❄️'],
  ['fog', '🌫️'],
  ['heatwave', '🔥'],
  ['clear', '☀️'],
  ['cloudy', '☁️'],
  // R13 재난 축(CO-A3·CO-K4) — 재난 보드가 목표로 삼던 'clear'를 대체한다.
  // 이 두 줄이 없으면 phenomenonMeta 폴백이 지도·단면 패널에 enum 원문 + ❔를 그린다.
  ['wildfire_risk', '🔥'],
  ['flood_risk', '🌊'],
  // ㉣ 4조건 규칙의 고유 결과 — 경보급(2026-08-18). ⚠️ **이 세 줄이 없으면
  // 화면에 enum 원문 + ❔가 뜬다**(위 두 줄이 같은 이유로 추가됐다).
  ['severe_storm', '⛈️'],
  ['wildfire_warning', '🚨'],
  ['flood_warning', '🚨'],
  // MT-18 전문가 보드(2026-08-18) — 태풍·온실효과. 위와 같은 이유로 필요하다:
  // 없으면 phenomenonMeta 폴백이 enum 원문 + ❔를 그린다.
  ['typhoon', '🌀'],
  ['tropical_night', '🌡️'],
]);

export const CLOUD_META = metaDict('board.meta.cloud', [
  ['cumulonimbus', '⛈️'],
  ['nimbostratus', '🌧️'],
  ['stratus', '🌁'],
  ['cumulus', '⛅'],
  ['none', '🌈'],
]);

/** 팔레트 토큰 → {type, subtype?, meta} 파싱 (§3.3 palette 항목) */
export function parsePaletteToken(token) {
  if (token === 'moisture')
    return { type: 'moisture', label: tx('board.meta.element.moisture'), icon: '💧' };
  if (token === 'sun') return { type: 'sun', label: tx('board.meta.element.sun'), icon: '☀️' };
  // wind는 세기(level) 요소다 — 방향(subtype)이 아니다. 근거는 board_engine.py 도크스트링.
  if (token === 'wind') return { type: 'wind', label: tx('board.meta.element.wind'), icon: '🌬️' };
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

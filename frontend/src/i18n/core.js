// i18n 순수 코어 — zustand 등 어떤 패키지도 import하지 않는다.
//
// 왜 분리했나(2026-08-04, PR #25 CI 실측): mock parity 계약은 mock을 **순수 node
// 서브프로세스**로 실행하는데, lib 사전 getter화로 mock → tierMeta → i18n → zustand
// 사슬이 생겼고 CI test 잡에는 node_modules가 없어 ERR_MODULE_NOT_FOUND로 죽었다
// (로컬은 node_modules가 있어 통과 — "로컬 초록, CI 빨강"). payload_contract가 세운
// 교훈과 동일: **무거운 의존 없이 로드돼야 하는 것을 그 뒤에 두지 않는다.**
// react 컴포넌트는 index.js(useT·useLocaleStore)를, lib·mock 경로는 이 파일만 쓴다.
// mock의 전이 import에 bare 지정자가 다시 끼는 것은 backend
// test_r10_mock_parity_contract의 정적 가드가 막는다.
import ko from './resources/ko.js';
import en from './resources/en.js';
// board·explore 네임스페이스는 파일 소유를 갈랐다(§6.3 — D1이 board.*, D2가 나머지).
import boardKo from './resources/board.ko.js';
import boardEn from './resources/board.en.js';
// 기후 탐정(R13 CO-N-2)도 같은 이유로 파일을 갈랐다 — 최상위 키는 detective.* 하나뿐.
import detectiveKo from './resources/detective.ko.js';
import detectiveEn from './resources/detective.en.js';
// 안내봇(MT-26)도 같은 이유로 파일을 갈랐다 — 최상위 키는 guide.* 하나뿐.
import guideKo from './resources/guide.ko.js';
import guideEn from './resources/guide.en.js';

export const RESOURCES = {
  ko: { ...ko, ...boardKo, ...detectiveKo, ...guideKo },
  en: { ...en, ...boardEn, ...detectiveEn, ...guideEn },
};
export const SUPPORTED_LOCALES = Object.keys(RESOURCES);
export const DEFAULT_LOCALE = 'ko';
/** localStorage 키 — 로케일 영속(브라우저 재방문 시 유지) */
export const LOCALE_STORAGE_KEY = 'weathermind.locale';

function readStoredLocale() {
  try {
    const v = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(v) ? v : null;
  } catch {
    return null; // localStorage 접근 불가(프라이빗 모드 등) — 감지로 폴백
  }
}

/** 초기 로케일: localStorage → navigator.language 앞 2자 → ko */
export function detectLocale() {
  const stored = readStoredLocale();
  if (stored) return stored;
  const lang = (globalThis.navigator?.language ?? '').slice(0, 2).toLowerCase();
  return SUPPORTED_LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}


// ── 현재 로케일 (스토어 밖 소비자용 — lib 사전 getter가 렌더 중 읽는다) ──────
// index.js의 zustand 스토어가 setLocale 때 _syncLocale로 동기화한다. react
// 반응성은 스토어 구독(useT)이 담당하고, 여기는 "지금 값"의 단일 소스일 뿐이다.
let currentLocale = detectLocale();

export function getCurrentLocale() {
  return currentLocale;
}

/** index.js 전용 — 스토어 setLocale이 호출한다. 직접 쓰지 말 것. */
export function _syncLocale(locale) {
  if (SUPPORTED_LOCALES.includes(locale)) currentLocale = locale;
}

function lookupNode(locale, key) {
  let node = RESOURCES[locale];
  for (const part of key.split('.')) {
    node = node?.[part];
  }
  return node;
}

function lookup(locale, key) {
  const node = lookupNode(locale, key);
  return typeof node === 'string' ? node : undefined;
}

/**
 * 배열 리소스 조회 (MT-28) — 순서가 뜻을 갖는 문자열 목록용.
 *
 * `translate()`는 **문자열 리프만** 돌려주므로(비문자열이면 키를 그대로 반환)
 * 단면 스토리보드의 `steps`처럼 배열인 값은 못 읽는다. 단계를 `steps.0`·`steps.1`로
 * 쪼개 담을 수도 있지만, 그러면 **길이를 코드가 따로 알아야** 하고 그 길이가
 * 리소스와 어긋나면 조용히 잘린 스토리보드가 나온다 — 길이는 리소스가 소유해야 한다.
 *
 * 미지 키·비배열이면 빈 배열. 폴백은 translate와 같은 순서(현재 로케일 → ko)이고,
 * **번역 누락 시 빈 화면이 아니라 ko 원문**이 나오게 한다.
 */
export function translateList(locale, key) {
  const node = lookupNode(locale, key) ?? lookupNode(DEFAULT_LOCALE, key);
  return Array.isArray(node) ? node.filter((v) => typeof v === 'string') : [];
}

/** 순수 함수 번역 — 컴포넌트 밖(테스트·유틸)에서도 쓸 수 있다. */
export function translate(locale, key, params) {
  const raw = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m,
  );
}

/**
 * 개념 태그 → 표시명 (페이즈 B 공용 헬퍼).
 * 서버는 태그 코드만 보내고 표시명은 `concept.*` 리소스가 갖는다 — 리소스에
 * 없는 미지 태그는 (기존 `CONCEPT_LABEL[tag] ?? tag` 폴백과 동일하게) 태그
 * 원문을 그대로 보여준다. translate()의 "미지 키는 키 반환"을 감지해 폴백한다.
 */
export function conceptLabel(t, tag) {
  const key = `concept.${tag}`;
  const label = t(key);
  return label === key ? tag : label;
}

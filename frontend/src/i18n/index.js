import { create } from 'zustand';
import ko from './resources/ko.js';
import en from './resources/en.js';

/**
 * i18n 골격 (R11-01 §3 D) — 경량 자체 구현.
 *
 * 라이브러리 선정 근거(계약 D "번들 영향 실측과 근거"):
 *  - 이 리포는 lazy 청크 분리로 번들을 관리한다. react-i18next 채택 시
 *    i18next(≈40 kB min) + react-i18next(≈20 kB)가 메인 청크에 들어가는데,
 *    골격 단계에서 필요한 것은 ko/en 사전 조회 + {name} 보간 + 로케일 영속
 *    뿐이다 — 복수형·ICU·네임스페이스 lazy 로딩은 웨이브 2 전면 외부화 때
 *    필요해지면 그때 판단한다(이 모듈의 t(key, params) 시그니처는
 *    react-i18next와 호환되므로 교체 비용은 리소스 파일 포맷 이동뿐).
 *  - 상태는 이미 의존 중인 zustand로 — 신규 의존 0, 실측 번들 증가는
 *    빌드 전후 대조로 커밋 메시지·스프린트 문서에 남긴다.
 *
 * 사용법:
 *   const t = useT();                    // 컴포넌트에서 — 로케일 변경에 반응
 *   t('streak.title', { count: 7 })      // → '연속 출석 7일' / '7-day streak'
 *   useLocaleStore.getState().setLocale('en')  // 전환 + localStorage 영속
 *
 * 폴백: 현재 로케일에 키가 없으면 ko → 그래도 없으면 키 문자열 그대로.
 * (키 패리티 자체는 tests/i18n.smoke.test.mjs가 상주 가드)
 */

export const RESOURCES = { ko, en };
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

export const useLocaleStore = create((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    if (!SUPPORTED_LOCALES.includes(locale)) return;
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* 영속 실패해도 메모리 전환은 유지 */
    }
    set({ locale });
  },
}));

function lookup(locale, key) {
  let node = RESOURCES[locale];
  for (const part of key.split('.')) {
    node = node?.[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** 순수 함수 번역 — 컴포넌트 밖(테스트·유틸)에서도 쓸 수 있다. */
export function translate(locale, key, params) {
  const raw = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m,
  );
}

/** 컴포넌트용 훅 — 로케일이 바뀌면 소비 컴포넌트가 리렌더된다. */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return (key, params) => translate(locale, key, params);
}

import { create } from 'zustand';

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

// 순수부(리소스·translate·detectLocale·conceptLabel)는 core.js가 소유한다 —
// 분리 근거는 core.js 머리 주석. 여기는 zustand 스토어 + react 훅 + 재노출만.
export {
  RESOURCES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  detectLocale,
  translate,
  conceptLabel,
  getCurrentLocale,
} from './core.js';

import {
  SUPPORTED_LOCALES,
  LOCALE_STORAGE_KEY,
  getCurrentLocale,
  translate,
  _syncLocale,
} from './core.js';

export const useLocaleStore = create((set) => ({
  // core가 이미 정한 값을 그대로 받는다 — `detectLocale()`을 여기서 **한 번 더**
  // 부르면 같은 사실의 소유자가 둘이 되고, 그 둘이 갈리면 훅 경로와 스토어 밖
  // 경로가 다른 언어로 그려진다. core.currentLocale이 단일 소스다.
  locale: getCurrentLocale(),
  setLocale: (locale) => {
    if (!SUPPORTED_LOCALES.includes(locale)) return;
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* 영속 실패해도 메모리 전환은 유지 */
    }
    _syncLocale(locale); // 스토어 밖 소비자(lib 사전 getter) 동기화
    set({ locale });
  },
}));

/** 컴포넌트용 훅 — 로케일이 바뀌면 소비 컴포넌트가 리렌더된다. */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return (key, params) => translate(locale, key, params);
}


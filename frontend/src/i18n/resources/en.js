/**
 * en 리소스 (R11-01 §3 D — i18n 골격)
 *
 * ko와 키 집합이 1:1로 일치해야 한다 — tests/i18n.smoke.test.mjs가
 * 키 패리티를 상주 가드하므로, 한쪽만 추가/삭제하면 CI가 잡는다.
 */
export default {
  streak: {
    title: '{count}-day streak',
    days: 'days',
  },
  locale: {
    label: 'Language',
    ko: '한국어',
    en: 'English',
  },
};

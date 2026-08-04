/**
 * ko 리소스 (R11-01 §3 D — i18n 골격)
 *
 * 규약:
 *  - 중첩 객체 + 점 경로 키(`streak.title`). 값은 문자열만.
 *  - 보간은 `{name}` 자리표시자 — i18n/index.js의 translate()가 치환한다.
 *  - ko가 기준 로케일: 새 키는 여기 먼저 추가하고 en에 짝을 만든다.
 *    (ko↔en 키 집합 일치는 tests/i18n.smoke.test.mjs가 상주 가드)
 */
export default {
  streak: {
    // StreakBadge (파일럿): title 툴팁 전체 문구 + 최협폭에서 접히는 단위 표기
    title: '연속 출석 {count}일',
    days: '일',
  },
  locale: {
    label: '언어 선택',
    ko: '한국어',
    en: 'English',
  },
};

/**
 * KST 기준 요일(월=0 … 일=6) — CO-T-8.
 *
 * `new Date().getDay()`는 **브라우저 로컬 타임존** 요일이라 심사 PC가 KST가 아니면
 * 주간 출석 달력이 하루 어긋난다(서버 하루는 KST다). 목(`mock/apiMockPlugin.js`)이
 * 하루 경계에 쓰는 것과 **같은 계산**이지만, 목을 import하지는 않는다 —
 * 목은 개발 전용 산출물이고 제품 번들이 의존하면 안 된다.
 *
 * 2026-08-09: 홈 화면(HomePage.jsx)이 갖고 있던 함수다. 홈이 학습 화면에 흡수되고
 * 주간 출석 스트립이 내 정보로 옮겨오면서 여기로 나왔다 — 화면이 아니라 계산이라
 * lib이 맞는 자리다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstWeekdayIndex(nowMs = Date.now()) {
  return (new Date(nowMs + KST_OFFSET_MS).getUTCDay() + 6) % 7;
}

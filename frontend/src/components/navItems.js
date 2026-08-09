/**
 * 내비 항목 단일 소유자 — 하단 탭바(모바일)와 좌측 사이드바(PC)가 같은 목록을 쓴다.
 *
 * 두 곳에 따로 적어 두면 한쪽에만 항목이 추가돼 뷰포트별로 갈 수 있는 화면이
 * 달라진다. 홈을 추가하면서 실제로 그럴 뻔했다.
 *
 * **탭을 자물쇠로 막지 않는다**(R10-01 §3.4 판정, 2026-08-01): 아직 열리지 않은
 * 기능도 눌러 들어갈 수 있고, 목적지에서 무엇인지·언제 열리는지를 보여준다
 * (FeatureUnlockGate). 그래서 이 목록은 게이트 상태를 알지 않는다.
 */
export const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: '🏠', end: true },
  { to: '/learn', labelKey: 'nav.learn', icon: '🎓' },
  { to: '/board', labelKey: 'nav.board', icon: '🧩' },
  // CO-N-1 ② (2026-08-08): `/explore`(태풍 슬라이더·기후 시뮬)는 6개 탭 어디에도
  // 없어서 **잠긴 /board 우측 레일에서만** 갈 수 있었다 — URL을 손으로 치지 않으면
  // 영영 도달 못 하는 화면이었다. 심사 배점 ②의 "변수를 바꿔보며 학습 탐구"에
  // 가장 정확히 대응하는 화면이라 보드 바로 옆에 세운다.
  { to: '/explore', labelKey: 'nav.explore', icon: '🔬' },
  { to: '/duel', labelKey: 'nav.duel', icon: '🌡️' },
  { to: '/league', labelKey: 'nav.league', icon: '🏆' },
  { to: '/me', labelKey: 'nav.me', icon: '🏅' },
];

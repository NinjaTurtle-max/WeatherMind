/**
 * 게스트 판별 (R11-01 웨이브 2 §6.2 — R10-J 온보딩 재배치)
 *
 * 서버 규약(단일 진실원, backend/app/routers/auth.py): 게스트는 users 스키마를
 * 그대로 쓰되 이메일이 `guest-{uuid}@guest.weathermind.invalid`다(RFC 2606 예약
 * TLD — 실 수신 주소와 충돌 불가). 전환 API(POST /auth/guest/convert)의 409
 * NOT_GUEST 판정도 이 도메인 기준이다.
 *
 * 클라이언트 실측: POST /auth/guest 응답은 LoginResponse(토큰 2종)뿐이라 이메일이
 * 오지 않는다 — LoginPage가 authStore.user에 `is_guest: true` 표식을 싣는다
 * (zustand persist로 리로드에도 유지). 따라서 판별은 두 신호의 OR:
 *   1) user.is_guest === true  — 이번 기기에서 게스트로 시작한 세션.
 *   2) 이메일 도메인 일치      — 서버가 이메일을 알려주는 경로(향후 /auth/me 등)
 *      가 생겨도 표식 없이 판별되도록 규약 자체를 함께 본다.
 * 전환 성공 시 setUser로 is_guest를 해제(+실 이메일 저장)하면 두 신호 모두 꺼진다.
 */
export const GUEST_EMAIL_DOMAIN = 'guest.weathermind.invalid';

export function isGuestUser(user) {
  if (!user) return false;
  if (user.is_guest === true) return true;
  return typeof user.email === 'string' && user.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

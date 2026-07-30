/**
 * XP 표시 상수 (R8-01 §3.7⑥)
 *
 * 값의 단일 소유자는 backend(xp_service·duel_service — §3.6 XP 단일 창구)이며,
 * 프론트는 서버 응답에 액수가 실려오지 않는 표시 지점(승리 배지·토스트 문구)에서만
 * 이 미러 상수를 쓴다. 서버가 액수를 응답에 포함하면(xp_earned 등) 항상 응답값 우선.
 */

// 예보 대결 승리 XP — backend duel_service.DUEL_WIN_XP 미러 (07번 스펙 §1)
export const DUEL_WIN_XP = 15;

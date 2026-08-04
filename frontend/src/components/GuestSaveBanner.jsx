import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { isGuestUser } from '../modules/auth/guest';
import { useT } from '../i18n';

/**
 * 게스트 진도 저장 배너 (R11-01 웨이브 2 §6.2 — R10-J "투자 후 계정 유도")
 *
 * props 없는 자급 컴포넌트 — 마운트는 CurriculumHome 소유자(FE-A)가 1줄 import로.
 * ReviewQueueCard의 "due 0건이면 렌더 생략"과 같은 원리로, 조건 미충족이면
 * **null을 반환**한다(빈 카드 금지):
 *   1) 게스트가 아니면 null (판별: modules/auth/guest.js — is_guest 표식 ∨ 이메일 도메인).
 *   2) 진도가 없으면 null — 배너는 "투자 후" 유도다. 시작하자마자 가입을 조르면
 *      R10-J가 걷어낸 첫 관문이 자리만 옮겨 되살아난다.
 * 진도 판정은 /progress/me 실측: xp>0(배치고사는 XP 미지급 — 비배치 채점 응답
 * 1건 이상과 동치, onboardingGate.hasPriorProgress와 같은 근거) ∨ streak≥1.
 */
export default function GuestSaveBanner() {
  const user = useAuthStore((s) => s.user);
  const guest = isGuestUser(user);
  const t = useT();

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: guest, // 정식 계정에서는 이 배너 때문에 요청을 만들지 않는다
    staleTime: 30_000,
  });

  if (!guest || !me) return null;
  const hasProgress = (me.xp ?? 0) > 0 || (me.streak_count ?? 0) >= 1;
  if (!hasProgress) return null;

  return (
    <Link
      to="/account/convert"
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-sky-50 to-indigo-50 p-4 ring-1 ring-sky-200 transition hover:ring-sky-300"
      aria-label={t('guestBanner.aria')}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">
          💾
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">{t('guestBanner.title')}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t('guestBanner.body')}</p>
        </div>
      </div>
      <span className="shrink-0 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white">
        {t('guestBanner.cta')}
      </span>
    </Link>
  );
}

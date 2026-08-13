import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authApi, progressApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { isGuestUser } from '../modules/auth/guest';
import { useT } from '../i18n';

/**
 * 게스트 진도 저장 노드 — 학습 화면 **오른쪽 열**(2026-08-12 클라이언트 요구 ⑵).
 *
 * 무엇을 대체하나: `/learn` 맨 위를 가로로 덮던 `GuestSaveBanner`. 그 배너는
 * 로그인·회원가입 구조가 있던 시절 "30초 가입" 유도였고, 로그인 창이 사라진 지금
 * 화면 첫 줄을 가입 권유가 차지하는 모양 자체가 규정(계정 없이 열려야 함)과
 * 어긋나 보인다. 같은 일을 **여백에서** 한다.
 *
 * ⚠️ 목적지는 `/me#save-progress`다 — 「정보 입력」의 자리를 내 정보 하나로 모은다
 * (요구 ⑴). `/account/convert` 전체 화면도 살아 있지만, 그쪽으로 보내면 학습
 * 화면에서 통째로 이탈해 "잠깐 정보만 채우는" 동작이 아니게 된다.
 *
 * 처음 만들 때의 렌더 조건은 **게스트 하나뿐**이었다(진도 게이트 없음 — 종전 배너는
 * xp>0 ∨ streak≥1을 요구했다). 그때 남긴 근거를 지우지 않고 그대로 둔다:
 * R10-J의 "투자 후 유도"가 막으려던 것은 **첫 화면을 가로막는 권유**였고 그 위험은
 * 배너를 걷으면서 사라졌다. 반대로 게이트를 남기면 진도 0인 첫 방문자(심사위원의
 * 상태다)에게는 진도를 지키는 유일한 통로가 화면에 존재하지 않는다 — 로그인 화면을
 * 대신하는 기능이라 보이지 않으면 없는 것과 같다.
 *
 * ⚠️ **뒤집혔다 — 클라이언트 판정(2026-08-13): 「진도가 쌓이면 표시」로 확정.**
 * 위 근거는 기록으로 남기되 결론은 채택되지 않았다. 걷힌 종전 배너
 * (`GuestSaveBanner.jsx` — 파일은 `guest-convert` 스모크 때문에 남아 있다)가 쓰던
 * 게이트를 **원문 그대로** 되돌린다:
 *     hasProgress = (xp ?? 0) > 0 || (streak_count ?? 0) >= 1
 * `streak_count`이지 `streak`이 아니고, `>= 1`이지 `> 1`이 아니다 —
 * `lib/onboardingGate.hasPriorProgress`는 `> 1`에 units_cleared·level까지 보는
 * **다른 계약**이라 여기서 재사용하지 않는다. 배너와 같이 `me` 도착 전에는
 * 숨긴다(`!me → null`).
 *
 * 그 귀결: 진도 0인 첫 방문자에게 이 노드는 안 보이고, 진도 저장 통로는
 * **`/me`의 「정보 입력」 카드 하나**가 된다. 위에 적힌 J의 우려는 사라진 것이
 * 아니라 그 카드가 혼자 짊어지게 됐다 — 그 카드를 걷으면 통로가 0이 된다.
 *
 * 게스트 판별은 서버 우선(`GET /auth/me`의 is_guest) · 부재 시 스토어 표식.
 * 쿼리 키는 `Layout`과 같은 `['auth','me']`·`['progress','me']`라 요청이 추가로
 * 나가지 않는다.
 */
export default function GuestSaveNode() {
  const t = useT();
  const accessToken = useAuthStore((s) => s.accessToken);
  const storeUser = useAuthStore((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: Boolean(accessToken),
    staleTime: 60_000,
    retry: false,
  });
  const guest = me ? me.is_guest === true : isGuestUser(storeUser);

  // 진도 조회는 **게스트일 때만** — 정식 계정에서 이 노드 때문에 요청이 늘지 않는다
  // (종전 배너의 `enabled: guest`를 그대로 옮겼다).
  const { data: progress } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    enabled: guest && Boolean(accessToken),
    staleTime: 30_000,
  });

  if (!guest || !progress) return null;
  const hasProgress = (progress.xp ?? 0) > 0 || (progress.streak_count ?? 0) >= 1;
  if (!hasProgress) return null;

  return (
    <Link
      to="/me#save-progress"
      data-testid="learn-guest-save"
      className="rounded-2xl bg-gradient-to-r from-sky-50 to-indigo-50 p-3.5 ring-1 ring-sky-200 transition hover:ring-sky-300"
      aria-label={t('saveProgress.nodeAria')}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">💾</span>
        <p className="text-[13px] font-extrabold text-slate-900">{t('saveProgress.nodeTitle')}</p>
      </div>
      <p className="mt-1 text-[11.5px] font-bold leading-relaxed text-slate-600">
        {t('saveProgress.nodeBody')}
      </p>
      <p className="mt-1.5 text-[11.5px] font-extrabold text-sky-700">{t('saveProgress.nodeCta')}</p>
    </Link>
  );
}

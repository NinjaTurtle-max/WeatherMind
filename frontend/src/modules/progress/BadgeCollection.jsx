import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useT } from '../../i18n';

/**
 * BadgeCollection (R4-01 §3.3) — 배지 획득/미획득 그리드(5종).
 * GET /progress/badges → [{code, title, description, earned_at|null}]
 * earned_at 있으면 컬러+획득일, 없으면 회색 잠금 표시.
 *
 * R10-01 §3.4 (S4): collapsed=true면 **1개만 노출**한다(첫 세션 전 인지 부하 감소).
 * 기본값 false — 기존 호출·기존 사용자 화면 불변(회귀 0).
 */

// 배지 코드 → 아이콘 (계약 §3.3 5종 저작 코드와 1:1)
const BADGE_ICON = {
  streak_7: '🔥',
  // ⚡는 VS16(U+FE0F)을 **반드시** 달고 있어야 한다 — U+26A1 단독이면 macOS/Chrome에서
  // 잉크가 `24×17.9`로 떨어져(다른 아이콘은 전건 `38×38`) 같은 줄에서 혼자 작고 좁게
  // 보인다. 2026-08-19에 유닛 노드에서 같은 결함을 고치며 이 자리도 함께 닫았다.
  // 🔴 **유니코드 속성으로 판정하면 이 글자는 「문제없다」가 나온다** — U+26A1은
  // `Emoji_Presentation=Yes`다(Node·파이썬 양쪽 실측). 원인이 속성이 아니라 브라우저가
  // 기본 표현보다 **CSS 폰트 스택을 먼저 걷는** 것이기 때문이다. 지울 근거는 유니코드
  // 표가 아니라 **재실측**이다. 계약: `frontend/tests/learnPath.smoke.test.mjs` ⑪-c.
  streak_30: '⚡️',
  streak_100: '💯',
  perfect_session: '🌈',
  tier_promoted: '🎖️',
};

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function BadgeCollection({ collapsed = false }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', 'badges'],
    queryFn: progressApi.fetchBadges,
    staleTime: 60_000,
  });

  // h-full — 이 블록의 슬롯이 `lg:flex-1`(ProgressPage order-2)이라 늘어난다.
  // 성공 경로만 채우면 로딩·에러·0건에서 늘어난 만큼이 **빈 띠**로 남는다.
  if (isLoading)
    return (
      <div className="flex h-full flex-col justify-center">
        <LoadingSpinner label={t('badges.loading')} />
      </div>
    );

  if (isError) {
    return (
      <div className="flex h-full flex-col justify-center rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
        {t('badges.loadFailed', { detail: error?.detail ?? '' })}
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 block w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const badges = Array.isArray(data) ? data : [];
  const earnedCount = badges.filter((b) => b.earned_at).length;
  const visible = collapsed ? badges.slice(0, 1) : badges;
  const hiddenCount = badges.length - visible.length;

  return (
    // h-full + flex — 왼쪽 열에서 이 블록이 남는 높이를 먹는 칸이다(2026-08-12
    // 사용자 지시 — "배지 컬렉션 카드 세로 크기를 더 키우고"). 격자에 flex-1을
    // 주면 늘어난 높이가 **배지 타일 자체**로 간다. 여기서 안 받으면 늘어난
    // 만큼이 그냥 흰 여백이 된다(ProgressPage의 lg:flex-1 슬롯과 짝이다).
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-slate-900">{t('badges.title')}</h2>
        <span className="text-xs font-bold text-slate-400">
          {t('badges.earnedCount', { earned: earnedCount, total: badges.length })}
        </span>
      </div>

      {badges.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          {t('badges.empty')}
        </div>
      ) : (
        // flex-1은 **접힘(첫 세션 전)일 때 빼야 한다.** 그때는 타일이 1장뿐이라
        // 늘어난 높이를 나눠 받을 데가 없어, 104px 폭에 높이만 300px 가까운
        // 탑이 된다. 접힘일 때는 남는 높이가 그냥 이 블록 아래 여백으로 남고
        // 두 열의 끝은 그대로 맞는다.
        <div className={`grid grid-cols-3 gap-2 sm:grid-cols-5 ${collapsed ? '' : 'flex-1'}`}>
          {visible.map((b) => {
            const earned = Boolean(b.earned_at);
            const date = formatDate(b.earned_at);
            return (
              <div
                key={b.code}
                title={b.description}
                className={`flex flex-col items-center justify-center rounded-2xl p-3 text-center shadow-sm ring-1 transition ${
                  earned ? 'bg-white ring-amber-200' : 'bg-slate-50 ring-slate-200'
                }`}
              >
                <span
                  className={`text-3xl leading-none ${earned ? '' : 'opacity-25 grayscale'}`}
                  aria-hidden="true"
                >
                  {earned ? (BADGE_ICON[b.code] ?? '🏅') : '🔒'}
                </span>
                {/* min-h-[28px] = 2줄 자리. 타일이 `justify-center`라 **제목 줄
                    수가 다르면 아이콘 높이가 타일마다 어긋난다** — 시드 제목이
                    실제로 섞여 있다("한 달의 기단" 1줄 · "백일의 대기 대순환"
                    2줄). 제목 칸을 2줄로 고정해 내용 높이를 같게 만든다.
                    line-clamp-2로 3줄짜리가 들어와도 그 약속이 깨지지 않는다. */}
                <p
                  className={`mt-1.5 line-clamp-2 min-h-[28px] text-[11px] font-bold leading-tight ${
                    earned ? 'text-slate-800' : 'text-slate-400'
                  }`}
                >
                  {b.title}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">{earned ? date : t('badges.locked')}</p>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          {t('badges.moreAfterFirstSession', { count: hiddenCount })}
        </p>
      )}
    </div>
  );
}

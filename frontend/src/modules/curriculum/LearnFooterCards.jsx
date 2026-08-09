import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { leagueApi } from '../../api';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import RegionPicker from '../../components/RegionPicker';
import { deriveStanding } from '../../lib/leagueStanding';
import { useAuthStore } from '../../store/authStore';
import { tierFromElo, tierMeta } from '../../lib/tierMeta';
import { useT } from '../../i18n';

/**
 * LearnFooterCards — 학습 화면 **경로 아래 3카드**(2026-08-09 사용자 시안).
 *
 * 복습 · 자유 일일 세션 · 리그. 진입 배너가 얇아지면서(LearnHeroCard) 갈 곳이
 * 없어진 두 가지(복습·자유 세션)를 여기가 받고, 리그는 시안이 새로 넣은 칸이다.
 *
 * ⚠️ **세로가 이 화면에서 가장 비싼 자원이다.** 이 줄의 높이는 그대로 경로 트랙에서
 * 빠진다(`--wm-track-tail` → index.css `.wm-track` height → `--dot`). 카드에 줄을
 * 하나 더 넣기 전에 노드 지름을 재 볼 것. 상수로 빼지 않고 **런타임에 재서** 넘기는
 * 이유도 그것이다 — 복습 칸은 due 0건이면 통째로 사라져 높이가 상황마다 다르다.
 *
 * 리그 성적 규칙(`deriveStanding`)은 **LeaguePage와 공유한다**(lib/leagueStanding).
 * 복사하면 두 화면이 서로 다른 등급을 가리키는 사고가 난다.
 */
export default function LearnFooterCards({ dailyBlocked = false, energyBlocked = false, regenMin = 1 }) {
  const t = useT();

  // 리그 3종 — LeaguePage와 **같은 쿼리 키**라 캐시를 공유한다(중복 요청 없음).
  // retry 1도 같게 둔다: 리그는 KMA 키가 없으면 degraded라 실패가 흔한데, 학습
  // 화면이 그때마다 재시도로 매달릴 이유가 없다.
  const { data: ranksData } = useQuery({
    queryKey: ['league', 'leaderboard'],
    queryFn: () => leagueApi.fetchLeaderboard(),
    retry: 1,
    staleTime: 60_000,
  });
  const { data: myResultsData } = useQuery({
    queryKey: ['league', 'myResults'],
    queryFn: leagueApi.fetchMyLeagueResults,
    retry: 1,
    staleTime: 60_000,
  });
  const user = useAuthStore((s) => s.user);

  const ranks = Array.isArray(ranksData) ? ranksData : [];
  const standing = deriveStanding(ranks, Array.isArray(myResultsData) ? myResultsData : [], user);
  const tier = tierMeta(standing.elo == null ? 'stratus' : tierFromElo(standing.elo));

  return (
    <div
      data-testid="learn-footer"
      className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {/* 복습 — due 0건이면 컴포넌트가 스스로 null이라 칸째 빠진다(격자가 2칸으로
          줄 뿐 빈 카드가 남지 않는다). */}
      <ReviewQueueCard variant="tile" />

      {/* 자유 일일 세션.
          상태가 **셋**이다(둘로 줄이면 안 된다 — 실제로 줄였다가 스모크가 잡았다):
            dailyBlocked  잔량 0 + 오늘 세션 없음 → 발급이 429로 막힌다.
                          **진짜 disabled 버튼**이어야 한다: 회색 링크는 눌리고,
                          누르면 서버가 막는다(R10이 폐지한 흐름).
            energyBlocked 잔량 0인데 **오늘 세션이 살아 있다** → 재조회는 200이다
                          ("풀던 것을 뺏기지 않는다" 불변식). 링크로 남기고
                          문구를 「풀던 세션 이어서 풀기」로 바꾼다.
            그 외          평소. */}
      <div
        data-testid="learn-secondary"
        className="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
      >
        <div className="flex items-center gap-2">
          <p className="text-[13.5px] font-extrabold text-slate-800">
            {t('curriculum.daily.title')}
          </p>
          <span className="ml-auto">
            <RegionPicker />
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
          {t('curriculum.daily.body')}
        </p>
        {dailyBlocked ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="cursor-not-allowed text-[12px] font-bold text-slate-300"
            >
              {t('curriculum.daily.cta')}
            </button>
            <span className="text-[11px] font-bold text-rose-500">
              {t('curriculum.daily.regen', { min: regenMin })}
            </span>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
            <Link to="/daily" className="text-[12px] font-bold text-sky-600 hover:text-sky-700">
              {energyBlocked ? t('curriculum.daily.resume') : t('curriculum.daily.cta')}
            </Link>
            {energyBlocked && (
              <span className="text-[11px] font-bold text-rose-500">
                {t('curriculum.daily.regenResume', { min: regenMin })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 리그 — 순위가 없으면(정산 전·게스트) 숫자를 지어내지 않고 "집계 전"이라
          말한다. 0위로 채우면 실제 성적처럼 읽힌다. */}
      <div
        data-testid="learn-league"
        className="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
      >
        <p className="text-[13.5px] font-extrabold text-slate-800">
          {t('curriculum.leagueCard.title', { tier: tier.label })}
        </p>
        {standing.rank ? (
          <p className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[24px] font-extrabold leading-none tabular-nums text-slate-900">
              {t('league.dash.rankNth', { rank: standing.rank })}
            </span>
            <span className="text-[12px] font-medium text-slate-500">
              {t('curriculum.leagueCard.people', { total: ranks.length })}
            </span>
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
            {t('league.dash.rankPending')}
          </p>
        )}
        <Link
          to="/league"
          className="mt-auto pt-2.5 text-[12px] font-bold text-sky-600 hover:text-sky-700"
        >
          {t('curriculum.leagueCard.cta')}
        </Link>
      </div>
    </div>
  );
}

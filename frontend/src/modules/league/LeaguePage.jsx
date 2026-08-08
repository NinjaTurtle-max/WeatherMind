import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { duelApi, leagueApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import ForecastForm from '../../components/ForecastForm';
import Mascot from '../../components/Mascot';
import TierBadge from '../../components/TierBadge';
import BriefingRoom from '../duel/BriefingRoom';
import { TIER_ORDER, tierMeta, tierFromElo } from '../../lib/tierMeta';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../i18n';

/**
 * LeaguePage (04번 스펙 섹션 4 → 2026-08-06 대시보드 개편)
 *
 * 시안(사용자 첨부)의 배치를 따른다: 위 3칸(내 티어 · 이번 주 요약 · 주간 예측),
 * 아래 2칸(순위 · 등급 사다리), 맨 아래 안내 한 줄.
 *
 * ⚠️ 시안의 **문구·등급 체계는 그대로 옮기지 않았다.** 시안은 브론즈/실버/골드에
 * RP·시즌(월 단위)·친구 탭·"월요일 오전 9시 초기화"를 쓰는데, 이 제품의 실제
 * 도메인은 다르다:
 *   - 등급은 구름 5단계(층운→적운→난층운→적란운→태풍의 눈)이고 기준은 ELO다
 *     (계약 §3.2 · lib/tierMeta). RP라는 값은 존재하지 않는다.
 *   - 주기는 **주 단위**(week_start = 그 주 월요일, KST — league_service.week_start_of)다.
 *     "시즌"도 "오전 9시"도 서버에 근거가 없어 쓰지 않는다.
 *   - 친구 기능은 없다 — 전체/친구 토글을 넣으면 동작하지 않는 UI가 된다.
 * 시안에 있으나 근거 없는 것은 만들지 않고, 실제 값이 있는 자리로 대체했다.
 *
 * 기능은 종전 그대로 보존한다 — 주간 예측 제출(POST /league/predict, 주 1회)과
 * 브리핑 참고 카드(R9-01 §3.1: mid_forecast raw JSON 대신 /duel/briefing 재사용).
 * 시안에 없다고 지우면 화면만 닮고 기능이 사라진다.
 */
export default function LeaguePage() {
  const queryClient = useQueryClient();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [submitError, setSubmitError] = useState(null);

  const currentQ = useQuery({
    queryKey: ['league', 'current'],
    queryFn: leagueApi.fetchCurrentLeague,
    retry: 1,
  });

  const leaderboardQ = useQuery({
    queryKey: ['league', 'leaderboard'],
    queryFn: () => leagueApi.fetchLeaderboard(),
    retry: 1,
  });

  const myResultsQ = useQuery({
    queryKey: ['league', 'myResults'],
    queryFn: leagueApi.fetchMyLeagueResults,
    retry: 1,
  });

  // 이번 주 전적 — 리그 전용 API가 없다. 예보 대결 이력을 이번 주로 걸러 센다
  // (리그 포인트의 원천이 대결이므로 같은 자료다).
  const duelHistoryQ = useQuery({
    queryKey: ['duel', 'history'],
    queryFn: duelApi.fetchDuelHistory,
    retry: 1,
  });

  // 브리핑 재사용 (R9-01 §3.1) — 듀얼과 같은 자료·같은 캐시 키를 공유한다
  const briefingQ = useQuery({
    queryKey: ['duel', 'briefing'],
    queryFn: duelApi.fetchDuelBriefing,
    retry: 1,
    staleTime: 60_000,
  });

  const predictMutation = useMutation({
    mutationFn: leagueApi.submitPrediction,
    onSuccess: () => {
      setSubmitError(null);
      queryClient.invalidateQueries({ queryKey: ['league'] });
    },
    onError: (err) => setSubmitError(err.detail ?? t('league.submitFailed')),
  });

  if (currentQ.isLoading) return <LoadingSpinner label={t('league.loading')} />;

  if (currentQ.isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🌪️</p>
        <p className="mt-2 font-bold text-slate-800">{t('league.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{currentQ.error?.detail}</p>
        <button
          type="button"
          onClick={() => currentQ.refetch()}
          className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const current = currentQ.data ?? {};
  const myResults = Array.isArray(myResultsQ.data) ? myResultsQ.data : [];
  const ranks = Array.isArray(leaderboardQ.data) ? leaderboardQ.data : [];
  // 내 성적은 **한 곳에서만** 계산해 아래로 내린다. 카드마다 따로 구하면 같은
  // 규칙이 두 벌이 되어 한쪽만 고치는 사고가 난다(등급 카드와 사다리가 서로 다른
  // 등급을 가리키는 식).
  const standing = deriveStanding(ranks, myResults, user);
  const alreadySubmitted =
    predictMutation.isSuccess ||
    (current.week_start && myResults.some((r) => r.week_start === current.week_start));

  return (
    <div className="pt-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-slate-900">🏆 {t('league.title')}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{t('league.dash.subtitle')}</p>
        </div>
        <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm ring-1 ring-slate-200">
          {weekRangeLabel(current.week_start, t)}
        </span>
      </div>

      {/* 위 3칸 — 내 티어 / 이번 주 요약 / 주간 예측 */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3 lg:items-stretch">
        <MyTierCard
          standing={standing}
          loading={leaderboardQ.isLoading || myResultsQ.isLoading}
        />
        <WeekSummaryCard
          weekStart={current.week_start}
          duels={Array.isArray(duelHistoryQ.data) ? duelHistoryQ.data : []}
          loading={duelHistoryQ.isLoading}
        />
        {alreadySubmitted ? (
          <SubmittedCard />
        ) : (
          <div className="flex flex-col gap-2">
            <ForecastForm
              title={t('league.formTitle')}
              fields={[
                { name: 'temp_max', label: t('league.tempMax'), step: '0.1' },
                { name: 'temp_min', label: t('league.tempMin'), step: '0.1' },
                { name: 'rain_prob', label: t('league.rainProb'), min: '0', max: '100' },
              ]}
              submitLabel={t('league.submit')}
              validate={(v) => (v.temp_min > v.temp_max ? t('league.minOverMax') : null)}
              onSubmit={(values) => predictMutation.mutate(values)}
              submitting={predictMutation.isPending}
            />
            {submitError && (
              <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{submitError}</p>
            )}
          </div>
        )}
      </div>

      {/* 아래 2열 — 자료(왼쪽) ↔ 순위·등급(오른쪽).
          예보 대결과 **같은 배치**다(2026-08-08 지시). 브리핑은 예측의 근거인데
          전폭 카드로 맨 아래에 두니 위 예측 폼과 멀어, 값을 채우려면 스크롤을
          오르내려야 했다. 왼쪽 열로 크게 빼면 위쪽 폼과 한 화면에 들어온다.
          `compact`도 뗀다 — 좁은 전폭 카드라 접어 뒀던 습도·풍속 보조 차트를
          한 열을 통째로 쓰는 지금은 다 보여 준다("크게").
          grid-cols-[minmax(0,1fr)]는 장식이 아니다(DuelPage와 같은 이유) —
          브리핑 안의 하늘 타임라인이 자체 가로 스크롤을 갖는데, 격자 항목 기본
          min-width:auto면 그 내용 폭이 카드를 밀어 페이지에 가로 스크롤이 생긴다. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {/* 감싸 둔다 — 격자 항목 기본이 stretch라, KMA 키 없는 degraded에서
            「실황 자료 수신 대기」 한 장이 오른쪽 열 높이까지 늘어난다.
            감싸면 늘어나는 건 이 div이고 카드는 제 높이를 지킨다(DuelPage와 동일). */}
        <div>
          <BriefingRoom
            briefing={briefingQ.data}
            loading={briefingQ.isLoading}
            error={briefingQ.isError}
          />
        </div>
        <div className="flex flex-col gap-4">
          <RankCard ranks={ranks} loading={leaderboardQ.isLoading} />
          <TierLadderCard standing={standing} weekStart={current.week_start} />
        </div>
      </div>

      {myResults.length > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 text-sm font-extrabold text-slate-900">{t('league.myHistory')}</h2>
          <ul className="flex flex-col gap-1.5">
            {myResults.map((r, i) => (
              <li
                key={r.week_start ?? i}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200"
              >
                <span className="font-bold text-slate-700">{r.week_start ?? '-'}</span>
                <span className="text-slate-500">
                  {r.accuracy_score != null
                    ? t('league.accuracy', { score: r.accuracy_score })
                    : t('league.accuracyPending')}
                </span>
                <span className="font-extrabold text-sky-700">ELO {r.elo_rating_after ?? '-'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 rounded-xl bg-slate-100 px-4 py-2.5 text-center text-[12px] text-slate-500">
        ℹ️ {t('league.dash.resetNote')}
      </p>
    </div>
  );
}

/* ── 카드들 ──────────────────────────────────────────────────────────────── */

function Card({ title, children, className = '' }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {title && <h2 className="mb-2.5 text-sm font-extrabold text-slate-900">{title}</h2>}
      {children}
    </div>
  );
}

/** 내 티어 — 시안 왼쪽 첫 칸. ELO·순위는 부모가 구한 standing을 그대로 쓴다. */
function MyTierCard({ standing, loading }) {
  const t = useT();
  const { elo, rank } = standing;

  if (loading) {
    return (
      <Card title={t('league.dash.myTier')}>
        <LoadingSpinner label={t('league.loading')} />
      </Card>
    );
  }

  if (elo == null) {
    return (
      <Card title={t('league.dash.myTier')}>
        <div className="py-3 text-center">
          <p className="text-4xl" aria-hidden="true">
            {tierMeta('stratus').icon}
          </p>
          <p className="mt-2 text-sm font-extrabold text-slate-800">{t('league.dash.unranked')}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
            {t('league.dash.unrankedBody')}
          </p>
        </div>
      </Card>
    );
  }

  const code = tierFromElo(elo);
  const meta = tierMeta(code);
  const next = nextTierOf(code);
  // 진척은 **현재 티어 구간 안에서**의 비율이다. 0부터 재면 최상위 직전에도
  // 막대가 거의 다 차 있어 "곧 승급"처럼 보인다.
  const floor = meta.minElo;
  const ceil = next?.minElo ?? elo;
  const pct = next ? Math.max(0, Math.min(100, ((elo - floor) / (ceil - floor)) * 100)) : 100;

  return (
    <Card title={t('league.dash.myTier')}>
      <div className="flex items-center gap-3">
        <span className="text-4xl leading-none" aria-hidden="true">
          {meta.icon}
        </span>
        <div className="min-w-0">
          <TierBadge tier={code} size="md" showIcon={false} />
          <p className="mt-1.5 text-[22px] font-extrabold leading-none text-slate-900">
            ELO {elo}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            {rank != null ? t('league.dash.rankNth', { rank }) : t('league.dash.rankPending')}
          </p>
        </div>
      </div>

      <div className="mt-3">
        {next ? (
          <>
            <div className="flex items-baseline justify-between text-[11.5px] font-bold">
              <span className="text-slate-500">
                {t('league.dash.toNext', { gap: ceil - elo, tier: next.label })}
              </span>
              <span className="text-slate-400">
                {elo} / {ceil}
              </span>
            </div>
            <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <span
                className={`block h-full rounded-full ${meta.solid}`}
                style={{ width: `${Math.round(pct)}%` }}
              />
            </span>
          </>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-[12px] font-bold text-amber-700">
            {t('league.dash.topTier')}
          </p>
        )}
      </div>
    </Card>
  );
}

/** 이번 주 요약 — 예보 대결 이력을 이번 주(월요일 시작)로 걸러 센다. */
function WeekSummaryCard({ weekStart, duels, loading }) {
  const t = useT();
  const inWeek = weekStart ? duels.filter((d) => isInWeek(d.duel_date, weekStart)) : [];
  const played = inWeek.length;
  const won = inWeek.filter((d) => d.result === 'win').length;
  // 승률은 **정산된 대결만** 분모로 쓴다. 미정산(result 없음)까지 세면 오늘
  // 제출한 대결 때문에 승률이 떨어져 보인다.
  const settled = inWeek.filter((d) => d.result).length;
  const rate = settled > 0 ? Math.round((won / settled) * 100) : null;

  return (
    <Card title={t('league.dash.weekSummary')}>
      {loading ? (
        <LoadingSpinner label={t('league.loading')} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('league.dash.played')} value={t('league.dash.times', { n: played })} />
            <Stat label={t('league.dash.won')} value={t('league.dash.times', { n: won })} />
            <Stat
              label={t('league.dash.winRate')}
              value={rate == null ? '—' : `${rate}%`}
            />
          </div>
          <p className="mt-2.5 rounded-lg bg-sky-50 px-3 py-2 text-[12px] leading-relaxed text-sky-700">
            {played === 0 ? t('league.dash.weekEmpty') : t('league.dash.weekTip')}
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 py-2.5 text-center ring-1 ring-slate-200">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-0.5 text-[17px] font-extrabold text-slate-900">{value}</p>
    </div>
  );
}

/** 주간 예측 제출 완료 — 시안 오른쪽 첫 칸 자리(대결 CTA 겸용). */
function SubmittedCard() {
  const t = useT();
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3">
        <Mascot name="bolt" className="h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-emerald-700">{t('league.submittedTitle')}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{t('league.submittedBody')}</p>
        </div>
      </div>
      <Link
        to="/duel"
        className="mt-3 inline-block rounded-xl bg-sky-600 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-sky-700"
      >
        {t('league.dash.goDuel')}
      </Link>
    </Card>
  );
}

/** 리그 순위 — 시안 아래 왼쪽. 표 대신 행 리스트(시안과 같은 결). */
function RankCard({ ranks, loading }) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const medal = ['🥇', '🥈', '🥉'];

  return (
    <Card title={t('league.dash.ranking')}>
      {loading ? (
        <LoadingSpinner label={t('league.leaderboardLoading')} />
      ) : ranks.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          {t('league.board.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ranks.map((row, i) => {
            const me = isMe(row, user);
            const rank = row.rank ?? i + 1;
            return (
              <li
                key={row.user_id ?? `${row.nickname}-${i}`}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1 ${
                  me ? 'bg-sky-50 ring-sky-300' : 'bg-slate-50 ring-slate-200'
                }`}
              >
                <span className="w-7 shrink-0 text-center text-[13px] font-extrabold tabular-nums text-slate-500">
                  {rank <= 3 ? medal[rank - 1] : rank}
                </span>
                <span className={`min-w-0 flex-1 truncate text-[13px] font-bold ${me ? 'text-sky-800' : 'text-slate-700'}`}>
                  {row.nickname ?? t('league.board.anonymous')}
                  {me && <span className="ml-1 text-[11px] text-sky-600">{t('league.board.me')}</span>}
                </span>
                {row.tier && (
                  <span className="hidden shrink-0 sm:block">
                    <TierBadge tier={row.tier} />
                  </span>
                )}
                <span className="w-16 shrink-0 text-right text-[12.5px] font-extrabold tabular-nums text-slate-600">
                  {row.elo_rating ?? '-'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** 리그 등급 사다리 — 시안 아래 오른쪽. 5단계 + 승급 조건 + 주간 정보. */
function TierLadderCard({ standing, weekStart }) {
  const t = useT();
  const { elo } = standing;
  const code = elo == null ? null : tierFromElo(elo);
  // 정산 전(code null)에는 다음 등급을 계산하지 않는다 — 아래 렌더가 그 경우를
  // 따로 안내하므로, 여기서 TIER_ORDER[0]을 끼워 넣으면 쓰이지도 않는 값이
  // "다음 등급"인 척 남는다.
  const next = code ? nextTierOf(code) : null;

  return (
    <Card title={t('league.dash.ladder')}>
      <ol className="flex items-stretch gap-1">
        {TIER_ORDER.map((c) => {
          const m = tierMeta(c);
          const on = c === code;
          return (
            <li
              key={c}
              aria-current={on ? 'step' : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center rounded-xl px-1 py-2 text-center ring-1 ${
                on ? 'bg-amber-50 ring-amber-300' : 'bg-slate-50 ring-slate-200'
              }`}
            >
              <span className="text-[20px] leading-none" aria-hidden="true">
                {m.icon}
              </span>
              <span className={`mt-1 w-full truncate text-[10.5px] font-extrabold ${on ? 'text-amber-800' : 'text-slate-600'}`}>
                {m.label}
              </span>
              <span className="text-[9.5px] font-bold tabular-nums text-slate-400">{m.minElo}+</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-[11.5px] font-extrabold text-slate-700">{t('league.dash.promoTitle')}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            {/* 정산 전에는 "다음 등급"이 없다. TIER_ORDER[0](층운)을 다음으로
                내밀면 "층운까지 ELO 0 남았어요" 같은 말이 된다 — 실제로 그랬다.
                그때는 승급이 아니라 **첫 등급이 정해지는 방법**을 안내한다. */}
            {elo == null
              ? t('league.dash.unrankedBody')
              : next
                ? t('league.dash.promoNeed', { gap: next.minElo - elo, tier: next.label })
                : t('league.dash.topTier')}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-[11.5px] font-extrabold text-slate-700">{t('league.dash.weekTitle')}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            {weekRangeLabel(weekStart, t)}
            {daysLeftInWeek(weekStart) != null && (
              <>
                <br />
                {t('league.dash.weekLeft', { days: daysLeftInWeek(weekStart) })}
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ── 순수 헬퍼 ───────────────────────────────────────────────────────────── */

function isMe(row, user) {
  return (
    row.is_me === true ||
    (user?.user_id && row.user_id === user.user_id) ||
    (user?.nickname && row.nickname === user.nickname)
  );
}

/** 티어 코드 → 다음 티어 메타. 최상위면 null. */
function nextTierOf(code) {
  const nextCode = TIER_ORDER[TIER_ORDER.indexOf(code) + 1];
  return nextCode ? tierMeta(nextCode) : null;
}

/**
 * 내 리그 성적 한 벌 — {elo, rank}.
 *
 * ELO는 **가장 최근에 정산된 주**의 값이다. 서버가 week_start 내림차순으로
 * 주지만(routers/league.py) 그 순서에 기대지 않고 여기서 최댓값을 고른다 —
 * 정렬이 바뀌면 조용히 옛 등급을 보여주게 되고, 화면만 봐서는 알아챌 수 없다.
 *
 * 정산 이력이 없으면 리더보드 행으로 넘어간다. 그것도 없으면 null이다 —
 * 0으로 채우지 않는다(0은 "0점"이라는 실제 성적처럼 읽힌다).
 */
function deriveStanding(ranks, myResults, user) {
  const myRow = ranks.find((r) => isMe(r, user)) ?? null;
  const settled = myResults
    .filter((r) => r.elo_rating_after != null)
    .sort((a, b) => String(b.week_start ?? '').localeCompare(String(a.week_start ?? '')))[0];
  return {
    elo: settled?.elo_rating_after ?? myRow?.elo_rating ?? null,
    rank: myRow?.rank ?? null,
  };
}

/** 'YYYY-MM-DD' → Date(로컬 자정). 파싱 실패는 null. */
function parseDay(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** weekStart(월요일)부터 7일 안에 드는 날짜인가 */
function isInWeek(dayIso, weekStartIso) {
  const d = parseDay(dayIso);
  const s = parseDay(weekStartIso);
  if (!d || !s) return false;
  const diff = Math.floor((d - s) / 86400000);
  return diff >= 0 && diff < 7;
}

function weekRangeLabel(weekStartIso, t) {
  const s = parseDay(weekStartIso);
  if (!s) return t('league.thisWeek');
  const e = new Date(s.getTime() + 6 * 86400000);
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return `${md(s)} ~ ${md(e)}`;
}

/** 이번 주가 며칠 남았나(오늘 포함). weekStart를 모르면 null. */
function daysLeftInWeek(weekStartIso) {
  const s = parseDay(weekStartIso);
  if (!s) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const passed = Math.floor((today - s) / 86400000);
  return Math.max(0, 7 - passed);
}

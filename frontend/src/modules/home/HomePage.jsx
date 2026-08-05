import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../../api/client';
import { curriculumApi, progressApi } from '../../api';
import { useAttendance } from '../../hooks/useAttendance';
import Mascot from '../../components/Mascot';
import GuestSaveBanner from '../../components/GuestSaveBanner';
import RegionPicker from '../../components/RegionPicker';
import { conceptCharacter } from '../../components/conceptCharacter';
import { conceptLabel, useT } from '../../i18n';

/**
 * HomePage — 기본 진입(`/`)의 대시보드. 시안 `Soft Cloud 홈`의 구현이다.
 *
 * 2026-08-05 이전에는 `/`가 곧 학습 경로였다. 홈이 생기면서 학습 경로는
 * `/learn`으로 갈렸다(§CurriculumHome).
 *
 * **실제 API에 있는 값만 쓴다.** 시안이 문서로 남긴 매핑을 그대로 따랐다:
 *   Lv·XP·구름·스트릭 → 상단 바(Layout)가 소유한다 — 홈은 다시 그리지 않는다
 *   오늘의 목표      → me.daily_goal_items / me.today_answered_count (배치고사 제외는 서버)
 *   연속 출석        → me.streak_count / me.streak_freeze_count
 *   학습 세션 카드   → /curriculum 의 현재 유닛
 *   다시 볼 개념     → /progress/review-queue (due) + /progress/weak-tags (정답률 낮음)
 *   WeatherBrain     → /progress/abilities (개념 6종 θ · level_label)
 *   리그 티어        → me.tier
 *
 * 시안에 있었으나 **뺀 것**: 「최근 활동」(XP 로그) — 조회 엔드포인트가 없다.
 * 넣으려면 서버에 활동 조회가 먼저 생겨야 한다.
 *
 * 출석 체크(스트릭)는 기본 진입인 이 화면이 맡는다 — 학습 홈에서 옮겨왔다.
 * 두 화면이 같이 호출하면 하루에 두 번 POST 하게 된다.
 */

const TIER_KEYS = ['stratus', 'cumulus', 'nimbostratus', 'cumulonimbus', 'typhoon_eye'];

/** θ(로짓)를 레이더 반지름 0~1로. 대략 -3..+3 범위를 쓴다(schemas/progress.py). */
function thetaToRatio(theta) {
  return Math.min(1, Math.max(0.12, (theta + 3) / 6));
}

function Radar({ abilities, t }) {
  const n = abilities.length;
  if (n < 3) return null;
  const cx = 100;
  const cy = 100;
  const R = 80;
  const at = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r];
  };
  const ring = (r) =>
    abilities.map((_, i) => at(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = abilities
    .map((a, i) => at(i, thetaToRatio(a.theta)).map((v) => v.toFixed(1)).join(','))
    .join(' ');

  return (
    <svg
      viewBox="0 0 200 200"
      className="h-[190px] w-[190px] flex-none"
      role="img"
      aria-label={t('home.brain.aria', {
        list: abilities.map((a) => `${conceptLabel(t, a.concept_tag)} ${t(`ability.level.${a.level_label}`)}`).join(', '),
      })}
    >
      <g fill="none" stroke="#DDE8F1" strokeWidth="1">
        {[1, 0.66, 0.33].map((r) => (
          <polygon key={r} points={ring(r)} />
        ))}
      </g>
      <g stroke="#DDE8F1" strokeWidth="1">
        {abilities.map((a, i) => {
          const [x, y] = at(i, 1);
          return <line key={a.concept_tag} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>
      <polygon points={shape} fill="rgba(2,132,199,.22)" stroke="#0284C7" strokeWidth="2" strokeLinejoin="round" />
      <g fill="#0284C7">
        {abilities.map((a, i) => {
          const [x, y] = at(i, thetaToRatio(a.theta));
          return <circle key={a.concept_tag} cx={x} cy={y} r="3" />;
        })}
      </g>
    </svg>
  );
}

function Card({ title, cap, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`}>
      <h3 className="text-[13.5px] font-extrabold text-slate-900">{title}</h3>
      {cap && <p className="mt-0.5 text-[11.5px] text-slate-400">{cap}</p>}
      {children}
    </div>
  );
}

export default function HomePage() {
  const t = useT();
  useAttendance(true);

  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });
  const { data: tree } = useQuery({
    queryKey: ['curriculum'],
    queryFn: () => curriculumApi.fetchCurriculum(),
    staleTime: 30_000,
  });
  const { data: abilities } = useQuery({
    queryKey: ['progress', 'abilities'],
    queryFn: progressApi.fetchAbilities,
    staleTime: 60_000,
  });
  const { data: reviewQueue } = useQuery({
    queryKey: ['progress', 'review-queue'],
    queryFn: async () => (await client.get('/progress/review-queue')).data,
    staleTime: 60_000,
  });

  // 현재 유닛 — 학습 세션 카드의 부제. status는 서버 파생(R7-02 S4).
  const units = (tree?.sections ?? []).flatMap((s) => s.units);
  const current =
    units.find((u) => (u.status ?? (u.cleared ? 'cleared' : u.locked ? 'locked' : 'current')) === 'current') ??
    units.find((u) => u.status === 'unlocked') ??
    null;

  const goalTotal = me?.daily_goal_items ?? null;
  const goalDone = me?.today_answered_count ?? 0;
  const goalPct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;
  const remaining = goalTotal ? Math.max(0, goalTotal - goalDone) : 0;

  // 다시 볼 개념 — due인 것 우선, 상위 2개. review-queue가 next_review_at
  // 오름차순이라 그대로 앞에서 자른다(ReviewQueueCard와 같은 소비 방식).
  const due = (reviewQueue ?? []).filter((r) => r.due).slice(0, 2);

  const tierIdx = Math.max(0, TIER_KEYS.indexOf(me?.tier ?? 'stratus'));

  return (
    <div className="pt-2">
      <GuestSaveBanner />

      {/* 인사 — 스탯(Lv·XP·구름·스트릭)은 상단 바가 이미 전 화면에서 보여준다.
          여기 한 번 더 두면 같은 값이 한 화면에 두 벌이라 시선이 오른쪽으로 쏠린다. */}
      <div className="mb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight text-slate-900">{t('home.greet')}</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500">{t('home.greetSub')}</p>
      </div>

      {/* 바로 시작하기 */}
      <p className="text-xs font-extrabold tracking-wider text-slate-400">{t('home.quickStart')}</p>
      {/* 네 칸은 **같은 격**이다 — 마우스를 올린 칸만 파랗게 든다.
          학습 세션만 늘 진한 파랑이던 것을 걷어냈다(2026-08-05): 고정 강조는
          "지금 여기가 선택돼 있다"로 읽혀서, 다른 칸에 올려도 반응이 없는 것처럼
          보였다. 강조는 상태가 아니라 **가리킴**이어야 한다. */}
      <div className="mt-2.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { to: '/learn', icon: '🎓', k: 'learn', desc: current ? current.title : t('home.entry.learnEmpty'), cta: t('home.entry.learnGo') },
          { to: '/board', icon: '🧩', k: 'board' },
          { to: '/duel', icon: '🌡️', k: 'duel' },
          { to: '/league', icon: '🏆', k: 'league', desc: t('home.entry.leagueDesc', { tier: t(`tier.name.${TIER_KEYS[tierIdx]}`) }) },
        ].map((e) => (
          <Link
            key={e.to}
            to={e.to}
            className="group flex min-h-[118px] flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-sky-600 hover:bg-sky-600 focus-visible:border-sky-600 focus-visible:bg-sky-600"
          >
            <span className="text-[22px]" aria-hidden="true">{e.icon}</span>
            <span className="text-[13.5px] font-extrabold text-slate-900 group-hover:text-white group-focus-visible:text-white">
              {t(`home.entry.${e.k}`)}
            </span>
            <span className="text-[11.5px] leading-snug text-slate-500 group-hover:text-sky-100 group-focus-visible:text-sky-100">
              {e.desc ?? t(`home.entry.${e.k}Desc`)}
            </span>
            <span className="mt-auto text-[11.5px] font-extrabold text-sky-700 group-hover:text-white group-focus-visible:text-white">
              {e.cta ?? t('home.entry.go')}
            </span>
          </Link>
        ))}
      </div>

      {/* 오늘의 목표 · 연속 출석 */}
      <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card title={t('home.goal.title')} cap={t('home.goal.cap')}>
          {goalTotal ? (
            <>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[26px] font-extrabold tracking-tight tabular-nums text-sky-700">{goalDone}</span>
                <span className="text-[13px] font-bold tabular-nums text-slate-400">/ {goalTotal} {t('home.goal.items')}</span>
              </div>
              <div className="mt-2 h-[9px] overflow-hidden rounded-full bg-sky-100">
                <i className="block h-full rounded-full bg-sky-600" style={{ width: `${goalPct}%` }} />
              </div>
              <p className="mt-2 text-[11.5px] text-slate-500">
                {remaining > 0 ? t('home.goal.remaining', { n: remaining }) : t('home.goal.done')}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[12.5px] text-slate-500">{t('home.goal.unset')}</p>
          )}
        </Card>

        <Card
          title={t('home.streak.title')}
          cap={t('home.streak.cap', { n: me?.streak_freeze_count ?? 0 })}
        >
          <div className="mt-3 flex gap-1.5">
            {t('home.streak.days').split(',').map((label, i) => {
              // 서버는 **요일별 출석 이력을 주지 않는다** — streak_count(연속 일수)뿐이다.
              // 그래서 이번 주 월~일 칸을 오늘부터 거꾸로 streak만큼 칠한다.
              // 미래 요일은 절대 칠하지 않는다(diff < 0) — 오늘이 수요일인데 금·토·일이
              // 체크돼 보이던 버그가 여기서 났다. 요일별 실이력이 필요하면 API가 먼저다.
              const todayIdx = (new Date().getDay() + 6) % 7; // 월=0 … 일=6
              const diff = todayIdx - i;
              const done = diff >= 0 && diff < (me?.streak_count ?? 0);
              return (
                <div key={label} className="flex-1 text-center">
                  <div
                    className={`grid h-[30px] place-items-center rounded-[9px] text-xs font-extrabold ${
                      done ? 'bg-sky-600 text-white' : 'bg-sky-100 text-sky-300'
                    } ${i === todayIdx ? 'ring-2 ring-inset ring-sky-900' : ''}`}
                  >
                    {done ? '✓' : '·'}
                  </div>
                  <div className="mt-1 text-[10.5px] text-slate-400">{label}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 다시 볼 개념 · WeatherBrain */}
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card title={t('home.review.title')} cap={t('home.review.cap')}>
          {due.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-slate-500">{t('home.review.empty')}</p>
          ) : (
            due.map((r) => (
              <div key={r.concept_tag} className="mt-3 flex items-center gap-2.5">
                <Mascot name={conceptCharacter(r.concept_tag)} className="h-12 w-12 flex-none object-contain" />
                <div className="min-w-0">
                  <p className="text-[13px] font-extrabold text-slate-900">{conceptLabel(t, r.concept_tag)}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">
                    {t('home.review.meta', { n: r.consecutive_correct ?? 0, d: r.interval_days ?? 0 })}
                  </p>
                </div>
                <Link
                  to="/daily"
                  className="ml-auto flex-none rounded-[10px] bg-sky-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-sky-700"
                >
                  {t('home.review.cta')}
                </Link>
              </div>
            ))
          )}
        </Card>

        <Card title={t('home.brain.title')} cap={t('home.brain.cap')}>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            <Radar abilities={abilities ?? []} t={t} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {(abilities ?? []).map((a) => (
                <div key={a.concept_tag} className="flex items-center gap-2 text-xs">
                  <Mascot name={conceptCharacter(a.concept_tag)} className="h-7 w-7 flex-none object-contain" />
                  <span className="min-w-0 truncate font-bold text-slate-700">{conceptLabel(t, a.concept_tag)}</span>
                  <span className="ml-auto flex-none text-[11.5px] font-extrabold text-sky-700">
                    {t(`ability.level.${a.level_label}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* 자유 일일 세션 */}
      <div className="mt-3.5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-800">{t('curriculum.daily.title')}</p>
          <RegionPicker />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{t('curriculum.daily.body')}</p>
        <Link
          to="/daily"
          className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
        >
          {t('curriculum.daily.cta')}
        </Link>
      </div>
    </div>
  );
}

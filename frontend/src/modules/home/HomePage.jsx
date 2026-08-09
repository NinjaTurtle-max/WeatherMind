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

/** 유닛 status는 서버 파생(R7-02 S4). 옛 응답(status 없음)만 cleared/locked로 되짚는다. */
const unitStatus = (u) => u.status ?? (u.cleared ? 'cleared' : u.locked ? 'locked' : 'current');

/**
 * 홈의 학습 진입 **1개**를 고른다 (R13-01 §2.5).
 *
 * 왜 하나인가: 「바로 시작하기」에 학습·보드·대결·리그 네 칸이 같은 격으로 서 있어서
 * 처음 온 사람은 무엇부터 눌러야 하는지 알 수 없었다(사전 교육 Mo2의 "진입 실패"
 * 신호 그대로 — 뭘 눌러야 할지 모른 채 스크롤). 첫 화면에는 **눌러야 할 것 하나**만
 * 둔다. 나머지 셋은 보조 링크로 내린다.
 *
 * 우선순위 — 위에서부터 처음 맞는 것 하나:
 *   1. unit  진행 중 유닛이 있다  → 이어서 푼다
 *   2. daily 오늘 일일 세션을 아직 안 했다 → 오늘 몫을 시작한다
 *   3. done  둘 다 없다 → 완료 축하
 *
 * "진행 중 유닛"의 판정 근거는 **서버가 준 유닛 status**다. 백엔드
 * `build_curriculum`이 트리 전체에서 잠기지 않은 첫 미클리어 유닛 정확히 1개를
 * `current`로 승격해 내려준다 — 프론트가 진도를 다시 계산하지 않는다(계산하면
 * 선행 잠금·배치 θ 선해제 규칙 사본을 프론트가 갖게 된다). `current`가 없고
 * `unlocked`만 있는 응답(구 서버·부분 트리)도 진행 중으로 본다.
 *
 * "오늘 일일 세션 미발급"의 근거는 `/progress/me`의 `today_answered_count`다.
 * 서버가 answered_at 날짜로 매번 재계산하고 **배치고사는 이미 빼고** 준다.
 * 목표(daily_goal_items)가 설정돼 있으면 목표 도달을, 아니면 "오늘 한 문항이라도
 * 풀었는가"를 완료로 본다. 세션 발급 여부를 직접 알려주는 엔드포인트는 없다 —
 * 있으면 그걸 쓰는 게 맞다(이월 참조).
 */
export function pickHomeEntry({ units = [], todayAnswered = 0, dailyGoal = null } = {}) {
  const current =
    units.find((u) => unitStatus(u) === 'current') ??
    units.find((u) => unitStatus(u) === 'unlocked') ??
    null;
  if (current) return { kind: 'unit', unit: current, to: '/learn' };

  const goal = Number(dailyGoal) > 0 ? Number(dailyGoal) : 0;
  const dailyDone = goal > 0 ? todayAnswered >= goal : todayAnswered > 0;
  if (!dailyDone) return { kind: 'daily', unit: null, to: '/daily' };

  return { kind: 'done', unit: null, to: '/learn' };
}

/** 진입 카드의 화자 — 학습은 태양이, 오늘 몫은 번개, 완료는 메인 튜터 구름이. */
const ENTRY_MASCOT = { unit: 'sun', daily: 'bolt', done: 'cloud' };

/**
 * KST 기준 요일(월=0 … 일=6) — CO-T-8.
 *
 * `new Date().getDay()`는 **브라우저 로컬 타임존** 요일이라 심사 PC가 KST가 아니면
 * 스트릭 달력이 하루 어긋난다(서버 하루는 KST다). 목(`mock/apiMockPlugin.js`)이
 * 하루 경계에 쓰는 것과 **같은 계산**이지만, 목을 import하지는 않는다 —
 * 목은 개발 전용 산출물이고 제품 번들이 의존하면 안 된다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export function kstWeekdayIndex(nowMs = Date.now()) {
  return (new Date(nowMs + KST_OFFSET_MS).getUTCDay() + 6) % 7;
}

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

  const { data: me, isError: meError, refetch: refetchMe } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });
  const { data: tree, isError: treeError, refetch: refetchTree } = useQuery({
    queryKey: ['curriculum'],
    queryFn: () => curriculumApi.fetchCurriculum(),
    staleTime: 30_000,
  });
  const { data: abilities, isError: abilitiesError, refetch: refetchAbilities } = useQuery({
    queryKey: ['progress', 'abilities'],
    queryFn: progressApi.fetchAbilities,
    staleTime: 60_000,
  });
  const { data: reviewQueue, isError: reviewError, refetch: refetchReview } = useQuery({
    queryKey: ['progress', 'review-queue'],
    queryFn: async () => (await client.get('/progress/review-queue')).data,
    staleTime: 60_000,
  });

  // CO-S-2 — 홈은 장애를 **말해야 한다**.
  //
  // 2026-08-07까지 이 화면의 쿼리 넷은 `data`만 구조분해했다. 전 API가 500이어도
  // 화면은 "첫 유닛부터 시작해요" + "지금 복습할 개념이 없어요. 잘하고 있어요!"를
  // 그렸다 — **정상인데 할 게 없음**이라는 거짓말이다. `/learn`·`/league`·`/duel`·
  // `/me`는 전부 에러 카드가 있는데 첫 화면만 없었다.
  //
  // 알림은 **한 곳에 모은다**(카드마다 흩뿌리면 같은 문장이 네 벌 뜬다). 대신
  // 실패한 쿼리의 카드는 **렌더하지 않는다** — 빈 상태 문구가 곧 거짓말이라서다.
  // 재시도는 실패한 쿼리만 다시 부른다(성공한 것까지 흔들 이유가 없다).
  const hasError = meError || treeError || abilitiesError || reviewError;
  const retryFailed = () => {
    if (meError) refetchMe();
    if (treeError) refetchTree();
    if (abilitiesError) refetchAbilities();
    if (reviewError) refetchReview();
  };

  const units = (tree?.sections ?? []).flatMap((s) => s.units);

  const goalTotal = me?.daily_goal_items ?? null;
  const goalDone = me?.today_answered_count ?? 0;
  const goalPct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;
  const remaining = goalTotal ? Math.max(0, goalTotal - goalDone) : 0;

  // 다시 볼 개념 — due인 것 우선, 상위 2개. review-queue가 next_review_at
  // 오름차순이라 그대로 앞에서 자른다(ReviewQueueCard와 같은 소비 방식).
  const due = (reviewQueue ?? []).filter((r) => r.due).slice(0, 2);

  const tierIdx = Math.max(0, TIER_KEYS.indexOf(me?.tier ?? 'stratus'));

  // 학습 진입은 **하나**다 — 무엇을 보여줄지는 pickHomeEntry가 정한다(§2.5).
  // 트리가 아직 안 왔을 때(첫 렌더)는 "진행 중 유닛 없음"으로 단정하지 않는다.
  // 단정하면 대다수 사용자에게 '오늘의 세션'이 한 프레임 떴다가 '이어서 학습'으로
  // 바뀌는 깜빡임이 생긴다 — 목적지가 바뀌는 깜빡임은 오클릭을 만든다.
  const entry =
    tree === undefined
      ? { kind: 'unit', unit: null, to: '/learn' }
      : pickHomeEntry({ units, todayAnswered: goalDone, dailyGoal: goalTotal });
  const ENTRY_COPY = {
    unit: {
      eyebrow: t('home.entry.learn'),
      title: entry.unit?.title ?? t('home.entry.learnEmpty'),
      body: t('home.entry.unitBody'),
      cta: t('home.entry.learnGo'),
    },
    daily: {
      eyebrow: t('home.entry.todayLabel'),
      title: t('curriculum.daily.title'),
      body: t('curriculum.daily.body'),
      cta: t('curriculum.daily.cta'),
    },
    done: {
      eyebrow: t('home.entry.todayLabel'),
      title: t('home.entry.doneTitle'),
      body: t('home.entry.doneBody'),
      cta: t('home.entry.doneCta'),
    },
  };
  const copy = ENTRY_COPY[entry.kind];

  // 보조 진입 — 학습 카드와 **같은 격이 아니다**(카드가 아니라 링크).
  // 자유 일일 세션은 지역 설정과 함께 화면 맨 아래 보조 줄이 소유한다.
  const secondary = [
    { to: '/board', label: t('home.entry.board') },
    { to: '/duel', label: t('home.entry.duel') },
    { to: '/league', label: t('home.entry.leagueDesc', { tier: t(`tier.name.${TIER_KEYS[tierIdx]}`) }) },
  ];

  return (
    <div className="pt-2">
      <GuestSaveBanner />

      {/* 인사 — 스탯(Lv·XP·구름·스트릭)은 상단 바가 이미 전 화면에서 보여준다.
          여기 한 번 더 두면 같은 값이 한 화면에 두 벌이라 시선이 오른쪽으로 쏠린다. */}
      <div className="mb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight text-slate-900">{t('home.greet')}</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500">{t('home.greetSub')}</p>
      </div>

      {/* 장애 안내(CO-S-2) — role="alert"로 **소리내어** 알린다(S-A2 계열).
          여기 하나뿐이고, 실패한 카드는 아래에서 통째로 빠진다. */}
      {hasError && (
        <div
          role="alert"
          data-testid="home-error"
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4"
        >
          <p className="text-[13.5px] font-extrabold text-rose-700">{t('home.error.title')}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-rose-600">{t('home.error.body')}</p>
          <button
            type="button"
            onClick={retryFailed}
            className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-[12.5px] font-extrabold text-white transition hover:bg-rose-700"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* 바로 시작하기 — 진입 카드 **1개**(R13-01 §2.5).
          2026-08-06까지는 여기 네 칸(학습·보드·대결·리그)이 같은 격으로 서 있었다.
          "같은 격"은 고르는 사람에게는 "무엇이 먼저인지 아무도 모른다"와 같다.
          이제 서버 상태가 하나를 고르고(pickHomeEntry), 나머지는 아래 보조 줄로
          내려간다. 탭 구조(내비)는 손대지 않는다 — 진입은 본문의 문제였다. */}
      {/* 트리 조회가 실패하면 진입 카드를 내린다(CO-S-2) — 실패했을 때의 기본값이
          "첫 유닛부터 시작해요 / 이어서 풀기 →"라서, 같이 죽은 `/learn`으로
          보내는 **틀린 CTA**가 된다. 이때 눌러야 할 것은 위의 재시도다. */}
      {!treeError && (
        <>
          <p className="text-xs font-extrabold tracking-wider text-slate-400">{t('home.quickStart')}</p>
          <Link
            to={entry.to}
            data-testid="home-entry"
            data-entry-kind={entry.kind}
            className="group mt-2.5 flex items-center gap-4 rounded-2xl border border-sky-200 bg-white p-4 transition-colors hover:border-sky-600 hover:bg-sky-50 focus-visible:border-sky-600 focus-visible:bg-sky-50"
          >
            <Mascot name={ENTRY_MASCOT[entry.kind]} className="h-16 w-16 flex-none" />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-extrabold tracking-wider text-sky-700">{copy.eyebrow}</p>
              <p className="mt-0.5 truncate text-[17px] font-extrabold text-slate-900">{copy.title}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{copy.body}</p>
            </div>
            <span className="flex-none rounded-xl bg-sky-600 px-4 py-2.5 text-[13px] font-extrabold text-white transition group-hover:bg-sky-700">
              {copy.cta}
            </span>
          </Link>
        </>
      )}

      {/* 보조 진입 — 주 카드보다 약하게. 링크지 카드가 아니다. */}
      <div data-testid="home-secondary" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[11.5px] text-slate-400">{t('home.entry.more')}</span>
        {secondary.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="text-[12px] font-bold text-slate-500 underline-offset-4 hover:text-sky-700 hover:underline"
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* 오늘의 목표 · 연속 출석 */}
      {/* 둘 다 `/progress/me` 하나에서 온다 — 그 조회가 실패하면 "아직 목표를 정하지
          않았어요"·빈 주간 달력이 **정상 상태처럼** 보이므로 카드째 내린다(CO-S-2). */}
      <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {!meError && (
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
        )}

        {!meError && (
        <Card
          title={t('home.streak.title')}
          /* CO-T-6 — 프리즈 0개일 때 이 캡션은 **거짓말**이다("하루 빠져도 스트릭이
             지켜져요"). 획득 경로가 "스트릭 7일 +1" 하나뿐이라 신규·심사 계정은
             항상 0개다. n≥1일 때만 참이므로 그때만 렌더한다(문구는 그대로). */
          cap={(me?.streak_freeze_count ?? 0) > 0
            ? t('home.streak.cap', { n: me.streak_freeze_count })
            : null}
        >
          <div className="mt-3 flex gap-1.5">
            {t('home.streak.days').split(',').map((label, i) => {
              // 서버는 **요일별 출석 이력을 주지 않는다** — streak_count(연속 일수)뿐이다.
              // 그래서 이번 주 월~일 칸을 오늘부터 거꾸로 streak만큼 칠한다.
              // 미래 요일은 절대 칠하지 않는다(diff < 0) — 오늘이 수요일인데 금·토·일이
              // 체크돼 보이던 버그가 여기서 났다. 요일별 실이력이 필요하면 API가 먼저다.
              // 요일은 **KST 기준**이다(CO-T-8) — `new Date().getDay()`는 브라우저
              // 로컬 타임존이라 심사 PC가 KST가 아니면 서버 하루와 어긋난다.
              const todayIdx = kstWeekdayIndex(); // 월=0 … 일=6
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
        )}
      </div>

      {/* 다시 볼 개념 · WeatherBrain */}
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* 조회 실패 시 "지금 복습할 개념이 없어요. 잘하고 있어요!"가 뜨는 자리다
            — 서버가 죽은 것을 **칭찬**으로 바꿔 말하던 문장이라 카드째 내린다. */}
        {!reviewError && (
        <Card title={t('home.review.title')} cap={t('home.review.cap')}>
          {due.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-slate-500">{t('home.review.empty')}</p>
          ) : (
            due.map((r) => (
              <div key={r.concept_tag} className="mt-3 flex items-center gap-2.5">
                <Mascot name={conceptCharacter(r.concept_tag)} className="h-12 w-12 flex-none" />
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
        )}

        {!abilitiesError && (
        <Card title={t('home.brain.title')} cap={t('home.brain.cap')}>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            {/* CO-S-9 — 홈 카드 중 유일하게 빈 문구 분기가 없던 자리.
                개념 3종 미만이면 Radar가 null이라(다각형이 안 그려진다) 기록이
                0건일 때 제목+설명 뒤가 통째로 비었다. 레이더 자리에 사유를
                적는다 — 1~2건이라도 있으면 오른쪽 목록은 그대로 보여준다. */}
            {(abilities ?? []).length < 3 ? (
              <p className="flex-1 text-[12.5px] leading-relaxed text-slate-500">{t('home.brain.empty')}</p>
            ) : (
              <Radar abilities={abilities ?? []} t={t} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {(abilities ?? []).map((a) => (
                <div key={a.concept_tag} className="flex items-center gap-2 text-xs">
                  <Mascot name={conceptCharacter(a.concept_tag)} className="h-7 w-7 flex-none" />
                  <span className="min-w-0 truncate font-bold text-slate-700">{conceptLabel(t, a.concept_tag)}</span>
                  <span className="ml-auto flex-none text-[11.5px] font-extrabold text-sky-700">
                    {t(`ability.level.${a.level_label}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        )}
      </div>

      {/* 자유 일일 세션 — **보조 링크로 강등**(§2.5). 예전에는 검은 채움 버튼이라
          위의 학습 진입과 무게가 비슷했다. 학습 지역 설정과 한 줄에 둔다.

          CO-S-9 — 진입 카드가 이미 일일 세션일 때는(kind='daily') 위아래가
          `curriculum.daily.body`·`curriculum.daily.cta`를 **글자 그대로 두 번**
          그렸다. 같은 문장·같은 목적지가 한 화면에 두 벌이면 §2.5가 없앤
          "무엇을 누를지 모름"이 그대로 돌아온다 — 주 카드를 남기고 이 줄의
          중복분만 내린다(지역 픽커는 여기 말고 자리가 없으므로 남는다). */}
      <div
        data-testid="home-free-daily"
        className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3"
      >
        {entry.kind !== 'daily' && (
          <>
            <p className="text-[12.5px] text-slate-500">{t('curriculum.daily.body')}</p>
            <Link
              to="/daily"
              className="text-[12.5px] font-bold text-slate-600 underline underline-offset-4 hover:text-sky-700"
            >
              {t('curriculum.daily.cta')}
            </Link>
          </>
        )}
        <div className="ml-auto">
          <RegionPicker />
        </div>
      </div>
    </div>
  );
}

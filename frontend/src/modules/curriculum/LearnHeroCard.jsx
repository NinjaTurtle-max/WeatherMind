import { Link } from 'react-router-dom';
import Mascot from '../../components/Mascot';
import RegionPicker from '../../components/RegionPicker';
import ReviewQueueCard from '../../components/ReviewQueueCard';
import { ENTRY_MASCOT } from './learnEntry';
import { useT } from '../../i18n';

/**
 * LearnHeroCard — 학습 화면 맨 위 **가로 배너**.
 *
 * 홈 화면을 지우고 학습 하나로 합치면서, 홈에 흩어져 있던 진입 카드·오늘의 목표·
 * 복습 큐·자유 일일 세션·학습 지역을 이 한 장이 흡수했다. 흰 카드가 8장이라
 * 화면이 지저분하다는 지적에서 나온 통합이다.
 *
 * 배치가 두 번 바뀌었다(2026-08-09, 사용자 시안):
 *   ① 오른쪽 **세로 레일** — 마스코트가 위, 내용이 아래로 흐르는 296px 기둥.
 *      트랙 옆을 차지해 경로가 810px에 묶였다.
 *   ② 지금: 위쪽 **가로 배너**(시안 1c). 배너가 홈 몫을 다 흡수하고 트랙은
 *      레일 없이 **폭 전체**를 쓴다.
 * 세로로 길게 늘일 필요가 없어져 「남는 여백을 무엇으로 채우나」 문제도 같이
 * 사라졌다 — 세로 카드에서 그 여백은 110px이었다.
 *
 * 톤: 흰색~sky-50에 헤어라인 테두리. 파란색은 **CTA가 독점**하고 나머지는 무채색
 * 위계다(제목 slate-900 · 본문 slate-500). 색이 여러 곳에 흩어지면 어디를
 * 눌러야 하는지가 다시 흐려진다.
 *
 * ⚠️ 바깥을 `<Link>`로 감싸지 않는다. 안에 복습·자유 세션 링크와 지역 픽커
 * (버튼)가 있어 `<a>` 중첩·버튼 중첩이 된다 — 브라우저가 태그를 쪼개 React
 * 마크업과 실제 DOM이 갈린다. 누를 수 있는 것은 CTA·복습·세션·지역뿐이다.
 *
 * 마스코트는 **물방울이**(learnEntry.ENTRY_MASCOT). 사이드바 튜터가 /learn에서
 * 같은 캐릭터를 그리므로 그 화면에서는 SideNav가 튜터를 접는다.
 */
export default function LearnHeroCard({
  entry,
  copy,
  goalTotal,
  goalDone,
  dailyBlocked = false,
  energyBlocked = false,
  regenMin = 1,
}) {
  const t = useT();
  const pct = goalTotal ? Math.min(100, Math.round((goalDone / goalTotal) * 100)) : 0;

  return (
    <div
      data-testid="learn-entry"
      data-entry-kind={entry.kind}
      className="flex flex-col gap-3.5 rounded-[20px] bg-gradient-to-b from-white to-sky-50 px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80 lg:flex-row lg:items-center lg:gap-6"
    >
      {/* 왼쪽 — 캐릭터 + 진입.
          min-w-0: 플렉스 항목은 기본이 min-width:auto라 긴 유닛명이 오른쪽 칸을
          밀어낸다(제목이 한 줄에 안 들어가는 순간 배너가 깨진다). */}
      <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
        <Mascot
          name={ENTRY_MASCOT[entry.kind] ?? 'drop'}
          className="h-[88px] w-[88px] flex-none sm:h-[104px] sm:w-[104px]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            {copy.eyebrow}
          </p>
          <p className="mt-0.5 break-keep text-[21px] font-extrabold leading-snug tracking-[-0.02em] text-slate-900">
            {copy.title}
          </p>
          <p className="mt-1 break-keep text-[12.5px] leading-relaxed text-slate-500">{copy.body}</p>

          {/* 오늘의 목표 + CTA를 한 줄에. 세로 배너였을 때는 목표가 카드 바닥에
              따로 앉았는데, 가로에서는 진행 바가 CTA 옆에 있어야 "얼마나 남았고
              어디를 누르나"가 한 눈에 붙는다.
              ⚠️ 목표 미설정이어도 **자리를 숨기지 않는다** — 홈이 사라진 뒤로
              목표를 정하는 통로가 이 화면에 없어서, 숨기면 기능째 사라진다
              (2026-08-09 사용자 제보). 대신 내 정보(설정 통로)로 보낸다. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {goalTotal ? (
              <div className="min-w-[180px] flex-1" data-testid="learn-goal" data-goal-state="set">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold text-slate-500">{t('home.goal.title')}</span>
                  <span className="ml-auto text-[12px] font-bold tabular-nums text-slate-500">
                    {goalDone} / {goalTotal} {t('home.goal.items')}
                  </span>
                </div>
                <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-slate-200/80">
                  <i className="block h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ) : (
              <Link
                to="/me"
                data-testid="learn-goal"
                data-goal-state="unset"
                className="min-w-[180px] flex-1 text-[12px] font-bold text-slate-500"
              >
                {t('home.goal.title')}
                <span className="ml-2 text-sky-600">{t('curriculum.goalUnset')}</span>
              </Link>
            )}

            <Link
              to={entry.to}
              data-testid="learn-entry-cta"
              className="flex-none rounded-full bg-sky-600 px-5 py-2.5 text-[13.5px] font-bold tracking-[-0.01em] text-white transition hover:bg-sky-700"
            >
              {copy.cta}
            </Link>
          </div>
        </div>
      </div>

      {/* 오른쪽 — 복습 + 자유 일일 세션.
          lg↑에서만 세로 구분선을 준다. 그 아래에서는 배너가 세로로 접히므로
          왼쪽 선이 허공에 뜬다(가로 선으로 바꾼다). */}
      <div className="flex w-full flex-none flex-col gap-3 border-t border-slate-200/80 pt-4 lg:w-[300px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <ReviewQueueCard variant="hero" />

        {/* 자유 일일 세션 — 카드가 아니라 한 줄이다. 카드로 두면 위 CTA와 무게가
            비슷해져 "무엇을 누를지 모름"이 돌아온다(§2.5).

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
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-slate-400"
        >
          <span className="font-medium">{t('curriculum.daily.title')}</span>
          <RegionPicker />
          {dailyBlocked ? (
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="cursor-not-allowed font-bold text-slate-300"
              >
                {t('curriculum.daily.cta')}
              </button>
              <span className="text-[11px] font-bold text-rose-500">
                {t('curriculum.daily.regen', { min: regenMin })}
              </span>
            </span>
          ) : (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <Link to="/daily" className="font-bold text-sky-600 hover:text-sky-700">
                {energyBlocked ? t('curriculum.daily.resume') : t('curriculum.daily.cta')}
              </Link>
              {energyBlocked && (
                <span className="text-[11px] font-bold text-rose-500">
                  {t('curriculum.daily.regenResume', { min: regenMin })}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
